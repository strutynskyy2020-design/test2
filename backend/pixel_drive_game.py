"""Configuration and optional developer replay tooling.

Production routes accept browser outcomes and use the pure Python economy.
The standalone Node replay remains available only to developer tests/tools.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
from threading import BoundedSemaphore

try:
    from . import pixel_drive_progression as progression
except ImportError:
    import pixel_drive_progression as progression

BASE = Path(__file__).resolve().parent
_CONFIG_BYTES = (BASE / "pixel_drive_config.json").read_bytes()
CONFIG = json.loads(_CONFIG_BYTES)
_CONFIG_SHA = hashlib.sha256(_CONFIG_BYTES).hexdigest()
_SLOTS = BoundedSemaphore(2)
REPLAY_TIMEOUT = 30
MAX_INPUT_BYTES = 1048576
MAX_OUTPUT_BYTES = 262144


class ReplayUnavailable(RuntimeError):
    """An operational failure; never turn this into a client replay rejection."""


def fresh_upgrades():
    return dict(engine=0, suspension=0, tires=0, tank=0)


def level_config(level_id, session=None):
    session = session or {}
    if session.get('mode') == 'endless':
        return dict(id=level_id,mode='endless',worldId=session['world_id'],meters=1000000000,
                    max_ticks=2**53-1,gears=[],checkpoints=[],coinValues=[],finishReward=0,
                    stageId=session['stageId'],seed=session['seed'],generatorVersion=session['generatorVersion'])
    return progression._level(level_id, session.get('version'))


def _runtime_command():
    configured = os.environ.get("PIXEL_DRIVE_NODE")
    executable = Path(configured) if configured else Path(shutil.which("node") or "")
    if not executable.is_absolute() or not executable.is_file():
        raise ReplayUnavailable("Node runtime is unavailable")
    runtime = BASE / "pixel_drive_runtime.cjs"
    try:
        manifest = json.loads((BASE / "pixel_drive_runtime.manifest.json").read_text(encoding="utf-8"))
        if (manifest["version"] != CONFIG["version"] or manifest["config_sha256"] != _CONFIG_SHA
                or hashlib.sha256(runtime.read_bytes()).hexdigest() != manifest["runtime_sha256"]):
            raise ReplayUnavailable("Replay bundle does not match its configuration")
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise ReplayUnavailable("Replay bundle is missing or invalid") from exc
    return [str(executable), "--max-old-space-size=128", str(runtime)]


def _call_runtime(data):
    payload = json.dumps(dict(data, version=CONFIG["version"], config_sha256=_CONFIG_SHA),
                         ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(payload) > MAX_INPUT_BYTES:
        raise ValueError("Забагато даних керування")
    command = _runtime_command()
    if not _SLOTS.acquire(blocking=False):
        raise ReplayUnavailable("Replay workers are busy")
    try:
        # Node options are controlled here, never inherited from a host's preload settings.
        env = {k: v for k, v in os.environ.items() if k.upper() not in ("NODE_OPTIONS", "NODE_PATH")}
        result = subprocess.run(command, input=payload, capture_output=True, cwd=BASE,
                                env=env, timeout=REPLAY_TIMEOUT, check=False,
                                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        if result.returncode != 0 or len(result.stdout) > MAX_OUTPUT_BYTES:
            raise ReplayUnavailable("Replay worker failed")
        reply = json.loads(result.stdout)
        if (not isinstance(reply, dict) or reply.get("version") != CONFIG["version"]
                or reply.get("config_sha256") != _CONFIG_SHA):
            raise ReplayUnavailable("Replay worker protocol mismatch")
        if reply.get("ok") is not True:
            if reply.get("kind") == "invalid_replay":
                raise ValueError(str(reply.get("error", "Некоректний заїзд"))[:200])
            raise ReplayUnavailable("Replay worker rejected the request")
        return reply
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise ReplayUnavailable("Replay worker is unavailable") from exc
    finally:
        _SLOTS.release()


def ensure_runtime():
    """Check the optional developer replay executable and bundle."""
    _call_runtime(dict(op="health"))


def replay(level, upgrades, events, ticks, abandon=False, vehicle_id='wanderer'):
    if type(ticks) is not int or not 1 <= ticks <= level["max_ticks"] or len(events) > 43200:
        raise ValueError("Некоректна тривалість")
    if type(abandon) is not bool:
        raise ValueError("Некоректний стан заїзду")
    last = -1
    for event in events:
        if (not isinstance(event, (list, tuple)) or len(event) != 2
                or any(type(v) is not int for v in event)
                or not last < event[0] < ticks or event[0] < 0 or not 0 <= event[1] <= 7):
            raise ValueError("Некоректне керування")
        last = event[0]
    if (not isinstance(upgrades, dict) or set(upgrades) != set(fresh_upgrades())
            or any(type(v) is not int or not 0 <= v <= 10 for v in upgrades.values())):
        raise ValueError("Некоректні покращення")
    if not progression.vehicle_config(vehicle_id):
        raise ValueError('Невідома машина')
    reply = _call_runtime(dict(op="replay", level=level["id"], upgrades=upgrades,
                               events=events, ticks=ticks, abandon=abandon, vehicle_id=vehicle_id))
    outcome = reply.get("outcome")
    if not isinstance(outcome, dict) or outcome.get("ticks") != ticks or outcome.get("status") not in ("completed", "failed"):
        raise ReplayUnavailable("Replay worker returned an invalid outcome")
    return outcome


def migrate_progress(profile):
    return progression.migrate_progress(profile)


def award_progress(profile, level_id, outcome, metadata=None):
    return progression.award_progress(profile, level_id, outcome, metadata)


def purchase_progress(profile, part, from_level, vehicle_id=None):
    return progression.purchase_progress(profile, part, from_level, vehicle_id)
