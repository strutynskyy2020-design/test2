# TM6 Bonus v75 — board shapes and tactile UI polish

## What changed

### 1. Fixed 100 ms squash anticipation
Before an ordinary piece disappears, it now runs a dedicated 0.1-second anticipation phase:

`scale 1.00 → 0.86 → 1.15 → burst/exit`

The cascade player waits for that phase before applying the collapse frame, so the squash is visible rather than being swallowed by the exit transition.

### 2. Critical moves warning
When an active level has 3 moves or fewer, the moves card switches to red and continuously pulses with a restrained scale and glow. Reduced-motion mode keeps the warning color but disables the repeating movement.

### 3. Variable board silhouettes
The server now supports five authoritative 7×7 masks:

- `full` — complete 7×7;
- `rounded` — clipped corners;
- `diamond` — narrow 3/5/7 silhouette;
- `cross` — cross-shaped play area;
- `staircase` — diagonal stepped silhouette.

Levels 1–4 remain full for onboarding. Later levels rotate through the silhouettes in a safe progression. Shape holes are stored as `void` cells, cannot be swapped or targeted, stop gravity segments, are ignored by matches and reshuffles, and remain intact after cascades.

The admin level editor now includes a board-shape selector and prevents obstacles from being painted outside the active mask.

### 4. Stronger glossy 3D finish
Ordinary piece art now receives:

- a hard light rim on the upper-left edge;
- a dark lower-right bevel;
- a stronger specular highlight;
- a small contact shadow using the existing `piece-shadow.webp` asset;
- a restrained lower reflection/shading layer.

### 5. Persistent selected-cell pulse
A selected piece now keeps two animated rings around the cell until the second tap, swipe, cancellation, or move. The glow uses the piece’s own color and remains visible above the artwork.

## Compatibility

Old active sessions created before v75 keep their original full 7×7 board. The backend infers the silhouette from persisted `void` cells instead of forcing a new level-based shape onto an existing session.

## Files changed

- `backend/server.py`
- `frontend/src/pages/BonusMatch.jsx`
- `frontend/src/pages/Admin.jsx`
- `frontend/public/service-worker.js`

Both frontend and backend must be deployed. The PWA cache version is `tm6-v75`.

## Verification

- Python backend passed `py_compile`.
- JSX for `BonusMatch.jsx` and `Admin.jsx` passed the TypeScript parser.
- Every board silhouette was generated repeatedly without initial matches and with at least one legal move.
- Collapse tests confirmed that `void` cells remain fixed and are never filled.
- Legacy full-board inference was tested for pre-v75 sessions.
- A full production frontend build was not run because `node_modules` is not installed in this environment.
