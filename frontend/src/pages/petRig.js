// Pixel v176: one texture per body part, a fixed 320 x 400 bind space.
// No frame swapping, cross-fades, per-pose resizing, or wall-clock gait timers.
export const RIG_ROOT = "/pet/room/v4/rig/";
export const RIG_PARTS = ["head", "body", "tail", "fore-left", "fore-right", "hind-left", "hind-right", "ear-left", "ear-right", "eye-left", "eye-right", "mouth"];
export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Number(n) || 0));
const TAU = Math.PI * 2, RAD = 180 / Math.PI;
export const damp = (from, to, dt, rate = 10) => from + (to - from) * (1 - Math.exp(-rate * dt));
export const safeRigTarget = (target) => ({ x: clamp(target.x, 24, 76), y: clamp(target.y, 58, 92) });

export function rigSequence({ pose, reaction, walking, quiet, aim = 0, energy = 70 }) {
  if (pose === "sleep") return "sleep";
  if (walking && !quiet) return walking;
  if (["eat", "clean", "purr", "refuse", "sniff", "pounce", "yawn", "tired"].includes(reaction)) return reaction;
  if (pose === "eat") return "eat";
  if (quiet) return "idle";
  if (pose === "play") return "pounce";
  if (aim < -1.8) return "left";
  if (aim > 1.8) return "right";
  return energy < 30 ? "tired" : "idle";
}

export function createRigMotion(position) {
  return { position: { ...position }, path: [], waypoint: 0, speed: 0, phase: 0, distance: 0, facing: 0, walk: 0 };
}
export function setRigPath(state, path) {
  state.path = path.slice(1).map(p => ({ ...p })); state.waypoint = 0;
}
const segmentLength = (a, b, aspect) => Math.hypot(b.x - a.x, (b.y - a.y) * aspect);
export function advanceRigMotion(state, seconds, { paused = false, chase = false, aspect = 1 } = {}) {
  const dt = clamp(seconds, 0, .05), ratio = clamp(aspect, .35, 3);
  if (paused) { state.speed = 0; state.walk = damp(state.walk, 0, dt); return 0; }
  const remaining = state.path.slice(state.waypoint).reduce((n, p, i, arr) => n + segmentLength(i ? arr[i - 1] : state.position, p, ratio), 0);
  const desired = Math.min(chase ? 30 : 17, Math.sqrt(2 * 65 * remaining));
  state.speed = Math.min(desired, state.speed + 65 * dt);
  let budget = state.speed * dt, moved = 0, dx = 0;
  while (budget > 0 && state.waypoint < state.path.length) {
    const to = state.path[state.waypoint], length = segmentLength(state.position, to, ratio);
    if (length < .001) { state.waypoint++; continue; }
    const step = Math.min(budget, length), part = step / length;
    dx += (to.x - state.position.x) * part;
    state.position.x += (to.x - state.position.x) * part;
    state.position.y += (to.y - state.position.y) * part;
    moved += step; budget -= step;
    if (step === length) state.waypoint++;
  }
  if (moved > .001) {
    // One step cycle for each 72 bind-space units actually travelled.
    state.phase = (state.phase + moved * (320 / 44) / 72 * TAU) % TAU;
    state.distance += moved;
    if (Math.abs(dx) > .0001) state.facing = damp(state.facing, Math.sign(dx), dt, 7);
  }
  if (state.waypoint >= state.path.length) state.speed = 0;
  state.walk = damp(state.walk, moved > .001 ? 1 : 0, dt, 12);
  return moved;
}

// Two-bone inverse kinematics; lengths remain constant even during crouches.
export function solveLeg(dx, dy, upper = 59, lower = 56, bend = 1) {
  const distance = clamp(Math.hypot(dx, dy), Math.abs(upper - lower) + .001, upper + lower - .001);
  const direction = Math.atan2(dy, dx);
  const shoulder = Math.acos(clamp((upper * upper + distance * distance - lower * lower) / (2 * upper * distance), -1, 1));
  const knee = Math.acos(clamp((distance * distance - upper * upper - lower * lower) / (2 * upper * lower), -1, 1));
  return { upper: (direction - Math.PI / 2 + bend * shoulder) * RAD, lower: -bend * knee * RAD };
}

export const POSE_CHANNELS = ["sleep", "eat", "clean", "purr", "refuse", "sniff", "pounce", "tired", "yawn"];
export function poseWeights(sequence) { return Object.fromEntries(POSE_CHANNELS.map(key => [key, key === sequence ? 1 : 0])); }
export function blendRigPose(current, sequence, dt) {
  const target = poseWeights(sequence);
  POSE_CHANNELS.forEach(key => { current[key] = damp(current[key] || 0, target[key], dt, key === "sleep" ? 4 : 8); });
  return current;
}
const bone = (x = 0, y = 0, angle = 0, sx = 1, sy = 1) => ({ x, y, angle, sx, sy });
export function rigFootStep(phase) {
  const progress = ((phase / TAU) % 1 + 1) % 1;
  // During support the foot travels backwards exactly as far as the root
  // travels forwards; the shorter return arc lifts it off the floor.
  const stride = 72 * .6;
  if (progress < .6) return { x: stride / 2 - progress * 72, lift: 0 };
  const swing = (progress - .6) / .4, eased = swing * swing * (3 - 2 * swing);
  return { x: -stride / 2 + eased * stride, lift: Math.sin(swing * Math.PI) * 17 };
}
export function rigFrame({ time = 0, phase = 0, walk = 0, facing = 0, look = 0, lookY = 0, weights = {}, still = false }) {
  const { sleep = 0, eat = 0, clean = 0, purr = 0, refuse = 0, sniff = 0, pounce = 0, tired = 0, yawn = 0 } = weights;
  const t = still ? 0 : time, moving = still ? 0 : walk;
  const breath = still ? 0 : Math.sin(t * 1.65) * .65;
  const crouch = pounce * (3 + Math.sin(t * 3) * 2);
  const bodyY = 281 + sleep * 42 + eat * 28 + crouch - moving * 2;
  const bodyX = 160 + facing * moving * 3;
  const headX = -25 * sleep - eat * 20 + look * 1.2;
  const headY = -77 + sleep * 88 + eat * 86 + clean * 7 + tired * 7 + breath;
  const headAngle = look * 1.1 - sleep * 12 - eat * 10 - clean * 5 + purr * (still ? -5 : -4 + Math.sin(t * 1.8)) + refuse * Math.sin(t * 7) * 7 + sniff * Math.sin(t * 3) * 2;
  const blinkClock = t % 5.3;
  const blink = blinkClock > 4.8 && blinkClock < 5.04 ? Math.sin((blinkClock - 4.8) / .24 * Math.PI) : 0;
  const open = clamp((1 - blink) * (1 - sleep) * (1 - purr * .62) * (1 - tired * .35), 0, 1);
  const body = bone(bodyX, bodyY);
  const head = bone(headX, headY + lookY * .6, headAngle);
  const transforms = {
    torso: body, body: bone(0, 0, sleep * 78 + eat * 30, 1, 1 + breath * .002), head,
    tail: bone(207 + sleep * 10, 348 + sleep * 21, -14 + sleep * 68 + (still ? 0 : Math.sin(t * (refuse ? 4.5 : 1.35)) * (refuse ? 12 : 7))),
    earLeft: bone(-62, -96, -4 + refuse * -17 + (still ? 0 : Math.sin(t * 2) * 1.2)),
    earRight: bone(63, -99, 5 + refuse * 17 + (still ? 0 : Math.sin(t * 2 + 1) * 1.2)),
    eyeLeft: bone(-40 + look * .6, -42 + lookY * .5, 0, 1, Math.max(.001, open)),
    eyeRight: bone(45 + look * .6, -47 + lookY * .5, 0, 1, Math.max(.001, open)),
    mouth: bone(5, 8 + eat * Math.sin(t * 10), 0, 1, 1 + yawn * .7),
  };
  const contact = {};
  for (const [name, side, offset] of [["left", -1, 0], ["right", 1, Math.PI]]) {
    const cycle = phase + offset;
    const step = rigFootStep(cycle);
    const footX = 160 + side * (27 + sleep * 10) + step.x * moving * facing;
    const footY = 381 - step.lift * moving;
    const shoulder = { x: side * 27, y: -10 + sleep * 5 };
    const grooming = name === "left" ? clean : 0;
    const fx = footX + grooming * 37, fy = footY - grooming * (165 + Math.sin(t * 4) * 4);
    const leg = solveLeg(fx - bodyX - shoulder.x, fy - bodyY - shoulder.y, 59, 56, side);
    transforms["fore" + name] = bone(shoulder.x, shoulder.y, leg.upper);
    transforms["knee" + name] = bone(0, 59, leg.lower);
    const hindLift = Math.max(0, Math.sin(cycle + Math.PI)) * 9 * moving;
    transforms["hind" + name] = bone(160 + side * (49 + sleep * 13) + Math.cos(cycle + Math.PI) * 7 * moving, 381 - hindLift, side * (-5 - sleep * 14));
    contact[name] = { x: fx, y: fy };
  }
  return { transforms, contact, open, mouthOpacity: clamp(eat * .85 + clean * .65 + yawn, 0, 1), shadow: 1 - pounce * .08,
    // Hit areas follow the current bones rather than obsolete pose-specific PNG bounds.
    touches: { head: [(bodyX + head.x - 95) / 3.2, (bodyY + head.y - 136) / 4, 60, 42], back: [(bodyX - 67) / 3.2, (bodyY - 57) / 4, 21, 25], belly: [(bodyX - 20) / 3.2, (bodyY - 50) / 4, 25, 24] } };
}
export const boneTransform = ({ x, y, angle, sx, sy }) => `translate(${x.toFixed(3)} ${y.toFixed(3)}) rotate(${angle.toFixed(3)}) scale(${sx.toFixed(4)} ${sy.toFixed(4)})`;
