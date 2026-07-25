# TM6 Bonus Match v76: responsive timeline, stage 1

## Goal

Remove visible network and timer pauses from the normal move pipeline without moving authoritative match logic to the browser.

## Changes

### Immediate optimistic swap

- The two pieces swap locally on the same input frame.
- The `/games/bonus-match/move` request starts in parallel.
- The first visual swap is held only until a minimum local deadline of 165 ms.
- Network latency no longer adds another fixed 210 ms after the response.
- `moves_left` updates optimistically and is restored from the server for invalid or failed moves.

### Frontend-owned timing

The backend now sends semantic animation events and authoritative boards only. `duration_ms` was removed from Bonus Match frames.

Frontend timings:

- optimistic swap: 165 ms minimum;
- cascade 1: 320 ms;
- cascade 2: 230 ms;
- cascade 3: 165 ms;
- later cascades: previous duration × 0.82, minimum 105 ms;
- anticipation to fire: 58 ms;
- anticipation to collapse: 100 ms;
- obstacle turn: 240 ms;
- reshuffle: 330 ms.

### Overlapped phases

The move director now overlaps:

1. squash anticipation;
2. special-piece charge;
3. match burst and obstacle impacts;
4. board collapse and physical fall;
5. score animation and particles.

Only an absolute per-cascade deadline gates the next cascade. Effects are queued independently and can finish while the next logical cascade starts.

### Invalid moves

Invalid swaps use a compact local sequence:

- 120 ms shake;
- immediate board revert;
- 135 ms return settle.

### Compatibility

- Match calculation remains authoritative on the backend.
- Stable piece IDs and server cascade boards remain unchanged.
- Legacy `animation.steps` responses still work through the frontend fallback.
- Boosters continue to use the same server animation event pipeline.

## Deployment

Deploy both `frontend` and `backend` together. The service-worker cache version is `tm6-v76`.
