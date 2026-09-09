export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const ease = v => { const t = clamp(v); return t * t * (3 - 2 * t); };
export function blinkEnvelope(age) {
  if (age < 0 || age > .39) return 0;
  if (age < .115) return ease(age / .115);
  if (age < .16) return 1;
  return 1 - ease((age - .16) / .23);
}
// Continuous small-angle motion: texture sizes and bind coordinates never change.
export function pose(time = 0, petAge = Infinity, manualBlink = null) {
  time = Number.isFinite(time) ? Math.max(0, time) : 0;
  const pet = Number.isFinite(petAge) && petAge >= 0 && petAge <= 2.7 ? Math.sin(Math.PI * petAge / 2.7) ** 2 : 0;
  const breathing = Math.sin(time * 1.65);
  const age = (time + 1.1) % 5.9;
  return {
    head: Math.sin(time * .64) * .85 + Math.sin(time * .27) * .3 - pet * 1.05,
    headY: breathing * .65 - pet * 2,
    bodyY: 1 + breathing * .0035,
    bodyX: 1 + breathing * .0015,
    tail: Math.sin(time * .93) * 2.6 + Math.sin(time * 1.71) * .65 + pet * 1.5,
    blink: manualBlink === null ? Math.max(blinkEnvelope(age), pet * .85) : clamp(Number(manualBlink) || 0),
    pet,
  };
}

export function aperturePath(cx, cy, angle, width, top, bottom, closure) {
  const t = clamp(closure), c = Math.cos(angle), s = Math.sin(angle);
  const point = (x, y) => `${(cx + x * c - y * s).toFixed(2)},${(cy + x * s + y * c).toFixed(2)}`;
  const upper = top * (1 - t) + 23 * t;
  const lower = bottom * (1 - t) + 23 * t;
  return `M${point(-width, 7)} C${point(-width, upper)} ${point(width, upper)} ${point(width, 7)} C${point(width * .8, lower)} ${point(-width * .8, lower)} ${point(-width, 7)}Z`;
}

// Keep the outgoing walking layer facing its last direction while it fades out.
export const walkFacing = (sequence, previous = -1) => sequence === 'walk-right' ? 1 : sequence === 'walk-left' ? -1 : previous;
export const WALK_CYCLE = 170;
export const WALK_SUPPORT = .64;
// Bind points refer to the existing artwork. The paw is a separate, level strip;
// two adjoining strips bend the leg without adding or decoding new textures.
export const WALK_LEGS = {
  'fore-near': { root: [648, 1045], knee: [643, 1210], ankle: [611, 1348], phase: 0, bend: -1 },
  'fore-far': { root: [520, 1092], knee: [506, 1205], ankle: [454, 1328], phase: .5, bend: -1 },
  'hind-near': { root: [1070, 1033], knee: [1162, 1220], ankle: [1170, 1322], phase: .25, bend: 1 },
  'hind-far': { root: [920, 1092], knee: [970, 1200], ankle: [902, 1297], phase: .75, bend: 1 },
};
export function walkFoot(phase) {
  const progress = ((phase / (Math.PI * 2)) % 1 + 1) % 1;
  const reach = WALK_CYCLE * WALK_SUPPORT / 2;
  if (progress < WALK_SUPPORT) return { x: -reach + progress * WALK_CYCLE, lift: 0, planted: true };
  const swing = (progress - WALK_SUPPORT) / (1 - WALK_SUPPORT);
  // Match the support velocity at both ends; lift has zero endpoint velocity.
  const arc = Math.sin(Math.PI * swing) ** 2;
  const x = reach - WALK_CYCLE * WALK_SUPPORT * ease(swing)
    + WALK_CYCLE * (1 - WALK_SUPPORT) * swing * (1 - swing) * (1 - 2 * swing);
  return { x, lift: 34 * arc, planted: false };
}
const kneeFor = (root, ankle, upper, lower, bend) => {
  const dx = ankle[0] - root[0], dy = ankle[1] - root[1];
  const distance = Math.max(.001, Math.hypot(dx, dy));
  const along = clamp((upper * upper - lower * lower + distance * distance) / (2 * distance), 0, upper);
  const across = Math.sqrt(Math.max(0, upper * upper - along * along)) * bend;
  return [root[0] + (dx * along - dy * across) / distance, root[1] + (dy * along + dx * across) / distance];
};
// Map a horizontal texture strip between two joints. Both sides of each seam
// share exactly the same transform at the boundary, including under knee flexion.
const legStrip = (from, to, movedFrom, movedTo) => {
  const height = to[1] - from[1];
  const shear = ((movedTo[0] - to[0]) - (movedFrom[0] - from[0])) / height;
  const scaleY = (movedTo[1] - movedFrom[1]) / height;
  return [1, 0, shear, scaleY, movedFrom[0] - from[0] - shear * from[1], movedFrom[1] - scaleY * from[1]];
};
export const legMatrix = values => `matrix(${values.map(value => value.toFixed(5)).join(' ')})`;
export function plantedWalkTarget(previous, position, mirror, active) {
  if (!active || !previous?.active || !previous.planted || previous.mirror !== mirror) return undefined;
  return [800 + (previous.x - position.x) / mirror, 1390 + previous.y - position.y];
}
export function rememberWalkContact(contact, position, mirror, active) {
  return { x: position.x + mirror * (contact.x - 800), y: position.y + contact.y - 1390, planted: contact.planted, mirror, active };
}
export function walkLegFrame(leg, phase, { stride = 1, bodyY = 0, direction = { x: -1, y: 0 }, settle = 0, plantedAt } = {}) {
  const step = walkFoot(phase + leg.phase * Math.PI * 2);
  const dx = plantedAt && step.planted ? plantedAt[0] - leg.ankle[0] : -direction.x * step.x * stride;
  const dy = plantedAt && step.planted ? plantedAt[1] - leg.ankle[1] : (-direction.y * step.x - step.lift * (1 - settle)) * stride;
  const root = [leg.root[0], leg.root[1] + bodyY], ankle = [leg.ankle[0] + dx, leg.ankle[1] + dy];
  const upper = Math.hypot(leg.knee[0] - leg.root[0], leg.knee[1] - leg.root[1]) * 1.06;
  const lower = Math.hypot(leg.ankle[0] - leg.knee[0], leg.ankle[1] - leg.knee[1]) * 1.06;
  const rest = kneeFor(leg.root, leg.ankle, upper, lower, leg.bend);
  const solved = kneeFor(root, ankle, upper, lower, leg.bend);
  const knee = [leg.knee[0] + solved[0] - rest[0], leg.knee[1] + solved[1] - rest[1]];
  return {
    upper: legStrip(leg.root, leg.knee, root, knee),
    lower: legStrip(leg.knee, leg.ankle, knee, ankle),
    paw: [1, 0, 0, 1, dx, dy],
    contact: { x: ankle[0], y: ankle[1], planted: step.planted },
  };
}
// Kept for the retired renderer and its callers; the current cat uses bent strips.
export function walkLeg(phase, root, amplitude = 1) {
  const progress = ((phase / (Math.PI * 2)) % 1 + 1) % 1;
  const swing = clamp((progress - .6) / .4);
  const dx = progress < .6 ? 43 - progress / .6 * 86 : -43 + swing * swing * (3 - 2 * swing) * 86;
  const lift = progress < .6 ? 0 : Math.sin(swing * Math.PI) * 17;
  const angle = Math.atan2(-dx, 260) * 180 / Math.PI * amplitude;
  return `translate(0 ${(-lift * 1.17 * amplitude).toFixed(3)}) rotate(${angle.toFixed(3)} ${root[0]} ${root[1]})`;
}
