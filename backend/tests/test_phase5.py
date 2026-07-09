"""Phase 5 backend tests — self-registration, teams, uploads, admin user PATCH,
team leaderboard, extended user model.
"""
import io
import os
import uuid

import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") if os.environ.get("REACT_APP_BACKEND_URL") else "https://game-hub-callcenter.preview.emergentagent.com"


# ────────────────────────────────────────────────────────────────────────
# fixtures
# ────────────────────────────────────────────────────────────────────────
@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def admin_token(api):
    r = api.post(f"{BASE_URL}/api/auth/login", json={"email": "admin@callhub.ua", "password": "admin123"})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def anna_token(api):
    r = api.post(f"{BASE_URL}/api/auth/login", json={"email": "anna@callhub.ua", "password": "demo123"})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def teams_list(api):
    r = api.get(f"{BASE_URL}/api/teams")
    assert r.status_code == 200
    return r.json()


# ────────────────────────────────────────────────────────────────────────
# Public teams endpoint
# ────────────────────────────────────────────────────────────────────────
class TestPublicTeams:
    def test_get_teams_no_auth(self, api, teams_list):
        assert isinstance(teams_list, list)
        assert len(teams_list) >= 4  # 4 seeded
        names = {t["name"] for t in teams_list}
        # seeded teams
        for n in ["Продажі А", "Продажі B", "Підтримка B", "Утримання"]:
            assert n in names, f"Missing seeded team {n}"

    def test_team_shape(self, teams_list):
        t = teams_list[0]
        for key in ["id", "name", "description", "color", "department", "member_count", "total_earned", "created_at"]:
            assert key in t, f"Missing {key} in team"
        assert isinstance(t["member_count"], int)
        assert isinstance(t["total_earned"], int)


# ────────────────────────────────────────────────────────────────────────
# Self registration
# ────────────────────────────────────────────────────────────────────────
class TestSelfRegistration:
    def test_register_self_success(self, api, teams_list):
        email = f"test_selfreg_{uuid.uuid4().hex[:8]}@callhub.ua"
        team_id = teams_list[0]["id"]
        payload = {
            "email": email,
            "password": "secret123",
            "first_name": "Тест",
            "last_name": "Юзер",
            "phone": "+380501112233",
            "telegram": "@testuser",
            "position": "Оператор",
            "team_id": team_id,
        }
        r = api.post(f"{BASE_URL}/api/auth/register/self", json=payload)
        assert r.status_code == 201, r.text
        data = r.json()
        assert "token" in data and isinstance(data["token"], str)
        u = data["user"]
        assert u["email"] == email
        assert u["first_name"] == "Тест"
        assert u["last_name"] == "Юзер"
        assert u["name"] == "Тест Юзер"
        assert u["role"] == "employee"
        assert u["team_id"] == team_id
        assert u["team_name"] == teams_list[0]["name"]
        assert u["balance"] == 100  # signup bonus
        assert u["total_earned"] == 100
        assert u["total_xp"] == 50
        assert u["approved"] is True

    def test_register_duplicate_email(self, api):
        email = f"TEST_dup_{uuid.uuid4().hex[:8]}@callhub.ua"
        p = {"email": email, "password": "secret123", "first_name": "A", "last_name": "B"}
        r1 = api.post(f"{BASE_URL}/api/auth/register/self", json=p)
        assert r1.status_code == 201
        r2 = api.post(f"{BASE_URL}/api/auth/register/self", json=p)
        assert r2.status_code == 409

    def test_register_short_password(self, api):
        email = f"TEST_pwd_{uuid.uuid4().hex[:8]}@callhub.ua"
        r = api.post(f"{BASE_URL}/api/auth/register/self", json={
            "email": email, "password": "12345", "first_name": "A", "last_name": "B"
        })
        assert r.status_code == 400

    def test_register_missing_name(self, api):
        email = f"TEST_name_{uuid.uuid4().hex[:8]}@callhub.ua"
        r = api.post(f"{BASE_URL}/api/auth/register/self", json={
            "email": email, "password": "secret123", "first_name": "", "last_name": "B"
        })
        assert r.status_code == 400

    def test_register_invalid_team(self, api):
        email = f"TEST_teamx_{uuid.uuid4().hex[:8]}@callhub.ua"
        r = api.post(f"{BASE_URL}/api/auth/register/self", json={
            "email": email, "password": "secret123", "first_name": "A", "last_name": "B",
            "team_id": "does-not-exist-xxx"
        })
        assert r.status_code == 400


# ────────────────────────────────────────────────────────────────────────
# File uploads
# ────────────────────────────────────────────────────────────────────────
# 1x1 PNG
PNG_1x1 = bytes.fromhex(
    "89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C489"
    "0000000D49444154789C63F8CFC0500F0000030001007D6DBEA10000000049454E44AE426082"
)


class TestUploads:
    def test_upload_image_success(self, admin_token):
        headers = {"Authorization": f"Bearer {admin_token}"}
        files = {"file": ("t.png", io.BytesIO(PNG_1x1), "image/png")}
        r = requests.post(f"{BASE_URL}/api/uploads", files=files, data={"category": "avatars"}, headers=headers)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["url"].startswith("/uploads/avatars/")
        assert d["mime"] == "image/png"
        assert d["size"] == len(PNG_1x1)
        # verify GET accessible on backend (public routing may not include /uploads)
        internal = requests.get("http://localhost:8001" + d["url"])
        assert internal.status_code == 200, f"internal static 404: {d['url']}"
        assert internal.headers.get("content-type", "").startswith("image/png")
        assert len(internal.content) == len(PNG_1x1)
        # NOTE: /uploads/* is NOT reachable via public REACT_APP_BACKEND_URL because
        # the k8s ingress only routes /api/* to backend. See phase5 test report.

    def test_upload_no_auth(self):
        files = {"file": ("t.png", io.BytesIO(PNG_1x1), "image/png")}
        r = requests.post(f"{BASE_URL}/api/uploads", files=files)
        assert r.status_code == 401 or r.status_code == 403

    def test_upload_reject_bad_mime(self, admin_token):
        headers = {"Authorization": f"Bearer {admin_token}"}
        files = {"file": ("t.txt", io.BytesIO(b"hello"), "text/plain")}
        r = requests.post(f"{BASE_URL}/api/uploads", files=files, headers=headers)
        assert r.status_code == 415

    def test_upload_reject_too_large(self, admin_token):
        headers = {"Authorization": f"Bearer {admin_token}"}
        big = b"\x00" * (26 * 1024 * 1024)  # 26MB
        files = {"file": ("big.png", io.BytesIO(big), "image/png")}
        r = requests.post(f"{BASE_URL}/api/uploads", files=files, headers=headers)
        assert r.status_code == 413


# ────────────────────────────────────────────────────────────────────────
# Admin teams CRUD
# ────────────────────────────────────────────────────────────────────────
class TestAdminTeamsCRUD:
    created_team_id = None

    def test_admin_list_teams(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/admin/teams", headers={"Authorization": f"Bearer {admin_token}"})
        assert r.status_code == 200
        teams = r.json()
        assert isinstance(teams, list) and len(teams) >= 4
        for t in teams:
            assert "member_count" in t
            assert "total_earned" in t

    def test_admin_create_team(self, admin_token):
        name = f"TEST_team_{uuid.uuid4().hex[:6]}"
        r = requests.post(
            f"{BASE_URL}/api/admin/teams",
            headers={"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"},
            json={"name": name, "description": "d", "color": "#123456", "department": "QA"},
        )
        assert r.status_code == 201, r.text
        t = r.json()
        assert t["name"] == name
        assert t["color"] == "#123456"
        TestAdminTeamsCRUD.created_team_id = t["id"]

        # duplicate
        r2 = requests.post(
            f"{BASE_URL}/api/admin/teams",
            headers={"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"},
            json={"name": name},
        )
        assert r2.status_code == 409

    def test_admin_update_team_leader_change(self, admin_token, api):
        assert TestAdminTeamsCRUD.created_team_id
        tid = TestAdminTeamsCRUD.created_team_id
        # find olena's id
        r = requests.get(f"{BASE_URL}/api/admin/users", headers={"Authorization": f"Bearer {admin_token}"})
        assert r.status_code == 200
        olena = next(u for u in r.json() if u["email"] == "olena@callhub.ua")
        # set olena as leader (also assigns her team_id)
        r2 = requests.patch(
            f"{BASE_URL}/api/admin/teams/{tid}",
            headers={"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"},
            json={"leader_id": olena["id"]},
        )
        assert r2.status_code == 200, r2.text
        # verify olena is now team leader
        r3 = requests.get(f"{BASE_URL}/api/admin/users", headers={"Authorization": f"Bearer {admin_token}"})
        olena2 = next(u for u in r3.json() if u["email"] == "olena@callhub.ua")
        assert olena2["team_id"] == tid
        assert olena2["is_team_leader"] is True

    def test_admin_delete_team_unassigns_members(self, admin_token):
        assert TestAdminTeamsCRUD.created_team_id
        tid = TestAdminTeamsCRUD.created_team_id
        r = requests.delete(f"{BASE_URL}/api/admin/teams/{tid}",
                             headers={"Authorization": f"Bearer {admin_token}"})
        assert r.status_code == 204
        # olena should no longer have that team
        r2 = requests.get(f"{BASE_URL}/api/admin/users", headers={"Authorization": f"Bearer {admin_token}"})
        olena = next(u for u in r2.json() if u["email"] == "olena@callhub.ua")
        assert olena["team_id"] is None
        assert olena["is_team_leader"] is False


# ────────────────────────────────────────────────────────────────────────
# Admin user PATCH
# ────────────────────────────────────────────────────────────────────────
class TestAdminUserPatch:
    def test_patch_user_name_and_team(self, admin_token, teams_list):
        # create a self-registered user to mutate
        email = f"TEST_patch_{uuid.uuid4().hex[:6]}@callhub.ua"
        r = requests.post(f"{BASE_URL}/api/auth/register/self", json={
            "email": email, "password": "secret123", "first_name": "Old", "last_name": "Name",
        })
        assert r.status_code == 201
        uid = r.json()["user"]["id"]
        team_id = teams_list[0]["id"]

        r2 = requests.patch(
            f"{BASE_URL}/api/admin/users/{uid}",
            headers={"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"},
            json={
                "first_name": "Нове",
                "last_name": "Прізвище",
                "phone": "+380990001111",
                "telegram": "@x",
                "team_id": team_id,
                "position": "Senior",
                "department": "QA",
                "approved": True,
            },
        )
        assert r2.status_code == 200, r2.text
        u = r2.json()
        assert u["first_name"] == "Нове"
        assert u["last_name"] == "Прізвище"
        assert u["name"] == "Нове Прізвище"
        assert u["avatar_initials"] == "НП"
        assert u["team_id"] == team_id
        assert u["team_name"] == teams_list[0]["name"]
        assert u["position"] == "Senior"

    def test_patch_user_invalid_team(self, admin_token):
        email = f"TEST_patchbad_{uuid.uuid4().hex[:6]}@callhub.ua"
        r = requests.post(f"{BASE_URL}/api/auth/register/self", json={
            "email": email, "password": "secret123", "first_name": "A", "last_name": "B",
        })
        uid = r.json()["user"]["id"]
        r2 = requests.patch(
            f"{BASE_URL}/api/admin/users/{uid}",
            headers={"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"},
            json={"team_id": "nope-xxx"},
        )
        assert r2.status_code == 400


# ────────────────────────────────────────────────────────────────────────
# Team leaderboard
# ────────────────────────────────────────────────────────────────────────
class TestTeamLeaderboard:
    def test_team_leaderboard_shape(self, anna_token):
        r = requests.get(f"{BASE_URL}/api/leaderboard/teams",
                          headers={"Authorization": f"Bearer {anna_token}"})
        assert r.status_code == 200, r.text
        entries = r.json()
        assert isinstance(entries, list)
        assert len(entries) >= 4
        # sorted desc by total_earned
        earnings = [e["total_earned"] for e in entries]
        assert earnings == sorted(earnings, reverse=True)
        for i, e in enumerate(entries):
            assert e["rank"] == i + 1
            for k in ["team_id", "name", "color", "department", "member_count", "total_earned", "avg_earned"]:
                assert k in e

    def test_team_leaderboard_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/leaderboard/teams")
        assert r.status_code == 401 or r.status_code == 403


# ────────────────────────────────────────────────────────────────────────
# Admin users list includes team_name
# ────────────────────────────────────────────────────────────────────────
class TestAdminUsersTeamName:
    def test_admin_users_populates_team_name(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/admin/users",
                          headers={"Authorization": f"Bearer {admin_token}"})
        assert r.status_code == 200
        users = r.json()
        # Максим is seeded to Підтримка B and is a team leader
        maks = next((u for u in users if u["email"] == "maks@callhub.ua"), None)
        assert maks is not None
        assert maks["team_id"] is not None
        assert maks["team_name"] == "Підтримка B"
        assert maks["is_team_leader"] is True


# ────────────────────────────────────────────────────────────────────────
# Login unapproved user → 403
# ────────────────────────────────────────────────────────────────────────
class TestLoginUnapproved:
    def test_login_unapproved_returns_403(self, admin_token):
        email = f"TEST_unapp_{uuid.uuid4().hex[:6]}@callhub.ua"
        r = requests.post(f"{BASE_URL}/api/auth/register/self", json={
            "email": email, "password": "secret123", "first_name": "U", "last_name": "N",
        })
        assert r.status_code == 201
        uid = r.json()["user"]["id"]
        # set approved=false via admin PATCH
        r2 = requests.patch(
            f"{BASE_URL}/api/admin/users/{uid}",
            headers={"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"},
            json={"approved": False},
        )
        assert r2.status_code == 200
        # login attempt
        r3 = requests.post(f"{BASE_URL}/api/auth/login",
                            json={"email": email, "password": "secret123"})
        assert r3.status_code == 403


# ────────────────────────────────────────────────────────────────────────
# Regression: existing endpoints
# ────────────────────────────────────────────────────────────────────────
class TestRegression:
    def test_auth_me(self, anna_token):
        r = requests.get(f"{BASE_URL}/api/auth/me",
                          headers={"Authorization": f"Bearer {anna_token}"})
        assert r.status_code == 200
        assert r.json()["email"] == "anna@callhub.ua"

    def test_quests(self, anna_token):
        r = requests.get(f"{BASE_URL}/api/quests",
                          headers={"Authorization": f"Bearer {anna_token}"})
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_prizes(self, anna_token):
        r = requests.get(f"{BASE_URL}/api/prizes",
                          headers={"Authorization": f"Bearer {anna_token}"})
        assert r.status_code == 200

    def test_leaderboard_week(self, anna_token):
        r = requests.get(f"{BASE_URL}/api/leaderboard?period=week",
                          headers={"Authorization": f"Bearer {anna_token}"})
        assert r.status_code == 200
        d = r.json()
        assert d["period"] == "week"
        assert isinstance(d["top"], list)

    def test_feed(self, anna_token):
        r = requests.get(f"{BASE_URL}/api/feed",
                          headers={"Authorization": f"Bearer {anna_token}"})
        assert r.status_code == 200
        assert "events" in r.json()
