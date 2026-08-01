import json
from pathlib import Path

ROOT = Path(__file__).parent
levels = json.loads((ROOT / "backend" / "bonus_match_levels.json").read_text(encoding="utf-8"))
frontend_levels = json.loads((ROOT / "frontend" / "src" / "data" / "bonusMatchLevels.json").read_text(encoding="utf-8"))
shapes = {
    "full": ["1111111"] * 7,
    "rounded": ["0111110", "1111111", "1111111", "1111111", "1111111", "1111111", "0111110"],
    "diamond": ["0011100", "0111110", "1111111", "1111111", "1111111", "0111110", "0011100"],
    "cross": ["0011100", "0011100", "1111111", "1111111", "1111111", "0011100", "0011100"],
    "staircase": ["1111100", "1111110", "1111111", "1111111", "1111111", "0111111", "0011111"],
}
overlays = {"chain", "web"}

assert levels == frontend_levels, "backend and frontend level catalogs differ"
assert [item["level"] for item in levels] == list(range(1, 151))

for item in levels:
    mask = shapes[item["board_shape"]]
    layout = item["obstacle_layout"]
    coords = {(cell["row"], cell["col"]) for cell in layout}
    assert len(coords) == len(layout), f"duplicate cell in level {item['level']}"
    assert all(mask[row][col] == "1" for row, col in coords), f"void obstacle in level {item['level']}"
    active = sum(row.count("1") for row in mask)
    blocking = sum(cell["obstacle"] not in overlays for cell in layout)
    overlay_count = sum(cell["obstacle"] in overlays for cell in layout)
    assert active - blocking >= 24, f"too little playable space in level {item['level']}"
    assert item["target_coins"] <= item["moves"] - 3, f"coin target too high in level {item['level']}"
    assert item["star_thresholds"][0] == item["target_score"]
    assert item["star_thresholds"] == sorted(item["star_thresholds"])

    if item["level"] <= 50:
        assert item["moves"] >= 26, f"move budget too low in level {item['level']}"
    else:
        assert item["target_score"] >= 12_800, f"new level is not harder: {item['level']}"
        assert item["moves"] <= 39, f"too many moves in hard level {item['level']}"
        assert len(layout) >= 10, f"too few obstacles in hard level {item['level']}"
        assert len(item["obstacles"]) >= 3, f"hard level must mix obstacle types: {item['level']}"
        assert active - blocking - overlay_count >= 16, f"too few swappable cells in level {item['level']}"

assert levels[50]["target_score"] > levels[49]["target_score"]
assert levels[-1]["target_score"] >= 55_000
assert sum(1 for item in levels[50:] if item["is_boss"]) == 10
print("Validated 150 authored Bonus Match levels")
