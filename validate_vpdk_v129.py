from pathlib import Path

root = Path(__file__).resolve().parent
gas = (root / "integrations/google-sheets/Code.gs").read_text(encoding="utf-8")
standalone = (root / "VPDK-Code-v129.gs").read_text(encoding="utf-8")
cache = (root / "frontend/src/lib/googleReportsCache.js").read_text(encoding="utf-8")
service_worker = (root / "frontend/public/service-worker.js").read_text(encoding="utf-8")

for source in (gas, standalone):
    assert 'REPORT_CACHE_API_VERSION = "v129-pumb-period-boundary-fix"' in source
    assert 'key.includes("yestarday")' in source
    assert 'function isActivationTransformBlockTitle' in source
    assert 'row.some((cell) => isActivationTransformBlockTitle(cell, kind))' in source

assert 'const CACHE_PREFIX = "vpdk-google-reports-v129:";' in cache
assert 'const DB_NAME = "vpdk-google-reports-v129";' in cache
assert '"vpdk-google-reports-v128:"' in cache
assert 'const VERSION = "vpdk-v129";' in service_worker
print("VPDK Bonus v129 static validation: PASS")
