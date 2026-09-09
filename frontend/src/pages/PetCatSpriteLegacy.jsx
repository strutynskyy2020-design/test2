// Archived renderer; retained for reference, not imported by the room.
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Cat } from "lucide-react";
import { livingCatOffset } from "./petLivingState";
import { getRoomLayers, isUsablePetImage } from "./petRoom";
import { catWalkPath } from "./petNavigation";
import { RIG_ROOT, RIG_PARTS, safeRigTarget, rigSequence, createRigMotion, setRigPath, advanceRigMotion, poseWeights, blendRigPose, rigFrame, boneTransform, damp } from "./petRig";
import "@/styles/petRig.css";

export const catSequence = rigSequence;
export function catTouchAreas(sequence, safeBelly = false) {
  const frame = rigFrame({ weights: poseWeights(sequence), still: true });
  return { head: frame.touches.head, ...(sequence !== "sleep" ? { back: frame.touches.back } : {}),
    ...(safeBelly && !["sleep", "eat", "clean", "pounce", "walk-left", "walk-right"].includes(sequence) ? { belly: frame.touches.belly } : {}) };
}

let assetPromise;
export function clearRigAssetCache() { assetPromise = null; }
export function loadRigAssets() {
  if (!assetPromise) assetPromise = Promise.all(RIG_PARTS.map(part => new Promise((resolve, reject) => {
    const img = new Image();
    const timer = window.setTimeout(() => { img.onload = null; img.onerror = null; reject(new Error("rig-timeout")); }, 8000);
    const finish = (okay) => { clearTimeout(timer); img.onload = null; img.onerror = null; okay ? resolve() : reject(new Error("rig-asset")); };
    img.onload = () => finish(isUsablePetImage(img)); img.onerror = () => finish(false);
    img.src = RIG_ROOT + part + ".webp";
  }))).catch(error => { assetPromise = null; throw error; });
  return assetPromise;
}

export default function PetCatSprite({ pose, snapshot, zone, reaction = "idle", aim = 0, lookTarget, lookTargetRef, onClick, onPointerDown, catRef, disabled, quiet = false, paused = false, preview = false, chaseTarget, touching = false }) {
  const id = useId().replace(/:/g, ""), nodes = useRef({}), host = useRef(null);
  const base = { x: 50, y: 81, width: 44 };
  const offset = livingCatOffset(snapshot, base, zone, pose);
  const target = safeRigTarget({ x: chaseTarget?.x ?? base.x + offset.x, y: chaseTarget?.y ?? base.y + offset.y });
  const model = useRef(null);
  if (!model.current) model.current = { motion: createRigMotion(target), time: 0, weights: poseWeights(rigSequence({ pose, reaction, quiet })), look: 0, lookY: 0, pathKey: null, aspect: 1 };
  const initialStyle = useRef({ left: target.x + "%", top: target.y + "%", width: "44%", transform: "translate(-50%, -100%)" });
  const [ready, setReady] = useState(false), [retry, setRetry] = useState(0), [fallback, setFallback] = useState(0);
  const layoutKey = JSON.stringify(getRoomLayers(snapshot).map(item => [item.id, item.room.x, item.room.y, item.room.width, item.slot]));
  const input = useRef(null);
  input.current = { pose, snapshot, zone, reaction, aim, lookTarget, lookTargetRef, target, layoutKey, quiet, paused, preview, touching, chase: Boolean(chaseTarget) };
  const ref = (name) => (node) => { nodes.current[name] = node; };
  const attach = (node) => { host.current = node; if (typeof catRef === "function") catRef(node); else if (catRef) catRef.current = node; };
  const safeBelly = snapshot.pet.trust >= 10 && snapshot.pet.stats?.mood >= 60;

  const draw = (dt) => {
    const p = input.current, m = model.current;
    const key = [p.target.x.toFixed(1), p.target.y.toFixed(1), p.zone, p.layoutKey].join("|");
    if (key !== m.pathKey) {
      setRigPath(m.motion, catWalkPath(p.snapshot, m.motion.position, p.target, p.zone));
      m.pathKey = key;
    }
    if (p.preview) m.motion.position = { ...p.target };
    const stopped = p.quiet || p.paused || p.touching || p.preview;
    advanceRigMotion(m.motion, dt, { paused: stopped, chase: p.chase, aspect: m.aspect });
    const moving = !stopped && (m.motion.speed > .1 || m.motion.walk > .1);
    // Sleep is entered after reaching the bed; re-targeting never resets the gait.
    const sequence = moving ? (m.motion.facing < 0 ? "walk-left" : "walk-right") : rigSequence({ pose: p.pose, reaction: p.touching ? "purr" : p.reaction, quiet: p.quiet, aim: p.aim, energy: p.snapshot.pet.stats?.energy });
    if (p.quiet || p.preview) m.weights = poseWeights(sequence);
    else blendRigPose(m.weights, sequence, dt);
    if (!p.paused && !p.quiet) m.time += dt;
    const gaze = p.lookTarget || p.lookTargetRef?.current;
    const eyeX = gaze ? (gaze.x - m.motion.position.x) / 6 : p.aim || (moving ? m.motion.facing * 3 : p.reaction === "left" ? -3 : p.reaction === "right" ? 3 : 0);
    const eyeY = gaze ? (gaze.y - (m.motion.position.y - 25)) / 10 : 0;
    m.look = damp(m.look, Math.max(-5, Math.min(5, eyeX)), dt, 7);
    m.lookY = damp(m.lookY, Math.max(-3, Math.min(3, eyeY)), dt, 7);
    const frame = rigFrame({ time: m.time, phase: m.motion.phase, walk: moving ? m.motion.walk : 0, facing: m.motion.facing, look: m.look, lookY: m.lookY, weights: m.weights, still: p.quiet || p.preview });
    Object.entries(frame.transforms).forEach(([name, value]) => nodes.current[name]?.setAttribute("transform", boneTransform(value)));
    nodes.current.mouth?.setAttribute("opacity", frame.mouthOpacity.toFixed(3));
    nodes.current.eyes?.setAttribute("opacity", frame.open < .015 ? "0" : "1");
    const h = host.current;
    if (h) {
      h.style.left = m.motion.position.x.toFixed(4) + "%"; h.style.top = m.motion.position.y.toFixed(4) + "%";
      h.style.zIndex = String(Math.round(30 + (m.motion.position.y - 55) * .8));
      h.dataset.sequence = sequence;
    }
    for (const [name, box] of Object.entries(frame.touches)) {
      const button = nodes.current["touch-" + name];
      if (!button) continue;
      const hidden = name === "belly" && (!safeBelly || moving || m.weights.sleep > .1 || m.weights.eat > .1 || m.weights.clean > .1 || m.weights.pounce > .1) || name === "back" && m.weights.sleep > .3;
      button.hidden = hidden;
      const [left, top, width, height] = box;
      Object.assign(button.style, { left: left + "%", top: top + "%", width: width + "%", height: height + "%" });
    }
  };
  const drawRef = useRef(draw); drawRef.current = draw;
  useEffect(() => {
    let active = true;
    loadRigAssets().then(() => { if (active) setReady(true); }).catch(() => { if (active) setReady(false); });
    return () => { active = false; };
  }, [retry]);
  useEffect(() => {
    const online = () => { clearRigAssetCache(); setRetry(n => n + 1); setFallback(0); };
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, []);
  useEffect(() => {
    const parent = host.current?.parentElement;
    const measure = () => { const rect = parent?.getBoundingClientRect(); if (rect?.width) model.current.aspect = rect.height / rect.width; };
    measure();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    if (parent) observer?.observe(parent);
    return () => observer?.disconnect();
  }, []);
  useLayoutEffect(() => { drawRef.current(0); });
  useEffect(() => {
    if (quiet || paused || preview || !ready) return undefined;
    let request, previous, active = true;
    const tick = (timestamp) => {
      if (!active) return;
      const dt = previous === undefined ? 0 : Math.min(.05, (timestamp - previous) / 1000);
      previous = timestamp; drawRef.current(dt);
      request = requestAnimationFrame(tick);
    };
    request = requestAnimationFrame(tick);
    return () => { active = false; cancelAnimationFrame(request); };
  }, [quiet, paused, preview, ready]);

  const image = (part, x, y, width, height, extra = {}) => <image href={RIG_ROOT + part + ".webp"} x={x} y={y} width={width} height={height} preserveAspectRatio="none" {...extra} onError={() => { setReady(false); assetPromise = null; }} />;
  const limb = (side) => <g ref={ref("fore" + side)} data-bone={"fore-" + side}>
    <g clipPath={`url(#${id}-upper)`}>{image("fore-" + side, -20, -10, 40, 125)}</g>
    <g ref={ref("knee" + side)} data-bone={"knee-" + side}><g clipPath={`url(#${id}-lower)`}>{image("fore-" + side, -20, -69, 40, 125)}</g></g>
  </g>;
  return <div ref={attach} className={`play-cat pixel-rig ${quiet ? "quiet" : ""}`} style={initialStyle.current} data-reaction={reaction} data-testid="play-cat" data-rig-ready={ready} data-touching={touching}>
    <svg className="pixel-rig-art" viewBox="0 0 320 400" aria-hidden="true" focusable="false" style={{ visibility: ready ? "visible" : "hidden" }}>
      <defs><clipPath id={id + "-upper"}><rect x="-25" y="-12" width="50" height="81" /></clipPath><clipPath id={id + "-lower"}><rect x="-25" y="-9" width="50" height="68" /></clipPath></defs>
      <ellipse cx="160" cy="384" rx="79" ry="9" fill="#180b20" opacity=".22" />
      <g ref={ref("tail")} data-bone="tail">{image("tail", -18, -146, 58, 151)}</g>
      <g ref={ref("hindleft")} data-bone="hind-left">{image("hind-left", -32, -110, 62, 110)}</g>
      <g ref={ref("hindright")} data-bone="hind-right">{image("hind-right", -30, -110, 62, 110)}</g>
      <g ref={ref("torso")} data-bone="torso">
        <g ref={ref("body")} data-bone="body">{image("body", -66, -111, 132, 188)}</g>
        {limb("right")}
        <g ref={ref("head")} data-bone="head">
          <g ref={ref("earLeft")} data-bone="ear-left">{image("ear-left", -28, -64, 56, 64)}</g>
          <g ref={ref("earRight")} data-bone="ear-right">{image("ear-right", -28, -64, 56, 64)}</g>
          {image("head", -98, -128, 196, 169)}
          <g ref={ref("eyes")}><g ref={ref("eyeLeft")} data-bone="eye-left">{image("eye-left", -27, -25.5, 54, 51)}</g><g ref={ref("eyeRight")} data-bone="eye-right">{image("eye-right", -27, -25.5, 54, 51)}</g></g>
          <g ref={ref("mouth")} data-bone="mouth">{image("mouth", -13, -6, 26, 17)}</g>
        </g>
        {limb("left")}
      </g>
    </svg>
    {!ready && (fallback < 2 ? <img className="pixel-rig-fallback play-cat-frame" src={fallback ? "/pet/room/v2/cat/cat-sit.webp" : "/pet/room/v3/cat/idle.webp"} alt="" draggable={false} onError={() => setFallback(n => n + 1)} /> : <span className="play-cat-placeholder" role="img" aria-label="Котик"><Cat size={90} /></span>)}
    {["head", "back", ...(safeBelly ? ["belly"] : [])].map(area => <button key={area} ref={ref("touch-" + area)} type="button" className={`play-cat-touch pixel-touch touch-${area}`} aria-label={area === "head" ? snapshot.pet.name + ": торкнутися або погладити" : area === "back" ? "Погладити спинку" : "Погладити животик"} disabled={disabled} onPointerDown={e => onPointerDown?.(e, area)} onClick={() => onClick?.(area)} />)}
    {reaction === "purr" && <span className="play-cat-love" aria-hidden="true">♥</span>}
    {pose === "sleep" && <span className="play-zzz" aria-hidden="true">z Z z</span>}
  </div>;
}
