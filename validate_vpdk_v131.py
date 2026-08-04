from pathlib import Path
import ast

ROOT = Path(__file__).resolve().parent
pumb = (ROOT / "frontend/src/pages/ActivationPumbGoals.jsx").read_text(encoding="utf-8")
leaderboard = (ROOT / "frontend/src/pages/Leaderboard.jsx").read_text(encoding="utf-8")
backend_path = ROOT / "backend/server.py"
backend = backend_path.read_text(encoding="utf-8")
cache = (ROOT / "frontend/src/lib/googleReportsCache.js").read_text(encoding="utf-8")
sw = (ROOT / "frontend/public/service-worker.js").read_text(encoding="utf-8")

# PUMB Online metric cards use the spreadsheet's "Загальний підсумок" values.
assert 'label: "Зайшли в додаток після згоди"' in pumb
assert '<span className="font-bold text-zinc-500">Проект</span>' in pumb
assert 'active?.[`${metric.key}_overall`]' in pumb
assert 'projectMetrics?.[metric.key]' in pumb
# The top projection card intentionally remains team-scoped.
assert '>Команда</div><div className="mt-1 text-xl font-black text-white">{formatPercent(teamProjection)}' in pumb
assert 'команда {formatCount(teamGivingValue, "—")}' in pumb

# Main Point leaderboard can switch between all users and a selected group.
assert 'data-testid="lb-team-filter"' in leaderboard
assert 'api.get("/teams")' in leaderboard
assert 'params.team_id = selectedTeamId' in leaderboard
assert 'data-testid="lb-team-all"' in leaderboard
assert 'Усі' in leaderboard

# Backend ranks only users from the requested team and keeps global notifications global.
assert 'team_id: Optional[str] = None' in backend
assert 'user_filter["team_id"] = team_id' in backend
assert 'team_id=team_id' in backend
assert 'if own and not team_id:' in backend
ast.parse(backend_path.read_text(encoding="utf-8"))

assert 'vpdk-google-reports-v131:' in cache
assert 'vpdk-google-reports-v131' in cache
assert 'const VERSION = "vpdk-v131"' in sw

print("VPDK Bonus v131 validation: PASS")
