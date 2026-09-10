"""Deployment checks for compressed artwork and older backend URL compatibility."""
from hashlib import sha256
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "frontend/public"


def test_all_optimized_assets_are_real_content_addressed_files_within_budget():
    manifest = json.loads((ROOT / "frontend/asset-optimization-manifest.json").read_text())
    assert manifest["resized"] is False
    assert manifest["optimized_bytes"] < manifest["source_bytes"] * 0.25
    for asset in manifest["assets"]:
        target = PUBLIC / asset["target"].lstrip("/")
        data = target.read_bytes()
        assert data[:4] == b"RIFF" and data[8:12] == b"WEBP"
        digest = sha256(data).hexdigest()
        assert digest == asset["sha256"]
        assert f".{digest[:12]}.webp" in target.name
        assert len(data) == asset["optimized_bytes"] < 1024 * 1024
        assert not (PUBLIC / asset["source"].lstrip("/")).exists()
    assert sum(path.stat().st_size for path in PUBLIC.rglob("*") if path.is_file()) < 70_000_000


def test_old_backend_urls_rewrite_to_valid_images_before_the_spa_fallback():
    manifest = json.loads((ROOT / "frontend/asset-optimization-manifest.json").read_text())
    rules = [line.split() for line in (PUBLIC / "_redirects").read_text().splitlines() if line.strip() and not line.startswith("#")]
    fallback = next(index for index, rule in enumerate(rules) if rule[0] == "/*")
    rewrites = {rule[0]: (index, rule[1], rule[2]) for index, rule in enumerate(rules)}
    for asset in manifest["assets"]:
        index, target, status = rewrites[asset["source"]]
        assert index < fallback
        assert target == asset["target"]
        assert status == "200"
        assert (PUBLIC / target.lstrip("/")).is_file()
