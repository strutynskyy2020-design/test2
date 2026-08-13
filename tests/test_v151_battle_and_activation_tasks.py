from __future__ import annotations

import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "backend" / "server.py"


def assignment(name: str):
    tree = ast.parse(SERVER.read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == name:
                    return ast.literal_eval(node.value)
    raise AssertionError(name)


def test_activation_catalog_v151_contains_new_tasks() -> None:
    catalog = assignment("ACTIVATION_DAILY_TASK_CATALOG")
    by_title = {item["title"]: item for item in catalog}
    assert len(catalog) == 53
    assert by_title["З першого слова"]["reward"] == 10
    assert by_title["Кешбек на десерт"]["difficulty"] == "easy"
    assert by_title["Помічники вже тут"]["reward"] == 20
    assert by_title["🪄 Раз — і картка є!"]["reward"] == 30
    assert by_title["ЄКЛ? ЄКЛ!"]["difficulty"] == "hard"
    assert by_title["А слабо?"]["reward"] == 30


def test_activation_catalog_version_does_not_reset_current_day() -> None:
    versions = assignment("DAILY_TASK_CATALOG_VERSION")
    assert versions["activation"] == "activation-v1"


def test_daily_battle_has_atomic_day_reward_guard() -> None:
    source = SERVER.read_text(encoding="utf-8")
    assert 'reward_key = f"daily_battle:{date_key}"' in source
    assert '"battle_reward_keys": {"$ne": reward_key}' in source
    assert '"$inc": {"balance": amount, "total_earned": amount}' in source
    assert 'awarded.modified_count != 1' in source


def test_daily_battle_creation_uses_unique_mongo_ids() -> None:
    source = SERVER.read_text(encoding="utf-8")
    assert '"_id": f"daily-battle-day:{date_key}"' in source
    assert '"_id": f"daily-battle:{date_key}:{left[\'id\']}"' in source
    assert '"_id": f"daily-battle:{date_key}:{right[\'id\']}"' in source


def test_historical_duplicate_audit_endpoint_exists() -> None:
    source = SERVER.read_text(encoding="utf-8")
    assert '@api.get("/admin/daily-battles/duplicate-audit")' in source
    assert '"meta.battle_date": {"$exists": True}' in source
