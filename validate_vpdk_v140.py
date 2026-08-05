from __future__ import annotations

import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SERVER = ROOT / "backend" / "server.py"
ADMIN = ROOT / "frontend" / "src" / "pages" / "Admin.jsx"
STORE = ROOT / "frontend" / "src" / "pages" / "Store.jsx"
CONTEXT = ROOT / "frontend" / "src" / "context" / "AppContext.jsx"
LAYOUT = ROOT / "frontend" / "src" / "components" / "AppLayout.jsx"
MODAL = ROOT / "frontend" / "src" / "components" / "AdminAnnouncementModal.jsx"
CSS = ROOT / "frontend" / "src" / "index.css"
SW = ROOT / "frontend" / "public" / "service-worker.js"

server = SERVER.read_text(encoding="utf-8")
admin = ADMIN.read_text(encoding="utf-8")
store = STORE.read_text(encoding="utf-8")
context = CONTEXT.read_text(encoding="utf-8")
layout = LAYOUT.read_text(encoding="utf-8")
modal = MODAL.read_text(encoding="utf-8")
css = CSS.read_text(encoding="utf-8")
sw = SW.read_text(encoding="utf-8")

# Python syntax and models.
ast.parse(server)
for token in (
    "class PrizePromotionCreateBody",
    "class PrizePromotionModel",
    "class AnnouncementCreateBody",
    "class AnnouncementUpdateBody",
    "class AnnouncementModel",
    "effective_price: int = 0",
    "promotion_quantity_remaining: int = 0",
    "base_price: Optional[int] = None",
    "discount_points: int = 0",
):
    assert token in server, token

# Quantity-limited discounts are calculated server-side and consumed atomically.
for token in (
    "async def _active_prize_promotion",
    '@api.post("/admin/prizes/{prize_id}/promotion"',
    '@api.delete("/admin/prizes/{prize_id}/promotion"',
    'db.prize_promotions.find_one_and_update',
    '"quantity_remaining": {"$gt": 0}',
    '"$inc": {"quantity_remaining": -1, "used_count": 1}',
    "expected_price: Optional[int] = None",
    "Ціна змінилася. Оновіть магазин",
    '"base_price": base_price',
    '"discount_points": promotion_discount',
    '"promotion_id": promotion_id',
    'await db.prize_promotions.create_index',
):
    assert token in server, token

# One-time announcements: admin CRUD, employee pending endpoint and unique read receipt.
for token in (
    '@api.get("/announcements/pending"',
    '@api.post("/announcements/{announcement_id}/dismiss"',
    '@api.get("/admin/announcements"',
    '@api.post("/admin/announcements"',
    '@api.patch("/admin/announcements/{announcement_id}"',
    '@api.delete("/admin/announcements/{announcement_id}"',
    'if user.get("role") == "admin":',
    'db.announcement_reads.update_one',
    'await db.announcement_reads.create_index([("announcement_id", 1), ("user_id", 1)], unique=True)',
):
    assert token in server, token

# Store always renders and confirms the current effective price.
for token in (
    "const prizePrice =",
    "prize?.effective_price ?? prize?.price",
    "Акція −",
    "promotion_quantity_remaining",
    "expectedPrice",
    "buyPrize(pending.id, expectedPrice)",
    "prizePrice(a, false) - prizePrice(b, false)",
):
    assert token in store or token in context, token
assert "expected_price" in context
assert "data.prize" in context

# Admin controls.
for token in (
    '{ id: "announcements", label: "Повідомлення", icon: Megaphone }',
    "const PromotionEditor",
    "Знижка, Point",
    "Наступні, шт",
    "const AnnouncementsView",
    "const AnnouncementEditor",
    "Опублікувати для всіх",
    "Закрили:",
    "акція −",
):
    assert token in admin, token

# Global one-time modal.
for token in (
    'import AdminAnnouncementModal from "@/components/AdminAnnouncementModal"',
    "<AdminAnnouncementModal user={user} />",
):
    assert token in layout, token
for token in (
    'api.get("/announcements/pending"',
    'api.post(`/announcements/${announcement.id}/dismiss`)',
    "Повідомлення адміністратора",
    "Зрозуміло",
    "localStorage",
):
    assert token in modal, token

# Theme and cache version.
for token in (
    ".admin-announcement-card",
    "html.light .admin-announcement-card",
    "html.light .admin-promotion-info",
    "html.light .admin-announcement-list-card",
):
    assert token in css, token
assert 'const VERSION = "vpdk-v140";' in sw

# Previous v139 economy remains intact.
for token in (
    "BONUS_MATCH_FIRST_CLEAR_POINTS = 2",
    "SUDOKU_FIRST_CLEAR_POINTS = 2",
    "CUBE_SPIN_COST = 20",
):
    assert token in server, token

print("v140 prize promotions and one-time announcements validation passed")
