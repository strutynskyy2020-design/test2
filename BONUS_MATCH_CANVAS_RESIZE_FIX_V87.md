# Bonus Match v87 — Canvas resize feedback-loop fix

## Confirmed root cause

The v86 diagnostic report captured a runaway effects canvas:

- Board CSS size: about `420.8 × 420.85` px.
- Grid size: about `407.2 × 407.25` px.
- Canvas CSS/client size at failure: `26,843,546 × 26,843,546` px.
- Canvas bitmap size at failure: `33,637,253 × 33,637,253` px.
- Device pixel ratio: `1.25`.
- Browser emitted 54 `ResizeObserver loop completed with undelivered notifications` errors.

The old code observed the canvas itself and set `canvas.width` and `canvas.height` from the canvas's current rendered rectangle. A canvas is a replaced element. Because its CSS width and height were `auto`, changing the bitmap attributes changed its intrinsic size, which changed the rendered rectangle and triggered ResizeObserver again.

At DPR 1.25 the loop was approximately:

`407 px → 509 px → 636 px → ... → 26,843,546 px`

The oversized bitmap exceeded practical browser texture/raster limits and appeared as the large white board.

## Fix

1. The canvas now has explicit CSS width and height derived from the board:
   - `width: calc(100% - 0.75rem)`
   - `height: calc(100% - 0.75rem)`
2. ResizeObserver watches the parent board, not the canvas.
3. Resizing is coalesced through one `requestAnimationFrame`.
4. CSS dimensions are rejected above 2048 px.
5. Bitmap dimensions are capped at 4096 px.
6. Diagnostics v87 records `effects_canvas_invalid_size_blocked` and `effects_canvas_size_runaway` if a regression ever occurs.
7. Service worker registration/cache and render markers are updated to v87.

## Post-deploy check

In DevTools Console:

```js
const c = document.querySelector('[data-bonus-effects-canvas="v87"]');
({
  css: [c?.clientWidth, c?.clientHeight],
  bitmap: [c?.width, c?.height],
  board: document.querySelector('.bonus-match-board')?.getBoundingClientRect(),
})
```

For a roughly 407 px board on DPR 1.25, expected canvas values are approximately:

- CSS: `407 × 407`
- bitmap: `509 × 509`

They must stay stable after many moves.
