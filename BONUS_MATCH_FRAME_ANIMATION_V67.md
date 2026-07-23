# Bonus Match v67 — server animation frames and stable piece motion

## Problem fixed

The board previously rendered each piece inside a coordinate-keyed wrapper. When the server returned the final cascade result, React unmounted pieces from one cell and mounted them in another, so black empty slots flashed before the replacement appeared.

## Backend

`backend/server.py` now returns an authoritative `animation.frames` sequence:

1. `swap`
2. `match`
3. `collapse`
4. repeated `match` / `collapse` for every cascade
5. optional `reshuffle`

Every cell keeps a stable `id`. Match frames include `cleared_ids`, effects, score and combo metadata. Collapse frames include the authoritative board and `spawned_ids`.

## Frontend

`frontend/src/pages/BonusMatch.jsx` now:

- renders all pieces as direct children of one shared CSS grid;
- keys each piece by `cell.id`, not by row/column;
- uses Framer Motion `layout="position"` and `layoutId` so the same DOM piece visibly moves between cells;
- keeps removed pieces in `AnimatePresence` while surviving pieces fall into their new positions;
- mounts new server-created pieces with a drop animation from above;
- never renders `board_after_clear` as a standalone empty board frame;
- replays server frames in order and keeps the backend authoritative;
- shakes invalid swaps and then animates the same piece ids back to their original cells.

No new dependencies were added.
