from pathlib import Path
from PIL import Image
import ast

ROOT = Path(__file__).resolve().parent
SERVER = ROOT / "backend" / "server.py"
AVATAR_FRAME = ROOT / "frontend" / "src" / "components" / "AvatarFrame.jsx"
TASKS = ROOT / "frontend" / "src" / "pages" / "Tasks.jsx"
ADMIN = ROOT / "frontend" / "src" / "pages" / "Admin.jsx"
SW = ROOT / "frontend" / "public" / "service-worker.js"

ast.parse(SERVER.read_text(encoding="utf-8"))
server = SERVER.read_text(encoding="utf-8")
frame = AVATAR_FRAME.read_text(encoding="utf-8")
tasks = TASKS.read_text(encoding="utf-8")
admin = ADMIN.read_text(encoding="utf-8")

checks = {
    "diamond rarity": '"diamond"' in frame,
    "male frame mapping": "/avatar-frames/diamond-male.png" in frame,
    "female frame mapping": "/avatar-frames/diamond-female.webp" in frame,
    "admin grant endpoint": '/admin/users/{user_id}/diamond-avatar' in server,
    "three day duration": "DIAMOND_AVATAR_DURATION_DAYS = 3" in server,
    "daily point perk": "DIAMOND_AVATAR_DAILY_BONUS = 100" in server,
    "replacement perk": "DIAMOND_AVATAR_TASK_REPLACEMENTS = 5" in server,
    "expiry restore": "_restore_avatar_after_diamond" in server,
    "cleanup loop": "_diamond_avatar_cleanup_loop" in server,
    "permanent challenge": "Зроби 10 видач кредитних продуктів" in tasks,
    "four previews": "DIAMOND_AVATARS.map" in tasks,
    "admin selector": "DiamondAvatarAdminPanel" in admin,
    "service worker v133": 'const VERSION = "vpdk-v133";' in SW.read_text(encoding="utf-8"),
}
failed = [name for name, ok in checks.items() if not ok]
if failed:
    raise SystemExit("FAILED: " + ", ".join(failed))

assets = [
    ROOT / "frontend/public/avatar-frames/diamond-male.png",
    ROOT / "frontend/public/avatar-frames/diamond-female.webp",
    ROOT / "frontend/public/avatars/male-diamond-1.webp",
    ROOT / "frontend/public/avatars/female-diamond-1.webp",
    ROOT / "frontend/public/avatars/female-diamond-2.webp",
    ROOT / "frontend/public/avatars/female-diamond-3.webp",
]
for asset in assets:
    if not asset.exists() or asset.stat().st_size < 1000:
        raise SystemExit(f"Missing or empty asset: {asset}")
    with Image.open(asset) as image:
        if image.width != image.height:
            raise SystemExit(f"Asset is not square: {asset} {image.size}")

print("V133 validation passed")
for name in checks:
    print(f"  OK: {name}")
