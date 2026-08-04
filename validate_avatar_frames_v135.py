from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent

avatar_frame = (ROOT / 'frontend/src/components/AvatarFrame.jsx').read_text()
assert 'filename.startsWith("male-diamond-")' in avatar_frame
assert 'source.includes("male-diamond-")' not in avatar_frame
assert '/avatar-frames/diamond-female-floral-v135.webp' in avatar_frame
assert '/avatar-frames/diamond-male.png' in avatar_frame


def variant(url: str) -> str:
    source = str(url or '').strip().lower().split('?')[0].split('#')[0]
    filename = source.split('/')[-1] if source else ''
    return 'male' if filename.startswith('male-diamond-') else 'female'

assert variant('/avatars/male-diamond-1.webp') == 'male'
assert variant('/avatars/female-diamond-1.webp') == 'female'
assert variant('/avatars/female-diamond-2.webp?v=135') == 'female'
assert variant('https://cdn.example.com/avatars/male-diamond-1.webp#preview') == 'male'

report_pages = [
    'frontend/src/pages/CreditLeaderboard.jsx',
    'frontend/src/pages/DebitLeaderboard.jsx',
    'frontend/src/pages/DebitIssuances.jsx',
    'frontend/src/pages/DepositLeaderboard.jsx',
    'frontend/src/pages/DepositIssuanceLeaderboard.jsx',
    'frontend/src/pages/ActivationPumbGoals.jsx',
    'frontend/src/pages/ActivationCardsGoals.jsx',
]
for relative in report_pages:
    text = (ROOT / relative).read_text()
    assert 'import AvatarFrame from "@/components/AvatarFrame";' in text, relative
    assert '<AvatarFrame' in text, relative
    assert 'rarity=' in text, relative
    assert 'resolveAvatarUrl' not in text, relative

admin = (ROOT / 'frontend/src/pages/Admin.jsx').read_text()
assert admin.count('<AvatarFrame') >= 4
assert 'operator.avatar_rarity' in admin
assert 'u.avatar_rarity' in admin

backend = (ROOT / 'backend/server.py').read_text()
assert '"avatar_url": 1, "avatar_rarity": 1, "position": 1' in backend
assert '"avatar_url": 1, "avatar_rarity": 1,\n         "position": 1' in backend

for relative, expected_format in [
    ('frontend/public/avatar-frames/diamond-male.png', 'PNG'),
    ('frontend/public/avatar-frames/diamond-female-floral-v135.webp', 'WEBP'),
]:
    path = ROOT / relative
    assert path.exists(), relative
    with Image.open(path) as image:
        assert image.format == expected_format, (relative, image.format)
        assert image.size == (1024, 1024), (relative, image.size)
        assert 'A' in image.mode, (relative, image.mode)

service_worker = (ROOT / 'frontend/public/service-worker.js').read_text()
pwa = (ROOT / 'frontend/src/lib/pwa.js').read_text()
assert 'const VERSION = "vpdk-v135";' in service_worker
assert '/service-worker.js?v=135' in pwa

print('v135 avatar-frame validation passed')
