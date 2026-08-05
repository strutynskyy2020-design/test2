from pathlib import Path

root = Path(__file__).resolve().parent
css = (root / 'frontend/src/index.css').read_text()
asset = root / 'frontend/src/assets/card-frames/diamond-employee-card-v137.png'
sw = (root / 'frontend/public/service-worker.js').read_text()

assert asset.is_file() and asset.stat().st_size > 0
assert 'url("./assets/card-frames/diamond-employee-card-v137.png")' in css
assert 'url("/card-frames/diamond-employee-card-v137.png")' not in css
assert 'const VERSION = "vpdk-v141";' in sw

for stylesheet in (root / 'frontend/src').rglob('*.css'):
    text = stylesheet.read_text(errors='ignore')
    assert 'url("/' not in text, f'CRA-incompatible absolute CSS URL in {stylesheet}'
    assert "url('/" not in text, f'CRA-incompatible absolute CSS URL in {stylesheet}'

print('v141 validation passed')
