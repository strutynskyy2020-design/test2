export const pointInScene = (point, rect) => ({ x: (point.x - rect.left) / rect.width * 100, y: (point.y - rect.top) / rect.height * 100 });
export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
export function petTouchZone(point, rect) {
  if (!rect?.width || !rect?.height) return "head";
  const p = pointInScene(point, rect);
  return p.y < 48 ? "head" : p.x < 33 ? "back" : "belly";
}
export function dirtSpots(cleanliness = 100, mess = false) {
  const count = mess ? 6 : cleanliness > 92 ? 0 : clamp(Math.ceil((100 - cleanliness) / 15), 1, 6);
  return [{ x: 24, y: 65 }, { x: 70, y: 77 }, { x: 47, y: 85 }, { x: 33, y: 76 }, { x: 81, y: 66 }, { x: 60, y: 62 }]
    .slice(0, count).map((p, id) => ({ ...p, id, radius: 5, remaining: 1 }));
}
function distanceToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
export function scrubDirt(spots, from, to) {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  if (distance < .4) return spots;
  return spots.map((spot) => distanceToSegment(spot, from, to) <= spot.radius + 2
    ? { ...spot, remaining: Math.max(0, spot.remaining - Math.min(.48, distance / 30)) } : spot);
}
export const dirtIsClean = (spots) => spots.length > 0 && spots.every((spot) => spot.remaining <= .01);

export function throwBall(point, velocity) {
  return { x: clamp(point.x, 9, 91), y: clamp(point.y, 58, 87), vx: clamp(velocity.x, -80, 80), vy: clamp(velocity.y, -45, 45), rotation: 0, bounces: 0, distance: 0, elapsed: 0, stopped: false };
}
export function stepBall(ball, seconds, catPosition) {
  const dt = clamp(seconds, 0, .04);
  let { x, y, vx, vy, bounces, rotation, distance, elapsed } = ball;
  const dx = vx * dt, dy = vy * dt;
  x += dx; y += dy; distance += Math.hypot(dx, dy); elapsed += dt;
  if (x < 9 || x > 91) { x = clamp(x, 9, 91); vx *= -.78; bounces++; }
  if (y < 58 || y > 87) { y = clamp(y, 58, 87); vy *= -.72; bounces++; }
  rotation += dx * 8;
  const drag = Math.exp(-.65 * dt);
  vx *= drag; vy *= drag;
  const caught = elapsed > .35 && catPosition && Math.hypot(x - catPosition.x, y - catPosition.y) < 11;
  const stopped = Boolean(caught || elapsed >= 4 || elapsed > .6 && Math.hypot(vx, vy) < 3);
  return { x, y, vx, vy, bounces, rotation, distance, elapsed, caught: Boolean(caught), stopped };
}
export function wandReady(gesture, now) {
  return gesture.distance >= 100 && gesture.directionChanges >= 2 && now - gesture.startedAt >= 600;
}
