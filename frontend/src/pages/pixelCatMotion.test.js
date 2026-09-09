import { pose, walkLeg, walkFacing, WALK_CYCLE, WALK_SUPPORT, WALK_LEGS, walkFoot, walkLegFrame, plantedWalkTarget, rememberWalkContact } from './pixelCatMotion';
import { createCatTransition, stepCatTransition, actionVisualMode } from './pixelCatChoreography';
import manifest from '@/assets/pixelCatManifest.json';
test('pose transitions never make every layer invisible', () => {
  const state = createCatTransition('sit');
  for (const mode of ['walk', 'eat', 'sleep', 'sit', 'walk']) for (let i = 0; i < 120; i++) {
    const weights = stepCatTransition(state, mode, 1 / 60);
    expect(Object.values(weights).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 7);
    expect(Object.values(weights).every(v => v >= 0 && v <= 1)).toBe(true);
  }
});
test('quiet mode draws the requested pose immediately; zero dt preserves transition', () => {
  const state = createCatTransition('sit');
  stepCatTransition(state, 'sleep', 0); expect(state.weights.sit).toBe(1);
  stepCatTransition(state, 'sleep', 0, true); expect(state.weights).toEqual({ sit: 0, sleep: 1, eat: 0, walk: 0, rise: 0, groom: 0 });
  expect(actionVisualMode('walk-right')).toBe('walk'); expect(actionVisualMode('purr')).toBe('sit');
});
test('all new textures are web-sized, share a master, and have valid bounds', () => {
  expect(manifest.anchorSha256).toBe('cfd77f139886e4c541611d5684dd63cb74c7dcbbb8f4db15ce019fa5f54afc72');
  expect(manifest.totalBytes).toBeLessThan(350 * 1024);
  expect(manifest.parts['sit-head'].rect).toEqual(manifest.parts['sit-head-closed'].rect);
  Object.values(manifest.parts).forEach(part => { expect(Math.max(...part.pixels)).toBeLessThanOrEqual(640); expect(part.rect.every(Number.isFinite)).toBe(true); });
});
test('joint transforms and seated reactions remain finite for long sessions', () => {
  for (let t = 0; t < 3600; t += .125) {
    expect(walkLeg(t, [648, 1045])).not.toMatch(/NaN|Infinity/);
    expect(Object.values(pose(t)).every(Number.isFinite)).toBe(true);
  }
});

test('the outgoing walk pose does not flip when the cat sits down or falls asleep', () => {
  let facing = walkFacing('walk-right');
  for (const sequence of ['idle', 'sleep', 'eat', 'purr']) {
    facing = walkFacing(sequence, facing);
    expect(facing).toBe(1);
  }
  expect(walkFacing('walk-left', facing)).toBe(-1);
  expect(walkFacing('idle')).toBe(-1);
});

const apply = (matrix, [x, y]) => [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]];
test.each([-1, 1])('support paws stay at the same screen point facing %s, including acceleration and depth travel', facing => {
  const leg = WALK_LEGS['fore-near'];
  for (const direction of [{ x: -1, y: 0 }, { x: -.8, y: .6 }, { x: 0, y: -1 }]) {
    const phase = .12 * Math.PI * 2, distance = 19;
    const a = walkLegFrame(leg, phase, { direction, bodyY: -3 });
    const b = walkLegFrame(leg, phase + distance / WALK_CYCLE * Math.PI * 2, { direction, bodyY: 2 });
    const first = apply(a.paw, leg.ankle), next = apply(b.paw, leg.ankle);
    expect((next[0] + distance * direction.x) * facing).toBeCloseTo(first[0] * facing, 8);
    expect(next[1] + distance * direction.y).toBeCloseTo(first[1], 8);
    expect(a.contact.planted && b.contact.planted).toBe(true);
    expect(a.paw.slice(0, 4)).toEqual([1, 0, 0, 1]); // Paw stays flat.
  }
});
test('swing lifts the paw and meets support with continuous position and velocity', () => {
  const epsilon = 1e-5, tau = Math.PI * 2;
  for (const boundary of [WALK_SUPPORT, 1]) {
    const a = walkFoot((boundary - epsilon) * tau), b = walkFoot(boundary * tau), c = walkFoot((boundary + epsilon) * tau);
    expect(a.x).toBeCloseTo(c.x, 2);
    expect((b.x - a.x) / epsilon).toBeCloseTo((c.x - b.x) / epsilon, 0);
    expect(a.lift).toBeCloseTo(0, 5); expect(c.lift).toBeCloseTo(0, 5);
  }
  expect(walkFoot((WALK_SUPPORT + (1 - WALK_SUPPORT) / 2) * tau).lift).toBe(34);
});
test('bent texture strips keep their seams connected and preserve the neutral artwork', () => {
  for (const leg of Object.values(WALK_LEGS)) {
    const neutral = walkLegFrame(leg, 0, { stride: 0 });
    for (const part of ['upper', 'lower', 'paw']) neutral[part].forEach((value, index) => expect(value).toBeCloseTo([1, 0, 0, 1, 0, 0][index], 8));
    for (let phase = 0; phase < Math.PI * 2; phase += .08) {
      const frame = walkLegFrame(leg, phase, { bodyY: -4 });
      for (const [one, two, y] of [['upper', 'lower', leg.knee[1]], ['lower', 'paw', leg.ankle[1]]]) {
        for (const x of [0, 800, 1600]) {
          const a = apply(frame[one], [x, y]), b = apply(frame[two], [x, y]);
          expect(a[0]).toBeCloseTo(b[0], 8); expect(a[1]).toBeCloseTo(b[1], 8);
        }
      }
      expect(frame.upper[3]).toBeGreaterThan(.5); expect(frame.lower[3]).toBeGreaterThan(.5);
    }
  }
});

test.each([-1, 1])('a planted foot remains fixed through a path corner facing %s', mirror => {
  const leg = WALK_LEGS['fore-near'];
  let remembered;
  const path = [{ x: 0, y: 0 }, { x: -3, y: 0 }, { x: -6, y: -3 }, { x: -6, y: -7 }];
  let world;
  path.forEach((position, index) => {
    const frame = walkLegFrame(leg, (.1 + index * .02) * Math.PI * 2, { plantedAt: plantedWalkTarget(remembered, position, mirror, true) });
    remembered = rememberWalkContact(frame.contact, position, mirror, true);
    world ||= { x: remembered.x, y: remembered.y };
    expect(remembered.x).toBeCloseTo(world.x, 8); expect(remembered.y).toBeCloseTo(world.y, 8);
  });
  expect(plantedWalkTarget(remembered, path[3], -mirror, true)).toBeUndefined();
  expect(plantedWalkTarget(remembered, path[3], mirror, false)).toBeUndefined();
});
