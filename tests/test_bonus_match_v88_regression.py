"""Dependency-free regression checks for Bonus Match v88."""
from __future__ import annotations

import ast
import copy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "backend" / "server.py"
FRONTEND = ROOT / "frontend" / "src" / "pages" / "BonusMatch.jsx"


def _server_tree() -> ast.Module:
    return ast.parse(SERVER.read_text(encoding="utf-8"))


def _assignment(name: str):
    for node in _server_tree().body:
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == name:
                    return ast.literal_eval(node.value)
    raise AssertionError(f"Missing assignment: {name}")


def test_prices_and_labels() -> None:
    assert _assignment("BONUS_MATCH_LIFE_PRICE") == 10
    boosters = _assignment("BONUS_MATCH_BOOSTERS")
    assert {key: item["price"] for key, item in boosters.items()} == {
        "hammer": 10,
        "rocket": 20,
        "color_bomb": 50,
        "shuffle": 30,
    }
    assert boosters["color_bomb"]["label"] == "Веселковий джокер"


def _load_advance_obstacles():
    tree = _server_tree()
    function = next(
        node for node in tree.body
        if isinstance(node, ast.FunctionDef) and node.name == "_bonus_match_advance_obstacles"
    )
    module = ast.Module(body=[function], type_ignores=[])
    ast.fix_missing_locations(module)

    def nearby(row, col, include_self=True):
        cells = {(row - 1, col), (row + 1, col), (row, col - 1), (row, col + 1)}
        if include_self:
            cells.add((row, col))
        return {(r, c) for r, c in cells if 0 <= r < 7 and 0 <= c < 7}

    def cell_symbol(cell):
        return cell.get("symbol") if cell else None

    def apply_obstacle(board, row, col, obstacle):
        board[row][col]["obstacle"] = obstacle
        board[row][col]["obstacle_hits"] = 1
        board[row][col]["obstacle_age"] = 0
        return board[row][col]

    namespace = {
        "Optional": object,
        "BONUS_MATCH_ROWS": 7,
        "BONUS_MATCH_COLS": 7,
        "_bonus_match_clone_board": copy.deepcopy,
        "_bonus_match_nearby_cells": nearby,
        "_bonus_match_cell_symbol": cell_symbol,
        "_bonus_match_apply_obstacle": apply_obstacle,
    }
    exec(compile(module, str(SERVER), "exec"), namespace)
    return namespace["_bonus_match_advance_obstacles"]


def _web_board():
    board = [[None for _ in range(7)] for _ in range(7)]
    board[3][3] = {
        "id": "web-source",
        "symbol": "star",
        "special": None,
        "obstacle": "web",
        "obstacle_hits": 1,
        "obstacle_age": 2,
    }
    board[3][4] = {
        "id": "target",
        "symbol": "coin",
        "special": None,
        "obstacle": None,
        "obstacle_hits": 0,
        "obstacle_age": 0,
    }
    return board


def test_destroyed_web_stops_spread_for_turn() -> None:
    advance = _load_advance_obstacles()
    board, events = advance(
        _web_board(),
        [{"row": 1, "col": 1, "obstacle": "web", "destroyed": True}],
    )
    assert not any(event.get("effect") == "web_spread" for event in events)
    assert board[3][4].get("obstacle") is None


def test_untouched_ready_web_can_still_spread() -> None:
    advance = _load_advance_obstacles()
    board, events = advance(_web_board(), [])
    assert any(event.get("effect") == "web_spread" for event in events)
    assert board[3][4].get("obstacle") == "web"


def test_frontend_features_are_wired() -> None:
    source = FRONTEND.read_text(encoding="utf-8")
    required = [
        'user?.role === "admin"',
        'document.documentElement.requestFullscreen()',
        'api.post("/games/bonus-match/lives/purchase")',
        'api.post("/games/bonus-match/surrender"',
        'data-render-engine="v88"',
        'label: "Веселковий джокер"',
    ]
    for token in required:
        assert token in source, token


if __name__ == "__main__":
    test_prices_and_labels()
    test_destroyed_web_stops_spread_for_turn()
    test_untouched_ready_web_can_still_spread()
    test_frontend_features_are_wired()
    print("Bonus Match v88 regression checks passed")
