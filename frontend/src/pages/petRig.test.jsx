import { createRigMotion, setRigPath, advanceRigMotion, solveLeg, rigFrame, rigFootStep, poseWeights, blendRigPose, safeRigTarget, RIG_PARTS } from "./petRig";

const run = (fps, seconds = 1) => {
  const m = createRigMotion({ x: 25, y: 80 }); setRigPath(m, [{ x: 25, y: 80 }, { x: 75, y: 80 }]);
  for (let i = 0; i < fps * seconds; i++) advanceRigMotion(m, 1 / fps);
  return m;
};
test("same skeleton textures are shared by all animations", () => {
  expect(RIG_PARTS).toHaveLength(12);
  expect(RIG_PARTS).not.toContain("walk-a");
});
test("walk uses elapsed time, not the display refresh rate", () => {
  const slow = run(30), normal = run(60), fast = run(120);
  expect(Math.abs(slow.position.x - fast.position.x)).toBeLessThan(.3);
  expect(Math.abs(normal.position.x - fast.position.x)).toBeLessThan(.15);
});
test("retargeting preserves position, gait phase and accumulated travel", () => {
  const m = run(60), { phase, distance } = m, position = { ...m.position };
  setRigPath(m, [position, { x: 35, y: 64 }]);
  expect(m.phase).toBe(phase); expect(m.distance).toBe(distance); expect(m.position).toEqual(position);
});
test("touch, hidden tab and modal pauses cannot teleport or advance footsteps", () => {
  const m = run(60), position = { ...m.position }, phase = m.phase;
  for (let i = 0; i < 120; i++) advanceRigMotion(m, 1 / 60, { paused: true });
  expect(m.position).toEqual(position); expect(m.phase).toBe(phase);
  advanceRigMotion(m, 1 / 60);
  expect(Math.hypot(m.position.x - position.x, m.position.y - position.y)).toBeLessThan(.1);
});
test("vertical motion also produces steps, and stop does not walk in place", () => {
  const m = createRigMotion({ x: 50, y: 82 }); setRigPath(m, [{ x: 50, y: 82 }, { x: 50, y: 64 }]);
  for (let i = 0; i < 20; i++) advanceRigMotion(m, 1 / 60);
  expect(m.phase).toBeGreaterThan(0); expect(m.walk).toBeGreaterThan(0);
  for (let i = 0; i < 300; i++) advanceRigMotion(m, 1 / 60);
  expect(m.position).toEqual({ x: 50, y: 64 });
  const phase = m.phase;
  for (let i = 0; i < 120; i++) advanceRigMotion(m, 1 / 60);
  expect(m.phase).toBe(phase); expect(m.walk).toBeLessThan(.01);
});
test("large resume delta is bounded and waypoints never overshoot", () => {
  const m = createRigMotion({ x: 25, y: 80 }); setRigPath(m, [{ x: 25, y: 80 }, { x: 25.01, y: 80 }, { x: 28, y: 75 }]);
  advanceRigMotion(m, 300);
  expect(m.distance).toBeLessThan(1);
  for (let i = 0; i < 300; i++) advanceRigMotion(m, 1 / 60);
  expect(m.position).toEqual({ x: 28, y: 75 });
  expect(safeRigTarget({ x: -999, y: 1000 })).toEqual({ x: 24, y: 92 });
});
test.each([[0, 110], [30, 90], [-30, 70]])("two-bone leg reaches (%s, %s) without changing limb length", (x, y) => {
  const angles = solveLeg(x, y), a = angles.upper * Math.PI / 180, b = (angles.upper + angles.lower) * Math.PI / 180;
  expect(-Math.sin(a) * 59 - Math.sin(b) * 56).toBeCloseTo(x, 4);
  expect(Math.cos(a) * 59 + Math.cos(b) * 56).toBeCloseTo(y, 4);
});
test("stance foot counteracts ground travel; swing lifts and returns continuously", () => {
  const a = rigFootStep(.1 * Math.PI * 2), b = rigFootStep(.2 * Math.PI * 2);
  expect(a.lift).toBe(0); expect(b.lift).toBe(0);
  expect(b.x - a.x).toBeCloseTo(-7.2);
  expect(rigFootStep(.8 * Math.PI * 2).lift).toBeGreaterThan(16);
  expect(Math.abs(rigFootStep(Math.PI * 2 - .00001).x - rigFootStep(0).x)).toBeLessThan(.01);
});
test.each(["idle", "sleep", "eat", "clean", "purr", "refuse", "sniff", "pounce", "tired", "yawn"])("%s retains head scale, finite bones and hit targets", sequence => {
  for (let i = 0; i < 30; i++) {
    const frame = rigFrame({ time: i / 7, phase: i / 3, walk: sequence === "idle" ? 1 : 0, weights: poseWeights(sequence) });
    expect(frame.transforms.head.sx).toBe(1); expect(frame.transforms.head.sy).toBe(1);
    Object.values(frame.transforms).forEach(bone => Object.values(bone).forEach(n => expect(Number.isFinite(n)).toBe(true)));
    expect(frame.touches.head[1]).toBeGreaterThanOrEqual(0);
    expect(frame.touches.head[1] + frame.touches.head[3]).toBeLessThanOrEqual(100);
  }
});
test("sleep and reaction transitions blend, rather than snap to new proportions", () => {
  const weights = poseWeights("idle"), before = rigFrame({ weights });
  blendRigPose(weights, "sleep", 1 / 60);
  const after = rigFrame({ weights });
  expect(weights.sleep).toBeGreaterThan(0); expect(weights.sleep).toBeLessThan(.1);
  expect(after.transforms.head.y - before.transforms.head.y).toBeLessThan(7);
});
