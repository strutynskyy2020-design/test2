# TM6 Bonus v79 — broken image overlay hotfix

## Symptom

After several moves a large white rectangle with the browser's broken-image icon could cover the Bonus Match board and extend beyond the application column.

## Root cause addressed

The v78 board still mounted an actual `<img>` element for every piece shadow. If that image request failed or Netlify's SPA rewrite returned `index.html` for the image URL, the browser could render a broken replaced element. The v78 service worker also cached every successful same-origin response for image requests without checking `Content-Type`, so an HTML fallback could be cached under a `.webp` URL.

## Changes

- Removed every `<img>` element from the game board.
- Replaced the shadow image with a lightweight CSS radial gradient.
- Added `overflow-hidden` and `isolation` to the board root as a final containment guard.
- Renamed atlases to versioned files:
  - `pieces-v79.webp`
  - `obstacles-v79.webp`
- Added query versioning to atlas URLs.
- Changed artwork preload to report decode success.
- Added Lucide icon fallback when an atlas cannot be decoded.
- Updated the service worker to:
  - use cache version `tm6-v79`;
  - validate image `Content-Type` before caching;
  - delete invalid cached image responses;
  - return a transparent image when Netlify returns HTML for an image URL;
  - avoid one missing static asset aborting the whole service-worker installation.
- Removed the unused piece-shadow WebP and old unversioned atlas files.

## Deployment

Deploy the frontend. The backend is unchanged.

After the first reload, service worker v79 activates and removes the v78 caches. A second normal reload may be required on a tab that remained open during deployment.
