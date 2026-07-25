# TM6 Bonus v77: Stage 2 render optimization

## What changed

### 1. Board pieces no longer use Framer Motion layout measurement

Every piece is now placed in an absolute layer and moved with a GPU-friendly transform:

```css
transform: translate3d(column * 100%, row * 100%, 0);
```

The board no longer uses `LayoutGroup`, `layout`, or `layoutId`. This removes repeated FLIP layout measurement for up to 49 animated cells after every frame.

### 2. Stable piece DOM nodes

Pieces continue to use the server-provided stable `cell.id` as their React key. A swap or cascade moves the existing node instead of rebuilding the whole board.

The logical session remains in `game.board`, while `displayBoard` and the derived `visualPieces` list are used as the visual animation state.

### 3. Memoized board renderer

`Piece` is wrapped in `React.memo` with a custom visual comparator. Unchanged pieces do not rerender when only the score, toast, combo text, particle layer, or another cell changes.

The complete piece layer is also isolated in the memoized `BoardPiecesLayer` component.

Event callbacks are routed through stable refs, so new callback identities do not invalidate all 49 piece components.

### 4. One Canvas particle layer

The old `FxParticles` implementation created multiple animated DOM nodes for every explosion. Those particles are now rendered by one `<canvas>` layer.

The Canvas renderer:

- uses one `requestAnimationFrame` loop;
- caps device pixel ratio at 2;
- limits the active pool to 180 particles;
- pauses automatically when no particles remain;
- reacts to board resizing through `ResizeObserver`;
- supports circles, debris squares, gravity, stagger and additive glow;
- keeps reduced-motion support.

DOM-based beams, rings and important cell flashes remain, while small debris and sparks move to Canvas.

### 5. Lighter piece markup

The invisible Lucide SVG mounted inside every piece was removed. Several separate rim-light, bevel, reflection and dark-edge elements were combined into one CSS overlay while preserving the glossy artwork.

### 6. PWA cache

The service-worker cache version is now:

```text
tm6-v77
```

## Deployment

Only the frontend changed. The backend and `Code.gs` remain compatible with v76.

## Validation performed

- JSX/JavaScript syntax parsed with TypeScript in `--noResolve` mode;
- backend passed `python -m py_compile`;
- service worker passed `node --check`;
- verified that `LayoutGroup`, `layout` and `layoutId` are absent from the Bonus Match board;
- verified absolute `translate3d` placement, memoized pieces, stable dispatch refs and Canvas particle rendering;
- ZIP archive integrity checked after packaging.

A full production build was not run because this project copy does not contain `node_modules`.
