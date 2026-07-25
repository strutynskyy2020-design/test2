# TM6 Bonus v80 — Production overlay fix

## Root cause

The white square was not produced by the match-3 board renderer. The production HTML unconditionally loaded:

`https://assets.emergent.sh/scripts/emergent-main.js`

That visual-edit runtime can inject replaced media nodes over frequently changing UI. The Bonus Match board changes its DOM several times during a cascade, so the injected preview image could lose its source and remain as a large broken-image placeholder clipped by the board.

The accidental `frontend/public/public/` copy also contained another production HTML file with the same visual-edit script.

## Changes

- Removed the visual-edit runtime from production `public/index.html`.
- Removed the accidental nested `frontend/public/public/` directory.
- Added the `bonus-match-board` production guard class.
- Added a board-scoped `MutationObserver` that removes unexpected `img`, `picture`, `object`, `embed`, and `iframe` nodes.
- Added CSS safety rules that prevent replaced media from covering the board.
- Canvas remains explicitly transparent.
- Renamed the atlases to `pieces-v80.webp` and `obstacles-v80.webp`.
- Updated preload URLs, asset module and Service Worker precache.
- Bumped Service Worker registration and cache to v80.
- Added Netlify `_headers` rules so `index.html` and `service-worker.js` are never served from a stale HTTP cache while versioned atlases and static bundles remain immutable.

## Deployment

Deploy the complete `frontend` directory. Backend changes are not required.

After deployment, reload the page once. The v80 Service Worker activates immediately, removes old caches and reloads the open app on `controllerchange`.

## Validation

- JSX and JavaScript parsed through TypeScript transpilation.
- Service Worker passed `node --check`.
- Both WebP atlases passed Pillow verification.
- No production `script src` references the visual-edit runtime.
- No `img` element is used by the Bonus Match board renderer.
