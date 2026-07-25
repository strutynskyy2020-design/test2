# TM6 Bonus v84 — Service Worker fetch fix

## Root cause

The deployed frontend still registered `/service-worker.js?v=80` in `frontend/src/lib/pwa.js`, while newer releases changed only the worker body. Chrome therefore continued showing the stale v80 registration URL.

The generic fetch handler also returned a rejected promise when `fetch(request)` failed. The navigation handler could return `undefined` when both the network and cached app shell were unavailable. Chrome reported:

- `The FetchEvent ... resulted in a network error response: the promise was rejected.`
- `Uncaught (in promise) TypeError: Failed to fetch at service-worker.js ...:142`

## Changes

- Service Worker registration URL bumped to `/service-worker.js?v=84`.
- Cache namespace bumped to `tm6-v84`.
- Navigation requests always return a valid `Response`.
- Generic GET requests now catch network failures and return a 503 response instead of rejecting the FetchEvent.
- Runtime cache writes are awaited.
- Board render marker bumped to `v84`.

Only the frontend must be deployed.
