"""CallHub Game Hub — PWA + Motivational Feed tests (Iteration 4).

Covers:
- PWA static assets served correctly (/manifest.json, /service-worker.js, icons).
- GET /api/feed structure, auth, filter by kind sanity, limit param,
  and that new events (admin adjust + purchase) appear in the feed.
"""
import io
import os
import struct
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")

ADMIN_EMAIL = "admin@callhub.ua"
ADMIN_PW = "admin123"
ANNA_EMAIL = "anna@callhub.ua"
ANNA_PW = "demo123"


# ────────── Fixtures ──────────
@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _login(api, email, pw):
    r = api.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_headers(api):
    return {"Authorization": f"Bearer {_login(api, ADMIN_EMAIL, ADMIN_PW)}"}


@pytest.fixture(scope="module")
def anna_headers(api):
    return {"Authorization": f"Bearer {_login(api, ANNA_EMAIL, ANNA_PW)}"}


# ────────── PWA static asset tests ──────────
class TestPWAAssets:
    def test_manifest_served(self, api):
        r = api.get(f"{BASE_URL}/manifest.json")
        assert r.status_code == 200
        # Content-type may be application/json or application/manifest+json
        ct = r.headers.get("content-type", "")
        assert "json" in ct
        m = r.json()
        assert m["name"] == "CallHub Game Hub"
        assert m["short_name"]
        assert m["start_url"] == "/"
        assert m["display"] == "standalone"
        assert m["theme_color"]
        # icons must include at least 192 and 512
        sizes = {i["sizes"] for i in m["icons"]}
        assert "192x192" in sizes
        assert "512x512" in sizes
        # maskable icon present
        assert any(i.get("purpose") == "maskable" for i in m["icons"])

    def test_service_worker_served(self, api):
        r = api.get(f"{BASE_URL}/service-worker.js")
        assert r.status_code == 200
        ct = r.headers.get("content-type", "")
        assert "javascript" in ct
        body = r.text
        # basic sanity: must reference core SW events
        assert "install" in body or "fetch" in body
        assert len(body) > 200  # not an empty stub

    @pytest.mark.parametrize("path,min_size", [
        ("/icon-192.png", 192),
        ("/icon-512.png", 512),
        ("/apple-touch-icon.png", 180),
        ("/favicon-64.png", 64),
        ("/icon-maskable-512.png", 512),
    ])
    def test_icon_is_valid_png(self, api, path, min_size):
        r = api.get(f"{BASE_URL}{path}")
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("image/png")
        # PNG signature check
        assert r.content[:8] == b"\x89PNG\r\n\x1a\n", f"{path} is not a valid PNG"
        # IHDR chunk: bytes 16-24 are width, height (big-endian uint32 each)
        w, h = struct.unpack(">II", r.content[16:24])
        assert w >= 1 and h >= 1, f"{path} has invalid dims {w}x{h}"

    def test_index_has_pwa_meta(self, api):
        r = api.get(f"{BASE_URL}/")
        assert r.status_code == 200
        html = r.text
        assert 'rel="manifest"' in html
        assert 'apple-touch-icon' in html
        assert 'apple-mobile-web-app-capable' in html
        assert 'apple-mobile-web-app-status-bar-style' in html
        assert 'theme-color' in html


# ────────── Feed API tests ──────────
class TestFeedAPI:
    def test_feed_requires_auth(self, api):
        r = api.get(f"{BASE_URL}/api/feed")
        assert r.status_code in (401, 403)

    def test_feed_basic_structure(self, api, anna_headers):
        r = api.get(f"{BASE_URL}/api/feed", headers=anna_headers)
        assert r.status_code == 200
        data = r.json()
        assert "events" in data
        assert isinstance(data["events"], list)
        # Should have some pre-seeded activity for demo employees
        assert len(data["events"]) > 0
        # Validate schema of each event
        allowed_kinds = {"quest", "purchase", "level_up", "cube", "prize_delivered"}
        for ev in data["events"]:
            for k in ("id", "kind", "user_id", "user_name",
                      "avatar_initials", "avatar_color", "title", "created_at"):
                assert k in ev, f"Missing key {k} in {ev}"
            assert ev["kind"] in allowed_kinds
            assert isinstance(ev["user_name"], str) and ev["user_name"]

    def test_feed_sorted_desc(self, api, anna_headers):
        r = api.get(f"{BASE_URL}/api/feed?limit=20", headers=anna_headers)
        events = r.json()["events"]
        if len(events) >= 2:
            for a, b in zip(events, events[1:]):
                assert a["created_at"] >= b["created_at"], (
                    f"Feed not sorted desc: {a['created_at']} < {b['created_at']}"
                )

    def test_feed_limit_respected(self, api, anna_headers):
        r = api.get(f"{BASE_URL}/api/feed?limit=5", headers=anna_headers)
        assert r.status_code == 200
        assert len(r.json()["events"]) <= 5

    def test_feed_reflects_admin_adjust(self, api, admin_headers, anna_headers):
        # Get Anna user id
        users = api.get(f"{BASE_URL}/api/admin/users", headers=admin_headers).json()
        anna = next(u for u in users if u["email"] == ANNA_EMAIL)

        marker = f"TEST_feed_bonus_{os.getpid()}"
        r = api.patch(
            f"{BASE_URL}/api/admin/users/{anna['id']}/points",
            json={"amount": 10, "description": marker},
            headers=admin_headers,
        )
        assert r.status_code == 200

        # Query the feed — should include this event
        feed = api.get(f"{BASE_URL}/api/feed?limit=60", headers=anna_headers).json()["events"]
        # admin_adjust with positive amount is classified as kind='quest' by server.
        # We look up by subtitle == marker (server uses full description as subtitle for admin_adjust)
        matched = [e for e in feed if marker in (e.get("subtitle", "") or "")]
        assert matched, f"admin adjust with marker '{marker}' not found in feed"
        assert matched[0]["user_id"] == anna["id"]
        assert matched[0]["amount"] == 10

    def test_feed_reflects_purchase(self, api, admin_headers, anna_headers):
        # Ensure anna has balance
        users = api.get(f"{BASE_URL}/api/admin/users", headers=admin_headers).json()
        anna = next(u for u in users if u["email"] == ANNA_EMAIL)
        api.patch(
            f"{BASE_URL}/api/admin/users/{anna['id']}/points",
            json={"amount": 5000, "description": "TEST_top_up_for_purchase"},
            headers=admin_headers,
        )

        # Buy the cheapest prize
        prizes = api.get(f"{BASE_URL}/api/prizes", headers=anna_headers).json()
        cheap = sorted([p for p in prizes if p["stock"] > 0], key=lambda p: p["price"])[0]
        buy = api.post(f"{BASE_URL}/api/prizes/{cheap['id']}/buy", headers=anna_headers)
        assert buy.status_code == 200, buy.text

        feed = api.get(f"{BASE_URL}/api/feed?limit=60", headers=anna_headers).json()["events"]
        purchases = [e for e in feed if e["kind"] == "purchase" and e["user_id"] == anna["id"]]
        assert purchases, "Purchase event not found in feed after buying a prize"
        # Newest purchase should mention the prize title
        assert any(cheap["title"] in (p.get("subtitle", "") or "") for p in purchases)

    def test_feed_all_kinds_valid(self, api, anna_headers):
        """Ensure no unexpected 'kind' values leak out."""
        r = api.get(f"{BASE_URL}/api/feed?limit=100", headers=anna_headers)
        assert r.status_code == 200
        allowed = {"quest", "purchase", "level_up", "cube", "prize_delivered"}
        kinds = {e["kind"] for e in r.json()["events"]}
        assert kinds.issubset(allowed), f"Unexpected kinds: {kinds - allowed}"
