from __future__ import annotations

import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "backend" / "server.py"
ADMIN = ROOT / "frontend" / "src" / "pages" / "Admin.jsx"
FUN = ROOT / "frontend" / "src" / "pages" / "Fun.jsx"
SW = ROOT / "frontend" / "public" / "service-worker.js"


def assignment(name: str):
    tree = ast.parse(SERVER.read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == name:
                    return ast.literal_eval(node.value)
    raise AssertionError(name)


def test_default_cube_economy_is_preserved() -> None:
    assert assignment("DEFAULT_CUBE_SPIN_COST") == 20
    assert assignment("DEFAULT_CUBE_REWARD_RANGES") == [
        {"face": 1, "min_reward": 1, "max_reward": 10},
        {"face": 2, "min_reward": 11, "max_reward": 20},
        {"face": 3, "min_reward": 21, "max_reward": 30},
        {"face": 4, "min_reward": 31, "max_reward": 50},
        {"face": 5, "min_reward": 51, "max_reward": 100},
        {"face": 6, "min_reward": 101, "max_reward": 500},
    ]


def test_backend_uses_editable_cube_settings() -> None:
    source = SERVER.read_text(encoding="utf-8")
    assert 'db.app_settings.find_one({"id": "generous_cube"}' in source
    assert '@api.get("/admin/cube-settings")' in source
    assert '@api.patch("/admin/cube-settings")' in source
    assert 'settings = await _cube_settings()' in source
    assert 'cost = 0 if spin_count == 0 else settings["paid_spin_cost"]' in source
    assert 'cube_table = _cube_roll_table(settings)' in source
    assert 'cube_reward_ranges=settings["rewards"]' in source


def test_admin_has_cube_editor() -> None:
    source = ADMIN.read_text(encoding="utf-8")
    assert '{ id: "cube-settings", label: "Щедрий куб", icon: Dice5 }' in source
    assert 'api.get("/admin/cube-settings")' in source
    assert 'api.patch("/admin/cube-settings"' in source
    assert 'data-testid="cube-paid-spin-cost"' in source
    for face in range(1, 7):
        assert f'cube-face-setting-${{item.face}}' in source


def test_player_cube_screen_is_dynamic() -> None:
    source = FUN.read_text(encoding="utf-8")
    assert "status?.cube_reward_ranges" in source
    assert "status?.paid_spin_cost" in source
    assert "cubeMaximumReward" in source
    assert "cubeRewardRanges.map" in source
    assert "наступні — {paidSpinCost" in source


def test_service_worker_bumped() -> None:
    assert 'const VERSION = "vpdk-v146";' in SW.read_text(encoding="utf-8")
