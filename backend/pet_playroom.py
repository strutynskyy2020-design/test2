"""Repeatable play, separate from the daily care/reward economy.

Only small, server-budgeted need changes; never XP, trust, materials or Point.
The bounded receipts, cooldowns and daily budget are committed with profile CAS.
"""
from copy import deepcopy
from datetime import timedelta
from fastapi import Depends, HTTPException
from pydantic import Field
from typing import Literal

from pet_life import apply_need, day, ensure_life, clear_scene_mess, stamp
from pet_life_routes import LifeContext
from pet_care_rules import care_refusal, last_care_clock, record_care_clock, sleeping, start_sleep, wake_sleep


class PlayInteraction(LifeContext):
    action: Literal["feed", "pet", "play", "clean", "rest"]
    option: Literal["default", "balanced", "fish", "crunchy", "wand", "ball"] = "default"
    request_id: str = Field(min_length=8, max_length=80, pattern=r"^[a-zA-Z0-9_-]+$")
    zone: Literal["head", "back", "belly"] = "head"


class SleepAction(LifeContext):
    action: Literal["start", "wake"]
    request_id: str = Field(min_length=8, max_length=80, pattern=r"^[a-zA-Z0-9_-]+$")


OPTIONS = {"feed": {"balanced", "fish", "crunchy"}, "play": {"wand", "ball"},
           "pet": {"default"}, "clean": {"default"}, "rest": {"default"}}
LIMITS = {"feed": (300, 3, {"satiety": 8, "cleanliness": -1}),
          "pet": (60, 6, {"mood": 2}), "play": (60, 6, {"mood": 2, "energy": -1}),
          "clean": (180, 4, {"cleanliness": 10}), "rest": (0, 0, {})}
REACTIONS = {"feed": ("eat", "Ням!"), "pet": ("purr", "Мур-р-р…"),
             "play": ("pounce", "Лови мене!"), "clean": ("clean", "Ось тепер чистенько!"),
             "rest": ("sleep", "Тихенько… я відпочиваю.")}


def public_care_availability(profile, now):
    """Read-only hints; commands still check eligibility and budgets on the server."""
    life, daily = profile.get("life", {}), profile.get("daily", {})
    play = life.get("daily", {}).get("playroom", {})
    result = {}
    for action, (seconds, limit, _) in LIMITS.items():
        repeated = action in daily.get("care_actions", []) + daily.get("rejected_actions", [])
        dates = [stamp(life.get("care_at", {}).get(action)), stamp(play.get("last", {}).get(action))]
        if daily.get("last_action") == action:
            dates.append(stamp(daily.get("last_action_at")))
        last = max((date for date in dates if date), default=now if repeated else None)
        remaining = max(0, seconds - (now - last).total_seconds()) if repeated and last else 0
        exhausted = repeated and action != "rest" and play.get("uses", {}).get(action, 0) >= limit
        result[action] = {"repeated": repeated, "limited_today": exhausted,
                          "ready_at": (now + timedelta(seconds=remaining)).isoformat() if remaining else None}
    return result


def repeat_interaction(profile, body, now):
    if body.option not in OPTIONS[body.action]:
        raise HTTPException(422, "Невідповідний предмет для цієї дії")
    ensure_life(profile, now)
    daily = profile["daily"]
    if body.action not in daily.get("care_actions", []) + daily.get("rejected_actions", []):
        raise HTTPException(409, "Спочатку виконайте звичайну турботу цього дня")
    play = profile["life"]["daily"].setdefault("playroom", {"receipts": [], "uses": {}, "last": {}})
    fingerprint = f"{body.action}:{body.option}:{body.zone}"
    receipt = next((r for r in play["receipts"] if r["id"] == body.request_id), None)
    if receipt:
        if receipt["fingerprint"] != fingerprint:
            raise HTTPException(409, "Цей запит уже використано для іншої взаємодії")
        return {**deepcopy(receipt["result"]), "replayed": True}
    stats, survival = profile["stats"], profile["survival"]
    action = body.action
    reaction, message = REACTIONS[action]
    accepted = True
    refusal = care_refusal(profile, action, body.option, now, body.zone)
    if refusal:
        accepted, reaction, message = False, refusal["reaction"], refusal["message"]
    seconds, limit, effects = LIMITS[action]
    last = last_care_clock(profile, action, now)
    ready = not last or (now - last).total_seconds() >= seconds
    uses = play["uses"].get(action, 0)
    replenished = bool(action != "rest" and accepted and ready and uses < limit)
    if action == "rest":
        response = start_sleep(profile, now)
        reaction, message = response["reaction"], response["message"]
    elif accepted and sleeping(profile, now) and action == "feed":
        wake_sleep(profile, now, urgent=True)
    if replenished:
        effects = dict(effects)
        if action == "pet":
            effects["mood"] = {"head": 2, "back": 1, "belly": 3}[body.zone]
        for key, amount in effects.items():
            apply_need(profile, key, amount)
        play["uses"][action] = uses + 1
        play["last"][action] = now.isoformat()
        record_care_clock(profile, action, now)
        if action in {"feed", "play"}:
            key = "recent_foods" if action == "feed" else "recent_toys"
            survival[key] = (survival.get(key, []) + [body.option])[-3:]
        if action == "pet":
            survival["last_pet_at"] = now.isoformat()
        if action == "clean":
            clear_scene_mess(profile)
    elif accepted and action != "rest":
        # Playing is still available, but does not fake a replenished need.
        message = "На сьогодні достатньо: потреби знову відновлюватимуться завтра." if uses >= limit else "Дай мені коротку паузу. Потреби поки не змінилися."
        if action == "feed":
            reaction = "sniff"
    if replenished and action == "pet" and body.zone != "head":
        message = "О-о, почухай спинку ще!" if body.zone == "back" else "Тобі навіть животик довіряю."
    result = {"reaction": reaction, "message": message, "accepted": accepted,
              "replenished": replenished, "rewarded": False, "replayed": False,
              "zone": body.zone if action == "pet" else None}
    play["receipts"] = (play["receipts"] + [{"id": body.request_id, "fingerprint": fingerprint, "result": result}])[-16:]
    return result


def register_play_routes(api, db, get_current_user, feature):
    f = feature

    @api.post("/pet/sleep")
    async def manage_sleep(body: SleepAction, user: dict = Depends(get_current_user)):
        for _ in range(4):
            profile = await f._load_profile(db, user)
            now = f._now()
            if body.date_key != day(now) or body.generation != profile["survival"]["generation"]:
                raise HTTPException(409, "Команда сну застаріла. Оновіть кімнату")
            f._require_alive(profile)
            if (profile.get("expedition") or {}).get("status") == "active":
                raise HTTPException(409, "Котик ще в експедиції")
            expected = profile["revision"]
            receipts = profile["life"].setdefault("sleep_requests", [])
            existing = next((row for row in receipts if row["id"] == body.request_id), None)
            if existing:
                if existing["action"] != body.action:
                    raise HTTPException(409, "Цей запит уже використано")
                return {**f._snapshot(profile), "interaction": existing["result"]}
            result = start_sleep(profile, now) if body.action == "start" else wake_sleep(profile, now)
            profile["life"]["sleep_requests"] = (receipts + [{"id": body.request_id, "action": body.action, "result": result}])[-16:]
            f._update_survival_condition(profile)
            if await f._save_profile(db, profile, expected):
                return {**f._snapshot(profile), "interaction": result}
        raise HTTPException(409, "Кімната оновилась. Повторіть команду")

    @api.post("/pet/interact")
    async def interact(body: PlayInteraction, user: dict = Depends(get_current_user)):
        for _ in range(4):
            profile = await f._load_profile(db, user)
            now = f._now()
            if body.date_key != day(now) or body.generation != profile["survival"]["generation"]:
                raise HTTPException(409, "Взаємодія застаріла. Оновіть кімнату")
            f._require_alive(profile)
            if (profile.get("expedition") or {}).get("status") == "active":
                raise HTTPException(409, "Котик ще в експедиції")
            expected = profile["revision"]
            result = repeat_interaction(profile, body, now)
            f._update_survival_condition(profile)
            if await f._save_profile(db, profile, expected):
                return {**f._snapshot(profile), "interaction": result}
        raise HTTPException(409, "Кімната оновилась. Повторіть взаємодію")
