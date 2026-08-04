from pathlib import Path
import hashlib

ROOT = Path(__file__).resolve().parent
FRAME = ROOT / "frontend/public/avatar-frames/diamond-female-floral-v134.webp"
COMPONENT = ROOT / "frontend/src/components/AvatarFrame.jsx"
SW = ROOT / "frontend/public/service-worker.js"
PWA = ROOT / "frontend/src/lib/pwa.js"

EXPECTED_SHA256 = "8f1d6f60fee8983e9ca436cfe960708b18306553cb19213bae59717b31bee827"

assert FRAME.exists(), "female diamond frame missing"
assert hashlib.sha256(FRAME.read_bytes()).hexdigest() == EXPECTED_SHA256, "wrong female frame bytes"
component = COMPONENT.read_text(encoding="utf-8")
assert "/avatar-frames/diamond-male.png" in component
assert "/avatar-frames/diamond-female-floral-v134.webp" in component
assert 'includes("male-diamond-")' in component
assert 'const VERSION = "vpdk-v134";' in SW.read_text(encoding="utf-8")
assert '/service-worker.js?v=134' in PWA.read_text(encoding="utf-8")
print("v134 diamond frame validation passed")
