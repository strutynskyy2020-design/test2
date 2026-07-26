from pathlib import Path

ROOT = Path(__file__).resolve().parent
FRONTEND = ROOT / "frontend" / "src"

checks = {
    "Theme provider": (FRONTEND / "App.js", 'storageKey="tm6-color-theme"'),
    "Theme toaster": (FRONTEND / "App.js", 'theme={isLight ? "light" : "dark"}'),
    "Theme component": (FRONTEND / "components" / "ThemeToggle.jsx", 'data-testid="theme-toggle"'),
    "Header toggle": (FRONTEND / "components" / "AppLayout.jsx", '<ThemeToggle />'),
    "Login toggle": (FRONTEND / "pages" / "Login.jsx", '<ThemeToggle compact'),
    "Register toggle": (FRONTEND / "pages" / "Register.jsx", '<ThemeToggle compact'),
    "Light root palette": (FRONTEND / "index.css", 'html.light {'),
    "Light app shell": (FRONTEND / "index.css", 'html.light .app-theme-shell'),
    "Frameless pieces": (FRONTEND / "index.css", '.bonus-match-light-theme [data-bonus-piece]'),
}

failed = []
for label, (path, needle) in checks.items():
    text = path.read_text(encoding="utf-8")
    if needle not in text:
        failed.append(f"{label}: missing {needle!r} in {path.relative_to(ROOT)}")

css = (FRONTEND / "index.css").read_text(encoding="utf-8")
if css.count("{") != css.count("}"):
    failed.append("CSS braces are unbalanced")

if failed:
    print("V94 theme validation FAILED")
    for item in failed:
        print("-", item)
    raise SystemExit(1)

print("V94 theme validation OK")
print(f"Validated {len(checks)} theme integration points.")
