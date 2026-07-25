# TM6 Bonus v81 — Chrome compositor stability fix

## Root cause

DevTools confirmed that the board and all piece DOM nodes still exist when the white rectangle appears. `elementsFromPoint()` returns the normal Bonus Match cell/button/layer hierarchy and no large `img`, `object`, `embed`, or `iframe`. This rules out the earlier broken-image and empty-React-state hypotheses.

The failure is consistent with Chrome compositor/raster instability caused by many permanently promoted layers: every piece used `will-change: transform`, nested Framer Motion transforms, CSS `filter: drop-shadow(...)`, and layout containment. After repeated cascades, the board layer could be rasterized as a white surface while the DOM remained intact.

## Changes

- Removed permanent `contain: layout style` from the pieces layer and every piece wrapper.
- `will-change: transform` is now enabled only while a piece is actively moving, falling, shaking, being removed, dragged, or celebrating.
- Removed animated CSS `filter: drop-shadow(...)` from all atlas sprites. The existing static shadow/rim-light layers remain.
- Removed `backdrop-filter` from special-piece badges.
- Replaced the full-cell opaque white impact layer with a transparent radial glint.
- Added `backface-visibility: hidden` to moving wrappers and sprite surfaces.
- Added `data-render-engine="v81"`, `data-bonus-pieces-layer`, and `data-bonus-piece` attributes for future diagnostics.
- Versioned the atlas files and PWA cache as v81.
- Fixed the preload and Service Worker atlas query strings to `?v=81`.

## Deployment

Deploy frontend only. After deployment, close the old tab and reopen it. One hard refresh may be required to activate the v81 Service Worker.
