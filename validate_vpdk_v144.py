from pathlib import Path

root = Path(__file__).resolve().parent
css = (root / 'frontend/src/index.css').read_text(encoding='utf-8')
sw = (root / 'frontend/public/service-worker.js').read_text(encoding='utf-8')
home = (root / 'frontend/src/pages/Home.jsx').read_text(encoding='utf-8')
feed = (root / 'frontend/src/components/FeedItem.jsx').read_text(encoding='utf-8')

assert 'diamond-employee-card-v137.png' not in css
assert 'border-image-source' not in css[css.index('/* v144: diamond employees'):css.index('/* ==========================================================================\n   v138', css.index('/* v144: diamond employees'))]
assert '@keyframes diamond-card-frame-breathe' not in css
assert '.diamond-card-auto:has(.avatar-frame--diamond)' in css
assert 'linear-gradient(145deg, rgba(9, 25, 43, .98), rgba(20, 19, 38, .98))' in css
assert 'diamond-surface-orbit' in css
assert 'diamond-surface-shine' in css
assert 'vpdk-v144' in sw
assert '/card-frames/diamond-employee-card-v137.png' not in sw
assert not (root / 'frontend/public/card-frames/diamond-employee-card-v137.png').exists()
assert not (root / 'frontend/src/assets/card-frames/diamond-employee-card-v137.png').exists()
assert 'diamond-profile-card' not in home
assert 'diamond-feed-shell' not in feed

jsx_files = list((root / 'frontend/src').rglob('*.jsx'))
usage_count = sum(path.read_text(encoding='utf-8').count('diamond-card-auto') for path in jsx_files)
assert usage_count >= 15, usage_count

# Simple structural checks for the edited CSS.
assert css.count('{') == css.count('}'), (css.count('{'), css.count('}'))

print(f'v144 validation passed: {usage_count} diamond-aware surfaces, rectangular frame removed.')
