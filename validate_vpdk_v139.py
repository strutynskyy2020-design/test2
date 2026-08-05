from __future__ import annotations

import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SERVER = ROOT / "backend" / "server.py"
FUN = ROOT / "frontend" / "src" / "pages" / "Fun.jsx"
ADMIN = ROOT / "frontend" / "src" / "pages" / "Admin.jsx"
AI_PAGE = ROOT / "frontend" / "src" / "pages" / "AITrainer.jsx"
AI_DATA = ROOT / "frontend" / "src" / "data" / "aiTrainerScenarios.js"
BONUS = ROOT / "frontend" / "src" / "pages" / "BonusMatch.jsx"
SUDOKU = ROOT / "frontend" / "src" / "pages" / "Sudoku.jsx"
HOME = ROOT / "frontend" / "src" / "pages" / "Home.jsx"
SW = ROOT / "frontend" / "public" / "service-worker.js"


def assignments() -> dict[str, object]:
    tree = ast.parse(SERVER.read_text(encoding="utf-8"))
    result: dict[str, object] = {}
    for node in tree.body:
        if not isinstance(node, ast.Assign):
            continue
        for target in node.targets:
            if isinstance(target, ast.Name):
                try:
                    result[target.id] = ast.literal_eval(node.value)
                except Exception:
                    pass
    return result


def function_node(name: str) -> ast.FunctionDef:
    tree = ast.parse(SERVER.read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return node
    raise AssertionError(f"Missing function: {name}")


values = assignments()
server = SERVER.read_text(encoding="utf-8")
fun = FUN.read_text(encoding="utf-8")
admin = ADMIN.read_text(encoding="utf-8")
ai_page = AI_PAGE.read_text(encoding="utf-8")
ai_data = AI_DATA.read_text(encoding="utf-8")
bonus = BONUS.read_text(encoding="utf-8")
sudoku = SUDOKU.read_text(encoding="utf-8")
home = HOME.read_text(encoding="utf-8")
sw = SW.read_text(encoding="utf-8")

assert values["BONUS_MATCH_FIRST_CLEAR_POINTS"] == 2
assert values["SUDOKU_FIRST_CLEAR_POINTS"] == 2
assert values["CUBE_SPIN_COST"] == 20
assert values["CUBE_TABLE"] == [
    (1, 37, 1, 10, "one"),
    (2, 28, 11, 20, "two"),
    (3, 20, 21, 30, "three"),
    (4, 10, 31, 50, "four"),
    (5, 4, 51, 100, "five"),
    (6, 1, 101, 500, "six"),
]

reward_namespace: dict[str, object] = {}
exec(compile(ast.Module(body=[function_node("ai_trainer_points_for_score")], type_ignores=[]), str(SERVER), "exec"), reward_namespace)
reward_fn = reward_namespace["ai_trainer_points_for_score"]
assert reward_fn("easy", 4.9) == 0
assert reward_fn("easy", 5.0) == 5
assert reward_fn("medium", 5.4) == 5
assert reward_fn("hard", 5.5) == 6
assert reward_fn("hard", 9.5) == 10
assert reward_fn("hard", 10.0) == 10

assert "v139_first_2_points_10_xp_replay_5_xp" in server
assert "points_awarded: won ? 2 : 0" in bonus
assert "points_awarded: !completions[currentLevel.id] ? 2 : 0" in sudoku

assert "return score < 5 ? 0 : Math.max(5, Math.min(10, Math.round(score)))" in ai_data
for score in range(5, 11):
    assert f"({score}.0, {score})" in server
assert "ai_training_completions.find_one_and_update" in server
assert "return_document=ReturnDocument.BEFORE" in server
assert "except DuplicateKeyError" in server
assert "async def backfill_ai_training_completions_v139" in server
assert "backfilled_v139" in server
assert 'await db.ai_training_completions.create_index([("user_id", 1), ("scenario_id", 1)], unique=True)' in server
assert "points=Number(data?.reward_applied??points)" in ai_page
assert "firstCompletion=Boolean(data?.first_completion)" in ai_page
assert "лише вперше" in ai_page

for label in ("1–10", "11–20", "21–30", "31–50", "51–100", "101–500"):
    assert label in fun
assert "наступні — по 20 Point" in fun
assert "Кидай і забирай до 500 Point" in fun
assert "До 500 балів" in home

assert 'data-testid="users-search"' in admin
assert 'data-testid="points-search"' in admin
assert "[10, 20, 30, 40, 50].map" in admin
assert "quick-add-${value}" in admin
assert "Швидке нарахування" in admin

assert 'const VERSION = "vpdk-v139";' in sw

print("v139 reward economy and admin tools validation passed")
