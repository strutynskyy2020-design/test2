from pathlib import Path
import ast

ROOT = Path(__file__).resolve().parent
SERVER = (ROOT / "backend/server.py").read_text()
LEADERBOARD = (ROOT / "frontend/src/pages/Leaderboard.jsx").read_text()
TEAMS = (ROOT / "frontend/src/pages/Teams.jsx").read_text()
SW = (ROOT / "frontend/public/service-worker.js").read_text()

module = ast.parse(SERVER)
functions = {node.name: node for node in module.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))}

assert "_transaction_scores" in functions
assert "_leaderboard_for_period" in functions
assert "team_leaderboard" in functions

leaderboard_start = SERVER.index("class LeaderboardEntry")
leaderboard_end = SERVER.index("# Games: daily cube", leaderboard_start)
block = SERVER[leaderboard_start:leaderboard_end]

# Positive rewards and negative spending transactions must be summed together.
assert '"score": {"$sum": "$amount"}' in block
assert '"amount": {"$gt": 0}' not in block

# All-time rating is the actual remaining balance, not lifetime gross earnings.
assert 'item.get("balance", 0)' in block
assert 'item.get("total_earned", 0)' not in block

# Team endpoint supports all requested periods and returns explicit net score fields.
assert 'period: Literal["day", "week", "month", "all"] = "all"' in block
assert '"score": total' in block
assert '"avg_score": average' in block

for period in ("day", "week", "month", "all"):
    assert f'{{ id: "{period}"' in TEAMS
assert '/leaderboard/teams?period=${period}' in TEAMS
assert "зароблені Point мінус усі витрачені Point" in TEAMS
assert "зароблено Point мінус витрачено" in LEADERBOARD
assert 'const VERSION = "tm6-v109";' in SW

# A representative net score: 100 earned, 35 spent, 5 earned = 70.
assert sum([100, -35, 5]) == 70
print("v109 leaderboard validation: OK")
