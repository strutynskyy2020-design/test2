"""Server-owned campaign state, independent of the legacy pet survival simulation.

All wallet, quest and decision changes share one Mongo CAS write. A verified game
receipt is committed in the same document as its reward, so retrying a request
cannot mint currency twice, even across workers. No client scores are accepted.
"""
from copy import deepcopy
from collections import Counter
from datetime import datetime, timezone
from hashlib import sha256
from typing import Literal

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field
from pymongo.errors import DuplicateKeyError

try:
    from backend.pixel_campaign_content import CHAPTERS, CATALOG, STEPS, STEP_INDEX
    from backend.pixel_campaign_season import POSTLUDE
    from backend.pixel_campaign_relationships import ensure_fields, apply_effects, ending_for
except ModuleNotFoundError as exc:
    if exc.name != "backend":
        raise
    from pixel_campaign_content import CHAPTERS, CATALOG, STEPS, STEP_INDEX
    from pixel_campaign_season import POSTLUDE
    from pixel_campaign_relationships import ensure_fields, apply_effects, ending_for


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def timestamp(value):
    if isinstance(value, datetime):
        return value.replace(tzinfo=value.tzinfo or timezone.utc).timestamp()
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed.replace(tzinfo=parsed.tzinfo or timezone.utc).timestamp()
    except (TypeError, ValueError):
        return 0


def new_campaign(user_id, now):
    return {
        "_id": user_id, "version": 2,
        "flags": {}, "conflicts": {}, "repair": {}, "ending": None, "contact": None, "revision": 0, "started_at": now,
        "step": 0, "line": 0, "step_started_at": now, "progress": 0,
        "outcome": None, "wallet": {"feathers": 0, "gold": 0},
        "relationship": {"trust": 0, "closeness": 0, "respect": 0},
        "memories": [], "decisions": {}, "promise": None, "placement": "window",
        "owned": [], "equipped": {}, "completed": [], "discoveries": [],
        "journal": [], "receipts": {}, "level_rewards": [], "replay_days": {},
        "credit_version": 1, "game_credits": {},
    }


def completed_game_counts(state):
    counts = Counter()
    for step in STEPS[:state["step"]]:
        if step["kind"] == "game":
            counts[step["game"]] += step["count"]
    step = current_step(state)
    if step["kind"] == "game" and not step["id"].startswith("contact_"):
        counts[step["game"]] += min(state["progress"], step["count"])
    return counts


def ensure_game_credits(state):
    if state.get("credit_version") == 1:
        return
    # Preserve old chapter progress, wallets and choices. Attribute at most the
    # completed task quota to old clears; surplus unique clears remain available.
    used = completed_game_counts(state)
    state["game_credits"] = {}
    for key in dict.fromkeys(state.get("level_rewards", [])):
        game = key.split(":", 1)[0]
        if used[game] > 0:
            used[game] -= 1
        else:
            state["game_credits"].setdefault(game, []).append(key)
    state["credit_version"] = 1


def consume_game_credits(state, now):
    ensure_game_credits(state)
    step = current_step(state)
    if step["kind"] != "game":
        return
    credits = state["game_credits"].get(step["game"], [])
    count = min(len(credits), max(0, step["count"] - state["progress"]))
    del credits[:count]
    state["progress"] += count
    if state["progress"] >= step["count"]:
        state["journal"].append({"kind": "task", "title": step["title"],
                                 "text": "Завдання виконано. Враховано різні рівні гри.", "at": now})
        next_step(state, now)


def game_requirements(state):
    ensure_game_credits(state)
    total = Counter()
    for step in STEPS:
        if step["kind"] == "game":
            total[step["game"]] += step["count"]
    done = completed_game_counts(state)
    return {"total": sum(total.values()), "completed": sum(done.values()), "postlude": 2,
            "games": [{"id": game, "total": count, "completed": done[game],
                       "remaining": max(0, count - done[game]),
                       "banked": len(state["game_credits"].get(game, []))}
                      for game, count in total.items()]}


def current_step(state):
    index = state["step"]
    if index >= len(STEPS):
        contact = state.get("contact")
        if contact and contact["step"] < len(POSTLUDE):
            return POSTLUDE[contact["step"]]
        return {"id": "end", "kind": "end", "chapter": 24,
                "title": (state.get("ending") or ending_for(state))["title"],
                "description": "Історію Світлиці завершено. Кімната й усі чотири мінігри залишаються доступними."}
    return STEPS[index]


def relationship_view(state):
    ensure_fields(state)
    ending = state.get("ending")
    if ending:
        key, label, text = {
            "our_home": ("close", "Ваш спільний дім", "Піксель сам обрав залишитися поруч. Між вами є довіра, близькість і повага."),
            "equal_partners": ("warm", "На рівних", "Ви залишаєтеся разом, поважаючи окремі справи й особистий простір."),
            "second_chance": ("warm", "Дає другий шанс", "Піксель залишився з чіткими межами. Він бачить зміни й пам’ятає пройдений шлях."),
            "separate_doors": ("hurt", "Живе в Ніни", "Піксель обрав інший дім. Облаштування й мініігри залишаються доступними."),
        }[ending["id"]]
        if ending["id"] == "separate_doors" and (state.get("contact") or {}).get("step", 0) >= 3:
            key, label, text = "guarded", "Обережний контакт", "Зустріч відбулася. Піксель живе в Ніни й сам обирає, коли зустрічатися."
        return {"key": key, "label": label, "description": text, "reason": ending["reason"]}
    values = state["relationship"]
    score = sum(values.values()) / 3
    if score <= -35 or values["trust"] <= -50 or values["respect"] <= -60:
        key, label, text = "hurt", "Тримає дистанцію", "Піксель уникає близькості й відповідає коротко. Він пам’ятає, як з ним поводилися."
    elif score <= -12 or values["trust"] <= -12 or values["respect"] <= -20:
        key, label, text = "guarded", "Насторожений", "Піксель придивляється до твоїх вчинків і рідше говорить про особисте."
    elif any(c["status"] != "resolved" for c in state["conflicts"].values()):
        key, label, text = "guarded", "Потребує вчинків", "Теплих слів недостатньо. Залишилися порушені домовленості, наслідки яких ще потрібно виправити."
    elif score >= 35 and values["trust"] >= 25 and values["respect"] >= 25:
        key, label, text = "close", "Почувається своїм", "Піксель сам підходить ближче та ділиться тим, що для нього важливе."
    elif score >= 12:
        key, label, text = "warm", "Звикає до тебе", "Піксель охочіше залишається поруч. Ваші домовленості мають для нього значення."
    else:
        key, label, text = "curious", "Придивляється", "Ви ще знайомитеся. Стосунки формуються під час розмов і спільних рішень."
    return {"key": key, "label": label, "description": text,
            "reason": state["memories"][-1]["text"] if state["memories"] else "Ваша історія лише починається."}


def public_step(state):
    step = deepcopy(current_step(state))
    if step["id"] == "door":
        promised = state["promise"] == "open_together"
        step["lines"] += [
            "Ти обіцяв відчинити їх зі мною. Я готовий." if promised else
            "Ти попереджав, що спершу оглянеш вхід сам. Як вирішиш тепер?"
        ]
        if promised:
            step["choices"][1]["label"] = "Я порушив обіцянку й уже зайшов без тебе."
    if step["id"] == "threshold" and state["promise"] == "broken":
        step["lines"][1] = "Я пам’ятаю, що ти обіцяв. Зараз я не хочу ділитися спогадами. У квитанції є адреса підрядника — Ніна допоможе тобі без мене."
    if step["id"] == "window" and relationship_view(state)["key"] in ("guarded", "hurt"):
        step["lines"][0] = "Після тієї розмови про лист я не знаю, чи варто просити. Але біля вікна мені було спокійно."
    distant = relationship_view(state)["key"] in ("guarded", "hurt")
    if step["id"] == "c09_arrival" and distant:
        step.update(speaker="Ніна", lines=[
            "Піксель відмовився розповідати особисті спогади. Він має на це право. Пошук ми продовжимо за документами.",
            "Я знайшла квитанцію про продаж інструментів. Вона допоможе встановити події без його розповіді."])
    if step["id"] == "c09_choice" and distant:
        step["lines"] = ["Піксель: Зараз я не готовий розповідати особисте. Документи Ніни вже підтвердили факт. Ти приймеш мою відмову?"]
        step["choices"][0]["label"] = "Я поруч. Не вимагатиму спогадів, до яких ти не готовий."
    if step["id"] == "c15_arrival":
        if state["promise"] == "broken":
            step["lines"][0] = "Я пам’ятаю перші двері: ти обіцяв відчинити їх разом і зайшов без мене. Саме тому сьогодні я хочу сам вирішити, чи йти."
        if distant:
            step["lines"] += ["Сьогодні я залишуся окремо. Ніна отримає копію без мене. Це моя межа, а не перешкода для твого пошуку."]
    if step["id"] == "c16_arrival" and state["conflicts"]:
        step["lines"].append("Я пам’ятаю: " + list(state["conflicts"].values())[-1]["reason"])
    if step["id"] == "c24_close":
        step["lines"] = ending_for(state)["lines"]
    if step.get("id", "").startswith("contact_"):
        step["postlude"] = True
    for option in step.get("choices", []):
        for private in ("delta", "memory", "promise", "placement", "resolve", "response", "flags", "conflict", "repair"):
            option.pop(private, None)
    step.pop("discovery", None)
    return step


def snapshot(state):
    ensure_fields(state)
    step = public_step(state)
    return {
        "version": state["version"], "revision": state["revision"],
        "step": step, "line": state["line"], "progress": state["progress"],
        "outcome": state["outcome"], "wallet": state["wallet"],
        "relationship": relationship_view(state),
        "memories": state["memories"], "promise": state["promise"],
        "placement": state["placement"], "owned": state["owned"],
        "equipped": state["equipped"], "completed": state["completed"],
        "discoveries": state["discoveries"], "journal": state["journal"],
        "flags": state["flags"], "conflicts": list(state["conflicts"].values()),
        "ending": state["ending"], "contact": state["contact"],
        "locations": ["room"] + (["workshop"] if 3 in state["completed"] else []) + (["roof"] if state["equipped"].get("roof") else []),
        "cat_present": not state["ending"] or state["ending"]["present"],
        "chapters": CHAPTERS, "available_chapters": len(CHAPTERS),
        "game_requirements": game_requirements(state),
        "catalog": [{**item, "unlocked": state["step"] >= STEP_INDEX.get(item["unlock"], len(STEPS)),
                     "owned": item["id"] in state["owned"]} for item in CATALOG],
    }


def next_step(state, now):
    step = current_step(state)
    if state.get("contact") and state["step"] >= len(STEPS):
        if step["id"] == "contact_work":
            state["flags"].update(publication="repaired", access="restored", keepsakes="home")
            state["placement"] = "window"
        state["contact"]["step"] += 1
        state.update(line=0, progress=0, outcome=None, step_started_at=now)
        consume_game_credits(state, now)
        return
    if step.get("discovery") and not any(d["id"] == step["discovery"]["id"] for d in state["discoveries"]):
        state["discoveries"].append(deepcopy(step["discovery"]))
    if step.get("chapter_end") and step["chapter"] not in state["completed"]:
        state["completed"].append(step["chapter"])
        state["wallet"]["gold"] += step.get("gold", 1)
        state["journal"].append({"kind": "chapter", "title": CHAPTERS[step["chapter"] - 1]["title"],
                                 "text": "Розділ завершено. Отримано золоту пір’їнку." if step.get("gold", 1) else "Розмову завершено без нагороди.", "at": now})
    if step["id"] == "c24_close":
        state["ending"] = ending_for(state)
        state["journal"].append({"kind": "ending", "title": state["ending"]["title"], "text": " ".join(state["ending"]["lines"]), "at": now})
    state.update(step=state["step"] + 1, line=0, progress=0, outcome=None, step_started_at=now)
    consume_game_credits(state, now)


def apply_action(state, action, now):
    ensure_fields(state)
    step = current_step(state)
    # Also guards double-clicks and stale browser tabs from acting on the next scene.
    if action.get("step_id") != step["id"]:
        raise HTTPException(409, "Сцена вже змінилася. Онови кімнату.")
    kind = action.get("kind")
    if kind == "contact":
        if step["id"] != "end" or not state["ending"] or state["ending"]["present"] or state["contact"]:
            raise HTTPException(409, "Ця зустріч зараз недоступна.")
        state["contact"] = {"step": 0}
        state.update(line=0, progress=0, outcome=None, step_started_at=now)
    elif kind == "advance":
        if step["kind"] != "dialogue":
            raise HTTPException(409, "Спочатку виконай поточне завдання.")
        if state["outcome"]:
            next_step(state, now)
            return
        lines = public_step(state)["lines"]
        if state["line"] < len(lines) - 1:
            state["line"] += 1
        elif step.get("choices"):
            raise HTTPException(409, "Це рішення потрібно обрати самостійно.")
        else:
            state["journal"].append({"kind": "dialogue", "title": step["title"], "text": " ".join(lines), "at": now})
            next_step(state, now)
    elif kind == "skip":
        if step["kind"] != "dialogue" or state["outcome"]:
            raise HTTPException(409, "Цю сцену неможливо пропустити.")
        # Skip exposition only; a meaningful choice is never auto-selected.
        state["line"] = len(public_step(state)["lines"]) - 1
    elif kind == "choose":
        if step["kind"] != "dialogue" or state["outcome"] or state["line"] != len(public_step(state)["lines"]) - 1:
            raise HTTPException(409, "Рішення зараз недоступне.")
        selected = next((c for c in step.get("choices", []) if c["id"] == action.get("choice_id")), None)
        if not selected:
            raise HTTPException(400, "Невідоме рішення.")
        selected = deepcopy(selected)
        spoken_lines = public_step(state)["lines"]
        selected["label"] = next(c["label"] for c in public_step(state)["choices"] if c["id"] == selected["id"])
        if selected.get("resolve") == "alone" and state["promise"] == "open_together":
            selected.update(delta={"trust": -40, "closeness": -20, "respect": -25},
                            response="Ти дав слово. Я чекав унизу, бо повірив тобі. Зараз я не хочу йти з тобою. План у Ніни — продовжиш без моїх спогадів.",
                            memory="Ти порушив обіцянку відчинити майстерню разом. Піксель відмовився розповідати особисті спогади.")
            state["promise"] = "broken"
        elif selected.get("resolve"):
            state["promise"] = "kept" if selected["resolve"] == "kept" else "honest_alone"
        if selected.get("promise"):
            state["promise"] = selected["promise"]
        if selected.get("placement"):
            state["placement"] = selected["placement"]
        apply_effects(state, selected, step)
        if step["id"] == "c09_choice" and selected["id"] == "listen" and relationship_view(state)["key"] in ("guarded", "hurt"):
            selected.update(response="Дякую, що зупинився. Сьогодні обмежимося документами Ніни. Особисте я поки залишу собі.",
                            memory="Ти прийняв відмову Пікселя від особистої розповіді.",
                            delta={"trust": 12, "closeness": 0, "respect": 14})
            state["flags"]["memory"] = "private"
        for axis, change in selected["delta"].items():
            state["relationship"][axis] = max(-100, min(100, state["relationship"][axis] + change))
        state["decisions"][step["id"]] = selected["id"]
        state["outcome"] = selected["response"]
        if selected["memory"]:
            state["memories"].append({"id": step["id"], "text": selected["memory"], "at": now})
        state["journal"].append({"kind": "choice", "title": step["title"],
                                 "text": " ".join(spoken_lines),
                                 "choice": selected["label"], "response": selected["response"], "speaker": public_step(state).get("speaker", "Піксель"), "at": now})
    elif kind == "buy":
        item = next((c for c in CATALOG if c["id"] == action.get("item_id")), None)
        if not item or state["step"] < STEP_INDEX.get(item["unlock"], len(STEPS)):
            raise HTTPException(409, "Предмет відкриється пізніше за сюжетом.")
        if item["id"] in state["owned"]:
            return
        if state["wallet"][item["currency"]] < item["price"]:
            raise HTTPException(409, "Поки що не вистачає пір’їнок.")
        state["wallet"][item["currency"]] -= item["price"]
        state["owned"].append(item["id"])
        state["equipped"][item["slot"]] = item["id"]
        state["journal"].append({"kind": "room", "title": item["title"], "text": "У кімнаті з’явилася нова річ.", "at": now})
        if step["kind"] == "decorate" and step["item"] == item["id"]:
            next_step(state, now)
    else:
        raise HTTPException(400, "Невідома дія.")


def receipt_key(game, session_id):
    return sha256(f"{game}:{session_id}".encode()).hexdigest()


def win_level_key(win):
    key = f'{win["game"]}:{win["level"]}'
    return key + f':{win["campaign"]}' if win.get("campaign") else key


def apply_win(state, win, now):
    ensure_game_credits(state)
    key = receipt_key(win["game"], win["id"])
    if key in state["receipts"]:
        return {**state["receipts"][key], "duplicate": True}
    if not timestamp(win["at"]):
        raise HTTPException(409, "Час завершеного проходження не підтверджено.")
    step = current_step(state)
    level_key = win_level_key(win)
    first_clear = level_key not in state["level_rewards"]
    quest = first_clear and step["kind"] == "game" and win["game"] == step["game"]
    amount = 10 if first_clear else 0
    if first_clear:
        state["level_rewards"].append(level_key)
        state["game_credits"].setdefault(win["game"], []).append(level_key)
    state["wallet"]["feathers"] += amount
    consume_game_credits(state, now)
    receipt = {"feathers": amount, "quest": bool(quest), "step_id": step["id"],
               "first_clear": first_clear, "level_key": level_key,
               "banked": first_clear and level_key in state["game_credits"].get(win["game"], [])}
    state["receipts"][key] = receipt
    return {**receipt, "duplicate": False}


class CampaignAction(BaseModel):
    kind: Literal["advance", "skip", "choose", "buy", "contact"]
    step_id: str = Field(min_length=1, max_length=80)
    revision: int = Field(ge=0)
    choice_id: str | None = Field(default=None, max_length=80)
    item_id: str | None = Field(default=None, max_length=80)


class CampaignClaim(BaseModel):
    game: Literal["bonus_match", "hidden_objects", "flappy", "pixel_drive"]
    session_id: str = Field(min_length=1, max_length=120)


class CampaignService:
    def __init__(self, db):
        self.db = db
        self.collection = db.pixel_campaigns

    async def load(self, user_id):
        state = await self.collection.find_one({"_id": user_id})
        if state is None:
            state = new_campaign(user_id, now_iso())
            try:
                await self.collection.insert_one(state)
            except DuplicateKeyError:
                state = await self.collection.find_one({"_id": user_id})
        return state

    async def mutate(self, user_id, operation, revision=None):
        for _ in range(10):
            original = await self.load(user_id)
            if revision is not None and original["revision"] != revision:
                raise HTTPException(409, "Прогрес уже оновлено. Перевір поточну сцену.")
            updated = deepcopy(original)
            ensure_fields(updated)
            ensure_game_credits(updated)
            consume_game_credits(updated, now_iso())
            result = operation(updated, now_iso())
            if updated == original:
                return original, result
            updated["revision"] += 1
            saved = await self.collection.replace_one(
                {"_id": user_id, "revision": original["revision"]}, updated)
            if saved.modified_count:
                return updated, result
        raise HTTPException(409, "Одночасне збереження. Спробуй ще раз.")

    async def verified_win(self, user_id, game, session_id):
        if game == "bonus_match":
            row = await self.db.bonus_match_sessions.find_one(
                {"id": session_id, "user_id": user_id, "status": "won"},
                {"id": 1, "level": 1, "campaign": 1, "completed_at": 1})
            at = row.get("completed_at") if row else None
        elif game == "hidden_objects":
            # A run is inserted only by the server's validated completion flow.
            row = await self.db.hidden_object_runs.find_one(
                {"id": session_id, "user_id": user_id}, {"id": 1, "level": 1, "created_at": 1})
            at = row.get("created_at") if row else None
        elif game in ("flappy", "pixel_drive"):
            row = await self.db.pixel_campaign_runs.find_one({"id": session_id, "user_id": user_id, "game": game})
            at = row.get("completed_at") if row else None
        else:
            raise HTTPException(400, "Невідома мінігра.")
        if not row or not timestamp(at):
            raise HTTPException(409, "Завершене проходження не знайдено.")
        return {"game": game, "id": row["id"], "level": int(row["level"]), "at": at, "campaign": row.get("campaign")}

    async def claim(self, user_id, game, session_id):
        win = await self.verified_win(user_id, game, session_id)
        # Import earlier clears first, even when a replay's claim arrives first.
        await self.sync(user_id, exclude=receipt_key(game, session_id))
        return await self.mutate(user_id, lambda state, now: apply_win(state, win, now))

    async def sync(self, user_id, exclude=None):
        state, _ = await self.mutate(user_id, lambda state, now: None)
        # Recover a result even if the player closed a game before its reward UI.
        # Stream the cursor instead of truncating to a recent-games page.
        wins = []
        confirmed_levels = set(state["level_rewards"])
        sources = (
            ("bonus_match", self.db.bonus_match_sessions, "completed_at", {"status": "won"}),
            ("hidden_objects", self.db.hidden_object_runs, "created_at", {}),
            ("flappy", self.db.pixel_campaign_runs, "completed_at", {"game": "flappy"}),
            ("pixel_drive", self.db.pixel_campaign_runs, "completed_at", {"game": "pixel_drive"}),
        )
        for game, collection, time_field, extra in sources:
            cursor = collection.find({"user_id": user_id, **extra},
                                     {"id": 1, "level": 1, "campaign": 1, time_field: 1})
            async for row in cursor:
                key = receipt_key(game, row["id"])
                if timestamp(row.get(time_field)):
                    win = {"game": game, "id": row["id"], "level": int(row["level"]), "at": row[time_field], "campaign": row.get("campaign")}
                    confirmed_levels.add(win_level_key(win))
                    if key != exclude and key not in state["receipts"]:
                        wins.append(win)
        # Older players may have completed a finite game before durable story
        # receipts existed. These server-owned completion records survive session
        # expiry; importing them avoids requiring an impossible new first clear.
        def historic(game, level, campaign=None, at=None):
            win = dict(game=game, level=int(level), campaign=campaign, at=at or state["started_at"],
                       id=f"historic:{campaign or 'original'}:{level}")
            key = win_level_key(win)
            if key not in confirmed_levels:
                wins.append(win)
                confirmed_levels.add(key)

        async for row in self.db.bonus_match_completions.find({"user_id": user_id}):
            if row.get("stars", 0) > 0:
                historic("bonus_match", row["level"], row.get("campaign"), row.get("created_at"))
        flappy = await self.db.flappy_profiles.find_one({"user_id": user_id}) or {}
        for level, completed in flappy.get("completed", {}).items():
            if completed:
                historic("flappy", level)
        drive = await self.db.pixel_drive_profiles.find_one({"_id": user_id}) or {}
        # Drive v3 archives its old route records. Story first-clear credits must
        # survive that migration; historic() deduplicates both maps and durable runs.
        for records in (drive.get("tracks", {}), drive.get("legacy", {}).get("tracks", {})):
            for level, track in records.items():
                if "finish" in track.get("medals", []):
                    historic("pixel_drive", level)
        wins.sort(key=lambda win: (timestamp(win["at"]), win["game"], win["id"]))
        if wins:
            def apply_all(updated, now):
                for win in wins:
                    apply_win(updated, win, now)
            state, _ = await self.mutate(user_id, apply_all)
        return state


def register_pixel_campaign_routes(router, db, get_current_user):
    service = CampaignService(db)

    @router.get("/pet/campaign")
    async def get_campaign(user=Depends(get_current_user)):
        return snapshot(await service.sync(user["id"]))

    @router.post("/pet/campaign/action")
    async def campaign_action(body: CampaignAction, user=Depends(get_current_user)):
        state, _ = await service.mutate(user["id"], lambda state, now: apply_action(state, body.model_dump(), now), body.revision)
        return snapshot(state)

    @router.post("/pet/campaign/claim")
    async def campaign_claim(body: CampaignClaim, user=Depends(get_current_user)):
        state, reward = await service.claim(user["id"], body.game, body.session_id)
        return {"campaign": snapshot(state), "reward": reward}
