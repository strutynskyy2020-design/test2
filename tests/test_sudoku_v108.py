import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LEVELS = json.loads((ROOT / "backend" / "sudoku_levels.json").read_text(encoding="utf-8"))


def count_solutions(puzzle, regions, limit=2):
    grid = list(puzzle)
    rows = [0] * 9
    cols = [0] * 9
    boxes = [0] * 9
    full = (1 << 9) - 1
    for index, value in enumerate(grid):
        if not value:
            continue
        row, col = divmod(index, 9)
        region = regions[index]
        bit = 1 << (value - 1)
        if rows[row] & bit or cols[col] & bit or boxes[region] & bit:
            return 0
        rows[row] |= bit
        cols[col] |= bit
        boxes[region] |= bit

    found = 0

    def walk():
        nonlocal found
        if found >= limit:
            return
        best_index = -1
        best_mask = 0
        best_count = 10
        for index, value in enumerate(grid):
            if value:
                continue
            row, col = divmod(index, 9)
            region = regions[index]
            mask = full & ~(rows[row] | cols[col] | boxes[region])
            option_count = mask.bit_count()
            if option_count == 0:
                return
            if option_count < best_count:
                best_index = index
                best_mask = mask
                best_count = option_count
                if option_count == 1:
                    break
        if best_index < 0:
            found += 1
            return
        row, col = divmod(best_index, 9)
        region = regions[best_index]
        mask = best_mask
        while mask and found < limit:
            bit = mask & -mask
            mask -= bit
            value = bit.bit_length()
            grid[best_index] = value
            rows[row] |= bit
            cols[col] |= bit
            boxes[region] |= bit
            walk()
            rows[row] ^= bit
            cols[col] ^= bit
            boxes[region] ^= bit
            grid[best_index] = 0

    walk()
    return found


def test_has_exactly_50_levels():
    assert [level["id"] for level in LEVELS] == list(range(1, 51))


def test_every_level_is_valid_and_unique():
    for level in LEVELS:
        assert len(level["puzzle"]) == 81
        assert len(level["solution"]) == 81
        assert len(level["regions"]) == 81
        assert all(0 <= value <= 9 for value in level["puzzle"])
        assert all(1 <= value <= 9 for value in level["solution"])
        assert count_solutions(level["puzzle"], level["regions"]) == 1, level["id"]
        assert all(not clue or clue == level["solution"][index] for index, clue in enumerate(level["puzzle"]))



def test_irregular_regions_are_connected():
    for level in LEVELS:
        if level["type"] != "irregular":
            continue
        regions = level["regions"]
        for region_id in range(9):
            cells = [index for index, value in enumerate(regions) if value == region_id]
            assert len(cells) == 9
            seen = {cells[0]}
            stack = [cells[0]]
            while stack:
                index = stack.pop()
                row, col = divmod(index, 9)
                for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    rr, cc = row + dr, col + dc
                    if 0 <= rr < 9 and 0 <= cc < 9:
                        neighbor = rr * 9 + cc
                        if regions[neighbor] == region_id and neighbor not in seen:
                            seen.add(neighbor)
                            stack.append(neighbor)
            assert len(seen) == 9, (level["id"], region_id)

def test_frontend_and_backend_catalogs_match():
    frontend = json.loads((ROOT / "frontend" / "src" / "data" / "sudokuLevels.json").read_text(encoding="utf-8"))
    assert frontend == LEVELS


def test_route_home_card_and_reward_policy_are_wired():
    app = (ROOT / "frontend" / "src" / "App.js").read_text(encoding="utf-8")
    home = (ROOT / "frontend" / "src" / "pages" / "Home.jsx").read_text(encoding="utf-8")
    server = (ROOT / "backend" / "server.py").read_text(encoding="utf-8")
    assert 'path="/games/sudoku"' in app
    assert 'nav("/games/sudoku")' in home
    assert 'SUDOKU_FIRST_CLEAR_POINTS = 5' in server
    assert '@api.post("/games/sudoku/complete")' in server
