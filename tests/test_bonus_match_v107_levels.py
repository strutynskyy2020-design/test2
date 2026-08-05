"""Dependency-free checks for the v107 Bonus Match expansion."""
from __future__ import annotations

import ast
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "backend" / "server.py"
BACKEND_LEVELS = ROOT / "backend" / "bonus_match_levels.json"
FRONTEND_LEVELS = ROOT / "frontend" / "src" / "data" / "bonusMatchLevels.json"
FRONTEND_GAME = ROOT / "frontend" / "src" / "pages" / "BonusMatch.jsx"


def _assignment(name: str):
    tree = ast.parse(SERVER.read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == name:
                    return ast.literal_eval(node.value)
    raise AssertionError(f"Missing assignment: {name}")


def test_catalog_has_150_levels_in_both_runtimes() -> None:
    backend = json.loads(BACKEND_LEVELS.read_text(encoding="utf-8"))
    frontend = json.loads(FRONTEND_LEVELS.read_text(encoding="utf-8"))
    assert backend == frontend
    assert [item["level"] for item in backend] == list(range(1, 151))
    assert _assignment("BONUS_MATCH_DEFAULT_LEVEL_COUNT") == 150


def test_new_levels_are_materially_harder() -> None:
    levels = json.loads(BACKEND_LEVELS.read_text(encoding="utf-8"))
    old_final = levels[49]
    new_levels = levels[50:]
    assert min(item["target_score"] for item in new_levels) > old_final["target_score"]
    assert max(item["moves"] for item in new_levels) < old_final["moves"]
    assert min(len(item["obstacle_layout"]) for item in new_levels) >= 10
    assert levels[-1]["target_score"] >= 55_000
    assert levels[-1]["is_boss"] is True


def test_first_clear_reward_is_two_points() -> None:
    assert _assignment("BONUS_MATCH_FIRST_CLEAR_POINTS") == 2
    source = SERVER.read_text(encoding="utf-8")
    assert "First clear of a level: +2 Point and +10 XP." in source
    assert '"reward_policy": "v139_first_2_points_10_xp_replay_5_xp"' in source
    frontend = FRONTEND_GAME.read_text(encoding="utf-8")
    assert "points_awarded: won ? 2 : 0" in frontend
    assert "length: 150" in frontend


if __name__ == "__main__":
    test_catalog_has_150_levels_in_both_runtimes()
    test_new_levels_are_materially_harder()
    test_first_clear_reward_is_two_points()
    print("Bonus Match v139 reward checks passed")
