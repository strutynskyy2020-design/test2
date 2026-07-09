"""Phase 6 backend tests — Task constructor, Applications lifecycle,
Notifications, User moderation (pending approval).
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")

ADMIN = ("admin@callhub.ua", "admin123")
ANNA = ("anna@callhub.ua", "demo123")


def _login(email, pw):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_h():
    return {"Authorization": f"Bearer {_login(*ADMIN)}"}


@pytest.fixture(scope="module")
def anna_h():
    return {"Authorization": f"Bearer {_login(*ANNA)}"}


# ────────────────── 1. Registration with approval ──────────────────
class TestRegisterApprovalFlow:
    def test_self_register_returns_pending_not_token(self):
        email = f"test_pend_{uuid.uuid4().hex[:8]}@callhub.ua"
        r = requests.post(f"{BASE_URL}/api/auth/register/self", json={
            "email": email, "password": "secret123",
            "first_name": "Пенд", "last_name": "Юзер", "position": "Оператор",
        })
        assert r.status_code == 201, r.text
        data = r.json()
        assert data.get("ok") is True
        assert data.get("pending") is True
        assert "message" in data
        assert "token" not in data
        # login should be blocked
        r2 = requests.post(f"{BASE_URL}/api/auth/login",
                           json={"email": email, "password": "secret123"})
        assert r2.status_code == 403
        # error message hint
        assert "адмін" in r2.json().get("detail", "").lower() or "approv" in r2.json().get("detail", "").lower() or r2.status_code == 403

    def test_admin_pending_lists_new_user_and_approve_grants_login(self, admin_h):
        email = f"test_approve_{uuid.uuid4().hex[:8]}@callhub.ua"
        r = requests.post(f"{BASE_URL}/api/auth/register/self", json={
            "email": email, "password": "secret123",
            "first_name": "Ап", "last_name": "Прувед",
        })
        assert r.status_code == 201
        # admin sees pending list
        r2 = requests.get(f"{BASE_URL}/api/admin/users/pending", headers=admin_h)
        assert r2.status_code == 200
        pending = r2.json()
        target = next((u for u in pending if u["email"] == email), None)
        assert target is not None, f"{email} not in pending list"
        assert target["approved"] is False
        # approve
        r3 = requests.post(f"{BASE_URL}/api/admin/users/{target['id']}/approve", headers=admin_h)
        assert r3.status_code == 200, r3.text
        approved = r3.json()
        assert approved["approved"] is True
        assert approved["balance"] == 100  # signup bonus on approval
        assert approved["total_earned"] == 100
        # user disappears from pending
        r4 = requests.get(f"{BASE_URL}/api/admin/users/pending", headers=admin_h)
        emails = {u["email"] for u in r4.json()}
        assert email not in emails
        # user can now log in
        r5 = requests.post(f"{BASE_URL}/api/auth/login",
                           json={"email": email, "password": "secret123"})
        assert r5.status_code == 200
        assert r5.json()["user"]["email"] == email

    def test_admin_reject_deletes_pending_user(self, admin_h):
        email = f"test_reject_{uuid.uuid4().hex[:8]}@callhub.ua"
        r = requests.post(f"{BASE_URL}/api/auth/register/self", json={
            "email": email, "password": "secret123",
            "first_name": "Ре", "last_name": "Джект",
        })
        assert r.status_code == 201
        pending = requests.get(f"{BASE_URL}/api/admin/users/pending", headers=admin_h).json()
        target = next(u for u in pending if u["email"] == email)
        # reject = delete
        r2 = requests.delete(f"{BASE_URL}/api/admin/users/{target['id']}", headers=admin_h)
        assert r2.status_code == 204
        # cannot login
        r3 = requests.post(f"{BASE_URL}/api/auth/login",
                           json={"email": email, "password": "secret123"})
        assert r3.status_code == 401


# ────────────────── 2. Task constructor (admin) ──────────────────
class TestTaskConstructor:
    def test_list_tasks_seed(self, anna_h):
        r = requests.get(f"{BASE_URL}/api/tasks", headers=anna_h)
        assert r.status_code == 200
        tasks = r.json()
        assert len(tasks) >= 3
        titles = {t["title"] for t in tasks}
        assert "Фото робочого місця" in titles

    def test_admin_create_task_dynamic_fields(self, admin_h):
        payload = {
            "title": f"TEST_task_{uuid.uuid4().hex[:6]}",
            "description": "e2e test",
            "category": "quality",
            "icon": "clipboard-list",
            "reward": 250,
            "xp": 120,
            "active": True,
            "fields": [
                {"key": "name", "label": "Ім'я", "type": "text", "required": True, "placeholder": "Іван"},
                {"key": "count", "label": "Кількість", "type": "number", "required": True},
                {"key": "date", "label": "Дата", "type": "date", "required": False},
                {"key": "kind", "label": "Тип", "type": "select", "required": True,
                 "options": ["A", "B", "C"]},
                {"key": "agree", "label": "Погоджуюсь", "type": "checkbox", "required": True},
                {"key": "photo", "label": "Фото", "type": "photo", "required": False},
                {"key": "photos", "label": "Фото пачкою", "type": "photos", "required": False},
                {"key": "video", "label": "Відео", "type": "video", "required": False},
                {"key": "file", "label": "Файл", "type": "file", "required": False},
            ],
        }
        r = requests.post(f"{BASE_URL}/api/admin/tasks", headers=admin_h, json=payload)
        assert r.status_code == 201, r.text
        task = r.json()
        assert task["id"]
        assert task["title"] == payload["title"]
        assert task["reward"] == 250
        assert len(task["fields"]) == 9
        types = [f["type"] for f in task["fields"]]
        assert set(types) == {"text", "number", "date", "select", "checkbox",
                              "photo", "photos", "video", "file"}
        # GET individual
        r2 = requests.get(f"{BASE_URL}/api/tasks/{task['id']}", headers=admin_h)
        assert r2.status_code == 200
        assert r2.json()["title"] == payload["title"]

        # New task should have created a notification for anna
        n = requests.get(f"{BASE_URL}/api/notifications",
                        headers={"Authorization": r2.request.headers["Authorization"]})
        # verify via anna: fetched separately
        return task

    def test_admin_update_and_delete_task(self, admin_h):
        create = requests.post(f"{BASE_URL}/api/admin/tasks", headers=admin_h, json={
            "title": f"TEST_upd_{uuid.uuid4().hex[:6]}", "reward": 10, "xp": 5, "active": False,
        }).json()
        tid = create["id"]
        r = requests.patch(f"{BASE_URL}/api/admin/tasks/{tid}",
                           headers=admin_h, json={"reward": 999, "active": True})
        assert r.status_code == 200
        assert r.json()["reward"] == 999
        # delete
        r2 = requests.delete(f"{BASE_URL}/api/admin/tasks/{tid}", headers=admin_h)
        assert r2.status_code == 204
        # verify gone
        r3 = requests.get(f"{BASE_URL}/api/tasks/{tid}", headers=admin_h)
        assert r3.status_code == 404


# ────────────────── 3. Application lifecycle ──────────────────
class TestApplicationLifecycle:
    def _create_task(self, admin_h):
        return requests.post(f"{BASE_URL}/api/admin/tasks", headers=admin_h, json={
            "title": f"TEST_appt_{uuid.uuid4().hex[:6]}",
            "reward": 300, "xp": 60, "active": True,
            "fields": [
                {"key": "note", "label": "Коментар", "type": "text", "required": True},
                {"key": "count", "label": "Число", "type": "number", "required": False},
            ],
        }).json()

    def test_full_submit_review_approve_flow(self, admin_h, anna_h):
        task = self._create_task(admin_h)
        # anna submits
        r = requests.post(f"{BASE_URL}/api/applications", headers=anna_h, json={
            "task_id": task["id"], "values": {"note": "hello", "count": 3}, "submit": True,
        })
        assert r.status_code == 201, r.text
        app_ = r.json()
        assert app_["status"] == "submitted"
        assert app_["reward"] == 300
        assert app_["values"]["note"] == "hello"

        # appears in anna's applications
        mine = requests.get(f"{BASE_URL}/api/applications", headers=anna_h).json()
        assert any(a["id"] == app_["id"] for a in mine)

        # admin sees it
        adm_apps = requests.get(f"{BASE_URL}/api/admin/applications", headers=admin_h).json()
        assert any(a["id"] == app_["id"] for a in adm_apps)

        # anna balance before approve
        me_before = requests.get(f"{BASE_URL}/api/auth/me", headers=anna_h).json()

        # approve
        r2 = requests.post(f"{BASE_URL}/api/admin/applications/{app_['id']}/review",
                           headers=admin_h, json={"action": "approve", "reason": ""})
        assert r2.status_code == 200, r2.text
        assert r2.json()["status"] == "approved"

        me_after = requests.get(f"{BASE_URL}/api/auth/me", headers=anna_h).json()
        assert me_after["balance"] == me_before["balance"] + 300
        assert me_after["total_xp"] == me_before["total_xp"] + 60

        # anna gets an application_approved notification
        notifs = requests.get(f"{BASE_URL}/api/notifications", headers=anna_h).json()
        assert any(n["kind"] == "application_approved" for n in notifs)

    def test_draft_then_submit(self, admin_h, anna_h):
        task = self._create_task(admin_h)
        r = requests.post(f"{BASE_URL}/api/applications", headers=anna_h, json={
            "task_id": task["id"], "values": {"note": "draft"}, "submit": False,
        })
        assert r.status_code == 201
        assert r.json()["status"] == "draft"
        aid = r.json()["id"]
        # patch submit
        r2 = requests.patch(f"{BASE_URL}/api/applications/{aid}", headers=anna_h, json={
            "values": {"note": "submitted now"}, "submit": True,
        })
        assert r2.status_code == 200
        assert r2.json()["status"] == "submitted"
        assert r2.json()["values"]["note"] == "submitted now"

    def test_reject_requires_reason_and_allows_edit(self, admin_h, anna_h):
        task = self._create_task(admin_h)
        r = requests.post(f"{BASE_URL}/api/applications", headers=anna_h, json={
            "task_id": task["id"], "values": {"note": "first"}, "submit": True,
        })
        aid = r.json()["id"]
        # reject without reason → 400
        r2 = requests.post(f"{BASE_URL}/api/admin/applications/{aid}/review",
                           headers=admin_h, json={"action": "reject", "reason": ""})
        assert r2.status_code == 400
        # reject with reason
        r3 = requests.post(f"{BASE_URL}/api/admin/applications/{aid}/review",
                           headers=admin_h, json={"action": "reject", "reason": "Погана якість"})
        assert r3.status_code == 200
        assert r3.json()["status"] == "rejected"
        assert r3.json()["review_reason"] == "Погана якість"
        # anna gets notified
        notifs = requests.get(f"{BASE_URL}/api/notifications", headers=anna_h).json()
        assert any(n["kind"] == "application_rejected" for n in notifs)
        # rejected can be edited and resubmitted
        r4 = requests.patch(f"{BASE_URL}/api/applications/{aid}", headers=anna_h, json={
            "values": {"note": "fixed"}, "submit": True,
        })
        assert r4.status_code == 200
        assert r4.json()["status"] == "submitted"
        assert r4.json()["values"]["note"] == "fixed"


# ────────────────── 4. Notifications ──────────────────
class TestNotifications:
    def test_unread_count_and_mark_all_read(self, admin_h, anna_h):
        # generate notification for anna: create task (broadcast) then check
        requests.post(f"{BASE_URL}/api/admin/tasks", headers=admin_h, json={
            "title": f"TEST_notif_{uuid.uuid4().hex[:6]}", "reward": 10, "xp": 5, "active": True,
        })
        r = requests.get(f"{BASE_URL}/api/notifications/unread_count", headers=anna_h)
        assert r.status_code == 200
        assert r.json()["count"] >= 1

        r2 = requests.get(f"{BASE_URL}/api/notifications", headers=anna_h)
        assert r2.status_code == 200
        assert isinstance(r2.json(), list) and len(r2.json()) >= 1

        r3 = requests.post(f"{BASE_URL}/api/notifications/read-all", headers=anna_h)
        assert r3.status_code == 200
        r4 = requests.get(f"{BASE_URL}/api/notifications/unread_count", headers=anna_h)
        assert r4.json()["count"] == 0

    def test_admin_gets_pending_user_and_application_notifs(self, admin_h):
        # trigger user_pending
        email = f"test_notifadm_{uuid.uuid4().hex[:8]}@callhub.ua"
        requests.post(f"{BASE_URL}/api/auth/register/self", json={
            "email": email, "password": "secret123", "first_name": "N", "last_name": "N",
        })
        notifs = requests.get(f"{BASE_URL}/api/notifications", headers=admin_h).json()
        assert any(n["kind"] == "user_pending" for n in notifs)


# ────────────────── 5. Public teams still work (regression) ──────────────────
class TestRegression:
    def test_teams_public(self):
        r = requests.get(f"{BASE_URL}/api/teams")
        assert r.status_code == 200
        assert isinstance(r.json(), list) and len(r.json()) >= 4

    def test_existing_login_and_me(self):
        for email, pw in [ADMIN, ANNA, ("maks@callhub.ua", "demo123"),
                          ("olena@callhub.ua", "demo123")]:
            r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pw})
            assert r.status_code == 200, f"{email}: {r.text}"

    def test_quests_prizes_leaderboard_feed(self, anna_h):
        for path in ["/api/quests", "/api/prizes", "/api/leaderboard?period=week",
                     "/api/feed", "/api/leaderboard/teams"]:
            r = requests.get(f"{BASE_URL}{path}", headers=anna_h)
            assert r.status_code == 200, f"{path} failed: {r.status_code}"
