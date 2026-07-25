# TM6 Bonus v78: Stage 3 loading and asset pipeline

## Goal

Reduce the amount of raster data, network requests, decoding work and JavaScript downloaded before the player opens Bonus Match.

## 1. Compact texture atlases

The previous build loaded 17 separate Bonus Match WebP files:

- 6 piece images at 512×512;
- 10 obstacle images at 512×512;
- 1 shadow image.

They have been replaced with three files:

- `/bonus-match/atlas/pieces.webp`, six 128×128 sprites in a 3×2 atlas;
- `/bonus-match/atlas/obstacles.webp`, ten 128×128 sprites in a 5×2 atlas;
- `/bonus-match/atlas/piece-shadow.webp`, 128×64.

Each sprite has a transparent two-pixel gutter to prevent texture bleeding during scaling.

### Size comparison

- Previous artwork: 875,982 bytes.
- v78 artwork: 106,934 bytes.
- Reduction: approximately 87.8%.
- Image requests: 17 → 3.

The board and the Bonus Match admin editor both use the same atlases.

## 2. Decode before the board appears

`src/lib/bonusMatchAssets.js` owns the atlas metadata and one shared preload promise.

The loader:

- downloads each atlas once;
- uses `HTMLImageElement.decode()` when supported;
- keeps the decoded images warm in memory;
- resolves safely on older browsers where `decode()` may reject after `onload`.

Bonus Match displays its loading state until the atlases are decoded, so the first board frame no longer appears with blank or progressively decoded tiles.

## 3. Warm-up without blocking the app shell

The Home page schedules Bonus Match warm-up through `requestIdleCallback` after the main UI becomes idle. Hover, focus or touch on the Bonus Match card starts it immediately.

Warm-up fetches:

- the route chunk;
- the three atlases;
- the image decode promise.

The HTML also uses low-priority `prefetch` hints. These do not compete with the critical JavaScript and CSS the way global high-priority preload would.

## 4. Route-level code splitting

The following pages are loaded with `React.lazy` only when opened:

- Bonus Match;
- Admin;
- AI Trainer;
- Tasks and Teams;
- Store and Fun;
- Goals and all credit/debit detail pages;
- Feed, History and Leaderboard;
- Quests.

Login, Register and Home remain in the initial shell.

Each lazy page has an in-layout Suspense fallback, so navigation does not replace the entire authenticated application shell with a full-screen flash.

The reusable feed row was moved from `pages/Feed.jsx` to `components/FeedItem.jsx`. This prevents Home from statically importing the complete Feed page and defeating its lazy route split.

## 5. Hidden overlays

The runtime audit confirms that heavy overlays remain conditionally mounted:

- Bonus Match boss prompt;
- result panel;
- Admin editors and bottom sheets;
- notification panel.

Closed overlays do not retain image grids, editor forms or animated trees in the DOM.

## 6. App-shell work

The optional Emergent helper script now uses `defer`, removing it from the HTML parser’s critical path.

The PWA cache version is now:

```text
tm6-v78
```

Only the three atlas files are precached for Bonus Match.

## Deployment

Only the frontend changed. The v76/v77 backend remains compatible.

## Validation

- JSX/JavaScript parsed with TypeScript in no-resolve mode;
- service worker passed `node --check`;
- backend passed Python bytecode compilation;
- atlas dimensions and file inventory validated with Pillow;
- all local `/bonus-match/` references checked against real files;
- confirmed 16 lazy route imports;
- confirmed no legacy individual piece or obstacle URLs remain;
- ZIP integrity checked after packaging.

A complete CRA production build was not run because this project copy does not include `node_modules` or a dependency lockfile.
