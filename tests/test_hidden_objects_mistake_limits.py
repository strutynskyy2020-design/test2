from __future__ import annotations

import importlib.util
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
SERVER = BACKEND / "server.py"


def load_game_module():
    spec = importlib.util.spec_from_file_location(
        "hidden_object_game_mistake_limits", BACKEND / "hidden_object_game.py"
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_wrong_click_limits_follow_difficulty() -> None:
    game = load_game_module()

    assert game.hidden_object_mistake_limit({"difficulty": "easy"}) == 15
    assert game.hidden_object_mistake_limit({"difficulty": "medium"}) == 10
    assert game.hidden_object_mistake_limit({"difficulty": "hard"}) == 5
    assert game.hidden_object_mistake_limit({}) == 10


def test_last_allowed_miss_fails_exactly_at_limit() -> None:
    game = load_game_module()

    for difficulty, limit in (("easy", 15), ("medium", 10), ("hard", 5)):
        level = {"difficulty": difficulty}
        assert game.hidden_object_apply_miss(level, limit - 2) == (limit - 1, 1, False)
        assert game.hidden_object_apply_miss(level, limit - 1) == (limit, 0, True)
        assert game.hidden_object_apply_miss(level, limit) == (limit, 0, True)


def test_public_level_exposes_authoritative_limit() -> None:
    game = load_game_module()
    level = {
        "id": 4,
        "difficulty": "hard",
        "scene_id": "scene",
        "target_ids": ["one", "two", "three", "four"],
        "par_time": 180,
        "hints": 1,
    }
    scene = {"id": "scene", "image": "/scene.png", "width": 1600, "height": 1000}

    payload = game.hidden_object_public_level(level, scene)

    assert payload["mistake_limit"] == 5


def test_server_marks_failed_session_and_blocks_completion_reward() -> None:
    source = SERVER.read_text(encoding="utf-8")
    action = source.split("async def hidden_object_action", 1)[1].split(
        '@api.post("/games/hidden-objects/complete")', 1
    )[0]
    completion = source.split("async def hidden_object_complete", 1)[1].split(
        "async def seed_hidden_objects_v157", 1
    )[0]

    assert '"status": "failed"' in action
    assert '"failure_reason": "mistake_limit"' in action
    assert 'session_update["$unset"] = {"slot_key": ""}' in action
    assert '"mistakes_remaining": mistakes_remaining' in action
    assert 'if max(0, int(session.get("mistakes", 0))) >= mistake_limit:' in completion
    assert 'detail="Ліміт неправильних натискань вичерпано"' in completion
