import { getRoomLayers } from "./petRoom";

const inside = (p, r) => p.x > r.left && p.x < r.right && p.y > r.top && p.y < r.bottom;
export function roomObstacles(snapshot, from, to, zone) {
  return getRoomLayers(snapshot).filter((item) => ["bed", "decor", "bowl", "toy"].includes(item.room.slot || item.slot) && (item.room.slot || item.slot) !== zone).map((item) => {
    const { x, y, width } = item.room;
    const radius = width * (item.slot === "bed" ? .33 : .22) + 3;
    return { left: x - radius, right: x + radius, top: y - (item.slot === "bed" ? 8 : 5), bottom: y + 3 };
  }).filter((r) => !inside(from, r) && !inside(to, r)); // Climb off / approach the target furniture.
}
export function clearRoomSegment(a, b, obstacles) {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
  for (let i = 0; i <= steps; i++) {
    const p = { x: a.x + (b.x - a.x) * i / steps, y: a.y + (b.y - a.y) * i / steps };
    if (obstacles.some((r) => inside(p, r))) return false;
  }
  return true;
}
export function catWalkPath(snapshot, from, to, zone) {
  const obstacles = roomObstacles(snapshot, from, to, zone);
  if (clearRoomSegment(from, to, obstacles)) return [from, to];
  const points = [from, to, ...obstacles.flatMap((r) => [
    { x: r.left - 1, y: r.top - 1 }, { x: r.right + 1, y: r.top - 1 },
    { x: r.left - 1, y: r.bottom + 1 }, { x: r.right + 1, y: r.bottom + 1 },
  ]).filter((p) => p.x >= 24 && p.x <= 76 && p.y >= 58 && p.y <= 92 && !obstacles.some((r) => inside(p, r)))];
  const distance = points.map(() => Infinity), previous = [], visited = new Set(); distance[0] = 0;
  for (let count = 0; count < points.length; count++) {
    let best = -1;
    points.forEach((_, i) => { if (!visited.has(i) && (best < 0 || distance[i] < distance[best])) best = i; });
    if (best < 0 || !Number.isFinite(distance[best])) break;
    if (best === 1) {
      const route = []; for (let i = 1; i !== undefined; i = previous[i]) route.unshift(points[i]);
      return route;
    }
    visited.add(best);
    points.forEach((p, i) => {
      const next = distance[best] + Math.hypot(p.x - points[best].x, p.y - points[best].y);
      if (!visited.has(i) && next < distance[i] && clearRoomSegment(points[best], p, obstacles)) { distance[i] = next; previous[i] = best; }
    });
  }
  return [from, from]; // A blocked layout never makes the cat walk through a prop.
}
