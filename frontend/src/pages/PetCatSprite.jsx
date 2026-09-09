import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Cat } from "lucide-react";
import manifest from "@/assets/pixelCatManifest.json";
import { livingCatOffset } from "./petLivingState";
import { getRoomLayers, isUsablePetImage } from "./petRoom";
import { catWalkPath } from "./petNavigation";
import { safeRigTarget, rigSequence, createRigMotion, setRigPath, advanceRigMotion, damp } from "./petRig";
import { pose as seatedPose, aperturePath, walkFacing, WALK_CYCLE, WALK_LEGS, walkLegFrame, legMatrix, plantedWalkTarget, rememberWalkContact } from "./pixelCatMotion";
import { createCatTransition, stepCatTransition, catTransitionPresentation, actionVisualMode, pounceFrame, groomingFrame, yawnAmount } from "./pixelCatChoreography";
import "@/styles/petRig.css";

export const CAT_ASSET_ROOT = `/pet/room/v${manifest.version}/rig/`;
export const catSequence = rigSequence;
export function catTouchAreas(sequence, safeBelly = false) {
  if (sequence === "sleep") return { head: [16, 60, 41, 35] };
  if (sequence === "eat") return { head: [10, 56, 40, 40], back: [48, 39, 30, 33] };
  if (sequence.startsWith("walk")) return { head: [sequence === "walk-right" ? 55 : 5, 22, 40, 40], back: [37, 47, 34, 31] };
  return { head: [26, 16, 46, 43], back: [28, 60, 23, 34], ...(safeBelly && !["clean", "pounce"].includes(sequence) ? { belly: [51, 61, 17, 29] } : {}) };
}
let assetPromise;
export function clearRigAssetCache() { assetPromise = null; }
export function loadRigAssets() {
  if (!assetPromise) assetPromise = Promise.all(Object.values(manifest.parts).map(part => new Promise((resolve, reject) => {
    const img = new Image(); let settled = false;
    const finish = okay => { if (settled) return; settled = true; clearTimeout(timer); img.onload = null; img.onerror = null; okay ? resolve() : reject(new Error("cat-asset")); };
    const timer = window.setTimeout(() => finish(false), 8000);
    img.onload = () => { if (!isUsablePetImage(img)) return finish(false); if (typeof img.decode === "function") img.decode().then(() => finish(true), () => finish(false)); else finish(true); };
    img.onerror = () => finish(false); img.src = CAT_ASSET_ROOT + part.src;
  }))).catch(error => { assetPromise = null; throw error; });
  return assetPromise;
}

export default function PetCatSprite({ pose, snapshot, zone, reaction = "idle", actionKey, aim = 0, lookTarget, lookTargetRef, onClick, onPointerDown, catRef, disabled, quiet = false, paused = false, preview = false, chaseTarget, touching = false, debugStep = 0, debugSpeed = 1, debugContacts = false }) {
  const id = useId().replace(/:/g, ""), nodes = useRef({}), host = useRef(null);
  const base = { x: 50, y: 81, width: 64 };
  const offset = livingCatOffset(snapshot, base, zone, pose);
  const target = safeRigTarget({ x: chaseTarget?.x ?? base.x + offset.x, y: chaseTarget?.y ?? base.y + offset.y });
  target.x = Math.max(31, Math.min(69, target.x));
  const model = useRef(null);
  if (!model.current) { const sequence = rigSequence({ pose, reaction, quiet }); model.current = { motion: createRigMotion(target), time: 0, gait: 0, transition: createCatTransition(actionVisualMode(sequence)), actionAge: 0, actionKey, look: 0, pathKey: null, aspect: 1, sequence }; }
  const initialStyle = useRef({ left: target.x + "%", top: target.y + "%", width: "64%", transform: "translate(-50%, -96%)" });
  const [ready, setReady] = useState(false), [retry, setRetry] = useState(0), [failedPoster, setFailedPoster] = useState(false), [visible, setVisible] = useState(true), [reduced, setReduced] = useState(false);
  const layoutKey = JSON.stringify(getRoomLayers(snapshot).map(item => [item.id, item.room.x, item.room.y, item.room.width, item.slot]));
  const safeBelly = snapshot.pet.trust >= 10 && snapshot.pet.stats?.mood >= 60;
  const input = useRef(null);
  input.current = { pose, snapshot, zone, reaction, actionKey, aim, lookTarget, lookTargetRef, target, layoutKey, quiet: quiet || reduced, paused: paused || !visible, preview, touching, chase: Boolean(chaseTarget), safeBelly };
  const ref = name => node => { nodes.current[name] = node; };
  const attach = node => { host.current = node; if (typeof catRef === "function") catRef(node); else if (catRef) catRef.current = node; };
  const set = (name, attr, value) => nodes.current[name]?.setAttribute(attr, String(value));
  const draw = (dt, debugAdvance = false) => {
    const p = debugAdvance ? { ...input.current, paused: false } : input.current, m = model.current;
    const key = [p.target.x.toFixed(1), p.target.y.toFixed(1), p.zone, p.layoutKey].join("|");
    if (key !== m.pathKey) { setRigPath(m.motion, catWalkPath(p.snapshot, m.motion.position, p.target, p.zone)); m.pathKey = key; }
    if (p.preview || p.quiet) m.motion.position = { ...p.target };
    const stopped = p.quiet || p.paused || p.touching || p.preview;
    const remainingPath = m.motion.path.slice(m.motion.waypoint);
    const hasPath = remainingPath.some(point => Math.hypot(point.x - m.motion.position.x, point.y - m.motion.position.y) > .05);
    const moving = !stopped && (hasPath || m.motion.walk > .1);
    const dx = remainingPath.find(point => Math.abs(point.x - m.motion.position.x) > .1)?.x - m.motion.position.x;
    const direction = Number.isFinite(dx) ? Math.sign(dx) : m.walkFacing || -1;
    const sequence = p.paused && !p.preview && !p.quiet ? m.sequence : moving ? (direction < 0 ? "walk-left" : "walk-right") : rigSequence({ pose: p.pose, reaction: p.touching ? "purr" : p.reaction, quiet: p.quiet, aim: p.aim, energy: p.snapshot.pet.stats?.energy });
    if (!p.paused && (sequence !== m.sequence || (p.actionKey != null && p.actionKey !== m.actionKey))) m.actionAge = 0;
    else if (!p.paused && !p.quiet) m.actionAge += dt;
    if (!p.paused) m.actionKey = p.actionKey;
    m.sequence = sequence;
    // A reversal passes through the unmirrored sitting pose. Never mirror a
    // visible side silhouette (or its planted paws) in a single frame.
    if (!p.paused) {
      if (p.quiet || p.preview) m.turning = false;
      else if (m.turning && m.transition.weights.sit === 1) { m.walkFacing = direction; m.turning = false; }
      else if (moving && m.walkFacing && direction !== m.walkFacing && (m.transition.weights.walk > 0 || m.transition.weights.rise > 0)) m.turning = true;
    }
    const mode = m.turning ? "sit" : actionVisualMode(sequence, m.actionAge, p.quiet || p.preview);
    const wasStanding = m.transition.weights.walk === 1;
    const weights = stepCatTransition(m.transition, mode, p.paused ? 0 : dt, p.quiet || p.preview);
    // Finish registration before travelling, otherwise its offset causes skating.
    const before = { ...m.motion.position };
    const moved = advanceRigMotion(m.motion, dt, { paused: stopped || !wasStanding || weights.walk < 1, chase: p.chase, aspect: m.aspect });
    m.gait = (m.gait + moved * 25 / WALK_CYCLE * Math.PI * 2) % (Math.PI * 2);
    if (!p.paused && !p.quiet) m.time += dt;
    const t = p.quiet || p.preview ? 0 : m.time;
    const gaze = p.lookTarget || p.lookTargetRef?.current;
    const desiredLook = gaze ? (gaze.x - m.motion.position.x) / 20 : p.aim / 4;
    m.look = damp(m.look, Math.max(-1, Math.min(1, desiredLook || 0)), dt, 7);
    const isPurr = sequence === "purr", tired = sequence === "tired";
    const desiredYawn = sequence === "yawn" ? yawnAmount(m.actionAge, p.quiet || p.preview) : 0;
    let yawn = p.quiet || p.preview ? desiredYawn : damp(m.yawn || 0, desiredYawn, dt, 20);
    if (desiredYawn === 0 && yawn < .001) yawn = 0;
    m.yawn = yawn;
    const blink = yawn > 0 ? Math.min(1, yawn * 1.5) : p.quiet || p.preview ? (isPurr ? .65 : tired ? .4 : 0) : isPurr ? .7 + Math.sin(t * 2) * .1 : tired ? .38 : null;
    const s = seatedPose(t, Infinity, blink);
    const shake = sequence === "refuse" ? Math.sin(t * 8) * 1.2 : 0;
    const nod = sequence === "sniff" ? Math.sin(t * 5) * 1.1 : 0;
    set("sit-tail", "transform", `rotate(${s.tail} 981 1286)`);
    set("sit-body", "transform", `translate(783 1390) scale(${s.bodyX} ${s.bodyY}) translate(-783 -1390)`);
    set("sit-head", "transform", `translate(0 ${s.headY + nod}) rotate(${s.head + m.look + shake - yawn * 2 - (isPurr ? 1 : 0)} 793 809)`);
    set("yawn-mouth", "opacity", yawn);
    set("eyelids", "opacity", Math.min(1, s.blink * 12));
    set("eye-left", "d", aperturePath(676, 646, -.29, 63, -79, 63, s.blink));
    set("eye-right", "d", aperturePath(872, 571, -.29, 49, -83, 70, s.blink));
    set("sleep-art", "transform", `translate(800 1390) scale(${1 + Math.sin(t * 1.2) * .0015} ${1 + Math.sin(t * 1.2) * .008}) translate(-800 -1390)`);
    set("eat-art", "transform", `translate(800 1390) scale(1 ${1 + Math.sin(t * 7) * .002}) translate(-800 -1390)`);
    if (!m.turning) m.walkFacing = walkFacing(sequence, m.walkFacing);
    if (moved > 0) m.travelDirection = { x: (m.motion.position.x - before.x) / moved * (m.walkFacing === 1 ? -1 : 1), y: (m.motion.position.y - before.y) * m.aspect / moved };
    set("walk-facing", "transform", m.walkFacing === 1 ? "translate(1600 0) scale(-1 1)" : "");
    set("rise-facing", "transform", m.walkFacing === 1 ? "translate(1600 0) scale(-1 1)" : "");
    const desiredJump = pounceFrame(sequence === "pounce" ? m.actionAge : 10, p.quiet || p.preview);
    if (sequence === "pounce" || p.quiet || p.preview || !m.jump) m.jump = desiredJump;
    else for (const name of Object.keys(desiredJump)) m.jump[name] = damp(m.jump[name], desiredJump[name], dt, 18);
    const jump = m.jump;
    set("walk-action", "transform", `translate(0 ${-jump.lift + jump.crouch * 8}) rotate(${jump.pitch} 800 1190)`);
    set("shadow", "rx", 300 * jump.shadow);
    set("shadow", "opacity", .18 * jump.shadow);
    // Full stride during travel: damping stride with speed moves planted feet.
    // Prepare the feet while standing up, then lower the last airborne paw on arrival.
    if (p.quiet || p.preview || !weights.walk || sequence === "pounce") { m.stride = 0; m.gait = 0; }
    else if (hasPath) m.stride = Math.min(1, weights.walk * 2);
    const stride = m.stride || 0;
    m.settle = damp(m.settle || 0, hasPath ? 0 : 1, dt, 16);
    const bodyY = -(Math.sin(m.gait * 2) ** 2) * 4 * stride;
    set("walk-body", "transform", `translate(0 ${bodyY})`);
    const contactRoot = { x: m.motion.position.x * 25, y: m.motion.position.y * m.aspect * 25 };
    const mirror = m.walkFacing === 1 ? -1 : 1, plant = weights.walk === 1 && stride === 1;
    m.contacts ||= {};
    Object.entries(WALK_LEGS).forEach(([name, leg], index) => {
      const root = leg.root;
      const angle = (name.startsWith("fore") ? 9 : -9) * jump.tuck + (index % 2 ? -4 : 4) * jump.crouch;
      const frame = walkLegFrame(leg, m.gait, { stride, bodyY, direction: m.travelDirection, settle: m.settle,
        plantedAt: plantedWalkTarget(m.contacts[name], contactRoot, mirror, plant) });
      m.contacts[name] = rememberWalkContact(frame.contact, contactRoot, mirror, plant);
      set("walk-" + name, "transform", `translate(0 ${-18 * jump.tuck - jump.crouch * 8}) rotate(${angle} ${root[0]} ${root[1]})`);
      for (const part of ["upper", "lower", "paw"]) set(`walk-${name}-${part}`, "transform", legMatrix(frame[part]));
      set(`contact-${name}`, "cx", frame.contact.x);
      set(`contact-${name}`, "cy", frame.contact.y + (name === "fore-near" ? 42 : 35));
      set(`contact-${name}`, "fill", frame.contact.planted ? "#8cf3ba" : "#ffb85c");
    });
    const groom = groomingFrame(sequence === "clean" ? m.actionAge : 0, p.quiet || p.preview);
    set("groom-art", "transform", `translate(783 1390) scale(${s.bodyX} ${s.bodyY}) translate(-783 -1390)`);
    set("groom-paw", "transform", `translate(0 ${groom.lift}) rotate(${groom.paw} 633 936)`);
    const presentation = catTransitionPresentation(m.transition, m.walkFacing);
    const { registration, mode: visibleMode } = presentation;
    Object.entries(presentation.opacity).forEach(([name, opacity]) => set("mode-" + name, "opacity", opacity));
    Object.entries(registration).forEach(([name, x]) => set("mode-" + name, "transform", `translate(${x.toFixed(3)} 0) translate(800 1390) scale(${presentation.scaleX.toFixed(5)} ${presentation.scaleY.toFixed(5)}) translate(-800 -1390)`));
    if (nodes.current.zzz) nodes.current.zzz.style.opacity = String(presentation.opacity.sleep);
    const h = host.current;
    if (h) { h.style.left = m.motion.position.x.toFixed(4) + "%"; h.style.top = m.motion.position.y.toFixed(4) + "%"; h.style.zIndex = String(Math.round(30 + (m.motion.position.y - 55) * .8)); h.dataset.sequence = sequence; }
    if (h) { h.dataset.mode = visibleMode; h.dataset.actionAge = m.actionAge.toFixed(3); }
    const touchSequence = ["walk", "rise"].includes(visibleMode) ? m.walkFacing === 1 ? "walk-right" : "walk-left" : visibleMode === "groom" ? "clean" : visibleMode === "sit" ? ["clean", "pounce"].includes(sequence) ? sequence : "idle" : visibleMode;
    const areas = catTouchAreas(touchSequence, p.safeBelly && visibleMode === "sit");
    for (const area of Object.values(areas)) {
      area[0] = (area[0] - 50) * presentation.scaleX + 50 + registration[visibleMode] / 16;
      area[1] = (area[1] - 1390 / 14.5) * presentation.scaleY + 1390 / 14.5;
      area[2] *= presentation.scaleX; area[3] *= presentation.scaleY;
    }
    if (jump.lift && visibleMode === "walk") for (const area of Object.values(areas)) area[1] -= jump.lift / 14.5;
    for (const name of ["head", "back", "belly"]) { const button = nodes.current["touch-" + name]; if (!button) continue; button.hidden = !areas[name]; if (!areas[name]) continue; const [left, top, width, height] = areas[name]; Object.assign(button.style, { left: left + "%", top: top + "%", width: width + "%", height: height + "%" }); }
  };
  const drawRef = useRef(draw); drawRef.current = draw;
  useEffect(() => { let active = true; loadRigAssets().then(() => { if (active) setReady(true); }).catch(() => { if (active) setReady(false); }); return () => { active = false; }; }, [retry]);
  useEffect(() => { const online = () => { clearRigAssetCache(); setRetry(n => n + 1); setFailedPoster(false); }; window.addEventListener("online", online); return () => window.removeEventListener("online", online); }, []);
  useEffect(() => {
    let intersects = true; const update = () => setVisible(!document.hidden && intersects);
    const observer = typeof IntersectionObserver === "function" ? new IntersectionObserver(entries => { intersects = entries[0].isIntersecting; update(); }) : null;
    if (host.current) observer?.observe(host.current); document.addEventListener("visibilitychange", update); update();
    const media = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
    const motion = () => setReduced(Boolean(media?.matches)); motion(); media?.addEventListener?.("change", motion);
    return () => { observer?.disconnect(); document.removeEventListener("visibilitychange", update); media?.removeEventListener?.("change", motion); };
  }, []);
  useEffect(() => { const parent = host.current?.parentElement; const measure = () => { const r = parent?.getBoundingClientRect(); if (r?.width) model.current.aspect = r.height / r.width; }; measure(); const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null; if (parent) observer?.observe(parent); return () => observer?.disconnect(); }, []);
  useLayoutEffect(() => {
    // Used only by the development bench; the room never supplies debugStep.
    if (process.env.NODE_ENV === "development" && paused && debugStep && debugStep !== model.current.debugStep) {
      model.current.debugStep = debugStep;
      drawRef.current(.025, true);
    } else drawRef.current(0);
  });
  useEffect(() => {
    if (quiet || reduced || paused || !visible || preview || !ready) return undefined;
    let request, previous, active = true;
    const tick = timestamp => { if (!active) return; const dt = previous === undefined ? 0 : Math.min(.05, (timestamp - previous) / 1000); previous = timestamp; drawRef.current(dt * (process.env.NODE_ENV === "development" ? Math.max(.1, Math.min(1, debugSpeed)) : 1)); request = requestAnimationFrame(tick); };
    request = requestAnimationFrame(tick); return () => { active = false; cancelAnimationFrame(request); };
  }, [quiet, reduced, paused, visible, preview, ready, debugSpeed]);
  const image = (name, extra = {}) => { const p = manifest.parts[name]; return <image href={CAT_ASSET_ROOT + p.src} x={p.rect[0]} y={p.rect[1]} width={p.rect[2]} height={p.rect[3]} preserveAspectRatio="none" {...extra} onError={() => { setReady(false); clearRigAssetCache(); }} />; };
  const legImage = name => <g ref={ref("walk-" + name)}>{["upper", "lower", "paw"].map(part => <g key={part} ref={ref(`walk-${name}-${part}`)}><g clipPath={`url(#${id}-${name}-${part})`}>{image("walk-" + name)}</g></g>)}</g>;
  return <div ref={attach} className={`play-cat pixel-rig pixel-cat-v5 ${quiet || reduced ? "quiet" : ""}`} style={initialStyle.current} data-reaction={reaction} data-testid="play-cat" data-rig-ready={ready} data-touching={touching} data-animation-paused={paused || !visible}>
    <svg className="pixel-rig-art" viewBox="0 0 1600 1450" aria-hidden="true" focusable="false" style={{ visibility: ready ? "visible" : "hidden" }}>
      <defs><mask id={`${id}-eyelids`} maskUnits="userSpaceOnUse" x="0" y="0" width="1600" height="1450"><rect width="1600" height="1450" fill="black" /><ellipse cx="675" cy="642" rx="105" ry="105" fill="white" /><ellipse cx="872" cy="571" rx="90" ry="110" fill="white" /><path ref={ref("eye-left")} fill="black" /><path ref={ref("eye-right")} fill="black" /></mask></defs>
      <defs>{Object.entries(WALK_LEGS).map(([name, leg]) => <g key={name}>
        <clipPath id={`${id}-${name}-upper`} clipPathUnits="userSpaceOnUse"><rect width="1600" height={leg.knee[1] + .5} /></clipPath>
        <clipPath id={`${id}-${name}-lower`} clipPathUnits="userSpaceOnUse"><rect y={leg.knee[1]} width="1600" height={leg.ankle[1] - leg.knee[1] + .5} /></clipPath>
        <clipPath id={`${id}-${name}-paw`} clipPathUnits="userSpaceOnUse"><rect y={leg.ankle[1]} width="1600" height={1450 - leg.ankle[1]} /></clipPath>
      </g>)}</defs>
      <ellipse ref={ref("shadow")} cx="800" cy="1390" rx="300" ry="21" fill="#180b20" opacity=".18" />
      <g ref={ref("mode-sit")}><g ref={ref("sit-tail")}>{image("sit-tail")}</g><g ref={ref("sit-body")}>{image("sit-body")}<g ref={ref("sit-head")}>{image("sit-head")}{image("sit-head-closed", { ref: ref("eyelids"), mask: `url(#${id}-eyelids)` })}{image("yawn-mouth", { ref: ref("yawn-mouth") })}</g></g></g>
      <g ref={ref("mode-sleep")}><g ref={ref("sleep-art")}>{image("sleep")}</g></g>
      <g ref={ref("mode-eat")}><g ref={ref("eat-art")}>{image("eat")}</g></g>
      <g ref={ref("mode-walk")}><g ref={ref("walk-action")}><g ref={ref("walk-facing")}>{legImage("fore-far")}{legImage("hind-far")}<g ref={ref("walk-body")}>{image("walk-body")}</g>{legImage("fore-near")}{legImage("hind-near")}
        {process.env.NODE_ENV === "development" && debugContacts && <g opacity=".9">{Object.keys(WALK_LEGS).map(name => <circle key={name} ref={ref(`contact-${name}`)} r="9" />)}</g>}
      </g></g></g>
      <g ref={ref("mode-groom")}><g ref={ref("groom-art")}>{image("groom-body")}<g ref={ref("groom-paw")}>{image("groom-paw")}</g></g></g>
      <g ref={ref("mode-rise")}><g ref={ref("rise-facing")}>{image("rise")}</g></g>
    </svg>
    {!ready && (!failedPoster ? <img className="pixel-rig-fallback play-cat-frame" src={CAT_ASSET_ROOT + "sit-poster.webp"} alt="" draggable={false} onError={() => setFailedPoster(true)} /> : <span className="play-cat-placeholder" role="img" aria-label="Котик"><Cat size={90} /></span>)}
    {["head", "back", ...(safeBelly ? ["belly"] : [])].map(area => <button key={area} ref={ref("touch-" + area)} type="button" className={`play-cat-touch pixel-touch touch-${area}`} aria-label={area === "head" ? snapshot.pet.name + ": торкнутися або погладити" : area === "back" ? "Погладити спинку" : "Погладити животик"} disabled={disabled} onPointerDown={e => onPointerDown?.(e, area)} onClick={() => onClick?.(area)} />)}
    {reaction === "purr" && <span className="play-cat-love" aria-hidden="true">♥</span>}
    {pose === "sleep" && <span ref={ref("zzz")} className="play-zzz" aria-hidden="true">z Z z</span>}
  </div>;
}
