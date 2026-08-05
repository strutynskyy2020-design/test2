from pathlib import Path
import ast

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "frontend" / "src"

css = (SRC / "index.css").read_text()
for token in (
    "v138 · LIGHT THEME CONTRAST HARDENING",
    "html.light .diamond-challenge-card",
    "html.light .team-bank-hero-card",
    "html.light .admin-diamond-avatar-panel",
    "html.light .admin-team-filter-select",
    '.bg-\\[\\#111114\\]',
    'select option',
):
    assert token in css, token

assert "diamond-challenge-card" in (SRC / "pages" / "Tasks.jsx").read_text()
assert "team-bank-hero-card" in (SRC / "pages" / "Store.jsx").read_text()
admin = (SRC / "pages" / "Admin.jsx").read_text()
assert "admin-diamond-avatar-panel" in admin
assert "admin-team-filter-select" in admin

server_path = ROOT / "backend" / "server.py"
server_text = server_path.read_text()
server_ast = ast.parse(server_text)

def default_for(name: str, argument: str):
    for node in ast.walk(server_ast):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
            args = node.args.args
            defaults = node.args.defaults
            start = len(args) - len(defaults)
            mapping = {args[start + i].arg: defaults[i] for i in range(len(defaults))}
            value = mapping.get(argument)
            return value.value if isinstance(value, ast.Constant) else None
    raise AssertionError(f"function not found: {name}")

assert default_for("_leaderboard_for_period", "limit") == 20
assert default_for("bot_leaderboard", "limit") == 20

sw = (ROOT / "frontend" / "public" / "service-worker.js").read_text()
pwa = (SRC / "lib" / "pwa.js").read_text()
assert 'const VERSION = "vpdk-v138";' in sw
assert '/service-worker.js?v=138' in pwa

print("v138 light-theme and top-20 LeaderBoard validation passed")
