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


def function(name: str):
    tree = ast.parse(SERVER.read_text(encoding="utf-8"))
    node = next(item for item in tree.body if isinstance(item, ast.FunctionDef) and item.name == name)
    namespace: dict[str, object] = {}
    exec(compile(ast.Module(body=[node], type_ignores=[]), str(SERVER), "exec"), namespace)
    return namespace[name]


def test_game_rewards_are_reduced() -> None:
    assert assignment("BONUS_MATCH_FIRST_CLEAR_POINTS") == 2
    assert assignment("SUDOKU_FIRST_CLEAR_POINTS") == 2


def test_cube_economy_v139() -> None:
    assert assignment("CUBE_SPIN_COST") == 20
    assert assignment("CUBE_TABLE") == [
        (1, 37, 1, 10, "one"),
        (2, 28, 11, 20, "two"),
        (3, 20, 21, 30, "three"),
        (4, 10, 31, 50, "four"),
        (5, 4, 51, 100, "five"),
        (6, 1, 101, 500, "six"),
    ]


def test_ai_score_maps_to_same_point_value() -> None:
    reward = function("ai_trainer_points_for_score")
    assert reward("easy", 4.9) == 0
    assert reward("easy", 5.0) == 5
    assert reward("medium", 6.0) == 6
    assert reward("hard", 7.0) == 7
    assert reward("hard", 8.0) == 8
    assert reward("hard", 9.0) == 9
    assert reward("hard", 10.0) == 10


def test_ai_repeat_protection_is_wired() -> None:
    source = SERVER.read_text(encoding="utf-8")
    assert "ai_training_completions.find_one_and_update" in source
    assert "return_document=ReturnDocument.BEFORE" in source
    assert "except DuplicateKeyError" in source
    assert "backfill_ai_training_completions_v139" in source
