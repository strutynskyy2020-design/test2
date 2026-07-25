# TM6 Bonus v82 — full-board layer fix

## Confirmed cause
DevTools identified the element that becomes the white rectangle as the full-board piece wrapper:

```html
<div class="absolute inset-1.5 overflow-visible" data-bonus-pieces-layer="true">
```

Its bounding box matched the entire board (about 407×407 px). The individual piece DOM nodes remained present, so this was not an empty `visualPieces` state. The failure was tied to the existence/painting of one full-size overlay layer.

## Fix
- Removed the full-board `BoardPiecesLayer` DOM wrapper entirely.
- `BoardPiecesLayer` now returns piece nodes directly through `AnimatePresence`.
- Every piece is positioned relative to `.bonus-match-board` itself.
- Cell size accounts for board padding and the six 4 px grid gaps.
- Stable piece IDs and transform-based movement remain intact.
- No single transparent DOM element now covers the whole board.
- Added render marker `data-render-engine="v82"`.
- Bumped artwork URLs and Service Worker cache to v82.

## Deployment
Frontend only. Close the old tab after deployment and perform one hard refresh so Service Worker v82 controls the page.
