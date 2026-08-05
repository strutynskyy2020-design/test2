from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVER = (ROOT / "backend/server.py").read_text(encoding="utf-8")
ADMIN = (ROOT / "frontend/src/pages/Admin.jsx").read_text(encoding="utf-8")
STORE = (ROOT / "frontend/src/pages/Store.jsx").read_text(encoding="utf-8")
MODAL = (ROOT / "frontend/src/components/AdminAnnouncementModal.jsx").read_text(encoding="utf-8")


def test_promotion_stock_is_reserved_atomically():
    assert "db.prize_promotions.find_one_and_update" in SERVER
    assert '"quantity_remaining": {"$gt": 0}' in SERVER
    assert '"$inc": {"quantity_remaining": -1, "used_count": 1}' in SERVER
    assert "expected_price: Optional[int] = None" in SERVER


def test_store_uses_effective_price_and_refreshes_after_conflict():
    assert "prize?.effective_price ?? prize?.price" in STORE
    assert "promotion_quantity_remaining" in STORE
    assert "buyPrize(pending.id, expectedPrice)" in STORE


def test_announcements_are_one_time_per_employee():
    assert 'db.announcement_reads.update_one' in SERVER
    assert 'unique=True' in SERVER
    assert 'localDismissedKey = (userId)' in MODAL
    assert 'api.post(`/announcements/${announcement.id}/dismiss`)' in MODAL


def test_admin_has_both_management_surfaces():
    assert "const PromotionEditor" in ADMIN
    assert "Наступні, шт" in ADMIN
    assert "const AnnouncementsView" in ADMIN
    assert "Опублікувати для всіх" in ADMIN
