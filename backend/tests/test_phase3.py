"""Phase 3 backend tests — Leaderboard + Games (Cube + Prediction).

Also includes bot API regression checks.
"""
import os
import pytest
import requests


BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")

BOT_TOKEN = "458cdf2fc1274ec1959ef176893d5a96a28239acf6e533ef"

ANNA = ("anna@callhub.ua", "demo123")
MAKS = ("maks@callhub.ua", "demo123")
OLENA = ("olena@callhub.ua", "demo123")


# ────── Fixtures ──────
@pytest.fixture(scope="session")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _login(session, email, password):
    r = session.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return r.json()


def _headers(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="session")
def anna_headers(api):
    return _headers(_login(api, *ANNA)["token"])


@pytest.fixture(scope="session")
def maks_headers(api):
    return _headers(_login(api, *MAKS)["token"])


@pytest.fixture(scope="session")
def olena_headers(api):
    return _headers(_login(api, *OLENA)["token"])


@pytest.fixture
def bot_headers():
    return {"X-Bot-Token": BOT_TOKEN}


# ─────────────── Leaderboard ───────────────
class TestLeaderboard:
    def test_week(self, api, anna_headers):
        r = api.get(f"{BASE_URL}/api/leaderboard?period=week", headers=anna_headers)
        assert r.status_code == 200
        d = r.json()
        assert d["period"] == "week"
        assert isinstance(d["top"], list)
        # ranks are ordered starting at 1
        if d["top"]:
            assert d["top"][0]["rank"] == 1
            scores = [e["score"] for e in d["top"]]
            assert scores == sorted(scores, reverse=True)
        # my_entry must be None when user is in top-10 (only 3-4 employees seeded)
        assert d["my_entry"] is None

    def test_month(self, api, maks_headers):
        r = api.get(f"{BASE_URL}/api/leaderboard?period=month", headers=maks_headers)
        assert r.status_code == 200
        d = r.json()
        assert d["period"] == "month"
        assert isinstance(d["top"], list)
        assert d["my_entry"] is None  # only ~3 employees

    def test_all(self, api, anna_headers):
        r = api.get(f"{BASE_URL}/api/leaderboard?period=all", headers=anna_headers)
        assert r.status_code == 200
        d = r.json()
        assert d["period"] == "all"
        assert len(d["top"]) >= 3
        # By seed, Maks has highest total_earned
        assert d["top"][0]["name"].startswith("Максим")
        # rank sorted desc by score
        scores = [e["score"] for e in d["top"]]
        assert scores == sorted(scores, reverse=True)
        # Anna should have is_me=True somewhere in top
        me_rows = [e for e in d["top"] if e["is_me"]]
        assert len(me_rows) == 1
        # my_entry must be None because Anna is inside top-10
        assert d["my_entry"] is None

    def test_leaderboard_requires_auth(self, api):
        r = api.get(f"{BASE_URL}/api/leaderboard?period=week")
        assert r.status_code == 401

    def test_invalid_period(self, api, anna_headers):
        r = api.get(f"{BASE_URL}/api/leaderboard?period=bogus", headers=anna_headers)
        assert r.status_code == 422  # pydantic literal validation


# ─────────────── Games: cube + prediction ───────────────
class TestGames:
    def test_status_initial(self, api, olena_headers):
        r = api.get(f"{BASE_URL}/api/games/status", headers=olena_headers)
        assert r.status_code == 200
        d = r.json()
        assert "date" in d and "cube_spun" in d and "prediction_revealed" in d
        assert isinstance(d["cube_spun"], bool)
        assert isinstance(d["prediction_revealed"], bool)

    def test_status_requires_auth(self, api):
        r = api.get(f"{BASE_URL}/api/games/status")
        assert r.status_code == 401

    def test_prediction_reveal_idempotent(self, api, maks_headers):
        r1 = api.post(f"{BASE_URL}/api/games/prediction/reveal", headers=maks_headers)
        assert r1.status_code == 200, r1.text
        text1 = r1.json()["text"]
        assert isinstance(text1, str) and len(text1) > 5

        # second call must return SAME text
        r2 = api.post(f"{BASE_URL}/api/games/prediction/reveal", headers=maks_headers)
        assert r2.status_code == 200
        text2 = r2.json()["text"]
        assert text1 == text2, "prediction must be idempotent per user per day"

        # status now reflects revealed=True with same text
        s = api.get(f"{BASE_URL}/api/games/status", headers=maks_headers).json()
        assert s["prediction_revealed"] is True
        assert s["prediction_text"] == text1

    def test_cube_spin_and_paid_repeat(self, api, olena_headers):
        status = api.get(f"{BASE_URL}/api/games/status", headers=olena_headers).json()
        me_before = api.get(f"{BASE_URL}/api/auth/me", headers=olena_headers).json()

        r = api.post(f"{BASE_URL}/api/games/cube/spin", headers=olena_headers)
        assert r.status_code in {200, 400}, r.text
        if r.status_code == 200:
            body = r.json()
            assert body["face"] in {1, 2, 3, 4, 5, 6}
            assert body["tier"] in {"one", "two", "three", "four", "five", "six"}
            assert 0 <= body["reward"] <= 350
            expected_cost = 0 if int(status.get("cube_spin_count", 0)) == 0 else 50
            assert body["cost"] == expected_cost
            assert body["new_balance"] == me_before["balance"] + body["reward"] - expected_cost
            assert body["total_xp"] == me_before["total_xp"] + body["reward"] // 3

            s = api.get(f"{BASE_URL}/api/games/status", headers=olena_headers).json()
            assert s["cube_spun"] is True
            assert s["cube_spin_count"] == body["spin_count"]
            assert s["cube_face"] == body["face"]
            assert s["next_spin_cost"] == 50

    def test_cube_requires_auth(self, api):
        r = api.post(f"{BASE_URL}/api/games/cube/spin")
        assert r.status_code == 401

    def test_prediction_requires_auth(self, api):
        r = api.post(f"{BASE_URL}/api/games/prediction/reveal")
        assert r.status_code == 401


# ─────────────── Bot API regression ───────────────
class TestBotRegression:
    def test_bot_leaderboard_no_token(self, api):
        r = api.get(f"{BASE_URL}/api/bot/leaderboard")
        assert r.status_code == 401

    def test_bot_leaderboard_with_token(self, api, bot_headers):
        r = api.get(f"{BASE_URL}/api/bot/leaderboard?limit=5", headers=bot_headers)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert len(data) >= 1
        assert data[0]["rank"] == 1
