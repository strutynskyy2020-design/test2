"""Authored room events with previews and delayed, server-owned consequences."""


def choice(key, label, text, effects, hint, *, skill=None, pose="sit"):
    labels = {"mood": "Настрій", "energy": "Енергія", "cleanliness": "Чистота", "health": "Здоров’я"}
    impact = [{"label": f"{labels.get(k, k)} {'+' if v > 0 else '−'}{abs(v)}", "tone": "positive" if v > 0 else "cost"} for k, v in effects.get("stats", {}).items()]
    materials = {"feather": "Пір’їнка", "string": "Мотузка", "leaf": "Листок", "cardboard": "Картон", "photo": "Фотоспогад", "fabric": "Тканина"}
    impact.extend({"label": f"{materials.get(key, key)} +{amount}", "tone": "positive"} for key, amount in effects.get("materials", {}).items())
    if effects.get("trust"):
        v = effects["trust"]
        impact.append({"label": f"Довіра {'+' if v > 0 else '−'}{abs(v)}", "tone": "positive" if v > 0 else "cost"})
    if effects.get("delayed"):
        impact.append({"label": "Наслідок згодом", "tone": "story"})
    return {"id": key, "label": label, "hint": hint, "effects": {"xp": 3, **effects}, "impact": impact,
            "requires_skills": {skill: 25} if skill else {},
            "outcome": {"title": label, "text": text, "reaction_text": text, "pose": pose, "next_hint": hint}}


LIVING_EVENTS = [
    {"id": "storm-window", "title": "Грім за вікном", "text": "У світі котика гроза. {name} притискає вуха й шукає тихе місце.", "hotspot": "window", "tags": ["companion"], "weight": 10, "requires": {"weather": "storm"}, "choices": [
        choice("shelter", "Побути біля лежанки", "{name} заспокоївся поруч із вами.", {"stats": {"mood": 8}, "trust": 2, "skills": {"companion": 5}}, "Підтримка без нав’язливих дотиків.", pose="sleep"),
        choice("ignore", "Залишити розбиратися самому", "{name} сховався й тепер насторожено поглядає на вікно.", {"stats": {"mood": -7}, "trust": -1}, "Самостійність зараз обійдеться в настрій і довіру."),
        choice("ritual", "Виконати знайомий тихий ритуал", "Знайомий ритм заспокоїв {name} навіть під гуркіт грому.", {"stats": {"mood": 12, "energy": 5}, "trust": 2, "skills": {"companion": 5}}, "Доступно досвідченому Компаньйону.", skill="companion", pose="sleep"),
    ]},
    {"id": "plant-crash", "title": "Хто перекинув вазон?", "text": "Біля рослини земля й відбитки лап. {name} дуже уважно дивиться в інший бік.", "hotspot": "shelf", "tags": ["thinker", "companion"], "weight": 7, "requires": {"equipped": {"decor": "plant-moon"}}, "choices": [
        choice("tidy", "Прибрати й запропонувати іграшку", "Пригода закінчилася прибиранням, без сварки.", {"stats": {"cleanliness": 15, "energy": -5}, "trust": 1, "skills": {"thinker": 4}}, "Чистота +15 за 5 енергії."),
        choice("later", "Залишити на потім", "{name} повернувся до землі: ця пригода ще матиме продовження.", {"stats": {"mood": 4, "cleanliness": -5}, "delayed": "mess"}, "Через 4 години: ще −8 чистоти й −18 стану іграшки."),
    ]},
    {"id": "visitor-cat", "title": "Гостя на підвіконні", "text": "Іскра з сусіднього двору залишилася біля вікна. {name} не знає, як привітатися.", "hotspot": "window", "tags": ["companion", "explorer"], "weight": 5, "choices": [
        choice("welcome", "Дати час познайомитися", "Ви не квапили котиків. Іскра запам’ятала безпечне вікно.", {"stats": {"mood": 5, "energy": -4}, "path": {"companion": 1}, "delayed": "friend"}, "За 18 годин гостя принесе 2 листки, настрій +6."),
        choice("close", "Закрити штору й відпочити", "Сьогодні {name} обрав затишок власної кімнати.", {"stats": {"energy": 8}, "skills": {"companion": 3}}, "Зараз +8 енергії, без продовження зустрічі.", pose="sleep"),
        choice("performance", "Привітати гостю знайомим трюком", "Маленька вистава сподобалася Іскрі. Вона точно повернеться.", {"stats": {"mood": 8, "energy": -6}, "skills": {"actor": 5}, "delayed": "friend"}, "Потрібно 25 досвіду Артиста; за 18 годин — 2 листки та +6 настрою.", skill="actor", pose="play"),
    ]},
    {"id": "hidden-key", "title": "Маленький ключик", "text": "{name} помітив блиск під полицею. Біля нього — загадковий знак із трьох лапок.", "hotspot": "shelf", "tags": ["thinker", "explorer"], "weight": 6, "choices": [
        choice("observe", "Залишити й спостерігати", "{name} запам’ятав знак. Уночі він перевірить свою здогадку.", {"stats": {"energy": -3}, "path": {"thinker": 1}, "delayed": "clue"}, "Через 8 годин: пір’їнка й +6 досвіду Розумника."),
        choice("solve", "Розшифрувати знак одразу", "Кмітливий {name} знайшов схованку за третім слідом.", {"stats": {"mood": 8, "energy": -6}, "materials": {"feather": 2}, "skills": {"thinker": 6}}, "Потрібно 25 досвіду Розумника; знахідка — 2 пір’їнки.", skill="thinker"),
        choice("trail", "Перевірити маршрут слідів", "{name} відважно простежив шлях до схованки.", {"stats": {"mood": 8, "energy": -8}, "materials": {"cardboard": 3}, "skills": {"explorer": 6}}, "Потрібно 25 досвіду Дослідника; знахідка — 3 картони.", skill="explorer", pose="play"),
    ]},
    {"id": "under-shelf-noise", "title": "Шурхіт під полицею", "text": "{name} завмер: з-під полиці знову чути тихий шурхіт.", "hotspot": "shelf", "tags": ["explorer", "thinker"], "weight": 5, "choices": [
        choice("wait", "Залишити котику нічне розслідування", "{name} влаштував спостережний пункт. Загадка розкриється пізніше.", {"stats": {"energy": -4}, "delayed": "noise", "skills": {"explorer": 4}}, "За 6 годин знайдеться 2 мотузки."),
        choice("hunt", "Виманити клубок мисливським трюком", "Один точний стрибок — і клубок урятований.", {"stats": {"mood": 10, "energy": -8}, "materials": {"string": 2}, "skills": {"hunter": 5}}, "Потрібно 25 досвіду Мисливця.", skill="hunter", pose="play"),
        choice("rest", "Зачинити куточок до ранку", "Шурхіт може зачекати. {name} вмостився відпочивати.", {"stats": {"energy": 6, "mood": 3}}, "Без знахідки, зате трохи більше сил.", pose="sleep"),
    ]},
]


def enrich_events(events):
    for event in events:
        if event["id"] == "surprise-box":
            tunnel = next(c for c in event["choices"] if c["id"] == "hide")
            tunnel["effects"]["delayed"] = "box"
            tunnel["hint"] += " Через добу: 2 картони, 1 мотузка й +4 настрою."
            tunnel["impact"].append({"label": "Знахідка через 24 год", "tone": "story"})
    return [*events, *LIVING_EVENTS]
