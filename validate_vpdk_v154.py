from pathlib import Path

root = Path(__file__).resolve().parent
code = (root / 'integrations/google-sheets/Code.gs').read_text()
goals = (root / 'frontend/src/pages/Goals.jsx').read_text()
home = (root / 'frontend/src/pages/Home.jsx').read_text()
admin = (root / 'frontend/src/pages/Admin.jsx').read_text()
gateway = (root / 'netlify/functions/google-goals.js').read_text()
admin_gateway = (root / 'netlify/functions/google-goals-admin.js').read_text()

legacy_id = '1TV7NHvEmLf6i19yPt7SENl2TOn1Y04ToW1CjSGhtrf0'
assert legacy_id not in code
for token in ['REPORT_SOURCE_SPREADSHEET_ID', 'function openGoalsSheet', 'function getSheetContext', 'function findGoalRow']:
    assert token not in code, token
assert 'const SPREADSHEET_ID = "1J6pgu1HEuufkSA_O3EpcMwrylenAg685sQH4lRMjAic"' in code
assert 'const FIXED_PROJECTION_TARGET = "100"' in code
assert 'schedule: scheduleSourceData(sourceSpreadsheet)' in code
assert 'goals_editable: false' in code
assert 'projection_target: Number(FIXED_PROJECTION_TARGET)' in code
assert 'Мої проекції' in goals
assert 'Ціль кожного проекційного показника: 100%' in goals
assert 'Місячна ціль по бонусу' not in goals
assert 'Цілі тижня' not in goals
assert 'МОЇ ПРОЕКЦІЇ' in home
assert 'Ціль кожного напрямку: 100%' in home
assert 'Бонус:' not in home
assert '{ id: "goals", label: "Проекції", icon: Target }' in admin
assert 'GoalMetricEditor' not in admin
assert '/admin/goals-dashboard' not in admin
assert 'google-goals-admin' in admin
assert 'credit_target: "100"' in gateway
assert 'debit_target: "100"' in gateway
assert gateway.count('monthly_bonus_target: "0"') >= 2
assert 'event.httpMethod !== "GET"' in admin_gateway
assert 'projection_target: 100' in admin_gateway
print('V154 static validation: PASS')
