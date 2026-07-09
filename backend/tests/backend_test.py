"""CallHub Game Hub — Backend API pytest suite
Covers: health, auth, employee flows (quests/prizes/orders/tx),
admin CRUD + analytics, and bot API endpoints.
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # fallback: read frontend .env
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
    except Exception:
        pass

BOT_TOKEN = "458cdf2fc1274ec1959ef176893d5a96a28239acf6e533ef"

ADMIN_EMAIL = "admin@callhub.ua"
ADMIN_PW = "admin123"
ANNA_EMAIL = "anna@callhub.ua"
ANNA_PW = "demo123"
MAKS_EMAIL = "maks@callhub.ua"
MAKS_PW = "demo123"


# ────────────────── Fixtures ──────────────────
@pytest.fixture(scope="session")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _login(session, email, password):
    r = session.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return r.json()


@pytest.fixture(scope="session")
def admin_token(api):
    return _login(api, ADMIN_EMAIL, ADMIN_PW)["token"]


@pytest.fixture(scope="session")
def anna_token(api):
    return _login(api, ANNA_EMAIL, ANNA_PW)["token"]


@pytest.fixture
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture
def anna_headers(anna_token):
    return {"Authorization": f"Bearer {anna_token}"}


@pytest.fixture
def bot_headers():
    return {"X-Bot-Token": BOT_TOKEN}


# ────────────────── Health ──────────────────
class TestHealth:
    def test_health(self, api):
        r = api.get(f"{BASE_URL}/api/health")
        assert r.status_code == 200
        assert r.json()["status"] == "ok"


# ────────────────── Auth ──────────────────
class TestAuth:
    def test_login_admin(self, api):
        data = _login(api, ADMIN_EMAIL, ADMIN_PW)
        assert data["user"]["role"] == "admin"
        assert data["user"]["email"] == ADMIN_EMAIL
        assert "token" in data and isinstance(data["token"], str) and len(data["token"]) > 20

    def test_login_employee(self, api):
        data = _login(api, ANNA_EMAIL, ANNA_PW)
        assert data["user"]["role"] == "employee"
        assert data["user"]["email"] == ANNA_EMAIL
        # Anna seed: total_xp=6800 → level should be >= 3
        assert data["user"]["level"] >= 3
        assert "xp" in data["user"]
        assert "xp_to_next" in data["user"]

    def test_login_wrong_password(self, api):
        r = api.post(f"{BASE_URL}/api/auth/login", json={"email": ANNA_EMAIL, "password": "wrongpass"})
        assert r.status_code == 401
        assert "Невірний" in r.json().get("detail", "")

    def test_login_unknown_email(self, api):
        r = api.post(f"{BASE_URL}/api/auth/login", json={"email": "nobody@callhub.ua", "password": "x"})
        assert r.status_code == 401

    def test_me_with_token(self, api, anna_headers):
        r = api.get(f"{BASE_URL}/api/auth/me", headers=anna_headers)
        assert r.status_code == 200
        u = r.json()
        assert u["email"] == ANNA_EMAIL
        assert "level" in u and "xp" in u and "xp_to_next" in u

    def test_me_no_token(self, api):
        r = api.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 401

    def test_me_bad_token(self, api):
        r = api.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": "Bearer garbage"})
        assert r.status_code == 401


# ────────────────── Employee: quests / prizes / orders / transactions ──────────────────
class TestEmployeeFlow:
    def test_list_quests(self, api, anna_headers):
        r = api.get(f"{BASE_URL}/api/quests", headers=anna_headers)
        assert r.status_code == 200
        quests = r.json()
        assert len(quests) >= 6
        for q in quests:
            assert "progress" in q and "claimed" in q and "goal" in q and "reward" in q

    def test_claim_incomplete_quest(self, api, anna_headers):
        # find a quest with progress < goal
        r = api.get(f"{BASE_URL}/api/quests", headers=anna_headers)
        quests = r.json()
        incomplete = [q for q in quests if q["progress"] < q["goal"] and not q["claimed"]]
        if not incomplete:
            pytest.skip("No incomplete quests for Anna today")
        qid = incomplete[0]["id"]
        r2 = api.post(f"{BASE_URL}/api/quests/{qid}/claim", headers=anna_headers)
        assert r2.status_code == 400

    def test_claim_completed_quest_and_double_claim(self, api, anna_headers):
        r = api.get(f"{BASE_URL}/api/quests", headers=anna_headers)
        quests = r.json()
        completed = [q for q in quests if q["progress"] >= q["goal"] and not q["claimed"]]
        if not completed:
            pytest.skip("No completed unclaimed quests to claim today")
        q = completed[0]

        me_before = api.get(f"{BASE_URL}/api/auth/me", headers=anna_headers).json()
        r2 = api.post(f"{BASE_URL}/api/quests/{q['id']}/claim", headers=anna_headers)
        assert r2.status_code == 200, r2.text
        after = r2.json()
        assert after["balance"] == me_before["balance"] + q["reward"]
        assert after["total_earned"] == me_before["total_earned"] + q["reward"]

        # double claim → 400
        r3 = api.post(f"{BASE_URL}/api/quests/{q['id']}/claim", headers=anna_headers)
        assert r3.status_code == 400

    def test_list_prizes(self, api, anna_headers):
        r = api.get(f"{BASE_URL}/api/prizes", headers=anna_headers)
        assert r.status_code == 200
        prizes = r.json()
        assert len(prizes) >= 8
        for p in prizes:
            assert "price" in p and "stock" in p and p["active"] is True

    def test_buy_prize_and_insufficient(self, api, anna_headers):
        me = api.get(f"{BASE_URL}/api/auth/me", headers=anna_headers).json()
        prizes = api.get(f"{BASE_URL}/api/prizes", headers=anna_headers).json()
        affordable = [p for p in prizes if p["price"] <= me["balance"] and p["stock"] > 0]
        expensive = [p for p in prizes if p["price"] > me["balance"] and p["stock"] > 0]

        if affordable:
            prize = affordable[0]
            r = api.post(f"{BASE_URL}/api/prizes/{prize['id']}/buy", headers=anna_headers)
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["user"]["balance"] == me["balance"] - prize["price"]
            assert body["order"]["status"] == "processing"
            assert body["order"]["prize_id"] == prize["id"]

        if expensive:
            r2 = api.post(f"{BASE_URL}/api/prizes/{expensive[0]['id']}/buy", headers=anna_headers)
            assert r2.status_code == 400

    def test_my_orders(self, api, anna_headers):
        r = api.get(f"{BASE_URL}/api/orders", headers=anna_headers)
        assert r.status_code == 200
        # should contain only Anna's orders (user_id filter). Not asserting count.
        assert isinstance(r.json(), list)

    def test_my_transactions(self, api, anna_headers):
        r = api.get(f"{BASE_URL}/api/transactions", headers=anna_headers)
        assert r.status_code == 200
        txs = r.json()
        assert isinstance(txs, list)
        # kinds must be valid
        for t in txs:
            assert t["kind"] in {"quest", "purchase", "admin_adjust", "signup_bonus"}


# ────────────────── Admin CRUD ──────────────────
class TestAdmin:
    def test_admin_forbidden_for_employee(self, api, anna_headers):
        r = api.get(f"{BASE_URL}/api/admin/users", headers=anna_headers)
        assert r.status_code == 403

    def test_admin_requires_auth(self, api):
        r = api.get(f"{BASE_URL}/api/admin/users")
        assert r.status_code == 401

    def test_admin_list_users(self, api, admin_headers):
        r = api.get(f"{BASE_URL}/api/admin/users", headers=admin_headers)
        assert r.status_code == 200
        users = r.json()
        emails = {u["email"] for u in users}
        assert {ADMIN_EMAIL, ANNA_EMAIL, MAKS_EMAIL, "olena@callhub.ua"}.issubset(emails)
        for u in users:
            assert "level" in u and "xp" in u

    def test_adjust_points_credit_and_debit(self, api, admin_headers):
        users = api.get(f"{BASE_URL}/api/admin/users", headers=admin_headers).json()
        anna = next(u for u in users if u["email"] == ANNA_EMAIL)
        before_bal = anna["balance"]

        # credit +100
        r = api.patch(f"{BASE_URL}/api/admin/users/{anna['id']}/points",
                      json={"amount": 100, "description": "TEST_bonus"}, headers=admin_headers)
        assert r.status_code == 200
        assert r.json()["balance"] == before_bal + 100

        # debit -50
        r2 = api.patch(f"{BASE_URL}/api/admin/users/{anna['id']}/points",
                       json={"amount": -50, "description": "TEST_debit"}, headers=admin_headers)
        assert r2.status_code == 200
        assert r2.json()["balance"] == before_bal + 50

    def test_adjust_points_prevents_negative_balance(self, api, admin_headers):
        users = api.get(f"{BASE_URL}/api/admin/users", headers=admin_headers).json()
        anna = next(u for u in users if u["email"] == ANNA_EMAIL)
        r = api.patch(f"{BASE_URL}/api/admin/users/{anna['id']}/points",
                      json={"amount": -(anna["balance"] + 999999), "description": "TEST_neg"},
                      headers=admin_headers)
        assert r.status_code == 400

    def test_cannot_delete_admin(self, api, admin_headers):
        users = api.get(f"{BASE_URL}/api/admin/users", headers=admin_headers).json()
        admin = next(u for u in users if u["email"] == ADMIN_EMAIL)
        r = api.delete(f"{BASE_URL}/api/admin/users/{admin['id']}", headers=admin_headers)
        assert r.status_code == 400

    def test_quest_crud(self, api, admin_headers):
        # CREATE
        payload = {"title": f"TEST_quest_{uuid.uuid4().hex[:6]}",
                   "description": "test", "difficulty": "easy",
                   "reward": 10, "goal": 1, "icon": "target", "active": True}
        r = api.post(f"{BASE_URL}/api/admin/quests", json=payload, headers=admin_headers)
        assert r.status_code == 201, r.text
        qid = r.json()["id"]

        # UPDATE
        r2 = api.patch(f"{BASE_URL}/api/admin/quests/{qid}",
                       json={"reward": 25}, headers=admin_headers)
        assert r2.status_code == 200
        assert r2.json()["reward"] == 25

        # verify via list
        lst = api.get(f"{BASE_URL}/api/admin/quests", headers=admin_headers).json()
        assert any(q["id"] == qid and q["reward"] == 25 for q in lst)

        # DELETE
        r3 = api.delete(f"{BASE_URL}/api/admin/quests/{qid}", headers=admin_headers)
        assert r3.status_code == 204

        lst2 = api.get(f"{BASE_URL}/api/admin/quests", headers=admin_headers).json()
        assert not any(q["id"] == qid for q in lst2)

    def test_prize_crud(self, api, admin_headers):
        payload = {"title": f"TEST_prize_{uuid.uuid4().hex[:6]}",
                   "description": "test", "price": 500, "category": "merch",
                   "stock": 3, "active": True, "icon": "gift"}
        r = api.post(f"{BASE_URL}/api/admin/prizes", json=payload, headers=admin_headers)
        assert r.status_code == 201, r.text
        pid = r.json()["id"]

        r2 = api.patch(f"{BASE_URL}/api/admin/prizes/{pid}",
                       json={"price": 600}, headers=admin_headers)
        assert r2.status_code == 200
        assert r2.json()["price"] == 600

        r3 = api.delete(f"{BASE_URL}/api/admin/prizes/{pid}", headers=admin_headers)
        assert r3.status_code == 204

    def test_admin_analytics(self, api, admin_headers):
        r = api.get(f"{BASE_URL}/api/admin/analytics", headers=admin_headers)
        assert r.status_code == 200
        d = r.json()
        for key in ["total_users", "total_quests", "total_prizes",
                    "orders_processing", "total_points_earned",
                    "total_points_spent", "top_earners", "popular_quests"]:
            assert key in d
        assert d["total_users"] >= 3
        assert d["total_quests"] >= 6
        assert d["total_prizes"] >= 8
        assert isinstance(d["top_earners"], list)
        # Maks has highest total_earned per seed
        if d["top_earners"]:
            assert d["top_earners"][0]["name"].startswith("Максим")

    def test_admin_update_order_status(self, api, admin_headers, anna_headers):
        # Get an existing order (may have been created by earlier test) or create one
        orders = api.get(f"{BASE_URL}/api/admin/orders", headers=admin_headers).json()
        if not orders:
            # Create an order by buying a cheap prize as Anna
            prizes = api.get(f"{BASE_URL}/api/prizes", headers=anna_headers).json()
            cheap = sorted(prizes, key=lambda p: p["price"])[0]
            buy = api.post(f"{BASE_URL}/api/prizes/{cheap['id']}/buy", headers=anna_headers)
            if buy.status_code != 200:
                pytest.skip("Could not create order")
            orders = api.get(f"{BASE_URL}/api/admin/orders", headers=admin_headers).json()

        if not orders:
            pytest.skip("No orders available")
        oid = orders[0]["id"]
        r = api.patch(f"{BASE_URL}/api/admin/orders/{oid}",
                      json={"status": "ready"}, headers=admin_headers)
        assert r.status_code == 200
        assert r.json()["status"] == "ready"


# ────────────────── Bot API ──────────────────
class TestBotAPI:
    def test_bot_health(self, api, bot_headers):
        r = api.get(f"{BASE_URL}/api/bot/health", headers=bot_headers)
        assert r.status_code == 200
        assert r.json()["status"] == "ok"

    def test_bot_missing_token(self, api):
        r = api.get(f"{BASE_URL}/api/bot/health")
        assert r.status_code == 401

    def test_bot_wrong_token(self, api):
        r = api.get(f"{BASE_URL}/api/bot/health", headers={"X-Bot-Token": "wrong"})
        assert r.status_code == 401

    def test_bot_link_and_get_user(self, api, bot_headers):
        tg = "999888"
        r = api.post(f"{BASE_URL}/api/bot/link",
                     json={"email": ANNA_EMAIL, "telegram_id": tg}, headers=bot_headers)
        assert r.status_code == 200, r.text
        assert r.json()["telegram_id"] == tg
        assert r.json()["email"] == ANNA_EMAIL

        r2 = api.get(f"{BASE_URL}/api/bot/user/{tg}", headers=bot_headers)
        assert r2.status_code == 200
        assert r2.json()["email"] == ANNA_EMAIL

    def test_bot_user_quests(self, api, bot_headers):
        # ensure Anna linked
        api.post(f"{BASE_URL}/api/bot/link",
                 json={"email": ANNA_EMAIL, "telegram_id": "999888"}, headers=bot_headers)
        r = api.get(f"{BASE_URL}/api/bot/user/999888/quests", headers=bot_headers)
        assert r.status_code == 200
        assert len(r.json()) >= 6

    def test_bot_leaderboard(self, api, bot_headers):
        r = api.get(f"{BASE_URL}/api/bot/leaderboard?limit=3", headers=bot_headers)
        assert r.status_code == 200
        board = r.json()
        assert len(board) <= 3 and len(board) >= 1
        assert board[0]["rank"] == 1
        # Максим has highest total_earned per seed
        assert board[0]["name"].startswith("Максим")

    def test_bot_adjust(self, api, bot_headers):
        api.post(f"{BASE_URL}/api/bot/link",
                 json={"email": ANNA_EMAIL, "telegram_id": "999888"}, headers=bot_headers)
        before = api.get(f"{BASE_URL}/api/bot/user/999888", headers=bot_headers).json()
        r = api.post(f"{BASE_URL}/api/bot/adjust",
                     json={"telegram_id": "999888", "amount": 200, "description": "from bot"},
                     headers=bot_headers)
        assert r.status_code == 200, r.text
        assert r.json()["balance"] == before["balance"] + 200

    def test_bot_nonexistent_user(self, api, bot_headers):
        r = api.get(f"{BASE_URL}/api/bot/user/nonexistent_xyz", headers=bot_headers)
        assert r.status_code == 404
