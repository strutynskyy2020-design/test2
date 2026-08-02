from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "frontend" / "src"
CSS = (SRC / "index.css").read_text(encoding="utf-8")
STORE = (SRC / "pages" / "Store.jsx").read_text(encoding="utf-8")
ADMIN = (SRC / "pages" / "Admin.jsx").read_text(encoding="utf-8")
BACKEND = (ROOT / "backend" / "server.py").read_text(encoding="utf-8")
SW = (ROOT / "frontend" / "public" / "service-worker.js").read_text(encoding="utf-8")


def rgb(hex_color: str) -> tuple[float, float, float]:
    value = hex_color.lstrip("#")
    return tuple(int(value[i : i + 2], 16) / 255 for i in (0, 2, 4))


def luminance(hex_color: str) -> float:
    channels = []
    for channel in rgb(hex_color):
        channels.append(channel / 12.92 if channel <= 0.03928 else ((channel + 0.055) / 1.055) ** 2.4)
    r, g, b = channels
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(first: str, second: str) -> float:
    bright, dark = sorted((luminance(first), luminance(second)), reverse=True)
    return (bright + 0.05) / (dark + 0.05)


# All routed pages must be considered by the shared light-theme audit. The two
# game pages intentionally use their own dedicated light-theme systems.
page_names = {path.stem for path in (SRC / "pages").glob("*.jsx")}
expected_pages = {
    "AITrainer", "Admin", "BonusMatch", "CreditGoals", "CreditLeaderboard",
    "DebitIssuances", "DebitLeaderboard", "Feed", "Fun", "Goals", "History",
    "Home", "Leaderboard", "Login", "Quests", "Register", "Schedule", "Store",
    "Sudoku", "Tasks", "Teams",
}
assert expected_pages <= page_names, sorted(expected_pages - page_names)
assert "app-theme-shell:not(.game-only-app-shell)" in CSS
assert "html.light .sudoku-page" in (SRC / "styles" / "sudoku.css").read_text(encoding="utf-8")
assert "html.light .bonus-match-light-theme" in CSS

# Contrast-safe light theme tokens used for all small labels and accents.
for token in [
    "--light-text-strong", "--light-text-body", "--light-text-muted",
    "--light-text-subtle", "--light-amber", "--light-orange", "--light-cyan",
    "--light-purple", "--light-green", "--light-red", "--light-blue",
]:
    assert token in CSS, token

for foreground in ["#20242E", "#3F4654", "#5F6675", "#6D7482", "#9A5800", "#B9380B", "#00717D", "#6D3DF5", "#15803D", "#B42318", "#1D4ED8"]:
    assert contrast(foreground, "#FFFFFF") >= 4.5, (foreground, contrast(foreground, "#FFFFFF"))

# No report page may keep an inline dark gradient that would clash with the
# globally converted dark text in light mode.
for page in ["CreditGoals.jsx", "CreditLeaderboard.jsx", "DebitLeaderboard.jsx"]:
    contents = (SRC / "pages" / page).read_text(encoding="utf-8")
    assert "rgba(26,26,30" not in contents, page
assert "credit-goals-summary-card" in CSS
assert "credit-leaderboard-metric-card" in CSS
assert "debit-leaderboard-metric-card" in CSS

# Store catalogue: merch/certificates are hidden, avatars are not included in
# the generic All tab, and all five rarities get their own compact shelf.
assert '{ id: "merch"' not in STORE
assert '{ id: "certificate"' not in STORE
assert 'new Set(["merch", "certificate"])' in STORE
assert 'prize.category !== "avatar"' in STORE
assert 'cat === "avatar"' in STORE
for rarity in ["basic", "improved", "rare", "epic", "legendary"]:
    assert f'id: "{rarity}"' in STORE, rarity
assert "store-avatar-row" in STORE
assert "store-avatar-card" in STORE
assert 'size="sm"' in STORE

# Admin can add, subtract, or set an exact balance. Exact correction must not
# create XP on the server.
assert 'data-testid="adjust-add"' in ADMIN
assert 'data-testid="adjust-subtract"' in ADMIN
assert 'data-testid="adjust-set"' in ADMIN
assert 'mode: "set"' in ADMIN
assert 'label: "Бали та баланс"' in ADMIN
assert 'mode: Literal["delta", "set"]' in BACKEND
assert 'if body.mode == "set"' in BACKEND
assert 'if body.mode == "delta" and delta > 0' in BACKEND
assert '"adjustment_mode": body.mode' in BACKEND

assert 'const VERSION = "vpdk-v113";' in SW

# Basic delimiter checks catch accidental truncation in generated artifacts.
for relative in ["frontend/src/pages/Store.jsx", "frontend/src/pages/Admin.jsx", "frontend/src/index.css"]:
    text = (ROOT / relative).read_text(encoding="utf-8")
    assert text.count("{") == text.count("}"), relative

print("VPDK Bonus v113 validation passed")
