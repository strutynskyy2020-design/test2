import { CONFIG, PHYSICS, TEST_LEVEL, createDrive, getLevel, getUpgradeStats, stepDrive, replay, summarize, captureDrive, interpolateDrive, terrain, surfaceFriction, ReplayValidationError } from './engine';
const {
  flatLevel,
  runTicks,
  controlledRun
} = require('./physicsTestHelpers.cjs');
describe('Pixel Drive rigid-body physics', () => {
  test('three real bodies and two independent WheelJoints', () => {
    const s = createDrive(flatLevel()),
      f = s._physics;
    expect(f.chassis.getMass()).toBe(828);
    for(const wheel of f.wheels) expect(wheel.getMass()).toBeCloseTo(36,10);
    expect(f.wheels[0].getInertia()).toBeCloseTo(36 * .46 * .46 / 2, 8);
    expect(f.joints.map(j => j.getType())).toEqual(['wheel-joint', 'wheel-joint']);
    expect(Object.keys(s)).not.toContain('_physics');
  });
  test('rest settles at 30–40% sag and 55/45 loading without spontaneous motion', () => {
    const l = flatLevel(),
      s = createDrive(l);
    runTicks(l, s, 360);
    const x = s.x,
      y = s.y;
    runTicks(l, s, 240);
    for (const w of s.wheels) {
      expect(w.compression / w.travel).toBeGreaterThan(.30);
      expect(w.compression / w.travel).toBeLessThan(.40);
      expect(w.grounded).toBe(true);
    }
    expect(s.wheels[0].normalLoad / (s.wheels[0].normalLoad + s.wheels[1].normalLoad)).toBeCloseTo(.55, 1);
    expect(Math.abs(s.x - x)).toBeLessThan(.001);
    expect(Math.abs(s.y - y)).toBeLessThan(.001);
    expect(Math.hypot(s.vx, s.vy)).toBeLessThan(.001);
    expect(Math.abs(s.av)).toBeLessThan(.001);
    expect(s.wheels[0].effectiveMass).toBeLessThan(35);
  });
  test('0.2m bump raises front before rear while body responds by inertia', () => {
    const l = flatLevel({
        terrain: [[-100, 0], [20, 0], [21, .2], [22, 0], [1200, 0]]
      }),
      s = createDrive(l, undefined, {
        x: 16,
        vx: 3,
        wheelOmega: -3 / .45
      });
    let front = -1,
      rear = -1,
      angle = 0;
    for (let i = 0; i < 240; i++) {
      stepDrive(l, s, 0);
      if (s.wheels[1].y > .53 && front < 0) {
        front = i;
        angle = s.angle;
      }
      if (s.wheels[0].y > .53 && rear < 0) rear = i;
    }
    expect(front).toBeGreaterThan(0);
    expect(rear - front).toBeGreaterThan(30);
    expect(Math.abs(angle)).toBeLessThan(.12);
    expect(s.status).toBe('playing');
  });
  test('acceleration is gradual and release preserves rolling inertia', () => {
    const l = flatLevel(),
      s = createDrive(l);
    runTicks(l, s, 180);
    stepDrive(l, s, 1);
    expect(s.vx).toBeLessThan(.1);
    runTicks(l, s, 59, 1);
    expect(s.vx).toBeGreaterThan(2);
    expect(s.vx).toBeLessThan(3.5);
    expect(Math.abs(s.angle)).toBeLessThan(.2);
    runTicks(l, s, 240, 1);
    const v = s.vx;
    runTicks(l, s, 120, 0);
    expect(s.vx).toBeGreaterThan(v * .85);
    expect(s.vx).toBeLessThan(v);
    expect(s.status).toBe('playing');
  });
  test('upgraded torque overcomes a slope that defeats the same baseline vehicle', () => {
    const slope = Math.tan(Math.PI / 9),
      l = flatLevel({
        linearTerrain: true,
        terrain: [[-100, -100 * slope], [1200, 1200 * slope]]
      }),
      s = createDrive(l, {engine: 3}, {
        angle: Math.PI / 9,
        y: terrain(l, 9) + 1.45
      });
    runTicks(l, s, 600, 1);
    expect(s.x).toBeGreaterThan(45);
    expect(s.vx).toBeGreaterThan(4);
    expect(s.status).toBe('playing');
    const base = createDrive(l, undefined, {angle: Math.PI / 9, y: terrain(l, 9) + 1.45});
    runTicks(l, base, 600, 1);
    expect(base.x).toBeLessThan(9);
    expect(summarize(l, base).analysis.some(note => note.type === 'engine')).toBe(true);
  });
  test('brake slows before delayed reverse; simultaneous pedals never reverse', () => {
    const l = flatLevel(),
      s = createDrive(l, undefined, {
        vx: 12,
        wheelOmega: -12 / .45
      });
    runTicks(l, s, 120, 0);
    const before = s.vx;
    stepDrive(l, s, 2);
    expect(s.vx).toBeGreaterThan(0);
    expect(s.vx).toBeLessThan(before);
    expect(s.mode).toBe('brake');
    while (s.vx > .3 && s.tick < 600) stepDrive(l, s, 2);
    for (let i = 0; i < 5; i++) {
      stepDrive(l, s, 2);
      expect(s.mode).toBe('brake');
    }
    runTicks(l, s, 60, 2);
    expect(s.mode).toBe('reverse');
    expect(s.vx).toBeLessThan(-.5);
    const both = createDrive(l);
    runTicks(l, both, 600, 3);
    expect(both.mode).toBe('brake');
    expect(Math.abs(both.vx)).toBeLessThan(.01);
  });
  test('different air pedals preserve identical total COM ballistic trajectories', () => {
    const l = flatLevel(),
      states = [0, 1, 2, 3].map(() => createDrive(l, undefined, {
        y: 100,
        vx: 8,
        vy: 3,
        physics: {
          airDrag: 0,
          rollingResistance: 0,
          airAngularDamping: 0
        }
      }));
    states.forEach((s, input) => runTicks(l, s, 60, input));
    const neutral = states[0].diagnostics.com;
    for (const s of states) {
      expect(s.grounded).toBe(0);
      for (const key of ['x', 'y', 'vx', 'vy']) expect(s.diagnostics.com[key]).toBeCloseTo(neutral[key], 8);
    }
    expect(states[1].angle).toBeGreaterThan(1);
    expect(states[2].angle).toBeLessThan(-1);
    expect(states[3].angle).toBeCloseTo(states[0].angle, 10);
    expect(neutral.vy).toBeCloseTo(3 - 9.81, 8);
    expect(states[1].wheels[0].av).toBeLessThan(-states[1]._physics.stats.driveOmega * .8);
  });
  test('rotation coasts; opposite pedal first slows it; soft limit never clamps velocity', () => {
    const l = flatLevel(),
      s = createDrive(l, undefined, {
        y: 100
      });
    runTicks(l, s, 30, 1);
    const av = s.av;
    runTicks(l, s, 10, 0);
    expect(s.av).toBeGreaterThan(av * .95);
    expect(s.av).toBeGreaterThan(0);
    stepDrive(l, s, 2);
    expect(s.av).toBeGreaterThan(0);
    expect(s.av).toBeLessThan(av);
    runTicks(l, s, 45, 2);
    expect(s.av).toBeLessThan(0);
    const fast = createDrive(l, undefined, {
      y: 100,
      av: 6
    });
    stepDrive(l, fast, 1);
    expect(fast.av).toBeGreaterThan(5.5);
  });
  test('one metre landing compresses, bounces once, settles without tunnelling', () => {
    const l = flatLevel(),
      s = createDrive(l, undefined, {
        y: 2.275
      });
    let compression = 0,
      bounces = 0,
      lastVy = -1,
      minWheel = 100;
    for (let i = 0; i < 360; i++) {
      stepDrive(l, s, 0);
      compression = Math.max(compression, ...s.wheels.map(w => w.compression));
      minWheel = Math.min(minWheel, ...s.wheels.map(w => w.y));
      if (s.vy > .1 && lastVy <= .1) bounces++;
      lastVy = s.vy;
    }
    expect(compression).toBeGreaterThan(.38);
    expect(compression).toBeLessThan(.6);
    expect(bounces).toBe(1);
    expect(minWheel).toBeGreaterThan(.42);
    expect(Math.abs(s.vy)).toBeLessThan(.001);
    expect(s.status).toBe('playing');
  });
  test('progressive travel stops safely limit a two metre landing', () => {
    const l = flatLevel(),
      s = createDrive(l, undefined, {
        y: 3.275
      });
    let maximum = 0;
    for (let i = 0; i < 600; i++) {
      stepDrive(l, s, 0);
      maximum = Math.max(maximum, ...s.wheels.map(w => w.compression));
    }
    expect(maximum).toBeGreaterThan(PHYSICS.travelMax - PHYSICS.stopZone);
    expect(maximum).toBeLessThan(.65);
    expect(Math.abs(s.vy)).toBeLessThan(.001);
  });
  test('ice gives wheelspin, weaker acceleration, and longer braking distance', () => {
    const metrics = {};
    for (const surface of ['dirt', 'ice']) {
      const l = flatLevel({
          surface
        }),
        a = createDrive(l);
      runTicks(l, a, 180, 1);
      const s = createDrive(l, undefined, {
        vx: 12,
        wheelOmega: -12 / .45
      });
      runTicks(l, s, 120, 0);
      const x = s.x;
      while (s.vx > .3 && s.tick < 900) stepDrive(l, s, 2);
      metrics[surface] = {
        distance: s.x - x,
        v: a.vx,
        slip: Math.max(...a.wheels.map(w => Math.abs(w.slip)))
      };
    }
    expect(metrics.ice.distance).toBeGreaterThan(metrics.dirt.distance * 2.5);
    expect(metrics.ice.v).toBeLessThan(metrics.dirt.v * .8);
    expect(metrics.ice.slip).toBeGreaterThan(metrics.dirt.slip + 3);
    expect(surfaceFriction(flatLevel({
      surface: 'ice'
    }), 0)).toBe(.12);
  });
  test('30m/s crosses connected half-metre seams without hidden edge impacts', () => {
    const l = flatLevel(),
      s = createDrive(l, undefined, {
        vx: 30,
        wheelOmega: -30 / .45
      });
    runTicks(l, s, 180, 0);
    let min = 100,
      max = 0;
    for (let i = 0; i < 240; i++) {
      stepDrive(l, s, 0);
      min = Math.min(min, s.vx);
      max = Math.max(max, Math.abs(s.vy));
    }
    expect(s.x).toBeGreaterThan(200);
    expect(min).toBeGreaterThan(26);
    expect(max).toBeLessThan(.01);
    expect(s.status).toBe('playing');
  });
  test('30/60/120 display FPS give identical fixed-tick states and interpolation never mutates physics', () => {
    const l = flatLevel(),
      outputs = [];
    for (const fps of [30, 60, 120]) {
      const s = createDrive(l);
      let accumulator = 0,
        previous = captureDrive(s);
      for (let frame = 0; frame < fps * 5; frame++) {
        accumulator += 1 / fps;
        while (accumulator + 1e-10 >= PHYSICS.fixedDt) {
          previous = captureDrive(s);
          stepDrive(l, s, s.tick < 120 ? 1 : s.tick < 180 ? 0 : s.tick < 220 ? 2 : 0);
          accumulator -= PHYSICS.fixedDt;
        }
        interpolateDrive(previous, captureDrive(s), accumulator / PHYSICS.fixedDt);
      }
      expect(s.tick).toBe(300);
      outputs.push(captureDrive(s));
    }
    expect(outputs[0]).toEqual(outputs[1]);
    expect(outputs[1]).toEqual(outputs[2]);
  });
  test('interpolated colliders and centres follow the rendered car without mutating snapshots', () => {
    const l = flatLevel(),
      s = createDrive(l, undefined, {
        y: 10,
        vx: 12
      }),
      a = captureDrive(s);
    stepDrive(l, s, 1);
    const b = captureDrive(s),
      before = JSON.stringify(b),
      view = interpolateDrive(a, b, .5);
    expect(view.diagnostics.com.x).toBe((a.diagnostics.com.x + b.diagnostics.com.x) / 2);
    expect(view.diagnostics.colliders[1].x).toBe(view.wheels[0].x);
    expect(view.diagnostics.colliders[0].vertices[0].y).toBe((a.diagnostics.colliders[0].vertices[0].y + b.diagnostics.colliders[0].vertices[0].y) / 2);
    expect(JSON.stringify(b)).toBe(before);
  });
  test('head contact ends a run but inverted airborne angle alone does not', () => {
    const l = flatLevel(),
      safe = createDrive(l, undefined, {
        y: 50,
        angle: Math.PI
      });
    runTicks(l, safe, 30, 0);
    expect(safe.status).toBe('playing');
    const c = createDrive(l, undefined, {
      y: 1.8,
      angle: Math.PI
    });
    runTicks(l, c, 120, 0);
    expect(c.reason).toBe('overturned');
    expect(c.diagnostics.headContact).toBe(true);
  });
  test('empty fuel can coast over finish', () => {
    const l = flatLevel({
        length: 10,
        meters: 10
      }),
      s = createDrive(l, undefined, {
        x: 18.9,
        y: 2,
        vx: 12,
        wheelOmega: -12 / .45
      });
    s.fuel = 0;
    stepDrive(l, s, 1);
    expect(s.status).toBe('completed');
  });
  test('stationary empty fuel ends run and terminal state remains immutable', () => {
    const l = flatLevel(),
      s = createDrive(l);
    s.fuel = 0;
    runTicks(l, s, 180);
    expect(s.reason).toBe('fuel');
    const before = JSON.stringify(s);
    stepDrive(l, s, 1);
    expect(JSON.stringify(s)).toBe(before);
  });
  test('pickups are force-free and indices are unique for every fixed stage', () => {
    const l = flatLevel(),
      p = {
        ...l,
        gears: [9],
        fuel: [9]
      },
      a = createDrive(l),
      b = createDrive(p);
    stepDrive(l, a, 0);
    stepDrive(p, b, 0);
    for (const key of ['x', 'y', 'vx', 'vy', 'angle', 'av']) expect(a[key]).toBe(b[key]);
    expect(b.gears).toEqual([0]);
    expect(b.cans).toEqual([0]);
    for (const t of CONFIG.levels) {
      expect(new Set(t.gears).size).toBe(t.gears.length);
      expect(t.gears.length).toBeGreaterThan(0);
      expect(t.terrain.every((p, i) => i === 0 || p[0] > t.terrain[i - 1][0])).toBe(true);
      expect(t.length).toBe(t.meters);
    }
  });
  test('tank changes only capacity and suspension upgrades preserve useful sag', () => {
    const l = flatLevel(),
      a = createDrive(l),
      b = createDrive(l, {
        engine: 0,
        suspension: 0,
        tires: 0,
        tank: 10
      });
    runTicks(l, a, 180);
    runTicks(l, b, 180);
    expect(a.diagnostics.com.mass).toBe(b.diagnostics.com.mass);
    expect(a.y).toBe(b.y);
    expect(b.capacity).toBe(80);
    const up = createDrive(l, {
      engine: 0,
      suspension: 10,
      tires: 0,
      tank: 0
    });
    runTicks(l, up, 360);
    for (const w of up.wheels) expect(w.compression / w.travel).toBeGreaterThan(.25);
  });
  test('controlled baseline finishes the tutorial and exact replay agrees', () => {
    const l = getLevel(1),
      {
        state,
        events
      } = controlledRun(l);
    expect(state.status).toBe('completed');
    expect(summarize(l, state).distance).toBe(l.meters);
    expect(replay(l, state.upgrades, events, state.tick)).toEqual(summarize(l, state));
  });
  test('test course is separate and contains prescribed geometry', () => {
    expect(TEST_LEVEL.id).toBe(0);
    expect(CONFIG.levels).not.toContain(TEST_LEVEL);
    expect(terrain(TEST_LEVEL, 21)).toBe(.2);
    expect(terrain(TEST_LEVEL, 70)).toBe(9);
    expect(terrain(TEST_LEVEL, 117)).toBe(7.8);
  });
  test.each([[[[0, 1], [0, 2]], 30], [[[3, 1], [2, 0]], 30], [[[30, 1]], 30], [[[0, 8]], 30], [[[0, true]], 30], [[[-1, 0]], 30]])('rejects malformed events', (events, ticks) => {
    expect(() => replay(getLevel(1), undefined, events, ticks)).toThrow(ReplayValidationError);
  });
  test('unfinished replay requires explicit abandonment', () => {
    const l = getLevel(1);
    expect(() => replay(l, undefined, [], 20)).toThrow('триває');
    expect(replay(l, undefined, [], 20, true).reason).toBe('abandoned');
  });
  test('leaving the start area is distinct from exhausting the clock', () => {
    const level = flatLevel(), state = createDrive(level, undefined, {x: -90.1});
    stepDrive(level, state, 0);
    expect(state.reason).toBe('route_exit');
    expect(state.tick).toBeLessThan(level.max_ticks);
  });
  test('fuel burns one second per second for every pedal and engine profile', () => {
    const l = flatLevel();
    for (const engine of [0, 10]) for (const pedal of [0, 1, 2, 3]) {
      const s = createDrive(l, {engine});
      runTicks(l, s, 300, pedal);
      expect(s.status).toBe('playing');
      expect(s.fuel).toBe(35);
      expect(s.capacity).toBe(40);
    }
  });
  test('empty engine supplies no drive torque but can coast into a full refill and restart', () => {
    const l = flatLevel({fuel: [24]}), s = createDrive(l, {tank: 3}, {vx: 8, wheelOmega: -8 / .45});
    s.fuel = 0;
    stepDrive(l, s, 1);
    expect(s.wheels.every(w => w.driveTorque === 0)).toBe(true);
    expect(s.vx).toBeGreaterThan(7);
    while (!s.cans.length && s.status === 'playing' && s.tick < 240) stepDrive(l, s, 1);
    expect(s.cans).toEqual([0]);
    expect(s.fuel).toBe(52);
    expect(s.status).toBe('playing');
    runTicks(l, s, 30, 1);
    expect(s.wheels.some(w => w.driveTorque > 0)).toBe(true);
    expect(s.fuel).toBe(51.5);
  });
  test('cans are single-use and checkpoints never refill the time budget', () => {
    const l = flatLevel({fuel: [9], checkpoints: [{id: 'near-start', x: 8, reward: 100}]}), s = createDrive(l);
    stepDrive(l, s, 0);
    expect(s.fuel).toBe(40);
    expect(s.checkpoints).toEqual(['near-start']);
    runTicks(l, s, 60);
    expect(s.fuel).toBe(39);
    expect(s.cans).toEqual([0]);
    expect(s.telemetry.checkpoints).toHaveLength(1);
  });
  test('running out of fuel during reverse keeps ground braking available', () => {
    const l = flatLevel(), s = createDrive(l);
    runTicks(l, s, 60, 2);
    expect(s.mode).toBe('reverse');
    expect(s.vx).toBeLessThan(-.3);
    s.fuel = 0;
    stepDrive(l, s, 2);
    expect(s.mode).toBe('brake');
    expect(s.wheels.every(w => w.driveTorque === 0)).toBe(true);
    expect(s.wheels.some(w => w.brakeTorque > 0)).toBe(true);
    runTicks(l, s, 45, 2);
    expect(Math.abs(s.vx)).toBeLessThan(.3);
    expect(s._physics.reverse).toBe(false);
  });
  test('empty fuel keeps both directions of airborne control available', () => {
    const l = flatLevel();
    for (const pedal of [1, 2]) {
      const s = createDrive(l, undefined, {y: 30});
      s.fuel = 0;
      runTicks(l, s, 18, pedal);
      expect(s.grounded).toBe(0);
      expect(s.wheels.every(w => w.driveTorque === 0)).toBe(true);
      expect(s.av * (pedal === 1 ? 1 : -1)).toBeGreaterThan(.5);
    }
  });
  test('run coins have configured value and cannot be collected twice while stationary', () => {
    const l = flatLevel({gears: [9], coinValues: [25]}), s = createDrive(l);
    runTicks(l, s, 180);
    expect(s.gears).toEqual([0]);
    expect(s.coinValue).toBe(25);
    expect(summarize(l, s).coinValue).toBe(25);
    expect(summarize(l, s).analysis).toEqual([]);
    const again = createDrive(l); stepDrive(l, again, 0);
    expect(again.coinValue).toBe(25);
  });
  test('stats describe actual zero-to-ten component changes and reject invalid upgrades', () => {
    expect(getUpgradeStats().fuelSeconds).toBe(40);
    const u = {engine: 10, suspension: 10, tires: 10, tank: 10}, stats = getUpgradeStats(u), s = createDrive(flatLevel(), u);
    expect(stats.fuelSeconds).toBe(s.capacity);
    expect(stats.torqueNm).toBeCloseTo(4400, 9);
    expect(stats.gripMultiplier).toBe(1.4);
    expect(s.wheels[0].travel).toBeCloseTo(stats.suspension.travel, 12);
    expect(s.wheels.map(w => w.springK)).toEqual(stats.suspension.stiffness);
    expect(s.wheels.map(w => w.springC)).toEqual(stats.suspension.damping);
    expect(() => createDrive(flatLevel(), {engine: 11})).toThrow(ReplayValidationError);
    expect(() => createDrive(flatLevel(), {tank: -1})).toThrow(ReplayValidationError);
  });
});
