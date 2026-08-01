from pathlib import Path
import json

ROOT = Path(__file__).resolve().parent
APP = (ROOT / "frontend/src/App.js").read_text(encoding="utf-8")
LAYOUT = (ROOT / "frontend/src/components/AppLayout.jsx").read_text(encoding="utf-8")
HOME = (ROOT / "frontend/src/pages/Home.jsx").read_text(encoding="utf-8")
SUDOKU = (ROOT / "frontend/src/pages/Sudoku.jsx").read_text(encoding="utf-8")
SUDOKU_CSS = (ROOT / "frontend/src/styles/sudoku.css").read_text(encoding="utf-8")
INDEX_CSS = (ROOT / "frontend/src/index.css").read_text(encoding="utf-8")
SW = (ROOT / "frontend/public/service-worker.js").read_text(encoding="utf-8")
MANIFEST = json.loads((ROOT / "frontend/public/manifest.json").read_text(encoding="utf-8"))
INDEX = (ROOT / "frontend/public/index.html").read_text(encoding="utf-8")

assert 'defaultTheme="dark"' in APP
assert 'storageKey="vpdk-color-theme"' in APP
assert 'vpdk-dark-theme-default-v111' in APP
assert 'VPDK <span className="text-[#FFB800]">BONUS</span>' in LAYOUT
assert 'VPDK SUDOKU' in HOME
assert '<h1>VPDK <b>SUDOKU</b></h1>' in SUDOKU
assert 'html.light .home-sudoku-card' in INDEX_CSS
assert 'html.light .sudoku-board-shell' in SUDOKU_CSS
assert 'const VERSION = "vpdk-v111";' in SW
assert MANIFEST["name"] == "VPDK Bonus"
assert MANIFEST["short_name"] == "VPDK Bonus"
assert '<title>VPDK Bonus</title>' in INDEX
for asset in ["icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png", "splash-750x1334.png", "splash-1125x2436.png"]:
    path = ROOT / "frontend/public" / asset
    assert path.exists() and path.stat().st_size > 1000, asset

print("v111 VPDK brand, dark theme, PWA assets, and Sudoku palette validation: OK")
