"""Personal virtual pet for VPDK Bonus.

All artwork is shipped by the frontend. MongoDB stores only compact user-owned
state, ephemeral game sessions, and a journal/event ledger.
"""

from __future__ import annotations

import copy
import base64
import binascii
import hashlib
import json
import math
import uuid
import sys
from datetime import datetime, timedelta, timezone
from typing import Awaitable, Callable, Literal, Optional
from zoneinfo import ZoneInfo

from fastapi import Depends, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field, FiniteFloat, field_validator
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError, OperationFailure
import pet_life
from pet_life_routes import register_life_routes
from pet_playroom import register_play_routes, public_care_availability
from pet_care_rules import care_refusal, settle_sleep, sleep_overlap_hours, sleeping, start_sleep, wake_sleep
from pet_life_events import enrich_events


KYIV_TZ = ZoneInfo("Europe/Kyiv")
PET_RULES_VERSION = "pet-v4-living-shop"
PET_MAX_LEVEL = 10
PET_SURVIVAL_VERSION = 1
PET_STORY_VERSION = 1
PET_SURVIVAL_GRACE_HOURS = 12
PET_RUNAWAY_WARNING_HOURS = 12


DEFAULT_EQUIPPED = {
    "bed": "bed-basic",
    "bowl": "bowl-amber",
    "toy": "toy-wand",
    "wall": "wall-neon",
    "floor": None,
    "decor": None,
    "shelf": None,
}


PET_ITEMS = [
    {
        "id": "bed-basic", "name": "Затишна лежанка", "slot": "bed", "rarity": "basic", "icon": "bed",
        "unlock_level": 1, "description": "Улюблене місце для відпочинку.",
        "room": {"asset": "/pet/room/v2/items/bed-basic.webp", "x": 50, "y": 77, "width": 59, "z_index": 30, "anchor": "bottom", "move_bounds": {"min_x": 34, "max_x": 66, "min_y": 70, "max_y": 84}},
    },
    {
        "id": "bowl-amber", "name": "Бурштинова миска", "slot": "bowl", "rarity": "basic", "icon": "bowl",
        "unlock_level": 1, "description": "Миска, з якої все смакує краще.",
        "room": {"asset": "/pet/room/v2/items/bowl-amber.webp", "x": 15, "y": 79, "width": 22, "z_index": 50, "anchor": "bottom", "move_bounds": {"min_x": 8, "max_x": 42, "min_y": 69, "max_y": 85}},
    },
    {
        "id": "toy-wand", "name": "Неонова вудочка", "slot": "toy", "rarity": "basic", "icon": "wand",
        "unlock_level": 1, "description": "Для полювання на найспритніші пір'їнки.",
        "room": {"asset": "/pet/room/v2/items/toy-wand.webp", "x": 85, "y": 73, "width": 25, "z_index": 50, "anchor": "bottom", "move_bounds": {"min_x": 62, "max_x": 92, "min_y": 58, "max_y": 82}},
    },
    {
        "id": "wall-neon", "name": "Неонові лапки", "slot": "wall", "rarity": "basic", "icon": "sparkles",
        "unlock_level": 1, "description": "Тепле світло для особистої кімнати.",
        "room": {"asset": "/pet/room/v2/items/wall-neon.webp", "x": 26, "y": 17, "width": 18, "z_index": 10, "anchor": "center", "move_bounds": {"min_x": 12, "max_x": 72, "min_y": 11, "max_y": 34}},
    },
    {
        "id": "rug-cyan", "name": "Килим «Хвиля»", "slot": "floor", "rarity": "improved", "icon": "waves",
        "unlock_level": 2, "description": "М'який килим із блакитним кантом.",
        "room": {"asset": "/pet/room/v2/items/rug-cyan.webp", "x": 50, "y": 72, "width": 68, "z_index": 20, "anchor": "center", "move_bounds": {"min_x": 38, "max_x": 62, "min_y": 65, "max_y": 80}},
    },
    {
        "id": "plant-moon", "name": "Місячна рослина", "slot": "decor", "rarity": "rare", "icon": "sprout",
        "unlock_level": 4, "description": "Іноді Піксель спостерігає, як коливається листя.",
        "room": {"asset": "/pet/room/v2/items/plant-moon.webp", "x": 14, "y": 66, "width": 20, "z_index": 28, "anchor": "bottom", "move_bounds": {"min_x": 7, "max_x": 34, "min_y": 52, "max_y": 77}},
    },
    {
        "id": "fort-cardboard", "name": "Картонна фортеця", "slot": "decor", "rarity": "epic", "icon": "castle",
        "unlock_level": 1, "description": "Придбайте за матеріали або побудуйте в тижневому проєкті.",
        "room": {"asset": "/pet/room/v2/items/fort-cardboard.webp", "x": 23, "y": 71, "width": 31, "z_index": 28, "anchor": "bottom", "move_bounds": {"min_x": 10, "max_x": 42, "min_y": 57, "max_y": 79}},
    },
    {
        "id": "pillow-starlight", "name": "Подушка «Зоряне світло»", "slot": "bed", "rarity": "legendary", "icon": "moon",
        "unlock_level": 1, "description": "Легендарна подушка: доступна за матеріали або як рідкісний подарунок.",
        "room": {"asset": "/pet/room/v2/items/pillow-starlight.webp", "x": 50, "y": 77, "width": 56, "z_index": 30, "anchor": "bottom", "move_bounds": {"min_x": 34, "max_x": 66, "min_y": 70, "max_y": 84}},
    },
]


PET_ROOM_SCENE = {
    "version": "room-v2",
    "background_asset": "/pet/room/v2/background.webp",
    "appearances": {
        "orange-tabby-v1": {
            "poses": {
                "sit": {"asset": "/pet/room/v2/cat/cat-sit.webp", "x": 50, "y": 74, "width": 37, "z_index": 40, "anchor": "bottom"},
                "sleep": {"asset": "/pet/room/v2/cat/cat-sleep.webp", "x": 50, "y": 74, "width": 47, "z_index": 40, "anchor": "bottom"},
                "eat": {"asset": "/pet/room/v2/cat/cat-eat.webp", "x": 34, "y": 79, "width": 39, "z_index": 42, "anchor": "bottom"},
                "play": {"asset": "/pet/room/v2/cat/cat-play.webp", "x": 68, "y": 74, "width": 43, "z_index": 42, "anchor": "bottom"},
            },
        },
    },
}

PET_EXPEDITIONS = {
    "yard": {"id": "yard", "name": "Подвір'я", "duration_minutes": 120, "energy_cost": 12, "accent": "amber", "description": "Картон, мотузка й знайомі сліди."},
    "park": {"id": "park", "name": "Парк", "duration_minutes": 240, "energy_cost": 18, "accent": "green", "description": "Листя, пір'їнки та маленькі скарби."},
    "rooftop": {"id": "rooftop", "name": "Дах", "duration_minutes": 480, "energy_cost": 24, "accent": "purple", "description": "Рідкісний краєвид і незвичайна історія."},
}

PET_TRICKS = {
    "paw": {"id": "paw", "name": "Дати лапу", "energy_cost": 10, "trait": "affection", "icon": "paw-print"},
    "high-five": {"id": "high-five", "name": "Дай п'ять", "energy_cost": 12, "trait": "intelligence", "icon": "hand"},
    "box-jump": {"id": "box-jump", "name": "Стрибок у коробку", "energy_cost": 14, "trait": "curiosity", "icon": "package"},
}

PET_GAMES = [
    {
        "id": "memory", "mode": "sequence", "input": "moves", "name": "Лапки-пам'ятки",
        "description": "Запам'ятай послідовність кольорових лапок і повтори її.",
        "duration_seconds": 25, "icon": "brain", "reward": "+3 довіри",
    },
    {
        "id": "laser", "mode": "reaction", "input": "events", "name": "Спіймай промінчик",
        "description": "Торкайся лазерних цілей у правильній смузі та в їхнє коротке часове вікно.",
        "duration_seconds": 18, "icon": "sparkles", "reward": "+3 довіри",
    },
    {
        "id": "sorting", "mode": "sorting", "input": "events", "name": "Котяче сортування",
        "description": "Розклади їжу, іграшки та декор у правильні місця кімнати.",
        "duration_seconds": 30, "icon": "package", "reward": "+3 довіри",
    },
]

PET_STORY_ARC = {
    "id": "night-mail-v1",
    "title": "Нічна пошта",
    "total_chapters": 3,
    "summary": "{name} розкриває таємницю неонових сигналів і вирішує, що для нього означає дім.",
}


PET_STORY_SCENES = [
    {
        "id": "blue-signal",
        "chapter": 1,
        "title": "Три спалахи у вікні",
        "text": "Після опівночі {name} помічає за вікном три сині спалахи. На рамі лишилися синя стрічка з відбитком лапки та вицвілий знімок даху.",
        "foreshadow": "Цей перший вибір визначить, як {name} звикне розв’язувати незнайомі ситуації.",
        "hotspot": "window",
        "requires": {},
        "choices": [
            {
                "id": "follow-now", "label": "Вирушити за сигналом",
                "hint": "Підтримати сміливість, але витратити трохи сил.",
                "impact": [{"label": "Настрій +8", "tone": "positive"}, {"label": "Енергія −6", "tone": "cost"}, {"label": "Допитливість +3", "tone": "trait"}],
                "effects": {"stats": {"mood": 8, "energy": -6}, "traits": {"curiosity": 3}, "trust": 1, "xp": 8, "path": {"explorer": 2}, "flags_add": ["followed_signal"]},
                "outcome": {"title": "Слід веде далі", "text": "{name} сміливо торкнувся стрічки лапою й помітив на знімку крихітну карту даху.", "reaction_text": "Ходімо за світлом!", "pose": "play", "next_hint": "Наступний слід відкриється на 3 рівні дружби."},
            },
            {
                "id": "study-clue", "label": "Спочатку вивчити нитку",
                "hint": "Діяти обережно й шукати закономірність у сигналі.",
                "impact": [{"label": "Кмітливість +3", "tone": "trait"}, {"label": "Листок +1", "tone": "positive"}, {"label": "Шлях мислителя", "tone": "story"}],
                "effects": {"traits": {"intelligence": 3}, "materials": {"leaf": 1}, "xp": 8, "path": {"thinker": 2}, "flags_add": ["decoded_signal"]},
                "outcome": {"title": "У спалахах є ритм", "text": "На фото стало видно: три спалахи повторюють старий знак притулку для тварин.", "reaction_text": "Тут точно є закономірність.", "pose": "sit", "next_hint": "Наступний слід відкриється на 3 рівні дружби."},
            },
            {
                "id": "stay-together", "label": "Заспокоїти й почекати разом",
                "hint": "Показати, що невідоме не страшне, коли ви поруч.",
                "impact": [{"label": "Довіра +2", "tone": "positive"}, {"label": "Енергія +5", "tone": "positive"}, {"label": "Лагідність +3", "tone": "trait"}],
                "effects": {"stats": {"energy": 5, "mood": 5}, "traits": {"affection": 3}, "trust": 2, "xp": 8, "path": {"companion": 2}, "flags_add": ["waited_together"]},
                "outcome": {"title": "Сигнал повернувся", "text": "{name} заснув поруч, а вранці сам приніс синю стрічку до вашої долоні.", "reaction_text": "Разом мені спокійніше.", "pose": "sleep", "next_hint": "Наступний слід відкриється на 3 рівні дружби."},
            },
        ],
    },
    {
        "id": "rooftop-trail",
        "chapter": 2,
        "title": "Слід над містом",
        "text": "Ви разом виходите на дах. Там {name} знаходить старе фото саду й свіжі сліди невідомої кішки. Неоновий знак знову блимає.",
        "path_text": {
            "explorer": "{name} уже тягне вас до наступного сліду.",
            "thinker": "{name} прислухається до ритму сигналу й чекає вашого плану.",
            "companion": "{name} тримається поруч: для нього важливо пройти це разом.",
        },
        "foreshadow": "Ваш підхід змінить те, як {name} зустріне незнайомку.",
        "hotspot": "window",
        "requires": {"completed": ["blue-signal"], "min_level": 3, "min_trust": 6},
        "choices": [
            {
                "id": "track-paws", "label": "Іти свіжими слідами",
                "hint": "Швидкий шлях із витратою енергії та чистоти.",
                "impact": [{"label": "Настрій +9", "tone": "positive"}, {"label": "Енергія −9 · чистота −4", "tone": "cost"}, {"label": "Допитливість +3", "tone": "trait"}],
                "effects": {"stats": {"mood": 9, "energy": -9, "cleanliness": -4}, "traits": {"curiosity": 3}, "materials": {"leaf": 1}, "trust": 1, "xp": 10, "path": {"explorer": 2}, "flags_add": ["tracked_iskra"]},
                "outcome": {"title": "Знайдено прихований сад", "text": "Сліди привели до занедбаного саду. Там на вас чекає кішка на ім’я Іскра з новим посланням.", "reaction_text": "Я знав, що слід справжній!", "pose": "play", "next_hint": "Фінал відкриється на 5 рівні дружби й за довіри 8."},
            },
            {
                "id": "decode-photo", "label": "Зіставити фото й сигнал",
                "hint": "Повільніше, зате {name} краще запам’ятає схему.",
                "impact": [{"label": "Кмітливість +3", "tone": "trait"}, {"label": "Енергія −5", "tone": "cost"}, {"label": "Фотоспогад +1", "tone": "positive"}],
                "effects": {"stats": {"energy": -5, "mood": 5}, "traits": {"intelligence": 3}, "materials": {"leaf": 1}, "trust": 1, "xp": 10, "path": {"thinker": 2}, "flags_add": ["mapped_rooftop"]},
                "outcome": {"title": "Карта ожила", "text": "Старе фото виявилося картою: світлові точки позначають безпечний шлях до саду.", "reaction_text": "Тепер я розумію цей знак.", "pose": "sit", "next_hint": "Фінал відкриється на 5 рівні дружби й за довіри 8."},
            },
            {
                "id": "build-watchpost", "label": "Зробити просте укриття",
                "hint": "Зупинитися й подбати, щоб незнайомка могла підійти без страху.",
                "impact": [{"label": "Енергія −3", "tone": "cost"}, {"label": "Довіра +2", "tone": "positive"}, {"label": "Лагідність +3", "tone": "trait"}],
                "effects": {"stats": {"mood": 8, "energy": -3}, "traits": {"affection": 3}, "trust": 2, "xp": 10, "path": {"companion": 2}, "flags_add": ["built_watchpost"]},
                "outcome": {"title": "Іскра наблизилася", "text": "Побачивши укриття, Іскра вперше не втекла. {name} тихо сів поруч із нею.", "reaction_text": "Тут безпечно для обох.", "pose": "sit", "next_hint": "Фінал відкриється на 5 рівні дружби й за довіри 8."},
            },
        ],
    },
    {
        "id": "rooftop-garden",
        "chapter": 3,
        "title": "Сад над містом",
        "text": "Іскра привела {name} до капсули зі старими листами притулку. Тепер ваш котик має вирішити, як зберегти це місце.",
        "path_text": {
            "explorer": "Відновити стежку й показати її іншим?",
            "thinker": "Полагодити маяк, щоб послання більше не губилися?",
            "companion": "Зробити сад безпечним місцем для тих, хто ще шукає дім?",
        },
        "foreshadow": "Фінальний вибір закріпить характер котика, але не дасть економічної переваги над іншими фіналами.",
        "hotspot": "window",
        "requires": {"completed": ["rooftop-trail"], "min_level": 5, "min_trust": 8, "healthy_enough": True},
        "choices": [
            {
                "id": "restore-garden", "label": "Відновити стежки саду",
                "hint": "Піксель стане сміливим дослідником і частіше прагнутиме пригод.",
                "impact": [{"label": "Настрій +10", "tone": "positive"}, {"label": "Енергія −10 · чистота −5", "tone": "cost"}, {"label": "Фінал: дослідник", "tone": "story"}],
                "effects": {"stats": {"mood": 10, "energy": -10, "cleanliness": -5}, "traits": {"curiosity": 5}, "trust": 2, "xp": 15, "materials": {"leaf": 1}, "path": {"explorer": 4}, "ending": "explorer", "badge": "Хранитель стежок", "flags_add": ["garden_restored"]},
                "outcome": {"title": "Хранитель стежок", "text": "Піксель відновив шлях до саду й тепер першим помічає нові пригоди.", "reaction_text": "Наступний слід я знайду першим!", "pose": "play", "next_hint": "Сюжет завершено. Випадкові події тепер частіше підтримують шлях дослідника."},
            },
            {
                "id": "repair-beacon", "label": "Полагодити світловий маяк",
                "hint": "Піксель стане мислителем і частіше обиратиме головоломки.",
                "impact": [{"label": "Настрій +9", "tone": "positive"}, {"label": "Енергія −8", "tone": "cost"}, {"label": "Фінал: мислитель", "tone": "story"}],
                "effects": {"stats": {"mood": 9, "energy": -8}, "traits": {"intelligence": 5}, "trust": 2, "xp": 15, "materials": {"leaf": 1}, "path": {"thinker": 4}, "ending": "thinker", "badge": "Хранитель сигналу", "flags_add": ["beacon_repaired"]},
                "outcome": {"title": "Хранитель сигналу", "text": "Маяк знову працює, а Піксель навчився розрізняти кожен його світловий ритм.", "reaction_text": "Я розгадав нічну пошту!", "pose": "sit", "next_hint": "Сюжет завершено. Випадкові події тепер частіше підтримують шлях мислителя."},
            },
            {
                "id": "make-safe-home", "label": "Зробити сад безпечним домом",
                "hint": "Піксель стане компаньйоном і частіше шукатиме спільні тихі моменти.",
                "impact": [{"label": "Настрій +10 · енергія −5", "tone": "cost"}, {"label": "Лагідність +5", "tone": "trait"}, {"label": "Фінал: компаньйон", "tone": "story"}],
                "effects": {"stats": {"mood": 10, "energy": -5}, "traits": {"affection": 5}, "trust": 2, "xp": 15, "materials": {"leaf": 1}, "path": {"companion": 4}, "ending": "companion", "badge": "Хранитель дому", "flags_add": ["safe_home_created"]},
                "outcome": {"title": "Хранитель дому", "text": "Сад став тихим прихистком. Піксель зрозумів: дім — це місце, де на тебе чекають.", "reaction_text": "Тепер тут усі можуть видихнути.", "pose": "sit", "next_hint": "Сюжет завершено. Випадкові події тепер частіше підтримують шлях компаньйона."},
            },
        ],
    },
]


PET_DAILY_EVENTS = [
    {
        "id": "surprise-box", "title": "Несподівана коробка", "text": "У кімнаті з’явилася велика коробка. {name} вже ходить навколо неї колами.",
        "hotspot": "shelf", "tags": ["thinker", "companion"], "weight": 4,
        "choices": [
            {"id": "fort", "label": "Розібрати коробку на матеріали", "hint": "Отримати матеріал, але трохи втомити котика.", "impact": [{"label": "Картон +2", "tone": "positive"}, {"label": "Енергія −4", "tone": "cost"}], "effects": {"materials": {"cardboard": 2}, "stats": {"energy": -4}, "traits": {"intelligence": 1}, "xp": 3, "path": {"thinker": 1}}, "outcome": {"title": "Запас для майбутньої фортеці", "text": "{name} уважно контролював кожен шматок картону.", "reaction_text": "Цей кут точно стане вежею!", "pose": "sit"}},
            {"id": "hide", "label": "Зробити тунель для гри", "hint": "Багато веселощів в обмін на трохи енергії.", "impact": [{"label": "Настрій +10", "tone": "positive"}, {"label": "Енергія −5", "tone": "cost"}, {"label": "Допитливість +2", "tone": "trait"}], "effects": {"stats": {"mood": 10, "energy": -5}, "traits": {"curiosity": 2}, "xp": 3, "path": {"explorer": 1}}, "outcome": {"title": "Коробковий тунель", "text": "Піксель кілька разів пролетів крізь коробку й урочисто засів усередині.", "reaction_text": "Мене тут ніхто не знайде!", "pose": "play"}},
        ],
    },
    {
        "id": "window-butterfly", "title": "Метелик за вікном", "text": "{name} помітив яскравого метелика й завмер біля скла.",
        "hotspot": "window", "tags": ["explorer", "companion"], "weight": 4,
        "choices": [
            {"id": "watch", "label": "Спостерігати разом", "hint": "Тихий спільний момент посилить довіру.", "impact": [{"label": "Настрій +6", "tone": "positive"}, {"label": "Довіра +1", "tone": "positive"}, {"label": "Лагідність +2", "tone": "trait"}], "effects": {"stats": {"mood": 6}, "trust": 1, "traits": {"affection": 2}, "xp": 3, "path": {"companion": 1}}, "outcome": {"title": "Тиха хвилина", "text": "Ви стежили за метеликом, доки Піксель не притулився до руки.", "reaction_text": "Добре, що ти теж це бачив.", "pose": "sit"}},
            {"id": "imitate", "label": "Зіграти в полювання", "hint": "Весело, але гра забере сили й трохи ситості.", "impact": [{"label": "Настрій +10", "tone": "positive"}, {"label": "Енергія −8 · ситість −2", "tone": "cost"}, {"label": "Допитливість +2", "tone": "trait"}], "effects": {"stats": {"mood": 10, "energy": -8, "satiety": -2}, "traits": {"curiosity": 2}, "xp": 3, "path": {"explorer": 1}}, "outcome": {"title": "Полювання без здобичі", "text": "{name} повторив кожен рух метелика й задоволено впав на килим.", "reaction_text": "Я майже його спіймав!", "pose": "play"}},
            {"id": "photo", "label": "Замалювати метелика", "hint": "Поповнити щоденник і розвинути уважність.", "impact": [{"label": "Листок +1", "tone": "positive"}, {"label": "Кмітливість +2", "tone": "trait"}], "effects": {"materials": {"leaf": 1}, "traits": {"intelligence": 2}, "xp": 3, "path": {"thinker": 1}}, "outcome": {"title": "Метелик у щоденнику", "text": "У щоденнику залишився малюнок метелика, а поруч — знайдений листочок.", "reaction_text": "Він схожий на нашого гостя!", "pose": "sit"}},
        ],
    },
    {
        "id": "lost-yarn", "title": "Загублений клубок", "text": "Клубок закотився під полицю, але {name} уже придумав із цього пригоду.",
        "hotspot": "shelf", "tags": ["explorer", "thinker"], "weight": 4,
        "choices": [
            {"id": "help", "label": "Допомогти дістати", "hint": "Швидке рішення й теплий спільний момент.", "impact": [{"label": "Мотузка +1", "tone": "positive"}, {"label": "Довіра +1", "tone": "positive"}, {"label": "Лагідність +2", "tone": "trait"}], "effects": {"materials": {"string": 1}, "stats": {"mood": 5}, "trust": 1, "traits": {"affection": 2}, "xp": 3, "path": {"companion": 1}}, "outcome": {"title": "Спільна перемога", "text": "Клубок повернувся, а Піксель запам’ятав, що може попросити вас про допомогу.", "reaction_text": "Ми гарна команда.", "pose": "sit"}},
            {"id": "search", "label": "Дати знайти самостійно", "hint": "Розвинути наполегливість ціною енергії.", "impact": [{"label": "Настрій +8 · пір’їнка +1", "tone": "positive"}, {"label": "Енергія −6", "tone": "cost"}, {"label": "Допитливість +2", "tone": "trait"}], "effects": {"stats": {"mood": 8, "energy": -6}, "materials": {"feather": 1}, "traits": {"curiosity": 2}, "xp": 3, "path": {"explorer": 1}}, "outcome": {"title": "Таємна схованка", "text": "Разом із клубком {name} витягнув загублену пір’їнку.", "reaction_text": "Бачиш? Я сам знайшов!", "pose": "play"}},
            {"id": "puzzle", "label": "Зробити головоломку", "hint": "Перетворити пошук на задачу для розуму.", "impact": [{"label": "Кмітливість +2", "tone": "trait"}, {"label": "Настрій +5", "tone": "positive"}, {"label": "Енергія −3", "tone": "cost"}], "effects": {"stats": {"mood": 5, "energy": -3}, "traits": {"intelligence": 2}, "preference": {"toy": "puzzle"}, "xp": 3, "path": {"thinker": 1}}, "outcome": {"title": "Нова улюблена задача", "text": "Піксель запам’ятав гру й тепер уважніше дивиться на головоломки.", "reaction_text": "А можна ще складніше?", "pose": "play"}},
        ],
    },
    {
        "id": "quiet-tail", "title": "Хвіст каже «не зараз»", "text": "{name} напружено смикає хвостом і відвертається від дотиків.",
        "hotspot": "cat", "tags": ["companion", "thinker"], "weight": 10, "requires": {"mood_state": "do_not_touch"},
        "choices": [
            {"id": "space", "label": "Поважати межі", "hint": "Дати спокій — це теж турбота.", "impact": [{"label": "Довіра +2", "tone": "positive"}, {"label": "Енергія +8", "tone": "positive"}, {"label": "Лагідність +1", "tone": "trait"}], "effects": {"stats": {"mood": 5, "energy": 8}, "trust": 2, "traits": {"affection": 1}, "xp": 4, "path": {"companion": 1}}, "outcome": {"title": "Межі почуті", "text": "За деякий час Піксель сам повернувся й сів неподалік.", "reaction_text": "Дякую, що почекав.", "pose": "sleep"}},
            {"id": "puzzle", "label": "Запропонувати тиху головоломку", "hint": "Відволікти без дотиків, витративши трохи сил.", "impact": [{"label": "Настрій +7", "tone": "positive"}, {"label": "Енергія −5", "tone": "cost"}, {"label": "Кмітливість +2", "tone": "trait"}], "effects": {"stats": {"mood": 7, "energy": -5}, "trust": 1, "traits": {"intelligence": 2}, "xp": 4, "path": {"thinker": 1}}, "outcome": {"title": "Тиха гра", "text": "Піксель зацікавився задачею, не відчуваючи тиску.", "reaction_text": "Так грати зараз можна.", "pose": "play"}},
            {"id": "touch", "label": "Погладити попри протест", "hint": "Котик запам’ятає, що його сигнал проігнорували, і не дозволить дотики 4 години.", "impact": [{"label": "Довіра −2", "tone": "risk"}, {"label": "Настрій −8", "tone": "risk"}, {"label": "Без дотиків 4 год", "tone": "risk"}], "effects": {"stats": {"mood": -8}, "trust": -2, "xp": 1, "flags_add": ["boundary_ignored"], "survival": {"reaction": "do_not_touch", "reaction_hours": 4, "touch_cooldown_hours": 4}}, "outcome": {"title": "{name} відсторонився", "text": "Котик відійшов до лежанки. Повернути довіру допоможуть тиша й доречна турбота.", "reaction_text": "Я ж просив не чіпати.", "pose": "sleep"}},
        ],
    },
    {
        "id": "picky-bowl", "title": "Підозрілий погляд на миску", "text": "{name} уже кілька разів отримував однакову їжу й сьогодні явно очікує змін.",
        "hotspot": "bowl", "tags": ["explorer", "companion"], "weight": 10, "requires": {"repeated_food": True},
        "choices": [
            {"id": "fish", "label": "Запропонувати рибку", "hint": "Змінити улюблену їжу на рибку й прибрати вередливість.", "impact": [{"label": "Ситість +10", "tone": "positive"}, {"label": "Настрій +7", "tone": "positive"}, {"label": "Нова улюблена їжа", "tone": "story"}], "effects": {"stats": {"satiety": 10, "mood": 7}, "trust": 1, "preference": {"food": "fish"}, "traits": {"affection": 1}, "xp": 4, "path": {"companion": 1}, "survival": {"clear_recent_foods": True}}, "outcome": {"title": "Рибка схвалена", "text": "{name} доїв усе й запам’ятав цей смак як улюблений.", "reaction_text": "Оце вже цікавіше!", "pose": "eat"}},
            {"id": "crunchy", "label": "Дати хрусткий корм", "hint": "Змінити улюблену їжу на хрусткий корм і прибрати вередливість.", "impact": [{"label": "Ситість +8", "tone": "positive"}, {"label": "Допитливість +2", "tone": "trait"}, {"label": "Нова улюблена їжа", "tone": "story"}], "effects": {"stats": {"satiety": 8, "mood": 5}, "trust": 1, "preference": {"food": "crunchy"}, "traits": {"curiosity": 2}, "xp": 4, "path": {"explorer": 1}, "survival": {"clear_recent_foods": True}}, "outcome": {"title": "Новий хрускіт", "text": "Новий смак зацікавив котика й тепер впливатиме на його реакцію під час годування.", "reaction_text": "Хрум! Це залишаємо.", "pose": "eat"}},
            {"id": "insist", "label": "Наполягти на старій їжі", "hint": "Ситість зросте, але настрій і довіра постраждають; вередливість триватиме 4 години.", "impact": [{"label": "Ситість +6", "tone": "positive"}, {"label": "Настрій −7 · довіра −1", "tone": "risk"}, {"label": "Вередує 4 год", "tone": "risk"}], "effects": {"stats": {"satiety": 6, "mood": -7}, "trust": -1, "xp": 1, "flags_add": ["food_choice_ignored"], "survival": {"reaction": "picky", "reaction_hours": 4}}, "outcome": {"title": "Миска майже не торкнута", "text": "{name} трохи поїв, але запам’ятав, що його смак сьогодні не врахували.", "reaction_text": "Знову те саме…", "pose": "sit"}},
        ],
    },
    {
        "id": "night-zoomies", "title": "Нічні перегони", "text": "У {name} забагато енергії для сну: кімната перетворилася на трасу.",
        "hotspot": "toy", "tags": ["explorer", "thinker"], "weight": 6, "requires": {"energy_gte": 55},
        "choices": [
            {"id": "wand", "label": "Влаштувати полювання з вудочкою", "hint": "Найвеселіший, але найенерговитратніший варіант; котик трохи зголодніє.", "impact": [{"label": "Настрій +11", "tone": "positive"}, {"label": "Енергія −14 · ситість −3", "tone": "cost"}, {"label": "Допитливість +2", "tone": "trait"}], "effects": {"stats": {"mood": 11, "energy": -14, "satiety": -3}, "traits": {"curiosity": 2}, "preference": {"toy": "wand"}, "xp": 4, "path": {"explorer": 1}}, "outcome": {"title": "Швидкість світла", "text": "Після шаленої гонитви {name} нарешті задоволено розлігся.", "reaction_text": "Ще одне коло!", "pose": "play"}},
            {"id": "puzzle", "label": "Дати головоломку", "hint": "Спокійніше використати енергію й розвинути кмітливість.", "impact": [{"label": "Настрій +8", "tone": "positive"}, {"label": "Енергія −8", "tone": "cost"}, {"label": "Кмітливість +2", "tone": "trait"}], "effects": {"stats": {"mood": 8, "energy": -8}, "traits": {"intelligence": 2}, "preference": {"toy": "puzzle"}, "xp": 4, "path": {"thinker": 1}}, "outcome": {"title": "Енергія пішла в задачу", "text": "Піксель розібрався з головоломкою й тепер просить складнішу.", "reaction_text": "Це було занадто легко.", "pose": "play"}},
            {"id": "nest", "label": "Зробити тихе гніздечко", "hint": "Допомогти витратити надлишок енергії у спокійній грі й заснути.", "impact": [{"label": "Енергія −6", "tone": "cost"}, {"label": "Настрій +5", "tone": "positive"}, {"label": "Лагідність +2", "tone": "trait"}], "effects": {"stats": {"energy": -6, "mood": 5}, "traits": {"affection": 2}, "trust": 1, "xp": 4, "path": {"companion": 1}}, "outcome": {"title": "Спокій повернувся", "text": "{name} трохи погрався під пледом і нарешті вмостився поруч.", "reaction_text": "Гаразд, трасу закриваємо.", "pose": "sleep"}},
        ],
    },
    {
        "id": "dusty-sneeze", "title": "Підозріле чхання", "text": "Під полицею зібрався пил, і {name} демонстративно чхнув у ваш бік.",
        "hotspot": "bowl", "tags": ["thinker", "companion"], "weight": 8, "requires": {"cleanliness_lte": 65},
        "choices": [
            {"id": "clean", "label": "Прибрати просто зараз", "hint": "Повернути чистоту ціною невеликої втоми.", "impact": [{"label": "Чистота +18", "tone": "positive"}, {"label": "Енергія −4", "tone": "cost"}, {"label": "Здоров’я +2", "tone": "positive"}], "effects": {"stats": {"cleanliness": 18, "energy": -4, "health": 2}, "traits": {"intelligence": 1}, "trust": 1, "xp": 4, "path": {"thinker": 1}}, "outcome": {"title": "Пил переможено", "text": "Кімната знову чиста, а Піксель схвально перевірив кожен кут.", "reaction_text": "О, тепер дихається краще.", "pose": "sit"}},
            {"id": "rest", "label": "Спершу перенести Пікселя відпочити", "hint": "Покращити настрій та енергію, але залишити пил на потім.", "impact": [{"label": "Енергія +9", "tone": "positive"}, {"label": "Настрій +5", "tone": "positive"}, {"label": "Чистота −3", "tone": "cost"}], "effects": {"stats": {"energy": 9, "mood": 5, "cleanliness": -3}, "traits": {"affection": 2}, "xp": 3, "path": {"companion": 1}}, "outcome": {"title": "Спочатку — спокій", "text": "Піксель відпочив у чистому куточку, але прибирання все ще чекає.", "reaction_text": "Так краще. А пил не втече.", "pose": "sleep"}},
        ],
    },
    {
        "id": "collar-snag", "title": "Нашийник зачепився", "text": "Нашийник {name} зачепився за край лежанки. Він завмер і чекає вашої реакції.",
        "hotspot": "cat", "tags": ["companion", "thinker"], "weight": 8, "requires": {"equipped": {"collar": "collar-violet"}},
        "choices": [
            {"id": "gently", "label": "Обережно звільнити", "hint": "Спокійна допомога сильно підтримає довіру.", "impact": [{"label": "Довіра +2", "tone": "positive"}, {"label": "Настрій +5", "tone": "positive"}, {"label": "Лагідність +2", "tone": "trait"}], "effects": {"stats": {"mood": 5}, "trust": 2, "traits": {"affection": 2}, "xp": 4, "path": {"companion": 1}}, "outcome": {"title": "Спокійна допомога", "text": "Піксель не смикався й дозволив вам звільнити нашийник.", "reaction_text": "Я знав, що ти допоможеш.", "pose": "sit"}},
            {"id": "remove", "label": "Зняти нашийник", "hint": "Поставити комфорт вище за вигляд; предмет залишиться в колекції.", "impact": [{"label": "Нашийник знято", "tone": "story"}, {"label": "Настрій +7", "tone": "positive"}, {"label": "Довіра +1", "tone": "positive"}], "effects": {"stats": {"mood": 7}, "trust": 1, "unequip": ["collar"], "traits": {"intelligence": 1}, "xp": 4, "path": {"thinker": 1}}, "outcome": {"title": "Комфорт важливіший", "text": "Нашийник повернувся до колекції, а Піксель задоволено потягнувся.", "reaction_text": "Без нього сьогодні зручніше.", "pose": "sit"}},
        ],
    },
    {
        "id": "moon-plant", "title": "Листок у місячному світлі", "text": "Місячна рослина ворухнула листком, і {name} не може відвести погляд.",
        "hotspot": "shelf", "tags": ["explorer", "thinker", "companion"], "weight": 7, "requires": {"equipped": {"decor": "plant-moon"}},
        "choices": [
            {"id": "follow", "label": "Дослідити рух листка", "hint": "Знайти маленький сувенір, витративши сили й трохи забруднивши лапи.", "impact": [{"label": "Листок +1", "tone": "positive"}, {"label": "Енергія −5 · чистота −3", "tone": "cost"}, {"label": "Допитливість +2", "tone": "trait"}], "effects": {"materials": {"leaf": 1}, "stats": {"mood": 7, "energy": -5, "cleanliness": -3}, "traits": {"curiosity": 2}, "xp": 4, "path": {"explorer": 1}}, "outcome": {"title": "Знайдено срібний листок", "text": "За вазоном ховався сухий листок, що виблискує у неоні.", "reaction_text": "Я знав, що там щось є!", "pose": "play"}},
            {"id": "observe", "label": "Спостерігати й занотувати", "hint": "Розвинути уважність без зайвого ризику.", "impact": [{"label": "Кмітливість +2", "tone": "trait"}, {"label": "Настрій +5", "tone": "positive"}], "effects": {"stats": {"mood": 5}, "traits": {"intelligence": 2}, "xp": 4, "path": {"thinker": 1}}, "outcome": {"title": "Рослина має свій ритм", "text": "Піксель помітив, що листя рухається щоразу перед зміною світла.", "reaction_text": "Запишемо це як закономірність.", "pose": "sit"}},
            {"id": "together", "label": "Посидіти поруч", "hint": "Перетворити дивний момент на спокійний спогад.", "impact": [{"label": "Настрій +7", "tone": "positive"}, {"label": "Енергія +5", "tone": "positive"}, {"label": "Лагідність +2", "tone": "trait"}], "effects": {"stats": {"mood": 7, "energy": 5}, "traits": {"affection": 2}, "trust": 1, "xp": 4, "path": {"companion": 1}}, "outcome": {"title": "Тиха магія кімнати", "text": "Ви просто посиділи разом, доки листя тихо хиталося у світлі.", "reaction_text": "Не все дивне треба ловити.", "pose": "sit"}},
        ],
    },
]

PET_DAILY_EVENTS = enrich_events([event for event in PET_DAILY_EVENTS if event["id"] != "collar-snag"])

MATERIAL_NAMES = {
    "cardboard": "Картон",
    "string": "Мотузка",
    "fabric": "Тканина",
    "feather": "Пір'їнка",
    "leaf": "Листок",
}


class PetCareBody(BaseModel):
    action: Literal["feed", "pet", "play", "rest", "clean", "heal"]
    option: Optional[str] = Field(default=None, max_length=40)
    date_key: Optional[str] = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    generation: Optional[int] = Field(default=None, ge=1, le=1000000)
    zone: Literal["head", "back", "belly"] = "head"


class PetIntentBody(BaseModel):
    intent: Literal["explore", "learn", "build"]


class PetExpeditionBody(BaseModel):
    location_id: Literal["yard", "park", "rooftop"]
    loadout_id: Literal["backpack", "bell", "blanket"] = "backpack"


class PetProjectBody(BaseModel):
    contribution: Literal["cardboard", "craft", "ideas"] = "cardboard"


class PetMinigameEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    target_id: int = Field(ge=0, le=63)
    at_ms: int = Field(ge=0, le=120_000)
    lane: Optional[int] = Field(default=None, ge=0, le=3)


class PetMinigameFinishBody(BaseModel):
    moves: list[int] = Field(default_factory=list, max_length=32)
    events: list[PetMinigameEvent] = Field(default_factory=list, max_length=64)
    client_duration_ms: Optional[int] = Field(default=None, ge=0, le=120_000)


class PetEquipBody(BaseModel):
    item_id: str = Field(min_length=2, max_length=80)


class PetRoomPlacement(BaseModel):
    model_config = ConfigDict(extra="forbid")

    item_id: str = Field(min_length=2, max_length=80)
    x: FiniteFloat = Field(ge=0, le=100)
    y: FiniteFloat = Field(ge=0, le=100)

    @field_validator("x", "y", mode="before")
    @classmethod
    def reject_boolean_coordinates(cls, value):
        if isinstance(value, bool):
            raise ValueError("coordinate must be numeric")
        return value


class PetRoomLayoutBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    placements: list[PetRoomPlacement] = Field(default_factory=list, max_length=len(PET_ITEMS))


class PetEventChoiceBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_id: str = Field(min_length=2, max_length=80)
    choice_id: str = Field(min_length=2, max_length=80)
    date_key: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    generation: int = Field(ge=1, le=10_000)


class PetStoryChoiceBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scene_id: str = Field(min_length=2, max_length=80)
    choice_id: str = Field(min_length=2, max_length=80)
    date_key: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    generation: int = Field(ge=1, le=10_000)


class PetRenameBody(BaseModel):
    name: str = Field(min_length=2, max_length=20)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat()


def _date_key() -> str:
    return datetime.now(KYIV_TZ).strftime("%Y-%m-%d")


def _week_key() -> str:
    local = datetime.now(KYIV_TZ)
    year, week, _ = local.isocalendar()
    return f"{year}-W{week:02d}"


def _parse_iso(value: Optional[object]) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except (TypeError, ValueError):
        return None


def _encode_journal_cursor(item: dict) -> str:
    payload = json.dumps(
        [str(item.get("occurred_at") or ""), str(item.get("id") or "")],
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    return base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")


def _decode_journal_cursor(cursor: str) -> tuple[str, str]:
    try:
        padding = "=" * (-len(cursor) % 4)
        values = json.loads(base64.urlsafe_b64decode(cursor + padding).decode("utf-8"))
        if not isinstance(values, list) or len(values) != 2 or not all(isinstance(value, str) and value for value in values):
            raise ValueError("invalid cursor payload")
        return values[0], values[1]
    except (ValueError, TypeError, UnicodeDecodeError, json.JSONDecodeError, binascii.Error) as exc:
        raise ValueError("invalid journal cursor") from exc


def _workday_decay_hours(start: datetime, end: datetime) -> float:
    """Count only Kyiv weekday hours from 07:00 through 23:00.

    This avoids charging a Monday visit for an entire weekend or for nights.
    The result is capped because all dependent stat decay is capped as well.
    """
    if end <= start:
        return 0.0
    start_utc = start.astimezone(timezone.utc)
    end_utc = end.astimezone(timezone.utc)
    day = start_utc.astimezone(KYIV_TZ).date()
    last_day = end_utc.astimezone(KYIV_TZ).date()
    seconds = 0.0
    while day <= last_day and seconds < 24 * 3600:
        if day.weekday() < 5:
            window_start = datetime(day.year, day.month, day.day, 7, tzinfo=KYIV_TZ).astimezone(timezone.utc)
            window_end = datetime(day.year, day.month, day.day, 23, tzinfo=KYIV_TZ).astimezone(timezone.utc)
            overlap_start = max(start_utc, window_start)
            overlap_end = min(end_utc, window_end)
            if overlap_end > overlap_start:
                seconds += (overlap_end - overlap_start).total_seconds()
        day += timedelta(days=1)
    return min(24.0, seconds / 3600)


def _survival_decay_hours(start: datetime, end: datetime) -> float:
    """Count strict care hours while keeping weekends safe.

    Unlike the legacy office-hours decay, survival needs continue through
    weekday nights. Saturday and Sunday in Kyiv are protected automatically so
    an employee is never punished for leaving the work PWA closed all weekend.
    The cap is deliberately long enough for terminal outcomes while bounding a
    single migration/update calculation.
    """
    if end <= start:
        return 0.0
    start_utc = start.astimezone(timezone.utc)
    end_utc = end.astimezone(timezone.utc)
    day = start_utc.astimezone(KYIV_TZ).date()
    last_day = end_utc.astimezone(KYIV_TZ).date()
    seconds = 0.0
    cap_seconds = 168 * 3600
    while day <= last_day and seconds < cap_seconds:
        if day.weekday() < 5:
            next_day = day + timedelta(days=1)
            window_start = datetime(day.year, day.month, day.day, tzinfo=KYIV_TZ).astimezone(timezone.utc)
            window_end = datetime(next_day.year, next_day.month, next_day.day, tzinfo=KYIV_TZ).astimezone(timezone.utc)
            overlap_start = max(start_utc, window_start)
            overlap_end = min(end_utc, window_end)
            if overlap_end > overlap_start:
                seconds += (overlap_end - overlap_start).total_seconds()
        day += timedelta(days=1)
    return min(168.0, seconds / 3600)


def _survival_time_after_hours(start: datetime, end: datetime, target_hours: float) -> datetime:
    """Map accumulated protected-weekday hours back onto wall-clock time."""
    remaining = max(0.0, target_hours) * 3600
    start_utc = start.astimezone(timezone.utc)
    end_utc = end.astimezone(timezone.utc)
    day = start_utc.astimezone(KYIV_TZ).date()
    last_day = end_utc.astimezone(KYIV_TZ).date()
    while day <= last_day:
        if day.weekday() < 5:
            next_day = day + timedelta(days=1)
            window_start = datetime(day.year, day.month, day.day, tzinfo=KYIV_TZ).astimezone(timezone.utc)
            window_end = datetime(next_day.year, next_day.month, next_day.day, tzinfo=KYIV_TZ).astimezone(timezone.utc)
            overlap_start = max(start_utc, window_start)
            overlap_end = min(end_utc, window_end)
            available = max(0.0, (overlap_end - overlap_start).total_seconds())
            if remaining <= available + 1e-6:
                return min(end_utc, overlap_start + timedelta(seconds=remaining))
            remaining -= available
        day += timedelta(days=1)
    return end_utc


def _stable_int(*parts: object) -> int:
    raw = ":".join(str(part) for part in parts).encode("utf-8")
    return int.from_bytes(hashlib.sha256(raw).digest()[:8], "big")


SORTING_LANES = [
    {"id": 0, "label": "До миски"},
    {"id": 1, "label": "До кошика з іграшками"},
    {"id": 2, "label": "На полицю"},
]

SORTING_CARD_POOL = [
    ("Рибка", "fish", 0),
    ("Сухий корм", "cookie", 0),
    ("Смаколик", "bone", 0),
    ("Клубок", "circle", 1),
    ("М'ячик", "ball", 1),
    ("Пір'їнка", "feather", 1),
    ("Фото", "camera", 2),
    ("Книжка", "book", 2),
    ("Вазон", "sprout", 2),
    ("Мисочка", "bowl", 0),
    ("Мишка", "mouse", 1),
    ("Ліхтарик", "lamp", 2),
]


def _challenge_bytes(session_id: str, user_id: str, game_id: str) -> bytes:
    return hashlib.sha256(f"{session_id}:{user_id}:{game_id}:pet-game-v2".encode("utf-8")).digest()


def _build_minigame_challenge(session_id: str, user_id: str, game_id: str) -> tuple[dict, dict]:
    """Return the private authoritative challenge and its playable projection."""
    digest = _challenge_bytes(session_id, user_id, game_id)
    if game_id == "memory":
        solution = [byte % 4 for byte in digest[:6]]
        private = {
            "version": 2,
            "kind": "sequence",
            "solution": solution,
            "palette_size": 4,
            "cue_ms": 520,
            "min_duration_ms": 3_600,
            "duration_ms": 25_000,
        }
        public = {
            "kind": "sequence",
            "palette_size": 4,
            "cues": solution,
            "cue_ms": 520,
            "min_duration_ms": 3_600,
            "duration_ms": 25_000,
        }
        return private, public

    if game_id == "laser":
        targets = []
        for index in range(10):
            jitter = (digest[10 + index] % 201) - 100
            targets.append({
                "id": index,
                "lane": digest[index] % 4,
                "at_ms": 900 + index * 1_500 + jitter,
                "window_ms": 420,
            })
        duration_ms = 18_000
        min_duration_ms = targets[-1]["at_ms"] + targets[-1]["window_ms"]
        private = {
            "version": 2,
            "kind": "timed-targets",
            "targets": targets,
            "duration_ms": duration_ms,
            "min_duration_ms": min_duration_ms,
        }
        public = {
            "kind": "timed-targets",
            "lanes": 4,
            "targets": copy.deepcopy(targets),
            "duration_ms": duration_ms,
            "min_duration_ms": min_duration_ms,
        }
        return private, public

    if game_id == "sorting":
        selected = sorted(
            enumerate(SORTING_CARD_POOL),
            key=lambda row: _stable_int(session_id, user_id, "sorting", row[0]),
        )[:9]
        cards = [
            {"id": index, "label": card[0], "icon": card[1], "correct_lane": card[2]}
            for index, (_, card) in enumerate(selected)
        ]
        private = {
            "version": 2,
            "kind": "sorting",
            "cards": cards,
            "duration_ms": 30_000,
            "min_duration_ms": 3_000,
        }
        public = {
            "kind": "sorting",
            "lanes": copy.deepcopy(SORTING_LANES),
            "cards": [{key: card[key] for key in ("id", "label", "icon")} for card in cards],
            "duration_ms": 30_000,
            "min_duration_ms": 3_000,
        }
        return private, public

    raise ValueError(f"Unsupported pet minigame: {game_id}")


def _challenge_review(challenge: dict) -> dict:
    kind = challenge.get("kind")
    if kind == "sequence":
        return {"kind": kind, "solution": list(challenge.get("solution") or [])}
    if kind == "sorting":
        return {
            "kind": kind,
            "correct_lanes": [
                {"target_id": card.get("id"), "lane": card.get("correct_lane")}
                for card in challenge.get("cards") or []
            ],
        }
    if kind == "timed-targets":
        return {"kind": kind, "target_count": len(challenge.get("targets") or [])}
    return {"kind": str(kind or "legacy")}


def _score_minigame(session: dict, body: PetMinigameFinishBody, now: Optional[datetime] = None) -> tuple[int, dict]:
    """Score only against the immutable server challenge, never client totals."""
    current = (now or _now()).astimezone(timezone.utc)
    started_at = _parse_iso(session.get("started_at"))
    elapsed_ms = max(0, int((current - started_at).total_seconds() * 1000)) if started_at else 0
    challenge = session.get("challenge") if isinstance(session.get("challenge"), dict) else None
    if not challenge:
        # Existing v1 sessions remain finishable but their old sequence is no
        # longer exposed by the public projection.
        challenge = {
            "kind": "sequence",
            "solution": list(session.get("sequence") or []),
            "min_duration_ms": 0,
        }
    kind = challenge.get("kind")
    min_duration_ms = _safe_int(challenge.get("min_duration_ms"), 0, 0)
    duration_ms = _safe_int(challenge.get("duration_ms"), 0, 0)
    if elapsed_ms + 250 < min_duration_ms:
        return 0, {"kind": kind, "reason": "too_early", "elapsed_ms": elapsed_ms}
    client_duration_ms = body.client_duration_ms
    if client_duration_ms is not None:
        if client_duration_ms + 250 < min_duration_ms:
            return 0, {
                "kind": kind,
                "reason": "too_early",
                "elapsed_ms": client_duration_ms,
                "clock": "client",
            }
        # A client clock may lag behind the server because the response took time
        # to render, but it cannot legitimately be ahead of wall-clock time.
        if client_duration_ms > elapsed_ms + 1_000:
            return 0, {
                "kind": kind,
                "reason": "invalid_client_clock",
                "elapsed_ms": elapsed_ms,
                "client_duration_ms": client_duration_ms,
            }
        if duration_ms and client_duration_ms > duration_ms + 1_500:
            return 0, {
                "kind": kind,
                "reason": "time_limit_exceeded",
                "duration_ms": duration_ms,
                "client_duration_ms": client_duration_ms,
            }
    event_time_limit = min(
        elapsed_ms + 1_000,
        (client_duration_ms + 250) if client_duration_ms is not None else elapsed_ms + 1_000,
        (duration_ms + 500) if duration_ms else elapsed_ms + 1_000,
    )

    if kind == "sequence":
        expected = [int(value) for value in challenge.get("solution") or []]
        submitted = [int(value) for value in body.moves]
        matches = sum(1 for index, value in enumerate(submitted[:len(expected)]) if value == expected[index])
        missing = max(0, len(expected) - len(submitted))
        extra = max(0, len(submitted) - len(expected))
        score = round(100 * matches / max(1, len(expected))) - extra * 8
        return max(0, min(100, score)), {
            "kind": kind,
            "correct": matches,
            "total": len(expected),
            "invalid": missing + extra,
        }

    events = list(body.events)
    invalid = 0
    seen: set[int] = set()
    last_at = -1
    correct = 0
    if kind == "timed-targets":
        targets = {int(target["id"]): target for target in challenge.get("targets") or []}
        for event in events:
            if event.target_id in seen or event.at_ms < last_at:
                invalid += 1
                continue
            seen.add(event.target_id)
            last_at = event.at_ms
            target = targets.get(event.target_id)
            if not target or event.lane is None or event.at_ms > event_time_limit:
                invalid += 1
                continue
            lane_ok = event.lane == int(target["lane"])
            target_at = int(target["at_ms"])
            # Small tolerance absorbs animation-frame jitter, without accepting
            # a forged tap one full hit-window before the target appeared.
            timing_ok = target_at - 75 <= event.at_ms <= target_at + int(target["window_ms"]) + 100
            if lane_ok and timing_ok:
                correct += 1
            else:
                invalid += 1
        total = len(targets)
    elif kind == "sorting":
        cards = {int(card["id"]): card for card in challenge.get("cards") or []}
        for event in events:
            if event.target_id in seen or event.at_ms < last_at:
                invalid += 1
                continue
            seen.add(event.target_id)
            last_at = event.at_ms
            card = cards.get(event.target_id)
            if not card or event.lane is None or event.at_ms > event_time_limit:
                invalid += 1
                continue
            if event.lane == int(card["correct_lane"]):
                correct += 1
            else:
                invalid += 1
        total = len(cards)
    else:
        return 0, {"kind": str(kind), "reason": "unsupported_challenge"}

    missing = max(0, total - len(seen))
    score = round(100 * correct / max(1, total)) - invalid * 10
    return max(0, min(100, score)), {
        "kind": kind,
        "correct": correct,
        "total": total,
        "invalid": invalid + missing,
    }


def _reward_deck(user_id: str, cycle: int) -> list[str]:
    """Build a personal deterministic deck with a known maximum Point value.

    A stored cursor makes rewards varied without allowing extra rolls. Four of
    ten cards carry 25 Point total; the monthly guard below caps real awards.
    """
    cards = [
        "points-5-a", "points-5-b", "points-5-c", "points-10",
        "material-cardboard", "material-fabric", "material-feather", "material-leaf",
        "item-collar-violet", "item-pillow-starlight",
    ]
    return sorted(cards, key=lambda card: _stable_int(user_id, cycle, card, "pet-deck"))


def _reward_from_card(card: str) -> dict:
    if card.startswith("points-5"):
        return {"type": "points", "amount": 5, "title": "+5 Point"}
    if card == "points-10":
        return {"type": "points", "amount": 10, "title": "+10 Point"}
    if card == "item-collar-violet":
        # Preserve the deck order/cursor for existing profiles; retire its item.
        return {"type": "material", "material": "fabric", "amount": 4, "title": "Тканина ×4"}
    if card == "item-pillow-starlight":
        return {"type": "item", "item_id": "pillow-starlight", "title": "Подушка «Зоряне світло»"}
    material = card.removeprefix("material-")
    if material not in MATERIAL_NAMES:
        material = "cardboard"
    return {"type": "material", "material": material, "amount": 2, "title": f"{MATERIAL_NAMES[material]} ×2"}


def _clamp(value: float, low: int = 0, high: int = 100) -> int:
    return max(low, min(high, round(value)))


def _finite_number(value: object, fallback: float) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError, OverflowError):
        return float(fallback)
    return parsed if math.isfinite(parsed) else float(fallback)


def _safe_int(value: object, fallback: int, low: Optional[int] = None) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError, OverflowError):
        parsed = fallback
    return max(low, parsed) if low is not None else parsed


STORY_PATHS = {
    "explorer": {
        "label": "Сміливий дослідник",
        "short_label": "Дослідник",
        "description": "Частіше прагне активної гри, нових слідів та експедицій.",
    },
    "thinker": {
        "label": "Кмітливий мислитель",
        "short_label": "Мислитель",
        "description": "Частіше цікавиться головоломками, полицею та тренуваннями.",
    },
    "companion": {
        "label": "Лагідний компаньйон",
        "short_label": "Компаньйон",
        "description": "Частіше шукає спільний відпочинок, дотик і тихі моменти.",
    },
}


def _new_story(generation: int = 1) -> dict:
    return {
        "version": PET_STORY_VERSION,
        "generation": _safe_int(generation, 1, 1),
        "arc_id": PET_STORY_ARC["id"],
        "completed_scenes": [],
        "decisions": {},
        "flags": [],
        "path_scores": {"explorer": 0, "thinker": 0, "companion": 0},
        "ending": None,
        "temperament": None,
        "recent_path_choices": [],
        "badge": None,
        "recent_event_ids": [],
        "last_scene_id": None,
        "last_choice_at": None,
    }


def _ensure_story(profile: dict) -> bool:
    generation = _safe_int((profile.get("survival") or {}).get("generation"), 1, 1)
    story = profile.get("story")
    if not isinstance(story, dict) or _safe_int(story.get("generation"), 0, 0) != generation:
        profile["story"] = _new_story(generation)
        return True
    if story.get("version") != PET_STORY_VERSION or story.get("arc_id") != PET_STORY_ARC["id"]:
        profile["story"] = _new_story(generation)
        return True

    changed = False
    defaults = _new_story(generation)
    for key in ("completed_scenes", "flags", "recent_event_ids", "recent_path_choices"):
        values = story.get(key)
        clean = list(dict.fromkeys(str(value)[:80] for value in values if isinstance(value, str) and value))[-32:] if isinstance(values, list) else []
        if key == "recent_event_ids":
            clean = clean[-7:]
        elif key == "recent_path_choices":
            clean = [value for value in (values or []) if isinstance(value, str) and value in STORY_PATHS][-5:] if isinstance(values, list) else []
        if values != clean:
            story[key] = clean
            changed = True
    decisions = story.get("decisions")
    clean_decisions = {
        str(scene_id)[:80]: str(choice_id)[:80]
        for scene_id, choice_id in decisions.items()
        if isinstance(scene_id, str) and isinstance(choice_id, str)
    } if isinstance(decisions, dict) else {}
    if decisions != clean_decisions:
        story["decisions"] = clean_decisions
        changed = True
    scores = story.get("path_scores")
    if not isinstance(scores, dict):
        scores = {}
    clean_scores = {key: min(100, _safe_int(scores.get(key), 0, 0)) for key in STORY_PATHS}
    if story.get("path_scores") != clean_scores:
        story["path_scores"] = clean_scores
        changed = True
    for key in ("ending", "temperament", "badge", "last_scene_id", "last_choice_at"):
        if key not in story:
            story[key] = copy.deepcopy(defaults[key])
            changed = True
    if story.get("ending") not in {None, *STORY_PATHS.keys()}:
        story["ending"] = None
        changed = True
    if story.get("temperament") not in {None, *STORY_PATHS.keys()}:
        story["temperament"] = None
        changed = True
    return changed


def _dominant_story_path(profile: dict) -> Optional[str]:
    story = profile.get("story") if isinstance(profile.get("story"), dict) else {}
    temperament = story.get("temperament")
    if temperament in STORY_PATHS:
        return temperament
    ending = story.get("ending")
    if ending in STORY_PATHS:
        return ending
    scores = story.get("path_scores") if isinstance(story.get("path_scores"), dict) else {}
    ranked = sorted(STORY_PATHS, key=lambda key: (-_safe_int(scores.get(key), 0, 0), list(STORY_PATHS).index(key)))
    if not ranked or _safe_int(scores.get(ranked[0]), 0, 0) <= 0:
        return None
    top = _safe_int(scores.get(ranked[0]), 0, 0)
    if len(ranked) > 1 and _safe_int(scores.get(ranked[1]), 0, 0) == top:
        return None
    return ranked[0]


def _pet_personality(profile: dict) -> dict:
    path = _dominant_story_path(profile)
    if path:
        return {"id": path, **STORY_PATHS[path], "formed": True}
    traits = profile.get("traits") if isinstance(profile.get("traits"), dict) else {}
    dominant_trait = max(("curiosity", "intelligence", "affection"), key=lambda key: _safe_int(traits.get(key), 0))
    fallback = {
        "curiosity": ("curious", "Допитливий напарник", "Характер ще формується через ваші щоденні рішення."),
        "intelligence": ("observant", "Уважний напарник", "Характер ще формується через ваші щоденні рішення."),
        "affection": ("gentle", "Лагідний напарник", "Характер ще формується через ваші щоденні рішення."),
    }[dominant_trait]
    return {"id": fallback[0], "label": fallback[1], "short_label": "Характер формується", "description": fallback[2], "formed": False}


def _story_requirement_reason(profile: dict, scene: dict) -> Optional[str]:
    requirements = scene.get("requires") or {}
    completed = set((profile.get("story") or {}).get("completed_scenes") or [])
    if any(scene_id not in completed for scene_id in requirements.get("completed", [])):
        return "Спочатку завершіть попередній розділ"
    level = _safe_int(profile.get("friendship_level"), 1, 1)
    if level < _safe_int(requirements.get("min_level"), 1, 1):
        return f"Потрібен {requirements['min_level']} рівень дружби"
    trust = _safe_int(profile.get("trust"), 0, 0)
    if trust < _safe_int(requirements.get("min_trust"), 0, 0):
        return f"Потрібна довіра {requirements['min_trust']}"
    condition = (profile.get("survival") or {}).get("condition")
    if requirements.get("healthy_enough") and condition in {"neglected", "sick", "critical"}:
        return "Спочатку допоможіть котику відновитися"
    return None


def _next_story_definition(profile: dict) -> Optional[dict]:
    completed = set((profile.get("story") or {}).get("completed_scenes") or [])
    return next((scene for scene in PET_STORY_SCENES if scene["id"] not in completed), None)


def _choice_locked_reason(profile: dict, choice: dict) -> Optional[str]:
    for skill, required_xp in choice.get("requires_skills", {}).items():
        if (profile.get("life") or {}).get("skills", {}).get(skill, 0) < required_xp:
            return f"Потрібно {required_xp} досвіду: {pet_life.SKILLS[skill]['name']}"
    required = choice.get("requires_materials") or {}
    materials = (profile.get("inventory") or {}).get("materials") or {}
    missing = [
        f"{MATERIAL_NAMES.get(key, key)} ×{amount}"
        for key, amount in required.items()
        if _safe_int(materials.get(key), 0, 0) < _safe_int(amount, 0, 0)
    ]
    return f"Потрібно: {', '.join(missing)}" if missing else None


def _public_narrative_choice(profile: dict, choice: dict) -> dict:
    return {
        "id": choice["id"],
        "label": _narrative_text(choice["label"], profile),
        "hint": _narrative_text(choice.get("hint") or "Цей вибір вплине на {name}.", profile),
        "impact": copy.deepcopy(choice.get("impact") or []),
        "locked_reason": _choice_locked_reason(profile, choice),
    }


def _narrative_text(text: object, profile: dict) -> str:
    name = str(profile.get("name") or "Піксель")
    rendered = str(text or "").replace("{name}", name)
    if name != "Піксель":
        rendered = rendered.replace("Пікселя", name).replace("Піксель", name)
    return rendered


def _public_story_scene(profile: dict, scene: dict) -> dict:
    path = _dominant_story_path(profile)
    path_text = (scene.get("path_text") or {}).get(path)
    text = _narrative_text(scene.get("text"), profile)
    if path_text:
        text = f"{text} {_narrative_text(path_text, profile)}"
    return {
        "id": scene["id"],
        "chapter": scene["chapter"],
        "title": _narrative_text(scene["title"], profile),
        "text": text,
        "foreshadow": _narrative_text(scene.get("foreshadow"), profile),
        "hotspot": scene.get("hotspot"),
        "choices": [_public_narrative_choice(profile, choice) for choice in scene.get("choices", [])],
    }


def _story_status(profile: dict) -> dict:
    story = profile.get("story") if isinstance(profile.get("story"), dict) else _new_story(
        _safe_int((profile.get("survival") or {}).get("generation"), 1, 1)
    )
    daily = profile.get("daily") if isinstance(profile.get("daily"), dict) else {}
    next_scene = _next_story_definition({**profile, "story": story})
    alive = (profile.get("survival") or {}).get("status", "alive") == "alive"
    condition = (profile.get("survival") or {}).get("condition")
    reason = _story_requirement_reason(profile, next_scene) if next_scene else None
    if not alive:
        reason = "Ця історія завершилася разом із цим котиком"
    elif condition in {"sick", "critical"}:
        reason = "Сюжет призупинено, доки котик не одужає"
    resolved_today = copy.deepcopy(daily.get("story_result"))
    current_scene = None
    if next_scene and alive and not reason and not daily.get("story_resolved"):
        current_scene = _public_story_scene(profile, next_scene)
    completed_count = len(story.get("completed_scenes") or [])
    personality = _pet_personality({**profile, "story": story})
    if story.get("ending") or not next_scene:
        status = "completed"
        next_hint = f"Фінал: {story.get('badge') or personality['label']}"
    elif resolved_today:
        status = "waiting"
        next_hint = "Наступний розділ буде доступний завтра" + (f". {reason}" if reason else "")
    elif reason:
        status = "locked" if alive else "ended"
        next_hint = reason
    else:
        status = "available"
        next_hint = "Новий розділ доступний"
    return {
        **PET_STORY_ARC,
        "summary": _narrative_text(PET_STORY_ARC.get("summary"), profile),
        "status": status,
        "chapter_number": next_scene["chapter"] if next_scene else PET_STORY_ARC["total_chapters"],
        "completed_count": completed_count,
        "progress": round(100 * completed_count / PET_STORY_ARC["total_chapters"]),
        "personality": personality,
        "badge": story.get("badge"),
        "ending": story.get("ending"),
        "current_scene": current_scene,
        "resolved_today": resolved_today,
        "next_hint": next_hint,
    }


def _event_requirements_met(profile: dict, event: dict) -> bool:
    requirements = event.get("requires") or {}
    if requirements.get("weather") and pet_life.weather(profile, _now())["id"] != requirements["weather"]:
        return False
    stats = profile.get("stats") or {}
    survival = profile.get("survival") or {}
    inventory = profile.get("inventory") or {}
    for key, stat in (("mood_lte", "mood"), ("cleanliness_lte", "cleanliness")):
        if key in requirements and _safe_int(stats.get(stat), 100) > _safe_int(requirements[key], 100):
            return False
    if "energy_gte" in requirements and _safe_int(stats.get("energy"), 0) < _safe_int(requirements["energy_gte"], 0):
        return False
    if requirements.get("mood_state") and survival.get("mood_state") != requirements["mood_state"]:
        return False
    recent_foods = survival.get("recent_foods") if isinstance(survival.get("recent_foods"), list) else []
    if requirements.get("repeated_food") and not (len(recent_foods) >= 2 and recent_foods[-1] == recent_foods[-2]):
        return False
    equipped = inventory.get("equipped") if isinstance(inventory.get("equipped"), dict) else {}
    if any(equipped.get(slot) != item_id for slot, item_id in (requirements.get("equipped") or {}).items()):
        return False
    flags = set((profile.get("story") or {}).get("flags") or [])
    if any(flag not in flags for flag in requirements.get("flags", [])):
        return False
    return True


def _select_daily_event_id(profile: dict) -> Optional[str]:
    survival = profile.get("survival") or {}
    if survival.get("status", "alive") != "alive" or survival.get("condition") in {"sick", "critical"}:
        return None
    eligible = [event for event in PET_DAILY_EVENTS if _event_requirements_met(profile, event)]
    if not eligible:
        return None
    recent = set(((profile.get("story") or {}).get("recent_event_ids") or [])[-7:])
    fresh = [event for event in eligible if event["id"] not in recent]
    if fresh:
        eligible = fresh
    path = _dominant_story_path(profile)
    weighted = []
    for event in eligible:
        weight = max(1, _safe_int(event.get("weight"), 1, 1)) + (3 if path and path in event.get("tags", []) else 0)
        weighted.append((event, weight))
    total = sum(weight for _, weight in weighted)
    roll = _stable_int(profile.get("user_id"), _date_key(), survival.get("generation", 1), "daily-event-v3") % total
    for event, weight in weighted:
        if roll < weight:
            return event["id"]
        roll -= weight
    return weighted[-1][0]["id"]


def _ensure_daily_event_offer(profile: dict) -> bool:
    daily = profile.setdefault("daily", {})
    if daily.get("event_offered"):
        return False
    daily["event_offered"] = True
    daily["event_id"] = None if daily.get("event_resolved") else _select_daily_event_id(profile)
    return True


def _room_item(item_id: str) -> Optional[dict]:
    return next((item for item in PET_ITEMS if item["id"] == item_id), None)


def _room_slot(item: dict) -> Optional[str]:
    room = item.get("room") or {}
    return room.get("slot") or item.get("slot")


def _movable_room(item: Optional[dict]) -> Optional[dict]:
    room = (item or {}).get("room") or {}
    if room.get("attach_to") or not room.get("move_bounds"):
        return None
    if not all(key in room for key in ("asset", "x", "y", "width", "z_index")):
        return None
    return room


def _canonical_room_position(room: dict, x: object, y: object) -> Optional[dict]:
    if isinstance(x, bool) or isinstance(y, bool):
        return None
    try:
        raw_x = float(x)
        raw_y = float(y)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(raw_x) or not math.isfinite(raw_y):
        return None
    bounds = room.get("move_bounds") or {}
    if not (
        bounds.get("min_x", 0) <= raw_x <= bounds.get("max_x", 100)
        and bounds.get("min_y", 0) <= raw_y <= bounds.get("max_y", 100)
    ):
        return None

    # The client presents a 2% grid, while the server keeps a little precision
    # for future editors and imports. Only x/y ever enter the profile.
    canonical_x = round(raw_x, 2)
    canonical_y = round(raw_y, 2)

    def compact(value: float):
        rounded = round(value, 2)
        return int(rounded) if rounded.is_integer() else rounded

    return {"x": compact(canonical_x), "y": compact(canonical_y)}


def _sanitized_room_layout(profile: dict) -> dict:
    stored = profile.get("room_layout")
    if not isinstance(stored, dict):
        return {}
    owned = set((profile.get("inventory") or {}).get("items") or [])
    clean = {}
    for item_id, position in stored.items():
        item = _room_item(str(item_id))
        room = _movable_room(item)
        if not item or item["id"] not in owned or not room or not isinstance(position, dict):
            continue
        canonical = _canonical_room_position(room, position.get("x"), position.get("y"))
        if canonical and canonical != {"x": room["x"], "y": room["y"]}:
            clean[item["id"]] = canonical
    return clean


def _level_from_xp(xp: int) -> int:
    return min(PET_MAX_LEVEL, max(1, 1 + max(0, int(xp)) // 80))


def _fresh_daily() -> dict:
    return {
        "date": _date_key(),
        "care_actions": [],
        "rejected_actions": [],
        "last_action": None,
        "last_action_at": None,
        "combo": None,
        "intent": None,
        "focus_used": False,
        "focus_kind": None,
        "ritual_complete": False,
        "gift_claimed": False,
        "gift_reward": None,
        "minigame_rewarded": False,
        "minigame_reward_session_id": None,
        "event_resolved": False,
        "event_offered": False,
        "event_id": None,
        "event_result": None,
        "story_resolved": False,
        "story_result": None,
        "narrative_pose": None,
        "narrative_reaction_at": None,
        "photo_taken": False,
        "adoption_day": False,
    }


def _new_survival(now: Optional[datetime] = None, generation: int = 1) -> dict:
    current = (now or _now()).astimezone(timezone.utc)
    return {
        "version": PET_SURVIVAL_VERSION,
        "generation": _safe_int(generation, 1, 1),
        "status": "alive",
        "condition": "healthy",
        "illness": None,
        "mood_state": "content",
        "grace_until": (current + timedelta(hours=PET_SURVIVAL_GRACE_HOURS)).isoformat(),
        "neglect_hours": 0.0,
        "runaway_hours": 0.0,
        "runaway_hours_remaining": None,
        "critical_since": None,
        "ended_at": None,
        "end_reason": None,
        "last_pet_at": None,
        "touch_cooldown_until": None,
        "recent_foods": [],
        "recent_toys": [],
        "adopted_at": None,
        "adoption_from_status": None,
        "adoption_command_id": None,
        "weekend_protected": current.astimezone(KYIV_TZ).weekday() >= 5,
        "warning": None,
    }


def _ensure_survival(profile: dict, now: datetime) -> tuple[dict, bool, bool]:
    """Backfill the v2 state and report (state, changed, migrated).

    A legacy profile starts its strict clock *now*. This is an intentional
    migration barrier: time accumulated under the gentler v1 rules can never
    make an existing cat ill, missing, or dead on the first v2 request.
    """
    changed = False
    migrated = False
    stats = profile.setdefault("stats", {})
    for key, fallback in (("satiety", 72), ("mood", 78), ("energy", 76), ("health", 100), ("cleanliness", 90)):
        normalized = _clamp(_finite_number(stats.get(key), fallback))
        if stats.get(key) != normalized:
            stats[key] = normalized
            changed = True

    survival = profile.get("survival")
    if not isinstance(survival, dict):
        survival = _new_survival(now)
        profile["survival"] = survival
        profile["last_decay_at"] = now.isoformat()
        changed = True
        migrated = True
    else:
        generation = _safe_int(survival.get("generation"), 1, 1)
        if survival.get("generation") != generation:
            survival["generation"] = generation
            changed = True
        # A future version migration must preserve terminal state, timers and
        # illness. Only profiles with no survival document receive a new grace
        # period and a reset clock.
        if survival.get("version") != PET_SURVIVAL_VERSION:
            survival["version"] = PET_SURVIVAL_VERSION
            changed = True
        defaults = _new_survival(now, generation)
        defaults["grace_until"] = None
        for key, value in defaults.items():
            if key not in survival:
                survival[key] = copy.deepcopy(value)
                changed = True
        if survival.get("status") not in {"alive", "runaway", "dead"}:
            survival["status"] = "alive"
            changed = True
        if survival.get("condition") not in {"healthy", "unhappy", "neglected", "sick", "critical"}:
            survival["condition"] = "healthy"
            changed = True
        for key in ("recent_foods", "recent_toys"):
            values = survival.get(key)
            clean_values = [str(value)[:40] for value in values[-3:]] if isinstance(values, list) else []
            if values != clean_values:
                survival[key] = clean_values
                changed = True

    exact = survival.get("needs_exact")
    if not isinstance(exact, dict):
        exact = {}
        survival["needs_exact"] = exact
        changed = True
    for key, fallback in (("satiety", 72), ("mood", 78), ("energy", 76), ("health", 100), ("cleanliness", 90)):
        normalized = max(0.0, min(100.0, _finite_number(exact.get(key), stats.get(key, fallback))))
        if exact.get(key) != normalized:
            exact[key] = normalized
            changed = True

    grace_until = _parse_iso(survival.get("grace_until"))
    max_grace = now + timedelta(hours=PET_SURVIVAL_GRACE_HOURS)
    if survival.get("grace_until") and not grace_until:
        survival["grace_until"] = None
        changed = True
    elif grace_until and grace_until > max_grace:
        survival["grace_until"] = max_grace.isoformat()
        changed = True

    if profile.get("rules_version") != PET_RULES_VERSION:
        profile["rules_version"] = PET_RULES_VERSION
        changed = True
    return survival, changed, migrated


def _update_survival_condition(profile: dict, now: Optional[datetime] = None) -> None:
    current = (now or _now()).astimezone(timezone.utc)
    stats = profile.setdefault("stats", {})
    survival = profile.setdefault("survival", _new_survival(current))
    status = survival.get("status", "alive")
    survival["weekend_protected"] = current.astimezone(KYIV_TZ).weekday() >= 5

    if status == "alive" and _safe_int(stats.get("health"), 100) <= 0:
        status = "dead"
        survival["status"] = "dead"
        survival["ended_at"] = survival.get("ended_at") or current.isoformat()
        survival["end_reason"] = "health_depleted"
    if status in {"dead", "runaway"}:
        expedition = profile.get("expedition")
        if expedition and expedition.get("status") in {"active", "ready"}:
            expedition["status"] = "cancelled"
            expedition["cancelled_at"] = survival.get("ended_at") or current.isoformat()
            expedition["cancel_reason"] = status
            expedition.pop("outcome", None)

    if status == "dead":
        survival["condition"] = "critical"
        survival["mood_state"] = "gone"
        survival["warning"] = {
            "severity": "terminal",
            "title": "Котик помер",
            "message": "Здоров'я впало до нуля через тривале фізичне занедбання.",
        }
        survival["runaway_hours_remaining"] = None
        return
    if status == "runaway":
        survival["condition"] = "critical"
        survival["mood_state"] = "gone"
        survival["warning"] = {
            "severity": "terminal",
            "title": "Котик пішов",
            "message": "Довіра надто довго залишалася на нулі.",
        }
        survival["runaway_hours_remaining"] = 0
        return

    health = _safe_int(stats.get("health"), 100)
    satiety = _safe_int(stats.get("satiety"), 0)
    mood = _safe_int(stats.get("mood"), 0)
    cleanliness = _safe_int(stats.get("cleanliness"), 0)
    trust = _safe_int(profile.get("trust"), 0)
    runaway_hours = max(0.0, _finite_number(survival.get("runaway_hours"), 0))

    if health <= 25 or satiety <= 5 or (trust <= 0 and runaway_hours >= 6):
        condition = "critical"
    elif survival.get("illness"):
        condition = "sick"
    elif min(satiety, mood, cleanliness) < 25 or trust <= 3:
        condition = "neglected"
    elif min(satiety, mood, cleanliness, health) < 50 or trust < 6:
        condition = "unhappy"
    else:
        condition = "healthy"
    survival["condition"] = condition

    cooldown = _parse_iso(survival.get("touch_cooldown_until"))
    reaction_until = _parse_iso(survival.get("reaction_until"))
    if cooldown and current < cooldown:
        mood_state = "do_not_touch"
    elif reaction_until and current < reaction_until and survival.get("reaction"):
        mood_state = str(survival["reaction"])
    elif survival.get("illness") or mood < 25:
        mood_state = "do_not_touch"
    elif _safe_int(stats.get("energy"), 0) < 25:
        mood_state = "exhausted"
    elif len(survival.get("recent_foods") or []) >= 3 and len(set(survival["recent_foods"][-3:])) == 1:
        mood_state = "picky"
    else:
        mood_state = "content"
    survival["mood_state"] = mood_state

    at_runaway_risk = trust <= 0 and (satiety <= 10 or mood <= 35)
    survival["runaway_hours_remaining"] = round(max(0.0, PET_RUNAWAY_WARNING_HOURS - runaway_hours), 1) if at_runaway_risk else None
    if condition == "critical":
        survival["critical_since"] = survival.get("critical_since") or current.isoformat()
        message = "Негайно нагодуйте, вилікуйте або заспокойте котика — наслідки можуть стати незворотними."
        if at_runaway_risk:
            message = f"Довіра на нулі. Котик може піти приблизно через {survival['runaway_hours_remaining']:g} год."
        survival["warning"] = {"severity": "critical", "title": "Критичний стан", "message": message}
    elif condition == "sick":
        survival["critical_since"] = None
        survival["warning"] = {"severity": "danger", "title": "Котик захворів", "message": "Потрібні лікування та чиста кімната."}
    elif condition == "neglected":
        survival["critical_since"] = None
        survival["warning"] = {"severity": "warning", "title": "Ознаки занедбання", "message": "Одна з базових потреб уже небезпечно низька."}
    elif condition == "unhappy":
        survival["critical_since"] = None
        survival["warning"] = {"severity": "notice", "title": "Потрібна увага", "message": "Подбайте про потреби котика, поки стан не погіршився."}
    else:
        survival["critical_since"] = None
        survival["warning"] = None


def _hours_below(start_value: float, rate: float, threshold: float, elapsed: float) -> float:
    if elapsed <= 0 or rate <= 0:
        return 0.0
    crossing = max(0.0, (start_value - threshold) / rate)
    return max(0.0, elapsed - crossing)


def _apply_survival_decay(profile: dict, previous: datetime, now: datetime) -> tuple[bool, datetime]:
    survival = profile["survival"]
    if survival.get("status") != "alive":
        return False, now
    grace_until = _parse_iso(survival.get("grace_until"))
    decay_start = max(previous, grace_until) if grace_until else previous
    available_hours = _survival_decay_hours(decay_start, now)
    hours = float(math.floor(available_hours + 1e-9))
    if hours < 1:
        _update_survival_condition(profile, now)
        return False, decay_start if decay_start > previous else previous

    stats = profile["stats"]
    exact = survival.setdefault("needs_exact", {key: float(value) for key, value in stats.items()})
    for key, fallback in (("satiety", 72), ("mood", 78), ("energy", 76), ("health", 100), ("cleanliness", 90)):
        exact[key] = max(0.0, min(100.0, _finite_number(exact.get(key), stats.get(key, fallback))))

    # Hour-sized deterministic integration means opening the app every hour and
    # opening it once after several days produce the same state. Exact floats
    # are persisted privately; public meters remain compact rounded integers.
    remaining = hours
    processed = 0.0
    while remaining > 1e-9 and survival.get("status") == "alive":
        step = min(1.0, remaining)
        remaining -= step
        processed += step
        step_time = _survival_time_after_hours(decay_start, now, processed)
        old_satiety = exact["satiety"]
        old_mood = exact["mood"]
        old_cleanliness = exact["cleanliness"]
        exact["satiety"] = max(0.0, old_satiety - step)
        exact["mood"] = max(0.0, old_mood - step * 0.65)
        exact["cleanliness"] = max(0.0, old_cleanliness - step * 0.55)
        asleep_hours = sleep_overlap_hours(profile, step_time - timedelta(hours=step), step_time)
        exact["energy"] = min(100.0, exact["energy"] + max(0, step - asleep_hours) * 1.4)
        settle_sleep(profile, step_time)

        starvation_hours = _hours_below(old_satiety, 1.0, 0, step)
        filthy_hours = _hours_below(old_cleanliness, 0.55, 10, step)
        health_loss = starvation_hours * 3.0 + filthy_hours * 1.2
        if survival.get("illness"):
            health_loss += step * 0.75
        exact["health"] = max(0.0, exact["health"] - health_loss)

        emotional_hours = max(
            _hours_below(old_satiety, 1.0, 20, step),
            _hours_below(old_mood, 0.65, 20, step),
        )
        neglect_total = max(0.0, _finite_number(survival.get("neglect_hours"), 0)) + emotional_hours
        trust_loss = int(neglect_total // 3)
        survival["neglect_hours"] = round(neglect_total - trust_loss * 3, 4)
        if trust_loss:
            profile["trust"] = max(0, _safe_int(profile.get("trust"), 0) - trust_loss)

        for key in ("satiety", "mood", "energy", "health", "cleanliness"):
            stats[key] = _clamp(exact[key])

        if not survival.get("illness"):
            if exact["cleanliness"] <= 18:
                survival["illness"] = "infection"
            elif exact["health"] <= 60 and exact["satiety"] <= 25:
                survival["illness"] = "weakness"

        at_runaway_risk = _safe_int(profile.get("trust"), 0) <= 0 and (exact["satiety"] <= 10 or exact["mood"] <= 35)
        runaway_hours = max(0.0, _finite_number(survival.get("runaway_hours"), 0))
        survival["runaway_hours"] = round(
            runaway_hours + step if at_runaway_risk else max(0.0, runaway_hours - step * 2),
            4,
        )

        if stats["health"] <= 0:
            survival["status"] = "dead"
            survival["ended_at"] = step_time.isoformat()
            survival["end_reason"] = "health_depleted"
        elif survival["runaway_hours"] >= PET_RUNAWAY_WARNING_HOURS:
            survival["status"] = "runaway"
            survival["ended_at"] = step_time.isoformat()
            survival["end_reason"] = "trust_depleted"
        _update_survival_condition(profile, step_time)
        if isinstance(profile.get("life"), dict):
            pet_life.resolve_pending(profile, step_time)

    if survival.get("status") in {"runaway", "dead"}:
        expedition = profile.get("expedition")
        if expedition and expedition.get("status") in {"active", "ready"}:
            expedition["status"] = "cancelled"
            expedition["cancelled_at"] = survival.get("ended_at") or now.isoformat()
            expedition["cancel_reason"] = survival["status"]
            expedition.pop("outcome", None)

    _update_survival_condition(profile, now)
    cursor = now if survival.get("status") != "alive" else _survival_time_after_hours(decay_start, now, hours)
    return True, cursor


def _require_alive(profile: dict) -> None:
    status = (profile.get("survival") or {}).get("status", "alive")
    if status == "dead":
        raise HTTPException(status_code=409, detail="Котик помер. Прихистіть нового котика, щоб почати спочатку")
    if status == "runaway":
        raise HTTPException(status_code=409, detail="Котик пішов. Прихистіть нового котика, щоб почати спочатку")


def _require_care_context(profile: dict, body: PetCareBody) -> None:
    # Old clients may omit both fields. New gesture clients always send both.
    if body.date_key is not None or body.generation is not None:
        if body.date_key != _date_key() or body.generation != profile["survival"]["generation"]:
            raise HTTPException(409, "Турбота застаріла. Оновіть кімнату")
    if (profile.get("expedition") or {}).get("status") == "active":
        raise HTTPException(409, "Котик ще в експедиції")


def _new_profile(user: dict) -> dict:
    seed = _stable_int(user["id"], "preferences")
    foods = ["fish", "balanced", "crunchy"]
    toys = ["wand", "ball", "puzzle"]
    now = _now()
    ts = now.isoformat()
    return {
        "id": f"pet-{user['id']}",
        "user_id": user["id"],
        "name": "Піксель",
        "appearance_id": "orange-tabby-v1",
        "rules_version": PET_RULES_VERSION,
        "stats": {"satiety": 72, "mood": 78, "energy": 76, "health": 100, "cleanliness": 90},
        "survival": _new_survival(now),
        "trust": 6,
        "friendship_xp": 0,
        "friendship_level": 1,
        "active_days": 0,
        "care_streak": 0,
        "last_ritual_date": None,
        "traits": {"curiosity": 1, "affection": 1, "intelligence": 1},
        "preferences": {"food": foods[seed % len(foods)], "toy": toys[(seed // 5) % len(toys)]},
        "story": _new_story(1),
        "life": pet_life.new_life(1),
        "inventory": {
            "materials": {"cardboard": 2, "string": 1, "fabric": 1, "feather": 0, "leaf": 0},
            "items": ["bed-basic", "bowl-amber", "toy-wand", "wall-neon"],
            "equipped": copy.deepcopy(DEFAULT_EQUIPPED),
        },
        "room_layout": {},
        "tricks": {key: {"mastery": 0, "practices": 0, "mastered_at": None} for key in PET_TRICKS},
        "weekly_project": {"id": "cardboard-fort", "name": "Картонна фортеця", "week": _week_key(), "progress": 0, "goal": 3, "completed": False},
        "reward_deck": {"cycle": 0, "cursor": 0, "cards": _reward_deck(user["id"], 0)},
        "reward_budget": {"month": datetime.now(KYIV_TZ).strftime("%Y-%m"), "points": 0},
        "applied_commands": [],
        "applied_minigame_reward_keys": [],
        "daily": _fresh_daily(),
        "expedition": None,
        "last_decay_at": ts,
        "revision": 1,
        "created_at": ts,
        "updated_at": ts,
    }


def _advance_profile(original: dict) -> tuple[dict, bool]:
    profile = copy.deepcopy(original)
    changed = False
    now = _now()

    if not isinstance(profile.get("stats"), dict):
        profile["stats"] = {}
        changed = True

    if not isinstance(profile.get("daily"), dict):
        profile["daily"] = _fresh_daily()
        changed = True
    elif profile["daily"].get("date") != _date_key():
        profile["daily"] = _fresh_daily()
        changed = True

    daily = profile["daily"]
    for key, default in _fresh_daily().items():
        if key not in daily:
            daily[key] = copy.deepcopy(default)
            changed = True
    if not isinstance(daily.get("care_actions"), list):
        daily["care_actions"] = []
        changed = True
    if "last_action_at" not in daily:
        daily["last_action_at"] = None
        changed = True
    if not isinstance(daily.get("rejected_actions"), list):
        daily["rejected_actions"] = []
        changed = True
    if "adoption_day" not in daily:
        daily["adoption_day"] = False
        changed = True

    survival, survival_changed, migrated = _ensure_survival(profile, now)
    changed = changed or survival_changed

    if not isinstance(profile.get("inventory"), dict):
        profile["inventory"] = {}
        changed = True
    inventory = profile["inventory"]
    items = inventory.get("items")
    if not isinstance(items, list):
        inventory["items"] = []
        changed = True
    else:
        clean_items = list(dict.fromkeys(str(item_id) for item_id in items if isinstance(item_id, str) and item_id))
        if clean_items != items:
            inventory["items"] = clean_items
            changed = True
    materials = inventory.get("materials")
    if not isinstance(materials, dict):
        materials = {}
        inventory["materials"] = materials
        changed = True
    # One-time, lossless retirement of the old photo currency.
    if "photo" in materials:
        materials["leaf"] = _safe_int(materials.get("leaf"), 0, 0) + _safe_int(materials.pop("photo"), 0, 0)
        changed = True
    for material in MATERIAL_NAMES:
        amount = _safe_int(materials.get(material), 0, 0)
        if materials.get(material) != amount:
            materials[material] = amount
            changed = True
    equipped = inventory.get("equipped")
    for item_id in DEFAULT_EQUIPPED.values():
        if item_id and item_id not in inventory["items"]:
            inventory["items"].append(item_id)
            changed = True
    if not isinstance(equipped, dict):
        equipped = {}
        inventory["equipped"] = equipped
        changed = True
    for slot, item_id in list(equipped.items()):
        if slot == "collar" or item_id in {"collar-violet", "camera-retro"}:
            equipped.pop(slot, None)
            changed = True
    for slot, item_id in DEFAULT_EQUIPPED.items():
        if slot not in equipped:
            equipped[slot] = item_id
            changed = True
    if "expedition" in equipped:
        equipped.pop("expedition", None)
        changed = True

    room_layout = _sanitized_room_layout(profile)
    if profile.get("room_layout") != room_layout:
        profile["room_layout"] = room_layout
        changed = True

    reward_deck = profile.get("reward_deck")
    if not isinstance(reward_deck, dict):
        reward_deck = {}
    if not isinstance(reward_deck.get("cards"), list) or not reward_deck.get("cards"):
        cycle = _safe_int(reward_deck.get("cycle"), 0, 0)
        profile["reward_deck"] = {"cycle": cycle, "cursor": 0, "cards": _reward_deck(profile["user_id"], cycle)}
        changed = True

    if not isinstance(profile.get("applied_commands"), list):
        profile["applied_commands"] = []
        changed = True

    month_key = datetime.now(KYIV_TZ).strftime("%Y-%m")
    reward_budget = profile.get("reward_budget")
    if not isinstance(reward_budget, dict) or reward_budget.get("month") != month_key:
        profile["reward_budget"] = {"month": month_key, "points": 0}
        changed = True

    project = profile.get("weekly_project")
    if not isinstance(project, dict):
        project = {}
    if project.get("week") != _week_key():
        carry = 0 if project.get("completed") else min(2, int(project.get("progress") or 0))
        profile["weekly_project"] = {"id": "cardboard-fort", "name": "Картонна фортеця", "week": _week_key(), "progress": carry, "goal": 3, "completed": False}
        changed = True

    previous = _parse_iso(profile.get("last_decay_at"))
    if pet_life.ensure_life(profile, now):
        changed = True
    if previous is None or previous > now:
        previous = now
        if profile.get("last_decay_at") != now.isoformat():
            profile["last_decay_at"] = now.isoformat()
            changed = True
    elapsed_hours = max(0, int((now - previous).total_seconds() // 3600))
    if elapsed_hours and not migrated:
        before_survival = copy.deepcopy(survival)
        before_stats = copy.deepcopy(profile.get("stats"))
        before_trust = profile.get("trust")
        _, decay_cursor = _apply_survival_decay(profile, previous, now)
        if decay_cursor > previous:
            profile["last_decay_at"] = decay_cursor.isoformat()
        if before_survival != survival or before_stats != profile.get("stats") or before_trust != profile.get("trust"):
            changed = True
        if decay_cursor > previous:
            changed = True
    else:
        before_survival = copy.deepcopy(survival)
        _update_survival_condition(profile, now)
        if before_survival != survival:
            changed = True

    if settle_sleep(profile, now):
        changed = True
    if pet_life.advance_life(profile, now):
        changed = True
        _update_survival_condition(profile, now)
    if _ensure_story(profile):
        changed = True
    if _ensure_daily_event_offer(profile):
        changed = True

    expedition = profile.get("expedition")
    if expedition and expedition.get("status") == "active":
        ends_at = _parse_iso(expedition.get("ends_at"))
        if ends_at and now >= ends_at:
            expedition["status"] = "ready"
            changed = True

    profile["friendship_level"] = _level_from_xp(profile.get("friendship_xp", 0))
    return profile, changed


def _current_request(profile: dict) -> dict:
    stats = profile.get("stats", {})
    daily = profile.get("daily", {})
    survival = profile.get("survival") or {}
    if survival.get("status") in {"runaway", "dead"}:
        return {"id": "adopt", "title": "Ця історія завершилася", "action": "Прихистити нового котика", "hotspot": None}
    if survival.get("illness") and "heal" not in daily.get("care_actions", []):
        return {"id": "heal", "title": f"{profile['name']} захворів і потребує лікування", "action": "Лікувати", "hotspot": "cat"}
    if stats.get("cleanliness", 100) < 40 and "clean" not in daily.get("care_actions", []):
        return {"id": "clean", "title": "У кімнаті вже небезпечно брудно", "action": "Прибрати", "hotspot": "bowl"}
    if stats.get("satiety", 100) < 55 and "feed" not in daily.get("care_actions", []):
        return {"id": "feed", "title": f"{profile['name']} не проти перекусити", "action": "Пригостити", "hotspot": "bowl"}
    if stats.get("energy", 100) < 42 and "rest" not in daily.get("care_actions", []):
        return {"id": "rest", "title": f"{profile['name']} шукає затишне місце", "action": "Вкласти спати", "hotspot": "bed"}
    if survival.get("mood_state") == "do_not_touch" and "rest" not in daily.get("care_actions", []):
        return {"id": "rest", "title": f"{profile['name']} зараз хоче побути наодинці", "action": "Дати спокій", "hotspot": "bed"}
    personality = _pet_personality(profile).get("id")
    if personality == "companion" and "pet" not in daily.get("care_actions", []):
        return {"id": "pet", "title": f"{profile['name']} хоче тихо посидіти поруч", "action": "Погладити", "hotspot": "cat"}
    if personality == "thinker" and "play" not in daily.get("care_actions", []):
        return {"id": "play", "title": "Хочеться розібрати нову головоломку", "action": "Почати гру", "hotspot": "toy"}
    if personality == "explorer" and "play" not in daily.get("care_actions", []):
        return {"id": "play", "title": f"{profile['name']} уже шукає новий слід", "action": "Почати гру", "hotspot": "toy"}
    if "play" not in daily.get("care_actions", []):
        return {"id": "play", "title": "Хочеться погратися з вудочкою", "action": "Почати гру", "hotspot": "toy"}
    if "pet" not in daily.get("care_actions", []):
        return {"id": "pet", "title": "Саме час трохи помуркотіти", "action": "Погладити", "hotspot": "cat"}
    return {"id": "pet", "title": "Сьогодні все чудово", "action": "До котика", "hotspot": "cat"}


def _daily_event(profile: dict) -> Optional[dict]:
    if profile.get("daily", {}).get("event_resolved") or (profile.get("survival") or {}).get("status") != "alive":
        return None
    daily = profile.get("daily") or {}
    event_id = daily.get("event_id") if daily.get("event_offered") else _select_daily_event_id(profile)
    event = next((item for item in PET_DAILY_EVENTS if item["id"] == event_id), None)
    if not event:
        return None
    return {
        "id": event["id"],
        "title": event["title"],
        "text": _narrative_text(event.get("text"), profile),
        "hotspot": event.get("hotspot"),
        "category": "random",
        "choices": [_public_narrative_choice(profile, choice) for choice in event.get("choices", [])],
    }


def _public_profile(profile: dict) -> dict:
    clean = copy.deepcopy(profile)
    clean.pop("_id", None)
    clean.pop("reward_deck", None)
    clean.pop("reward_budget", None)
    clean.pop("applied_commands", None)
    clean.pop("applied_minigame_reward_keys", None)
    clean.pop("life", None)
    story = profile.get("story") if isinstance(profile.get("story"), dict) else _new_story(
        _safe_int((profile.get("survival") or {}).get("generation"), 1, 1)
    )
    clean["story"] = {
        "version": story.get("version", PET_STORY_VERSION),
        "arc_id": story.get("arc_id", PET_STORY_ARC["id"]),
        "completed_scenes": list(story.get("completed_scenes") or []),
        "decisions": copy.deepcopy(story.get("decisions") or {}),
        "ending": story.get("ending"),
        "badge": story.get("badge"),
    }
    clean["personality"] = _pet_personality(profile)
    if isinstance(clean.get("survival"), dict):
        clean["survival"].pop("needs_exact", None)
        clean["survival"].pop("adoption_command_id", None)
    expedition = clean.get("expedition")
    if expedition:
        expedition.pop("outcome", None)
    return clean


def _public_minigame_challenge(challenge: object) -> dict:
    """Allow-list playable challenge fields so a bad stored row cannot leak an answer key."""
    if not isinstance(challenge, dict):
        return {}
    kind = str(challenge.get("kind") or "")
    timing = {
        key: _safe_int(challenge.get(key), 0, 0)
        for key in ("duration_ms", "min_duration_ms")
        if key in challenge
    }
    if kind == "sequence":
        cues = challenge.get("cues") if isinstance(challenge.get("cues"), list) else []
        return {
            "kind": kind,
            "palette_size": _safe_int(challenge.get("palette_size"), 4, 2),
            "cues": [_safe_int(value, 0, 0) for value in cues[:32]],
            "cue_ms": _safe_int(challenge.get("cue_ms"), 520, 1),
            **timing,
        }
    if kind == "timed-targets":
        targets = []
        raw_targets = challenge.get("targets") if isinstance(challenge.get("targets"), list) else []
        for target in raw_targets[:64]:
            if not isinstance(target, dict):
                continue
            targets.append({
                "id": _safe_int(target.get("id"), 0, 0),
                "lane": _safe_int(target.get("lane"), 0, 0),
                "at_ms": _safe_int(target.get("at_ms"), 0, 0),
                "window_ms": _safe_int(target.get("window_ms"), 420, 1),
            })
        return {
            "kind": kind,
            "lanes": _safe_int(challenge.get("lanes"), 4, 1),
            "targets": targets,
            **timing,
        }
    if kind == "sorting":
        raw_lanes = challenge.get("lanes") if isinstance(challenge.get("lanes"), list) else []
        raw_cards = challenge.get("cards") if isinstance(challenge.get("cards"), list) else []
        lanes = [
            {"id": _safe_int(lane.get("id"), index, 0), "label": str(lane.get("label") or "")}
            for index, lane in enumerate(raw_lanes[:4])
            if isinstance(lane, dict)
        ]
        cards = [
            {
                "id": _safe_int(card.get("id"), index, 0),
                "label": str(card.get("label") or ""),
                "icon": str(card.get("icon") or "package"),
            }
            for index, card in enumerate(raw_cards[:32])
            if isinstance(card, dict)
        ]
        return {"kind": kind, "lanes": lanes, "cards": cards, **timing}
    return {"kind": kind or "unsupported"}


def _public_session(session: dict) -> dict:
    clean = copy.deepcopy(session)
    clean.pop("_id", None)
    clean.pop("purge_at", None)
    challenge = clean.pop("challenge", None)
    legacy_sequence = clean.pop("sequence", None)
    if "public_challenge" not in clean and legacy_sequence is not None:
        clean["public_challenge"] = {
            "kind": "sequence",
            "palette_size": 4,
            "cues": list(legacy_sequence),
            "cue_ms": 520,
            "min_duration_ms": 0,
        }
    clean["public_challenge"] = _public_minigame_challenge(clean.get("public_challenge"))
    if clean.get("status") == "completed":
        if isinstance(challenge, dict):
            clean["review"] = _challenge_review(challenge)
        elif legacy_sequence is not None:
            clean["review"] = {"kind": "sequence", "solution": list(legacy_sequence)}
    expires_at = _parse_iso(clean.get("expires_at"))
    if expires_at:
        clean["expires_at"] = expires_at.isoformat()
    return clean


def _snapshot(profile: dict, recent_journal: Optional[list[dict]] = None) -> dict:
    daily = profile.get("daily", {})
    care_count = len(daily.get("care_actions", []))
    alive = (profile.get("survival") or {}).get("status", "alive") == "alive"
    return {
        "server_time": _now_iso(),
        "date_key": _date_key(),
        "rules_version": PET_RULES_VERSION,
        "pet": _public_profile(profile),
        "request": _current_request(profile),
        "gift": {
            "available": bool(alive and daily.get("ritual_complete") and profile.get("trust", 0) >= 10 and not daily.get("gift_claimed")),
            "claimed": bool(daily.get("gift_claimed")),
            "reward": daily.get("gift_reward"),
            "ritual_progress": min(2, care_count),
            "ritual_goal": 2,
        },
        "daily_event": _daily_event(profile),
        "story": _story_status(profile),
        "life": pet_life.public_life(profile, _now()),
        "care_availability": public_care_availability(profile, _now()),
        "catalog": {
            "items": pet_life.shop_catalog(PET_ITEMS),
            "room": PET_ROOM_SCENE,
            "expeditions": list(PET_EXPEDITIONS.values()),
            "tricks": list(PET_TRICKS.values()),
            "games": PET_GAMES,
            "materials": MATERIAL_NAMES,
            "loadout": [
                {"id": "backpack", "name": "Рюкзачок", "description": "Додатковий звичайний матеріал"},
                {"id": "bell", "name": "Дзвіночок", "description": "Більше сюжетних зустрічей"},
                {"id": "blanket", "name": "Плед", "description": "Більше енергії після повернення"},
            ],
        },
        "recent_journal": recent_journal or [],
        "storage": {"artwork": "static-pwa-assets", "mongo_blobs": False},
    }


async def _record_event(db, user_id: str, kind: str, title: str, text: str, data: Optional[dict] = None, source_key: Optional[str] = None, important: bool = False) -> dict:
    event_id = source_key or str(uuid.uuid4())
    doc = {
        "id": event_id,
        "user_id": user_id,
        "kind": kind,
        "title": title,
        "text": text,
        "data": data or {},
        "important": important,
        "occurred_at": _now_iso(),
        "expires_at": None if important else _now() + timedelta(days=180),
    }
    try:
        await db.pet_events.insert_one(doc)
    except DuplicateKeyError:
        existing = await db.pet_events.find_one({"id": event_id, "user_id": user_id}, {"_id": 0})
        return existing or {**doc, "_id": None}
    doc.pop("_id", None)
    return doc


async def _recent_events(db, user_id: str, limit: int = 8) -> list[dict]:
    return await db.pet_events.find({"user_id": user_id}, {"_id": 0, "expires_at": 0}).sort("occurred_at", -1).to_list(limit)


async def _reconcile_terminal_milestone(db, user_id: str, profile: dict) -> None:
    """Idempotently repair the journal side effect of a terminal profile CAS."""
    survival = profile.get("survival") or {}
    status = survival.get("status")
    if status not in {"runaway", "dead"}:
        return
    if status == "dead":
        title = "Котик помер"
        text = "Через тривале фізичне занедбання здоров'я котика впало до нуля."
    else:
        title = "Котик пішов"
        text = "Довіра надто довго була на нулі, і котик залишив кімнату."
    await _record_event(
        db,
        user_id,
        "milestone",
        title,
        text,
        {"status": status, "reason": survival.get("end_reason")},
        source_key=f"pet-terminal:{user_id}:{_safe_int(survival.get('generation'), 1, 1)}",
        important=True,
    )


async def _load_profile(db, user: dict) -> dict:
    for _ in range(4):
        profile = await db.pet_profiles.find_one({"user_id": user["id"]}, {"_id": 0})
        if not profile:
            candidate = _new_profile(user)
            try:
                await db.pet_profiles.insert_one(copy.deepcopy(candidate))
                await _record_event(
                    db,
                    user["id"],
                    "milestone",
                    "Перша зустріч",
                    f"Ви познайомилися з котом на ім'я {candidate['name']}.",
                    {"level": 1},
                    source_key=f"pet-created:{user['id']}",
                    important=True,
                )
                return candidate
            except DuplicateKeyError:
                continue
        advanced, changed = _advance_profile(profile)
        if not changed:
            await _reconcile_terminal_milestone(db, user["id"], advanced)
            return advanced
        expected = _safe_int(profile.get("revision"), 1, 1)
        advanced["revision"] = expected + 1
        advanced["updated_at"] = _now_iso()
        result = await db.pet_profiles.replace_one({"user_id": user["id"], "revision": expected}, advanced)
        if result.modified_count:
            await _reconcile_terminal_milestone(db, user["id"], advanced)
            return advanced
    raise HTTPException(status_code=409, detail="Стан кота оновився. Спробуйте ще раз")


async def _save_profile(db, profile: dict, expected_revision: int) -> bool:
    replacement = copy.deepcopy(profile)
    replacement.pop("_id", None)
    replacement["revision"] = expected_revision + 1
    replacement["updated_at"] = _now_iso()
    result = await db.pet_profiles.replace_one(
        {"user_id": replacement["user_id"], "revision": expected_revision},
        replacement,
    )
    if result.modified_count:
        profile.clear()
        profile.update(replacement)
        return True
    return False


def _apply_stat(profile: dict, key: str, delta: int) -> None:
    stats = profile.setdefault("stats", {})
    survival = profile.get("survival")
    exact = survival.setdefault("needs_exact", {}) if isinstance(survival, dict) else None
    base = _finite_number(exact.get(key), stats.get(key, 0)) if exact is not None else _finite_number(stats.get(key), 0)
    value = max(0.0, min(100.0, base + _finite_number(delta, 0)))
    if exact is not None:
        exact[key] = value
    stats[key] = _clamp(value)


NARRATIVE_STAT_LABELS = {
    "satiety": "Ситість",
    "mood": "Настрій",
    "energy": "Енергія",
    "health": "Здоров’я",
    "cleanliness": "Чистота",
}
NARRATIVE_TRAIT_LABELS = {
    "curiosity": "Допитливість",
    "intelligence": "Кмітливість",
    "affection": "Лагідність",
}
NARRATIVE_FOOD_LABELS = {"fish": "рибка", "balanced": "збалансований корм", "crunchy": "хрусткий корм"}
NARRATIVE_TOY_LABELS = {"wand": "вудочка", "ball": "м’ячик", "puzzle": "головоломка"}


def _delta_impact(label: str, delta: int, kind: str = "stat") -> dict:
    sign = "+" if delta > 0 else "−"
    return {"label": f"{label} {sign}{abs(delta)}", "tone": "positive" if delta > 0 else "cost", "kind": kind}


def _apply_narrative_effects(profile: dict, effects: dict) -> list[dict]:
    """Apply an authored, server-owned choice and return its actual visible deltas."""
    applied: list[dict] = []
    for key, delta in (effects.get("stats") or {}).items():
        if key not in NARRATIVE_STAT_LABELS:
            continue
        before = _safe_int((profile.get("stats") or {}).get(key), 0)
        _apply_stat(profile, key, _safe_int(delta, 0))
        actual = _safe_int((profile.get("stats") or {}).get(key), before) - before
        if actual:
            applied.append(_delta_impact(NARRATIVE_STAT_LABELS[key], actual))

    if "trust" in effects:
        before = _safe_int(profile.get("trust"), 0, 0)
        profile["trust"] = max(0, min(20, before + _safe_int(effects.get("trust"), 0)))
        actual = profile["trust"] - before
        if actual:
            applied.append(_delta_impact("Довіра", actual, "trust"))

    traits = profile.setdefault("traits", {})
    for key, delta in (effects.get("traits") or {}).items():
        if key not in NARRATIVE_TRAIT_LABELS:
            continue
        before = _safe_int(traits.get(key), 0, 0)
        traits[key] = max(0, min(100, before + _safe_int(delta, 0)))
        actual = traits[key] - before
        if actual:
            applied.append(_delta_impact(NARRATIVE_TRAIT_LABELS[key], actual, "trait"))

    materials = profile.setdefault("inventory", {}).setdefault("materials", {})
    for key, delta in (effects.get("materials") or {}).items():
        if key not in MATERIAL_NAMES:
            continue
        before = _safe_int(materials.get(key), 0, 0)
        materials[key] = max(0, min(999, before + _safe_int(delta, 0)))
        actual = materials[key] - before
        if actual:
            applied.append(_delta_impact(MATERIAL_NAMES[key], actual, "material"))

    story = profile.setdefault("story", _new_story(_safe_int((profile.get("survival") or {}).get("generation"), 1, 1)))
    scores = story.setdefault("path_scores", {key: 0 for key in STORY_PATHS})
    path_effects = effects.get("path") or {}
    had_ending = story.get("ending") in STORY_PATHS
    for key, delta in path_effects.items():
        if key not in STORY_PATHS:
            continue
        before = _safe_int(scores.get(key), 0, 0)
        scores[key] = max(0, min(100, before + _safe_int(delta, 0)))
        actual = scores[key] - before
        if actual:
            applied.append(_delta_impact(f"Шлях «{STORY_PATHS[key]['short_label']}»", actual, "story"))

    chosen_paths = [key for key, delta in path_effects.items() if key in STORY_PATHS and _safe_int(delta, 0) > 0]
    if had_ending and chosen_paths:
        chosen_path = max(chosen_paths, key=lambda key: _safe_int(path_effects.get(key), 0))
        current_temperament = story.get("temperament") or story.get("ending")
        if chosen_path == current_temperament:
            story["recent_path_choices"] = []
        else:
            recent = story.get("recent_path_choices") if isinstance(story.get("recent_path_choices"), list) else []
            story["recent_path_choices"] = ([*recent, chosen_path] if recent and recent[-1] == chosen_path else [chosen_path])[-5:]
            if len(story["recent_path_choices"]) >= 5:
                story["temperament"] = chosen_path
                story["recent_path_choices"] = []
                applied.append({
                    "label": f"Характер змінився: {STORY_PATHS[chosen_path]['short_label']}",
                    "tone": "story",
                    "kind": "temperament",
                })

    flags = list(story.get("flags") or [])
    for flag in effects.get("flags_clear") or []:
        flags = [existing for existing in flags if existing != flag]
    for flag in effects.get("flags_add") or []:
        normalized = str(flag)[:80]
        if normalized and normalized not in flags:
            flags.append(normalized)
    story["flags"] = flags[-32:]

    preferences = profile.setdefault("preferences", {})
    preference_effects = effects.get("preference") or {}
    food = preference_effects.get("food")
    if food in NARRATIVE_FOOD_LABELS:
        preferences["food"] = food
        applied.append({"label": f"Улюблена їжа: {NARRATIVE_FOOD_LABELS[food]}", "tone": "story", "kind": "preference"})
    toy = preference_effects.get("toy")
    if toy in NARRATIVE_TOY_LABELS:
        preferences["toy"] = toy
        applied.append({"label": f"Улюблена іграшка: {NARRATIVE_TOY_LABELS[toy]}", "tone": "story", "kind": "preference"})

    survival = profile.get("survival")
    if not isinstance(survival, dict):
        survival = _new_survival(_now(), 1)
        profile["survival"] = survival
    survival_effects = effects.get("survival") or {}
    if survival_effects.get("clear_recent_foods"):
        survival["recent_foods"] = []
        if survival.get("reaction") == "picky":
            survival["reaction"] = None
            survival["reaction_until"] = None
        applied.append({"label": "Вередливість минула", "tone": "positive", "kind": "condition"})
    reaction = survival_effects.get("reaction")
    if reaction in {"do_not_touch", "picky", "bored", "exhausted"}:
        reaction_hours = min(12, max(1, _safe_int(survival_effects.get("reaction_hours"), 2, 1)))
        survival["reaction"] = reaction
        survival["reaction_until"] = (_now() + timedelta(hours=reaction_hours)).isoformat()
        reaction_label = {
            "do_not_touch": "Не хоче дотиків",
            "picky": "Вередує",
            "bored": "Нудьгує",
            "exhausted": "Виснажений",
        }[reaction]
        applied.append({"label": f"{reaction_label} {reaction_hours} год", "tone": "risk", "kind": "condition"})
    if survival_effects.get("touch_cooldown_hours"):
        cooldown_hours = min(12, max(1, _safe_int(survival_effects.get("touch_cooldown_hours"), 2, 1)))
        survival["touch_cooldown_until"] = (_now() + timedelta(hours=cooldown_hours)).isoformat()

    equipped = profile.setdefault("inventory", {}).setdefault("equipped", {})
    for slot in effects.get("unequip") or []:
        if slot in DEFAULT_EQUIPPED and equipped.get(slot) is not None:
            equipped[slot] = None
            applied.append({"label": "Нашийник знято" if slot == "collar" else "Предмет повернуто до колекції", "tone": "story", "kind": "room"})

    xp = max(0, _safe_int(effects.get("xp"), 0, 0))
    if xp:
        profile["friendship_xp"] = _safe_int(profile.get("friendship_xp"), 0, 0) + xp
        applied.append({"label": f"Дружба +{xp} XP", "tone": "positive", "kind": "xp"})
    ending = effects.get("ending")
    if ending in STORY_PATHS:
        story["ending"] = ending
    badge = effects.get("badge")
    if isinstance(badge, str) and badge:
        story["badge"] = badge[:80]

    _apply_progress(profile)
    _update_survival_condition(profile)
    return applied


def _choice_result(profile: dict, source: str, subject: dict, choice: dict, applied: list[dict]) -> dict:
    outcome = choice.get("outcome") or {}
    return {
        "source": source,
        "id": subject["id"],
        "choice_id": choice["id"],
        "choice_label": choice["label"],
        "title": _narrative_text(outcome.get("title") or "Вибір збережено", profile),
        "text": _narrative_text(outcome.get("text"), profile),
        "reaction_text": _narrative_text(outcome.get("reaction_text"), profile),
        "pose": outcome.get("pose") if outcome.get("pose") in {"sit", "sleep", "eat", "play"} else "sit",
        "impact": applied,
        "next_hint": _narrative_text(outcome.get("next_hint"), profile),
        "resolved_at": _now_iso(),
    }


def _apply_progress(profile: dict) -> None:
    previous = int(profile.get("friendship_level", 1))
    profile["friendship_level"] = _level_from_xp(profile.get("friendship_xp", 0))
    if profile["friendship_level"] > previous:
        profile["last_level_up"] = profile["friendship_level"]


def _command_marker(profile: dict, command_id: str) -> Optional[dict]:
    return next(
        (marker for marker in profile.get("applied_commands", []) if marker.get("id") == command_id),
        None,
    )


def _mark_command_applied(profile: dict, command: dict, kind: str, result: dict) -> dict:
    marker = {
        "id": command["id"],
        "kind": kind,
        "result": copy.deepcopy(result),
        "applied_at": _now_iso(),
    }
    markers = [
        existing
        for existing in profile.setdefault("applied_commands", [])
        if existing.get("id") != command["id"]
    ]
    markers.append(marker)
    profile["applied_commands"] = markers[-64:]
    return marker


async def seed_pet_v1(db) -> None:
    await db.pet_social.create_index("id", unique=True)
    await db.pet_social.create_index("purge_at", expireAfterSeconds=0)
    await db.pet_social.create_index([("sender", 1), ("created_at", -1)])
    await db.pet_social.create_index([("target", 1), ("created_at", -1)])
    await db.pet_profiles.create_index("user_id", unique=True)
    await db.pet_events.create_index("id", unique=True)
    await db.pet_events.create_index([("user_id", 1), ("occurred_at", -1), ("id", -1)])
    await db.pet_events.create_index([("user_id", 1), ("kind", 1), ("occurred_at", -1), ("id", -1)])
    await db.pet_events.create_index("expires_at", expireAfterSeconds=0)
    await db.pet_minigame_sessions.create_index("id", unique=True)
    await db.pet_minigame_sessions.update_many(
        {"status": "active", "expires_at": {"$lte": _now()}},
        {"$set": {"status": "expired", "completed_at": _now_iso()}},
    )
    duplicate_groups = await db.pet_minigame_sessions.aggregate([
        {"$match": {"status": "active"}},
        {"$sort": {"started_at": -1}},
        {"$group": {
            "_id": {"user_id": "$user_id", "game_id": "$game_id"},
            "session_ids": {"$push": "$id"},
            "count": {"$sum": 1},
        }},
        {"$match": {"count": {"$gt": 1}}},
    ]).to_list(5000)
    for group in duplicate_groups:
        stale_ids = (group.get("session_ids") or [])[1:]
        if stale_ids:
            await db.pet_minigame_sessions.update_many(
                {"id": {"$in": stale_ids}, "status": "active"},
                {"$set": {"status": "expired", "completed_at": _now_iso()}},
            )
    await db.pet_minigame_sessions.create_index(
        [("user_id", 1), ("game_id", 1)],
        unique=True,
        partialFilterExpression={"status": "active"},
        name="one_active_pet_game_per_kind",
    )
    # Completed sessions remain replayable for seven days so a lost response can
    # be retried. Older builds used ``expires_at`` as TTL and could erase the
    # idempotency record minutes after a game ended.
    index_info = await db.pet_minigame_sessions.index_information()
    for index_name, index in index_info.items():
        if index.get("key") == [("expires_at", 1)] and "expireAfterSeconds" in index:
            try:
                await db.pet_minigame_sessions.drop_index(index_name)
            except OperationFailure:
                refreshed = await db.pet_minigame_sessions.index_information()
                if index_name in refreshed:
                    raise
    await db.pet_minigame_sessions.update_many(
        {"purge_at": {"$exists": False}},
        {"$set": {"purge_at": _now() + timedelta(days=7)}},
    )
    await db.pet_minigame_sessions.create_index("purge_at", expireAfterSeconds=0)
    await db.pet_reward_claims.create_index("id", unique=True)
    await db.pet_commands.create_index("id", unique=True)
    await db.pet_commands.create_index("expires_at", expireAfterSeconds=0)


def register_pet_routes(
    api,
    db,
    get_current_user: Callable[..., Awaitable[dict]],
    notify_points_awarded: Callable[[str, int, str], Awaitable[None]],
) -> None:
    register_life_routes(api, db, get_current_user, sys.modules[__name__])
    register_play_routes(api, db, get_current_user, sys.modules[__name__])
    def command_identity(user_id: str, key: str, payload: dict) -> tuple[str, str, str]:
        normalized = str(key or "").strip()
        if len(normalized) < 8 or len(normalized) > 160:
            raise HTTPException(status_code=400, detail="Некоректний Idempotency-Key")
        request_hash = hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()
        command_id = hashlib.sha256(f"{user_id}:{normalized}".encode("utf-8")).hexdigest()
        return normalized, request_hash, command_id

    async def find_command(user_id: str, key: str, payload: dict) -> Optional[dict]:
        _, request_hash, command_id = command_identity(user_id, key, payload)
        existing = await db.pet_commands.find_one({"id": command_id, "user_id": user_id}, {"_id": 0})
        if existing and existing.get("request_hash") != request_hash:
            raise HTTPException(status_code=409, detail="Idempotency-Key уже використано для іншої дії")
        return existing

    async def reserve_command(user_id: str, key: str, payload: dict) -> dict:
        _, request_hash, command_id = command_identity(user_id, key, payload)
        doc = {
            "id": command_id,
            "user_id": user_id,
            "request_hash": request_hash,
            "status": "processing",
            "created_at": _now_iso(),
            "expires_at": _now() + timedelta(days=7),
        }
        try:
            await db.pet_commands.insert_one(copy.deepcopy(doc))
            return doc
        except DuplicateKeyError:
            existing = await db.pet_commands.find_one({"id": command_id, "user_id": user_id}, {"_id": 0})
            if not existing or existing.get("request_hash") != request_hash:
                raise HTTPException(status_code=409, detail="Idempotency-Key уже використано для іншої дії")
            return existing

    async def complete_command(command: dict, event_id: Optional[str] = None, result: Optional[dict] = None) -> None:
        updates = {"status": "completed", "completed_at": _now_iso(), "event_id": event_id}
        if result is not None:
            updates["result"] = result
        await db.pet_commands.update_one(
            {"id": command["id"]},
            {"$set": updates},
        )

    async def apply_point_gift(user: dict, profile: dict, reward: dict, reward_date: Optional[str] = None) -> bool:
        """Idempotently finish the economic side of an already-decided gift.

        The pet profile is saved first, so retries can safely repair a partial
        Mongo write without rolling the gift or crediting the wallet twice.
        """
        if reward.get("type") != "points":
            return False
        reward_date = reward_date or profile.get("daily", {}).get("date") or _date_key()
        reward_key = f"pet-gift:{user['id']}:{reward_date}"
        claim = {
            "id": reward_key,
            "user_id": user["id"],
            "kind": "points",
            "date": reward_date,
            "amount": int(reward["amount"]),
            "created_at": _now_iso(),
        }
        await db.pet_reward_claims.update_one(
            {"id": reward_key},
            {"$setOnInsert": claim},
            upsert=True,
        )
        applied = await db.users.update_one(
            {"id": user["id"], "pet_applied_reward_keys": {"$ne": reward_key}},
            {
                "$inc": {
                    "balance": int(reward["amount"]),
                    "total_earned": int(reward["amount"]),
                    "pet_reward_points_total": int(reward["amount"]),
                },
                "$addToSet": {"pet_applied_reward_keys": reward_key},
            },
        )
        await db.transactions.update_one(
            {"_id": reward_key},
            {"$setOnInsert": {
                "_id": reward_key,
                "id": reward_key,
                "user_id": user["id"],
                "kind": "pet_gift",
                "amount": int(reward["amount"]),
                "description": f"Подарунок від {profile['name']}: {reward['title']}",
                "created_at": _now_iso(),
                "meta": {"source": "pet", "date": reward_date},
            }},
            upsert=True,
        )
        await db.pet_reward_claims.update_one(
            {"id": reward_key},
            {"$set": {"applied_at": _now_iso(), "ledger_written": True}},
        )
        if applied.modified_count:
            try:
                await notify_points_awarded(user["id"], int(reward["amount"]), f"Подарунок від {profile['name']}")
            except Exception:
                # Notification delivery must never roll back an already guarded wallet credit.
                pass
        return bool(applied.modified_count)

    async def settle_minigame_reward(user: dict, session: dict) -> bool:
        score = int(session.get("score") or 0)
        if score < 50:
            return False
        if session.get("status") != "completed":
            raise HTTPException(status_code=409, detail="Гру ще не завершено")
        preflight_profile = await _load_profile(db, user)
        current_generation = _safe_int((preflight_profile.get("survival") or {}).get("generation"), 1, 1)
        if _safe_int(session.get("pet_generation"), 1, 1) != current_generation:
            raise HTTPException(status_code=409, detail="Ця гра належить попередньому котику")
        started_at = _parse_iso(session.get("started_at")) or _now()
        reward_date = started_at.astimezone(KYIV_TZ).strftime("%Y-%m-%d")
        reward_key = f"pet-game:{user['id']}:{reward_date}"
        await db.pet_reward_claims.update_one(
            {"id": reward_key},
            {"$setOnInsert": {
                "id": reward_key,
                "user_id": user["id"],
                "kind": "minigame",
                "date": reward_date,
                "session_id": session["id"],
                "created_at": _now_iso(),
            }},
            upsert=True,
        )
        claim = await db.pet_reward_claims.find_one({"id": reward_key, "user_id": user["id"]}, {"_id": 0})
        if not claim or claim.get("session_id") != session["id"]:
            return False

        for _ in range(4):
            profile = await _load_profile(db, user)
            if _safe_int((profile.get("survival") or {}).get("generation"), 1, 1) != current_generation:
                raise HTTPException(status_code=409, detail="Ця гра належить попередньому котику")
            applied_keys = profile.setdefault("applied_minigame_reward_keys", [])
            if reward_key not in applied_keys:
                daily = profile.setdefault("daily", _fresh_daily())
                if daily.get("date") == reward_date and daily.get("minigame_rewarded"):
                    previous_session = daily.get("minigame_reward_session_id")
                    if previous_session and previous_session != session["id"]:
                        return False
                expected = profile["revision"]
                profile["trust"] = min(20, int(profile.get("trust", 0)) + 3)
                profile["friendship_xp"] = int(profile.get("friendship_xp", 0)) + 6
                pet_life.ensure_life(profile, _now())
                pet_life.gain_skill(profile, "hunter" if session.get("game_id") == "laser" else "thinker", 5)
                materials = profile.setdefault("inventory", {}).setdefault("materials", {})
                materials["feather"] = int(materials.get("feather", 0)) + 1
                if daily.get("date") == reward_date:
                    daily["minigame_rewarded"] = True
                    daily["minigame_reward_session_id"] = session["id"]
                applied_keys.append(reward_key)
                profile["applied_minigame_reward_keys"] = applied_keys[-40:]
                _apply_progress(profile)
                if not await _save_profile(db, profile, expected):
                    continue

            event = await _record_event(
                db,
                user["id"],
                "game",
                "Котяча гра",
                f"Результат — {score}%. {profile['name']} отримав +3 довіри.",
                {"game_id": session.get("game_id"), "score": score},
                source_key=f"pet-game-event:{reward_key}",
            )
            await db.pet_reward_claims.update_one(
                {"id": reward_key},
                {"$set": {"applied_at": _now_iso(), "event_id": event.get("id")}},
            )
            return True
        raise HTTPException(status_code=409, detail="Нагорода гри ще зберігається. Повторіть спробу")

    @api.get("/pet")
    async def get_pet(user: dict = Depends(get_current_user)):
        profile = await _load_profile(db, user)
        return _snapshot(profile, await _recent_events(db, user["id"]))

    @api.patch("/pet")
    async def rename_pet(body: PetRenameBody, user: dict = Depends(get_current_user)):
        name = " ".join(body.name.strip().split())
        if len(name) < 2:
            raise HTTPException(status_code=400, detail="Ім'я має містити щонайменше 2 символи")
        for _ in range(3):
            profile = await _load_profile(db, user)
            _require_alive(profile)
            if profile.get("name") == name:
                return {
                    **_snapshot(profile, await _recent_events(db, user["id"])),
                    "idempotent": True,
                    "message": "Це ім'я вже збережено",
                }
            expected = profile["revision"]
            old_name = profile["name"]
            profile["name"] = name
            if await _save_profile(db, profile, expected):
                await _record_event(db, user["id"], "discovery", "Нове ім'я", f"{old_name} тепер відгукується на ім'я {name}.")
                return _snapshot(profile, await _recent_events(db, user["id"]))
        raise HTTPException(status_code=409, detail="Не вдалося зберегти ім'я")

    @api.post("/pet/adopt")
    async def adopt_new_pet(
        user: dict = Depends(get_current_user),
        idempotency_key: str = Header(default="", alias="Idempotency-Key"),
    ):
        """Start a new relationship after a terminal outcome.

        Room ownership is account-level and therefore survives. Friendship,
        learned tricks, streaks, needs, and temperament history belong to the
        individual cat and deliberately start over.
        """
        normalized_key = str(idempotency_key or "").strip()
        if normalized_key and (len(normalized_key) < 8 or len(normalized_key) > 160):
            raise HTTPException(status_code=400, detail="Некоректний Idempotency-Key")
        adoption_command_id = hashlib.sha256(f"{user['id']}:{normalized_key}".encode("utf-8")).hexdigest() if normalized_key else None

        async def reconcile_adoption(profile: dict) -> None:
            survival = profile.get("survival") or {}
            generation = _safe_int(survival.get("generation"), 1, 1)
            adopted_at = _parse_iso(survival.get("adopted_at")) or _now()
            await db.pet_minigame_sessions.update_many(
                {"user_id": user["id"], "status": "active", "pet_generation": {"$ne": generation}},
                {"$set": {"status": "expired", "completed_at": adopted_at.isoformat(), "expired_reason": "new_pet_generation"}},
            )
            await _record_event(
                db,
                user["id"],
                "milestone",
                "Новий початок",
                f"У кімнаті оселився новий котик. Це покоління №{generation}.",
                {"generation": generation, "previous_status": survival.get("adoption_from_status")},
                source_key=f"pet-adopted:{user['id']}:{generation}",
                important=True,
            )

        for _ in range(3):
            profile = await _load_profile(db, user)
            previous_survival = profile.get("survival") or {}
            previous_status = previous_survival.get("status", "alive")
            if previous_status == "alive":
                if adoption_command_id and previous_survival.get("adoption_command_id") == adoption_command_id:
                    await reconcile_adoption(profile)
                    return {
                        **_snapshot(profile, await _recent_events(db, user["id"])),
                        "idempotent": True,
                        "message": "Новий котик уже вдома.",
                    }
                raise HTTPException(status_code=409, detail="Ваш котик уже вдома")

            expected = profile["revision"]
            generation = _safe_int(previous_survival.get("generation"), 1, 1) + 1
            now = _now()
            seed = _stable_int(user["id"], generation, "preferences")
            foods = ["fish", "balanced", "crunchy"]
            toys = ["wand", "ball", "puzzle"]
            profile["stats"] = {"satiety": 72, "mood": 78, "energy": 76, "health": 100, "cleanliness": 90}
            profile["survival"] = _new_survival(now, generation)
            profile["survival"]["adopted_at"] = now.isoformat()
            profile["survival"]["adoption_from_status"] = previous_status
            profile["survival"]["adoption_command_id"] = adoption_command_id
            profile["trust"] = 6
            profile["friendship_xp"] = 0
            profile["friendship_level"] = 1
            profile["active_days"] = 0
            profile["care_streak"] = 0
            profile["last_ritual_date"] = None
            profile["traits"] = {"curiosity": 1, "affection": 1, "intelligence": 1}
            profile["preferences"] = {"food": foods[seed % len(foods)], "toy": toys[(seed // 5) % len(toys)]}
            profile["story"] = _new_story(generation)
            profile["life"] = pet_life.new_life(generation, profile.get("life"))
            profile["tricks"] = {key: {"mastery": 0, "practices": 0, "mastered_at": None} for key in PET_TRICKS}
            profile["daily"] = _fresh_daily()
            # A fresh cat can receive care immediately, but a same-day adoption
            # cannot reroll the economic rewards/focus already available to the
            # account. These locks disappear with the normal daily rollover.
            profile["daily"].update({
                "adoption_day": True,
                "focus_used": True,
                "focus_kind": "adoption",
                "gift_claimed": True,
                "minigame_rewarded": True,
                "event_resolved": True,
                "event_offered": True,
                "story_resolved": True,
                "photo_taken": True,
            })
            profile["expedition"] = None
            profile["weekly_project"] = {
                "id": "cardboard-fort",
                "name": "Картонна фортеця",
                "week": _week_key(),
                "progress": 0,
                "goal": 3,
                "completed": False,
            }
            profile["last_decay_at"] = now.isoformat()
            profile["rules_version"] = PET_RULES_VERSION
            profile.pop("last_level_up", None)
            if await _save_profile(db, profile, expected):
                await reconcile_adoption(profile)
                return {
                    **_snapshot(profile, await _recent_events(db, user["id"])),
                    "message": "Новий котик уже вдома. Почніть будувати довіру спочатку.",
                }
        raise HTTPException(status_code=409, detail="Не вдалося завершити прихисток")

    @api.post("/pet/intent")
    async def choose_intent(body: PetIntentBody, user: dict = Depends(get_current_user)):
        for _ in range(3):
            profile = await _load_profile(db, user)
            _require_alive(profile)
            if profile["daily"].get("focus_used"):
                raise HTTPException(status_code=409, detail="Фокус дня вже використано")
            expected = profile["revision"]
            profile["daily"]["intent"] = body.intent
            if await _save_profile(db, profile, expected):
                labels = {"explore": "досліджувати", "learn": "навчатися", "build": "облаштовувати кімнату"}
                return {**_snapshot(profile), "message": f"Сьогодні ви вирішили {labels[body.intent]}."}
        raise HTTPException(status_code=409, detail="Стан змінився. Повторіть вибір")

    @api.post("/pet/care")
    async def care_for_pet(
        body: PetCareBody,
        user: dict = Depends(get_current_user),
        idempotency_key: str = Header(default="", alias="Idempotency-Key"),
    ):
        effects = {
            "feed": {
                "balanced": {"satiety": 25, "mood": 2, "energy": 0, "cleanliness": -4},
                "fish": {"satiety": 18, "mood": 8, "energy": -5, "cleanliness": -5},
                "crunchy": {"satiety": 30, "mood": 1, "energy": 0, "cleanliness": -3},
                "treat": {"satiety": 12, "mood": 15, "energy": 0, "cleanliness": -4},
            },
            "pet": {"default": {"satiety": 0, "mood": 12, "energy": 2, "cleanliness": 0}},
            "play": {
                "wand": {"satiety": -3, "mood": 20, "energy": -14, "cleanliness": -2},
                "ball": {"satiety": -3, "mood": 24, "energy": -18, "cleanliness": -3},
                "puzzle": {"satiety": -2, "mood": 14, "energy": -10, "cleanliness": -2},
            },
            "rest": {"default": {"satiety": -2, "mood": 5, "energy": 0, "cleanliness": -1}},
            "clean": {"default": {"satiety": 0, "mood": 3, "energy": -3, "cleanliness": 55}},
            "heal": {"default": {"satiety": 0, "mood": -3, "energy": -6, "health": 40, "cleanliness": 8}},
        }
        action_titles = {
            "feed": "Смачний перекус",
            "pet": "Час муркотіння",
            "play": "Весела гра",
            "rest": "Затишний відпочинок",
            "clean": "Чиста кімната",
            "heal": "Турботливе лікування",
        }
        option = body.option or ({"feed": "balanced", "play": "wand"}.get(body.action, "default"))
        selected = effects[body.action].get(option)
        if not selected:
            raise HTTPException(status_code=400, detail="Цей варіант дії недоступний")
        command_payload = {"kind": "care", "action": body.action, "option": option}
        if body.zone != "head":
            command_payload["zone"] = body.zone
        _require_care_context(await _load_profile(db, user), body)
        command = await find_command(user["id"], idempotency_key, command_payload)
        if not command:
            preflight_profile = await _load_profile(db, user)
            _require_alive(preflight_profile)
            command = await reserve_command(user["id"], idempotency_key, command_payload)
        if command.get("status") == "completed":
            profile = await _load_profile(db, user)
            saved = command.get("result") or {}
            saved_action = saved.get("action")
            saved_date = saved.get("date")
            if saved_action in action_titles and saved_date:
                await _record_event(
                    db,
                    user["id"],
                    "care",
                    action_titles[saved_action],
                    f"Турботу про {profile['name']} зараховано.",
                    {"action": saved_action, "option": saved.get("option"), "combo": saved.get("combo")},
                    source_key=f"pet-care:{user['id']}:{saved_date}:{saved_action}",
                )
            response = _snapshot(profile, await _recent_events(db, user["id"]))
            response.update({**saved, "idempotent": True, "message": "Цю дію вже оброблено"})
            return response

        for _ in range(4):
            profile = await _load_profile(db, user)
            daily = profile["daily"]
            _require_care_context(profile, body)
            marker = _command_marker(profile, command["id"])
            if marker:
                saved = marker.get("result") or {}
                saved_action = saved.get("action", body.action)
                saved_date = saved.get("date", daily["date"])
                source = f"pet-care:{user['id']}:{saved_date}:{saved_action}"
                await complete_command(command, source, saved)
                await _record_event(
                    db,
                    user["id"],
                    "care",
                    action_titles.get(saved_action, action_titles[body.action]),
                    f"Турботу про {profile['name']} зараховано.",
                    {"action": saved_action, "option": saved.get("option", option), "combo": saved.get("combo")},
                    source_key=source,
                )
                response = _snapshot(profile, await _recent_events(db, user["id"]))
                response.update({**saved, "idempotent": True, "message": "Цю дію вже оброблено"})
                return response
            _require_alive(profile)
            if body.action in daily.get("care_actions", []) or body.action in daily.get("rejected_actions", []):
                source = f"pet-care:{user['id']}:{daily['date']}:{body.action}"
                saved = {
                    "date": daily["date"],
                    "action": body.action,
                    "option": option,
                    "combo": None,
                    "trust_gained": 0,
                    "ritual_completed": False,
                }
                expected = profile["revision"]
                _mark_command_applied(profile, command, "care", saved)
                if not await _save_profile(db, profile, expected):
                    continue
                await complete_command(command, source, saved)
                await _record_event(
                    db,
                    user["id"],
                    "care",
                    action_titles[body.action],
                    f"Турботу про {profile['name']} зараховано.",
                    {"action": body.action, "option": option, "combo": daily.get("combo")},
                    source_key=source,
                )
                return {**_snapshot(profile, await _recent_events(db, user["id"])), "idempotent": True, "message": "Цю турботу вже зараховано сьогодні"}
            refusal = care_refusal(profile, body.action, option, _now(), body.zone)
            if refusal and not (body.action == "pet" and refusal["reaction"] == "refuse"):
                expected = profile["revision"]
                saved = {"interaction": refusal, "accepted": False, "message": refusal["message"]}
                _mark_command_applied(profile, command, "care", saved)
                if not await _save_profile(db, profile, expected):
                    continue
                await complete_command(command, result=saved)
                return {**_snapshot(profile), **saved}
            if body.action == "heal" and not profile.get("survival", {}).get("illness") and profile["stats"].get("health", 100) >= 75:
                raise HTTPException(status_code=409, detail=f"{profile['name']} зараз не потребує лікування")

            if body.action == "pet" and refusal:
                expected = profile["revision"]
                _apply_stat(profile, "mood", -7)
                profile["trust"] = max(0, int(profile.get("trust", 0)) - 2)
                daily.setdefault("rejected_actions", []).append("pet")
                daily["last_action"] = "pet-rejected"
                daily["last_action_at"] = _now_iso()
                survival = profile["survival"]
                survival["last_pet_at"] = _now_iso()
                survival["touch_cooldown_until"] = (_now() + timedelta(hours=2)).isoformat()
                survival["reaction"] = "do_not_touch"
                survival["reaction_until"] = survival["touch_cooldown_until"]
                pet_life.record_care(profile, "pet", option, _now(), rejected=True)
                _update_survival_condition(profile)
                saved = {
                    "date": daily["date"],
                    "action": "pet",
                    "option": option,
                    "combo": None,
                    "trust_gained": -2,
                    "ritual_completed": False,
                    "reaction": "do_not_touch",
                    "rejected": True,
                    "interaction": refusal,
                }
                _mark_command_applied(profile, command, "care", saved)
                if not await _save_profile(db, profile, expected):
                    continue
                source = f"pet-care:{user['id']}:{daily['date']}:pet"
                await complete_command(command, source, saved)
                await _record_event(
                    db,
                    user["id"],
                    "care",
                    "Не чіпай мене",
                    f"{profile['name']} відсторонився: зараз йому потрібні тиша, їжа або лікування.",
                    {"action": "pet", "reaction": "do_not_touch"},
                    source_key=source,
                )
                response = _snapshot(profile, await _recent_events(db, user["id"]))
                response.update({"effects": {"mood": -7}, **saved, "idempotent": False})
                return response

            expected = profile["revision"]
            previous_action = daily.get("last_action")
            care_before_stats = copy.deepcopy(profile["stats"])
            applied_effects = copy.deepcopy(selected)
            if body.action == "pet":
                applied_effects["mood"] = {"head": 12, "back": 9, "belly": 14}[body.zone]
            if body.action == "rest":
                start_sleep(profile, _now())
            elif sleeping(profile, _now()) and body.action in {"feed", "heal"}:
                wake_sleep(profile, _now(), urgent=True)
            survival = profile["survival"]
            reaction = None
            if body.action == "feed":
                recent = survival.setdefault("recent_foods", [])
                if len(recent) >= 2 and recent[-2:] == [option, option]:
                    applied_effects["satiety"] = max(3, round(applied_effects.get("satiety", 0) * 0.25))
                    applied_effects["mood"] = -6
                    reaction = "picky"
                elif option == profile.get("preferences", {}).get("food"):
                    applied_effects["mood"] = applied_effects.get("mood", 0) + 3
                recent.append(option)
                survival["recent_foods"] = recent[-3:]
            elif body.action == "play":
                recent = survival.setdefault("recent_toys", [])
                if profile["stats"].get("energy", 0) < 30:
                    applied_effects["mood"] = min(4, applied_effects.get("mood", 0))
                    applied_effects["health"] = -6
                    reaction = "exhausted"
                elif len(recent) >= 2 and recent[-2:] == [option, option]:
                    applied_effects["mood"] = max(2, round(applied_effects.get("mood", 0) * 0.25))
                    reaction = "bored"
                recent.append(option)
                survival["recent_toys"] = recent[-3:]

            for stat, delta in applied_effects.items():
                _apply_stat(profile, stat, delta)
            if body.action == "clean":
                pet_life.clear_scene_mess(profile)
            trust_gain = {"feed": 2, "pet": 3, "play": 3, "rest": 1, "clean": 1, "heal": 2}[body.action]
            if reaction in {"picky", "bored", "exhausted"}:
                trust_gain = 0
            elif body.action == "feed" and option == profile.get("preferences", {}).get("food"):
                trust_gain += 1
            profile["trust"] = min(20, int(profile.get("trust", 0)) + trust_gain)
            profile["friendship_xp"] = int(profile.get("friendship_xp", 0)) + 5
            trait = {"feed": "affection", "pet": "affection", "play": "curiosity", "rest": "intelligence", "clean": "intelligence", "heal": "affection"}[body.action]
            profile["traits"][trait] = int(profile["traits"].get(trait, 0)) + 1
            daily.setdefault("care_actions", []).append(body.action)
            daily["last_action"] = body.action
            daily["last_action_at"] = _now_iso()
            if body.action == "pet":
                survival["last_pet_at"] = daily["last_action_at"]
                survival["touch_cooldown_until"] = None
            if body.action == "heal":
                survival["illness"] = None
            recovery = {"feed": 6, "pet": 4, "play": 2, "rest": 2, "clean": 5, "heal": 6}[body.action]
            survival["neglect_hours"] = round(max(0.0, float(survival.get("neglect_hours") or 0) - recovery), 2)
            survival["runaway_hours"] = round(max(0.0, float(survival.get("runaway_hours") or 0) - recovery * 2), 2)
            if reaction:
                survival["reaction"] = reaction
                survival["reaction_until"] = (_now() + timedelta(hours=2)).isoformat()
            else:
                survival["reaction"] = None
                survival["reaction_until"] = None
            _update_survival_condition(profile)

            combo_names = {("play", "pet"): "Затишне завершення", ("feed", "rest"): "Ситий сон", ("pet", "play"): "Взаємна довіра"}
            combo = combo_names.get((previous_action, body.action)) if not daily.get("combo") else None
            if combo:
                daily["combo"] = combo
                profile["trust"] = min(20, profile["trust"] + 2)
                profile["friendship_xp"] += 3

            ritual_just_completed = len(daily["care_actions"]) >= 2 and not daily.get("ritual_complete")
            if ritual_just_completed:
                daily["ritual_complete"] = True
                profile["active_days"] = int(profile.get("active_days", 0)) + 1
                yesterday = (datetime.now(KYIV_TZ).date() - timedelta(days=1)).isoformat()
                profile["care_streak"] = int(profile.get("care_streak", 0)) + 1 if profile.get("last_ritual_date") == yesterday else 1
                profile["last_ritual_date"] = daily["date"]
                profile["trust"] = min(20, profile["trust"] + 2)
                profile["friendship_xp"] += 5

            trust_gained = trust_gain + (2 if combo else 0) + (2 if ritual_just_completed else 0)
            before_routine_trust = profile["trust"]
            routine_note = pet_life.record_care(profile, body.action, option, _now(), reaction=reaction, before_stats=care_before_stats)
            if body.action == "clean":
                pet_life.clear_scene_mess(profile)
            trust_gained += profile["trust"] - before_routine_trust
            _update_survival_condition(profile)
            saved = {
                "date": daily["date"],
                "action": body.action,
                "option": option,
                "combo": combo,
                "trust_gained": trust_gained,
                "life_note": routine_note,
                "ritual_completed": ritual_just_completed,
                "reaction": reaction,
                "rejected": False,
                "zone": body.zone if body.action == "pet" else None,
            }
            _mark_command_applied(profile, command, "care", saved)
            _apply_progress(profile)
            if await _save_profile(db, profile, expected):
                action_text = {
                    "feed": f"Ви пригостили {profile['name']}.",
                    "pet": f"{profile['name']} замуркотів від задоволення.",
                    "play": f"Ви погралися разом.",
                    "rest": f"{profile['name']} влаштувався відпочити.",
                    "clean": "Кімната й миска знову чисті.",
                    "heal": f"{profile['name']} отримав потрібне лікування.",
                }
                source = f"pet-care:{user['id']}:{daily['date']}:{body.action}"
                await complete_command(command, source, saved)
                await _record_event(db, user["id"], "care", action_titles[body.action], action_text[body.action], {"action": body.action, "option": option, "combo": combo}, source_key=source)
                terminal_status = profile.get("survival", {}).get("status")
                if terminal_status in {"dead", "runaway"}:
                    title = "Котик помер" if terminal_status == "dead" else "Котик пішов"
                    terminal_text = (
                        "Здоров'я котика впало до нуля."
                        if terminal_status == "dead"
                        else "Довіра надто довго була на нулі, і котик залишив кімнату."
                    )
                    await _record_event(
                        db,
                        user["id"],
                        "milestone",
                        title,
                        terminal_text,
                        {"status": terminal_status, "reason": profile["survival"].get("end_reason")},
                        source_key=f"pet-terminal:{user['id']}:{profile['survival'].get('generation', 1)}",
                        important=True,
                    )
                response = _snapshot(profile, await _recent_events(db, user["id"]))
                response.update({"effects": applied_effects, **saved, "idempotent": False})
                return response
        raise HTTPException(status_code=409, detail="Кіт уже отримав іншу дію. Оновіть сторінку")

    @api.post("/pet/photo")
    async def take_photo(user: dict = Depends(get_current_user)):
        raise HTTPException(status_code=410, detail="Функцію фото прибрано. Попередні спогади збережено.")

    @api.post("/pet/events/choose")
    async def choose_daily_event(body: PetEventChoiceBody, user: dict = Depends(get_current_user)):
        for _ in range(3):
            profile = await _load_profile(db, user)
            _require_alive(profile)
            daily = profile["daily"]
            generation = _safe_int(profile.get("survival", {}).get("generation"), 1, 1)
            if body.date_key != daily.get("date") or body.generation != generation:
                raise HTTPException(status_code=409, detail="Цей вибір уже застарів. Оновіть сторінку")
            stored_result = daily.get("event_result")
            if daily.get("event_resolved"):
                if not stored_result:
                    return {**_snapshot(profile, await _recent_events(db, user["id"])), "idempotent": True}
                if stored_result.get("id") != body.event_id or stored_result.get("choice_id") != body.choice_id:
                    raise HTTPException(status_code=409, detail="Цю подію вже вирішено іншим вибором")
                await _record_event(
                    db,
                    user["id"],
                    "encounter",
                    stored_result.get("title") or "Випадкова подія",
                    stored_result.get("text") or f"{profile['name']} запам’ятав цей момент.",
                    {"event_id": body.event_id, "choice_id": body.choice_id, "impact": stored_result.get("impact") or []},
                    source_key=f"pet-event:{user['id']}:{daily['date']}",
                )
                return {
                    **_snapshot(profile, await _recent_events(db, user["id"])),
                    "outcome": copy.deepcopy(stored_result),
                    "message": stored_result.get("title") or "Вибір збережено",
                    "idempotent": True,
                }
            current = _daily_event(profile)
            if not current:
                raise HTTPException(status_code=409, detail="Сьогодні немає нової випадкової події")
            if current["id"] != body.event_id:
                raise HTTPException(status_code=409, detail="Подія вже змінилася")
            event_def = next(item for item in PET_DAILY_EVENTS if item["id"] == body.event_id)
            choice = next((item for item in event_def["choices"] if item["id"] == body.choice_id), None)
            if not choice:
                raise HTTPException(status_code=400, detail="Оберіть доступний варіант")
            locked_reason = _choice_locked_reason(profile, choice)
            if locked_reason:
                raise HTTPException(status_code=409, detail=locked_reason)
            expected = profile["revision"]
            applied = _apply_narrative_effects(profile, choice.get("effects") or {})
            pet_life.record_choice(profile, event_def["id"], choice, _now())
            result = _choice_result(profile, "event", event_def, choice, applied)
            daily["event_resolved"] = True
            daily["event_result"] = result
            daily["narrative_pose"] = result["pose"]
            daily["narrative_reaction_at"] = result["resolved_at"]
            story = profile["story"]
            recent = [item for item in story.get("recent_event_ids", []) if item != body.event_id]
            story["recent_event_ids"] = [*recent, body.event_id][-7:]
            if await _save_profile(db, profile, expected):
                await _record_event(
                    db,
                    user["id"],
                    "encounter",
                    result["title"],
                    result["text"],
                    {"event_id": body.event_id, "choice_id": body.choice_id, "impact": applied},
                    source_key=f"pet-event:{user['id']}:{daily['date']}",
                )
                return {
                    **_snapshot(profile, await _recent_events(db, user["id"])),
                    "outcome": result,
                    "message": result["title"],
                    "idempotent": False,
                }
        raise HTTPException(status_code=409, detail="Не вдалося зберегти вибір")

    @api.post("/pet/story/choose")
    async def choose_story_scene(body: PetStoryChoiceBody, user: dict = Depends(get_current_user)):
        for _ in range(3):
            profile = await _load_profile(db, user)
            _require_alive(profile)
            daily = profile["daily"]
            generation = _safe_int(profile.get("survival", {}).get("generation"), 1, 1)
            if body.date_key != daily.get("date") or body.generation != generation:
                raise HTTPException(status_code=409, detail="Цей вибір уже застарів. Оновіть сторінку")
            stored_result = daily.get("story_result")
            if daily.get("story_resolved"):
                if not stored_result:
                    return {**_snapshot(profile, await _recent_events(db, user["id"])), "idempotent": True}
                if stored_result.get("id") != body.scene_id or stored_result.get("choice_id") != body.choice_id:
                    raise HTTPException(status_code=409, detail="Сьогоднішній сюжетний вибір уже зроблено")
                await _record_event(
                    db,
                    user["id"],
                    "story",
                    stored_result.get("title") or "Сюжетний вибір",
                    stored_result.get("text") or f"{profile['name']} запам’ятав цей момент.",
                    {"scene_id": body.scene_id, "choice_id": body.choice_id, "impact": stored_result.get("impact") or []},
                    source_key=f"pet-story:{user['id']}:{profile['survival'].get('generation', 1)}:{body.scene_id}",
                    important=True,
                )
                return {
                    **_snapshot(profile, await _recent_events(db, user["id"])),
                    "outcome": copy.deepcopy(stored_result),
                    "message": stored_result.get("title") or "Вибір збережено",
                    "idempotent": True,
                }

            story_status = _story_status(profile)
            current = story_status.get("current_scene")
            if not current:
                raise HTTPException(status_code=409, detail=story_status.get("next_hint") or "Новий розділ ще не доступний")
            if current["id"] != body.scene_id:
                raise HTTPException(status_code=409, detail="Сюжет уже змінився. Оновіть сторінку")
            scene = next(item for item in PET_STORY_SCENES if item["id"] == body.scene_id)
            choice = next((item for item in scene["choices"] if item["id"] == body.choice_id), None)
            if not choice:
                raise HTTPException(status_code=400, detail="Оберіть доступний варіант")
            locked_reason = _choice_locked_reason(profile, choice)
            if locked_reason:
                raise HTTPException(status_code=409, detail=locked_reason)

            expected = profile["revision"]
            applied = _apply_narrative_effects(profile, choice.get("effects") or {})
            pet_life.record_choice(profile, scene["id"], choice, _now())
            story = profile["story"]
            story.setdefault("completed_scenes", []).append(scene["id"])
            story.setdefault("decisions", {})[scene["id"]] = choice["id"]
            story["last_scene_id"] = scene["id"]
            story["last_choice_at"] = _now_iso()
            result = _choice_result(profile, "story", scene, choice, applied)
            daily["story_resolved"] = True
            daily["story_result"] = result
            result["next_hint"] = _story_status(profile)["next_hint"]
            daily["narrative_pose"] = result["pose"]
            daily["narrative_reaction_at"] = result["resolved_at"]
            if await _save_profile(db, profile, expected):
                await _record_event(
                    db,
                    user["id"],
                    "story",
                    result["title"],
                    result["text"],
                    {"scene_id": body.scene_id, "choice_id": body.choice_id, "impact": applied},
                    source_key=f"pet-story:{user['id']}:{profile['survival'].get('generation', 1)}:{body.scene_id}",
                    important=True,
                )
                return {
                    **_snapshot(profile, await _recent_events(db, user["id"])),
                    "outcome": result,
                    "message": result["title"],
                    "idempotent": False,
                }
        raise HTTPException(status_code=409, detail="Не вдалося зберегти сюжетний вибір")

    @api.post("/pet/expeditions")
    async def start_expedition(body: PetExpeditionBody, user: dict = Depends(get_current_user)):
        definition = PET_EXPEDITIONS[body.location_id]
        for _ in range(3):
            profile = await _load_profile(db, user)
            _require_alive(profile)
            if sleeping(profile, _now()):
                raise HTTPException(409, "Спершу розбудіть котика лампою")
            existing = profile.get("expedition")
            if existing and existing.get("status") in {"active", "ready"}:
                await _record_event(
                    db,
                    user["id"],
                    "expedition",
                    f"Вирушили: {existing.get('location_name', 'експедиція')}",
                    f"{profile['name']} взяв спорядження й вирушив у дорогу.",
                    {"location_id": existing.get("location_id"), "loadout_id": existing.get("loadout_id")},
                    source_key=f"pet-expedition-start:{existing.get('id')}",
                )
                raise HTTPException(status_code=409, detail="Спочатку завершіть поточну експедицію")
            if profile["daily"].get("focus_used"):
                raise HTTPException(status_code=409, detail="Фокус дня вже використано")
            if profile["stats"].get("energy", 0) < definition["energy_cost"]:
                raise HTTPException(status_code=409, detail=f"{profile['name']} потрібно відпочити перед експедицією")
            if body.loadout_id == "camera" and "camera-retro" not in profile["inventory"].get("items", []):
                raise HTTPException(status_code=403, detail="Спочатку придбайте ретро-фотоапарат у магазині")

            expected = profile["revision"]
            started = _now()
            ends = started + timedelta(minutes=definition["duration_minutes"])
            roll = _stable_int(profile["id"], body.location_id, started.isoformat())
            material_by_location = {"yard": "cardboard", "park": "leaf", "rooftop": "fabric"}
            material = material_by_location[body.location_id]
            amount = 1 + (roll % 2) + (1 if body.loadout_id == "backpack" else 0)
            photo = body.loadout_id == "camera" and roll % 3 == 0
            story = body.loadout_id == "bell" and roll % 2 == 0
            energy_back = 8 if body.loadout_id == "blanket" else 3
            profile["expedition"] = {
                "id": str(uuid.uuid4()),
                "location_id": body.location_id,
                "location_name": definition["name"],
                "loadout_id": body.loadout_id,
                "status": "active",
                "started_at": started.isoformat(),
                "ends_at": ends.isoformat(),
                "duration_minutes": definition["duration_minutes"],
                "outcome": {"material": material, "amount": amount, "photo": photo, "story": story, "energy_back": energy_back},
            }
            profile["daily"]["focus_used"] = True
            profile["daily"]["focus_kind"] = "expedition"
            profile["daily"]["intent"] = profile["daily"].get("intent") or "explore"
            _apply_stat(profile, "energy", -definition["energy_cost"])
            profile["traits"]["curiosity"] += 2
            if await _save_profile(db, profile, expected):
                await _record_event(db, user["id"], "expedition", f"Вирушили: {definition['name']}", f"{profile['name']} взяв спорядження й вирушив у дорогу.", {"location_id": body.location_id, "loadout_id": body.loadout_id}, source_key=f"pet-expedition-start:{profile['expedition']['id']}")
                return {**_snapshot(profile, await _recent_events(db, user["id"])), "message": "Експедицію розпочато"}
        raise HTTPException(status_code=409, detail="Не вдалося почати експедицію")

    @api.post("/pet/expeditions/{expedition_id}/claim")
    async def claim_expedition(expedition_id: str, user: dict = Depends(get_current_user)):
        for _ in range(3):
            profile = await _load_profile(db, user)
            _require_alive(profile)
            expedition = profile.get("expedition")
            if not expedition or expedition.get("id") != expedition_id:
                raise HTTPException(status_code=404, detail="Експедицію не знайдено")
            if expedition.get("status") == "claimed":
                result = expedition.get("result") or {}
                material = result.get("material", "cardboard")
                material_name = MATERIAL_NAMES.get(material, material)
                story_text = " Дзвіночок привів до нової маленької історії." if result.get("story") else ""
                await _record_event(db, user["id"], "expedition", f"Повернення з локації «{expedition.get('location_name', 'експедиція')}»", f"{profile['name']} приніс: {material_name} ×{int(result.get('amount', 1))}.{story_text}", result, source_key=f"pet-expedition-claim:{expedition_id}", important=bool(result.get("photo") or result.get("story")))
                return {**_snapshot(profile, await _recent_events(db, user["id"])), "idempotent": True, "result": result}
            if expedition.get("status") not in {"active", "ready"}:
                raise HTTPException(status_code=409, detail="Експедиція має некоректний стан")
            ends_at = _parse_iso(expedition.get("ends_at"))
            if not ends_at:
                raise HTTPException(status_code=409, detail="Не вдалося перевірити час експедиції")
            if _now() < ends_at:
                remaining = max(1, int((ends_at - _now()).total_seconds()))
                raise HTTPException(status_code=409, detail=f"Експедиція ще триває: {remaining} с")
            expected = profile["revision"]
            outcome = expedition.get("outcome") or {}
            material = outcome.get("material", "cardboard")
            amount = int(outcome.get("amount", 1))
            profile["inventory"]["materials"][material] = int(profile["inventory"]["materials"].get(material, 0)) + amount
            if outcome.get("photo"):
                profile["inventory"]["materials"]["leaf"] = int(profile["inventory"]["materials"].get("leaf", 0)) + 1
            _apply_stat(profile, "energy", int(outcome.get("energy_back", 3)))
            profile["friendship_xp"] += 10 + (3 if outcome.get("story") else 0)
            pet_life.gain_skill(profile, "explorer", 6)
            expedition["status"] = "claimed"
            expedition["claimed_at"] = _now_iso()
            expedition["result"] = {"material": material, "amount": amount, "photo": bool(outcome.get("photo")), "story": bool(outcome.get("story"))}
            expedition.pop("outcome", None)
            _apply_progress(profile)
            if await _save_profile(db, profile, expected):
                material_name = MATERIAL_NAMES.get(material, material)
                story_text = " Дзвіночок привів до нової маленької історії." if outcome.get("story") else ""
                await _record_event(db, user["id"], "expedition", f"Повернення з локації «{expedition['location_name']}»", f"{profile['name']} приніс: {material_name} ×{amount}.{story_text}", expedition["result"], source_key=f"pet-expedition-claim:{expedition_id}", important=bool(outcome.get("photo") or outcome.get("story")))
                return {**_snapshot(profile, await _recent_events(db, user["id"])), "result": expedition["result"], "message": "Знахідки додано до колекції"}
        raise HTTPException(status_code=409, detail="Не вдалося забрати знахідки")

    @api.post("/pet/tricks/{trick_id}/practice")
    async def practice_trick(trick_id: str, user: dict = Depends(get_current_user)):
        definition = PET_TRICKS.get(trick_id)
        if not definition:
            raise HTTPException(status_code=404, detail="Трюк не знайдено")
        for _ in range(3):
            profile = await _load_profile(db, user)
            _require_alive(profile)
            if sleeping(profile, _now()):
                raise HTTPException(409, "Спершу розбудіть котика лампою")
            if profile["daily"].get("focus_used"):
                raise HTTPException(status_code=409, detail="Фокус дня вже використано")
            if profile["stats"].get("energy", 0) < definition["energy_cost"]:
                raise HTTPException(status_code=409, detail=f"{profile['name']} бракує енергії")
            expected = profile["revision"]
            progress = profile["tricks"].setdefault(trick_id, {"mastery": 0, "practices": 0, "mastered_at": None})
            gain = 22 + (_stable_int(user["id"], trick_id, _date_key()) % 9)
            before = int(progress.get("mastery", 0))
            progress["mastery"] = min(100, before + gain)
            progress["practices"] = int(progress.get("practices", 0)) + 1
            pet_life.gain_skill(profile, "actor", 5)
            mastered = progress["mastery"] == 100 and before < 100
            if mastered:
                progress["mastered_at"] = _now_iso()
            profile["daily"]["focus_used"] = True
            profile["daily"]["focus_kind"] = "training"
            profile["daily"]["intent"] = profile["daily"].get("intent") or "learn"
            _apply_stat(profile, "energy", -definition["energy_cost"])
            profile["traits"][definition["trait"]] += 2
            profile["friendship_xp"] += 8
            _apply_progress(profile)
            if await _save_profile(db, profile, expected):
                await _record_event(db, user["id"], "training", definition["name"], f"Тренування додало {gain}% майстерності.", {"trick_id": trick_id, "gain": gain, "mastery": progress["mastery"]}, source_key=f"pet-training:{user['id']}:{_date_key()}", important=mastered)
                return {**_snapshot(profile, await _recent_events(db, user["id"])), "mastery_gained": gain, "mastered": mastered, "message": "Тренування завершено"}
        raise HTTPException(status_code=409, detail="Не вдалося зберегти тренування")

    @api.post("/pet/project/contribute")
    async def contribute_project(body: PetProjectBody, user: dict = Depends(get_current_user)):
        for _ in range(3):
            profile = await _load_profile(db, user)
            _require_alive(profile)
            if profile["daily"].get("focus_used"):
                raise HTTPException(status_code=409, detail="Фокус дня вже використано")
            project = profile["weekly_project"]
            if project.get("completed"):
                raise HTTPException(status_code=409, detail="Тижневий проєкт уже завершено")
            expected = profile["revision"]
            material_cost = {"cardboard": "cardboard", "craft": "string", "ideas": None}[body.contribution]
            if material_cost:
                if profile["inventory"]["materials"].get(material_cost, 0) <= 0:
                    raise HTTPException(status_code=409, detail=f"Бракує ресурсу: {MATERIAL_NAMES[material_cost]}")
                profile["inventory"]["materials"][material_cost] -= 1
            project["progress"] = min(project["goal"], int(project.get("progress", 0)) + 1)
            completed = project["progress"] >= project["goal"]
            project["completed"] = completed
            if completed and "fort-cardboard" not in profile["inventory"]["items"]:
                profile["inventory"]["items"].append("fort-cardboard")
            profile["daily"]["focus_used"] = True
            profile["daily"]["focus_kind"] = "project"
            profile["daily"]["intent"] = profile["daily"].get("intent") or "build"
            profile["traits"]["intelligence"] += 2
            profile["friendship_xp"] += 8
            _apply_progress(profile)
            if await _save_profile(db, profile, expected):
                await _record_event(db, user["id"], "project", "Картонна фортеця", f"Проєкт виконано на {project['progress']} з {project['goal']} етапів.", {"progress": project["progress"], "completed": completed}, source_key=f"pet-project:{user['id']}:{_date_key()}", important=completed)
                return {**_snapshot(profile, await _recent_events(db, user["id"])), "completed": completed, "message": "Внесок у проєкт збережено"}
        raise HTTPException(status_code=409, detail="Не вдалося оновити проєкт")

    @api.post("/pet/minigames/{game_id}/start")
    async def start_minigame(game_id: str, user: dict = Depends(get_current_user)):
        if game_id not in {game["id"] for game in PET_GAMES}:
            raise HTTPException(status_code=404, detail="Гру не знайдено")
        profile = await _load_profile(db, user)
        _require_alive(profile)
        refusal = care_refusal(profile, "play", "minigame", _now())
        if refusal:
            raise HTTPException(409, refusal["message"])
        generation = _safe_int((profile.get("survival") or {}).get("generation"), 1, 1)
        now = _now()
        await db.pet_minigame_sessions.update_many(
            {"user_id": user["id"], "game_id": game_id, "status": "active", "expires_at": {"$lte": now}},
            {"$set": {"status": "expired", "completed_at": now.isoformat()}},
        )
        await db.pet_minigame_sessions.update_many(
            {"user_id": user["id"], "game_id": game_id, "status": "active", "pet_generation": {"$ne": generation}},
            {"$set": {"status": "expired", "completed_at": now.isoformat(), "expired_reason": "old_pet_generation"}},
        )
        active_query = {"user_id": user["id"], "game_id": game_id, "pet_generation": generation, "status": "active", "expires_at": {"$gt": now}}
        existing = await db.pet_minigame_sessions.find_one(active_query, {"_id": 0})
        if existing:
            return {"session": _public_session(existing), "resumed": True}
        session_id = str(uuid.uuid4())
        challenge, public_challenge = _build_minigame_challenge(session_id, user["id"], game_id)
        doc = {
            "id": session_id,
            "user_id": user["id"],
            "game_id": game_id,
            "pet_generation": generation,
            "challenge": challenge,
            "public_challenge": public_challenge,
            "status": "active",
            "started_at": now.isoformat(),
            "expires_at": now + timedelta(minutes=5),
            "purge_at": now + timedelta(days=7),
            "completed_at": None,
            "score": None,
            "rewarded": False,
            "reward_status": "not_started",
        }
        try:
            await db.pet_minigame_sessions.insert_one(copy.deepcopy(doc))
        except DuplicateKeyError:
            existing = await db.pet_minigame_sessions.find_one(active_query, {"_id": 0})
            if existing:
                return {"session": _public_session(existing), "resumed": True}
            raise HTTPException(status_code=409, detail="Ігрова сесія вже запускається")
        return {"session": _public_session(doc), "resumed": False}

    @api.post("/pet/minigames/sessions/{session_id}/finish")
    async def finish_minigame(session_id: str, body: PetMinigameFinishBody, user: dict = Depends(get_current_user)):
        profile = await _load_profile(db, user)
        session = await db.pet_minigame_sessions.find_one({"id": session_id, "user_id": user["id"]}, {"_id": 0})
        if not session:
            raise HTTPException(status_code=404, detail="Ігрову сесію не знайдено")
        current_generation = _safe_int((profile.get("survival") or {}).get("generation"), 1, 1)
        if _safe_int(session.get("pet_generation"), 1, 1) != current_generation:
            raise HTTPException(status_code=409, detail="Ця гра належить попередньому котику")
        idempotent = session.get("status") == "completed"
        if not idempotent:
            _require_alive(profile)
            expires_at = _parse_iso(session.get("expires_at"))
            finished_at = _now()
            if not expires_at or expires_at < finished_at:
                raise HTTPException(status_code=409, detail="Час сесії минув")
            score, score_detail = _score_minigame(session, body, finished_at)
            score_reason = score_detail.get("reason")
            if score_reason == "too_early":
                remaining_ms = max(1, _safe_int((session.get("challenge") or {}).get("min_duration_ms"), 0) - score_detail.get("elapsed_ms", 0))
                raise HTTPException(status_code=409, detail=f"Гра ще триває: {remaining_ms} мс")
            if score_reason == "invalid_client_clock":
                raise HTTPException(status_code=409, detail="Час гри не синхронізовано. Спробуйте надіслати результат ще раз")
            if score_reason == "unsupported_challenge":
                raise HTTPException(status_code=409, detail="Сценарій гри застарів. Оновіть застосунок і спробуйте ще раз")
            session = await db.pet_minigame_sessions.find_one_and_update(
                {"id": session_id, "user_id": user["id"], "status": "active"},
                {"$set": {
                    "status": "completed",
                    "completed_at": _now_iso(),
                    "score": score,
                    "score_detail": score_detail,
                    "reward_status": "pending" if score >= 50 else "ineligible",
                }},
                return_document=ReturnDocument.AFTER,
                projection={"_id": 0},
            )
            if not session:
                session = await db.pet_minigame_sessions.find_one({"id": session_id, "user_id": user["id"]}, {"_id": 0})
                idempotent = True
        if not session or session.get("status") != "completed":
            raise HTTPException(status_code=409, detail="Ігрова сесія ще завершується")

        score = int(session.get("score") or 0)
        rewarded = await settle_minigame_reward(user, session) if score >= 50 else False
        reward_status = "applied" if rewarded else "ineligible"
        await db.pet_minigame_sessions.update_one(
            {"id": session_id, "user_id": user["id"]},
            {"$set": {"rewarded": rewarded, "reward_status": reward_status}},
        )
        session["rewarded"] = rewarded
        session["reward_status"] = reward_status
        profile = await _load_profile(db, user)
        return {"session": _public_session(session), "score": score, "rewarded": rewarded, "idempotent": idempotent, "pet_state": _snapshot(profile, await _recent_events(db, user["id"]))}

    @api.post("/pet/collection/equip")
    async def equip_item(body: PetEquipBody, user: dict = Depends(get_current_user)):
        definition = next((item for item in PET_ITEMS if item["id"] == body.item_id), None)
        room_slot = ((definition or {}).get("room") or {}).get("slot") or (definition or {}).get("slot")
        if not definition or room_slot == "expedition":
            raise HTTPException(status_code=404, detail="Предмет не знайдено")
        for _ in range(3):
            profile = await _load_profile(db, user)
            _require_alive(profile)
            if body.item_id not in profile["inventory"]["items"]:
                raise HTTPException(status_code=403, detail="Спочатку відкрийте цей предмет")
            if profile["inventory"].get("equipped", {}).get(room_slot) == body.item_id:
                return {
                    **_snapshot(profile, await _recent_events(db, user["id"])),
                    "idempotent": True,
                    "message": "Предмет уже застосовано",
                }
            expected = profile["revision"]
            profile["inventory"]["equipped"][room_slot] = body.item_id
            if await _save_profile(db, profile, expected):
                await _record_event(db, user["id"], "collection", "Кімнату оновлено", f"Ви обрали «{definition['name']}».", {"item_id": body.item_id, "slot": room_slot})
                return {**_snapshot(profile), "message": "Предмет застосовано"}
        raise HTTPException(status_code=409, detail="Не вдалося застосувати предмет")

    @api.post("/pet/collection/unequip")
    async def unequip_item(body: PetEquipBody, user: dict = Depends(get_current_user)):
        definition = next((item for item in PET_ITEMS if item["id"] == body.item_id), None)
        room_slot = ((definition or {}).get("room") or {}).get("slot") or (definition or {}).get("slot")
        if not definition or room_slot == "expedition":
            raise HTTPException(status_code=404, detail="Предмет не знайдено")
        for _ in range(3):
            profile = await _load_profile(db, user)
            _require_alive(profile)
            equipped = profile["inventory"].setdefault("equipped", {})
            if equipped.get(room_slot) != body.item_id:
                return {
                    **_snapshot(profile, await _recent_events(db, user["id"])),
                    "idempotent": True,
                    "message": "Предмет уже прибрано",
                }
            expected = profile["revision"]
            equipped[room_slot] = None
            if await _save_profile(db, profile, expected):
                await _record_event(
                    db,
                    user["id"],
                    "collection",
                    "Предмет прибрано",
                    f"Ви забрали «{definition['name']}» з кімнати.",
                    {"item_id": body.item_id, "slot": room_slot},
                )
                return {**_snapshot(profile), "message": "Предмет забрано з кімнати"}
        raise HTTPException(status_code=409, detail="Не вдалося забрати предмет")

    @api.patch("/pet/room/layout")
    async def update_room_layout(body: PetRoomLayoutBody, user: dict = Depends(get_current_user)):
        item_ids = [placement.item_id for placement in body.placements]
        if len(item_ids) != len(set(item_ids)):
            raise HTTPException(status_code=400, detail="Кожен предмет можна передати лише один раз")

        for _ in range(3):
            profile = await _load_profile(db, user)
            _require_alive(profile)
            owned = set(profile.get("inventory", {}).get("items") or [])
            equipped = profile.get("inventory", {}).get("equipped") or {}
            next_layout = _sanitized_room_layout(profile)

            # Validate the complete batch before changing the in-memory profile.
            for placement in body.placements:
                definition = _room_item(placement.item_id)
                if not definition:
                    raise HTTPException(status_code=404, detail="Предмет не знайдено")
                room = _movable_room(definition)
                if not room:
                    raise HTTPException(status_code=400, detail="Цей предмет не можна переміщувати")
                if placement.item_id not in owned:
                    raise HTTPException(status_code=403, detail="Спочатку відкрийте цей предмет")
                room_slot = _room_slot(definition)
                if equipped.get(room_slot) != placement.item_id:
                    raise HTTPException(status_code=409, detail="Предмет уже не встановлений у кімнаті")
                position = _canonical_room_position(room, placement.x, placement.y)
                if position is None:
                    raise HTTPException(status_code=400, detail=f"«{definition['name']}» не можна поставити в це місце")
                if position == {"x": room["x"], "y": room["y"]}:
                    next_layout.pop(placement.item_id, None)
                else:
                    next_layout[placement.item_id] = position

            if next_layout == profile.get("room_layout", {}):
                return {
                    **_snapshot(profile, await _recent_events(db, user["id"])),
                    "idempotent": True,
                    "message": "Розташування вже збережено",
                }

            expected = profile["revision"]
            profile["room_layout"] = next_layout
            if await _save_profile(db, profile, expected):
                return {**_snapshot(profile), "message": "Розташування кімнати збережено"}

        raise HTTPException(status_code=409, detail="Кімната змінилася. Перевірте розташування й спробуйте ще раз")

    @api.post("/pet/gift/claim")
    async def claim_gift(user: dict = Depends(get_current_user), idempotency_key: str = Header(default="", alias="Idempotency-Key")):
        command_payload = {"kind": "gift"}
        command = await find_command(user["id"], idempotency_key, command_payload)
        if not command:
            preflight_profile = await _load_profile(db, user)
            _require_alive(preflight_profile)
            command = await reserve_command(user["id"], idempotency_key, command_payload)
        if command.get("status") == "completed":
            profile = await _load_profile(db, user)
            saved_result = command.get("result") or {}
            saved_reward = saved_result.get("reward") or profile.get("daily", {}).get("gift_reward") or {}
            command_created = _parse_iso(command.get("created_at"))
            reward_date = saved_result.get("reward_date") or (
                command_created.astimezone(KYIV_TZ).strftime("%Y-%m-%d") if command_created else profile.get("daily", {}).get("date")
            )
            await apply_point_gift(user, profile, saved_reward, reward_date)
            await _record_event(db, user["id"], "reward", "Подарунок від кота", f"{profile['name']} приніс: {saved_reward.get('title', 'сюрприз')}.", saved_reward, source_key=f"pet-gift-event:{user['id']}:{reward_date}", important=True)
            return {**_snapshot(profile, await _recent_events(db, user["id"])), "idempotent": True, "reward": saved_reward}
        for _ in range(4):
            profile = await _load_profile(db, user)
            daily = profile["daily"]
            marker = _command_marker(profile, command["id"])
            if marker:
                saved_result = marker.get("result") or {}
                saved_reward = saved_result.get("reward") or {}
                reward_date = saved_result.get("reward_date")
                if not reward_date:
                    raise HTTPException(status_code=409, detail="Не вдалося відновити дату подарунка")
                source = f"pet-gift-event:{user['id']}:{reward_date}"
                await complete_command(command, source, saved_result)
                await apply_point_gift(user, profile, saved_reward, reward_date)
                await _record_event(db, user["id"], "reward", "Подарунок від кота", f"{profile['name']} приніс: {saved_reward.get('title', 'сюрприз')}.", saved_reward, source_key=source, important=True)
                return {**_snapshot(profile, await _recent_events(db, user["id"])), "idempotent": True, "reward": saved_reward}
            _require_alive(profile)
            if daily.get("gift_claimed"):
                previous_reward = daily.get("gift_reward") or {}
                reward_date = daily["date"]
                saved_result = {"reward": previous_reward, "reward_date": reward_date}
                expected = profile["revision"]
                _mark_command_applied(profile, command, "gift", saved_result)
                if not await _save_profile(db, profile, expected):
                    continue
                source = f"pet-gift-event:{user['id']}:{reward_date}"
                await complete_command(command, source, saved_result)
                await apply_point_gift(user, profile, previous_reward, reward_date)
                await _record_event(db, user["id"], "reward", "Подарунок від кота", f"{profile['name']} приніс: {previous_reward.get('title', 'сюрприз')}.", previous_reward, source_key=source, important=True)
                return {**_snapshot(profile, await _recent_events(db, user["id"])), "idempotent": True, "reward": previous_reward}
            if not daily.get("ritual_complete") or profile.get("trust", 0) < 10:
                raise HTTPException(status_code=409, detail="Спершу завершіть денний ритуал і наповніть довіру")
            expected = profile["revision"]
            deck = profile["reward_deck"]
            cursor = max(0, min(int(deck.get("cursor") or 0), len(deck["cards"]) - 1))
            reward = _reward_from_card(deck["cards"][cursor])
            next_cursor = cursor + 1
            if next_cursor >= len(deck["cards"]):
                next_cycle = int(deck.get("cycle") or 0) + 1
                profile["reward_deck"] = {"cycle": next_cycle, "cursor": 0, "cards": _reward_deck(user["id"], next_cycle)}
            else:
                deck["cursor"] = next_cursor

            if reward["type"] == "item" and reward["item_id"] in profile["inventory"]["items"]:
                reward = {"type": "material", "material": "feather", "amount": 3, "title": "Пір'їнка ×3"}

            if reward["type"] == "points":
                budget = profile["reward_budget"]
                next_total = int(budget.get("points") or 0) + int(reward["amount"])
                if next_total > 50:
                    reward = {"type": "material", "material": "feather", "amount": 3, "title": "Пір'їнка ×3 · місячний ліміт Point"}
                else:
                    budget["points"] = next_total
            daily["gift_claimed"] = True
            daily["gift_reward"] = reward
            profile["friendship_xp"] += 5
            if reward["type"] == "item" and reward["item_id"] not in profile["inventory"]["items"]:
                profile["inventory"]["items"].append(reward["item_id"])
            if reward["type"] == "material":
                key = reward["material"]
                profile["inventory"]["materials"][key] = int(profile["inventory"]["materials"].get(key, 0)) + reward["amount"]
            reward_date = daily["date"]
            saved_result = {"reward": reward, "reward_date": reward_date}
            _mark_command_applied(profile, command, "gift", saved_result)
            _apply_progress(profile)
            if not await _save_profile(db, profile, expected):
                continue

            source = f"pet-gift-event:{user['id']}:{reward_date}"
            await complete_command(command, source, saved_result)
            await apply_point_gift(user, profile, reward, reward_date)

            await _record_event(db, user["id"], "reward", "Подарунок від кота", f"{profile['name']} приніс: {reward['title']}.", reward, source_key=source, important=True)
            return {**_snapshot(profile, await _recent_events(db, user["id"])), "reward": reward, "idempotent": False}
        raise HTTPException(status_code=409, detail="Подарунок уже змінюється. Спробуйте ще раз")

    @api.get("/pet/journal")
    async def get_pet_journal(
        limit: int = 30,
        kind: Optional[str] = None,
        cursor: Optional[str] = None,
        user: dict = Depends(get_current_user),
    ):
        safe_limit = max(1, min(50, int(limit)))
        query: dict = {"user_id": user["id"]}
        if kind and kind != "all":
            query["kind"] = kind
        if cursor:
            try:
                occurred_at, event_id = _decode_journal_cursor(cursor)
            except ValueError:
                raise HTTPException(status_code=400, detail="Некоректний курсор щоденника")
            query["$or"] = [
                {"occurred_at": {"$lt": occurred_at}},
                {"occurred_at": occurred_at, "id": {"$lt": event_id}},
            ]
        rows = await db.pet_events.find(query, {"_id": 0, "expires_at": 0}).sort(
            [("occurred_at", -1), ("id", -1)]
        ).to_list(safe_limit + 1)
        has_more = len(rows) > safe_limit
        items = rows[:safe_limit]
        next_cursor = _encode_journal_cursor(items[-1]) if has_more and items else None
        return {"items": items, "has_more": has_more, "next_cursor": next_cursor}
