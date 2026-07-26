import json
from pathlib import Path

ROOT = Path(__file__).parent
levels = json.loads((ROOT / "backend" / "bonus_match_levels.json").read_text(encoding="utf-8"))
shapes = {
    "full": ["1111111"] * 7,
    "rounded": ["0111110", "1111111", "1111111", "1111111", "1111111", "1111111", "0111110"],
    "diamond": ["0011100", "0111110", "1111111", "1111111", "1111111", "0111110", "0011100"],
    "cross": ["0011100", "0011100", "1111111", "1111111", "1111111", "0011100", "0011100"],
    "staircase": ["1111100", "1111110", "1111111", "1111111", "1111111", "0111111", "0011111"],
}
overlays = {"chain", "web"}
assert [item["level"] for item in levels] == list(range(1, 51))
for item in levels:
    mask = shapes[item["board_shape"]]
    layout = item["obstacle_layout"]
    coords = {(cell["row"], cell["col"]) for cell in layout}
    assert len(coords) == len(layout), f"duplicate cell in level {item['level']}"
    assert all(mask[row][col] == "1" for row, col in coords), f"void obstacle in level {item['level']}"
    active = sum(row.count("1") for row in mask)
    blocking = sum(cell["obstacle"] not in overlays for cell in layout)
    assert active - blocking >= 24, f"too little playable space in level {item['level']}"
    assert item["moves"] >= 26, f"move budget too low in level {item['level']}"
    assert item["target_coins"] <= item["moves"], f"coin target too high in level {item['level']}"
print("Validated 50 authored Bonus Match levels")
