from pathlib import Path

root = Path(__file__).resolve().parent
server = (root / "backend" / "server.py").read_text()
hook = (root / "frontend" / "src" / "hooks" / "useOperatorReportTrend.js").read_text()
sw = (root / "frontend" / "public" / "service-worker.js").read_text()

checks = {
    "daily collection": "db.operator_report_daily.update_one" in server,
    "one doc unique index": 'create_index([("user_id", 1), ("date_key", 1)], unique=True)' in server,
    "kyiv daily key": "date_key = kyiv_today_key()" in server,
    "nested reports path": 'report_path = f"reports.{report_key}.{period_key}.{segment_key}"' in server,
    "daily trend reads": "db.operator_report_daily.find" in server,
    "session dedupe": "window.sessionStorage.getItem(key)" in hook,
    "service worker v150": 'const VERSION = "vpdk-v150"' in sw,
}

failed = [name for name, ok in checks.items() if not ok]
for name, ok in checks.items():
    print(f"{'OK' if ok else 'FAIL'}: {name}")
if failed:
    raise SystemExit("Validation failed: " + ", ".join(failed))
print("V150 daily trend validation passed")
