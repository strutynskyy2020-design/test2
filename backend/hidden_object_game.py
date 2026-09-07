"""Pure helpers for the VPDK Hidden Objects game.

The HTTP layer and persistence stay in ``server.py`` to match the existing
application structure.  Geometry, scoring and manifest validation live here so
they can be tested without importing the whole FastAPI application.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


HIDDEN_OBJECT_MISTAKE_LIMITS = {
    "easy": 15,
    "medium": 10,
    "hard": 5,
}


def hidden_object_mistake_limit(level: dict) -> int:
    """Return the authoritative wrong-click limit for a level difficulty."""

    difficulty = str(level.get("difficulty") or "medium").strip().lower()
    return HIDDEN_OBJECT_MISTAKE_LIMITS.get(difficulty, HIDDEN_OBJECT_MISTAKE_LIMITS["medium"])


def hidden_object_apply_miss(level: dict, current_mistakes: int) -> tuple[int, int, bool]:
    """Advance the miss counter without allowing it to exceed its limit."""

    limit = hidden_object_mistake_limit(level)
    mistakes = min(limit, max(0, int(current_mistakes)) + 1)
    return mistakes, max(0, limit - mistakes), mistakes >= limit


def load_hidden_object_catalog(path: Path) -> tuple[dict[str, Any], dict[str, dict], dict[int, dict]]:
    catalog = json.loads(path.read_text(encoding="utf-8"))
    scenes = catalog.get("scenes")
    levels = catalog.get("levels")
    if not isinstance(scenes, list) or not scenes:
        raise ValueError("Hidden Objects catalog must contain scenes")
    if not isinstance(levels, list) or not levels:
        raise ValueError("Hidden Objects catalog must contain levels")

    scenes_by_id: dict[str, dict] = {}
    for scene in scenes:
        scene_id = str(scene.get("id") or "").strip()
        if not scene_id or scene_id in scenes_by_id:
            raise ValueError(f"Invalid or duplicate scene id: {scene_id!r}")
        if not str(scene.get("image") or "").startswith("/"):
            raise ValueError(f"Scene {scene_id} has an invalid image path")
        if int(scene.get("width", 0)) <= 0 or int(scene.get("height", 0)) <= 0:
            raise ValueError(f"Scene {scene_id} has invalid dimensions")

        objects_by_id: dict[str, dict] = {}
        for item in scene.get("objects") or []:
            object_id = str(item.get("id") or "").strip()
            if not object_id or object_id in objects_by_id:
                raise ValueError(f"Scene {scene_id} has an invalid object id")
            for key in ("x", "y", "rx", "ry"):
                if not isinstance(item.get(key), (int, float)):
                    raise ValueError(f"Object {scene_id}/{object_id} is missing {key}")
            x, y = float(item["x"]), float(item["y"])
            rx, ry = float(item["rx"]), float(item["ry"])
            if not (0 <= x <= 1 and 0 <= y <= 1 and 0 < rx <= 0.3 and 0 < ry <= 0.3):
                raise ValueError(f"Object {scene_id}/{object_id} has invalid hit geometry")
            if not str(item.get("label") or "").strip():
                raise ValueError(f"Object {scene_id}/{object_id} is missing a label")
            objects_by_id[object_id] = dict(item)

        if len(objects_by_id) < 4:
            raise ValueError(f"Scene {scene_id} must contain at least four objects")
        scene_copy = dict(scene)
        scene_copy["objects_by_id"] = objects_by_id
        scenes_by_id[scene_id] = scene_copy

    levels_by_id: dict[int, dict] = {}
    for level in levels:
        level_id = int(level.get("id", 0))
        if level_id <= 0 or level_id in levels_by_id:
            raise ValueError(f"Invalid or duplicate level id: {level_id}")
        scene_id = str(level.get("scene_id") or "")
        scene = scenes_by_id.get(scene_id)
        if not scene:
            raise ValueError(f"Level {level_id} references an unknown scene")
        target_ids = [str(value) for value in level.get("target_ids") or []]
        if len(target_ids) < 4 or len(target_ids) != len(set(target_ids)):
            raise ValueError(f"Level {level_id} has an invalid target list")
        missing = [value for value in target_ids if value not in scene["objects_by_id"]]
        if missing:
            raise ValueError(f"Level {level_id} references missing targets: {missing}")
        if int(level.get("par_time", 0)) < 30:
            raise ValueError(f"Level {level_id} has an invalid par time")
        if not 0 <= int(level.get("hints", 0)) <= 10:
            raise ValueError(f"Level {level_id} has an invalid hint count")
        levels_by_id[level_id] = dict(level)

    expected_ids = list(range(1, len(levels_by_id) + 1))
    if sorted(levels_by_id) != expected_ids:
        raise ValueError("Hidden Objects level ids must be contiguous and start at 1")
    return catalog, scenes_by_id, levels_by_id


def hidden_object_contains(item: dict, x: float, y: float, tolerance: float = 0.012) -> bool:
    """Return whether a normalized point falls inside an elliptical hit area."""

    rx = max(0.001, float(item["rx"]) + max(0.0, tolerance))
    ry = max(0.001, float(item["ry"]) + max(0.0, tolerance))
    dx = (float(x) - float(item["x"])) / rx
    dy = (float(y) - float(item["y"])) / ry
    return (dx * dx) + (dy * dy) <= 1.0


def hidden_object_stars(level: dict, elapsed: int, mistakes: int, hints_used: int) -> tuple[int, int]:
    effective_time = max(0, int(elapsed)) + max(0, int(mistakes)) * 5 + max(0, int(hints_used)) * 15
    par_time = max(30, int(level.get("par_time", 180)))
    if effective_time <= par_time:
        return 3, effective_time
    if effective_time <= round(par_time * 1.5):
        return 2, effective_time
    return 1, effective_time


def hidden_object_public_level(level: dict, scene: dict) -> dict:
    return {
        "id": int(level["id"]),
        "title": level.get("title", f"Рівень {level['id']}"),
        "description": level.get("description", ""),
        "chapter": level.get("chapter", "Справи детектива"),
        "difficulty": level.get("difficulty", "medium"),
        "scene_id": scene["id"],
        "image": scene["image"],
        "image_width": int(scene["width"]),
        "image_height": int(scene["height"]),
        "target_count": len(level.get("target_ids") or []),
        "par_time": int(level.get("par_time", 180)),
        "hints": int(level.get("hints", 0)),
        "mistake_limit": hidden_object_mistake_limit(level),
    }


def hidden_object_targets(level: dict, scene: dict) -> list[dict]:
    objects = scene["objects_by_id"]
    return [
        {
            "id": object_id,
            "label": objects[object_id]["label"],
            "icon": objects[object_id].get("icon", "search"),
        }
        for object_id in level.get("target_ids") or []
    ]
