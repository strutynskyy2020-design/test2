from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent
src = ROOT / "frontend" / "src"
public = ROOT / "frontend" / "public"

asset = public / "card-frames" / "diamond-employee-card-v137.png"
assert asset.exists(), "diamond employee frame asset is missing"
with Image.open(asset) as image:
    assert image.size == (1536, 1024), image.size
    assert image.mode == "RGBA", image.mode
    alpha = image.getchannel("A")
    lo, hi = alpha.getextrema()
    assert lo == 0 and hi == 255, (lo, hi)

css = (src / "index.css").read_text()
assert '.diamond-card-auto:has(.avatar-frame--diamond)::before' in css
assert '/card-frames/diamond-employee-card-v137.png' in css
assert '@keyframes diamond-card-frame-breathe' in css
assert 'pointer-events: none' in css

surface_files = {
    "pages/Leaderboard.jsx": 1,
    "pages/CreditLeaderboard.jsx": 2,
    "pages/DebitLeaderboard.jsx": 2,
    "pages/DepositLeaderboard.jsx": 1,
    "pages/DepositIssuanceLeaderboard.jsx": 1,
    "pages/ActivationPumbGoals.jsx": 1,
    "pages/ActivationCardsGoals.jsx": 1,
    "pages/DebitIssuances.jsx": 1,
    "components/FeedItem.jsx": 1,
    "pages/BonusMatch.jsx": 1,
    "pages/Home.jsx": 1,
    "pages/Admin.jsx": 3,
}
for rel, minimum in surface_files.items():
    text = (src / rel).read_text()
    count = text.count('diamond-card-auto')
    assert count >= minimum, f"{rel}: expected at least {minimum}, got {count}"
    assert '<AvatarFrame' in text, f"{rel}: no AvatarFrame found"

sw = (public / "service-worker.js").read_text()
pwa = (src / "lib" / "pwa.js").read_text()
assert 'const VERSION = "vpdk-v137";' in sw
assert '"/card-frames/diamond-employee-card-v137.png"' in sw
assert '/service-worker.js?v=137' in pwa

# Guard the previous male/female diamond fix.
avatar_frame = (src / "components" / "AvatarFrame.jsx").read_text()
assert 'filename.startsWith("male-diamond-")' in avatar_frame
assert 'diamond-female-floral-v135.webp' in avatar_frame

print("v137 rectangular diamond employee frames validation passed")
