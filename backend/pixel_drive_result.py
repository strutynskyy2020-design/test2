"""Bound browser results for storage and rewards; this does not verify physics."""
import math
import re
try:
    from .pixel_drive_progression import fuel_capacity
except ImportError:
    from pixel_drive_progression import fuel_capacity

_CONTROLS = re.compile(r"[\x00-\x1f\x7f]")
_FAILURE_REASONS = {"overturned", "stuck", "fuel", "route_exit", "time", "abandoned", "ended"}
_JS_WHITESPACE = "\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"


def _number(value, maximum):
    if type(value) not in (int, float) or (type(value) is float and not math.isfinite(value)):
        return 0
    return max(0, min(maximum, value))


def _text(value, maximum):
    return _CONTROLS.sub("", value).strip(_JS_WHITESPACE)[:maximum] if isinstance(value, str) else ""


def normalize_outcome(level, upgrades, raw, ticks, abandon=False, session=None):
    """Trust the reported run while deriving currency/medals from known data."""
    session = session or {}
    endless = (session.get('mode') or level.get('mode')) == 'endless'
    vehicle_id = session.get('vehicle_id', 'wanderer')
    completed = not endless and not abandon and raw.get("status") == "completed"
    status = "completed" if completed else "failed"
    reason = "finish" if completed else "abandoned" if abandon else raw.get("reason")
    if not completed and (not isinstance(reason, str) or reason not in _FAILURE_REASONS):
        reason = "ended"
    distance = level["meters"] if completed else math.floor(_number(raw.get("distance"), 1000000000 if endless else level["meters"]))
    raw_gears = raw.get("gears") if not endless and isinstance(raw.get("gears"), list) else []
    gears = sorted({int(n) for n in raw_gears if type(n) in (int,float)
                    and 0 <= n < len(level["gears"]) and n == int(n)})
    allowed_checkpoints = {cp["id"] for cp in level["checkpoints"]}
    raw_checkpoints = raw.get("checkpoints") if not endless and isinstance(raw.get("checkpoints"), list) else []
    checkpoints = sorted({n for n in raw_checkpoints if isinstance(n, str) and n in allowed_checkpoints})
    capacity = fuel_capacity(vehicle_id, upgrades['tank'])
    fuel_seconds = _number(raw.get("fuelSeconds"), capacity)
    medals = []
    if completed:
        medals.append("finish")
        if len(gears) >= math.ceil(len(level["gears"]) * .7):
            medals.append("collector")
        if fuel_seconds * 5 >= capacity:
            medals.append("economy")
    analysis = []
    raw_analysis = raw.get("analysis") if isinstance(raw.get("analysis"), list) else []
    for note in raw_analysis:
        if not isinstance(note, dict):
            continue
        message = _text(note.get("message"), 400)
        if message:
            analysis.append({"type": _text(note.get("type"), 40) or "info", "message": message})
        if len(analysis) == 3:
            break
    metadata = {key: session.get(key) if session.get(key) is not None else level[key]
                for key in ("seed", "generatorVersion")}
    metadata["stageId"] = session.get("stageId") or level["stageId"]
    # Start x=9 plus 3m for the 1.65m pickup radius and floored distance.
    coins = min(math.floor(_number(raw.get('coinsCollected'), 2**53-1)), math.floor((distance+12)/25))
    return dict(status=status, reason=reason, ticks=ticks, distance=distance,
                fuel=math.floor(fuel_seconds * 100 / capacity), fuelSeconds=fuel_seconds,
                coinValue=coins*5 if endless else sum(level["coinValues"][n] for n in gears), gears=gears,
                checkpoints=checkpoints, medals=medals, analysis=analysis,
                vehicleId=vehicle_id, worldId=session.get('world_id') or level.get('worldId','earth'), mode='endless' if endless else 'campaign',
                **({'coinsCollected':coins} if endless else {}),
                **metadata)
