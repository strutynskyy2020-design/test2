from __future__ import annotations

import ast
import asyncio
import copy
from pathlib import Path
from types import SimpleNamespace


ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "backend" / "server.py"


def _matches(document: dict, query: dict) -> bool:
    for key, expected in query.items():
        actual = document.get(key)
        if isinstance(expected, dict):
            if "$in" in expected and actual not in expected["$in"]:
                return False
            if "$ne" in expected and actual == expected["$ne"]:
                return False
        elif actual != expected:
            return False
    return True


class _Cursor:
    def __init__(self, rows: list[dict]):
        self.rows = rows

    async def to_list(self, length: int) -> list[dict]:
        return copy.deepcopy(self.rows[:length])


class _Collection:
    def __init__(self, rows: list[dict] | None = None):
        self.rows = copy.deepcopy(rows or [])
        self.fail_on_level: int | None = None
        self.update_calls = 0

    def find(self, query: dict, projection: dict | None = None) -> _Cursor:
        rows = [row for row in self.rows if _matches(row, query)]
        if projection and projection.get("_id") == 0:
            rows = [{key: value for key, value in row.items() if key != "_id"} for row in rows]
        return _Cursor(rows)

    async def update_one(self, query: dict, update: dict, upsert: bool = False):
        self.update_calls += 1
        target_level = query.get("level")
        if self.fail_on_level is not None and target_level == self.fail_on_level:
            raise RuntimeError("simulated interrupted migration")

        existing = next((row for row in self.rows if _matches(row, query)), None)
        if existing is not None:
            existing.update(copy.deepcopy(update.get("$set", {})))
            return SimpleNamespace(modified_count=1, upserted_id=None)
        if not upsert:
            return SimpleNamespace(modified_count=0, upserted_id=None)

        inserted = {
            key: value
            for key, value in query.items()
            if not isinstance(value, dict)
        }
        inserted.update(copy.deepcopy(update.get("$setOnInsert", {})))
        inserted.update(copy.deepcopy(update.get("$set", {})))
        self.rows.append(inserted)
        return SimpleNamespace(modified_count=0, upserted_id=inserted.get("id"))

    async def delete_many(self, query: dict):
        previous = len(self.rows)
        self.rows = [row for row in self.rows if not _matches(row, query)]
        return SimpleNamespace(deleted_count=previous - len(self.rows))


def _load_migration(db, version="v5"):
    tree = ast.parse(SERVER.read_text(encoding="utf-8"))
    function = next(
        node
        for node in tree.body
        if isinstance(node, ast.AsyncFunctionDef)
        and node.name == "_hidden_object_migrate_campaign_progress"
    )
    namespace = {
        "db": db,
        "HIDDEN_OBJECT_V5_LEGACY_LEVEL_MAP": {4: 7, 5: 8, 6: 9},
        "_hidden_object_catalog_version": lambda: version,
        "now_iso": lambda: "2026-09-04T12:00:00+00:00",
        "uuid": SimpleNamespace(uuid4=lambda: "migration-id"),
    }
    ast.fix_missing_locations(function)
    exec(
        compile(ast.Module(body=[function], type_ignores=[]), str(SERVER), "exec"),
        namespace,
    )
    return namespace["_hidden_object_migrate_campaign_progress"]


def _db(completions: list[dict], profile: dict):
    return SimpleNamespace(
        hidden_object_completions=_Collection(completions),
        hidden_object_profiles=_Collection([profile]),
    )


def test_migration_uses_a_dedicated_marker_and_protects_v5_medium_clears() -> None:
    profile = {"user_id": "u1", "content_version": "v5"}
    db = _db(
        [
            {"id": "old-4", "user_id": "u1", "level": 4, "stars": 3, "best_time": 90},
            {"id": "old-5", "user_id": "u1", "level": 5, "content_version": "v4", "stars": 2},
            {"id": "medium-6", "user_id": "u1", "level": 6, "content_version": "v5", "stars": 1},
        ],
        profile,
    )
    migrate = _load_migration(db)

    result = asyncio.run(migrate("u1", profile))

    by_level = {row["level"]: row for row in db.hidden_object_completions.rows}
    assert sorted(by_level) == [6, 7, 8]
    assert by_level[6]["id"] == "medium-6"
    assert by_level[7]["stars"] == 3
    assert by_level[7]["migrated_from_level"] == 4
    assert by_level[7]["content_version"] == "v5"
    assert by_level[8]["migrated_from_content_version"] == "v4"
    assert result["v5_progress_migrated"] is True
    assert db.hidden_object_profiles.rows[0]["v5_progress_migrated"] is True

    rows_after_first_run = copy.deepcopy(db.hidden_object_completions.rows)
    completion_updates = db.hidden_object_completions.update_calls
    result = asyncio.run(migrate("u1", result))
    assert db.hidden_object_completions.rows == rows_after_first_run
    assert db.hidden_object_completions.update_calls == completion_updates


def test_interrupted_copy_keeps_sources_and_can_be_retried() -> None:
    profile = {"user_id": "u2", "content_version": "v4"}
    db = _db(
        [
            {"id": "old-4", "user_id": "u2", "level": 4, "stars": 3},
            {"id": "old-5", "user_id": "u2", "level": 5, "stars": 2},
            {"id": "old-6", "user_id": "u2", "level": 6, "stars": 1},
        ],
        profile,
    )
    migrate = _load_migration(db)
    db.hidden_object_completions.fail_on_level = 8

    try:
        asyncio.run(migrate("u2", profile))
    except RuntimeError as error:
        assert str(error) == "simulated interrupted migration"
    else:
        raise AssertionError("Expected the simulated interruption")

    assert {row["level"] for row in db.hidden_object_completions.rows} == {4, 5, 6, 7}
    assert "v5_progress_migrated" not in db.hidden_object_profiles.rows[0]

    db.hidden_object_completions.fail_on_level = None
    result = asyncio.run(migrate("u2", profile))

    assert {row["level"] for row in db.hidden_object_completions.rows} == {7, 8, 9}
    assert result["v5_progress_migrated"] is True


def test_new_completions_are_tagged_with_the_current_catalog_version() -> None:
    source = SERVER.read_text(encoding="utf-8")
    completion = source.split("async def hidden_object_complete", 1)[1].split(
        "async def seed_hidden_objects_v157", 1
    )[0]

    assert '"content_version": _hidden_object_catalog_version()' in completion


def test_direct_v4_to_v6_upgrade_does_not_move_v5_or_v6_medium_clears():
    profile = {"user_id": "u3", "content_version": "v4"}
    db = _db([
        {"id": "legacy", "user_id": "u3", "level": 4, "content_version": "v4", "stars": 3},
        {"id": "medium5", "user_id": "u3", "level": 5, "content_version": "v5", "stars": 2},
        {"id": "medium6", "user_id": "u3", "level": 6, "content_version": "v6", "stars": 1},
    ], profile)
    result = asyncio.run(_load_migration(db, "v6")("u3", profile))
    by_level = {row["level"]: row for row in db.hidden_object_completions.rows}
    assert sorted(by_level) == [5, 6, 7]
    assert by_level[5]["id"] == "medium5"
    assert by_level[6]["id"] == "medium6"
    assert by_level[7]["stars"] == 3
    assert result["content_version"] == "v6"
    assert result["v5_progress_migrated"] is True


def test_v6_upgrade_preserves_already_migrated_progress():
    profile = {"user_id": "u4", "content_version": "v5", "v5_progress_migrated": True}
    completions = [{"id": "same", "user_id": "u4", "level": 7, "content_version": "v5", "stars": 3}]
    db = _db(completions, profile)
    result = asyncio.run(_load_migration(db, "v6")("u4", profile))
    assert db.hidden_object_completions.rows == completions
    assert db.hidden_object_completions.update_calls == 0
    assert result["content_version"] == "v6"
