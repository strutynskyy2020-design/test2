# Bonus Match diagnostics v86

## Why the v85 button was not visible

The v85 source did contain a debug button, but it was rendered inside the animated page tree. That made the tool dependent on the page's stacking and containing blocks and gave no reliable proof that the live deployment was actually running the diagnostics build.

v86 renders the diagnostic UI with `createPortal(..., document.body)` and uses inline styles plus the maximum practical z-index. It therefore stays outside the Bonus Match board, Framer Motion containers, and the mobile app shell.

## Visible proof that v86 is running

The page must show a persistent button near the lower-right edge of the 480px app shell:

`🐞 DEBUG v86`

The following checks are also available in DevTools:

```js
document.documentElement.dataset.bonusDiagnostics
window.__TM6_BONUS_DIAGNOSTICS__.summary()
document.querySelector('[data-render-engine="v86"]')
document.querySelector('[data-testid="bonus-debug-button"]')
```

## What the logger records

- JavaScript errors and unhandled promise rejections
- React Error Boundary failures
- failed element/resource loads
- Fetch and Axios/XMLHttpRequest timing, status, content type, and failure
- console warnings and errors
- long browser tasks
- Service Worker controller and browser state
- game state, board hash, compact 7x7 board, moves, score, cascade and animation state
- DOM piece count versus React's expected piece count
- visibility, opacity, rectangles, transforms, backgrounds and z-indexes
- nine `elementsFromPoint` stacks across the board
- large covering descendants and pseudo-elements
- replaced elements such as IMG, OBJECT, IFRAME and VIDEO
- Canvas dimensions and nine sampled pixels
- active Web Animations under the board
- board child and attribute mutations

Request bodies and query-parameter values are not written to the report.

## How to capture the failure

1. Deploy v86 frontend.
2. Remove the old Service Worker once in DevTools, Application, Service Workers.
3. Reload and confirm `🐞 DEBUG v86` is visible.
4. Play until the white board appears.
5. Do not reload the page.
6. Open the debug panel and press `⬇ JSON ЛОГ`.
7. Upload the generated `bonus-match-diagnostics-v86-....json` file.

The keyboard shortcut `Alt + Shift + B` opens the panel even when another game layer covers the page.

## Emergency Console export

```js
window.__TM6_BONUS_DIAGNOSTICS__.snapshot('white-board-manual')
window.__TM6_BONUS_DIAGNOSTICS__.download({ note: 'white board visible' })
```

Logs are preserved in `localStorage`, so a reload does not immediately erase the previous session's events.
