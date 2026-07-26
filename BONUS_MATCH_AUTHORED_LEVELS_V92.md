# Bonus Match V92 — 50 authored levels

The first 50 Bonus Match levels are no longer built from random obstacle placement.

## Design structure

- Ten five-level chapters, one for each obstacle type.
- Every level has a named visual idea: diagonals, gates, rings, columns, crowns, forts, quarantine zones, and reactor guards.
- Obstacles use explicit row/column layouts stored in `backend/bonus_match_levels.json` and mirrored in `frontend/src/data/bonusMatchLevels.json` for offline/mock mode.
- Blocking obstacles never reduce a board below 24 playable cells.
- Move counts were raised and calibrated per layout. Harder/boss stages receive extra moves instead of arbitrary target spikes.
- Score goals grow smoothly and include obstacle density rather than multiplying sharply every fifth level.
- Coin goals increase gradually from 7 to 22.
- The board generator retries until the initial board has no accidental match and at least one valid move.

## Chapters

1. Match tutorial and ice
2. Chains
3. Crates
4. Stone
5. Crystals
6. Webs
7. Shields
8. Slime
9. Metal
10. Cores

MongoDB level overrides remain supported. An explicitly customized admin level still takes priority over the authored default.
