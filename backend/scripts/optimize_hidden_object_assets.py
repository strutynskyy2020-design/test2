"""Encode Hidden Objects PNGs as WebP without resizing or changing hit geometry.

Run with a Python environment containing Pillow. Originals are backed up outside
the publish directory before replacement. Netlify rewrites keep old API payloads
working when the frontend is deployed before the backend.
"""
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
from io import BytesIO
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile
import json

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / "frontend/public"
ASSETS = PUBLIC / "hidden-objects"
MANIFEST = ROOT / "frontend/asset-optimization-manifest.json"
BACKUP = ROOT / "artifacts/hidden-object-assets-before-optimization.zip"
QUALITY = 92


def encode(source):
    relative = source.relative_to(ASSETS)
    original = source.read_bytes()
    with Image.open(BytesIO(original)) as image:
        output = BytesIO()
        image.save(output, format="WEBP", quality=QUALITY, method=6)
        encoded = output.getvalue()
        with Image.open(BytesIO(encoded)) as decoded:
            decoded.load()
            assert decoded.size == image.size, f"Changed dimensions: {source}"
            if "A" in image.getbands():
                assert decoded.convert("RGBA").getchannel("A").tobytes() == image.getchannel("A").tobytes(), source
        assert len(encoded) < len(original), f"Conversion increased size: {source}"
        assert len(encoded) < 2 * 1024 * 1024, f"Image exceeds cache entry budget: {source}"
        digest = sha256(encoded).hexdigest()
        target = ASSETS / "optimized" / relative.parent / f"{source.stem}.{digest[:12]}.webp"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(encoded)
        return {
            "source": "/" + source.relative_to(PUBLIC).as_posix(),
            "target": "/" + target.relative_to(PUBLIC).as_posix(),
            "original_bytes": len(original), "optimized_bytes": len(encoded),
            "original_sha256": sha256(original).hexdigest(), "sha256": digest,
            "width": image.width, "height": image.height,
        }


def main():
    sources = sorted(p for p in ASSETS.rglob("*.png") if "optimized" not in p.relative_to(ASSETS).parts)
    if not sources:
        print("No unoptimized Hidden Objects PNGs remain.")
        return
    if MANIFEST.exists() or BACKUP.exists():
        raise RuntimeError("A previous optimization exists; review its manifest before replacing assets.")
    assert all(p.resolve().is_relative_to(ASSETS.resolve()) and not p.is_symlink() for p in sources)
    before = sum(p.stat().st_size for p in PUBLIC.rglob("*") if p.is_file())
    BACKUP.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(BACKUP, "x", ZIP_DEFLATED) as archive:
        for source in sources:
            archive.write(source, source.relative_to(ROOT).as_posix())
        for name in ("backend/hidden_object_levels.json", "frontend/src/pages/Home.jsx", "frontend/public/service-worker.js", "frontend/public/_redirects", "frontend/public/_headers"):
            archive.write(ROOT / name, name)
    with ZipFile(BACKUP) as archive:
        assert archive.testzip() is None

    with ThreadPoolExecutor(max_workers=4) as pool:
        entries = list(pool.map(encode, sources))

    for name in ("backend/hidden_object_levels.json", "frontend/src/pages/Home.jsx"):
        path = ROOT / name
        text = path.read_text(encoding="utf-8")
        for item in entries:
            text = text.replace(item["source"], item["target"])
        path.write_text(text, encoding="utf-8", newline="\n")

    redirects_path = PUBLIC / "_redirects"
    redirects = redirects_path.read_text(encoding="utf-8")
    compatibility = "# Optimized artwork: preserve old backend and saved-client image URLs.\n"
    compatibility += "\n".join(f'{item["source"]}  {item["target"]}  200' for item in entries)
    redirects_path.write_text(compatibility + "\n\n" + redirects, encoding="utf-8", newline="\n")

    # Only the individually verified, backed-up inputs are removed from public.
    for source, item in zip(sources, entries):
        assert source.resolve().is_relative_to(ASSETS.resolve())
        assert sha256(source.read_bytes()).hexdigest() == item["original_sha256"]
        source.unlink()
    after = sum(p.stat().st_size for p in PUBLIC.rglob("*") if p.is_file())
    report = {
        "format": "webp", "quality": QUALITY, "resized": False,
        "public_bytes_before": before, "public_bytes_after": after,
        "source_bytes": sum(item["original_bytes"] for item in entries),
        "optimized_bytes": sum(item["optimized_bytes"] for item in entries),
        "assets": entries,
    }
    MANIFEST.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k != "assets"}, indent=2))
    print(f"Optimized {len(entries)} images; originals: {BACKUP}")


if __name__ == "__main__":
    main()
