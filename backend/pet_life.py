"""Bounded personal-pet life state. No network, timers, blobs or background jobs."""
from __future__ import annotations

import copy
import hashlib
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import HTTPException

KYIV = ZoneInfo("Europe/Kyiv")
SHOP_PRICES = {
    "bed-basic": {"cardboard": 2, "fabric": 1},
    "bowl-amber": {"cardboard": 2, "leaf": 1},
    "toy-wand": {"string": 2, "feather": 1},
    "wall-neon": {"cardboard": 2, "string": 1},
    "rug-cyan": {"cardboard": 5, "leaf": 2, "feather": 1},
    "plant-moon": {"cardboard": 7, "leaf": 5, "feather": 3},
    "fort-cardboard": {"cardboard": 16, "string": 8, "leaf": 4, "feather": 2},
    "pillow-starlight": {"cardboard": 18, "fabric": 15, "leaf": 10, "feather": 7},
}
SKILLS = {
    "hunter": {"name": "Мисливець", "action": "play", "description": "Уважне полювання й гра з вудочкою.", "unlock": "Особлива мисливська гра й стрибок за пір’їнкою"},
    "explorer": {"name": "Дослідник", "action": "explore", "description": "Дослідження слідів і нових куточків.", "unlock": "Пошук схованок і сміливі сюжетні варіанти"},
    "actor": {"name": "Артист", "action": "perform", "description": "Трюки, виразні пози й маленькі виступи.", "unlock": "Виступ для господаря й нові жести"},
    "thinker": {"name": "Розумник", "action": "puzzle", "description": "Головоломки та спостереження.", "unlock": "Складні загадки й розшифрування знаків"},
    "companion": {"name": "Компаньйон", "action": "rest", "description": "Спокій, підтримка та повага до меж.", "unlock": "Спільний тихий ритуал і довірливі відповіді"},
}
ROOM_THEMES = [
    {"id": "cyber", "name": "Кіберпанк"}, {"id": "home", "name": "Теплий дім"},
    {"id": "nature", "name": "Зелений сад"}, {"id": "space", "name": "Космос"},
]
ROUTINE = [
    {"id": "night", "start": 0, "end": 7, "label": "Нічний сон", "action": "rest", "pose": "sleep", "zone": "bed"},
    {"id": "breakfast", "start": 7, "end": 10, "label": "Сніданок", "action": "feed", "pose": "sit", "zone": "bowl"},
    {"id": "hunt", "start": 10, "end": 13, "label": "Час полювання", "action": "play", "pose": "play", "zone": "toy"},
    {"id": "nap", "start": 13, "end": 16, "label": "Денний сон", "action": "rest", "pose": "sleep", "zone": "bed"},
    {"id": "study", "start": 16, "end": 19, "label": "Маленьке дослідження", "action": "play", "pose": "sit", "zone": "shelf"},
    {"id": "together", "start": 19, "end": 22, "label": "Вечірня увага", "action": "pet", "pose": "sit", "zone": "bed"},
    {"id": "zoomies", "start": 22, "end": 24, "label": "Останнє коло перед сном", "action": "play", "pose": "play", "zone": "toy"},
]
DELAYED = {
    "box": {"title": "У коробки є майбутнє", "text": "Котик перетворив залишену коробку на маленьку схованку й приніс матеріали.", "hours": 24, "materials": {"cardboard": 2, "string": 1}, "mood": 4},
    "clue": {"title": "Нічний слід розкрито", "text": "Терпляче спостереження допомогло знайти пір’їнку й нову деталь загадки.", "hours": 8, "materials": {"feather": 1}, "skill": "thinker"},
    "friend": {"title": "Іскра завітала знову", "text": "Кішка, якій ви допомогли, залишила біля вікна листочок. Котик упізнав нову подругу.", "hours": 18, "materials": {"leaf": 2}, "mood": 6},
    "mess": {"title": "Наслідок невгамовної гри", "text": "Котик розкидав речі: час прибрати кімнату й полагодити улюблену іграшку.", "hours": 4, "cleanliness": -8, "wear": 18},
    "ritual": {"title": "Наш особливий вечір", "text": "Котик запам’ятав три вечори уваги й тепер сам кличе вас до лежанки.", "hours": 1, "mood": 6, "skill": "companion"},
    "noise": {"title": "Таємниця під полицею", "text": "Незрозумілий шум виявився клубком, що покотився до старої схованки.", "hours": 6, "materials": {"string": 2}},
}
FOODS = {"fish": "рибка", "balanced": "збалансований корм", "crunchy": "хрусткий корм", "treat": "ласощі"}
TOYS = {"wand": "вудочка", "ball": "м’ячик", "puzzle": "головоломка"}


def stamp(value):
    try:
        result = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return result.replace(tzinfo=timezone.utc) if result.tzinfo is None else result
    except (ValueError, TypeError):
        return None


def number(value, default=0, maximum=999):
    try:
        return max(0, min(maximum, int(value)))
    except (TypeError, ValueError, OverflowError):
        return default


def day(now):
    return now.astimezone(KYIV).date().isoformat()


def add_material(profile, key, amount):
    wallet = profile["inventory"]["materials"]
    existing = max(0, int(wallet.get(key, 0)))
    # Preserve legacy balances above the new accumulation cap.
    wallet[key] = max(existing, min(999, existing + amount))


def new_life(generation=1, previous=None):
    previous = previous or {}
    return {
        "version": 1, "generation": generation, "memories": [], "pending": [],
        "skills": {key: 0 for key in SKILLS}, "food_counts": {}, "toy_counts": {},
        "mood_reason": "Знайомство з домом", "activity_at": None, "last_care_at": None,
        "theme": previous.get("theme", "cyber"), "sound": previous.get("sound", "off"),
        "presets": copy.deepcopy(previous.get("presets", []))[:3],
        "condition": copy.deepcopy(previous.get("condition", {})), "wear_date": None,
        "public_room": bool(previous.get("public_room", False)),
        "exhibition": bool(previous.get("exhibition", False)), "evening_dates": [],
        "daily": copy.deepcopy(previous.get("daily", {})), "ritual_learned": False,
        "care_at": {}, "sleep": {}, "sleep_windows": [], "sleep_requests": [], "scene_marks": [],
    }


def ensure_life(profile, now):
    before = copy.deepcopy(profile.get("life"))
    life = profile.get("life")
    generation = number(profile.get("survival", {}).get("generation"), 1, 10000)
    if not isinstance(life, dict) or life.get("generation") != generation:
        life = new_life(generation, life if isinstance(life, dict) else None)
        profile["life"] = life
    for key, default in new_life(generation).items():
        if key not in life or isinstance(default, (dict, list)) and not isinstance(life[key], type(default)):
            life[key] = copy.deepcopy(default)
    life["memories"] = [m for m in life["memories"] if isinstance(m, dict)][-20:]
    life["scene_marks"] = [m for m in life["scene_marks"] if isinstance(m, dict)
        and m.get("kind") in {"box", "scraps", "butterfly", "ball", "visitor", "curtain", "key", "mess"}
        and stamp(m.get("expires_at")) and stamp(m["expires_at"]) > now][-8:]
    life["pending"] = [p for p in life["pending"] if isinstance(p, dict) and p.get("kind") in DELAYED and isinstance(p.get("id"), str) and stamp(p.get("due_at"))][-8:]
    life["presets"] = [p for p in life["presets"] if isinstance(p, dict) and p.get("id") in {"1", "2", "3"} and isinstance(p.get("name"), str) and isinstance(p.get("equipped"), dict) and isinstance(p.get("layout"), dict) and p.get("theme") in {t["id"] for t in ROOM_THEMES}][:3]
    if life["theme"] not in {t["id"] for t in ROOM_THEMES}:
        life["theme"] = "cyber"
    if life["sound"] not in {"off", "ambient"}:
        life["sound"] = "off"
    life["skills"] = {key: number(life["skills"].get(key), 0, 100) for key in SKILLS}
    life["food_counts"] = {key: number(life["food_counts"].get(key)) for key in FOODS}
    life["toy_counts"] = {key: number(life["toy_counts"].get(key)) for key in TOYS}
    life["condition"] = {key: number(value, 100, 100) for key, value in life["condition"].items() if key in SHOP_PRICES}
    if life["daily"].get("date") != day(now):
        life["daily"] = {"date": day(now), "activity_used": False, "search_used": False, "repairs": [], "skill_used": False}
    return before != life


def remember(profile, key, title, text, now, kind="memory", tone="neutral"):
    life = profile["life"]
    if any(m.get("id") == key for m in life["memories"]):
        return
    life["memories"] = [*life["memories"], {"id": key, "title": title, "text": text, "kind": kind, "tone": tone, "at": now.isoformat()}][-20:]
    life["mood_reason"] = text


def gain_skill(profile, skill, amount=4):
    if skill in SKILLS:
        skills = profile["life"]["skills"]
        skills[skill] = min(100, number(skills.get(skill), 0, 100) + amount)


def apply_need(profile, key, amount):
    exact = profile.setdefault("survival", {}).setdefault("needs_exact", {})
    value = max(0, min(100, float(exact.get(key, profile["stats"].get(key, 0))) + amount))
    exact[key] = value
    profile["stats"][key] = round(value)


def schedule(profile, kind, source, now):
    life = profile["life"]
    key = f"{source}:{kind}"
    if kind not in DELAYED or len(life["pending"]) >= 8 or any(p["id"] == key for p in life["pending"]):
        return
    life["pending"].append({"id": key, "kind": kind, "due_at": (now + timedelta(hours=DELAYED[kind]["hours"])).isoformat()})


def resolve_pending(profile, now):
    life = profile["life"]
    if profile["survival"].get("status") != "alive":
        life["pending"] = []
        return
    for pending in list(life["pending"]):
        due = stamp(pending.get("due_at"))
        if not due or due > now:
            continue
        definition = DELAYED[pending["kind"]]
        for material, amount in definition.get("materials", {}).items():
            add_material(profile, material, amount)
        for key in ("mood", "cleanliness"):
            if key in definition:
                apply_need(profile, key, definition[key])
        if definition.get("wear"):
            item = profile["inventory"]["equipped"].get("toy")
            if item:
                life["condition"][item] = max(0, life["condition"].get(item, 100) - definition["wear"])
        gain_skill(profile, definition.get("skill"), 6)
        if pending["kind"] == "mess":
            record_scene_choice(profile, "plant-crash", "later", now)
        remember(profile, pending["id"], definition["title"], definition["text"], now, "consequence", "cost" if definition.get("wear") else "positive")
        life["pending"].remove(pending)


def advance_life(profile, now):
    before = copy.deepcopy(profile.get("life"))
    ensure_life(profile, now)
    life = profile["life"]
    resolve_pending(profile, now)
    if profile["survival"].get("status") != "alive":
        return life != before
    if life.get("wear_date") != day(now):
        # One bounded wear tick per local day, never an unlimited offline penalty.
        for item in profile["inventory"].get("equipped", {}).values():
            if item in SHOP_PRICES:
                loss = 7 if profile["stats"].get("cleanliness", 100) < 40 else 2
                life["condition"][item] = max(0, life["condition"].get(item, 100) - loss)
        life["wear_date"] = day(now)
    return before != life


def routine(now):
    hour = now.astimezone(KYIV).hour
    current = next(row for row in ROUTINE if row["start"] <= hour < row["end"])
    return {**current, "slots": ROUTINE, "next_at": f"{current['end'] % 24:02d}:00", "timezone": "Europe/Kyiv"}


def weather(profile, now):
    index = int(hashlib.sha256(f"{profile['user_id']}:{day(now)}:weather".encode()).hexdigest()[:8], 16) % 4
    key, label = [("clear", "Ясно"), ("rain", "Дощ"), ("clouds", "Хмарно"), ("storm", "Гроза")][index]
    return {"id": key, "label": label, "description": "Погода у світі котика"}


def care_preview(profile, now):
    from pet_care_rules import sleeping
    current = routine(now)
    asleep = sleeping(profile, now)
    urgent = min(profile["stats"].get("health", 100), profile["stats"].get("satiety", 100)) < 35 or bool(profile["survival"].get("illness"))
    return {"recommended": current["action"], "bonus": "Доречна турбота: +3 настрою",
            "warning": "Котик спить. Спершу розбудіть лампою; у перші 15 хвилин це може забрати 3 настрою, один раз на день." if asleep and not urgent else None}


def record_care(profile, action, option, now, rejected=False, reaction=None, before_stats=None):
    from pet_care_rules import record_care_clock
    ensure_life(profile, now)
    record_care_clock(profile, action, now)
    life = profile["life"]
    key = f"care:{day(now)}:{action}"
    if any(m.get("id") == key for m in life["memories"]):
        return None
    life["last_care_at"] = now.isoformat()
    current = routine(now)
    title = "Турбота запам’яталася"
    note = {"feed": f"Сьогодні в меню — {FOODS.get(option, option)}.", "play": f"Разом гралися: {TOYS.get(option, option)}.", "pet": "Ваша увага допомогла відчути близькість.", "rest": "Ви дали котику відпочити у власному темпі.", "heal": "Ви були поруч, коли котик почувався зле.", "clean": "Кімната знову чиста й безпечна."}.get(action, "Час разом запам’ятався.")
    tone = "positive"
    if rejected:
        title, note, tone = "Мої межі", "Котик просив спокою, але його сигнал проігнорували.", "cost"
    elif reaction:
        note = {"picky": "Однакова їжа набридла: котик чекає різноманіття.", "bored": "Однакова гра набридла: котик хоче нове заняття.", "exhausted": "Гра була надто виснажливою."}.get(reaction, note)
        tone = "cost"
    else:
        if action == current["action"]:
            apply_need(profile, "mood", 3)
            note += " Влучний момент: настрій +3."
        previous = before_stats or profile["stats"]
        if action == "feed" and option == profile["preferences"]["food"] and previous.get("satiety", 100) < 40 and previous.get("mood", 100) < 45:
            apply_need(profile, "mood", 4)
            note += " Улюблена їжа підтримала голодного й засмученого котика: ще +4 настрою."
        if action == "feed" and option in FOODS:
            life["food_counts"][option] = min(999, life["food_counts"].get(option, 0) + 1)
        if action == "play" and option in TOYS:
            life["toy_counts"][option] = min(999, life["toy_counts"].get(option, 0) + 1)
        gain_skill(profile, {"feed": "companion", "rest": "companion", "pet": "companion", "heal": "companion", "clean": "thinker", "play": "thinker" if option == "puzzle" else "hunter"}.get(action))
        if current["id"] == "together" and action in {"pet", "rest"}:
            life["evening_dates"] = list(dict.fromkeys([*life.get("evening_dates", []), day(now)]))[-3:]
            if len(life["evening_dates"]) == 3 and not life.get("ritual_learned"):
                schedule(profile, "ritual", "evening-tradition", now)
                life["ritual_learned"] = True
    remember(profile, key, title, note, now, "care", tone)
    return note


def clear_scene_mess(profile):
    profile["life"]["scene_marks"] = [mark for mark in profile["life"].get("scene_marks", []) if mark.get("kind") != "mess"]


def record_scene_choice(profile, source, choice_id, now):
    # Authored IDs only: no asset URLs, image blobs or client-owned coordinates.
    kind = None
    if source == "surprise-box": kind = "box" if choice_id == "hide" else "scraps"
    elif source == "window-butterfly": kind = "ball" if choice_id == "imitate" else "butterfly"
    elif source == "lost-yarn": kind = "ball"
    elif source == "hidden-key" and choice_id == "observe": kind = "key"
    elif source == "under-shelf-noise" and choice_id == "hunt": kind = "ball"
    elif source == "visitor-cat": kind = "curtain" if choice_id == "close" else "visitor"
    elif source == "plant-crash":
        clear_scene_mess(profile)
        if choice_id == "later": kind = "mess"
    elif source == "dusty-sneeze" and choice_id == "clean": clear_scene_mess(profile)
    marks = [mark for mark in profile["life"]["scene_marks"] if mark.get("source") != source]
    if kind:
        labels = {"box": "Коробковий тунель", "scraps": "Матеріали з коробки", "butterfly": "Метелик за вікном",
            "ball": "Знайдена іграшка", "visitor": "Іскра залишилася поруч", "curtain": "Тихий куточок за шторою",
            "key": "Ключик чекає розгадки", "mess": "Відкладене прибирання"}
        # One prop of each kind avoids stacked duplicate sprites.
        marks = [mark for mark in marks if mark.get("kind") != kind]
        marks.append({"id": f"{source}:{choice_id}", "source": source, "kind": kind, "label": labels[kind],
            "expires_at": (now + timedelta(hours=48 if kind in {"box", "mess"} else 24)).isoformat()})
    profile["life"]["scene_marks"] = marks[-8:]


def record_choice(profile, source, choice, now):
    ensure_life(profile, now)
    record_scene_choice(profile, source, choice["id"], now)
    mapping = {
        "explorer": "explorer", "thinker": "thinker", "companion": "companion",
    }
    effects = choice.get("effects", {})
    for key in effects.get("path", {}):
        gain_skill(profile, mapping.get(key), 5)
    for key, amount in effects.get("skills", {}).items():
        gain_skill(profile, key, min(10, number(amount)))
    pending = effects.get("delayed")
    if pending in DELAYED:
        schedule(profile, pending, f"{source}:{day(now)}:{choice['id']}", now)
    text = (choice.get("outcome", {}).get("text") or choice.get("hint") or "Важливе рішення.").replace("{name}", profile["name"]).replace("Піксель", profile["name"])
    remember(profile, f"choice:{source}:{day(now)}", choice["label"], text, now, "choice", "cost" if effects.get("trust", 0) < 0 else "positive")


def buy_item(profile, item_id):
    cost = SHOP_PRICES.get(item_id)
    if cost is None:
        raise HTTPException(404, "Предмет не продається")
    inventory = profile["inventory"]
    if item_id in inventory["items"]:
        return False
    wallet = inventory["materials"]
    if any(number(wallet.get(key)) < amount for key, amount in cost.items()):
        raise HTTPException(409, "Недостатньо матеріалів для покупки")
    for key, amount in cost.items():
        wallet[key] = max(0, int(wallet.get(key, 0))) - amount
    inventory["items"].append(item_id)
    profile["life"]["condition"][item_id] = 100
    return True


def public_life(profile, now):
    from pet_care_rules import public_sleep
    view = copy.deepcopy(profile)
    ensure_life(view, now)
    life = view["life"]
    stats = view["stats"]
    current = routine(now)
    state = view.get("survival", {})
    alive = state.get("status", "alive") == "alive"
    skills = [{"id": key, **definition, "xp": life["skills"][key], "level": min(3, life["skills"][key] // 25), "unlocked": life["skills"][key] >= 25} for key, definition in SKILLS.items()]
    combos = []
    if stats.get("satiety", 100) < 40 and stats.get("mood", 100) < 45:
        combos.append({"title": "Голодний і засмучений", "text": f"Улюблена їжа ({FOODS.get(view['preferences']['food'], 'корм')}) зараз особливо доречна."})
    if stats.get("cleanliness", 100) < 40 and stats.get("health", 100) < 60:
        combos.append({"title": "Бруд ускладнює відновлення", "text": "Прибирання й лікування важливіші за гру."})
    if stats.get("energy", 0) > 65 and stats.get("mood", 100) < 40:
        combos.append({"title": "Енергія без заняття", "text": "Саме час змінити гру. Відкладене прибирання в подіях може призвести до безладу."})
    if view.get("trust", 20) < 4:
        combos.append({"title": "Хочеться сховатися", "text": "Тиша й доречна турбота допоможуть відновити довіру."})
    if stats.get("mood", 0) > 80 and view.get("trust", 0) >= 10:
        combos.append({"title": "Котик довіряє вам", "text": "Можна завершити ритуал і відкрити денний подарунок."})
    active_until = [stamp(state.get(key)) for key in ("reaction_until", "touch_cooldown_until")]
    active_until = [date for date in active_until if date and date > now]
    grace = stamp(state.get("grace_until"))
    protected = bool(state.get("weekend_protected") or grace and grace > now)
    # Same hourly satiety rate as strict survival; an estimate, not a second clock.
    forecasts = [{"id": "satiety", "label": "До голоду", "hours": round(max(0, stats.get("satiety", 0) - 30), 1)},
                 {"id": "cleanliness", "label": "До прибирання", "hours": round(max(0, (stats.get("cleanliness", 0) - 40) / .55), 1)}]
    return {
        "routine": current, "care_preview": care_preview(view, now), "weather": weather(view, now),
        "sleep": public_sleep(view, now), "scene_marks": life.get("scene_marks", [])[-8:],
        "memories": list(reversed(life["memories"])), "mood_reason": life["mood_reason"], "combos": combos,
        "debuff_until": max(active_until).isoformat() if active_until else None,
        "forecasts": forecasts if alive and not protected else [], "forecast_paused": protected,
        "skills": skills, "pending": [{"id": p["id"], "title": DELAYED[p["kind"]]["title"], "due_at": p["due_at"]} for p in life["pending"]],
        "theme": life["theme"], "themes": ROOM_THEMES, "sound": life["sound"],
        "activity": {"at": life.get("activity_at"), "pose": life.get("activity_pose"), "zone": life.get("activity_zone")},
        "presets": [{"id": p["id"], "name": p["name"]} for p in life["presets"]], "condition": life["condition"],
        "daily": life["daily"], "public_room": life["public_room"], "exhibition": life["exhibition"],
        "preferences": {"food": FOODS.get(view["preferences"]["food"]), "toy": TOYS.get(view["preferences"]["toy"])},
        "habits": {"foods": life["food_counts"], "toys": life["toy_counts"]},
    }


def shop_catalog(items):
    return [{**item, "unlock_level": 1, "price": SHOP_PRICES[item["id"]]} for item in items]
