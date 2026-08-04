from __future__ import annotations

import ast
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent
backend_path = ROOT / "backend" / "server.py"
admin_path = ROOT / "frontend" / "src" / "pages" / "Admin.jsx"
pumb_path = ROOT / "frontend" / "src" / "pages" / "ActivationPumbGoals.jsx"
cache_path = ROOT / "frontend" / "src" / "lib" / "googleReportsCache.js"
service_worker_path = ROOT / "frontend" / "public" / "service-worker.js"

source = backend_path.read_text(encoding="utf-8")
tree = ast.parse(source)
assignments: dict[str, object] = {}
for node in tree.body:
    if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
        if node.targets[0].id in {"SALES_DAILY_TASK_CATALOG", "ACTIVATION_DAILY_TASK_CATALOG"}:
            assignments[node.targets[0].id] = ast.literal_eval(node.value)

sales = assignments["SALES_DAILY_TASK_CATALOG"]
activation = assignments["ACTIVATION_DAILY_TASK_CATALOG"]
assert len(sales) >= 30
assert len(activation) == 30
assert len({item["id"] for item in sales + activation}) == len(sales) + len(activation)
assert all(item["id"] >= 1000 for item in activation)
assert Counter(item["difficulty"] for item in activation) == {"easy": 10, "medium": 10, "hard": 10}

expected_titles = {
    "Агент 777", "Ровесник", "Молода кров", "Назад у майбутнє", "Тезка", "Алфавіт",
    "Ну ти і фартовий", "Олег, ти що плачеш?", "Вкинув мем — врятував колег",
    "Місія нездійсненна: одна хвилина", "Не чує баба", "Турбо-старт",
    "Чий ти будеш, козаче?", "Сарафанне радіо", "Іронія долі", "День бабака",
    "Золотий вік", "Погашення після згоди", "А наша Галя балувана", "Вип'ємо еспресо",
    "Бери бика за рога", "Зарплата прийшла!", "Подвійний удар", "Колишніх не буває",
    "Місія нездійсненна: три заперечення", "В яблучко", "Контрольний постріл",
    "Багатий тато", "Тарас Бульба", "Дідусівська версія",
}
assert {item["title"] for item in activation} == expected_titles
assert next(item for item in activation if item["title"] == "Подвійний удар")["reward"] == 40
assert next(item for item in activation if item["title"] == "Контрольний постріл")["reward"] == 50
assert next(item for item in activation if item["title"] == "Дідусівська версія")["reward"] == 50

for token in (
    'DAILY_TASK_CATALOG_VERSION = {"sales": "sales-v1", "activation": "activation-v1"}',
    '"catalog_profile": profile',
    'team_id: Optional[str] = None',
    '@api.get("/admin/analytics")',
    '@api.get("/admin/daily-tasks-dashboard")',
    '@api.get("/admin/goals-dashboard")',
    '@api.get("/admin/achievements-dashboard")',
):
    assert token in source, token

admin = admin_path.read_text(encoding="utf-8")
for token in (
    'data-testid="admin-global-team-filter"',
    'vpdk_admin_team_filter_v128',
    '<V teamFilter={teamFilter} teams={adminTeams} />',
    'withTeamQuery("/admin/analytics", teamFilter)',
    'withTeamQuery("/admin/daily-tasks-dashboard", teamFilter)',
    'withTeamQuery("/admin/goals-dashboard", teamFilter)',
    'withTeamQuery("/admin/orders", teamFilter)',
    'withTeamQuery(q, teamFilter)',
):
    assert token in admin, token

pumb = pumb_path.read_text(encoding="utf-8")
for token in (
    'periodRowForLogin(report?.activation_pumb_metrics, period, login)',
    'active?.[`${metric.key}_team`]',
    'giving?.team_overall',
):
    assert token in pumb, token

assert "vpdk-google-reports-v128" in cache_path.read_text(encoding="utf-8")
assert 'const VERSION = "vpdk-v128";' in service_worker_path.read_text(encoding="utf-8")
print("VPDK Bonus v128 static validation: PASS")
