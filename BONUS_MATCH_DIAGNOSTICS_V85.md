# TM6 Bonus v85 — Bonus Match Diagnostics

## Purpose

This build adds a persistent diagnostics recorder for the intermittent white-board failure. It does not guess the cause. It records the state immediately before, during, and after moves so the exported JSON can identify the exact failing layer.

## New files

- `frontend/src/lib/bonusMatchDiagnostics.js`
- `frontend/src/components/BonusMatchErrorBoundary.jsx`

## What is recorded

- move start, server response, move completion, and move failure;
- every animation frame and cascade phase;
- logical/display board snapshot and stable cell IDs;
- expected visual piece count and actual DOM piece count;
- board computed styles and element stack at the board centre;
- large descendants covering most of the board;
- `::before` and `::after` computed content/backgrounds;
- Canvas dimensions;
- recent network resources;
- Service Worker controller URL;
- browser online state, visibility, viewport, DPR, and available heap metrics;
- uncaught JavaScript errors and rejected promises;
- React render failures through an Error Boundary;
- artwork preload failures;
- automatic detection of nearly-white full-board layers.

## How to collect a report

1. Deploy the v85 frontend.
2. Open Bonus Match and play until the white board appears.
3. Press the bug button in the lower-right corner.
4. Press **ЗАВАНТАЖИТИ ЛОГ**.
5. Upload the generated `bonus-match-diagnostics-....json` file to the chat.

The journal survives ordinary React renders and is stored in `sessionStorage` for the current browser tab. Do not close the tab before downloading the report after the failure.

## Automatic alert

When the watchdog detects a nearly-white large layer or a mismatch between the expected pieces and DOM pieces, the debug panel opens automatically and displays a red warning.

## Safety

- Ring buffer capped at 900 events.
- Persisted buffer capped at 350 events.
- Board snapshots contain game cell state only, no passwords or authorization tokens.
- Logging/storage failures are swallowed so diagnostics cannot break gameplay.

## Versioning

- Render marker: `data-render-engine="v85"`
- Service Worker registration: `/service-worker.js?v=85`
- Cache: `tm6-v85`
- Artwork atlases: `pieces-v85.webp`, `obstacles-v85.webp`
