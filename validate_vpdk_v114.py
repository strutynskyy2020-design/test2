from pathlib import Path

ROOT = Path(__file__).resolve().parent
BACKEND = (ROOT / "backend/server.py").read_text(encoding="utf-8")
APP = (ROOT / "frontend/src/App.js").read_text(encoding="utf-8")
LAYOUT = (ROOT / "frontend/src/components/AppLayout.jsx").read_text(encoding="utf-8")
NOTIFICATIONS = (ROOT / "frontend/src/components/NotificationBell.jsx").read_text(encoding="utf-8")
ANALYTICS = (ROOT / "frontend/src/pages/ManagerAnalytics.jsx").read_text(encoding="utf-8")
TEAMS = (ROOT / "frontend/src/pages/Teams.jsx").read_text(encoding="utf-8")
PUSH_LIB = (ROOT / "frontend/src/lib/pushNotifications.js").read_text(encoding="utf-8")
SW = (ROOT / "frontend/public/service-worker.js").read_text(encoding="utf-8")
SCHEDULER = (ROOT / "netlify/functions/push-scheduler.mjs").read_text(encoding="utf-8")
GOOGLE = (ROOT / "integrations/google-sheets/Code-v114.gs").read_text(encoding="utf-8")
GOOGLE_CTX = (ROOT / "frontend/src/context/GoogleReportsContext.jsx").read_text(encoding="utf-8")
APP_CTX = (ROOT / "frontend/src/context/AppContext.jsx").read_text(encoding="utf-8")
REQS = (ROOT / "backend/requirements.txt").read_text(encoding="utf-8")

# Backend Web Push and secure internal scheduler.
for token in [
    'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'PUSH_SCHEDULER_TOKEN',
    'REPORTS_WEBHOOK_TOKEN', '@api.get("/push/config")',
    '@api.post("/push/subscribe"', '@api.post("/push/test")',
    '@api.post("/internal/push-schedule")',
    '@api.post("/internal/reports-published")',
    '@api.get("/manager-analytics")',
]:
    assert token in BACKEND, token
assert "pywebpush>=2.0.3" in REQS
assert 'datetime.now(KYIV_TZ)' in BACKEND
for hour in [9, 12, 15, 17]:
    assert f'{hour}: {{' in BACKEND, hour
assert 'scheduled_push_runs' in BACKEND
assert '_refresh_rank_change_notifications' in BACKEND
assert '_report_metric_number' in BACKEND

# Required notification event classes.
for kind in [
    '"points"', '"achievement"', '"new_prize"', '"order_ready"',
    '"manager_message"', '"reports_updated"', '"game_level"',
    '"ranking_change"', '"workday_start"', '"issuance_reminder"',
]:
    assert kind in BACKEND, kind

# PWA push implementation and subscription lifecycle.
assert 'const VERSION = "vpdk-v114";' in SW
assert 'self.addEventListener("push"' in SW
assert 'self.addEventListener("notificationclick"' in SW
assert 'registration.showNotification' in SW
assert 'navigator.serviceWorker.ready' in PUSH_LIB
assert 'pushManager.subscribe' in PUSH_LIB
assert 'syncExistingPushSubscription' in PUSH_LIB
assert 'syncExistingPushSubscription().catch' in APP_CTX
assert 'await api.delete("/push/unsubscribe"' in APP_CTX

# Unified notification center and preferences.
assert 'Центр сповіщень' in NOTIFICATIONS
for preference in [
    'points', 'achievements', 'prizes', 'orders', 'manager_messages',
    'reports', 'games', 'ranking', 'scheduled_reminders',
]:
    assert f'["{preference}"' in NOTIFICATIONS, preference
assert 'Надіслати тест' in NOTIFICATIONS

# Hourly Netlify scheduler delegates timezone decisions to backend.
assert 'schedule: "@hourly"' in SCHEDULER
assert '/api/internal/push-schedule' in SCHEDULER
assert 'X-Scheduler-Token' in SCHEDULER

# Manager analytics route and entry point.
assert 'const ManagerAnalytics = lazy' in APP
assert 'path="/analytics"' in APP
assert 'RequireManager' in APP
assert '"/analytics": "Аналітика команди"' in LAYOUT
assert 'data-testid="open-manager-analytics"' in TEAMS
for label in [
    'Динаміка команди', 'Дивились звіти', 'Популярні призи',
    'Порівняння команд', 'Тренд Google-звітів',
]:
    assert label in ANALYTICS, label

# Report publication webhook and metric fallback.
assert 'function notifyBackendReportsPublished(snapshot)' in GOOGLE
assert '/api/internal/reports-published' in GOOGLE
assert 'const webhookResult = notifyBackendReportsPublished(snapshot);' in GOOGLE
assert 'VPDK_BACKEND_URL' in GOOGLE
assert 'REPORTS_WEBHOOK_TOKEN' in GOOGLE
assert 'api.post("/analytics/report-snapshot"' in GOOGLE_CTX

# Coarse delimiter checks catch accidental truncation in generated JSX/JS.
for relative in [
    "frontend/src/App.js",
    "frontend/src/pages/Teams.jsx",
    "frontend/src/pages/ManagerAnalytics.jsx",
    "frontend/src/components/NotificationBell.jsx",
    "frontend/src/context/GoogleReportsContext.jsx",
]:
    text = (ROOT / relative).read_text(encoding="utf-8")
    assert text.count("{") == text.count("}"), relative
    assert text.count("(") == text.count(")"), relative

print("VPDK Bonus v114 validation passed")
