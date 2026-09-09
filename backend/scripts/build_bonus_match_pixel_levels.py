"""Reproducible Pixel room campaign. Run from any directory to rebuild both catalogs."""
import json
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CAMPAIGN = "pixel-room-2026-09"
CHAPTERS = [
    ("Світло у вікні", "crate"), ("Забуті листи", "chain"),
    ("Дощ за склом", "ice"), ("Тиха бібліотека", "web"),
    ("Таємниця каміна", "stone"), ("Кришталеві спогади", "crystal"),
    ("Ключ від горища", "shield"), ("Зелений сад", "slime"),
    ("Майстерня годинникаря", "metal"), ("Серце дому", "core"),
]
PATTERNS = ["Стежка", "Дві полиці", "Діагональ", "Куточки", "Сходинки",
            "Листівка", "Віконце", "Сузір’я", "Перехрестя", "Секрет",
            "Намисто", "Дзеркало", "Мозаїка", "Вечір", "Нова знахідка"]
HITS = {"crate": 1, "chain": 1, "ice": 2, "web": 1, "stone": 2,
        "crystal": 1, "shield": 2, "slime": 1, "metal": 1, "core": 2}


def build_levels():
    levels = []
    for level in range(1, 151):
        chapter, variant = divmod(level - 1, 15)
        title, obstacle = CHAPTERS[chapter]
        rng = random.Random(f"{CAMPAIGN}:{level}")
        # Keep edge lanes and ample uninterrupted runs for special creation.
        cells = [(r, c) for r in range(1, 7) for c in range(1, 7)]
        rng.shuffle(cells)
        cells.sort(key=lambda rc: (rc[0] * (variant % 3 + 1) + rc[1]) % (variant % 4 + 2))
        count = 8 + variant % 4 + chapter // 3
        coords = cells[:count]
        if level == 1:
            coords = [(1, 7), (2, 1), (3, 3), (4, 6), (5, 4), (6, 7), (7, 1), (0, 5)]
        layout = [{"row": r, "col": c, "obstacle": obstacle, "hits": HITS[obstacle]} for r, c in coords]
        if chapter and variant >= 5:
            secondary = CHAPTERS[chapter - 1][1]
            layout += [{"row": r, "col": c, "obstacle": secondary, "hits": HITS[secondary]}
                       for r, c in cells[count:count + 2 + variant // 5]]
        target_score = 2000 + chapter * 500 + variant * 120
        levels.append({
            "level": level, "campaign": CAMPAIGN, "title": f"{title} · {PATTERNS[variant]}",
            "chapter": chapter + 1, "chapter_title": title, "board_shape": "full",
            "moves": 18 if level == 1 else 23 + chapter + variant // 5,
            "objective": {"kind": "clear_obstacles", "obstacle": obstacle, "count": len(coords)},
            "target_score": target_score, "target_coins": 0,
            "star_thresholds": [target_score, int(target_score * 1.5), target_score * 2],
            "is_milestone": variant in (4, 9, 14), "is_boss": variant == 14,
            "reward_multiplier": 1, "obstacles": list(dict.fromkeys(c["obstacle"] for c in layout)),
            "new_obstacle": obstacle if variant == 0 else None,
            "obstacle_count": len(layout), "obstacle_layout": layout, "active": True,
            "design_note": "Прибери цільові перешкоди. Очки визначають зірки; монети не є умовою перемоги.",
        })
    return levels


if __name__ == "__main__":
    data = json.dumps(build_levels(), ensure_ascii=False, indent=2) + "\n"
    for path in (ROOT / "backend/bonus_match_levels.json", ROOT / "frontend/src/data/bonusMatchLevels.json"):
        path.write_text(data, encoding="utf-8")
    print("Created 150 new Pixel room levels in both runtimes.")
