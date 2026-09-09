"""Shared care eligibility, per-action clocks, and real-time server sleep.

No timers/jobs: sleep is settled at deterministic simulation boundaries and on
load. Sleep never changes the daily reward budget or grants instant energy.
"""
from datetime import timedelta
from fastapi import HTTPException
from pet_life import apply_need, stamp

SLEEP_ENERGY_PER_HOUR = 12.0
SLEEP_MAX_HOURS = 8


def sleeping(profile, now):
    state = profile.get("life", {}).get("sleep", {})
    start, end = stamp(state.get("started_at")), stamp(state.get("ends_at"))
    return bool(state.get("active") and start and end and start <= now < end)


def sleep_overlap_hours(profile, start, end):
    life = profile.get("life", {})
    total = 0.0
    for state in [*life.get("sleep_windows", []), life.get("sleep", {})]:
        first, last = stamp(state.get("started_at")), stamp(state.get("ends_at"))
        if not first or not last:
            continue
        woke = stamp(state.get("woke_at"))
        if woke: last = min(last, woke)
        total += max(0.0, (min(end, last) - max(start, first)).total_seconds() / 3600)
    return min(total, max(0.0, (end - start).total_seconds() / 3600))


def settle_sleep(profile, now):
    state = profile.get("life", {}).get("sleep", {})
    if not state.get("active"):
        return False
    previous, end = stamp(state.get("settled_at")), stamp(state.get("ends_at"))
    if profile.get("survival", {}).get("status") != "alive" or not previous or not end:
        state.update(active=False, ended_reason="unavailable")
        return True
    until = min(now, end)
    if until <= previous:
        return False
    apply_need(profile, "energy", (until - previous).total_seconds() / 3600 * SLEEP_ENERGY_PER_HOUR)
    state["settled_at"] = until.isoformat()
    if now >= end:
        state.update(active=False, ended_reason="rested", woke_at=end.isoformat())
    return True


def start_sleep(profile, now):
    settle_sleep(profile, now)
    if sleeping(profile, now):
        return {"reaction": "sleep", "message": "Тихенько… я вже сплю.", "accepted": True, "replenished": False, "rewarded": False}
    life = profile["life"]
    state = life.get("sleep", {})
    # Keep completed intervals until the hourly survival cursor passes them.
    # Bound rapid toggles without letting them manufacture instantaneous energy.
    cutoff = stamp(profile.get("last_decay_at")) or now
    windows = [row for row in life.get("sleep_windows", []) if (stamp(row.get("woke_at")) or stamp(row.get("ends_at")) or now) > cutoff]
    if len(windows) >= 64:
        raise HTTPException(429, "Забагато перемикань сну. Зачекайте трохи")
    if state.get("started_at"):
        windows.append({key: state.get(key) for key in ("started_at", "ends_at", "woke_at")})
    life["sleep_windows"] = windows[-64:]
    energy = profile["survival"].get("needs_exact", {}).get("energy", profile["stats"]["energy"])
    hours = min(SLEEP_MAX_HOURS, max(.25, (100 - energy) / SLEEP_ENERGY_PER_HOUR))
    profile["life"]["sleep"] = {"active": True, "started_at": now.isoformat(),
        "settled_at": now.isoformat(), "ends_at": (now + timedelta(hours=hours)).isoformat(), "woke_at": None}
    return {"reaction": "sleep", "message": "Я засинаю. Сили повернуться поступово.", "accepted": True, "replenished": False, "rewarded": False}


def wake_sleep(profile, now, urgent=False):
    state = profile["life"].get("sleep", {})
    was_active = sleeping(profile, now)
    settle_sleep(profile, now)
    if not was_active:
        return {"reaction": "idle", "message": "Я вже прокинувся.", "accepted": True, "rewarded": False}
    started = stamp(state.get("started_at")) or now
    daily = profile["life"]["daily"]
    early = (now - started).total_seconds() < 900 and profile["stats"]["energy"] < 80
    if early and not urgent and not daily.get("sleep_wake_penalized"):
        apply_need(profile, "mood", -3)
        daily["sleep_wake_penalized"] = True
    state.update(active=False, woke_at=now.isoformat(), ended_reason="urgent" if urgent else "woken")
    return {"reaction": "yawn", "message": "Ще сонний… дай трохи оговтатися." if early else "Я прокинувся й потягнувся!", "accepted": True, "rewarded": False}


def care_refusal(profile, action, option, now, zone="head"):
    stats, survival = profile["stats"], profile["survival"]
    reason = None
    if sleeping(profile, now) and action not in {"rest", "heal"}:
        urgent_food = action == "feed" and stats["satiety"] < 20
        if not urgent_food:
            reason = ("sleep", "Я сплю. Спершу розбуди мене лампою.")
    if not reason and action == "feed" and stats["satiety"] > 92:
        reason = ("sniff", "Я вже наївся. Залишимо на потім?")
    if not reason and action == "clean" and stats.get("cleanliness", 100) > 92 and not any(mark.get("kind") == "mess" for mark in profile.get("life", {}).get("scene_marks", [])):
        reason = ("idle", "У кімнаті вже чисто. Губку поки відкладемо.")
    if not reason and action == "feed" and survival.get("mood_state") == "picky" and option == (survival.get("recent_foods") or [None])[-1]:
        reason = ("sniff", "Може, спробуємо іншу їжу?")
    if not reason and action == "pet":
        if survival.get("mood_state") == "do_not_touch" or stats["mood"] < 25 or survival.get("illness") or (stamp(survival.get("touch_cooldown_until")) or now) > now:
            reason = ("refuse", "Побудь поруч, але поки не гладь мене.")
        elif zone == "belly" and (profile.get("trust", 0) < 10 or stats["mood"] < 60):
            reason = ("refuse", "Животик поки не чіпай. Краще погладь голівку.")
    if not reason and action == "play":
        if stats["energy"] < 25 or stats["health"] < 35 or survival.get("illness"):
            reason = ("tired", "Зараз мені потрібен відпочинок.")
        elif survival.get("mood_state") == "bored" and option == (survival.get("recent_toys") or [None])[-1]:
            reason = ("refuse", "Ця іграшка набридла. Спробуємо іншу?")
    if not reason:
        return None
    return {"reaction": reason[0], "message": reason[1], "accepted": False, "replenished": False, "rewarded": False}


def record_care_clock(profile, action, now):
    profile["life"].setdefault("care_at", {})[action] = now.isoformat()


def last_care_clock(profile, action, now):
    life = profile["life"]
    candidates = [stamp(life.get("care_at", {}).get(action)),
                  stamp(life.get("daily", {}).get("playroom", {}).get("last", {}).get(action))]
    daily = profile["daily"]
    if daily.get("last_action") == action:
        candidates.append(stamp(daily.get("last_action_at")))
    dates = [value for value in candidates if value]
    if dates:
        return max(dates)
    # Older profiles lack per-action timestamps. Conservatively start the pause
    # once at migration, rather than let alternating actions bypass it.
    if action in daily.get("care_actions", []) + daily.get("rejected_actions", []):
        record_care_clock(profile, action, now)
        return now
    return None


def public_sleep(profile, now):
    state = profile.get("life", {}).get("sleep", {})
    return {"active": sleeping(profile, now), "started_at": state.get("started_at"),
            "ends_at": state.get("ends_at"), "woke_at": state.get("woke_at"),
            "energy_per_hour": SLEEP_ENERGY_PER_HOUR}
