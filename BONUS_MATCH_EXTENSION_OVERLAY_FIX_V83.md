# Bonus Match v83

## Confirmed clue
The production DOM contains `bis_skin_checked="1"`, an attribute injected by a browser security extension. The white board is not a removed React tree: the board and piece nodes remain present, and no large `img`, `object`, `embed`, or `iframe` is returned by `elementsFromPoint()`.

This points to generated/replaced content applied through CSS pseudo-elements or extension styling rather than a normal game element.

## Fix
- Suppress `::before` and `::after` generated content throughout `.bonus-match-board`.
- Force the board surface back to the game background with `!important`.
- Prevent background images and replacement media from covering the board.
- Keep canvas transparent.
- Version assets and PWA cache as v83.
- Set `data-render-engine="v83"` for production verification.

## Verification
After deployment, inspect `.bonus-match-board` and confirm `data-render-engine="v83"`.
For a definitive extension test, open the game in an Incognito window with extensions disabled. If the issue disappears there, the extension is the source.
