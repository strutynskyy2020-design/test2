"""Phase 2 social features tests: reactions + comments on feed events."""
import os
import pytest
import requests

def _load_url():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if not v:
        # fallback to frontend .env
        try:
            with open("/app/frontend/.env") as f:
                for line in f:
                    if line.startswith("REACT_APP_BACKEND_URL="):
                        v = line.split("=", 1)[1].strip()
                        break
        except Exception:
            pass
    assert v, "REACT_APP_BACKEND_URL missing"
    return v.rstrip("/")

BASE_URL = _load_url()
API = f"{BASE_URL}/api"


def _login(email: str, pwd: str) -> str:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pwd}, timeout=15)
    assert r.status_code == 200, f"login failed {email}: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def anna_token():
    return _login("anna@callhub.ua", "demo123")


@pytest.fixture(scope="module")
def maks_token():
    return _login("maks@callhub.ua", "demo123")


@pytest.fixture(scope="module")
def admin_token():
    return _login("admin@callhub.ua", "admin123")


def _hdr(t):
    return {"Authorization": f"Bearer {t}"}


def _get_feed(token):
    r = requests.get(f"{API}/feed", headers=_hdr(token), params={"limit": 60}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["events"]


# ── Reactions ────────────────────────────────────────────────────────────
class TestReactions:
    def test_feed_events_have_social_fields(self, anna_token):
        events = _get_feed(anna_token)
        assert len(events) > 0, "expected feed events"
        e = events[0]
        assert "reactions" in e
        assert "my_reaction" in e
        assert "comment_count" in e

    def test_react_set_replace_toggle(self, anna_token):
        events = _get_feed(anna_token)
        # Pick an event NOT owned by anna to avoid notification path complexity
        ev = events[0]
        eid = ev["id"]

        # 1) SET like
        r = requests.post(f"{API}/feed/{eid}/react", headers=_hdr(anna_token), json={"emoji": "like"}, timeout=10)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["action"] == "set"
        assert d["my_reaction"] == "like"
        assert d["reactions"].get("like", 0) >= 1

        # 2) REPLACE with fire — like count for anna should move to fire
        r2 = requests.post(f"{API}/feed/{eid}/react", headers=_hdr(anna_token), json={"emoji": "fire"}, timeout=10)
        assert r2.status_code == 200
        d2 = r2.json()
        assert d2["action"] == "set"
        assert d2["my_reaction"] == "fire"
        assert d2["reactions"].get("fire", 0) >= 1

        # Verify only one reaction per user via feed enrichment
        evs = _get_feed(anna_token)
        got = next((x for x in evs if x["id"] == eid), None)
        assert got is not None
        assert got["my_reaction"] == "fire"

        # 3) TOGGLE fire off
        r3 = requests.post(f"{API}/feed/{eid}/react", headers=_hdr(anna_token), json={"emoji": "fire"}, timeout=10)
        assert r3.status_code == 200
        d3 = r3.json()
        assert d3["action"] == "removed"
        assert d3["my_reaction"] is None

    def test_one_reaction_per_user_unique(self, anna_token, maks_token):
        events = _get_feed(anna_token)
        eid = events[0]["id"]
        # anna & maks both react
        requests.post(f"{API}/feed/{eid}/react", headers=_hdr(anna_token), json={"emoji": "clap"}, timeout=10)
        requests.post(f"{API}/feed/{eid}/react", headers=_hdr(maks_token), json={"emoji": "clap"}, timeout=10)
        # Check summary
        evs = _get_feed(anna_token)
        got = next((x for x in evs if x["id"] == eid), None)
        assert got["reactions"].get("clap", 0) >= 2
        # cleanup
        requests.post(f"{API}/feed/{eid}/react", headers=_hdr(anna_token), json={"emoji": "clap"}, timeout=10)
        requests.post(f"{API}/feed/{eid}/react", headers=_hdr(maks_token), json={"emoji": "clap"}, timeout=10)


# ── Comments ─────────────────────────────────────────────────────────────
class TestComments:
    def test_comment_create_list_delete(self, anna_token):
        events = _get_feed(anna_token)
        eid = events[0]["id"]

        # create
        r = requests.post(f"{API}/feed/{eid}/comments", headers=_hdr(anna_token), json={"text": "TEST_comment_hello"}, timeout=10)
        assert r.status_code == 201, r.text
        c = r.json()
        assert c["text"] == "TEST_comment_hello"
        assert c["user_name"]
        cid = c["id"]

        # list
        r2 = requests.get(f"{API}/feed/{eid}/comments", headers=_hdr(anna_token), timeout=10)
        assert r2.status_code == 200
        arr = r2.json()
        assert any(x["id"] == cid for x in arr)

        # count reflected in feed
        evs = _get_feed(anna_token)
        got = next((x for x in evs if x["id"] == eid), None)
        assert got["comment_count"] >= 1

        # delete own
        r3 = requests.delete(f"{API}/comments/{cid}", headers=_hdr(anna_token), timeout=10)
        assert r3.status_code == 204

        # ensure gone
        r4 = requests.get(f"{API}/feed/{eid}/comments", headers=_hdr(anna_token), timeout=10)
        assert not any(x["id"] == cid for x in r4.json())

    def test_admin_can_delete_any_comment(self, anna_token, admin_token):
        events = _get_feed(anna_token)
        eid = events[0]["id"]
        r = requests.post(f"{API}/feed/{eid}/comments", headers=_hdr(anna_token), json={"text": "TEST_anna_says_hi"}, timeout=10)
        assert r.status_code == 201
        cid = r.json()["id"]
        # admin deletes anna's comment
        rd = requests.delete(f"{API}/comments/{cid}", headers=_hdr(admin_token), timeout=10)
        assert rd.status_code == 204

    def test_non_owner_cannot_delete(self, anna_token, maks_token):
        events = _get_feed(anna_token)
        eid = events[0]["id"]
        r = requests.post(f"{API}/feed/{eid}/comments", headers=_hdr(anna_token), json={"text": "TEST_only_mine"}, timeout=10)
        cid = r.json()["id"]
        rd = requests.delete(f"{API}/comments/{cid}", headers=_hdr(maks_token), timeout=10)
        assert rd.status_code == 403
        # cleanup
        requests.delete(f"{API}/comments/{cid}", headers=_hdr(anna_token), timeout=10)

    def test_empty_comment_rejected(self, anna_token):
        events = _get_feed(anna_token)
        eid = events[0]["id"]
        r = requests.post(f"{API}/feed/{eid}/comments", headers=_hdr(anna_token), json={"text": "   "}, timeout=10)
        assert r.status_code == 400


# ── Notifications on cross-user actions ──────────────────────────────────
class TestSocialNotifications:
    def _notif_count(self, token, kind):
        r = requests.get(f"{API}/notifications", headers=_hdr(token), timeout=10)
        assert r.status_code == 200
        return sum(1 for n in r.json() if n.get("kind") == kind)

    def test_reaction_notifies_owner_not_self(self, anna_token, maks_token):
        # find an event owned by anna
        events = _get_feed(anna_token)
        anna_me = requests.get(f"{API}/auth/me", headers=_hdr(anna_token), timeout=10).json()
        anna_id = anna_me["id"]
        anna_event = next((e for e in events if e.get("user_id") == anna_id), None)
        if not anna_event:
            pytest.skip("no anna-owned feed event available")
        eid = anna_event["id"]

        before = self._notif_count(anna_token, "reaction")
        r = requests.post(f"{API}/feed/{eid}/react", headers=_hdr(maks_token), json={"emoji": "rocket"}, timeout=10)
        assert r.status_code == 200
        after = self._notif_count(anna_token, "reaction")
        assert after >= before + 1, "anna should receive a reaction notification"

        # anna reacts to own event → should NOT notify herself
        before_self = self._notif_count(anna_token, "reaction")
        requests.post(f"{API}/feed/{eid}/react", headers=_hdr(anna_token), json={"emoji": "heart"}, timeout=10)
        after_self = self._notif_count(anna_token, "reaction")
        assert after_self == before_self, "self reaction must not notify self"

        # cleanup
        requests.post(f"{API}/feed/{eid}/react", headers=_hdr(anna_token), json={"emoji": "heart"}, timeout=10)
        requests.post(f"{API}/feed/{eid}/react", headers=_hdr(maks_token), json={"emoji": "rocket"}, timeout=10)

    def test_comment_notifies_owner_not_self(self, anna_token, maks_token):
        events = _get_feed(anna_token)
        anna_me = requests.get(f"{API}/auth/me", headers=_hdr(anna_token), timeout=10).json()
        anna_id = anna_me["id"]
        anna_event = next((e for e in events if e.get("user_id") == anna_id), None)
        if not anna_event:
            pytest.skip("no anna-owned feed event available")
        eid = anna_event["id"]

        before = self._notif_count(anna_token, "comment")
        r = requests.post(f"{API}/feed/{eid}/comments", headers=_hdr(maks_token), json={"text": "TEST_maks_pings_anna"}, timeout=10)
        assert r.status_code == 201
        after = self._notif_count(anna_token, "comment")
        assert after >= before + 1

        # self-comment shouldn't notify self
        before_self = self._notif_count(anna_token, "comment")
        r2 = requests.post(f"{API}/feed/{eid}/comments", headers=_hdr(anna_token), json={"text": "TEST_self_note"}, timeout=10)
        after_self = self._notif_count(anna_token, "comment")
        assert after_self == before_self

        # cleanup
        for cid in (r.json()["id"], r2.json()["id"]):
            requests.delete(f"{API}/comments/{cid}", headers=_hdr(anna_token), timeout=10)


# ── Persistence ──────────────────────────────────────────────────────────
class TestPersistence:
    def test_reaction_and_comment_persist_across_reload(self, anna_token):
        events = _get_feed(anna_token)
        # use last event to avoid race with other test classes using events[0]
        eid = events[-1]["id"]
        # ensure clean state
        evs0 = _get_feed(anna_token)
        got0 = next((x for x in evs0 if x["id"] == eid), None)
        if got0 and got0.get("my_reaction"):
            requests.post(f"{API}/feed/{eid}/react", headers=_hdr(anna_token), json={"emoji": got0["my_reaction"]}, timeout=10)
        requests.post(f"{API}/feed/{eid}/react", headers=_hdr(anna_token), json={"emoji": "star"}, timeout=10)
        cr = requests.post(f"{API}/feed/{eid}/comments", headers=_hdr(anna_token), json={"text": "TEST_persist"}, timeout=10)
        cid = cr.json()["id"]

        # "reload"
        evs = _get_feed(anna_token)
        got = next((x for x in evs if x["id"] == eid), None)
        assert got["my_reaction"] == "star"
        assert got["reactions"].get("star", 0) >= 1
        assert got["comment_count"] >= 1

        # cleanup
        requests.post(f"{API}/feed/{eid}/react", headers=_hdr(anna_token), json={"emoji": "star"}, timeout=10)
        requests.delete(f"{API}/comments/{cid}", headers=_hdr(anna_token), timeout=10)
