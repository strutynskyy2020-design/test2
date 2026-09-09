import { useEffect, useRef, useState } from "react";
import { Check, Minus, MoveHorizontal, Plus, RotateCcw } from "lucide-react";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const PANORAMA_VIEWPORT_RATIO = 4 / 5;

const getPanBounds = (rect, sceneWidthMultiplier, zoom) => ({
  x: Math.max(0, (rect.width * sceneWidthMultiplier * zoom - rect.width) / 2),
  y: Math.max(0, (rect.height * zoom - rect.height) / 2),
});

const clampToBounds = (next, bounds) => ({
  x: clamp(next.x, -bounds.x, bounds.x),
  y: clamp(next.y, -bounds.y, bounds.y),
});

export default function SceneViewport({ session, hintMarker, missMarker, disabled, onFind }) {
  const viewportRef = useRef(null);
  const svgRef = useRef(null);
  const dragRef = useRef(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const sceneRatio = session.image_width / session.image_height;
  const isPanorama = sceneRatio > 1;
  const sceneWidthMultiplier = isPanorama ? sceneRatio / PANORAMA_VIEWPORT_RATIO : 1;

  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setIsDragging(false);
    dragRef.current = null;
  }, [session?.id]);

  const panBounds = (nextZoom = zoom) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return getPanBounds(rect, sceneWidthMultiplier, nextZoom);
  };

  const clampPan = (next, nextZoom = zoom) => clampToBounds(next, panBounds(nextZoom));

  useEffect(() => {
    if (!hintMarker) return;
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const bounds = getPanBounds(rect, sceneWidthMultiplier, zoom);
    setPan(clampToBounds({
      x: (0.5 - hintMarker.x) * rect.width * sceneWidthMultiplier * zoom,
      y: (0.5 - hintMarker.y) * rect.height * zoom,
    }, bounds));
  }, [hintMarker, sceneWidthMultiplier, zoom]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => {
      const bounds = getPanBounds(viewport.getBoundingClientRect(), sceneWidthMultiplier, zoom);
      setPan((current) => {
        const next = clampToBounds(current, bounds);
        return next.x === current.x && next.y === current.y ? current : next;
      });
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [sceneWidthMultiplier, zoom]);

  const changeZoom = (delta) => {
    setZoom((current) => {
      const next = clamp(Number((current + delta).toFixed(2)), 1, 2.75);
      setPan((value) => clampPan(value, next));
      return next;
    });
  };

  const pointFromEvent = (event) => {
    const svg = svgRef.current;
    const matrix = svg?.getScreenCTM?.();
    if (!svg || !matrix) return null;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const local = point.matrixTransform(matrix.inverse());
    if (local.x < 0 || local.x > 1 || local.y < 0 || local.y > 1) return null;
    return { x: Number(local.x.toFixed(5)), y: Number(local.y.toFixed(5)) };
  };

  const onPointerDown = (event) => {
    if (disabled || event.button > 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: pan.x,
      originY: pan.y,
      moved: false,
    };
  };

  const onPointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const bounds = panBounds();
    if (bounds.x === 0 && bounds.y === 0) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.hypot(dx, dy) > 7) {
      drag.moved = true;
      setIsDragging(true);
    }
    setPan(clampPan({ x: drag.originX + dx, y: drag.originY + dy }));
  };

  const onPointerUp = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setIsDragging(false);
    if (drag.moved || disabled) return;
    const point = pointFromEvent(event);
    if (point) onFind(point);
  };

  return (
    <section className="hidden-scene-shell" data-testid="hidden-object-scene">
      <div
        ref={viewportRef}
        className={`hidden-scene-viewport ${isPanorama ? "is-panorama" : ""} ${isPanorama || zoom > 1 ? "is-pannable" : ""} ${isDragging ? "is-dragging" : ""} ${disabled ? "is-disabled" : ""}`}
        style={{
          "--scene-ratio": `${session.image_width} / ${session.image_height}`,
          "--scene-render-width": `${sceneWidthMultiplier * 100}%`,
        }}
      >
        <svg
          ref={svgRef}
          className="hidden-scene-svg"
          viewBox="0 0 1 1"
          preserveAspectRatio="none"
          role="img"
          aria-label={`Сцена рівня «${session.title}». Натискайте на предмети зі списку.${isPanorama ? " Перетягуйте сцену ліворуч або праворуч, щоб оглянути її повністю." : ""}`}
          style={{ transform: `translate3d(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px), 0) scale(${zoom})` }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => { dragRef.current = null; setIsDragging(false); }}
        >
          <image href={session.image} x="0" y="0" width="1" height="1" preserveAspectRatio="none" />
          {session.found_markers?.map((marker) => (
            <g key={marker.object_id} className="hidden-found-marker" transform={`translate(${marker.x} ${marker.y})`}>
              <circle r="0.031" />
              <Check x="-0.017" y="-0.017" width="0.034" height="0.034" strokeWidth="3.5" />
            </g>
          ))}
          {hintMarker && (
            <g className="hidden-hint-marker" transform={`translate(${hintMarker.x} ${hintMarker.y})`}>
              <circle r="0.062" />
              <circle r="0.036" />
              <circle className="hidden-hint-core" r="0.014" />
            </g>
          )}
          {missMarker && <circle className="hidden-miss-marker" cx={missMarker.x} cy={missMarker.y} r="0.028" />}
        </svg>

        {isPanorama && (
          <div className="hidden-pan-affordance" data-testid="hidden-object-pan-hint" aria-hidden="true">
            <MoveHorizontal size={17} />
            <span>Тягніть сцену вліво або вправо</span>
          </div>
        )}

        <div className="hidden-zoom-controls" aria-label="Масштаб сцени">
          <button type="button" onClick={() => changeZoom(-0.35)} disabled={zoom <= 1} aria-label="Зменшити масштаб" data-testid="hidden-object-zoom-out"><Minus size={18} /></button>
          <span>{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => changeZoom(0.35)} disabled={zoom >= 2.75} aria-label="Збільшити масштаб" data-testid="hidden-object-zoom-in"><Plus size={18} /></button>
          <button type="button" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} aria-label="Скинути масштаб" data-testid="hidden-object-zoom-reset"><RotateCcw size={17} /></button>
        </div>
      </div>
    </section>
  );
}
