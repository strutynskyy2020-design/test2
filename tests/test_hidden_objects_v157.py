from __future__ import annotations

import importlib.util
import struct
import hashlib
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
MANIFEST = BACKEND / "hidden_object_levels.json"
SERVER = BACKEND / "server.py"


def load_game_module():
    spec = importlib.util.spec_from_file_location(
        "hidden_object_game", BACKEND / "hidden_object_game.py"
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def image_size(path: Path) -> tuple[int, int]:
    data = path.read_bytes()
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return struct.unpack(">II", data[16:24])
    assert data[:4] == b"RIFF" and data[8:12] == b"WEBP", path
    offset = 12
    while offset + 8 <= len(data):
        kind = data[offset:offset + 4]
        size = int.from_bytes(data[offset + 4:offset + 8], "little")
        chunk = data[offset + 8:offset + 8 + size]
        if kind == b"VP8X":
            return int.from_bytes(chunk[4:7], "little") + 1, int.from_bytes(chunk[7:10], "little") + 1
        if kind == b"VP8 ":
            assert chunk[3:6] == b"\x9d\x01\x2a", path
            width, height = struct.unpack("<HH", chunk[6:10])
            return width & 0x3FFF, height & 0x3FFF
        if kind == b"VP8L":
            assert chunk[0] == 0x2F, path
            dimensions = int.from_bytes(chunk[1:5], "little")
            return (dimensions & 0x3FFF) + 1, ((dimensions >> 14) & 0x3FFF) + 1
        offset += 8 + size + (size % 2)
    raise AssertionError(f"No image dimensions in {path}")


def test_catalog_and_generated_artwork_are_valid() -> None:
    game = load_game_module()
    catalog, scenes, levels = game.load_hidden_object_catalog(MANIFEST)

    assert catalog["version"] == "v6"
    assert sorted(levels) == list(range(1, 55))
    assert len(scenes) == 54

    campaign_scene_ids = [levels[level_id]["scene_id"] for level_id in sorted(levels)]
    assert len(set(campaign_scene_ids)) == 54
    assert set(campaign_scene_ids) == set(scenes)
    assert len({scenes[scene_id]["image"] for scene_id in campaign_scene_ids}) == 54

    for scene in scenes.values():
        image = FRONTEND / "public" / scene["image"].lstrip("/")
        assert image.is_file()
        assert image_size(image) == (scene["width"], scene["height"])


def test_all_campaign_scenes_are_wide_panoramas() -> None:
    game = load_game_module()
    _catalog, scenes, levels = game.load_hidden_object_catalog(MANIFEST)

    for level_id in levels:
        scene = scenes[levels[level_id]["scene_id"]]
        image = FRONTEND / "public" / scene["image"].lstrip("/")
        actual_width, actual_height = image_size(image)
        assert (actual_width, actual_height) == (scene["width"], scene["height"])
        assert actual_width >= actual_height * 1.5, (
            f"Level {level_id} is not panoramic: {actual_width}x{actual_height}"
        )


def test_every_target_has_a_server_verified_hit_area() -> None:
    game = load_game_module()
    _catalog, scenes, levels = game.load_hidden_object_catalog(MANIFEST)

    for level in levels.values():
        scene = scenes[level["scene_id"]]
        for target_id in level["target_ids"]:
            target = scene["objects_by_id"][target_id]
            assert game.hidden_object_contains(target, target["x"], target["y"])

    first_level = levels[1]
    first_scene = scenes[first_level["scene_id"]]
    first = first_scene["objects_by_id"][first_level["target_ids"][0]]
    assert not game.hidden_object_contains(first, 0.0, 0.0)


def test_campaign_difficulty_target_and_hint_progression() -> None:
    game = load_game_module()
    _catalog, scenes, levels = game.load_hidden_object_catalog(MANIFEST)

    expected = {
        1: ("easy", 6, 15),
        2: ("easy", 6, 15),
        3: ("easy", 6, 15),
        4: ("medium", 9, 10),
        5: ("medium", 10, 10),
        6: ("medium", 11, 10),
        7: ("hard", 12, 5),
        8: ("hard", 14, 5),
        9: ("hard", 16, 5),
    }

    for level_id, (difficulty, target_count, mistake_limit) in expected.items():
        level = levels[level_id]
        assert level["difficulty"] == difficulty
        assert len(level["target_ids"]) == target_count
        assert game.hidden_object_mistake_limit(level) == mistake_limit

    assert [levels[level_id]["hints"] for level_id in (4, 5, 6)] == [2, 2, 2]
    assert [levels[level_id]["hints"] for level_id in (7, 8, 9)] == [2, 1, 1]


def test_target_hit_areas_do_not_overlap() -> None:
    game = load_game_module()
    _catalog, scenes, levels = game.load_hidden_object_catalog(MANIFEST)

    tolerance = 0.012
    for level_id in levels:
        level = levels[level_id]
        objects = scenes[level["scene_id"]]["objects_by_id"]
        targets = [objects[target_id] for target_id in level["target_ids"]]
        for target in targets:
            assert target["rx"] <= target["x"] <= 1 - target["rx"]
            assert target["ry"] <= target["y"] <= 1 - target["ry"]
        for index, first in enumerate(targets):
            for second in targets[index + 1:]:
                combined_rx = first["rx"] + second["rx"] + (2 * tolerance)
                combined_ry = first["ry"] + second["ry"] + (2 * tolerance)
                normalized_distance = (
                    ((first["x"] - second["x"]) / combined_rx) ** 2
                    + ((first["y"] - second["y"]) / combined_ry) ** 2
                )
                assert normalized_distance > 1, (
                    f"Overlapping target areas in level {level_id}: "
                    f"{first['id']} / {second['id']}"
                )


def test_panorama_targets_cover_left_center_and_right() -> None:
    game = load_game_module()
    _catalog, scenes, levels = game.load_hidden_object_catalog(MANIFEST)

    for level_id in levels:
        level = levels[level_id]
        objects = scenes[level["scene_id"]]["objects_by_id"]
        xs = [float(objects[target_id]["x"]) for target_id in level["target_ids"]]
        counts = {
            "left": sum(x < 1 / 3 for x in xs),
            "center": sum(1 / 3 <= x <= 2 / 3 for x in xs),
            "right": sum(x > 2 / 3 for x in xs),
        }
        assert min(counts.values()) >= 2, f"Level {level_id} target spread: {counts}"


def test_star_rules_include_mistake_and_hint_penalties() -> None:
    game = load_game_module()
    level = {"par_time": 100}

    assert game.hidden_object_stars(level, 70, 0, 0) == (3, 70)
    assert game.hidden_object_stars(level, 95, 2, 0) == (2, 105)
    assert game.hidden_object_stars(level, 130, 2, 1) == (1, 155)


def test_public_level_payload_does_not_expose_hitboxes() -> None:
    game = load_game_module()
    _catalog, scenes, levels = game.load_hidden_object_catalog(MANIFEST)

    expected_limits = {"easy": 15, "medium": 10, "hard": 5}
    for level in levels.values():
        scene = scenes[level["scene_id"]]
        payload = game.hidden_object_public_level(level, scene)
        targets = game.hidden_object_targets(level, scene)

        assert "objects" not in payload
        assert "target_ids" not in payload
        assert payload["mistake_limit"] == expected_limits[level["difficulty"]]
        assert all(set(item) == {"id", "label", "icon", "image"} for item in targets)


def test_expansion_is_45_unique_illustrations_and_correct_difficulty_counts():
    game = load_game_module()
    _catalog, scenes, levels = game.load_hidden_object_catalog(MANIFEST)
    assert Counter(level["difficulty"] for level in levels.values()) == {"easy": 3, "medium": 23, "hard": 28}
    new_levels = [level for level in levels.values() if level["id"] > 9]
    assert Counter(level["difficulty"] for level in new_levels) == {"medium": 20, "hard": 25}
    hashes = set()
    for level in new_levels:
        scene = scenes[level["scene_id"]]
        hashes.add(hashlib.sha256((FRONTEND / "public" / scene["image"].lstrip("/")).read_bytes()).hexdigest())
        assert len(level["target_ids"]) >= (10 if level["difficulty"] == "medium" else 12)
    assert len(hashes) == 45


def test_every_picture_clue_exists_and_target_order_is_stable_per_attempt():
    game = load_game_module()
    _catalog, scenes, levels = game.load_hidden_object_catalog(MANIFEST)
    for level in levels.values():
        scene = scenes[level["scene_id"]]
        first = game.hidden_object_targets(level, scene, "session-a")
        assert first == game.hidden_object_targets(level, scene, "session-a")
        ids = [item["id"] for item in first]
        assert set(ids) == set(level["target_ids"])
        orders = {tuple(item["id"] for item in game.hidden_object_targets(level, scene, f"session-{i}")) for i in range(8)}
        assert len(orders) > 1
        assert any(list(order) != sorted(order, key=lambda oid: scene["objects_by_id"][oid]["x"]) for order in orders)
        for clue in first:
            assert clue["image"].startswith("/hidden-objects/optimized/v6/targets/")
            width, height = image_size(FRONTEND / "public" / clue["image"].lstrip("/"))
            assert width > 5 and height > 5


def test_hidden_objects_replaces_sudoku_in_runtime_wiring() -> None:
    app = (FRONTEND / "src" / "App.js").read_text(encoding="utf-8")
    home = (FRONTEND / "src" / "pages" / "Home.jsx").read_text(encoding="utf-8")
    campaign = (FRONTEND / "src" / "components" / "PixelCampaignViews.jsx").read_text(encoding="utf-8")
    server = SERVER.read_text(encoding="utf-8")

    assert 'path="/games/hidden-objects"' in app
    assert 'nav("/pet/room")' in home
    assert 'route: "/games/hidden-objects?from=pixel"' in campaign
    assert '@api.get("/games/hidden-objects/status")' in server
    assert '@api.post("/games/hidden-objects/action")' in server
    assert '@api.post("/games/hidden-objects/complete")' in server
    assert '/games/sudoku' not in server.lower()
    assert not (FRONTEND / "src" / "pages" / "Sudoku.jsx").exists()
    assert not (FRONTEND / "src" / "styles" / "sudoku.css").exists()
    assert not (BACKEND / "sudoku_levels.json").exists()


def test_completion_accepts_only_a_server_session_id() -> None:
    server = SERVER.read_text(encoding="utf-8")
    body = server.split("class HiddenObjectCompleteBody", 1)[1].split(
        "def _hidden_object_elapsed", 1
    )[0]

    assert "session_id" in body
    assert "stars" not in body
    assert "found_ids" not in body
    assert "points" not in body
    assert "source_key" in server
    assert "game_reward_keys" in server


def test_session_and_reward_updates_are_concurrency_guarded() -> None:
    server = SERVER.read_text(encoding="utf-8")

    assert '"last_sequence": last_sequence' in server
    assert "return_document=ReturnDocument.AFTER" in server
    assert '"status": "completing"' in server
    assert 'partialFilterExpression={"status": "active"}' in server
    assert '"$max": {"stars": stars}' in server
    assert "HIDDEN_OBJECT_REPLAY_REWARDS_PER_DAY = 1" in server
    assert "hidden_object_replay:{user['id']}:{reward_day}" in server
    assert "_hidden_object_retire_stale_active_sessions" in server
    assert '"content_version": {"$ne": _hidden_object_catalog_version()}' in server
