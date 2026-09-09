import { careHint, sleepHint } from "./petCareView";
import { catTouchAreas } from "./PetCatSprite";
import { dirtSpots } from "./petGestures";
import { livingCatOffset, livingSceneState } from "./petLivingState";
import { catWalkPath, clearRoomSegment, roomObstacles } from "./petNavigation";

const now = Date.parse("2026-09-07T09:00:00Z");
const snapshot = () => ({ pet: { name: "Піксель", trust: 7, stats: { energy: 70, health: 100, satiety: 70, mood: 75, cleanliness: 85 }, survival: { status: "alive" }, inventory: { items: [], equipped: {} } }, life: { sleep: { active: false }, scene_marks: [] }, catalog: { items: [] } });
test.each([80, 85, 90, 92])("cleaning has actual stains at cleanliness %s", (cleanliness) => {
  const s = snapshot(); s.pet.stats.cleanliness = cleanliness;
  expect(dirtSpots(cleanliness).length).toBeGreaterThan(0);
  expect(careHint(s, "clean", now).blocked).not.toBe(true);
});
test("no misleading scrub instruction in a clean room; mess remains actionable", () => {
  const s = snapshot(); s.pet.stats.cleanliness = 100;
  expect(careHint(s, "clean", now).blocked).toBe(true);
  s.life.scene_marks = [{ kind: "mess" }];
  expect(careHint(s, "clean", now).blocked).not.toBe(true);
});
test("unsafe belly stays hidden and walking head touch area mirrors with the art", () => {
  expect(catTouchAreas("idle", false).belly).toBeUndefined();
  expect(catTouchAreas("idle", true).belly).toBeDefined();
  expect(catTouchAreas("walk-left", true).belly).toBeUndefined();
  const left = catTouchAreas("walk-left").head, right = catTouchAreas("walk-right").head;
  expect(right[0]).toBe(100 - left[0] - left[2]);
  expect(right.slice(1)).toEqual(left.slice(1));
  expect(catTouchAreas("eat").head[1]).toBeGreaterThan(catTouchAreas("idle").head[1]);
  expect(catTouchAreas("sleep").head[1]).toBeGreaterThan(catTouchAreas("eat").head[1]);
});
test("hints explain waiting and exhausted daily budget without blocking harmless play", () => {
  const s = snapshot(); s.care_availability = { pet: { ready_at: new Date(now + 45000).toISOString() } };
  expect(careHint(s, "pet", now)).toMatchObject({ waiting: true });
  expect(careHint(s, "pet", now + 60000).waiting).toBeUndefined();
  s.care_availability.pet.limited_today = true;
  expect(careHint(s, "pet", now)).toMatchObject({ limited: true });
  s.pet.survival.mood_state = "do_not_touch";
  expect(careHint(s, "pet", now).blocked).toBe(true);
});
test("sleep hints use server timestamps and urgent food remains available", () => {
  const s = snapshot(); s.life.sleep = { active: true, started_at: new Date(now - 60000).toISOString(), ends_at: new Date(now + 3600000).toISOString() };
  expect(sleepHint(s, now)).toContain("Не буди зарано");
  expect(careHint(s, "play", now).blocked).toBe(true);
  s.pet.stats.satiety = 10;
  expect(careHint(s, "feed", now).blocked).not.toBe(true);
});
test("moved bowl changes both coordinates of the feeding target", () => {
  const s = snapshot(); s.catalog.items = [{ id: "bowl", slot: "bowl", room: { asset: "b.webp", x: 15, y: 79, width: 22 } }]; s.pet.inventory = { items: ["bowl"], equipped: { bowl: "bowl" } }; s.pet.room_layout = { bowl: { x: 30, y: 85 } };
  expect(livingCatOffset(s, { x: 50, y: 81, width: 44 }, "bowl", "eat")).toEqual({ x: -1, y: 4 });
});
test("remembered props trigger behaviour, but sleep wins over every event", () => {
  const s = snapshot(); s.life.scene_marks = [{ kind: "box" }];
  expect(livingSceneState(s, now, { inspecting: { kind: "box" } })).toMatchObject({ reaction: "sniff", target: { x: 33, y: 85 } });
  s.life.sleep.active = true;
  expect(livingSceneState(s, now, { inspecting: { kind: "box" } }).pose).toBe("sleep");
});
test("cat walks around furniture without intersecting its ground footprint", () => {
  const s = snapshot(); s.catalog.items = [{ id: "plant", slot: "decor", room: { asset: "p.webp", x: 50, y: 77, width: 20 } }]; s.pet.inventory = { items: ["plant"], equipped: { decor: "plant" } };
  const from = { x: 25, y: 75 }, to = { x: 75, y: 75 }, obstacles = roomObstacles(s, from, to);
  const route = catWalkPath(s, from, to);
  expect(route.length).toBeGreaterThan(2);
  expect(route.at(-1)).toEqual(to);
  route.slice(1).forEach((p, i) => expect(clearRoomSegment(route[i], p, obstacles)).toBe(true));
});
