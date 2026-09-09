/******/ (() => { // webpackBootstrap
/******/ 	var __webpack_modules__ = ({

/***/ 879
(module, __unused_webpack_exports, __webpack_require__) {

// SI units, Y up, continuous counter-clockwise radians. Shared with server replay.
const {
  Vec2,
  World,
  Polygon,
  Circle,
  Chain,
  WheelJoint
} = __webpack_require__(423);
const CONFIG = __webpack_require__(836),
  PHYSICS = __webpack_require__(250),
  TEST_LEVEL = __webpack_require__(428);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const freshUpgrades = () => ({
  engine: 0,
  suspension: 0,
  tires: 0,
  tank: 0
});
function getUpgradeStats(upgrades = freshUpgrades(), physics = PHYSICS) {
  const u = {...freshUpgrades(), ...upgrades}, s = u.suspension;
  return {
    torqueNm: physics.forwardTorque * (1 + .14 * u.engine),
    driveOmega: physics.forwardOmega * (1 + .04 * u.engine),
    gripMultiplier: 1 + .04 * u.tires,
    fuelSeconds: 40 + 4 * u.tank,
    suspension: {
      travel: physics.travelMax - physics.travelMin + .025 * s,
      stiffness: physics.springK.map(k => k / (1 + .018 * s)),
      damping: physics.springC.map(c => c * (1 + .018 * s)),
    },
  };
}
class ReplayValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReplayValidationError';
    this.code = 'INVALID_REPLAY';
  }
}
function getLevel(id) {
  const l = id === 0 ? TEST_LEVEL : CONFIG.levels.find(l => l.id === id);
  if (!l) throw new ReplayValidationError('Невідома траса');
  return l;
}
function terrain(l, x) {
  const p = l.terrain;
  if (x <= p[0][0]) return p[0][1];
  if (x >= p[p.length - 1][0]) return p[p.length - 1][1];
  let a = 0,
    b = p.length - 1;
  while (b - a > 1) {
    const m = Math.floor((a + b) / 2);
    if (p[m][0] <= x) a = m;else b = m;
  }
  const t = (x - p[a][0]) / (p[b][0] - p[a][0]);
  return p[a][1] + (p[b][1] - p[a][1]) * (l.linearTerrain ? t : t * t * (3 - 2 * t));
}
const surfaceAt = (l, x) => (l.surfaces || []).find(s => x >= s.from && x <= s.to)?.kind || l.surface || 'dirt';
const surfaceFriction = (l, x, p = PHYSICS) => p.materials[surfaceAt(l, x)] || p.materials.dirt;
const dot = (a, b) => a.x * b.x + a.y * b.y;
function totalCOM(bodies) {
  let x = 0,
    y = 0,
    vx = 0,
    vy = 0,
    mass = 0;
  for (const b of bodies) {
    const m = b.getMass(),
      p = b.getWorldCenter(),
      v = b.getLinearVelocity();
    mass += m;
    x += p.x * m;
    y += p.y * m;
    vx += v.x * m;
    vy += v.y * m;
  }
  return {
    x: x / mass,
    y: y / mass,
    vx: vx / mass,
    vy: vy / mass,
    mass
  };
}
function buildTerrain(world, l, p) {
  // A single connected chain supplies true neighbouring vertices at every seam.
  // Right-to-left winding exposes the upper/right-hand face toward the vehicle.
  const points = [],
    end = Math.max(l.length + 70, l.terrain[l.terrain.length - 1][0]);
  for (let x = -100; x <= end; x += p.terrainStep) points.push(Vec2(x, terrain(l, x)));
  points.reverse();
  const road = world.createBody();
  road.createFixture(new Chain(points, false), {
    friction: 1,
    restitution: p.restitution,
    userData: {
      kind: 'road'
    }
  });
}
function readContacts(s) {
  const f = s._physics,
    contacts = [],
    support = [false, false];
  let head = false;
  for (let c = f.world.getContactList(); c; c = c.getNext()) {
    if (!c.isTouching() || !c.isEnabled()) continue;
    const a = c.getFixtureA().getUserData() || {},
      b = c.getFixtureB().getUserData() || {};
    if (a.kind === 'head' && b.kind === 'road' || b.kind === 'head' && a.kind === 'road') {
      head = true;
      continue;
    }
    const wheel = a.kind === 'wheel' ? a : b.kind === 'wheel' ? b : null;
    if (!wheel || a.kind !== 'road' && b.kind !== 'road') continue;
    const m = c.getWorldManifold(null);
    if (!m) continue;
    const sign = a.kind === 'wheel' ? -1 : 1,
      nx = m.normal.x * sign,
      ny = m.normal.y * sign;
    if (ny > .12) support[wheel.index] = true;
    for (let i = 0; i < c.getManifold().pointCount; i++) contacts.push({
      x: m.points[i].x,
      y: m.points[i].y,
      nx,
      ny,
      wheel: wheel.index
    });
  }
  return {
    contacts,
    support,
    head
  };
}
function updateState(s) {
  const f = s._physics,
    p = f.p,
    b = f.chassis,
    pos = b.getPosition(),
    v = b.getLinearVelocity(),
    contact = readContacts(s);
  s.x = pos.x;
  s.y = pos.y;
  s.vx = v.x;
  s.vy = v.y;
  s.angle = b.getAngle();
  s.av = b.getAngularVelocity();
  s.grounded = contact.support.filter(Boolean).length;
  s.wheels = f.wheels.map((w, i) => {
    const pos = w.getPosition(),
      v = w.getLinearVelocity(),
      a = b.getWorldPoint(Vec2((i ? 1 : -1) * p.wheelbase / 2, p.mountY)),
      omega = w.getAngularVelocity(),
      normal = contact.contacts.find(c => c.wheel === i) || {
        nx: 0,
        ny: 1
      };
    return {
      x: pos.x,
      y: pos.y,
      vx: v.x,
      vy: v.y,
      angle: w.getAngle(),
      av: omega,
      radius: p.wheelRadius,
      grounded: contact.support[i],
      anchorX: a.x,
      anchorY: a.y,
      compression: f.joints[i].getJointTranslation(),
      travel: p.travelMax - p.travelMin,
      travelMin: p.travelMin,
      travelMax: p.travelMax,
      normalLoad: f.loads[i],
      driveTorque: f.driveTorques[i],
      brakeTorque: f.brakeTorques[i],
      slip: -omega * p.wheelRadius - (v.x * normal.ny - v.y * normal.nx),
      springK: f.springs[i].k,
      springC: f.springs[i].c,
      effectiveMass: f.springs[i].mass,
      frequency: f.springs[i].frequency,
      dampingRatio: f.springs[i].dampingRatio
    };
  });
  const h = b.getWorldPoint(Vec2(p.head.x, p.head.y));
  s.diagnostics = {
    com: totalCOM([b, ...f.wheels]),
    chassisCOM: {
      ...b.getWorldCenter()
    },
    contacts: contact.contacts,
    colliders: [{
      type: 'polygon',
      vertices: p.bodyVertices.map(v => ({
        ...b.getWorldPoint(Vec2(...v))
      }))
    }, ...s.wheels.map(w => ({
      type: 'circle',
      x: w.x,
      y: w.y,
      r: w.radius,
      radius: w.radius
    })), {
      type: 'circle',
      x: h.x,
      y: h.y,
      r: p.head.radius,
      radius: p.head.radius,
      sensor: true
    }],
    support: contact.support,
    mode: s.mode,
    airTorque: f.airTorque,
    driveTorque: f.driveTorques.reduce((a, v) => a + v, 0),
    speed: Math.hypot(s.vx, s.vy),
    headContact: contact.head,
    throttle: f.throttle,
    landingImpulse: f.landingImpulse,
    physicsHz: 120
  };
  return contact;
}
function createDrive(l, upgrades = freshUpgrades(), options = {}) {
  const p = {
      ...PHYSICS,
      ...options.physics
    },
    world = new World(Vec2(0, -p.gravity)),
    u = {
      ...freshUpgrades(),
      ...upgrades
    };
  for (const key of CONFIG.parts) if (!Number.isInteger(u[key]) || u[key] < 0 || u[key] > 10) throw new ReplayValidationError('Некоректне покращення');
  const sus = u.suspension, stats = getUpgradeStats(u, p);
  // Matched travel/rate/damping upgrades retain useful sag instead of locking
  // wheels to the chassis. Tank upgrades never modify these masses or shapes.
  p.travelMax += sus * .025;
  p.wheelRestY -= sus * .009;
  const x = options.x ?? 9,
    y = options.y ?? terrain(l, x) + p.wheelRadius - p.wheelRestY,
    angle = options.angle || 0,
    v = Vec2(options.vx || 0, options.vy || 0),
    chassis = world.createDynamicBody({
      position: Vec2(x, y),
      angle,
      bullet: true,
      linearVelocity: v,
      angularVelocity: options.av || 0
    });
  chassis.createFixture(new Polygon(p.bodyVertices.map(v => Vec2(...v))), {
    density: 1,
    friction: .4,
    restitution: 0,
    filterGroupIndex: -1,
    userData: {
      kind: 'body'
    }
  });
  chassis.createFixture(new Circle(Vec2(p.head.x, p.head.y), p.head.radius), {
    isSensor: true,
    filterGroupIndex: -1,
    userData: {
      kind: 'head'
    }
  });
  const inertia = p.chassisMass * (p.bodyLength ** 2 + p.bodyHeight ** 2) / 12 * p.inertiaScale;
  chassis.setMassData({
    mass: p.chassisMass,
    center: Vec2(p.comX, 0),
    I: inertia + p.chassisMass * p.comX * p.comX
  });
  const wheels = [],
    joints = [],
    springs = [];
  for (let i = 0; i < 2; i++) {
    const offset = Vec2((i ? 1 : -1) * p.wheelbase / 2, p.wheelRestY),
      pos = chassis.getWorldPoint(offset),
      w = world.createDynamicBody({
        position: pos,
        angle,
        bullet: true,
        linearVelocity: chassis.getLinearVelocityFromWorldPoint(pos),
        angularVelocity: options.wheelOmega ?? options.av ?? 0
      });
    w.createFixture(new Circle(p.wheelRadius), {
      density: p.wheelMass / (Math.PI * p.wheelRadius ** 2),
      friction: 1,
      restitution: p.restitution,
      filterGroupIndex: -1,
      userData: {
        kind: 'wheel',
        index: i
      }
    });
    // WheelJoint computes its spring using this axial constraint effective mass,
    // including chassis rotational compliance, rather than all 870 kg.
    const mass = 1 / (1 / p.chassisMass + 1 / p.wheelMass + (offset.x - p.comX) ** 2 / inertia),
      k = stats.suspension.stiffness[i],
      c = stats.suspension.damping[i],
      frequency = Math.sqrt(k / mass) / (2 * Math.PI),
      dampingRatio = c / (2 * Math.sqrt(k * mass));
    joints.push(world.createJoint(new WheelJoint({
      bodyA: chassis,
      bodyB: w,
      localAnchorA: offset,
      localAnchorB: Vec2(),
      localAxisA: Vec2(0, 1),
      frequencyHz: frequency,
      dampingRatio,
      enableMotor: false,
      collideConnected: false
    })));
    wheels.push(w);
    springs.push({
      mass,
      k,
      c,
      frequency,
      dampingRatio
    });
  }
  buildTerrain(world, l, p);
  const capacity = stats.fuelSeconds,
    s = {
      tick: 0,
      x,
      y,
      vx: v.x,
      vy: v.y,
      angle,
      av: options.av || 0,
      fuel: capacity,
      capacity,
      upgrades: u,
      gears: [],
      cans: [],
      coinValue: 0,
      checkpoints: [],
      stageId: l.stageId || `test-${l.id}`,
      seed: l.seed || 0,
      generatorVersion: l.generatorVersion || 0,
      telemetry: {fuelStops: [], modules: [], checkpoints: [], dryAt: null,
        tractionSeconds: 0, slipSeconds: 0, landingLosses: [], maxSpeed: 0},
      status: 'playing',
      reason: '',
      roof: 0,
      stalled: 0,
      grounded: 0,
      wheels: [],
      best: 0,
      mode: 'coast'
    };
  const f = {
    world,
    chassis,
    wheels,
    joints,
    springs,
    p,
    stats,
    throttle: 0,
    reverse: false,
    reverseTimer: 0,
    loads: [0, 0],
    driveTorques: [0, 0],
    brakeTorques: [0, 0],
    airTorque: 0,
    landingImpulse: 0,
    headTime: 0,
    stuckTime: 0,
    tractionTime: 0,
    slipTime: 0,
    airEntrySpeed: null,
    landing: null,
    visitedModules: new Set()
  };
  Object.defineProperty(s, '_physics', {
    value: f,
    enumerable: false
  });
  world.on('pre-solve', c => {
    const a = c.getFixtureA().getUserData() || {},
      b = c.getFixtureB().getUserData() || {};
    if (a.kind === 'wheel' || b.kind === 'wheel') {
      const body = a.kind === 'wheel' ? c.getFixtureA().getBody() : c.getFixtureB().getBody();
      // This is the final contact pair coefficient. Planck's default geometric
      // material mixing must not silently turn a requested 0.2 ice value into 0.45.
      c.setFriction(surfaceFriction(l, body.getPosition().x, p) * stats.gripMultiplier);
      c.setRestitution(p.restitution);
    }
  });
  world.on('post-solve', (c, impulse) => {
    const a = c.getFixtureA().getUserData() || {},
      b = c.getFixtureB().getUserData() || {},
      w = a.kind === 'wheel' ? a : b.kind === 'wheel' ? b : null,
      total = impulse.normalImpulses.reduce((a, v) => a + v, 0);
    if (w) f.loads[w.index] += total / (p.fixedDt / p.substeps);
    f.landingImpulse = Math.max(f.landingImpulse, total);
  });
  world.step(0);
  updateState(s);
  return s;
}
function applyTravelStop(f, i) {
  // Only progressive end stops live here. WheelJoint owns the main spring and
  // damper, so no duplicate k*x force is applied across the normal travel range.
  const {
      p,
      chassis: b
    } = f,
    w = f.wheels[i],
    j = f.joints[i],
    axis = b.getWorldVector(Vec2(0, 1)),
    t = j.getJointTranslation(),
    anchor = j.getAnchorA(),
    wheel = w.getPosition(),
    v = dot(Vec2.sub(w.getLinearVelocity(), b.getLinearVelocityFromWorldPoint(wheel)), axis);
  let excess = 0,
    direction = 0;
  if (t > p.travelMax - p.stopZone) {
    excess = t - (p.travelMax - p.stopZone);
    direction = -1;
  } else if (t < p.travelMin + p.stopZone) {
    excess = p.travelMin + p.stopZone - t;
    direction = 1;
  }
  if (!direction) return;
  const damping = Math.max(0, -direction * v) * p.stopDamping * clamp(excess / p.stopZone, 0, 1),
    force = direction * Math.min(p.maxStopForce, p.stopK * excess * excess + damping),
    vector = Vec2.mul(axis, force);
  w.applyForce(vector, wheel, true);
  b.applyForce(Vec2.neg(vector), anchor, true);
}
function applyControls(l, s, input, dt) {
  const f = s._physics,
    p = f.p,
    b = f.chassis,
    c = readContacts(s),
    grounded = c.support.filter(Boolean).length,
    both = input === 3,
    gas = input === 1 && s.fuel > 0,
    brake = Boolean(input & 2),
    n = c.contacts.length ? c.contacts.reduce((a, c) => ({
      x: a.x + c.nx,
      y: a.y + c.ny
    }), {
      x: 0,
      y: 0
    }) : {
      x: 0,
      y: 1
    },
    length = Math.hypot(n.x, n.y) || 1,
    v = b.getLinearVelocity(),
    speed = (v.x * n.y - v.y * n.x) / length;
  if (!brake || both || !grounded || s.fuel <= 0) {
    f.reverse = false;
    f.reverseTimer = 0;
  } else if (f.reverse) {
    if (speed > p.reverseExitSpeed) {
      f.reverse = false;
      f.reverseTimer = 0;
    }
  } else if (Math.abs(speed) < p.reverseEntrySpeed) {
    f.reverseTimer += dt;
    if (f.reverseTimer >= p.reverseWait) f.reverse = true;
  } else f.reverseTimer = 0;
  const drive = gas ? 1 : brake && !both && f.reverse && s.fuel > 0 ? -1 : 0,
    target = Math.abs(drive),
    tau = target > f.throttle ? p.throttleRise : p.throttleFall;
  f.throttle += (target - f.throttle) * (1 - Math.exp(-dt / tau));
  f.airTorque = 0;
  f.driveTorques = [0, 0];
  f.brakeTorques = [0, 0];
  s.mode = grounded ? both ? 'brake' : drive === -1 ? 'reverse' : brake ? 'brake' : gas ? 'drive' : 'coast' : both || !input ? 'air-neutral' : input === 1 ? 'air-gas' : 'air-brake';
  let reaction = 0;
  for (let i = 0; i < 2; i++) {
    const w = f.wheels[i],
      j = f.joints[i],
      omega = w.getAngularVelocity() - b.getAngularVelocity(),
      shouldBrake = brake && !f.reverse && grounded;
    // A bounded zero-speed motor supplies ground braking. Drive instead uses
    // explicit equal-and-opposite torque pairs; the two never run together.
    j.enableMotor(shouldBrake);
    j.setMotorSpeed(0);
    j.setMaxMotorTorque(shouldBrake ? p.brakeTorque * .5 : 0);
    let torque = 0;
    if (drive && !shouldBrake) {
      const maxOmega = drive > 0 ? f.stats.driveOmega : p.reverseOmega,
        q = clamp(-omega * drive / maxOmega, 0, 1);
      torque = -drive * f.throttle * (drive > 0 ? f.stats.torqueNm : p.reverseTorque) * p.axleShares[i] * (1 - q * q);
      f.driveTorques[i] = -torque;
    } else if (brake && !both && !grounded) {
      const inertia = w.getInertia();
      torque = -Math.sign(omega) * Math.min(p.brakeTorque * .5, Math.abs(omega) / (dt * (1 / inertia + 1 / b.getInertia())));
      f.brakeTorques[i] = Math.abs(torque);
    }
    if (shouldBrake) f.brakeTorques[i] = p.brakeTorque * .5;
    if (torque) {
      w.applyTorque(torque, true);
      b.applyTorque(-torque, true);
      reaction -= torque;
    }
    if (c.support[i] && p.rollingResistance) {
      const load = f.loads[i] || p.gravity * (p.chassisMass / 2 + p.wheelMass),
        omega = w.getAngularVelocity(),
        limit = p.rollingResistance * load * p.wheelRadius,
        resistance = -Math.sign(omega) * Math.min(limit, Math.abs(omega) * w.getInertia() / dt);
      w.applyTorque(resistance, true);
    }
    applyTravelStop(f, i);
  }
  if (!grounded) {
    const direction = input === 1 ? 1 : input === 2 ? -1 : 0,
      omega = b.getAngularVelocity(),
      soft = direction * omega > 0 ? Math.max(0, 1 - (direction * omega / p.airSoftOmega) ** 2) : 1,
      target = direction * b.getInertia() * p.airAlpha * soft;
    // The drive already reacts on the chassis. Budget the separate arcade
    // assist against that known reaction so nominal input does not double it.
    f.airTorque = direction ? target - reaction : 0;
    b.applyTorque(f.airTorque - p.airAngularDamping * b.getInertia() * omega, true);
  }
  if (p.airDrag) {
    const v = b.getLinearVelocity(),
      speed = Math.hypot(v.x, v.y);
    b.applyForceToCenter(Vec2(-p.airDrag * v.x * speed, -p.airDrag * v.y * speed), true);
  }
}
function recordTelemetry(l, s, input, previous) {
  const f = s._physics, t = s.telemetry, dt = f.p.fixedDt;
  const slope = (terrain(l, s.x + .5) - terrain(l, s.x - .5));
  const supported = s.wheels.filter(w => w.grounded);
  const slip = supported.length ? Math.max(...supported.map(w => Math.abs(w.slip))) : 0;
  const gas = input === 1 && s.fuel > 0 && f.throttle > .8;
  const losingOnClimb = gas && s.grounded && slope > .12 && s.vx < 2 && slip < 1.8;
  const spinning = gas && s.grounded && slip > 3 && Math.abs(s.vx) < 5;
  f.tractionTime = losingOnClimb ? f.tractionTime + dt : Math.max(0, f.tractionTime - dt * .5);
  f.slipTime = spinning ? f.slipTime + dt : Math.max(0, f.slipTime - dt * .5);
  t.tractionSeconds = Math.max(t.tractionSeconds, f.tractionTime);
  t.slipSeconds = Math.max(t.slipSeconds, f.slipTime);
  if (f.tractionTime >= 2) t.tractionAt = Math.round(s.x - 9);
  if (f.slipTime >= 2) t.slipAt = Math.round(s.x - 9);
  t.maxSpeed = Math.max(t.maxSpeed, Math.hypot(s.vx, s.vy));
  if (previous.grounded && !s.grounded) f.airEntrySpeed = previous.speed;
  if (!previous.grounded && s.grounded && f.airEntrySpeed !== null) {
    f.landing = {at: s.x - 9, speed: f.airEntrySpeed, tick: s.tick, braked: Boolean(input & 2)};
    f.airEntrySpeed = null;
  }
  if (f.landing) {
    f.landing.braked ||= Boolean(input & 2);
    if (s.tick - f.landing.tick >= 30) {
      if (!f.landing.braked && f.landing.speed > 6 && s.vx < f.landing.speed * .55 && s.grounded) {
        t.landingLosses.push({at: Math.round(f.landing.at), before: +f.landing.speed.toFixed(2), after: +s.vx.toFixed(2)});
        if (t.landingLosses.length > 12) t.landingLosses.shift();
      }
      f.landing = null;
    }
  }
  for (const module of l.modules || []) {
    const from = module.from ?? module.start ?? 0, to = module.to ?? module.end ?? l.length + 9;
    if (s.x >= from && s.x < to) {
      s.challenge = {id: module.id, type: module.type, name: module.name || module.type, from, to};
      if (!f.visitedModules.has(module.id)) {
        f.visitedModules.add(module.id);
        t.modules.push({id: module.id, tick: s.tick, x: s.x, angle: s.angle, av: s.av,
          speed: Math.hypot(s.vx, s.vy), fuel: s.fuel, compression: s.wheels.map(w => w.compression)});
      }
      break;
    }
  }
  s.diagnostics.challenge = s.challenge;
  s.diagnostics.fuelSeconds = s.fuel;
}
function analyzeRun(l, s) {
  const t = s.telemetry, notes = [];
  if (t.dryAt) {
    const next = (l.fuel || []).find((x, i) => x > t.dryAt.x && !t.dryAt.cans.includes(i));
    notes.push({type: 'fuel', message: next !== undefined
      ? `Пальне закінчилося за ${Math.round(next - t.dryAt.x)} м до каністри. Запас бака або швидше проходження допоможуть доїхати далі.`
      : `Запас пального вичерпано на ${Math.round(t.dryAt.x - 9)} м. Авто продовжило рух накатом.`});
  }
  if (t.slipSeconds >= 2) notes.push({type: 'grip', message: `Біля ${t.slipAt} м колеса довго буксували під газом. Спробуй кращі шини або м’якший газ.`});
  if (t.tractionSeconds >= 2) notes.push({type: 'engine', message: `Біля ${t.tractionAt} м авто втрачало швидкість на підйомі під газом без значного буксування. Двигун або кращий розгін можуть допомогти.`});
  if (t.landingLosses.length) notes.push({type: 'landing', message: `Після приземлення біля ${t.landingLosses[0].at} м втрачено багато швидкості без гальмування. Спробуй інший кут або покращення підвіски.`});
  return notes.slice(0, 3);
}
function stepDrive(l, s, input = 0) {
  if (s.status !== 'playing') return s;
  if (!s._physics) throw new Error('Фізичний стан потрібно створити через createDrive');
  const f = s._physics,
    p = f.p,
    dt = p.fixedDt / p.substeps;
  const previous = {grounded: s.grounded, speed: Math.hypot(s.vx, s.vy)};
  f.landingImpulse = 0;
  for (let n = 0; n < p.substeps; n++) {
    applyControls(l, s, input, dt);
    f.loads = [0, 0];
    // Two real 1/120-second steps; solver iterations are a separate parameter.
    f.world.step(dt, p.velocityIterations, p.positionIterations);
  }
  const c = updateState(s);
  s.tick++;
  s.best = Math.max(s.best, s.x - 9);
  // Fuel is a time budget: exactly one unit per 60 active ticks, independent
  // of pedals, engine upgrades or wheel slip. Zero fuel leaves physics alive.
  const beforeFuel = s.fuel;
  s.fuel = Math.max(0, Math.round(s.fuel * 60) - 1) / 60;
  if (beforeFuel > 0 && s.fuel === 0) s.telemetry.dryAt = {x: s.x, tick: s.tick, cans: [...s.cans]};
  (l.gears || []).forEach((x, i) => {
    if (!s.gears.includes(i) && Math.abs(s.x - x) < 1.65 && Math.abs(s.y - terrain(l, x) - 1.15) < 2.1) {
      s.gears.push(i);
      s.coinValue += l.coinValues?.[i] ?? 1;
    }
  });
  (l.fuel || []).forEach((x, i) => {
    if (!s.cans.includes(i) && Math.abs(s.x - x) < 1.65 && Math.abs(s.y - terrain(l, x) - 1.15) < 2.1) {
      s.cans.push(i);
      s.telemetry.fuelStops.push({index: i, x, tick: s.tick, before: s.fuel, capacity: s.capacity});
      s.fuel = s.capacity;
    }
  });
  for (const checkpoint of l.checkpoints || []) {
    if (s.x >= checkpoint.x && !s.checkpoints.includes(checkpoint.id)) {
      s.checkpoints.push(checkpoint.id);
      s.telemetry.checkpoints.push({id: checkpoint.id, tick: s.tick, fuel: s.fuel, speed: Math.hypot(s.vx, s.vy)});
    }
  }
  recordTelemetry(l, s, input, previous);
  f.headTime = c.head ? f.headTime + p.fixedDt : 0;
  s.roof = Math.round(f.headTime / p.fixedDt);
  s.stalled = s.fuel === 0 && Math.hypot(s.vx, s.vy) < .3 ? s.stalled + 1 : 0;
  f.stuckTime = Math.cos(s.angle) < -.35 && Math.hypot(s.vx, s.vy) < .3 && Math.abs(s.av) < .15 ? f.stuckTime + p.fixedDt : 0;
  if (s.x >= l.length + 9) {
    s.status = 'completed';
    s.reason = 'finish';
  } else if (c.head && (Math.hypot(s.vx, s.vy) > p.headImpactSpeed || f.headTime >= p.headContactTime)) {
    s.status = 'failed';
    s.reason = 'overturned';
  } else if (f.stuckTime >= 3) {
    s.status = 'failed';
    s.reason = 'stuck';
  } else if (s.stalled >= 120) {
    s.status = 'failed';
    s.reason = 'fuel';
  } else if (s.x < -90) {
    s.status = 'failed';
    s.reason = 'route_exit';
  } else if (s.tick >= l.max_ticks) {
    s.status = 'failed';
    s.reason = 'time';
  }
  return s;
}
function wheelGeometry(s, side) {
  return s.wheels[side < 0 ? 0 : 1];
}
function captureDrive(s) {
  return {
    ...s,
    upgrades: {
      ...s.upgrades
    },
    gears: [...s.gears],
    cans: [...s.cans],
    checkpoints: [...s.checkpoints],
    wheels: s.wheels.map(w => ({
      ...w
    })),
    diagnostics: s.diagnostics
  };
}
function interpolateDrive(a, b, alpha) {
  if (!a || a.tick === b.tick) return b;
  const t = clamp(alpha, 0, 1),
    mix = (a, b) => a + (b - a) * t,
    out = {
      ...b
    };
  for (const k of ['x', 'y', 'angle']) out[k] = mix(a[k], b[k]);
  out.wheels = b.wheels.map((w, i) => {
    const result = {
        ...w
      },
      old = a.wheels[i];
    if (old) for (const k of ['x', 'y', 'angle', 'anchorX', 'anchorY', 'compression']) result[k] = mix(old[k], w[k]);
    return result;
  });
  if (a.diagnostics && b.diagnostics) {
    const point = (old, current) => ({...current, x: mix(old.x, current.x), y: mix(old.y, current.y)});
    out.diagnostics = {
      ...b.diagnostics,
      com: point(a.diagnostics.com, b.diagnostics.com),
      chassisCOM: point(a.diagnostics.chassisCOM, b.diagnostics.chassisCOM),
      colliders: b.diagnostics.colliders.map((shape, i) => {
        const old = a.diagnostics.colliders[i];
        if (!old) return shape;
        if (shape.type === 'polygon') return {...shape, vertices: shape.vertices.map((v, n) => point(old.vertices[n], v))};
        return point(old, shape);
      }),
      // Contact normals belong to the last solved physics step, not a made-up
      // interpolated collision. Collider outlines track the displayed vehicle.
    };
  }
  return out;
}
function summarize(l, s) {
  const medals = s.status === 'completed' ? ['finish', ...(s.gears.length >= Math.ceil((l.gears || []).length * .7) ? ['collector'] : []), ...(s.fuel * 5 >= s.capacity ? ['economy'] : [])] : [];
  return {
    status: s.status,
    reason: s.reason,
    ticks: s.tick,
    distance: Math.min(l.meters, Math.floor(s.best)),
    fuel: Math.floor(s.fuel * 100 / s.capacity),
    fuelSeconds: +s.fuel.toFixed(3),
    coinValue: s.coinValue,
    checkpoints: [...s.checkpoints],
    stageId: s.stageId,
    seed: s.seed,
    generatorVersion: s.generatorVersion,
    analysis: analyzeRun(l, s),
    gears: [...s.gears].sort((a, b) => a - b),
    medals
  };
}
function replay(l, u, events, ticks, abandon = false) {
  if (!Number.isInteger(ticks) || ticks < 1 || ticks > l.max_ticks || !Array.isArray(events) || events.length > CONFIG.maxTicks) throw new ReplayValidationError('Некоректна тривалість');
  let last = -1;
  for (const e of events) {
    if (!Array.isArray(e) || e.length !== 2 || !Number.isInteger(e[0]) || !Number.isInteger(e[1]) || e[0] <= last || e[0] < 0 || e[0] >= ticks || e[1] < 0 || e[1] > 3) throw new ReplayValidationError('Некоректне керування');
    last = e[0];
  }
  const s = createDrive(l, u);
  let cursor = 0,
    input = 0;
  for (let tick = 0; tick < ticks; tick++) {
    if (events[cursor]?.[0] === tick) input = events[cursor++][1];
    stepDrive(l, s, input);
    if (s.status !== 'playing' && s.tick !== ticks) throw new ReplayValidationError('Заїзд завершився раніше');
  }
  if (s.status === 'playing') {
    if (!abandon) throw new ReplayValidationError('Заїзд ще триває');
    s.status = 'failed';
    s.reason = 'abandoned';
  }
  return summarize(l, s);
}
module.exports = {
  CONFIG,
  ...void (PHYSICS),
  ...void (TEST_LEVEL),
  ...void (ReplayValidationError),
  ...void (clamp),
  ...void (terrain),
  ...void (surfaceAt),
  ...void (surfaceFriction),
  getLevel,
  ...void (freshUpgrades),
  ...void (getUpgradeStats),
  ...void (createDrive),
  ...void (wheelGeometry),
  ...void (stepDrive),
  ...void (captureDrive),
  ...void (interpolateDrive),
  ...void (summarize),
  replay
};


/***/ },

/***/ 250
(module) {

// SI units throughout. These are our game's measured/tunable values, not the
// parameters of another commercial game. Every axle receives only its share.
const PHYSICS = {
  fixedDt: 1 / 60,
  substeps: 2,
  velocityIterations: 8,
  positionIterations: 3,
  gravity: 10,
  chassisMass: 800,
  wheelMass: 35,
  wheelRadius: .45,
  wheelbase: 2.6,
  bodyLength: 3.6,
  bodyHeight: .65,
  comX: -.13,
  inertiaScale: 1,
  wheelRestY: -.825,
  mountY: -.06,
  bodyVertices: [[-1.8, -.50], [1.8, -.50], [1.75, .04], [1.22, .25], [-1.3, .25], [-1.8, .05]],
  head: {
    x: .25,
    y: .60,
    radius: .25
  },
  springK: [20000, 16000],
  springC: [2800, 2300],
  travelMin: -.1,
  travelMax: .6,
  stopZone: .1,
  stopK: 280000,
  stopDamping: 3800,
  maxStopForce: 35000,
  forwardTorque: 1250,
  forwardOmega: 60,
  axleShares: [.65, .35],
  reverseTorque: 1200,
  reverseOmega: 12,
  brakeTorque: 3200,
  throttleRise: .10,
  throttleFall: .06,
  reverseWait: .15,
  reverseEntrySpeed: .3,
  reverseExitSpeed: .75,
  airAlpha: 4,
  airSoftOmega: 4,
  airAngularDamping: .045,
  airDrag: .32,
  rollingResistance: .013,
  restitution: .02,
  materials: {
    dirt: 1.1,
    snow: .55,
    ice: .2
  },
  terrainStep: .5,
  headImpactSpeed: 2.8,
  headContactTime: .12
};
module.exports = PHYSICS;


/***/ },

/***/ 806
(module, __unused_webpack_exports, __webpack_require__) {

// Shared by local storage and the authoritative bundled server worker.
const CONFIG = __webpack_require__(836);
const SCHEMA = 3, VEHICLE = 'wanderer';
const PARTS = ['engine', 'suspension', 'tires', 'tank'];
const copy = value => JSON.parse(JSON.stringify(value));
const freshUpgrades = () => Object.fromEntries(PARTS.map(part => [part, 0]));
const integer = (n, low, high = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(n) && n >= low && n <= high;
function freshProgress() {
  const upgrades = freshUpgrades();
  return {profile_schema: SCHEMA, vehicle_id: VEHICLE, balance: 0, upgrades,
    vehicles: {[VEHICLE]: {upgrades: {...upgrades}}}, tracks: {}, tutorial_granted: false, migration: null, purchases: {}};
}
function migrateProgress(before) {
  if (before.profile_schema === SCHEMA) return copy(before);
  const result = {...copy(before), ...freshProgress()};
  if (!integer(before.balance, 0) || !before.upgrades || !PARTS.every(part => integer(before.upgrades[part], 1, 5)))
    throw new Error('Некоректне попереднє збереження');
  const credit = CONFIG.levels[0].finishReward;
  if (!integer(credit, 0)) throw new Error('Немає конфігурації нової кампанії');
  result.legacy = {version: before.version || 'pre-3', balance: before.balance, upgrades: copy(before.upgrades),
    tracks: copy(before.tracks || {}), purchases: copy(before.purchases || {})};
  result.balance = before.balance + credit;
  result.upgrades = Object.fromEntries(PARTS.map(part => [part, before.upgrades[part] - 1]));
  result.vehicles[VEHICLE].upgrades = {...result.upgrades};
  result.tutorial_granted = true;
  result.migration = {from_version: before.version || 'pre-3', tutorial_credit: credit};
  result.tracks['1'] = {gears: [], medals: [], checkpoints: [], best: 0, attempts: 0, finish_reward_claimed: true};
  delete result.rewards;
  return result;
}
function unlockedLevel(profile) {
  let id = profile.tutorial_granted ? 2 : 1;
  while (id < CONFIG.levels.length && profile.tracks[String(id)]?.medals?.includes('finish')) id++;
  return id;
}
function publicProgress(profile) {
  return {version: CONFIG.version, profile_schema: SCHEMA, vehicle_id: VEHICLE,
    balance: profile.balance, upgrades: copy(profile.upgrades), vehicles: copy(profile.vehicles),
    tracks: copy(profile.tracks), tutorial_granted: Boolean(profile.tutorial_granted),
    migration: copy(profile.migration || null), unlocked_level: unlockedLevel(profile),
    levels: CONFIG.levels.map(({id, name, meters, hint, recommended, stageId, seed, generatorVersion}) =>
      ({id, name, meters, hint, recommended, stageId, seed, generatorVersion}))};
}
function awardProgress(before, level, outcome) {
  if (!integer(before.balance, 0) || !['completed', 'failed'].includes(outcome.status)) throw new Error('Некоректний результат');
  const gears = [...new Set(outcome.gears || [])], checkpoints = [...new Set(outcome.checkpoints || [])];
  if (gears.some(id => !integer(id, 0, level.gears.length - 1)) ||
      checkpoints.some(id => !level.checkpoints.some(cp => cp.id === id)) ||
      !integer(outcome.distance, 0, level.meters)) throw new Error('Некоректні нагороди');
  const result = copy(before), key = String(level.id);
  const track = result.tracks[key] || {gears: [], medals: [], checkpoints: [], best: 0, attempts: 0, finish_reward_claimed: false};
  const previous = track.best;
  const newCheckpoints = checkpoints.filter(id => !track.checkpoints.includes(id));
  const newMedals = (outcome.medals || []).filter(id => !track.medals.includes(id));
  const coinParts = gears.reduce((sum, id) => sum + level.coinValues[id], 0);
  const checkpointParts = newCheckpoints.reduce((sum, id) => sum + level.checkpoints.find(cp => cp.id === id).reward, 0);
  const finishParts = outcome.status === 'completed' && !track.finish_reward_claimed ? level.finishReward : 0;
  const parts = coinParts + checkpointParts + finishParts;
  if (!integer(parts, 0) || !integer(result.balance + parts, 0)) throw new Error('Некоректна сума нагороди');
  result.balance += parts;
  track.gears = [...new Set([...track.gears, ...gears])].sort((a, b) => a - b);
  track.medals = [...new Set([...track.medals, ...newMedals])].sort();
  track.checkpoints = [...new Set([...track.checkpoints, ...checkpoints])].sort();
  track.best = Math.max(previous, outcome.distance);
  track.attempts = (track.attempts || 0) + 1;
  if (outcome.status === 'completed') track.finish_reward_claimed = true;
  result.tracks[key] = track;
  return {progress: result, receipt: {parts, coin_parts: coinParts, checkpoint_parts: checkpointParts,
    finish_parts: finishParts, new_medals: newMedals.sort(), new_gears: gears.length,
    new_checkpoints: newCheckpoints.sort(), new_record: outcome.distance > previous, previous_best: previous}};
}
function purchaseProgress(before, part, from) {
  if (!PARTS.includes(part) || !integer(from, 0, 9) || before.upgrades[part] !== from) throw new Error('Рівень покращення змінився');
  const price = CONFIG.upgradePrices[part][from];
  if (before.balance < price) throw new Error('Недостатньо монет');
  const result = copy(before);
  result.balance -= price;
  result.upgrades[part]++;
  result.vehicles[VEHICLE].upgrades = {...result.upgrades};
  return {progress: result, purchase: {part, from, to: from + 1, price}};
}
function validateProgress(profile) {
  if (!profile || profile.profile_schema !== SCHEMA || profile.vehicle_id !== VEHICLE || !integer(profile.balance, 0) ||
      !profile.upgrades || !PARTS.every(part => integer(profile.upgrades[part], 0, 10)) ||
      !profile.vehicles?.[VEHICLE]?.upgrades || PARTS.some(part => profile.vehicles[VEHICLE].upgrades[part] !== profile.upgrades[part]) ||
      !profile.tracks || typeof profile.tracks !== 'object' || Array.isArray(profile.tracks)) throw new Error('Некоректне збереження');
  for (const [id, track] of Object.entries(profile.tracks)) {
    const level = CONFIG.levels.find(level => String(level.id) === id);
    if (!level || !integer(track.best, 0, level.meters) || !integer(track.attempts || 0, 0) ||
        !Array.isArray(track.gears) || track.gears.some(n => !integer(n, 0, level.gears.length - 1)) ||
        !Array.isArray(track.medals) || track.medals.some(m => !['finish', 'collector', 'economy'].includes(m)) ||
        !Array.isArray(track.checkpoints) || track.checkpoints.some(id => !level.checkpoints.some(cp => cp.id === id)))
      throw new Error('Некоректний рекорд');
  }
  return copy(profile);
}
module.exports = {...void (SCHEMA), ...void (VEHICLE), ...void (PARTS), ...void (freshProgress), migrateProgress, ...void (unlockedLevel), ...void (publicProgress), awardProgress, purchaseProgress, ...void (validateProgress)};


/***/ },

/***/ 428
(module) {

// Separate repeatable proving ground. It never participates in campaign rewards.
module.exports = {
  id: 0,
  name: "Полігон підвіски",
  meters: 180,
  length: 180,
  max_ticks: 10800,
  hint: "Рівна ділянка → нерівність 0,2 м → підйом → гребінь → трамплін.",
  bridges: [],
  gears: [],
  fuel: [70, 140],
  terrain: [[-40, 0], [20, 0], [21, .2], [22, 0], [35, 0], [55, 7.28], [70, 9], [85, 7], [95, 4], [106, 4], [114, 7.2], [117, 7.8], [122, 2], [145, 2], [160, 0], [210, 0]],
  surfaces: [{
    from: 155,
    to: 175,
    kind: "ice"
  }]
};


/***/ },

/***/ 423
(__unused_webpack_module, exports) {

(function(global, factory) {
   true ? factory(exports) : 0;
})(this, (function(exports2) {
  "use strict";/**
 * Planck.js v1.5.0
 * @license The MIT license
 * @copyright Copyright (c) 2026 Erin Catto, Ali Shakiba
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

  var extendStatics = function(d2, b2) {
    extendStatics = Object.setPrototypeOf || { __proto__: [] } instanceof Array && function(d3, b3) {
      d3.__proto__ = b3;
    } || function(d3, b3) {
      for (var p in b3) if (Object.prototype.hasOwnProperty.call(b3, p)) d3[p] = b3[p];
    };
    return extendStatics(d2, b2);
  };
  function __extends(d2, b2) {
    if (typeof b2 !== "function" && b2 !== null)
      throw new TypeError("Class extends value " + String(b2) + " is not a constructor or null");
    extendStatics(d2, b2);
    function __() {
      this.constructor = d2;
    }
    d2.prototype = b2 === null ? Object.create(b2) : (__.prototype = b2.prototype, new __());
  }
  var __assign = function() {
    __assign = Object.assign || function __assign2(t) {
      for (var s2, i = 1, n2 = arguments.length; i < n2; i++) {
        s2 = arguments[i];
        for (var p in s2) if (Object.prototype.hasOwnProperty.call(s2, p)) t[p] = s2[p];
      }
      return t;
    };
    return __assign.apply(this, arguments);
  };
  typeof SuppressedError === "function" ? SuppressedError : function(error, suppressed, message) {
    var e3 = new Error(message);
    return e3.name = "SuppressedError", e3.error = error, e3.suppressed = suppressed, e3;
  };
  var options = function(input2, defaults) {
    if (input2 === null || typeof input2 === "undefined") {
      input2 = {};
    }
    var output2 = __assign({}, input2);
    for (var key in defaults) {
      if (defaults.hasOwnProperty(key) && typeof input2[key] === "undefined") {
        output2[key] = defaults[key];
      }
    }
    if (typeof Object.getOwnPropertySymbols === "function") {
      var symbols = Object.getOwnPropertySymbols(defaults);
      for (var i = 0; i < symbols.length; i++) {
        var symbol = symbols[i];
        if (defaults.propertyIsEnumerable(symbol) && typeof input2[symbol] === "undefined") {
          output2[symbol] = defaults[symbol];
        }
      }
    }
    return output2;
  };
  var math_random = Math.random;
  var EPSILON = 1e-9;
  var isFinite = Number.isFinite;
  function nextPowerOfTwo(x2) {
    x2 |= x2 >> 1;
    x2 |= x2 >> 2;
    x2 |= x2 >> 4;
    x2 |= x2 >> 8;
    x2 |= x2 >> 16;
    return x2 + 1;
  }
  function isPowerOfTwo(x2) {
    return x2 > 0 && (x2 & x2 - 1) === 0;
  }
  function mod(num, min, max) {
    if (typeof min === "undefined") {
      max = 1;
      min = 0;
    } else if (typeof max === "undefined") {
      max = min;
      min = 0;
    }
    if (max > min) {
      num = (num - min) % (max - min);
      return num + (num < 0 ? max : min);
    } else {
      num = (num - max) % (min - max);
      return num + (num <= 0 ? min : max);
    }
  }
  function clamp(num, min, max) {
    if (num < min) {
      return min;
    } else if (num > max) {
      return max;
    } else {
      return num;
    }
  }
  function random(min, max) {
    if (typeof min === "undefined") {
      max = 1;
      min = 0;
    } else if (typeof max === "undefined") {
      max = min;
      min = 0;
    }
    return min === max ? min : math_random() * (max - min) + min;
  }
  var math = Object.create(Math);
  math.EPSILON = EPSILON;
  math.isFinite = isFinite;
  math.nextPowerOfTwo = nextPowerOfTwo;
  math.isPowerOfTwo = isPowerOfTwo;
  math.mod = mod;
  math.clamp = clamp;
  math.random = random;
  var math_abs$9 = Math.abs;
  var math_sqrt$5 = Math.sqrt;
  var math_max$8 = Math.max;
  var math_min$8 = Math.min;
  var Vec2 = (
    /** @class */
    (function() {
      function Vec22(x2, y) {
        if (!(this instanceof Vec22)) {
          return new Vec22(x2, y);
        }
        if (typeof x2 === "undefined") {
          this.x = 0;
          this.y = 0;
        } else if (typeof x2 === "object") {
          this.x = x2.x;
          this.y = x2.y;
        } else {
          this.x = x2;
          this.y = y;
        }
      }
      Vec22.prototype._serialize = function() {
        return {
          x: this.x,
          y: this.y
        };
      };
      Vec22._deserialize = function(data) {
        var obj = Object.create(Vec22.prototype);
        obj.x = data.x;
        obj.y = data.y;
        return obj;
      };
      Vec22.zero = function() {
        var obj = Object.create(Vec22.prototype);
        obj.x = 0;
        obj.y = 0;
        return obj;
      };
      Vec22.neo = function(x2, y) {
        var obj = Object.create(Vec22.prototype);
        obj.x = x2;
        obj.y = y;
        return obj;
      };
      Vec22.clone = function(v3) {
        return Vec22.neo(v3.x, v3.y);
      };
      Vec22.prototype.toString = function() {
        return JSON.stringify(this);
      };
      Vec22.isValid = function(obj) {
        if (obj === null || typeof obj === "undefined") {
          return false;
        }
        return Number.isFinite(obj.x) && Number.isFinite(obj.y);
      };
      Vec22.assert = function(o) {
      };
      Vec22.prototype.clone = function() {
        return Vec22.clone(this);
      };
      Vec22.prototype.setZero = function() {
        this.x = 0;
        this.y = 0;
        return this;
      };
      Vec22.prototype.set = function(x2, y) {
        if (typeof x2 === "object") {
          this.x = x2.x;
          this.y = x2.y;
        } else {
          this.x = x2;
          this.y = y;
        }
        return this;
      };
      Vec22.prototype.setNum = function(x2, y) {
        this.x = x2;
        this.y = y;
        return this;
      };
      Vec22.prototype.setVec2 = function(value) {
        this.x = value.x;
        this.y = value.y;
        return this;
      };
      Vec22.prototype.wSet = function(a2, v3, b2, w) {
        if (typeof b2 !== "undefined" || typeof w !== "undefined") {
          return this.setCombine(a2, v3, b2, w);
        } else {
          return this.setMul(a2, v3);
        }
      };
      Vec22.prototype.setCombine = function(a2, v3, b2, w) {
        var x2 = a2 * v3.x + b2 * w.x;
        var y = a2 * v3.y + b2 * w.y;
        this.x = x2;
        this.y = y;
        return this;
      };
      Vec22.prototype.setMul = function(a2, v3) {
        var x2 = a2 * v3.x;
        var y = a2 * v3.y;
        this.x = x2;
        this.y = y;
        return this;
      };
      Vec22.prototype.add = function(w) {
        this.x += w.x;
        this.y += w.y;
        return this;
      };
      Vec22.prototype.wAdd = function(a2, v3, b2, w) {
        if (typeof b2 !== "undefined" || typeof w !== "undefined") {
          return this.addCombine(a2, v3, b2, w);
        } else {
          return this.addMul(a2, v3);
        }
      };
      Vec22.prototype.addCombine = function(a2, v3, b2, w) {
        var x2 = a2 * v3.x + b2 * w.x;
        var y = a2 * v3.y + b2 * w.y;
        this.x += x2;
        this.y += y;
        return this;
      };
      Vec22.prototype.addMul = function(a2, v3) {
        var x2 = a2 * v3.x;
        var y = a2 * v3.y;
        this.x += x2;
        this.y += y;
        return this;
      };
      Vec22.prototype.wSub = function(a2, v3, b2, w) {
        if (typeof b2 !== "undefined" || typeof w !== "undefined") {
          return this.subCombine(a2, v3, b2, w);
        } else {
          return this.subMul(a2, v3);
        }
      };
      Vec22.prototype.subCombine = function(a2, v3, b2, w) {
        var x2 = a2 * v3.x + b2 * w.x;
        var y = a2 * v3.y + b2 * w.y;
        this.x -= x2;
        this.y -= y;
        return this;
      };
      Vec22.prototype.subMul = function(a2, v3) {
        var x2 = a2 * v3.x;
        var y = a2 * v3.y;
        this.x -= x2;
        this.y -= y;
        return this;
      };
      Vec22.prototype.sub = function(w) {
        this.x -= w.x;
        this.y -= w.y;
        return this;
      };
      Vec22.prototype.mul = function(m) {
        this.x *= m;
        this.y *= m;
        return this;
      };
      Vec22.prototype.length = function() {
        return Vec22.lengthOf(this);
      };
      Vec22.prototype.lengthSquared = function() {
        return Vec22.lengthSquared(this);
      };
      Vec22.prototype.normalize = function() {
        var length = this.length();
        if (length < EPSILON) {
          return 0;
        }
        var invLength = 1 / length;
        this.x *= invLength;
        this.y *= invLength;
        return length;
      };
      Vec22.normalize = function(v3) {
        var length = Vec22.lengthOf(v3);
        if (length < EPSILON) {
          return Vec22.zero();
        }
        var invLength = 1 / length;
        return Vec22.neo(v3.x * invLength, v3.y * invLength);
      };
      Vec22.lengthOf = function(v3) {
        return math_sqrt$5(v3.x * v3.x + v3.y * v3.y);
      };
      Vec22.lengthSquared = function(v3) {
        return v3.x * v3.x + v3.y * v3.y;
      };
      Vec22.distance = function(v3, w) {
        var dx = v3.x - w.x;
        var dy = v3.y - w.y;
        return math_sqrt$5(dx * dx + dy * dy);
      };
      Vec22.distanceSquared = function(v3, w) {
        var dx = v3.x - w.x;
        var dy = v3.y - w.y;
        return dx * dx + dy * dy;
      };
      Vec22.areEqual = function(v3, w) {
        return v3 === w || typeof w === "object" && w !== null && v3.x === w.x && v3.y === w.y;
      };
      Vec22.skew = function(v3) {
        return Vec22.neo(-v3.y, v3.x);
      };
      Vec22.dot = function(v3, w) {
        return v3.x * w.x + v3.y * w.y;
      };
      Vec22.cross = function(v3, w) {
        if (typeof w === "number") {
          return Vec22.neo(w * v3.y, -w * v3.x);
        } else if (typeof v3 === "number") {
          return Vec22.neo(-v3 * w.y, v3 * w.x);
        } else {
          return v3.x * w.y - v3.y * w.x;
        }
      };
      Vec22.crossVec2Vec2 = function(v3, w) {
        return v3.x * w.y - v3.y * w.x;
      };
      Vec22.crossVec2Num = function(v3, w) {
        return Vec22.neo(w * v3.y, -w * v3.x);
      };
      Vec22.crossNumVec2 = function(v3, w) {
        return Vec22.neo(-v3 * w.y, v3 * w.x);
      };
      Vec22.addCross = function(a2, v3, w) {
        if (typeof w === "number") {
          return Vec22.neo(w * v3.y + a2.x, -w * v3.x + a2.y);
        } else if (typeof v3 === "number") {
          return Vec22.neo(-v3 * w.y + a2.x, v3 * w.x + a2.y);
        }
      };
      Vec22.addCrossVec2Num = function(a2, v3, w) {
        return Vec22.neo(w * v3.y + a2.x, -w * v3.x + a2.y);
      };
      Vec22.addCrossNumVec2 = function(a2, v3, w) {
        return Vec22.neo(-v3 * w.y + a2.x, v3 * w.x + a2.y);
      };
      Vec22.add = function(v3, w) {
        return Vec22.neo(v3.x + w.x, v3.y + w.y);
      };
      Vec22.wAdd = function(a2, v3, b2, w) {
        if (typeof b2 !== "undefined" || typeof w !== "undefined") {
          return Vec22.combine(a2, v3, b2, w);
        } else {
          return Vec22.mulNumVec2(a2, v3);
        }
      };
      Vec22.combine = function(a2, v3, b2, w) {
        return Vec22.zero().setCombine(a2, v3, b2, w);
      };
      Vec22.sub = function(v3, w) {
        return Vec22.neo(v3.x - w.x, v3.y - w.y);
      };
      Vec22.mul = function(a2, b2) {
        if (typeof a2 === "object") {
          return Vec22.neo(a2.x * b2, a2.y * b2);
        } else if (typeof b2 === "object") {
          return Vec22.neo(a2 * b2.x, a2 * b2.y);
        }
      };
      Vec22.mulVec2Num = function(a2, b2) {
        return Vec22.neo(a2.x * b2, a2.y * b2);
      };
      Vec22.mulNumVec2 = function(a2, b2) {
        return Vec22.neo(a2 * b2.x, a2 * b2.y);
      };
      Vec22.prototype.neg = function() {
        this.x = -this.x;
        this.y = -this.y;
        return this;
      };
      Vec22.neg = function(v3) {
        return Vec22.neo(-v3.x, -v3.y);
      };
      Vec22.abs = function(v3) {
        return Vec22.neo(math_abs$9(v3.x), math_abs$9(v3.y));
      };
      Vec22.mid = function(v3, w) {
        return Vec22.neo((v3.x + w.x) * 0.5, (v3.y + w.y) * 0.5);
      };
      Vec22.upper = function(v3, w) {
        return Vec22.neo(math_max$8(v3.x, w.x), math_max$8(v3.y, w.y));
      };
      Vec22.lower = function(v3, w) {
        return Vec22.neo(math_min$8(v3.x, w.x), math_min$8(v3.y, w.y));
      };
      Vec22.prototype.clamp = function(max) {
        var lengthSqr = this.x * this.x + this.y * this.y;
        if (lengthSqr > max * max) {
          var scale = max / math_sqrt$5(lengthSqr);
          this.x *= scale;
          this.y *= scale;
        }
        return this;
      };
      Vec22.clamp = function(v3, max) {
        var r = Vec22.neo(v3.x, v3.y);
        r.clamp(max);
        return r;
      };
      Vec22.clampVec2 = function(v3, min, max) {
        return {
          x: clamp(v3.x, min === null || min === void 0 ? void 0 : min.x, max === null || max === void 0 ? void 0 : max.x),
          y: clamp(v3.y, min === null || min === void 0 ? void 0 : min.y, max === null || max === void 0 ? void 0 : max.y)
        };
      };
      Vec22.scaleFn = function(x2, y) {
        return function(v3) {
          return Vec22.neo(v3.x * x2, v3.y * y);
        };
      };
      Vec22.translateFn = function(x2, y) {
        return function(v3) {
          return Vec22.neo(v3.x + x2, v3.y + y);
        };
      };
      return Vec22;
    })()
  );
  var math_max$7 = Math.max;
  var math_min$7 = Math.min;
  var AABB = (
    /** @class */
    (function() {
      function AABB2(lower, upper) {
        if (!(this instanceof AABB2)) {
          return new AABB2(lower, upper);
        }
        this.lowerBound = Vec2.zero();
        this.upperBound = Vec2.zero();
        if (typeof lower === "object") {
          this.lowerBound.setVec2(lower);
        }
        if (typeof upper === "object") {
          this.upperBound.setVec2(upper);
        } else if (typeof lower === "object") {
          this.upperBound.setVec2(lower);
        }
      }
      AABB2.prototype.isValid = function() {
        return AABB2.isValid(this);
      };
      AABB2.isValid = function(obj) {
        if (obj === null || typeof obj === "undefined") {
          return false;
        }
        return Vec2.isValid(obj.lowerBound) && Vec2.isValid(obj.upperBound) && Vec2.sub(obj.upperBound, obj.lowerBound).lengthSquared() >= 0;
      };
      AABB2.assert = function(o) {
      };
      AABB2.prototype.getCenter = function() {
        return Vec2.neo((this.lowerBound.x + this.upperBound.x) * 0.5, (this.lowerBound.y + this.upperBound.y) * 0.5);
      };
      AABB2.prototype.getExtents = function() {
        return Vec2.neo((this.upperBound.x - this.lowerBound.x) * 0.5, (this.upperBound.y - this.lowerBound.y) * 0.5);
      };
      AABB2.prototype.getPerimeter = function() {
        return 2 * (this.upperBound.x - this.lowerBound.x + this.upperBound.y - this.lowerBound.y);
      };
      AABB2.prototype.combine = function(a2, b2) {
        b2 = b2 || this;
        var lowerA = a2.lowerBound;
        var upperA = a2.upperBound;
        var lowerB = b2.lowerBound;
        var upperB = b2.upperBound;
        var lowerX = math_min$7(lowerA.x, lowerB.x);
        var lowerY = math_min$7(lowerA.y, lowerB.y);
        var upperX = math_max$7(upperB.x, upperA.x);
        var upperY = math_max$7(upperB.y, upperA.y);
        this.lowerBound.setNum(lowerX, lowerY);
        this.upperBound.setNum(upperX, upperY);
      };
      AABB2.prototype.combinePoints = function(a2, b2) {
        this.lowerBound.setNum(math_min$7(a2.x, b2.x), math_min$7(a2.y, b2.y));
        this.upperBound.setNum(math_max$7(a2.x, b2.x), math_max$7(a2.y, b2.y));
      };
      AABB2.prototype.set = function(aabb) {
        this.lowerBound.setNum(aabb.lowerBound.x, aabb.lowerBound.y);
        this.upperBound.setNum(aabb.upperBound.x, aabb.upperBound.y);
      };
      AABB2.prototype.contains = function(aabb) {
        var result = true;
        result = result && this.lowerBound.x <= aabb.lowerBound.x;
        result = result && this.lowerBound.y <= aabb.lowerBound.y;
        result = result && aabb.upperBound.x <= this.upperBound.x;
        result = result && aabb.upperBound.y <= this.upperBound.y;
        return result;
      };
      AABB2.prototype.extend = function(value) {
        AABB2.extend(this, value);
        return this;
      };
      AABB2.extend = function(out, value) {
        out.lowerBound.x -= value;
        out.lowerBound.y -= value;
        out.upperBound.x += value;
        out.upperBound.y += value;
        return out;
      };
      AABB2.testOverlap = function(a2, b2) {
        var d1x = b2.lowerBound.x - a2.upperBound.x;
        var d2x = a2.lowerBound.x - b2.upperBound.x;
        var d1y = b2.lowerBound.y - a2.upperBound.y;
        var d2y = a2.lowerBound.y - b2.upperBound.y;
        if (d1x > 0 || d1y > 0 || d2x > 0 || d2y > 0) {
          return false;
        }
        return true;
      };
      AABB2.areEqual = function(a2, b2) {
        return Vec2.areEqual(a2.lowerBound, b2.lowerBound) && Vec2.areEqual(a2.upperBound, b2.upperBound);
      };
      AABB2.diff = function(a2, b2) {
        var wD = math_max$7(0, math_min$7(a2.upperBound.x, b2.upperBound.x) - math_max$7(b2.lowerBound.x, a2.lowerBound.x));
        var hD = math_max$7(0, math_min$7(a2.upperBound.y, b2.upperBound.y) - math_max$7(b2.lowerBound.y, a2.lowerBound.y));
        var wA = a2.upperBound.x - a2.lowerBound.x;
        var hA = a2.upperBound.y - a2.lowerBound.y;
        var wB = b2.upperBound.x - b2.lowerBound.x;
        var hB = b2.upperBound.y - b2.lowerBound.y;
        return wA * hA + wB * hB - wD * hD;
      };
      AABB2.prototype.rayCast = function(output2, input2) {
        var tmin = -Infinity;
        var tmax = Infinity;
        var p = input2.p1;
        var d2 = Vec2.sub(input2.p2, input2.p1);
        var absD = Vec2.abs(d2);
        var normal3 = Vec2.zero();
        {
          if (absD.x < EPSILON) {
            if (p.x < this.lowerBound.x || this.upperBound.x < p.x) {
              return false;
            }
          } else {
            var inv_d = 1 / d2.x;
            var t1 = (this.lowerBound.x - p.x) * inv_d;
            var t2 = (this.upperBound.x - p.x) * inv_d;
            var s2 = -1;
            if (t1 > t2) {
              var temp3 = t1;
              t1 = t2;
              t2 = temp3;
              s2 = 1;
            }
            if (t1 > tmin) {
              normal3.setZero();
              normal3.x = s2;
              tmin = t1;
            }
            tmax = math_min$7(tmax, t2);
            if (tmin > tmax) {
              return false;
            }
          }
        }
        {
          if (absD.y < EPSILON) {
            if (p.y < this.lowerBound.y || this.upperBound.y < p.y) {
              return false;
            }
          } else {
            var inv_d = 1 / d2.y;
            var t1 = (this.lowerBound.y - p.y) * inv_d;
            var t2 = (this.upperBound.y - p.y) * inv_d;
            var s2 = -1;
            if (t1 > t2) {
              var temp3 = t1;
              t1 = t2;
              t2 = temp3;
              s2 = 1;
            }
            if (t1 > tmin) {
              normal3.setZero();
              normal3.y = s2;
              tmin = t1;
            }
            tmax = math_min$7(tmax, t2);
            if (tmin > tmax) {
              return false;
            }
          }
        }
        if (tmin < 0 || input2.maxFraction < tmin) {
          return false;
        }
        output2.fraction = tmin;
        output2.normal = normal3;
        return true;
      };
      AABB2.prototype.toString = function() {
        return JSON.stringify(this);
      };
      AABB2.combinePoints = function(out, a2, b2) {
        out.lowerBound.x = math_min$7(a2.x, b2.x);
        out.lowerBound.y = math_min$7(a2.y, b2.y);
        out.upperBound.x = math_max$7(a2.x, b2.x);
        out.upperBound.y = math_max$7(a2.y, b2.y);
        return out;
      };
      AABB2.combinedPerimeter = function(a2, b2) {
        var lx = math_min$7(a2.lowerBound.x, b2.lowerBound.x);
        var ly = math_min$7(a2.lowerBound.y, b2.lowerBound.y);
        var ux = math_max$7(a2.upperBound.x, b2.upperBound.x);
        var uy = math_max$7(a2.upperBound.y, b2.upperBound.y);
        return 2 * (ux - lx + uy - ly);
      };
      return AABB2;
    })()
  );
  var math_PI$6 = Math.PI;
  var Settings = (
    /** @class */
    (function() {
      function Settings2() {
      }
      Object.defineProperty(Settings2, "polygonRadius", {
        /**
         * The radius of the polygon/edge shape skin. This should not be modified.
         * Making this smaller means polygons will have an insufficient buffer for
         * continuous collision. Making it larger may create artifacts for vertex
         * collision.
         */
        get: function() {
          return 2 * Settings2.linearSlop;
        },
        enumerable: false,
        configurable: true
      });
      Settings2.lengthUnitsPerMeter = 1;
      Settings2.maxManifoldPoints = 2;
      Settings2.maxPolygonVertices = 12;
      Settings2.aabbExtension = 0.1;
      Settings2.aabbMultiplier = 2;
      Settings2.linearSlop = 5e-3;
      Settings2.angularSlop = 2 / 180 * math_PI$6;
      Settings2.maxSubSteps = 8;
      Settings2.maxTOIContacts = 32;
      Settings2.maxTOIIterations = 20;
      Settings2.maxDistanceIterations = 20;
      Settings2.velocityThreshold = 1;
      Settings2.maxLinearCorrection = 0.2;
      Settings2.maxAngularCorrection = 8 / 180 * math_PI$6;
      Settings2.maxTranslation = 2;
      Settings2.maxRotation = 0.5 * math_PI$6;
      Settings2.baumgarte = 0.2;
      Settings2.toiBaugarte = 0.75;
      Settings2.timeToSleep = 0.5;
      Settings2.linearSleepTolerance = 0.01;
      Settings2.angularSleepTolerance = 2 / 180 * math_PI$6;
      return Settings2;
    })()
  );
  var SettingsInternal = (
    /** @class */
    (function() {
      function SettingsInternal2() {
      }
      Object.defineProperty(SettingsInternal2, "maxManifoldPoints", {
        get: function() {
          return Settings.maxManifoldPoints;
        },
        enumerable: false,
        configurable: true
      });
      Object.defineProperty(SettingsInternal2, "maxPolygonVertices", {
        get: function() {
          return Settings.maxPolygonVertices;
        },
        enumerable: false,
        configurable: true
      });
      Object.defineProperty(SettingsInternal2, "aabbExtension", {
        get: function() {
          return Settings.aabbExtension * Settings.lengthUnitsPerMeter;
        },
        enumerable: false,
        configurable: true
      });
      Object.defineProperty(SettingsInternal2, "aabbMultiplier", {
        get: function() {
          return Settings.aabbMultiplier;
        },
        enumerable: false,
        configurable: true
      });
      Object.defineProperty(SettingsInternal2, "linearSlop", {
        get: function() {
          return Settings.linearSlop * Settings.lengthUnitsPerMeter;
        },
        enumerable: false,
        configurable: true
      });
      Object.defineProperty(SettingsInternal2, "linearSlopSquared", {
        get: function() {
          return Settings.linearSlop * Settings.lengthUnitsPerMeter * Settings.linearSlop * Settings.lengthUnitsPerMeter;
        },
        enumerable: false,
        configurable: true
      });
      Object.defineProperty(SettingsInternal2, "angularSlop", {
        get: function() {
          return Settings.angularSlop;
        },
        enumerable: false,
        configurable: true
      });
      Object.defineProperty(SettingsInternal2, "polygonRadius", {
        get: function() {
          return 2 * Settings.linearSlop;
        },
        enumerable: false,
        configurable: true
      });
      Object.defineProperty(SettingsInternal2, "maxSubSteps", {
        get: function() {
          return Settings.maxSubSteps;
        },
        enumerable: false,
        configurable: true
      });
      Object.defineProperty(SettingsInternal2, "maxTOIContacts", {
        get: function() {
          return Settings.maxTOIContacts;
        },
        enumerable: false,
        configurable: true
      });
      Object.defineProperty(SettingsInternal2, "maxTOIIterations", {
        get: function() {
          return Settings.maxTOIIterations;
        },
        enumerable: false,
        configurable: true
      });
      Object.defineProperty(SettingsInternal2, "maxDistanceIterations", {
        get: function() {
          return Settings.maxDistanceIterations;
        },
        enumerable: false,
        configurable: true
      });
      Object.defineProperty(SettingsInternal2, "velocityThreshold", {
        get: function() {
          return Settings.velocityThreshold * Settings.lengthUnitsPerMeter;
        },
        enumerable: false,
        configurable: true
      });
      Object.defineProperty(SettingsInternal2, "maxLinearCorrection", {
        get: function() {
          return Settings.maxLinearCorrection * Settings.lengthUnitsPerMeter;
        },
        enumerable: false,
        configurable: true
      });
      Object.defineProperty(SettingsInternal2, "maxAngularCorrection", {
        get: function() {
          return Settings.maxAngularCorrection;
        },
        enumerable: false,
        configurable: true
      });
      Object.defineProperty(SettingsInternal2, "maxTranslation", {
        get: function() {
          return Settings.maxTranslation * Settings.lengthUnitsPerMeter;
        },
        enumerable: false,
        configurable: true
      });
      Object.defineProperty(SettingsInternal2, "maxTranslationSquared", {
        get: function() {
          return Settings.maxTranslation * Settings.lengthUnitsPerMeter * Settings.maxTranslation * Settings.lengthUnitsPerMeter;
        },
        enumerable: false,
        configurable: true
      });
      Object.defineProperty(SettingsInternal2, "maxRotation", {
        get: function() {
          return Settings.maxRotation;
        },
        enumerable: false,
        configurable: true
      });
      Object.defineProperty(SettingsInternal2, "maxRotationSquared", {
        get: function() {
          return Settings.maxRotation * Settings.maxRotation;
        },
        enumerable: false,
        configurable: true
      });
      Object.defineProperty(SettingsInternal2, "baumgarte", {
        get: function() {
          return Settings.baumgarte;
        },
        enumerable: false,
        configurable: true
      });
      Object.defineProperty(SettingsInternal2, "toiBaugarte", {
        get: function() {
          return Settings.toiBaugarte;
        },
        enumerable: false,
        configurable: true
      });
      Object.defineProperty(SettingsInternal2, "timeToSleep", {
        get: function() {
          return Settings.timeToSleep;
        },
        enumerable: false,
        configurable: true
      });
      Object.defineProperty(SettingsInternal2, "linearSleepTolerance", {
        get: function() {
          return Settings.linearSleepTolerance * Settings.lengthUnitsPerMeter;
        },
        enumerable: false,
        configurable: true
      });
      Object.defineProperty(SettingsInternal2, "linearSleepToleranceSqr", {
        get: function() {
          return Settings.linearSleepTolerance * Settings.lengthUnitsPerMeter * Settings.linearSleepTolerance * Settings.lengthUnitsPerMeter;
        },
        enumerable: false,
        configurable: true
      });
      Object.defineProperty(SettingsInternal2, "angularSleepTolerance", {
        get: function() {
          return Settings.angularSleepTolerance;
        },
        enumerable: false,
        configurable: true
      });
      Object.defineProperty(SettingsInternal2, "angularSleepToleranceSqr", {
        get: function() {
          return Settings.angularSleepTolerance * Settings.angularSleepTolerance;
        },
        enumerable: false,
        configurable: true
      });
      return SettingsInternal2;
    })()
  );
  var Pool = (
    /** @class */
    (function() {
      function Pool2(opts) {
        this._list = [];
        this._max = Infinity;
        this._hasCreateFn = false;
        this._createCount = 0;
        this._hasAllocateFn = false;
        this._allocateCount = 0;
        this._hasReleaseFn = false;
        this._releaseCount = 0;
        this._hasDisposeFn = false;
        this._disposeCount = 0;
        this._list = [];
        this._max = opts.max || this._max;
        this._createFn = opts.create;
        this._hasCreateFn = typeof this._createFn === "function";
        this._allocateFn = opts.allocate;
        this._hasAllocateFn = typeof this._allocateFn === "function";
        this._releaseFn = opts.release;
        this._hasReleaseFn = typeof this._releaseFn === "function";
        this._disposeFn = opts.dispose;
        this._hasDisposeFn = typeof this._disposeFn === "function";
      }
      Pool2.prototype.max = function(n2) {
        if (typeof n2 === "number") {
          this._max = n2;
          return this;
        }
        return this._max;
      };
      Pool2.prototype.size = function() {
        return this._list.length;
      };
      Pool2.prototype.allocate = function() {
        var item;
        if (this._list.length > 0) {
          item = this._list.shift();
        } else {
          this._createCount++;
          if (this._hasCreateFn) {
            item = this._createFn();
          } else {
            item = {};
          }
        }
        this._allocateCount++;
        if (this._hasAllocateFn) {
          this._allocateFn(item);
        }
        return item;
      };
      Pool2.prototype.release = function(item) {
        if (this._list.length < this._max) {
          this._releaseCount++;
          if (this._hasReleaseFn) {
            this._releaseFn(item);
          }
          this._list.push(item);
        } else {
          this._disposeCount++;
          if (this._hasDisposeFn) {
            item = this._disposeFn(item);
          }
        }
      };
      Pool2.prototype.toString = function() {
        return " +" + this._createCount + " >" + this._allocateCount + " <" + this._releaseCount + " -" + this._disposeCount + " =" + this._list.length + "/" + this._max;
      };
      return Pool2;
    })()
  );
  var math_abs$8 = Math.abs;
  var math_max$6 = Math.max;
  var TreeNode = (
    /** @class */
    (function() {
      function TreeNode2(id) {
        this.aabb = new AABB();
        this.userData = null;
        this.parent = null;
        this.child1 = null;
        this.child2 = null;
        this.height = -1;
        this.id = id;
      }
      TreeNode2.prototype.toString = function() {
        return this.id + ": " + this.userData;
      };
      TreeNode2.prototype.isLeaf = function() {
        return this.child1 == null;
      };
      return TreeNode2;
    })()
  );
  var poolTreeNode = new Pool({
    create: function() {
      return new TreeNode();
    },
    release: function(node) {
      node.userData = null;
      node.parent = null;
      node.child1 = null;
      node.child2 = null;
      node.height = -1;
      node.id = void 0;
    }
  });
  var DynamicTree = (
    /** @class */
    (function() {
      function DynamicTree2() {
        this.inputPool = new Pool({
          create: function() {
            return {};
          },
          release: function(stack) {
          }
        });
        this.stackPool = new Pool({
          create: function() {
            return [];
          },
          release: function(stack) {
            stack.length = 0;
          }
        });
        this.iteratorPool = new Pool({
          create: function() {
            return new Iterator();
          },
          release: function(iterator) {
            iterator.close();
          }
        });
        this.m_root = null;
        this.m_nodes = {};
        this.m_lastProxyId = 0;
      }
      DynamicTree2.prototype.getUserData = function(id) {
        var node = this.m_nodes[id];
        return node.userData;
      };
      DynamicTree2.prototype.getFatAABB = function(id) {
        var node = this.m_nodes[id];
        return node.aabb;
      };
      DynamicTree2.prototype.allocateNode = function() {
        var node = poolTreeNode.allocate();
        node.id = ++this.m_lastProxyId;
        this.m_nodes[node.id] = node;
        return node;
      };
      DynamicTree2.prototype.freeNode = function(node) {
        delete this.m_nodes[node.id];
        poolTreeNode.release(node);
      };
      DynamicTree2.prototype.createProxy = function(aabb, userData) {
        var node = this.allocateNode();
        node.aabb.set(aabb);
        AABB.extend(node.aabb, SettingsInternal.aabbExtension);
        node.userData = userData;
        node.height = 0;
        this.insertLeaf(node);
        return node.id;
      };
      DynamicTree2.prototype.destroyProxy = function(id) {
        var node = this.m_nodes[id];
        this.removeLeaf(node);
        this.freeNode(node);
      };
      DynamicTree2.prototype.moveProxy = function(id, aabb, d2) {
        var node = this.m_nodes[id];
        if (node.aabb.contains(aabb)) {
          return false;
        }
        this.removeLeaf(node);
        node.aabb.set(aabb);
        aabb = node.aabb;
        AABB.extend(aabb, SettingsInternal.aabbExtension);
        if (d2.x < 0) {
          aabb.lowerBound.x += d2.x * SettingsInternal.aabbMultiplier;
        } else {
          aabb.upperBound.x += d2.x * SettingsInternal.aabbMultiplier;
        }
        if (d2.y < 0) {
          aabb.lowerBound.y += d2.y * SettingsInternal.aabbMultiplier;
        } else {
          aabb.upperBound.y += d2.y * SettingsInternal.aabbMultiplier;
        }
        this.insertLeaf(node);
        return true;
      };
      DynamicTree2.prototype.insertLeaf = function(leaf) {
        if (this.m_root == null) {
          this.m_root = leaf;
          this.m_root.parent = null;
          return;
        }
        var leafAABB = leaf.aabb;
        var index = this.m_root;
        while (!index.isLeaf()) {
          var child1 = index.child1;
          var child2 = index.child2;
          var area = index.aabb.getPerimeter();
          var combinedArea = AABB.combinedPerimeter(index.aabb, leafAABB);
          var cost = 2 * combinedArea;
          var inheritanceCost = 2 * (combinedArea - area);
          var newArea1 = AABB.combinedPerimeter(leafAABB, child1.aabb);
          var cost1 = newArea1 + inheritanceCost;
          if (!child1.isLeaf()) {
            var oldArea = child1.aabb.getPerimeter();
            cost1 -= oldArea;
          }
          var newArea2 = AABB.combinedPerimeter(leafAABB, child2.aabb);
          var cost2 = newArea2 + inheritanceCost;
          if (!child2.isLeaf()) {
            var oldArea = child2.aabb.getPerimeter();
            cost2 -= oldArea;
          }
          if (cost < cost1 && cost < cost2) {
            break;
          }
          if (cost1 < cost2) {
            index = child1;
          } else {
            index = child2;
          }
        }
        var sibling = index;
        var oldParent = sibling.parent;
        var newParent = this.allocateNode();
        newParent.parent = oldParent;
        newParent.userData = null;
        newParent.aabb.combine(leafAABB, sibling.aabb);
        newParent.height = sibling.height + 1;
        if (oldParent != null) {
          if (oldParent.child1 === sibling) {
            oldParent.child1 = newParent;
          } else {
            oldParent.child2 = newParent;
          }
          newParent.child1 = sibling;
          newParent.child2 = leaf;
          sibling.parent = newParent;
          leaf.parent = newParent;
        } else {
          newParent.child1 = sibling;
          newParent.child2 = leaf;
          sibling.parent = newParent;
          leaf.parent = newParent;
          this.m_root = newParent;
        }
        index = leaf.parent;
        while (index != null) {
          index = this.balance(index);
          var child1 = index.child1;
          var child2 = index.child2;
          index.height = 1 + math_max$6(child1.height, child2.height);
          index.aabb.combine(child1.aabb, child2.aabb);
          index = index.parent;
        }
      };
      DynamicTree2.prototype.removeLeaf = function(leaf) {
        if (leaf === this.m_root) {
          this.m_root = null;
          return;
        }
        var parent = leaf.parent;
        var grandParent = parent.parent;
        var sibling;
        if (parent.child1 === leaf) {
          sibling = parent.child2;
        } else {
          sibling = parent.child1;
        }
        if (grandParent != null) {
          if (grandParent.child1 === parent) {
            grandParent.child1 = sibling;
          } else {
            grandParent.child2 = sibling;
          }
          sibling.parent = grandParent;
          this.freeNode(parent);
          var index = grandParent;
          while (index != null) {
            index = this.balance(index);
            var child1 = index.child1;
            var child2 = index.child2;
            index.aabb.combine(child1.aabb, child2.aabb);
            index.height = 1 + math_max$6(child1.height, child2.height);
            index = index.parent;
          }
        } else {
          this.m_root = sibling;
          sibling.parent = null;
          this.freeNode(parent);
        }
      };
      DynamicTree2.prototype.balance = function(iA) {
        var A = iA;
        if (A.isLeaf() || A.height < 2) {
          return iA;
        }
        var B = A.child1;
        var C = A.child2;
        var balance = C.height - B.height;
        if (balance > 1) {
          var F = C.child1;
          var G = C.child2;
          C.child1 = A;
          C.parent = A.parent;
          A.parent = C;
          if (C.parent != null) {
            if (C.parent.child1 === iA) {
              C.parent.child1 = C;
            } else {
              C.parent.child2 = C;
            }
          } else {
            this.m_root = C;
          }
          if (F.height > G.height) {
            C.child2 = F;
            A.child2 = G;
            G.parent = A;
            A.aabb.combine(B.aabb, G.aabb);
            C.aabb.combine(A.aabb, F.aabb);
            A.height = 1 + math_max$6(B.height, G.height);
            C.height = 1 + math_max$6(A.height, F.height);
          } else {
            C.child2 = G;
            A.child2 = F;
            F.parent = A;
            A.aabb.combine(B.aabb, F.aabb);
            C.aabb.combine(A.aabb, G.aabb);
            A.height = 1 + math_max$6(B.height, F.height);
            C.height = 1 + math_max$6(A.height, G.height);
          }
          return C;
        }
        if (balance < -1) {
          var D = B.child1;
          var E = B.child2;
          B.child1 = A;
          B.parent = A.parent;
          A.parent = B;
          if (B.parent != null) {
            if (B.parent.child1 === A) {
              B.parent.child1 = B;
            } else {
              B.parent.child2 = B;
            }
          } else {
            this.m_root = B;
          }
          if (D.height > E.height) {
            B.child2 = D;
            A.child1 = E;
            E.parent = A;
            A.aabb.combine(C.aabb, E.aabb);
            B.aabb.combine(A.aabb, D.aabb);
            A.height = 1 + math_max$6(C.height, E.height);
            B.height = 1 + math_max$6(A.height, D.height);
          } else {
            B.child2 = E;
            A.child1 = D;
            D.parent = A;
            A.aabb.combine(C.aabb, D.aabb);
            B.aabb.combine(A.aabb, E.aabb);
            A.height = 1 + math_max$6(C.height, D.height);
            B.height = 1 + math_max$6(A.height, E.height);
          }
          return B;
        }
        return A;
      };
      DynamicTree2.prototype.getHeight = function() {
        if (this.m_root == null) {
          return 0;
        }
        return this.m_root.height;
      };
      DynamicTree2.prototype.getAreaRatio = function() {
        if (this.m_root == null) {
          return 0;
        }
        var root = this.m_root;
        var rootArea = root.aabb.getPerimeter();
        var totalArea = 0;
        var node;
        var it = this.iteratorPool.allocate().preorder(this.m_root);
        while (node = it.next()) {
          if (node.height < 0) {
            continue;
          }
          totalArea += node.aabb.getPerimeter();
        }
        this.iteratorPool.release(it);
        return totalArea / rootArea;
      };
      DynamicTree2.prototype.computeHeight = function(id) {
        var node;
        if (typeof id !== "undefined") {
          node = this.m_nodes[id];
        } else {
          node = this.m_root;
        }
        if (node.isLeaf()) {
          return 0;
        }
        var height1 = this.computeHeight(node.child1.id);
        var height2 = this.computeHeight(node.child2.id);
        return 1 + math_max$6(height1, height2);
      };
      DynamicTree2.prototype.validateStructure = function(node) {
        if (node == null) {
          return;
        }
        if (node === this.m_root) ;
        var child1 = node.child1;
        var child2 = node.child2;
        if (node.isLeaf()) {
          return;
        }
        this.validateStructure(child1);
        this.validateStructure(child2);
      };
      DynamicTree2.prototype.validateMetrics = function(node) {
        if (node == null) {
          return;
        }
        var child1 = node.child1;
        var child2 = node.child2;
        if (node.isLeaf()) {
          return;
        }
        this.validateMetrics(child1);
        this.validateMetrics(child2);
      };
      DynamicTree2.prototype.validate = function() {
        return;
      };
      DynamicTree2.prototype.getMaxBalance = function() {
        var maxBalance = 0;
        var node;
        var it = this.iteratorPool.allocate().preorder(this.m_root);
        while (node = it.next()) {
          if (node.height <= 1) {
            continue;
          }
          var balance = math_abs$8(node.child2.height - node.child1.height);
          maxBalance = math_max$6(maxBalance, balance);
        }
        this.iteratorPool.release(it);
        return maxBalance;
      };
      DynamicTree2.prototype.rebuildBottomUp = function() {
        var nodes = [];
        var count = 0;
        var node;
        var it = this.iteratorPool.allocate().preorder(this.m_root);
        while (node = it.next()) {
          if (node.height < 0) {
            continue;
          }
          if (node.isLeaf()) {
            node.parent = null;
            nodes[count] = node;
            ++count;
          } else {
            this.freeNode(node);
          }
        }
        this.iteratorPool.release(it);
        while (count > 1) {
          var minCost = Infinity;
          var iMin = -1;
          var jMin = -1;
          for (var i = 0; i < count; ++i) {
            var aabbi = nodes[i].aabb;
            for (var j = i + 1; j < count; ++j) {
              var aabbj = nodes[j].aabb;
              var cost = AABB.combinedPerimeter(aabbi, aabbj);
              if (cost < minCost) {
                iMin = i;
                jMin = j;
                minCost = cost;
              }
            }
          }
          var child1 = nodes[iMin];
          var child2 = nodes[jMin];
          var parent_1 = this.allocateNode();
          parent_1.child1 = child1;
          parent_1.child2 = child2;
          parent_1.height = 1 + math_max$6(child1.height, child2.height);
          parent_1.aabb.combine(child1.aabb, child2.aabb);
          parent_1.parent = null;
          child1.parent = parent_1;
          child2.parent = parent_1;
          nodes[jMin] = nodes[count - 1];
          nodes[iMin] = parent_1;
          --count;
        }
        this.m_root = nodes[0];
      };
      DynamicTree2.prototype.shiftOrigin = function(newOrigin) {
        var node;
        var it = this.iteratorPool.allocate().preorder(this.m_root);
        while (node = it.next()) {
          var aabb = node.aabb;
          aabb.lowerBound.x -= newOrigin.x;
          aabb.lowerBound.y -= newOrigin.y;
          aabb.upperBound.x -= newOrigin.x;
          aabb.upperBound.y -= newOrigin.y;
        }
        this.iteratorPool.release(it);
      };
      DynamicTree2.prototype.query = function(aabb, queryCallback) {
        var stack = this.stackPool.allocate();
        stack.push(this.m_root);
        while (stack.length > 0) {
          var node = stack.pop();
          if (node == null) {
            continue;
          }
          if (AABB.testOverlap(node.aabb, aabb)) {
            if (node.isLeaf()) {
              var proceed = queryCallback(node.id);
              if (proceed === false) {
                return;
              }
            } else {
              stack.push(node.child1);
              stack.push(node.child2);
            }
          }
        }
        this.stackPool.release(stack);
      };
      DynamicTree2.prototype.rayCast = function(input2, rayCastCallback) {
        var p1 = input2.p1;
        var p2 = input2.p2;
        var r = Vec2.sub(p2, p1);
        r.normalize();
        var v3 = Vec2.crossNumVec2(1, r);
        var abs_v = Vec2.abs(v3);
        var maxFraction = input2.maxFraction;
        var segmentAABB = new AABB();
        var t = Vec2.combine(1 - maxFraction, p1, maxFraction, p2);
        segmentAABB.combinePoints(p1, t);
        var stack = this.stackPool.allocate();
        var subInput = this.inputPool.allocate();
        stack.push(this.m_root);
        while (stack.length > 0) {
          var node = stack.pop();
          if (node == null) {
            continue;
          }
          if (AABB.testOverlap(node.aabb, segmentAABB) === false) {
            continue;
          }
          var c2 = node.aabb.getCenter();
          var h = node.aabb.getExtents();
          var separation = math_abs$8(Vec2.dot(v3, Vec2.sub(p1, c2))) - Vec2.dot(abs_v, h);
          if (separation > 0) {
            continue;
          }
          if (node.isLeaf()) {
            subInput.p1 = Vec2.clone(input2.p1);
            subInput.p2 = Vec2.clone(input2.p2);
            subInput.maxFraction = maxFraction;
            var value = rayCastCallback(subInput, node.id);
            if (value === 0) {
              break;
            } else if (value > 0) {
              maxFraction = value;
              t = Vec2.combine(1 - maxFraction, p1, maxFraction, p2);
              segmentAABB.combinePoints(p1, t);
            }
          } else {
            stack.push(node.child1);
            stack.push(node.child2);
          }
        }
        this.stackPool.release(stack);
        this.inputPool.release(subInput);
      };
      return DynamicTree2;
    })()
  );
  var Iterator = (
    /** @class */
    (function() {
      function Iterator2() {
        this.parents = [];
        this.states = [];
      }
      Iterator2.prototype.preorder = function(root) {
        this.parents.length = 0;
        this.parents.push(root);
        this.states.length = 0;
        this.states.push(0);
        return this;
      };
      Iterator2.prototype.next = function() {
        while (this.parents.length > 0) {
          var i = this.parents.length - 1;
          var node = this.parents[i];
          if (this.states[i] === 0) {
            this.states[i] = 1;
            return node;
          }
          if (this.states[i] === 1) {
            this.states[i] = 2;
            if (node.child1) {
              this.parents.push(node.child1);
              this.states.push(1);
              return node.child1;
            }
          }
          if (this.states[i] === 2) {
            this.states[i] = 3;
            if (node.child2) {
              this.parents.push(node.child2);
              this.states.push(1);
              return node.child2;
            }
          }
          this.parents.pop();
          this.states.pop();
        }
      };
      Iterator2.prototype.close = function() {
        this.parents.length = 0;
      };
      return Iterator2;
    })()
  );
  var math_max$5 = Math.max;
  var math_min$6 = Math.min;
  var BroadPhase = (
    /** @class */
    (function() {
      function BroadPhase2() {
        var _this = this;
        this.m_tree = new DynamicTree();
        this.m_moveBuffer = [];
        this.query = function(aabb, queryCallback) {
          _this.m_tree.query(aabb, queryCallback);
        };
        this.queryCallback = function(proxyId) {
          if (proxyId === _this.m_queryProxyId) {
            return true;
          }
          var proxyIdA = math_min$6(proxyId, _this.m_queryProxyId);
          var proxyIdB = math_max$5(proxyId, _this.m_queryProxyId);
          var userDataA = _this.m_tree.getUserData(proxyIdA);
          var userDataB = _this.m_tree.getUserData(proxyIdB);
          _this.m_callback(userDataA, userDataB);
          return true;
        };
      }
      BroadPhase2.prototype.getUserData = function(proxyId) {
        return this.m_tree.getUserData(proxyId);
      };
      BroadPhase2.prototype.testOverlap = function(proxyIdA, proxyIdB) {
        var aabbA = this.m_tree.getFatAABB(proxyIdA);
        var aabbB = this.m_tree.getFatAABB(proxyIdB);
        return AABB.testOverlap(aabbA, aabbB);
      };
      BroadPhase2.prototype.getFatAABB = function(proxyId) {
        return this.m_tree.getFatAABB(proxyId);
      };
      BroadPhase2.prototype.getProxyCount = function() {
        return this.m_moveBuffer.length;
      };
      BroadPhase2.prototype.getTreeHeight = function() {
        return this.m_tree.getHeight();
      };
      BroadPhase2.prototype.getTreeBalance = function() {
        return this.m_tree.getMaxBalance();
      };
      BroadPhase2.prototype.getTreeQuality = function() {
        return this.m_tree.getAreaRatio();
      };
      BroadPhase2.prototype.rayCast = function(input2, rayCastCallback) {
        this.m_tree.rayCast(input2, rayCastCallback);
      };
      BroadPhase2.prototype.shiftOrigin = function(newOrigin) {
        this.m_tree.shiftOrigin(newOrigin);
      };
      BroadPhase2.prototype.createProxy = function(aabb, userData) {
        var proxyId = this.m_tree.createProxy(aabb, userData);
        this.bufferMove(proxyId);
        return proxyId;
      };
      BroadPhase2.prototype.destroyProxy = function(proxyId) {
        this.unbufferMove(proxyId);
        this.m_tree.destroyProxy(proxyId);
      };
      BroadPhase2.prototype.moveProxy = function(proxyId, aabb, displacement2) {
        var changed = this.m_tree.moveProxy(proxyId, aabb, displacement2);
        if (changed) {
          this.bufferMove(proxyId);
        }
      };
      BroadPhase2.prototype.touchProxy = function(proxyId) {
        this.bufferMove(proxyId);
      };
      BroadPhase2.prototype.bufferMove = function(proxyId) {
        this.m_moveBuffer.push(proxyId);
      };
      BroadPhase2.prototype.unbufferMove = function(proxyId) {
        for (var i = 0; i < this.m_moveBuffer.length; ++i) {
          if (this.m_moveBuffer[i] === proxyId) {
            this.m_moveBuffer[i] = null;
          }
        }
      };
      BroadPhase2.prototype.updatePairs = function(addPairCallback) {
        this.m_callback = addPairCallback;
        while (this.m_moveBuffer.length > 0) {
          this.m_queryProxyId = this.m_moveBuffer.pop();
          if (this.m_queryProxyId === null) {
            continue;
          }
          var fatAABB = this.m_tree.getFatAABB(this.m_queryProxyId);
          this.m_tree.query(fatAABB, this.queryCallback);
        }
      };
      return BroadPhase2;
    })()
  );
  var math_sin$2 = Math.sin;
  var math_cos$2 = Math.cos;
  var math_sqrt$4 = Math.sqrt;
  function vec2(x2, y) {
    return { x: x2, y };
  }
  function rotation(angle) {
    return { s: math_sin$2(angle), c: math_cos$2(angle) };
  }
  function setVec2(out, x2, y) {
    out.x = x2;
    out.y = y;
    return out;
  }
  function copyVec2(out, w) {
    out.x = w.x;
    out.y = w.y;
    return out;
  }
  function zeroVec2(out) {
    out.x = 0;
    out.y = 0;
    return out;
  }
  function negVec2(out) {
    out.x = -out.x;
    out.y = -out.y;
    return out;
  }
  function plusVec2(out, w) {
    out.x += w.x;
    out.y += w.y;
    return out;
  }
  function addVec2(out, v3, w) {
    out.x = v3.x + w.x;
    out.y = v3.y + w.y;
    return out;
  }
  function minusVec2(out, w) {
    out.x -= w.x;
    out.y -= w.y;
    return out;
  }
  function subVec2(out, v3, w) {
    out.x = v3.x - w.x;
    out.y = v3.y - w.y;
    return out;
  }
  function mulVec2(out, m) {
    out.x *= m;
    out.y *= m;
    return out;
  }
  function scaleVec2(out, m, w) {
    out.x = m * w.x;
    out.y = m * w.y;
    return out;
  }
  function plusScaleVec2(out, m, w) {
    out.x += m * w.x;
    out.y += m * w.y;
    return out;
  }
  function minusScaleVec2(out, m, w) {
    out.x -= m * w.x;
    out.y -= m * w.y;
    return out;
  }
  function combine2Vec2(out, am, a2, bm, b2) {
    out.x = am * a2.x + bm * b2.x;
    out.y = am * a2.y + bm * b2.y;
    return out;
  }
  function combine3Vec2(out, am, a2, bm, b2, cm, c2) {
    out.x = am * a2.x + bm * b2.x + cm * c2.x;
    out.y = am * a2.y + bm * b2.y + cm * c2.y;
    return out;
  }
  function normalizeVec2Length(out) {
    var length = math_sqrt$4(out.x * out.x + out.y * out.y);
    if (length !== 0) {
      var invLength = 1 / length;
      out.x *= invLength;
      out.y *= invLength;
    }
    return length;
  }
  function normalizeVec2(out) {
    var length = math_sqrt$4(out.x * out.x + out.y * out.y);
    if (length > 0) {
      var invLength = 1 / length;
      out.x *= invLength;
      out.y *= invLength;
    }
    return out;
  }
  function crossVec2Num(out, v3, w) {
    var x2 = w * v3.y;
    var y = -w * v3.x;
    out.x = x2;
    out.y = y;
    return out;
  }
  function crossNumVec2(out, w, v3) {
    var x2 = -w * v3.y;
    var y = w * v3.x;
    out.x = x2;
    out.y = y;
    return out;
  }
  function crossVec2Vec2(a2, b2) {
    return a2.x * b2.y - a2.y * b2.x;
  }
  function dotVec2(a2, b2) {
    return a2.x * b2.x + a2.y * b2.y;
  }
  function lengthSqrVec2(a2) {
    return a2.x * a2.x + a2.y * a2.y;
  }
  function distVec2(a2, b2) {
    var dx = a2.x - b2.x;
    var dy = a2.y - b2.y;
    return math_sqrt$4(dx * dx + dy * dy);
  }
  function distSqrVec2(a2, b2) {
    var dx = a2.x - b2.x;
    var dy = a2.y - b2.y;
    return dx * dx + dy * dy;
  }
  function setRotAngle(out, a2) {
    out.c = math_cos$2(a2);
    out.s = math_sin$2(a2);
    return out;
  }
  function rotVec2(out, q, v3) {
    out.x = q.c * v3.x - q.s * v3.y;
    out.y = q.s * v3.x + q.c * v3.y;
    return out;
  }
  function derotVec2(out, q, v3) {
    var x2 = q.c * v3.x + q.s * v3.y;
    var y = -q.s * v3.x + q.c * v3.y;
    out.x = x2;
    out.y = y;
    return out;
  }
  function rerotVec2(out, before, after, v3) {
    var x0 = before.c * v3.x + before.s * v3.y;
    var y0 = -before.s * v3.x + before.c * v3.y;
    var x2 = after.c * x0 - after.s * y0;
    var y = after.s * x0 + after.c * y0;
    out.x = x2;
    out.y = y;
    return out;
  }
  function transform(x2, y, a2) {
    return { p: vec2(x2, y), q: rotation(a2) };
  }
  function copyTransform(out, transform2) {
    out.p.x = transform2.p.x;
    out.p.y = transform2.p.y;
    out.q.s = transform2.q.s;
    out.q.c = transform2.q.c;
    return out;
  }
  function transformVec2(out, xf2, v3) {
    var x2 = xf2.q.c * v3.x - xf2.q.s * v3.y + xf2.p.x;
    var y = xf2.q.s * v3.x + xf2.q.c * v3.y + xf2.p.y;
    out.x = x2;
    out.y = y;
    return out;
  }
  function detransformVec2(out, xf2, v3) {
    var px = v3.x - xf2.p.x;
    var py = v3.y - xf2.p.y;
    var x2 = xf2.q.c * px + xf2.q.s * py;
    var y = -xf2.q.s * px + xf2.q.c * py;
    out.x = x2;
    out.y = y;
    return out;
  }
  function retransformVec2(out, from, to, v3) {
    var x0 = from.q.c * v3.x - from.q.s * v3.y + from.p.x;
    var y0 = from.q.s * v3.x + from.q.c * v3.y + from.p.y;
    var px = x0 - to.p.x;
    var py = y0 - to.p.y;
    var x2 = to.q.c * px + to.q.s * py;
    var y = -to.q.s * px + to.q.c * py;
    out.x = x2;
    out.y = y;
    return out;
  }
  function detransformTransform(out, a2, b2) {
    var c2 = a2.q.c * b2.q.c + a2.q.s * b2.q.s;
    var s2 = a2.q.c * b2.q.s - a2.q.s * b2.q.c;
    var x2 = a2.q.c * (b2.p.x - a2.p.x) + a2.q.s * (b2.p.y - a2.p.y);
    var y = -a2.q.s * (b2.p.x - a2.p.x) + a2.q.c * (b2.p.y - a2.p.y);
    out.q.c = c2;
    out.q.s = s2;
    out.p.x = x2;
    out.p.y = y;
    return out;
  }
  var math_sin$1 = Math.sin;
  var math_cos$1 = Math.cos;
  var math_atan2$1 = Math.atan2;
  var Rot = (
    /** @class */
    (function() {
      function Rot2(angle) {
        if (!(this instanceof Rot2)) {
          return new Rot2(angle);
        }
        if (typeof angle === "number") {
          this.setAngle(angle);
        } else if (typeof angle === "object") {
          this.setRot(angle);
        } else {
          this.setIdentity();
        }
      }
      Rot2.neo = function(angle) {
        var obj = Object.create(Rot2.prototype);
        obj.setAngle(angle);
        return obj;
      };
      Rot2.clone = function(rot) {
        var obj = Object.create(Rot2.prototype);
        obj.s = rot.s;
        obj.c = rot.c;
        return obj;
      };
      Rot2.identity = function() {
        var obj = Object.create(Rot2.prototype);
        obj.s = 0;
        obj.c = 1;
        return obj;
      };
      Rot2.isValid = function(obj) {
        if (obj === null || typeof obj === "undefined") {
          return false;
        }
        return Number.isFinite(obj.s) && Number.isFinite(obj.c);
      };
      Rot2.assert = function(o) {
      };
      Rot2.prototype.setIdentity = function() {
        this.s = 0;
        this.c = 1;
      };
      Rot2.prototype.set = function(angle) {
        if (typeof angle === "object") {
          this.s = angle.s;
          this.c = angle.c;
        } else {
          this.s = math_sin$1(angle);
          this.c = math_cos$1(angle);
        }
      };
      Rot2.prototype.setRot = function(angle) {
        this.s = angle.s;
        this.c = angle.c;
      };
      Rot2.prototype.setAngle = function(angle) {
        this.s = math_sin$1(angle);
        this.c = math_cos$1(angle);
      };
      Rot2.prototype.getAngle = function() {
        return math_atan2$1(this.s, this.c);
      };
      Rot2.prototype.getXAxis = function() {
        return Vec2.neo(this.c, this.s);
      };
      Rot2.prototype.getYAxis = function() {
        return Vec2.neo(-this.s, this.c);
      };
      Rot2.mul = function(rot, m) {
        if ("c" in m && "s" in m) {
          var qr = Rot2.identity();
          qr.s = rot.s * m.c + rot.c * m.s;
          qr.c = rot.c * m.c - rot.s * m.s;
          return qr;
        } else if ("x" in m && "y" in m) {
          return Vec2.neo(rot.c * m.x - rot.s * m.y, rot.s * m.x + rot.c * m.y);
        }
      };
      Rot2.mulRot = function(rot, m) {
        var qr = Rot2.identity();
        qr.s = rot.s * m.c + rot.c * m.s;
        qr.c = rot.c * m.c - rot.s * m.s;
        return qr;
      };
      Rot2.mulVec2 = function(rot, m) {
        return Vec2.neo(rot.c * m.x - rot.s * m.y, rot.s * m.x + rot.c * m.y);
      };
      Rot2.mulSub = function(rot, v3, w) {
        var x2 = rot.c * (v3.x - w.x) - rot.s * (v3.y - w.y);
        var y = rot.s * (v3.x - w.x) + rot.c * (v3.y - w.y);
        return Vec2.neo(x2, y);
      };
      Rot2.mulT = function(rot, m) {
        if ("c" in m && "s" in m) {
          var qr = Rot2.identity();
          qr.s = rot.c * m.s - rot.s * m.c;
          qr.c = rot.c * m.c + rot.s * m.s;
          return qr;
        } else if ("x" in m && "y" in m) {
          return Vec2.neo(rot.c * m.x + rot.s * m.y, -rot.s * m.x + rot.c * m.y);
        }
      };
      Rot2.mulTRot = function(rot, m) {
        var qr = Rot2.identity();
        qr.s = rot.c * m.s - rot.s * m.c;
        qr.c = rot.c * m.c + rot.s * m.s;
        return qr;
      };
      Rot2.mulTVec2 = function(rot, m) {
        return Vec2.neo(rot.c * m.x + rot.s * m.y, -rot.s * m.x + rot.c * m.y);
      };
      return Rot2;
    })()
  );
  var math_atan2 = Math.atan2;
  var math_PI$5 = Math.PI;
  var temp$7 = vec2(0, 0);
  var Sweep = (
    /** @class */
    (function() {
      function Sweep2() {
        this.localCenter = Vec2.zero();
        this.c = Vec2.zero();
        this.a = 0;
        this.alpha0 = 0;
        this.c0 = Vec2.zero();
        this.a0 = 0;
      }
      Sweep2.prototype.recycle = function() {
        zeroVec2(this.localCenter);
        zeroVec2(this.c);
        this.a = 0;
        this.alpha0 = 0;
        zeroVec2(this.c0);
        this.a0 = 0;
      };
      Sweep2.prototype.setTransform = function(xf2) {
        transformVec2(temp$7, xf2, this.localCenter);
        copyVec2(this.c, temp$7);
        copyVec2(this.c0, temp$7);
        this.a = this.a0 = math_atan2(xf2.q.s, xf2.q.c);
      };
      Sweep2.prototype.setLocalCenter = function(localCenter2, xf2) {
        copyVec2(this.localCenter, localCenter2);
        transformVec2(temp$7, xf2, this.localCenter);
        copyVec2(this.c, temp$7);
        copyVec2(this.c0, temp$7);
      };
      Sweep2.prototype.getTransform = function(xf2, beta) {
        if (beta === void 0) {
          beta = 0;
        }
        setRotAngle(xf2.q, (1 - beta) * this.a0 + beta * this.a);
        combine2Vec2(xf2.p, 1 - beta, this.c0, beta, this.c);
        minusVec2(xf2.p, rotVec2(temp$7, xf2.q, this.localCenter));
      };
      Sweep2.prototype.advance = function(alpha) {
        var beta = (alpha - this.alpha0) / (1 - this.alpha0);
        combine2Vec2(this.c0, beta, this.c, 1 - beta, this.c0);
        this.a0 = beta * this.a + (1 - beta) * this.a0;
        this.alpha0 = alpha;
      };
      Sweep2.prototype.forward = function() {
        this.a0 = this.a;
        copyVec2(this.c0, this.c);
      };
      Sweep2.prototype.normalize = function() {
        var a0 = mod(this.a0, -math_PI$5, +math_PI$5);
        this.a -= this.a0 - a0;
        this.a0 = a0;
      };
      Sweep2.prototype.set = function(that) {
        copyVec2(this.localCenter, that.localCenter);
        copyVec2(this.c, that.c);
        this.a = that.a;
        this.alpha0 = that.alpha0;
        copyVec2(this.c0, that.c0);
        this.a0 = that.a0;
      };
      return Sweep2;
    })()
  );
  var Transform = (
    /** @class */
    (function() {
      function Transform2(position, rotation2) {
        if (!(this instanceof Transform2)) {
          return new Transform2(position, rotation2);
        }
        this.p = Vec2.zero();
        this.q = Rot.identity();
        if (typeof position !== "undefined") {
          this.p.setVec2(position);
        }
        if (typeof rotation2 !== "undefined") {
          this.q.setAngle(rotation2);
        }
      }
      Transform2.clone = function(xf2) {
        var obj = Object.create(Transform2.prototype);
        obj.p = Vec2.clone(xf2.p);
        obj.q = Rot.clone(xf2.q);
        return obj;
      };
      Transform2.neo = function(position, rotation2) {
        var obj = Object.create(Transform2.prototype);
        obj.p = Vec2.clone(position);
        obj.q = Rot.clone(rotation2);
        return obj;
      };
      Transform2.identity = function() {
        var obj = Object.create(Transform2.prototype);
        obj.p = Vec2.zero();
        obj.q = Rot.identity();
        return obj;
      };
      Transform2.prototype.setIdentity = function() {
        this.p.setZero();
        this.q.setIdentity();
      };
      Transform2.prototype.set = function(a2, b2) {
        if (typeof b2 === "undefined") {
          this.p.set(a2.p);
          this.q.set(a2.q);
        } else {
          this.p.set(a2);
          this.q.set(b2);
        }
      };
      Transform2.prototype.setNum = function(position, rotation2) {
        this.p.setVec2(position);
        this.q.setAngle(rotation2);
      };
      Transform2.prototype.setTransform = function(xf2) {
        this.p.setVec2(xf2.p);
        this.q.setRot(xf2.q);
      };
      Transform2.isValid = function(obj) {
        if (obj === null || typeof obj === "undefined") {
          return false;
        }
        return Vec2.isValid(obj.p) && Rot.isValid(obj.q);
      };
      Transform2.assert = function(o) {
      };
      Transform2.mul = function(a2, b2) {
        if (Array.isArray(b2)) {
          var arr = [];
          for (var i = 0; i < b2.length; i++) {
            arr[i] = Transform2.mul(a2, b2[i]);
          }
          return arr;
        } else if ("x" in b2 && "y" in b2) {
          return Transform2.mulVec2(a2, b2);
        } else if ("p" in b2 && "q" in b2) {
          return Transform2.mulXf(a2, b2);
        }
      };
      Transform2.mulAll = function(a2, b2) {
        var arr = [];
        for (var i = 0; i < b2.length; i++) {
          arr[i] = Transform2.mul(a2, b2[i]);
        }
        return arr;
      };
      Transform2.mulFn = function(a2) {
        return function(b2) {
          return Transform2.mul(a2, b2);
        };
      };
      Transform2.mulVec2 = function(a2, b2) {
        var x2 = a2.q.c * b2.x - a2.q.s * b2.y + a2.p.x;
        var y = a2.q.s * b2.x + a2.q.c * b2.y + a2.p.y;
        return Vec2.neo(x2, y);
      };
      Transform2.mulXf = function(a2, b2) {
        var xf2 = Transform2.identity();
        xf2.q = Rot.mulRot(a2.q, b2.q);
        xf2.p = Vec2.add(Rot.mulVec2(a2.q, b2.p), a2.p);
        return xf2;
      };
      Transform2.mulT = function(a2, b2) {
        if ("x" in b2 && "y" in b2) {
          return Transform2.mulTVec2(a2, b2);
        } else if ("p" in b2 && "q" in b2) {
          return Transform2.mulTXf(a2, b2);
        }
      };
      Transform2.mulTVec2 = function(a2, b2) {
        var px = b2.x - a2.p.x;
        var py = b2.y - a2.p.y;
        var x2 = a2.q.c * px + a2.q.s * py;
        var y = -a2.q.s * px + a2.q.c * py;
        return Vec2.neo(x2, y);
      };
      Transform2.mulTXf = function(a2, b2) {
        var xf2 = Transform2.identity();
        xf2.q.setRot(Rot.mulTRot(a2.q, b2.q));
        xf2.p.setVec2(Rot.mulTVec2(a2.q, Vec2.sub(b2.p, a2.p)));
        return xf2;
      };
      return Transform2;
    })()
  );
  var Velocity = (
    /** @class */
    /* @__PURE__ */ (function() {
      function Velocity2() {
        this.v = Vec2.zero();
        this.w = 0;
      }
      return Velocity2;
    })()
  );
  var math_sin = Math.sin;
  var math_cos = Math.cos;
  var Position = (
    /** @class */
    (function() {
      function Position2() {
        this.c = Vec2.zero();
        this.a = 0;
      }
      Position2.prototype.getTransform = function(xf2, p) {
        xf2.q.c = math_cos(this.a);
        xf2.q.s = math_sin(this.a);
        xf2.p.x = this.c.x - (xf2.q.c * p.x - xf2.q.s * p.y);
        xf2.p.y = this.c.y - (xf2.q.s * p.x + xf2.q.c * p.y);
        return xf2;
      };
      return Position2;
    })()
  );
  function getTransform(xf2, p, c2, a2) {
    xf2.q.c = math_cos(a2);
    xf2.q.s = math_sin(a2);
    xf2.p.x = c2.x - (xf2.q.c * p.x - xf2.q.s * p.y);
    xf2.p.y = c2.y - (xf2.q.s * p.x + xf2.q.c * p.y);
    return xf2;
  }
  var Shape = (
    /** @class */
    (function() {
      function Shape2() {
        this.style = {};
        this.appData = {};
      }
      Shape2.isValid = function(obj) {
        if (obj === null || typeof obj === "undefined") {
          return false;
        }
        return typeof obj.m_type === "string" && typeof obj.m_radius === "number";
      };
      return Shape2;
    })()
  );
  var synchronize_aabb1 = new AABB();
  var synchronize_aabb2 = new AABB();
  var displacement = vec2(0, 0);
  var FixtureDefDefault = {
    userData: null,
    friction: 0.2,
    restitution: 0,
    density: 0,
    isSensor: false,
    filterGroupIndex: 0,
    filterCategoryBits: 1,
    filterMaskBits: 65535
  };
  var FixtureProxy = (
    /** @class */
    /* @__PURE__ */ (function() {
      function FixtureProxy2(fixture, childIndex) {
        this.aabb = new AABB();
        this.fixture = fixture;
        this.childIndex = childIndex;
      }
      return FixtureProxy2;
    })()
  );
  var Fixture = (
    /** @class */
    (function() {
      function Fixture2(body, shape, def) {
        this.style = {};
        this.appData = {};
        if (shape.shape) {
          def = shape;
          shape = shape.shape;
        } else if (typeof def === "number") {
          def = { density: def };
        }
        def = options(def, FixtureDefDefault);
        this.m_body = body;
        this.m_friction = def.friction;
        this.m_restitution = def.restitution;
        this.m_density = def.density;
        this.m_isSensor = def.isSensor;
        this.m_filterGroupIndex = def.filterGroupIndex;
        this.m_filterCategoryBits = def.filterCategoryBits;
        this.m_filterMaskBits = def.filterMaskBits;
        this.m_shape = shape;
        this.m_next = null;
        this.m_proxies = [];
        this.m_proxyCount = 0;
        var childCount = this.m_shape.getChildCount();
        for (var i = 0; i < childCount; ++i) {
          this.m_proxies[i] = new FixtureProxy(this, i);
        }
        this.m_userData = def.userData;
        if (typeof def.style === "object" && def.style !== null) {
          this.style = def.style;
        }
      }
      Fixture2.prototype._reset = function() {
        var body = this.getBody();
        var broadPhase = body.m_world.m_broadPhase;
        this.destroyProxies(broadPhase);
        if (this.m_shape._reset) {
          this.m_shape._reset();
        }
        var childCount = this.m_shape.getChildCount();
        for (var i = 0; i < childCount; ++i) {
          this.m_proxies[i] = new FixtureProxy(this, i);
        }
        this.createProxies(broadPhase, body.m_xf);
        body.resetMassData();
      };
      Fixture2.prototype._serialize = function() {
        return {
          friction: this.m_friction,
          restitution: this.m_restitution,
          density: this.m_density,
          isSensor: this.m_isSensor,
          filterGroupIndex: this.m_filterGroupIndex,
          filterCategoryBits: this.m_filterCategoryBits,
          filterMaskBits: this.m_filterMaskBits,
          shape: this.m_shape
        };
      };
      Fixture2._deserialize = function(data, body, restore) {
        var shape = restore(Shape, data.shape);
        var fixture = shape && new Fixture2(body, shape, data);
        return fixture;
      };
      Fixture2.prototype.getType = function() {
        return this.m_shape.m_type;
      };
      Fixture2.prototype.getShape = function() {
        return this.m_shape;
      };
      Fixture2.prototype.isSensor = function() {
        return this.m_isSensor;
      };
      Fixture2.prototype.setSensor = function(sensor) {
        if (sensor != this.m_isSensor) {
          this.m_body.setAwake(true);
          this.m_isSensor = sensor;
        }
      };
      Fixture2.prototype.getUserData = function() {
        return this.m_userData;
      };
      Fixture2.prototype.setUserData = function(data) {
        this.m_userData = data;
      };
      Fixture2.prototype.getBody = function() {
        return this.m_body;
      };
      Fixture2.prototype.getNext = function() {
        return this.m_next;
      };
      Fixture2.prototype.getDensity = function() {
        return this.m_density;
      };
      Fixture2.prototype.setDensity = function(density) {
        this.m_density = density;
      };
      Fixture2.prototype.getFriction = function() {
        return this.m_friction;
      };
      Fixture2.prototype.setFriction = function(friction) {
        this.m_friction = friction;
      };
      Fixture2.prototype.getRestitution = function() {
        return this.m_restitution;
      };
      Fixture2.prototype.setRestitution = function(restitution) {
        this.m_restitution = restitution;
      };
      Fixture2.prototype.testPoint = function(p) {
        return this.m_shape.testPoint(this.m_body.getTransform(), p);
      };
      Fixture2.prototype.rayCast = function(output2, input2, childIndex) {
        return this.m_shape.rayCast(output2, input2, this.m_body.getTransform(), childIndex);
      };
      Fixture2.prototype.getMassData = function(massData) {
        this.m_shape.computeMass(massData, this.m_density);
      };
      Fixture2.prototype.getAABB = function(childIndex) {
        return this.m_proxies[childIndex].aabb;
      };
      Fixture2.prototype.createProxies = function(broadPhase, xf2) {
        this.m_proxyCount = this.m_shape.getChildCount();
        for (var i = 0; i < this.m_proxyCount; ++i) {
          var proxy = this.m_proxies[i];
          this.m_shape.computeAABB(proxy.aabb, xf2, i);
          proxy.proxyId = broadPhase.createProxy(proxy.aabb, proxy);
        }
      };
      Fixture2.prototype.destroyProxies = function(broadPhase) {
        for (var i = 0; i < this.m_proxyCount; ++i) {
          var proxy = this.m_proxies[i];
          broadPhase.destroyProxy(proxy.proxyId);
          proxy.proxyId = null;
        }
        this.m_proxyCount = 0;
      };
      Fixture2.prototype.synchronize = function(broadPhase, xf1, xf2) {
        for (var i = 0; i < this.m_proxyCount; ++i) {
          var proxy = this.m_proxies[i];
          this.m_shape.computeAABB(synchronize_aabb1, xf1, proxy.childIndex);
          this.m_shape.computeAABB(synchronize_aabb2, xf2, proxy.childIndex);
          proxy.aabb.combine(synchronize_aabb1, synchronize_aabb2);
          subVec2(displacement, xf2.p, xf1.p);
          broadPhase.moveProxy(proxy.proxyId, proxy.aabb, displacement);
        }
      };
      Fixture2.prototype.setFilterData = function(filter) {
        this.m_filterGroupIndex = filter.groupIndex;
        this.m_filterCategoryBits = filter.categoryBits;
        this.m_filterMaskBits = filter.maskBits;
        this.refilter();
      };
      Fixture2.prototype.getFilterGroupIndex = function() {
        return this.m_filterGroupIndex;
      };
      Fixture2.prototype.setFilterGroupIndex = function(groupIndex) {
        this.m_filterGroupIndex = groupIndex;
        this.refilter();
      };
      Fixture2.prototype.getFilterCategoryBits = function() {
        return this.m_filterCategoryBits;
      };
      Fixture2.prototype.setFilterCategoryBits = function(categoryBits) {
        this.m_filterCategoryBits = categoryBits;
        this.refilter();
      };
      Fixture2.prototype.getFilterMaskBits = function() {
        return this.m_filterMaskBits;
      };
      Fixture2.prototype.setFilterMaskBits = function(maskBits) {
        this.m_filterMaskBits = maskBits;
        this.refilter();
      };
      Fixture2.prototype.refilter = function() {
        if (this.m_body == null) {
          return;
        }
        var edge = this.m_body.getContactList();
        while (edge) {
          var contact = edge.contact;
          var fixtureA = contact.getFixtureA();
          var fixtureB = contact.getFixtureB();
          if (fixtureA == this || fixtureB == this) {
            contact.flagForFiltering();
          }
          edge = edge.next;
        }
        var world = this.m_body.getWorld();
        if (world == null) {
          return;
        }
        var broadPhase = world.m_broadPhase;
        for (var i = 0; i < this.m_proxyCount; ++i) {
          broadPhase.touchProxy(this.m_proxies[i].proxyId);
        }
      };
      Fixture2.prototype.shouldCollide = function(that) {
        if (that.m_filterGroupIndex === this.m_filterGroupIndex && that.m_filterGroupIndex !== 0) {
          return that.m_filterGroupIndex > 0;
        }
        var collideA = (that.m_filterMaskBits & this.m_filterCategoryBits) !== 0;
        var collideB = (that.m_filterCategoryBits & this.m_filterMaskBits) !== 0;
        var collide = collideA && collideB;
        return collide;
      };
      return Fixture2;
    })()
  );
  var STATIC = "static";
  var KINEMATIC = "kinematic";
  var DYNAMIC = "dynamic";
  var oldCenter = vec2(0, 0);
  var localCenter = vec2(0, 0);
  var shift = vec2(0, 0);
  var temp$6 = vec2(0, 0);
  var xf$2 = transform(0, 0, 0);
  var BodyDefDefault = {
    type: STATIC,
    position: Vec2.zero(),
    angle: 0,
    linearVelocity: Vec2.zero(),
    angularVelocity: 0,
    linearDamping: 0,
    angularDamping: 0,
    fixedRotation: false,
    bullet: false,
    gravityScale: 1,
    allowSleep: true,
    awake: true,
    active: true,
    userData: null
  };
  var Body = (
    /** @class */
    (function() {
      function Body2(world, def) {
        this.style = {};
        this.appData = {};
        def = options(def, BodyDefDefault);
        this.m_world = world;
        this.m_awakeFlag = def.awake;
        this.m_autoSleepFlag = def.allowSleep;
        this.m_bulletFlag = def.bullet;
        this.m_fixedRotationFlag = def.fixedRotation;
        this.m_activeFlag = def.active;
        this.m_islandFlag = false;
        this.m_toiFlag = false;
        this.m_userData = def.userData;
        this.m_type = def.type;
        if (this.m_type == DYNAMIC) {
          this.m_mass = 1;
          this.m_invMass = 1;
        } else {
          this.m_mass = 0;
          this.m_invMass = 0;
        }
        this.m_I = 0;
        this.m_invI = 0;
        this.m_xf = Transform.identity();
        this.m_xf.p.setVec2(def.position);
        this.m_xf.q.setAngle(def.angle);
        this.m_sweep = new Sweep();
        this.m_sweep.setTransform(this.m_xf);
        this.c_velocity = new Velocity();
        this.c_position = new Position();
        this.m_force = Vec2.zero();
        this.m_torque = 0;
        this.m_linearVelocity = Vec2.clone(def.linearVelocity);
        this.m_angularVelocity = def.angularVelocity;
        this.m_linearDamping = def.linearDamping;
        this.m_angularDamping = def.angularDamping;
        this.m_gravityScale = def.gravityScale;
        this.m_sleepTime = 0;
        this.m_jointList = null;
        this.m_contactList = null;
        this.m_fixtureList = null;
        this.m_prev = null;
        this.m_next = null;
        this.m_destroyed = false;
        if (typeof def.style === "object" && def.style !== null) {
          this.style = def.style;
        }
      }
      Body2.prototype._serialize = function() {
        var fixtures = [];
        for (var f = this.m_fixtureList; f; f = f.m_next) {
          fixtures.push(f);
        }
        return {
          type: this.m_type,
          bullet: this.m_bulletFlag,
          fixedRotation: this.m_fixedRotationFlag,
          position: this.m_xf.p,
          angle: this.m_xf.q.getAngle(),
          linearVelocity: this.m_linearVelocity,
          angularVelocity: this.m_angularVelocity,
          fixtures
        };
      };
      Body2._deserialize = function(data, world, restore) {
        var body = new Body2(world, data);
        if (data.fixtures) {
          for (var i = data.fixtures.length - 1; i >= 0; i--) {
            var fixture = restore(Fixture, data.fixtures[i], body);
            body._addFixture(fixture);
          }
        }
        return body;
      };
      Body2.prototype.isWorldLocked = function() {
        return this.m_world && this.m_world.isLocked() ? true : false;
      };
      Body2.prototype.getWorld = function() {
        return this.m_world;
      };
      Body2.prototype.getNext = function() {
        return this.m_next;
      };
      Body2.prototype.setUserData = function(data) {
        this.m_userData = data;
      };
      Body2.prototype.getUserData = function() {
        return this.m_userData;
      };
      Body2.prototype.getFixtureList = function() {
        return this.m_fixtureList;
      };
      Body2.prototype.getJointList = function() {
        return this.m_jointList;
      };
      Body2.prototype.getContactList = function() {
        return this.m_contactList;
      };
      Body2.prototype.isStatic = function() {
        return this.m_type == STATIC;
      };
      Body2.prototype.isDynamic = function() {
        return this.m_type == DYNAMIC;
      };
      Body2.prototype.isKinematic = function() {
        return this.m_type == KINEMATIC;
      };
      Body2.prototype.setStatic = function() {
        this.setType(STATIC);
        return this;
      };
      Body2.prototype.setDynamic = function() {
        this.setType(DYNAMIC);
        return this;
      };
      Body2.prototype.setKinematic = function() {
        this.setType(KINEMATIC);
        return this;
      };
      Body2.prototype.getType = function() {
        return this.m_type;
      };
      Body2.prototype.setType = function(type) {
        if (this.isWorldLocked() == true) {
          return;
        }
        if (this.m_type == type) {
          return;
        }
        this.m_type = type;
        this.resetMassData();
        if (this.m_type == STATIC) {
          this.m_linearVelocity.setZero();
          this.m_angularVelocity = 0;
          this.m_sweep.forward();
          this.synchronizeFixtures();
        }
        this.setAwake(true);
        this.m_force.setZero();
        this.m_torque = 0;
        var ce = this.m_contactList;
        while (ce) {
          var ce0 = ce;
          ce = ce.next;
          this.m_world.destroyContact(ce0.contact);
        }
        this.m_contactList = null;
        var broadPhase = this.m_world.m_broadPhase;
        for (var f = this.m_fixtureList; f; f = f.m_next) {
          for (var i = 0; i < f.m_proxyCount; ++i) {
            broadPhase.touchProxy(f.m_proxies[i].proxyId);
          }
        }
      };
      Body2.prototype.isBullet = function() {
        return this.m_bulletFlag;
      };
      Body2.prototype.setBullet = function(flag) {
        this.m_bulletFlag = !!flag;
      };
      Body2.prototype.isSleepingAllowed = function() {
        return this.m_autoSleepFlag;
      };
      Body2.prototype.setSleepingAllowed = function(flag) {
        this.m_autoSleepFlag = !!flag;
        if (this.m_autoSleepFlag == false) {
          this.setAwake(true);
        }
      };
      Body2.prototype.isAwake = function() {
        return this.m_awakeFlag;
      };
      Body2.prototype.setAwake = function(flag) {
        if (flag) {
          this.m_awakeFlag = true;
          this.m_sleepTime = 0;
        } else {
          this.m_awakeFlag = false;
          this.m_sleepTime = 0;
          this.m_linearVelocity.setZero();
          this.m_angularVelocity = 0;
          this.m_force.setZero();
          this.m_torque = 0;
        }
      };
      Body2.prototype.isActive = function() {
        return this.m_activeFlag;
      };
      Body2.prototype.setActive = function(flag) {
        if (flag == this.m_activeFlag) {
          return;
        }
        this.m_activeFlag = !!flag;
        if (this.m_activeFlag) {
          var broadPhase = this.m_world.m_broadPhase;
          for (var f = this.m_fixtureList; f; f = f.m_next) {
            f.createProxies(broadPhase, this.m_xf);
          }
          this.m_world.m_newFixture = true;
        } else {
          var broadPhase = this.m_world.m_broadPhase;
          for (var f = this.m_fixtureList; f; f = f.m_next) {
            f.destroyProxies(broadPhase);
          }
          var ce = this.m_contactList;
          while (ce) {
            var ce0 = ce;
            ce = ce.next;
            this.m_world.destroyContact(ce0.contact);
          }
          this.m_contactList = null;
        }
      };
      Body2.prototype.isFixedRotation = function() {
        return this.m_fixedRotationFlag;
      };
      Body2.prototype.setFixedRotation = function(flag) {
        if (this.m_fixedRotationFlag == flag) {
          return;
        }
        this.m_fixedRotationFlag = !!flag;
        this.m_angularVelocity = 0;
        this.resetMassData();
      };
      Body2.prototype.getTransform = function() {
        return this.m_xf;
      };
      Body2.prototype.setTransform = function(a2, b2) {
        if (this.isWorldLocked() == true) {
          return;
        }
        if (typeof b2 === "number") {
          this.m_xf.setNum(a2, b2);
        } else {
          this.m_xf.setTransform(a2);
        }
        this.m_sweep.setTransform(this.m_xf);
        var broadPhase = this.m_world.m_broadPhase;
        for (var f = this.m_fixtureList; f; f = f.m_next) {
          f.synchronize(broadPhase, this.m_xf, this.m_xf);
        }
        this.setAwake(true);
      };
      Body2.prototype.synchronizeTransform = function() {
        this.m_sweep.getTransform(this.m_xf, 1);
      };
      Body2.prototype.synchronizeFixtures = function() {
        this.m_sweep.getTransform(xf$2, 0);
        var broadPhase = this.m_world.m_broadPhase;
        for (var f = this.m_fixtureList; f; f = f.m_next) {
          f.synchronize(broadPhase, xf$2, this.m_xf);
        }
      };
      Body2.prototype.advance = function(alpha) {
        this.m_sweep.advance(alpha);
        copyVec2(this.m_sweep.c, this.m_sweep.c0);
        this.m_sweep.a = this.m_sweep.a0;
        this.m_sweep.getTransform(this.m_xf, 1);
      };
      Body2.prototype.getPosition = function() {
        return this.m_xf.p;
      };
      Body2.prototype.setPosition = function(p) {
        this.setTransform(p, this.m_sweep.a);
      };
      Body2.prototype.getAngle = function() {
        return this.m_sweep.a;
      };
      Body2.prototype.setAngle = function(angle) {
        this.setTransform(this.m_xf.p, angle);
      };
      Body2.prototype.getWorldCenter = function() {
        return this.m_sweep.c;
      };
      Body2.prototype.getLocalCenter = function() {
        return this.m_sweep.localCenter;
      };
      Body2.prototype.getLinearVelocity = function() {
        return this.m_linearVelocity;
      };
      Body2.prototype.getLinearVelocityFromWorldPoint = function(worldPoint) {
        var localCenter2 = Vec2.sub(worldPoint, this.m_sweep.c);
        return Vec2.add(this.m_linearVelocity, Vec2.crossNumVec2(this.m_angularVelocity, localCenter2));
      };
      Body2.prototype.getLinearVelocityFromLocalPoint = function(localPoint) {
        return this.getLinearVelocityFromWorldPoint(this.getWorldPoint(localPoint));
      };
      Body2.prototype.setLinearVelocity = function(v3) {
        if (this.m_type == STATIC) {
          return;
        }
        if (Vec2.dot(v3, v3) > 0) {
          this.setAwake(true);
        }
        this.m_linearVelocity.setVec2(v3);
      };
      Body2.prototype.getAngularVelocity = function() {
        return this.m_angularVelocity;
      };
      Body2.prototype.setAngularVelocity = function(w) {
        if (this.m_type == STATIC) {
          return;
        }
        if (w * w > 0) {
          this.setAwake(true);
        }
        this.m_angularVelocity = w;
      };
      Body2.prototype.getLinearDamping = function() {
        return this.m_linearDamping;
      };
      Body2.prototype.setLinearDamping = function(linearDamping) {
        this.m_linearDamping = linearDamping;
      };
      Body2.prototype.getAngularDamping = function() {
        return this.m_angularDamping;
      };
      Body2.prototype.setAngularDamping = function(angularDamping) {
        this.m_angularDamping = angularDamping;
      };
      Body2.prototype.getGravityScale = function() {
        return this.m_gravityScale;
      };
      Body2.prototype.setGravityScale = function(scale) {
        this.m_gravityScale = scale;
      };
      Body2.prototype.getMass = function() {
        return this.m_mass;
      };
      Body2.prototype.getInertia = function() {
        return this.m_I + this.m_mass * Vec2.dot(this.m_sweep.localCenter, this.m_sweep.localCenter);
      };
      Body2.prototype.getMassData = function(data) {
        data.mass = this.m_mass;
        data.I = this.getInertia();
        copyVec2(data.center, this.m_sweep.localCenter);
      };
      Body2.prototype.resetMassData = function() {
        this.m_mass = 0;
        this.m_invMass = 0;
        this.m_I = 0;
        this.m_invI = 0;
        zeroVec2(this.m_sweep.localCenter);
        if (this.isStatic() || this.isKinematic()) {
          copyVec2(this.m_sweep.c0, this.m_xf.p);
          copyVec2(this.m_sweep.c, this.m_xf.p);
          this.m_sweep.a0 = this.m_sweep.a;
          return;
        }
        zeroVec2(localCenter);
        for (var f = this.m_fixtureList; f; f = f.m_next) {
          if (f.m_density == 0) {
            continue;
          }
          var massData = {
            mass: 0,
            center: vec2(0, 0),
            I: 0
          };
          f.getMassData(massData);
          this.m_mass += massData.mass;
          plusScaleVec2(localCenter, massData.mass, massData.center);
          this.m_I += massData.I;
        }
        if (this.m_mass > 0) {
          this.m_invMass = 1 / this.m_mass;
          scaleVec2(localCenter, this.m_invMass, localCenter);
        } else {
          this.m_mass = 1;
          this.m_invMass = 1;
        }
        if (this.m_I > 0 && this.m_fixedRotationFlag == false) {
          this.m_I -= this.m_mass * dotVec2(localCenter, localCenter);
          this.m_invI = 1 / this.m_I;
        } else {
          this.m_I = 0;
          this.m_invI = 0;
        }
        copyVec2(oldCenter, this.m_sweep.c);
        this.m_sweep.setLocalCenter(localCenter, this.m_xf);
        subVec2(shift, this.m_sweep.c, oldCenter);
        crossNumVec2(temp$6, this.m_angularVelocity, shift);
        plusVec2(this.m_linearVelocity, temp$6);
      };
      Body2.prototype.setMassData = function(massData) {
        if (this.isWorldLocked() == true) {
          return;
        }
        if (this.m_type != DYNAMIC) {
          return;
        }
        this.m_invMass = 0;
        this.m_I = 0;
        this.m_invI = 0;
        this.m_mass = massData.mass;
        if (this.m_mass <= 0) {
          this.m_mass = 1;
        }
        this.m_invMass = 1 / this.m_mass;
        if (massData.I > 0 && this.m_fixedRotationFlag == false) {
          this.m_I = massData.I - this.m_mass * dotVec2(massData.center, massData.center);
          this.m_invI = 1 / this.m_I;
        }
        copyVec2(oldCenter, this.m_sweep.c);
        this.m_sweep.setLocalCenter(massData.center, this.m_xf);
        subVec2(shift, this.m_sweep.c, oldCenter);
        crossNumVec2(temp$6, this.m_angularVelocity, shift);
        plusVec2(this.m_linearVelocity, temp$6);
      };
      Body2.prototype.applyForce = function(force, point2, wake) {
        if (wake === void 0) {
          wake = true;
        }
        if (this.m_type != DYNAMIC) {
          return;
        }
        if (wake && this.m_awakeFlag == false) {
          this.setAwake(true);
        }
        if (this.m_awakeFlag) {
          this.m_force.add(force);
          this.m_torque += Vec2.crossVec2Vec2(Vec2.sub(point2, this.m_sweep.c), force);
        }
      };
      Body2.prototype.applyForceToCenter = function(force, wake) {
        if (wake === void 0) {
          wake = true;
        }
        if (this.m_type != DYNAMIC) {
          return;
        }
        if (wake && this.m_awakeFlag == false) {
          this.setAwake(true);
        }
        if (this.m_awakeFlag) {
          this.m_force.add(force);
        }
      };
      Body2.prototype.applyTorque = function(torque, wake) {
        if (wake === void 0) {
          wake = true;
        }
        if (this.m_type != DYNAMIC) {
          return;
        }
        if (wake && this.m_awakeFlag == false) {
          this.setAwake(true);
        }
        if (this.m_awakeFlag) {
          this.m_torque += torque;
        }
      };
      Body2.prototype.applyLinearImpulse = function(impulse, point2, wake) {
        if (wake === void 0) {
          wake = true;
        }
        if (this.m_type != DYNAMIC) {
          return;
        }
        if (wake && this.m_awakeFlag == false) {
          this.setAwake(true);
        }
        if (this.m_awakeFlag) {
          this.m_linearVelocity.addMul(this.m_invMass, impulse);
          this.m_angularVelocity += this.m_invI * Vec2.crossVec2Vec2(Vec2.sub(point2, this.m_sweep.c), impulse);
        }
      };
      Body2.prototype.applyAngularImpulse = function(impulse, wake) {
        if (wake === void 0) {
          wake = true;
        }
        if (this.m_type != DYNAMIC) {
          return;
        }
        if (wake && this.m_awakeFlag == false) {
          this.setAwake(true);
        }
        if (this.m_awakeFlag) {
          this.m_angularVelocity += this.m_invI * impulse;
        }
      };
      Body2.prototype.shouldCollide = function(that) {
        if (this.m_type != DYNAMIC && that.m_type != DYNAMIC) {
          return false;
        }
        for (var jn = this.m_jointList; jn; jn = jn.next) {
          if (jn.other == that) {
            if (jn.joint.m_collideConnected == false) {
              return false;
            }
          }
        }
        return true;
      };
      Body2.prototype._addFixture = function(fixture) {
        if (this.isWorldLocked() == true) {
          return null;
        }
        if (this.m_activeFlag) {
          var broadPhase = this.m_world.m_broadPhase;
          fixture.createProxies(broadPhase, this.m_xf);
        }
        fixture.m_next = this.m_fixtureList;
        this.m_fixtureList = fixture;
        if (fixture.m_density > 0) {
          this.resetMassData();
        }
        this.m_world.m_newFixture = true;
        return fixture;
      };
      Body2.prototype.createFixture = function(shape, fixdef) {
        if (this.isWorldLocked() == true) {
          return null;
        }
        var fixture = new Fixture(this, shape, fixdef);
        this._addFixture(fixture);
        this.m_world.publish("add-fixture", fixture);
        return fixture;
      };
      Body2.prototype.destroyFixture = function(fixture) {
        if (this.isWorldLocked() == true) {
          return;
        }
        if (this.m_fixtureList === fixture) {
          this.m_fixtureList = fixture.m_next;
        } else {
          var node = this.m_fixtureList;
          while (node != null) {
            if (node.m_next === fixture) {
              node.m_next = fixture.m_next;
              break;
            }
            node = node.m_next;
          }
        }
        var edge = this.m_contactList;
        while (edge) {
          var c2 = edge.contact;
          edge = edge.next;
          var fixtureA = c2.getFixtureA();
          var fixtureB = c2.getFixtureB();
          if (fixture == fixtureA || fixture == fixtureB) {
            this.m_world.destroyContact(c2);
          }
        }
        if (this.m_activeFlag) {
          var broadPhase = this.m_world.m_broadPhase;
          fixture.destroyProxies(broadPhase);
        }
        fixture.m_body = null;
        fixture.m_next = null;
        this.m_world.publish("remove-fixture", fixture);
        this.resetMassData();
      };
      Body2.prototype.getWorldPoint = function(localPoint) {
        return Transform.mulVec2(this.m_xf, localPoint);
      };
      Body2.prototype.getWorldVector = function(localVector) {
        return Rot.mulVec2(this.m_xf.q, localVector);
      };
      Body2.prototype.getLocalPoint = function(worldPoint) {
        return Transform.mulTVec2(this.m_xf, worldPoint);
      };
      Body2.prototype.getLocalVector = function(worldVector) {
        return Rot.mulTVec2(this.m_xf.q, worldVector);
      };
      Body2.STATIC = "static";
      Body2.KINEMATIC = "kinematic";
      Body2.DYNAMIC = "dynamic";
      return Body2;
    })()
  );
  var JointEdge = (
    /** @class */
    /* @__PURE__ */ (function() {
      function JointEdge2() {
        this.other = null;
        this.joint = null;
        this.prev = null;
        this.next = null;
      }
      return JointEdge2;
    })()
  );
  var Joint = (
    /** @class */
    (function() {
      function Joint2(def, bodyA, bodyB) {
        this.m_type = "unknown-joint";
        this.m_prev = null;
        this.m_next = null;
        this.m_edgeA = new JointEdge();
        this.m_edgeB = new JointEdge();
        this.m_islandFlag = false;
        this.style = {};
        this.appData = {};
        bodyA = "bodyA" in def ? def.bodyA : bodyA;
        bodyB = "bodyB" in def ? def.bodyB : bodyB;
        this.m_bodyA = bodyA;
        this.m_bodyB = bodyB;
        this.m_collideConnected = !!def.collideConnected;
        this.m_userData = def.userData;
        if (typeof def.style === "object" && def.style !== null) {
          this.style = def.style;
        }
      }
      Joint2.prototype.isActive = function() {
        return this.m_bodyA.isActive() && this.m_bodyB.isActive();
      };
      Joint2.prototype.getType = function() {
        return this.m_type;
      };
      Joint2.prototype.getBodyA = function() {
        return this.m_bodyA;
      };
      Joint2.prototype.getBodyB = function() {
        return this.m_bodyB;
      };
      Joint2.prototype.getNext = function() {
        return this.m_next;
      };
      Joint2.prototype.getUserData = function() {
        return this.m_userData;
      };
      Joint2.prototype.setUserData = function(data) {
        this.m_userData = data;
      };
      Joint2.prototype.getCollideConnected = function() {
        return this.m_collideConnected;
      };
      Joint2.prototype.shiftOrigin = function(newOrigin) {
      };
      Joint2.prototype._resetAnchors = function(def) {
        return this._reset(def);
      };
      return Joint2;
    })()
  );
  var stats = {
    gjkCalls: 0,
    gjkIters: 0,
    gjkMaxIters: 0,
    toiTime: 0,
    toiMaxTime: 0,
    toiCalls: 0,
    toiIters: 0,
    toiMaxIters: 0,
    toiRootIters: 0,
    toiMaxRootIters: 0,
    toString: function(newline) {
      newline = typeof newline === "string" ? newline : "\n";
      var string = "";
      for (var name_1 in this) {
        if (typeof this[name_1] !== "function" && typeof this[name_1] !== "object") {
          string += name_1 + ": " + this[name_1] + newline;
        }
      }
      return string;
    }
  };
  var now = function() {
    return Date.now();
  };
  var diff = function(time) {
    return Date.now() - time;
  };
  const Timer = {
    now,
    diff
  };
  var math_max$4 = Math.max;
  var temp$5 = vec2(0, 0);
  var normal$4 = vec2(0, 0);
  var e12 = vec2(0, 0);
  var e13 = vec2(0, 0);
  var e23 = vec2(0, 0);
  var temp1 = vec2(0, 0);
  var temp2 = vec2(0, 0);
  stats.gjkCalls = 0;
  stats.gjkIters = 0;
  stats.gjkMaxIters = 0;
  var DistanceInput = (
    /** @class */
    (function() {
      function DistanceInput2() {
        this.proxyA = new DistanceProxy();
        this.proxyB = new DistanceProxy();
        this.transformA = Transform.identity();
        this.transformB = Transform.identity();
        this.useRadii = false;
      }
      DistanceInput2.prototype.recycle = function() {
        this.proxyA.recycle();
        this.proxyB.recycle();
        this.transformA.setIdentity();
        this.transformB.setIdentity();
        this.useRadii = false;
      };
      return DistanceInput2;
    })()
  );
  var DistanceOutput = (
    /** @class */
    (function() {
      function DistanceOutput2() {
        this.pointA = vec2(0, 0);
        this.pointB = vec2(0, 0);
        this.distance = 0;
        this.iterations = 0;
      }
      DistanceOutput2.prototype.recycle = function() {
        zeroVec2(this.pointA);
        zeroVec2(this.pointB);
        this.distance = 0;
        this.iterations = 0;
      };
      return DistanceOutput2;
    })()
  );
  var SimplexCache = (
    /** @class */
    (function() {
      function SimplexCache2() {
        this.metric = 0;
        this.indexA = [];
        this.indexB = [];
        this.count = 0;
      }
      SimplexCache2.prototype.recycle = function() {
        this.metric = 0;
        this.indexA.length = 0;
        this.indexB.length = 0;
        this.count = 0;
      };
      return SimplexCache2;
    })()
  );
  var Distance = function(output2, cache2, input2) {
    ++stats.gjkCalls;
    var proxyA = input2.proxyA;
    var proxyB = input2.proxyB;
    var xfA2 = input2.transformA;
    var xfB2 = input2.transformB;
    simplex.recycle();
    simplex.readCache(cache2, proxyA, xfA2, proxyB, xfB2);
    var vertices = simplex.m_v;
    var k_maxIters = SettingsInternal.maxDistanceIterations;
    var saveA = [];
    var saveB = [];
    var saveCount = 0;
    var iter = 0;
    while (iter < k_maxIters) {
      saveCount = simplex.m_count;
      for (var i = 0; i < saveCount; ++i) {
        saveA[i] = vertices[i].indexA;
        saveB[i] = vertices[i].indexB;
      }
      simplex.solve();
      if (simplex.m_count === 3) {
        break;
      }
      var d2 = simplex.getSearchDirection();
      if (lengthSqrVec2(d2) < EPSILON * EPSILON) {
        break;
      }
      var vertex = vertices[simplex.m_count];
      vertex.indexA = proxyA.getSupport(derotVec2(temp$5, xfA2.q, scaleVec2(temp$5, -1, d2)));
      transformVec2(vertex.wA, xfA2, proxyA.getVertex(vertex.indexA));
      vertex.indexB = proxyB.getSupport(derotVec2(temp$5, xfB2.q, d2));
      transformVec2(vertex.wB, xfB2, proxyB.getVertex(vertex.indexB));
      subVec2(vertex.w, vertex.wB, vertex.wA);
      ++iter;
      ++stats.gjkIters;
      var duplicate = false;
      for (var i = 0; i < saveCount; ++i) {
        if (vertex.indexA === saveA[i] && vertex.indexB === saveB[i]) {
          duplicate = true;
          break;
        }
      }
      if (duplicate) {
        break;
      }
      ++simplex.m_count;
    }
    stats.gjkMaxIters = math_max$4(stats.gjkMaxIters, iter);
    simplex.getWitnessPoints(output2.pointA, output2.pointB);
    output2.distance = distVec2(output2.pointA, output2.pointB);
    output2.iterations = iter;
    simplex.writeCache(cache2);
    if (input2.useRadii) {
      var rA2 = proxyA.m_radius;
      var rB2 = proxyB.m_radius;
      if (output2.distance > rA2 + rB2 && output2.distance > EPSILON) {
        output2.distance -= rA2 + rB2;
        subVec2(normal$4, output2.pointB, output2.pointA);
        normalizeVec2(normal$4);
        plusScaleVec2(output2.pointA, rA2, normal$4);
        minusScaleVec2(output2.pointB, rB2, normal$4);
      } else {
        var p = subVec2(temp$5, output2.pointA, output2.pointB);
        copyVec2(output2.pointA, p);
        copyVec2(output2.pointB, p);
        output2.distance = 0;
      }
    }
  };
  var DistanceProxy = (
    /** @class */
    (function() {
      function DistanceProxy2() {
        this.m_vertices = [];
        this.m_count = 0;
        this.m_radius = 0;
      }
      DistanceProxy2.prototype.recycle = function() {
        this.m_vertices.length = 0;
        this.m_count = 0;
        this.m_radius = 0;
      };
      DistanceProxy2.prototype.getVertexCount = function() {
        return this.m_count;
      };
      DistanceProxy2.prototype.getVertex = function(index) {
        return this.m_vertices[index];
      };
      DistanceProxy2.prototype.getSupport = function(d2) {
        var bestIndex = -1;
        var bestValue = -Infinity;
        for (var i = 0; i < this.m_count; ++i) {
          var value = dotVec2(this.m_vertices[i], d2);
          if (value > bestValue) {
            bestIndex = i;
            bestValue = value;
          }
        }
        return bestIndex;
      };
      DistanceProxy2.prototype.getSupportVertex = function(d2) {
        return this.m_vertices[this.getSupport(d2)];
      };
      DistanceProxy2.prototype.set = function(shape, index) {
        shape.computeDistanceProxy(this, index);
      };
      DistanceProxy2.prototype.setVertices = function(vertices, count, radius) {
        this.m_vertices = vertices;
        this.m_count = count;
        this.m_radius = radius;
      };
      return DistanceProxy2;
    })()
  );
  var SimplexVertex = (
    /** @class */
    (function() {
      function SimplexVertex2() {
        this.wA = vec2(0, 0);
        this.indexA = 0;
        this.wB = vec2(0, 0);
        this.indexB = 0;
        this.w = vec2(0, 0);
        this.a = 0;
      }
      SimplexVertex2.prototype.recycle = function() {
        this.indexA = 0;
        this.indexB = 0;
        zeroVec2(this.wA);
        zeroVec2(this.wB);
        zeroVec2(this.w);
        this.a = 0;
      };
      SimplexVertex2.prototype.set = function(v3) {
        this.indexA = v3.indexA;
        this.indexB = v3.indexB;
        copyVec2(this.wA, v3.wA);
        copyVec2(this.wB, v3.wB);
        copyVec2(this.w, v3.w);
        this.a = v3.a;
      };
      return SimplexVertex2;
    })()
  );
  var searchDirection_reuse = vec2(0, 0);
  var closestPoint_reuse = vec2(0, 0);
  var Simplex = (
    /** @class */
    (function() {
      function Simplex2() {
        this.m_v1 = new SimplexVertex();
        this.m_v2 = new SimplexVertex();
        this.m_v3 = new SimplexVertex();
        this.m_v = [this.m_v1, this.m_v2, this.m_v3];
      }
      Simplex2.prototype.recycle = function() {
        this.m_v1.recycle();
        this.m_v2.recycle();
        this.m_v3.recycle();
        this.m_count = 0;
      };
      Simplex2.prototype.toString = function() {
        if (this.m_count === 3) {
          return [
            "+" + this.m_count,
            this.m_v1.a,
            this.m_v1.wA.x,
            this.m_v1.wA.y,
            this.m_v1.wB.x,
            this.m_v1.wB.y,
            this.m_v2.a,
            this.m_v2.wA.x,
            this.m_v2.wA.y,
            this.m_v2.wB.x,
            this.m_v2.wB.y,
            this.m_v3.a,
            this.m_v3.wA.x,
            this.m_v3.wA.y,
            this.m_v3.wB.x,
            this.m_v3.wB.y
          ].toString();
        } else if (this.m_count === 2) {
          return [
            "+" + this.m_count,
            this.m_v1.a,
            this.m_v1.wA.x,
            this.m_v1.wA.y,
            this.m_v1.wB.x,
            this.m_v1.wB.y,
            this.m_v2.a,
            this.m_v2.wA.x,
            this.m_v2.wA.y,
            this.m_v2.wB.x,
            this.m_v2.wB.y
          ].toString();
        } else if (this.m_count === 1) {
          return [
            "+" + this.m_count,
            this.m_v1.a,
            this.m_v1.wA.x,
            this.m_v1.wA.y,
            this.m_v1.wB.x,
            this.m_v1.wB.y
          ].toString();
        } else {
          return "+" + this.m_count;
        }
      };
      Simplex2.prototype.readCache = function(cache2, proxyA, transformA, proxyB, transformB) {
        this.m_count = cache2.count;
        for (var i = 0; i < this.m_count; ++i) {
          var v3 = this.m_v[i];
          v3.indexA = cache2.indexA[i];
          v3.indexB = cache2.indexB[i];
          var wALocal = proxyA.getVertex(v3.indexA);
          var wBLocal = proxyB.getVertex(v3.indexB);
          transformVec2(v3.wA, transformA, wALocal);
          transformVec2(v3.wB, transformB, wBLocal);
          subVec2(v3.w, v3.wB, v3.wA);
          v3.a = 0;
        }
        if (this.m_count > 1) {
          var metric1 = cache2.metric;
          var metric2 = this.getMetric();
          if (metric2 < 0.5 * metric1 || 2 * metric1 < metric2 || metric2 < EPSILON) {
            this.m_count = 0;
          }
        }
        if (this.m_count === 0) {
          var v3 = this.m_v[0];
          v3.indexA = 0;
          v3.indexB = 0;
          var wALocal = proxyA.getVertex(0);
          var wBLocal = proxyB.getVertex(0);
          transformVec2(v3.wA, transformA, wALocal);
          transformVec2(v3.wB, transformB, wBLocal);
          subVec2(v3.w, v3.wB, v3.wA);
          v3.a = 1;
          this.m_count = 1;
        }
      };
      Simplex2.prototype.writeCache = function(cache2) {
        cache2.metric = this.getMetric();
        cache2.count = this.m_count;
        for (var i = 0; i < this.m_count; ++i) {
          cache2.indexA[i] = this.m_v[i].indexA;
          cache2.indexB[i] = this.m_v[i].indexB;
        }
      };
      Simplex2.prototype.getSearchDirection = function() {
        var v13 = this.m_v1;
        var v22 = this.m_v2;
        switch (this.m_count) {
          case 1:
            return setVec2(searchDirection_reuse, -v13.w.x, -v13.w.y);
          case 2: {
            subVec2(e12, v22.w, v13.w);
            var sgn = -crossVec2Vec2(e12, v13.w);
            if (sgn > 0) {
              return setVec2(searchDirection_reuse, -e12.y, e12.x);
            } else {
              return setVec2(searchDirection_reuse, e12.y, -e12.x);
            }
          }
          default:
            return zeroVec2(searchDirection_reuse);
        }
      };
      Simplex2.prototype.getClosestPoint = function() {
        var v13 = this.m_v1;
        var v22 = this.m_v2;
        switch (this.m_count) {
          case 0:
            return zeroVec2(closestPoint_reuse);
          case 1:
            return copyVec2(closestPoint_reuse, v13.w);
          case 2:
            return combine2Vec2(closestPoint_reuse, v13.a, v13.w, v22.a, v22.w);
          case 3:
            return zeroVec2(closestPoint_reuse);
          default:
            return zeroVec2(closestPoint_reuse);
        }
      };
      Simplex2.prototype.getWitnessPoints = function(pA2, pB2) {
        var v13 = this.m_v1;
        var v22 = this.m_v2;
        var v3 = this.m_v3;
        switch (this.m_count) {
          case 0:
            break;
          case 1:
            copyVec2(pA2, v13.wA);
            copyVec2(pB2, v13.wB);
            break;
          case 2:
            combine2Vec2(pA2, v13.a, v13.wA, v22.a, v22.wA);
            combine2Vec2(pB2, v13.a, v13.wB, v22.a, v22.wB);
            break;
          case 3:
            combine3Vec2(pA2, v13.a, v13.wA, v22.a, v22.wA, v3.a, v3.wA);
            copyVec2(pB2, pA2);
            break;
        }
      };
      Simplex2.prototype.getMetric = function() {
        switch (this.m_count) {
          case 0:
            return 0;
          case 1:
            return 0;
          case 2:
            return distVec2(this.m_v1.w, this.m_v2.w);
          case 3:
            return crossVec2Vec2(subVec2(temp1, this.m_v2.w, this.m_v1.w), subVec2(temp2, this.m_v3.w, this.m_v1.w));
          default:
            return 0;
        }
      };
      Simplex2.prototype.solve = function() {
        switch (this.m_count) {
          case 1:
            break;
          case 2:
            this.solve2();
            break;
          case 3:
            this.solve3();
            break;
        }
      };
      Simplex2.prototype.solve2 = function() {
        var w1 = this.m_v1.w;
        var w2 = this.m_v2.w;
        subVec2(e12, w2, w1);
        var d12_2 = -dotVec2(w1, e12);
        if (d12_2 <= 0) {
          this.m_v1.a = 1;
          this.m_count = 1;
          return;
        }
        var d12_1 = dotVec2(w2, e12);
        if (d12_1 <= 0) {
          this.m_v2.a = 1;
          this.m_count = 1;
          this.m_v1.set(this.m_v2);
          return;
        }
        var inv_d12 = 1 / (d12_1 + d12_2);
        this.m_v1.a = d12_1 * inv_d12;
        this.m_v2.a = d12_2 * inv_d12;
        this.m_count = 2;
      };
      Simplex2.prototype.solve3 = function() {
        var w1 = this.m_v1.w;
        var w2 = this.m_v2.w;
        var w3 = this.m_v3.w;
        subVec2(e12, w2, w1);
        var w1e12 = dotVec2(w1, e12);
        var w2e12 = dotVec2(w2, e12);
        var d12_1 = w2e12;
        var d12_2 = -w1e12;
        subVec2(e13, w3, w1);
        var w1e13 = dotVec2(w1, e13);
        var w3e13 = dotVec2(w3, e13);
        var d13_1 = w3e13;
        var d13_2 = -w1e13;
        subVec2(e23, w3, w2);
        var w2e23 = dotVec2(w2, e23);
        var w3e23 = dotVec2(w3, e23);
        var d23_1 = w3e23;
        var d23_2 = -w2e23;
        var n123 = crossVec2Vec2(e12, e13);
        var d123_1 = n123 * crossVec2Vec2(w2, w3);
        var d123_2 = n123 * crossVec2Vec2(w3, w1);
        var d123_3 = n123 * crossVec2Vec2(w1, w2);
        if (d12_2 <= 0 && d13_2 <= 0) {
          this.m_v1.a = 1;
          this.m_count = 1;
          return;
        }
        if (d12_1 > 0 && d12_2 > 0 && d123_3 <= 0) {
          var inv_d12 = 1 / (d12_1 + d12_2);
          this.m_v1.a = d12_1 * inv_d12;
          this.m_v2.a = d12_2 * inv_d12;
          this.m_count = 2;
          return;
        }
        if (d13_1 > 0 && d13_2 > 0 && d123_2 <= 0) {
          var inv_d13 = 1 / (d13_1 + d13_2);
          this.m_v1.a = d13_1 * inv_d13;
          this.m_v3.a = d13_2 * inv_d13;
          this.m_count = 2;
          this.m_v2.set(this.m_v3);
          return;
        }
        if (d12_1 <= 0 && d23_2 <= 0) {
          this.m_v2.a = 1;
          this.m_count = 1;
          this.m_v1.set(this.m_v2);
          return;
        }
        if (d13_1 <= 0 && d23_1 <= 0) {
          this.m_v3.a = 1;
          this.m_count = 1;
          this.m_v1.set(this.m_v3);
          return;
        }
        if (d23_1 > 0 && d23_2 > 0 && d123_1 <= 0) {
          var inv_d23 = 1 / (d23_1 + d23_2);
          this.m_v2.a = d23_1 * inv_d23;
          this.m_v3.a = d23_2 * inv_d23;
          this.m_count = 2;
          this.m_v1.set(this.m_v3);
          return;
        }
        var inv_d123 = 1 / (d123_1 + d123_2 + d123_3);
        this.m_v1.a = d123_1 * inv_d123;
        this.m_v2.a = d123_2 * inv_d123;
        this.m_v3.a = d123_3 * inv_d123;
        this.m_count = 3;
      };
      return Simplex2;
    })()
  );
  var simplex = new Simplex();
  var input$1 = new DistanceInput();
  var cache$1 = new SimplexCache();
  var output$1 = new DistanceOutput();
  var testOverlap = function(shapeA, indexA, shapeB, indexB, xfA2, xfB2) {
    input$1.recycle();
    input$1.proxyA.set(shapeA, indexA);
    input$1.proxyB.set(shapeB, indexB);
    copyTransform(input$1.transformA, xfA2);
    copyTransform(input$1.transformB, xfB2);
    input$1.useRadii = true;
    output$1.recycle();
    cache$1.recycle();
    Distance(output$1, cache$1, input$1);
    return output$1.distance < 10 * EPSILON;
  };
  Distance.testOverlap = testOverlap;
  Distance.Input = DistanceInput;
  Distance.Output = DistanceOutput;
  Distance.Proxy = DistanceProxy;
  Distance.Cache = SimplexCache;
  var ShapeCastInput = (
    /** @class */
    (function() {
      function ShapeCastInput2() {
        this.proxyA = new DistanceProxy();
        this.proxyB = new DistanceProxy();
        this.transformA = Transform.identity();
        this.transformB = Transform.identity();
        this.translationB = Vec2.zero();
      }
      ShapeCastInput2.prototype.recycle = function() {
        this.proxyA.recycle();
        this.proxyB.recycle();
        this.transformA.setIdentity();
        this.transformB.setIdentity();
        zeroVec2(this.translationB);
      };
      return ShapeCastInput2;
    })()
  );
  var ShapeCastOutput = (
    /** @class */
    /* @__PURE__ */ (function() {
      function ShapeCastOutput2() {
        this.point = Vec2.zero();
        this.normal = Vec2.zero();
        this.lambda = 1;
        this.iterations = 0;
      }
      return ShapeCastOutput2;
    })()
  );
  var ShapeCast = function(output2, input2) {
    output2.iterations = 0;
    output2.lambda = 1;
    output2.normal.setZero();
    output2.point.setZero();
    var proxyA = input2.proxyA;
    var proxyB = input2.proxyB;
    var radiusA = math_max$4(proxyA.m_radius, SettingsInternal.polygonRadius);
    var radiusB = math_max$4(proxyB.m_radius, SettingsInternal.polygonRadius);
    var radius = radiusA + radiusB;
    var xfA2 = input2.transformA;
    var xfB2 = input2.transformB;
    var r = input2.translationB;
    var n2 = Vec2.zero();
    var lambda = 0;
    var simplex2 = new Simplex();
    simplex2.m_count = 0;
    var vertices = simplex2.m_v;
    var indexA = proxyA.getSupport(Rot.mulTVec2(xfA2.q, Vec2.neg(r)));
    var wA = Transform.mulVec2(xfA2, proxyA.getVertex(indexA));
    var indexB = proxyB.getSupport(Rot.mulTVec2(xfB2.q, r));
    var wB = Transform.mulVec2(xfB2, proxyB.getVertex(indexB));
    var v3 = Vec2.sub(wA, wB);
    var sigma = math_max$4(SettingsInternal.polygonRadius, radius - SettingsInternal.polygonRadius);
    var tolerance = 0.5 * SettingsInternal.linearSlop;
    var k_maxIters = 20;
    var iter = 0;
    while (iter < k_maxIters && v3.length() - sigma > tolerance) {
      output2.iterations += 1;
      indexA = proxyA.getSupport(Rot.mulTVec2(xfA2.q, Vec2.neg(v3)));
      wA = Transform.mulVec2(xfA2, proxyA.getVertex(indexA));
      indexB = proxyB.getSupport(Rot.mulTVec2(xfB2.q, v3));
      wB = Transform.mulVec2(xfB2, proxyB.getVertex(indexB));
      var p = Vec2.sub(wA, wB);
      v3.normalize();
      var vp = Vec2.dot(v3, p);
      var vr = Vec2.dot(v3, r);
      if (vp - sigma > lambda * vr) {
        if (vr <= 0) {
          return false;
        }
        lambda = (vp - sigma) / vr;
        if (lambda > 1) {
          return false;
        }
        n2.setMul(-1, v3);
        simplex2.m_count = 0;
      }
      var vertex = vertices[simplex2.m_count];
      vertex.indexA = indexB;
      vertex.wA = Vec2.combine(1, wB, lambda, r);
      vertex.indexB = indexA;
      vertex.wB = wA;
      vertex.w = Vec2.sub(vertex.wB, vertex.wA);
      vertex.a = 1;
      simplex2.m_count += 1;
      switch (simplex2.m_count) {
        case 1:
          break;
        case 2:
          simplex2.solve2();
          break;
        case 3:
          simplex2.solve3();
          break;
      }
      if (simplex2.m_count == 3) {
        return false;
      }
      v3.setVec2(simplex2.getClosestPoint());
      ++iter;
    }
    if (iter == 0) {
      return false;
    }
    var pointA2 = Vec2.zero();
    var pointB2 = Vec2.zero();
    simplex2.getWitnessPoints(pointB2, pointA2);
    if (v3.lengthSquared() > 0) {
      n2.setMul(-1, v3);
      n2.normalize();
    }
    output2.point = Vec2.combine(1, pointA2, radiusA, n2);
    output2.normal = n2;
    output2.lambda = lambda;
    output2.iterations = iter;
    return true;
  };
  var math_abs$7 = Math.abs;
  var math_max$3 = Math.max;
  var TOIInput = (
    /** @class */
    (function() {
      function TOIInput2() {
        this.proxyA = new DistanceProxy();
        this.proxyB = new DistanceProxy();
        this.sweepA = new Sweep();
        this.sweepB = new Sweep();
      }
      TOIInput2.prototype.recycle = function() {
        this.proxyA.recycle();
        this.proxyB.recycle();
        this.sweepA.recycle();
        this.sweepB.recycle();
        this.tMax = -1;
      };
      return TOIInput2;
    })()
  );
  exports2.TOIOutputState = void 0;
  (function(TOIOutputState2) {
    TOIOutputState2[TOIOutputState2["e_unset"] = -1] = "e_unset";
    TOIOutputState2[TOIOutputState2["e_unknown"] = 0] = "e_unknown";
    TOIOutputState2[TOIOutputState2["e_failed"] = 1] = "e_failed";
    TOIOutputState2[TOIOutputState2["e_overlapped"] = 2] = "e_overlapped";
    TOIOutputState2[TOIOutputState2["e_touching"] = 3] = "e_touching";
    TOIOutputState2[TOIOutputState2["e_separated"] = 4] = "e_separated";
  })(exports2.TOIOutputState || (exports2.TOIOutputState = {}));
  var TOIOutput = (
    /** @class */
    (function() {
      function TOIOutput2() {
        this.state = exports2.TOIOutputState.e_unset;
        this.t = -1;
      }
      TOIOutput2.prototype.recycle = function() {
        this.state = exports2.TOIOutputState.e_unset;
        this.t = -1;
      };
      return TOIOutput2;
    })()
  );
  stats.toiTime = 0;
  stats.toiMaxTime = 0;
  stats.toiCalls = 0;
  stats.toiIters = 0;
  stats.toiMaxIters = 0;
  stats.toiRootIters = 0;
  stats.toiMaxRootIters = 0;
  var distanceInput = new DistanceInput();
  var distanceOutput = new DistanceOutput();
  var cache = new SimplexCache();
  var xfA$1 = transform(0, 0, 0);
  var xfB$1 = transform(0, 0, 0);
  var temp$4 = vec2(0, 0);
  var pointA$2 = vec2(0, 0);
  var pointB$2 = vec2(0, 0);
  var normal$3 = vec2(0, 0);
  var axisA = vec2(0, 0);
  var axisB = vec2(0, 0);
  var localPointA = vec2(0, 0);
  var localPointB = vec2(0, 0);
  var TimeOfImpact = function(output2, input2) {
    var timer = Timer.now();
    ++stats.toiCalls;
    output2.state = exports2.TOIOutputState.e_unknown;
    output2.t = input2.tMax;
    var proxyA = input2.proxyA;
    var proxyB = input2.proxyB;
    var sweepA = input2.sweepA;
    var sweepB = input2.sweepB;
    sweepA.normalize();
    sweepB.normalize();
    var tMax = input2.tMax;
    var totalRadius = proxyA.m_radius + proxyB.m_radius;
    var target = math_max$3(SettingsInternal.linearSlop, totalRadius - 3 * SettingsInternal.linearSlop);
    var tolerance = 0.25 * SettingsInternal.linearSlop;
    var t1 = 0;
    var k_maxIterations = SettingsInternal.maxTOIIterations;
    var iter = 0;
    cache.recycle();
    distanceInput.proxyA.setVertices(proxyA.m_vertices, proxyA.m_count, proxyA.m_radius);
    distanceInput.proxyB.setVertices(proxyB.m_vertices, proxyB.m_count, proxyB.m_radius);
    distanceInput.useRadii = false;
    while (true) {
      sweepA.getTransform(xfA$1, t1);
      sweepB.getTransform(xfB$1, t1);
      copyTransform(distanceInput.transformA, xfA$1);
      copyTransform(distanceInput.transformB, xfB$1);
      Distance(distanceOutput, cache, distanceInput);
      if (distanceOutput.distance <= 0) {
        output2.state = exports2.TOIOutputState.e_overlapped;
        output2.t = 0;
        break;
      }
      if (distanceOutput.distance < target + tolerance) {
        output2.state = exports2.TOIOutputState.e_touching;
        output2.t = t1;
        break;
      }
      separationFunction.initialize(cache, proxyA, sweepA, proxyB, sweepB, t1);
      var done = false;
      var t2 = tMax;
      var pushBackIter = 0;
      while (true) {
        var s2 = separationFunction.findMinSeparation(t2);
        if (s2 > target + tolerance) {
          output2.state = exports2.TOIOutputState.e_separated;
          output2.t = tMax;
          done = true;
          break;
        }
        if (s2 > target - tolerance) {
          t1 = t2;
          break;
        }
        var s1 = separationFunction.evaluate(t1);
        if (s1 < target - tolerance) {
          output2.state = exports2.TOIOutputState.e_failed;
          output2.t = t1;
          done = true;
          break;
        }
        if (s1 <= target + tolerance) {
          output2.state = exports2.TOIOutputState.e_touching;
          output2.t = t1;
          done = true;
          break;
        }
        var rootIterCount = 0;
        var a1 = t1;
        var a2 = t2;
        while (true) {
          var t = void 0;
          if (rootIterCount & 1) {
            t = a1 + (target - s1) * (a2 - a1) / (s2 - s1);
          } else {
            t = 0.5 * (a1 + a2);
          }
          ++rootIterCount;
          ++stats.toiRootIters;
          var s3 = separationFunction.evaluate(t);
          if (math_abs$7(s3 - target) < tolerance) {
            t2 = t;
            break;
          }
          if (s3 > target) {
            a1 = t;
            s1 = s3;
          } else {
            a2 = t;
            s2 = s3;
          }
          if (rootIterCount === 50) {
            break;
          }
        }
        stats.toiMaxRootIters = math_max$3(stats.toiMaxRootIters, rootIterCount);
        ++pushBackIter;
        if (pushBackIter === SettingsInternal.maxPolygonVertices) {
          break;
        }
      }
      ++iter;
      ++stats.toiIters;
      if (done) {
        break;
      }
      if (iter === k_maxIterations) {
        output2.state = exports2.TOIOutputState.e_failed;
        output2.t = t1;
        break;
      }
    }
    stats.toiMaxIters = math_max$3(stats.toiMaxIters, iter);
    var time = Timer.diff(timer);
    stats.toiMaxTime = math_max$3(stats.toiMaxTime, time);
    stats.toiTime += time;
    separationFunction.recycle();
  };
  var SeparationFunctionType;
  (function(SeparationFunctionType2) {
    SeparationFunctionType2[SeparationFunctionType2["e_unset"] = -1] = "e_unset";
    SeparationFunctionType2[SeparationFunctionType2["e_points"] = 1] = "e_points";
    SeparationFunctionType2[SeparationFunctionType2["e_faceA"] = 2] = "e_faceA";
    SeparationFunctionType2[SeparationFunctionType2["e_faceB"] = 3] = "e_faceB";
  })(SeparationFunctionType || (SeparationFunctionType = {}));
  var SeparationFunction = (
    /** @class */
    (function() {
      function SeparationFunction2() {
        this.m_proxyA = null;
        this.m_proxyB = null;
        this.m_sweepA = null;
        this.m_sweepB = null;
        this.m_type = SeparationFunctionType.e_unset;
        this.m_localPoint = vec2(0, 0);
        this.m_axis = vec2(0, 0);
        this.indexA = -1;
        this.indexB = -1;
      }
      SeparationFunction2.prototype.recycle = function() {
        this.m_proxyA = null;
        this.m_proxyB = null;
        this.m_sweepA = null;
        this.m_sweepB = null;
        this.m_type = SeparationFunctionType.e_unset;
        zeroVec2(this.m_localPoint);
        zeroVec2(this.m_axis);
        this.indexA = -1;
        this.indexB = -1;
      };
      SeparationFunction2.prototype.initialize = function(cache2, proxyA, sweepA, proxyB, sweepB, t1) {
        var count = cache2.count;
        this.m_proxyA = proxyA;
        this.m_proxyB = proxyB;
        this.m_sweepA = sweepA;
        this.m_sweepB = sweepB;
        this.m_sweepA.getTransform(xfA$1, t1);
        this.m_sweepB.getTransform(xfB$1, t1);
        if (count === 1) {
          this.m_type = SeparationFunctionType.e_points;
          var localPointA_1 = this.m_proxyA.getVertex(cache2.indexA[0]);
          var localPointB_1 = this.m_proxyB.getVertex(cache2.indexB[0]);
          transformVec2(pointA$2, xfA$1, localPointA_1);
          transformVec2(pointB$2, xfB$1, localPointB_1);
          subVec2(this.m_axis, pointB$2, pointA$2);
          var s2 = normalizeVec2Length(this.m_axis);
          return s2;
        } else if (cache2.indexA[0] === cache2.indexA[1]) {
          this.m_type = SeparationFunctionType.e_faceB;
          var localPointB1 = proxyB.getVertex(cache2.indexB[0]);
          var localPointB2 = proxyB.getVertex(cache2.indexB[1]);
          crossVec2Num(this.m_axis, subVec2(temp$4, localPointB2, localPointB1), 1);
          normalizeVec2(this.m_axis);
          rotVec2(normal$3, xfB$1.q, this.m_axis);
          combine2Vec2(this.m_localPoint, 0.5, localPointB1, 0.5, localPointB2);
          transformVec2(pointB$2, xfB$1, this.m_localPoint);
          var localPointA_2 = proxyA.getVertex(cache2.indexA[0]);
          var pointA_1 = Transform.mulVec2(xfA$1, localPointA_2);
          var s2 = dotVec2(pointA_1, normal$3) - dotVec2(pointB$2, normal$3);
          if (s2 < 0) {
            negVec2(this.m_axis);
            s2 = -s2;
          }
          return s2;
        } else {
          this.m_type = SeparationFunctionType.e_faceA;
          var localPointA1 = this.m_proxyA.getVertex(cache2.indexA[0]);
          var localPointA2 = this.m_proxyA.getVertex(cache2.indexA[1]);
          crossVec2Num(this.m_axis, subVec2(temp$4, localPointA2, localPointA1), 1);
          normalizeVec2(this.m_axis);
          rotVec2(normal$3, xfA$1.q, this.m_axis);
          combine2Vec2(this.m_localPoint, 0.5, localPointA1, 0.5, localPointA2);
          transformVec2(pointA$2, xfA$1, this.m_localPoint);
          var localPointB_2 = this.m_proxyB.getVertex(cache2.indexB[0]);
          transformVec2(pointB$2, xfB$1, localPointB_2);
          var s2 = dotVec2(pointB$2, normal$3) - dotVec2(pointA$2, normal$3);
          if (s2 < 0) {
            negVec2(this.m_axis);
            s2 = -s2;
          }
          return s2;
        }
      };
      SeparationFunction2.prototype.compute = function(find, t) {
        this.m_sweepA.getTransform(xfA$1, t);
        this.m_sweepB.getTransform(xfB$1, t);
        switch (this.m_type) {
          case SeparationFunctionType.e_points: {
            if (find) {
              derotVec2(axisA, xfA$1.q, this.m_axis);
              derotVec2(axisB, xfB$1.q, scaleVec2(temp$4, -1, this.m_axis));
              this.indexA = this.m_proxyA.getSupport(axisA);
              this.indexB = this.m_proxyB.getSupport(axisB);
            }
            copyVec2(localPointA, this.m_proxyA.getVertex(this.indexA));
            copyVec2(localPointB, this.m_proxyB.getVertex(this.indexB));
            transformVec2(pointA$2, xfA$1, localPointA);
            transformVec2(pointB$2, xfB$1, localPointB);
            var sep = dotVec2(pointB$2, this.m_axis) - dotVec2(pointA$2, this.m_axis);
            return sep;
          }
          case SeparationFunctionType.e_faceA: {
            rotVec2(normal$3, xfA$1.q, this.m_axis);
            transformVec2(pointA$2, xfA$1, this.m_localPoint);
            if (find) {
              derotVec2(axisB, xfB$1.q, scaleVec2(temp$4, -1, normal$3));
              this.indexA = -1;
              this.indexB = this.m_proxyB.getSupport(axisB);
            }
            copyVec2(localPointB, this.m_proxyB.getVertex(this.indexB));
            transformVec2(pointB$2, xfB$1, localPointB);
            var sep = dotVec2(pointB$2, normal$3) - dotVec2(pointA$2, normal$3);
            return sep;
          }
          case SeparationFunctionType.e_faceB: {
            rotVec2(normal$3, xfB$1.q, this.m_axis);
            transformVec2(pointB$2, xfB$1, this.m_localPoint);
            if (find) {
              derotVec2(axisA, xfA$1.q, scaleVec2(temp$4, -1, normal$3));
              this.indexB = -1;
              this.indexA = this.m_proxyA.getSupport(axisA);
            }
            copyVec2(localPointA, this.m_proxyA.getVertex(this.indexA));
            transformVec2(pointA$2, xfA$1, localPointA);
            var sep = dotVec2(pointA$2, normal$3) - dotVec2(pointB$2, normal$3);
            return sep;
          }
          default:
            if (find) {
              this.indexA = -1;
              this.indexB = -1;
            }
            return 0;
        }
      };
      SeparationFunction2.prototype.findMinSeparation = function(t) {
        return this.compute(true, t);
      };
      SeparationFunction2.prototype.evaluate = function(t) {
        return this.compute(false, t);
      };
      return SeparationFunction2;
    })()
  );
  var separationFunction = new SeparationFunction();
  TimeOfImpact.Input = TOIInput;
  TimeOfImpact.Output = TOIOutput;
  var math_abs$6 = Math.abs;
  var math_sqrt$3 = Math.sqrt;
  var math_min$5 = Math.min;
  var TimeStep = (
    /** @class */
    (function() {
      function TimeStep2() {
        this.dt = 0;
        this.inv_dt = 0;
        this.velocityIterations = 0;
        this.positionIterations = 0;
        this.warmStarting = false;
        this.blockSolve = true;
        this.inv_dt0 = 0;
        this.dtRatio = 1;
      }
      TimeStep2.prototype.reset = function(dt) {
        if (this.dt > 0) {
          this.inv_dt0 = this.inv_dt;
        }
        this.dt = dt;
        this.inv_dt = dt == 0 ? 0 : 1 / dt;
        this.dtRatio = dt * this.inv_dt0;
      };
      return TimeStep2;
    })()
  );
  var s_subStep = new TimeStep();
  var c = vec2(0, 0);
  var v = vec2(0, 0);
  var translation = vec2(0, 0);
  var input = new TOIInput();
  var output = new TOIOutput();
  var backup = new Sweep();
  var backup1 = new Sweep();
  var backup2 = new Sweep();
  var ContactImpulse = (
    /** @class */
    (function() {
      function ContactImpulse2(contact) {
        this.contact = contact;
        this.normals = [];
        this.tangents = [];
      }
      ContactImpulse2.prototype.recycle = function() {
        this.normals.length = 0;
        this.tangents.length = 0;
      };
      Object.defineProperty(ContactImpulse2.prototype, "normalImpulses", {
        get: function() {
          var contact = this.contact;
          var normals = this.normals;
          normals.length = 0;
          for (var p = 0; p < contact.v_points.length; ++p) {
            normals.push(contact.v_points[p].normalImpulse);
          }
          return normals;
        },
        enumerable: false,
        configurable: true
      });
      Object.defineProperty(ContactImpulse2.prototype, "tangentImpulses", {
        get: function() {
          var contact = this.contact;
          var tangents = this.tangents;
          tangents.length = 0;
          for (var p = 0; p < contact.v_points.length; ++p) {
            tangents.push(contact.v_points[p].tangentImpulse);
          }
          return tangents;
        },
        enumerable: false,
        configurable: true
      });
      return ContactImpulse2;
    })()
  );
  var Solver = (
    /** @class */
    (function() {
      function Solver2(world) {
        this.m_world = world;
        this.m_stack = [];
        this.m_bodies = [];
        this.m_contacts = [];
        this.m_joints = [];
      }
      Solver2.prototype.clear = function() {
        this.m_stack.length = 0;
        this.m_bodies.length = 0;
        this.m_contacts.length = 0;
        this.m_joints.length = 0;
      };
      Solver2.prototype.addBody = function(body) {
        this.m_bodies.push(body);
      };
      Solver2.prototype.addContact = function(contact) {
        this.m_contacts.push(contact);
      };
      Solver2.prototype.addJoint = function(joint) {
        this.m_joints.push(joint);
      };
      Solver2.prototype.solveWorld = function(step) {
        var world = this.m_world;
        for (var b2 = world.m_bodyList; b2; b2 = b2.m_next) {
          b2.m_islandFlag = false;
        }
        for (var c_1 = world.m_contactList; c_1; c_1 = c_1.m_next) {
          c_1.m_islandFlag = false;
        }
        for (var j = world.m_jointList; j; j = j.m_next) {
          j.m_islandFlag = false;
        }
        var stack = this.m_stack;
        for (var seed = world.m_bodyList; seed; seed = seed.m_next) {
          if (seed.m_islandFlag) {
            continue;
          }
          if (seed.isAwake() == false || seed.isActive() == false) {
            continue;
          }
          if (seed.isStatic()) {
            continue;
          }
          this.clear();
          stack.push(seed);
          seed.m_islandFlag = true;
          while (stack.length > 0) {
            var b2 = stack.pop();
            this.addBody(b2);
            b2.m_awakeFlag = true;
            if (b2.isStatic()) {
              continue;
            }
            for (var ce = b2.m_contactList; ce; ce = ce.next) {
              var contact = ce.contact;
              if (contact.m_islandFlag) {
                continue;
              }
              if (contact.isEnabled() == false || contact.isTouching() == false) {
                continue;
              }
              var sensorA = contact.m_fixtureA.m_isSensor;
              var sensorB = contact.m_fixtureB.m_isSensor;
              if (sensorA || sensorB) {
                continue;
              }
              this.addContact(contact);
              contact.m_islandFlag = true;
              var other = ce.other;
              if (other.m_islandFlag) {
                continue;
              }
              stack.push(other);
              other.m_islandFlag = true;
            }
            for (var je = b2.m_jointList; je; je = je.next) {
              if (je.joint.m_islandFlag == true) {
                continue;
              }
              var other = je.other;
              if (other.isActive() == false) {
                continue;
              }
              this.addJoint(je.joint);
              je.joint.m_islandFlag = true;
              if (other.m_islandFlag) {
                continue;
              }
              stack.push(other);
              other.m_islandFlag = true;
            }
          }
          this.solveIsland(step);
          for (var i = 0; i < this.m_bodies.length; ++i) {
            var b2 = this.m_bodies[i];
            if (b2.isStatic()) {
              b2.m_islandFlag = false;
            }
          }
        }
      };
      Solver2.prototype.solveIsland = function(step) {
        var world = this.m_world;
        var gravity = world.m_gravity;
        var allowSleep = world.m_allowSleep;
        var h = step.dt;
        for (var i = 0; i < this.m_bodies.length; ++i) {
          var body = this.m_bodies[i];
          copyVec2(c, body.m_sweep.c);
          var a2 = body.m_sweep.a;
          copyVec2(v, body.m_linearVelocity);
          var w = body.m_angularVelocity;
          copyVec2(body.m_sweep.c0, body.m_sweep.c);
          body.m_sweep.a0 = body.m_sweep.a;
          if (body.isDynamic()) {
            plusScaleVec2(v, h * body.m_gravityScale, gravity);
            plusScaleVec2(v, h * body.m_invMass, body.m_force);
            w += h * body.m_invI * body.m_torque;
            scaleVec2(v, 1 / (1 + h * body.m_linearDamping), v);
            w *= 1 / (1 + h * body.m_angularDamping);
          }
          copyVec2(body.c_position.c, c);
          body.c_position.a = a2;
          copyVec2(body.c_velocity.v, v);
          body.c_velocity.w = w;
        }
        for (var i = 0; i < this.m_contacts.length; ++i) {
          var contact = this.m_contacts[i];
          contact.initConstraint(step);
        }
        for (var i = 0; i < this.m_contacts.length; ++i) {
          var contact = this.m_contacts[i];
          contact.initVelocityConstraint(step);
        }
        if (step.warmStarting) {
          for (var i = 0; i < this.m_contacts.length; ++i) {
            var contact = this.m_contacts[i];
            contact.warmStartConstraint(step);
          }
        }
        for (var i = 0; i < this.m_joints.length; ++i) {
          var joint = this.m_joints[i];
          joint.initVelocityConstraints(step);
        }
        for (var i = 0; i < step.velocityIterations; ++i) {
          for (var j = 0; j < this.m_joints.length; ++j) {
            var joint = this.m_joints[j];
            joint.solveVelocityConstraints(step);
          }
          for (var j = 0; j < this.m_contacts.length; ++j) {
            var contact = this.m_contacts[j];
            contact.solveVelocityConstraint(step);
          }
        }
        for (var i = 0; i < this.m_contacts.length; ++i) {
          var contact = this.m_contacts[i];
          contact.storeConstraintImpulses(step);
        }
        for (var i = 0; i < this.m_bodies.length; ++i) {
          var body = this.m_bodies[i];
          copyVec2(c, body.c_position.c);
          var a2 = body.c_position.a;
          copyVec2(v, body.c_velocity.v);
          var w = body.c_velocity.w;
          scaleVec2(translation, h, v);
          var translationLengthSqr = lengthSqrVec2(translation);
          if (translationLengthSqr > SettingsInternal.maxTranslationSquared) {
            var ratio = SettingsInternal.maxTranslation / math_sqrt$3(translationLengthSqr);
            mulVec2(v, ratio);
          }
          var rotation2 = h * w;
          if (rotation2 * rotation2 > SettingsInternal.maxRotationSquared) {
            var ratio = SettingsInternal.maxRotation / math_abs$6(rotation2);
            w *= ratio;
          }
          plusScaleVec2(c, h, v);
          a2 += h * w;
          copyVec2(body.c_position.c, c);
          body.c_position.a = a2;
          copyVec2(body.c_velocity.v, v);
          body.c_velocity.w = w;
        }
        var positionSolved = false;
        for (var i = 0; i < step.positionIterations; ++i) {
          var minSeparation = 0;
          for (var j = 0; j < this.m_contacts.length; ++j) {
            var contact = this.m_contacts[j];
            var separation = contact.solvePositionConstraint(step);
            minSeparation = math_min$5(minSeparation, separation);
          }
          var contactsOkay = minSeparation >= -3 * SettingsInternal.linearSlop;
          var jointsOkay = true;
          for (var j = 0; j < this.m_joints.length; ++j) {
            var joint = this.m_joints[j];
            var jointOkay = joint.solvePositionConstraints(step);
            jointsOkay = jointsOkay && jointOkay;
          }
          if (contactsOkay && jointsOkay) {
            positionSolved = true;
            break;
          }
        }
        for (var i = 0; i < this.m_bodies.length; ++i) {
          var body = this.m_bodies[i];
          copyVec2(body.m_sweep.c, body.c_position.c);
          body.m_sweep.a = body.c_position.a;
          copyVec2(body.m_linearVelocity, body.c_velocity.v);
          body.m_angularVelocity = body.c_velocity.w;
          body.synchronizeTransform();
        }
        this.postSolveIsland();
        if (allowSleep) {
          var minSleepTime = Infinity;
          var linTolSqr = SettingsInternal.linearSleepToleranceSqr;
          var angTolSqr = SettingsInternal.angularSleepToleranceSqr;
          for (var i = 0; i < this.m_bodies.length; ++i) {
            var body = this.m_bodies[i];
            if (body.isStatic()) {
              continue;
            }
            if (body.m_autoSleepFlag == false || body.m_angularVelocity * body.m_angularVelocity > angTolSqr || lengthSqrVec2(body.m_linearVelocity) > linTolSqr) {
              body.m_sleepTime = 0;
              minSleepTime = 0;
            } else {
              body.m_sleepTime += h;
              minSleepTime = math_min$5(minSleepTime, body.m_sleepTime);
            }
          }
          if (minSleepTime >= SettingsInternal.timeToSleep && positionSolved) {
            for (var i = 0; i < this.m_bodies.length; ++i) {
              var body = this.m_bodies[i];
              body.setAwake(false);
            }
          }
        }
      };
      Solver2.prototype.solveWorldTOI = function(step) {
        var world = this.m_world;
        if (world.m_stepComplete) {
          for (var b2 = world.m_bodyList; b2; b2 = b2.m_next) {
            b2.m_islandFlag = false;
            b2.m_sweep.alpha0 = 0;
          }
          for (var c_2 = world.m_contactList; c_2; c_2 = c_2.m_next) {
            c_2.m_toiFlag = false;
            c_2.m_islandFlag = false;
            c_2.m_toiCount = 0;
            c_2.m_toi = 1;
          }
        }
        while (true) {
          var minContact = null;
          var minAlpha = 1;
          for (var c_3 = world.m_contactList; c_3; c_3 = c_3.m_next) {
            if (c_3.isEnabled() == false) {
              continue;
            }
            if (c_3.m_toiCount > SettingsInternal.maxSubSteps) {
              continue;
            }
            var alpha = 1;
            if (c_3.m_toiFlag) {
              alpha = c_3.m_toi;
            } else {
              var fA_1 = c_3.getFixtureA();
              var fB_1 = c_3.getFixtureB();
              if (fA_1.isSensor() || fB_1.isSensor()) {
                continue;
              }
              var bA_1 = fA_1.getBody();
              var bB_1 = fB_1.getBody();
              var activeA = bA_1.isAwake() && !bA_1.isStatic();
              var activeB = bB_1.isAwake() && !bB_1.isStatic();
              if (activeA == false && activeB == false) {
                continue;
              }
              var collideA = bA_1.isBullet() || !bA_1.isDynamic();
              var collideB = bB_1.isBullet() || !bB_1.isDynamic();
              if (collideA == false && collideB == false) {
                continue;
              }
              var alpha0 = bA_1.m_sweep.alpha0;
              if (bA_1.m_sweep.alpha0 < bB_1.m_sweep.alpha0) {
                alpha0 = bB_1.m_sweep.alpha0;
                bA_1.m_sweep.advance(alpha0);
              } else if (bB_1.m_sweep.alpha0 < bA_1.m_sweep.alpha0) {
                alpha0 = bA_1.m_sweep.alpha0;
                bB_1.m_sweep.advance(alpha0);
              }
              var indexA = c_3.getChildIndexA();
              var indexB = c_3.getChildIndexB();
              input.proxyA.set(fA_1.getShape(), indexA);
              input.proxyB.set(fB_1.getShape(), indexB);
              input.sweepA.set(bA_1.m_sweep);
              input.sweepB.set(bB_1.m_sweep);
              input.tMax = 1;
              TimeOfImpact(output, input);
              var beta = output.t;
              if (output.state == exports2.TOIOutputState.e_touching) {
                alpha = math_min$5(alpha0 + (1 - alpha0) * beta, 1);
              } else {
                alpha = 1;
              }
              c_3.m_toi = alpha;
              c_3.m_toiFlag = true;
            }
            if (alpha < minAlpha) {
              minContact = c_3;
              minAlpha = alpha;
            }
          }
          if (minContact == null || 1 - 10 * EPSILON < minAlpha) {
            world.m_stepComplete = true;
            break;
          }
          var fA = minContact.getFixtureA();
          var fB = minContact.getFixtureB();
          var bA = fA.getBody();
          var bB = fB.getBody();
          backup1.set(bA.m_sweep);
          backup2.set(bB.m_sweep);
          bA.advance(minAlpha);
          bB.advance(minAlpha);
          minContact.update(world);
          minContact.m_toiFlag = false;
          ++minContact.m_toiCount;
          if (minContact.isEnabled() == false || minContact.isTouching() == false) {
            minContact.setEnabled(false);
            bA.m_sweep.set(backup1);
            bB.m_sweep.set(backup2);
            bA.synchronizeTransform();
            bB.synchronizeTransform();
            continue;
          }
          bA.setAwake(true);
          bB.setAwake(true);
          this.clear();
          this.addBody(bA);
          this.addBody(bB);
          this.addContact(minContact);
          bA.m_islandFlag = true;
          bB.m_islandFlag = true;
          minContact.m_islandFlag = true;
          var bodies = [bA, bB];
          for (var i = 0; i < bodies.length; ++i) {
            var body = bodies[i];
            if (body.isDynamic()) {
              for (var ce = body.m_contactList; ce; ce = ce.next) {
                var contact = ce.contact;
                if (contact.m_islandFlag) {
                  continue;
                }
                var other = ce.other;
                if (other.isDynamic() && !body.isBullet() && !other.isBullet()) {
                  continue;
                }
                var sensorA = contact.m_fixtureA.m_isSensor;
                var sensorB = contact.m_fixtureB.m_isSensor;
                if (sensorA || sensorB) {
                  continue;
                }
                backup.set(other.m_sweep);
                if (other.m_islandFlag == false) {
                  other.advance(minAlpha);
                }
                contact.update(world);
                if (contact.isEnabled() == false || contact.isTouching() == false) {
                  other.m_sweep.set(backup);
                  other.synchronizeTransform();
                  continue;
                }
                contact.m_islandFlag = true;
                this.addContact(contact);
                if (other.m_islandFlag) {
                  continue;
                }
                other.m_islandFlag = true;
                if (!other.isStatic()) {
                  other.setAwake(true);
                }
                this.addBody(other);
              }
            }
          }
          s_subStep.reset((1 - minAlpha) * step.dt);
          s_subStep.dtRatio = 1;
          s_subStep.positionIterations = 20;
          s_subStep.velocityIterations = step.velocityIterations;
          s_subStep.warmStarting = false;
          this.solveIslandTOI(s_subStep, bA, bB);
          for (var i = 0; i < this.m_bodies.length; ++i) {
            var body = this.m_bodies[i];
            body.m_islandFlag = false;
            if (!body.isDynamic()) {
              continue;
            }
            body.synchronizeFixtures();
            for (var ce = body.m_contactList; ce; ce = ce.next) {
              ce.contact.m_toiFlag = false;
              ce.contact.m_islandFlag = false;
            }
          }
          world.findNewContacts();
          if (world.m_subStepping) {
            world.m_stepComplete = false;
            break;
          }
        }
      };
      Solver2.prototype.solveIslandTOI = function(subStep, toiA, toiB) {
        for (var i = 0; i < this.m_bodies.length; ++i) {
          var body = this.m_bodies[i];
          copyVec2(body.c_position.c, body.m_sweep.c);
          body.c_position.a = body.m_sweep.a;
          copyVec2(body.c_velocity.v, body.m_linearVelocity);
          body.c_velocity.w = body.m_angularVelocity;
        }
        for (var i = 0; i < this.m_contacts.length; ++i) {
          var contact = this.m_contacts[i];
          contact.initConstraint(subStep);
        }
        for (var i = 0; i < subStep.positionIterations; ++i) {
          var minSeparation = 0;
          for (var j = 0; j < this.m_contacts.length; ++j) {
            var contact = this.m_contacts[j];
            var separation = contact.solvePositionConstraintTOI(subStep, toiA, toiB);
            minSeparation = math_min$5(minSeparation, separation);
          }
          var contactsOkay = minSeparation >= -1.5 * SettingsInternal.linearSlop;
          if (contactsOkay) {
            break;
          }
        }
        var i;
        copyVec2(toiA.m_sweep.c0, toiA.c_position.c);
        toiA.m_sweep.a0 = toiA.c_position.a;
        copyVec2(toiB.m_sweep.c0, toiB.c_position.c);
        toiB.m_sweep.a0 = toiB.c_position.a;
        for (var i = 0; i < this.m_contacts.length; ++i) {
          var contact = this.m_contacts[i];
          contact.initVelocityConstraint(subStep);
        }
        for (var i = 0; i < subStep.velocityIterations; ++i) {
          for (var j = 0; j < this.m_contacts.length; ++j) {
            var contact = this.m_contacts[j];
            contact.solveVelocityConstraint(subStep);
          }
        }
        var h = subStep.dt;
        for (var i = 0; i < this.m_bodies.length; ++i) {
          var body = this.m_bodies[i];
          copyVec2(c, body.c_position.c);
          var a2 = body.c_position.a;
          copyVec2(v, body.c_velocity.v);
          var w = body.c_velocity.w;
          scaleVec2(translation, h, v);
          var translationLengthSqr = lengthSqrVec2(translation);
          if (translationLengthSqr > SettingsInternal.maxTranslationSquared) {
            var ratio = SettingsInternal.maxTranslation / math_sqrt$3(translationLengthSqr);
            mulVec2(v, ratio);
          }
          var rotation2 = h * w;
          if (rotation2 * rotation2 > SettingsInternal.maxRotationSquared) {
            var ratio = SettingsInternal.maxRotation / math_abs$6(rotation2);
            w *= ratio;
          }
          plusScaleVec2(c, h, v);
          a2 += h * w;
          copyVec2(body.c_position.c, c);
          body.c_position.a = a2;
          copyVec2(body.c_velocity.v, v);
          body.c_velocity.w = w;
          copyVec2(body.m_sweep.c, c);
          body.m_sweep.a = a2;
          copyVec2(body.m_linearVelocity, v);
          body.m_angularVelocity = w;
          body.synchronizeTransform();
        }
        this.postSolveIsland();
      };
      Solver2.prototype.postSolveIsland = function() {
        for (var c_5 = 0; c_5 < this.m_contacts.length; ++c_5) {
          var contact = this.m_contacts[c_5];
          this.m_world.postSolve(contact, contact.m_impulse);
        }
      };
      return Solver2;
    })()
  );
  Solver.TimeStep = TimeStep;
  var Mat22 = (
    /** @class */
    (function() {
      function Mat222(a2, b2, c2, d2) {
        if (typeof a2 === "object" && a2 !== null) {
          this.ex = Vec2.clone(a2);
          this.ey = Vec2.clone(b2);
        } else if (typeof a2 === "number") {
          this.ex = Vec2.neo(a2, c2);
          this.ey = Vec2.neo(b2, d2);
        } else {
          this.ex = Vec2.zero();
          this.ey = Vec2.zero();
        }
      }
      Mat222.prototype.toString = function() {
        return JSON.stringify(this);
      };
      Mat222.isValid = function(obj) {
        if (obj === null || typeof obj === "undefined") {
          return false;
        }
        return Vec2.isValid(obj.ex) && Vec2.isValid(obj.ey);
      };
      Mat222.assert = function(o) {
      };
      Mat222.prototype.set = function(a2, b2, c2, d2) {
        if (typeof a2 === "number" && typeof b2 === "number" && typeof c2 === "number" && typeof d2 === "number") {
          this.ex.setNum(a2, c2);
          this.ey.setNum(b2, d2);
        } else if (typeof a2 === "object" && typeof b2 === "object") {
          this.ex.setVec2(a2);
          this.ey.setVec2(b2);
        } else if (typeof a2 === "object") {
          this.ex.setVec2(a2.ex);
          this.ey.setVec2(a2.ey);
        } else ;
      };
      Mat222.prototype.setIdentity = function() {
        this.ex.x = 1;
        this.ey.x = 0;
        this.ex.y = 0;
        this.ey.y = 1;
      };
      Mat222.prototype.setZero = function() {
        this.ex.x = 0;
        this.ey.x = 0;
        this.ex.y = 0;
        this.ey.y = 0;
      };
      Mat222.prototype.getInverse = function() {
        var a2 = this.ex.x;
        var b2 = this.ey.x;
        var c2 = this.ex.y;
        var d2 = this.ey.y;
        var det = a2 * d2 - b2 * c2;
        if (det !== 0) {
          det = 1 / det;
        }
        var imx = new Mat222();
        imx.ex.x = det * d2;
        imx.ey.x = -det * b2;
        imx.ex.y = -det * c2;
        imx.ey.y = det * a2;
        return imx;
      };
      Mat222.prototype.solve = function(v3) {
        var a2 = this.ex.x;
        var b2 = this.ey.x;
        var c2 = this.ex.y;
        var d2 = this.ey.y;
        var det = a2 * d2 - b2 * c2;
        if (det !== 0) {
          det = 1 / det;
        }
        var w = Vec2.zero();
        w.x = det * (d2 * v3.x - b2 * v3.y);
        w.y = det * (a2 * v3.y - c2 * v3.x);
        return w;
      };
      Mat222.mul = function(mx, v3) {
        if (v3 && "x" in v3 && "y" in v3) {
          var x2 = mx.ex.x * v3.x + mx.ey.x * v3.y;
          var y = mx.ex.y * v3.x + mx.ey.y * v3.y;
          return Vec2.neo(x2, y);
        } else if (v3 && "ex" in v3 && "ey" in v3) {
          var a2 = mx.ex.x * v3.ex.x + mx.ey.x * v3.ex.y;
          var b2 = mx.ex.x * v3.ey.x + mx.ey.x * v3.ey.y;
          var c2 = mx.ex.y * v3.ex.x + mx.ey.y * v3.ex.y;
          var d2 = mx.ex.y * v3.ey.x + mx.ey.y * v3.ey.y;
          return new Mat222(a2, b2, c2, d2);
        }
      };
      Mat222.mulVec2 = function(mx, v3) {
        var x2 = mx.ex.x * v3.x + mx.ey.x * v3.y;
        var y = mx.ex.y * v3.x + mx.ey.y * v3.y;
        return Vec2.neo(x2, y);
      };
      Mat222.mulMat22 = function(mx, v3) {
        var a2 = mx.ex.x * v3.ex.x + mx.ey.x * v3.ex.y;
        var b2 = mx.ex.x * v3.ey.x + mx.ey.x * v3.ey.y;
        var c2 = mx.ex.y * v3.ex.x + mx.ey.y * v3.ex.y;
        var d2 = mx.ex.y * v3.ey.x + mx.ey.y * v3.ey.y;
        return new Mat222(a2, b2, c2, d2);
      };
      Mat222.mulT = function(mx, v3) {
        if (v3 && "x" in v3 && "y" in v3) {
          return Vec2.neo(Vec2.dot(v3, mx.ex), Vec2.dot(v3, mx.ey));
        } else if (v3 && "ex" in v3 && "ey" in v3) {
          var c1 = Vec2.neo(Vec2.dot(mx.ex, v3.ex), Vec2.dot(mx.ey, v3.ex));
          var c2 = Vec2.neo(Vec2.dot(mx.ex, v3.ey), Vec2.dot(mx.ey, v3.ey));
          return new Mat222(c1, c2);
        }
      };
      Mat222.mulTVec2 = function(mx, v3) {
        return Vec2.neo(Vec2.dot(v3, mx.ex), Vec2.dot(v3, mx.ey));
      };
      Mat222.mulTMat22 = function(mx, v3) {
        var c1 = Vec2.neo(Vec2.dot(mx.ex, v3.ex), Vec2.dot(mx.ey, v3.ex));
        var c2 = Vec2.neo(Vec2.dot(mx.ex, v3.ey), Vec2.dot(mx.ey, v3.ey));
        return new Mat222(c1, c2);
      };
      Mat222.abs = function(mx) {
        return new Mat222(Vec2.abs(mx.ex), Vec2.abs(mx.ey));
      };
      Mat222.add = function(mx1, mx2) {
        return new Mat222(Vec2.add(mx1.ex, mx2.ex), Vec2.add(mx1.ey, mx2.ey));
      };
      return Mat222;
    })()
  );
  var math_sqrt$2 = Math.sqrt;
  var pointA$1 = vec2(0, 0);
  var pointB$1 = vec2(0, 0);
  var temp$3 = vec2(0, 0);
  var cA$1 = vec2(0, 0);
  var cB$1 = vec2(0, 0);
  var dist = vec2(0, 0);
  var planePoint$2 = vec2(0, 0);
  var clipPoint$1 = vec2(0, 0);
  exports2.ManifoldType = void 0;
  (function(ManifoldType2) {
    ManifoldType2[ManifoldType2["e_unset"] = -1] = "e_unset";
    ManifoldType2[ManifoldType2["e_circles"] = 0] = "e_circles";
    ManifoldType2[ManifoldType2["e_faceA"] = 1] = "e_faceA";
    ManifoldType2[ManifoldType2["e_faceB"] = 2] = "e_faceB";
  })(exports2.ManifoldType || (exports2.ManifoldType = {}));
  exports2.ContactFeatureType = void 0;
  (function(ContactFeatureType2) {
    ContactFeatureType2[ContactFeatureType2["e_unset"] = -1] = "e_unset";
    ContactFeatureType2[ContactFeatureType2["e_vertex"] = 0] = "e_vertex";
    ContactFeatureType2[ContactFeatureType2["e_face"] = 1] = "e_face";
  })(exports2.ContactFeatureType || (exports2.ContactFeatureType = {}));
  exports2.PointState = void 0;
  (function(PointState2) {
    PointState2[PointState2["nullState"] = 0] = "nullState";
    PointState2[PointState2["addState"] = 1] = "addState";
    PointState2[PointState2["persistState"] = 2] = "persistState";
    PointState2[PointState2["removeState"] = 3] = "removeState";
  })(exports2.PointState || (exports2.PointState = {}));
  var ClipVertex = (
    /** @class */
    (function() {
      function ClipVertex2() {
        this.v = vec2(0, 0);
        this.id = new ContactID();
      }
      ClipVertex2.prototype.set = function(o) {
        copyVec2(this.v, o.v);
        this.id.set(o.id);
      };
      ClipVertex2.prototype.recycle = function() {
        zeroVec2(this.v);
        this.id.recycle();
      };
      return ClipVertex2;
    })()
  );
  var Manifold = (
    /** @class */
    (function() {
      function Manifold2() {
        this.localNormal = vec2(0, 0);
        this.localPoint = vec2(0, 0);
        this.points = [new ManifoldPoint(), new ManifoldPoint()];
        this.pointCount = 0;
      }
      Manifold2.prototype.set = function(that) {
        this.type = that.type;
        copyVec2(this.localNormal, that.localNormal);
        copyVec2(this.localPoint, that.localPoint);
        this.pointCount = that.pointCount;
        this.points[0].set(that.points[0]);
        this.points[1].set(that.points[1]);
      };
      Manifold2.prototype.recycle = function() {
        this.type = exports2.ManifoldType.e_unset;
        zeroVec2(this.localNormal);
        zeroVec2(this.localPoint);
        this.pointCount = 0;
        this.points[0].recycle();
        this.points[1].recycle();
      };
      Manifold2.prototype.getWorldManifold = function(wm, xfA2, radiusA, xfB2, radiusB) {
        if (this.pointCount == 0) {
          return wm;
        }
        wm = wm || new WorldManifold();
        wm.pointCount = this.pointCount;
        var normal3 = wm.normal;
        var points = wm.points;
        var separations = wm.separations;
        switch (this.type) {
          case exports2.ManifoldType.e_circles: {
            setVec2(normal3, 1, 0);
            var manifoldPoint = this.points[0];
            transformVec2(pointA$1, xfA2, this.localPoint);
            transformVec2(pointB$1, xfB2, manifoldPoint.localPoint);
            subVec2(dist, pointB$1, pointA$1);
            var lengthSqr = lengthSqrVec2(dist);
            if (lengthSqr > EPSILON * EPSILON) {
              var length_1 = math_sqrt$2(lengthSqr);
              scaleVec2(normal3, 1 / length_1, dist);
            }
            combine2Vec2(cA$1, 1, pointA$1, radiusA, normal3);
            combine2Vec2(cB$1, 1, pointB$1, -radiusB, normal3);
            combine2Vec2(points[0], 0.5, cA$1, 0.5, cB$1);
            separations[0] = dotVec2(subVec2(temp$3, cB$1, cA$1), normal3);
            break;
          }
          case exports2.ManifoldType.e_faceA: {
            rotVec2(normal3, xfA2.q, this.localNormal);
            transformVec2(planePoint$2, xfA2, this.localPoint);
            for (var i = 0; i < this.pointCount; ++i) {
              var manifoldPoint = this.points[i];
              transformVec2(clipPoint$1, xfB2, manifoldPoint.localPoint);
              combine2Vec2(cA$1, 1, clipPoint$1, radiusA - dotVec2(subVec2(temp$3, clipPoint$1, planePoint$2), normal3), normal3);
              combine2Vec2(cB$1, 1, clipPoint$1, -radiusB, normal3);
              combine2Vec2(points[i], 0.5, cA$1, 0.5, cB$1);
              separations[i] = dotVec2(subVec2(temp$3, cB$1, cA$1), normal3);
            }
            break;
          }
          case exports2.ManifoldType.e_faceB: {
            rotVec2(normal3, xfB2.q, this.localNormal);
            transformVec2(planePoint$2, xfB2, this.localPoint);
            for (var i = 0; i < this.pointCount; ++i) {
              var manifoldPoint = this.points[i];
              transformVec2(clipPoint$1, xfA2, manifoldPoint.localPoint);
              combine2Vec2(cB$1, 1, clipPoint$1, radiusB - dotVec2(subVec2(temp$3, clipPoint$1, planePoint$2), normal3), normal3);
              combine2Vec2(cA$1, 1, clipPoint$1, -radiusA, normal3);
              combine2Vec2(points[i], 0.5, cA$1, 0.5, cB$1);
              separations[i] = dotVec2(subVec2(temp$3, cA$1, cB$1), normal3);
            }
            negVec2(normal3);
            break;
          }
        }
        return wm;
      };
      Manifold2.clipSegmentToLine = clipSegmentToLine;
      Manifold2.ClipVertex = ClipVertex;
      Manifold2.getPointStates = getPointStates;
      Manifold2.PointState = exports2.PointState;
      return Manifold2;
    })()
  );
  var ManifoldPoint = (
    /** @class */
    (function() {
      function ManifoldPoint2() {
        this.localPoint = vec2(0, 0);
        this.normalImpulse = 0;
        this.tangentImpulse = 0;
        this.id = new ContactID();
      }
      ManifoldPoint2.prototype.set = function(that) {
        copyVec2(this.localPoint, that.localPoint);
        this.normalImpulse = that.normalImpulse;
        this.tangentImpulse = that.tangentImpulse;
        this.id.set(that.id);
      };
      ManifoldPoint2.prototype.recycle = function() {
        zeroVec2(this.localPoint);
        this.normalImpulse = 0;
        this.tangentImpulse = 0;
        this.id.recycle();
      };
      return ManifoldPoint2;
    })()
  );
  var ContactID = (
    /** @class */
    (function() {
      function ContactID2() {
        this.key = -1;
        this.indexA = -1;
        this.indexB = -1;
        this.typeA = exports2.ContactFeatureType.e_unset;
        this.typeB = exports2.ContactFeatureType.e_unset;
      }
      ContactID2.prototype.setFeatures = function(indexA, typeA, indexB, typeB) {
        this.indexA = indexA;
        this.indexB = indexB;
        this.typeA = typeA;
        this.typeB = typeB;
        this.key = this.indexA + this.indexB * 4 + this.typeA * 16 + this.typeB * 64;
      };
      ContactID2.prototype.set = function(that) {
        this.indexA = that.indexA;
        this.indexB = that.indexB;
        this.typeA = that.typeA;
        this.typeB = that.typeB;
        this.key = this.indexA + this.indexB * 4 + this.typeA * 16 + this.typeB * 64;
      };
      ContactID2.prototype.swapFeatures = function() {
        var indexA = this.indexA;
        var indexB = this.indexB;
        var typeA = this.typeA;
        var typeB = this.typeB;
        this.indexA = indexB;
        this.indexB = indexA;
        this.typeA = typeB;
        this.typeB = typeA;
        this.key = this.indexA + this.indexB * 4 + this.typeA * 16 + this.typeB * 64;
      };
      ContactID2.prototype.recycle = function() {
        this.indexA = 0;
        this.indexB = 0;
        this.typeA = exports2.ContactFeatureType.e_unset;
        this.typeB = exports2.ContactFeatureType.e_unset;
        this.key = -1;
      };
      return ContactID2;
    })()
  );
  var WorldManifold = (
    /** @class */
    (function() {
      function WorldManifold2() {
        this.normal = vec2(0, 0);
        this.points = [vec2(0, 0), vec2(0, 0)];
        this.separations = [0, 0];
        this.pointCount = 0;
      }
      WorldManifold2.prototype.recycle = function() {
        zeroVec2(this.normal);
        zeroVec2(this.points[0]);
        zeroVec2(this.points[1]);
        this.separations[0] = 0;
        this.separations[1] = 0;
        this.pointCount = 0;
      };
      return WorldManifold2;
    })()
  );
  function getPointStates(state1, state2, manifold1, manifold2) {
    for (var i = 0; i < manifold1.pointCount; ++i) {
      var id = manifold1.points[i].id;
      state1[i] = exports2.PointState.removeState;
      for (var j = 0; j < manifold2.pointCount; ++j) {
        if (manifold2.points[j].id.key === id.key) {
          state1[i] = exports2.PointState.persistState;
          break;
        }
      }
    }
    for (var i = 0; i < manifold2.pointCount; ++i) {
      var id = manifold2.points[i].id;
      state2[i] = exports2.PointState.addState;
      for (var j = 0; j < manifold1.pointCount; ++j) {
        if (manifold1.points[j].id.key === id.key) {
          state2[i] = exports2.PointState.persistState;
          break;
        }
      }
    }
  }
  function clipSegmentToLine(vOut, vIn, normal3, offset, vertexIndexA) {
    var numOut = 0;
    var distance0 = dotVec2(normal3, vIn[0].v) - offset;
    var distance1 = dotVec2(normal3, vIn[1].v) - offset;
    if (distance0 <= 0)
      vOut[numOut++].set(vIn[0]);
    if (distance1 <= 0)
      vOut[numOut++].set(vIn[1]);
    if (distance0 * distance1 < 0) {
      var interp = distance0 / (distance0 - distance1);
      combine2Vec2(vOut[numOut].v, 1 - interp, vIn[0].v, interp, vIn[1].v);
      vOut[numOut].id.setFeatures(vertexIndexA, exports2.ContactFeatureType.e_vertex, vIn[0].id.indexB, exports2.ContactFeatureType.e_face);
      ++numOut;
    }
    return numOut;
  }
  var math_sqrt$1 = Math.sqrt;
  var math_max$2 = Math.max;
  var math_min$4 = Math.min;
  var contactPool = new Pool({
    create: function() {
      return new Contact();
    },
    release: function(contact) {
      contact.recycle();
    }
  });
  var oldManifold = new Manifold();
  var worldManifold = new WorldManifold();
  var ContactEdge = (
    /** @class */
    (function() {
      function ContactEdge2(contact) {
        this.prev = null;
        this.next = null;
        this.other = null;
        this.contact = contact;
      }
      ContactEdge2.prototype.recycle = function() {
        this.prev = null;
        this.next = null;
        this.other = null;
      };
      return ContactEdge2;
    })()
  );
  function mixFriction(friction1, friction2) {
    return math_sqrt$1(friction1 * friction2);
  }
  function mixRestitution(restitution1, restitution2) {
    return restitution1 > restitution2 ? restitution1 : restitution2;
  }
  var s_registers = [];
  var VelocityConstraintPoint = (
    /** @class */
    (function() {
      function VelocityConstraintPoint2() {
        this.rA = vec2(0, 0);
        this.rB = vec2(0, 0);
        this.normalImpulse = 0;
        this.tangentImpulse = 0;
        this.normalMass = 0;
        this.tangentMass = 0;
        this.velocityBias = 0;
      }
      VelocityConstraintPoint2.prototype.recycle = function() {
        zeroVec2(this.rA);
        zeroVec2(this.rB);
        this.normalImpulse = 0;
        this.tangentImpulse = 0;
        this.normalMass = 0;
        this.tangentMass = 0;
        this.velocityBias = 0;
      };
      return VelocityConstraintPoint2;
    })()
  );
  var cA = vec2(0, 0);
  var vA = vec2(0, 0);
  var cB = vec2(0, 0);
  var vB = vec2(0, 0);
  var tangent$1 = vec2(0, 0);
  var xfA = transform(0, 0, 0);
  var xfB = transform(0, 0, 0);
  var pointA = vec2(0, 0);
  var pointB = vec2(0, 0);
  var clipPoint = vec2(0, 0);
  var planePoint$1 = vec2(0, 0);
  var rA = vec2(0, 0);
  var rB = vec2(0, 0);
  var P$1 = vec2(0, 0);
  var normal$2 = vec2(0, 0);
  var point = vec2(0, 0);
  var dv = vec2(0, 0);
  var dv1 = vec2(0, 0);
  var dv2 = vec2(0, 0);
  var b = vec2(0, 0);
  var a = vec2(0, 0);
  var x = vec2(0, 0);
  var d = vec2(0, 0);
  var P1 = vec2(0, 0);
  var P2 = vec2(0, 0);
  var temp$2 = vec2(0, 0);
  var Contact = (
    /** @class */
    (function() {
      function Contact2() {
        this.m_nodeA = new ContactEdge(this);
        this.m_nodeB = new ContactEdge(this);
        this.m_fixtureA = null;
        this.m_fixtureB = null;
        this.m_indexA = -1;
        this.m_indexB = -1;
        this.m_evaluateFcn = null;
        this.m_manifold = new Manifold();
        this.m_prev = null;
        this.m_next = null;
        this.m_toi = 1;
        this.m_toiCount = 0;
        this.m_toiFlag = false;
        this.m_friction = 0;
        this.m_restitution = 0;
        this.m_tangentSpeed = 0;
        this.m_enabledFlag = true;
        this.m_islandFlag = false;
        this.m_touchingFlag = false;
        this.m_filterFlag = false;
        this.m_bulletHitFlag = false;
        this.m_impulse = new ContactImpulse(this);
        this.v_points = [new VelocityConstraintPoint(), new VelocityConstraintPoint()];
        this.v_normal = vec2(0, 0);
        this.v_normalMass = new Mat22();
        this.v_K = new Mat22();
        this.v_pointCount = 0;
        this.v_tangentSpeed = 0;
        this.v_friction = 0;
        this.v_restitution = 0;
        this.v_invMassA = 0;
        this.v_invMassB = 0;
        this.v_invIA = 0;
        this.v_invIB = 0;
        this.p_localPoints = [vec2(0, 0), vec2(0, 0)];
        this.p_localNormal = vec2(0, 0);
        this.p_localPoint = vec2(0, 0);
        this.p_localCenterA = vec2(0, 0);
        this.p_localCenterB = vec2(0, 0);
        this.p_type = exports2.ManifoldType.e_unset;
        this.p_radiusA = 0;
        this.p_radiusB = 0;
        this.p_pointCount = 0;
        this.p_invMassA = 0;
        this.p_invMassB = 0;
        this.p_invIA = 0;
        this.p_invIB = 0;
      }
      Contact2.prototype.initialize = function(fA, indexA, fB, indexB, evaluateFcn) {
        this.m_fixtureA = fA;
        this.m_fixtureB = fB;
        this.m_indexA = indexA;
        this.m_indexB = indexB;
        this.m_evaluateFcn = evaluateFcn;
        this.m_friction = mixFriction(this.m_fixtureA.m_friction, this.m_fixtureB.m_friction);
        this.m_restitution = mixRestitution(this.m_fixtureA.m_restitution, this.m_fixtureB.m_restitution);
      };
      Contact2.prototype.recycle = function() {
        this.m_nodeA.recycle();
        this.m_nodeB.recycle();
        this.m_fixtureA = null;
        this.m_fixtureB = null;
        this.m_indexA = -1;
        this.m_indexB = -1;
        this.m_evaluateFcn = null;
        this.m_manifold.recycle();
        this.m_prev = null;
        this.m_next = null;
        this.m_toi = 1;
        this.m_toiCount = 0;
        this.m_toiFlag = false;
        this.m_friction = 0;
        this.m_restitution = 0;
        this.m_tangentSpeed = 0;
        this.m_enabledFlag = true;
        this.m_islandFlag = false;
        this.m_touchingFlag = false;
        this.m_filterFlag = false;
        this.m_bulletHitFlag = false;
        this.m_impulse.recycle();
        for (var _i = 0, _a2 = this.v_points; _i < _a2.length; _i++) {
          var point_1 = _a2[_i];
          point_1.recycle();
        }
        zeroVec2(this.v_normal);
        this.v_normalMass.setZero();
        this.v_K.setZero();
        this.v_pointCount = 0;
        this.v_tangentSpeed = 0;
        this.v_friction = 0;
        this.v_restitution = 0;
        this.v_invMassA = 0;
        this.v_invMassB = 0;
        this.v_invIA = 0;
        this.v_invIB = 0;
        for (var _b = 0, _c = this.p_localPoints; _b < _c.length; _b++) {
          var point_2 = _c[_b];
          zeroVec2(point_2);
        }
        zeroVec2(this.p_localNormal);
        zeroVec2(this.p_localPoint);
        zeroVec2(this.p_localCenterA);
        zeroVec2(this.p_localCenterB);
        this.p_type = exports2.ManifoldType.e_unset;
        this.p_radiusA = 0;
        this.p_radiusB = 0;
        this.p_pointCount = 0;
        this.p_invMassA = 0;
        this.p_invMassB = 0;
        this.p_invIA = 0;
        this.p_invIB = 0;
      };
      Contact2.prototype.initConstraint = function(step) {
        var fixtureA = this.m_fixtureA;
        var fixtureB = this.m_fixtureB;
        if (fixtureA === null || fixtureB === null)
          return;
        var bodyA = fixtureA.m_body;
        var bodyB = fixtureB.m_body;
        if (bodyA === null || bodyB === null)
          return;
        var shapeA = fixtureA.m_shape;
        var shapeB = fixtureB.m_shape;
        if (shapeA === null || shapeB === null)
          return;
        var manifold = this.m_manifold;
        var pointCount = manifold.pointCount;
        this.v_invMassA = bodyA.m_invMass;
        this.v_invMassB = bodyB.m_invMass;
        this.v_invIA = bodyA.m_invI;
        this.v_invIB = bodyB.m_invI;
        this.v_friction = this.m_friction;
        this.v_restitution = this.m_restitution;
        this.v_tangentSpeed = this.m_tangentSpeed;
        this.v_pointCount = pointCount;
        this.v_K.setZero();
        this.v_normalMass.setZero();
        this.p_invMassA = bodyA.m_invMass;
        this.p_invMassB = bodyB.m_invMass;
        this.p_invIA = bodyA.m_invI;
        this.p_invIB = bodyB.m_invI;
        copyVec2(this.p_localCenterA, bodyA.m_sweep.localCenter);
        copyVec2(this.p_localCenterB, bodyB.m_sweep.localCenter);
        this.p_radiusA = shapeA.m_radius;
        this.p_radiusB = shapeB.m_radius;
        this.p_type = manifold.type;
        copyVec2(this.p_localNormal, manifold.localNormal);
        copyVec2(this.p_localPoint, manifold.localPoint);
        this.p_pointCount = pointCount;
        for (var j = 0; j < SettingsInternal.maxManifoldPoints; ++j) {
          this.v_points[j].recycle();
          zeroVec2(this.p_localPoints[j]);
        }
        for (var j = 0; j < pointCount; ++j) {
          var cp = manifold.points[j];
          var vcp = this.v_points[j];
          if (step.warmStarting) {
            vcp.normalImpulse = step.dtRatio * cp.normalImpulse;
            vcp.tangentImpulse = step.dtRatio * cp.tangentImpulse;
          }
          copyVec2(this.p_localPoints[j], cp.localPoint);
        }
      };
      Contact2.prototype.getManifold = function() {
        return this.m_manifold;
      };
      Contact2.prototype.getWorldManifold = function(worldManifold2) {
        var fixtureA = this.m_fixtureA;
        var fixtureB = this.m_fixtureB;
        if (fixtureA === null || fixtureB === null)
          return;
        var bodyA = fixtureA.m_body;
        var bodyB = fixtureB.m_body;
        if (bodyA === null || bodyB === null)
          return;
        var shapeA = fixtureA.m_shape;
        var shapeB = fixtureB.m_shape;
        if (shapeA === null || shapeB === null)
          return;
        return this.m_manifold.getWorldManifold(worldManifold2, bodyA.getTransform(), shapeA.m_radius, bodyB.getTransform(), shapeB.m_radius);
      };
      Contact2.prototype.setEnabled = function(flag) {
        this.m_enabledFlag = !!flag;
      };
      Contact2.prototype.isEnabled = function() {
        return this.m_enabledFlag;
      };
      Contact2.prototype.isTouching = function() {
        return this.m_touchingFlag;
      };
      Contact2.prototype.getNext = function() {
        return this.m_next;
      };
      Contact2.prototype.getFixtureA = function() {
        return this.m_fixtureA;
      };
      Contact2.prototype.getFixtureB = function() {
        return this.m_fixtureB;
      };
      Contact2.prototype.getChildIndexA = function() {
        return this.m_indexA;
      };
      Contact2.prototype.getChildIndexB = function() {
        return this.m_indexB;
      };
      Contact2.prototype.flagForFiltering = function() {
        this.m_filterFlag = true;
      };
      Contact2.prototype.setFriction = function(friction) {
        this.m_friction = friction;
      };
      Contact2.prototype.getFriction = function() {
        return this.m_friction;
      };
      Contact2.prototype.resetFriction = function() {
        var fixtureA = this.m_fixtureA;
        var fixtureB = this.m_fixtureB;
        if (fixtureA === null || fixtureB === null)
          return;
        this.m_friction = mixFriction(fixtureA.m_friction, fixtureB.m_friction);
      };
      Contact2.prototype.setRestitution = function(restitution) {
        this.m_restitution = restitution;
      };
      Contact2.prototype.getRestitution = function() {
        return this.m_restitution;
      };
      Contact2.prototype.resetRestitution = function() {
        var fixtureA = this.m_fixtureA;
        var fixtureB = this.m_fixtureB;
        if (fixtureA === null || fixtureB === null)
          return;
        this.m_restitution = mixRestitution(fixtureA.m_restitution, fixtureB.m_restitution);
      };
      Contact2.prototype.setTangentSpeed = function(speed) {
        this.m_tangentSpeed = speed;
      };
      Contact2.prototype.getTangentSpeed = function() {
        return this.m_tangentSpeed;
      };
      Contact2.prototype.evaluate = function(manifold, xfA2, xfB2) {
        var fixtureA = this.m_fixtureA;
        var fixtureB = this.m_fixtureB;
        if (fixtureA === null || fixtureB === null)
          return;
        this.m_evaluateFcn(manifold, xfA2, fixtureA, this.m_indexA, xfB2, fixtureB, this.m_indexB);
      };
      Contact2.prototype.update = function(listener) {
        var fixtureA = this.m_fixtureA;
        var fixtureB = this.m_fixtureB;
        if (fixtureA === null || fixtureB === null)
          return;
        var bodyA = fixtureA.m_body;
        var bodyB = fixtureB.m_body;
        if (bodyA === null || bodyB === null)
          return;
        var shapeA = fixtureA.m_shape;
        var shapeB = fixtureB.m_shape;
        if (shapeA === null || shapeB === null)
          return;
        this.m_enabledFlag = true;
        var touching = false;
        var wasTouching = this.m_touchingFlag;
        var sensorA = fixtureA.m_isSensor;
        var sensorB = fixtureB.m_isSensor;
        var sensor = sensorA || sensorB;
        var xfA2 = bodyA.m_xf;
        var xfB2 = bodyB.m_xf;
        if (sensor) {
          touching = testOverlap(shapeA, this.m_indexA, shapeB, this.m_indexB, xfA2, xfB2);
          this.m_manifold.pointCount = 0;
        } else {
          oldManifold.recycle();
          oldManifold.set(this.m_manifold);
          this.m_manifold.recycle();
          this.evaluate(this.m_manifold, xfA2, xfB2);
          touching = this.m_manifold.pointCount > 0;
          for (var i = 0; i < this.m_manifold.pointCount; ++i) {
            var nmp = this.m_manifold.points[i];
            nmp.normalImpulse = 0;
            nmp.tangentImpulse = 0;
            for (var j = 0; j < oldManifold.pointCount; ++j) {
              var omp = oldManifold.points[j];
              if (omp.id.key === nmp.id.key) {
                nmp.normalImpulse = omp.normalImpulse;
                nmp.tangentImpulse = omp.tangentImpulse;
                break;
              }
            }
          }
          if (touching !== wasTouching) {
            bodyA.setAwake(true);
            bodyB.setAwake(true);
          }
        }
        this.m_touchingFlag = touching;
        var hasListener = typeof listener === "object" && listener !== null;
        if (!wasTouching && touching && hasListener) {
          listener.beginContact(this);
        }
        if (wasTouching && !touching && hasListener) {
          listener.endContact(this);
        }
        if (!sensor && touching && hasListener && oldManifold) {
          listener.preSolve(this, oldManifold);
        }
      };
      Contact2.prototype.solvePositionConstraint = function(step) {
        return this._solvePositionConstraint(step, null, null);
      };
      Contact2.prototype.solvePositionConstraintTOI = function(step, toiA, toiB) {
        return this._solvePositionConstraint(step, toiA, toiB);
      };
      Contact2.prototype._solvePositionConstraint = function(step, toiA, toiB) {
        var toi = toiA !== null && toiB !== null ? true : false;
        var minSeparation = 0;
        var fixtureA = this.m_fixtureA;
        var fixtureB = this.m_fixtureB;
        if (fixtureA === null || fixtureB === null)
          return minSeparation;
        var bodyA = fixtureA.m_body;
        var bodyB = fixtureB.m_body;
        if (bodyA === null || bodyB === null)
          return minSeparation;
        var positionA = bodyA.c_position;
        var positionB = bodyB.c_position;
        var localCenterA = this.p_localCenterA;
        var localCenterB = this.p_localCenterB;
        var mA = 0;
        var iA = 0;
        if (!toi || bodyA === toiA || bodyA === toiB) {
          mA = this.p_invMassA;
          iA = this.p_invIA;
        }
        var mB = 0;
        var iB = 0;
        if (!toi || bodyB === toiA || bodyB === toiB) {
          mB = this.p_invMassB;
          iB = this.p_invIB;
        }
        copyVec2(cA, positionA.c);
        var aA = positionA.a;
        copyVec2(cB, positionB.c);
        var aB = positionB.a;
        for (var j = 0; j < this.p_pointCount; ++j) {
          getTransform(xfA, localCenterA, cA, aA);
          getTransform(xfB, localCenterB, cB, aB);
          var separation = void 0;
          switch (this.p_type) {
            case exports2.ManifoldType.e_circles: {
              transformVec2(pointA, xfA, this.p_localPoint);
              transformVec2(pointB, xfB, this.p_localPoints[0]);
              subVec2(normal$2, pointB, pointA);
              normalizeVec2(normal$2);
              combine2Vec2(point, 0.5, pointA, 0.5, pointB);
              separation = dotVec2(pointB, normal$2) - dotVec2(pointA, normal$2) - this.p_radiusA - this.p_radiusB;
              break;
            }
            case exports2.ManifoldType.e_faceA: {
              rotVec2(normal$2, xfA.q, this.p_localNormal);
              transformVec2(planePoint$1, xfA, this.p_localPoint);
              transformVec2(clipPoint, xfB, this.p_localPoints[j]);
              separation = dotVec2(clipPoint, normal$2) - dotVec2(planePoint$1, normal$2) - this.p_radiusA - this.p_radiusB;
              copyVec2(point, clipPoint);
              break;
            }
            case exports2.ManifoldType.e_faceB: {
              rotVec2(normal$2, xfB.q, this.p_localNormal);
              transformVec2(planePoint$1, xfB, this.p_localPoint);
              transformVec2(clipPoint, xfA, this.p_localPoints[j]);
              separation = dotVec2(clipPoint, normal$2) - dotVec2(planePoint$1, normal$2) - this.p_radiusA - this.p_radiusB;
              copyVec2(point, clipPoint);
              negVec2(normal$2);
              break;
            }
            // todo: what should we do here?
            default: {
              return minSeparation;
            }
          }
          subVec2(rA, point, cA);
          subVec2(rB, point, cB);
          minSeparation = math_min$4(minSeparation, separation);
          var baumgarte = toi ? SettingsInternal.toiBaugarte : SettingsInternal.baumgarte;
          var linearSlop = SettingsInternal.linearSlop;
          var maxLinearCorrection = SettingsInternal.maxLinearCorrection;
          var C = clamp(baumgarte * (separation + linearSlop), -maxLinearCorrection, 0);
          var rnA = crossVec2Vec2(rA, normal$2);
          var rnB = crossVec2Vec2(rB, normal$2);
          var K = mA + mB + iA * rnA * rnA + iB * rnB * rnB;
          var impulse = K > 0 ? -C / K : 0;
          scaleVec2(P$1, impulse, normal$2);
          minusScaleVec2(cA, mA, P$1);
          aA -= iA * crossVec2Vec2(rA, P$1);
          plusScaleVec2(cB, mB, P$1);
          aB += iB * crossVec2Vec2(rB, P$1);
        }
        copyVec2(positionA.c, cA);
        positionA.a = aA;
        copyVec2(positionB.c, cB);
        positionB.a = aB;
        return minSeparation;
      };
      Contact2.prototype.initVelocityConstraint = function(step) {
        var fixtureA = this.m_fixtureA;
        var fixtureB = this.m_fixtureB;
        if (fixtureA === null || fixtureB === null)
          return;
        var bodyA = fixtureA.m_body;
        var bodyB = fixtureB.m_body;
        if (bodyA === null || bodyB === null)
          return;
        var velocityA = bodyA.c_velocity;
        var velocityB = bodyB.c_velocity;
        var positionA = bodyA.c_position;
        var positionB = bodyB.c_position;
        var radiusA = this.p_radiusA;
        var radiusB = this.p_radiusB;
        var manifold = this.m_manifold;
        var mA = this.v_invMassA;
        var mB = this.v_invMassB;
        var iA = this.v_invIA;
        var iB = this.v_invIB;
        var localCenterA = this.p_localCenterA;
        var localCenterB = this.p_localCenterB;
        copyVec2(cA, positionA.c);
        var aA = positionA.a;
        copyVec2(vA, velocityA.v);
        var wA = velocityA.w;
        copyVec2(cB, positionB.c);
        var aB = positionB.a;
        copyVec2(vB, velocityB.v);
        var wB = velocityB.w;
        getTransform(xfA, localCenterA, cA, aA);
        getTransform(xfB, localCenterB, cB, aB);
        worldManifold.recycle();
        manifold.getWorldManifold(worldManifold, xfA, radiusA, xfB, radiusB);
        copyVec2(this.v_normal, worldManifold.normal);
        for (var j = 0; j < this.v_pointCount; ++j) {
          var vcp = this.v_points[j];
          var wmp = worldManifold.points[j];
          subVec2(vcp.rA, wmp, cA);
          subVec2(vcp.rB, wmp, cB);
          var rnA = crossVec2Vec2(vcp.rA, this.v_normal);
          var rnB = crossVec2Vec2(vcp.rB, this.v_normal);
          var kNormal = mA + mB + iA * rnA * rnA + iB * rnB * rnB;
          vcp.normalMass = kNormal > 0 ? 1 / kNormal : 0;
          crossVec2Num(tangent$1, this.v_normal, 1);
          var rtA = crossVec2Vec2(vcp.rA, tangent$1);
          var rtB = crossVec2Vec2(vcp.rB, tangent$1);
          var kTangent = mA + mB + iA * rtA * rtA + iB * rtB * rtB;
          vcp.tangentMass = kTangent > 0 ? 1 / kTangent : 0;
          vcp.velocityBias = 0;
          var vRel = 0;
          vRel += dotVec2(this.v_normal, vB);
          vRel += dotVec2(this.v_normal, crossNumVec2(temp$2, wB, vcp.rB));
          vRel -= dotVec2(this.v_normal, vA);
          vRel -= dotVec2(this.v_normal, crossNumVec2(temp$2, wA, vcp.rA));
          if (vRel < -SettingsInternal.velocityThreshold) {
            vcp.velocityBias = -this.v_restitution * vRel;
          }
        }
        if (this.v_pointCount == 2 && step.blockSolve) {
          var vcp1 = this.v_points[0];
          var vcp2 = this.v_points[1];
          var rn1A = crossVec2Vec2(vcp1.rA, this.v_normal);
          var rn1B = crossVec2Vec2(vcp1.rB, this.v_normal);
          var rn2A = crossVec2Vec2(vcp2.rA, this.v_normal);
          var rn2B = crossVec2Vec2(vcp2.rB, this.v_normal);
          var k11 = mA + mB + iA * rn1A * rn1A + iB * rn1B * rn1B;
          var k22 = mA + mB + iA * rn2A * rn2A + iB * rn2B * rn2B;
          var k12 = mA + mB + iA * rn1A * rn2A + iB * rn1B * rn2B;
          var k_maxConditionNumber = 1e3;
          if (k11 * k11 < k_maxConditionNumber * (k11 * k22 - k12 * k12)) {
            this.v_K.ex.setNum(k11, k12);
            this.v_K.ey.setNum(k12, k22);
            var a_1 = this.v_K.ex.x;
            var b_1 = this.v_K.ey.x;
            var c2 = this.v_K.ex.y;
            var d_1 = this.v_K.ey.y;
            var det = a_1 * d_1 - b_1 * c2;
            if (det !== 0) {
              det = 1 / det;
            }
            this.v_normalMass.ex.x = det * d_1;
            this.v_normalMass.ey.x = -det * b_1;
            this.v_normalMass.ex.y = -det * c2;
            this.v_normalMass.ey.y = det * a_1;
          } else {
            this.v_pointCount = 1;
          }
        }
        copyVec2(positionA.c, cA);
        positionA.a = aA;
        copyVec2(velocityA.v, vA);
        velocityA.w = wA;
        copyVec2(positionB.c, cB);
        positionB.a = aB;
        copyVec2(velocityB.v, vB);
        velocityB.w = wB;
      };
      Contact2.prototype.warmStartConstraint = function(step) {
        var fixtureA = this.m_fixtureA;
        var fixtureB = this.m_fixtureB;
        if (fixtureA === null || fixtureB === null)
          return;
        var bodyA = fixtureA.m_body;
        var bodyB = fixtureB.m_body;
        if (bodyA === null || bodyB === null)
          return;
        var velocityA = bodyA.c_velocity;
        var velocityB = bodyB.c_velocity;
        var mA = this.v_invMassA;
        var iA = this.v_invIA;
        var mB = this.v_invMassB;
        var iB = this.v_invIB;
        copyVec2(vA, velocityA.v);
        var wA = velocityA.w;
        copyVec2(vB, velocityB.v);
        var wB = velocityB.w;
        copyVec2(normal$2, this.v_normal);
        crossVec2Num(tangent$1, normal$2, 1);
        for (var j = 0; j < this.v_pointCount; ++j) {
          var vcp = this.v_points[j];
          combine2Vec2(P$1, vcp.normalImpulse, normal$2, vcp.tangentImpulse, tangent$1);
          wA -= iA * crossVec2Vec2(vcp.rA, P$1);
          minusScaleVec2(vA, mA, P$1);
          wB += iB * crossVec2Vec2(vcp.rB, P$1);
          plusScaleVec2(vB, mB, P$1);
        }
        copyVec2(velocityA.v, vA);
        velocityA.w = wA;
        copyVec2(velocityB.v, vB);
        velocityB.w = wB;
      };
      Contact2.prototype.storeConstraintImpulses = function(step) {
        var manifold = this.m_manifold;
        for (var j = 0; j < this.v_pointCount; ++j) {
          manifold.points[j].normalImpulse = this.v_points[j].normalImpulse;
          manifold.points[j].tangentImpulse = this.v_points[j].tangentImpulse;
        }
      };
      Contact2.prototype.solveVelocityConstraint = function(step) {
        var fixtureA = this.m_fixtureA;
        var fixtureB = this.m_fixtureB;
        if (fixtureA === null || fixtureB === null)
          return;
        var bodyA = fixtureA.m_body;
        var bodyB = fixtureB.m_body;
        if (bodyA === null || bodyB === null)
          return;
        var velocityA = bodyA.c_velocity;
        var velocityB = bodyB.c_velocity;
        var mA = this.v_invMassA;
        var iA = this.v_invIA;
        var mB = this.v_invMassB;
        var iB = this.v_invIB;
        copyVec2(vA, velocityA.v);
        var wA = velocityA.w;
        copyVec2(vB, velocityB.v);
        var wB = velocityB.w;
        copyVec2(normal$2, this.v_normal);
        crossVec2Num(tangent$1, normal$2, 1);
        var friction = this.v_friction;
        for (var j = 0; j < this.v_pointCount; ++j) {
          var vcp = this.v_points[j];
          zeroVec2(dv);
          plusVec2(dv, vB);
          plusVec2(dv, crossNumVec2(temp$2, wB, vcp.rB));
          minusVec2(dv, vA);
          minusVec2(dv, crossNumVec2(temp$2, wA, vcp.rA));
          var vt = dotVec2(dv, tangent$1) - this.v_tangentSpeed;
          var lambda = vcp.tangentMass * -vt;
          var maxFriction = friction * vcp.normalImpulse;
          var newImpulse = clamp(vcp.tangentImpulse + lambda, -maxFriction, maxFriction);
          lambda = newImpulse - vcp.tangentImpulse;
          vcp.tangentImpulse = newImpulse;
          scaleVec2(P$1, lambda, tangent$1);
          minusScaleVec2(vA, mA, P$1);
          wA -= iA * crossVec2Vec2(vcp.rA, P$1);
          plusScaleVec2(vB, mB, P$1);
          wB += iB * crossVec2Vec2(vcp.rB, P$1);
        }
        if (this.v_pointCount == 1 || step.blockSolve == false) {
          for (var i = 0; i < this.v_pointCount; ++i) {
            var vcp = this.v_points[i];
            zeroVec2(dv);
            plusVec2(dv, vB);
            plusVec2(dv, crossNumVec2(temp$2, wB, vcp.rB));
            minusVec2(dv, vA);
            minusVec2(dv, crossNumVec2(temp$2, wA, vcp.rA));
            var vn = dotVec2(dv, normal$2);
            var lambda = -vcp.normalMass * (vn - vcp.velocityBias);
            var newImpulse = math_max$2(vcp.normalImpulse + lambda, 0);
            lambda = newImpulse - vcp.normalImpulse;
            vcp.normalImpulse = newImpulse;
            scaleVec2(P$1, lambda, normal$2);
            minusScaleVec2(vA, mA, P$1);
            wA -= iA * crossVec2Vec2(vcp.rA, P$1);
            plusScaleVec2(vB, mB, P$1);
            wB += iB * crossVec2Vec2(vcp.rB, P$1);
          }
        } else {
          var vcp1 = this.v_points[0];
          var vcp2 = this.v_points[1];
          setVec2(a, vcp1.normalImpulse, vcp2.normalImpulse);
          zeroVec2(dv1);
          plusVec2(dv1, vB);
          plusVec2(dv1, crossNumVec2(temp$2, wB, vcp1.rB));
          minusVec2(dv1, vA);
          minusVec2(dv1, crossNumVec2(temp$2, wA, vcp1.rA));
          zeroVec2(dv2);
          plusVec2(dv2, vB);
          plusVec2(dv2, crossNumVec2(temp$2, wB, vcp2.rB));
          minusVec2(dv2, vA);
          minusVec2(dv2, crossNumVec2(temp$2, wA, vcp2.rA));
          var vn1 = dotVec2(dv1, normal$2);
          var vn2 = dotVec2(dv2, normal$2);
          setVec2(b, vn1 - vcp1.velocityBias, vn2 - vcp2.velocityBias);
          b.x -= this.v_K.ex.x * a.x + this.v_K.ey.x * a.y;
          b.y -= this.v_K.ex.y * a.x + this.v_K.ey.y * a.y;
          while (true) {
            zeroVec2(x);
            x.x = -(this.v_normalMass.ex.x * b.x + this.v_normalMass.ey.x * b.y);
            x.y = -(this.v_normalMass.ex.y * b.x + this.v_normalMass.ey.y * b.y);
            if (x.x >= 0 && x.y >= 0) {
              subVec2(d, x, a);
              scaleVec2(P1, d.x, normal$2);
              scaleVec2(P2, d.y, normal$2);
              combine3Vec2(vA, -mA, P1, -mA, P2, 1, vA);
              wA -= iA * (crossVec2Vec2(vcp1.rA, P1) + crossVec2Vec2(vcp2.rA, P2));
              combine3Vec2(vB, mB, P1, mB, P2, 1, vB);
              wB += iB * (crossVec2Vec2(vcp1.rB, P1) + crossVec2Vec2(vcp2.rB, P2));
              vcp1.normalImpulse = x.x;
              vcp2.normalImpulse = x.y;
              break;
            }
            x.x = -vcp1.normalMass * b.x;
            x.y = 0;
            vn1 = 0;
            vn2 = this.v_K.ex.y * x.x + b.y;
            if (x.x >= 0 && vn2 >= 0) {
              subVec2(d, x, a);
              scaleVec2(P1, d.x, normal$2);
              scaleVec2(P2, d.y, normal$2);
              combine3Vec2(vA, -mA, P1, -mA, P2, 1, vA);
              wA -= iA * (crossVec2Vec2(vcp1.rA, P1) + crossVec2Vec2(vcp2.rA, P2));
              combine3Vec2(vB, mB, P1, mB, P2, 1, vB);
              wB += iB * (crossVec2Vec2(vcp1.rB, P1) + crossVec2Vec2(vcp2.rB, P2));
              vcp1.normalImpulse = x.x;
              vcp2.normalImpulse = x.y;
              break;
            }
            x.x = 0;
            x.y = -vcp2.normalMass * b.y;
            vn1 = this.v_K.ey.x * x.y + b.x;
            vn2 = 0;
            if (x.y >= 0 && vn1 >= 0) {
              subVec2(d, x, a);
              scaleVec2(P1, d.x, normal$2);
              scaleVec2(P2, d.y, normal$2);
              combine3Vec2(vA, -mA, P1, -mA, P2, 1, vA);
              wA -= iA * (crossVec2Vec2(vcp1.rA, P1) + crossVec2Vec2(vcp2.rA, P2));
              combine3Vec2(vB, mB, P1, mB, P2, 1, vB);
              wB += iB * (crossVec2Vec2(vcp1.rB, P1) + crossVec2Vec2(vcp2.rB, P2));
              vcp1.normalImpulse = x.x;
              vcp2.normalImpulse = x.y;
              break;
            }
            x.x = 0;
            x.y = 0;
            vn1 = b.x;
            vn2 = b.y;
            if (vn1 >= 0 && vn2 >= 0) {
              subVec2(d, x, a);
              scaleVec2(P1, d.x, normal$2);
              scaleVec2(P2, d.y, normal$2);
              combine3Vec2(vA, -mA, P1, -mA, P2, 1, vA);
              wA -= iA * (crossVec2Vec2(vcp1.rA, P1) + crossVec2Vec2(vcp2.rA, P2));
              combine3Vec2(vB, mB, P1, mB, P2, 1, vB);
              wB += iB * (crossVec2Vec2(vcp1.rB, P1) + crossVec2Vec2(vcp2.rB, P2));
              vcp1.normalImpulse = x.x;
              vcp2.normalImpulse = x.y;
              break;
            }
            break;
          }
        }
        copyVec2(velocityA.v, vA);
        velocityA.w = wA;
        copyVec2(velocityB.v, vB);
        velocityB.w = wB;
      };
      Contact2.addType = function(type1, type2, callback) {
        s_registers[type1] = s_registers[type1] || {};
        s_registers[type1][type2] = callback;
      };
      Contact2.create = function(fixtureA, indexA, fixtureB, indexB) {
        var typeA = fixtureA.m_shape.m_type;
        var typeB = fixtureB.m_shape.m_type;
        var contact = contactPool.allocate();
        var evaluateFcn;
        if (evaluateFcn = s_registers[typeA] && s_registers[typeA][typeB]) {
          contact.initialize(fixtureA, indexA, fixtureB, indexB, evaluateFcn);
        } else if (evaluateFcn = s_registers[typeB] && s_registers[typeB][typeA]) {
          contact.initialize(fixtureB, indexB, fixtureA, indexA, evaluateFcn);
        } else {
          return null;
        }
        fixtureA = contact.m_fixtureA;
        fixtureB = contact.m_fixtureB;
        indexA = contact.getChildIndexA();
        indexB = contact.getChildIndexB();
        var bodyA = fixtureA.m_body;
        var bodyB = fixtureB.m_body;
        contact.m_nodeA.contact = contact;
        contact.m_nodeA.other = bodyB;
        contact.m_nodeA.prev = null;
        contact.m_nodeA.next = bodyA.m_contactList;
        if (bodyA.m_contactList != null) {
          bodyA.m_contactList.prev = contact.m_nodeA;
        }
        bodyA.m_contactList = contact.m_nodeA;
        contact.m_nodeB.contact = contact;
        contact.m_nodeB.other = bodyA;
        contact.m_nodeB.prev = null;
        contact.m_nodeB.next = bodyB.m_contactList;
        if (bodyB.m_contactList != null) {
          bodyB.m_contactList.prev = contact.m_nodeB;
        }
        bodyB.m_contactList = contact.m_nodeB;
        if (fixtureA.isSensor() == false && fixtureB.isSensor() == false) {
          bodyA.setAwake(true);
          bodyB.setAwake(true);
        }
        return contact;
      };
      Contact2.destroy = function(contact, listener) {
        var fixtureA = contact.m_fixtureA;
        var fixtureB = contact.m_fixtureB;
        if (fixtureA === null || fixtureB === null)
          return;
        var bodyA = fixtureA.m_body;
        var bodyB = fixtureB.m_body;
        if (bodyA === null || bodyB === null)
          return;
        if (contact.isTouching()) {
          listener.endContact(contact);
        }
        if (contact.m_nodeA.prev) {
          contact.m_nodeA.prev.next = contact.m_nodeA.next;
        }
        if (contact.m_nodeA.next) {
          contact.m_nodeA.next.prev = contact.m_nodeA.prev;
        }
        if (contact.m_nodeA == bodyA.m_contactList) {
          bodyA.m_contactList = contact.m_nodeA.next;
        }
        if (contact.m_nodeB.prev) {
          contact.m_nodeB.prev.next = contact.m_nodeB.next;
        }
        if (contact.m_nodeB.next) {
          contact.m_nodeB.next.prev = contact.m_nodeB.prev;
        }
        if (contact.m_nodeB == bodyB.m_contactList) {
          bodyB.m_contactList = contact.m_nodeB.next;
        }
        if (contact.m_manifold.pointCount > 0 && !fixtureA.m_isSensor && !fixtureB.m_isSensor) {
          bodyA.setAwake(true);
          bodyB.setAwake(true);
        }
        contactPool.release(contact);
      };
      return Contact2;
    })()
  );
  var DEFAULTS$b = {
    gravity: Vec2.zero(),
    allowSleep: true,
    warmStarting: true,
    continuousPhysics: true,
    subStepping: false,
    blockSolve: true,
    velocityIterations: 8,
    positionIterations: 3
  };
  var World = (
    /** @class */
    (function() {
      function World2(def) {
        if (!(this instanceof World2)) {
          return new World2(def);
        }
        this.s_step = new TimeStep();
        if (!def) {
          def = {};
        } else if (Vec2.isValid(def)) {
          def = { gravity: def };
        }
        def = options(def, DEFAULTS$b);
        this.m_solver = new Solver(this);
        this.m_broadPhase = new BroadPhase();
        this.m_contactList = null;
        this.m_contactCount = 0;
        this.m_bodyList = null;
        this.m_bodyCount = 0;
        this.m_jointList = null;
        this.m_jointCount = 0;
        this.m_stepComplete = true;
        this.m_allowSleep = def.allowSleep;
        this.m_gravity = Vec2.clone(def.gravity);
        this.m_clearForces = true;
        this.m_newFixture = false;
        this.m_locked = false;
        this.m_warmStarting = def.warmStarting;
        this.m_continuousPhysics = def.continuousPhysics;
        this.m_subStepping = def.subStepping;
        this.m_blockSolve = def.blockSolve;
        this.m_velocityIterations = def.velocityIterations;
        this.m_positionIterations = def.positionIterations;
        this.m_t = 0;
        this.m_step_callback = [];
      }
      World2.prototype._serialize = function() {
        var bodies = [];
        var joints = [];
        for (var b2 = this.getBodyList(); b2; b2 = b2.getNext()) {
          bodies.push(b2);
        }
        for (var j = this.getJointList(); j; j = j.getNext()) {
          if (typeof j._serialize === "function") {
            joints.push(j);
          }
        }
        return {
          gravity: this.m_gravity,
          bodies,
          joints
        };
      };
      World2._deserialize = function(data, context, restore) {
        if (!data) {
          return new World2();
        }
        var world = new World2(data.gravity);
        if (data.bodies) {
          for (var i = data.bodies.length - 1; i >= 0; i -= 1) {
            world._addBody(restore(Body, data.bodies[i], world));
          }
        }
        if (data.joints) {
          for (var i = data.joints.length - 1; i >= 0; i--) {
            world.createJoint(restore(Joint, data.joints[i], world));
          }
        }
        return world;
      };
      World2.prototype.getBodyList = function() {
        return this.m_bodyList;
      };
      World2.prototype.getJointList = function() {
        return this.m_jointList;
      };
      World2.prototype.getContactList = function() {
        return this.m_contactList;
      };
      World2.prototype.getBodyCount = function() {
        return this.m_bodyCount;
      };
      World2.prototype.getJointCount = function() {
        return this.m_jointCount;
      };
      World2.prototype.getContactCount = function() {
        return this.m_contactCount;
      };
      World2.prototype.setGravity = function(gravity) {
        this.m_gravity.set(gravity);
      };
      World2.prototype.getGravity = function() {
        return this.m_gravity;
      };
      World2.prototype.isLocked = function() {
        return this.m_locked;
      };
      World2.prototype.setAllowSleeping = function(flag) {
        if (flag == this.m_allowSleep) {
          return;
        }
        this.m_allowSleep = flag;
        if (this.m_allowSleep == false) {
          for (var b2 = this.m_bodyList; b2; b2 = b2.m_next) {
            b2.setAwake(true);
          }
        }
      };
      World2.prototype.getAllowSleeping = function() {
        return this.m_allowSleep;
      };
      World2.prototype.setWarmStarting = function(flag) {
        this.m_warmStarting = flag;
      };
      World2.prototype.getWarmStarting = function() {
        return this.m_warmStarting;
      };
      World2.prototype.setContinuousPhysics = function(flag) {
        this.m_continuousPhysics = flag;
      };
      World2.prototype.getContinuousPhysics = function() {
        return this.m_continuousPhysics;
      };
      World2.prototype.setSubStepping = function(flag) {
        this.m_subStepping = flag;
      };
      World2.prototype.getSubStepping = function() {
        return this.m_subStepping;
      };
      World2.prototype.setAutoClearForces = function(flag) {
        this.m_clearForces = flag;
      };
      World2.prototype.getAutoClearForces = function() {
        return this.m_clearForces;
      };
      World2.prototype.clearForces = function() {
        for (var body = this.m_bodyList; body; body = body.getNext()) {
          body.m_force.setZero();
          body.m_torque = 0;
        }
      };
      World2.prototype.queryAABB = function(aabb, callback) {
        var broadPhase = this.m_broadPhase;
        this.m_broadPhase.query(aabb, function(proxyId) {
          var proxy = broadPhase.getUserData(proxyId);
          return callback(proxy.fixture);
        });
      };
      World2.prototype.rayCast = function(point1, point2, callback) {
        var broadPhase = this.m_broadPhase;
        this.m_broadPhase.rayCast({
          maxFraction: 1,
          p1: point1,
          p2: point2
        }, function(input2, proxyId) {
          var proxy = broadPhase.getUserData(proxyId);
          var fixture = proxy.fixture;
          var index = proxy.childIndex;
          var output2 = {};
          var hit = fixture.rayCast(output2, input2, index);
          if (hit) {
            var fraction = output2.fraction;
            var point3 = Vec2.add(Vec2.mulNumVec2(1 - fraction, input2.p1), Vec2.mulNumVec2(fraction, input2.p2));
            return callback(fixture, point3, output2.normal, fraction);
          }
          return input2.maxFraction;
        });
      };
      World2.prototype.getProxyCount = function() {
        return this.m_broadPhase.getProxyCount();
      };
      World2.prototype.getTreeHeight = function() {
        return this.m_broadPhase.getTreeHeight();
      };
      World2.prototype.getTreeBalance = function() {
        return this.m_broadPhase.getTreeBalance();
      };
      World2.prototype.getTreeQuality = function() {
        return this.m_broadPhase.getTreeQuality();
      };
      World2.prototype.shiftOrigin = function(newOrigin) {
        if (this.isLocked()) {
          return;
        }
        for (var b2 = this.m_bodyList; b2; b2 = b2.m_next) {
          b2.m_xf.p.sub(newOrigin);
          b2.m_sweep.c0.sub(newOrigin);
          b2.m_sweep.c.sub(newOrigin);
        }
        for (var j = this.m_jointList; j; j = j.m_next) {
          j.shiftOrigin(newOrigin);
        }
        this.m_broadPhase.shiftOrigin(newOrigin);
      };
      World2.prototype._addBody = function(body) {
        if (this.isLocked()) {
          return;
        }
        body.m_prev = null;
        body.m_next = this.m_bodyList;
        if (this.m_bodyList) {
          this.m_bodyList.m_prev = body;
        }
        this.m_bodyList = body;
        ++this.m_bodyCount;
        this.publish("add-body", body);
      };
      World2.prototype.createBody = function(arg1, arg2) {
        if (this.isLocked()) {
          return null;
        }
        var def = {};
        if (!arg1) ;
        else if (Vec2.isValid(arg1)) {
          def = { position: arg1, angle: arg2 };
        } else if (typeof arg1 === "object") {
          def = arg1;
        }
        var body = new Body(this, def);
        this._addBody(body);
        return body;
      };
      World2.prototype.createDynamicBody = function(arg1, arg2) {
        var def = {};
        if (!arg1) ;
        else if (Vec2.isValid(arg1)) {
          def = { position: arg1, angle: arg2 };
        } else if (typeof arg1 === "object") {
          def = arg1;
        }
        def.type = "dynamic";
        return this.createBody(def);
      };
      World2.prototype.createKinematicBody = function(arg1, arg2) {
        var def = {};
        if (!arg1) ;
        else if (Vec2.isValid(arg1)) {
          def = { position: arg1, angle: arg2 };
        } else if (typeof arg1 === "object") {
          def = arg1;
        }
        def.type = "kinematic";
        return this.createBody(def);
      };
      World2.prototype.destroyBody = function(b2) {
        if (this.isLocked()) {
          return;
        }
        if (b2.m_destroyed) {
          return false;
        }
        var je = b2.m_jointList;
        while (je) {
          var je0 = je;
          je = je.next;
          this.publish("remove-joint", je0.joint);
          this.destroyJoint(je0.joint);
          b2.m_jointList = je;
        }
        b2.m_jointList = null;
        var ce = b2.m_contactList;
        while (ce) {
          var ce0 = ce;
          ce = ce.next;
          this.destroyContact(ce0.contact);
          b2.m_contactList = ce;
        }
        b2.m_contactList = null;
        var f = b2.m_fixtureList;
        while (f) {
          var f0 = f;
          f = f.m_next;
          this.publish("remove-fixture", f0);
          f0.destroyProxies(this.m_broadPhase);
          b2.m_fixtureList = f;
        }
        b2.m_fixtureList = null;
        if (b2.m_prev) {
          b2.m_prev.m_next = b2.m_next;
        }
        if (b2.m_next) {
          b2.m_next.m_prev = b2.m_prev;
        }
        if (b2 == this.m_bodyList) {
          this.m_bodyList = b2.m_next;
        }
        b2.m_destroyed = true;
        --this.m_bodyCount;
        this.publish("remove-body", b2);
        return true;
      };
      World2.prototype.createJoint = function(joint) {
        if (this.isLocked()) {
          return null;
        }
        joint.m_prev = null;
        joint.m_next = this.m_jointList;
        if (this.m_jointList) {
          this.m_jointList.m_prev = joint;
        }
        this.m_jointList = joint;
        ++this.m_jointCount;
        joint.m_edgeA.joint = joint;
        joint.m_edgeA.other = joint.m_bodyB;
        joint.m_edgeA.prev = null;
        joint.m_edgeA.next = joint.m_bodyA.m_jointList;
        if (joint.m_bodyA.m_jointList)
          joint.m_bodyA.m_jointList.prev = joint.m_edgeA;
        joint.m_bodyA.m_jointList = joint.m_edgeA;
        joint.m_edgeB.joint = joint;
        joint.m_edgeB.other = joint.m_bodyA;
        joint.m_edgeB.prev = null;
        joint.m_edgeB.next = joint.m_bodyB.m_jointList;
        if (joint.m_bodyB.m_jointList)
          joint.m_bodyB.m_jointList.prev = joint.m_edgeB;
        joint.m_bodyB.m_jointList = joint.m_edgeB;
        if (joint.m_collideConnected == false) {
          for (var edge = joint.m_bodyB.getContactList(); edge; edge = edge.next) {
            if (edge.other == joint.m_bodyA) {
              edge.contact.flagForFiltering();
            }
          }
        }
        this.publish("add-joint", joint);
        return joint;
      };
      World2.prototype.destroyJoint = function(joint) {
        if (this.isLocked()) {
          return;
        }
        if (joint.m_prev) {
          joint.m_prev.m_next = joint.m_next;
        }
        if (joint.m_next) {
          joint.m_next.m_prev = joint.m_prev;
        }
        if (joint == this.m_jointList) {
          this.m_jointList = joint.m_next;
        }
        var bodyA = joint.m_bodyA;
        var bodyB = joint.m_bodyB;
        bodyA.setAwake(true);
        bodyB.setAwake(true);
        if (joint.m_edgeA.prev) {
          joint.m_edgeA.prev.next = joint.m_edgeA.next;
        }
        if (joint.m_edgeA.next) {
          joint.m_edgeA.next.prev = joint.m_edgeA.prev;
        }
        if (joint.m_edgeA == bodyA.m_jointList) {
          bodyA.m_jointList = joint.m_edgeA.next;
        }
        joint.m_edgeA.prev = null;
        joint.m_edgeA.next = null;
        if (joint.m_edgeB.prev) {
          joint.m_edgeB.prev.next = joint.m_edgeB.next;
        }
        if (joint.m_edgeB.next) {
          joint.m_edgeB.next.prev = joint.m_edgeB.prev;
        }
        if (joint.m_edgeB == bodyB.m_jointList) {
          bodyB.m_jointList = joint.m_edgeB.next;
        }
        joint.m_edgeB.prev = null;
        joint.m_edgeB.next = null;
        --this.m_jointCount;
        if (joint.m_collideConnected == false) {
          var edge = bodyB.getContactList();
          while (edge) {
            if (edge.other == bodyA) {
              edge.contact.flagForFiltering();
            }
            edge = edge.next;
          }
        }
        this.publish("remove-joint", joint);
      };
      World2.prototype.step = function(timeStep, velocityIterations, positionIterations) {
        this.publish("pre-step", timeStep);
        if ((velocityIterations | 0) !== velocityIterations) {
          velocityIterations = 0;
        }
        velocityIterations = velocityIterations || this.m_velocityIterations;
        positionIterations = positionIterations || this.m_positionIterations;
        if (this.m_newFixture) {
          this.findNewContacts();
          this.m_newFixture = false;
        }
        this.m_locked = true;
        this.s_step.reset(timeStep);
        this.s_step.velocityIterations = velocityIterations;
        this.s_step.positionIterations = positionIterations;
        this.s_step.warmStarting = this.m_warmStarting;
        this.s_step.blockSolve = this.m_blockSolve;
        this.updateContacts();
        if (this.m_stepComplete && timeStep > 0) {
          this.m_solver.solveWorld(this.s_step);
          for (var b2 = this.m_bodyList; b2; b2 = b2.getNext()) {
            if (b2.m_islandFlag == false) {
              continue;
            }
            if (b2.isStatic()) {
              continue;
            }
            b2.synchronizeFixtures();
          }
          this.findNewContacts();
        }
        if (this.m_continuousPhysics && timeStep > 0) {
          this.m_solver.solveWorldTOI(this.s_step);
        }
        if (this.m_clearForces) {
          this.clearForces();
        }
        this.m_locked = false;
        var callback;
        while (callback = this.m_step_callback.shift()) {
          callback(this);
        }
        this.publish("post-step", timeStep);
      };
      World2.prototype.queueUpdate = function(callback) {
        if (!this.isLocked()) {
          callback(this);
        } else {
          this.m_step_callback.push(callback);
        }
      };
      World2.prototype.findNewContacts = function() {
        var _this = this;
        this.m_broadPhase.updatePairs(function(proxyA, proxyB) {
          return _this.createContact(proxyA, proxyB);
        });
      };
      World2.prototype.createContact = function(proxyA, proxyB) {
        var fixtureA = proxyA.fixture;
        var fixtureB = proxyB.fixture;
        var indexA = proxyA.childIndex;
        var indexB = proxyB.childIndex;
        var bodyA = fixtureA.getBody();
        var bodyB = fixtureB.getBody();
        if (bodyA == bodyB) {
          return;
        }
        var edge = bodyB.getContactList();
        while (edge) {
          if (edge.other == bodyA) {
            var fA = edge.contact.getFixtureA();
            var fB = edge.contact.getFixtureB();
            var iA = edge.contact.getChildIndexA();
            var iB = edge.contact.getChildIndexB();
            if (fA == fixtureA && fB == fixtureB && iA == indexA && iB == indexB) {
              return;
            }
            if (fA == fixtureB && fB == fixtureA && iA == indexB && iB == indexA) {
              return;
            }
          }
          edge = edge.next;
        }
        if (bodyB.shouldCollide(bodyA) == false) {
          return;
        }
        if (fixtureB.shouldCollide(fixtureA) == false) {
          return;
        }
        var contact = Contact.create(fixtureA, indexA, fixtureB, indexB);
        if (contact == null) {
          return;
        }
        contact.m_prev = null;
        if (this.m_contactList != null) {
          contact.m_next = this.m_contactList;
          this.m_contactList.m_prev = contact;
        }
        this.m_contactList = contact;
        ++this.m_contactCount;
      };
      World2.prototype.updateContacts = function() {
        var c2;
        var next_c = this.m_contactList;
        while (c2 = next_c) {
          next_c = c2.getNext();
          var fixtureA = c2.getFixtureA();
          var fixtureB = c2.getFixtureB();
          var indexA = c2.getChildIndexA();
          var indexB = c2.getChildIndexB();
          var bodyA = fixtureA.getBody();
          var bodyB = fixtureB.getBody();
          if (c2.m_filterFlag) {
            if (bodyB.shouldCollide(bodyA) == false) {
              this.destroyContact(c2);
              continue;
            }
            if (fixtureB.shouldCollide(fixtureA) == false) {
              this.destroyContact(c2);
              continue;
            }
            c2.m_filterFlag = false;
          }
          var activeA = bodyA.isAwake() && !bodyA.isStatic();
          var activeB = bodyB.isAwake() && !bodyB.isStatic();
          if (activeA == false && activeB == false) {
            continue;
          }
          var proxyIdA = fixtureA.m_proxies[indexA].proxyId;
          var proxyIdB = fixtureB.m_proxies[indexB].proxyId;
          var overlap = this.m_broadPhase.testOverlap(proxyIdA, proxyIdB);
          if (overlap == false) {
            this.destroyContact(c2);
            continue;
          }
          c2.update(this);
        }
      };
      World2.prototype.destroyContact = function(contact) {
        if (contact.m_prev) {
          contact.m_prev.m_next = contact.m_next;
        }
        if (contact.m_next) {
          contact.m_next.m_prev = contact.m_prev;
        }
        if (contact == this.m_contactList) {
          this.m_contactList = contact.m_next;
        }
        Contact.destroy(contact, this);
        --this.m_contactCount;
      };
      World2.prototype.on = function(name, listener) {
        if (typeof name !== "string" || typeof listener !== "function") {
          return this;
        }
        if (!this._listeners) {
          this._listeners = {};
        }
        if (!this._listeners[name]) {
          this._listeners[name] = [];
        }
        this._listeners[name].push(listener);
        return this;
      };
      World2.prototype.off = function(name, listener) {
        if (typeof name !== "string" || typeof listener !== "function") {
          return this;
        }
        var listeners = this._listeners && this._listeners[name];
        if (!listeners || !listeners.length) {
          return this;
        }
        var index = listeners.indexOf(listener);
        if (index >= 0) {
          listeners.splice(index, 1);
        }
        return this;
      };
      World2.prototype.publish = function(name, arg1, arg2, arg3) {
        var listeners = this._listeners && this._listeners[name];
        if (!listeners || !listeners.length) {
          return 0;
        }
        for (var l = 0; l < listeners.length; l++) {
          listeners[l].call(this, arg1, arg2, arg3);
        }
        return listeners.length;
      };
      World2.prototype.beginContact = function(contact) {
        this.publish("begin-contact", contact);
      };
      World2.prototype.endContact = function(contact) {
        this.publish("end-contact", contact);
      };
      World2.prototype.preSolve = function(contact, oldManifold2) {
        this.publish("pre-solve", contact, oldManifold2);
      };
      World2.prototype.postSolve = function(contact, impulse) {
        this.publish("post-solve", contact, impulse);
      };
      return World2;
    })()
  );
  var Vec3 = (
    /** @class */
    (function() {
      function Vec32(x2, y, z) {
        if (!(this instanceof Vec32)) {
          return new Vec32(x2, y, z);
        }
        if (typeof x2 === "undefined") {
          this.x = 0;
          this.y = 0;
          this.z = 0;
        } else if (typeof x2 === "object") {
          this.x = x2.x;
          this.y = x2.y;
          this.z = x2.z;
        } else {
          this.x = x2;
          this.y = y;
          this.z = z;
        }
      }
      Vec32.prototype._serialize = function() {
        return {
          x: this.x,
          y: this.y,
          z: this.z
        };
      };
      Vec32._deserialize = function(data) {
        var obj = Object.create(Vec32.prototype);
        obj.x = data.x;
        obj.y = data.y;
        obj.z = data.z;
        return obj;
      };
      Vec32.neo = function(x2, y, z) {
        var obj = Object.create(Vec32.prototype);
        obj.x = x2;
        obj.y = y;
        obj.z = z;
        return obj;
      };
      Vec32.zero = function() {
        var obj = Object.create(Vec32.prototype);
        obj.x = 0;
        obj.y = 0;
        obj.z = 0;
        return obj;
      };
      Vec32.clone = function(v3) {
        return Vec32.neo(v3.x, v3.y, v3.z);
      };
      Vec32.prototype.toString = function() {
        return JSON.stringify(this);
      };
      Vec32.isValid = function(obj) {
        if (obj === null || typeof obj === "undefined") {
          return false;
        }
        return Number.isFinite(obj.x) && Number.isFinite(obj.y) && Number.isFinite(obj.z);
      };
      Vec32.assert = function(o) {
      };
      Vec32.prototype.setZero = function() {
        this.x = 0;
        this.y = 0;
        this.z = 0;
        return this;
      };
      Vec32.prototype.set = function(x2, y, z) {
        this.x = x2;
        this.y = y;
        this.z = z;
        return this;
      };
      Vec32.prototype.add = function(w) {
        this.x += w.x;
        this.y += w.y;
        this.z += w.z;
        return this;
      };
      Vec32.prototype.sub = function(w) {
        this.x -= w.x;
        this.y -= w.y;
        this.z -= w.z;
        return this;
      };
      Vec32.prototype.mul = function(m) {
        this.x *= m;
        this.y *= m;
        this.z *= m;
        return this;
      };
      Vec32.areEqual = function(v3, w) {
        return v3 === w || typeof v3 === "object" && v3 !== null && typeof w === "object" && w !== null && v3.x === w.x && v3.y === w.y && v3.z === w.z;
      };
      Vec32.dot = function(v3, w) {
        return v3.x * w.x + v3.y * w.y + v3.z * w.z;
      };
      Vec32.cross = function(v3, w) {
        return new Vec32(v3.y * w.z - v3.z * w.y, v3.z * w.x - v3.x * w.z, v3.x * w.y - v3.y * w.x);
      };
      Vec32.add = function(v3, w) {
        return new Vec32(v3.x + w.x, v3.y + w.y, v3.z + w.z);
      };
      Vec32.sub = function(v3, w) {
        return new Vec32(v3.x - w.x, v3.y - w.y, v3.z - w.z);
      };
      Vec32.mul = function(v3, m) {
        return new Vec32(m * v3.x, m * v3.y, m * v3.z);
      };
      Vec32.prototype.neg = function() {
        this.x = -this.x;
        this.y = -this.y;
        this.z = -this.z;
        return this;
      };
      Vec32.neg = function(v3) {
        return new Vec32(-v3.x, -v3.y, -v3.z);
      };
      return Vec32;
    })()
  );
  var v1$2 = vec2(0, 0);
  var v2$1 = vec2(0, 0);
  var EdgeShape = (
    /** @class */
    (function(_super) {
      __extends(EdgeShape2, _super);
      function EdgeShape2(v122, v22) {
        var _this = this;
        if (!(_this instanceof EdgeShape2)) {
          return new EdgeShape2(v122, v22);
        }
        _this = _super.call(this) || this;
        _this.m_type = EdgeShape2.TYPE;
        _this.m_radius = SettingsInternal.polygonRadius;
        _this.m_vertex1 = v122 ? Vec2.clone(v122) : Vec2.zero();
        _this.m_vertex2 = v22 ? Vec2.clone(v22) : Vec2.zero();
        _this.m_vertex0 = Vec2.zero();
        _this.m_vertex3 = Vec2.zero();
        _this.m_hasVertex0 = false;
        _this.m_hasVertex3 = false;
        return _this;
      }
      EdgeShape2.prototype._serialize = function() {
        return {
          type: this.m_type,
          vertex1: this.m_vertex1,
          vertex2: this.m_vertex2,
          vertex0: this.m_vertex0,
          vertex3: this.m_vertex3
        };
      };
      EdgeShape2._deserialize = function(data) {
        var shape = new EdgeShape2(data.vertex1, data.vertex2);
        if (shape.m_hasVertex0) {
          shape.setPrevVertex(data.vertex0);
        }
        if (shape.m_hasVertex3) {
          shape.setNextVertex(data.vertex3);
        }
        return shape;
      };
      EdgeShape2.prototype._reset = function() {
      };
      EdgeShape2.prototype.getRadius = function() {
        return this.m_radius;
      };
      EdgeShape2.prototype.getType = function() {
        return this.m_type;
      };
      EdgeShape2.prototype.setNext = function(v3) {
        return this.setNextVertex(v3);
      };
      EdgeShape2.prototype.setNextVertex = function(v3) {
        if (v3) {
          this.m_vertex3.setVec2(v3);
          this.m_hasVertex3 = true;
        } else {
          this.m_vertex3.setZero();
          this.m_hasVertex3 = false;
        }
        return this;
      };
      EdgeShape2.prototype.getNextVertex = function() {
        return this.m_vertex3;
      };
      EdgeShape2.prototype.setPrev = function(v3) {
        return this.setPrevVertex(v3);
      };
      EdgeShape2.prototype.setPrevVertex = function(v3) {
        if (v3) {
          this.m_vertex0.setVec2(v3);
          this.m_hasVertex0 = true;
        } else {
          this.m_vertex0.setZero();
          this.m_hasVertex0 = false;
        }
        return this;
      };
      EdgeShape2.prototype.getPrevVertex = function() {
        return this.m_vertex0;
      };
      EdgeShape2.prototype._set = function(v122, v22) {
        this.m_vertex1.setVec2(v122);
        this.m_vertex2.setVec2(v22);
        this.m_hasVertex0 = false;
        this.m_hasVertex3 = false;
        return this;
      };
      EdgeShape2.prototype._clone = function() {
        var clone = new EdgeShape2();
        clone.m_type = this.m_type;
        clone.m_radius = this.m_radius;
        clone.m_vertex1.setVec2(this.m_vertex1);
        clone.m_vertex2.setVec2(this.m_vertex2);
        clone.m_vertex0.setVec2(this.m_vertex0);
        clone.m_vertex3.setVec2(this.m_vertex3);
        clone.m_hasVertex0 = this.m_hasVertex0;
        clone.m_hasVertex3 = this.m_hasVertex3;
        return clone;
      };
      EdgeShape2.prototype.getChildCount = function() {
        return 1;
      };
      EdgeShape2.prototype.testPoint = function(xf2, p) {
        return false;
      };
      EdgeShape2.prototype.rayCast = function(output2, input2, xf2, childIndex) {
        var p1 = Rot.mulTVec2(xf2.q, Vec2.sub(input2.p1, xf2.p));
        var p2 = Rot.mulTVec2(xf2.q, Vec2.sub(input2.p2, xf2.p));
        var d2 = Vec2.sub(p2, p1);
        var v122 = this.m_vertex1;
        var v22 = this.m_vertex2;
        var e3 = Vec2.sub(v22, v122);
        var normal3 = Vec2.neo(e3.y, -e3.x);
        normal3.normalize();
        var numerator = Vec2.dot(normal3, Vec2.sub(v122, p1));
        var denominator = Vec2.dot(normal3, d2);
        if (denominator == 0) {
          return false;
        }
        var t = numerator / denominator;
        if (t < 0 || input2.maxFraction < t) {
          return false;
        }
        var q = Vec2.add(p1, Vec2.mulNumVec2(t, d2));
        var r = Vec2.sub(v22, v122);
        var rr = Vec2.dot(r, r);
        if (rr == 0) {
          return false;
        }
        var s2 = Vec2.dot(Vec2.sub(q, v122), r) / rr;
        if (s2 < 0 || 1 < s2) {
          return false;
        }
        output2.fraction = t;
        if (numerator > 0) {
          output2.normal = Rot.mulVec2(xf2.q, normal3).neg();
        } else {
          output2.normal = Rot.mulVec2(xf2.q, normal3);
        }
        return true;
      };
      EdgeShape2.prototype.computeAABB = function(aabb, xf2, childIndex) {
        transformVec2(v1$2, xf2, this.m_vertex1);
        transformVec2(v2$1, xf2, this.m_vertex2);
        AABB.combinePoints(aabb, v1$2, v2$1);
        AABB.extend(aabb, this.m_radius);
      };
      EdgeShape2.prototype.computeMass = function(massData, density) {
        massData.mass = 0;
        combine2Vec2(massData.center, 0.5, this.m_vertex1, 0.5, this.m_vertex2);
        massData.I = 0;
      };
      EdgeShape2.prototype.computeDistanceProxy = function(proxy) {
        proxy.m_vertices[0] = this.m_vertex1;
        proxy.m_vertices[1] = this.m_vertex2;
        proxy.m_vertices.length = 2;
        proxy.m_count = 2;
        proxy.m_radius = this.m_radius;
      };
      EdgeShape2.TYPE = "edge";
      return EdgeShape2;
    })(Shape)
  );
  var v1$1 = vec2(0, 0);
  var v2 = vec2(0, 0);
  var ChainShape = (
    /** @class */
    (function(_super) {
      __extends(ChainShape2, _super);
      function ChainShape2(vertices, loop) {
        var _this = this;
        if (!(_this instanceof ChainShape2)) {
          return new ChainShape2(vertices, loop);
        }
        _this = _super.call(this) || this;
        _this.m_type = ChainShape2.TYPE;
        _this.m_radius = SettingsInternal.polygonRadius;
        _this.m_vertices = [];
        _this.m_count = 0;
        _this.m_prevVertex = null;
        _this.m_nextVertex = null;
        _this.m_hasPrevVertex = false;
        _this.m_hasNextVertex = false;
        _this.m_isLoop = !!loop;
        if (vertices && vertices.length) {
          if (loop) {
            _this._createLoop(vertices);
          } else {
            _this._createChain(vertices);
          }
        }
        return _this;
      }
      ChainShape2.prototype._serialize = function() {
        var data = {
          type: this.m_type,
          vertices: this.m_isLoop ? this.m_vertices.slice(0, this.m_vertices.length - 1) : this.m_vertices,
          isLoop: this.m_isLoop,
          hasPrevVertex: this.m_hasPrevVertex,
          hasNextVertex: this.m_hasNextVertex,
          prevVertex: null,
          nextVertex: null
        };
        if (this.m_prevVertex) {
          data.prevVertex = this.m_prevVertex;
        }
        if (this.m_nextVertex) {
          data.nextVertex = this.m_nextVertex;
        }
        return data;
      };
      ChainShape2._deserialize = function(data, fixture, restore) {
        var vertices = [];
        if (data.vertices) {
          for (var i = 0; i < data.vertices.length; i++) {
            vertices.push(data.vertices[i]);
          }
        }
        var shape = new ChainShape2(vertices, data.isLoop);
        if (data.prevVertex) {
          shape.setPrevVertex(data.prevVertex);
        }
        if (data.nextVertex) {
          shape.setNextVertex(data.nextVertex);
        }
        return shape;
      };
      ChainShape2.prototype.getType = function() {
        return this.m_type;
      };
      ChainShape2.prototype.getRadius = function() {
        return this.m_radius;
      };
      ChainShape2.prototype._createLoop = function(vertices) {
        if (vertices.length < 3) {
          return;
        }
        var i;
        this.m_vertices = [];
        this.m_count = vertices.length + 1;
        for (var i = 0; i < vertices.length; ++i) {
          this.m_vertices[i] = Vec2.clone(vertices[i]);
        }
        this.m_vertices[vertices.length] = Vec2.clone(vertices[0]);
        this.m_prevVertex = this.m_vertices[this.m_count - 2];
        this.m_nextVertex = this.m_vertices[1];
        this.m_hasPrevVertex = true;
        this.m_hasNextVertex = true;
        return this;
      };
      ChainShape2.prototype._createChain = function(vertices) {
        var i;
        this.m_vertices = [];
        this.m_count = vertices.length;
        for (var i = 0; i < vertices.length; ++i) {
          this.m_vertices[i] = Vec2.clone(vertices[i]);
        }
        this.m_prevVertex = null;
        this.m_nextVertex = null;
        this.m_hasPrevVertex = false;
        this.m_hasNextVertex = false;
        return this;
      };
      ChainShape2.prototype._reset = function() {
        if (this.m_isLoop) {
          this._createLoop(this.m_vertices.slice(0, this.m_vertices.length - 1));
        } else {
          this._createChain(this.m_vertices);
        }
      };
      ChainShape2.prototype.setPrevVertex = function(prevVertex) {
        this.m_prevVertex = prevVertex;
        this.m_hasPrevVertex = true;
      };
      ChainShape2.prototype.getPrevVertex = function() {
        return this.m_prevVertex;
      };
      ChainShape2.prototype.setNextVertex = function(nextVertex) {
        this.m_nextVertex = nextVertex;
        this.m_hasNextVertex = true;
      };
      ChainShape2.prototype.getNextVertex = function() {
        return this.m_nextVertex;
      };
      ChainShape2.prototype._clone = function() {
        var clone = new ChainShape2();
        clone._createChain(this.m_vertices);
        clone.m_type = this.m_type;
        clone.m_radius = this.m_radius;
        clone.m_prevVertex = this.m_prevVertex;
        clone.m_nextVertex = this.m_nextVertex;
        clone.m_hasPrevVertex = this.m_hasPrevVertex;
        clone.m_hasNextVertex = this.m_hasNextVertex;
        return clone;
      };
      ChainShape2.prototype.getChildCount = function() {
        return this.m_count - 1;
      };
      ChainShape2.prototype.getChildEdge = function(edge, childIndex) {
        edge.m_type = EdgeShape.TYPE;
        edge.m_radius = this.m_radius;
        edge.m_vertex1 = this.m_vertices[childIndex];
        edge.m_vertex2 = this.m_vertices[childIndex + 1];
        if (childIndex > 0) {
          edge.m_vertex0 = this.m_vertices[childIndex - 1];
          edge.m_hasVertex0 = true;
        } else {
          edge.m_vertex0 = this.m_prevVertex;
          edge.m_hasVertex0 = this.m_hasPrevVertex;
        }
        if (childIndex < this.m_count - 2) {
          edge.m_vertex3 = this.m_vertices[childIndex + 2];
          edge.m_hasVertex3 = true;
        } else {
          edge.m_vertex3 = this.m_nextVertex;
          edge.m_hasVertex3 = this.m_hasNextVertex;
        }
      };
      ChainShape2.prototype.getVertex = function(index) {
        if (index < this.m_count) {
          return this.m_vertices[index];
        } else {
          return this.m_vertices[0];
        }
      };
      ChainShape2.prototype.isLoop = function() {
        return this.m_isLoop;
      };
      ChainShape2.prototype.testPoint = function(xf2, p) {
        return false;
      };
      ChainShape2.prototype.rayCast = function(output2, input2, xf2, childIndex) {
        var edgeShape = new EdgeShape(this.getVertex(childIndex), this.getVertex(childIndex + 1));
        return edgeShape.rayCast(output2, input2, xf2, 0);
      };
      ChainShape2.prototype.computeAABB = function(aabb, xf2, childIndex) {
        transformVec2(v1$1, xf2, this.getVertex(childIndex));
        transformVec2(v2, xf2, this.getVertex(childIndex + 1));
        AABB.combinePoints(aabb, v1$1, v2);
      };
      ChainShape2.prototype.computeMass = function(massData, density) {
        massData.mass = 0;
        zeroVec2(massData.center);
        massData.I = 0;
      };
      ChainShape2.prototype.computeDistanceProxy = function(proxy, childIndex) {
        proxy.m_vertices[0] = this.getVertex(childIndex);
        proxy.m_vertices[1] = this.getVertex(childIndex + 1);
        proxy.m_count = 2;
        proxy.m_radius = this.m_radius;
      };
      ChainShape2.TYPE = "chain";
      return ChainShape2;
    })(Shape)
  );
  var math_max$1 = Math.max;
  var math_min$3 = Math.min;
  var temp$1 = vec2(0, 0);
  var e$1 = vec2(0, 0);
  var e1$1 = vec2(0, 0);
  var e2$1 = vec2(0, 0);
  var center = vec2(0, 0);
  var s = vec2(0, 0);
  var PolygonShape = (
    /** @class */
    (function(_super) {
      __extends(PolygonShape2, _super);
      function PolygonShape2(vertices) {
        var _this = this;
        if (!(_this instanceof PolygonShape2)) {
          return new PolygonShape2(vertices);
        }
        _this = _super.call(this) || this;
        _this.m_type = PolygonShape2.TYPE;
        _this.m_radius = SettingsInternal.polygonRadius;
        _this.m_centroid = Vec2.zero();
        _this.m_vertices = [];
        _this.m_normals = [];
        _this.m_count = 0;
        if (vertices && vertices.length) {
          _this._set(vertices);
        }
        return _this;
      }
      PolygonShape2.prototype._serialize = function() {
        return {
          type: this.m_type,
          vertices: this.m_vertices
        };
      };
      PolygonShape2._deserialize = function(data, fixture, restore) {
        var vertices = [];
        if (data.vertices) {
          for (var i = 0; i < data.vertices.length; i++) {
            vertices.push(data.vertices[i]);
          }
        }
        var shape = new PolygonShape2(vertices);
        return shape;
      };
      PolygonShape2.prototype.getType = function() {
        return this.m_type;
      };
      PolygonShape2.prototype.getRadius = function() {
        return this.m_radius;
      };
      PolygonShape2.prototype._clone = function() {
        var clone = new PolygonShape2();
        clone.m_type = this.m_type;
        clone.m_radius = this.m_radius;
        clone.m_count = this.m_count;
        clone.m_centroid.setVec2(this.m_centroid);
        for (var i = 0; i < this.m_count; i++) {
          clone.m_vertices.push(this.m_vertices[i].clone());
        }
        for (var i = 0; i < this.m_normals.length; i++) {
          clone.m_normals.push(this.m_normals[i].clone());
        }
        return clone;
      };
      PolygonShape2.prototype.getChildCount = function() {
        return 1;
      };
      PolygonShape2.prototype._reset = function() {
        this._set(this.m_vertices);
      };
      PolygonShape2.prototype._set = function(vertices) {
        if (vertices.length < 3) {
          this._setAsBox(1, 1);
          return;
        }
        var n2 = math_min$3(vertices.length, SettingsInternal.maxPolygonVertices);
        var ps = [];
        for (var i = 0; i < n2; ++i) {
          var v3 = vertices[i];
          var unique = true;
          for (var j = 0; j < ps.length; ++j) {
            if (Vec2.distanceSquared(v3, ps[j]) < 0.25 * SettingsInternal.linearSlopSquared) {
              unique = false;
              break;
            }
          }
          if (unique) {
            ps.push(Vec2.clone(v3));
          }
        }
        n2 = ps.length;
        if (n2 < 3) {
          this._setAsBox(1, 1);
          return;
        }
        var i0 = 0;
        var x0 = ps[0].x;
        for (var i = 1; i < n2; ++i) {
          var x2 = ps[i].x;
          if (x2 > x0 || x2 === x0 && ps[i].y < ps[i0].y) {
            i0 = i;
            x0 = x2;
          }
        }
        var hull = [];
        var m = 0;
        var ih = i0;
        while (true) {
          hull[m] = ih;
          var ie2 = 0;
          for (var j = 1; j < n2; ++j) {
            if (ie2 === ih) {
              ie2 = j;
              continue;
            }
            var r = Vec2.sub(ps[ie2], ps[hull[m]]);
            var v3 = Vec2.sub(ps[j], ps[hull[m]]);
            var c2 = Vec2.crossVec2Vec2(r, v3);
            if (c2 < 0) {
              ie2 = j;
            }
            if (c2 === 0 && v3.lengthSquared() > r.lengthSquared()) {
              ie2 = j;
            }
          }
          ++m;
          ih = ie2;
          if (ie2 === i0) {
            break;
          }
        }
        if (m < 3) {
          this._setAsBox(1, 1);
          return;
        }
        this.m_count = m;
        this.m_vertices = [];
        for (var i = 0; i < m; ++i) {
          this.m_vertices[i] = ps[hull[i]];
        }
        for (var i = 0; i < m; ++i) {
          var i1 = i;
          var i2 = i + 1 < m ? i + 1 : 0;
          var edge = Vec2.sub(this.m_vertices[i2], this.m_vertices[i1]);
          this.m_normals[i] = Vec2.crossVec2Num(edge, 1);
          this.m_normals[i].normalize();
        }
        this.m_centroid = computeCentroid(this.m_vertices, m);
      };
      PolygonShape2.prototype._setAsBox = function(hx, hy, center2, angle) {
        this.m_vertices[0] = Vec2.neo(hx, -hy);
        this.m_vertices[1] = Vec2.neo(hx, hy);
        this.m_vertices[2] = Vec2.neo(-hx, hy);
        this.m_vertices[3] = Vec2.neo(-hx, -hy);
        this.m_normals[0] = Vec2.neo(1, 0);
        this.m_normals[1] = Vec2.neo(0, 1);
        this.m_normals[2] = Vec2.neo(-1, 0);
        this.m_normals[3] = Vec2.neo(0, -1);
        this.m_count = 4;
        if (center2 && Vec2.isValid(center2)) {
          angle = angle || 0;
          copyVec2(this.m_centroid, center2);
          var xf2 = Transform.identity();
          xf2.p.setVec2(center2);
          xf2.q.setAngle(angle);
          for (var i = 0; i < this.m_count; ++i) {
            this.m_vertices[i] = Transform.mulVec2(xf2, this.m_vertices[i]);
            this.m_normals[i] = Rot.mulVec2(xf2.q, this.m_normals[i]);
          }
        }
      };
      PolygonShape2.prototype.testPoint = function(xf2, p) {
        var pLocal = detransformVec2(temp$1, xf2, p);
        for (var i = 0; i < this.m_count; ++i) {
          var dot = dotVec2(this.m_normals[i], pLocal) - dotVec2(this.m_normals[i], this.m_vertices[i]);
          if (dot > 0) {
            return false;
          }
        }
        return true;
      };
      PolygonShape2.prototype.rayCast = function(output2, input2, xf2, childIndex) {
        var p1 = Rot.mulTVec2(xf2.q, Vec2.sub(input2.p1, xf2.p));
        var p2 = Rot.mulTVec2(xf2.q, Vec2.sub(input2.p2, xf2.p));
        var d2 = Vec2.sub(p2, p1);
        var lower = 0;
        var upper = input2.maxFraction;
        var index = -1;
        for (var i = 0; i < this.m_count; ++i) {
          var numerator = Vec2.dot(this.m_normals[i], Vec2.sub(this.m_vertices[i], p1));
          var denominator = Vec2.dot(this.m_normals[i], d2);
          if (denominator == 0) {
            if (numerator < 0) {
              return false;
            }
          } else {
            if (denominator < 0 && numerator < lower * denominator) {
              lower = numerator / denominator;
              index = i;
            } else if (denominator > 0 && numerator < upper * denominator) {
              upper = numerator / denominator;
            }
          }
          if (upper < lower) {
            return false;
          }
        }
        if (index >= 0) {
          output2.fraction = lower;
          output2.normal = Rot.mulVec2(xf2.q, this.m_normals[index]);
          return true;
        }
        return false;
      };
      PolygonShape2.prototype.computeAABB = function(aabb, xf2, childIndex) {
        var minX = Infinity;
        var minY = Infinity;
        var maxX = -Infinity;
        var maxY = -Infinity;
        for (var i = 0; i < this.m_count; ++i) {
          var v3 = transformVec2(temp$1, xf2, this.m_vertices[i]);
          minX = math_min$3(minX, v3.x);
          maxX = math_max$1(maxX, v3.x);
          minY = math_min$3(minY, v3.y);
          maxY = math_max$1(maxY, v3.y);
        }
        setVec2(aabb.lowerBound, minX - this.m_radius, minY - this.m_radius);
        setVec2(aabb.upperBound, maxX + this.m_radius, maxY + this.m_radius);
      };
      PolygonShape2.prototype.computeMass = function(massData, density) {
        zeroVec2(center);
        var area = 0;
        var I = 0;
        zeroVec2(s);
        for (var i = 0; i < this.m_count; ++i) {
          plusVec2(s, this.m_vertices[i]);
        }
        scaleVec2(s, 1 / this.m_count, s);
        var k_inv3 = 1 / 3;
        for (var i = 0; i < this.m_count; ++i) {
          subVec2(e1$1, this.m_vertices[i], s);
          if (i + 1 < this.m_count) {
            subVec2(e2$1, this.m_vertices[i + 1], s);
          } else {
            subVec2(e2$1, this.m_vertices[0], s);
          }
          var D = crossVec2Vec2(e1$1, e2$1);
          var triangleArea = 0.5 * D;
          area += triangleArea;
          combine2Vec2(temp$1, triangleArea * k_inv3, e1$1, triangleArea * k_inv3, e2$1);
          plusVec2(center, temp$1);
          var ex1 = e1$1.x;
          var ey1 = e1$1.y;
          var ex2 = e2$1.x;
          var ey2 = e2$1.y;
          var intx2 = ex1 * ex1 + ex2 * ex1 + ex2 * ex2;
          var inty2 = ey1 * ey1 + ey2 * ey1 + ey2 * ey2;
          I += 0.25 * k_inv3 * D * (intx2 + inty2);
        }
        massData.mass = density * area;
        scaleVec2(center, 1 / area, center);
        addVec2(massData.center, center, s);
        massData.I = density * I;
        massData.I += massData.mass * (dotVec2(massData.center, massData.center) - dotVec2(center, center));
      };
      PolygonShape2.prototype.validate = function() {
        for (var i = 0; i < this.m_count; ++i) {
          var i1 = i;
          var i2 = i < this.m_count - 1 ? i1 + 1 : 0;
          var p = this.m_vertices[i1];
          subVec2(e$1, this.m_vertices[i2], p);
          for (var j = 0; j < this.m_count; ++j) {
            if (j == i1 || j == i2) {
              continue;
            }
            var c2 = crossVec2Vec2(e$1, subVec2(temp$1, this.m_vertices[j], p));
            if (c2 < 0) {
              return false;
            }
          }
        }
        return true;
      };
      PolygonShape2.prototype.computeDistanceProxy = function(proxy) {
        for (var i = 0; i < this.m_count; ++i) {
          proxy.m_vertices[i] = this.m_vertices[i];
        }
        proxy.m_vertices.length = this.m_count;
        proxy.m_count = this.m_count;
        proxy.m_radius = this.m_radius;
      };
      PolygonShape2.TYPE = "polygon";
      return PolygonShape2;
    })(Shape)
  );
  function computeCentroid(vs, count) {
    var c2 = Vec2.zero();
    var area = 0;
    var pRef = Vec2.zero();
    var i;
    var inv3 = 1 / 3;
    for (var i = 0; i < count; ++i) {
      var p1 = pRef;
      var p2 = vs[i];
      var p3 = i + 1 < count ? vs[i + 1] : vs[0];
      var e1_1 = Vec2.sub(p2, p1);
      var e2_1 = Vec2.sub(p3, p1);
      var D = Vec2.crossVec2Vec2(e1_1, e2_1);
      var triangleArea = 0.5 * D;
      area += triangleArea;
      combine3Vec2(temp$1, 1, p1, 1, p2, 1, p3);
      plusScaleVec2(c2, triangleArea * inv3, temp$1);
    }
    c2.mul(1 / area);
    return c2;
  }
  var math_sqrt = Math.sqrt;
  var math_PI$4 = Math.PI;
  var temp = vec2(0, 0);
  var CircleShape = (
    /** @class */
    (function(_super) {
      __extends(CircleShape2, _super);
      function CircleShape2(a2, b2) {
        var _this = this;
        if (!(_this instanceof CircleShape2)) {
          return new CircleShape2(a2, b2);
        }
        _this = _super.call(this) || this;
        _this.m_type = CircleShape2.TYPE;
        _this.m_p = Vec2.zero();
        _this.m_radius = 1;
        if (typeof a2 === "object" && Vec2.isValid(a2)) {
          _this.m_p.setVec2(a2);
          if (typeof b2 === "number") {
            _this.m_radius = b2;
          }
        } else if (typeof a2 === "number") {
          _this.m_radius = a2;
        }
        return _this;
      }
      CircleShape2.prototype._serialize = function() {
        return {
          type: this.m_type,
          p: this.m_p,
          radius: this.m_radius
        };
      };
      CircleShape2._deserialize = function(data) {
        return new CircleShape2(data.p, data.radius);
      };
      CircleShape2.prototype._reset = function() {
      };
      CircleShape2.prototype.getType = function() {
        return this.m_type;
      };
      CircleShape2.prototype.getRadius = function() {
        return this.m_radius;
      };
      CircleShape2.prototype.getCenter = function() {
        return this.m_p;
      };
      CircleShape2.prototype._clone = function() {
        var clone = new CircleShape2();
        clone.m_type = this.m_type;
        clone.m_radius = this.m_radius;
        clone.m_p = this.m_p.clone();
        return clone;
      };
      CircleShape2.prototype.getChildCount = function() {
        return 1;
      };
      CircleShape2.prototype.testPoint = function(xf2, p) {
        var center2 = transformVec2(temp, xf2, this.m_p);
        return distSqrVec2(p, center2) <= this.m_radius * this.m_radius;
      };
      CircleShape2.prototype.rayCast = function(output2, input2, xf2, childIndex) {
        var position = Vec2.add(xf2.p, Rot.mulVec2(xf2.q, this.m_p));
        var s2 = Vec2.sub(input2.p1, position);
        var b2 = Vec2.dot(s2, s2) - this.m_radius * this.m_radius;
        var r = Vec2.sub(input2.p2, input2.p1);
        var c2 = Vec2.dot(s2, r);
        var rr = Vec2.dot(r, r);
        var sigma = c2 * c2 - rr * b2;
        if (sigma < 0 || rr < EPSILON) {
          return false;
        }
        var a2 = -(c2 + math_sqrt(sigma));
        if (0 <= a2 && a2 <= input2.maxFraction * rr) {
          a2 /= rr;
          output2.fraction = a2;
          output2.normal = Vec2.add(s2, Vec2.mulNumVec2(a2, r));
          output2.normal.normalize();
          return true;
        }
        return false;
      };
      CircleShape2.prototype.computeAABB = function(aabb, xf2, childIndex) {
        var p = transformVec2(temp, xf2, this.m_p);
        setVec2(aabb.lowerBound, p.x - this.m_radius, p.y - this.m_radius);
        setVec2(aabb.upperBound, p.x + this.m_radius, p.y + this.m_radius);
      };
      CircleShape2.prototype.computeMass = function(massData, density) {
        massData.mass = density * math_PI$4 * this.m_radius * this.m_radius;
        copyVec2(massData.center, this.m_p);
        massData.I = massData.mass * (0.5 * this.m_radius * this.m_radius + lengthSqrVec2(this.m_p));
      };
      CircleShape2.prototype.computeDistanceProxy = function(proxy) {
        proxy.m_vertices[0] = this.m_p;
        proxy.m_vertices.length = 1;
        proxy.m_count = 1;
        proxy.m_radius = this.m_radius;
      };
      CircleShape2.TYPE = "circle";
      return CircleShape2;
    })(Shape)
  );
  var math_abs$5 = Math.abs;
  var math_PI$3 = Math.PI;
  var DEFAULTS$a = {
    frequencyHz: 0,
    dampingRatio: 0
  };
  var DistanceJoint = (
    /** @class */
    (function(_super) {
      __extends(DistanceJoint2, _super);
      function DistanceJoint2(def, bodyA, bodyB, anchorA, anchorB) {
        var _this = this;
        if (!(_this instanceof DistanceJoint2)) {
          return new DistanceJoint2(def, bodyA, bodyB, anchorA, anchorB);
        }
        if (bodyB && anchorA && "m_type" in anchorA && "x" in bodyB && "y" in bodyB) {
          var temp3 = bodyB;
          bodyB = anchorA;
          anchorA = temp3;
        }
        def = options(def, DEFAULTS$a);
        _this = _super.call(this, def, bodyA, bodyB) || this;
        bodyA = _this.m_bodyA;
        bodyB = _this.m_bodyB;
        _this.m_type = DistanceJoint2.TYPE;
        _this.m_localAnchorA = Vec2.clone(anchorA ? bodyA.getLocalPoint(anchorA) : def.localAnchorA || Vec2.zero());
        _this.m_localAnchorB = Vec2.clone(anchorB ? bodyB.getLocalPoint(anchorB) : def.localAnchorB || Vec2.zero());
        _this.m_length = Number.isFinite(def.length) ? def.length : Vec2.distance(bodyA.getWorldPoint(_this.m_localAnchorA), bodyB.getWorldPoint(_this.m_localAnchorB));
        _this.m_frequencyHz = def.frequencyHz;
        _this.m_dampingRatio = def.dampingRatio;
        _this.m_impulse = 0;
        _this.m_gamma = 0;
        _this.m_bias = 0;
        return _this;
      }
      DistanceJoint2.prototype._serialize = function() {
        return {
          type: this.m_type,
          bodyA: this.m_bodyA,
          bodyB: this.m_bodyB,
          collideConnected: this.m_collideConnected,
          frequencyHz: this.m_frequencyHz,
          dampingRatio: this.m_dampingRatio,
          localAnchorA: this.m_localAnchorA,
          localAnchorB: this.m_localAnchorB,
          length: this.m_length
        };
      };
      DistanceJoint2._deserialize = function(data, world, restore) {
        data = __assign({}, data);
        data.bodyA = restore(Body, data.bodyA, world);
        data.bodyB = restore(Body, data.bodyB, world);
        var joint = new DistanceJoint2(data);
        return joint;
      };
      DistanceJoint2.prototype._reset = function(def) {
        if (def.anchorA) {
          this.m_localAnchorA.setVec2(this.m_bodyA.getLocalPoint(def.anchorA));
        } else if (def.localAnchorA) {
          this.m_localAnchorA.setVec2(def.localAnchorA);
        }
        if (def.anchorB) {
          this.m_localAnchorB.setVec2(this.m_bodyB.getLocalPoint(def.anchorB));
        } else if (def.localAnchorB) {
          this.m_localAnchorB.setVec2(def.localAnchorB);
        }
        if (def.length > 0) {
          this.m_length = +def.length;
        } else if (def.length < 0) ;
        else if (def.anchorA || def.anchorA || def.anchorA || def.anchorA) {
          this.m_length = Vec2.distance(this.m_bodyA.getWorldPoint(this.m_localAnchorA), this.m_bodyB.getWorldPoint(this.m_localAnchorB));
        }
        if (Number.isFinite(def.frequencyHz)) {
          this.m_frequencyHz = def.frequencyHz;
        }
        if (Number.isFinite(def.dampingRatio)) {
          this.m_dampingRatio = def.dampingRatio;
        }
      };
      DistanceJoint2.prototype.getLocalAnchorA = function() {
        return this.m_localAnchorA;
      };
      DistanceJoint2.prototype.getLocalAnchorB = function() {
        return this.m_localAnchorB;
      };
      DistanceJoint2.prototype.setLength = function(length) {
        this.m_length = length;
      };
      DistanceJoint2.prototype.getLength = function() {
        return this.m_length;
      };
      DistanceJoint2.prototype.setFrequency = function(hz) {
        this.m_frequencyHz = hz;
      };
      DistanceJoint2.prototype.getFrequency = function() {
        return this.m_frequencyHz;
      };
      DistanceJoint2.prototype.setDampingRatio = function(ratio) {
        this.m_dampingRatio = ratio;
      };
      DistanceJoint2.prototype.getDampingRatio = function() {
        return this.m_dampingRatio;
      };
      DistanceJoint2.prototype.getAnchorA = function() {
        return this.m_bodyA.getWorldPoint(this.m_localAnchorA);
      };
      DistanceJoint2.prototype.getAnchorB = function() {
        return this.m_bodyB.getWorldPoint(this.m_localAnchorB);
      };
      DistanceJoint2.prototype.getReactionForce = function(inv_dt) {
        return Vec2.mulNumVec2(this.m_impulse, this.m_u).mul(inv_dt);
      };
      DistanceJoint2.prototype.getReactionTorque = function(inv_dt) {
        return 0;
      };
      DistanceJoint2.prototype.initVelocityConstraints = function(step) {
        this.m_localCenterA = this.m_bodyA.m_sweep.localCenter;
        this.m_localCenterB = this.m_bodyB.m_sweep.localCenter;
        this.m_invMassA = this.m_bodyA.m_invMass;
        this.m_invMassB = this.m_bodyB.m_invMass;
        this.m_invIA = this.m_bodyA.m_invI;
        this.m_invIB = this.m_bodyB.m_invI;
        var cA2 = this.m_bodyA.c_position.c;
        var aA = this.m_bodyA.c_position.a;
        var vA2 = this.m_bodyA.c_velocity.v;
        var wA = this.m_bodyA.c_velocity.w;
        var cB2 = this.m_bodyB.c_position.c;
        var aB = this.m_bodyB.c_position.a;
        var vB2 = this.m_bodyB.c_velocity.v;
        var wB = this.m_bodyB.c_velocity.w;
        var qA = Rot.neo(aA);
        var qB = Rot.neo(aB);
        this.m_rA = Rot.mulVec2(qA, Vec2.sub(this.m_localAnchorA, this.m_localCenterA));
        this.m_rB = Rot.mulVec2(qB, Vec2.sub(this.m_localAnchorB, this.m_localCenterB));
        this.m_u = Vec2.sub(Vec2.add(cB2, this.m_rB), Vec2.add(cA2, this.m_rA));
        var length = this.m_u.length();
        if (length > SettingsInternal.linearSlop) {
          this.m_u.mul(1 / length);
        } else {
          this.m_u.setNum(0, 0);
        }
        var crAu = Vec2.crossVec2Vec2(this.m_rA, this.m_u);
        var crBu = Vec2.crossVec2Vec2(this.m_rB, this.m_u);
        var invMass = this.m_invMassA + this.m_invIA * crAu * crAu + this.m_invMassB + this.m_invIB * crBu * crBu;
        this.m_mass = invMass != 0 ? 1 / invMass : 0;
        if (this.m_frequencyHz > 0) {
          var C = length - this.m_length;
          var omega = 2 * math_PI$3 * this.m_frequencyHz;
          var d2 = 2 * this.m_mass * this.m_dampingRatio * omega;
          var k = this.m_mass * omega * omega;
          var h = step.dt;
          this.m_gamma = h * (d2 + h * k);
          this.m_gamma = this.m_gamma != 0 ? 1 / this.m_gamma : 0;
          this.m_bias = C * h * k * this.m_gamma;
          invMass += this.m_gamma;
          this.m_mass = invMass != 0 ? 1 / invMass : 0;
        } else {
          this.m_gamma = 0;
          this.m_bias = 0;
        }
        if (step.warmStarting) {
          this.m_impulse *= step.dtRatio;
          var P3 = Vec2.mulNumVec2(this.m_impulse, this.m_u);
          vA2.subMul(this.m_invMassA, P3);
          wA -= this.m_invIA * Vec2.crossVec2Vec2(this.m_rA, P3);
          vB2.addMul(this.m_invMassB, P3);
          wB += this.m_invIB * Vec2.crossVec2Vec2(this.m_rB, P3);
        } else {
          this.m_impulse = 0;
        }
        this.m_bodyA.c_velocity.v.setVec2(vA2);
        this.m_bodyA.c_velocity.w = wA;
        this.m_bodyB.c_velocity.v.setVec2(vB2);
        this.m_bodyB.c_velocity.w = wB;
      };
      DistanceJoint2.prototype.solveVelocityConstraints = function(step) {
        var vA2 = this.m_bodyA.c_velocity.v;
        var wA = this.m_bodyA.c_velocity.w;
        var vB2 = this.m_bodyB.c_velocity.v;
        var wB = this.m_bodyB.c_velocity.w;
        var vpA = Vec2.add(vA2, Vec2.crossNumVec2(wA, this.m_rA));
        var vpB = Vec2.add(vB2, Vec2.crossNumVec2(wB, this.m_rB));
        var Cdot = Vec2.dot(this.m_u, vpB) - Vec2.dot(this.m_u, vpA);
        var impulse = -this.m_mass * (Cdot + this.m_bias + this.m_gamma * this.m_impulse);
        this.m_impulse += impulse;
        var P3 = Vec2.mulNumVec2(impulse, this.m_u);
        vA2.subMul(this.m_invMassA, P3);
        wA -= this.m_invIA * Vec2.crossVec2Vec2(this.m_rA, P3);
        vB2.addMul(this.m_invMassB, P3);
        wB += this.m_invIB * Vec2.crossVec2Vec2(this.m_rB, P3);
        this.m_bodyA.c_velocity.v.setVec2(vA2);
        this.m_bodyA.c_velocity.w = wA;
        this.m_bodyB.c_velocity.v.setVec2(vB2);
        this.m_bodyB.c_velocity.w = wB;
      };
      DistanceJoint2.prototype.solvePositionConstraints = function(step) {
        if (this.m_frequencyHz > 0) {
          return true;
        }
        var cA2 = this.m_bodyA.c_position.c;
        var aA = this.m_bodyA.c_position.a;
        var cB2 = this.m_bodyB.c_position.c;
        var aB = this.m_bodyB.c_position.a;
        var qA = Rot.neo(aA);
        var qB = Rot.neo(aB);
        var rA2 = Rot.mulSub(qA, this.m_localAnchorA, this.m_localCenterA);
        var rB2 = Rot.mulSub(qB, this.m_localAnchorB, this.m_localCenterB);
        var u = Vec2.sub(Vec2.add(cB2, rB2), Vec2.add(cA2, rA2));
        var length = u.normalize();
        var C = clamp(length - this.m_length, -SettingsInternal.maxLinearCorrection, SettingsInternal.maxLinearCorrection);
        var impulse = -this.m_mass * C;
        var P3 = Vec2.mulNumVec2(impulse, u);
        cA2.subMul(this.m_invMassA, P3);
        aA -= this.m_invIA * Vec2.crossVec2Vec2(rA2, P3);
        cB2.addMul(this.m_invMassB, P3);
        aB += this.m_invIB * Vec2.crossVec2Vec2(rB2, P3);
        this.m_bodyA.c_position.c.setVec2(cA2);
        this.m_bodyA.c_position.a = aA;
        this.m_bodyB.c_position.c.setVec2(cB2);
        this.m_bodyB.c_position.a = aB;
        return math_abs$5(C) < SettingsInternal.linearSlop;
      };
      DistanceJoint2.TYPE = "distance-joint";
      return DistanceJoint2;
    })(Joint)
  );
  var DEFAULTS$9 = {
    maxForce: 0,
    maxTorque: 0
  };
  var FrictionJoint = (
    /** @class */
    (function(_super) {
      __extends(FrictionJoint2, _super);
      function FrictionJoint2(def, bodyA, bodyB, anchor) {
        var _this = this;
        if (!(_this instanceof FrictionJoint2)) {
          return new FrictionJoint2(def, bodyA, bodyB, anchor);
        }
        def = options(def, DEFAULTS$9);
        _this = _super.call(this, def, bodyA, bodyB) || this;
        bodyA = _this.m_bodyA;
        bodyB = _this.m_bodyB;
        _this.m_type = FrictionJoint2.TYPE;
        _this.m_localAnchorA = Vec2.clone(anchor ? bodyA.getLocalPoint(anchor) : def.localAnchorA || Vec2.zero());
        _this.m_localAnchorB = Vec2.clone(anchor ? bodyB.getLocalPoint(anchor) : def.localAnchorB || Vec2.zero());
        _this.m_linearImpulse = Vec2.zero();
        _this.m_angularImpulse = 0;
        _this.m_maxForce = def.maxForce;
        _this.m_maxTorque = def.maxTorque;
        return _this;
      }
      FrictionJoint2.prototype._serialize = function() {
        return {
          type: this.m_type,
          bodyA: this.m_bodyA,
          bodyB: this.m_bodyB,
          collideConnected: this.m_collideConnected,
          maxForce: this.m_maxForce,
          maxTorque: this.m_maxTorque,
          localAnchorA: this.m_localAnchorA,
          localAnchorB: this.m_localAnchorB
        };
      };
      FrictionJoint2._deserialize = function(data, world, restore) {
        data = __assign({}, data);
        data.bodyA = restore(Body, data.bodyA, world);
        data.bodyB = restore(Body, data.bodyB, world);
        var joint = new FrictionJoint2(data);
        return joint;
      };
      FrictionJoint2.prototype._reset = function(def) {
        if (def.anchorA) {
          this.m_localAnchorA.setVec2(this.m_bodyA.getLocalPoint(def.anchorA));
        } else if (def.localAnchorA) {
          this.m_localAnchorA.setVec2(def.localAnchorA);
        }
        if (def.anchorB) {
          this.m_localAnchorB.setVec2(this.m_bodyB.getLocalPoint(def.anchorB));
        } else if (def.localAnchorB) {
          this.m_localAnchorB.setVec2(def.localAnchorB);
        }
        if (Number.isFinite(def.maxForce)) {
          this.m_maxForce = def.maxForce;
        }
        if (Number.isFinite(def.maxTorque)) {
          this.m_maxTorque = def.maxTorque;
        }
      };
      FrictionJoint2.prototype.getLocalAnchorA = function() {
        return this.m_localAnchorA;
      };
      FrictionJoint2.prototype.getLocalAnchorB = function() {
        return this.m_localAnchorB;
      };
      FrictionJoint2.prototype.setMaxForce = function(force) {
        this.m_maxForce = force;
      };
      FrictionJoint2.prototype.getMaxForce = function() {
        return this.m_maxForce;
      };
      FrictionJoint2.prototype.setMaxTorque = function(torque) {
        this.m_maxTorque = torque;
      };
      FrictionJoint2.prototype.getMaxTorque = function() {
        return this.m_maxTorque;
      };
      FrictionJoint2.prototype.getAnchorA = function() {
        return this.m_bodyA.getWorldPoint(this.m_localAnchorA);
      };
      FrictionJoint2.prototype.getAnchorB = function() {
        return this.m_bodyB.getWorldPoint(this.m_localAnchorB);
      };
      FrictionJoint2.prototype.getReactionForce = function(inv_dt) {
        return Vec2.mulNumVec2(inv_dt, this.m_linearImpulse);
      };
      FrictionJoint2.prototype.getReactionTorque = function(inv_dt) {
        return inv_dt * this.m_angularImpulse;
      };
      FrictionJoint2.prototype.initVelocityConstraints = function(step) {
        this.m_localCenterA = this.m_bodyA.m_sweep.localCenter;
        this.m_localCenterB = this.m_bodyB.m_sweep.localCenter;
        this.m_invMassA = this.m_bodyA.m_invMass;
        this.m_invMassB = this.m_bodyB.m_invMass;
        this.m_invIA = this.m_bodyA.m_invI;
        this.m_invIB = this.m_bodyB.m_invI;
        var aA = this.m_bodyA.c_position.a;
        var vA2 = this.m_bodyA.c_velocity.v;
        var wA = this.m_bodyA.c_velocity.w;
        var aB = this.m_bodyB.c_position.a;
        var vB2 = this.m_bodyB.c_velocity.v;
        var wB = this.m_bodyB.c_velocity.w;
        var qA = Rot.neo(aA);
        var qB = Rot.neo(aB);
        this.m_rA = Rot.mulVec2(qA, Vec2.sub(this.m_localAnchorA, this.m_localCenterA));
        this.m_rB = Rot.mulVec2(qB, Vec2.sub(this.m_localAnchorB, this.m_localCenterB));
        var mA = this.m_invMassA;
        var mB = this.m_invMassB;
        var iA = this.m_invIA;
        var iB = this.m_invIB;
        var K = new Mat22();
        K.ex.x = mA + mB + iA * this.m_rA.y * this.m_rA.y + iB * this.m_rB.y * this.m_rB.y;
        K.ex.y = -iA * this.m_rA.x * this.m_rA.y - iB * this.m_rB.x * this.m_rB.y;
        K.ey.x = K.ex.y;
        K.ey.y = mA + mB + iA * this.m_rA.x * this.m_rA.x + iB * this.m_rB.x * this.m_rB.x;
        this.m_linearMass = K.getInverse();
        this.m_angularMass = iA + iB;
        if (this.m_angularMass > 0) {
          this.m_angularMass = 1 / this.m_angularMass;
        }
        if (step.warmStarting) {
          this.m_linearImpulse.mul(step.dtRatio);
          this.m_angularImpulse *= step.dtRatio;
          var P3 = Vec2.neo(this.m_linearImpulse.x, this.m_linearImpulse.y);
          vA2.subMul(mA, P3);
          wA -= iA * (Vec2.crossVec2Vec2(this.m_rA, P3) + this.m_angularImpulse);
          vB2.addMul(mB, P3);
          wB += iB * (Vec2.crossVec2Vec2(this.m_rB, P3) + this.m_angularImpulse);
        } else {
          this.m_linearImpulse.setZero();
          this.m_angularImpulse = 0;
        }
        this.m_bodyA.c_velocity.v = vA2;
        this.m_bodyA.c_velocity.w = wA;
        this.m_bodyB.c_velocity.v = vB2;
        this.m_bodyB.c_velocity.w = wB;
      };
      FrictionJoint2.prototype.solveVelocityConstraints = function(step) {
        var vA2 = this.m_bodyA.c_velocity.v;
        var wA = this.m_bodyA.c_velocity.w;
        var vB2 = this.m_bodyB.c_velocity.v;
        var wB = this.m_bodyB.c_velocity.w;
        var mA = this.m_invMassA;
        var mB = this.m_invMassB;
        var iA = this.m_invIA;
        var iB = this.m_invIB;
        var h = step.dt;
        {
          var Cdot = wB - wA;
          var impulse = -this.m_angularMass * Cdot;
          var oldImpulse = this.m_angularImpulse;
          var maxImpulse = h * this.m_maxTorque;
          this.m_angularImpulse = clamp(this.m_angularImpulse + impulse, -maxImpulse, maxImpulse);
          impulse = this.m_angularImpulse - oldImpulse;
          wA -= iA * impulse;
          wB += iB * impulse;
        }
        {
          var Cdot = Vec2.sub(Vec2.add(vB2, Vec2.crossNumVec2(wB, this.m_rB)), Vec2.add(vA2, Vec2.crossNumVec2(wA, this.m_rA)));
          var impulse = Vec2.neg(Mat22.mulVec2(this.m_linearMass, Cdot));
          var oldImpulse = this.m_linearImpulse;
          this.m_linearImpulse.add(impulse);
          var maxImpulse = h * this.m_maxForce;
          if (this.m_linearImpulse.lengthSquared() > maxImpulse * maxImpulse) {
            this.m_linearImpulse.normalize();
            this.m_linearImpulse.mul(maxImpulse);
          }
          impulse = Vec2.sub(this.m_linearImpulse, oldImpulse);
          vA2.subMul(mA, impulse);
          wA -= iA * Vec2.crossVec2Vec2(this.m_rA, impulse);
          vB2.addMul(mB, impulse);
          wB += iB * Vec2.crossVec2Vec2(this.m_rB, impulse);
        }
        this.m_bodyA.c_velocity.v = vA2;
        this.m_bodyA.c_velocity.w = wA;
        this.m_bodyB.c_velocity.v = vB2;
        this.m_bodyB.c_velocity.w = wB;
      };
      FrictionJoint2.prototype.solvePositionConstraints = function(step) {
        return true;
      };
      FrictionJoint2.TYPE = "friction-joint";
      return FrictionJoint2;
    })(Joint)
  );
  var Mat33 = (
    /** @class */
    (function() {
      function Mat332(a2, b2, c2) {
        if (typeof a2 === "object" && a2 !== null) {
          this.ex = Vec3.clone(a2);
          this.ey = Vec3.clone(b2);
          this.ez = Vec3.clone(c2);
        } else {
          this.ex = Vec3.zero();
          this.ey = Vec3.zero();
          this.ez = Vec3.zero();
        }
      }
      Mat332.prototype.toString = function() {
        return JSON.stringify(this);
      };
      Mat332.isValid = function(obj) {
        if (obj === null || typeof obj === "undefined") {
          return false;
        }
        return Vec3.isValid(obj.ex) && Vec3.isValid(obj.ey) && Vec3.isValid(obj.ez);
      };
      Mat332.assert = function(o) {
      };
      Mat332.prototype.setZero = function() {
        this.ex.setZero();
        this.ey.setZero();
        this.ez.setZero();
        return this;
      };
      Mat332.prototype.solve33 = function(v3) {
        var cross_x = this.ey.y * this.ez.z - this.ey.z * this.ez.y;
        var cross_y = this.ey.z * this.ez.x - this.ey.x * this.ez.z;
        var cross_z = this.ey.x * this.ez.y - this.ey.y * this.ez.x;
        var det = this.ex.x * cross_x + this.ex.y * cross_y + this.ex.z * cross_z;
        if (det !== 0) {
          det = 1 / det;
        }
        var r = new Vec3();
        cross_x = this.ey.y * this.ez.z - this.ey.z * this.ez.y;
        cross_y = this.ey.z * this.ez.x - this.ey.x * this.ez.z;
        cross_z = this.ey.x * this.ez.y - this.ey.y * this.ez.x;
        r.x = det * (v3.x * cross_x + v3.y * cross_y + v3.z * cross_z);
        cross_x = v3.y * this.ez.z - v3.z * this.ez.y;
        cross_y = v3.z * this.ez.x - v3.x * this.ez.z;
        cross_z = v3.x * this.ez.y - v3.y * this.ez.x;
        r.y = det * (this.ex.x * cross_x + this.ex.y * cross_y + this.ex.z * cross_z);
        cross_x = this.ey.y * v3.z - this.ey.z * v3.y;
        cross_y = this.ey.z * v3.x - this.ey.x * v3.z;
        cross_z = this.ey.x * v3.y - this.ey.y * v3.x;
        r.z = det * (this.ex.x * cross_x + this.ex.y * cross_y + this.ex.z * cross_z);
        return r;
      };
      Mat332.prototype.solve22 = function(v3) {
        var a11 = this.ex.x;
        var a12 = this.ey.x;
        var a21 = this.ex.y;
        var a22 = this.ey.y;
        var det = a11 * a22 - a12 * a21;
        if (det !== 0) {
          det = 1 / det;
        }
        var r = Vec2.zero();
        r.x = det * (a22 * v3.x - a12 * v3.y);
        r.y = det * (a11 * v3.y - a21 * v3.x);
        return r;
      };
      Mat332.prototype.getInverse22 = function(M) {
        var a2 = this.ex.x;
        var b2 = this.ey.x;
        var c2 = this.ex.y;
        var d2 = this.ey.y;
        var det = a2 * d2 - b2 * c2;
        if (det !== 0) {
          det = 1 / det;
        }
        M.ex.x = det * d2;
        M.ey.x = -det * b2;
        M.ex.z = 0;
        M.ex.y = -det * c2;
        M.ey.y = det * a2;
        M.ey.z = 0;
        M.ez.x = 0;
        M.ez.y = 0;
        M.ez.z = 0;
      };
      Mat332.prototype.getSymInverse33 = function(M) {
        var det = Vec3.dot(this.ex, Vec3.cross(this.ey, this.ez));
        if (det !== 0) {
          det = 1 / det;
        }
        var a11 = this.ex.x;
        var a12 = this.ey.x;
        var a13 = this.ez.x;
        var a22 = this.ey.y;
        var a23 = this.ez.y;
        var a33 = this.ez.z;
        M.ex.x = det * (a22 * a33 - a23 * a23);
        M.ex.y = det * (a13 * a23 - a12 * a33);
        M.ex.z = det * (a12 * a23 - a13 * a22);
        M.ey.x = M.ex.y;
        M.ey.y = det * (a11 * a33 - a13 * a13);
        M.ey.z = det * (a13 * a12 - a11 * a23);
        M.ez.x = M.ex.z;
        M.ez.y = M.ey.z;
        M.ez.z = det * (a11 * a22 - a12 * a12);
      };
      Mat332.mul = function(a2, b2) {
        if (b2 && "z" in b2 && "y" in b2 && "x" in b2) {
          var x2 = a2.ex.x * b2.x + a2.ey.x * b2.y + a2.ez.x * b2.z;
          var y = a2.ex.y * b2.x + a2.ey.y * b2.y + a2.ez.y * b2.z;
          var z = a2.ex.z * b2.x + a2.ey.z * b2.y + a2.ez.z * b2.z;
          return new Vec3(x2, y, z);
        } else if (b2 && "y" in b2 && "x" in b2) {
          var x2 = a2.ex.x * b2.x + a2.ey.x * b2.y;
          var y = a2.ex.y * b2.x + a2.ey.y * b2.y;
          return Vec2.neo(x2, y);
        }
      };
      Mat332.mulVec3 = function(a2, b2) {
        var x2 = a2.ex.x * b2.x + a2.ey.x * b2.y + a2.ez.x * b2.z;
        var y = a2.ex.y * b2.x + a2.ey.y * b2.y + a2.ez.y * b2.z;
        var z = a2.ex.z * b2.x + a2.ey.z * b2.y + a2.ez.z * b2.z;
        return new Vec3(x2, y, z);
      };
      Mat332.mulVec2 = function(a2, b2) {
        var x2 = a2.ex.x * b2.x + a2.ey.x * b2.y;
        var y = a2.ex.y * b2.x + a2.ey.y * b2.y;
        return Vec2.neo(x2, y);
      };
      Mat332.add = function(a2, b2) {
        return new Mat332(Vec3.add(a2.ex, b2.ex), Vec3.add(a2.ey, b2.ey), Vec3.add(a2.ez, b2.ez));
      };
      return Mat332;
    })()
  );
  var math_abs$4 = Math.abs;
  var LimitState$2;
  (function(LimitState2) {
    LimitState2[LimitState2["inactiveLimit"] = 0] = "inactiveLimit";
    LimitState2[LimitState2["atLowerLimit"] = 1] = "atLowerLimit";
    LimitState2[LimitState2["atUpperLimit"] = 2] = "atUpperLimit";
    LimitState2[LimitState2["equalLimits"] = 3] = "equalLimits";
  })(LimitState$2 || (LimitState$2 = {}));
  var DEFAULTS$8 = {
    lowerAngle: 0,
    upperAngle: 0,
    maxMotorTorque: 0,
    motorSpeed: 0,
    enableLimit: false,
    enableMotor: false
  };
  var RevoluteJoint = (
    /** @class */
    (function(_super) {
      __extends(RevoluteJoint2, _super);
      function RevoluteJoint2(def, bodyA, bodyB, anchor) {
        var _this = this;
        var _a2, _b, _c, _d, _e, _f;
        if (!(_this instanceof RevoluteJoint2)) {
          return new RevoluteJoint2(def, bodyA, bodyB, anchor);
        }
        def = def !== null && def !== void 0 ? def : {};
        _this = _super.call(this, def, bodyA, bodyB) || this;
        bodyA = _this.m_bodyA;
        bodyB = _this.m_bodyB;
        _this.m_mass = new Mat33();
        _this.m_limitState = LimitState$2.inactiveLimit;
        _this.m_type = RevoluteJoint2.TYPE;
        if (Vec2.isValid(anchor)) {
          _this.m_localAnchorA = bodyA.getLocalPoint(anchor);
        } else if (Vec2.isValid(def.localAnchorA)) {
          _this.m_localAnchorA = Vec2.clone(def.localAnchorA);
        } else {
          _this.m_localAnchorA = Vec2.zero();
        }
        if (Vec2.isValid(anchor)) {
          _this.m_localAnchorB = bodyB.getLocalPoint(anchor);
        } else if (Vec2.isValid(def.localAnchorB)) {
          _this.m_localAnchorB = Vec2.clone(def.localAnchorB);
        } else {
          _this.m_localAnchorB = Vec2.zero();
        }
        if (Number.isFinite(def.referenceAngle)) {
          _this.m_referenceAngle = def.referenceAngle;
        } else {
          _this.m_referenceAngle = bodyB.getAngle() - bodyA.getAngle();
        }
        _this.m_impulse = new Vec3();
        _this.m_motorImpulse = 0;
        _this.m_lowerAngle = (_a2 = def.lowerAngle) !== null && _a2 !== void 0 ? _a2 : DEFAULTS$8.lowerAngle;
        _this.m_upperAngle = (_b = def.upperAngle) !== null && _b !== void 0 ? _b : DEFAULTS$8.upperAngle;
        _this.m_maxMotorTorque = (_c = def.maxMotorTorque) !== null && _c !== void 0 ? _c : DEFAULTS$8.maxMotorTorque;
        _this.m_motorSpeed = (_d = def.motorSpeed) !== null && _d !== void 0 ? _d : DEFAULTS$8.motorSpeed;
        _this.m_enableLimit = (_e = def.enableLimit) !== null && _e !== void 0 ? _e : DEFAULTS$8.enableLimit;
        _this.m_enableMotor = (_f = def.enableMotor) !== null && _f !== void 0 ? _f : DEFAULTS$8.enableMotor;
        return _this;
      }
      RevoluteJoint2.prototype._serialize = function() {
        return {
          type: this.m_type,
          bodyA: this.m_bodyA,
          bodyB: this.m_bodyB,
          collideConnected: this.m_collideConnected,
          lowerAngle: this.m_lowerAngle,
          upperAngle: this.m_upperAngle,
          maxMotorTorque: this.m_maxMotorTorque,
          motorSpeed: this.m_motorSpeed,
          enableLimit: this.m_enableLimit,
          enableMotor: this.m_enableMotor,
          localAnchorA: this.m_localAnchorA,
          localAnchorB: this.m_localAnchorB,
          referenceAngle: this.m_referenceAngle
        };
      };
      RevoluteJoint2._deserialize = function(data, world, restore) {
        data = __assign({}, data);
        data.bodyA = restore(Body, data.bodyA, world);
        data.bodyB = restore(Body, data.bodyB, world);
        var joint = new RevoluteJoint2(data);
        return joint;
      };
      RevoluteJoint2.prototype._reset = function(def) {
        if (def.anchorA) {
          this.m_localAnchorA.setVec2(this.m_bodyA.getLocalPoint(def.anchorA));
        } else if (def.localAnchorA) {
          this.m_localAnchorA.setVec2(def.localAnchorA);
        }
        if (def.anchorB) {
          this.m_localAnchorB.setVec2(this.m_bodyB.getLocalPoint(def.anchorB));
        } else if (def.localAnchorB) {
          this.m_localAnchorB.setVec2(def.localAnchorB);
        }
        if (Number.isFinite(def.referenceAngle)) {
          this.m_referenceAngle = def.referenceAngle;
        }
        if (def.enableLimit !== void 0) {
          this.m_enableLimit = def.enableLimit;
        }
        if (Number.isFinite(def.lowerAngle)) {
          this.m_lowerAngle = def.lowerAngle;
        }
        if (Number.isFinite(def.upperAngle)) {
          this.m_upperAngle = def.upperAngle;
        }
        if (Number.isFinite(def.maxMotorTorque)) {
          this.m_maxMotorTorque = def.maxMotorTorque;
        }
        if (Number.isFinite(def.motorSpeed)) {
          this.m_motorSpeed = def.motorSpeed;
        }
        if (def.enableMotor !== void 0) {
          this.m_enableMotor = def.enableMotor;
        }
      };
      RevoluteJoint2.prototype.getLocalAnchorA = function() {
        return this.m_localAnchorA;
      };
      RevoluteJoint2.prototype.getLocalAnchorB = function() {
        return this.m_localAnchorB;
      };
      RevoluteJoint2.prototype.getReferenceAngle = function() {
        return this.m_referenceAngle;
      };
      RevoluteJoint2.prototype.getJointAngle = function() {
        var bA = this.m_bodyA;
        var bB = this.m_bodyB;
        return bB.m_sweep.a - bA.m_sweep.a - this.m_referenceAngle;
      };
      RevoluteJoint2.prototype.getJointSpeed = function() {
        var bA = this.m_bodyA;
        var bB = this.m_bodyB;
        return bB.m_angularVelocity - bA.m_angularVelocity;
      };
      RevoluteJoint2.prototype.isMotorEnabled = function() {
        return this.m_enableMotor;
      };
      RevoluteJoint2.prototype.enableMotor = function(flag) {
        if (flag == this.m_enableMotor)
          return;
        this.m_bodyA.setAwake(true);
        this.m_bodyB.setAwake(true);
        this.m_enableMotor = flag;
      };
      RevoluteJoint2.prototype.getMotorTorque = function(inv_dt) {
        return inv_dt * this.m_motorImpulse;
      };
      RevoluteJoint2.prototype.setMotorSpeed = function(speed) {
        if (speed == this.m_motorSpeed)
          return;
        this.m_bodyA.setAwake(true);
        this.m_bodyB.setAwake(true);
        this.m_motorSpeed = speed;
      };
      RevoluteJoint2.prototype.getMotorSpeed = function() {
        return this.m_motorSpeed;
      };
      RevoluteJoint2.prototype.setMaxMotorTorque = function(torque) {
        if (torque == this.m_maxMotorTorque)
          return;
        this.m_bodyA.setAwake(true);
        this.m_bodyB.setAwake(true);
        this.m_maxMotorTorque = torque;
      };
      RevoluteJoint2.prototype.getMaxMotorTorque = function() {
        return this.m_maxMotorTorque;
      };
      RevoluteJoint2.prototype.isLimitEnabled = function() {
        return this.m_enableLimit;
      };
      RevoluteJoint2.prototype.enableLimit = function(flag) {
        if (flag != this.m_enableLimit) {
          this.m_bodyA.setAwake(true);
          this.m_bodyB.setAwake(true);
          this.m_enableLimit = flag;
          this.m_impulse.z = 0;
        }
      };
      RevoluteJoint2.prototype.getLowerLimit = function() {
        return this.m_lowerAngle;
      };
      RevoluteJoint2.prototype.getUpperLimit = function() {
        return this.m_upperAngle;
      };
      RevoluteJoint2.prototype.setLimits = function(lower, upper) {
        if (lower != this.m_lowerAngle || upper != this.m_upperAngle) {
          this.m_bodyA.setAwake(true);
          this.m_bodyB.setAwake(true);
          this.m_impulse.z = 0;
          this.m_lowerAngle = lower;
          this.m_upperAngle = upper;
        }
      };
      RevoluteJoint2.prototype.getAnchorA = function() {
        return this.m_bodyA.getWorldPoint(this.m_localAnchorA);
      };
      RevoluteJoint2.prototype.getAnchorB = function() {
        return this.m_bodyB.getWorldPoint(this.m_localAnchorB);
      };
      RevoluteJoint2.prototype.getReactionForce = function(inv_dt) {
        return Vec2.neo(this.m_impulse.x, this.m_impulse.y).mul(inv_dt);
      };
      RevoluteJoint2.prototype.getReactionTorque = function(inv_dt) {
        return inv_dt * this.m_impulse.z;
      };
      RevoluteJoint2.prototype.initVelocityConstraints = function(step) {
        this.m_localCenterA = this.m_bodyA.m_sweep.localCenter;
        this.m_localCenterB = this.m_bodyB.m_sweep.localCenter;
        this.m_invMassA = this.m_bodyA.m_invMass;
        this.m_invMassB = this.m_bodyB.m_invMass;
        this.m_invIA = this.m_bodyA.m_invI;
        this.m_invIB = this.m_bodyB.m_invI;
        var aA = this.m_bodyA.c_position.a;
        var vA2 = this.m_bodyA.c_velocity.v;
        var wA = this.m_bodyA.c_velocity.w;
        var aB = this.m_bodyB.c_position.a;
        var vB2 = this.m_bodyB.c_velocity.v;
        var wB = this.m_bodyB.c_velocity.w;
        var qA = Rot.neo(aA);
        var qB = Rot.neo(aB);
        this.m_rA = Rot.mulVec2(qA, Vec2.sub(this.m_localAnchorA, this.m_localCenterA));
        this.m_rB = Rot.mulVec2(qB, Vec2.sub(this.m_localAnchorB, this.m_localCenterB));
        var mA = this.m_invMassA;
        var mB = this.m_invMassB;
        var iA = this.m_invIA;
        var iB = this.m_invIB;
        var fixedRotation = iA + iB === 0;
        this.m_mass.ex.x = mA + mB + this.m_rA.y * this.m_rA.y * iA + this.m_rB.y * this.m_rB.y * iB;
        this.m_mass.ey.x = -this.m_rA.y * this.m_rA.x * iA - this.m_rB.y * this.m_rB.x * iB;
        this.m_mass.ez.x = -this.m_rA.y * iA - this.m_rB.y * iB;
        this.m_mass.ex.y = this.m_mass.ey.x;
        this.m_mass.ey.y = mA + mB + this.m_rA.x * this.m_rA.x * iA + this.m_rB.x * this.m_rB.x * iB;
        this.m_mass.ez.y = this.m_rA.x * iA + this.m_rB.x * iB;
        this.m_mass.ex.z = this.m_mass.ez.x;
        this.m_mass.ey.z = this.m_mass.ez.y;
        this.m_mass.ez.z = iA + iB;
        this.m_motorMass = iA + iB;
        if (this.m_motorMass > 0) {
          this.m_motorMass = 1 / this.m_motorMass;
        }
        if (this.m_enableMotor == false || fixedRotation) {
          this.m_motorImpulse = 0;
        }
        if (this.m_enableLimit && fixedRotation == false) {
          var jointAngle = aB - aA - this.m_referenceAngle;
          if (math_abs$4(this.m_upperAngle - this.m_lowerAngle) < 2 * SettingsInternal.angularSlop) {
            this.m_limitState = LimitState$2.equalLimits;
          } else if (jointAngle <= this.m_lowerAngle) {
            if (this.m_limitState != LimitState$2.atLowerLimit) {
              this.m_impulse.z = 0;
            }
            this.m_limitState = LimitState$2.atLowerLimit;
          } else if (jointAngle >= this.m_upperAngle) {
            if (this.m_limitState != LimitState$2.atUpperLimit) {
              this.m_impulse.z = 0;
            }
            this.m_limitState = LimitState$2.atUpperLimit;
          } else {
            this.m_limitState = LimitState$2.inactiveLimit;
            this.m_impulse.z = 0;
          }
        } else {
          this.m_limitState = LimitState$2.inactiveLimit;
        }
        if (step.warmStarting) {
          this.m_impulse.mul(step.dtRatio);
          this.m_motorImpulse *= step.dtRatio;
          var P3 = Vec2.neo(this.m_impulse.x, this.m_impulse.y);
          vA2.subMul(mA, P3);
          wA -= iA * (Vec2.crossVec2Vec2(this.m_rA, P3) + this.m_motorImpulse + this.m_impulse.z);
          vB2.addMul(mB, P3);
          wB += iB * (Vec2.crossVec2Vec2(this.m_rB, P3) + this.m_motorImpulse + this.m_impulse.z);
        } else {
          this.m_impulse.setZero();
          this.m_motorImpulse = 0;
        }
        this.m_bodyA.c_velocity.v = vA2;
        this.m_bodyA.c_velocity.w = wA;
        this.m_bodyB.c_velocity.v = vB2;
        this.m_bodyB.c_velocity.w = wB;
      };
      RevoluteJoint2.prototype.solveVelocityConstraints = function(step) {
        var vA2 = this.m_bodyA.c_velocity.v;
        var wA = this.m_bodyA.c_velocity.w;
        var vB2 = this.m_bodyB.c_velocity.v;
        var wB = this.m_bodyB.c_velocity.w;
        var mA = this.m_invMassA;
        var mB = this.m_invMassB;
        var iA = this.m_invIA;
        var iB = this.m_invIB;
        var fixedRotation = iA + iB === 0;
        if (this.m_enableMotor && this.m_limitState != LimitState$2.equalLimits && fixedRotation == false) {
          var Cdot = wB - wA - this.m_motorSpeed;
          var impulse = -this.m_motorMass * Cdot;
          var oldImpulse = this.m_motorImpulse;
          var maxImpulse = step.dt * this.m_maxMotorTorque;
          this.m_motorImpulse = clamp(this.m_motorImpulse + impulse, -maxImpulse, maxImpulse);
          impulse = this.m_motorImpulse - oldImpulse;
          wA -= iA * impulse;
          wB += iB * impulse;
        }
        if (this.m_enableLimit && this.m_limitState != LimitState$2.inactiveLimit && fixedRotation == false) {
          var Cdot1 = Vec2.zero();
          Cdot1.addCombine(1, vB2, 1, Vec2.crossNumVec2(wB, this.m_rB));
          Cdot1.subCombine(1, vA2, 1, Vec2.crossNumVec2(wA, this.m_rA));
          var Cdot2 = wB - wA;
          var Cdot = new Vec3(Cdot1.x, Cdot1.y, Cdot2);
          var impulse = Vec3.neg(this.m_mass.solve33(Cdot));
          if (this.m_limitState == LimitState$2.equalLimits) {
            this.m_impulse.add(impulse);
          } else if (this.m_limitState == LimitState$2.atLowerLimit) {
            var newImpulse = this.m_impulse.z + impulse.z;
            if (newImpulse < 0) {
              var rhs = Vec2.combine(-1, Cdot1, this.m_impulse.z, Vec2.neo(this.m_mass.ez.x, this.m_mass.ez.y));
              var reduced = this.m_mass.solve22(rhs);
              impulse.x = reduced.x;
              impulse.y = reduced.y;
              impulse.z = -this.m_impulse.z;
              this.m_impulse.x += reduced.x;
              this.m_impulse.y += reduced.y;
              this.m_impulse.z = 0;
            } else {
              this.m_impulse.add(impulse);
            }
          } else if (this.m_limitState == LimitState$2.atUpperLimit) {
            var newImpulse = this.m_impulse.z + impulse.z;
            if (newImpulse > 0) {
              var rhs = Vec2.combine(-1, Cdot1, this.m_impulse.z, Vec2.neo(this.m_mass.ez.x, this.m_mass.ez.y));
              var reduced = this.m_mass.solve22(rhs);
              impulse.x = reduced.x;
              impulse.y = reduced.y;
              impulse.z = -this.m_impulse.z;
              this.m_impulse.x += reduced.x;
              this.m_impulse.y += reduced.y;
              this.m_impulse.z = 0;
            } else {
              this.m_impulse.add(impulse);
            }
          }
          var P3 = Vec2.neo(impulse.x, impulse.y);
          vA2.subMul(mA, P3);
          wA -= iA * (Vec2.crossVec2Vec2(this.m_rA, P3) + impulse.z);
          vB2.addMul(mB, P3);
          wB += iB * (Vec2.crossVec2Vec2(this.m_rB, P3) + impulse.z);
        } else {
          var Cdot = Vec2.zero();
          Cdot.addCombine(1, vB2, 1, Vec2.crossNumVec2(wB, this.m_rB));
          Cdot.subCombine(1, vA2, 1, Vec2.crossNumVec2(wA, this.m_rA));
          var impulse = this.m_mass.solve22(Vec2.neg(Cdot));
          this.m_impulse.x += impulse.x;
          this.m_impulse.y += impulse.y;
          vA2.subMul(mA, impulse);
          wA -= iA * Vec2.crossVec2Vec2(this.m_rA, impulse);
          vB2.addMul(mB, impulse);
          wB += iB * Vec2.crossVec2Vec2(this.m_rB, impulse);
        }
        this.m_bodyA.c_velocity.v = vA2;
        this.m_bodyA.c_velocity.w = wA;
        this.m_bodyB.c_velocity.v = vB2;
        this.m_bodyB.c_velocity.w = wB;
      };
      RevoluteJoint2.prototype.solvePositionConstraints = function(step) {
        var cA2 = this.m_bodyA.c_position.c;
        var aA = this.m_bodyA.c_position.a;
        var cB2 = this.m_bodyB.c_position.c;
        var aB = this.m_bodyB.c_position.a;
        var qA = Rot.neo(aA);
        var qB = Rot.neo(aB);
        var angularError = 0;
        var positionError = 0;
        var fixedRotation = this.m_invIA + this.m_invIB == 0;
        if (this.m_enableLimit && this.m_limitState != LimitState$2.inactiveLimit && fixedRotation == false) {
          var angle = aB - aA - this.m_referenceAngle;
          var limitImpulse = 0;
          if (this.m_limitState == LimitState$2.equalLimits) {
            var C = clamp(angle - this.m_lowerAngle, -SettingsInternal.maxAngularCorrection, SettingsInternal.maxAngularCorrection);
            limitImpulse = -this.m_motorMass * C;
            angularError = math_abs$4(C);
          } else if (this.m_limitState == LimitState$2.atLowerLimit) {
            var C = angle - this.m_lowerAngle;
            angularError = -C;
            C = clamp(C + SettingsInternal.angularSlop, -SettingsInternal.maxAngularCorrection, 0);
            limitImpulse = -this.m_motorMass * C;
          } else if (this.m_limitState == LimitState$2.atUpperLimit) {
            var C = angle - this.m_upperAngle;
            angularError = C;
            C = clamp(C - SettingsInternal.angularSlop, 0, SettingsInternal.maxAngularCorrection);
            limitImpulse = -this.m_motorMass * C;
          }
          aA -= this.m_invIA * limitImpulse;
          aB += this.m_invIB * limitImpulse;
        }
        {
          qA.setAngle(aA);
          qB.setAngle(aB);
          var rA2 = Rot.mulVec2(qA, Vec2.sub(this.m_localAnchorA, this.m_localCenterA));
          var rB2 = Rot.mulVec2(qB, Vec2.sub(this.m_localAnchorB, this.m_localCenterB));
          var C = Vec2.zero();
          C.addCombine(1, cB2, 1, rB2);
          C.subCombine(1, cA2, 1, rA2);
          positionError = C.length();
          var mA = this.m_invMassA;
          var mB = this.m_invMassB;
          var iA = this.m_invIA;
          var iB = this.m_invIB;
          var K = new Mat22();
          K.ex.x = mA + mB + iA * rA2.y * rA2.y + iB * rB2.y * rB2.y;
          K.ex.y = -iA * rA2.x * rA2.y - iB * rB2.x * rB2.y;
          K.ey.x = K.ex.y;
          K.ey.y = mA + mB + iA * rA2.x * rA2.x + iB * rB2.x * rB2.x;
          var impulse = Vec2.neg(K.solve(C));
          cA2.subMul(mA, impulse);
          aA -= iA * Vec2.crossVec2Vec2(rA2, impulse);
          cB2.addMul(mB, impulse);
          aB += iB * Vec2.crossVec2Vec2(rB2, impulse);
        }
        this.m_bodyA.c_position.c.setVec2(cA2);
        this.m_bodyA.c_position.a = aA;
        this.m_bodyB.c_position.c.setVec2(cB2);
        this.m_bodyB.c_position.a = aB;
        return positionError <= SettingsInternal.linearSlop && angularError <= SettingsInternal.angularSlop;
      };
      RevoluteJoint2.TYPE = "revolute-joint";
      return RevoluteJoint2;
    })(Joint)
  );
  var math_abs$3 = Math.abs;
  var math_max = Math.max;
  var math_min$2 = Math.min;
  var LimitState$1;
  (function(LimitState2) {
    LimitState2[LimitState2["inactiveLimit"] = 0] = "inactiveLimit";
    LimitState2[LimitState2["atLowerLimit"] = 1] = "atLowerLimit";
    LimitState2[LimitState2["atUpperLimit"] = 2] = "atUpperLimit";
    LimitState2[LimitState2["equalLimits"] = 3] = "equalLimits";
  })(LimitState$1 || (LimitState$1 = {}));
  var DEFAULTS$7 = {
    enableLimit: false,
    lowerTranslation: 0,
    upperTranslation: 0,
    enableMotor: false,
    maxMotorForce: 0,
    motorSpeed: 0
  };
  var PrismaticJoint = (
    /** @class */
    (function(_super) {
      __extends(PrismaticJoint2, _super);
      function PrismaticJoint2(def, bodyA, bodyB, anchor, axis) {
        var _this = this;
        if (!(_this instanceof PrismaticJoint2)) {
          return new PrismaticJoint2(def, bodyA, bodyB, anchor, axis);
        }
        def = options(def, DEFAULTS$7);
        _this = _super.call(this, def, bodyA, bodyB) || this;
        bodyA = _this.m_bodyA;
        bodyB = _this.m_bodyB;
        _this.m_type = PrismaticJoint2.TYPE;
        _this.m_localAnchorA = Vec2.clone(anchor ? bodyA.getLocalPoint(anchor) : def.localAnchorA || Vec2.zero());
        _this.m_localAnchorB = Vec2.clone(anchor ? bodyB.getLocalPoint(anchor) : def.localAnchorB || Vec2.zero());
        _this.m_localXAxisA = Vec2.clone(axis ? bodyA.getLocalVector(axis) : def.localAxisA || Vec2.neo(1, 0));
        _this.m_localXAxisA.normalize();
        _this.m_localYAxisA = Vec2.crossNumVec2(1, _this.m_localXAxisA);
        _this.m_referenceAngle = Number.isFinite(def.referenceAngle) ? def.referenceAngle : bodyB.getAngle() - bodyA.getAngle();
        _this.m_impulse = new Vec3();
        _this.m_motorMass = 0;
        _this.m_motorImpulse = 0;
        _this.m_lowerTranslation = def.lowerTranslation;
        _this.m_upperTranslation = def.upperTranslation;
        _this.m_maxMotorForce = def.maxMotorForce;
        _this.m_motorSpeed = def.motorSpeed;
        _this.m_enableLimit = def.enableLimit;
        _this.m_enableMotor = def.enableMotor;
        _this.m_limitState = LimitState$1.inactiveLimit;
        _this.m_axis = Vec2.zero();
        _this.m_perp = Vec2.zero();
        _this.m_K = new Mat33();
        return _this;
      }
      PrismaticJoint2.prototype._serialize = function() {
        return {
          type: this.m_type,
          bodyA: this.m_bodyA,
          bodyB: this.m_bodyB,
          collideConnected: this.m_collideConnected,
          lowerTranslation: this.m_lowerTranslation,
          upperTranslation: this.m_upperTranslation,
          maxMotorForce: this.m_maxMotorForce,
          motorSpeed: this.m_motorSpeed,
          enableLimit: this.m_enableLimit,
          enableMotor: this.m_enableMotor,
          localAnchorA: this.m_localAnchorA,
          localAnchorB: this.m_localAnchorB,
          localAxisA: this.m_localXAxisA,
          referenceAngle: this.m_referenceAngle
        };
      };
      PrismaticJoint2._deserialize = function(data, world, restore) {
        data = __assign({}, data);
        data.bodyA = restore(Body, data.bodyA, world);
        data.bodyB = restore(Body, data.bodyB, world);
        data.localAxisA = Vec2.clone(data.localAxisA);
        var joint = new PrismaticJoint2(data);
        return joint;
      };
      PrismaticJoint2.prototype._reset = function(def) {
        if (def.anchorA) {
          this.m_localAnchorA.setVec2(this.m_bodyA.getLocalPoint(def.anchorA));
        } else if (def.localAnchorA) {
          this.m_localAnchorA.setVec2(def.localAnchorA);
        }
        if (def.anchorB) {
          this.m_localAnchorB.setVec2(this.m_bodyB.getLocalPoint(def.anchorB));
        } else if (def.localAnchorB) {
          this.m_localAnchorB.setVec2(def.localAnchorB);
        }
        if (def.localAxisA) {
          this.m_localXAxisA.setVec2(def.localAxisA);
          this.m_localYAxisA.setVec2(Vec2.crossNumVec2(1, def.localAxisA));
        }
        if (Number.isFinite(def.referenceAngle)) {
          this.m_referenceAngle = def.referenceAngle;
        }
        if (typeof def.enableLimit !== "undefined") {
          this.m_enableLimit = !!def.enableLimit;
        }
        if (Number.isFinite(def.lowerTranslation)) {
          this.m_lowerTranslation = def.lowerTranslation;
        }
        if (Number.isFinite(def.upperTranslation)) {
          this.m_upperTranslation = def.upperTranslation;
        }
        if (typeof def.enableMotor !== "undefined") {
          this.m_enableMotor = !!def.enableMotor;
        }
        if (Number.isFinite(def.maxMotorForce)) {
          this.m_maxMotorForce = def.maxMotorForce;
        }
        if (Number.isFinite(def.motorSpeed)) {
          this.m_motorSpeed = def.motorSpeed;
        }
      };
      PrismaticJoint2.prototype.getLocalAnchorA = function() {
        return this.m_localAnchorA;
      };
      PrismaticJoint2.prototype.getLocalAnchorB = function() {
        return this.m_localAnchorB;
      };
      PrismaticJoint2.prototype.getLocalAxisA = function() {
        return this.m_localXAxisA;
      };
      PrismaticJoint2.prototype.getReferenceAngle = function() {
        return this.m_referenceAngle;
      };
      PrismaticJoint2.prototype.getJointTranslation = function() {
        var pA2 = this.m_bodyA.getWorldPoint(this.m_localAnchorA);
        var pB2 = this.m_bodyB.getWorldPoint(this.m_localAnchorB);
        var d2 = Vec2.sub(pB2, pA2);
        var axis = this.m_bodyA.getWorldVector(this.m_localXAxisA);
        var translation2 = Vec2.dot(d2, axis);
        return translation2;
      };
      PrismaticJoint2.prototype.getJointSpeed = function() {
        var bA = this.m_bodyA;
        var bB = this.m_bodyB;
        var rA2 = Rot.mulVec2(bA.m_xf.q, Vec2.sub(this.m_localAnchorA, bA.m_sweep.localCenter));
        var rB2 = Rot.mulVec2(bB.m_xf.q, Vec2.sub(this.m_localAnchorB, bB.m_sweep.localCenter));
        var p1 = Vec2.add(bA.m_sweep.c, rA2);
        var p2 = Vec2.add(bB.m_sweep.c, rB2);
        var d2 = Vec2.sub(p2, p1);
        var axis = Rot.mulVec2(bA.m_xf.q, this.m_localXAxisA);
        var vA2 = bA.m_linearVelocity;
        var vB2 = bB.m_linearVelocity;
        var wA = bA.m_angularVelocity;
        var wB = bB.m_angularVelocity;
        var speed = Vec2.dot(d2, Vec2.crossNumVec2(wA, axis)) + Vec2.dot(axis, Vec2.sub(Vec2.addCrossNumVec2(vB2, wB, rB2), Vec2.addCrossNumVec2(vA2, wA, rA2)));
        return speed;
      };
      PrismaticJoint2.prototype.isLimitEnabled = function() {
        return this.m_enableLimit;
      };
      PrismaticJoint2.prototype.enableLimit = function(flag) {
        if (flag != this.m_enableLimit) {
          this.m_bodyA.setAwake(true);
          this.m_bodyB.setAwake(true);
          this.m_enableLimit = flag;
          this.m_impulse.z = 0;
        }
      };
      PrismaticJoint2.prototype.getLowerLimit = function() {
        return this.m_lowerTranslation;
      };
      PrismaticJoint2.prototype.getUpperLimit = function() {
        return this.m_upperTranslation;
      };
      PrismaticJoint2.prototype.setLimits = function(lower, upper) {
        if (lower != this.m_lowerTranslation || upper != this.m_upperTranslation) {
          this.m_bodyA.setAwake(true);
          this.m_bodyB.setAwake(true);
          this.m_lowerTranslation = lower;
          this.m_upperTranslation = upper;
          this.m_impulse.z = 0;
        }
      };
      PrismaticJoint2.prototype.isMotorEnabled = function() {
        return this.m_enableMotor;
      };
      PrismaticJoint2.prototype.enableMotor = function(flag) {
        if (flag == this.m_enableMotor)
          return;
        this.m_bodyA.setAwake(true);
        this.m_bodyB.setAwake(true);
        this.m_enableMotor = flag;
      };
      PrismaticJoint2.prototype.setMotorSpeed = function(speed) {
        if (speed == this.m_motorSpeed)
          return;
        this.m_bodyA.setAwake(true);
        this.m_bodyB.setAwake(true);
        this.m_motorSpeed = speed;
      };
      PrismaticJoint2.prototype.setMaxMotorForce = function(force) {
        if (force == this.m_maxMotorForce)
          return;
        this.m_bodyA.setAwake(true);
        this.m_bodyB.setAwake(true);
        this.m_maxMotorForce = force;
      };
      PrismaticJoint2.prototype.getMaxMotorForce = function() {
        return this.m_maxMotorForce;
      };
      PrismaticJoint2.prototype.getMotorSpeed = function() {
        return this.m_motorSpeed;
      };
      PrismaticJoint2.prototype.getMotorForce = function(inv_dt) {
        return inv_dt * this.m_motorImpulse;
      };
      PrismaticJoint2.prototype.getAnchorA = function() {
        return this.m_bodyA.getWorldPoint(this.m_localAnchorA);
      };
      PrismaticJoint2.prototype.getAnchorB = function() {
        return this.m_bodyB.getWorldPoint(this.m_localAnchorB);
      };
      PrismaticJoint2.prototype.getReactionForce = function(inv_dt) {
        return Vec2.combine(this.m_impulse.x, this.m_perp, this.m_motorImpulse + this.m_impulse.z, this.m_axis).mul(inv_dt);
      };
      PrismaticJoint2.prototype.getReactionTorque = function(inv_dt) {
        return inv_dt * this.m_impulse.y;
      };
      PrismaticJoint2.prototype.initVelocityConstraints = function(step) {
        this.m_localCenterA = this.m_bodyA.m_sweep.localCenter;
        this.m_localCenterB = this.m_bodyB.m_sweep.localCenter;
        this.m_invMassA = this.m_bodyA.m_invMass;
        this.m_invMassB = this.m_bodyB.m_invMass;
        this.m_invIA = this.m_bodyA.m_invI;
        this.m_invIB = this.m_bodyB.m_invI;
        var cA2 = this.m_bodyA.c_position.c;
        var aA = this.m_bodyA.c_position.a;
        var vA2 = this.m_bodyA.c_velocity.v;
        var wA = this.m_bodyA.c_velocity.w;
        var cB2 = this.m_bodyB.c_position.c;
        var aB = this.m_bodyB.c_position.a;
        var vB2 = this.m_bodyB.c_velocity.v;
        var wB = this.m_bodyB.c_velocity.w;
        var qA = Rot.neo(aA);
        var qB = Rot.neo(aB);
        var rA2 = Rot.mulVec2(qA, Vec2.sub(this.m_localAnchorA, this.m_localCenterA));
        var rB2 = Rot.mulVec2(qB, Vec2.sub(this.m_localAnchorB, this.m_localCenterB));
        var d2 = Vec2.zero();
        d2.addCombine(1, cB2, 1, rB2);
        d2.subCombine(1, cA2, 1, rA2);
        var mA = this.m_invMassA;
        var mB = this.m_invMassB;
        var iA = this.m_invIA;
        var iB = this.m_invIB;
        {
          this.m_axis = Rot.mulVec2(qA, this.m_localXAxisA);
          this.m_a1 = Vec2.crossVec2Vec2(Vec2.add(d2, rA2), this.m_axis);
          this.m_a2 = Vec2.crossVec2Vec2(rB2, this.m_axis);
          this.m_motorMass = mA + mB + iA * this.m_a1 * this.m_a1 + iB * this.m_a2 * this.m_a2;
          if (this.m_motorMass > 0) {
            this.m_motorMass = 1 / this.m_motorMass;
          }
        }
        {
          this.m_perp = Rot.mulVec2(qA, this.m_localYAxisA);
          this.m_s1 = Vec2.crossVec2Vec2(Vec2.add(d2, rA2), this.m_perp);
          this.m_s2 = Vec2.crossVec2Vec2(rB2, this.m_perp);
          Vec2.crossVec2Vec2(rA2, this.m_perp);
          var k11 = mA + mB + iA * this.m_s1 * this.m_s1 + iB * this.m_s2 * this.m_s2;
          var k12 = iA * this.m_s1 + iB * this.m_s2;
          var k13 = iA * this.m_s1 * this.m_a1 + iB * this.m_s2 * this.m_a2;
          var k22 = iA + iB;
          if (k22 == 0) {
            k22 = 1;
          }
          var k23 = iA * this.m_a1 + iB * this.m_a2;
          var k33 = mA + mB + iA * this.m_a1 * this.m_a1 + iB * this.m_a2 * this.m_a2;
          this.m_K.ex.set(k11, k12, k13);
          this.m_K.ey.set(k12, k22, k23);
          this.m_K.ez.set(k13, k23, k33);
        }
        if (this.m_enableLimit) {
          var jointTranslation = Vec2.dot(this.m_axis, d2);
          if (math_abs$3(this.m_upperTranslation - this.m_lowerTranslation) < 2 * SettingsInternal.linearSlop) {
            this.m_limitState = LimitState$1.equalLimits;
          } else if (jointTranslation <= this.m_lowerTranslation) {
            if (this.m_limitState != LimitState$1.atLowerLimit) {
              this.m_limitState = LimitState$1.atLowerLimit;
              this.m_impulse.z = 0;
            }
          } else if (jointTranslation >= this.m_upperTranslation) {
            if (this.m_limitState != LimitState$1.atUpperLimit) {
              this.m_limitState = LimitState$1.atUpperLimit;
              this.m_impulse.z = 0;
            }
          } else {
            this.m_limitState = LimitState$1.inactiveLimit;
            this.m_impulse.z = 0;
          }
        } else {
          this.m_limitState = LimitState$1.inactiveLimit;
          this.m_impulse.z = 0;
        }
        if (this.m_enableMotor == false) {
          this.m_motorImpulse = 0;
        }
        if (step.warmStarting) {
          this.m_impulse.mul(step.dtRatio);
          this.m_motorImpulse *= step.dtRatio;
          var P3 = Vec2.combine(this.m_impulse.x, this.m_perp, this.m_motorImpulse + this.m_impulse.z, this.m_axis);
          var LA = this.m_impulse.x * this.m_s1 + this.m_impulse.y + (this.m_motorImpulse + this.m_impulse.z) * this.m_a1;
          var LB = this.m_impulse.x * this.m_s2 + this.m_impulse.y + (this.m_motorImpulse + this.m_impulse.z) * this.m_a2;
          vA2.subMul(mA, P3);
          wA -= iA * LA;
          vB2.addMul(mB, P3);
          wB += iB * LB;
        } else {
          this.m_impulse.setZero();
          this.m_motorImpulse = 0;
        }
        this.m_bodyA.c_velocity.v.setVec2(vA2);
        this.m_bodyA.c_velocity.w = wA;
        this.m_bodyB.c_velocity.v.setVec2(vB2);
        this.m_bodyB.c_velocity.w = wB;
      };
      PrismaticJoint2.prototype.solveVelocityConstraints = function(step) {
        var vA2 = this.m_bodyA.c_velocity.v;
        var wA = this.m_bodyA.c_velocity.w;
        var vB2 = this.m_bodyB.c_velocity.v;
        var wB = this.m_bodyB.c_velocity.w;
        var mA = this.m_invMassA;
        var mB = this.m_invMassB;
        var iA = this.m_invIA;
        var iB = this.m_invIB;
        if (this.m_enableMotor && this.m_limitState != LimitState$1.equalLimits) {
          var Cdot = Vec2.dot(this.m_axis, Vec2.sub(vB2, vA2)) + this.m_a2 * wB - this.m_a1 * wA;
          var impulse = this.m_motorMass * (this.m_motorSpeed - Cdot);
          var oldImpulse = this.m_motorImpulse;
          var maxImpulse = step.dt * this.m_maxMotorForce;
          this.m_motorImpulse = clamp(this.m_motorImpulse + impulse, -maxImpulse, maxImpulse);
          impulse = this.m_motorImpulse - oldImpulse;
          var P3 = Vec2.mulNumVec2(impulse, this.m_axis);
          var LA = impulse * this.m_a1;
          var LB = impulse * this.m_a2;
          vA2.subMul(mA, P3);
          wA -= iA * LA;
          vB2.addMul(mB, P3);
          wB += iB * LB;
        }
        var Cdot1 = Vec2.zero();
        Cdot1.x += Vec2.dot(this.m_perp, vB2) + this.m_s2 * wB;
        Cdot1.x -= Vec2.dot(this.m_perp, vA2) + this.m_s1 * wA;
        Cdot1.y = wB - wA;
        if (this.m_enableLimit && this.m_limitState != LimitState$1.inactiveLimit) {
          var Cdot2 = 0;
          Cdot2 += Vec2.dot(this.m_axis, vB2) + this.m_a2 * wB;
          Cdot2 -= Vec2.dot(this.m_axis, vA2) + this.m_a1 * wA;
          var Cdot = new Vec3(Cdot1.x, Cdot1.y, Cdot2);
          var f1 = Vec3.clone(this.m_impulse);
          var df = this.m_K.solve33(Vec3.neg(Cdot));
          this.m_impulse.add(df);
          if (this.m_limitState == LimitState$1.atLowerLimit) {
            this.m_impulse.z = math_max(this.m_impulse.z, 0);
          } else if (this.m_limitState == LimitState$1.atUpperLimit) {
            this.m_impulse.z = math_min$2(this.m_impulse.z, 0);
          }
          var b2 = Vec2.combine(-1, Cdot1, -(this.m_impulse.z - f1.z), Vec2.neo(this.m_K.ez.x, this.m_K.ez.y));
          var f2r = Vec2.add(this.m_K.solve22(b2), Vec2.neo(f1.x, f1.y));
          this.m_impulse.x = f2r.x;
          this.m_impulse.y = f2r.y;
          df = Vec3.sub(this.m_impulse, f1);
          var P3 = Vec2.combine(df.x, this.m_perp, df.z, this.m_axis);
          var LA = df.x * this.m_s1 + df.y + df.z * this.m_a1;
          var LB = df.x * this.m_s2 + df.y + df.z * this.m_a2;
          vA2.subMul(mA, P3);
          wA -= iA * LA;
          vB2.addMul(mB, P3);
          wB += iB * LB;
        } else {
          var df = this.m_K.solve22(Vec2.neg(Cdot1));
          this.m_impulse.x += df.x;
          this.m_impulse.y += df.y;
          var P3 = Vec2.mulNumVec2(df.x, this.m_perp);
          var LA = df.x * this.m_s1 + df.y;
          var LB = df.x * this.m_s2 + df.y;
          vA2.subMul(mA, P3);
          wA -= iA * LA;
          vB2.addMul(mB, P3);
          wB += iB * LB;
        }
        this.m_bodyA.c_velocity.v = vA2;
        this.m_bodyA.c_velocity.w = wA;
        this.m_bodyB.c_velocity.v = vB2;
        this.m_bodyB.c_velocity.w = wB;
      };
      PrismaticJoint2.prototype.solvePositionConstraints = function(step) {
        var cA2 = this.m_bodyA.c_position.c;
        var aA = this.m_bodyA.c_position.a;
        var cB2 = this.m_bodyB.c_position.c;
        var aB = this.m_bodyB.c_position.a;
        var qA = Rot.neo(aA);
        var qB = Rot.neo(aB);
        var mA = this.m_invMassA;
        var mB = this.m_invMassB;
        var iA = this.m_invIA;
        var iB = this.m_invIB;
        var rA2 = Rot.mulVec2(qA, Vec2.sub(this.m_localAnchorA, this.m_localCenterA));
        var rB2 = Rot.mulVec2(qB, Vec2.sub(this.m_localAnchorB, this.m_localCenterB));
        var d2 = Vec2.sub(Vec2.add(cB2, rB2), Vec2.add(cA2, rA2));
        var axis = Rot.mulVec2(qA, this.m_localXAxisA);
        var a1 = Vec2.crossVec2Vec2(Vec2.add(d2, rA2), axis);
        var a2 = Vec2.crossVec2Vec2(rB2, axis);
        var perp2 = Rot.mulVec2(qA, this.m_localYAxisA);
        var s1 = Vec2.crossVec2Vec2(Vec2.add(d2, rA2), perp2);
        var s2 = Vec2.crossVec2Vec2(rB2, perp2);
        var impulse = new Vec3();
        var C1 = Vec2.zero();
        C1.x = Vec2.dot(perp2, d2);
        C1.y = aB - aA - this.m_referenceAngle;
        var linearError = math_abs$3(C1.x);
        var angularError = math_abs$3(C1.y);
        var linearSlop = SettingsInternal.linearSlop;
        var maxLinearCorrection = SettingsInternal.maxLinearCorrection;
        var active = false;
        var C2 = 0;
        if (this.m_enableLimit) {
          var translation2 = Vec2.dot(axis, d2);
          if (math_abs$3(this.m_upperTranslation - this.m_lowerTranslation) < 2 * linearSlop) {
            C2 = clamp(translation2, -maxLinearCorrection, maxLinearCorrection);
            linearError = math_max(linearError, math_abs$3(translation2));
            active = true;
          } else if (translation2 <= this.m_lowerTranslation) {
            C2 = clamp(translation2 - this.m_lowerTranslation + linearSlop, -maxLinearCorrection, 0);
            linearError = Math.max(linearError, this.m_lowerTranslation - translation2);
            active = true;
          } else if (translation2 >= this.m_upperTranslation) {
            C2 = clamp(translation2 - this.m_upperTranslation - linearSlop, 0, maxLinearCorrection);
            linearError = Math.max(linearError, translation2 - this.m_upperTranslation);
            active = true;
          }
        }
        if (active) {
          var k11 = mA + mB + iA * s1 * s1 + iB * s2 * s2;
          var k12 = iA * s1 + iB * s2;
          var k13 = iA * s1 * a1 + iB * s2 * a2;
          var k22 = iA + iB;
          if (k22 == 0) {
            k22 = 1;
          }
          var k23 = iA * a1 + iB * a2;
          var k33 = mA + mB + iA * a1 * a1 + iB * a2 * a2;
          var K = new Mat33();
          K.ex.set(k11, k12, k13);
          K.ey.set(k12, k22, k23);
          K.ez.set(k13, k23, k33);
          var C = new Vec3();
          C.x = C1.x;
          C.y = C1.y;
          C.z = C2;
          impulse = K.solve33(Vec3.neg(C));
        } else {
          var k11 = mA + mB + iA * s1 * s1 + iB * s2 * s2;
          var k12 = iA * s1 + iB * s2;
          var k22 = iA + iB;
          if (k22 == 0) {
            k22 = 1;
          }
          var K = new Mat22();
          K.ex.setNum(k11, k12);
          K.ey.setNum(k12, k22);
          var impulse1 = K.solve(Vec2.neg(C1));
          impulse.x = impulse1.x;
          impulse.y = impulse1.y;
          impulse.z = 0;
        }
        var P3 = Vec2.combine(impulse.x, perp2, impulse.z, axis);
        var LA = impulse.x * s1 + impulse.y + impulse.z * a1;
        var LB = impulse.x * s2 + impulse.y + impulse.z * a2;
        cA2.subMul(mA, P3);
        aA -= iA * LA;
        cB2.addMul(mB, P3);
        aB += iB * LB;
        this.m_bodyA.c_position.c = cA2;
        this.m_bodyA.c_position.a = aA;
        this.m_bodyB.c_position.c = cB2;
        this.m_bodyB.c_position.a = aB;
        return linearError <= SettingsInternal.linearSlop && angularError <= SettingsInternal.angularSlop;
      };
      PrismaticJoint2.TYPE = "prismatic-joint";
      return PrismaticJoint2;
    })(Joint)
  );
  var DEFAULTS$6 = {
    ratio: 1
  };
  var GearJoint = (
    /** @class */
    (function(_super) {
      __extends(GearJoint2, _super);
      function GearJoint2(def, bodyA, bodyB, joint1, joint2, ratio) {
        var _this = this;
        if (!(_this instanceof GearJoint2)) {
          return new GearJoint2(def, bodyA, bodyB, joint1, joint2, ratio);
        }
        def = options(def, DEFAULTS$6);
        _this = _super.call(this, def, bodyA, bodyB) || this;
        bodyA = _this.m_bodyA;
        bodyB = _this.m_bodyB;
        _this.m_type = GearJoint2.TYPE;
        _this.m_joint1 = joint1 ? joint1 : def.joint1;
        _this.m_joint2 = joint2 ? joint2 : def.joint2;
        _this.m_ratio = Number.isFinite(ratio) ? ratio : def.ratio;
        _this.m_type1 = _this.m_joint1.getType();
        _this.m_type2 = _this.m_joint2.getType();
        var coordinateA;
        var coordinateB;
        _this.m_bodyC = _this.m_joint1.getBodyA();
        _this.m_bodyA = _this.m_joint1.getBodyB();
        var xfA2 = _this.m_bodyA.m_xf;
        var aA = _this.m_bodyA.m_sweep.a;
        var xfC = _this.m_bodyC.m_xf;
        var aC = _this.m_bodyC.m_sweep.a;
        if (_this.m_type1 === RevoluteJoint.TYPE) {
          var revolute = _this.m_joint1;
          _this.m_localAnchorC = revolute.m_localAnchorA;
          _this.m_localAnchorA = revolute.m_localAnchorB;
          _this.m_referenceAngleA = revolute.m_referenceAngle;
          _this.m_localAxisC = Vec2.zero();
          coordinateA = aA - aC - _this.m_referenceAngleA;
        } else {
          var prismatic = _this.m_joint1;
          _this.m_localAnchorC = prismatic.m_localAnchorA;
          _this.m_localAnchorA = prismatic.m_localAnchorB;
          _this.m_referenceAngleA = prismatic.m_referenceAngle;
          _this.m_localAxisC = prismatic.m_localXAxisA;
          var pC = _this.m_localAnchorC;
          var pA2 = Rot.mulTVec2(xfC.q, Vec2.add(Rot.mulVec2(xfA2.q, _this.m_localAnchorA), Vec2.sub(xfA2.p, xfC.p)));
          coordinateA = Vec2.dot(pA2, _this.m_localAxisC) - Vec2.dot(pC, _this.m_localAxisC);
        }
        _this.m_bodyD = _this.m_joint2.getBodyA();
        _this.m_bodyB = _this.m_joint2.getBodyB();
        var xfB2 = _this.m_bodyB.m_xf;
        var aB = _this.m_bodyB.m_sweep.a;
        var xfD = _this.m_bodyD.m_xf;
        var aD = _this.m_bodyD.m_sweep.a;
        if (_this.m_type2 === RevoluteJoint.TYPE) {
          var revolute = _this.m_joint2;
          _this.m_localAnchorD = revolute.m_localAnchorA;
          _this.m_localAnchorB = revolute.m_localAnchorB;
          _this.m_referenceAngleB = revolute.m_referenceAngle;
          _this.m_localAxisD = Vec2.zero();
          coordinateB = aB - aD - _this.m_referenceAngleB;
        } else {
          var prismatic = _this.m_joint2;
          _this.m_localAnchorD = prismatic.m_localAnchorA;
          _this.m_localAnchorB = prismatic.m_localAnchorB;
          _this.m_referenceAngleB = prismatic.m_referenceAngle;
          _this.m_localAxisD = prismatic.m_localXAxisA;
          var pD = _this.m_localAnchorD;
          var pB2 = Rot.mulTVec2(xfD.q, Vec2.add(Rot.mulVec2(xfB2.q, _this.m_localAnchorB), Vec2.sub(xfB2.p, xfD.p)));
          coordinateB = Vec2.dot(pB2, _this.m_localAxisD) - Vec2.dot(pD, _this.m_localAxisD);
        }
        _this.m_constant = coordinateA + _this.m_ratio * coordinateB;
        _this.m_impulse = 0;
        return _this;
      }
      GearJoint2.prototype._serialize = function() {
        return {
          type: this.m_type,
          bodyA: this.m_bodyA,
          bodyB: this.m_bodyB,
          collideConnected: this.m_collideConnected,
          joint1: this.m_joint1,
          joint2: this.m_joint2,
          ratio: this.m_ratio
          // _constant: this.m_constant,
        };
      };
      GearJoint2._deserialize = function(data, world, restore) {
        data = __assign({}, data);
        data.bodyA = restore(Body, data.bodyA, world);
        data.bodyB = restore(Body, data.bodyB, world);
        data.joint1 = restore(Joint, data.joint1, world);
        data.joint2 = restore(Joint, data.joint2, world);
        var joint = new GearJoint2(data);
        return joint;
      };
      GearJoint2.prototype._reset = function(def) {
        if (Number.isFinite(def.ratio)) {
          this.m_ratio = def.ratio;
        }
      };
      GearJoint2.prototype.getJoint1 = function() {
        return this.m_joint1;
      };
      GearJoint2.prototype.getJoint2 = function() {
        return this.m_joint2;
      };
      GearJoint2.prototype.setRatio = function(ratio) {
        this.m_ratio = ratio;
      };
      GearJoint2.prototype.getRatio = function() {
        return this.m_ratio;
      };
      GearJoint2.prototype.getAnchorA = function() {
        return this.m_bodyA.getWorldPoint(this.m_localAnchorA);
      };
      GearJoint2.prototype.getAnchorB = function() {
        return this.m_bodyB.getWorldPoint(this.m_localAnchorB);
      };
      GearJoint2.prototype.getReactionForce = function(inv_dt) {
        return Vec2.mulNumVec2(this.m_impulse, this.m_JvAC).mul(inv_dt);
      };
      GearJoint2.prototype.getReactionTorque = function(inv_dt) {
        var L = this.m_impulse * this.m_JwA;
        return inv_dt * L;
      };
      GearJoint2.prototype.initVelocityConstraints = function(step) {
        this.m_lcA = this.m_bodyA.m_sweep.localCenter;
        this.m_lcB = this.m_bodyB.m_sweep.localCenter;
        this.m_lcC = this.m_bodyC.m_sweep.localCenter;
        this.m_lcD = this.m_bodyD.m_sweep.localCenter;
        this.m_mA = this.m_bodyA.m_invMass;
        this.m_mB = this.m_bodyB.m_invMass;
        this.m_mC = this.m_bodyC.m_invMass;
        this.m_mD = this.m_bodyD.m_invMass;
        this.m_iA = this.m_bodyA.m_invI;
        this.m_iB = this.m_bodyB.m_invI;
        this.m_iC = this.m_bodyC.m_invI;
        this.m_iD = this.m_bodyD.m_invI;
        var aA = this.m_bodyA.c_position.a;
        var vA2 = this.m_bodyA.c_velocity.v;
        var wA = this.m_bodyA.c_velocity.w;
        var aB = this.m_bodyB.c_position.a;
        var vB2 = this.m_bodyB.c_velocity.v;
        var wB = this.m_bodyB.c_velocity.w;
        var aC = this.m_bodyC.c_position.a;
        var vC = this.m_bodyC.c_velocity.v;
        var wC = this.m_bodyC.c_velocity.w;
        var aD = this.m_bodyD.c_position.a;
        var vD = this.m_bodyD.c_velocity.v;
        var wD = this.m_bodyD.c_velocity.w;
        var qA = Rot.neo(aA);
        var qB = Rot.neo(aB);
        var qC = Rot.neo(aC);
        var qD = Rot.neo(aD);
        this.m_mass = 0;
        if (this.m_type1 == RevoluteJoint.TYPE) {
          this.m_JvAC = Vec2.zero();
          this.m_JwA = 1;
          this.m_JwC = 1;
          this.m_mass += this.m_iA + this.m_iC;
        } else {
          var u = Rot.mulVec2(qC, this.m_localAxisC);
          var rC = Rot.mulSub(qC, this.m_localAnchorC, this.m_lcC);
          var rA2 = Rot.mulSub(qA, this.m_localAnchorA, this.m_lcA);
          this.m_JvAC = u;
          this.m_JwC = Vec2.crossVec2Vec2(rC, u);
          this.m_JwA = Vec2.crossVec2Vec2(rA2, u);
          this.m_mass += this.m_mC + this.m_mA + this.m_iC * this.m_JwC * this.m_JwC + this.m_iA * this.m_JwA * this.m_JwA;
        }
        if (this.m_type2 == RevoluteJoint.TYPE) {
          this.m_JvBD = Vec2.zero();
          this.m_JwB = this.m_ratio;
          this.m_JwD = this.m_ratio;
          this.m_mass += this.m_ratio * this.m_ratio * (this.m_iB + this.m_iD);
        } else {
          var u = Rot.mulVec2(qD, this.m_localAxisD);
          var rD = Rot.mulSub(qD, this.m_localAnchorD, this.m_lcD);
          var rB2 = Rot.mulSub(qB, this.m_localAnchorB, this.m_lcB);
          this.m_JvBD = Vec2.mulNumVec2(this.m_ratio, u);
          this.m_JwD = this.m_ratio * Vec2.crossVec2Vec2(rD, u);
          this.m_JwB = this.m_ratio * Vec2.crossVec2Vec2(rB2, u);
          this.m_mass += this.m_ratio * this.m_ratio * (this.m_mD + this.m_mB) + this.m_iD * this.m_JwD * this.m_JwD + this.m_iB * this.m_JwB * this.m_JwB;
        }
        this.m_mass = this.m_mass > 0 ? 1 / this.m_mass : 0;
        if (step.warmStarting) {
          vA2.addMul(this.m_mA * this.m_impulse, this.m_JvAC);
          wA += this.m_iA * this.m_impulse * this.m_JwA;
          vB2.addMul(this.m_mB * this.m_impulse, this.m_JvBD);
          wB += this.m_iB * this.m_impulse * this.m_JwB;
          vC.subMul(this.m_mC * this.m_impulse, this.m_JvAC);
          wC -= this.m_iC * this.m_impulse * this.m_JwC;
          vD.subMul(this.m_mD * this.m_impulse, this.m_JvBD);
          wD -= this.m_iD * this.m_impulse * this.m_JwD;
        } else {
          this.m_impulse = 0;
        }
        this.m_bodyA.c_velocity.v.setVec2(vA2);
        this.m_bodyA.c_velocity.w = wA;
        this.m_bodyB.c_velocity.v.setVec2(vB2);
        this.m_bodyB.c_velocity.w = wB;
        this.m_bodyC.c_velocity.v.setVec2(vC);
        this.m_bodyC.c_velocity.w = wC;
        this.m_bodyD.c_velocity.v.setVec2(vD);
        this.m_bodyD.c_velocity.w = wD;
      };
      GearJoint2.prototype.solveVelocityConstraints = function(step) {
        var vA2 = this.m_bodyA.c_velocity.v;
        var wA = this.m_bodyA.c_velocity.w;
        var vB2 = this.m_bodyB.c_velocity.v;
        var wB = this.m_bodyB.c_velocity.w;
        var vC = this.m_bodyC.c_velocity.v;
        var wC = this.m_bodyC.c_velocity.w;
        var vD = this.m_bodyD.c_velocity.v;
        var wD = this.m_bodyD.c_velocity.w;
        var Cdot = Vec2.dot(this.m_JvAC, vA2) - Vec2.dot(this.m_JvAC, vC) + Vec2.dot(this.m_JvBD, vB2) - Vec2.dot(this.m_JvBD, vD);
        Cdot += this.m_JwA * wA - this.m_JwC * wC + (this.m_JwB * wB - this.m_JwD * wD);
        var impulse = -this.m_mass * Cdot;
        this.m_impulse += impulse;
        vA2.addMul(this.m_mA * impulse, this.m_JvAC);
        wA += this.m_iA * impulse * this.m_JwA;
        vB2.addMul(this.m_mB * impulse, this.m_JvBD);
        wB += this.m_iB * impulse * this.m_JwB;
        vC.subMul(this.m_mC * impulse, this.m_JvAC);
        wC -= this.m_iC * impulse * this.m_JwC;
        vD.subMul(this.m_mD * impulse, this.m_JvBD);
        wD -= this.m_iD * impulse * this.m_JwD;
        this.m_bodyA.c_velocity.v.setVec2(vA2);
        this.m_bodyA.c_velocity.w = wA;
        this.m_bodyB.c_velocity.v.setVec2(vB2);
        this.m_bodyB.c_velocity.w = wB;
        this.m_bodyC.c_velocity.v.setVec2(vC);
        this.m_bodyC.c_velocity.w = wC;
        this.m_bodyD.c_velocity.v.setVec2(vD);
        this.m_bodyD.c_velocity.w = wD;
      };
      GearJoint2.prototype.solvePositionConstraints = function(step) {
        var cA2 = this.m_bodyA.c_position.c;
        var aA = this.m_bodyA.c_position.a;
        var cB2 = this.m_bodyB.c_position.c;
        var aB = this.m_bodyB.c_position.a;
        var cC = this.m_bodyC.c_position.c;
        var aC = this.m_bodyC.c_position.a;
        var cD = this.m_bodyD.c_position.c;
        var aD = this.m_bodyD.c_position.a;
        var qA = Rot.neo(aA);
        var qB = Rot.neo(aB);
        var qC = Rot.neo(aC);
        var qD = Rot.neo(aD);
        var linearError = 0;
        var coordinateA;
        var coordinateB;
        var JvAC;
        var JvBD;
        var JwA;
        var JwB;
        var JwC;
        var JwD;
        var mass = 0;
        if (this.m_type1 == RevoluteJoint.TYPE) {
          JvAC = Vec2.zero();
          JwA = 1;
          JwC = 1;
          mass += this.m_iA + this.m_iC;
          coordinateA = aA - aC - this.m_referenceAngleA;
        } else {
          var u = Rot.mulVec2(qC, this.m_localAxisC);
          var rC = Rot.mulSub(qC, this.m_localAnchorC, this.m_lcC);
          var rA2 = Rot.mulSub(qA, this.m_localAnchorA, this.m_lcA);
          JvAC = u;
          JwC = Vec2.crossVec2Vec2(rC, u);
          JwA = Vec2.crossVec2Vec2(rA2, u);
          mass += this.m_mC + this.m_mA + this.m_iC * JwC * JwC + this.m_iA * JwA * JwA;
          var pC = Vec2.sub(this.m_localAnchorC, this.m_lcC);
          var pA2 = Rot.mulTVec2(qC, Vec2.add(rA2, Vec2.sub(cA2, cC)));
          coordinateA = Vec2.dot(Vec2.sub(pA2, pC), this.m_localAxisC);
        }
        if (this.m_type2 == RevoluteJoint.TYPE) {
          JvBD = Vec2.zero();
          JwB = this.m_ratio;
          JwD = this.m_ratio;
          mass += this.m_ratio * this.m_ratio * (this.m_iB + this.m_iD);
          coordinateB = aB - aD - this.m_referenceAngleB;
        } else {
          var u = Rot.mulVec2(qD, this.m_localAxisD);
          var rD = Rot.mulSub(qD, this.m_localAnchorD, this.m_lcD);
          var rB2 = Rot.mulSub(qB, this.m_localAnchorB, this.m_lcB);
          JvBD = Vec2.mulNumVec2(this.m_ratio, u);
          JwD = this.m_ratio * Vec2.crossVec2Vec2(rD, u);
          JwB = this.m_ratio * Vec2.crossVec2Vec2(rB2, u);
          mass += this.m_ratio * this.m_ratio * (this.m_mD + this.m_mB) + this.m_iD * JwD * JwD + this.m_iB * JwB * JwB;
          var pD = Vec2.sub(this.m_localAnchorD, this.m_lcD);
          var pB2 = Rot.mulTVec2(qD, Vec2.add(rB2, Vec2.sub(cB2, cD)));
          coordinateB = Vec2.dot(pB2, this.m_localAxisD) - Vec2.dot(pD, this.m_localAxisD);
        }
        var C = coordinateA + this.m_ratio * coordinateB - this.m_constant;
        var impulse = 0;
        if (mass > 0) {
          impulse = -C / mass;
        }
        cA2.addMul(this.m_mA * impulse, JvAC);
        aA += this.m_iA * impulse * JwA;
        cB2.addMul(this.m_mB * impulse, JvBD);
        aB += this.m_iB * impulse * JwB;
        cC.subMul(this.m_mC * impulse, JvAC);
        aC -= this.m_iC * impulse * JwC;
        cD.subMul(this.m_mD * impulse, JvBD);
        aD -= this.m_iD * impulse * JwD;
        this.m_bodyA.c_position.c.setVec2(cA2);
        this.m_bodyA.c_position.a = aA;
        this.m_bodyB.c_position.c.setVec2(cB2);
        this.m_bodyB.c_position.a = aB;
        this.m_bodyC.c_position.c.setVec2(cC);
        this.m_bodyC.c_position.a = aC;
        this.m_bodyD.c_position.c.setVec2(cD);
        this.m_bodyD.c_position.a = aD;
        return linearError < SettingsInternal.linearSlop;
      };
      GearJoint2.TYPE = "gear-joint";
      return GearJoint2;
    })(Joint)
  );
  var DEFAULTS$5 = {
    maxForce: 1,
    maxTorque: 1,
    correctionFactor: 0.3
  };
  var MotorJoint = (
    /** @class */
    (function(_super) {
      __extends(MotorJoint2, _super);
      function MotorJoint2(def, bodyA, bodyB) {
        var _this = this;
        if (!(_this instanceof MotorJoint2)) {
          return new MotorJoint2(def, bodyA, bodyB);
        }
        def = options(def, DEFAULTS$5);
        _this = _super.call(this, def, bodyA, bodyB) || this;
        bodyA = _this.m_bodyA;
        bodyB = _this.m_bodyB;
        _this.m_type = MotorJoint2.TYPE;
        _this.m_linearOffset = Vec2.isValid(def.linearOffset) ? Vec2.clone(def.linearOffset) : bodyA.getLocalPoint(bodyB.getPosition());
        _this.m_angularOffset = Number.isFinite(def.angularOffset) ? def.angularOffset : bodyB.getAngle() - bodyA.getAngle();
        _this.m_linearImpulse = Vec2.zero();
        _this.m_angularImpulse = 0;
        _this.m_maxForce = def.maxForce;
        _this.m_maxTorque = def.maxTorque;
        _this.m_correctionFactor = def.correctionFactor;
        return _this;
      }
      MotorJoint2.prototype._serialize = function() {
        return {
          type: this.m_type,
          bodyA: this.m_bodyA,
          bodyB: this.m_bodyB,
          collideConnected: this.m_collideConnected,
          maxForce: this.m_maxForce,
          maxTorque: this.m_maxTorque,
          correctionFactor: this.m_correctionFactor,
          linearOffset: this.m_linearOffset,
          angularOffset: this.m_angularOffset
        };
      };
      MotorJoint2._deserialize = function(data, world, restore) {
        data = __assign({}, data);
        data.bodyA = restore(Body, data.bodyA, world);
        data.bodyB = restore(Body, data.bodyB, world);
        var joint = new MotorJoint2(data);
        return joint;
      };
      MotorJoint2.prototype._reset = function(def) {
        if (Number.isFinite(def.angularOffset)) {
          this.m_angularOffset = def.angularOffset;
        }
        if (Number.isFinite(def.maxForce)) {
          this.m_maxForce = def.maxForce;
        }
        if (Number.isFinite(def.maxTorque)) {
          this.m_maxTorque = def.maxTorque;
        }
        if (Number.isFinite(def.correctionFactor)) {
          this.m_correctionFactor = def.correctionFactor;
        }
        if (Vec2.isValid(def.linearOffset)) {
          this.m_linearOffset.set(def.linearOffset);
        }
      };
      MotorJoint2.prototype.setMaxForce = function(force) {
        this.m_maxForce = force;
      };
      MotorJoint2.prototype.getMaxForce = function() {
        return this.m_maxForce;
      };
      MotorJoint2.prototype.setMaxTorque = function(torque) {
        this.m_maxTorque = torque;
      };
      MotorJoint2.prototype.getMaxTorque = function() {
        return this.m_maxTorque;
      };
      MotorJoint2.prototype.setCorrectionFactor = function(factor) {
        this.m_correctionFactor = factor;
      };
      MotorJoint2.prototype.getCorrectionFactor = function() {
        return this.m_correctionFactor;
      };
      MotorJoint2.prototype.setLinearOffset = function(linearOffset) {
        if (linearOffset.x != this.m_linearOffset.x || linearOffset.y != this.m_linearOffset.y) {
          this.m_bodyA.setAwake(true);
          this.m_bodyB.setAwake(true);
          this.m_linearOffset.set(linearOffset);
        }
      };
      MotorJoint2.prototype.getLinearOffset = function() {
        return this.m_linearOffset;
      };
      MotorJoint2.prototype.setAngularOffset = function(angularOffset) {
        if (angularOffset != this.m_angularOffset) {
          this.m_bodyA.setAwake(true);
          this.m_bodyB.setAwake(true);
          this.m_angularOffset = angularOffset;
        }
      };
      MotorJoint2.prototype.getAngularOffset = function() {
        return this.m_angularOffset;
      };
      MotorJoint2.prototype.getAnchorA = function() {
        return this.m_bodyA.getPosition();
      };
      MotorJoint2.prototype.getAnchorB = function() {
        return this.m_bodyB.getPosition();
      };
      MotorJoint2.prototype.getReactionForce = function(inv_dt) {
        return Vec2.mulNumVec2(inv_dt, this.m_linearImpulse);
      };
      MotorJoint2.prototype.getReactionTorque = function(inv_dt) {
        return inv_dt * this.m_angularImpulse;
      };
      MotorJoint2.prototype.initVelocityConstraints = function(step) {
        this.m_localCenterA = this.m_bodyA.m_sweep.localCenter;
        this.m_localCenterB = this.m_bodyB.m_sweep.localCenter;
        this.m_invMassA = this.m_bodyA.m_invMass;
        this.m_invMassB = this.m_bodyB.m_invMass;
        this.m_invIA = this.m_bodyA.m_invI;
        this.m_invIB = this.m_bodyB.m_invI;
        var cA2 = this.m_bodyA.c_position.c;
        var aA = this.m_bodyA.c_position.a;
        var vA2 = this.m_bodyA.c_velocity.v;
        var wA = this.m_bodyA.c_velocity.w;
        var cB2 = this.m_bodyB.c_position.c;
        var aB = this.m_bodyB.c_position.a;
        var vB2 = this.m_bodyB.c_velocity.v;
        var wB = this.m_bodyB.c_velocity.w;
        var qA = Rot.neo(aA);
        var qB = Rot.neo(aB);
        this.m_rA = Rot.mulVec2(qA, Vec2.sub(this.m_linearOffset, this.m_localCenterA));
        this.m_rB = Rot.mulVec2(qB, Vec2.neg(this.m_localCenterB));
        var mA = this.m_invMassA;
        var mB = this.m_invMassB;
        var iA = this.m_invIA;
        var iB = this.m_invIB;
        var K = new Mat22();
        K.ex.x = mA + mB + iA * this.m_rA.y * this.m_rA.y + iB * this.m_rB.y * this.m_rB.y;
        K.ex.y = -iA * this.m_rA.x * this.m_rA.y - iB * this.m_rB.x * this.m_rB.y;
        K.ey.x = K.ex.y;
        K.ey.y = mA + mB + iA * this.m_rA.x * this.m_rA.x + iB * this.m_rB.x * this.m_rB.x;
        this.m_linearMass = K.getInverse();
        this.m_angularMass = iA + iB;
        if (this.m_angularMass > 0) {
          this.m_angularMass = 1 / this.m_angularMass;
        }
        this.m_linearError = Vec2.zero();
        this.m_linearError.addCombine(1, cB2, 1, this.m_rB);
        this.m_linearError.subCombine(1, cA2, 1, this.m_rA);
        this.m_angularError = aB - aA - this.m_angularOffset;
        if (step.warmStarting) {
          this.m_linearImpulse.mul(step.dtRatio);
          this.m_angularImpulse *= step.dtRatio;
          var P3 = Vec2.neo(this.m_linearImpulse.x, this.m_linearImpulse.y);
          vA2.subMul(mA, P3);
          wA -= iA * (Vec2.crossVec2Vec2(this.m_rA, P3) + this.m_angularImpulse);
          vB2.addMul(mB, P3);
          wB += iB * (Vec2.crossVec2Vec2(this.m_rB, P3) + this.m_angularImpulse);
        } else {
          this.m_linearImpulse.setZero();
          this.m_angularImpulse = 0;
        }
        this.m_bodyA.c_velocity.v = vA2;
        this.m_bodyA.c_velocity.w = wA;
        this.m_bodyB.c_velocity.v = vB2;
        this.m_bodyB.c_velocity.w = wB;
      };
      MotorJoint2.prototype.solveVelocityConstraints = function(step) {
        var vA2 = this.m_bodyA.c_velocity.v;
        var wA = this.m_bodyA.c_velocity.w;
        var vB2 = this.m_bodyB.c_velocity.v;
        var wB = this.m_bodyB.c_velocity.w;
        var mA = this.m_invMassA;
        var mB = this.m_invMassB;
        var iA = this.m_invIA;
        var iB = this.m_invIB;
        var h = step.dt;
        var inv_h = step.inv_dt;
        {
          var Cdot = wB - wA + inv_h * this.m_correctionFactor * this.m_angularError;
          var impulse = -this.m_angularMass * Cdot;
          var oldImpulse = this.m_angularImpulse;
          var maxImpulse = h * this.m_maxTorque;
          this.m_angularImpulse = clamp(this.m_angularImpulse + impulse, -maxImpulse, maxImpulse);
          impulse = this.m_angularImpulse - oldImpulse;
          wA -= iA * impulse;
          wB += iB * impulse;
        }
        {
          var Cdot = Vec2.zero();
          Cdot.addCombine(1, vB2, 1, Vec2.crossNumVec2(wB, this.m_rB));
          Cdot.subCombine(1, vA2, 1, Vec2.crossNumVec2(wA, this.m_rA));
          Cdot.addMul(inv_h * this.m_correctionFactor, this.m_linearError);
          var impulse = Vec2.neg(Mat22.mulVec2(this.m_linearMass, Cdot));
          var oldImpulse = Vec2.clone(this.m_linearImpulse);
          this.m_linearImpulse.add(impulse);
          var maxImpulse = h * this.m_maxForce;
          this.m_linearImpulse.clamp(maxImpulse);
          impulse = Vec2.sub(this.m_linearImpulse, oldImpulse);
          vA2.subMul(mA, impulse);
          wA -= iA * Vec2.crossVec2Vec2(this.m_rA, impulse);
          vB2.addMul(mB, impulse);
          wB += iB * Vec2.crossVec2Vec2(this.m_rB, impulse);
        }
        this.m_bodyA.c_velocity.v = vA2;
        this.m_bodyA.c_velocity.w = wA;
        this.m_bodyB.c_velocity.v = vB2;
        this.m_bodyB.c_velocity.w = wB;
      };
      MotorJoint2.prototype.solvePositionConstraints = function(step) {
        return true;
      };
      MotorJoint2.TYPE = "motor-joint";
      return MotorJoint2;
    })(Joint)
  );
  var math_PI$2 = Math.PI;
  var DEFAULTS$4 = {
    maxForce: 0,
    frequencyHz: 5,
    dampingRatio: 0.7
  };
  var MouseJoint = (
    /** @class */
    (function(_super) {
      __extends(MouseJoint2, _super);
      function MouseJoint2(def, bodyA, bodyB, target) {
        var _this = this;
        if (!(_this instanceof MouseJoint2)) {
          return new MouseJoint2(def, bodyA, bodyB, target);
        }
        def = options(def, DEFAULTS$4);
        _this = _super.call(this, def, bodyA, bodyB) || this;
        bodyA = _this.m_bodyA;
        bodyB = _this.m_bodyB;
        _this.m_type = MouseJoint2.TYPE;
        if (Vec2.isValid(target)) {
          _this.m_targetA = Vec2.clone(target);
        } else if (Vec2.isValid(def.target)) {
          _this.m_targetA = Vec2.clone(def.target);
        } else {
          _this.m_targetA = Vec2.zero();
        }
        _this.m_localAnchorB = Transform.mulTVec2(bodyB.getTransform(), _this.m_targetA);
        _this.m_maxForce = def.maxForce;
        _this.m_impulse = Vec2.zero();
        _this.m_frequencyHz = def.frequencyHz;
        _this.m_dampingRatio = def.dampingRatio;
        _this.m_beta = 0;
        _this.m_gamma = 0;
        _this.m_rB = Vec2.zero();
        _this.m_localCenterB = Vec2.zero();
        _this.m_invMassB = 0;
        _this.m_invIB = 0;
        _this.m_mass = new Mat22();
        _this.m_C = Vec2.zero();
        return _this;
      }
      MouseJoint2.prototype._serialize = function() {
        return {
          type: this.m_type,
          bodyA: this.m_bodyA,
          bodyB: this.m_bodyB,
          collideConnected: this.m_collideConnected,
          target: this.m_targetA,
          maxForce: this.m_maxForce,
          frequencyHz: this.m_frequencyHz,
          dampingRatio: this.m_dampingRatio,
          _localAnchorB: this.m_localAnchorB
        };
      };
      MouseJoint2._deserialize = function(data, world, restore) {
        data = __assign({}, data);
        data.bodyA = restore(Body, data.bodyA, world);
        data.bodyB = restore(Body, data.bodyB, world);
        data.target = Vec2.clone(data.target);
        var joint = new MouseJoint2(data);
        if (data._localAnchorB) {
          joint.m_localAnchorB = data._localAnchorB;
        }
        return joint;
      };
      MouseJoint2.prototype._reset = function(def) {
        if (Number.isFinite(def.maxForce)) {
          this.m_maxForce = def.maxForce;
        }
        if (Number.isFinite(def.frequencyHz)) {
          this.m_frequencyHz = def.frequencyHz;
        }
        if (Number.isFinite(def.dampingRatio)) {
          this.m_dampingRatio = def.dampingRatio;
        }
      };
      MouseJoint2.prototype.setTarget = function(target) {
        if (Vec2.areEqual(target, this.m_targetA))
          return;
        this.m_bodyB.setAwake(true);
        this.m_targetA.set(target);
      };
      MouseJoint2.prototype.getTarget = function() {
        return this.m_targetA;
      };
      MouseJoint2.prototype.setMaxForce = function(force) {
        this.m_maxForce = force;
      };
      MouseJoint2.prototype.getMaxForce = function() {
        return this.m_maxForce;
      };
      MouseJoint2.prototype.setFrequency = function(hz) {
        this.m_frequencyHz = hz;
      };
      MouseJoint2.prototype.getFrequency = function() {
        return this.m_frequencyHz;
      };
      MouseJoint2.prototype.setDampingRatio = function(ratio) {
        this.m_dampingRatio = ratio;
      };
      MouseJoint2.prototype.getDampingRatio = function() {
        return this.m_dampingRatio;
      };
      MouseJoint2.prototype.getAnchorA = function() {
        return Vec2.clone(this.m_targetA);
      };
      MouseJoint2.prototype.getAnchorB = function() {
        return this.m_bodyB.getWorldPoint(this.m_localAnchorB);
      };
      MouseJoint2.prototype.getReactionForce = function(inv_dt) {
        return Vec2.mulNumVec2(inv_dt, this.m_impulse);
      };
      MouseJoint2.prototype.getReactionTorque = function(inv_dt) {
        return inv_dt * 0;
      };
      MouseJoint2.prototype.shiftOrigin = function(newOrigin) {
        this.m_targetA.sub(newOrigin);
      };
      MouseJoint2.prototype.initVelocityConstraints = function(step) {
        this.m_localCenterB = this.m_bodyB.m_sweep.localCenter;
        this.m_invMassB = this.m_bodyB.m_invMass;
        this.m_invIB = this.m_bodyB.m_invI;
        var position = this.m_bodyB.c_position;
        var velocity = this.m_bodyB.c_velocity;
        var cB2 = position.c;
        var aB = position.a;
        var vB2 = velocity.v;
        var wB = velocity.w;
        var qB = Rot.neo(aB);
        var mass = this.m_bodyB.getMass();
        var omega = 2 * math_PI$2 * this.m_frequencyHz;
        var d2 = 2 * mass * this.m_dampingRatio * omega;
        var k = mass * (omega * omega);
        var h = step.dt;
        this.m_gamma = h * (d2 + h * k);
        if (this.m_gamma != 0) {
          this.m_gamma = 1 / this.m_gamma;
        }
        this.m_beta = h * k * this.m_gamma;
        this.m_rB = Rot.mulVec2(qB, Vec2.sub(this.m_localAnchorB, this.m_localCenterB));
        var K = new Mat22();
        K.ex.x = this.m_invMassB + this.m_invIB * this.m_rB.y * this.m_rB.y + this.m_gamma;
        K.ex.y = -this.m_invIB * this.m_rB.x * this.m_rB.y;
        K.ey.x = K.ex.y;
        K.ey.y = this.m_invMassB + this.m_invIB * this.m_rB.x * this.m_rB.x + this.m_gamma;
        this.m_mass = K.getInverse();
        this.m_C.setVec2(cB2);
        this.m_C.addCombine(1, this.m_rB, -1, this.m_targetA);
        this.m_C.mul(this.m_beta);
        wB *= 0.98;
        if (step.warmStarting) {
          this.m_impulse.mul(step.dtRatio);
          vB2.addMul(this.m_invMassB, this.m_impulse);
          wB += this.m_invIB * Vec2.crossVec2Vec2(this.m_rB, this.m_impulse);
        } else {
          this.m_impulse.setZero();
        }
        velocity.v.setVec2(vB2);
        velocity.w = wB;
      };
      MouseJoint2.prototype.solveVelocityConstraints = function(step) {
        var velocity = this.m_bodyB.c_velocity;
        var vB2 = Vec2.clone(velocity.v);
        var wB = velocity.w;
        var Cdot = Vec2.crossNumVec2(wB, this.m_rB);
        Cdot.add(vB2);
        Cdot.addCombine(1, this.m_C, this.m_gamma, this.m_impulse);
        Cdot.neg();
        var impulse = Mat22.mulVec2(this.m_mass, Cdot);
        var oldImpulse = Vec2.clone(this.m_impulse);
        this.m_impulse.add(impulse);
        var maxImpulse = step.dt * this.m_maxForce;
        this.m_impulse.clamp(maxImpulse);
        impulse = Vec2.sub(this.m_impulse, oldImpulse);
        vB2.addMul(this.m_invMassB, impulse);
        wB += this.m_invIB * Vec2.crossVec2Vec2(this.m_rB, impulse);
        velocity.v.setVec2(vB2);
        velocity.w = wB;
      };
      MouseJoint2.prototype.solvePositionConstraints = function(step) {
        return true;
      };
      MouseJoint2.TYPE = "mouse-joint";
      return MouseJoint2;
    })(Joint)
  );
  var math_abs$2 = Math.abs;
  var DEFAULTS$3 = {
    collideConnected: true
  };
  var PulleyJoint = (
    /** @class */
    (function(_super) {
      __extends(PulleyJoint2, _super);
      function PulleyJoint2(def, bodyA, bodyB, groundA, groundB, anchorA, anchorB, ratio) {
        var _this = this;
        if (!(_this instanceof PulleyJoint2)) {
          return new PulleyJoint2(def, bodyA, bodyB, groundA, groundB, anchorA, anchorB, ratio);
        }
        def = options(def, DEFAULTS$3);
        _this = _super.call(this, def, bodyA, bodyB) || this;
        bodyA = _this.m_bodyA;
        bodyB = _this.m_bodyB;
        _this.m_type = PulleyJoint2.TYPE;
        _this.m_groundAnchorA = Vec2.clone(groundA ? groundA : def.groundAnchorA || Vec2.neo(-1, 1));
        _this.m_groundAnchorB = Vec2.clone(groundB ? groundB : def.groundAnchorB || Vec2.neo(1, 1));
        _this.m_localAnchorA = Vec2.clone(anchorA ? bodyA.getLocalPoint(anchorA) : def.localAnchorA || Vec2.neo(-1, 0));
        _this.m_localAnchorB = Vec2.clone(anchorB ? bodyB.getLocalPoint(anchorB) : def.localAnchorB || Vec2.neo(1, 0));
        _this.m_lengthA = Number.isFinite(def.lengthA) ? def.lengthA : Vec2.distance(anchorA, groundA);
        _this.m_lengthB = Number.isFinite(def.lengthB) ? def.lengthB : Vec2.distance(anchorB, groundB);
        _this.m_ratio = Number.isFinite(ratio) ? ratio : def.ratio;
        _this.m_constant = _this.m_lengthA + _this.m_ratio * _this.m_lengthB;
        _this.m_impulse = 0;
        return _this;
      }
      PulleyJoint2.prototype._serialize = function() {
        return {
          type: this.m_type,
          bodyA: this.m_bodyA,
          bodyB: this.m_bodyB,
          collideConnected: this.m_collideConnected,
          groundAnchorA: this.m_groundAnchorA,
          groundAnchorB: this.m_groundAnchorB,
          localAnchorA: this.m_localAnchorA,
          localAnchorB: this.m_localAnchorB,
          lengthA: this.m_lengthA,
          lengthB: this.m_lengthB,
          ratio: this.m_ratio
        };
      };
      PulleyJoint2._deserialize = function(data, world, restore) {
        data = __assign({}, data);
        data.bodyA = restore(Body, data.bodyA, world);
        data.bodyB = restore(Body, data.bodyB, world);
        var joint = new PulleyJoint2(data);
        return joint;
      };
      PulleyJoint2.prototype._reset = function(def) {
        if (Vec2.isValid(def.groundAnchorA)) {
          this.m_groundAnchorA.set(def.groundAnchorA);
        }
        if (Vec2.isValid(def.groundAnchorB)) {
          this.m_groundAnchorB.set(def.groundAnchorB);
        }
        if (Vec2.isValid(def.localAnchorA)) {
          this.m_localAnchorA.set(def.localAnchorA);
        } else if (Vec2.isValid(def.anchorA)) {
          this.m_localAnchorA.set(this.m_bodyA.getLocalPoint(def.anchorA));
        }
        if (Vec2.isValid(def.localAnchorB)) {
          this.m_localAnchorB.set(def.localAnchorB);
        } else if (Vec2.isValid(def.anchorB)) {
          this.m_localAnchorB.set(this.m_bodyB.getLocalPoint(def.anchorB));
        }
        if (Number.isFinite(def.lengthA)) {
          this.m_lengthA = def.lengthA;
        }
        if (Number.isFinite(def.lengthB)) {
          this.m_lengthB = def.lengthB;
        }
        if (Number.isFinite(def.ratio)) {
          this.m_ratio = def.ratio;
        }
      };
      PulleyJoint2.prototype.getGroundAnchorA = function() {
        return this.m_groundAnchorA;
      };
      PulleyJoint2.prototype.getGroundAnchorB = function() {
        return this.m_groundAnchorB;
      };
      PulleyJoint2.prototype.getLengthA = function() {
        return this.m_lengthA;
      };
      PulleyJoint2.prototype.getLengthB = function() {
        return this.m_lengthB;
      };
      PulleyJoint2.prototype.getRatio = function() {
        return this.m_ratio;
      };
      PulleyJoint2.prototype.getCurrentLengthA = function() {
        var p = this.m_bodyA.getWorldPoint(this.m_localAnchorA);
        var s2 = this.m_groundAnchorA;
        return Vec2.distance(p, s2);
      };
      PulleyJoint2.prototype.getCurrentLengthB = function() {
        var p = this.m_bodyB.getWorldPoint(this.m_localAnchorB);
        var s2 = this.m_groundAnchorB;
        return Vec2.distance(p, s2);
      };
      PulleyJoint2.prototype.shiftOrigin = function(newOrigin) {
        this.m_groundAnchorA.sub(newOrigin);
        this.m_groundAnchorB.sub(newOrigin);
      };
      PulleyJoint2.prototype.getAnchorA = function() {
        return this.m_bodyA.getWorldPoint(this.m_localAnchorA);
      };
      PulleyJoint2.prototype.getAnchorB = function() {
        return this.m_bodyB.getWorldPoint(this.m_localAnchorB);
      };
      PulleyJoint2.prototype.getReactionForce = function(inv_dt) {
        return Vec2.mulNumVec2(this.m_impulse, this.m_uB).mul(inv_dt);
      };
      PulleyJoint2.prototype.getReactionTorque = function(inv_dt) {
        return 0;
      };
      PulleyJoint2.prototype.initVelocityConstraints = function(step) {
        this.m_localCenterA = this.m_bodyA.m_sweep.localCenter;
        this.m_localCenterB = this.m_bodyB.m_sweep.localCenter;
        this.m_invMassA = this.m_bodyA.m_invMass;
        this.m_invMassB = this.m_bodyB.m_invMass;
        this.m_invIA = this.m_bodyA.m_invI;
        this.m_invIB = this.m_bodyB.m_invI;
        var cA2 = this.m_bodyA.c_position.c;
        var aA = this.m_bodyA.c_position.a;
        var vA2 = this.m_bodyA.c_velocity.v;
        var wA = this.m_bodyA.c_velocity.w;
        var cB2 = this.m_bodyB.c_position.c;
        var aB = this.m_bodyB.c_position.a;
        var vB2 = this.m_bodyB.c_velocity.v;
        var wB = this.m_bodyB.c_velocity.w;
        var qA = Rot.neo(aA);
        var qB = Rot.neo(aB);
        this.m_rA = Rot.mulVec2(qA, Vec2.sub(this.m_localAnchorA, this.m_localCenterA));
        this.m_rB = Rot.mulVec2(qB, Vec2.sub(this.m_localAnchorB, this.m_localCenterB));
        this.m_uA = Vec2.sub(Vec2.add(cA2, this.m_rA), this.m_groundAnchorA);
        this.m_uB = Vec2.sub(Vec2.add(cB2, this.m_rB), this.m_groundAnchorB);
        var lengthA = this.m_uA.length();
        var lengthB = this.m_uB.length();
        if (lengthA > 10 * SettingsInternal.linearSlop) {
          this.m_uA.mul(1 / lengthA);
        } else {
          this.m_uA.setZero();
        }
        if (lengthB > 10 * SettingsInternal.linearSlop) {
          this.m_uB.mul(1 / lengthB);
        } else {
          this.m_uB.setZero();
        }
        var ruA = Vec2.crossVec2Vec2(this.m_rA, this.m_uA);
        var ruB = Vec2.crossVec2Vec2(this.m_rB, this.m_uB);
        var mA = this.m_invMassA + this.m_invIA * ruA * ruA;
        var mB = this.m_invMassB + this.m_invIB * ruB * ruB;
        this.m_mass = mA + this.m_ratio * this.m_ratio * mB;
        if (this.m_mass > 0) {
          this.m_mass = 1 / this.m_mass;
        }
        if (step.warmStarting) {
          this.m_impulse *= step.dtRatio;
          var PA = Vec2.mulNumVec2(-this.m_impulse, this.m_uA);
          var PB = Vec2.mulNumVec2(-this.m_ratio * this.m_impulse, this.m_uB);
          vA2.addMul(this.m_invMassA, PA);
          wA += this.m_invIA * Vec2.crossVec2Vec2(this.m_rA, PA);
          vB2.addMul(this.m_invMassB, PB);
          wB += this.m_invIB * Vec2.crossVec2Vec2(this.m_rB, PB);
        } else {
          this.m_impulse = 0;
        }
        this.m_bodyA.c_velocity.v = vA2;
        this.m_bodyA.c_velocity.w = wA;
        this.m_bodyB.c_velocity.v = vB2;
        this.m_bodyB.c_velocity.w = wB;
      };
      PulleyJoint2.prototype.solveVelocityConstraints = function(step) {
        var vA2 = this.m_bodyA.c_velocity.v;
        var wA = this.m_bodyA.c_velocity.w;
        var vB2 = this.m_bodyB.c_velocity.v;
        var wB = this.m_bodyB.c_velocity.w;
        var vpA = Vec2.add(vA2, Vec2.crossNumVec2(wA, this.m_rA));
        var vpB = Vec2.add(vB2, Vec2.crossNumVec2(wB, this.m_rB));
        var Cdot = -Vec2.dot(this.m_uA, vpA) - this.m_ratio * Vec2.dot(this.m_uB, vpB);
        var impulse = -this.m_mass * Cdot;
        this.m_impulse += impulse;
        var PA = Vec2.mulNumVec2(-impulse, this.m_uA);
        var PB = Vec2.mulNumVec2(-this.m_ratio * impulse, this.m_uB);
        vA2.addMul(this.m_invMassA, PA);
        wA += this.m_invIA * Vec2.crossVec2Vec2(this.m_rA, PA);
        vB2.addMul(this.m_invMassB, PB);
        wB += this.m_invIB * Vec2.crossVec2Vec2(this.m_rB, PB);
        this.m_bodyA.c_velocity.v = vA2;
        this.m_bodyA.c_velocity.w = wA;
        this.m_bodyB.c_velocity.v = vB2;
        this.m_bodyB.c_velocity.w = wB;
      };
      PulleyJoint2.prototype.solvePositionConstraints = function(step) {
        var cA2 = this.m_bodyA.c_position.c;
        var aA = this.m_bodyA.c_position.a;
        var cB2 = this.m_bodyB.c_position.c;
        var aB = this.m_bodyB.c_position.a;
        var qA = Rot.neo(aA);
        var qB = Rot.neo(aB);
        var rA2 = Rot.mulVec2(qA, Vec2.sub(this.m_localAnchorA, this.m_localCenterA));
        var rB2 = Rot.mulVec2(qB, Vec2.sub(this.m_localAnchorB, this.m_localCenterB));
        var uA = Vec2.sub(Vec2.add(cA2, this.m_rA), this.m_groundAnchorA);
        var uB = Vec2.sub(Vec2.add(cB2, this.m_rB), this.m_groundAnchorB);
        var lengthA = uA.length();
        var lengthB = uB.length();
        if (lengthA > 10 * SettingsInternal.linearSlop) {
          uA.mul(1 / lengthA);
        } else {
          uA.setZero();
        }
        if (lengthB > 10 * SettingsInternal.linearSlop) {
          uB.mul(1 / lengthB);
        } else {
          uB.setZero();
        }
        var ruA = Vec2.crossVec2Vec2(rA2, uA);
        var ruB = Vec2.crossVec2Vec2(rB2, uB);
        var mA = this.m_invMassA + this.m_invIA * ruA * ruA;
        var mB = this.m_invMassB + this.m_invIB * ruB * ruB;
        var mass = mA + this.m_ratio * this.m_ratio * mB;
        if (mass > 0) {
          mass = 1 / mass;
        }
        var C = this.m_constant - lengthA - this.m_ratio * lengthB;
        var linearError = math_abs$2(C);
        var impulse = -mass * C;
        var PA = Vec2.mulNumVec2(-impulse, uA);
        var PB = Vec2.mulNumVec2(-this.m_ratio * impulse, uB);
        cA2.addMul(this.m_invMassA, PA);
        aA += this.m_invIA * Vec2.crossVec2Vec2(rA2, PA);
        cB2.addMul(this.m_invMassB, PB);
        aB += this.m_invIB * Vec2.crossVec2Vec2(rB2, PB);
        this.m_bodyA.c_position.c = cA2;
        this.m_bodyA.c_position.a = aA;
        this.m_bodyB.c_position.c = cB2;
        this.m_bodyB.c_position.a = aB;
        return linearError < SettingsInternal.linearSlop;
      };
      PulleyJoint2.TYPE = "pulley-joint";
      return PulleyJoint2;
    })(Joint)
  );
  var math_min$1 = Math.min;
  var LimitState;
  (function(LimitState2) {
    LimitState2[LimitState2["inactiveLimit"] = 0] = "inactiveLimit";
    LimitState2[LimitState2["atLowerLimit"] = 1] = "atLowerLimit";
    LimitState2[LimitState2["atUpperLimit"] = 2] = "atUpperLimit";
    LimitState2[LimitState2["equalLimits"] = 3] = "equalLimits";
  })(LimitState || (LimitState = {}));
  var DEFAULTS$2 = {
    maxLength: 0
  };
  var RopeJoint = (
    /** @class */
    (function(_super) {
      __extends(RopeJoint2, _super);
      function RopeJoint2(def, bodyA, bodyB, anchor) {
        var _this = this;
        if (!(_this instanceof RopeJoint2)) {
          return new RopeJoint2(def, bodyA, bodyB, anchor);
        }
        def = options(def, DEFAULTS$2);
        _this = _super.call(this, def, bodyA, bodyB) || this;
        bodyA = _this.m_bodyA;
        bodyB = _this.m_bodyB;
        _this.m_type = RopeJoint2.TYPE;
        _this.m_localAnchorA = Vec2.clone(anchor ? bodyA.getLocalPoint(anchor) : def.localAnchorA || Vec2.neo(-1, 0));
        _this.m_localAnchorB = Vec2.clone(anchor ? bodyB.getLocalPoint(anchor) : def.localAnchorB || Vec2.neo(1, 0));
        _this.m_maxLength = def.maxLength;
        _this.m_mass = 0;
        _this.m_impulse = 0;
        _this.m_length = 0;
        _this.m_state = LimitState.inactiveLimit;
        return _this;
      }
      RopeJoint2.prototype._serialize = function() {
        return {
          type: this.m_type,
          bodyA: this.m_bodyA,
          bodyB: this.m_bodyB,
          collideConnected: this.m_collideConnected,
          localAnchorA: this.m_localAnchorA,
          localAnchorB: this.m_localAnchorB,
          maxLength: this.m_maxLength
        };
      };
      RopeJoint2._deserialize = function(data, world, restore) {
        data = __assign({}, data);
        data.bodyA = restore(Body, data.bodyA, world);
        data.bodyB = restore(Body, data.bodyB, world);
        var joint = new RopeJoint2(data);
        return joint;
      };
      RopeJoint2.prototype._reset = function(def) {
        if (Number.isFinite(def.maxLength)) {
          this.m_maxLength = def.maxLength;
        }
      };
      RopeJoint2.prototype.getLocalAnchorA = function() {
        return this.m_localAnchorA;
      };
      RopeJoint2.prototype.getLocalAnchorB = function() {
        return this.m_localAnchorB;
      };
      RopeJoint2.prototype.setMaxLength = function(length) {
        this.m_maxLength = length;
      };
      RopeJoint2.prototype.getMaxLength = function() {
        return this.m_maxLength;
      };
      RopeJoint2.prototype.getLimitState = function() {
        return this.m_state;
      };
      RopeJoint2.prototype.getAnchorA = function() {
        return this.m_bodyA.getWorldPoint(this.m_localAnchorA);
      };
      RopeJoint2.prototype.getAnchorB = function() {
        return this.m_bodyB.getWorldPoint(this.m_localAnchorB);
      };
      RopeJoint2.prototype.getReactionForce = function(inv_dt) {
        return Vec2.mulNumVec2(this.m_impulse, this.m_u).mul(inv_dt);
      };
      RopeJoint2.prototype.getReactionTorque = function(inv_dt) {
        return 0;
      };
      RopeJoint2.prototype.initVelocityConstraints = function(step) {
        this.m_localCenterA = this.m_bodyA.m_sweep.localCenter;
        this.m_localCenterB = this.m_bodyB.m_sweep.localCenter;
        this.m_invMassA = this.m_bodyA.m_invMass;
        this.m_invMassB = this.m_bodyB.m_invMass;
        this.m_invIA = this.m_bodyA.m_invI;
        this.m_invIB = this.m_bodyB.m_invI;
        var cA2 = this.m_bodyA.c_position.c;
        var aA = this.m_bodyA.c_position.a;
        var vA2 = this.m_bodyA.c_velocity.v;
        var wA = this.m_bodyA.c_velocity.w;
        var cB2 = this.m_bodyB.c_position.c;
        var aB = this.m_bodyB.c_position.a;
        var vB2 = this.m_bodyB.c_velocity.v;
        var wB = this.m_bodyB.c_velocity.w;
        var qA = Rot.neo(aA);
        var qB = Rot.neo(aB);
        this.m_rA = Rot.mulSub(qA, this.m_localAnchorA, this.m_localCenterA);
        this.m_rB = Rot.mulSub(qB, this.m_localAnchorB, this.m_localCenterB);
        this.m_u = Vec2.zero();
        this.m_u.addCombine(1, cB2, 1, this.m_rB);
        this.m_u.subCombine(1, cA2, 1, this.m_rA);
        this.m_length = this.m_u.length();
        var C = this.m_length - this.m_maxLength;
        if (C > 0) {
          this.m_state = LimitState.atUpperLimit;
        } else {
          this.m_state = LimitState.inactiveLimit;
        }
        if (this.m_length > SettingsInternal.linearSlop) {
          this.m_u.mul(1 / this.m_length);
        } else {
          this.m_u.setZero();
          this.m_mass = 0;
          this.m_impulse = 0;
          return;
        }
        var crA = Vec2.crossVec2Vec2(this.m_rA, this.m_u);
        var crB = Vec2.crossVec2Vec2(this.m_rB, this.m_u);
        var invMass = this.m_invMassA + this.m_invIA * crA * crA + this.m_invMassB + this.m_invIB * crB * crB;
        this.m_mass = invMass != 0 ? 1 / invMass : 0;
        if (step.warmStarting) {
          this.m_impulse *= step.dtRatio;
          var P3 = Vec2.mulNumVec2(this.m_impulse, this.m_u);
          vA2.subMul(this.m_invMassA, P3);
          wA -= this.m_invIA * Vec2.crossVec2Vec2(this.m_rA, P3);
          vB2.addMul(this.m_invMassB, P3);
          wB += this.m_invIB * Vec2.crossVec2Vec2(this.m_rB, P3);
        } else {
          this.m_impulse = 0;
        }
        this.m_bodyA.c_velocity.v.setVec2(vA2);
        this.m_bodyA.c_velocity.w = wA;
        this.m_bodyB.c_velocity.v.setVec2(vB2);
        this.m_bodyB.c_velocity.w = wB;
      };
      RopeJoint2.prototype.solveVelocityConstraints = function(step) {
        var vA2 = this.m_bodyA.c_velocity.v;
        var wA = this.m_bodyA.c_velocity.w;
        var vB2 = this.m_bodyB.c_velocity.v;
        var wB = this.m_bodyB.c_velocity.w;
        var vpA = Vec2.addCrossNumVec2(vA2, wA, this.m_rA);
        var vpB = Vec2.addCrossNumVec2(vB2, wB, this.m_rB);
        var C = this.m_length - this.m_maxLength;
        var Cdot = Vec2.dot(this.m_u, Vec2.sub(vpB, vpA));
        if (C < 0) {
          Cdot += step.inv_dt * C;
        }
        var impulse = -this.m_mass * Cdot;
        var oldImpulse = this.m_impulse;
        this.m_impulse = math_min$1(0, this.m_impulse + impulse);
        impulse = this.m_impulse - oldImpulse;
        var P3 = Vec2.mulNumVec2(impulse, this.m_u);
        vA2.subMul(this.m_invMassA, P3);
        wA -= this.m_invIA * Vec2.crossVec2Vec2(this.m_rA, P3);
        vB2.addMul(this.m_invMassB, P3);
        wB += this.m_invIB * Vec2.crossVec2Vec2(this.m_rB, P3);
        this.m_bodyA.c_velocity.v = vA2;
        this.m_bodyA.c_velocity.w = wA;
        this.m_bodyB.c_velocity.v = vB2;
        this.m_bodyB.c_velocity.w = wB;
      };
      RopeJoint2.prototype.solvePositionConstraints = function(step) {
        var cA2 = this.m_bodyA.c_position.c;
        var aA = this.m_bodyA.c_position.a;
        var cB2 = this.m_bodyB.c_position.c;
        var aB = this.m_bodyB.c_position.a;
        var qA = Rot.neo(aA);
        var qB = Rot.neo(aB);
        var rA2 = Rot.mulSub(qA, this.m_localAnchorA, this.m_localCenterA);
        var rB2 = Rot.mulSub(qB, this.m_localAnchorB, this.m_localCenterB);
        var u = Vec2.zero();
        u.addCombine(1, cB2, 1, rB2);
        u.subCombine(1, cA2, 1, rA2);
        var length = u.normalize();
        var C = length - this.m_maxLength;
        C = clamp(C, 0, SettingsInternal.maxLinearCorrection);
        var impulse = -this.m_mass * C;
        var P3 = Vec2.mulNumVec2(impulse, u);
        cA2.subMul(this.m_invMassA, P3);
        aA -= this.m_invIA * Vec2.crossVec2Vec2(rA2, P3);
        cB2.addMul(this.m_invMassB, P3);
        aB += this.m_invIB * Vec2.crossVec2Vec2(rB2, P3);
        this.m_bodyA.c_position.c.setVec2(cA2);
        this.m_bodyA.c_position.a = aA;
        this.m_bodyB.c_position.c.setVec2(cB2);
        this.m_bodyB.c_position.a = aB;
        return length - this.m_maxLength < SettingsInternal.linearSlop;
      };
      RopeJoint2.TYPE = "rope-joint";
      return RopeJoint2;
    })(Joint)
  );
  var math_abs$1 = Math.abs;
  var math_PI$1 = Math.PI;
  var DEFAULTS$1 = {
    frequencyHz: 0,
    dampingRatio: 0
  };
  var WeldJoint = (
    /** @class */
    (function(_super) {
      __extends(WeldJoint2, _super);
      function WeldJoint2(def, bodyA, bodyB, anchor) {
        var _this = this;
        if (!(_this instanceof WeldJoint2)) {
          return new WeldJoint2(def, bodyA, bodyB, anchor);
        }
        def = options(def, DEFAULTS$1);
        _this = _super.call(this, def, bodyA, bodyB) || this;
        bodyA = _this.m_bodyA;
        bodyB = _this.m_bodyB;
        _this.m_type = WeldJoint2.TYPE;
        _this.m_localAnchorA = Vec2.clone(anchor ? bodyA.getLocalPoint(anchor) : def.localAnchorA || Vec2.zero());
        _this.m_localAnchorB = Vec2.clone(anchor ? bodyB.getLocalPoint(anchor) : def.localAnchorB || Vec2.zero());
        _this.m_referenceAngle = Number.isFinite(def.referenceAngle) ? def.referenceAngle : bodyB.getAngle() - bodyA.getAngle();
        _this.m_frequencyHz = def.frequencyHz;
        _this.m_dampingRatio = def.dampingRatio;
        _this.m_impulse = new Vec3();
        _this.m_bias = 0;
        _this.m_gamma = 0;
        _this.m_mass = new Mat33();
        return _this;
      }
      WeldJoint2.prototype._serialize = function() {
        return {
          type: this.m_type,
          bodyA: this.m_bodyA,
          bodyB: this.m_bodyB,
          collideConnected: this.m_collideConnected,
          frequencyHz: this.m_frequencyHz,
          dampingRatio: this.m_dampingRatio,
          localAnchorA: this.m_localAnchorA,
          localAnchorB: this.m_localAnchorB,
          referenceAngle: this.m_referenceAngle
        };
      };
      WeldJoint2._deserialize = function(data, world, restore) {
        data = __assign({}, data);
        data.bodyA = restore(Body, data.bodyA, world);
        data.bodyB = restore(Body, data.bodyB, world);
        var joint = new WeldJoint2(data);
        return joint;
      };
      WeldJoint2.prototype._reset = function(def) {
        if (def.anchorA) {
          this.m_localAnchorA.setVec2(this.m_bodyA.getLocalPoint(def.anchorA));
        } else if (def.localAnchorA) {
          this.m_localAnchorA.setVec2(def.localAnchorA);
        }
        if (def.anchorB) {
          this.m_localAnchorB.setVec2(this.m_bodyB.getLocalPoint(def.anchorB));
        } else if (def.localAnchorB) {
          this.m_localAnchorB.setVec2(def.localAnchorB);
        }
        if (Number.isFinite(def.frequencyHz)) {
          this.m_frequencyHz = def.frequencyHz;
        }
        if (Number.isFinite(def.dampingRatio)) {
          this.m_dampingRatio = def.dampingRatio;
        }
      };
      WeldJoint2.prototype.getLocalAnchorA = function() {
        return this.m_localAnchorA;
      };
      WeldJoint2.prototype.getLocalAnchorB = function() {
        return this.m_localAnchorB;
      };
      WeldJoint2.prototype.getReferenceAngle = function() {
        return this.m_referenceAngle;
      };
      WeldJoint2.prototype.setFrequency = function(hz) {
        this.m_frequencyHz = hz;
      };
      WeldJoint2.prototype.getFrequency = function() {
        return this.m_frequencyHz;
      };
      WeldJoint2.prototype.setDampingRatio = function(ratio) {
        this.m_dampingRatio = ratio;
      };
      WeldJoint2.prototype.getDampingRatio = function() {
        return this.m_dampingRatio;
      };
      WeldJoint2.prototype.getAnchorA = function() {
        return this.m_bodyA.getWorldPoint(this.m_localAnchorA);
      };
      WeldJoint2.prototype.getAnchorB = function() {
        return this.m_bodyB.getWorldPoint(this.m_localAnchorB);
      };
      WeldJoint2.prototype.getReactionForce = function(inv_dt) {
        return Vec2.neo(this.m_impulse.x, this.m_impulse.y).mul(inv_dt);
      };
      WeldJoint2.prototype.getReactionTorque = function(inv_dt) {
        return inv_dt * this.m_impulse.z;
      };
      WeldJoint2.prototype.initVelocityConstraints = function(step) {
        this.m_localCenterA = this.m_bodyA.m_sweep.localCenter;
        this.m_localCenterB = this.m_bodyB.m_sweep.localCenter;
        this.m_invMassA = this.m_bodyA.m_invMass;
        this.m_invMassB = this.m_bodyB.m_invMass;
        this.m_invIA = this.m_bodyA.m_invI;
        this.m_invIB = this.m_bodyB.m_invI;
        var aA = this.m_bodyA.c_position.a;
        var vA2 = this.m_bodyA.c_velocity.v;
        var wA = this.m_bodyA.c_velocity.w;
        var aB = this.m_bodyB.c_position.a;
        var vB2 = this.m_bodyB.c_velocity.v;
        var wB = this.m_bodyB.c_velocity.w;
        var qA = Rot.neo(aA);
        var qB = Rot.neo(aB);
        this.m_rA = Rot.mulVec2(qA, Vec2.sub(this.m_localAnchorA, this.m_localCenterA));
        this.m_rB = Rot.mulVec2(qB, Vec2.sub(this.m_localAnchorB, this.m_localCenterB));
        var mA = this.m_invMassA;
        var mB = this.m_invMassB;
        var iA = this.m_invIA;
        var iB = this.m_invIB;
        var K = new Mat33();
        K.ex.x = mA + mB + this.m_rA.y * this.m_rA.y * iA + this.m_rB.y * this.m_rB.y * iB;
        K.ey.x = -this.m_rA.y * this.m_rA.x * iA - this.m_rB.y * this.m_rB.x * iB;
        K.ez.x = -this.m_rA.y * iA - this.m_rB.y * iB;
        K.ex.y = K.ey.x;
        K.ey.y = mA + mB + this.m_rA.x * this.m_rA.x * iA + this.m_rB.x * this.m_rB.x * iB;
        K.ez.y = this.m_rA.x * iA + this.m_rB.x * iB;
        K.ex.z = K.ez.x;
        K.ey.z = K.ez.y;
        K.ez.z = iA + iB;
        if (this.m_frequencyHz > 0) {
          K.getInverse22(this.m_mass);
          var invM = iA + iB;
          var m = invM > 0 ? 1 / invM : 0;
          var C = aB - aA - this.m_referenceAngle;
          var omega = 2 * math_PI$1 * this.m_frequencyHz;
          var d2 = 2 * m * this.m_dampingRatio * omega;
          var k = m * omega * omega;
          var h = step.dt;
          this.m_gamma = h * (d2 + h * k);
          this.m_gamma = this.m_gamma != 0 ? 1 / this.m_gamma : 0;
          this.m_bias = C * h * k * this.m_gamma;
          invM += this.m_gamma;
          this.m_mass.ez.z = invM != 0 ? 1 / invM : 0;
        } else if (K.ez.z == 0) {
          K.getInverse22(this.m_mass);
          this.m_gamma = 0;
          this.m_bias = 0;
        } else {
          K.getSymInverse33(this.m_mass);
          this.m_gamma = 0;
          this.m_bias = 0;
        }
        if (step.warmStarting) {
          this.m_impulse.mul(step.dtRatio);
          var P3 = Vec2.neo(this.m_impulse.x, this.m_impulse.y);
          vA2.subMul(mA, P3);
          wA -= iA * (Vec2.crossVec2Vec2(this.m_rA, P3) + this.m_impulse.z);
          vB2.addMul(mB, P3);
          wB += iB * (Vec2.crossVec2Vec2(this.m_rB, P3) + this.m_impulse.z);
        } else {
          this.m_impulse.setZero();
        }
        this.m_bodyA.c_velocity.v = vA2;
        this.m_bodyA.c_velocity.w = wA;
        this.m_bodyB.c_velocity.v = vB2;
        this.m_bodyB.c_velocity.w = wB;
      };
      WeldJoint2.prototype.solveVelocityConstraints = function(step) {
        var vA2 = this.m_bodyA.c_velocity.v;
        var wA = this.m_bodyA.c_velocity.w;
        var vB2 = this.m_bodyB.c_velocity.v;
        var wB = this.m_bodyB.c_velocity.w;
        var mA = this.m_invMassA;
        var mB = this.m_invMassB;
        var iA = this.m_invIA;
        var iB = this.m_invIB;
        if (this.m_frequencyHz > 0) {
          var Cdot2 = wB - wA;
          var impulse2 = -this.m_mass.ez.z * (Cdot2 + this.m_bias + this.m_gamma * this.m_impulse.z);
          this.m_impulse.z += impulse2;
          wA -= iA * impulse2;
          wB += iB * impulse2;
          var Cdot1 = Vec2.zero();
          Cdot1.addCombine(1, vB2, 1, Vec2.crossNumVec2(wB, this.m_rB));
          Cdot1.subCombine(1, vA2, 1, Vec2.crossNumVec2(wA, this.m_rA));
          var impulse1 = Vec2.neg(Mat33.mulVec2(this.m_mass, Cdot1));
          this.m_impulse.x += impulse1.x;
          this.m_impulse.y += impulse1.y;
          var P3 = Vec2.clone(impulse1);
          vA2.subMul(mA, P3);
          wA -= iA * Vec2.crossVec2Vec2(this.m_rA, P3);
          vB2.addMul(mB, P3);
          wB += iB * Vec2.crossVec2Vec2(this.m_rB, P3);
        } else {
          var Cdot1 = Vec2.zero();
          Cdot1.addCombine(1, vB2, 1, Vec2.crossNumVec2(wB, this.m_rB));
          Cdot1.subCombine(1, vA2, 1, Vec2.crossNumVec2(wA, this.m_rA));
          var Cdot2 = wB - wA;
          var Cdot = new Vec3(Cdot1.x, Cdot1.y, Cdot2);
          var impulse = Vec3.neg(Mat33.mulVec3(this.m_mass, Cdot));
          this.m_impulse.add(impulse);
          var P3 = Vec2.neo(impulse.x, impulse.y);
          vA2.subMul(mA, P3);
          wA -= iA * (Vec2.crossVec2Vec2(this.m_rA, P3) + impulse.z);
          vB2.addMul(mB, P3);
          wB += iB * (Vec2.crossVec2Vec2(this.m_rB, P3) + impulse.z);
        }
        this.m_bodyA.c_velocity.v = vA2;
        this.m_bodyA.c_velocity.w = wA;
        this.m_bodyB.c_velocity.v = vB2;
        this.m_bodyB.c_velocity.w = wB;
      };
      WeldJoint2.prototype.solvePositionConstraints = function(step) {
        var cA2 = this.m_bodyA.c_position.c;
        var aA = this.m_bodyA.c_position.a;
        var cB2 = this.m_bodyB.c_position.c;
        var aB = this.m_bodyB.c_position.a;
        var qA = Rot.neo(aA);
        var qB = Rot.neo(aB);
        var mA = this.m_invMassA;
        var mB = this.m_invMassB;
        var iA = this.m_invIA;
        var iB = this.m_invIB;
        var rA2 = Rot.mulVec2(qA, Vec2.sub(this.m_localAnchorA, this.m_localCenterA));
        var rB2 = Rot.mulVec2(qB, Vec2.sub(this.m_localAnchorB, this.m_localCenterB));
        var positionError;
        var angularError;
        var K = new Mat33();
        K.ex.x = mA + mB + rA2.y * rA2.y * iA + rB2.y * rB2.y * iB;
        K.ey.x = -rA2.y * rA2.x * iA - rB2.y * rB2.x * iB;
        K.ez.x = -rA2.y * iA - rB2.y * iB;
        K.ex.y = K.ey.x;
        K.ey.y = mA + mB + rA2.x * rA2.x * iA + rB2.x * rB2.x * iB;
        K.ez.y = rA2.x * iA + rB2.x * iB;
        K.ex.z = K.ez.x;
        K.ey.z = K.ez.y;
        K.ez.z = iA + iB;
        if (this.m_frequencyHz > 0) {
          var C1 = Vec2.zero();
          C1.addCombine(1, cB2, 1, rB2);
          C1.subCombine(1, cA2, 1, rA2);
          positionError = C1.length();
          angularError = 0;
          var P3 = Vec2.neg(K.solve22(C1));
          cA2.subMul(mA, P3);
          aA -= iA * Vec2.crossVec2Vec2(rA2, P3);
          cB2.addMul(mB, P3);
          aB += iB * Vec2.crossVec2Vec2(rB2, P3);
        } else {
          var C1 = Vec2.zero();
          C1.addCombine(1, cB2, 1, rB2);
          C1.subCombine(1, cA2, 1, rA2);
          var C2 = aB - aA - this.m_referenceAngle;
          positionError = C1.length();
          angularError = math_abs$1(C2);
          var C = new Vec3(C1.x, C1.y, C2);
          var impulse = new Vec3();
          if (K.ez.z > 0) {
            impulse = Vec3.neg(K.solve33(C));
          } else {
            var impulse2 = Vec2.neg(K.solve22(C1));
            impulse.set(impulse2.x, impulse2.y, 0);
          }
          var P3 = Vec2.neo(impulse.x, impulse.y);
          cA2.subMul(mA, P3);
          aA -= iA * (Vec2.crossVec2Vec2(rA2, P3) + impulse.z);
          cB2.addMul(mB, P3);
          aB += iB * (Vec2.crossVec2Vec2(rB2, P3) + impulse.z);
        }
        this.m_bodyA.c_position.c = cA2;
        this.m_bodyA.c_position.a = aA;
        this.m_bodyB.c_position.c = cB2;
        this.m_bodyB.c_position.a = aB;
        return positionError <= SettingsInternal.linearSlop && angularError <= SettingsInternal.angularSlop;
      };
      WeldJoint2.TYPE = "weld-joint";
      return WeldJoint2;
    })(Joint)
  );
  var math_abs = Math.abs;
  var math_PI = Math.PI;
  var DEFAULTS = {
    enableMotor: false,
    maxMotorTorque: 0,
    motorSpeed: 0,
    frequencyHz: 2,
    dampingRatio: 0.7
  };
  var WheelJoint = (
    /** @class */
    (function(_super) {
      __extends(WheelJoint2, _super);
      function WheelJoint2(def, bodyA, bodyB, anchor, axis) {
        var _this = this;
        if (!(_this instanceof WheelJoint2)) {
          return new WheelJoint2(def, bodyA, bodyB, anchor, axis);
        }
        def = options(def, DEFAULTS);
        _this = _super.call(this, def, bodyA, bodyB) || this;
        bodyA = _this.m_bodyA;
        bodyB = _this.m_bodyB;
        _this.m_ax = Vec2.zero();
        _this.m_ay = Vec2.zero();
        _this.m_type = WheelJoint2.TYPE;
        _this.m_localAnchorA = Vec2.clone(anchor ? bodyA.getLocalPoint(anchor) : def.localAnchorA || Vec2.zero());
        _this.m_localAnchorB = Vec2.clone(anchor ? bodyB.getLocalPoint(anchor) : def.localAnchorB || Vec2.zero());
        if (Vec2.isValid(axis)) {
          _this.m_localXAxisA = bodyA.getLocalVector(axis);
        } else if (Vec2.isValid(def.localAxisA)) {
          _this.m_localXAxisA = Vec2.clone(def.localAxisA);
        } else if (Vec2.isValid(def.localAxis)) {
          _this.m_localXAxisA = Vec2.clone(def.localAxis);
        } else {
          _this.m_localXAxisA = Vec2.neo(1, 0);
        }
        _this.m_localYAxisA = Vec2.crossNumVec2(1, _this.m_localXAxisA);
        _this.m_mass = 0;
        _this.m_impulse = 0;
        _this.m_motorMass = 0;
        _this.m_motorImpulse = 0;
        _this.m_springMass = 0;
        _this.m_springImpulse = 0;
        _this.m_maxMotorTorque = def.maxMotorTorque;
        _this.m_motorSpeed = def.motorSpeed;
        _this.m_enableMotor = def.enableMotor;
        _this.m_frequencyHz = def.frequencyHz;
        _this.m_dampingRatio = def.dampingRatio;
        _this.m_bias = 0;
        _this.m_gamma = 0;
        return _this;
      }
      WheelJoint2.prototype._serialize = function() {
        return {
          type: this.m_type,
          bodyA: this.m_bodyA,
          bodyB: this.m_bodyB,
          collideConnected: this.m_collideConnected,
          enableMotor: this.m_enableMotor,
          maxMotorTorque: this.m_maxMotorTorque,
          motorSpeed: this.m_motorSpeed,
          frequencyHz: this.m_frequencyHz,
          dampingRatio: this.m_dampingRatio,
          localAnchorA: this.m_localAnchorA,
          localAnchorB: this.m_localAnchorB,
          localAxisA: this.m_localXAxisA
        };
      };
      WheelJoint2._deserialize = function(data, world, restore) {
        data = __assign({}, data);
        data.bodyA = restore(Body, data.bodyA, world);
        data.bodyB = restore(Body, data.bodyB, world);
        var joint = new WheelJoint2(data);
        return joint;
      };
      WheelJoint2.prototype._reset = function(def) {
        if (def.anchorA) {
          this.m_localAnchorA.setVec2(this.m_bodyA.getLocalPoint(def.anchorA));
        } else if (def.localAnchorA) {
          this.m_localAnchorA.setVec2(def.localAnchorA);
        }
        if (def.anchorB) {
          this.m_localAnchorB.setVec2(this.m_bodyB.getLocalPoint(def.anchorB));
        } else if (def.localAnchorB) {
          this.m_localAnchorB.setVec2(def.localAnchorB);
        }
        if (def.localAxisA) {
          this.m_localXAxisA.setVec2(def.localAxisA);
          this.m_localYAxisA.setVec2(Vec2.crossNumVec2(1, def.localAxisA));
        }
        if (def.enableMotor !== void 0) {
          this.m_enableMotor = def.enableMotor;
        }
        if (Number.isFinite(def.maxMotorTorque)) {
          this.m_maxMotorTorque = def.maxMotorTorque;
        }
        if (Number.isFinite(def.motorSpeed)) {
          this.m_motorSpeed = def.motorSpeed;
        }
        if (Number.isFinite(def.frequencyHz)) {
          this.m_frequencyHz = def.frequencyHz;
        }
        if (Number.isFinite(def.dampingRatio)) {
          this.m_dampingRatio = def.dampingRatio;
        }
      };
      WheelJoint2.prototype.getLocalAnchorA = function() {
        return this.m_localAnchorA;
      };
      WheelJoint2.prototype.getLocalAnchorB = function() {
        return this.m_localAnchorB;
      };
      WheelJoint2.prototype.getLocalAxisA = function() {
        return this.m_localXAxisA;
      };
      WheelJoint2.prototype.getJointTranslation = function() {
        var bA = this.m_bodyA;
        var bB = this.m_bodyB;
        var pA2 = bA.getWorldPoint(this.m_localAnchorA);
        var pB2 = bB.getWorldPoint(this.m_localAnchorB);
        var d2 = Vec2.sub(pB2, pA2);
        var axis = bA.getWorldVector(this.m_localXAxisA);
        var translation2 = Vec2.dot(d2, axis);
        return translation2;
      };
      WheelJoint2.prototype.getJointSpeed = function() {
        var wA = this.m_bodyA.m_angularVelocity;
        var wB = this.m_bodyB.m_angularVelocity;
        return wB - wA;
      };
      WheelJoint2.prototype.isMotorEnabled = function() {
        return this.m_enableMotor;
      };
      WheelJoint2.prototype.enableMotor = function(flag) {
        if (flag == this.m_enableMotor)
          return;
        this.m_bodyA.setAwake(true);
        this.m_bodyB.setAwake(true);
        this.m_enableMotor = flag;
      };
      WheelJoint2.prototype.setMotorSpeed = function(speed) {
        if (speed == this.m_motorSpeed)
          return;
        this.m_bodyA.setAwake(true);
        this.m_bodyB.setAwake(true);
        this.m_motorSpeed = speed;
      };
      WheelJoint2.prototype.getMotorSpeed = function() {
        return this.m_motorSpeed;
      };
      WheelJoint2.prototype.setMaxMotorTorque = function(torque) {
        if (torque == this.m_maxMotorTorque)
          return;
        this.m_bodyA.setAwake(true);
        this.m_bodyB.setAwake(true);
        this.m_maxMotorTorque = torque;
      };
      WheelJoint2.prototype.getMaxMotorTorque = function() {
        return this.m_maxMotorTorque;
      };
      WheelJoint2.prototype.getMotorTorque = function(inv_dt) {
        return inv_dt * this.m_motorImpulse;
      };
      WheelJoint2.prototype.setSpringFrequencyHz = function(hz) {
        this.m_frequencyHz = hz;
      };
      WheelJoint2.prototype.getSpringFrequencyHz = function() {
        return this.m_frequencyHz;
      };
      WheelJoint2.prototype.setSpringDampingRatio = function(ratio) {
        this.m_dampingRatio = ratio;
      };
      WheelJoint2.prototype.getSpringDampingRatio = function() {
        return this.m_dampingRatio;
      };
      WheelJoint2.prototype.getAnchorA = function() {
        return this.m_bodyA.getWorldPoint(this.m_localAnchorA);
      };
      WheelJoint2.prototype.getAnchorB = function() {
        return this.m_bodyB.getWorldPoint(this.m_localAnchorB);
      };
      WheelJoint2.prototype.getReactionForce = function(inv_dt) {
        return Vec2.combine(this.m_impulse, this.m_ay, this.m_springImpulse, this.m_ax).mul(inv_dt);
      };
      WheelJoint2.prototype.getReactionTorque = function(inv_dt) {
        return inv_dt * this.m_motorImpulse;
      };
      WheelJoint2.prototype.initVelocityConstraints = function(step) {
        this.m_localCenterA = this.m_bodyA.m_sweep.localCenter;
        this.m_localCenterB = this.m_bodyB.m_sweep.localCenter;
        this.m_invMassA = this.m_bodyA.m_invMass;
        this.m_invMassB = this.m_bodyB.m_invMass;
        this.m_invIA = this.m_bodyA.m_invI;
        this.m_invIB = this.m_bodyB.m_invI;
        var mA = this.m_invMassA;
        var mB = this.m_invMassB;
        var iA = this.m_invIA;
        var iB = this.m_invIB;
        var cA2 = this.m_bodyA.c_position.c;
        var aA = this.m_bodyA.c_position.a;
        var vA2 = this.m_bodyA.c_velocity.v;
        var wA = this.m_bodyA.c_velocity.w;
        var cB2 = this.m_bodyB.c_position.c;
        var aB = this.m_bodyB.c_position.a;
        var vB2 = this.m_bodyB.c_velocity.v;
        var wB = this.m_bodyB.c_velocity.w;
        var qA = Rot.neo(aA);
        var qB = Rot.neo(aB);
        var rA2 = Rot.mulVec2(qA, Vec2.sub(this.m_localAnchorA, this.m_localCenterA));
        var rB2 = Rot.mulVec2(qB, Vec2.sub(this.m_localAnchorB, this.m_localCenterB));
        var d2 = Vec2.zero();
        d2.addCombine(1, cB2, 1, rB2);
        d2.subCombine(1, cA2, 1, rA2);
        {
          this.m_ay = Rot.mulVec2(qA, this.m_localYAxisA);
          this.m_sAy = Vec2.crossVec2Vec2(Vec2.add(d2, rA2), this.m_ay);
          this.m_sBy = Vec2.crossVec2Vec2(rB2, this.m_ay);
          this.m_mass = mA + mB + iA * this.m_sAy * this.m_sAy + iB * this.m_sBy * this.m_sBy;
          if (this.m_mass > 0) {
            this.m_mass = 1 / this.m_mass;
          }
        }
        this.m_springMass = 0;
        this.m_bias = 0;
        this.m_gamma = 0;
        if (this.m_frequencyHz > 0) {
          this.m_ax = Rot.mulVec2(qA, this.m_localXAxisA);
          this.m_sAx = Vec2.crossVec2Vec2(Vec2.add(d2, rA2), this.m_ax);
          this.m_sBx = Vec2.crossVec2Vec2(rB2, this.m_ax);
          var invMass = mA + mB + iA * this.m_sAx * this.m_sAx + iB * this.m_sBx * this.m_sBx;
          if (invMass > 0) {
            this.m_springMass = 1 / invMass;
            var C = Vec2.dot(d2, this.m_ax);
            var omega = 2 * math_PI * this.m_frequencyHz;
            var damp = 2 * this.m_springMass * this.m_dampingRatio * omega;
            var k = this.m_springMass * omega * omega;
            var h = step.dt;
            this.m_gamma = h * (damp + h * k);
            if (this.m_gamma > 0) {
              this.m_gamma = 1 / this.m_gamma;
            }
            this.m_bias = C * h * k * this.m_gamma;
            this.m_springMass = invMass + this.m_gamma;
            if (this.m_springMass > 0) {
              this.m_springMass = 1 / this.m_springMass;
            }
          }
        } else {
          this.m_springImpulse = 0;
        }
        if (this.m_enableMotor) {
          this.m_motorMass = iA + iB;
          if (this.m_motorMass > 0) {
            this.m_motorMass = 1 / this.m_motorMass;
          }
        } else {
          this.m_motorMass = 0;
          this.m_motorImpulse = 0;
        }
        if (step.warmStarting) {
          this.m_impulse *= step.dtRatio;
          this.m_springImpulse *= step.dtRatio;
          this.m_motorImpulse *= step.dtRatio;
          var P3 = Vec2.combine(this.m_impulse, this.m_ay, this.m_springImpulse, this.m_ax);
          var LA = this.m_impulse * this.m_sAy + this.m_springImpulse * this.m_sAx + this.m_motorImpulse;
          var LB = this.m_impulse * this.m_sBy + this.m_springImpulse * this.m_sBx + this.m_motorImpulse;
          vA2.subMul(this.m_invMassA, P3);
          wA -= this.m_invIA * LA;
          vB2.addMul(this.m_invMassB, P3);
          wB += this.m_invIB * LB;
        } else {
          this.m_impulse = 0;
          this.m_springImpulse = 0;
          this.m_motorImpulse = 0;
        }
        this.m_bodyA.c_velocity.v.setVec2(vA2);
        this.m_bodyA.c_velocity.w = wA;
        this.m_bodyB.c_velocity.v.setVec2(vB2);
        this.m_bodyB.c_velocity.w = wB;
      };
      WheelJoint2.prototype.solveVelocityConstraints = function(step) {
        var mA = this.m_invMassA;
        var mB = this.m_invMassB;
        var iA = this.m_invIA;
        var iB = this.m_invIB;
        var vA2 = this.m_bodyA.c_velocity.v;
        var wA = this.m_bodyA.c_velocity.w;
        var vB2 = this.m_bodyB.c_velocity.v;
        var wB = this.m_bodyB.c_velocity.w;
        {
          var Cdot = Vec2.dot(this.m_ax, vB2) - Vec2.dot(this.m_ax, vA2) + this.m_sBx * wB - this.m_sAx * wA;
          var impulse = -this.m_springMass * (Cdot + this.m_bias + this.m_gamma * this.m_springImpulse);
          this.m_springImpulse += impulse;
          var P3 = Vec2.mulNumVec2(impulse, this.m_ax);
          var LA = impulse * this.m_sAx;
          var LB = impulse * this.m_sBx;
          vA2.subMul(mA, P3);
          wA -= iA * LA;
          vB2.addMul(mB, P3);
          wB += iB * LB;
        }
        {
          var Cdot = wB - wA - this.m_motorSpeed;
          var impulse = -this.m_motorMass * Cdot;
          var oldImpulse = this.m_motorImpulse;
          var maxImpulse = step.dt * this.m_maxMotorTorque;
          this.m_motorImpulse = clamp(this.m_motorImpulse + impulse, -maxImpulse, maxImpulse);
          impulse = this.m_motorImpulse - oldImpulse;
          wA -= iA * impulse;
          wB += iB * impulse;
        }
        {
          var Cdot = Vec2.dot(this.m_ay, vB2) - Vec2.dot(this.m_ay, vA2) + this.m_sBy * wB - this.m_sAy * wA;
          var impulse = -this.m_mass * Cdot;
          this.m_impulse += impulse;
          var P3 = Vec2.mulNumVec2(impulse, this.m_ay);
          var LA = impulse * this.m_sAy;
          var LB = impulse * this.m_sBy;
          vA2.subMul(mA, P3);
          wA -= iA * LA;
          vB2.addMul(mB, P3);
          wB += iB * LB;
        }
        this.m_bodyA.c_velocity.v.setVec2(vA2);
        this.m_bodyA.c_velocity.w = wA;
        this.m_bodyB.c_velocity.v.setVec2(vB2);
        this.m_bodyB.c_velocity.w = wB;
      };
      WheelJoint2.prototype.solvePositionConstraints = function(step) {
        var cA2 = this.m_bodyA.c_position.c;
        var aA = this.m_bodyA.c_position.a;
        var cB2 = this.m_bodyB.c_position.c;
        var aB = this.m_bodyB.c_position.a;
        var qA = Rot.neo(aA);
        var qB = Rot.neo(aB);
        var rA2 = Rot.mulVec2(qA, Vec2.sub(this.m_localAnchorA, this.m_localCenterA));
        var rB2 = Rot.mulVec2(qB, Vec2.sub(this.m_localAnchorB, this.m_localCenterB));
        var d2 = Vec2.zero();
        d2.addCombine(1, cB2, 1, rB2);
        d2.subCombine(1, cA2, 1, rA2);
        var ay = Rot.mulVec2(qA, this.m_localYAxisA);
        var sAy = Vec2.crossVec2Vec2(Vec2.add(d2, rA2), ay);
        var sBy = Vec2.crossVec2Vec2(rB2, ay);
        var C = Vec2.dot(d2, ay);
        var k = this.m_invMassA + this.m_invMassB + this.m_invIA * this.m_sAy * this.m_sAy + this.m_invIB * this.m_sBy * this.m_sBy;
        var impulse = k != 0 ? -C / k : 0;
        var P3 = Vec2.mulNumVec2(impulse, ay);
        var LA = impulse * sAy;
        var LB = impulse * sBy;
        cA2.subMul(this.m_invMassA, P3);
        aA -= this.m_invIA * LA;
        cB2.addMul(this.m_invMassB, P3);
        aB += this.m_invIB * LB;
        this.m_bodyA.c_position.c.setVec2(cA2);
        this.m_bodyA.c_position.a = aA;
        this.m_bodyB.c_position.c.setVec2(cB2);
        this.m_bodyB.c_position.a = aB;
        return math_abs(C) <= SettingsInternal.linearSlop;
      };
      WheelJoint2.TYPE = "wheel-joint";
      return WheelJoint2;
    })(Joint)
  );
  var _a;
  var SID = 0;
  var SERIALIZE_REF_TYPES = {
    "World": World,
    "Body": Body,
    "Joint": Joint,
    "Fixture": Fixture,
    "Shape": Shape
  };
  var DESERIALIZE_BY_REF_TYPE = {
    "Vec2": Vec2,
    "Vec3": Vec3,
    "World": World,
    "Body": Body,
    "Joint": Joint,
    "Fixture": Fixture,
    "Shape": Shape
  };
  var DESERIALIZE_BY_TYPE_FIELD = (_a = {}, _a[Body.STATIC] = Body, _a[Body.DYNAMIC] = Body, _a[Body.KINEMATIC] = Body, _a[ChainShape.TYPE] = ChainShape, // [BoxShape.TYPE]: BoxShape,
  _a[PolygonShape.TYPE] = PolygonShape, _a[EdgeShape.TYPE] = EdgeShape, _a[CircleShape.TYPE] = CircleShape, _a[DistanceJoint.TYPE] = DistanceJoint, _a[FrictionJoint.TYPE] = FrictionJoint, _a[GearJoint.TYPE] = GearJoint, _a[MotorJoint.TYPE] = MotorJoint, _a[MouseJoint.TYPE] = MouseJoint, _a[PrismaticJoint.TYPE] = PrismaticJoint, _a[PulleyJoint.TYPE] = PulleyJoint, _a[RevoluteJoint.TYPE] = RevoluteJoint, _a[RopeJoint.TYPE] = RopeJoint, _a[WeldJoint.TYPE] = WeldJoint, _a[WheelJoint.TYPE] = WheelJoint, _a);
  var DEFAULT_OPTIONS = {
    rootClass: World,
    preSerialize: function(obj) {
      return obj;
    },
    postSerialize: function(data, obj) {
      return data;
    },
    preDeserialize: function(data) {
      return data;
    },
    postDeserialize: function(obj, data) {
      return obj;
    }
  };
  var Serializer = (
    /** @class */
    /* @__PURE__ */ (function() {
      function Serializer2(options2) {
        var _this = this;
        this.toJson = function(root) {
          var preSerialize = _this.options.preSerialize;
          var postSerialize = _this.options.postSerialize;
          var json = [];
          var refQueue = [root];
          var refMemoById = {};
          function addToRefQueue(value, typeName) {
            value.__sid = value.__sid || ++SID;
            if (!refMemoById[value.__sid]) {
              refQueue.push(value);
              var index = json.length + refQueue.length;
              var ref = {
                refIndex: index,
                refType: typeName
              };
              refMemoById[value.__sid] = ref;
            }
            return refMemoById[value.__sid];
          }
          function serializeWithHooks(obj2) {
            obj2 = preSerialize(obj2);
            var data = obj2._serialize();
            data = postSerialize(data, obj2);
            return data;
          }
          function traverse(value, noRefType) {
            if (noRefType === void 0) {
              noRefType = false;
            }
            if (typeof value !== "object" || value === null) {
              return value;
            }
            if (typeof value._serialize === "function") {
              if (!noRefType) {
                for (var typeName in SERIALIZE_REF_TYPES) {
                  if (value instanceof SERIALIZE_REF_TYPES[typeName]) {
                    return addToRefQueue(value, typeName);
                  }
                }
              }
              value = serializeWithHooks(value);
            }
            if (Array.isArray(value)) {
              var newValue = [];
              for (var key = 0; key < value.length; key++) {
                newValue[key] = traverse(value[key]);
              }
              value = newValue;
            } else {
              var newValue = {};
              for (var key in value) {
                if (value.hasOwnProperty(key)) {
                  newValue[key] = traverse(value[key]);
                }
              }
              value = newValue;
            }
            return value;
          }
          while (refQueue.length) {
            var obj = refQueue.shift();
            var str = traverse(obj, true);
            json.push(str);
          }
          return json;
        };
        this.fromJson = function(json) {
          var preDeserialize = _this.options.preDeserialize;
          var postDeserialize = _this.options.postDeserialize;
          var rootClass = _this.options.rootClass;
          var deserializedRefMemoByIndex = {};
          function deserializeWithHooks(classHint, data, context) {
            if (!classHint || !classHint._deserialize) {
              classHint = DESERIALIZE_BY_TYPE_FIELD[data.type];
            }
            var deserializer = classHint && classHint._deserialize;
            if (!deserializer) {
              return;
            }
            data = preDeserialize(data);
            var classDeserializeFn = classHint._deserialize;
            var obj = classDeserializeFn(data, context, deserializeChild);
            obj = postDeserialize(obj, data);
            return obj;
          }
          function deserializeChild(classHint, dataOrRef, context) {
            var isRefObject = dataOrRef.refIndex && dataOrRef.refType;
            if (!isRefObject) {
              return deserializeWithHooks(classHint, dataOrRef, context);
            }
            var ref = dataOrRef;
            if (DESERIALIZE_BY_REF_TYPE[ref.refType]) {
              classHint = DESERIALIZE_BY_REF_TYPE[ref.refType];
            }
            var refIndex = ref.refIndex;
            if (!deserializedRefMemoByIndex[refIndex]) {
              var data = json[refIndex];
              var obj = deserializeWithHooks(classHint, data, context);
              deserializedRefMemoByIndex[refIndex] = obj;
            }
            return deserializedRefMemoByIndex[refIndex];
          }
          var root = deserializeWithHooks(rootClass, json[0], null);
          return root;
        };
        this.options = __assign(__assign({}, DEFAULT_OPTIONS), options2);
      }
      return Serializer2;
    })()
  );
  var worldSerializer = new Serializer({
    rootClass: World
  });
  Serializer.fromJson = worldSerializer.fromJson;
  Serializer.toJson = worldSerializer.toJson;
  var Testbed = (
    /** @class */
    (function() {
      function Testbed2() {
      }
      Testbed2.mount = function(options2) {
        throw new Error("Not implemented");
      };
      Testbed2.start = function(world) {
        var testbed2 = Testbed2.mount();
        testbed2.start(world);
        return testbed2;
      };
      return Testbed2;
    })()
  );
  function testbed(a2, b2) {
    var callback;
    var options2;
    if (typeof a2 === "function") {
      callback = a2;
      options2 = b2;
    } else if (typeof b2 === "function") {
      callback = b2;
      options2 = a2;
    } else {
      options2 = a2 !== null && a2 !== void 0 ? a2 : b2;
    }
    var testbed2 = Testbed.mount(options2);
    if (callback) {
      var world = callback(testbed2) || testbed2.world;
      testbed2.start(world);
    } else {
      return testbed2;
    }
  }
  var BoxShape = (
    /** @class */
    (function(_super) {
      __extends(BoxShape2, _super);
      function BoxShape2(halfWidth, halfHeight, center2, angle) {
        var _this = this;
        if (!(_this instanceof BoxShape2)) {
          return new BoxShape2(halfWidth, halfHeight, center2, angle);
        }
        _this = _super.call(this) || this;
        _this._setAsBox(halfWidth, halfHeight, center2, angle);
        return _this;
      }
      BoxShape2.TYPE = "polygon";
      return BoxShape2;
    })(PolygonShape)
  );
  Contact.addType(CircleShape.TYPE, CircleShape.TYPE, CircleCircleContact);
  function CircleCircleContact(manifold, xfA2, fixtureA, indexA, xfB2, fixtureB, indexB) {
    CollideCircles(manifold, fixtureA.getShape(), xfA2, fixtureB.getShape(), xfB2);
  }
  var pA = vec2(0, 0);
  var pB = vec2(0, 0);
  var CollideCircles = function(manifold, circleA, xfA2, circleB, xfB2) {
    manifold.pointCount = 0;
    transformVec2(pA, xfA2, circleA.m_p);
    transformVec2(pB, xfB2, circleB.m_p);
    var distSqr = distSqrVec2(pB, pA);
    var rA2 = circleA.m_radius;
    var rB2 = circleB.m_radius;
    var radius = rA2 + rB2;
    if (distSqr > radius * radius) {
      return;
    }
    manifold.type = exports2.ManifoldType.e_circles;
    copyVec2(manifold.localPoint, circleA.m_p);
    zeroVec2(manifold.localNormal);
    manifold.pointCount = 1;
    copyVec2(manifold.points[0].localPoint, circleB.m_p);
    manifold.points[0].id.setFeatures(0, exports2.ContactFeatureType.e_vertex, 0, exports2.ContactFeatureType.e_vertex);
  };
  Contact.addType(EdgeShape.TYPE, CircleShape.TYPE, EdgeCircleContact);
  Contact.addType(ChainShape.TYPE, CircleShape.TYPE, ChainCircleContact);
  function EdgeCircleContact(manifold, xfA2, fixtureA, indexA, xfB2, fixtureB, indexB) {
    var shapeA = fixtureA.getShape();
    var shapeB = fixtureB.getShape();
    CollideEdgeCircle(manifold, shapeA, xfA2, shapeB, xfB2);
  }
  function ChainCircleContact(manifold, xfA2, fixtureA, indexA, xfB2, fixtureB, indexB) {
    var chain = fixtureA.getShape();
    var edge = new EdgeShape();
    chain.getChildEdge(edge, indexA);
    var shapeA = edge;
    var shapeB = fixtureB.getShape();
    CollideEdgeCircle(manifold, shapeA, xfA2, shapeB, xfB2);
  }
  var e = vec2(0, 0);
  var e1 = vec2(0, 0);
  var e2 = vec2(0, 0);
  var Q = vec2(0, 0);
  var P = vec2(0, 0);
  var n$2 = vec2(0, 0);
  var CollideEdgeCircle = function(manifold, edgeA, xfA2, circleB, xfB2) {
    manifold.pointCount = 0;
    retransformVec2(Q, xfB2, xfA2, circleB.m_p);
    var A = edgeA.m_vertex1;
    var B = edgeA.m_vertex2;
    subVec2(e, B, A);
    var u = dotVec2(e, B) - dotVec2(e, Q);
    var v3 = dotVec2(e, Q) - dotVec2(e, A);
    var radius = edgeA.m_radius + circleB.m_radius;
    if (v3 <= 0) {
      copyVec2(P, A);
      var dd_1 = distSqrVec2(Q, A);
      if (dd_1 > radius * radius) {
        return;
      }
      if (edgeA.m_hasVertex0) {
        var A1 = edgeA.m_vertex0;
        var B1 = A;
        subVec2(e1, B1, A1);
        var u1 = dotVec2(e1, B1) - dotVec2(e1, Q);
        if (u1 > 0) {
          return;
        }
      }
      manifold.type = exports2.ManifoldType.e_circles;
      zeroVec2(manifold.localNormal);
      copyVec2(manifold.localPoint, P);
      manifold.pointCount = 1;
      copyVec2(manifold.points[0].localPoint, circleB.m_p);
      manifold.points[0].id.setFeatures(0, exports2.ContactFeatureType.e_vertex, 0, exports2.ContactFeatureType.e_vertex);
      return;
    }
    if (u <= 0) {
      copyVec2(P, B);
      var dd_2 = distSqrVec2(Q, P);
      if (dd_2 > radius * radius) {
        return;
      }
      if (edgeA.m_hasVertex3) {
        var B2 = edgeA.m_vertex3;
        var A2 = B;
        subVec2(e2, B2, A2);
        var v22 = dotVec2(e2, Q) - dotVec2(e2, A2);
        if (v22 > 0) {
          return;
        }
      }
      manifold.type = exports2.ManifoldType.e_circles;
      zeroVec2(manifold.localNormal);
      copyVec2(manifold.localPoint, P);
      manifold.pointCount = 1;
      copyVec2(manifold.points[0].localPoint, circleB.m_p);
      manifold.points[0].id.setFeatures(1, exports2.ContactFeatureType.e_vertex, 0, exports2.ContactFeatureType.e_vertex);
      return;
    }
    var den = lengthSqrVec2(e);
    combine2Vec2(P, u / den, A, v3 / den, B);
    var dd = distSqrVec2(Q, P);
    if (dd > radius * radius) {
      return;
    }
    crossNumVec2(n$2, 1, e);
    if (dotVec2(n$2, Q) - dotVec2(n$2, A) < 0) {
      negVec2(n$2);
    }
    normalizeVec2(n$2);
    manifold.type = exports2.ManifoldType.e_faceA;
    copyVec2(manifold.localNormal, n$2);
    copyVec2(manifold.localPoint, A);
    manifold.pointCount = 1;
    copyVec2(manifold.points[0].localPoint, circleB.m_p);
    manifold.points[0].id.setFeatures(0, exports2.ContactFeatureType.e_face, 0, exports2.ContactFeatureType.e_vertex);
  };
  var incidentEdge = [new ClipVertex(), new ClipVertex()];
  var clipPoints1$1 = [new ClipVertex(), new ClipVertex()];
  var clipPoints2$1 = [new ClipVertex(), new ClipVertex()];
  var clipSegmentToLineNormal = vec2(0, 0);
  var v1 = vec2(0, 0);
  var n$1 = vec2(0, 0);
  var xf$1 = transform(0, 0, 0);
  var v11 = vec2(0, 0);
  var v12 = vec2(0, 0);
  var localTangent = vec2(0, 0);
  var localNormal = vec2(0, 0);
  var planePoint = vec2(0, 0);
  var tangent = vec2(0, 0);
  var normal$1 = vec2(0, 0);
  var normal1$1 = vec2(0, 0);
  Contact.addType(PolygonShape.TYPE, PolygonShape.TYPE, PolygonContact);
  function PolygonContact(manifold, xfA2, fixtureA, indexA, xfB2, fixtureB, indexB) {
    CollidePolygons(manifold, fixtureA.getShape(), xfA2, fixtureB.getShape(), xfB2);
  }
  function findMaxSeparation(poly1, xf1, poly2, xf2, output2) {
    var count1 = poly1.m_count;
    var count2 = poly2.m_count;
    var n1s = poly1.m_normals;
    var v1s = poly1.m_vertices;
    var v2s = poly2.m_vertices;
    detransformTransform(xf$1, xf2, xf1);
    var bestIndex = 0;
    var maxSeparation2 = -Infinity;
    for (var i = 0; i < count1; ++i) {
      rotVec2(n$1, xf$1.q, n1s[i]);
      transformVec2(v1, xf$1, v1s[i]);
      var si = Infinity;
      for (var j = 0; j < count2; ++j) {
        var sij = dotVec2(n$1, v2s[j]) - dotVec2(n$1, v1);
        if (sij < si) {
          si = sij;
        }
      }
      if (si > maxSeparation2) {
        maxSeparation2 = si;
        bestIndex = i;
      }
    }
    output2.maxSeparation = maxSeparation2;
    output2.bestIndex = bestIndex;
  }
  function findIncidentEdge(clipVertex, poly1, xf1, edge12, poly2, xf2) {
    var normals1 = poly1.m_normals;
    var count2 = poly2.m_count;
    var vertices2 = poly2.m_vertices;
    var normals2 = poly2.m_normals;
    rerotVec2(normal1$1, xf2.q, xf1.q, normals1[edge12]);
    var index = 0;
    var minDot = Infinity;
    for (var i = 0; i < count2; ++i) {
      var dot = dotVec2(normal1$1, normals2[i]);
      if (dot < minDot) {
        minDot = dot;
        index = i;
      }
    }
    var i1 = index;
    var i2 = i1 + 1 < count2 ? i1 + 1 : 0;
    transformVec2(clipVertex[0].v, xf2, vertices2[i1]);
    clipVertex[0].id.setFeatures(edge12, exports2.ContactFeatureType.e_face, i1, exports2.ContactFeatureType.e_vertex);
    transformVec2(clipVertex[1].v, xf2, vertices2[i2]);
    clipVertex[1].id.setFeatures(edge12, exports2.ContactFeatureType.e_face, i2, exports2.ContactFeatureType.e_vertex);
  }
  var maxSeparation = {
    maxSeparation: 0,
    bestIndex: 0
  };
  var CollidePolygons = function(manifold, polyA, xfA2, polyB, xfB2) {
    manifold.pointCount = 0;
    var totalRadius = polyA.m_radius + polyB.m_radius;
    findMaxSeparation(polyA, xfA2, polyB, xfB2, maxSeparation);
    var edgeA = maxSeparation.bestIndex;
    var separationA = maxSeparation.maxSeparation;
    if (separationA > totalRadius)
      return;
    findMaxSeparation(polyB, xfB2, polyA, xfA2, maxSeparation);
    var edgeB = maxSeparation.bestIndex;
    var separationB = maxSeparation.maxSeparation;
    if (separationB > totalRadius)
      return;
    var poly1;
    var poly2;
    var xf1;
    var xf2;
    var edge12;
    var flip;
    var k_tol = 0.1 * SettingsInternal.linearSlop;
    if (separationB > separationA + k_tol) {
      poly1 = polyB;
      poly2 = polyA;
      xf1 = xfB2;
      xf2 = xfA2;
      edge12 = edgeB;
      manifold.type = exports2.ManifoldType.e_faceB;
      flip = true;
    } else {
      poly1 = polyA;
      poly2 = polyB;
      xf1 = xfA2;
      xf2 = xfB2;
      edge12 = edgeA;
      manifold.type = exports2.ManifoldType.e_faceA;
      flip = false;
    }
    incidentEdge[0].recycle();
    incidentEdge[1].recycle();
    findIncidentEdge(incidentEdge, poly1, xf1, edge12, poly2, xf2);
    var count1 = poly1.m_count;
    var vertices1 = poly1.m_vertices;
    var iv1 = edge12;
    var iv2 = edge12 + 1 < count1 ? edge12 + 1 : 0;
    copyVec2(v11, vertices1[iv1]);
    copyVec2(v12, vertices1[iv2]);
    subVec2(localTangent, v12, v11);
    normalizeVec2(localTangent);
    crossVec2Num(localNormal, localTangent, 1);
    combine2Vec2(planePoint, 0.5, v11, 0.5, v12);
    rotVec2(tangent, xf1.q, localTangent);
    crossVec2Num(normal$1, tangent, 1);
    transformVec2(v11, xf1, v11);
    transformVec2(v12, xf1, v12);
    var frontOffset = dotVec2(normal$1, v11);
    var sideOffset1 = -dotVec2(tangent, v11) + totalRadius;
    var sideOffset2 = dotVec2(tangent, v12) + totalRadius;
    clipPoints1$1[0].recycle();
    clipPoints1$1[1].recycle();
    clipPoints2$1[0].recycle();
    clipPoints2$1[1].recycle();
    setVec2(clipSegmentToLineNormal, -tangent.x, -tangent.y);
    var np1 = clipSegmentToLine(clipPoints1$1, incidentEdge, clipSegmentToLineNormal, sideOffset1, iv1);
    if (np1 < 2) {
      return;
    }
    setVec2(clipSegmentToLineNormal, tangent.x, tangent.y);
    var np2 = clipSegmentToLine(clipPoints2$1, clipPoints1$1, clipSegmentToLineNormal, sideOffset2, iv2);
    if (np2 < 2) {
      return;
    }
    copyVec2(manifold.localNormal, localNormal);
    copyVec2(manifold.localPoint, planePoint);
    var pointCount = 0;
    for (var i = 0; i < clipPoints2$1.length; ++i) {
      var separation = dotVec2(normal$1, clipPoints2$1[i].v) - frontOffset;
      if (separation <= totalRadius) {
        var cp = manifold.points[pointCount];
        detransformVec2(cp.localPoint, xf2, clipPoints2$1[i].v);
        cp.id.set(clipPoints2$1[i].id);
        if (flip) {
          cp.id.swapFeatures();
        }
        ++pointCount;
      }
    }
    manifold.pointCount = pointCount;
  };
  Contact.addType(PolygonShape.TYPE, CircleShape.TYPE, PolygonCircleContact);
  function PolygonCircleContact(manifold, xfA2, fixtureA, indexA, xfB2, fixtureB, indexB) {
    CollidePolygonCircle(manifold, fixtureA.getShape(), xfA2, fixtureB.getShape(), xfB2);
  }
  var cLocal = vec2(0, 0);
  var faceCenter = vec2(0, 0);
  var CollidePolygonCircle = function(manifold, polygonA, xfA2, circleB, xfB2) {
    manifold.pointCount = 0;
    retransformVec2(cLocal, xfB2, xfA2, circleB.m_p);
    var normalIndex = 0;
    var separation = -Infinity;
    var radius = polygonA.m_radius + circleB.m_radius;
    var vertexCount = polygonA.m_count;
    var vertices = polygonA.m_vertices;
    var normals = polygonA.m_normals;
    for (var i = 0; i < vertexCount; ++i) {
      var s2 = dotVec2(normals[i], cLocal) - dotVec2(normals[i], vertices[i]);
      if (s2 > radius) {
        return;
      }
      if (s2 > separation) {
        separation = s2;
        normalIndex = i;
      }
    }
    var vertIndex1 = normalIndex;
    var vertIndex2 = vertIndex1 + 1 < vertexCount ? vertIndex1 + 1 : 0;
    var v13 = vertices[vertIndex1];
    var v22 = vertices[vertIndex2];
    if (separation < EPSILON) {
      manifold.pointCount = 1;
      manifold.type = exports2.ManifoldType.e_faceA;
      copyVec2(manifold.localNormal, normals[normalIndex]);
      combine2Vec2(manifold.localPoint, 0.5, v13, 0.5, v22);
      copyVec2(manifold.points[0].localPoint, circleB.m_p);
      manifold.points[0].id.setFeatures(0, exports2.ContactFeatureType.e_vertex, 0, exports2.ContactFeatureType.e_vertex);
      return;
    }
    var u1 = dotVec2(cLocal, v22) - dotVec2(cLocal, v13) - dotVec2(v13, v22) + dotVec2(v13, v13);
    var u2 = dotVec2(cLocal, v13) - dotVec2(cLocal, v22) - dotVec2(v22, v13) + dotVec2(v22, v22);
    if (u1 <= 0) {
      if (distSqrVec2(cLocal, v13) > radius * radius) {
        return;
      }
      manifold.pointCount = 1;
      manifold.type = exports2.ManifoldType.e_faceA;
      subVec2(manifold.localNormal, cLocal, v13);
      normalizeVec2(manifold.localNormal);
      copyVec2(manifold.localPoint, v13);
      copyVec2(manifold.points[0].localPoint, circleB.m_p);
      manifold.points[0].id.setFeatures(0, exports2.ContactFeatureType.e_vertex, 0, exports2.ContactFeatureType.e_vertex);
    } else if (u2 <= 0) {
      if (distSqrVec2(cLocal, v22) > radius * radius) {
        return;
      }
      manifold.pointCount = 1;
      manifold.type = exports2.ManifoldType.e_faceA;
      subVec2(manifold.localNormal, cLocal, v22);
      normalizeVec2(manifold.localNormal);
      copyVec2(manifold.localPoint, v22);
      copyVec2(manifold.points[0].localPoint, circleB.m_p);
      manifold.points[0].id.setFeatures(0, exports2.ContactFeatureType.e_vertex, 0, exports2.ContactFeatureType.e_vertex);
    } else {
      combine2Vec2(faceCenter, 0.5, v13, 0.5, v22);
      var separation_1 = dotVec2(cLocal, normals[vertIndex1]) - dotVec2(faceCenter, normals[vertIndex1]);
      if (separation_1 > radius) {
        return;
      }
      manifold.pointCount = 1;
      manifold.type = exports2.ManifoldType.e_faceA;
      copyVec2(manifold.localNormal, normals[vertIndex1]);
      copyVec2(manifold.localPoint, faceCenter);
      copyVec2(manifold.points[0].localPoint, circleB.m_p);
      manifold.points[0].id.setFeatures(0, exports2.ContactFeatureType.e_vertex, 0, exports2.ContactFeatureType.e_vertex);
    }
  };
  var math_min = Math.min;
  Contact.addType(EdgeShape.TYPE, PolygonShape.TYPE, EdgePolygonContact);
  Contact.addType(ChainShape.TYPE, PolygonShape.TYPE, ChainPolygonContact);
  function EdgePolygonContact(manifold, xfA2, fA, indexA, xfB2, fB, indexB) {
    CollideEdgePolygon(manifold, fA.getShape(), xfA2, fB.getShape(), xfB2);
  }
  var edge_reuse = new EdgeShape();
  function ChainPolygonContact(manifold, xfA2, fA, indexA, xfB2, fB, indexB) {
    var chain = fA.getShape();
    chain.getChildEdge(edge_reuse, indexA);
    CollideEdgePolygon(manifold, edge_reuse, xfA2, fB.getShape(), xfB2);
  }
  var EPAxisType;
  (function(EPAxisType2) {
    EPAxisType2[EPAxisType2["e_unknown"] = -1] = "e_unknown";
    EPAxisType2[EPAxisType2["e_edgeA"] = 1] = "e_edgeA";
    EPAxisType2[EPAxisType2["e_edgeB"] = 2] = "e_edgeB";
  })(EPAxisType || (EPAxisType = {}));
  var VertexType;
  (function(VertexType2) {
    VertexType2[VertexType2["e_isolated"] = 0] = "e_isolated";
    VertexType2[VertexType2["e_concave"] = 1] = "e_concave";
    VertexType2[VertexType2["e_convex"] = 2] = "e_convex";
  })(VertexType || (VertexType = {}));
  var EPAxis = (
    /** @class */
    /* @__PURE__ */ (function() {
      function EPAxis2() {
      }
      return EPAxis2;
    })()
  );
  var TempPolygon = (
    /** @class */
    /* @__PURE__ */ (function() {
      function TempPolygon2() {
        this.vertices = [];
        this.normals = [];
        this.count = 0;
        for (var i = 0; i < SettingsInternal.maxPolygonVertices; i++) {
          this.vertices.push(vec2(0, 0));
          this.normals.push(vec2(0, 0));
        }
      }
      return TempPolygon2;
    })()
  );
  var ReferenceFace = (
    /** @class */
    (function() {
      function ReferenceFace2() {
        this.v1 = vec2(0, 0);
        this.v2 = vec2(0, 0);
        this.normal = vec2(0, 0);
        this.sideNormal1 = vec2(0, 0);
        this.sideNormal2 = vec2(0, 0);
      }
      ReferenceFace2.prototype.recycle = function() {
        zeroVec2(this.v1);
        zeroVec2(this.v2);
        zeroVec2(this.normal);
        zeroVec2(this.sideNormal1);
        zeroVec2(this.sideNormal2);
      };
      return ReferenceFace2;
    })()
  );
  var clipPoints1 = [new ClipVertex(), new ClipVertex()];
  var clipPoints2 = [new ClipVertex(), new ClipVertex()];
  var ie = [new ClipVertex(), new ClipVertex()];
  var edgeAxis = new EPAxis();
  var polygonAxis = new EPAxis();
  var polygonBA = new TempPolygon();
  var rf = new ReferenceFace();
  var centroidB = vec2(0, 0);
  var edge0 = vec2(0, 0);
  var edge1 = vec2(0, 0);
  var edge2 = vec2(0, 0);
  var xf = transform(0, 0, 0);
  var normal = vec2(0, 0);
  var normal0 = vec2(0, 0);
  var normal1 = vec2(0, 0);
  var normal2 = vec2(0, 0);
  var lowerLimit = vec2(0, 0);
  var upperLimit = vec2(0, 0);
  var perp = vec2(0, 0);
  var n = vec2(0, 0);
  var CollideEdgePolygon = function(manifold, edgeA, xfA2, polygonB, xfB2) {
    detransformTransform(xf, xfA2, xfB2);
    transformVec2(centroidB, xf, polygonB.m_centroid);
    var v0 = edgeA.m_vertex0;
    var v13 = edgeA.m_vertex1;
    var v22 = edgeA.m_vertex2;
    var v3 = edgeA.m_vertex3;
    var hasVertex0 = edgeA.m_hasVertex0;
    var hasVertex3 = edgeA.m_hasVertex3;
    subVec2(edge1, v22, v13);
    normalizeVec2(edge1);
    setVec2(normal1, edge1.y, -edge1.x);
    var offset1 = dotVec2(normal1, centroidB) - dotVec2(normal1, v13);
    var offset0 = 0;
    var offset2 = 0;
    var convex1 = false;
    var convex2 = false;
    zeroVec2(normal0);
    zeroVec2(normal2);
    if (hasVertex0) {
      subVec2(edge0, v13, v0);
      normalizeVec2(edge0);
      setVec2(normal0, edge0.y, -edge0.x);
      convex1 = crossVec2Vec2(edge0, edge1) >= 0;
      offset0 = Vec2.dot(normal0, centroidB) - Vec2.dot(normal0, v0);
    }
    if (hasVertex3) {
      subVec2(edge2, v3, v22);
      normalizeVec2(edge2);
      setVec2(normal2, edge2.y, -edge2.x);
      convex2 = Vec2.crossVec2Vec2(edge1, edge2) > 0;
      offset2 = Vec2.dot(normal2, centroidB) - Vec2.dot(normal2, v22);
    }
    var front;
    zeroVec2(normal);
    zeroVec2(lowerLimit);
    zeroVec2(upperLimit);
    if (hasVertex0 && hasVertex3) {
      if (convex1 && convex2) {
        front = offset0 >= 0 || offset1 >= 0 || offset2 >= 0;
        if (front) {
          copyVec2(normal, normal1);
          copyVec2(lowerLimit, normal0);
          copyVec2(upperLimit, normal2);
        } else {
          scaleVec2(normal, -1, normal1);
          scaleVec2(lowerLimit, -1, normal1);
          scaleVec2(upperLimit, -1, normal1);
        }
      } else if (convex1) {
        front = offset0 >= 0 || offset1 >= 0 && offset2 >= 0;
        if (front) {
          copyVec2(normal, normal1);
          copyVec2(lowerLimit, normal0);
          copyVec2(upperLimit, normal1);
        } else {
          scaleVec2(normal, -1, normal1);
          scaleVec2(lowerLimit, -1, normal2);
          scaleVec2(upperLimit, -1, normal1);
        }
      } else if (convex2) {
        front = offset2 >= 0 || offset0 >= 0 && offset1 >= 0;
        if (front) {
          copyVec2(normal, normal1);
          copyVec2(lowerLimit, normal1);
          copyVec2(upperLimit, normal2);
        } else {
          scaleVec2(normal, -1, normal1);
          scaleVec2(lowerLimit, -1, normal1);
          scaleVec2(upperLimit, -1, normal0);
        }
      } else {
        front = offset0 >= 0 && offset1 >= 0 && offset2 >= 0;
        if (front) {
          copyVec2(normal, normal1);
          copyVec2(lowerLimit, normal1);
          copyVec2(upperLimit, normal1);
        } else {
          scaleVec2(normal, -1, normal1);
          scaleVec2(lowerLimit, -1, normal2);
          scaleVec2(upperLimit, -1, normal0);
        }
      }
    } else if (hasVertex0) {
      if (convex1) {
        front = offset0 >= 0 || offset1 >= 0;
        if (front) {
          copyVec2(normal, normal1);
          copyVec2(lowerLimit, normal0);
          scaleVec2(upperLimit, -1, normal1);
        } else {
          scaleVec2(normal, -1, normal1);
          copyVec2(lowerLimit, normal1);
          scaleVec2(upperLimit, -1, normal1);
        }
      } else {
        front = offset0 >= 0 && offset1 >= 0;
        if (front) {
          copyVec2(normal, normal1);
          copyVec2(lowerLimit, normal1);
          scaleVec2(upperLimit, -1, normal1);
        } else {
          scaleVec2(normal, -1, normal1);
          copyVec2(lowerLimit, normal1);
          scaleVec2(upperLimit, -1, normal0);
        }
      }
    } else if (hasVertex3) {
      if (convex2) {
        front = offset1 >= 0 || offset2 >= 0;
        if (front) {
          copyVec2(normal, normal1);
          scaleVec2(lowerLimit, -1, normal1);
          copyVec2(upperLimit, normal2);
        } else {
          scaleVec2(normal, -1, normal1);
          scaleVec2(lowerLimit, -1, normal1);
          copyVec2(upperLimit, normal1);
        }
      } else {
        front = offset1 >= 0 && offset2 >= 0;
        if (front) {
          copyVec2(normal, normal1);
          scaleVec2(lowerLimit, -1, normal1);
          copyVec2(upperLimit, normal1);
        } else {
          scaleVec2(normal, -1, normal1);
          scaleVec2(lowerLimit, -1, normal2);
          copyVec2(upperLimit, normal1);
        }
      }
    } else {
      front = offset1 >= 0;
      if (front) {
        copyVec2(normal, normal1);
        scaleVec2(lowerLimit, -1, normal1);
        scaleVec2(upperLimit, -1, normal1);
      } else {
        scaleVec2(normal, -1, normal1);
        copyVec2(lowerLimit, normal1);
        copyVec2(upperLimit, normal1);
      }
    }
    polygonBA.count = polygonB.m_count;
    for (var i = 0; i < polygonB.m_count; ++i) {
      transformVec2(polygonBA.vertices[i], xf, polygonB.m_vertices[i]);
      rotVec2(polygonBA.normals[i], xf.q, polygonB.m_normals[i]);
    }
    var radius = polygonB.m_radius + edgeA.m_radius;
    manifold.pointCount = 0;
    {
      edgeAxis.type = EPAxisType.e_edgeA;
      edgeAxis.index = front ? 0 : 1;
      edgeAxis.separation = Infinity;
      for (var i = 0; i < polygonBA.count; ++i) {
        var v4 = polygonBA.vertices[i];
        var s2 = dotVec2(normal, v4) - dotVec2(normal, v13);
        if (s2 < edgeAxis.separation) {
          edgeAxis.separation = s2;
        }
      }
    }
    if (edgeAxis.type == EPAxisType.e_unknown) {
      return;
    }
    if (edgeAxis.separation > radius) {
      return;
    }
    {
      polygonAxis.type = EPAxisType.e_unknown;
      polygonAxis.index = -1;
      polygonAxis.separation = -Infinity;
      setVec2(perp, -normal.y, normal.x);
      for (var i = 0; i < polygonBA.count; ++i) {
        scaleVec2(n, -1, polygonBA.normals[i]);
        var s1 = dotVec2(n, polygonBA.vertices[i]) - dotVec2(n, v13);
        var s22 = dotVec2(n, polygonBA.vertices[i]) - dotVec2(n, v22);
        var s2 = math_min(s1, s22);
        if (s2 > radius) {
          polygonAxis.type = EPAxisType.e_edgeB;
          polygonAxis.index = i;
          polygonAxis.separation = s2;
          break;
        }
        if (dotVec2(n, perp) >= 0) {
          if (dotVec2(n, normal) - dotVec2(upperLimit, normal) < -SettingsInternal.angularSlop) {
            continue;
          }
        } else {
          if (dotVec2(n, normal) - dotVec2(lowerLimit, normal) < -SettingsInternal.angularSlop) {
            continue;
          }
        }
        if (s2 > polygonAxis.separation) {
          polygonAxis.type = EPAxisType.e_edgeB;
          polygonAxis.index = i;
          polygonAxis.separation = s2;
        }
      }
    }
    if (polygonAxis.type != EPAxisType.e_unknown && polygonAxis.separation > radius) {
      return;
    }
    var k_relativeTol = 0.98;
    var k_absoluteTol = 1e-3;
    var primaryAxis;
    if (polygonAxis.type == EPAxisType.e_unknown) {
      primaryAxis = edgeAxis;
    } else if (polygonAxis.separation > k_relativeTol * edgeAxis.separation + k_absoluteTol) {
      primaryAxis = polygonAxis;
    } else {
      primaryAxis = edgeAxis;
    }
    ie[0].recycle();
    ie[1].recycle();
    if (primaryAxis.type == EPAxisType.e_edgeA) {
      manifold.type = exports2.ManifoldType.e_faceA;
      var bestIndex = 0;
      var bestValue = dotVec2(normal, polygonBA.normals[0]);
      for (var i = 1; i < polygonBA.count; ++i) {
        var value = dotVec2(normal, polygonBA.normals[i]);
        if (value < bestValue) {
          bestValue = value;
          bestIndex = i;
        }
      }
      var i1 = bestIndex;
      var i2 = i1 + 1 < polygonBA.count ? i1 + 1 : 0;
      copyVec2(ie[0].v, polygonBA.vertices[i1]);
      ie[0].id.setFeatures(0, exports2.ContactFeatureType.e_face, i1, exports2.ContactFeatureType.e_vertex);
      copyVec2(ie[1].v, polygonBA.vertices[i2]);
      ie[1].id.setFeatures(0, exports2.ContactFeatureType.e_face, i2, exports2.ContactFeatureType.e_vertex);
      if (front) {
        rf.i1 = 0;
        rf.i2 = 1;
        copyVec2(rf.v1, v13);
        copyVec2(rf.v2, v22);
        copyVec2(rf.normal, normal1);
      } else {
        rf.i1 = 1;
        rf.i2 = 0;
        copyVec2(rf.v1, v22);
        copyVec2(rf.v2, v13);
        scaleVec2(rf.normal, -1, normal1);
      }
    } else {
      manifold.type = exports2.ManifoldType.e_faceB;
      copyVec2(ie[0].v, v13);
      ie[0].id.setFeatures(0, exports2.ContactFeatureType.e_vertex, primaryAxis.index, exports2.ContactFeatureType.e_face);
      copyVec2(ie[1].v, v22);
      ie[1].id.setFeatures(0, exports2.ContactFeatureType.e_vertex, primaryAxis.index, exports2.ContactFeatureType.e_face);
      rf.i1 = primaryAxis.index;
      rf.i2 = rf.i1 + 1 < polygonBA.count ? rf.i1 + 1 : 0;
      copyVec2(rf.v1, polygonBA.vertices[rf.i1]);
      copyVec2(rf.v2, polygonBA.vertices[rf.i2]);
      copyVec2(rf.normal, polygonBA.normals[rf.i1]);
    }
    setVec2(rf.sideNormal1, rf.normal.y, -rf.normal.x);
    setVec2(rf.sideNormal2, -rf.sideNormal1.x, -rf.sideNormal1.y);
    rf.sideOffset1 = dotVec2(rf.sideNormal1, rf.v1);
    rf.sideOffset2 = dotVec2(rf.sideNormal2, rf.v2);
    clipPoints1[0].recycle();
    clipPoints1[1].recycle();
    clipPoints2[0].recycle();
    clipPoints2[1].recycle();
    var np1 = clipSegmentToLine(clipPoints1, ie, rf.sideNormal1, rf.sideOffset1, rf.i1);
    if (np1 < SettingsInternal.maxManifoldPoints) {
      return;
    }
    var np2 = clipSegmentToLine(clipPoints2, clipPoints1, rf.sideNormal2, rf.sideOffset2, rf.i2);
    if (np2 < SettingsInternal.maxManifoldPoints) {
      return;
    }
    if (primaryAxis.type == EPAxisType.e_edgeA) {
      copyVec2(manifold.localNormal, rf.normal);
      copyVec2(manifold.localPoint, rf.v1);
    } else {
      copyVec2(manifold.localNormal, polygonB.m_normals[rf.i1]);
      copyVec2(manifold.localPoint, polygonB.m_vertices[rf.i1]);
    }
    var pointCount = 0;
    for (var i = 0; i < SettingsInternal.maxManifoldPoints; ++i) {
      var separation = dotVec2(rf.normal, clipPoints2[i].v) - dotVec2(rf.normal, rf.v1);
      if (separation <= radius) {
        var cp = manifold.points[pointCount];
        if (primaryAxis.type == EPAxisType.e_edgeA) {
          detransformVec2(cp.localPoint, xf, clipPoints2[i].v);
          cp.id.set(clipPoints2[i].id);
        } else {
          copyVec2(cp.localPoint, clipPoints2[i].v);
          cp.id.set(clipPoints2[i].id);
          cp.id.swapFeatures();
        }
        ++pointCount;
      }
    }
    manifold.pointCount = pointCount;
  };
  var internal = {
    CollidePolygons,
    Settings,
    Sweep,
    Manifold,
    Distance,
    TimeOfImpact,
    DynamicTree,
    stats
  };
  var DataDriver = (
    /** @class */
    (function() {
      function DataDriver2(key, listener) {
        this._refMap = {};
        this._map = {};
        this._xmap = {};
        this._data = [];
        this._entered = [];
        this._exited = [];
        this._key = key;
        this._listener = listener;
      }
      DataDriver2.prototype.update = function(data) {
        if (!Array.isArray(data))
          throw "Invalid data: " + data;
        this._entered.length = 0;
        this._exited.length = 0;
        this._data.length = data.length;
        for (var i = 0; i < data.length; i++) {
          if (typeof data[i] !== "object" || data[i] === null)
            continue;
          var d2 = data[i];
          var id = this._key(d2);
          if (!this._map[id]) {
            this._entered.push(d2);
          } else {
            delete this._map[id];
          }
          this._data[i] = d2;
          this._xmap[id] = d2;
        }
        for (var id in this._map) {
          this._exited.push(this._map[id]);
          delete this._map[id];
        }
        var temp3 = this._map;
        this._map = this._xmap;
        this._xmap = temp3;
        for (var i = 0; i < this._exited.length; i++) {
          var d2 = this._exited[i];
          var key = this._key(d2);
          var ref = this._refMap[key];
          this._listener.exit(d2, ref);
          delete this._refMap[key];
        }
        for (var i = 0; i < this._entered.length; i++) {
          var d2 = this._entered[i];
          var key = this._key(d2);
          var ref = this._listener.enter(d2);
          if (ref) {
            this._refMap[key] = ref;
          }
        }
        for (var i = 0; i < this._data.length; i++) {
          if (typeof data[i] !== "object" || data[i] === null)
            continue;
          var d2 = this._data[i];
          var key = this._key(d2);
          var ref = this._refMap[key];
          this._listener.update(d2, ref);
        }
        this._entered.length = 0;
        this._exited.length = 0;
        this._data.length = 0;
      };
      DataDriver2.prototype.ref = function(d2) {
        return this._refMap[this._key(d2)];
      };
      return DataDriver2;
    })()
  );
  const planck = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
    __proto__: null,
    AABB,
    Body,
    Box: BoxShape,
    BoxShape,
    BroadPhase,
    Chain: ChainShape,
    ChainShape,
    Circle: CircleShape,
    CircleShape,
    ClipVertex,
    CollideCircles,
    CollideEdgeCircle,
    CollideEdgePolygon,
    CollidePolygonCircle,
    CollidePolygons,
    Contact,
    ContactEdge,
    get ContactFeatureType() {
      return exports2.ContactFeatureType;
    },
    ContactID,
    ContactImpulse,
    DataDriver,
    Distance,
    DistanceInput,
    DistanceJoint,
    DistanceOutput,
    DistanceProxy,
    DynamicTree,
    Edge: EdgeShape,
    EdgeShape,
    Fixture,
    FixtureProxy,
    FrictionJoint,
    GearJoint,
    Joint,
    JointEdge,
    Manifold,
    ManifoldPoint,
    get ManifoldType() {
      return exports2.ManifoldType;
    },
    Mat22,
    Mat33,
    Math: math,
    MotorJoint,
    MouseJoint,
    get PointState() {
      return exports2.PointState;
    },
    Polygon: PolygonShape,
    PolygonShape,
    PrismaticJoint,
    PulleyJoint,
    RevoluteJoint,
    RopeJoint,
    Rot,
    Serializer,
    Settings,
    SettingsInternal,
    Shape,
    ShapeCast,
    ShapeCastInput,
    ShapeCastOutput,
    SimplexCache,
    Solver,
    Sweep,
    TOIInput,
    TOIOutput,
    get TOIOutputState() {
      return exports2.TOIOutputState;
    },
    Testbed,
    TimeOfImpact,
    TimeStep,
    Transform,
    TreeNode,
    Vec2,
    Vec3,
    VelocityConstraintPoint,
    WeldJoint,
    WheelJoint,
    World,
    WorldManifold,
    clipSegmentToLine,
    getPointStates,
    internal,
    mixFriction,
    mixRestitution,
    stats,
    testOverlap,
    testbed
  }, Symbol.toStringTag, { value: "Module" }));
  exports2.AABB = AABB;
  exports2.Body = Body;
  exports2.Box = BoxShape;
  exports2.BoxShape = BoxShape;
  exports2.BroadPhase = BroadPhase;
  exports2.Chain = ChainShape;
  exports2.ChainShape = ChainShape;
  exports2.Circle = CircleShape;
  exports2.CircleShape = CircleShape;
  exports2.ClipVertex = ClipVertex;
  exports2.CollideCircles = CollideCircles;
  exports2.CollideEdgeCircle = CollideEdgeCircle;
  exports2.CollideEdgePolygon = CollideEdgePolygon;
  exports2.CollidePolygonCircle = CollidePolygonCircle;
  exports2.CollidePolygons = CollidePolygons;
  exports2.Contact = Contact;
  exports2.ContactEdge = ContactEdge;
  exports2.ContactID = ContactID;
  exports2.ContactImpulse = ContactImpulse;
  exports2.DataDriver = DataDriver;
  exports2.Distance = Distance;
  exports2.DistanceInput = DistanceInput;
  exports2.DistanceJoint = DistanceJoint;
  exports2.DistanceOutput = DistanceOutput;
  exports2.DistanceProxy = DistanceProxy;
  exports2.DynamicTree = DynamicTree;
  exports2.Edge = EdgeShape;
  exports2.EdgeShape = EdgeShape;
  exports2.Fixture = Fixture;
  exports2.FixtureProxy = FixtureProxy;
  exports2.FrictionJoint = FrictionJoint;
  exports2.GearJoint = GearJoint;
  exports2.Joint = Joint;
  exports2.JointEdge = JointEdge;
  exports2.Manifold = Manifold;
  exports2.ManifoldPoint = ManifoldPoint;
  exports2.Mat22 = Mat22;
  exports2.Mat33 = Mat33;
  exports2.Math = math;
  exports2.MotorJoint = MotorJoint;
  exports2.MouseJoint = MouseJoint;
  exports2.Polygon = PolygonShape;
  exports2.PolygonShape = PolygonShape;
  exports2.PrismaticJoint = PrismaticJoint;
  exports2.PulleyJoint = PulleyJoint;
  exports2.RevoluteJoint = RevoluteJoint;
  exports2.RopeJoint = RopeJoint;
  exports2.Rot = Rot;
  exports2.Serializer = Serializer;
  exports2.Settings = Settings;
  exports2.SettingsInternal = SettingsInternal;
  exports2.Shape = Shape;
  exports2.ShapeCast = ShapeCast;
  exports2.ShapeCastInput = ShapeCastInput;
  exports2.ShapeCastOutput = ShapeCastOutput;
  exports2.SimplexCache = SimplexCache;
  exports2.Solver = Solver;
  exports2.Sweep = Sweep;
  exports2.TOIInput = TOIInput;
  exports2.TOIOutput = TOIOutput;
  exports2.Testbed = Testbed;
  exports2.TimeOfImpact = TimeOfImpact;
  exports2.TimeStep = TimeStep;
  exports2.Transform = Transform;
  exports2.TreeNode = TreeNode;
  exports2.Vec2 = Vec2;
  exports2.Vec3 = Vec3;
  exports2.VelocityConstraintPoint = VelocityConstraintPoint;
  exports2.WeldJoint = WeldJoint;
  exports2.WheelJoint = WheelJoint;
  exports2.World = World;
  exports2.WorldManifold = WorldManifold;
  exports2.clipSegmentToLine = clipSegmentToLine;
  exports2.default = planck;
  exports2.getPointStates = getPointStates;
  exports2.internal = internal;
  exports2.mixFriction = mixFriction;
  exports2.mixRestitution = mixRestitution;
  exports2.stats = stats;
  exports2.testOverlap = testOverlap;
  exports2.testbed = testbed;
  Object.defineProperties(exports2, { __esModule: { value: true }, [Symbol.toStringTag]: { value: "Module" } });
}));
//# sourceMappingURL=planck.js.map


/***/ },

/***/ 836
(module) {

"use strict";
module.exports = /*#__PURE__*/JSON.parse('{"version":3,"dataVersion":3,"generatorVersion":3,"parts":["engine","suspension","tires","tank"],"maxTicks":36000,"minUpgrade":0,"maxUpgrade":10,"upgradePrices":{"engine":[350,500,650,2250,4500,7000,10500,21000,30000,38000],"suspension":[300,400,550,2000,5000,9000,15000,28000,33000,36000],"tires":[300,400,550,2000,5000,9000,15000,28000,33000,36000],"tank":[350,500,650,2250,4500,7000,10500,21000,30000,38000]},"economy":{"startingFormula":"round50(basePrice * 1.38^L)","basePrices":{"engine":350,"suspension":300,"tires":300,"tank":350},"startingUpgradePrices":{"engine":[350,500,650,900,1250,1750,2400,3350,4600,6350],"suspension":[300,400,550,800,1100,1500,2050,2850,3950,5450],"tires":[300,400,550,800,1100,1500,2050,2850,3950,5450],"tank":[350,500,650,900,1250,1750,2400,3350,4600,6350]},"calibrationVersion":1,"calibrationId":"A-shorter-campaign","measurementSource":"artifacts/pixel-drive-v3-economy-analysis.json","explanation":"Prices from L3 calibrated to measured repeat earnings; L0–2 and ordinary coin values unchanged. Some middle upgrades intentionally remain faster than the 2–4 target to reduce campaign repetition."},"levels":[{"id":1,"stageId":"first-drive","campaignIndex":0,"name":"Перший виїзд","meters":200,"recommended":{"engine":0,"suspension":0,"tires":0,"tank":0},"finishReward":400,"description":"Навчися розганятися, зібрати пальне й м’яко приземлитися.","challenge":"Навчання","hint":"Відпускай газ перед спуском. Пальне — це час активного заїзду.","modules":[{"id":"first-drive-0","type":"intro","name":"Знайомий початок","from":0,"to":45,"geometry":{"firstVertex":1,"lastVertex":46,"heightChange":0,"maximumSlopeDegrees":0},"material":"dirt","entry":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.35,0.35],"angularSpeed":[-1.2,1.2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"exit":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.5,0.5],"angularSpeed":[-2,2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"recovery":{"from":45,"to":45},"pickups":{"coins":[0,1,2],"fuel":[]},"validation":{"state":"measured within complete route, not isolated proof","source":"artifacts/pixel-drive-campaign-balance.json","reference":{"entry":{"x":9,"speed":0,"bodyAngle":0,"angularSpeed":0,"groundedWheels":2,"suspensionCompression":[0,0],"fuelSeconds":40,"tick":0},"exit":{"x":45.0313,"speed":13.4568,"bodyAngle":0.0345,"angularSpeed":0.0001,"groundedWheels":2,"suspensionCompression":[0.2601,0.1718],"fuelSeconds":34.8333,"tick":310}},"profiles":[{"name":"base","n":100,"entered":100,"exited":100,"fullCourseWins":100,"entrySpeedRange":[0.153,0.1531],"entryFuelRange":[39.9833,39.9833]}]}},{"id":"first-drive-1","type":"rollers","name":"Хвиляста ділянка","from":45,"to":90,"geometry":{"firstVertex":46,"lastVertex":91,"heightChange":0,"maximumSlopeDegrees":3.7908770243539562},"material":"dirt","entry":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.35,0.35],"angularSpeed":[-1.2,1.2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"exit":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.5,0.5],"angularSpeed":[-2,2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"recovery":{"from":90,"to":90},"pickups":{"coins":[3,4,5],"fuel":[0]},"validation":{"state":"measured within complete route, not isolated proof","source":"artifacts/pixel-drive-campaign-balance.json","reference":{"entry":{"x":45.0313,"speed":13.4568,"bodyAngle":0.0345,"angularSpeed":0.0001,"groundedWheels":2,"suspensionCompression":[0.2601,0.1718],"fuelSeconds":34.8333,"tick":310},"exit":{"x":90.2343,"speed":18.2885,"bodyAngle":0.0275,"angularSpeed":-0.0612,"groundedWheels":2,"suspensionCompression":[0.2485,0.1832],"fuelSeconds":39.9,"tick":479}},"profiles":[{"name":"base","n":100,"entered":100,"exited":100,"fullCourseWins":100,"entrySpeedRange":[13.4568,16.1836],"entryFuelRange":[27.25,34.8333]}]}},{"id":"first-drive-2","type":"climb","name":"Плавний схил","from":90,"to":125,"geometry":{"firstVertex":91,"lastVertex":126,"heightChange":3.223250083757886,"maximumSlopeDegrees":7.000024784752914},"material":"dirt","entry":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.35,0.35],"angularSpeed":[-1.2,1.2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"exit":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.5,0.5],"angularSpeed":[-2,2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"recovery":{"from":125,"to":125},"pickups":{"coins":[6,7,8],"fuel":[0]},"validation":{"state":"measured within complete route, not isolated proof","source":"artifacts/pixel-drive-campaign-balance.json","reference":{"entry":{"x":90.2343,"speed":18.2885,"bodyAngle":0.0275,"angularSpeed":-0.0612,"groundedWheels":2,"suspensionCompression":[0.2485,0.1832],"fuelSeconds":39.9,"tick":479},"exit":{"x":125.1977,"speed":19.0973,"bodyAngle":0.0144,"angularSpeed":-0.238,"groundedWheels":2,"suspensionCompression":[0.1032,0.0583],"fuelSeconds":38.0167,"tick":592}},"profiles":[{"name":"base","n":100,"entered":100,"exited":100,"fullCourseWins":100,"entrySpeedRange":[14.1711,19.6407],"entryFuelRange":[39.8833,39.9167]}]}},{"id":"first-drive-3","type":"climb","name":"Плавний схил","from":125,"to":155,"geometry":{"firstVertex":126,"lastVertex":156,"heightChange":-3.56367337166359,"maximumSlopeDegrees":9.00003128230294},"material":"dirt","entry":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.35,0.35],"angularSpeed":[-1.2,1.2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"exit":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.5,0.5],"angularSpeed":[-2,2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"recovery":{"from":155,"to":200},"pickups":{"coins":[9,10,11],"fuel":[]},"validation":{"state":"measured within complete route, not isolated proof","source":"artifacts/pixel-drive-campaign-balance.json","reference":{"entry":{"x":125.1977,"speed":19.0973,"bodyAngle":0.0144,"angularSpeed":-0.238,"groundedWheels":2,"suspensionCompression":[0.1032,0.0583],"fuelSeconds":38.0167,"tick":592},"exit":{"x":155.1447,"speed":21.94,"bodyAngle":0.0023,"angularSpeed":0.5193,"groundedWheels":2,"suspensionCompression":[0.4423,0.4331],"fuelSeconds":36.55,"tick":680}},"profiles":[{"name":"base","n":100,"entered":100,"exited":100,"fullCourseWins":100,"entrySpeedRange":[14.1409,20.0139],"entryFuelRange":[37.3833,38.1333]}]}},{"id":"first-drive-4","type":"recovery","name":"Відновлення","from":155,"to":200,"geometry":{"firstVertex":156,"lastVertex":201,"heightChange":0,"maximumSlopeDegrees":0},"material":"dirt","entry":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.35,0.35],"angularSpeed":[-1.2,1.2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"exit":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.5,0.5],"angularSpeed":[-2,2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"recovery":{"from":200,"to":200},"pickups":{"coins":[12,13,14],"fuel":[]},"validation":{"state":"measured within complete route, not isolated proof","source":"artifacts/pixel-drive-campaign-balance.json","reference":{"entry":{"x":155.1447,"speed":21.94,"bodyAngle":0.0023,"angularSpeed":0.5193,"groundedWheels":2,"suspensionCompression":[0.4423,0.4331],"fuelSeconds":36.55,"tick":680},"exit":{"x":200.3194,"speed":23.1418,"bodyAngle":0.01,"angularSpeed":-0.0016,"groundedWheels":2,"suspensionCompression":[0.2336,0.2075],"fuelSeconds":34.55,"tick":800}},"profiles":[{"name":"base","n":100,"entered":100,"exited":100,"fullCourseWins":100,"entrySpeedRange":[14.5479,22.5213],"entryFuelRange":[35.3167,36.7167]}]}}],"fuel":[90],"seed":3193799369,"generatorVersion":3,"length":200,"max_ticks":36000,"terrain":[[-100,12],[0,12],[1,12],[2,12],[3,12],[4,12],[5,12],[6,12],[7,12],[8,12],[9,12],[10,12],[11,12],[12,12],[13,12],[14,12],[15,12],[16,12],[17,12],[18,12],[19,12],[20,12],[21,12],[22,12],[23,12],[24,12],[25,12],[26,12],[27,12],[28,12],[29,12],[30,12],[31,12],[32,12],[33,12],[34,12],[35,12],[36,12],[37,12],[38,12],[39,12],[40,12],[41,12],[42,12],[43,12],[44,12],[45,12],[46,12.000413],[47,12.002908],[48,12.008545],[49,12.017333],[50,12.028091],[51,12.038565],[52,12.045793],[53,12.046664],[54,12.038563],[55,12.019985],[56,11.991005],[57,11.953502],[58,11.911076],[59,11.868667],[60,11.83191],[61,11.806323],[62,11.796461],[63,11.805172],[64,11.833069],[65,11.878327],[66,11.936831],[67,12.002677],[68,12.068937],[69,12.128587],[70,12.175449],[71,12.205018],[72,12.215021],[73,12.205658],[74,12.179473],[75,12.140893],[76,12.095509],[77,12.049227],[78,12.007418],[79,11.974207],[80,11.952],[81,11.941318],[82,11.940949],[83,11.94836],[84,11.960303],[85,11.973479],[86,11.985151],[87,11.993595],[88,11.998303],[89,11.999931],[90,12],[91,12.001157],[92,12.010745],[93,12.035087],[94,12.078307],[95,12.14233],[96,12.22688],[97,12.329484],[98,12.445467],[99,12.567956],[100,12.690741],[101,12.813525],[102,12.93631],[103,13.059095],[104,13.181879],[105,13.304664],[106,13.427448],[107,13.550233],[108,13.673017],[109,13.795802],[110,13.918586],[111,14.041371],[112,14.164156],[113,14.28694],[114,14.409725],[115,14.532509],[116,14.655294],[117,14.777783],[118,14.893766],[119,14.99637],[120,15.08092],[121,15.144943],[122,15.188163],[123,15.212505],[124,15.222093],[125,15.22325],[126,15.221232],[127,15.20476],[128,15.163698],[129,15.092413],[130,14.98978],[131,14.859177],[132,14.708489],[133,14.550104],[134,14.39172],[135,14.233336],[136,14.074951],[137,13.916567],[138,13.758182],[139,13.599798],[140,13.441413],[141,13.283029],[142,13.124645],[143,12.96626],[144,12.807876],[145,12.649491],[146,12.491107],[147,12.332722],[148,12.174338],[149,12.02365],[150,11.893047],[151,11.790414],[152,11.719129],[153,11.678067],[154,11.661595],[155,11.659577],[156,11.659577],[157,11.659577],[158,11.659577],[159,11.659577],[160,11.659577],[161,11.659577],[162,11.659577],[163,11.659577],[164,11.659577],[165,11.659577],[166,11.659577],[167,11.659577],[168,11.659577],[169,11.659577],[170,11.659577],[171,11.659577],[172,11.659577],[173,11.659577],[174,11.659577],[175,11.659577],[176,11.659577],[177,11.659577],[178,11.659577],[179,11.659577],[180,11.659577],[181,11.659577],[182,11.659577],[183,11.659577],[184,11.659577],[185,11.659577],[186,11.659577],[187,11.659577],[188,11.659577],[189,11.659577],[190,11.659577],[191,11.659577],[192,11.659577],[193,11.659577],[194,11.659577],[195,11.659577],[196,11.659577],[197,11.659577],[198,11.659577],[199,11.659577],[200,11.659577],[280,11.659576712094296]],"linearTerrain":true,"surfaces":[],"gears":[17.98,29.55,42.77,53.64,67.14,78.27,90.57,101.51,113.38,125.16,137.52,149.01,160.61,175.22,185.26],"coinValues":[15,15,15,15,15,15,15,15,15,15,20,20,20,20,20],"bridges":[],"checkpoints":[{"id":"first-drive-checkpoint-0","x":90,"reward":100}],"fuelValidation":{"state":"measured in complete recommended-profile simulation","targetRho":[0.6,0.75],"referenceProfile":{"engine":0,"suspension":0,"tires":0,"tank":0},"legs":[{"from":9,"to":90,"T_ref":7.8833,"C_ref":40,"rho":0.1971,"fuelRemaining":32.1167,"arrivalTick":473},{"from":90,"to":209,"T_ref":5.8333,"C_ref":40,"rho":0.1458,"fuelRemaining":34.1667,"arrivalTick":823,"finish":true}]},"streams":{"geometry":"geometry","coins":"coins","fuel":"fuel","decorations":"decorations","fuelMarker":0.3312712262850255},"decorationSeed":1417409013,"validation":{"state":"measured full-course attempts","sampleCount":100,"source":"artifacts/pixel-drive-campaign-balance.json","notAnImpossibilityProof":true,"profiles":[{"name":"base","upgrades":{"engine":0,"suspension":0,"tires":0,"tank":0},"n":100,"wins":100,"distanceRange":[200,200.38],"failures":{}}],"reference":{"upgrades":{"engine":0,"suspension":0,"tires":0,"tank":0},"targetSpeed":24,"holdTicks":12,"ticks":823,"seconds":13.7167,"inputChanges":1}}},{"id":2,"stageId":"green-hills","campaignIndex":1,"name":"Зелені пагорби","meters":600,"recommended":{"engine":2,"suspension":1,"tires":1,"tank":1},"finishReward":550,"description":"Набери розгін перед довгим підйомом. Перші покращення двигуна відкриють шлях вище.","challenge":"Тяга та розгін","hint":"На довгому підйомі потрібен запас тяги, а не лише швидкий стрибок.","modules":[{"id":"green-hills-0","type":"intro","name":"Знайомий початок","from":0,"to":150,"geometry":{"firstVertex":1,"lastVertex":151,"heightChange":-1.7763568394002505e-15,"maximumSlopeDegrees":5.020260861531083},"material":"dirt","entry":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.35,0.35],"angularSpeed":[-1.2,1.2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"exit":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.5,0.5],"angularSpeed":[-2,2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"recovery":{"from":150,"to":170},"pickups":{"coins":[0,1,2,3,4,5,6,7,8,9],"fuel":[0]},"validation":{"state":"measured within complete route, not isolated proof","source":"artifacts/pixel-drive-campaign-balance.json","reference":{"entry":{"x":9,"speed":0,"bodyAngle":0,"angularSpeed":0,"groundedWheels":2,"suspensionCompression":[0,0],"fuelSeconds":44,"tick":0},"exit":{"x":150.2625,"speed":18.0103,"bodyAngle":-0.0056,"angularSpeed":0.0003,"groundedWheels":2,"suspensionCompression":[0.2145,0.228],"fuelSeconds":42.5167,"tick":628}},"profiles":[{"name":"base","n":100,"entered":100,"exited":100,"fullCourseWins":0,"entrySpeedRange":[0.1513,0.1514],"entryFuelRange":[39.9833,39.9833]},{"name":"recommended","n":100,"entered":100,"exited":100,"fullCourseWins":100,"entrySpeedRange":[0.1512,0.1513],"entryFuelRange":[43.9833,43.9833]},{"name":"maximum","n":100,"entered":100,"exited":100,"fullCourseWins":99,"entrySpeedRange":[0.1497,0.1502],"entryFuelRange":[79.9833,79.9833]},{"name":"engine-only","n":100,"entered":100,"exited":100,"fullCourseWins":99,"entrySpeedRange":[0.1513,0.1518],"entryFuelRange":[39.9833,39.9833]},{"name":"tank-only","n":100,"entered":100,"exited":100,"fullCourseWins":0,"entrySpeedRange":[0.1513,0.1514],"entryFuelRange":[79.9833,79.9833]},{"name":"strong-F0","n":100,"entered":100,"exited":100,"fullCourseWins":99,"entrySpeedRange":[0.1497,0.1502],"entryFuelRange":[39.9833,39.9833]},{"name":"recommended-minus-engine","n":100,"entered":100,"exited":100,"fullCourseWins":87,"entrySpeedRange":[0.1512,0.1513],"entryFuelRange":[43.9833,43.9833]},{"name":"recommended-minus-suspension","n":100,"entered":100,"exited":100,"fullCourseWins":100,"entrySpeedRange":[0.1513,0.1514],"entryFuelRange":[43.9833,43.9833]},{"name":"recommended-minus-tires","n":100,"entered":100,"exited":100,"fullCourseWins":100,"entrySpeedRange":[0.1512,0.1513],"entryFuelRange":[43.9833,43.9833]},{"name":"recommended-minus-tank","n":100,"entered":100,"exited":100,"fullCourseWins":100,"entrySpeedRange":[0.1512,0.1513],"entryFuelRange":[39.9833,39.9833]}]}},{"id":"green-hills-1","type":"recovery","name":"Відновлення","from":150,"to":170,"geometry":{"firstVertex":151,"lastVertex":171,"heightChange":0,"maximumSlopeDegrees":0},"material":"dirt","entry":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.35,0.35],"angularSpeed":[-1.2,1.2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"exit":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.5,0.5],"angularSpeed":[-2,2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"recovery":{"from":170,"to":170},"pickups":{"coins":[10],"fuel":[]},"validation":{"state":"measured within complete route, not isolated proof","source":"artifacts/pixel-drive-campaign-balance.json","reference":{"entry":{"x":150.2625,"speed":18.0103,"bodyAngle":-0.0056,"angularSpeed":0.0003,"groundedWheels":2,"suspensionCompression":[0.2145,0.228],"fuelSeconds":42.5167,"tick":628},"exit":{"x":170.1653,"speed":18.0232,"bodyAngle":-0.004,"angularSpeed":0.0184,"groundedWheels":2,"suspensionCompression":[0.2217,0.2354],"fuelSeconds":41.4167,"tick":694}},"profiles":[{"name":"base","n":100,"entered":100,"exited":100,"fullCourseWins":0,"entrySpeedRange":[14.6898,22.3471],"entryFuelRange":[38.1667,38.7833]},{"name":"recommended","n":100,"entered":100,"exited":100,"fullCourseWins":100,"entrySpeedRange":[14.6937,24.5513],"entryFuelRange":[42.2,42.9]},{"name":"maximum","n":100,"entered":100,"exited":100,"fullCourseWins":99,"entrySpeedRange":[15.0732,32.0363],"entryFuelRange":[78.1667,79.15]},{"name":"engine-only","n":100,"entered":100,"exited":100,"fullCourseWins":99,"entrySpeedRange":[14.6821,31.9945],"entryFuelRange":[38.2167,39.15]},{"name":"tank-only","n":100,"entered":100,"exited":100,"fullCourseWins":0,"entrySpeedRange":[14.6898,22.3471],"entryFuelRange":[78.1667,78.7833]},{"name":"strong-F0","n":100,"entered":100,"exited":100,"fullCourseWins":99,"entrySpeedRange":[15.0732,32.0363],"entryFuelRange":[38.1667,39.15]},{"name":"recommended-minus-engine","n":100,"entered":100,"exited":100,"fullCourseWins":87,"entrySpeedRange":[14.5655,23.562],"entryFuelRange":[42.2,42.85]},{"name":"recommended-minus-suspension","n":100,"entered":100,"exited":100,"fullCourseWins":100,"entrySpeedRange":[14.6946,24.5361],"entryFuelRange":[42.2,42.9]},{"name":"recommended-minus-tires","n":100,"entered":100,"exited":100,"fullCourseWins":100,"entrySpeedRange":[14.6937,24.5513],"entryFuelRange":[42.2,42.9]},{"name":"recommended-minus-tank","n":100,"entered":100,"exited":100,"fullCourseWins":100,"entrySpeedRange":[14.6937,24.5513],"entryFuelRange":[38.2,38.9]}]}},{"id":"green-hills-2","type":"torque","name":"Контрольний підйом","from":170,"to":410,"geometry":{"firstVertex":171,"lastVertex":411,"heightChange":89.69382213540428,"maximumSlopeDegrees":22.0000381318336},"material":"dirt","entry":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.35,0.35],"angularSpeed":[-1.2,1.2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"exit":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.5,0.5],"angularSpeed":[-2,2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"recovery":{"from":410,"to":445},"pickups":{"coins":[11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27],"fuel":[]},"validation":{"state":"measured within complete route, not isolated proof","source":"artifacts/pixel-drive-campaign-balance.json","reference":{"entry":{"x":170.1653,"speed":18.0232,"bodyAngle":-0.004,"angularSpeed":0.0184,"groundedWheels":2,"suspensionCompression":[0.2217,0.2354],"fuelSeconds":41.4167,"tick":694},"exit":{"x":410.1138,"speed":11.3305,"bodyAngle":0.0453,"angularSpeed":-0.0407,"groundedWheels":2,"suspensionCompression":[0.2414,0.125],"fuelSeconds":19.1167,"tick":2032}},"profiles":[{"name":"base","n":100,"entered":100,"exited":0,"fullCourseWins":0,"entrySpeedRange":[14.4318,22.869],"entryFuelRange":[36.8,37.9]},{"name":"recommended","n":100,"entered":100,"exited":100,"fullCourseWins":100,"entrySpeedRange":[14.4994,25.1174],"entryFuelRange":[40.8333,42.0833]},{"name":"maximum","n":100,"entered":100,"exited":100,"fullCourseWins":99,"entrySpeedRange":[13.9212,32.6577],"entryFuelRange":[76.8,78.5167]},{"name":"engine-only","n":100,"entered":100,"exited":100,"fullCourseWins":99,"entrySpeedRange":[14.5766,32.6057],"entryFuelRange":[36.8333,38.5167]},{"name":"tank-only","n":100,"entered":100,"exited":0,"fullCourseWins":0,"entrySpeedRange":[14.4318,22.869],"entryFuelRange":[76.8,77.9]},{"name":"strong-F0","n":100,"entered":100,"exited":100,"fullCourseWins":99,"entrySpeedRange":[13.9212,32.6577],"entryFuelRange":[36.8,38.5167]},{"name":"recommended-minus-engine","n":100,"entered":100,"exited":87,"fullCourseWins":87,"entrySpeedRange":[14.8141,23.9482],"entryFuelRange":[40.8167,42]},{"name":"recommended-minus-suspension","n":100,"entered":100,"exited":100,"fullCourseWins":100,"entrySpeedRange":[14.5004,25.1157],"entryFuelRange":[40.8333,42.0833]},{"name":"recommended-minus-tires","n":100,"entered":100,"exited":100,"fullCourseWins":100,"entrySpeedRange":[14.4994,25.1174],"entryFuelRange":[40.8333,42.0833]},{"name":"recommended-minus-tank","n":100,"entered":100,"exited":100,"fullCourseWins":100,"entrySpeedRange":[14.4994,25.1174],"entryFuelRange":[36.8333,38.0833]}]}},{"id":"green-hills-3","type":"recovery","name":"Відновлення","from":410,"to":445,"geometry":{"firstVertex":411,"lastVertex":446,"heightChange":0,"maximumSlopeDegrees":0},"material":"dirt","entry":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.35,0.35],"angularSpeed":[-1.2,1.2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"exit":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.5,0.5],"angularSpeed":[-2,2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"recovery":{"from":445,"to":445},"pickups":{"coins":[28,29,30],"fuel":[1]},"validation":{"state":"measured within complete route, not isolated proof","source":"artifacts/pixel-drive-campaign-balance.json","reference":{"entry":{"x":410.1138,"speed":11.3305,"bodyAngle":0.0453,"angularSpeed":-0.0407,"groundedWheels":2,"suspensionCompression":[0.2414,0.125],"fuelSeconds":19.1167,"tick":2032},"exit":{"x":445.2721,"speed":17.7819,"bodyAngle":0.0376,"angularSpeed":-0.0154,"groundedWheels":2,"suspensionCompression":[0.2681,0.1665],"fuelSeconds":42.9833,"tick":2175}},"profiles":[{"name":"base","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"recommended","n":100,"entered":100,"exited":100,"fullCourseWins":100,"entrySpeedRange":[10.9065,12.3648],"entryFuelRange":[15.1833,24.4667]},{"name":"maximum","n":100,"entered":100,"exited":99,"fullCourseWins":99,"entrySpeedRange":[14.471,24.5762],"entryFuelRange":[60.0167,69.1667]},{"name":"engine-only","n":100,"entered":100,"exited":99,"fullCourseWins":99,"entrySpeedRange":[14.9928,24.6667],"entryFuelRange":[19.9,29.3333]},{"name":"tank-only","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"strong-F0","n":100,"entered":100,"exited":99,"fullCourseWins":99,"entrySpeedRange":[14.471,24.5762],"entryFuelRange":[20.0167,29.1667]},{"name":"recommended-minus-engine","n":100,"entered":87,"exited":87,"fullCourseWins":87,"entrySpeedRange":[7.4847,8.4637],"entryFuelRange":[5.5667,17.2667]},{"name":"recommended-minus-suspension","n":100,"entered":100,"exited":100,"fullCourseWins":100,"entrySpeedRange":[10.8685,12.354],"entryFuelRange":[15.2,24.4833]},{"name":"recommended-minus-tires","n":100,"entered":100,"exited":100,"fullCourseWins":100,"entrySpeedRange":[10.9064,12.3639],"entryFuelRange":[15.1833,24.4667]},{"name":"recommended-minus-tank","n":100,"entered":100,"exited":100,"fullCourseWins":100,"entrySpeedRange":[10.9065,12.3648],"entryFuelRange":[11.1833,20.4667]}]}},{"id":"green-hills-4","type":"climb","name":"Плавний схил","from":445,"to":545,"geometry":{"firstVertex":446,"lastVertex":546,"heightChange":-17.42963805694214,"maximumSlopeDegrees":12.00002402882636},"material":"dirt","entry":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.35,0.35],"angularSpeed":[-1.2,1.2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"exit":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.5,0.5],"angularSpeed":[-2,2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"recovery":{"from":545,"to":600},"pickups":{"coins":[31,32,33,34,35,36,37],"fuel":[]},"validation":{"state":"measured within complete route, not isolated proof","source":"artifacts/pixel-drive-campaign-balance.json","reference":{"entry":{"x":445.2721,"speed":17.7819,"bodyAngle":0.0376,"angularSpeed":-0.0154,"groundedWheels":2,"suspensionCompression":[0.2681,0.1665],"fuelSeconds":42.9833,"tick":2175},"exit":{"x":545.1648,"speed":18.0358,"bodyAngle":-0.0106,"angularSpeed":0.4096,"groundedWheels":2,"suspensionCompression":[0.3013,0.328],"fuelSeconds":37.5833,"tick":2499}},"profiles":[{"name":"base","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"recommended","n":100,"entered":100,"exited":100,"fullCourseWins":100,"entrySpeedRange":[14.9325,18.2538],"entryFuelRange":[42.8833,43.0333]},{"name":"maximum","n":100,"entered":99,"exited":99,"fullCourseWins":99,"entrySpeedRange":[14.9144,25.9257],"entryFuelRange":[78.8667,79.3333]},{"name":"engine-only","n":100,"entered":99,"exited":99,"fullCourseWins":99,"entrySpeedRange":[14.4987,25.9164],"entryFuelRange":[38.85,39.3167]},{"name":"tank-only","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"strong-F0","n":100,"entered":99,"exited":99,"fullCourseWins":99,"entrySpeedRange":[14.9144,25.9257],"entryFuelRange":[38.8667,39.3333]},{"name":"recommended-minus-engine","n":100,"entered":87,"exited":87,"fullCourseWins":87,"entrySpeedRange":[15.5252,15.8904],"entryFuelRange":[42.8167,42.8667]},{"name":"recommended-minus-suspension","n":100,"entered":100,"exited":100,"fullCourseWins":100,"entrySpeedRange":[14.9441,18.2471],"entryFuelRange":[42.8833,43.0333]},{"name":"recommended-minus-tires","n":100,"entered":100,"exited":100,"fullCourseWins":100,"entrySpeedRange":[14.9325,18.2531],"entryFuelRange":[42.8833,43.0333]},{"name":"recommended-minus-tank","n":100,"entered":100,"exited":100,"fullCourseWins":100,"entrySpeedRange":[14.9325,18.2538],"entryFuelRange":[38.8833,39.0333]}]}},{"id":"green-hills-5","type":"recovery","name":"Відновлення","from":545,"to":600,"geometry":{"firstVertex":546,"lastVertex":601,"heightChange":0,"maximumSlopeDegrees":0},"material":"dirt","entry":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.35,0.35],"angularSpeed":[-1.2,1.2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"exit":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.5,0.5],"angularSpeed":[-2,2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"recovery":{"from":600,"to":600},"pickups":{"coins":[38,39,40,41],"fuel":[]},"validation":{"state":"measured within complete route, not isolated proof","source":"artifacts/pixel-drive-campaign-balance.json","reference":{"entry":{"x":545.1648,"speed":18.0358,"bodyAngle":-0.0106,"angularSpeed":0.4096,"groundedWheels":2,"suspensionCompression":[0.3013,0.328],"fuelSeconds":37.5833,"tick":2499},"exit":{"x":600.1597,"speed":18.0134,"bodyAngle":-0.0012,"angularSpeed":0.0484,"groundedWheels":2,"suspensionCompression":[0.2249,0.2281],"fuelSeconds":34.55,"tick":2681}},"profiles":[{"name":"base","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"recommended","n":100,"entered":100,"exited":100,"fullCourseWins":100,"entrySpeedRange":[14.2973,28.2926],"entryFuelRange":[36.1667,38.8167]},{"name":"maximum","n":100,"entered":99,"exited":99,"fullCourseWins":99,"entrySpeedRange":[13.5445,34.5264],"entryFuelRange":[72.2,75.9167]},{"name":"engine-only","n":100,"entered":99,"exited":99,"fullCourseWins":99,"entrySpeedRange":[14.0546,34.2499],"entryFuelRange":[32.1667,35.8667]},{"name":"tank-only","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"strong-F0","n":100,"entered":99,"exited":99,"fullCourseWins":99,"entrySpeedRange":[13.5445,34.5264],"entryFuelRange":[32.2,35.9167]},{"name":"recommended-minus-engine","n":100,"entered":87,"exited":87,"fullCourseWins":87,"entrySpeedRange":[19.746,27.0687],"entryFuelRange":[37.7,38.3167]},{"name":"recommended-minus-suspension","n":100,"entered":100,"exited":100,"fullCourseWins":100,"entrySpeedRange":[14.7999,28.2988],"entryFuelRange":[36.1667,38.8167]},{"name":"recommended-minus-tires","n":100,"entered":100,"exited":100,"fullCourseWins":100,"entrySpeedRange":[15.2653,28.2977],"entryFuelRange":[36.1667,38.8167]},{"name":"recommended-minus-tank","n":100,"entered":100,"exited":100,"fullCourseWins":100,"entrySpeedRange":[14.2973,28.2926],"entryFuelRange":[32.1667,34.8167]}]}}],"fuel":[125,430],"seed":1553267842,"generatorVersion":3,"length":600,"max_ticks":36000,"terrain":[[-100,12],[0,12],[1,12.00008],[2,12.000484],[3,12.001411],[4,12.003024],[5,12.005444],[6,12.008741],[7,12.012923],[8,12.017939],[9,12.02367],[10,12.029936],[11,12.036499],[12,12.043063],[13,12.049292],[14,12.054813],[15,12.059233],[16,12.062151],[17,12.063174],[18,12.061932],[19,12.058094],[20,12.051385],[21,12.041597],[22,12.028602],[23,12.012366],[24,11.992954],[25,11.970538],[26,11.945396],[27,11.917916],[28,11.888587],[29,11.857998],[30,11.826819],[31,11.795796],[32,11.765727],[33,11.737449],[34,11.711814],[35,11.689668],[36,11.671827],[37,11.659054],[38,11.652039],[39,11.651371],[40,11.657525],[41,11.670837],[42,11.691497],[43,11.71953],[44,11.754792],[45,11.796966],[46,11.845562],[47,11.89992],[48,11.959222],[49,12.022505],[50,12.088675],[51,12.156534],[52,12.224799],[53,12.292131],[54,12.357166],[55,12.418541],[56,12.474931],[57,12.525072],[58,12.567801],[59,12.602073],[60,12.626999],[61,12.641857],[62,12.646122],[63,12.639474],[64,12.621812],[65,12.593257],[66,12.554157],[67,12.505076],[68,12.44679],[69,12.380271],[70,12.306666],[71,12.227274],[72,12.143522],[73,12.05693],[74,11.969085],[75,11.8816],[76,11.796086],[77,11.714113],[78,11.637179],[79,11.566675],[80,11.503861],[81,11.449833],[82,11.405504],[83,11.371588],[84,11.348582],[85,11.336757],[86,11.33616],[87,11.34661],[88,11.367707],[89,11.398846],[90,11.439229],[91,11.487887],[92,11.543707],[93,11.605454],[94,11.671805],[95,11.741377],[96,11.812757],[97,11.884541],[98,11.955355],[99,12.023893],[100,12.088938],[101,12.14939],[102,12.204287],[103,12.252819],[104,12.294346],[105,12.328403],[106,12.354704],[107,12.373146],[108,12.383799],[109,12.386902],[110,12.382847],[111,12.372166],[112,12.355508],[113,12.333624],[114,12.307338],[115,12.277529],[116,12.245101],[117,12.210964],[118,12.176007],[119,12.141081],[120,12.106975],[121,12.074401],[122,12.043981],[123,12.016233],[124,11.991566],[125,11.970275],[126,11.95254],[127,11.938428],[128,11.927899],[129,11.920817],[130,11.916958],[131,11.916022],[132,11.917653],[133,11.92145],[134,11.926985],[135,11.933819],[136,11.941518],[137,11.949669],[138,11.95789],[139,11.965845],[140,11.973253],[141,11.979893],[142,11.985609],[143,11.990313],[144,11.993982],[145,11.996657],[146,11.998434],[147,11.99946],[148,11.999919],[149,12.000023],[150,12],[151,12],[152,12],[153,12],[154,12],[155,12],[156,12],[157,12],[158,12],[159,12],[160,12],[161,12],[162,12],[163,12],[164,12],[165,12],[166,12],[167,12],[168,12],[169,12],[170,12],[171,12.000918],[172,12.008868],[173,12.030084],[174,12.06997],[175,12.133099],[176,12.223212],[177,12.343218],[178,12.495195],[179,12.680391],[180,12.899222],[181,13.15127],[182,13.435291],[183,13.749204],[184,14.090101],[185,14.454241],[186,14.837051],[187,15.233128],[188,15.636236],[189,16.040262],[190,16.444288],[191,16.848315],[192,17.252341],[193,17.656367],[194,18.060393],[195,18.46442],[196,18.868446],[197,19.272472],[198,19.676498],[199,20.080525],[200,20.484551],[201,20.888577],[202,21.292603],[203,21.696629],[204,22.100656],[205,22.504682],[206,22.908708],[207,23.312734],[208,23.716761],[209,24.120787],[210,24.524813],[211,24.928839],[212,25.332865],[213,25.736892],[214,26.140918],[215,26.544944],[216,26.94897],[217,27.352997],[218,27.757023],[219,28.161049],[220,28.565075],[221,28.969101],[222,29.373128],[223,29.777154],[224,30.18118],[225,30.585206],[226,30.989233],[227,31.393259],[228,31.797285],[229,32.201311],[230,32.605338],[231,33.009364],[232,33.41339],[233,33.817416],[234,34.221442],[235,34.625469],[236,35.029495],[237,35.433521],[238,35.837547],[239,36.241574],[240,36.6456],[241,37.049626],[242,37.453652],[243,37.857678],[244,38.261705],[245,38.665731],[246,39.069757],[247,39.473783],[248,39.87781],[249,40.281836],[250,40.685862],[251,41.089888],[252,41.493914],[253,41.897941],[254,42.301967],[255,42.705993],[256,43.110019],[257,43.514046],[258,43.918072],[259,44.322098],[260,44.726124],[261,45.130151],[262,45.534177],[263,45.938203],[264,46.342229],[265,46.746255],[266,47.150282],[267,47.554308],[268,47.958334],[269,48.36236],[270,48.766387],[271,49.170413],[272,49.574439],[273,49.978465],[274,50.382491],[275,50.786518],[276,51.190544],[277,51.59457],[278,51.998596],[279,52.402623],[280,52.806649],[281,53.210675],[282,53.614701],[283,54.018727],[284,54.422754],[285,54.82678],[286,55.230806],[287,55.634832],[288,56.038859],[289,56.442885],[290,56.846911],[291,57.250937],[292,57.654964],[293,58.05899],[294,58.463016],[295,58.867042],[296,59.271068],[297,59.675095],[298,60.079121],[299,60.483147],[300,60.887173],[301,61.2912],[302,61.695226],[303,62.099252],[304,62.503278],[305,62.907304],[306,63.311331],[307,63.715357],[308,64.119383],[309,64.523409],[310,64.927436],[311,65.331462],[312,65.735488],[313,66.139514],[314,66.54354],[315,66.947567],[316,67.351593],[317,67.755619],[318,68.159645],[319,68.563672],[320,68.967698],[321,69.371724],[322,69.77575],[323,70.179777],[324,70.583803],[325,70.987829],[326,71.391855],[327,71.795881],[328,72.199908],[329,72.603934],[330,73.00796],[331,73.411986],[332,73.816013],[333,74.220039],[334,74.624065],[335,75.028091],[336,75.432117],[337,75.836144],[338,76.24017],[339,76.644196],[340,77.048222],[341,77.452249],[342,77.856275],[343,78.260301],[344,78.664327],[345,79.068353],[346,79.47238],[347,79.876406],[348,80.280432],[349,80.684458],[350,81.088485],[351,81.492511],[352,81.896537],[353,82.300563],[354,82.70459],[355,83.108616],[356,83.512642],[357,83.916668],[358,84.320694],[359,84.724721],[360,85.128747],[361,85.532773],[362,85.936799],[363,86.340826],[364,86.744852],[365,87.148878],[366,87.552904],[367,87.95693],[368,88.360957],[369,88.764983],[370,89.169009],[371,89.573035],[372,89.977062],[373,90.381088],[374,90.785114],[375,91.18914],[376,91.593166],[377,91.997193],[378,92.401219],[379,92.805245],[380,93.209271],[381,93.613298],[382,94.017324],[383,94.42135],[384,94.825376],[385,95.229403],[386,95.633429],[387,96.037455],[388,96.441481],[389,96.845507],[390,97.249534],[391,97.65356],[392,98.057586],[393,98.460694],[394,98.856771],[395,99.239581],[396,99.603721],[397,99.944618],[398,100.258531],[399,100.542552],[400,100.794601],[401,101.013431],[402,101.198627],[403,101.350604],[404,101.47061],[405,101.560723],[406,101.623852],[407,101.663738],[408,101.684955],[409,101.692904],[410,101.693822],[411,101.693822],[412,101.693822],[413,101.693822],[414,101.693822],[415,101.693822],[416,101.693822],[417,101.693822],[418,101.693822],[419,101.693822],[420,101.693822],[421,101.693822],[422,101.693822],[423,101.693822],[424,101.693822],[425,101.693822],[426,101.693822],[427,101.693822],[428,101.693822],[429,101.693822],[430,101.693822],[431,101.693822],[432,101.693822],[433,101.693822],[434,101.693822],[435,101.693822],[436,101.693822],[437,101.693822],[438,101.693822],[439,101.693822],[440,101.693822],[441,101.693822],[442,101.693822],[443,101.693822],[444,101.693822],[445,101.693822],[446,101.693339],[447,101.689157],[448,101.677995],[449,101.657011],[450,101.623799],[451,101.576391],[452,101.513257],[453,101.433302],[454,101.335871],[455,101.220745],[456,101.088143],[457,100.938722],[458,100.773573],[459,100.594228],[460,100.402656],[461,100.201261],[462,99.992887],[463,99.780813],[464,99.568257],[465,99.3557],[466,99.143143],[467,98.930587],[468,98.71803],[469,98.505474],[470,98.292917],[471,98.080361],[472,97.867804],[473,97.655247],[474,97.442691],[475,97.230134],[476,97.017578],[477,96.805021],[478,96.592465],[479,96.379908],[480,96.167352],[481,95.954795],[482,95.742238],[483,95.529682],[484,95.317125],[485,95.104569],[486,94.892012],[487,94.679456],[488,94.466899],[489,94.254342],[490,94.041786],[491,93.829229],[492,93.616673],[493,93.404116],[494,93.19156],[495,92.979003],[496,92.766447],[497,92.55389],[498,92.341333],[499,92.128777],[500,91.91622],[501,91.703664],[502,91.491107],[503,91.278551],[504,91.065994],[505,90.853437],[506,90.640881],[507,90.428324],[508,90.215768],[509,90.003211],[510,89.790655],[511,89.578098],[512,89.365542],[513,89.152985],[514,88.940428],[515,88.727872],[516,88.515315],[517,88.302759],[518,88.090202],[519,87.877646],[520,87.665089],[521,87.452533],[522,87.239976],[523,87.027419],[524,86.814863],[525,86.602306],[526,86.38975],[527,86.177193],[528,85.965119],[529,85.756745],[530,85.55535],[531,85.363778],[532,85.184433],[533,85.019285],[534,84.869863],[535,84.737261],[536,84.622135],[537,84.524704],[538,84.44475],[539,84.381615],[540,84.334207],[541,84.300995],[542,84.280011],[543,84.268849],[544,84.264667],[545,84.264184],[546,84.264184],[547,84.264184],[548,84.264184],[549,84.264184],[550,84.264184],[551,84.264184],[552,84.264184],[553,84.264184],[554,84.264184],[555,84.264184],[556,84.264184],[557,84.264184],[558,84.264184],[559,84.264184],[560,84.264184],[561,84.264184],[562,84.264184],[563,84.264184],[564,84.264184],[565,84.264184],[566,84.264184],[567,84.264184],[568,84.264184],[569,84.264184],[570,84.264184],[571,84.264184],[572,84.264184],[573,84.264184],[574,84.264184],[575,84.264184],[576,84.264184],[577,84.264184],[578,84.264184],[579,84.264184],[580,84.264184],[581,84.264184],[582,84.264184],[583,84.264184],[584,84.264184],[585,84.264184],[586,84.264184],[587,84.264184],[588,84.264184],[589,84.264184],[590,84.264184],[591,84.264184],[592,84.264184],[593,84.264184],[594,84.264184],[595,84.264184],[596,84.264184],[597,84.264184],[598,84.264184],[599,84.264184],[600,84.264184],[680,84.26418407846214]],"linearTerrain":true,"surfaces":[],"gears":[16.97,31.45,45.01,61.02,72.86,88.79,102.49,116.21,128.78,144.79,157.39,173.43,186.02,200.67,213.21,226.81,241.13,256.32,269.85,283.68,297.88,311.4,327.1,340.6,353.03,368.57,382.62,397.41,410.07,424.05,438.78,450.91,466.9,480.17,494.88,507.13,522.33,536.28,551.44,564.3,577.12,593.43],"coinValues":[20,20,20,20,20,20,20,20,20,20,20,20,20,20,20,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,30,30,30,30,30,30,30,30,30,30],"bridges":[],"checkpoints":[{"id":"green-hills-checkpoint-0","x":410,"reward":180}],"fuelValidation":{"state":"measured in complete recommended-profile simulation","targetRho":[0.6,0.75],"referenceProfile":{"engine":2,"suspension":1,"tires":1,"tank":1},"legs":[{"from":9,"to":125,"T_ref":8.9833,"C_ref":44,"rho":0.2042,"fuelRemaining":35.0167,"arrivalTick":539},{"from":125,"to":430,"T_ref":26.25,"C_ref":44,"rho":0.5966,"fuelRemaining":17.75,"arrivalTick":2114},{"from":430,"to":609,"T_ref":9.95,"C_ref":44,"rho":0.2261,"fuelRemaining":34.05,"arrivalTick":2711,"finish":true}]},"streams":{"geometry":"geometry","coins":"coins","fuel":"fuel","decorations":"decorations","fuelMarker":0.4578424724750221},"decorationSeed":2692535015,"validation":{"state":"measured full-course attempts","sampleCount":1000,"source":"artifacts/pixel-drive-campaign-balance.json","notAnImpossibilityProof":true,"profiles":[{"name":"base","upgrades":{"engine":0,"suspension":0,"tires":0,"tank":0},"n":100,"wins":0,"distanceRange":[261.66,326.66],"failures":{"route_exit":100}},{"name":"recommended","upgrades":{"engine":2,"suspension":1,"tires":1,"tank":1},"n":100,"wins":100,"distanceRange":[600.01,600.45],"failures":{}},{"name":"maximum","upgrades":{"engine":10,"suspension":10,"tires":10,"tank":10},"n":100,"wins":99,"distanceRange":[426.81,600.52],"failures":{"overturned":1}},{"name":"engine-only","upgrades":{"engine":10,"suspension":0,"tires":0,"tank":0},"n":100,"wins":99,"distanceRange":[426.9,600.5],"failures":{"overturned":1}},{"name":"tank-only","upgrades":{"engine":0,"suspension":0,"tires":0,"tank":10},"n":100,"wins":0,"distanceRange":[261.66,326.66],"failures":{"route_exit":94,"fuel":6}},{"name":"strong-F0","upgrades":{"engine":10,"suspension":10,"tires":10,"tank":0},"n":100,"wins":99,"distanceRange":[426.81,600.52],"failures":{"overturned":1}},{"name":"recommended-minus-engine","upgrades":{"engine":1,"suspension":1,"tires":1,"tank":1},"n":100,"wins":87,"distanceRange":[343.5,600.42],"failures":{"route_exit":13}},{"name":"recommended-minus-suspension","upgrades":{"engine":2,"suspension":0,"tires":1,"tank":1},"n":100,"wins":100,"distanceRange":[600,600.42],"failures":{}},{"name":"recommended-minus-tires","upgrades":{"engine":2,"suspension":1,"tires":0,"tank":1},"n":100,"wins":100,"distanceRange":[600,600.45],"failures":{}},{"name":"recommended-minus-tank","upgrades":{"engine":2,"suspension":1,"tires":1,"tank":0},"n":100,"wins":100,"distanceRange":[600.01,600.45],"failures":{}}],"reference":{"upgrades":{"engine":2,"suspension":1,"tires":1,"tank":1},"targetSpeed":18,"holdTicks":12,"ticks":2711,"seconds":45.1833,"inputChanges":25}}},{"id":3,"stageId":"stone-quarry","campaignIndex":2,"name":"Кам’янистий кар’єр","meters":1000,"recommended":{"engine":4,"suspension":3,"tires":3,"tank":2},"finishReward":1000,"description":"Хвилі, короткі підйоми й посадки перевіряють підвіску та збереження швидкості.","challenge":"Підвіска й темп","hint":"Після нерівності дай підвісці заспокоїтися й збережи темп до фінішу.","modules":[{"id":"stone-quarry-0","type":"intro","name":"Знайомий початок","from":0,"to":140,"geometry":{"firstVertex":1,"lastVertex":141,"heightChange":1.7763568394002505e-15,"maximumSlopeDegrees":6.13590326379085},"material":"dirt","entry":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.35,0.35],"angularSpeed":[-1.2,1.2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"exit":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.5,0.5],"angularSpeed":[-2,2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"recovery":{"from":140,"to":140},"pickups":{"coins":[0,1,2,3,4,5,6,7,8],"fuel":[0]},"validation":{"state":"measured within complete route, not isolated proof","source":"artifacts/pixel-drive-campaign-balance.json","reference":{"entry":{"x":9,"speed":0,"bodyAngle":0,"angularSpeed":0,"groundedWheels":2,"suspensionCompression":[0,0],"fuelSeconds":48,"tick":0},"exit":{"x":140.2053,"speed":25.6893,"bodyAngle":0.0238,"angularSpeed":-0.0036,"groundedWheels":2,"suspensionCompression":[0.2353,0.1777],"fuelSeconds":47.1333,"tick":510}},"profiles":[{"name":"base","n":100,"entered":100,"exited":100,"fullCourseWins":0,"entrySpeedRange":[0.151,0.151],"entryFuelRange":[39.9833,39.9833]},{"name":"recommended","n":100,"entered":100,"exited":100,"fullCourseWins":61,"entrySpeedRange":[0.1505,0.1507],"entryFuelRange":[47.9833,47.9833]},{"name":"maximum","n":100,"entered":100,"exited":100,"fullCourseWins":59,"entrySpeedRange":[0.1495,0.1499],"entryFuelRange":[79.9833,79.9833]},{"name":"engine-only","n":100,"entered":100,"exited":100,"fullCourseWins":54,"entrySpeedRange":[0.151,0.1515],"entryFuelRange":[39.9833,39.9833]},{"name":"tank-only","n":100,"entered":100,"exited":100,"fullCourseWins":0,"entrySpeedRange":[0.151,0.151],"entryFuelRange":[79.9833,79.9833]},{"name":"strong-F0","n":100,"entered":100,"exited":100,"fullCourseWins":59,"entrySpeedRange":[0.1495,0.1499],"entryFuelRange":[39.9833,39.9833]},{"name":"recommended-minus-engine","n":100,"entered":100,"exited":100,"fullCourseWins":54,"entrySpeedRange":[0.1505,0.1507],"entryFuelRange":[47.9833,47.9833]},{"name":"recommended-minus-suspension","n":100,"entered":100,"exited":100,"fullCourseWins":61,"entrySpeedRange":[0.1507,0.1509],"entryFuelRange":[47.9833,47.9833]},{"name":"recommended-minus-tires","n":100,"entered":100,"exited":100,"fullCourseWins":54,"entrySpeedRange":[0.1505,0.1507],"entryFuelRange":[47.9833,47.9833]},{"name":"recommended-minus-tank","n":100,"entered":100,"exited":100,"fullCourseWins":61,"entrySpeedRange":[0.1505,0.1507],"entryFuelRange":[43.9833,43.9833]},{"name":"recommended-S0","n":100,"entered":100,"exited":100,"fullCourseWins":46,"entrySpeedRange":[0.151,0.1512],"entryFuelRange":[47.9833,47.9833]}]}},{"id":"stone-quarry-1","type":"torque","name":"Контрольний підйом","from":140,"to":380,"geometry":{"firstVertex":141,"lastVertex":381,"heightChange":89.69382213540428,"maximumSlopeDegrees":22.0000381318336},"material":"dirt","entry":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.35,0.35],"angularSpeed":[-1.2,1.2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"exit":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.5,0.5],"angularSpeed":[-2,2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"recovery":{"from":380,"to":420},"pickups":{"coins":[9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25],"fuel":[]},"validation":{"state":"measured within complete route, not isolated proof","source":"artifacts/pixel-drive-campaign-balance.json","reference":{"entry":{"x":140.2053,"speed":25.6893,"bodyAngle":0.0238,"angularSpeed":-0.0036,"groundedWheels":2,"suspensionCompression":[0.2353,0.1777],"fuelSeconds":47.1333,"tick":510},"exit":{"x":380.0609,"speed":16.2737,"bodyAngle":0.0974,"angularSpeed":-0.4005,"groundedWheels":1,"suspensionCompression":[0.1491,-0.005],"fuelSeconds":33.35,"tick":1337}},"profiles":[{"name":"base","n":100,"entered":100,"exited":0,"fullCourseWins":0,"entrySpeedRange":[14.3984,21.9051],"entryFuelRange":[38.5167,39]},{"name":"recommended","n":100,"entered":100,"exited":100,"fullCourseWins":61,"entrySpeedRange":[14.3899,26.2798],"entryFuelRange":[46.5167,47.1667]},{"name":"maximum","n":100,"entered":100,"exited":100,"fullCourseWins":59,"entrySpeedRange":[15.0295,31.1754],"entryFuelRange":[78.4833,79.2833]},{"name":"engine-only","n":100,"entered":100,"exited":100,"fullCourseWins":54,"entrySpeedRange":[14.4061,30.676],"entryFuelRange":[38.5167,39.2833]},{"name":"tank-only","n":100,"entered":100,"exited":0,"fullCourseWins":0,"entrySpeedRange":[14.3984,21.9051],"entryFuelRange":[78.5167,79]},{"name":"strong-F0","n":100,"entered":100,"exited":100,"fullCourseWins":59,"entrySpeedRange":[15.0295,31.1754],"entryFuelRange":[38.4833,39.2833]},{"name":"recommended-minus-engine","n":100,"entered":100,"exited":100,"fullCourseWins":54,"entrySpeedRange":[14.2973,25.3562],"entryFuelRange":[46.5,47.1333]},{"name":"recommended-minus-suspension","n":100,"entered":100,"exited":100,"fullCourseWins":61,"entrySpeedRange":[14.3903,26.2828],"entryFuelRange":[46.5,47.1667]},{"name":"recommended-minus-tires","n":100,"entered":100,"exited":100,"fullCourseWins":54,"entrySpeedRange":[14.3899,26.2809],"entryFuelRange":[46.5167,47.1667]},{"name":"recommended-minus-tank","n":100,"entered":100,"exited":100,"fullCourseWins":61,"entrySpeedRange":[14.3899,26.2798],"entryFuelRange":[42.5167,43.1667]},{"name":"recommended-S0","n":100,"entered":100,"exited":100,"fullCourseWins":46,"entrySpeedRange":[14.3929,26.2947],"entryFuelRange":[46.5,47.1667]}]}},{"id":"stone-quarry-2","type":"recovery","name":"Відновлення","from":380,"to":420,"geometry":{"firstVertex":381,"lastVertex":421,"heightChange":0,"maximumSlopeDegrees":0},"material":"dirt","entry":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.35,0.35],"angularSpeed":[-1.2,1.2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"exit":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.5,0.5],"angularSpeed":[-2,2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"recovery":{"from":420,"to":420},"pickups":{"coins":[26,27,28],"fuel":[1]},"validation":{"state":"measured within complete route, not isolated proof","source":"artifacts/pixel-drive-campaign-balance.json","reference":{"entry":{"x":380.0609,"speed":16.2737,"bodyAngle":0.0974,"angularSpeed":-0.4005,"groundedWheels":1,"suspensionCompression":[0.1491,-0.005],"fuelSeconds":33.35,"tick":1337},"exit":{"x":420.151,"speed":21.971,"bodyAngle":0.0388,"angularSpeed":-0.0059,"groundedWheels":2,"suspensionCompression":[0.2778,0.1747],"fuelSeconds":47.9333,"tick":1461}},"profiles":[{"name":"base","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"recommended","n":100,"entered":100,"exited":100,"fullCourseWins":61,"entrySpeedRange":[14.3272,16.4701],"entryFuelRange":[28.4667,33.5333]},{"name":"maximum","n":100,"entered":100,"exited":99,"fullCourseWins":59,"entrySpeedRange":[14.3107,24.4964],"entryFuelRange":[61.45,69.7833]},{"name":"engine-only","n":100,"entered":100,"exited":99,"fullCourseWins":54,"entrySpeedRange":[14.6686,24.521],"entryFuelRange":[21.4667,29.8833]},{"name":"tank-only","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"strong-F0","n":100,"entered":100,"exited":99,"fullCourseWins":59,"entrySpeedRange":[14.3107,24.4964],"entryFuelRange":[21.45,29.7833]},{"name":"recommended-minus-engine","n":100,"entered":100,"exited":100,"fullCourseWins":54,"entrySpeedRange":[12.5071,14.842],"entryFuelRange":[26.0167,31.8667]},{"name":"recommended-minus-suspension","n":100,"entered":100,"exited":100,"fullCourseWins":61,"entrySpeedRange":[12.285,16.3993],"entryFuelRange":[28.45,33.5333]},{"name":"recommended-minus-tires","n":100,"entered":100,"exited":100,"fullCourseWins":54,"entrySpeedRange":[14.1092,16.4661],"entryFuelRange":[28.4667,33.5333]},{"name":"recommended-minus-tank","n":100,"entered":100,"exited":100,"fullCourseWins":61,"entrySpeedRange":[14.3272,16.4701],"entryFuelRange":[24.4667,29.5333]},{"name":"recommended-S0","n":100,"entered":100,"exited":100,"fullCourseWins":46,"entrySpeedRange":[14.311,16.4149],"entryFuelRange":[28.45,33.5333]}]}},{"id":"stone-quarry-3","type":"rollers","name":"Хвиляста ділянка","from":420,"to":600,"geometry":{"firstVertex":421,"lastVertex":601,"heightChange":1.2789769243681803e-13,"maximumSlopeDegrees":25.2286881954481},"material":"dirt","entry":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.35,0.35],"angularSpeed":[-1.2,1.2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"exit":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.5,0.5],"angularSpeed":[-2,2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"recovery":{"from":600,"to":600},"pickups":{"coins":[29,30,31,32,33,34,35,36,37,38,39,40,41],"fuel":[1]},"validation":{"state":"measured within complete route, not isolated proof","source":"artifacts/pixel-drive-campaign-balance.json","reference":{"entry":{"x":420.151,"speed":21.971,"bodyAngle":0.0388,"angularSpeed":-0.0059,"groundedWheels":2,"suspensionCompression":[0.2778,0.1747],"fuelSeconds":47.9333,"tick":1461},"exit":{"x":600.1032,"speed":18.4566,"bodyAngle":0.0555,"angularSpeed":-0.0371,"groundedWheels":2,"suspensionCompression":[0.3072,0.168],"fuelSeconds":35.0167,"tick":2236}},"profiles":[{"name":"base","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"recommended","n":100,"entered":100,"exited":86,"fullCourseWins":61,"entrySpeedRange":[14.4813,22.0352],"entryFuelRange":[47.9,47.9333]},{"name":"maximum","n":100,"entered":99,"exited":82,"fullCourseWins":59,"entrySpeedRange":[15.1261,26.3346],"entryFuelRange":[79.8833,79.95]},{"name":"engine-only","n":100,"entered":99,"exited":76,"fullCourseWins":54,"entrySpeedRange":[14.9717,26.4213],"entryFuelRange":[39.8833,39.95]},{"name":"tank-only","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"strong-F0","n":100,"entered":99,"exited":82,"fullCourseWins":59,"entrySpeedRange":[15.1261,26.3346],"entryFuelRange":[39.8833,39.95]},{"name":"recommended-minus-engine","n":100,"entered":100,"exited":94,"fullCourseWins":54,"entrySpeedRange":[14.5005,20.5969],"entryFuelRange":[47.8833,47.9333]},{"name":"recommended-minus-suspension","n":100,"entered":100,"exited":87,"fullCourseWins":61,"entrySpeedRange":[14.4853,22.0017],"entryFuelRange":[47.9,47.9333]},{"name":"recommended-minus-tires","n":100,"entered":100,"exited":82,"fullCourseWins":54,"entrySpeedRange":[14.4763,22.0301],"entryFuelRange":[47.8833,47.9333]},{"name":"recommended-minus-tank","n":100,"entered":100,"exited":86,"fullCourseWins":61,"entrySpeedRange":[14.4813,22.0352],"entryFuelRange":[43.9,43.9333]},{"name":"recommended-S0","n":100,"entered":100,"exited":75,"fullCourseWins":46,"entrySpeedRange":[14.4304,22.0247],"entryFuelRange":[47.8833,47.9333]}]}},{"id":"stone-quarry-4","type":"climb","name":"Плавний схил","from":600,"to":665,"geometry":{"firstVertex":601,"lastVertex":666,"heightChange":12.15465320858695,"maximumSlopeDegrees":13.999999846632095},"material":"dirt","entry":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.35,0.35],"angularSpeed":[-1.2,1.2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"exit":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.5,0.5],"angularSpeed":[-2,2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"recovery":{"from":665,"to":665},"pickups":{"coins":[42,43,44,45,46],"fuel":[]},"validation":{"state":"measured within complete route, not isolated proof","source":"artifacts/pixel-drive-campaign-balance.json","reference":{"entry":{"x":600.1032,"speed":18.4566,"bodyAngle":0.0555,"angularSpeed":-0.0371,"groundedWheels":2,"suspensionCompression":[0.3072,0.168],"fuelSeconds":35.0167,"tick":2236},"exit":{"x":665.2505,"speed":20.0632,"bodyAngle":0.0266,"angularSpeed":-0.6742,"groundedWheels":0,"suspensionCompression":[0.0189,0.0049],"fuelSeconds":31.65,"tick":2438}},"profiles":[{"name":"base","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"recommended","n":100,"entered":86,"exited":86,"fullCourseWins":61,"entrySpeedRange":[14.5837,19.3583],"entryFuelRange":[32.3,36]},{"name":"maximum","n":100,"entered":82,"exited":82,"fullCourseWins":59,"entrySpeedRange":[14.373,22.3918],"entryFuelRange":[63.65,69.8833]},{"name":"engine-only","n":100,"entered":76,"exited":76,"fullCourseWins":54,"entrySpeedRange":[14.8376,21.836],"entryFuelRange":[24.4333,30.3333]},{"name":"tank-only","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"strong-F0","n":100,"entered":82,"exited":82,"fullCourseWins":59,"entrySpeedRange":[14.373,22.3918],"entryFuelRange":[23.65,29.8833]},{"name":"recommended-minus-engine","n":100,"entered":94,"exited":94,"fullCourseWins":54,"entrySpeedRange":[14.5351,18.7824],"entryFuelRange":[31.4167,35.3833]},{"name":"recommended-minus-suspension","n":100,"entered":87,"exited":87,"fullCourseWins":61,"entrySpeedRange":[14.6731,19.3342],"entryFuelRange":[28.85,36]},{"name":"recommended-minus-tires","n":100,"entered":82,"exited":82,"fullCourseWins":54,"entrySpeedRange":[14.4749,19.3556],"entryFuelRange":[32,35.4833]},{"name":"recommended-minus-tank","n":100,"entered":86,"exited":86,"fullCourseWins":61,"entrySpeedRange":[14.5837,19.3583],"entryFuelRange":[28.3,32]},{"name":"recommended-S0","n":100,"entered":75,"exited":75,"fullCourseWins":46,"entrySpeedRange":[14.8559,19.3749],"entryFuelRange":[30.45,35.3667]}]}},{"id":"stone-quarry-5","type":"jump","name":"Трамплін і посадка","from":665,"to":720,"geometry":{"firstVertex":666,"lastVertex":721,"heightChange":0,"maximumSlopeDegrees":7.802757978277677},"material":"dirt","entry":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.35,0.35],"angularSpeed":[-1.2,1.2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"exit":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.5,0.5],"angularSpeed":[-2,2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"recovery":{"from":720,"to":765},"pickups":{"coins":[47,48,49,50],"fuel":[]},"validation":{"state":"measured within complete route, not isolated proof","source":"artifacts/pixel-drive-campaign-balance.json","reference":{"entry":{"x":665.2505,"speed":20.0632,"bodyAngle":0.0266,"angularSpeed":-0.6742,"groundedWheels":0,"suspensionCompression":[0.0189,0.0049],"fuelSeconds":31.65,"tick":2438},"exit":{"x":720.1302,"speed":23.8692,"bodyAngle":0.0183,"angularSpeed":0.3309,"groundedWheels":2,"suspensionCompression":[0.439,0.3797],"fuelSeconds":29.05,"tick":2594}},"profiles":[{"name":"base","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"recommended","n":100,"entered":86,"exited":86,"fullCourseWins":61,"entrySpeedRange":[14.8623,20.8298],"entryFuelRange":[27.8667,32.7167]},{"name":"maximum","n":100,"entered":82,"exited":82,"fullCourseWins":59,"entrySpeedRange":[14.2921,25.5577],"entryFuelRange":[59.1333,67.1667]},{"name":"engine-only","n":100,"entered":76,"exited":76,"fullCourseWins":54,"entrySpeedRange":[14.8266,25.4441],"entryFuelRange":[19.9333,27.5833]},{"name":"tank-only","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"strong-F0","n":100,"entered":82,"exited":82,"fullCourseWins":59,"entrySpeedRange":[14.2921,25.5577],"entryFuelRange":[19.1333,27.1667]},{"name":"recommended-minus-engine","n":100,"entered":94,"exited":94,"fullCourseWins":54,"entrySpeedRange":[14.3714,19.7946],"entryFuelRange":[27.7167,31.9333]},{"name":"recommended-minus-suspension","n":100,"entered":87,"exited":87,"fullCourseWins":61,"entrySpeedRange":[14.2703,20.8122],"entryFuelRange":[25.1,32.7333]},{"name":"recommended-minus-tires","n":100,"entered":82,"exited":82,"fullCourseWins":54,"entrySpeedRange":[14.7242,20.7335],"entryFuelRange":[27.65,32.1333]},{"name":"recommended-minus-tank","n":100,"entered":86,"exited":86,"fullCourseWins":61,"entrySpeedRange":[14.8623,20.8298],"entryFuelRange":[23.8667,28.7167]},{"name":"recommended-S0","n":100,"entered":75,"exited":75,"fullCourseWins":46,"entrySpeedRange":[14.4936,20.7393],"entryFuelRange":[26.95,32.0333]}]}},{"id":"stone-quarry-6","type":"recovery","name":"Відновлення","from":720,"to":765,"geometry":{"firstVertex":721,"lastVertex":766,"heightChange":0,"maximumSlopeDegrees":0},"material":"dirt","entry":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.35,0.35],"angularSpeed":[-1.2,1.2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"exit":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.5,0.5],"angularSpeed":[-2,2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"recovery":{"from":765,"to":765},"pickups":{"coins":[51,52,53],"fuel":[]},"validation":{"state":"measured within complete route, not isolated proof","source":"artifacts/pixel-drive-campaign-balance.json","reference":{"entry":{"x":720.1302,"speed":23.8692,"bodyAngle":0.0183,"angularSpeed":0.3309,"groundedWheels":2,"suspensionCompression":[0.439,0.3797],"fuelSeconds":29.05,"tick":2594},"exit":{"x":765.3918,"speed":25.9412,"bodyAngle":0.006,"angularSpeed":-0.0645,"groundedWheels":2,"suspensionCompression":[0.2403,0.2257],"fuelSeconds":27.25,"tick":2702}},"profiles":[{"name":"base","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"recommended","n":100,"entered":86,"exited":86,"fullCourseWins":61,"entrySpeedRange":[13.5427,24.8535],"entryFuelRange":[24.1333,30.2167]},{"name":"maximum","n":100,"entered":82,"exited":82,"fullCourseWins":59,"entrySpeedRange":[14.6185,27.2351],"entryFuelRange":[55.3833,64.9167]},{"name":"engine-only","n":100,"entered":76,"exited":76,"fullCourseWins":54,"entrySpeedRange":[13.4105,27.159],"entryFuelRange":[16.1833,25.4167]},{"name":"tank-only","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"strong-F0","n":100,"entered":82,"exited":82,"fullCourseWins":59,"entrySpeedRange":[14.6185,27.2351],"entryFuelRange":[15.3833,24.9167]},{"name":"recommended-minus-engine","n":100,"entered":94,"exited":94,"fullCourseWins":54,"entrySpeedRange":[14.8494,24.0379],"entryFuelRange":[23.9333,29.3]},{"name":"recommended-minus-suspension","n":100,"entered":87,"exited":87,"fullCourseWins":61,"entrySpeedRange":[14.2774,24.8819],"entryFuelRange":[22,30.1167]},{"name":"recommended-minus-tires","n":100,"entered":82,"exited":82,"fullCourseWins":54,"entrySpeedRange":[14.5135,24.8734],"entryFuelRange":[23.8667,29.5833]},{"name":"recommended-minus-tank","n":100,"entered":86,"exited":86,"fullCourseWins":61,"entrySpeedRange":[13.5427,24.8535],"entryFuelRange":[20.1333,26.2167]},{"name":"recommended-S0","n":100,"entered":75,"exited":75,"fullCourseWins":46,"entrySpeedRange":[14.0769,24.9077],"entryFuelRange":[23.9333,29.5667]}]}},{"id":"stone-quarry-7","type":"rollers","name":"Хвиляста ділянка","from":765,"to":945,"geometry":{"firstVertex":766,"lastVertex":946,"heightChange":-2.842170943040401e-14,"maximumSlopeDegrees":32.137654540171404},"material":"dirt","entry":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.35,0.35],"angularSpeed":[-1.2,1.2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"exit":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.5,0.5],"angularSpeed":[-2,2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"recovery":{"from":945,"to":1000},"pickups":{"coins":[54,55,56,57,58,59,60,61,62,63,64,65,66],"fuel":[]},"validation":{"state":"measured within complete route, not isolated proof","source":"artifacts/pixel-drive-campaign-balance.json","reference":{"entry":{"x":765.3918,"speed":25.9412,"bodyAngle":0.006,"angularSpeed":-0.0645,"groundedWheels":2,"suspensionCompression":[0.2403,0.2257],"fuelSeconds":27.25,"tick":2702},"exit":{"x":945.1908,"speed":18.243,"bodyAngle":0.0567,"angularSpeed":-0.0599,"groundedWheels":2,"suspensionCompression":[0.3109,0.1666],"fuelSeconds":11.9667,"tick":3619}},"profiles":[{"name":"base","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"recommended","n":100,"entered":86,"exited":61,"fullCourseWins":61,"entrySpeedRange":[14.5392,26.8021],"entryFuelRange":[21.0833,28.4667]},{"name":"maximum","n":100,"entered":82,"exited":59,"fullCourseWins":59,"entrySpeedRange":[15.1526,31.033],"entryFuelRange":[52.3167,63.3333]},{"name":"engine-only","n":100,"entered":76,"exited":54,"fullCourseWins":54,"entrySpeedRange":[14.99,30.9846],"entryFuelRange":[13.15,23.8333]},{"name":"tank-only","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"strong-F0","n":100,"entered":82,"exited":59,"fullCourseWins":59,"entrySpeedRange":[15.1526,31.033],"entryFuelRange":[12.3167,23.3333]},{"name":"recommended-minus-engine","n":100,"entered":94,"exited":54,"fullCourseWins":54,"entrySpeedRange":[14.6204,25.8539],"entryFuelRange":[20.9167,27.3167]},{"name":"recommended-minus-suspension","n":100,"entered":87,"exited":61,"fullCourseWins":61,"entrySpeedRange":[14.6132,26.8217],"entryFuelRange":[19.5333,28.3167]},{"name":"recommended-minus-tires","n":100,"entered":82,"exited":54,"fullCourseWins":54,"entrySpeedRange":[14.7234,26.8302],"entryFuelRange":[20.8667,27.8333]},{"name":"recommended-minus-tank","n":100,"entered":86,"exited":61,"fullCourseWins":61,"entrySpeedRange":[14.5392,26.8021],"entryFuelRange":[17.0833,24.4667]},{"name":"recommended-S0","n":100,"entered":75,"exited":46,"fullCourseWins":46,"entrySpeedRange":[14.5325,26.8376],"entryFuelRange":[20.8833,27.8167]}]}},{"id":"stone-quarry-8","type":"recovery","name":"Відновлення","from":945,"to":1000,"geometry":{"firstVertex":946,"lastVertex":1001,"heightChange":0,"maximumSlopeDegrees":0},"material":"dirt","entry":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.35,0.35],"angularSpeed":[-1.2,1.2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"exit":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.5,0.5],"angularSpeed":[-2,2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"recovery":{"from":1000,"to":1000},"pickups":{"coins":[67,68,69],"fuel":[]},"validation":{"state":"measured within complete route, not isolated proof","source":"artifacts/pixel-drive-campaign-balance.json","reference":{"entry":{"x":945.1908,"speed":18.243,"bodyAngle":0.0567,"angularSpeed":-0.0599,"groundedWheels":2,"suspensionCompression":[0.3109,0.1666],"fuelSeconds":11.9667,"tick":3619},"exit":{"x":1000.1459,"speed":24.0068,"bodyAngle":0.0331,"angularSpeed":-0.0068,"groundedWheels":2,"suspensionCompression":[0.2694,0.1865],"fuelSeconds":9.4,"tick":3773}},"profiles":[{"name":"base","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"recommended","n":100,"entered":61,"exited":61,"fullCourseWins":61,"entrySpeedRange":[14.5787,18.3894],"entryFuelRange":[0.2667,14.3833]},{"name":"maximum","n":100,"entered":59,"exited":59,"fullCourseWins":59,"entrySpeedRange":[14.9833,21.2746],"entryFuelRange":[35.1333,51.8833]},{"name":"engine-only","n":100,"entered":54,"exited":54,"fullCourseWins":54,"entrySpeedRange":[7.4344,21.0394],"entryFuelRange":[0,12.0667]},{"name":"tank-only","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"strong-F0","n":100,"entered":59,"exited":59,"fullCourseWins":59,"entrySpeedRange":[7.2271,21.2746],"entryFuelRange":[0,11.8833]},{"name":"recommended-minus-engine","n":100,"entered":54,"exited":54,"fullCourseWins":54,"entrySpeedRange":[14.7655,18.0469],"entryFuelRange":[1,12.45]},{"name":"recommended-minus-suspension","n":100,"entered":61,"exited":61,"fullCourseWins":61,"entrySpeedRange":[14.7703,18.4802],"entryFuelRange":[1.75,13.3333]},{"name":"recommended-minus-tires","n":100,"entered":54,"exited":54,"fullCourseWins":54,"entrySpeedRange":[14.5226,18.4589],"entryFuelRange":[2.85,13.9667]},{"name":"recommended-minus-tank","n":100,"entered":61,"exited":61,"fullCourseWins":61,"entrySpeedRange":[6.5396,18.3894],"entryFuelRange":[0,10.3833]},{"name":"recommended-S0","n":100,"entered":46,"exited":46,"fullCourseWins":46,"entrySpeedRange":[13.271,18.2284],"entryFuelRange":[0,13.3167]}]}}],"fuel":[120,420],"seed":4207703611,"generatorVersion":3,"length":1000,"max_ticks":36000,"terrain":[[-100,12],[0,12],[1,12.000108],[2,12.000663],[3,12.001936],[4,12.00415],[5,12.007456],[6,12.011924],[7,12.017533],[8,12.024165],[9,12.031609],[10,12.039558],[11,12.047622],[12,12.055342],[13,12.0622],[14,12.067647],[15,12.07112],[16,12.072068],[17,12.069977],[18,12.064396],[19,12.054959],[20,12.04141],[21,12.023623],[22,12.001614],[23,11.975554],[24,11.945779],[25,11.912784],[26,11.877226],[27,11.839906],[28,11.801757],[29,11.763824],[30,11.727232],[31,11.69316],[32,11.662805],[33,11.637349],[34,11.617917],[35,11.605542],[36,11.601131],[37,11.605425],[38,11.618976],[39,11.642114],[40,11.674932],[41,11.717268],[42,11.7687],[43,11.828543],[44,11.895862],[45,11.969481],[46,12.048009],[47,12.12987],[48,12.213336],[49,12.296567],[50,12.377661],[51,12.454696],[52,12.525785],[53,12.589122],[54,12.643033],[55,12.686022],[56,12.716814],[57,12.734393],[58,12.738032],[59,12.727317],[60,12.702166],[61,12.662832],[62,12.609906],[63,12.544304],[64,12.467251],[65,12.380249],[66,12.285048],[67,12.183601],[68,12.078018],[69,11.970515],[70,11.863359],[71,11.758813],[72,11.659081],[73,11.56625],[74,11.482247],[75,11.408781],[76,11.347314],[77,11.299018],[78,11.264751],[79,11.24504],[80,11.240073],[81,11.249692],[82,11.273408],[83,11.310417],[84,11.359623],[85,11.41967],[86,11.488984],[87,11.565812],[88,11.648276],[89,11.734416],[90,11.822247],[91,11.909806],[92,11.995202],[93,12.076665],[94,12.152582],[95,12.221537],[96,12.282339],[97,12.334046],[98,12.375981],[99,12.407738],[100,12.42918],[101,12.440437],[102,12.441885],[103,12.43413],[104,12.417977],[105,12.3944],[106,12.364508],[107,12.329504],[108,12.29065],[109,12.249226],[110,12.206492],[111,12.163655],[112,12.121834],[113,12.082033],[114,12.045119],[115,12.011803],[116,11.982631],[117,11.957975],[118,11.938035],[119,11.922843],[120,11.912279],[121,11.90608],[122,11.903865],[123,11.905154],[124,11.909398],[125,11.915999],[126,11.924341],[127,11.933814],[128,11.943838],[129,11.953883],[130,11.963492],[131,11.972288],[132,11.979991],[133,11.98642],[134,11.991496],[135,11.995234],[136,11.997743],[137,11.999205],[138,11.99987],[139,12.000028],[140,12],[141,12.000918],[142,12.008868],[143,12.030084],[144,12.06997],[145,12.133099],[146,12.223212],[147,12.343218],[148,12.495195],[149,12.680391],[150,12.899222],[151,13.15127],[152,13.435291],[153,13.749204],[154,14.090101],[155,14.454241],[156,14.837051],[157,15.233128],[158,15.636236],[159,16.040262],[160,16.444288],[161,16.848315],[162,17.252341],[163,17.656367],[164,18.060393],[165,18.46442],[166,18.868446],[167,19.272472],[168,19.676498],[169,20.080525],[170,20.484551],[171,20.888577],[172,21.292603],[173,21.696629],[174,22.100656],[175,22.504682],[176,22.908708],[177,23.312734],[178,23.716761],[179,24.120787],[180,24.524813],[181,24.928839],[182,25.332865],[183,25.736892],[184,26.140918],[185,26.544944],[186,26.94897],[187,27.352997],[188,27.757023],[189,28.161049],[190,28.565075],[191,28.969101],[192,29.373128],[193,29.777154],[194,30.18118],[195,30.585206],[196,30.989233],[197,31.393259],[198,31.797285],[199,32.201311],[200,32.605338],[201,33.009364],[202,33.41339],[203,33.817416],[204,34.221442],[205,34.625469],[206,35.029495],[207,35.433521],[208,35.837547],[209,36.241574],[210,36.6456],[211,37.049626],[212,37.453652],[213,37.857678],[214,38.261705],[215,38.665731],[216,39.069757],[217,39.473783],[218,39.87781],[219,40.281836],[220,40.685862],[221,41.089888],[222,41.493914],[223,41.897941],[224,42.301967],[225,42.705993],[226,43.110019],[227,43.514046],[228,43.918072],[229,44.322098],[230,44.726124],[231,45.130151],[232,45.534177],[233,45.938203],[234,46.342229],[235,46.746255],[236,47.150282],[237,47.554308],[238,47.958334],[239,48.36236],[240,48.766387],[241,49.170413],[242,49.574439],[243,49.978465],[244,50.382491],[245,50.786518],[246,51.190544],[247,51.59457],[248,51.998596],[249,52.402623],[250,52.806649],[251,53.210675],[252,53.614701],[253,54.018727],[254,54.422754],[255,54.82678],[256,55.230806],[257,55.634832],[258,56.038859],[259,56.442885],[260,56.846911],[261,57.250937],[262,57.654964],[263,58.05899],[264,58.463016],[265,58.867042],[266,59.271068],[267,59.675095],[268,60.079121],[269,60.483147],[270,60.887173],[271,61.2912],[272,61.695226],[273,62.099252],[274,62.503278],[275,62.907304],[276,63.311331],[277,63.715357],[278,64.119383],[279,64.523409],[280,64.927436],[281,65.331462],[282,65.735488],[283,66.139514],[284,66.54354],[285,66.947567],[286,67.351593],[287,67.755619],[288,68.159645],[289,68.563672],[290,68.967698],[291,69.371724],[292,69.77575],[293,70.179777],[294,70.583803],[295,70.987829],[296,71.391855],[297,71.795881],[298,72.199908],[299,72.603934],[300,73.00796],[301,73.411986],[302,73.816013],[303,74.220039],[304,74.624065],[305,75.028091],[306,75.432117],[307,75.836144],[308,76.24017],[309,76.644196],[310,77.048222],[311,77.452249],[312,77.856275],[313,78.260301],[314,78.664327],[315,79.068353],[316,79.47238],[317,79.876406],[318,80.280432],[319,80.684458],[320,81.088485],[321,81.492511],[322,81.896537],[323,82.300563],[324,82.70459],[325,83.108616],[326,83.512642],[327,83.916668],[328,84.320694],[329,84.724721],[330,85.128747],[331,85.532773],[332,85.936799],[333,86.340826],[334,86.744852],[335,87.148878],[336,87.552904],[337,87.95693],[338,88.360957],[339,88.764983],[340,89.169009],[341,89.573035],[342,89.977062],[343,90.381088],[344,90.785114],[345,91.18914],[346,91.593166],[347,91.997193],[348,92.401219],[349,92.805245],[350,93.209271],[351,93.613298],[352,94.017324],[353,94.42135],[354,94.825376],[355,95.229403],[356,95.633429],[357,96.037455],[358,96.441481],[359,96.845507],[360,97.249534],[361,97.65356],[362,98.057586],[363,98.460694],[364,98.856771],[365,99.239581],[366,99.603721],[367,99.944618],[368,100.258531],[369,100.542552],[370,100.794601],[371,101.013431],[372,101.198627],[373,101.350604],[374,101.47061],[375,101.560723],[376,101.623852],[377,101.663738],[378,101.684955],[379,101.692904],[380,101.693822],[381,101.693822],[382,101.693822],[383,101.693822],[384,101.693822],[385,101.693822],[386,101.693822],[387,101.693822],[388,101.693822],[389,101.693822],[390,101.693822],[391,101.693822],[392,101.693822],[393,101.693822],[394,101.693822],[395,101.693822],[396,101.693822],[397,101.693822],[398,101.693822],[399,101.693822],[400,101.693822],[401,101.693822],[402,101.693822],[403,101.693822],[404,101.693822],[405,101.693822],[406,101.693822],[407,101.693822],[408,101.693822],[409,101.693822],[410,101.693822],[411,101.693822],[412,101.693822],[413,101.693822],[414,101.693822],[415,101.693822],[416,101.693822],[417,101.693822],[418,101.693822],[419,101.693822],[420,101.693822],[421,101.694001],[422,101.695049],[423,101.697279],[424,101.700397],[425,101.703482],[426,101.705141],[427,101.70383],[428,101.698273],[429,101.687898],[430,101.67318],[431,101.655807],[432,101.638605],[433,101.625199],[434,101.619441],[435,101.624683],[436,101.643022],[437,101.674642],[438,101.717408],[439,101.766805],[440,101.816296],[441,101.858085],[442,101.884207],[443,101.887806],[444,101.864412],[445,101.813001],[446,101.736649],[447,101.642616],[448,101.541796],[449,101.447537],[450,101.373952],[451,101.333931],[452,101.337113],[453,101.388133],[454,101.485423],[455,101.620796],[456,101.779954],[457,101.943908],[458,102.091203],[459,102.200679],[460,102.254422],[461,102.240501],[462,102.155086],[463,102.003601],[464,101.800694],[465,101.568928],[466,101.336309],[467,101.132903],[468,100.986953],[469,100.921008],[470,100.948574],[471,101.071788],[472,101.280478],[473,101.552821],[474,101.85757],[475,102.157664],[476,102.414765],[477,102.594201],[478,102.669632],[479,102.62685],[480,102.466136],[481,102.202828],[482,101.865946],[483,101.494981],[484,101.135209],[485,100.832085],[486,100.625429],[487,100.544154],[488,100.602233],[489,100.79648],[490,101.10647],[491,101.496679],[492,101.920609],[493,102.326424],[494,102.663393],[495,102.888339],[496,102.971242],[497,102.899282],[498,102.678752],[499,102.334584],[500,101.907481],[501,101.449021],[502,101.015309],[503,100.659985],[504,100.427469],[505,100.347313],[506,100.43038],[507,100.667368],[508,101.029864],[509,101.473817],[510,101.944993],[511,102.385728],[512,102.742119],[513,102.970742],[514,103.044046],[515,102.953735],[516,102.711722],[517,102.348542],[518,101.909433],[519,101.448601],[520,101.022406],[521,100.682339],[522,100.468688],[523,100.405672],[524,100.498656],[525,100.733768],[526,101.07992],[527,101.492966],[528,101.921407],[529,102.312924],[530,102.620872],[531,102.809936],[532,102.860237],[533,102.769412],[534,102.552452],[535,102.239371],[536,101.871058],[537,101.493884],[538,101.15379],[539,100.89061],[540,100.733341],[541,100.69694],[542,100.780984],[543,100.970318],[544,101.237519],[545,101.546811],[546,101.858861],[547,102.13582],[548,102.345965],[549,102.467342],[550,102.490022],[551,102.416716],[552,102.261778],[553,102.048771],[554,101.807012],[555,101.567571],[556,101.359277],[557,101.205244],[558,101.12034],[559,101.109862],[560,101.169523],[561,101.286663],[562,101.442464],[563,101.614787],[564,101.781245],[565,101.922065],[566,102.022403],[567,102.073821],[568,102.074811],[569,102.030367],[570,101.950727],[571,101.849544],[572,101.74176],[573,101.641518],[574,101.560377],[575,101.506062],[576,101.481864],[577,101.486717],[578,101.515864],[579,101.561971],[580,101.616472],[581,101.670928],[582,101.718206],[583,101.753305],[584,101.773775],[585,101.779682],[586,101.773201],[587,101.757936],[588,101.738111],[589,101.717788],[590,101.700226],[591,101.687479],[592,101.680277],[593,101.678162],[594,101.679824],[595,101.683558],[596,101.687717],[597,101.691083],[598,101.693078],[599,101.693791],[600,101.693822],[601,101.694516],[602,101.700497],[603,101.716385],[604,101.746102],[605,101.792872],[606,101.859224],[607,101.946988],[608,102.057296],[609,102.190584],[610,102.346592],[611,102.524359],[612,102.722231],[613,102.937854],[614,103.168177],[615,103.409453],[616,103.657237],[617,103.906565],[618,104.155893],[619,104.405221],[620,104.654549],[621,104.903877],[622,105.153205],[623,105.402533],[624,105.651861],[625,105.901189],[626,106.150517],[627,106.399845],[628,106.649173],[629,106.898501],[630,107.147829],[631,107.397157],[632,107.646485],[633,107.895813],[634,108.145141],[635,108.394469],[636,108.643797],[637,108.893125],[638,109.142453],[639,109.391781],[640,109.641109],[641,109.890437],[642,110.139765],[643,110.389093],[644,110.638421],[645,110.887749],[646,111.137077],[647,111.386405],[648,111.635733],[649,111.885061],[650,112.132844],[651,112.37412],[652,112.604444],[653,112.820066],[654,113.017938],[655,113.195706],[656,113.351713],[657,113.485002],[658,113.59531],[659,113.683073],[660,113.749425],[661,113.796196],[662,113.825913],[663,113.841801],[664,113.847782],[665,113.848475],[666,113.856302],[667,113.879678],[668,113.9183],[669,113.971664],[670,114.039075],[671,114.119653],[672,114.212348],[673,114.315952],[674,114.429114],[675,114.550359],[676,114.678106],[677,114.81069],[678,114.946382],[679,115.083414],[680,115.219999],[681,115.354356],[682,115.484734],[683,115.609434],[684,115.726828],[685,115.835388],[686,115.933698],[687,116.020477],[688,116.094592],[689,116.155078],[690,116.201146],[691,116.232196],[692,116.247823],[693,116.247823],[694,116.232196],[695,116.201146],[696,116.155078],[697,116.094592],[698,116.020477],[699,115.933698],[700,115.835388],[701,115.726828],[702,115.609434],[703,115.484734],[704,115.354356],[705,115.219999],[706,115.083414],[707,114.946382],[708,114.81069],[709,114.678106],[710,114.550359],[711,114.429114],[712,114.315952],[713,114.212348],[714,114.119653],[715,114.039075],[716,113.971664],[717,113.9183],[718,113.879678],[719,113.856302],[720,113.848475],[721,113.848475],[722,113.848475],[723,113.848475],[724,113.848475],[725,113.848475],[726,113.848475],[727,113.848475],[728,113.848475],[729,113.848475],[730,113.848475],[731,113.848475],[732,113.848475],[733,113.848475],[734,113.848475],[735,113.848475],[736,113.848475],[737,113.848475],[738,113.848475],[739,113.848475],[740,113.848475],[741,113.848475],[742,113.848475],[743,113.848475],[744,113.848475],[745,113.848475],[746,113.848475],[747,113.848475],[748,113.848475],[749,113.848475],[750,113.848475],[751,113.848475],[752,113.848475],[753,113.848475],[754,113.848475],[755,113.848475],[756,113.848475],[757,113.848475],[758,113.848475],[759,113.848475],[760,113.848475],[761,113.848475],[762,113.848475],[763,113.848475],[764,113.848475],[765,113.848475],[766,113.848715],[767,113.850115],[768,113.853089],[769,113.857242],[770,113.861344],[771,113.863535],[772,113.861759],[773,113.85432],[774,113.840464],[775,113.82083],[776,113.79768],[777,113.774785],[778,113.75698],[779,113.749396],[780,113.756494],[781,113.781053],[782,113.823299],[783,113.880365],[784,113.946215],[785,114.012123],[786,114.067694],[787,114.102315],[788,114.106868],[789,114.075422],[790,114.006649],[791,113.904686],[792,113.779248],[793,113.644882],[794,113.519394],[795,113.421592],[796,113.368635],[797,113.373329],[798,113.441799],[799,113.571891],[800,113.752634],[801,113.964915],[802,114.183388],[803,114.379446],[804,114.524901],[805,114.595919],[806,114.576666],[807,114.462122],[808,114.259608],[809,113.988732],[810,113.67964],[811,113.369699],[812,113.098989],[813,112.905125],[814,112.81809],[815,112.855787],[816,113.020948],[817,113.299897],[818,113.663433],[819,114.06983],[820,114.469644],[821,114.81178],[822,115.050073],[823,115.149514],[824,115.091292],[825,114.875928],[826,114.524013],[827,114.074357],[828,113.579687],[829,113.100392],[830,112.697047],[831,112.422655],[832,112.315634],[833,112.394453],[834,112.654693],[835,113.068961],[836,113.589767],[837,114.155037],[838,114.695641],[839,115.143987],[840,115.442613],[841,115.551646],[842,115.454175],[843,115.158781],[844,114.698872],[845,114.128853],[846,113.517567],[847,112.939827],[848,112.467094],[849,112.158471],[850,112.053189],[851,112.165542],[852,112.48293],[853,112.967295],[854,113.559774],[855,114.187989],[856,114.775056],[857,115.249176],[858,115.552582],[859,115.648714],[860,115.526706],[861,115.20264],[862,114.717394],[863,114.131406],[864,113.517008],[865,112.949335],[866,112.496965],[867,112.21348],[868,112.131],[869,112.25649],[870,112.571267],[871,113.033731],[872,113.584911],[873,114.1561],[874,114.677556],[875,115.087168],[876,115.337978],[877,115.403641],[878,115.281182],[879,114.990753],[880,114.572504],[881,114.081041],[882,113.578224],[883,113.125283],[884,112.775251],[885,112.566673],[886,112.519346],[887,112.632557],[888,112.885963],[889,113.242892],[890,113.655576],[891,114.07155],[892,114.440383],[893,114.719845],[894,114.88077],[895,114.910037],[896,114.811384],[897,114.604053],[898,114.319545],[899,113.996994],[900,113.677832],[901,113.400466],[902,113.195655],[903,113.08314],[904,113.069891],[905,113.1501],[906,113.306814],[907,113.514887],[908,113.744777],[909,113.966634],[910,114.154128],[911,114.287512],[912,114.355598],[913,114.356442],[914,114.296758],[915,114.190247],[916,114.05514],[917,113.91137],[918,113.777785],[919,113.669773],[920,113.597598],[921,113.56561],[922,113.572346],[923,113.611433],[924,113.673069],[925,113.745822],[926,113.818443],[927,113.881427],[928,113.928131],[929,113.955304],[930,113.963059],[931,113.95431],[932,113.933875],[933,113.907394],[934,113.880281],[935,113.856873],[936,113.839905],[937,113.830338],[938,113.827551],[939,113.829795],[940,113.834791],[941,113.840344],[942,113.844832],[943,113.847488],[944,113.848435],[945,113.848475],[946,113.848475],[947,113.848475],[948,113.848475],[949,113.848475],[950,113.848475],[951,113.848475],[952,113.848475],[953,113.848475],[954,113.848475],[955,113.848475],[956,113.848475],[957,113.848475],[958,113.848475],[959,113.848475],[960,113.848475],[961,113.848475],[962,113.848475],[963,113.848475],[964,113.848475],[965,113.848475],[966,113.848475],[967,113.848475],[968,113.848475],[969,113.848475],[970,113.848475],[971,113.848475],[972,113.848475],[973,113.848475],[974,113.848475],[975,113.848475],[976,113.848475],[977,113.848475],[978,113.848475],[979,113.848475],[980,113.848475],[981,113.848475],[982,113.848475],[983,113.848475],[984,113.848475],[985,113.848475],[986,113.848475],[987,113.848475],[988,113.848475],[989,113.848475],[990,113.848475],[991,113.848475],[992,113.848475],[993,113.848475],[994,113.848475],[995,113.848475],[996,113.848475],[997,113.848475],[998,113.848475],[999,113.848475],[1000,113.848475],[1080,113.84847534399132]],"linearTerrain":true,"surfaces":[],"gears":[17.18,32.33,47.24,58.89,75.46,87.52,100.69,115,130.03,142.85,159.32,171.88,187.4,199.24,214.92,228.48,242.59,254.74,268.96,283.35,297.8,313.44,326.3,338.71,354.57,367.13,380.59,396.8,410.8,423.93,437.66,453.18,466.47,479.36,495.15,509.11,521.83,537.46,549.35,564.1,577.63,590.58,604.73,620.87,634.98,648.62,662.23,675.02,690.84,704.06,717.88,732.69,745.41,761.39,775.38,788.79,800.77,817.02,831.34,845.17,859.04,872.18,884.98,900.5,912.99,928.4,941.04,956.2,969.99,984.49],"coinValues":[25,25,25,25,25,25,25,25,25,25,25,25,25,25,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,40,40,40,40,40,40,40,40,40,40,40,40,40],"bridges":[],"checkpoints":[{"id":"stone-quarry-checkpoint-0","x":380,"reward":260},{"id":"stone-quarry-checkpoint-1","x":600,"reward":260},{"id":"stone-quarry-checkpoint-2","x":945,"reward":260}],"fuelValidation":{"state":"measured in complete recommended-profile simulation","targetRho":[0.6,0.75],"referenceProfile":{"engine":4,"suspension":3,"tires":3,"tank":2},"legs":[{"from":9,"to":120,"T_ref":7.6333,"C_ref":48,"rho":0.159,"fuelRemaining":40.3667,"arrivalTick":458},{"from":120,"to":420,"T_ref":16.65,"C_ref":48,"rho":0.3469,"fuelRemaining":31.35,"arrivalTick":1457},{"from":420,"to":1009,"T_ref":38.9667,"C_ref":48,"rho":0.8118,"fuelRemaining":9.0333,"arrivalTick":3795,"finish":true}]},"streams":{"geometry":"geometry","coins":"coins","fuel":"fuel","decorations":"decorations","fuelMarker":0.7085194003302604},"decorationSeed":4094369012,"validation":{"state":"measured full-course attempts","sampleCount":1100,"source":"artifacts/pixel-drive-campaign-balance.json","notAnImpossibilityProof":true,"profiles":[{"name":"base","upgrades":{"engine":0,"suspension":0,"tires":0,"tank":0},"n":100,"wins":0,"distanceRange":[233.9,290.59],"failures":{"route_exit":100}},{"name":"recommended","upgrades":{"engine":4,"suspension":3,"tires":3,"tank":2},"n":100,"wins":61,"distanceRange":[492.89,1000.4],"failures":{"overturned":36,"fuel":3}},{"name":"maximum","upgrades":{"engine":10,"suspension":10,"tires":10,"tank":10},"n":100,"wins":59,"distanceRange":[396.45,1000.47],"failures":{"overturned":41}},{"name":"engine-only","upgrades":{"engine":10,"suspension":0,"tires":0,"tank":0},"n":100,"wins":54,"distanceRange":[396.61,1000.46],"failures":{"overturned":46}},{"name":"tank-only","upgrades":{"engine":0,"suspension":0,"tires":0,"tank":10},"n":100,"wins":0,"distanceRange":[233.9,290.59],"failures":{"route_exit":90,"fuel":10}},{"name":"strong-F0","upgrades":{"engine":10,"suspension":10,"tires":10,"tank":0},"n":100,"wins":59,"distanceRange":[396.45,1000.47],"failures":{"overturned":41}},{"name":"recommended-minus-engine","upgrades":{"engine":3,"suspension":3,"tires":3,"tank":2},"n":100,"wins":54,"distanceRange":[487.84,1000.38],"failures":{"overturned":39,"fuel":7}},{"name":"recommended-minus-suspension","upgrades":{"engine":4,"suspension":2,"tires":3,"tank":2},"n":100,"wins":61,"distanceRange":[492.46,1000.36],"failures":{"overturned":34,"fuel":5}},{"name":"recommended-minus-tires","upgrades":{"engine":4,"suspension":3,"tires":2,"tank":2},"n":100,"wins":54,"distanceRange":[485.42,1000.4],"failures":{"overturned":44,"fuel":2}},{"name":"recommended-minus-tank","upgrades":{"engine":4,"suspension":3,"tires":3,"tank":1},"n":100,"wins":61,"distanceRange":[492.89,1000.4],"failures":{"overturned":36,"fuel":3}},{"name":"recommended-S0","upgrades":{"engine":4,"suspension":0,"tires":3,"tank":2},"n":100,"wins":46,"distanceRange":[485.96,1000.41],"failures":{"overturned":52,"fuel":2}}],"reference":{"upgrades":{"engine":4,"suspension":3,"tires":3,"tank":2},"targetSpeed":26,"holdTicks":12,"ticks":3795,"seconds":63.25,"inputChanges":39}}},{"id":4,"stageId":"mountain-pass","campaignIndex":3,"name":"Гірський перевал","meters":1600,"recommended":{"engine":6,"suspension":4,"tires":5,"tank":4},"finishReward":1700,"description":"Довгі навантаження чергуються з гребенями. Тяга і шини допомагають зберігати інерцію.","challenge":"Тривала тяга та зчеплення","hint":"Збережи розгін перед підйомом і вирівняй авто на гребені.","modules":[{"id":"mountain-pass-0","type":"intro","name":"Знайомий початок","from":0,"to":160,"geometry":{"firstVertex":1,"lastVertex":161,"heightChange":-5.329070518200751e-15,"maximumSlopeDegrees":6.706216587109976},"material":"dirt","entry":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.35,0.35],"angularSpeed":[-1.2,1.2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"exit":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.5,0.5],"angularSpeed":[-2,2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"recovery":{"from":160,"to":160},"pickups":{"coins":[0,1,2,3,4,5,6,7,8,9,10],"fuel":[0]},"validation":{"state":"measured within complete route, not isolated proof","source":"artifacts/pixel-drive-campaign-balance.json","reference":{"entry":{"x":9,"speed":0,"bodyAngle":0,"angularSpeed":0,"groundedWheels":2,"suspensionCompression":[0,0],"fuelSeconds":56,"tick":0},"exit":{"x":160.0034,"speed":24.1515,"bodyAngle":0.0139,"angularSpeed":0.0209,"groundedWheels":2,"suspensionCompression":[0.2344,0.2013],"fuelSeconds":55.1,"tick":532}},"profiles":[{"name":"base","n":100,"entered":100,"exited":100,"fullCourseWins":0,"entrySpeedRange":[0.1509,0.151],"entryFuelRange":[39.9833,39.9833]},{"name":"recommended","n":100,"entered":100,"exited":100,"fullCourseWins":91,"entrySpeedRange":[0.1503,0.1506],"entryFuelRange":[55.9833,55.9833]},{"name":"maximum","n":100,"entered":100,"exited":100,"fullCourseWins":94,"entrySpeedRange":[0.1494,0.1499],"entryFuelRange":[79.9833,79.9833]},{"name":"engine-only","n":100,"entered":100,"exited":100,"fullCourseWins":84,"entrySpeedRange":[0.1509,0.1514],"entryFuelRange":[39.9833,39.9833]},{"name":"tank-only","n":100,"entered":100,"exited":100,"fullCourseWins":0,"entrySpeedRange":[0.1509,0.151],"entryFuelRange":[79.9833,79.9833]},{"name":"strong-F0","n":100,"entered":100,"exited":100,"fullCourseWins":90,"entrySpeedRange":[0.1494,0.1499],"entryFuelRange":[39.9833,39.9833]},{"name":"recommended-minus-engine","n":100,"entered":100,"exited":100,"fullCourseWins":86,"entrySpeedRange":[0.1503,0.1506],"entryFuelRange":[55.9833,55.9833]},{"name":"recommended-minus-suspension","n":100,"entered":100,"exited":100,"fullCourseWins":89,"entrySpeedRange":[0.1505,0.1508],"entryFuelRange":[55.9833,55.9833]},{"name":"recommended-minus-tires","n":100,"entered":100,"exited":100,"fullCourseWins":91,"entrySpeedRange":[0.1503,0.1506],"entryFuelRange":[55.9833,55.9833]},{"name":"recommended-minus-tank","n":100,"entered":100,"exited":100,"fullCourseWins":90,"entrySpeedRange":[0.1503,0.1506],"entryFuelRange":[51.9833,51.9833]}]}},{"id":"mountain-pass-1","type":"torque","name":"Контрольний підйом","from":160,"to":420,"geometry":{"firstVertex":161,"lastVertex":421,"heightChange":118.0312864329386,"maximumSlopeDegrees":26.000019043346352},"material":"dirt","entry":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.35,0.35],"angularSpeed":[-1.2,1.2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"exit":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.5,0.5],"angularSpeed":[-2,2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"recovery":{"from":420,"to":480},"pickups":{"coins":[11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28],"fuel":[]},"validation":{"state":"measured within complete route, not isolated proof","source":"artifacts/pixel-drive-campaign-balance.json","reference":{"entry":{"x":160.0034,"speed":24.1515,"bodyAngle":0.0139,"angularSpeed":0.0209,"groundedWheels":2,"suspensionCompression":[0.2344,0.2013],"fuelSeconds":55.1,"tick":532},"exit":{"x":420.1834,"speed":16.4876,"bodyAngle":0.5312,"angularSpeed":0.7596,"groundedWheels":1,"suspensionCompression":[0.1184,-0.0096],"fuelSeconds":39.3667,"tick":1476}},"profiles":[{"name":"base","n":100,"entered":100,"exited":0,"fullCourseWins":0,"entrySpeedRange":[14.3637,22.5674],"entryFuelRange":[38.5167,39.0333]},{"name":"recommended","n":100,"entered":100,"exited":100,"fullCourseWins":91,"entrySpeedRange":[14.7488,28.5573],"entryFuelRange":[54.55,55.2333]},{"name":"maximum","n":100,"entered":100,"exited":100,"fullCourseWins":94,"entrySpeedRange":[14.6185,31.6686],"entryFuelRange":[78.55,79.3]},{"name":"engine-only","n":100,"entered":100,"exited":100,"fullCourseWins":84,"entrySpeedRange":[14.4332,31.5979],"entryFuelRange":[38.5167,39.3]},{"name":"tank-only","n":100,"entered":100,"exited":0,"fullCourseWins":0,"entrySpeedRange":[14.3637,22.5674],"entryFuelRange":[78.5167,79.0333]},{"name":"strong-F0","n":100,"entered":100,"exited":100,"fullCourseWins":90,"entrySpeedRange":[14.6185,31.6686],"entryFuelRange":[38.55,39.3]},{"name":"recommended-minus-engine","n":100,"entered":100,"exited":100,"fullCourseWins":86,"entrySpeedRange":[14.5517,27.8919],"entryFuelRange":[54.5333,55.2167]},{"name":"recommended-minus-suspension","n":100,"entered":100,"exited":100,"fullCourseWins":89,"entrySpeedRange":[14.7492,28.7859],"entryFuelRange":[54.55,55.2333]},{"name":"recommended-minus-tires","n":100,"entered":100,"exited":100,"fullCourseWins":91,"entrySpeedRange":[14.7489,28.5676],"entryFuelRange":[54.55,55.2333]},{"name":"recommended-minus-tank","n":100,"entered":100,"exited":100,"fullCourseWins":90,"entrySpeedRange":[14.7488,28.5573],"entryFuelRange":[50.55,51.2333]}]}},{"id":"mountain-pass-2","type":"recovery","name":"Відновлення","from":420,"to":480,"geometry":{"firstVertex":421,"lastVertex":481,"heightChange":0,"maximumSlopeDegrees":0},"material":"dirt","entry":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.35,0.35],"angularSpeed":[-1.2,1.2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"exit":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.5,0.5],"angularSpeed":[-2,2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"recovery":{"from":480,"to":480},"pickups":{"coins":[29,30,31,32],"fuel":[]},"validation":{"state":"measured within complete route, not isolated proof","source":"artifacts/pixel-drive-campaign-balance.json","reference":{"entry":{"x":420.1834,"speed":16.4876,"bodyAngle":0.5312,"angularSpeed":0.7596,"groundedWheels":1,"suspensionCompression":[0.1184,-0.0096],"fuelSeconds":39.3667,"tick":1476},"exit":{"x":480.2109,"speed":23.7019,"bodyAngle":0.0465,"angularSpeed":-0.0167,"groundedWheels":2,"suspensionCompression":[0.2902,0.164],"fuelSeconds":36.2,"tick":1666}},"profiles":[{"name":"base","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"recommended","n":100,"entered":100,"exited":99,"fullCourseWins":91,"entrySpeedRange":[13.6995,16.7451],"entryFuelRange":[35.6333,40.7667]},{"name":"maximum","n":100,"entered":100,"exited":99,"fullCourseWins":94,"entrySpeedRange":[14.5629,21.8416],"entryFuelRange":[59.8333,67.9833]},{"name":"engine-only","n":100,"entered":100,"exited":99,"fullCourseWins":84,"entrySpeedRange":[14.3897,21.8975],"entryFuelRange":[19.75,28.2333]},{"name":"tank-only","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"strong-F0","n":100,"entered":100,"exited":99,"fullCourseWins":90,"entrySpeedRange":[14.5629,21.8416],"entryFuelRange":[19.8333,27.9833]},{"name":"recommended-minus-engine","n":100,"entered":100,"exited":100,"fullCourseWins":86,"entrySpeedRange":[13.1487,15.1698],"entryFuelRange":[33.4,39.2333]},{"name":"recommended-minus-suspension","n":100,"entered":100,"exited":100,"fullCourseWins":89,"entrySpeedRange":[14.0446,16.751],"entryFuelRange":[35.6333,40.8167]},{"name":"recommended-minus-tires","n":100,"entered":100,"exited":99,"fullCourseWins":91,"entrySpeedRange":[14.9599,16.7231],"entryFuelRange":[35.6333,40.7667]},{"name":"recommended-minus-tank","n":100,"entered":100,"exited":99,"fullCourseWins":90,"entrySpeedRange":[13.6995,16.7451],"entryFuelRange":[31.6333,36.7667]}]}},{"id":"mountain-pass-3","type":"climb","name":"Плавний схил","from":480,"to":640,"geometry":{"firstVertex":481,"lastVertex":641,"heightChange":-25.038431260602266,"maximumSlopeDegrees":10.000001071994772},"material":"dirt","entry":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.35,0.35],"angularSpeed":[-1.2,1.2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"exit":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.5,0.5],"angularSpeed":[-2,2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"recovery":{"from":640,"to":640},"pickups":{"coins":[33,34,35,36,37,38,39,40,41,42,43,44],"fuel":[]},"validation":{"state":"measured within complete route, not isolated proof","source":"artifacts/pixel-drive-campaign-balance.json","reference":{"entry":{"x":480.2109,"speed":23.7019,"bodyAngle":0.0465,"angularSpeed":-0.0167,"groundedWheels":2,"suspensionCompression":[0.2902,0.164],"fuelSeconds":36.2,"tick":1666},"exit":{"x":640.2934,"speed":24.3429,"bodyAngle":0.0166,"angularSpeed":0.1579,"groundedWheels":2,"suspensionCompression":[0.4326,0.3962],"fuelSeconds":29.6667,"tick":2058}},"profiles":[{"name":"base","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"recommended","n":100,"entered":99,"exited":99,"fullCourseWins":91,"entrySpeedRange":[15.0157,24.9918],"entryFuelRange":[31.5667,37.8167]},{"name":"maximum","n":100,"entered":99,"exited":99,"fullCourseWins":94,"entrySpeedRange":[14.7409,27.4734],"entryFuelRange":[55.6667,65.3333]},{"name":"engine-only","n":100,"entered":99,"exited":99,"fullCourseWins":84,"entrySpeedRange":[13.7268,27.6552],"entryFuelRange":[15.6167,25.6]},{"name":"tank-only","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"strong-F0","n":100,"entered":99,"exited":99,"fullCourseWins":90,"entrySpeedRange":[14.7409,27.4734],"entryFuelRange":[15.6667,25.3333]},{"name":"recommended-minus-engine","n":100,"entered":100,"exited":100,"fullCourseWins":86,"entrySpeedRange":[14.8182,23.9783],"entryFuelRange":[29.3167,36.2]},{"name":"recommended-minus-suspension","n":100,"entered":100,"exited":99,"fullCourseWins":89,"entrySpeedRange":[1.0901,25.0502],"entryFuelRange":[31.5833,37.8167]},{"name":"recommended-minus-tires","n":100,"entered":99,"exited":99,"fullCourseWins":91,"entrySpeedRange":[15.0102,24.9869],"entryFuelRange":[31.55,37.85]},{"name":"recommended-minus-tank","n":100,"entered":99,"exited":99,"fullCourseWins":90,"entrySpeedRange":[15.0157,24.9918],"entryFuelRange":[27.5667,33.8167]}]}},{"id":"mountain-pass-4","type":"snow-climb","name":"Сніговий підйом","from":640,"to":940,"geometry":{"firstVertex":641,"lastVertex":941,"heightChange":156.31515250968218,"maximumSlopeDegrees":29.000041573821097},"material":"snow","entry":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.35,0.35],"angularSpeed":[-1.2,1.2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"exit":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.5,0.5],"angularSpeed":[-2,2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"recovery":{"from":940,"to":1010},"pickups":{"coins":[45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65],"fuel":[1]},"validation":{"state":"measured within complete route, not isolated proof","source":"artifacts/pixel-drive-campaign-balance.json","reference":{"entry":{"x":640.2934,"speed":24.3429,"bodyAngle":0.0166,"angularSpeed":0.1579,"groundedWheels":2,"suspensionCompression":[0.4326,0.3962],"fuelSeconds":29.6667,"tick":2058},"exit":{"x":940.0857,"speed":12.4662,"bodyAngle":0.0673,"angularSpeed":0.0381,"groundedWheels":2,"suspensionCompression":[0.2468,0.0771],"fuelSeconds":42.25,"tick":3480}},"profiles":[{"name":"base","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"recommended","n":100,"entered":99,"exited":99,"fullCourseWins":91,"entrySpeedRange":[14.9282,34.1704],"entryFuelRange":[20.7333,32.5333]},{"name":"maximum","n":100,"entered":99,"exited":99,"fullCourseWins":94,"entrySpeedRange":[13.7866,37.3],"entryFuelRange":[44.7667,60.4667]},{"name":"engine-only","n":100,"entered":99,"exited":95,"fullCourseWins":84,"entrySpeedRange":[14.5149,37.3829],"entryFuelRange":[4.7333,20.65]},{"name":"tank-only","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"strong-F0","n":100,"entered":99,"exited":96,"fullCourseWins":90,"entrySpeedRange":[13.7866,37.3],"entryFuelRange":[4.7667,20.4667]},{"name":"recommended-minus-engine","n":100,"entered":100,"exited":97,"fullCourseWins":86,"entrySpeedRange":[13.823,33.3684],"entryFuelRange":[18.5,30.7167]},{"name":"recommended-minus-suspension","n":100,"entered":99,"exited":99,"fullCourseWins":89,"entrySpeedRange":[14.8979,34.1816],"entryFuelRange":[20.7333,32.5333]},{"name":"recommended-minus-tires","n":100,"entered":99,"exited":99,"fullCourseWins":91,"entrySpeedRange":[15.0315,34.1709],"entryFuelRange":[20.75,32.4667]},{"name":"recommended-minus-tank","n":100,"entered":99,"exited":99,"fullCourseWins":90,"entrySpeedRange":[14.9282,34.1704],"entryFuelRange":[16.7333,28.5333]}]}},{"id":"mountain-pass-5","type":"recovery","name":"Відновлення","from":940,"to":1010,"geometry":{"firstVertex":941,"lastVertex":1011,"heightChange":0,"maximumSlopeDegrees":0},"material":"dirt","entry":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.35,0.35],"angularSpeed":[-1.2,1.2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"exit":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.5,0.5],"angularSpeed":[-2,2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"recovery":{"from":1010,"to":1010},"pickups":{"coins":[66,67,68,69,70],"fuel":[]},"validation":{"state":"measured within complete route, not isolated proof","source":"artifacts/pixel-drive-campaign-balance.json","reference":{"entry":{"x":940.0857,"speed":12.4662,"bodyAngle":0.0673,"angularSpeed":0.0381,"groundedWheels":2,"suspensionCompression":[0.2468,0.0771],"fuelSeconds":42.25,"tick":3480},"exit":{"x":1010.0768,"speed":24.3249,"bodyAngle":0.0198,"angularSpeed":-0.1533,"groundedWheels":2,"suspensionCompression":[0.2585,0.2092],"fuelSeconds":38.65,"tick":3696}},"profiles":[{"name":"base","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"recommended","n":100,"entered":99,"exited":99,"fullCourseWins":91,"entrySpeedRange":[11.0945,13.4284],"entryFuelRange":[36.3167,44.5667]},{"name":"maximum","n":100,"entered":99,"exited":99,"fullCourseWins":94,"entrySpeedRange":[13.9612,18.5102],"entryFuelRange":[69.6833,72.6333]},{"name":"engine-only","n":100,"entered":95,"exited":95,"fullCourseWins":84,"entrySpeedRange":[13.9143,17.4065],"entryFuelRange":[29.4167,32.45]},{"name":"tank-only","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"strong-F0","n":100,"entered":96,"exited":96,"fullCourseWins":90,"entrySpeedRange":[13.9612,18.5102],"entryFuelRange":[26.7,32.6333]},{"name":"recommended-minus-engine","n":100,"entered":97,"exited":97,"fullCourseWins":86,"entrySpeedRange":[8.9513,11.5035],"entryFuelRange":[16.7833,41.6167]},{"name":"recommended-minus-suspension","n":100,"entered":99,"exited":99,"fullCourseWins":89,"entrySpeedRange":[11.1711,13.4527],"entryFuelRange":[36.6,44.6667]},{"name":"recommended-minus-tires","n":100,"entered":99,"exited":99,"fullCourseWins":91,"entrySpeedRange":[10.7712,13.1631],"entryFuelRange":[34.9667,44.3167]},{"name":"recommended-minus-tank","n":100,"entered":99,"exited":99,"fullCourseWins":90,"entrySpeedRange":[11.0945,13.4284],"entryFuelRange":[32.3167,40.5667]}]}},{"id":"mountain-pass-6","type":"rollers","name":"Хвиляста ділянка","from":1010,"to":1190,"geometry":{"firstVertex":1011,"lastVertex":1191,"heightChange":-3.410605131648481e-13,"maximumSlopeDegrees":20.499563692108815},"material":"dirt","entry":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.35,0.35],"angularSpeed":[-1.2,1.2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"exit":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.5,0.5],"angularSpeed":[-2,2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"recovery":{"from":1190,"to":1190},"pickups":{"coins":[71,72,73,74,75,76,77,78,79,80,81,82,83],"fuel":[]},"validation":{"state":"measured within complete route, not isolated proof","source":"artifacts/pixel-drive-campaign-balance.json","reference":{"entry":{"x":1010.0768,"speed":24.3249,"bodyAngle":0.0198,"angularSpeed":-0.1533,"groundedWheels":2,"suspensionCompression":[0.2585,0.2092],"fuelSeconds":38.65,"tick":3696},"exit":{"x":1190.0755,"speed":20.6728,"bodyAngle":0.0646,"angularSpeed":-0.0378,"groundedWheels":2,"suspensionCompression":[0.3248,0.1637],"fuelSeconds":27.8667,"tick":4343}},"profiles":[{"name":"base","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"recommended","n":100,"entered":99,"exited":91,"fullCourseWins":91,"entrySpeedRange":[14.5216,25.0673],"entryFuelRange":[31.45,41.0667]},{"name":"maximum","n":100,"entered":99,"exited":94,"fullCourseWins":94,"entrySpeedRange":[14.3141,28.5078],"entryFuelRange":[64.8667,69.5]},{"name":"engine-only","n":100,"entered":95,"exited":84,"fullCourseWins":84,"entrySpeedRange":[17.0153,28.2809],"entryFuelRange":[25.5167,29.3]},{"name":"tank-only","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"strong-F0","n":100,"entered":96,"exited":91,"fullCourseWins":90,"entrySpeedRange":[17.6468,28.5078],"entryFuelRange":[22.35,29.5]},{"name":"recommended-minus-engine","n":100,"entered":97,"exited":93,"fullCourseWins":86,"entrySpeedRange":[16.5633,23.7894],"entryFuelRange":[12.2,37.8167]},{"name":"recommended-minus-suspension","n":100,"entered":99,"exited":89,"fullCourseWins":89,"entrySpeedRange":[14.7663,25.0863],"entryFuelRange":[31.7333,41.1667]},{"name":"recommended-minus-tires","n":100,"entered":99,"exited":91,"fullCourseWins":91,"entrySpeedRange":[14.7456,25.0112],"entryFuelRange":[30.1167,40.7833]},{"name":"recommended-minus-tank","n":100,"entered":99,"exited":91,"fullCourseWins":90,"entrySpeedRange":[14.5216,25.0673],"entryFuelRange":[27.45,37.0667]}]}},{"id":"mountain-pass-7","type":"climb","name":"Плавний схил","from":1190,"to":1450,"geometry":{"firstVertex":1191,"lastVertex":1451,"heightChange":107.74534184467177,"maximumSlopeDegrees":24.000015047623798},"material":"dirt","entry":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.35,0.35],"angularSpeed":[-1.2,1.2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"exit":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.5,0.5],"angularSpeed":[-2,2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"recovery":{"from":1450,"to":1600},"pickups":{"coins":[84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100,101,102],"fuel":[2]},"validation":{"state":"measured within complete route, not isolated proof","source":"artifacts/pixel-drive-campaign-balance.json","reference":{"entry":{"x":1190.0755,"speed":20.6728,"bodyAngle":0.0646,"angularSpeed":-0.0378,"groundedWheels":2,"suspensionCompression":[0.3248,0.1637],"fuelSeconds":27.8667,"tick":4343},"exit":{"x":1450.0611,"speed":16.3953,"bodyAngle":0.066,"angularSpeed":0.0544,"groundedWheels":0,"suspensionCompression":[0.0046,-0.003],"fuelSeconds":52.8333,"tick":5248}},"profiles":[{"name":"base","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"recommended","n":100,"entered":91,"exited":91,"fullCourseWins":91,"entrySpeedRange":[15.0438,21.288],"entryFuelRange":[17.15,31.7833]},{"name":"maximum","n":100,"entered":94,"exited":94,"fullCourseWins":94,"entrySpeedRange":[14.9321,25.4079],"entryFuelRange":[50.7,61.85]},{"name":"engine-only","n":100,"entered":84,"exited":84,"fullCourseWins":84,"entrySpeedRange":[17.9821,25.2833],"entryFuelRange":[12.1833,20.9833]},{"name":"tank-only","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"strong-F0","n":100,"entered":91,"exited":90,"fullCourseWins":90,"entrySpeedRange":[16.4469,25.4079],"entryFuelRange":[9.7833,21.85]},{"name":"recommended-minus-engine","n":100,"entered":93,"exited":86,"fullCourseWins":86,"entrySpeedRange":[14.6626,20.779],"entryFuelRange":[0,28.0833]},{"name":"recommended-minus-suspension","n":100,"entered":89,"exited":89,"fullCourseWins":89,"entrySpeedRange":[15.002,22.0763],"entryFuelRange":[17.8667,32.1667]},{"name":"recommended-minus-tires","n":100,"entered":91,"exited":91,"fullCourseWins":91,"entrySpeedRange":[15.1587,21.2493],"entryFuelRange":[15.8,30.9667]},{"name":"recommended-minus-tank","n":100,"entered":91,"exited":90,"fullCourseWins":90,"entrySpeedRange":[15.0438,21.288],"entryFuelRange":[13.15,27.7833]}]}},{"id":"mountain-pass-8","type":"recovery","name":"Відновлення","from":1450,"to":1600,"geometry":{"firstVertex":1451,"lastVertex":1601,"heightChange":0,"maximumSlopeDegrees":0},"material":"dirt","entry":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.35,0.35],"angularSpeed":[-1.2,1.2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"exit":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.5,0.5],"angularSpeed":[-2,2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"recovery":{"from":1600,"to":1600},"pickups":{"coins":[103,104,105,106,107,108,109,110,111,112],"fuel":[]},"validation":{"state":"measured within complete route, not isolated proof","source":"artifacts/pixel-drive-campaign-balance.json","reference":{"entry":{"x":1450.0611,"speed":16.3953,"bodyAngle":0.066,"angularSpeed":0.0544,"groundedWheels":0,"suspensionCompression":[0.0046,-0.003],"fuelSeconds":52.8333,"tick":5248},"exit":{"x":1600.2413,"speed":24.1925,"bodyAngle":0.0117,"angularSpeed":0.0948,"groundedWheels":2,"suspensionCompression":[0.252,0.2216],"fuelSeconds":46.0833,"tick":5653}},"profiles":[{"name":"base","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"recommended","n":100,"entered":91,"exited":91,"fullCourseWins":91,"entrySpeedRange":[13.4382,17.6202],"entryFuelRange":[52.2833,52.85]},{"name":"maximum","n":100,"entered":94,"exited":94,"fullCourseWins":94,"entrySpeedRange":[14.5067,22.9768],"entryFuelRange":[76.3667,77.7167]},{"name":"engine-only","n":100,"entered":84,"exited":84,"fullCourseWins":84,"entrySpeedRange":[17.2536,22.8445],"entryFuelRange":[36.9667,37.7167]},{"name":"tank-only","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"strong-F0","n":100,"entered":90,"exited":90,"fullCourseWins":90,"entrySpeedRange":[17.532,22.9768],"entryFuelRange":[36.9833,37.7167]},{"name":"recommended-minus-engine","n":100,"entered":86,"exited":86,"fullCourseWins":86,"entrySpeedRange":[14.0676,16.1342],"entryFuelRange":[50.8833,52.45]},{"name":"recommended-minus-suspension","n":100,"entered":89,"exited":89,"fullCourseWins":89,"entrySpeedRange":[13.9982,17.6132],"entryFuelRange":[52.25,52.8667]},{"name":"recommended-minus-tires","n":100,"entered":91,"exited":91,"fullCourseWins":91,"entrySpeedRange":[14.4079,17.5981],"entryFuelRange":[52.25,52.85]},{"name":"recommended-minus-tank","n":100,"entered":90,"exited":90,"fullCourseWins":90,"entrySpeedRange":[13.4382,17.6202],"entryFuelRange":[48.45,48.85]}]}}],"fuel":[140,800,1400],"seed":2567172084,"generatorVersion":3,"length":1600,"max_ticks":36000,"terrain":[[-100,12],[0,12],[1,12.000081],[2,12.000519],[3,12.001559],[4,12.003408],[5,12.006234],[6,12.010147],[7,12.015198],[8,12.02137],[9,12.028577],[10,12.036658],[11,12.045387],[12,12.054468],[13,12.063551],[14,12.072232],[15,12.080071],[16,12.086602],[17,12.091347],[18,12.093832],[19,12.093606],[20,12.090251],[21,12.083405],[22,12.072773],[23,12.058143],[24,12.039398],[25,12.016524],[26,11.989624],[27,11.958917],[28,11.924742],[29,11.88756],[30,11.847946],[31,11.806583],[32,11.764252],[33,11.721817],[34,11.680209],[35,11.640408],[36,11.603423],[37,11.570265],[38,11.541928],[39,11.519362],[40,11.503452],[41,11.494991],[42,11.494659],[43,11.503004],[44,11.520421],[45,11.547138],[46,11.583205],[47,11.628483],[48,11.682642],[49,11.745157],[50,11.815317],[51,11.892227],[52,11.974825],[53,12.061896],[54,12.152092],[55,12.243958],[56,12.335954],[57,12.426486],[58,12.513939],[59,12.596703],[60,12.673211],[61,12.741966],[62,12.801579],[63,12.85079],[64,12.888502],[65,12.913803],[66,12.925988],[67,12.924576],[68,12.909321],[69,12.880224],[70,12.837533],[71,12.781743],[72,12.713588],[73,12.634034],[74,12.544256],[75,12.445622],[76,12.339667],[77,12.228065],[78,12.112599],[79,11.995125],[80,11.877542],[81,11.76175],[82,11.64962],[83,11.542955],[84,11.443459],[85,11.352701],[86,11.27209],[87,11.202849],[88,11.145992],[89,11.102303],[90,11.072331],[91,11.056374],[92,11.054481],[93,11.066452],[94,11.091845],[95,11.129986],[96,11.179991],[97,11.240778],[98,11.311097],[99,11.389555],[100,11.474645],[101,11.564778],[102,11.658315],[103,11.7536],[104,11.848991],[105,11.942894],[106,12.033791],[107,12.120268],[108,12.201041],[109,12.274977],[110,12.341109],[111,12.398656],[112,12.447027],[113,12.485828],[114,12.514865],[115,12.534139],[116,12.543838],[117,12.544327],[118,12.536133],[119,12.519929],[120,12.496509],[121,12.466771],[122,12.43169],[123,12.392296],[124,12.349646],[125,12.3048],[126,12.258801],[127,12.212647],[128,12.167275],[129,12.123542],[130,12.082207],[131,12.043922],[132,12.009222],[133,11.978519],[134,11.952097],[135,11.930117],[136,11.912618],[137,11.899524],[138,11.890656],[139,11.885739],[140,11.884423],[141,11.886289],[142,11.890875],[143,11.897684],[144,11.906207],[145,11.915937],[146,11.926385],[147,11.937093],[148,11.947648],[149,11.957692],[150,11.966931],[151,11.97514],[152,11.982168],[153,11.987935],[154,11.992435],[155,11.995729],[156,11.99794],[157,11.99924],[158,11.999849],[159,12.000013],[160,12],[161,12.001108],[162,12.010705],[163,12.036317],[164,12.084467],[165,12.160675],[166,12.269457],[167,12.414326],[168,12.59779],[169,12.821355],[170,13.085523],[171,13.389791],[172,13.732655],[173,14.111605],[174,14.52313],[175,14.962712],[176,15.424833],[177,15.902969],[178,16.389593],[179,16.877326],[180,17.365058],[181,17.852791],[182,18.340524],[183,18.828256],[184,19.315989],[185,19.803721],[186,20.291454],[187,20.779187],[188,21.266919],[189,21.754652],[190,22.242384],[191,22.730117],[192,23.21785],[193,23.705582],[194,24.193315],[195,24.681047],[196,25.16878],[197,25.656512],[198,26.144245],[199,26.631978],[200,27.11971],[201,27.607443],[202,28.095175],[203,28.582908],[204,29.070641],[205,29.558373],[206,30.046106],[207,30.533838],[208,31.021571],[209,31.509304],[210,31.997036],[211,32.484769],[212,32.972501],[213,33.460234],[214,33.947966],[215,34.435699],[216,34.923432],[217,35.411164],[218,35.898897],[219,36.386629],[220,36.874362],[221,37.362095],[222,37.849827],[223,38.33756],[224,38.825292],[225,39.313025],[226,39.800758],[227,40.28849],[228,40.776223],[229,41.263955],[230,41.751688],[231,42.23942],[232,42.727153],[233,43.214886],[234,43.702618],[235,44.190351],[236,44.678083],[237,45.165816],[238,45.653549],[239,46.141281],[240,46.629014],[241,47.116746],[242,47.604479],[243,48.092212],[244,48.579944],[245,49.067677],[246,49.555409],[247,50.043142],[248,50.530874],[249,51.018607],[250,51.50634],[251,51.994072],[252,52.481805],[253,52.969537],[254,53.45727],[255,53.945003],[256,54.432735],[257,54.920468],[258,55.4082],[259,55.895933],[260,56.383666],[261,56.871398],[262,57.359131],[263,57.846863],[264,58.334596],[265,58.822329],[266,59.310061],[267,59.797794],[268,60.285526],[269,60.773259],[270,61.260991],[271,61.748724],[272,62.236457],[273,62.724189],[274,63.211922],[275,63.699654],[276,64.187387],[277,64.67512],[278,65.162852],[279,65.650585],[280,66.138317],[281,66.62605],[282,67.113783],[283,67.601515],[284,68.089248],[285,68.57698],[286,69.064713],[287,69.552445],[288,70.040178],[289,70.527911],[290,71.015643],[291,71.503376],[292,71.991108],[293,72.478841],[294,72.966574],[295,73.454306],[296,73.942039],[297,74.429771],[298,74.917504],[299,75.405237],[300,75.892969],[301,76.380702],[302,76.868434],[303,77.356167],[304,77.843899],[305,78.331632],[306,78.819365],[307,79.307097],[308,79.79483],[309,80.282562],[310,80.770295],[311,81.258028],[312,81.74576],[313,82.233493],[314,82.721225],[315,83.208958],[316,83.696691],[317,84.184423],[318,84.672156],[319,85.159888],[320,85.647621],[321,86.135353],[322,86.623086],[323,87.110819],[324,87.598551],[325,88.086284],[326,88.574016],[327,89.061749],[328,89.549482],[329,90.037214],[330,90.524947],[331,91.012679],[332,91.500412],[333,91.988145],[334,92.475877],[335,92.96361],[336,93.451342],[337,93.939075],[338,94.426807],[339,94.91454],[340,95.402273],[341,95.890005],[342,96.377738],[343,96.86547],[344,97.353203],[345,97.840936],[346,98.328668],[347,98.816401],[348,99.304133],[349,99.791866],[350,100.279599],[351,100.767331],[352,101.255064],[353,101.742796],[354,102.230529],[355,102.718261],[356,103.205994],[357,103.693727],[358,104.181459],[359,104.669192],[360,105.156924],[361,105.644657],[362,106.13239],[363,106.620122],[364,107.107855],[365,107.595587],[366,108.08332],[367,108.571053],[368,109.058785],[369,109.546518],[370,110.03425],[371,110.521983],[372,111.009715],[373,111.497448],[374,111.985181],[375,112.472913],[376,112.960646],[377,113.448378],[378,113.936111],[379,114.423844],[380,114.911576],[381,115.399309],[382,115.887041],[383,116.374774],[384,116.862507],[385,117.350239],[386,117.837972],[387,118.325704],[388,118.813437],[389,119.301169],[390,119.788902],[391,120.276635],[392,120.764367],[393,121.2521],[394,121.739832],[395,122.227565],[396,122.715298],[397,123.20303],[398,123.690763],[399,124.178495],[400,124.666228],[401,125.153961],[402,125.641693],[403,126.128318],[404,126.606454],[405,127.068574],[406,127.508157],[407,127.919681],[408,128.298631],[409,128.641495],[410,128.945764],[411,129.209931],[412,129.433496],[413,129.61696],[414,129.761829],[415,129.870611],[416,129.94682],[417,129.99497],[418,130.020582],[419,130.030178],[420,130.031286],[421,130.031286],[422,130.031286],[423,130.031286],[424,130.031286],[425,130.031286],[426,130.031286],[427,130.031286],[428,130.031286],[429,130.031286],[430,130.031286],[431,130.031286],[432,130.031286],[433,130.031286],[434,130.031286],[435,130.031286],[436,130.031286],[437,130.031286],[438,130.031286],[439,130.031286],[440,130.031286],[441,130.031286],[442,130.031286],[443,130.031286],[444,130.031286],[445,130.031286],[446,130.031286],[447,130.031286],[448,130.031286],[449,130.031286],[450,130.031286],[451,130.031286],[452,130.031286],[453,130.031286],[454,130.031286],[455,130.031286],[456,130.031286],[457,130.031286],[458,130.031286],[459,130.031286],[460,130.031286],[461,130.031286],[462,130.031286],[463,130.031286],[464,130.031286],[465,130.031286],[466,130.031286],[467,130.031286],[468,130.031286],[469,130.031286],[470,130.031286],[471,130.031286],[472,130.031286],[473,130.031286],[474,130.031286],[475,130.031286],[476,130.031286],[477,130.031286],[478,130.031286],[479,130.031286],[480,130.031286],[481,130.030886],[482,130.027416],[483,130.018157],[484,130.00075],[485,129.973199],[486,129.933871],[487,129.881498],[488,129.815171],[489,129.734347],[490,129.638844],[491,129.528844],[492,129.40489],[493,129.267891],[494,129.119115],[495,128.960195],[496,128.793128],[497,128.62027],[498,128.444344],[499,128.268017],[500,128.09169],[501,127.915363],[502,127.739036],[503,127.562709],[504,127.386382],[505,127.210055],[506,127.033728],[507,126.857401],[508,126.681074],[509,126.504747],[510,126.32842],[511,126.152093],[512,125.975766],[513,125.799439],[514,125.623112],[515,125.446785],[516,125.270458],[517,125.094131],[518,124.917804],[519,124.741477],[520,124.56515],[521,124.388823],[522,124.212496],[523,124.036169],[524,123.859842],[525,123.683515],[526,123.507188],[527,123.330861],[528,123.154534],[529,122.978207],[530,122.80188],[531,122.625553],[532,122.449226],[533,122.272899],[534,122.096572],[535,121.920245],[536,121.743918],[537,121.567591],[538,121.391264],[539,121.214937],[540,121.03861],[541,120.862283],[542,120.685956],[543,120.509629],[544,120.333302],[545,120.156976],[546,119.980649],[547,119.804322],[548,119.627995],[549,119.451668],[550,119.275341],[551,119.099014],[552,118.922687],[553,118.74636],[554,118.570033],[555,118.393706],[556,118.217379],[557,118.041052],[558,117.864725],[559,117.688398],[560,117.512071],[561,117.335744],[562,117.159417],[563,116.98309],[564,116.806763],[565,116.630436],[566,116.454109],[567,116.277782],[568,116.101455],[569,115.925128],[570,115.748801],[571,115.572474],[572,115.396147],[573,115.21982],[574,115.043493],[575,114.867166],[576,114.690839],[577,114.514512],[578,114.338185],[579,114.161858],[580,113.985531],[581,113.809204],[582,113.632877],[583,113.45655],[584,113.280223],[585,113.103896],[586,112.927569],[587,112.751242],[588,112.574915],[589,112.398588],[590,112.222261],[591,112.045934],[592,111.869607],[593,111.69328],[594,111.516953],[595,111.340626],[596,111.164299],[597,110.987973],[598,110.811646],[599,110.635319],[600,110.458992],[601,110.282665],[602,110.106338],[603,109.930011],[604,109.753684],[605,109.577357],[606,109.40103],[607,109.224703],[608,109.048376],[609,108.872049],[610,108.695722],[611,108.519395],[612,108.343068],[613,108.166741],[614,107.990414],[615,107.814087],[616,107.63776],[617,107.461433],[618,107.285106],[619,107.108779],[620,106.932452],[621,106.756125],[622,106.579798],[623,106.403872],[624,106.231014],[625,106.063946],[626,105.905027],[627,105.756251],[628,105.619251],[629,105.495298],[630,105.385298],[631,105.289795],[632,105.208971],[633,105.142644],[634,105.09027],[635,105.050943],[636,105.023392],[637,105.005984],[638,104.996725],[639,104.993256],[640,104.992855],[641,104.994115],[642,105.005021],[643,105.034129],[644,105.088852],[645,105.175463],[646,105.299094],[647,105.463737],[648,105.672245],[649,105.926327],[650,106.226554],[651,106.572356],[652,106.962021],[653,107.392699],[654,107.860397],[655,108.359983],[656,108.885184],[657,109.428587],[658,109.981637],[659,110.535946],[660,111.090255],[661,111.644564],[662,112.198873],[663,112.753182],[664,113.307491],[665,113.8618],[666,114.416109],[667,114.970418],[668,115.524727],[669,116.079036],[670,116.633345],[671,117.187654],[672,117.741963],[673,118.296272],[674,118.850581],[675,119.404891],[676,119.9592],[677,120.513509],[678,121.067818],[679,121.622127],[680,122.176436],[681,122.730745],[682,123.285054],[683,123.839363],[684,124.393672],[685,124.947981],[686,125.50229],[687,126.056599],[688,126.610908],[689,127.165217],[690,127.719526],[691,128.273835],[692,128.828144],[693,129.382453],[694,129.936762],[695,130.491072],[696,131.045381],[697,131.59969],[698,132.153999],[699,132.708308],[700,133.262617],[701,133.816926],[702,134.371235],[703,134.925544],[704,135.479853],[705,136.034162],[706,136.588471],[707,137.14278],[708,137.697089],[709,138.251398],[710,138.805707],[711,139.360016],[712,139.914325],[713,140.468634],[714,141.022944],[715,141.577253],[716,142.131562],[717,142.685871],[718,143.24018],[719,143.794489],[720,144.348798],[721,144.903107],[722,145.457416],[723,146.011725],[724,146.566034],[725,147.120343],[726,147.674652],[727,148.228961],[728,148.78327],[729,149.337579],[730,149.891888],[731,150.446197],[732,151.000506],[733,151.554815],[734,152.109125],[735,152.663434],[736,153.217743],[737,153.772052],[738,154.326361],[739,154.88067],[740,155.434979],[741,155.989288],[742,156.543597],[743,157.097906],[744,157.652215],[745,158.206524],[746,158.760833],[747,159.315142],[748,159.869451],[749,160.42376],[750,160.978069],[751,161.532378],[752,162.086687],[753,162.640997],[754,163.195306],[755,163.749615],[756,164.303924],[757,164.858233],[758,165.412542],[759,165.966851],[760,166.52116],[761,167.075469],[762,167.629778],[763,168.184087],[764,168.738396],[765,169.292705],[766,169.847014],[767,170.401323],[768,170.955632],[769,171.509941],[770,172.06425],[771,172.618559],[772,173.172869],[773,173.727178],[774,174.281487],[775,174.835796],[776,175.390105],[777,175.944414],[778,176.498723],[779,177.053032],[780,177.607341],[781,178.16165],[782,178.715959],[783,179.270268],[784,179.824577],[785,180.378886],[786,180.933195],[787,181.487504],[788,182.041813],[789,182.596122],[790,183.150431],[791,183.70474],[792,184.25905],[793,184.813359],[794,185.367668],[795,185.921977],[796,186.476286],[797,187.030595],[798,187.584904],[799,188.139213],[800,188.693522],[801,189.247831],[802,189.80214],[803,190.356449],[804,190.910758],[805,191.465067],[806,192.019376],[807,192.573685],[808,193.127994],[809,193.682303],[810,194.236612],[811,194.790922],[812,195.345231],[813,195.89954],[814,196.453849],[815,197.008158],[816,197.562467],[817,198.116776],[818,198.671085],[819,199.225394],[820,199.779703],[821,200.334012],[822,200.888321],[823,201.44263],[824,201.996939],[825,202.551248],[826,203.105557],[827,203.659866],[828,204.214175],[829,204.768484],[830,205.322793],[831,205.877103],[832,206.431412],[833,206.985721],[834,207.54003],[835,208.094339],[836,208.648648],[837,209.202957],[838,209.757266],[839,210.311575],[840,210.865884],[841,211.420193],[842,211.974502],[843,212.528811],[844,213.08312],[845,213.637429],[846,214.191738],[847,214.746047],[848,215.300356],[849,215.854665],[850,216.408975],[851,216.963284],[852,217.517593],[853,218.071902],[854,218.626211],[855,219.18052],[856,219.734829],[857,220.289138],[858,220.843447],[859,221.397756],[860,221.952065],[861,222.506374],[862,223.060683],[863,223.614992],[864,224.169301],[865,224.72361],[866,225.277919],[867,225.832228],[868,226.386537],[869,226.940846],[870,227.495156],[871,228.049465],[872,228.603774],[873,229.158083],[874,229.712392],[875,230.266701],[876,230.82101],[877,231.375319],[878,231.929628],[879,232.483937],[880,233.038246],[881,233.592555],[882,234.146864],[883,234.701173],[884,235.255482],[885,235.809791],[886,236.3641],[887,236.918409],[888,237.472718],[889,238.027028],[890,238.581337],[891,239.135646],[892,239.689955],[893,240.244264],[894,240.798573],[895,241.352882],[896,241.907191],[897,242.4615],[898,243.015809],[899,243.570118],[900,244.124427],[901,244.678736],[902,245.233045],[903,245.787354],[904,246.341663],[905,246.895972],[906,247.450281],[907,248.00459],[908,248.558899],[909,249.113209],[910,249.667518],[911,250.221827],[912,250.776136],[913,251.330445],[914,251.884754],[915,252.439063],[916,252.993372],[917,253.547681],[918,254.10199],[919,254.656299],[920,255.210608],[921,255.764917],[922,256.319226],[923,256.872276],[924,257.415678],[925,257.94088],[926,258.440466],[927,258.908164],[928,259.338842],[929,259.728507],[930,260.074309],[931,260.374536],[932,260.628618],[933,260.837125],[934,261.001769],[935,261.1254],[936,261.212011],[937,261.266734],[938,261.295842],[939,261.306748],[940,261.308008],[941,261.308008],[942,261.308008],[943,261.308008],[944,261.308008],[945,261.308008],[946,261.308008],[947,261.308008],[948,261.308008],[949,261.308008],[950,261.308008],[951,261.308008],[952,261.308008],[953,261.308008],[954,261.308008],[955,261.308008],[956,261.308008],[957,261.308008],[958,261.308008],[959,261.308008],[960,261.308008],[961,261.308008],[962,261.308008],[963,261.308008],[964,261.308008],[965,261.308008],[966,261.308008],[967,261.308008],[968,261.308008],[969,261.308008],[970,261.308008],[971,261.308008],[972,261.308008],[973,261.308008],[974,261.308008],[975,261.308008],[976,261.308008],[977,261.308008],[978,261.308008],[979,261.308008],[980,261.308008],[981,261.308008],[982,261.308008],[983,261.308008],[984,261.308008],[985,261.308008],[986,261.308008],[987,261.308008],[988,261.308008],[989,261.308008],[990,261.308008],[991,261.308008],[992,261.308008],[993,261.308008],[994,261.308008],[995,261.308008],[996,261.308008],[997,261.308008],[998,261.308008],[999,261.308008],[1000,261.308008],[1001,261.308008],[1002,261.308008],[1003,261.308008],[1004,261.308008],[1005,261.308008],[1006,261.308008],[1007,261.308008],[1008,261.308008],[1009,261.308008],[1010,261.308008],[1011,261.308104],[1012,261.308857],[1013,261.310678],[1014,261.313586],[1015,261.31713],[1016,261.320412],[1017,261.322223],[1018,261.321263],[1019,261.316431],[1020,261.307108],[1021,261.293411],[1022,261.276338],[1023,261.257786],[1024,261.240415],[1025,261.227347],[1026,261.221756],[1027,261.226364],[1028,261.242945],[1029,261.271883],[1030,261.311881],[1031,261.359866],[1032,261.411139],[1033,261.45977],[1034,261.49922],[1035,261.523116],[1036,261.526114],[1037,261.504718],[1038,261.457964],[1039,261.387853],[1040,261.299453],[1041,261.200629],[1042,261.101402],[1043,261.012969],[1044,260.94649],[1045,260.911766],[1046,260.915952],[1047,260.962479],[1048,261.050317],[1049,261.173703],[1050,261.322396],[1051,261.482477],[1052,261.637629],[1053,261.770784],[1054,261.865983],[1055,261.910229],[1056,261.895135],[1057,261.818164],[1058,261.683285],[1059,261.500949],[1060,261.287346],[1061,261.062977],[1062,260.850676],[1063,260.673272],[1064,260.551125],[1065,260.499813],[1066,260.528222],[1067,260.637278],[1068,260.819481],[1069,261.059332],[1070,261.334633],[1071,261.618567],[1072,261.88235],[1073,262.098192],[1074,262.242263],[1075,262.297334],[1076,262.254808],[1077,262.115897],[1078,261.891795],[1079,261.6028],[1080,261.276454],[1081,260.944863],[1082,260.641476],[1083,260.397643],[1084,260.239315],[1085,260.184246],[1086,260.239988],[1087,260.402925],[1088,260.658447],[1089,260.982286],[1090,261.342866],[1091,261.704458],[1092,262.030795],[1093,262.288797],[1094,262.451994],[1095,262.5033],[1096,262.436837],[1097,262.258604],[1098,261.98593],[1099,261.645749],[1100,261.271873],[1101,260.901555],[1102,260.57169],[1103,260.315052],[1104,260.15696],[1105,260.112723],[1106,260.186119],[1107,260.369077],[1108,260.642564],[1109,260.978615],[1110,261.343244],[1111,261.69996],[1112,262.013504],[1113,262.253412],[1114,262.39704],[1115,262.431754],[1116,262.356049],[1117,262.17951],[1118,261.921644],[1119,261.609699],[1120,261.275745],[1121,260.953317],[1122,260.673972],[1123,260.464145],[1124,260.342594],[1125,260.318709],[1126,260.391821],[1127,260.551571],[1128,260.779265],[1129,261.050038],[1130,261.335588],[1131,261.607178],[1132,261.838569],[1133,262.008594],[1134,262.103116],[1135,262.116173],[1136,262.050245],[1137,261.915625],[1138,261.729016],[1139,261.511518],[1140,261.286261],[1141,261.075928],[1142,260.900462],[1143,260.775159],[1144,260.709357],[1145,260.705822],[1146,260.760842],[1147,260.865018],[1148,261.004586],[1149,261.163134],[1150,261.323481],[1151,261.469526],[1152,261.587842],[1153,261.668897],[1154,261.707751],[1155,261.70422],[1156,261.662515],[1157,261.590424],[1158,261.49818],[1159,261.397148],[1160,261.298498],[1161,261.212018],[1162,261.145183],[1163,261.102567],[1164,261.085637],[1165,261.092927],[1166,261.120515],[1167,261.162751],[1168,261.213096],[1169,261.264984],[1170,261.312589],[1171,261.351412],[1172,261.378643],[1173,261.393268],[1174,261.395941],[1175,261.388653],[1176,261.374281],[1177,261.356071],[1178,261.337146],[1179,261.320101],[1180,261.306731],[1181,261.297909],[1182,261.293628],[1183,261.293171],[1184,261.295368],[1185,261.298893],[1186,261.302544],[1187,261.305458],[1188,261.307231],[1189,261.307933],[1190,261.308008],[1191,261.309019],[1192,261.31778],[1193,261.341159],[1194,261.385113],[1195,261.45468],[1196,261.553983],[1197,261.686227],[1198,261.853703],[1199,262.057785],[1200,262.298932],[1201,262.576684],[1202,262.889669],[1203,263.235595],[1204,263.611257],[1205,264.012531],[1206,264.43438],[1207,264.870849],[1208,265.315066],[1209,265.760295],[1210,266.205523],[1211,266.650752],[1212,267.095981],[1213,267.541209],[1214,267.986438],[1215,268.431667],[1216,268.876895],[1217,269.322124],[1218,269.767353],[1219,270.212581],[1220,270.65781],[1221,271.103039],[1222,271.548267],[1223,271.993496],[1224,272.438725],[1225,272.883954],[1226,273.329182],[1227,273.774411],[1228,274.21964],[1229,274.664868],[1230,275.110097],[1231,275.555326],[1232,276.000554],[1233,276.445783],[1234,276.891012],[1235,277.33624],[1236,277.781469],[1237,278.226698],[1238,278.671926],[1239,279.117155],[1240,279.562384],[1241,280.007612],[1242,280.452841],[1243,280.89807],[1244,281.343299],[1245,281.788527],[1246,282.233756],[1247,282.678985],[1248,283.124213],[1249,283.569442],[1250,284.014671],[1251,284.459899],[1252,284.905128],[1253,285.350357],[1254,285.795585],[1255,286.240814],[1256,286.686043],[1257,287.131271],[1258,287.5765],[1259,288.021729],[1260,288.466957],[1261,288.912186],[1262,289.357415],[1263,289.802644],[1264,290.247872],[1265,290.693101],[1266,291.13833],[1267,291.583558],[1268,292.028787],[1269,292.474016],[1270,292.919244],[1271,293.364473],[1272,293.809702],[1273,294.25493],[1274,294.700159],[1275,295.145388],[1276,295.590616],[1277,296.035845],[1278,296.481074],[1279,296.926303],[1280,297.371531],[1281,297.81676],[1282,298.261989],[1283,298.707217],[1284,299.152446],[1285,299.597675],[1286,300.042903],[1287,300.488132],[1288,300.933361],[1289,301.378589],[1290,301.823818],[1291,302.269047],[1292,302.714275],[1293,303.159504],[1294,303.604733],[1295,304.049961],[1296,304.49519],[1297,304.940419],[1298,305.385648],[1299,305.830876],[1300,306.276105],[1301,306.721334],[1302,307.166562],[1303,307.611791],[1304,308.05702],[1305,308.502248],[1306,308.947477],[1307,309.392706],[1308,309.837934],[1309,310.283163],[1310,310.728392],[1311,311.17362],[1312,311.618849],[1313,312.064078],[1314,312.509306],[1315,312.954535],[1316,313.399764],[1317,313.844993],[1318,314.290221],[1319,314.73545],[1320,315.180679],[1321,315.625907],[1322,316.071136],[1323,316.516365],[1324,316.961593],[1325,317.406822],[1326,317.852051],[1327,318.297279],[1328,318.742508],[1329,319.187737],[1330,319.632965],[1331,320.078194],[1332,320.523423],[1333,320.968652],[1334,321.41388],[1335,321.859109],[1336,322.304338],[1337,322.749566],[1338,323.194795],[1339,323.640024],[1340,324.085252],[1341,324.530481],[1342,324.97571],[1343,325.420938],[1344,325.866167],[1345,326.311396],[1346,326.756624],[1347,327.201853],[1348,327.647082],[1349,328.09231],[1350,328.537539],[1351,328.982768],[1352,329.427997],[1353,329.873225],[1354,330.318454],[1355,330.763683],[1356,331.208911],[1357,331.65414],[1358,332.099369],[1359,332.544597],[1360,332.989826],[1361,333.435055],[1362,333.880283],[1363,334.325512],[1364,334.770741],[1365,335.215969],[1366,335.661198],[1367,336.106427],[1368,336.551655],[1369,336.996884],[1370,337.442113],[1371,337.887342],[1372,338.33257],[1373,338.777799],[1374,339.223028],[1375,339.668256],[1376,340.113485],[1377,340.558714],[1378,341.003942],[1379,341.449171],[1380,341.8944],[1381,342.339628],[1382,342.784857],[1383,343.230086],[1384,343.675314],[1385,344.120543],[1386,344.565772],[1387,345.011001],[1388,345.456229],[1389,345.901458],[1390,346.346687],[1391,346.791915],[1392,347.237144],[1393,347.682373],[1394,348.127601],[1395,348.57283],[1396,349.018059],[1397,349.463287],[1398,349.908516],[1399,350.353745],[1400,350.798973],[1401,351.244202],[1402,351.689431],[1403,352.134659],[1404,352.579888],[1405,353.025117],[1406,353.470346],[1407,353.915574],[1408,354.360803],[1409,354.806032],[1410,355.25126],[1411,355.696489],[1412,356.141718],[1413,356.586946],[1414,357.032175],[1415,357.477404],[1416,357.922632],[1417,358.367861],[1418,358.81309],[1419,359.258318],[1420,359.703547],[1421,360.148776],[1422,360.594005],[1423,361.039233],[1424,361.484462],[1425,361.929691],[1426,362.374919],[1427,362.820148],[1428,363.265377],[1429,363.710605],[1430,364.155834],[1431,364.601063],[1432,365.046291],[1433,365.490509],[1434,365.926977],[1435,366.348826],[1436,366.7501],[1437,367.125762],[1438,367.471688],[1439,367.784673],[1440,368.062426],[1441,368.303572],[1442,368.507654],[1443,368.67513],[1444,368.807374],[1445,368.906677],[1446,368.976244],[1447,369.020198],[1448,369.043578],[1449,369.052338],[1450,369.05335],[1451,369.05335],[1452,369.05335],[1453,369.05335],[1454,369.05335],[1455,369.05335],[1456,369.05335],[1457,369.05335],[1458,369.05335],[1459,369.05335],[1460,369.05335],[1461,369.05335],[1462,369.05335],[1463,369.05335],[1464,369.05335],[1465,369.05335],[1466,369.05335],[1467,369.05335],[1468,369.05335],[1469,369.05335],[1470,369.05335],[1471,369.05335],[1472,369.05335],[1473,369.05335],[1474,369.05335],[1475,369.05335],[1476,369.05335],[1477,369.05335],[1478,369.05335],[1479,369.05335],[1480,369.05335],[1481,369.05335],[1482,369.05335],[1483,369.05335],[1484,369.05335],[1485,369.05335],[1486,369.05335],[1487,369.05335],[1488,369.05335],[1489,369.05335],[1490,369.05335],[1491,369.05335],[1492,369.05335],[1493,369.05335],[1494,369.05335],[1495,369.05335],[1496,369.05335],[1497,369.05335],[1498,369.05335],[1499,369.05335],[1500,369.05335],[1501,369.05335],[1502,369.05335],[1503,369.05335],[1504,369.05335],[1505,369.05335],[1506,369.05335],[1507,369.05335],[1508,369.05335],[1509,369.05335],[1510,369.05335],[1511,369.05335],[1512,369.05335],[1513,369.05335],[1514,369.05335],[1515,369.05335],[1516,369.05335],[1517,369.05335],[1518,369.05335],[1519,369.05335],[1520,369.05335],[1521,369.05335],[1522,369.05335],[1523,369.05335],[1524,369.05335],[1525,369.05335],[1526,369.05335],[1527,369.05335],[1528,369.05335],[1529,369.05335],[1530,369.05335],[1531,369.05335],[1532,369.05335],[1533,369.05335],[1534,369.05335],[1535,369.05335],[1536,369.05335],[1537,369.05335],[1538,369.05335],[1539,369.05335],[1540,369.05335],[1541,369.05335],[1542,369.05335],[1543,369.05335],[1544,369.05335],[1545,369.05335],[1546,369.05335],[1547,369.05335],[1548,369.05335],[1549,369.05335],[1550,369.05335],[1551,369.05335],[1552,369.05335],[1553,369.05335],[1554,369.05335],[1555,369.05335],[1556,369.05335],[1557,369.05335],[1558,369.05335],[1559,369.05335],[1560,369.05335],[1561,369.05335],[1562,369.05335],[1563,369.05335],[1564,369.05335],[1565,369.05335],[1566,369.05335],[1567,369.05335],[1568,369.05335],[1569,369.05335],[1570,369.05335],[1571,369.05335],[1572,369.05335],[1573,369.05335],[1574,369.05335],[1575,369.05335],[1576,369.05335],[1577,369.05335],[1578,369.05335],[1579,369.05335],[1580,369.05335],[1581,369.05335],[1582,369.05335],[1583,369.05335],[1584,369.05335],[1585,369.05335],[1586,369.05335],[1587,369.05335],[1588,369.05335],[1589,369.05335],[1590,369.05335],[1591,369.05335],[1592,369.05335],[1593,369.05335],[1594,369.05335],[1595,369.05335],[1596,369.05335],[1597,369.05335],[1598,369.05335],[1599,369.05335],[1600,369.05335],[1680,369.05334952668994]],"linearTerrain":true,"surfaces":[{"from":640,"to":940,"kind":"snow"}],"gears":[16.71,31.27,46.94,58.63,73.47,88.75,102.01,114.77,129.43,143.91,158.82,170.84,186.45,198.74,214.01,228.03,241.67,256.27,268.82,282.53,297.95,312.42,324.54,338.51,353.18,368.27,381.7,396.11,409.32,424.79,437.75,450.92,466.73,480.62,494.14,507.89,520.74,535.01,550.83,562.57,577.88,591.65,604.98,620.49,634.31,647.68,663.38,676,689.67,704.72,718.25,733.33,744.57,758.65,773.68,786.75,803.47,817.2,831.19,844.51,858.65,872.61,885.49,899.87,912.91,926.86,942.91,954.87,970.12,985.06,997.41,1010.94,1024.65,1039.4,1054.67,1069.03,1081.71,1096.01,1108.83,1123.42,1139.01,1152.78,1167.23,1179.58,1195.42,1209.31,1222.87,1234.87,1249.59,1264.12,1278.63,1292.11,1307.16,1319.09,1332.68,1349.23,1361.15,1376.16,1390.05,1404.46,1417.95,1433.13,1446.01,1459.67,1473.39,1487.78,1501.42,1516.64,1530.35,1544.25,1558.03,1571.61,1585.18],"coinValues":[30,30,30,30,30,30,30,30,30,30,30,30,30,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,40,40,40,40,40,40,40,40,40,40,40,40,40,40,40,40,40,40,40,40,40,40,40,40,40,40,40,45,45,45,45,45,45,45,45,45,45,45,45,45,45,45,45,45,45,45,45,45,45,45,45,45,45,45,45,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50],"bridges":[],"checkpoints":[{"id":"mountain-pass-checkpoint-0","x":420,"reward":340},{"id":"mountain-pass-checkpoint-1","x":940,"reward":340},{"id":"mountain-pass-checkpoint-2","x":1190,"reward":340}],"fuelValidation":{"state":"measured in complete recommended-profile simulation","targetRho":[0.7,0.85],"referenceProfile":{"engine":6,"suspension":4,"tires":5,"tank":4},"legs":[{"from":9,"to":140,"T_ref":7.9667,"C_ref":56,"rho":0.1423,"fuelRemaining":48.0333,"arrivalTick":478},{"from":140,"to":800,"T_ref":36.2833,"C_ref":56,"rho":0.6479,"fuelRemaining":19.7167,"arrivalTick":2655},{"from":800,"to":1400,"T_ref":40.05,"C_ref":56,"rho":0.7152,"fuelRemaining":15.95,"arrivalTick":5058},{"from":1400,"to":1609,"T_ref":10.2833,"C_ref":56,"rho":0.1836,"fuelRemaining":45.7167,"arrivalTick":5675,"finish":true}]},"streams":{"geometry":"geometry","coins":"coins","fuel":"fuel","decorations":"decorations","fuelMarker":0.9563947888091207},"decorationSeed":3660085544,"validation":{"state":"measured full-course attempts","sampleCount":1000,"source":"artifacts/pixel-drive-campaign-balance.json","notAnImpossibilityProof":true,"profiles":[{"name":"base","upgrades":{"engine":0,"suspension":0,"tires":0,"tank":0},"n":100,"wins":0,"distanceRange":[215.7,262.18],"failures":{"route_exit":100}},{"name":"recommended","upgrades":{"engine":6,"suspension":4,"tires":5,"tank":4},"n":100,"wins":91,"distanceRange":[466.35,1600.49],"failures":{"overturned":9}},{"name":"maximum","upgrades":{"engine":10,"suspension":10,"tires":10,"tank":10},"n":100,"wins":94,"distanceRange":[434.28,1600.54],"failures":{"overturned":6}},{"name":"engine-only","upgrades":{"engine":10,"suspension":0,"tires":0,"tank":0},"n":100,"wins":84,"distanceRange":[434.63,1600.52],"failures":{"overturned":12,"route_exit":4}},{"name":"tank-only","upgrades":{"engine":0,"suspension":0,"tires":0,"tank":10},"n":100,"wins":0,"distanceRange":[215.7,262.18],"failures":{"fuel":89,"route_exit":11}},{"name":"strong-F0","upgrades":{"engine":10,"suspension":10,"tires":10,"tank":0},"n":100,"wins":90,"distanceRange":[434.28,1600.54],"failures":{"overturned":7,"route_exit":3}},{"name":"recommended-minus-engine","upgrades":{"engine":5,"suspension":4,"tires":5,"tank":4},"n":100,"wins":86,"distanceRange":[889.3,1600.47],"failures":{"overturned":6,"route_exit":8}},{"name":"recommended-minus-suspension","upgrades":{"engine":6,"suspension":3,"tires":5,"tank":4},"n":100,"wins":89,"distanceRange":[471.3,1600.46],"failures":{"overturned":11}},{"name":"recommended-minus-tires","upgrades":{"engine":6,"suspension":4,"tires":4,"tank":4},"n":100,"wins":91,"distanceRange":[467.89,1600.48],"failures":{"overturned":9}},{"name":"recommended-minus-tank","upgrades":{"engine":6,"suspension":4,"tires":5,"tank":3},"n":100,"wins":90,"distanceRange":[466.35,1600.49],"failures":{"overturned":10}}],"reference":{"upgrades":{"engine":6,"suspension":4,"tires":5,"tank":4},"targetSpeed":24,"holdTicks":12,"ticks":5675,"seconds":94.5833,"inputChanges":59}}},{"id":5,"stageId":"winter-route","campaignIndex":4,"name":"Зимовий маршрут","meters":2200,"recommended":{"engine":7,"suspension":6,"tires":7,"tank":5},"finishReward":2500,"description":"Снігові підйоми, короткий лід і сухі зони відновлення навчають дозувати тягу.","challenge":"Зчеплення та контроль газу","hint":"Колеса буксують — спробуй м’якший газ або кращі шини.","modules":[{"id":"winter-route-0","type":"intro","name":"Знайомий початок","from":0,"to":180,"geometry":{"firstVertex":1,"lastVertex":181,"heightChange":-5.329070518200751e-15,"maximumSlopeDegrees":5.9762976810402675},"material":"dirt","entry":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.35,0.35],"angularSpeed":[-1.2,1.2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"exit":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.5,0.5],"angularSpeed":[-2,2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"recovery":{"from":180,"to":180},"pickups":{"coins":[0,1,2,3,4,5,6,7,8,9,10,11],"fuel":[0]},"validation":{"state":"measured within complete route, not isolated proof","source":"artifacts/pixel-drive-campaign-balance.json","reference":{"entry":{"x":9,"speed":0,"bodyAngle":0,"angularSpeed":0,"groundedWheels":2,"suspensionCompression":[0,0],"fuelSeconds":60,"tick":0},"exit":{"x":180.0123,"speed":24.2221,"bodyAngle":0.0136,"angularSpeed":0.1099,"groundedWheels":2,"suspensionCompression":[0.2477,0.2152],"fuelSeconds":58.7,"tick":565}},"profiles":[{"name":"base","n":100,"entered":100,"exited":100,"fullCourseWins":0,"entrySpeedRange":[0.1513,0.1513],"entryFuelRange":[39.9833,39.9833]},{"name":"recommended","n":100,"entered":100,"exited":100,"fullCourseWins":93,"entrySpeedRange":[0.1503,0.1507],"entryFuelRange":[59.9833,59.9833]},{"name":"maximum","n":100,"entered":100,"exited":100,"fullCourseWins":92,"entrySpeedRange":[0.1497,0.1502],"entryFuelRange":[79.9833,79.9833]},{"name":"engine-only","n":100,"entered":100,"exited":100,"fullCourseWins":74,"entrySpeedRange":[0.1513,0.1518],"entryFuelRange":[39.9833,39.9833]},{"name":"tank-only","n":100,"entered":100,"exited":100,"fullCourseWins":0,"entrySpeedRange":[0.1513,0.1513],"entryFuelRange":[79.9833,79.9833]},{"name":"strong-F0","n":100,"entered":100,"exited":100,"fullCourseWins":92,"entrySpeedRange":[0.1497,0.1502],"entryFuelRange":[39.9833,39.9833]},{"name":"recommended-minus-engine","n":100,"entered":100,"exited":100,"fullCourseWins":0,"entrySpeedRange":[0.1503,0.1506],"entryFuelRange":[59.9833,59.9833]},{"name":"recommended-minus-suspension","n":100,"entered":100,"exited":100,"fullCourseWins":94,"entrySpeedRange":[0.1505,0.1508],"entryFuelRange":[59.9833,59.9833]},{"name":"recommended-minus-tires","n":100,"entered":100,"exited":100,"fullCourseWins":93,"entrySpeedRange":[0.1503,0.1507],"entryFuelRange":[59.9833,59.9833]},{"name":"recommended-minus-tank","n":100,"entered":100,"exited":100,"fullCourseWins":88,"entrySpeedRange":[0.1503,0.1507],"entryFuelRange":[55.9833,55.9833]}]}},{"id":"winter-route-1","type":"torque","name":"Контрольний підйом","from":180,"to":440,"geometry":{"firstVertex":181,"lastVertex":441,"heightChange":107.74534184466559,"maximumSlopeDegrees":24.000015047622437},"material":"dirt","entry":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.35,0.35],"angularSpeed":[-1.2,1.2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"exit":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.5,0.5],"angularSpeed":[-2,2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"recovery":{"from":440,"to":510},"pickups":{"coins":[12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30],"fuel":[]},"validation":{"state":"measured within complete route, not isolated proof","source":"artifacts/pixel-drive-campaign-balance.json","reference":{"entry":{"x":180.0123,"speed":24.2221,"bodyAngle":0.0136,"angularSpeed":0.1099,"groundedWheels":2,"suspensionCompression":[0.2477,0.2152],"fuelSeconds":58.7,"tick":565},"exit":{"x":440.2548,"speed":18.2896,"bodyAngle":0.1215,"angularSpeed":-0.3126,"groundedWheels":0,"suspensionCompression":[0.0064,-0.0041],"fuelSeconds":45.0167,"tick":1386}},"profiles":[{"name":"base","n":100,"entered":100,"exited":0,"fullCourseWins":0,"entrySpeedRange":[14.2277,23.0628],"entryFuelRange":[37.8167,38.6]},{"name":"recommended","n":100,"entered":100,"exited":100,"fullCourseWins":93,"entrySpeedRange":[14.2626,30.4091],"entryFuelRange":[57.8167,58.9333]},{"name":"maximum","n":100,"entered":100,"exited":100,"fullCourseWins":92,"entrySpeedRange":[14.5758,32.8304],"entryFuelRange":[77.8667,79.0167]},{"name":"engine-only","n":100,"entered":100,"exited":100,"fullCourseWins":74,"entrySpeedRange":[14.2905,32.8246],"entryFuelRange":[37.7833,39.0167]},{"name":"tank-only","n":100,"entered":100,"exited":0,"fullCourseWins":0,"entrySpeedRange":[14.2277,23.0628],"entryFuelRange":[77.8167,78.6]},{"name":"strong-F0","n":100,"entered":100,"exited":100,"fullCourseWins":92,"entrySpeedRange":[14.5758,32.8304],"entryFuelRange":[37.8667,39.0167]},{"name":"recommended-minus-engine","n":100,"entered":100,"exited":100,"fullCourseWins":0,"entrySpeedRange":[14.3243,29.4718],"entryFuelRange":[57.8167,58.9167]},{"name":"recommended-minus-suspension","n":100,"entered":100,"exited":100,"fullCourseWins":94,"entrySpeedRange":[14.2631,30.4179],"entryFuelRange":[57.8167,58.95]},{"name":"recommended-minus-tires","n":100,"entered":100,"exited":100,"fullCourseWins":93,"entrySpeedRange":[14.2626,30.4162],"entryFuelRange":[57.8167,58.95]},{"name":"recommended-minus-tank","n":100,"entered":100,"exited":100,"fullCourseWins":88,"entrySpeedRange":[14.2626,30.4091],"entryFuelRange":[53.8167,54.9333]}]}},{"id":"winter-route-2","type":"recovery","name":"Відновлення","from":440,"to":510,"geometry":{"firstVertex":441,"lastVertex":511,"heightChange":0,"maximumSlopeDegrees":0},"material":"dirt","entry":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.35,0.35],"angularSpeed":[-1.2,1.2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"exit":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.5,0.5],"angularSpeed":[-2,2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"recovery":{"from":510,"to":510},"pickups":{"coins":[31,32,33,34,35],"fuel":[]},"validation":{"state":"measured within complete route, not isolated proof","source":"artifacts/pixel-drive-campaign-balance.json","reference":{"entry":{"x":440.2548,"speed":18.2896,"bodyAngle":0.1215,"angularSpeed":-0.3126,"groundedWheels":0,"suspensionCompression":[0.0064,-0.0041],"fuelSeconds":45.0167,"tick":1386},"exit":{"x":510.1808,"speed":24.0764,"bodyAngle":0.0036,"angularSpeed":0.132,"groundedWheels":2,"suspensionCompression":[0.2501,0.2477],"fuelSeconds":41.7833,"tick":1580}},"profiles":[{"name":"base","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"recommended","n":100,"entered":100,"exited":99,"fullCourseWins":93,"entrySpeedRange":[13.6861,18.7725],"entryFuelRange":[38.8833,46.55]},{"name":"maximum","n":100,"entered":100,"exited":99,"fullCourseWins":92,"entrySpeedRange":[14.6097,23.2563],"entryFuelRange":[59.1167,68.3833]},{"name":"engine-only","n":100,"entered":100,"exited":99,"fullCourseWins":74,"entrySpeedRange":[14.6891,23.3021],"entryFuelRange":[19.0667,28.6]},{"name":"tank-only","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"strong-F0","n":100,"entered":100,"exited":99,"fullCourseWins":92,"entrySpeedRange":[14.6097,23.2563],"entryFuelRange":[19.1167,28.3833]},{"name":"recommended-minus-engine","n":100,"entered":100,"exited":99,"fullCourseWins":0,"entrySpeedRange":[14.2323,17.9091],"entryFuelRange":[38.8333,45.5833]},{"name":"recommended-minus-suspension","n":100,"entered":100,"exited":99,"fullCourseWins":94,"entrySpeedRange":[13.5493,18.7888],"entryFuelRange":[38.8833,46.5667]},{"name":"recommended-minus-tires","n":100,"entered":100,"exited":99,"fullCourseWins":93,"entrySpeedRange":[13.7258,18.7722],"entryFuelRange":[38.8667,46.5333]},{"name":"recommended-minus-tank","n":100,"entered":100,"exited":99,"fullCourseWins":88,"entrySpeedRange":[13.6861,18.7725],"entryFuelRange":[34.8833,42.55]}]}},{"id":"winter-route-3","type":"snow-climb","name":"Сніговий підйом","from":510,"to":890,"geometry":{"firstVertex":511,"lastVertex":891,"heightChange":217.51154408798055,"maximumSlopeDegrees":31.000016037893268},"material":"snow","entry":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.35,0.35],"angularSpeed":[-1.2,1.2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"exit":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.5,0.5],"angularSpeed":[-2,2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"recovery":{"from":890,"to":970},"pickups":{"coins":[36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62],"fuel":[1]},"validation":{"state":"measured within complete route, not isolated proof","source":"artifacts/pixel-drive-campaign-balance.json","reference":{"entry":{"x":510.1808,"speed":24.0764,"bodyAngle":0.0036,"angularSpeed":0.132,"groundedWheels":2,"suspensionCompression":[0.2501,0.2477],"fuelSeconds":41.7833,"tick":1580},"exit":{"x":890.0263,"speed":10.8944,"bodyAngle":0.0819,"angularSpeed":0.0344,"groundedWheels":2,"suspensionCompression":[0.2806,0.0753],"fuelSeconds":33.9667,"tick":3866}},"profiles":[{"name":"base","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"recommended","n":100,"entered":99,"exited":99,"fullCourseWins":93,"entrySpeedRange":[14.2177,26.7773],"entryFuelRange":[34.0667,43.45]},{"name":"maximum","n":100,"entered":99,"exited":99,"fullCourseWins":92,"entrySpeedRange":[14.5388,29.0328],"entryFuelRange":[54.3,65.4667]},{"name":"engine-only","n":100,"entered":99,"exited":82,"fullCourseWins":74,"entrySpeedRange":[14.0821,29.0368],"entryFuelRange":[14.1833,25.7]},{"name":"tank-only","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"strong-F0","n":100,"entered":99,"exited":99,"fullCourseWins":92,"entrySpeedRange":[14.5388,29.0328],"entryFuelRange":[14.3,25.4667]},{"name":"recommended-minus-engine","n":100,"entered":99,"exited":0,"fullCourseWins":0,"entrySpeedRange":[14.1795,25.9453],"entryFuelRange":[34.0667,42.35]},{"name":"recommended-minus-suspension","n":100,"entered":99,"exited":99,"fullCourseWins":94,"entrySpeedRange":[14.26,26.75],"entryFuelRange":[34.0833,43.4333]},{"name":"recommended-minus-tires","n":100,"entered":99,"exited":99,"fullCourseWins":93,"entrySpeedRange":[14.2141,26.7722],"entryFuelRange":[34.0667,43.35]},{"name":"recommended-minus-tank","n":100,"entered":99,"exited":99,"fullCourseWins":88,"entrySpeedRange":[14.2177,26.7773],"entryFuelRange":[30.0667,39.45]}]}},{"id":"winter-route-4","type":"recovery","name":"Відновлення","from":890,"to":970,"geometry":{"firstVertex":891,"lastVertex":971,"heightChange":0,"maximumSlopeDegrees":0},"material":"dirt","entry":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.35,0.35],"angularSpeed":[-1.2,1.2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"exit":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.5,0.5],"angularSpeed":[-2,2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"recovery":{"from":970,"to":970},"pickups":{"coins":[63,64,65,66,67,68],"fuel":[]},"validation":{"state":"measured within complete route, not isolated proof","source":"artifacts/pixel-drive-campaign-balance.json","reference":{"entry":{"x":890.0263,"speed":10.8944,"bodyAngle":0.0819,"angularSpeed":0.0344,"groundedWheels":2,"suspensionCompression":[0.2806,0.0753],"fuelSeconds":33.9667,"tick":3866},"exit":{"x":970.2115,"speed":24.2465,"bodyAngle":-0.0038,"angularSpeed":-0.0008,"groundedWheels":2,"suspensionCompression":[0.2408,0.252],"fuelSeconds":29.8667,"tick":4112}},"profiles":[{"name":"base","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"recommended","n":100,"entered":99,"exited":99,"fullCourseWins":93,"entrySpeedRange":[10.0558,11.2277],"entryFuelRange":[19.2833,36.15]},{"name":"maximum","n":100,"entered":99,"exited":99,"fullCourseWins":92,"entrySpeedRange":[13.5822,15.0473],"entryFuelRange":[64.2667,66.6333]},{"name":"engine-only","n":100,"entered":82,"exited":82,"fullCourseWins":74,"entrySpeedRange":[9.2508,12.2571],"entryFuelRange":[11.8667,24.0333]},{"name":"tank-only","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"strong-F0","n":100,"entered":99,"exited":99,"fullCourseWins":92,"entrySpeedRange":[13.5822,15.0473],"entryFuelRange":[24.2667,26.6333]},{"name":"recommended-minus-engine","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"recommended-minus-suspension","n":100,"entered":99,"exited":99,"fullCourseWins":94,"entrySpeedRange":[10.1419,11.3486],"entryFuelRange":[20.9,36.6]},{"name":"recommended-minus-tires","n":100,"entered":99,"exited":99,"fullCourseWins":93,"entrySpeedRange":[9.646,10.94],"entryFuelRange":[8.8167,35.0167]},{"name":"recommended-minus-tank","n":100,"entered":99,"exited":99,"fullCourseWins":88,"entrySpeedRange":[10.0558,11.2277],"entryFuelRange":[15.2833,32.15]}]}},{"id":"winter-route-5","type":"climb","name":"Плавний схил","from":970,"to":1190,"geometry":{"firstVertex":971,"lastVertex":1191,"heightChange":-42.93642545734008,"maximumSlopeDegrees":12.00002402882636},"material":"dirt","entry":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.35,0.35],"angularSpeed":[-1.2,1.2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"exit":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.5,0.5],"angularSpeed":[-2,2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"recovery":{"from":1190,"to":1190},"pickups":{"coins":[69,70,71,72,73,74,75,76,77,78,79,80,81,82,83],"fuel":[]},"validation":{"state":"measured within complete route, not isolated proof","source":"artifacts/pixel-drive-campaign-balance.json","reference":{"entry":{"x":970.2115,"speed":24.2465,"bodyAngle":-0.0038,"angularSpeed":-0.0008,"groundedWheels":2,"suspensionCompression":[0.2408,0.252],"fuelSeconds":29.8667,"tick":4112},"exit":{"x":1190.0746,"speed":24.8864,"bodyAngle":0.0136,"angularSpeed":0.1609,"groundedWheels":2,"suspensionCompression":[0.4963,0.4603],"fuelSeconds":20.9,"tick":4650}},"profiles":[{"name":"base","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"recommended","n":100,"entered":99,"exited":99,"fullCourseWins":93,"entrySpeedRange":[14.5355,26.2786],"entryFuelRange":[13.6667,32.1167]},{"name":"maximum","n":100,"entered":99,"exited":99,"fullCourseWins":92,"entrySpeedRange":[14.2383,29.3882],"entryFuelRange":[58.7167,63.1]},{"name":"engine-only","n":100,"entered":82,"exited":82,"fullCourseWins":74,"entrySpeedRange":[22.4663,28.9074],"entryFuelRange":[7.6667,20.3667]},{"name":"tank-only","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"strong-F0","n":100,"entered":99,"exited":99,"fullCourseWins":92,"entrySpeedRange":[14.2383,29.3882],"entryFuelRange":[18.7167,23.1]},{"name":"recommended-minus-engine","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"recommended-minus-suspension","n":100,"entered":99,"exited":99,"fullCourseWins":94,"entrySpeedRange":[14.1912,26.2999],"entryFuelRange":[15.2833,32.5833]},{"name":"recommended-minus-tires","n":100,"entered":99,"exited":99,"fullCourseWins":93,"entrySpeedRange":[14.7117,26.2308],"entryFuelRange":[3.1833,30.95]},{"name":"recommended-minus-tank","n":100,"entered":99,"exited":99,"fullCourseWins":88,"entrySpeedRange":[14.5355,26.2786],"entryFuelRange":[9.6667,28.1167]}]}},{"id":"winter-route-6","type":"ice","name":"Короткий лід","from":1190,"to":1255,"geometry":{"firstVertex":1191,"lastVertex":1256,"heightChange":0,"maximumSlopeDegrees":0},"material":"ice","entry":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.35,0.35],"angularSpeed":[-1.2,1.2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"exit":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.5,0.5],"angularSpeed":[-2,2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"recovery":{"from":1255,"to":1330},"pickups":{"coins":[84,85,86,87,88],"fuel":[]},"validation":{"state":"measured within complete route, not isolated proof","source":"artifacts/pixel-drive-campaign-balance.json","reference":{"entry":{"x":1190.0746,"speed":24.8864,"bodyAngle":0.0136,"angularSpeed":0.1609,"groundedWheels":2,"suspensionCompression":[0.4963,0.4603],"fuelSeconds":20.9,"tick":4650},"exit":{"x":1255.2524,"speed":23.9981,"bodyAngle":-0.0033,"angularSpeed":0,"groundedWheels":2,"suspensionCompression":[0.2424,0.2511],"fuelSeconds":18.2333,"tick":4810}},"profiles":[{"name":"base","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"recommended","n":100,"entered":99,"exited":99,"fullCourseWins":93,"entrySpeedRange":[13.5055,37.6876],"entryFuelRange":[0,25.2167]},{"name":"maximum","n":100,"entered":99,"exited":99,"fullCourseWins":92,"entrySpeedRange":[13.1711,37.9735],"entryFuelRange":[43.6833,56.5833]},{"name":"engine-only","n":100,"entered":82,"exited":82,"fullCourseWins":74,"entrySpeedRange":[21.938,38.0113],"entryFuelRange":[0,13.5833]},{"name":"tank-only","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"strong-F0","n":100,"entered":99,"exited":99,"fullCourseWins":92,"entrySpeedRange":[13.1711,37.9735],"entryFuelRange":[3.6833,16.5833]},{"name":"recommended-minus-engine","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"recommended-minus-suspension","n":100,"entered":99,"exited":99,"fullCourseWins":94,"entrySpeedRange":[13.8243,37.882],"entryFuelRange":[0.4333,25.7167]},{"name":"recommended-minus-tires","n":100,"entered":99,"exited":99,"fullCourseWins":93,"entrySpeedRange":[14.3308,37.7336],"entryFuelRange":[0,24.0667]},{"name":"recommended-minus-tank","n":100,"entered":99,"exited":99,"fullCourseWins":88,"entrySpeedRange":[13.4657,37.6876],"entryFuelRange":[0,21.2167]}]}},{"id":"winter-route-7","type":"recovery","name":"Відновлення","from":1255,"to":1330,"geometry":{"firstVertex":1256,"lastVertex":1331,"heightChange":0,"maximumSlopeDegrees":0},"material":"dirt","entry":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.35,0.35],"angularSpeed":[-1.2,1.2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"exit":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.5,0.5],"angularSpeed":[-2,2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"recovery":{"from":1330,"to":1330},"pickups":{"coins":[89,90,91,92,93],"fuel":[]},"validation":{"state":"measured within complete route, not isolated proof","source":"artifacts/pixel-drive-campaign-balance.json","reference":{"entry":{"x":1255.2524,"speed":23.9981,"bodyAngle":-0.0033,"angularSpeed":0,"groundedWheels":2,"suspensionCompression":[0.2424,0.2511],"fuelSeconds":18.2333,"tick":4810},"exit":{"x":1330.0157,"speed":24.0536,"bodyAngle":-0.0041,"angularSpeed":-0.0025,"groundedWheels":2,"suspensionCompression":[0.2415,0.2522],"fuelSeconds":15.1333,"tick":4996}},"profiles":[{"name":"base","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"recommended","n":100,"entered":99,"exited":99,"fullCourseWins":93,"entrySpeedRange":[12.5996,36.6233],"entryFuelRange":[0,23.3333]},{"name":"maximum","n":100,"entered":99,"exited":99,"fullCourseWins":92,"entrySpeedRange":[14.4368,36.9142],"entryFuelRange":[39.2333,54.8]},{"name":"engine-only","n":100,"entered":82,"exited":82,"fullCourseWins":74,"entrySpeedRange":[21.5266,36.9502],"entryFuelRange":[0,11.7]},{"name":"tank-only","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"strong-F0","n":100,"entered":99,"exited":99,"fullCourseWins":92,"entrySpeedRange":[14.4368,36.9142],"entryFuelRange":[0,14.8]},{"name":"recommended-minus-engine","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"recommended-minus-suspension","n":100,"entered":99,"exited":99,"fullCourseWins":94,"entrySpeedRange":[13.5967,36.8103],"entryFuelRange":[0,23.9667]},{"name":"recommended-minus-tires","n":100,"entered":99,"exited":99,"fullCourseWins":93,"entrySpeedRange":[13.4268,36.6678],"entryFuelRange":[0,22.2667]},{"name":"recommended-minus-tank","n":100,"entered":99,"exited":99,"fullCourseWins":88,"entrySpeedRange":[12.5489,36.6233],"entryFuelRange":[0,19.3333]}]}},{"id":"winter-route-8","type":"rollers","name":"Хвиляста ділянка","from":1330,"to":1550,"geometry":{"firstVertex":1331,"lastVertex":1551,"heightChange":-2.2737367544323206e-13,"maximumSlopeDegrees":17.131861944332936},"material":"dirt","entry":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.35,0.35],"angularSpeed":[-1.2,1.2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"exit":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.5,0.5],"angularSpeed":[-2,2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"recovery":{"from":1550,"to":1550},"pickups":{"coins":[94,95,96,97,98,99,100,101,102,103,104,105,106,107,108,109],"fuel":[2]},"validation":{"state":"measured within complete route, not isolated proof","source":"artifacts/pixel-drive-campaign-balance.json","reference":{"entry":{"x":1330.0157,"speed":24.0536,"bodyAngle":-0.0041,"angularSpeed":-0.0025,"groundedWheels":2,"suspensionCompression":[0.2415,0.2522],"fuelSeconds":15.1333,"tick":4996},"exit":{"x":1550.36,"speed":23.0465,"bodyAngle":0.0651,"angularSpeed":0.0003,"groundedWheels":2,"suspensionCompression":[0.324,0.1646],"fuelSeconds":52.2833,"tick":5685}},"profiles":[{"name":"base","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"recommended","n":100,"entered":99,"exited":93,"fullCourseWins":93,"entrySpeedRange":[11.4966,35.4064],"entryFuelRange":[0,21.2167]},{"name":"maximum","n":100,"entered":99,"exited":92,"fullCourseWins":92,"entrySpeedRange":[14.426,36.4355],"entryFuelRange":[34.1333,52.75]},{"name":"engine-only","n":100,"entered":82,"exited":74,"fullCourseWins":74,"entrySpeedRange":[20.5214,36.4491],"entryFuelRange":[0,9.6333]},{"name":"tank-only","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"strong-F0","n":100,"entered":99,"exited":92,"fullCourseWins":92,"entrySpeedRange":[13.3921,36.4355],"entryFuelRange":[0,12.75]},{"name":"recommended-minus-engine","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"recommended-minus-suspension","n":100,"entered":99,"exited":94,"fullCourseWins":94,"entrySpeedRange":[12.5306,35.5933],"entryFuelRange":[0,21.8833]},{"name":"recommended-minus-tires","n":100,"entered":99,"exited":93,"fullCourseWins":93,"entrySpeedRange":[12.3514,35.4486],"entryFuelRange":[0,20.1833]},{"name":"recommended-minus-tank","n":100,"entered":99,"exited":93,"fullCourseWins":88,"entrySpeedRange":[11.4457,35.4064],"entryFuelRange":[0,17.2167]}]}},{"id":"winter-route-9","type":"snow-climb","name":"Сніговий підйом","from":1550,"to":1980,"geometry":{"firstVertex":1551,"lastVertex":1981,"heightChange":237.86831090613566,"maximumSlopeDegrees":30.000031404253537},"material":"snow","entry":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.35,0.35],"angularSpeed":[-1.2,1.2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"exit":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.5,0.5],"angularSpeed":[-2,2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"recovery":{"from":1980,"to":2200},"pickups":{"coins":[110,111,112,113,114,115,116,117,118,119,120,121,122,123,124,125,126,127,128,129,130,131,132,133,134,135,136,137,138,139,140],"fuel":[]},"validation":{"state":"measured within complete route, not isolated proof","source":"artifacts/pixel-drive-campaign-balance.json","reference":{"entry":{"x":1550.36,"speed":23.0465,"bodyAngle":0.0651,"angularSpeed":0.0003,"groundedWheels":2,"suspensionCompression":[0.324,0.1646],"fuelSeconds":52.2833,"tick":5685},"exit":{"x":1980.0171,"speed":12.1937,"bodyAngle":0.0748,"angularSpeed":0.0226,"groundedWheels":2,"suspensionCompression":[0.2607,0.0698],"fuelSeconds":14.7,"tick":7940}},"profiles":[{"name":"base","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"recommended","n":100,"entered":93,"exited":93,"fullCourseWins":93,"entrySpeedRange":[14.1874,25.5574],"entryFuelRange":[49.35,54.4]},{"name":"maximum","n":100,"entered":92,"exited":92,"fullCourseWins":92,"entrySpeedRange":[14.6679,28.0813],"entryFuelRange":[69.1167,74.6667]},{"name":"engine-only","n":100,"entered":74,"exited":74,"fullCourseWins":74,"entrySpeedRange":[22.6702,27.9301],"entryFuelRange":[30.0833,35.2833]},{"name":"tank-only","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"strong-F0","n":100,"entered":92,"exited":92,"fullCourseWins":92,"entrySpeedRange":[14.3438,28.0813],"entryFuelRange":[29.4,34.6667]},{"name":"recommended-minus-engine","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"recommended-minus-suspension","n":100,"entered":94,"exited":94,"fullCourseWins":94,"entrySpeedRange":[14.8365,24.892],"entryFuelRange":[49.35,54.2333]},{"name":"recommended-minus-tires","n":100,"entered":93,"exited":93,"fullCourseWins":93,"entrySpeedRange":[14.365,25.2528],"entryFuelRange":[49.35,54.1167]},{"name":"recommended-minus-tank","n":100,"entered":93,"exited":88,"fullCourseWins":88,"entrySpeedRange":[14.3053,25.5574],"entryFuelRange":[45.2833,50.4]}]}},{"id":"winter-route-10","type":"recovery","name":"Відновлення","from":1980,"to":2200,"geometry":{"firstVertex":1981,"lastVertex":2201,"heightChange":0,"maximumSlopeDegrees":0},"material":"dirt","entry":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.35,0.35],"angularSpeed":[-1.2,1.2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"exit":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.5,0.5],"angularSpeed":[-2,2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"recovery":{"from":2200,"to":2200},"pickups":{"coins":[141,142,143,144,145,146,147,148,149,150,151,152,153,154,155],"fuel":[3]},"validation":{"state":"measured within complete route, not isolated proof","source":"artifacts/pixel-drive-campaign-balance.json","reference":{"entry":{"x":1980.0171,"speed":12.1937,"bodyAngle":0.0748,"angularSpeed":0.0226,"groundedWheels":2,"suspensionCompression":[0.2607,0.0698],"fuelSeconds":14.7,"tick":7940},"exit":{"x":2200.1592,"speed":24.0912,"bodyAngle":0.0033,"angularSpeed":0.095,"groundedWheels":2,"suspensionCompression":[0.2481,0.2442],"fuelSeconds":51.95,"tick":8527}},"profiles":[{"name":"base","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"recommended","n":100,"entered":93,"exited":93,"fullCourseWins":93,"entrySpeedRange":[9.9345,12.378],"entryFuelRange":[0,18.4167]},{"name":"maximum","n":100,"entered":92,"exited":92,"fullCourseWins":92,"entrySpeedRange":[14.2439,15.4892],"entryFuelRange":[38.2667,50.0833]},{"name":"engine-only","n":100,"entered":74,"exited":74,"fullCourseWins":74,"entrySpeedRange":[5.0537,13.7524],"entryFuelRange":[0,8.65]},{"name":"tank-only","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"strong-F0","n":100,"entered":92,"exited":92,"fullCourseWins":92,"entrySpeedRange":[7.2,15.4892],"entryFuelRange":[0,10.0833]},{"name":"recommended-minus-engine","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"recommended-minus-suspension","n":100,"entered":94,"exited":94,"fullCourseWins":94,"entrySpeedRange":[11.2987,12.387],"entryFuelRange":[0,18.1667]},{"name":"recommended-minus-tires","n":100,"entered":93,"exited":93,"fullCourseWins":93,"entrySpeedRange":[3.8805,12.0737],"entryFuelRange":[0,16.75]},{"name":"recommended-minus-tank","n":100,"entered":88,"exited":88,"fullCourseWins":88,"entrySpeedRange":[7.0847,12.378],"entryFuelRange":[0,14.4167]}]}}],"fuel":[150,690,1420,2010],"seed":926640557,"generatorVersion":3,"length":2200,"max_ticks":36000,"terrain":[[-100,12],[0,12],[1,12.000047],[2,12.000329],[3,12.001023],[4,12.002289],[5,12.004263],[6,12.007051],[7,12.010725],[8,12.015317],[9,12.020817],[10,12.027171],[11,12.034282],[12,12.042005],[13,12.050156],[14,12.058509],[15,12.066803],[16,12.07475],[17,12.082033],[18,12.088324],[19,12.093282],[20,12.096569],[21,12.097855],[22,12.096828],[23,12.093205],[24,12.086736],[25,12.077219],[26,12.064502],[27,12.048494],[28,12.029167],[29,12.006566],[30,11.980808],[31,11.952085],[32,11.920665],[33,11.886893],[34,11.851184],[35,11.814021],[36,11.775949],[37,11.737568],[38,11.699523],[39,11.662494],[40,11.627186],[41,11.594316],[42,11.564601],[43,11.538743],[44,11.517417],[45,11.501257],[46,11.490844],[47,11.48669],[48,11.489231],[49,11.498812],[50,11.51568],[51,11.539973],[52,11.571718],[53,11.610822],[54,11.657074],[55,11.710138],[56,11.769563],[57,11.834776],[58,11.9051],[59,11.97975],[60,12.057852],[61,12.138448],[62,12.220513],[63,12.302968],[64,12.384697],[65,12.464563],[66,12.541425],[67,12.614156],[68,12.681662],[69,12.742899],[70,12.796891],[71,12.842745],[72,12.879668],[73,12.906978],[74,12.924121],[75,12.930678],[76,12.926373],[77,12.91108],[78,12.884829],[79,12.847805],[80,12.800346],[81,12.742942],[82,12.676226],[83,12.600971],[84,12.518072],[85,12.42854],[86,12.333482],[87,12.234091],[88,12.131622],[89,12.027379],[90,11.922693],[91,11.8189],[92,11.717327],[93,11.619266],[94,11.52596],[95,11.43858],[96,11.358212],[97,11.285839],[98,11.222326],[99,11.16841],[100,11.124687],[101,11.091608],[102,11.069469],[103,11.058414],[104,11.058426],[105,11.069338],[106,11.090829],[107,11.122438],[108,11.163567],[109,11.213495],[110,11.271392],[111,11.336328],[112,11.407295],[113,11.483221],[114,11.562984],[115,11.645437],[116,11.72942],[117,11.813784],[118,11.8974],[119,11.979186],[120,12.058115],[121,12.133232],[122,12.203668],[123,12.268651],[124,12.327514],[125,12.379704],[126,12.424788],[127,12.462453],[128,12.492513],[129,12.514901],[130,12.52967],[131,12.53699],[132,12.537137],[133,12.530485],[134,12.517499],[135,12.498723],[136,12.474765],[137,12.446286],[138,12.413988],[139,12.378599],[140,12.340857],[141,12.301499],[142,12.26125],[143,12.220806],[144,12.180826],[145,12.141921],[146,12.104645],[147,12.069487],[148,12.036867],[149,12.00713],[150,11.980545],[151,11.9573],[152,11.93751],[153,11.921211],[154,11.908368],[155,11.89888],[156,11.892586],[157,11.88927],[158,11.888672],[159,11.890492],[160,11.894407],[161,11.900071],[162,11.907132],[163,11.915236],[164,11.924039],[165,11.933212],[166,11.942452],[167,11.951484],[168,11.960072],[169,11.968019],[170,11.975169],[171,11.981415],[172,11.986694],[173,11.990987],[174,11.994319],[175,11.996757],[176,11.9984],[177,11.999381],[178,11.999855],[179,12],[180,12],[181,12.001012],[182,12.009772],[183,12.033152],[184,12.077106],[185,12.146673],[186,12.245975],[187,12.378219],[188,12.545695],[189,12.749777],[190,12.990924],[191,13.268677],[192,13.581661],[193,13.927588],[194,14.303249],[195,14.704524],[196,15.126373],[197,15.562841],[198,16.007058],[199,16.452287],[200,16.897516],[201,17.342744],[202,17.787973],[203,18.233202],[204,18.67843],[205,19.123659],[206,19.568888],[207,20.014116],[208,20.459345],[209,20.904574],[210,21.349802],[211,21.795031],[212,22.24026],[213,22.685488],[214,23.130717],[215,23.575946],[216,24.021175],[217,24.466403],[218,24.911632],[219,25.356861],[220,25.802089],[221,26.247318],[222,26.692547],[223,27.137775],[224,27.583004],[225,28.028233],[226,28.473461],[227,28.91869],[228,29.363919],[229,29.809147],[230,30.254376],[231,30.699605],[232,31.144833],[233,31.590062],[234,32.035291],[235,32.48052],[236,32.925748],[237,33.370977],[238,33.816206],[239,34.261434],[240,34.706663],[241,35.151892],[242,35.59712],[243,36.042349],[244,36.487578],[245,36.932806],[246,37.378035],[247,37.823264],[248,38.268492],[249,38.713721],[250,39.15895],[251,39.604178],[252,40.049407],[253,40.494636],[254,40.939865],[255,41.385093],[256,41.830322],[257,42.275551],[258,42.720779],[259,43.166008],[260,43.611237],[261,44.056465],[262,44.501694],[263,44.946923],[264,45.392151],[265,45.83738],[266,46.282609],[267,46.727837],[268,47.173066],[269,47.618295],[270,48.063524],[271,48.508752],[272,48.953981],[273,49.39921],[274,49.844438],[275,50.289667],[276,50.734896],[277,51.180124],[278,51.625353],[279,52.070582],[280,52.51581],[281,52.961039],[282,53.406268],[283,53.851496],[284,54.296725],[285,54.741954],[286,55.187182],[287,55.632411],[288,56.07764],[289,56.522869],[290,56.968097],[291,57.413326],[292,57.858555],[293,58.303783],[294,58.749012],[295,59.194241],[296,59.639469],[297,60.084698],[298,60.529927],[299,60.975155],[300,61.420384],[301,61.865613],[302,62.310841],[303,62.75607],[304,63.201299],[305,63.646527],[306,64.091756],[307,64.536985],[308,64.982214],[309,65.427442],[310,65.872671],[311,66.3179],[312,66.763128],[313,67.208357],[314,67.653586],[315,68.098814],[316,68.544043],[317,68.989272],[318,69.4345],[319,69.879729],[320,70.324958],[321,70.770186],[322,71.215415],[323,71.660644],[324,72.105873],[325,72.551101],[326,72.99633],[327,73.441559],[328,73.886787],[329,74.332016],[330,74.777245],[331,75.222473],[332,75.667702],[333,76.112931],[334,76.558159],[335,77.003388],[336,77.448617],[337,77.893845],[338,78.339074],[339,78.784303],[340,79.229531],[341,79.67476],[342,80.119989],[343,80.565218],[344,81.010446],[345,81.455675],[346,81.900904],[347,82.346132],[348,82.791361],[349,83.23659],[350,83.681818],[351,84.127047],[352,84.572276],[353,85.017504],[354,85.462733],[355,85.907962],[356,86.35319],[357,86.798419],[358,87.243648],[359,87.688877],[360,88.134105],[361,88.579334],[362,89.024563],[363,89.469791],[364,89.91502],[365,90.360249],[366,90.805477],[367,91.250706],[368,91.695935],[369,92.141163],[370,92.586392],[371,93.031621],[372,93.476849],[373,93.922078],[374,94.367307],[375,94.812535],[376,95.257764],[377,95.702993],[378,96.148222],[379,96.59345],[380,97.038679],[381,97.483908],[382,97.929136],[383,98.374365],[384,98.819594],[385,99.264822],[386,99.710051],[387,100.15528],[388,100.600508],[389,101.045737],[390,101.490966],[391,101.936194],[392,102.381423],[393,102.826652],[394,103.27188],[395,103.717109],[396,104.162338],[397,104.607567],[398,105.052795],[399,105.498024],[400,105.943253],[401,106.388481],[402,106.83371],[403,107.278939],[404,107.724167],[405,108.169396],[406,108.614625],[407,109.059853],[408,109.505082],[409,109.950311],[410,110.395539],[411,110.840768],[412,111.285997],[413,111.731226],[414,112.176454],[415,112.621683],[416,113.066912],[417,113.51214],[418,113.957369],[419,114.402598],[420,114.847826],[421,115.293055],[422,115.738284],[423,116.182501],[424,116.618969],[425,117.040818],[426,117.442093],[427,117.817754],[428,118.163681],[429,118.476665],[430,118.754418],[431,118.995564],[432,119.199647],[433,119.367123],[434,119.499367],[435,119.598669],[436,119.668236],[437,119.71219],[438,119.73557],[439,119.74433],[440,119.745342],[441,119.745342],[442,119.745342],[443,119.745342],[444,119.745342],[445,119.745342],[446,119.745342],[447,119.745342],[448,119.745342],[449,119.745342],[450,119.745342],[451,119.745342],[452,119.745342],[453,119.745342],[454,119.745342],[455,119.745342],[456,119.745342],[457,119.745342],[458,119.745342],[459,119.745342],[460,119.745342],[461,119.745342],[462,119.745342],[463,119.745342],[464,119.745342],[465,119.745342],[466,119.745342],[467,119.745342],[468,119.745342],[469,119.745342],[470,119.745342],[471,119.745342],[472,119.745342],[473,119.745342],[474,119.745342],[475,119.745342],[476,119.745342],[477,119.745342],[478,119.745342],[479,119.745342],[480,119.745342],[481,119.745342],[482,119.745342],[483,119.745342],[484,119.745342],[485,119.745342],[486,119.745342],[487,119.745342],[488,119.745342],[489,119.745342],[490,119.745342],[491,119.745342],[492,119.745342],[493,119.745342],[494,119.745342],[495,119.745342],[496,119.745342],[497,119.745342],[498,119.745342],[499,119.745342],[500,119.745342],[501,119.745342],[502,119.745342],[503,119.745342],[504,119.745342],[505,119.745342],[506,119.745342],[507,119.745342],[508,119.745342],[509,119.745342],[510,119.745342],[511,119.746707],[512,119.758529],[513,119.790082],[514,119.8494],[515,119.943285],[516,120.077299],[517,120.255769],[518,120.481788],[519,120.757208],[520,121.082648],[521,121.457491],[522,121.879881],[523,122.346727],[524,122.853703],[525,123.395246],[526,123.964554],[527,124.553592],[528,125.153087],[529,125.753948],[530,126.354809],[531,126.955669],[532,127.55653],[533,128.157391],[534,128.758251],[535,129.359112],[536,129.959972],[537,130.560833],[538,131.161694],[539,131.762554],[540,132.363415],[541,132.964275],[542,133.565136],[543,134.165997],[544,134.766857],[545,135.367718],[546,135.968579],[547,136.569439],[548,137.1703],[549,137.77116],[550,138.372021],[551,138.972882],[552,139.573742],[553,140.174603],[554,140.775464],[555,141.376324],[556,141.977185],[557,142.578045],[558,143.178906],[559,143.779767],[560,144.380627],[561,144.981488],[562,145.582348],[563,146.183209],[564,146.78407],[565,147.38493],[566,147.985791],[567,148.586652],[568,149.187512],[569,149.788373],[570,150.389233],[571,150.990094],[572,151.590955],[573,152.191815],[574,152.792676],[575,153.393537],[576,153.994397],[577,154.595258],[578,155.196118],[579,155.796979],[580,156.39784],[581,156.9987],[582,157.599561],[583,158.200421],[584,158.801282],[585,159.402143],[586,160.003003],[587,160.603864],[588,161.204725],[589,161.805585],[590,162.406446],[591,163.007306],[592,163.608167],[593,164.209028],[594,164.809888],[595,165.410749],[596,166.01161],[597,166.61247],[598,167.213331],[599,167.814191],[600,168.415052],[601,169.015913],[602,169.616773],[603,170.217634],[604,170.818494],[605,171.419355],[606,172.020216],[607,172.621076],[608,173.221937],[609,173.822798],[610,174.423658],[611,175.024519],[612,175.625379],[613,176.22624],[614,176.827101],[615,177.427961],[616,178.028822],[617,178.629683],[618,179.230543],[619,179.831404],[620,180.432264],[621,181.033125],[622,181.633986],[623,182.234846],[624,182.835707],[625,183.436567],[626,184.037428],[627,184.638289],[628,185.239149],[629,185.84001],[630,186.440871],[631,187.041731],[632,187.642592],[633,188.243452],[634,188.844313],[635,189.445174],[636,190.046034],[637,190.646895],[638,191.247756],[639,191.848616],[640,192.449477],[641,193.050337],[642,193.651198],[643,194.252059],[644,194.852919],[645,195.45378],[646,196.05464],[647,196.655501],[648,197.256362],[649,197.857222],[650,198.458083],[651,199.058944],[652,199.659804],[653,200.260665],[654,200.861525],[655,201.462386],[656,202.063247],[657,202.664107],[658,203.264968],[659,203.865829],[660,204.466689],[661,205.06755],[662,205.66841],[663,206.269271],[664,206.870132],[665,207.470992],[666,208.071853],[667,208.672713],[668,209.273574],[669,209.874435],[670,210.475295],[671,211.076156],[672,211.677017],[673,212.277877],[674,212.878738],[675,213.479598],[676,214.080459],[677,214.68132],[678,215.28218],[679,215.883041],[680,216.483902],[681,217.084762],[682,217.685623],[683,218.286483],[684,218.887344],[685,219.488205],[686,220.089065],[687,220.689926],[688,221.290786],[689,221.891647],[690,222.492508],[691,223.093368],[692,223.694229],[693,224.29509],[694,224.89595],[695,225.496811],[696,226.097671],[697,226.698532],[698,227.299393],[699,227.900253],[700,228.501114],[701,229.101975],[702,229.702835],[703,230.303696],[704,230.904556],[705,231.505417],[706,232.106278],[707,232.707138],[708,233.307999],[709,233.908859],[710,234.50972],[711,235.110581],[712,235.711441],[713,236.312302],[714,236.913163],[715,237.514023],[716,238.114884],[717,238.715744],[718,239.316605],[719,239.917466],[720,240.518326],[721,241.119187],[722,241.720048],[723,242.320908],[724,242.921769],[725,243.522629],[726,244.12349],[727,244.724351],[728,245.325211],[729,245.926072],[730,246.526932],[731,247.127793],[732,247.728654],[733,248.329514],[734,248.930375],[735,249.531236],[736,250.132096],[737,250.732957],[738,251.333817],[739,251.934678],[740,252.535539],[741,253.136399],[742,253.73726],[743,254.338121],[744,254.938981],[745,255.539842],[746,256.140702],[747,256.741563],[748,257.342424],[749,257.943284],[750,258.544145],[751,259.145005],[752,259.745866],[753,260.346727],[754,260.947587],[755,261.548448],[756,262.149309],[757,262.750169],[758,263.35103],[759,263.95189],[760,264.552751],[761,265.153612],[762,265.754472],[763,266.355333],[764,266.956194],[765,267.557054],[766,268.157915],[767,268.758775],[768,269.359636],[769,269.960497],[770,270.561357],[771,271.162218],[772,271.763078],[773,272.363939],[774,272.9648],[775,273.56566],[776,274.166521],[777,274.767382],[778,275.368242],[779,275.969103],[780,276.569963],[781,277.170824],[782,277.771685],[783,278.372545],[784,278.973406],[785,279.574267],[786,280.175127],[787,280.775988],[788,281.376848],[789,281.977709],[790,282.57857],[791,283.17943],[792,283.780291],[793,284.381151],[794,284.982012],[795,285.582873],[796,286.183733],[797,286.784594],[798,287.385455],[799,287.986315],[800,288.587176],[801,289.188036],[802,289.788897],[803,290.389758],[804,290.990618],[805,291.591479],[806,292.19234],[807,292.7932],[808,293.394061],[809,293.994921],[810,294.595782],[811,295.196643],[812,295.797503],[813,296.398364],[814,296.999224],[815,297.600085],[816,298.200946],[817,298.801806],[818,299.402667],[819,300.003528],[820,300.604388],[821,301.205249],[822,301.806109],[823,302.40697],[824,303.007831],[825,303.608691],[826,304.209552],[827,304.810413],[828,305.411273],[829,306.012134],[830,306.612994],[831,307.213855],[832,307.814716],[833,308.415576],[834,309.016437],[835,309.617297],[836,310.218158],[837,310.819019],[838,311.419879],[839,312.02074],[840,312.621601],[841,313.222461],[842,313.823322],[843,314.424182],[844,315.025043],[845,315.625904],[846,316.226764],[847,316.827625],[848,317.428486],[849,318.029346],[850,318.630207],[851,319.231067],[852,319.831928],[853,320.432789],[854,321.033649],[855,321.63451],[856,322.23537],[857,322.836231],[858,323.437092],[859,324.037952],[860,324.638813],[861,325.239674],[862,325.840534],[863,326.441395],[864,327.042255],[865,327.643116],[866,328.243977],[867,328.844837],[868,329.445698],[869,330.046559],[870,330.647419],[871,331.24828],[872,331.84914],[873,332.448636],[874,333.037674],[875,333.606982],[876,334.148524],[877,334.6555],[878,335.122347],[879,335.544737],[880,335.91958],[881,336.24502],[882,336.52044],[883,336.746458],[884,336.924929],[885,337.058943],[886,337.152827],[887,337.212146],[888,337.243698],[889,337.255521],[890,337.256886],[891,337.256886],[892,337.256886],[893,337.256886],[894,337.256886],[895,337.256886],[896,337.256886],[897,337.256886],[898,337.256886],[899,337.256886],[900,337.256886],[901,337.256886],[902,337.256886],[903,337.256886],[904,337.256886],[905,337.256886],[906,337.256886],[907,337.256886],[908,337.256886],[909,337.256886],[910,337.256886],[911,337.256886],[912,337.256886],[913,337.256886],[914,337.256886],[915,337.256886],[916,337.256886],[917,337.256886],[918,337.256886],[919,337.256886],[920,337.256886],[921,337.256886],[922,337.256886],[923,337.256886],[924,337.256886],[925,337.256886],[926,337.256886],[927,337.256886],[928,337.256886],[929,337.256886],[930,337.256886],[931,337.256886],[932,337.256886],[933,337.256886],[934,337.256886],[935,337.256886],[936,337.256886],[937,337.256886],[938,337.256886],[939,337.256886],[940,337.256886],[941,337.256886],[942,337.256886],[943,337.256886],[944,337.256886],[945,337.256886],[946,337.256886],[947,337.256886],[948,337.256886],[949,337.256886],[950,337.256886],[951,337.256886],[952,337.256886],[953,337.256886],[954,337.256886],[955,337.256886],[956,337.256886],[957,337.256886],[958,337.256886],[959,337.256886],[960,337.256886],[961,337.256886],[962,337.256886],[963,337.256886],[964,337.256886],[965,337.256886],[966,337.256886],[967,337.256886],[968,337.256886],[969,337.256886],[970,337.256886],[971,337.256403],[972,337.252221],[973,337.241059],[974,337.220075],[975,337.186863],[976,337.139455],[977,337.07632],[978,336.996366],[979,336.898935],[980,336.783809],[981,336.651207],[982,336.501785],[983,336.336637],[984,336.157292],[985,335.96572],[986,335.764325],[987,335.555951],[988,335.343877],[989,335.13132],[990,334.918764],[991,334.706207],[992,334.493651],[993,334.281094],[994,334.068538],[995,333.855981],[996,333.643424],[997,333.430868],[998,333.218311],[999,333.005755],[1000,332.793198],[1001,332.580642],[1002,332.368085],[1003,332.155528],[1004,331.942972],[1005,331.730415],[1006,331.517859],[1007,331.305302],[1008,331.092746],[1009,330.880189],[1010,330.667633],[1011,330.455076],[1012,330.242519],[1013,330.029963],[1014,329.817406],[1015,329.60485],[1016,329.392293],[1017,329.179737],[1018,328.96718],[1019,328.754623],[1020,328.542067],[1021,328.32951],[1022,328.116954],[1023,327.904397],[1024,327.691841],[1025,327.479284],[1026,327.266728],[1027,327.054171],[1028,326.841614],[1029,326.629058],[1030,326.416501],[1031,326.203945],[1032,325.991388],[1033,325.778832],[1034,325.566275],[1035,325.353718],[1036,325.141162],[1037,324.928605],[1038,324.716049],[1039,324.503492],[1040,324.290936],[1041,324.078379],[1042,323.865823],[1043,323.653266],[1044,323.440709],[1045,323.228153],[1046,323.015596],[1047,322.80304],[1048,322.590483],[1049,322.377927],[1050,322.16537],[1051,321.952813],[1052,321.740257],[1053,321.5277],[1054,321.315144],[1055,321.102587],[1056,320.890031],[1057,320.677474],[1058,320.464918],[1059,320.252361],[1060,320.039804],[1061,319.827248],[1062,319.614691],[1063,319.402135],[1064,319.189578],[1065,318.977022],[1066,318.764465],[1067,318.551909],[1068,318.339352],[1069,318.126795],[1070,317.914239],[1071,317.701682],[1072,317.489126],[1073,317.276569],[1074,317.064013],[1075,316.851456],[1076,316.638899],[1077,316.426343],[1078,316.213786],[1079,316.00123],[1080,315.788673],[1081,315.576117],[1082,315.36356],[1083,315.151004],[1084,314.938447],[1085,314.72589],[1086,314.513334],[1087,314.300777],[1088,314.088221],[1089,313.875664],[1090,313.663108],[1091,313.450551],[1092,313.237994],[1093,313.025438],[1094,312.812881],[1095,312.600325],[1096,312.387768],[1097,312.175212],[1098,311.962655],[1099,311.750099],[1100,311.537542],[1101,311.324985],[1102,311.112429],[1103,310.899872],[1104,310.687316],[1105,310.474759],[1106,310.262203],[1107,310.049646],[1108,309.837089],[1109,309.624533],[1110,309.411976],[1111,309.19942],[1112,308.986863],[1113,308.774307],[1114,308.56175],[1115,308.349194],[1116,308.136637],[1117,307.92408],[1118,307.711524],[1119,307.498967],[1120,307.286411],[1121,307.073854],[1122,306.861298],[1123,306.648741],[1124,306.436184],[1125,306.223628],[1126,306.011071],[1127,305.798515],[1128,305.585958],[1129,305.373402],[1130,305.160845],[1131,304.948289],[1132,304.735732],[1133,304.523175],[1134,304.310619],[1135,304.098062],[1136,303.885506],[1137,303.672949],[1138,303.460393],[1139,303.247836],[1140,303.03528],[1141,302.822723],[1142,302.610166],[1143,302.39761],[1144,302.185053],[1145,301.972497],[1146,301.75994],[1147,301.547384],[1148,301.334827],[1149,301.12227],[1150,300.909714],[1151,300.697157],[1152,300.484601],[1153,300.272044],[1154,300.059488],[1155,299.846931],[1156,299.634375],[1157,299.421818],[1158,299.209261],[1159,298.996705],[1160,298.784148],[1161,298.571592],[1162,298.359035],[1163,298.146479],[1164,297.933922],[1165,297.721365],[1166,297.508809],[1167,297.296252],[1168,297.083696],[1169,296.871139],[1170,296.658583],[1171,296.446026],[1172,296.23347],[1173,296.021396],[1174,295.813022],[1175,295.611627],[1176,295.420054],[1177,295.24071],[1178,295.075561],[1179,294.926139],[1180,294.793537],[1181,294.678412],[1182,294.580981],[1183,294.501026],[1184,294.437891],[1185,294.390484],[1186,294.357272],[1187,294.336287],[1188,294.325126],[1189,294.320943],[1190,294.32046],[1191,294.32046],[1192,294.32046],[1193,294.32046],[1194,294.32046],[1195,294.32046],[1196,294.32046],[1197,294.32046],[1198,294.32046],[1199,294.32046],[1200,294.32046],[1201,294.32046],[1202,294.32046],[1203,294.32046],[1204,294.32046],[1205,294.32046],[1206,294.32046],[1207,294.32046],[1208,294.32046],[1209,294.32046],[1210,294.32046],[1211,294.32046],[1212,294.32046],[1213,294.32046],[1214,294.32046],[1215,294.32046],[1216,294.32046],[1217,294.32046],[1218,294.32046],[1219,294.32046],[1220,294.32046],[1221,294.32046],[1222,294.32046],[1223,294.32046],[1224,294.32046],[1225,294.32046],[1226,294.32046],[1227,294.32046],[1228,294.32046],[1229,294.32046],[1230,294.32046],[1231,294.32046],[1232,294.32046],[1233,294.32046],[1234,294.32046],[1235,294.32046],[1236,294.32046],[1237,294.32046],[1238,294.32046],[1239,294.32046],[1240,294.32046],[1241,294.32046],[1242,294.32046],[1243,294.32046],[1244,294.32046],[1245,294.32046],[1246,294.32046],[1247,294.32046],[1248,294.32046],[1249,294.32046],[1250,294.32046],[1251,294.32046],[1252,294.32046],[1253,294.32046],[1254,294.32046],[1255,294.32046],[1256,294.32046],[1257,294.32046],[1258,294.32046],[1259,294.32046],[1260,294.32046],[1261,294.32046],[1262,294.32046],[1263,294.32046],[1264,294.32046],[1265,294.32046],[1266,294.32046],[1267,294.32046],[1268,294.32046],[1269,294.32046],[1270,294.32046],[1271,294.32046],[1272,294.32046],[1273,294.32046],[1274,294.32046],[1275,294.32046],[1276,294.32046],[1277,294.32046],[1278,294.32046],[1279,294.32046],[1280,294.32046],[1281,294.32046],[1282,294.32046],[1283,294.32046],[1284,294.32046],[1285,294.32046],[1286,294.32046],[1287,294.32046],[1288,294.32046],[1289,294.32046],[1290,294.32046],[1291,294.32046],[1292,294.32046],[1293,294.32046],[1294,294.32046],[1295,294.32046],[1296,294.32046],[1297,294.32046],[1298,294.32046],[1299,294.32046],[1300,294.32046],[1301,294.32046],[1302,294.32046],[1303,294.32046],[1304,294.32046],[1305,294.32046],[1306,294.32046],[1307,294.32046],[1308,294.32046],[1309,294.32046],[1310,294.32046],[1311,294.32046],[1312,294.32046],[1313,294.32046],[1314,294.32046],[1315,294.32046],[1316,294.32046],[1317,294.32046],[1318,294.32046],[1319,294.32046],[1320,294.32046],[1321,294.32046],[1322,294.32046],[1323,294.32046],[1324,294.32046],[1325,294.32046],[1326,294.32046],[1327,294.32046],[1328,294.32046],[1329,294.32046],[1330,294.32046],[1331,294.320543],[1332,294.321012],[1333,294.322004],[1334,294.323396],[1335,294.324792],[1336,294.325592],[1337,294.32512],[1338,294.322802],[1339,294.318349],[1340,294.311909],[1341,294.304149],[1342,294.296235],[1343,294.289713],[1344,294.286278],[1345,294.28748],[1346,294.294397],[1347,294.307343],[1348,294.325661],[1349,294.347653],[1350,294.370676],[1351,294.391411],[1352,294.406291],[1353,294.412022],[1354,294.406143],[1355,294.387528],[1356,294.356751],[1357,294.316239],[1358,294.270164],[1359,294.224063],[1360,294.184211],[1361,294.156815],[1362,294.14713],[1363,294.158607],[1364,294.192223],[1365,294.246069],[1366,294.315321],[1367,294.392598],[1368,294.468713],[1369,294.533735],[1370,294.578251],[1371,294.594666],[1372,294.578363],[1373,294.528562],[1374,294.44874],[1375,294.346512],[1376,294.23296],[1377,294.121458],[1378,294.026109],[1379,293.959984],[1380,293.933373],[1381,293.952281],[1382,294.017383],[1383,294.123604],[1384,294.260402],[1385,294.41278],[1386,294.562917],[1387,294.692248],[1388,294.783763],[1389,294.824215],[1390,294.805979],[1391,294.728285],[1392,294.597654],[1393,294.427433],[1394,294.236459],[1395,294.046968],[1396,293.881994],[1397,293.762558],[1398,293.70499],[1399,293.718728],[1400,293.804888],[1401,293.955816],[1402,294.155703],[1403,294.382231],[1404,294.609084],[1405,294.809031],[1406,294.957221],[1407,295.034289],[1408,295.028878],[1409,294.93926],[1410,294.773812],[1411,294.550273],[1412,294.293838],[1413,294.034288],[1414,293.802494],[1415,293.626708],[1416,293.529085],[1417,293.522877],[1418,293.610651],[1419,293.783771],[1420,294.023228],[1421,294.301746],[1422,294.58693],[1423,294.845073],[1424,295.045197],[1425,295.162807],[1426,295.182923],[1427,295.101993],[1428,294.92846],[1429,294.681874],[1430,294.390667],[1431,294.088829],[1432,293.811893],[1433,293.59269],[1434,293.457414],[1435,293.422448],[1436,293.49236],[1437,293.659304],[1438,293.903914],[1439,294.197575],[1440,294.505824],[1441,294.79244],[1442,295.023764],[1443,295.1727],[1444,295.221932],[1445,295.165968],[1446,295.011755],[1447,294.777812],[1448,294.491979],[1449,294.18806],[1450,293.901773],[1451,293.666502],[1452,293.509343],[1453,293.447954],[1454,293.488536],[1455,293.625221],[1456,293.840892],[1457,294.109345],[1458,294.398507],[1459,294.674314],[1460,294.904771],[1461,295.063713],[1462,295.133811],[1463,295.108473],[1464,294.992442],[1465,294.801023],[1466,294.55807],[1467,294.292996],[1468,294.037171],[1469,293.820172],[1470,293.666327],[1471,293.591957],[1472,293.603644],[1473,293.697702],[1474,293.860883],[1475,294.072203],[1476,294.305646],[1477,294.533386],[1478,294.729132],[1479,294.871196],[1480,294.944902],[1481,294.944098],[1482,294.871583],[1483,294.738468],[1484,294.562551],[1485,294.365963],[1486,294.172376],[1487,294.004142],[1488,293.879693],[1489,293.811523],[1490,293.804963],[1491,293.857866],[1492,293.961203],[1493,294.10046],[1494,294.257624],[1495,294.413504],[1496,294.550066],[1497,294.652528],[1498,294.710941],[1499,294.721113],[1500,294.684781],[1501,294.609061],[1502,294.505278],[1503,294.387348],[1504,294.26995],[1505,294.166715],[1506,294.088656],[1507,294.04302],[1508,294.032677],[1509,294.056087],[1510,294.107813],[1511,294.179472],[1512,294.260985],[1513,294.341938],[1514,294.412883],[1515,294.466415],[1516,294.497903],[1517,294.505813],[1518,294.491617],[1519,294.459325],[1520,294.414738],[1521,294.364548],[1522,294.315397],[1523,294.273047],[1524,294.241741],[1525,294.22383],[1526,294.219687],[1527,294.227896],[1528,294.245658],[1529,294.269335],[1530,294.295045],[1531,294.319221],[1532,294.339054],[1533,294.352772],[1534,294.359733],[1535,294.360346],[1536,294.355841],[1537,294.347952],[1538,294.33857],[1539,294.329417],[1540,294.321808],[1541,294.316507],[1542,294.313707],[1543,294.313112],[1544,294.314094],[1545,294.315889],[1546,294.317787],[1547,294.319282],[1548,294.32015],[1549,294.320451],[1550,294.32046],[1551,294.321772],[1552,294.333132],[1553,294.36345],[1554,294.420447],[1555,294.510658],[1556,294.639429],[1557,294.810916],[1558,295.028091],[1559,295.292734],[1560,295.605441],[1561,295.965617],[1562,296.371479],[1563,296.820059],[1564,297.307199],[1565,297.827552],[1566,298.374584],[1567,298.940574],[1568,299.516613],[1569,300.093963],[1570,300.671313],[1571,301.248664],[1572,301.826014],[1573,302.403364],[1574,302.980715],[1575,303.558065],[1576,304.135415],[1577,304.712765],[1578,305.290116],[1579,305.867466],[1580,306.444816],[1581,307.022166],[1582,307.599517],[1583,308.176867],[1584,308.754217],[1585,309.331567],[1586,309.908918],[1587,310.486268],[1588,311.063618],[1589,311.640969],[1590,312.218319],[1591,312.795669],[1592,313.373019],[1593,313.95037],[1594,314.52772],[1595,315.10507],[1596,315.68242],[1597,316.259771],[1598,316.837121],[1599,317.414471],[1600,317.991822],[1601,318.569172],[1602,319.146522],[1603,319.723872],[1604,320.301223],[1605,320.878573],[1606,321.455923],[1607,322.033273],[1608,322.610624],[1609,323.187974],[1610,323.765324],[1611,324.342674],[1612,324.920025],[1613,325.497375],[1614,326.074725],[1615,326.652076],[1616,327.229426],[1617,327.806776],[1618,328.384126],[1619,328.961477],[1620,329.538827],[1621,330.116177],[1622,330.693527],[1623,331.270878],[1624,331.848228],[1625,332.425578],[1626,333.002929],[1627,333.580279],[1628,334.157629],[1629,334.734979],[1630,335.31233],[1631,335.88968],[1632,336.46703],[1633,337.04438],[1634,337.621731],[1635,338.199081],[1636,338.776431],[1637,339.353781],[1638,339.931132],[1639,340.508482],[1640,341.085832],[1641,341.663183],[1642,342.240533],[1643,342.817883],[1644,343.395233],[1645,343.972584],[1646,344.549934],[1647,345.127284],[1648,345.704634],[1649,346.281985],[1650,346.859335],[1651,347.436685],[1652,348.014036],[1653,348.591386],[1654,349.168736],[1655,349.746086],[1656,350.323437],[1657,350.900787],[1658,351.478137],[1659,352.055487],[1660,352.632838],[1661,353.210188],[1662,353.787538],[1663,354.364888],[1664,354.942239],[1665,355.519589],[1666,356.096939],[1667,356.67429],[1668,357.25164],[1669,357.82899],[1670,358.40634],[1671,358.983691],[1672,359.561041],[1673,360.138391],[1674,360.715741],[1675,361.293092],[1676,361.870442],[1677,362.447792],[1678,363.025143],[1679,363.602493],[1680,364.179843],[1681,364.757193],[1682,365.334544],[1683,365.911894],[1684,366.489244],[1685,367.066594],[1686,367.643945],[1687,368.221295],[1688,368.798645],[1689,369.375995],[1690,369.953346],[1691,370.530696],[1692,371.108046],[1693,371.685397],[1694,372.262747],[1695,372.840097],[1696,373.417447],[1697,373.994798],[1698,374.572148],[1699,375.149498],[1700,375.726848],[1701,376.304199],[1702,376.881549],[1703,377.458899],[1704,378.03625],[1705,378.6136],[1706,379.19095],[1707,379.7683],[1708,380.345651],[1709,380.923001],[1710,381.500351],[1711,382.077701],[1712,382.655052],[1713,383.232402],[1714,383.809752],[1715,384.387102],[1716,384.964453],[1717,385.541803],[1718,386.119153],[1719,386.696504],[1720,387.273854],[1721,387.851204],[1722,388.428554],[1723,389.005905],[1724,389.583255],[1725,390.160605],[1726,390.737955],[1727,391.315306],[1728,391.892656],[1729,392.470006],[1730,393.047357],[1731,393.624707],[1732,394.202057],[1733,394.779407],[1734,395.356758],[1735,395.934108],[1736,396.511458],[1737,397.088808],[1738,397.666159],[1739,398.243509],[1740,398.820859],[1741,399.398209],[1742,399.97556],[1743,400.55291],[1744,401.13026],[1745,401.707611],[1746,402.284961],[1747,402.862311],[1748,403.439661],[1749,404.017012],[1750,404.594362],[1751,405.171712],[1752,405.749062],[1753,406.326413],[1754,406.903763],[1755,407.481113],[1756,408.058464],[1757,408.635814],[1758,409.213164],[1759,409.790514],[1760,410.367865],[1761,410.945215],[1762,411.522565],[1763,412.099915],[1764,412.677266],[1765,413.254616],[1766,413.831966],[1767,414.409316],[1768,414.986667],[1769,415.564017],[1770,416.141367],[1771,416.718718],[1772,417.296068],[1773,417.873418],[1774,418.450768],[1775,419.028119],[1776,419.605469],[1777,420.182819],[1778,420.760169],[1779,421.33752],[1780,421.91487],[1781,422.49222],[1782,423.069571],[1783,423.646921],[1784,424.224271],[1785,424.801621],[1786,425.378972],[1787,425.956322],[1788,426.533672],[1789,427.111022],[1790,427.688373],[1791,428.265723],[1792,428.843073],[1793,429.420423],[1794,429.997774],[1795,430.575124],[1796,431.152474],[1797,431.729825],[1798,432.307175],[1799,432.884525],[1800,433.461875],[1801,434.039226],[1802,434.616576],[1803,435.193926],[1804,435.771276],[1805,436.348627],[1806,436.925977],[1807,437.503327],[1808,438.080678],[1809,438.658028],[1810,439.235378],[1811,439.812728],[1812,440.390079],[1813,440.967429],[1814,441.544779],[1815,442.122129],[1816,442.69948],[1817,443.27683],[1818,443.85418],[1819,444.43153],[1820,445.008881],[1821,445.586231],[1822,446.163581],[1823,446.740932],[1824,447.318282],[1825,447.895632],[1826,448.472982],[1827,449.050333],[1828,449.627683],[1829,450.205033],[1830,450.782383],[1831,451.359734],[1832,451.937084],[1833,452.514434],[1834,453.091785],[1835,453.669135],[1836,454.246485],[1837,454.823835],[1838,455.401186],[1839,455.978536],[1840,456.555886],[1841,457.133236],[1842,457.710587],[1843,458.287937],[1844,458.865287],[1845,459.442637],[1846,460.019988],[1847,460.597338],[1848,461.174688],[1849,461.752039],[1850,462.329389],[1851,462.906739],[1852,463.484089],[1853,464.06144],[1854,464.63879],[1855,465.21614],[1856,465.79349],[1857,466.370841],[1858,466.948191],[1859,467.525541],[1860,468.102892],[1861,468.680242],[1862,469.257592],[1863,469.834942],[1864,470.412293],[1865,470.989643],[1866,471.566993],[1867,472.144343],[1868,472.721694],[1869,473.299044],[1870,473.876394],[1871,474.453744],[1872,475.031095],[1873,475.608445],[1874,476.185795],[1875,476.763146],[1876,477.340496],[1877,477.917846],[1878,478.495196],[1879,479.072547],[1880,479.649897],[1881,480.227247],[1882,480.804597],[1883,481.381948],[1884,481.959298],[1885,482.536648],[1886,483.113999],[1887,483.691349],[1888,484.268699],[1889,484.846049],[1890,485.4234],[1891,486.00075],[1892,486.5781],[1893,487.15545],[1894,487.732801],[1895,488.310151],[1896,488.887501],[1897,489.464851],[1898,490.042202],[1899,490.619552],[1900,491.196902],[1901,491.774253],[1902,492.351603],[1903,492.928953],[1904,493.506303],[1905,494.083654],[1906,494.661004],[1907,495.238354],[1908,495.815704],[1909,496.393055],[1910,496.970405],[1911,497.547755],[1912,498.125105],[1913,498.702456],[1914,499.279806],[1915,499.857156],[1916,500.434507],[1917,501.011857],[1918,501.589207],[1919,502.166557],[1920,502.743908],[1921,503.321258],[1922,503.898608],[1923,504.475958],[1924,505.053309],[1925,505.630659],[1926,506.208009],[1927,506.78536],[1928,507.36271],[1929,507.94006],[1930,508.51741],[1931,509.094761],[1932,509.672111],[1933,510.249461],[1934,510.826811],[1935,511.404162],[1936,511.981512],[1937,512.558862],[1938,513.136212],[1939,513.713563],[1940,514.290913],[1941,514.868263],[1942,515.445614],[1943,516.022964],[1944,516.600314],[1945,517.177664],[1946,517.755015],[1947,518.332365],[1948,518.909715],[1949,519.487065],[1950,520.064416],[1951,520.641766],[1952,521.219116],[1953,521.796467],[1954,522.373817],[1955,522.951167],[1956,523.528517],[1957,524.105868],[1958,524.683218],[1959,525.260568],[1960,525.837918],[1961,526.415269],[1962,526.992619],[1963,527.568658],[1964,528.134648],[1965,528.68168],[1966,529.202033],[1967,529.689172],[1968,530.137752],[1969,530.543615],[1970,530.903791],[1971,531.216497],[1972,531.481141],[1973,531.698316],[1974,531.869803],[1975,531.998573],[1976,532.088784],[1977,532.145782],[1978,532.1761],[1979,532.18746],[1980,532.188771],[1981,532.188771],[1982,532.188771],[1983,532.188771],[1984,532.188771],[1985,532.188771],[1986,532.188771],[1987,532.188771],[1988,532.188771],[1989,532.188771],[1990,532.188771],[1991,532.188771],[1992,532.188771],[1993,532.188771],[1994,532.188771],[1995,532.188771],[1996,532.188771],[1997,532.188771],[1998,532.188771],[1999,532.188771],[2000,532.188771],[2001,532.188771],[2002,532.188771],[2003,532.188771],[2004,532.188771],[2005,532.188771],[2006,532.188771],[2007,532.188771],[2008,532.188771],[2009,532.188771],[2010,532.188771],[2011,532.188771],[2012,532.188771],[2013,532.188771],[2014,532.188771],[2015,532.188771],[2016,532.188771],[2017,532.188771],[2018,532.188771],[2019,532.188771],[2020,532.188771],[2021,532.188771],[2022,532.188771],[2023,532.188771],[2024,532.188771],[2025,532.188771],[2026,532.188771],[2027,532.188771],[2028,532.188771],[2029,532.188771],[2030,532.188771],[2031,532.188771],[2032,532.188771],[2033,532.188771],[2034,532.188771],[2035,532.188771],[2036,532.188771],[2037,532.188771],[2038,532.188771],[2039,532.188771],[2040,532.188771],[2041,532.188771],[2042,532.188771],[2043,532.188771],[2044,532.188771],[2045,532.188771],[2046,532.188771],[2047,532.188771],[2048,532.188771],[2049,532.188771],[2050,532.188771],[2051,532.188771],[2052,532.188771],[2053,532.188771],[2054,532.188771],[2055,532.188771],[2056,532.188771],[2057,532.188771],[2058,532.188771],[2059,532.188771],[2060,532.188771],[2061,532.188771],[2062,532.188771],[2063,532.188771],[2064,532.188771],[2065,532.188771],[2066,532.188771],[2067,532.188771],[2068,532.188771],[2069,532.188771],[2070,532.188771],[2071,532.188771],[2072,532.188771],[2073,532.188771],[2074,532.188771],[2075,532.188771],[2076,532.188771],[2077,532.188771],[2078,532.188771],[2079,532.188771],[2080,532.188771],[2081,532.188771],[2082,532.188771],[2083,532.188771],[2084,532.188771],[2085,532.188771],[2086,532.188771],[2087,532.188771],[2088,532.188771],[2089,532.188771],[2090,532.188771],[2091,532.188771],[2092,532.188771],[2093,532.188771],[2094,532.188771],[2095,532.188771],[2096,532.188771],[2097,532.188771],[2098,532.188771],[2099,532.188771],[2100,532.188771],[2101,532.188771],[2102,532.188771],[2103,532.188771],[2104,532.188771],[2105,532.188771],[2106,532.188771],[2107,532.188771],[2108,532.188771],[2109,532.188771],[2110,532.188771],[2111,532.188771],[2112,532.188771],[2113,532.188771],[2114,532.188771],[2115,532.188771],[2116,532.188771],[2117,532.188771],[2118,532.188771],[2119,532.188771],[2120,532.188771],[2121,532.188771],[2122,532.188771],[2123,532.188771],[2124,532.188771],[2125,532.188771],[2126,532.188771],[2127,532.188771],[2128,532.188771],[2129,532.188771],[2130,532.188771],[2131,532.188771],[2132,532.188771],[2133,532.188771],[2134,532.188771],[2135,532.188771],[2136,532.188771],[2137,532.188771],[2138,532.188771],[2139,532.188771],[2140,532.188771],[2141,532.188771],[2142,532.188771],[2143,532.188771],[2144,532.188771],[2145,532.188771],[2146,532.188771],[2147,532.188771],[2148,532.188771],[2149,532.188771],[2150,532.188771],[2151,532.188771],[2152,532.188771],[2153,532.188771],[2154,532.188771],[2155,532.188771],[2156,532.188771],[2157,532.188771],[2158,532.188771],[2159,532.188771],[2160,532.188771],[2161,532.188771],[2162,532.188771],[2163,532.188771],[2164,532.188771],[2165,532.188771],[2166,532.188771],[2167,532.188771],[2168,532.188771],[2169,532.188771],[2170,532.188771],[2171,532.188771],[2172,532.188771],[2173,532.188771],[2174,532.188771],[2175,532.188771],[2176,532.188771],[2177,532.188771],[2178,532.188771],[2179,532.188771],[2180,532.188771],[2181,532.188771],[2182,532.188771],[2183,532.188771],[2184,532.188771],[2185,532.188771],[2186,532.188771],[2187,532.188771],[2188,532.188771],[2189,532.188771],[2190,532.188771],[2191,532.188771],[2192,532.188771],[2193,532.188771],[2194,532.188771],[2195,532.188771],[2196,532.188771],[2197,532.188771],[2198,532.188771],[2199,532.188771],[2200,532.188771],[2280,532.1887713814415]],"linearTerrain":true,"surfaces":[{"from":510,"to":890,"kind":"snow"},{"from":1190,"to":1255,"kind":"ice"},{"from":1550,"to":1980,"kind":"snow"}],"gears":[18.15,31.83,45.2,60.47,73.43,86.93,102.23,117.46,128.57,144.44,158.78,170.58,187.05,200.75,213.07,226.81,243.44,256.34,269.29,284.3,298.54,313.36,325.75,340.11,355.21,368.01,381.19,394.9,409.77,425.2,437.4,452.52,465.56,481.4,493.93,508,523.2,536.69,550.33,564.53,577.16,591.31,607.18,620.94,634.3,646.75,662.32,676.72,690.5,702.85,719.28,732.7,745.92,759.26,772.65,788.83,801.54,815.17,830.41,845.23,857.15,872.82,886.54,899.35,913.5,929.31,941.64,956.89,969.81,984.18,997.42,1010.79,1027.5,1040.42,1054.66,1069.4,1083.39,1096.68,1110.05,1124.32,1137.56,1152.35,1165.85,1180.13,1193.02,1206.87,1223.33,1236.47,1248.59,1264.24,1277.11,1290.62,1306.05,1320.77,1333.63,1349.19,1363.45,1376.63,1389.59,1402.64,1416.99,1433.04,1445.17,1461.07,1474.51,1487.57,1501.09,1515.01,1529.05,1544.48,1558.42,1572.09,1586.57,1599.14,1614.35,1628.88,1641.25,1656.55,1670.17,1685.37,1698.19,1712.27,1726.73,1740.01,1755.47,1768.34,1782.23,1796.06,1809.98,1824.23,1837.79,1853.18,1865.41,1879.28,1894.85,1907.77,1921.94,1935.75,1948.73,1964.14,1977.72,1992.58,2006.21,2019.98,2034.88,2046.94,2062.79,2074.64,2090.17,2104.82,2117.03,2132.72,2146.05,2160.73,2175.35,2187.22],"coinValues":[35,35,35,35,35,35,35,35,35,40,40,40,40,40,40,40,40,40,40,40,40,40,40,40,40,40,40,40,40,40,40,40,40,40,40,40,40,40,40,40,45,45,45,45,45,45,45,45,45,45,45,45,45,45,45,45,45,45,45,45,45,45,45,45,45,45,45,45,45,45,45,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60],"bridges":[],"checkpoints":[{"id":"winter-route-checkpoint-0","x":440,"reward":420},{"id":"winter-route-checkpoint-1","x":890,"reward":420},{"id":"winter-route-checkpoint-2","x":1550,"reward":420},{"id":"winter-route-checkpoint-3","x":1980,"reward":420}],"fuelValidation":{"state":"measured in complete recommended-profile simulation","targetRho":[0.7,0.85],"referenceProfile":{"engine":7,"suspension":6,"tires":7,"tank":5},"legs":[{"from":9,"to":150,"T_ref":8.1167,"C_ref":60,"rho":0.1353,"fuelRemaining":51.8833,"arrivalTick":487},{"from":150,"to":690,"T_ref":30.2833,"C_ref":60,"rho":0.5047,"fuelRemaining":29.7167,"arrivalTick":2304},{"from":690,"to":1420,"T_ref":48.6333,"C_ref":60,"rho":0.8106,"fuelRemaining":11.3667,"arrivalTick":5222},{"from":1420,"to":2010,"T_ref":47.0333,"C_ref":60,"rho":0.7839,"fuelRemaining":12.9667,"arrivalTick":8044},{"from":2010,"to":2209,"T_ref":8.4167,"C_ref":60,"rho":0.1403,"fuelRemaining":51.5833,"arrivalTick":8549,"finish":true}]},"streams":{"geometry":"geometry","coins":"coins","fuel":"fuel","decorations":"decorations","fuelMarker":0.9850064902566373},"decorationSeed":1204866546,"validation":{"state":"measured full-course attempts","sampleCount":1000,"source":"artifacts/pixel-drive-campaign-balance.json","notAnImpossibilityProof":true,"profiles":[{"name":"base","upgrades":{"engine":0,"suspension":0,"tires":0,"tank":0},"n":100,"wins":0,"distanceRange":[248.3,305.6],"failures":{"fuel":92,"route_exit":8}},{"name":"recommended","upgrades":{"engine":7,"suspension":6,"tires":7,"tank":5},"n":100,"wins":93,"distanceRange":[493.66,2200.5],"failures":{"overturned":7}},{"name":"maximum","upgrades":{"engine":10,"suspension":10,"tires":10,"tank":10},"n":100,"wins":92,"distanceRange":[455.62,2200.55],"failures":{"overturned":8}},{"name":"engine-only","upgrades":{"engine":10,"suspension":0,"tires":0,"tank":0},"n":100,"wins":74,"distanceRange":[455.97,2200.49],"failures":{"overturned":9,"route_exit":17}},{"name":"tank-only","upgrades":{"engine":0,"suspension":0,"tires":0,"tank":10},"n":100,"wins":0,"distanceRange":[248.3,305.6],"failures":{"route_exit":94,"fuel":6}},{"name":"strong-F0","upgrades":{"engine":10,"suspension":10,"tires":10,"tank":0},"n":100,"wins":92,"distanceRange":[455.62,2200.55],"failures":{"overturned":8}},{"name":"recommended-minus-engine","upgrades":{"engine":6,"suspension":6,"tires":7,"tank":5},"n":100,"wins":0,"distanceRange":[492.62,827.58],"failures":{"overturned":1,"route_exit":99}},{"name":"recommended-minus-suspension","upgrades":{"engine":7,"suspension":5,"tires":7,"tank":5},"n":100,"wins":94,"distanceRange":[491.77,2200.48],"failures":{"overturned":6}},{"name":"recommended-minus-tires","upgrades":{"engine":7,"suspension":6,"tires":6,"tank":5},"n":100,"wins":93,"distanceRange":[493.38,2200.52],"failures":{"overturned":7}},{"name":"recommended-minus-tank","upgrades":{"engine":7,"suspension":6,"tires":7,"tank":4},"n":100,"wins":88,"distanceRange":[493.66,2200.5],"failures":{"overturned":10,"fuel":2}}],"reference":{"upgrades":{"engine":7,"suspension":6,"tires":7,"tank":5},"targetSpeed":24,"holdTicks":12,"ticks":8549,"seconds":142.4833,"inputChanges":75}}},{"id":6,"stageId":"long-haul","campaignIndex":5,"name":"Далекий перегін","meters":3000,"recommended":{"engine":8,"suspension":7,"tires":7,"tank":8},"finishReward":3400,"description":"Довгий контрольний перегін вимагає запасу пального й рівного темпу.","challenge":"Автономність","hint":"Повний бак перед затяжним перегоном важливіший за зайвий стрибок.","modules":[{"id":"long-haul-0","type":"intro","name":"Знайомий початок","from":0,"to":170,"geometry":{"firstVertex":1,"lastVertex":171,"heightChange":-7.105427357601002e-15,"maximumSlopeDegrees":6.318904088577373},"material":"dirt","entry":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.35,0.35],"angularSpeed":[-1.2,1.2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"exit":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.5,0.5],"angularSpeed":[-2,2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"recovery":{"from":170,"to":170},"pickups":{"coins":[0,1,2,3,4,5,6,7,8,9,10],"fuel":[0]},"validation":{"state":"measured within complete route, not isolated proof","source":"artifacts/pixel-drive-campaign-balance.json","reference":{"entry":{"x":9,"speed":0,"bodyAngle":0,"angularSpeed":0,"groundedWheels":2,"suspensionCompression":[0,0],"fuelSeconds":72,"tick":0},"exit":{"x":170.3447,"speed":23.9739,"bodyAngle":-0.0033,"angularSpeed":0.0487,"groundedWheels":2,"suspensionCompression":[0.2298,0.2442],"fuelSeconds":71.1,"tick":531}},"profiles":[{"name":"base","n":100,"entered":100,"exited":100,"fullCourseWins":0,"entrySpeedRange":[0.1511,0.1512],"entryFuelRange":[39.9833,39.9833]},{"name":"recommended","n":100,"entered":100,"exited":100,"fullCourseWins":79,"entrySpeedRange":[0.1501,0.1504],"entryFuelRange":[71.9833,71.9833]},{"name":"maximum","n":100,"entered":100,"exited":100,"fullCourseWins":88,"entrySpeedRange":[0.1496,0.1501],"entryFuelRange":[79.9833,79.9833]},{"name":"engine-only","n":100,"entered":100,"exited":100,"fullCourseWins":0,"entrySpeedRange":[0.1511,0.1516],"entryFuelRange":[39.9833,39.9833]},{"name":"tank-only","n":100,"entered":100,"exited":100,"fullCourseWins":0,"entrySpeedRange":[0.1511,0.1512],"entryFuelRange":[79.9833,79.9833]},{"name":"strong-F0","n":100,"entered":100,"exited":100,"fullCourseWins":0,"entrySpeedRange":[0.1496,0.1501],"entryFuelRange":[39.9833,39.9833]},{"name":"recommended-minus-engine","n":100,"entered":100,"exited":100,"fullCourseWins":76,"entrySpeedRange":[0.1501,0.1504],"entryFuelRange":[71.9833,71.9833]},{"name":"recommended-minus-suspension","n":100,"entered":100,"exited":100,"fullCourseWins":78,"entrySpeedRange":[0.1502,0.1506],"entryFuelRange":[71.9833,71.9833]},{"name":"recommended-minus-tires","n":100,"entered":100,"exited":100,"fullCourseWins":81,"entrySpeedRange":[0.1501,0.1504],"entryFuelRange":[71.9833,71.9833]},{"name":"recommended-minus-tank","n":100,"entered":100,"exited":100,"fullCourseWins":79,"entrySpeedRange":[0.1501,0.1504],"entryFuelRange":[67.9833,67.9833]}]}},{"id":"long-haul-1","type":"torque","name":"Контрольний підйом","from":170,"to":410,"geometry":{"firstVertex":171,"lastVertex":411,"heightChange":94.23340919853257,"maximumSlopeDegrees":23.000008922726547},"material":"dirt","entry":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.35,0.35],"angularSpeed":[-1.2,1.2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"exit":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.5,0.5],"angularSpeed":[-2,2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"recovery":{"from":410,"to":500},"pickups":{"coins":[11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27],"fuel":[]},"validation":{"state":"measured within complete route, not isolated proof","source":"artifacts/pixel-drive-campaign-balance.json","reference":{"entry":{"x":170.3447,"speed":23.9739,"bodyAngle":-0.0033,"angularSpeed":0.0487,"groundedWheels":2,"suspensionCompression":[0.2298,0.2442],"fuelSeconds":71.1,"tick":531},"exit":{"x":410.3285,"speed":20.5904,"bodyAngle":0.2271,"angularSpeed":-1.0528,"groundedWheels":0,"suspensionCompression":[-0.0005,0.0089],"fuelSeconds":59.55,"tick":1224}},"profiles":[{"name":"base","n":100,"entered":100,"exited":0,"fullCourseWins":0,"entrySpeedRange":[15.0077,22.8229],"entryFuelRange":[38.55,39.05]},{"name":"recommended","n":100,"entered":100,"exited":100,"fullCourseWins":79,"entrySpeedRange":[15.0014,31.157],"entryFuelRange":[70.5667,71.3]},{"name":"maximum","n":100,"entered":100,"exited":100,"fullCourseWins":88,"entrySpeedRange":[13.6268,32.2797],"entryFuelRange":[78.5333,79.3167]},{"name":"engine-only","n":100,"entered":100,"exited":100,"fullCourseWins":0,"entrySpeedRange":[14.1288,32.2433],"entryFuelRange":[38.5833,39.3167]},{"name":"tank-only","n":100,"entered":100,"exited":0,"fullCourseWins":0,"entrySpeedRange":[15.0077,22.8229],"entryFuelRange":[78.55,79.05]},{"name":"strong-F0","n":100,"entered":100,"exited":100,"fullCourseWins":0,"entrySpeedRange":[13.6268,32.2797],"entryFuelRange":[38.5333,39.3167]},{"name":"recommended-minus-engine","n":100,"entered":100,"exited":100,"fullCourseWins":76,"entrySpeedRange":[14.9913,30.0288],"entryFuelRange":[70.5667,71.2833]},{"name":"recommended-minus-suspension","n":100,"entered":100,"exited":100,"fullCourseWins":78,"entrySpeedRange":[15.0023,30.9545],"entryFuelRange":[70.5667,71.2833]},{"name":"recommended-minus-tires","n":100,"entered":100,"exited":100,"fullCourseWins":81,"entrySpeedRange":[15.0015,30.9482],"entryFuelRange":[70.5667,71.2833]},{"name":"recommended-minus-tank","n":100,"entered":100,"exited":100,"fullCourseWins":79,"entrySpeedRange":[15.0014,31.157],"entryFuelRange":[66.5667,67.3]}]}},{"id":"long-haul-2","type":"recovery","name":"Відновлення","from":410,"to":500,"geometry":{"firstVertex":411,"lastVertex":501,"heightChange":0,"maximumSlopeDegrees":0},"material":"dirt","entry":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.35,0.35],"angularSpeed":[-1.2,1.2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"exit":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.5,0.5],"angularSpeed":[-2,2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"recovery":{"from":500,"to":500},"pickups":{"coins":[28,29,30,31,32,33,34],"fuel":[1]},"validation":{"state":"measured within complete route, not isolated proof","source":"artifacts/pixel-drive-campaign-balance.json","reference":{"entry":{"x":410.3285,"speed":20.5904,"bodyAngle":0.2271,"angularSpeed":-1.0528,"groundedWheels":0,"suspensionCompression":[-0.0005,0.0089],"fuelSeconds":59.55,"tick":1224},"exit":{"x":500.256,"speed":24.0209,"bodyAngle":-0.0031,"angularSpeed":0.0126,"groundedWheels":2,"suspensionCompression":[0.2464,0.2587],"fuelSeconds":70.7,"tick":1464}},"profiles":[{"name":"base","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"recommended","n":100,"entered":100,"exited":99,"fullCourseWins":79,"entrySpeedRange":[12.3281,21.1341],"entryFuelRange":[53.6667,60.8833]},{"name":"maximum","n":100,"entered":100,"exited":99,"fullCourseWins":88,"entrySpeedRange":[14.9337,23.9822],"entryFuelRange":[61.6833,69.7667]},{"name":"engine-only","n":100,"entered":100,"exited":99,"fullCourseWins":0,"entrySpeedRange":[14.9828,24.0141],"entryFuelRange":[21.8833,29.9]},{"name":"tank-only","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"strong-F0","n":100,"entered":100,"exited":99,"fullCourseWins":0,"entrySpeedRange":[14.9337,23.9822],"entryFuelRange":[21.6833,29.7667]},{"name":"recommended-minus-engine","n":100,"entered":100,"exited":99,"fullCourseWins":76,"entrySpeedRange":[14.3029,19.6512],"entryFuelRange":[53.7333,60.2167]},{"name":"recommended-minus-suspension","n":100,"entered":100,"exited":99,"fullCourseWins":78,"entrySpeedRange":[15.0315,21.1137],"entryFuelRange":[53.6667,60.8667]},{"name":"recommended-minus-tires","n":100,"entered":100,"exited":99,"fullCourseWins":81,"entrySpeedRange":[12.3227,21.1032],"entryFuelRange":[53.6667,60.85]},{"name":"recommended-minus-tank","n":100,"entered":100,"exited":99,"fullCourseWins":79,"entrySpeedRange":[12.3281,21.1341],"entryFuelRange":[49.6667,56.8833]}]}},{"id":"long-haul-3","type":"fuel-climb","name":"Перегін без заправки","from":500,"to":2000,"geometry":{"firstVertex":501,"lastVertex":2001,"heightChange":539.4038871825053,"maximumSlopeDegrees":20.000038741107762},"material":"dirt","entry":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.35,0.35],"angularSpeed":[-1.2,1.2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"exit":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.5,0.5],"angularSpeed":[-2,2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"recovery":{"from":2000,"to":2100},"pickups":{"coins":[35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100,101,102,103,104,105,106,107,108,109,110,111,112,113,114,115,116,117,118,119,120,121,122,123,124,125,126,127,128,129,130,131,132,133,134,135,136,137,138,139,140,141],"fuel":[2]},"validation":{"state":"measured within complete route, not isolated proof","source":"artifacts/pixel-drive-campaign-balance.json","reference":{"entry":{"x":500.256,"speed":24.0209,"bodyAngle":-0.0031,"angularSpeed":0.0126,"groundedWheels":2,"suspensionCompression":[0.2464,0.2587],"fuelSeconds":70.7,"tick":1464},"exit":{"x":2000.2393,"speed":22.2845,"bodyAngle":0.0418,"angularSpeed":0.2225,"groundedWheels":0,"suspensionCompression":[0.015,-0.0079],"fuelSeconds":63.4167,"tick":5495}},"profiles":[{"name":"base","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"recommended","n":100,"entered":99,"exited":87,"fullCourseWins":79,"entrySpeedRange":[15.0262,29.1791],"entryFuelRange":[69.9333,70.8833]},{"name":"maximum","n":100,"entered":99,"exited":93,"fullCourseWins":88,"entrySpeedRange":[15.0963,30.7715],"entryFuelRange":[77.8667,78.9333]},{"name":"engine-only","n":100,"entered":99,"exited":0,"fullCourseWins":0,"entrySpeedRange":[15.0239,30.6765],"entryFuelRange":[37.8667,38.9333]},{"name":"tank-only","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"strong-F0","n":100,"entered":99,"exited":0,"fullCourseWins":0,"entrySpeedRange":[15.0963,30.7715],"entryFuelRange":[37.8667,38.9333]},{"name":"recommended-minus-engine","n":100,"entered":99,"exited":87,"fullCourseWins":76,"entrySpeedRange":[15.3499,28.2711],"entryFuelRange":[69.8833,70.8333]},{"name":"recommended-minus-suspension","n":100,"entered":99,"exited":87,"fullCourseWins":78,"entrySpeedRange":[15.0196,29.134],"entryFuelRange":[69.9333,70.8667]},{"name":"recommended-minus-tires","n":100,"entered":99,"exited":87,"fullCourseWins":81,"entrySpeedRange":[15.0294,29.1786],"entryFuelRange":[69.9333,70.8833]},{"name":"recommended-minus-tank","n":100,"entered":99,"exited":87,"fullCourseWins":79,"entrySpeedRange":[15.0262,29.1791],"entryFuelRange":[65.9333,66.8833]}]}},{"id":"long-haul-4","type":"recovery","name":"Відновлення","from":2000,"to":2100,"geometry":{"firstVertex":2001,"lastVertex":2101,"heightChange":0,"maximumSlopeDegrees":0},"material":"dirt","entry":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.35,0.35],"angularSpeed":[-1.2,1.2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"exit":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.5,0.5],"angularSpeed":[-2,2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"recovery":{"from":2100,"to":2100},"pickups":{"coins":[142,143,144,145,146,147,148],"fuel":[]},"validation":{"state":"measured within complete route, not isolated proof","source":"artifacts/pixel-drive-campaign-balance.json","reference":{"entry":{"x":2000.2393,"speed":22.2845,"bodyAngle":0.0418,"angularSpeed":0.2225,"groundedWheels":0,"suspensionCompression":[0.015,-0.0079],"fuelSeconds":63.4167,"tick":5495},"exit":{"x":2100.0026,"speed":24.1208,"bodyAngle":-0.004,"angularSpeed":-0.0125,"groundedWheels":2,"suspensionCompression":[0.2457,0.2545],"fuelSeconds":59.1667,"tick":5750}},"profiles":[{"name":"base","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"recommended","n":100,"entered":87,"exited":87,"fullCourseWins":79,"entrySpeedRange":[17.8448,22.634],"entryFuelRange":[61.9,63.4333]},{"name":"maximum","n":100,"entered":93,"exited":93,"fullCourseWins":88,"entrySpeedRange":[16.8291,25.4803],"entryFuelRange":[68.3167,72.3833]},{"name":"engine-only","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"tank-only","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"strong-F0","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"recommended-minus-engine","n":100,"entered":87,"exited":87,"fullCourseWins":76,"entrySpeedRange":[15.796,21.1113],"entryFuelRange":[61.9,62.8]},{"name":"recommended-minus-suspension","n":100,"entered":87,"exited":87,"fullCourseWins":78,"entrySpeedRange":[18.3197,22.6094],"entryFuelRange":[61.8833,63.4333]},{"name":"recommended-minus-tires","n":100,"entered":87,"exited":87,"fullCourseWins":81,"entrySpeedRange":[18.8479,22.5987],"entryFuelRange":[61.9167,63.4333]},{"name":"recommended-minus-tank","n":100,"entered":87,"exited":87,"fullCourseWins":79,"entrySpeedRange":[17.8448,22.634],"entryFuelRange":[55.8,59.4333]}]}},{"id":"long-haul-5","type":"climb","name":"Плавний схил","from":2100,"to":2350,"geometry":{"firstVertex":2101,"lastVertex":2351,"heightChange":-53.561420341122584,"maximumSlopeDegrees":13.00004399988933},"material":"dirt","entry":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.35,0.35],"angularSpeed":[-1.2,1.2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"exit":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.5,0.5],"angularSpeed":[-2,2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"recovery":{"from":2350,"to":2350},"pickups":{"coins":[149,150,151,152,153,154,155,156,157,158,159,160,161,162,163,164,165,166],"fuel":[]},"validation":{"state":"measured within complete route, not isolated proof","source":"artifacts/pixel-drive-campaign-balance.json","reference":{"entry":{"x":2100.0026,"speed":24.1208,"bodyAngle":-0.004,"angularSpeed":-0.0125,"groundedWheels":2,"suspensionCompression":[0.2457,0.2545],"fuelSeconds":59.1667,"tick":5750},"exit":{"x":2350.0299,"speed":24.329,"bodyAngle":-0.0165,"angularSpeed":0.4483,"groundedWheels":2,"suspensionCompression":[0.4754,0.5173],"fuelSeconds":48.9667,"tick":6362}},"profiles":[{"name":"base","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"recommended","n":100,"entered":87,"exited":87,"fullCourseWins":79,"entrySpeedRange":[19.7443,30.1229],"entryFuelRange":[56.8,59.6]},{"name":"maximum","n":100,"entered":93,"exited":93,"fullCourseWins":88,"entrySpeedRange":[16.9932,31.5786],"entryFuelRange":[62.4333,68.8]},{"name":"engine-only","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"tank-only","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"strong-F0","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"recommended-minus-engine","n":100,"entered":87,"exited":87,"fullCourseWins":76,"entrySpeedRange":[19.735,29.1671],"entryFuelRange":[56.7833,58.8333]},{"name":"recommended-minus-suspension","n":100,"entered":87,"exited":87,"fullCourseWins":78,"entrySpeedRange":[19.8169,30.0737],"entryFuelRange":[56.7667,59.6]},{"name":"recommended-minus-tires","n":100,"entered":87,"exited":87,"fullCourseWins":81,"entrySpeedRange":[19.7523,30.1202],"entryFuelRange":[56.8333,59.6]},{"name":"recommended-minus-tank","n":100,"entered":87,"exited":87,"fullCourseWins":79,"entrySpeedRange":[19.8689,30.1229],"entryFuelRange":[50.7667,55.6]}]}},{"id":"long-haul-6","type":"rollers","name":"Хвиляста ділянка","from":2350,"to":2580,"geometry":{"firstVertex":2351,"lastVertex":2581,"heightChange":-4.547473508864641e-13,"maximumSlopeDegrees":19.804861347187998},"material":"dirt","entry":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.35,0.35],"angularSpeed":[-1.2,1.2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"exit":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.5,0.5],"angularSpeed":[-2,2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"recovery":{"from":2580,"to":2580},"pickups":{"coins":[167,168,169,170,171,172,173,174,175,176,177,178,179,180,181,182],"fuel":[]},"validation":{"state":"measured within complete route, not isolated proof","source":"artifacts/pixel-drive-campaign-balance.json","reference":{"entry":{"x":2350.0299,"speed":24.329,"bodyAngle":-0.0165,"angularSpeed":0.4483,"groundedWheels":2,"suspensionCompression":[0.4754,0.5173],"fuelSeconds":48.9667,"tick":6362},"exit":{"x":2580.2814,"speed":23.4379,"bodyAngle":0.0712,"angularSpeed":-0.0158,"groundedWheels":2,"suspensionCompression":[0.3375,0.1546],"fuelSeconds":34.7,"tick":7218}},"profiles":[{"name":"base","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"recommended","n":100,"entered":87,"exited":79,"fullCourseWins":79,"entrySpeedRange":[19.2254,37.8622],"entryFuelRange":[44.2833,52.3167]},{"name":"maximum","n":100,"entered":93,"exited":88,"fullCourseWins":88,"entrySpeedRange":[16.8019,38.5056],"entryFuelRange":[47.9833,61.75]},{"name":"engine-only","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"tank-only","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"strong-F0","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"recommended-minus-engine","n":100,"entered":87,"exited":76,"fullCourseWins":76,"entrySpeedRange":[19.5463,38.2725],"entryFuelRange":[44.2333,51.4]},{"name":"recommended-minus-suspension","n":100,"entered":87,"exited":78,"fullCourseWins":78,"entrySpeedRange":[20.0273,38.4253],"entryFuelRange":[44.2667,52.2667]},{"name":"recommended-minus-tires","n":100,"entered":87,"exited":81,"fullCourseWins":81,"entrySpeedRange":[18.7338,38.4819],"entryFuelRange":[44.3,52.3167]},{"name":"recommended-minus-tank","n":100,"entered":87,"exited":79,"fullCourseWins":79,"entrySpeedRange":[18.9416,37.8622],"entryFuelRange":[38.25,48.3167]}]}},{"id":"long-haul-7","type":"climb","name":"Плавний схил","from":2580,"to":2830,"geometry":{"firstVertex":2581,"lastVertex":2831,"heightChange":75.38136952602895,"maximumSlopeDegrees":18.000015742583283},"material":"dirt","entry":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.35,0.35],"angularSpeed":[-1.2,1.2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"exit":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.5,0.5],"angularSpeed":[-2,2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"recovery":{"from":2830,"to":3000},"pickups":{"coins":[183,184,185,186,187,188,189,190,191,192,193,194,195,196,197,198,199,200],"fuel":[3]},"validation":{"state":"measured within complete route, not isolated proof","source":"artifacts/pixel-drive-campaign-balance.json","reference":{"entry":{"x":2580.2814,"speed":23.4379,"bodyAngle":0.0712,"angularSpeed":-0.0158,"groundedWheels":2,"suspensionCompression":[0.3375,0.1546],"fuelSeconds":34.7,"tick":7218},"exit":{"x":2830.2134,"speed":23.8101,"bodyAngle":0.2867,"angularSpeed":-0.529,"groundedWheels":0,"suspensionCompression":[0.0072,0.0091],"fuelSeconds":62.0167,"tick":7864}},"profiles":[{"name":"base","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"recommended","n":100,"entered":79,"exited":79,"fullCourseWins":79,"entrySpeedRange":[19.7563,25.4008],"entryFuelRange":[28.65,43.4]},{"name":"maximum","n":100,"entered":88,"exited":88,"fullCourseWins":88,"entrySpeedRange":[17.0874,26.1505],"entryFuelRange":[31.2667,53.4833]},{"name":"engine-only","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"tank-only","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"strong-F0","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"recommended-minus-engine","n":100,"entered":76,"exited":76,"fullCourseWins":76,"entrySpeedRange":[19.8112,24.2878],"entryFuelRange":[28.5,42.1167]},{"name":"recommended-minus-suspension","n":100,"entered":78,"exited":78,"fullCourseWins":78,"entrySpeedRange":[19.8464,27.1413],"entryFuelRange":[29.0667,44.4]},{"name":"recommended-minus-tires","n":100,"entered":81,"exited":81,"fullCourseWins":81,"entrySpeedRange":[19.6903,26.8372],"entryFuelRange":[29.5,44.45]},{"name":"recommended-minus-tank","n":100,"entered":79,"exited":79,"fullCourseWins":79,"entrySpeedRange":[19.4876,25.4008],"entryFuelRange":[22.5667,39.4]}]}},{"id":"long-haul-8","type":"recovery","name":"Відновлення","from":2830,"to":3000,"geometry":{"firstVertex":2831,"lastVertex":3001,"heightChange":0,"maximumSlopeDegrees":0},"material":"dirt","entry":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.35,0.35],"angularSpeed":[-1.2,1.2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"exit":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.5,0.5],"angularSpeed":[-2,2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"recovery":{"from":3000,"to":3000},"pickups":{"coins":[201,202,203,204,205,206,207,208,209,210,211,212],"fuel":[]},"validation":{"state":"measured within complete route, not isolated proof","source":"artifacts/pixel-drive-campaign-balance.json","reference":{"entry":{"x":2830.2134,"speed":23.8101,"bodyAngle":0.2867,"angularSpeed":-0.529,"groundedWheels":0,"suspensionCompression":[0.0072,0.0091],"fuelSeconds":62.0167,"tick":7864},"exit":{"x":3000.3687,"speed":24.1397,"bodyAngle":0.0041,"angularSpeed":0.1205,"groundedWheels":2,"suspensionCompression":[0.2553,0.2444],"fuelSeconds":54.95,"tick":8288}},"profiles":[{"name":"base","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"recommended","n":100,"entered":79,"exited":79,"fullCourseWins":79,"entrySpeedRange":[19.0693,23.9551],"entryFuelRange":[59.8333,62.3333]},{"name":"maximum","n":100,"entered":88,"exited":88,"fullCourseWins":88,"entrySpeedRange":[17.3074,26.6197],"entryFuelRange":[66.0667,71.1333]},{"name":"engine-only","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"tank-only","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"strong-F0","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"recommended-minus-engine","n":100,"entered":76,"exited":76,"fullCourseWins":76,"entrySpeedRange":[17.8971,22.5976],"entryFuelRange":[59.8,61.7833]},{"name":"recommended-minus-suspension","n":100,"entered":78,"exited":78,"fullCourseWins":78,"entrySpeedRange":[18.9913,24.0545],"entryFuelRange":[59.8333,62.5167]},{"name":"recommended-minus-tires","n":100,"entered":81,"exited":81,"fullCourseWins":81,"entrySpeedRange":[18.9122,24.0877],"entryFuelRange":[59.7833,62.4833]},{"name":"recommended-minus-tank","n":100,"entered":79,"exited":79,"fullCourseWins":79,"entrySpeedRange":[19.0693,23.9551],"entryFuelRange":[55.8167,58.3333]}]}}],"fuel":[150,470,1810,2600],"seed":3581076326,"generatorVersion":3,"length":3000,"max_ticks":36000,"terrain":[[-100,12],[0,12],[1,12.000099],[2,12.000554],[3,12.001561],[4,12.003285],[5,12.005857],[6,12.009363],[7,12.01384],[8,12.019274],[9,12.025594],[10,12.032676],[11,12.040341],[12,12.048357],[13,12.056447],[14,12.064293],[15,12.071546],[16,12.077832],[17,12.082764],[18,12.085954],[19,12.087022],[20,12.085609],[21,12.081393],[22,12.074092],[23,12.063484],[24,12.04941],[25,12.031789],[26,12.01062],[27,11.985989],[28,11.958076],[29,11.927153],[30,11.893585],[31,11.857826],[32,11.820416],[33,11.781972],[34,11.743181],[35,11.704784],[36,11.667569],[37,11.632353],[38,11.599965],[39,11.57123],[40,11.546956],[41,11.527908],[42,11.514798],[43,11.508264],[44,11.508852],[45,11.517008],[46,11.533058],[47,11.557199],[48,11.589489],[49,11.629844],[50,11.678028],[51,11.733657],[52,11.796198],[53,11.864974],[54,11.939173],[55,12.017856],[56,12.099974],[57,12.18438],[58,12.269848],[59,12.355093],[60,12.438793],[61,12.519613],[62,12.596222],[63,12.667326],[64,12.731684],[65,12.788135],[66,12.835617],[67,12.873191],[68,12.900057],[69,12.915572],[70,12.919263],[71,12.910838],[72,12.890192],[73,12.857414],[74,12.81279],[75,12.756793],[76,12.690084],[77,12.613503],[78,12.528049],[79,12.434874],[80,12.335258],[81,12.230591],[82,12.12235],[83,12.012074],[84,11.901339],[85,11.791733],[86,11.684826],[87,11.582148],[88,11.48516],[89,11.395233],[90,11.31362],[91,11.241444],[92,11.17967],[93,11.129098],[94,11.090345],[95,11.063841],[96,11.049817],[97,11.048311],[98,11.059161],[99,11.082016],[100,11.116341],[101,11.161431],[102,11.216423],[103,11.280312],[104,11.351973],[105,11.430182],[106,11.513637],[107,11.600981],[108,11.690827],[109,11.781786],[110,11.872483],[111,11.961589],[112,12.047836],[113,12.130041],[114,12.207124],[115,12.278123],[116,12.342208],[117,12.398694],[118,12.447043],[119,12.486877],[120,12.517971],[121,12.540261],[122,12.55383],[123,12.55891],[124,12.555866],[125,12.54519],[126,12.52748],[127,12.503431],[128,12.473815],[129,12.439465],[130,12.401252],[131,12.360073],[132,12.316827],[133,12.272402],[134,12.227654],[135,12.183393],[136,12.140369],[137,12.099263],[138,12.06067],[139,12.025096],[140,11.992951],[141,11.964547],[142,11.940094],[143,11.919703],[144,11.90339],[145,11.89108],[146,11.882616],[147,11.877765],[148,11.876233],[149,11.87767],[150,11.881689],[151,11.887872],[152,11.895787],[153,11.904999],[154,11.91508],[155,11.925626],[156,11.936258],[157,11.946639],[158,11.956477],[159,11.965533],[160,11.973622],[161,11.980619],[162,11.986456],[163,11.991123],[164,11.994662],[165,11.997167],[166,11.998773],[167,11.999651],[168,12.000002],[169,12.000043],[170,12],[171,12.000964],[172,12.009316],[173,12.031606],[174,12.073512],[175,12.139836],[176,12.234509],[177,12.360589],[178,12.520258],[179,12.714827],[180,12.944733],[181,13.209539],[182,13.507934],[183,13.837735],[184,14.195886],[185,14.578455],[186,14.98064],[187,15.396763],[188,15.820273],[189,16.244748],[190,16.669223],[191,17.093698],[192,17.518173],[193,17.942647],[194,18.367122],[195,18.791597],[196,19.216072],[197,19.640547],[198,20.065022],[199,20.489496],[200,20.913971],[201,21.338446],[202,21.762921],[203,22.187396],[204,22.61187],[205,23.036345],[206,23.46082],[207,23.885295],[208,24.30977],[209,24.734244],[210,25.158719],[211,25.583194],[212,26.007669],[213,26.432144],[214,26.856619],[215,27.281093],[216,27.705568],[217,28.130043],[218,28.554518],[219,28.978993],[220,29.403467],[221,29.827942],[222,30.252417],[223,30.676892],[224,31.101367],[225,31.525842],[226,31.950316],[227,32.374791],[228,32.799266],[229,33.223741],[230,33.648216],[231,34.07269],[232,34.497165],[233,34.92164],[234,35.346115],[235,35.77059],[236,36.195065],[237,36.619539],[238,37.044014],[239,37.468489],[240,37.892964],[241,38.317439],[242,38.741913],[243,39.166388],[244,39.590863],[245,40.015338],[246,40.439813],[247,40.864288],[248,41.288762],[249,41.713237],[250,42.137712],[251,42.562187],[252,42.986662],[253,43.411136],[254,43.835611],[255,44.260086],[256,44.684561],[257,45.109036],[258,45.53351],[259,45.957985],[260,46.38246],[261,46.806935],[262,47.23141],[263,47.655885],[264,48.080359],[265,48.504834],[266,48.929309],[267,49.353784],[268,49.778259],[269,50.202733],[270,50.627208],[271,51.051683],[272,51.476158],[273,51.900633],[274,52.325108],[275,52.749582],[276,53.174057],[277,53.598532],[278,54.023007],[279,54.447482],[280,54.871956],[281,55.296431],[282,55.720906],[283,56.145381],[284,56.569856],[285,56.994331],[286,57.418805],[287,57.84328],[288,58.267755],[289,58.69223],[290,59.116705],[291,59.541179],[292,59.965654],[293,60.390129],[294,60.814604],[295,61.239079],[296,61.663553],[297,62.088028],[298,62.512503],[299,62.936978],[300,63.361453],[301,63.785928],[302,64.210402],[303,64.634877],[304,65.059352],[305,65.483827],[306,65.908302],[307,66.332776],[308,66.757251],[309,67.181726],[310,67.606201],[311,68.030676],[312,68.455151],[313,68.879625],[314,69.3041],[315,69.728575],[316,70.15305],[317,70.577525],[318,71.001999],[319,71.426474],[320,71.850949],[321,72.275424],[322,72.699899],[323,73.124374],[324,73.548848],[325,73.973323],[326,74.397798],[327,74.822273],[328,75.246748],[329,75.671222],[330,76.095697],[331,76.520172],[332,76.944647],[333,77.369122],[334,77.793597],[335,78.218071],[336,78.642546],[337,79.067021],[338,79.491496],[339,79.915971],[340,80.340445],[341,80.76492],[342,81.189395],[343,81.61387],[344,82.038345],[345,82.462819],[346,82.887294],[347,83.311769],[348,83.736244],[349,84.160719],[350,84.585194],[351,85.009668],[352,85.434143],[353,85.858618],[354,86.283093],[355,86.707568],[356,87.132042],[357,87.556517],[358,87.980992],[359,88.405467],[360,88.829942],[361,89.254417],[362,89.678891],[363,90.103366],[364,90.527841],[365,90.952316],[366,91.376791],[367,91.801265],[368,92.22574],[369,92.650215],[370,93.07469],[371,93.499165],[372,93.92364],[373,94.348114],[374,94.772589],[375,95.197064],[376,95.621539],[377,96.046014],[378,96.470488],[379,96.894963],[380,97.319438],[381,97.743913],[382,98.168388],[383,98.592863],[384,99.017337],[385,99.441812],[386,99.866287],[387,100.290762],[388,100.715237],[389,101.139711],[390,101.564186],[391,101.988661],[392,102.413136],[393,102.836646],[394,103.252769],[395,103.654954],[396,104.037524],[397,104.395674],[398,104.725476],[399,105.023871],[400,105.288676],[401,105.518582],[402,105.713151],[403,105.87282],[404,105.9989],[405,106.093573],[406,106.159898],[407,106.201803],[408,106.224093],[409,106.232445],[410,106.233409],[411,106.233409],[412,106.233409],[413,106.233409],[414,106.233409],[415,106.233409],[416,106.233409],[417,106.233409],[418,106.233409],[419,106.233409],[420,106.233409],[421,106.233409],[422,106.233409],[423,106.233409],[424,106.233409],[425,106.233409],[426,106.233409],[427,106.233409],[428,106.233409],[429,106.233409],[430,106.233409],[431,106.233409],[432,106.233409],[433,106.233409],[434,106.233409],[435,106.233409],[436,106.233409],[437,106.233409],[438,106.233409],[439,106.233409],[440,106.233409],[441,106.233409],[442,106.233409],[443,106.233409],[444,106.233409],[445,106.233409],[446,106.233409],[447,106.233409],[448,106.233409],[449,106.233409],[450,106.233409],[451,106.233409],[452,106.233409],[453,106.233409],[454,106.233409],[455,106.233409],[456,106.233409],[457,106.233409],[458,106.233409],[459,106.233409],[460,106.233409],[461,106.233409],[462,106.233409],[463,106.233409],[464,106.233409],[465,106.233409],[466,106.233409],[467,106.233409],[468,106.233409],[469,106.233409],[470,106.233409],[471,106.233409],[472,106.233409],[473,106.233409],[474,106.233409],[475,106.233409],[476,106.233409],[477,106.233409],[478,106.233409],[479,106.233409],[480,106.233409],[481,106.233409],[482,106.233409],[483,106.233409],[484,106.233409],[485,106.233409],[486,106.233409],[487,106.233409],[488,106.233409],[489,106.233409],[490,106.233409],[491,106.233409],[492,106.233409],[493,106.233409],[494,106.233409],[495,106.233409],[496,106.233409],[497,106.233409],[498,106.233409],[499,106.233409],[500,106.233409],[501,106.234236],[502,106.241398],[503,106.26051],[504,106.296442],[505,106.353313],[506,106.434492],[507,106.5426],[508,106.67951],[509,106.846345],[510,107.04348],[511,107.27054],[512,107.526402],[513,107.809194],[514,108.116294],[515,108.444332],[516,108.789189],[517,109.145998],[518,109.509141],[519,109.873112],[520,110.237082],[521,110.601052],[522,110.965022],[523,111.328992],[524,111.692963],[525,112.056933],[526,112.420903],[527,112.784873],[528,113.148844],[529,113.512814],[530,113.876784],[531,114.240754],[532,114.604725],[533,114.968695],[534,115.332665],[535,115.696635],[536,116.060606],[537,116.424576],[538,116.788546],[539,117.152516],[540,117.516486],[541,117.880457],[542,118.244427],[543,118.608397],[544,118.972367],[545,119.336338],[546,119.700308],[547,120.064278],[548,120.428248],[549,120.792219],[550,121.156189],[551,121.520159],[552,121.884129],[553,122.2481],[554,122.61207],[555,122.97604],[556,123.34001],[557,123.70398],[558,124.067951],[559,124.431921],[560,124.795891],[561,125.159861],[562,125.523832],[563,125.887802],[564,126.251772],[565,126.615742],[566,126.979713],[567,127.343683],[568,127.707653],[569,128.071623],[570,128.435593],[571,128.799564],[572,129.163534],[573,129.527504],[574,129.891474],[575,130.255445],[576,130.619415],[577,130.983385],[578,131.347355],[579,131.711326],[580,132.075296],[581,132.439266],[582,132.803236],[583,133.167207],[584,133.531177],[585,133.895147],[586,134.259117],[587,134.623087],[588,134.987058],[589,135.351028],[590,135.714998],[591,136.078968],[592,136.442939],[593,136.806909],[594,137.170879],[595,137.534849],[596,137.89882],[597,138.26279],[598,138.62676],[599,138.99073],[600,139.354701],[601,139.718671],[602,140.082641],[603,140.446611],[604,140.810581],[605,141.174552],[606,141.538522],[607,141.902492],[608,142.266462],[609,142.630433],[610,142.994403],[611,143.358373],[612,143.722343],[613,144.086314],[614,144.450284],[615,144.814254],[616,145.178224],[617,145.542194],[618,145.906165],[619,146.270135],[620,146.634105],[621,146.998075],[622,147.362046],[623,147.726016],[624,148.089986],[625,148.453956],[626,148.817927],[627,149.181897],[628,149.545867],[629,149.909837],[630,150.273808],[631,150.637778],[632,151.001748],[633,151.365718],[634,151.729688],[635,152.093659],[636,152.457629],[637,152.821599],[638,153.185569],[639,153.54954],[640,153.91351],[641,154.27748],[642,154.64145],[643,155.005421],[644,155.369391],[645,155.733361],[646,156.097331],[647,156.461302],[648,156.825272],[649,157.189242],[650,157.553212],[651,157.917182],[652,158.281153],[653,158.645123],[654,159.009093],[655,159.373063],[656,159.737034],[657,160.101004],[658,160.464974],[659,160.828944],[660,161.192915],[661,161.556885],[662,161.920855],[663,162.284825],[664,162.648796],[665,163.012766],[666,163.376736],[667,163.740706],[668,164.104676],[669,164.468647],[670,164.832617],[671,165.196587],[672,165.560557],[673,165.924528],[674,166.288498],[675,166.652468],[676,167.016438],[677,167.380409],[678,167.744379],[679,168.108349],[680,168.472319],[681,168.836289],[682,169.20026],[683,169.56423],[684,169.9282],[685,170.29217],[686,170.656141],[687,171.020111],[688,171.384081],[689,171.748051],[690,172.112022],[691,172.475992],[692,172.839962],[693,173.203932],[694,173.567903],[695,173.931873],[696,174.295843],[697,174.659813],[698,175.023783],[699,175.387754],[700,175.751724],[701,176.115694],[702,176.479664],[703,176.843635],[704,177.207605],[705,177.571575],[706,177.935545],[707,178.299516],[708,178.663486],[709,179.027456],[710,179.391426],[711,179.755397],[712,180.119367],[713,180.483337],[714,180.847307],[715,181.211277],[716,181.575248],[717,181.939218],[718,182.303188],[719,182.667158],[720,183.031129],[721,183.395099],[722,183.759069],[723,184.123039],[724,184.48701],[725,184.85098],[726,185.21495],[727,185.57892],[728,185.942891],[729,186.306861],[730,186.670831],[731,187.034801],[732,187.398771],[733,187.762742],[734,188.126712],[735,188.490682],[736,188.854652],[737,189.218623],[738,189.582593],[739,189.946563],[740,190.310533],[741,190.674504],[742,191.038474],[743,191.402444],[744,191.766414],[745,192.130384],[746,192.494355],[747,192.858325],[748,193.222295],[749,193.586265],[750,193.950236],[751,194.314206],[752,194.678176],[753,195.042146],[754,195.406117],[755,195.770087],[756,196.134057],[757,196.498027],[758,196.861998],[759,197.225968],[760,197.589938],[761,197.953908],[762,198.317878],[763,198.681849],[764,199.045819],[765,199.409789],[766,199.773759],[767,200.13773],[768,200.5017],[769,200.86567],[770,201.22964],[771,201.593611],[772,201.957581],[773,202.321551],[774,202.685521],[775,203.049492],[776,203.413462],[777,203.777432],[778,204.141402],[779,204.505372],[780,204.869343],[781,205.233313],[782,205.597283],[783,205.961253],[784,206.325224],[785,206.689194],[786,207.053164],[787,207.417134],[788,207.781105],[789,208.145075],[790,208.509045],[791,208.873015],[792,209.236985],[793,209.600956],[794,209.964926],[795,210.328896],[796,210.692866],[797,211.056837],[798,211.420807],[799,211.784777],[800,212.148747],[801,212.512718],[802,212.876688],[803,213.240658],[804,213.604628],[805,213.968599],[806,214.332569],[807,214.696539],[808,215.060509],[809,215.424479],[810,215.78845],[811,216.15242],[812,216.51639],[813,216.88036],[814,217.244331],[815,217.608301],[816,217.972271],[817,218.336241],[818,218.700212],[819,219.064182],[820,219.428152],[821,219.792122],[822,220.156093],[823,220.520063],[824,220.884033],[825,221.248003],[826,221.611973],[827,221.975944],[828,222.339914],[829,222.703884],[830,223.067854],[831,223.431825],[832,223.795795],[833,224.159765],[834,224.523735],[835,224.887706],[836,225.251676],[837,225.615646],[838,225.979616],[839,226.343587],[840,226.707557],[841,227.071527],[842,227.435497],[843,227.799467],[844,228.163438],[845,228.527408],[846,228.891378],[847,229.255348],[848,229.619319],[849,229.983289],[850,230.347259],[851,230.711229],[852,231.0752],[853,231.43917],[854,231.80314],[855,232.16711],[856,232.53108],[857,232.895051],[858,233.259021],[859,233.622991],[860,233.986961],[861,234.350932],[862,234.714902],[863,235.078872],[864,235.442842],[865,235.806813],[866,236.170783],[867,236.534753],[868,236.898723],[869,237.262694],[870,237.626664],[871,237.990634],[872,238.354604],[873,238.718574],[874,239.082545],[875,239.446515],[876,239.810485],[877,240.174455],[878,240.538426],[879,240.902396],[880,241.266366],[881,241.630336],[882,241.994307],[883,242.358277],[884,242.722247],[885,243.086217],[886,243.450188],[887,243.814158],[888,244.178128],[889,244.542098],[890,244.906068],[891,245.270039],[892,245.634009],[893,245.997979],[894,246.361949],[895,246.72592],[896,247.08989],[897,247.45386],[898,247.81783],[899,248.181801],[900,248.545771],[901,248.909741],[902,249.273711],[903,249.637681],[904,250.001652],[905,250.365622],[906,250.729592],[907,251.093562],[908,251.457533],[909,251.821503],[910,252.185473],[911,252.549443],[912,252.913414],[913,253.277384],[914,253.641354],[915,254.005324],[916,254.369295],[917,254.733265],[918,255.097235],[919,255.461205],[920,255.825175],[921,256.189146],[922,256.553116],[923,256.917086],[924,257.281056],[925,257.645027],[926,258.008997],[927,258.372967],[928,258.736937],[929,259.100908],[930,259.464878],[931,259.828848],[932,260.192818],[933,260.556789],[934,260.920759],[935,261.284729],[936,261.648699],[937,262.012669],[938,262.37664],[939,262.74061],[940,263.10458],[941,263.46855],[942,263.832521],[943,264.196491],[944,264.560461],[945,264.924431],[946,265.288402],[947,265.652372],[948,266.016342],[949,266.380312],[950,266.744283],[951,267.108253],[952,267.472223],[953,267.836193],[954,268.200163],[955,268.564134],[956,268.928104],[957,269.292074],[958,269.656044],[959,270.020015],[960,270.383985],[961,270.747955],[962,271.111925],[963,271.475896],[964,271.839866],[965,272.203836],[966,272.567806],[967,272.931776],[968,273.295747],[969,273.659717],[970,274.023687],[971,274.387657],[972,274.751628],[973,275.115598],[974,275.479568],[975,275.843538],[976,276.207509],[977,276.571479],[978,276.935449],[979,277.299419],[980,277.66339],[981,278.02736],[982,278.39133],[983,278.7553],[984,279.11927],[985,279.483241],[986,279.847211],[987,280.211181],[988,280.575151],[989,280.939122],[990,281.303092],[991,281.667062],[992,282.031032],[993,282.395003],[994,282.758973],[995,283.122943],[996,283.486913],[997,283.850884],[998,284.214854],[999,284.578824],[1000,284.942794],[1001,285.306764],[1002,285.670735],[1003,286.034705],[1004,286.398675],[1005,286.762645],[1006,287.126616],[1007,287.490586],[1008,287.854556],[1009,288.218526],[1010,288.582497],[1011,288.946467],[1012,289.310437],[1013,289.674407],[1014,290.038378],[1015,290.402348],[1016,290.766318],[1017,291.130288],[1018,291.494258],[1019,291.858229],[1020,292.222199],[1021,292.586169],[1022,292.950139],[1023,293.31411],[1024,293.67808],[1025,294.04205],[1026,294.40602],[1027,294.769991],[1028,295.133961],[1029,295.497931],[1030,295.861901],[1031,296.225871],[1032,296.589842],[1033,296.953812],[1034,297.317782],[1035,297.681752],[1036,298.045723],[1037,298.409693],[1038,298.773663],[1039,299.137633],[1040,299.501604],[1041,299.865574],[1042,300.229544],[1043,300.593514],[1044,300.957485],[1045,301.321455],[1046,301.685425],[1047,302.049395],[1048,302.413365],[1049,302.777336],[1050,303.141306],[1051,303.505276],[1052,303.869246],[1053,304.233217],[1054,304.597187],[1055,304.961157],[1056,305.325127],[1057,305.689098],[1058,306.053068],[1059,306.417038],[1060,306.781008],[1061,307.144979],[1062,307.508949],[1063,307.872919],[1064,308.236889],[1065,308.600859],[1066,308.96483],[1067,309.3288],[1068,309.69277],[1069,310.05674],[1070,310.420711],[1071,310.784681],[1072,311.148651],[1073,311.512621],[1074,311.876592],[1075,312.240562],[1076,312.604532],[1077,312.968502],[1078,313.332472],[1079,313.696443],[1080,314.060413],[1081,314.424383],[1082,314.788353],[1083,315.152324],[1084,315.516294],[1085,315.880264],[1086,316.244234],[1087,316.608205],[1088,316.972175],[1089,317.336145],[1090,317.700115],[1091,318.064086],[1092,318.428056],[1093,318.792026],[1094,319.155996],[1095,319.519966],[1096,319.883937],[1097,320.247907],[1098,320.611877],[1099,320.975847],[1100,321.339818],[1101,321.703788],[1102,322.067758],[1103,322.431728],[1104,322.795699],[1105,323.159669],[1106,323.523639],[1107,323.887609],[1108,324.25158],[1109,324.61555],[1110,324.97952],[1111,325.34349],[1112,325.70746],[1113,326.071431],[1114,326.435401],[1115,326.799371],[1116,327.163341],[1117,327.527312],[1118,327.891282],[1119,328.255252],[1120,328.619222],[1121,328.983193],[1122,329.347163],[1123,329.711133],[1124,330.075103],[1125,330.439074],[1126,330.803044],[1127,331.167014],[1128,331.530984],[1129,331.894954],[1130,332.258925],[1131,332.622895],[1132,332.986865],[1133,333.350835],[1134,333.714806],[1135,334.078776],[1136,334.442746],[1137,334.806716],[1138,335.170687],[1139,335.534657],[1140,335.898627],[1141,336.262597],[1142,336.626567],[1143,336.990538],[1144,337.354508],[1145,337.718478],[1146,338.082448],[1147,338.446419],[1148,338.810389],[1149,339.174359],[1150,339.538329],[1151,339.9023],[1152,340.26627],[1153,340.63024],[1154,340.99421],[1155,341.358181],[1156,341.722151],[1157,342.086121],[1158,342.450091],[1159,342.814061],[1160,343.178032],[1161,343.542002],[1162,343.905972],[1163,344.269942],[1164,344.633913],[1165,344.997883],[1166,345.361853],[1167,345.725823],[1168,346.089794],[1169,346.453764],[1170,346.817734],[1171,347.181704],[1172,347.545675],[1173,347.909645],[1174,348.273615],[1175,348.637585],[1176,349.001555],[1177,349.365526],[1178,349.729496],[1179,350.093466],[1180,350.457436],[1181,350.821407],[1182,351.185377],[1183,351.549347],[1184,351.913317],[1185,352.277288],[1186,352.641258],[1187,353.005228],[1188,353.369198],[1189,353.733168],[1190,354.097139],[1191,354.461109],[1192,354.825079],[1193,355.189049],[1194,355.55302],[1195,355.91699],[1196,356.28096],[1197,356.64493],[1198,357.008901],[1199,357.372871],[1200,357.736841],[1201,358.100811],[1202,358.464782],[1203,358.828752],[1204,359.192722],[1205,359.556692],[1206,359.920662],[1207,360.284633],[1208,360.648603],[1209,361.012573],[1210,361.376543],[1211,361.740514],[1212,362.104484],[1213,362.468454],[1214,362.832424],[1215,363.196395],[1216,363.560365],[1217,363.924335],[1218,364.288305],[1219,364.652276],[1220,365.016246],[1221,365.380216],[1222,365.744186],[1223,366.108156],[1224,366.472127],[1225,366.836097],[1226,367.200067],[1227,367.564037],[1228,367.928008],[1229,368.291978],[1230,368.655948],[1231,369.019918],[1232,369.383889],[1233,369.747859],[1234,370.111829],[1235,370.475799],[1236,370.83977],[1237,371.20374],[1238,371.56771],[1239,371.93168],[1240,372.29565],[1241,372.659621],[1242,373.023591],[1243,373.387561],[1244,373.751531],[1245,374.115502],[1246,374.479472],[1247,374.843442],[1248,375.207412],[1249,375.571383],[1250,375.935353],[1251,376.299323],[1252,376.663293],[1253,377.027263],[1254,377.391234],[1255,377.755204],[1256,378.119174],[1257,378.483144],[1258,378.847115],[1259,379.211085],[1260,379.575055],[1261,379.939025],[1262,380.302996],[1263,380.666966],[1264,381.030936],[1265,381.394906],[1266,381.758877],[1267,382.122847],[1268,382.486817],[1269,382.850787],[1270,383.214757],[1271,383.578728],[1272,383.942698],[1273,384.306668],[1274,384.670638],[1275,385.034609],[1276,385.398579],[1277,385.762549],[1278,386.126519],[1279,386.49049],[1280,386.85446],[1281,387.21843],[1282,387.5824],[1283,387.946371],[1284,388.310341],[1285,388.674311],[1286,389.038281],[1287,389.402251],[1288,389.766222],[1289,390.130192],[1290,390.494162],[1291,390.858132],[1292,391.222103],[1293,391.586073],[1294,391.950043],[1295,392.314013],[1296,392.677984],[1297,393.041954],[1298,393.405924],[1299,393.769894],[1300,394.133865],[1301,394.497835],[1302,394.861805],[1303,395.225775],[1304,395.589745],[1305,395.953716],[1306,396.317686],[1307,396.681656],[1308,397.045626],[1309,397.409597],[1310,397.773567],[1311,398.137537],[1312,398.501507],[1313,398.865478],[1314,399.229448],[1315,399.593418],[1316,399.957388],[1317,400.321358],[1318,400.685329],[1319,401.049299],[1320,401.413269],[1321,401.777239],[1322,402.14121],[1323,402.50518],[1324,402.86915],[1325,403.23312],[1326,403.597091],[1327,403.961061],[1328,404.325031],[1329,404.689001],[1330,405.052972],[1331,405.416942],[1332,405.780912],[1333,406.144882],[1334,406.508852],[1335,406.872823],[1336,407.236793],[1337,407.600763],[1338,407.964733],[1339,408.328704],[1340,408.692674],[1341,409.056644],[1342,409.420614],[1343,409.784585],[1344,410.148555],[1345,410.512525],[1346,410.876495],[1347,411.240466],[1348,411.604436],[1349,411.968406],[1350,412.332376],[1351,412.696346],[1352,413.060317],[1353,413.424287],[1354,413.788257],[1355,414.152227],[1356,414.516198],[1357,414.880168],[1358,415.244138],[1359,415.608108],[1360,415.972079],[1361,416.336049],[1362,416.700019],[1363,417.063989],[1364,417.427959],[1365,417.79193],[1366,418.1559],[1367,418.51987],[1368,418.88384],[1369,419.247811],[1370,419.611781],[1371,419.975751],[1372,420.339721],[1373,420.703692],[1374,421.067662],[1375,421.431632],[1376,421.795602],[1377,422.159573],[1378,422.523543],[1379,422.887513],[1380,423.251483],[1381,423.615453],[1382,423.979424],[1383,424.343394],[1384,424.707364],[1385,425.071334],[1386,425.435305],[1387,425.799275],[1388,426.163245],[1389,426.527215],[1390,426.891186],[1391,427.255156],[1392,427.619126],[1393,427.983096],[1394,428.347067],[1395,428.711037],[1396,429.075007],[1397,429.438977],[1398,429.802947],[1399,430.166918],[1400,430.530888],[1401,430.894858],[1402,431.258828],[1403,431.622799],[1404,431.986769],[1405,432.350739],[1406,432.714709],[1407,433.07868],[1408,433.44265],[1409,433.80662],[1410,434.17059],[1411,434.534561],[1412,434.898531],[1413,435.262501],[1414,435.626471],[1415,435.990441],[1416,436.354412],[1417,436.718382],[1418,437.082352],[1419,437.446322],[1420,437.810293],[1421,438.174263],[1422,438.538233],[1423,438.902203],[1424,439.266174],[1425,439.630144],[1426,439.994114],[1427,440.358084],[1428,440.722054],[1429,441.086025],[1430,441.449995],[1431,441.813965],[1432,442.177935],[1433,442.541906],[1434,442.905876],[1435,443.269846],[1436,443.633816],[1437,443.997787],[1438,444.361757],[1439,444.725727],[1440,445.089697],[1441,445.453668],[1442,445.817638],[1443,446.181608],[1444,446.545578],[1445,446.909548],[1446,447.273519],[1447,447.637489],[1448,448.001459],[1449,448.365429],[1450,448.7294],[1451,449.09337],[1452,449.45734],[1453,449.82131],[1454,450.185281],[1455,450.549251],[1456,450.913221],[1457,451.277191],[1458,451.641162],[1459,452.005132],[1460,452.369102],[1461,452.733072],[1462,453.097042],[1463,453.461013],[1464,453.824983],[1465,454.188953],[1466,454.552923],[1467,454.916894],[1468,455.280864],[1469,455.644834],[1470,456.008804],[1471,456.372775],[1472,456.736745],[1473,457.100715],[1474,457.464685],[1475,457.828655],[1476,458.192626],[1477,458.556596],[1478,458.920566],[1479,459.284536],[1480,459.648507],[1481,460.012477],[1482,460.376447],[1483,460.740417],[1484,461.104388],[1485,461.468358],[1486,461.832328],[1487,462.196298],[1488,462.560269],[1489,462.924239],[1490,463.288209],[1491,463.652179],[1492,464.016149],[1493,464.38012],[1494,464.74409],[1495,465.10806],[1496,465.47203],[1497,465.836001],[1498,466.199971],[1499,466.563941],[1500,466.927911],[1501,467.291882],[1502,467.655852],[1503,468.019822],[1504,468.383792],[1505,468.747763],[1506,469.111733],[1507,469.475703],[1508,469.839673],[1509,470.203643],[1510,470.567614],[1511,470.931584],[1512,471.295554],[1513,471.659524],[1514,472.023495],[1515,472.387465],[1516,472.751435],[1517,473.115405],[1518,473.479376],[1519,473.843346],[1520,474.207316],[1521,474.571286],[1522,474.935257],[1523,475.299227],[1524,475.663197],[1525,476.027167],[1526,476.391137],[1527,476.755108],[1528,477.119078],[1529,477.483048],[1530,477.847018],[1531,478.210989],[1532,478.574959],[1533,478.938929],[1534,479.302899],[1535,479.66687],[1536,480.03084],[1537,480.39481],[1538,480.75878],[1539,481.12275],[1540,481.486721],[1541,481.850691],[1542,482.214661],[1543,482.578631],[1544,482.942602],[1545,483.306572],[1546,483.670542],[1547,484.034512],[1548,484.398483],[1549,484.762453],[1550,485.126423],[1551,485.490393],[1552,485.854364],[1553,486.218334],[1554,486.582304],[1555,486.946274],[1556,487.310244],[1557,487.674215],[1558,488.038185],[1559,488.402155],[1560,488.766125],[1561,489.130096],[1562,489.494066],[1563,489.858036],[1564,490.222006],[1565,490.585977],[1566,490.949947],[1567,491.313917],[1568,491.677887],[1569,492.041858],[1570,492.405828],[1571,492.769798],[1572,493.133768],[1573,493.497738],[1574,493.861709],[1575,494.225679],[1576,494.589649],[1577,494.953619],[1578,495.31759],[1579,495.68156],[1580,496.04553],[1581,496.4095],[1582,496.773471],[1583,497.137441],[1584,497.501411],[1585,497.865381],[1586,498.229352],[1587,498.593322],[1588,498.957292],[1589,499.321262],[1590,499.685232],[1591,500.049203],[1592,500.413173],[1593,500.777143],[1594,501.141113],[1595,501.505084],[1596,501.869054],[1597,502.233024],[1598,502.596994],[1599,502.960965],[1600,503.324935],[1601,503.688905],[1602,504.052875],[1603,504.416845],[1604,504.780816],[1605,505.144786],[1606,505.508756],[1607,505.872726],[1608,506.236697],[1609,506.600667],[1610,506.964637],[1611,507.328607],[1612,507.692578],[1613,508.056548],[1614,508.420518],[1615,508.784488],[1616,509.148459],[1617,509.512429],[1618,509.876399],[1619,510.240369],[1620,510.604339],[1621,510.96831],[1622,511.33228],[1623,511.69625],[1624,512.06022],[1625,512.424191],[1626,512.788161],[1627,513.152131],[1628,513.516101],[1629,513.880072],[1630,514.244042],[1631,514.608012],[1632,514.971982],[1633,515.335953],[1634,515.699923],[1635,516.063893],[1636,516.427863],[1637,516.791833],[1638,517.155804],[1639,517.519774],[1640,517.883744],[1641,518.247714],[1642,518.611685],[1643,518.975655],[1644,519.339625],[1645,519.703595],[1646,520.067566],[1647,520.431536],[1648,520.795506],[1649,521.159476],[1650,521.523446],[1651,521.887417],[1652,522.251387],[1653,522.615357],[1654,522.979327],[1655,523.343298],[1656,523.707268],[1657,524.071238],[1658,524.435208],[1659,524.799179],[1660,525.163149],[1661,525.527119],[1662,525.891089],[1663,526.25506],[1664,526.61903],[1665,526.983],[1666,527.34697],[1667,527.71094],[1668,528.074911],[1669,528.438881],[1670,528.802851],[1671,529.166821],[1672,529.530792],[1673,529.894762],[1674,530.258732],[1675,530.622702],[1676,530.986673],[1677,531.350643],[1678,531.714613],[1679,532.078583],[1680,532.442554],[1681,532.806524],[1682,533.170494],[1683,533.534464],[1684,533.898434],[1685,534.262405],[1686,534.626375],[1687,534.990345],[1688,535.354315],[1689,535.718286],[1690,536.082256],[1691,536.446226],[1692,536.810196],[1693,537.174167],[1694,537.538137],[1695,537.902107],[1696,538.266077],[1697,538.630048],[1698,538.994018],[1699,539.357988],[1700,539.721958],[1701,540.085928],[1702,540.449899],[1703,540.813869],[1704,541.177839],[1705,541.541809],[1706,541.90578],[1707,542.26975],[1708,542.63372],[1709,542.99769],[1710,543.361661],[1711,543.725631],[1712,544.089601],[1713,544.453571],[1714,544.817541],[1715,545.181512],[1716,545.545482],[1717,545.909452],[1718,546.273422],[1719,546.637393],[1720,547.001363],[1721,547.365333],[1722,547.729303],[1723,548.093274],[1724,548.457244],[1725,548.821214],[1726,549.185184],[1727,549.549155],[1728,549.913125],[1729,550.277095],[1730,550.641065],[1731,551.005035],[1732,551.369006],[1733,551.732976],[1734,552.096946],[1735,552.460916],[1736,552.824887],[1737,553.188857],[1738,553.552827],[1739,553.916797],[1740,554.280768],[1741,554.644738],[1742,555.008708],[1743,555.372678],[1744,555.736649],[1745,556.100619],[1746,556.464589],[1747,556.828559],[1748,557.192529],[1749,557.5565],[1750,557.92047],[1751,558.28444],[1752,558.64841],[1753,559.012381],[1754,559.376351],[1755,559.740321],[1756,560.104291],[1757,560.468262],[1758,560.832232],[1759,561.196202],[1760,561.560172],[1761,561.924142],[1762,562.288113],[1763,562.652083],[1764,563.016053],[1765,563.380023],[1766,563.743994],[1767,564.107964],[1768,564.471934],[1769,564.835904],[1770,565.199875],[1771,565.563845],[1772,565.927815],[1773,566.291785],[1774,566.655756],[1775,567.019726],[1776,567.383696],[1777,567.747666],[1778,568.111636],[1779,568.475607],[1780,568.839577],[1781,569.203547],[1782,569.567517],[1783,569.931488],[1784,570.295458],[1785,570.659428],[1786,571.023398],[1787,571.387369],[1788,571.751339],[1789,572.115309],[1790,572.479279],[1791,572.84325],[1792,573.20722],[1793,573.57119],[1794,573.93516],[1795,574.29913],[1796,574.663101],[1797,575.027071],[1798,575.391041],[1799,575.755011],[1800,576.118982],[1801,576.482952],[1802,576.846922],[1803,577.210892],[1804,577.574863],[1805,577.938833],[1806,578.302803],[1807,578.666773],[1808,579.030744],[1809,579.394714],[1810,579.758684],[1811,580.122654],[1812,580.486624],[1813,580.850595],[1814,581.214565],[1815,581.578535],[1816,581.942505],[1817,582.306476],[1818,582.670446],[1819,583.034416],[1820,583.398386],[1821,583.762357],[1822,584.126327],[1823,584.490297],[1824,584.854267],[1825,585.218237],[1826,585.582208],[1827,585.946178],[1828,586.310148],[1829,586.674118],[1830,587.038089],[1831,587.402059],[1832,587.766029],[1833,588.129999],[1834,588.49397],[1835,588.85794],[1836,589.22191],[1837,589.58588],[1838,589.949851],[1839,590.313821],[1840,590.677791],[1841,591.041761],[1842,591.405731],[1843,591.769702],[1844,592.133672],[1845,592.497642],[1846,592.861612],[1847,593.225583],[1848,593.589553],[1849,593.953523],[1850,594.317493],[1851,594.681464],[1852,595.045434],[1853,595.409404],[1854,595.773374],[1855,596.137345],[1856,596.501315],[1857,596.865285],[1858,597.229255],[1859,597.593225],[1860,597.957196],[1861,598.321166],[1862,598.685136],[1863,599.049106],[1864,599.413077],[1865,599.777047],[1866,600.141017],[1867,600.504987],[1868,600.868958],[1869,601.232928],[1870,601.596898],[1871,601.960868],[1872,602.324839],[1873,602.688809],[1874,603.052779],[1875,603.416749],[1876,603.780719],[1877,604.14469],[1878,604.50866],[1879,604.87263],[1880,605.2366],[1881,605.600571],[1882,605.964541],[1883,606.328511],[1884,606.692481],[1885,607.056452],[1886,607.420422],[1887,607.784392],[1888,608.148362],[1889,608.512332],[1890,608.876303],[1891,609.240273],[1892,609.604243],[1893,609.968213],[1894,610.332184],[1895,610.696154],[1896,611.060124],[1897,611.424094],[1898,611.788065],[1899,612.152035],[1900,612.516005],[1901,612.879975],[1902,613.243946],[1903,613.607916],[1904,613.971886],[1905,614.335856],[1906,614.699826],[1907,615.063797],[1908,615.427767],[1909,615.791737],[1910,616.155707],[1911,616.519678],[1912,616.883648],[1913,617.247618],[1914,617.611588],[1915,617.975559],[1916,618.339529],[1917,618.703499],[1918,619.067469],[1919,619.43144],[1920,619.79541],[1921,620.15938],[1922,620.52335],[1923,620.88732],[1924,621.251291],[1925,621.615261],[1926,621.979231],[1927,622.343201],[1928,622.707172],[1929,623.071142],[1930,623.435112],[1931,623.799082],[1932,624.163053],[1933,624.527023],[1934,624.890993],[1935,625.254963],[1936,625.618933],[1937,625.982904],[1938,626.346874],[1939,626.710844],[1940,627.074814],[1941,627.438785],[1942,627.802755],[1943,628.166725],[1944,628.530695],[1945,628.894666],[1946,629.258636],[1947,629.622606],[1948,629.986576],[1949,630.350547],[1950,630.714517],[1951,631.078487],[1952,631.442457],[1953,631.806427],[1954,632.170398],[1955,632.534368],[1956,632.898338],[1957,633.262308],[1958,633.626279],[1959,633.990249],[1960,634.354219],[1961,634.718189],[1962,635.08216],[1963,635.44613],[1964,635.8101],[1965,636.17407],[1966,636.538041],[1967,636.902011],[1968,637.265981],[1969,637.629951],[1970,637.993921],[1971,638.357892],[1972,638.721862],[1973,639.085832],[1974,639.449802],[1975,639.813773],[1976,640.177743],[1977,640.541713],[1978,640.905683],[1979,641.269654],[1980,641.633624],[1981,641.997594],[1982,642.361564],[1983,642.724708],[1984,643.081516],[1985,643.426374],[1986,643.754412],[1987,644.061512],[1988,644.344303],[1989,644.600165],[1990,644.827225],[1991,645.02436],[1992,645.191196],[1993,645.328106],[1994,645.436214],[1995,645.517393],[1996,645.574263],[1997,645.610195],[1998,645.629308],[1999,645.636469],[2000,645.637296],[2001,645.637296],[2002,645.637296],[2003,645.637296],[2004,645.637296],[2005,645.637296],[2006,645.637296],[2007,645.637296],[2008,645.637296],[2009,645.637296],[2010,645.637296],[2011,645.637296],[2012,645.637296],[2013,645.637296],[2014,645.637296],[2015,645.637296],[2016,645.637296],[2017,645.637296],[2018,645.637296],[2019,645.637296],[2020,645.637296],[2021,645.637296],[2022,645.637296],[2023,645.637296],[2024,645.637296],[2025,645.637296],[2026,645.637296],[2027,645.637296],[2028,645.637296],[2029,645.637296],[2030,645.637296],[2031,645.637296],[2032,645.637296],[2033,645.637296],[2034,645.637296],[2035,645.637296],[2036,645.637296],[2037,645.637296],[2038,645.637296],[2039,645.637296],[2040,645.637296],[2041,645.637296],[2042,645.637296],[2043,645.637296],[2044,645.637296],[2045,645.637296],[2046,645.637296],[2047,645.637296],[2048,645.637296],[2049,645.637296],[2050,645.637296],[2051,645.637296],[2052,645.637296],[2053,645.637296],[2054,645.637296],[2055,645.637296],[2056,645.637296],[2057,645.637296],[2058,645.637296],[2059,645.637296],[2060,645.637296],[2061,645.637296],[2062,645.637296],[2063,645.637296],[2064,645.637296],[2065,645.637296],[2066,645.637296],[2067,645.637296],[2068,645.637296],[2069,645.637296],[2070,645.637296],[2071,645.637296],[2072,645.637296],[2073,645.637296],[2074,645.637296],[2075,645.637296],[2076,645.637296],[2077,645.637296],[2078,645.637296],[2079,645.637296],[2080,645.637296],[2081,645.637296],[2082,645.637296],[2083,645.637296],[2084,645.637296],[2085,645.637296],[2086,645.637296],[2087,645.637296],[2088,645.637296],[2089,645.637296],[2090,645.637296],[2091,645.637296],[2092,645.637296],[2093,645.637296],[2094,645.637296],[2095,645.637296],[2096,645.637296],[2097,645.637296],[2098,645.637296],[2099,645.637296],[2100,645.637296],[2101,645.636772],[2102,645.632229],[2103,645.620106],[2104,645.597314],[2105,645.561241],[2106,645.509749],[2107,645.441175],[2108,645.354332],[2109,645.248508],[2110,645.123464],[2111,644.979439],[2112,644.817144],[2113,644.637768],[2114,644.442973],[2115,644.234897],[2116,644.016152],[2117,643.789826],[2118,643.559483],[2119,643.328614],[2120,643.097746],[2121,642.866878],[2122,642.63601],[2123,642.405142],[2124,642.174274],[2125,641.943405],[2126,641.712537],[2127,641.481669],[2128,641.250801],[2129,641.019933],[2130,640.789064],[2131,640.558196],[2132,640.327328],[2133,640.09646],[2134,639.865592],[2135,639.634723],[2136,639.403855],[2137,639.172987],[2138,638.942119],[2139,638.711251],[2140,638.480382],[2141,638.249514],[2142,638.018646],[2143,637.787778],[2144,637.55691],[2145,637.326042],[2146,637.095173],[2147,636.864305],[2148,636.633437],[2149,636.402569],[2150,636.171701],[2151,635.940832],[2152,635.709964],[2153,635.479096],[2154,635.248228],[2155,635.01736],[2156,634.786491],[2157,634.555623],[2158,634.324755],[2159,634.093887],[2160,633.863019],[2161,633.63215],[2162,633.401282],[2163,633.170414],[2164,632.939546],[2165,632.708678],[2166,632.477809],[2167,632.246941],[2168,632.016073],[2169,631.785205],[2170,631.554337],[2171,631.323469],[2172,631.0926],[2173,630.861732],[2174,630.630864],[2175,630.399996],[2176,630.169128],[2177,629.938259],[2178,629.707391],[2179,629.476523],[2180,629.245655],[2181,629.014787],[2182,628.783918],[2183,628.55305],[2184,628.322182],[2185,628.091314],[2186,627.860446],[2187,627.629577],[2188,627.398709],[2189,627.167841],[2190,626.936973],[2191,626.706105],[2192,626.475237],[2193,626.244368],[2194,626.0135],[2195,625.782632],[2196,625.551764],[2197,625.320896],[2198,625.090027],[2199,624.859159],[2200,624.628291],[2201,624.397423],[2202,624.166555],[2203,623.935686],[2204,623.704818],[2205,623.47395],[2206,623.243082],[2207,623.012214],[2208,622.781345],[2209,622.550477],[2210,622.319609],[2211,622.088741],[2212,621.857873],[2213,621.627005],[2214,621.396136],[2215,621.165268],[2216,620.9344],[2217,620.703532],[2218,620.472664],[2219,620.241795],[2220,620.010927],[2221,619.780059],[2222,619.549191],[2223,619.318323],[2224,619.087454],[2225,618.856586],[2226,618.625718],[2227,618.39485],[2228,618.163982],[2229,617.933113],[2230,617.702245],[2231,617.471377],[2232,617.240509],[2233,617.009641],[2234,616.778772],[2235,616.547904],[2236,616.317036],[2237,616.086168],[2238,615.8553],[2239,615.624432],[2240,615.393563],[2241,615.162695],[2242,614.931827],[2243,614.700959],[2244,614.470091],[2245,614.239222],[2246,614.008354],[2247,613.777486],[2248,613.546618],[2249,613.31575],[2250,613.084881],[2251,612.854013],[2252,612.623145],[2253,612.392277],[2254,612.161409],[2255,611.93054],[2256,611.699672],[2257,611.468804],[2258,611.237936],[2259,611.007068],[2260,610.7762],[2261,610.545331],[2262,610.314463],[2263,610.083595],[2264,609.852727],[2265,609.621859],[2266,609.39099],[2267,609.160122],[2268,608.929254],[2269,608.698386],[2270,608.467518],[2271,608.236649],[2272,608.005781],[2273,607.774913],[2274,607.544045],[2275,607.313177],[2276,607.082308],[2277,606.85144],[2278,606.620572],[2279,606.389704],[2280,606.158836],[2281,605.927968],[2282,605.697099],[2283,605.466231],[2284,605.235363],[2285,605.004495],[2286,604.773627],[2287,604.542758],[2288,604.31189],[2289,604.081022],[2290,603.850154],[2291,603.619286],[2292,603.388417],[2293,603.157549],[2294,602.926681],[2295,602.695813],[2296,602.464945],[2297,602.234076],[2298,602.003208],[2299,601.77234],[2300,601.541472],[2301,601.310604],[2302,601.079735],[2303,600.848867],[2304,600.617999],[2305,600.387131],[2306,600.156263],[2307,599.925395],[2308,599.694526],[2309,599.463658],[2310,599.23279],[2311,599.001922],[2312,598.771054],[2313,598.540185],[2314,598.309317],[2315,598.078449],[2316,597.847581],[2317,597.616713],[2318,597.385844],[2319,597.154976],[2320,596.924108],[2321,596.69324],[2322,596.462372],[2323,596.231503],[2324,596.000635],[2325,595.769767],[2326,595.538899],[2327,595.308031],[2328,595.077163],[2329,594.846294],[2330,594.615426],[2331,594.384558],[2332,594.15369],[2333,593.923346],[2334,593.69702],[2335,593.478276],[2336,593.270199],[2337,593.075404],[2338,592.896028],[2339,592.733734],[2340,592.589708],[2341,592.464664],[2342,592.35884],[2343,592.271997],[2344,592.203424],[2345,592.151932],[2346,592.115858],[2347,592.093066],[2348,592.080943],[2349,592.076401],[2350,592.075876],[2351,592.075948],[2352,592.076423],[2353,592.077497],[2354,592.079114],[2355,592.080932],[2356,592.082359],[2357,592.082664],[2358,592.081136],[2359,592.077264],[2360,592.070916],[2361,592.062461],[2362,592.052819],[2363,592.043406],[2364,592.035982],[2365,592.032405],[2366,592.034324],[2367,592.04286],[2368,592.058313],[2369,592.079967],[2370,592.106019],[2371,592.133665],[2372,592.159359],[2373,592.179215],[2374,592.189518],[2375,592.187277],[2376,592.170753],[2377,592.139867],[2378,592.096441],[2379,592.044191],[2380,591.988475],[2381,591.935781],[2382,591.893012],[2383,591.866638],[2384,591.861816],[2385,591.881594],[2386,591.926303],[2387,591.993243],[2388,592.076724],[2389,592.168488],[2390,592.258489],[2391,592.335969],[2392,592.390708],[2393,592.41431],[2394,592.401368],[2395,592.350357],[2396,592.264116],[2397,592.149842],[2398,592.018552],[2399,591.884054],[2400,591.761508],[2401,591.665734],[2402,591.60945],[2403,591.601649],[2404,591.646312],[2405,591.741644],[2406,591.879935],[2407,592.048114],[2408,592.228954],[2409,592.402835],[2410,592.549868],[2411,592.652168],[2412,592.696002],[2413,592.673566],[2414,592.584159],[2415,592.434594],[2416,592.238765],[2417,592.016384],[2418,591.790989],[2419,591.587449],[2420,591.4292],[2421,591.335545],[2422,591.319319],[2423,591.385204],[2424,591.528906],[2425,591.73732],[2426,591.989703],[2427,592.259741],[2428,592.518316],[2429,592.736675],[2430,592.889648],[2431,592.958565],[2432,592.933518],[2433,592.814701],[2434,592.612662],[2435,592.34739],[2436,592.046327],[2437,591.741505],[2438,591.466098],[2439,591.250771],[2440,591.120236],[2441,591.090399],[2442,591.166426],[2443,591.341978],[2444,591.599702],[2445,591.912959],[2446,592.248606],[2447,592.570552],[2448,592.843681],[2449,593.03773],[2450,593.13068],[2451,593.111278],[2452,592.98039],[2453,592.751044],[2454,592.447117],[2455,592.100818],[2456,591.749233],[2457,591.430297],[2458,591.17865],[2459,591.021824],[2460,590.977196],[2461,591.050038],[2462,591.232892],[2463,591.506345],[2464,591.841117],[2465,592.201235],[2466,592.547957],[2467,592.84399],[2468,593.057558],[2469,593.165855],[2470,593.157517],[2471,593.033831],[2472,592.808549],[2473,592.506344],[2474,592.160076],[2475,591.807168],[2476,591.485514],[2477,591.229354],[2478,591.065581],[2479,591.01088],[2480,591.07001],[2481,591.235404],[2482,591.488124],[2483,591.800041],[2484,592.137006],[2485,592.462628],[2486,592.742254],[2487,592.946705],[2488,593.055354],[2489,593.058231],[2490,592.956921],[2491,592.764194],[2492,592.502413],[2493,592.20093],[2494,591.892761],[2495,591.610936],[2496,591.384917],[2497,591.237486],[2498,591.18243],[2499,591.223265],[2500,591.353106],[2501,591.555689],[2502,591.807375],[2503,592.079917],[2504,592.343657],[2505,592.570776],[2506,592.738257],[2507,592.83023],[2508,592.839467],[2509,592.767875],[2510,592.625984],[2511,592.4315],[2512,592.207125],[2513,591.977909],[2514,591.768441],[2515,591.600196],[2516,591.489324],[2517,591.445115],[2518,591.469282],[2519,591.556098],[2520,591.693357],[2521,591.863995],[2522,592.048181],[2523,592.225613],[2524,592.377753],[2525,592.489766],[2526,592.551949],[2527,592.560514],[2528,592.517687],[2529,592.431117],[2530,592.312736],[2531,592.177185],[2532,592.04005],[2533,591.91608],[2534,591.817617],[2535,591.75339],[2536,591.727792],[2537,591.740687],[2538,591.787749],[2539,591.861242],[2540,591.951139],[2541,592.046411],[2542,592.136345],[2543,592.211718],[2544,592.265718],[2545,592.294506],[2546,592.297394],[2547,592.276642],[2548,592.236932],[2549,592.184603],[2550,592.126757],[2551,592.070364],[2552,592.021466],[2553,591.984561],[2554,591.962246],[2555,591.95512],[2556,591.96194],[2557,591.97999],[2558,592.00559],[2559,592.034668],[2560,592.063319],[2561,592.088268],[2562,592.107203],[2563,592.118933],[2564,592.123381],[2565,592.121425],[2566,592.114629],[2567,592.104915],[2568,592.09423],[2569,592.084263],[2570,592.076235],[2571,592.070799],[2572,592.068045],[2573,592.067594],[2574,592.068764],[2575,592.070757],[2576,592.072842],[2577,592.074496],[2578,592.075481],[2579,592.075849],[2580,592.075876],[2581,592.076614],[2582,592.083007],[2583,592.10007],[2584,592.132146],[2585,592.182915],[2586,592.255384],[2587,592.351893],[2588,592.474114],[2589,592.62305],[2590,592.799034],[2591,593.001733],[2592,593.230143],[2593,593.482594],[2594,593.756745],[2595,594.049588],[2596,594.357445],[2597,594.675972],[2598,595.000153],[2599,595.325073],[2600,595.649993],[2601,595.974912],[2602,596.299832],[2603,596.624752],[2604,596.949671],[2605,597.274591],[2606,597.599511],[2607,597.924431],[2608,598.24935],[2609,598.57427],[2610,598.89919],[2611,599.224109],[2612,599.549029],[2613,599.873949],[2614,600.198868],[2615,600.523788],[2616,600.848708],[2617,601.173628],[2618,601.498547],[2619,601.823467],[2620,602.148387],[2621,602.473306],[2622,602.798226],[2623,603.123146],[2624,603.448065],[2625,603.772985],[2626,604.097905],[2627,604.422824],[2628,604.747744],[2629,605.072664],[2630,605.397584],[2631,605.722503],[2632,606.047423],[2633,606.372343],[2634,606.697262],[2635,607.022182],[2636,607.347102],[2637,607.672021],[2638,607.996941],[2639,608.321861],[2640,608.646781],[2641,608.9717],[2642,609.29662],[2643,609.62154],[2644,609.946459],[2645,610.271379],[2646,610.596299],[2647,610.921218],[2648,611.246138],[2649,611.571058],[2650,611.895978],[2651,612.220897],[2652,612.545817],[2653,612.870737],[2654,613.195656],[2655,613.520576],[2656,613.845496],[2657,614.170415],[2658,614.495335],[2659,614.820255],[2660,615.145174],[2661,615.470094],[2662,615.795014],[2663,616.119934],[2664,616.444853],[2665,616.769773],[2666,617.094693],[2667,617.419612],[2668,617.744532],[2669,618.069452],[2670,618.394371],[2671,618.719291],[2672,619.044211],[2673,619.369131],[2674,619.69405],[2675,620.01897],[2676,620.34389],[2677,620.668809],[2678,620.993729],[2679,621.318649],[2680,621.643568],[2681,621.968488],[2682,622.293408],[2683,622.618327],[2684,622.943247],[2685,623.268167],[2686,623.593087],[2687,623.918006],[2688,624.242926],[2689,624.567846],[2690,624.892765],[2691,625.217685],[2692,625.542605],[2693,625.867524],[2694,626.192444],[2695,626.517364],[2696,626.842284],[2697,627.167203],[2698,627.492123],[2699,627.817043],[2700,628.141962],[2701,628.466882],[2702,628.791802],[2703,629.116721],[2704,629.441641],[2705,629.766561],[2706,630.09148],[2707,630.4164],[2708,630.74132],[2709,631.06624],[2710,631.391159],[2711,631.716079],[2712,632.040999],[2713,632.365918],[2714,632.690838],[2715,633.015758],[2716,633.340677],[2717,633.665597],[2718,633.990517],[2719,634.315437],[2720,634.640356],[2721,634.965276],[2722,635.290196],[2723,635.615115],[2724,635.940035],[2725,636.264955],[2726,636.589874],[2727,636.914794],[2728,637.239714],[2729,637.564634],[2730,637.889553],[2731,638.214473],[2732,638.539393],[2733,638.864312],[2734,639.189232],[2735,639.514152],[2736,639.839071],[2737,640.163991],[2738,640.488911],[2739,640.81383],[2740,641.13875],[2741,641.46367],[2742,641.78859],[2743,642.113509],[2744,642.438429],[2745,642.763349],[2746,643.088268],[2747,643.413188],[2748,643.738108],[2749,644.063027],[2750,644.387947],[2751,644.712867],[2752,645.037787],[2753,645.362706],[2754,645.687626],[2755,646.012546],[2756,646.337465],[2757,646.662385],[2758,646.987305],[2759,647.312224],[2760,647.637144],[2761,647.962064],[2762,648.286983],[2763,648.611903],[2764,648.936823],[2765,649.261743],[2766,649.586662],[2767,649.911582],[2768,650.236502],[2769,650.561421],[2770,650.886341],[2771,651.211261],[2772,651.53618],[2773,651.8611],[2774,652.18602],[2775,652.51094],[2776,652.835859],[2777,653.160779],[2778,653.485699],[2779,653.810618],[2780,654.135538],[2781,654.460458],[2782,654.785377],[2783,655.110297],[2784,655.435217],[2785,655.760137],[2786,656.085056],[2787,656.409976],[2788,656.734896],[2789,657.059815],[2790,657.384735],[2791,657.709655],[2792,658.034574],[2793,658.359494],[2794,658.684414],[2795,659.009333],[2796,659.334253],[2797,659.659173],[2798,659.984093],[2799,660.309012],[2800,660.633932],[2801,660.958852],[2802,661.283771],[2803,661.608691],[2804,661.933611],[2805,662.25853],[2806,662.58345],[2807,662.90837],[2808,663.23329],[2809,663.558209],[2810,663.883129],[2811,664.208049],[2812,664.532968],[2813,664.85715],[2814,665.175676],[2815,665.483534],[2816,665.776377],[2817,666.050528],[2818,666.302978],[2819,666.531389],[2820,666.734088],[2821,666.910072],[2822,667.059007],[2823,667.181228],[2824,667.277737],[2825,667.350206],[2826,667.400975],[2827,667.433052],[2828,667.450114],[2829,667.456507],[2830,667.457246],[2831,667.457246],[2832,667.457246],[2833,667.457246],[2834,667.457246],[2835,667.457246],[2836,667.457246],[2837,667.457246],[2838,667.457246],[2839,667.457246],[2840,667.457246],[2841,667.457246],[2842,667.457246],[2843,667.457246],[2844,667.457246],[2845,667.457246],[2846,667.457246],[2847,667.457246],[2848,667.457246],[2849,667.457246],[2850,667.457246],[2851,667.457246],[2852,667.457246],[2853,667.457246],[2854,667.457246],[2855,667.457246],[2856,667.457246],[2857,667.457246],[2858,667.457246],[2859,667.457246],[2860,667.457246],[2861,667.457246],[2862,667.457246],[2863,667.457246],[2864,667.457246],[2865,667.457246],[2866,667.457246],[2867,667.457246],[2868,667.457246],[2869,667.457246],[2870,667.457246],[2871,667.457246],[2872,667.457246],[2873,667.457246],[2874,667.457246],[2875,667.457246],[2876,667.457246],[2877,667.457246],[2878,667.457246],[2879,667.457246],[2880,667.457246],[2881,667.457246],[2882,667.457246],[2883,667.457246],[2884,667.457246],[2885,667.457246],[2886,667.457246],[2887,667.457246],[2888,667.457246],[2889,667.457246],[2890,667.457246],[2891,667.457246],[2892,667.457246],[2893,667.457246],[2894,667.457246],[2895,667.457246],[2896,667.457246],[2897,667.457246],[2898,667.457246],[2899,667.457246],[2900,667.457246],[2901,667.457246],[2902,667.457246],[2903,667.457246],[2904,667.457246],[2905,667.457246],[2906,667.457246],[2907,667.457246],[2908,667.457246],[2909,667.457246],[2910,667.457246],[2911,667.457246],[2912,667.457246],[2913,667.457246],[2914,667.457246],[2915,667.457246],[2916,667.457246],[2917,667.457246],[2918,667.457246],[2919,667.457246],[2920,667.457246],[2921,667.457246],[2922,667.457246],[2923,667.457246],[2924,667.457246],[2925,667.457246],[2926,667.457246],[2927,667.457246],[2928,667.457246],[2929,667.457246],[2930,667.457246],[2931,667.457246],[2932,667.457246],[2933,667.457246],[2934,667.457246],[2935,667.457246],[2936,667.457246],[2937,667.457246],[2938,667.457246],[2939,667.457246],[2940,667.457246],[2941,667.457246],[2942,667.457246],[2943,667.457246],[2944,667.457246],[2945,667.457246],[2946,667.457246],[2947,667.457246],[2948,667.457246],[2949,667.457246],[2950,667.457246],[2951,667.457246],[2952,667.457246],[2953,667.457246],[2954,667.457246],[2955,667.457246],[2956,667.457246],[2957,667.457246],[2958,667.457246],[2959,667.457246],[2960,667.457246],[2961,667.457246],[2962,667.457246],[2963,667.457246],[2964,667.457246],[2965,667.457246],[2966,667.457246],[2967,667.457246],[2968,667.457246],[2969,667.457246],[2970,667.457246],[2971,667.457246],[2972,667.457246],[2973,667.457246],[2974,667.457246],[2975,667.457246],[2976,667.457246],[2977,667.457246],[2978,667.457246],[2979,667.457246],[2980,667.457246],[2981,667.457246],[2982,667.457246],[2983,667.457246],[2984,667.457246],[2985,667.457246],[2986,667.457246],[2987,667.457246],[2988,667.457246],[2989,667.457246],[2990,667.457246],[2991,667.457246],[2992,667.457246],[2993,667.457246],[2994,667.457246],[2995,667.457246],[2996,667.457246],[2997,667.457246],[2998,667.457246],[2999,667.457246],[3000,667.457246],[3080,667.4572455659437]],"linearTerrain":true,"surfaces":[],"gears":[18.76,30.65,45.01,59.29,72.95,88.09,102.81,114.5,129.54,144.25,158.73,171.48,187.47,199.84,214.2,228.8,241.14,254.91,269.85,283.68,297.85,310.94,327,340.74,354.25,368.12,381.64,396.61,410.85,425.41,436.55,451.23,466.78,479.69,494.63,509.05,521.91,536.69,550.55,565.36,578.73,593.44,606.61,620.12,634.77,647.26,662.77,675.92,690.16,703.79,717.38,730.86,747.33,760.62,774.22,786.5,801.5,815.13,830.73,844.41,856.77,873.24,885.38,899.09,914.08,929.1,942.45,954.73,969.36,985.21,999.35,1011.49,1027.4,1041.48,1053.65,1066.52,1082.02,1094.72,1110.73,1123.46,1139.27,1153.36,1164.8,1179.66,1193.96,1209.28,1221.16,1237.1,1251.42,1265.46,1277.05,1290.64,1306.32,1320.57,1333.1,1347.81,1363.45,1376.4,1389.43,1404.23,1418.29,1431.45,1445.76,1461.05,1473.17,1487.15,1502.68,1516.15,1530.55,1545.21,1556.97,1571.53,1587.45,1598.74,1612.52,1629.44,1642.67,1656.67,1669.11,1683.95,1699,1710.98,1725.35,1740.14,1754.96,1766.7,1782.96,1795.27,1810.79,1824.01,1839.13,1851.52,1867.27,1880.02,1894.91,1909.2,1921.83,1935.51,1948.84,1964.49,1977.15,1990.91,2004.94,2020.86,2035.27,2048.69,2063.48,2075.24,2090.69,2103.41,2118.36,2132.01,2145.98,2159.62,2173.54,2188.58,2200.84,2216.03,2229.14,2243.52,2257.95,2271.14,2284.59,2301.3,2315.29,2326.95,2340.68,2354.74,2369.42,2385.32,2398.48,2410.6,2426.45,2441.06,2452.74,2466.61,2481.64,2495.83,2510.72,2524.21,2536.73,2553.03,2566.55,2580.84,2592.97,2606.75,2622.91,2636.64,2650.69,2663.5,2678.85,2690.96,2706,2721.07,2733.36,2748.48,2763.5,2776.72,2790.59,2803.21,2819.3,2830.52,2844.88,2859.62,2875.5,2888.84,2901,2915.77,2930.65,2942.81,2959.33,2972.7,2986.45],"coinValues":[40,40,40,45,45,45,45,45,45,45,45,45,45,45,45,45,45,45,45,45,45,45,45,45,45,45,45,45,45,45,45,45,45,45,45,45,45,45,45,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70],"bridges":[],"checkpoints":[{"id":"long-haul-checkpoint-0","x":410,"reward":500},{"id":"long-haul-checkpoint-1","x":2000,"reward":500},{"id":"long-haul-checkpoint-2","x":2580,"reward":500}],"fuelValidation":{"state":"measured in complete recommended-profile simulation","targetRho":[0.8,0.92],"referenceProfile":{"engine":8,"suspension":7,"tires":7,"tank":8},"legs":[{"from":9,"to":150,"T_ref":7.95,"C_ref":72,"rho":0.1104,"fuelRemaining":64.05,"arrivalTick":477},{"from":150,"to":470,"T_ref":15.15,"C_ref":72,"rho":0.2104,"fuelRemaining":56.85,"arrivalTick":1386},{"from":470,"to":1810,"T_ref":59.9,"C_ref":72,"rho":0.8319,"fuelRemaining":12.1,"arrivalTick":4980},{"from":1810,"to":2600,"T_ref":38.0833,"C_ref":72,"rho":0.5289,"fuelRemaining":33.9167,"arrivalTick":7265},{"from":2600,"to":3009,"T_ref":17.4167,"C_ref":72,"rho":0.2419,"fuelRemaining":54.5833,"arrivalTick":8310,"finish":true}]},"streams":{"geometry":"geometry","coins":"coins","fuel":"fuel","decorations":"decorations","fuelMarker":0.2941384061705321},"decorationSeed":1261444275,"validation":{"state":"measured full-course attempts","sampleCount":1000,"source":"artifacts/pixel-drive-campaign-balance.json","notAnImpossibilityProof":true,"profiles":[{"name":"base","upgrades":{"engine":0,"suspension":0,"tires":0,"tank":0},"n":100,"wins":0,"distanceRange":[251.66,308.34],"failures":{"route_exit":87,"fuel":13}},{"name":"recommended","upgrades":{"engine":8,"suspension":7,"tires":7,"tank":8},"n":100,"wins":79,"distanceRange":[417.84,3000.51],"failures":{"overturned":11,"route_exit":10}},{"name":"maximum","upgrades":{"engine":10,"suspension":10,"tires":10,"tank":10},"n":100,"wins":88,"distanceRange":[426.67,3000.51],"failures":{"overturned":6,"route_exit":6}},{"name":"engine-only","upgrades":{"engine":10,"suspension":0,"tires":0,"tank":0},"n":100,"wins":0,"distanceRange":[426.85,1578.2],"failures":{"overturned":3,"route_exit":97}},{"name":"tank-only","upgrades":{"engine":0,"suspension":0,"tires":0,"tank":10},"n":100,"wins":0,"distanceRange":[251.66,308.34],"failures":{"fuel":83,"route_exit":17}},{"name":"strong-F0","upgrades":{"engine":10,"suspension":10,"tires":10,"tank":0},"n":100,"wins":0,"distanceRange":[426.67,1577.77],"failures":{"overturned":2,"route_exit":98}},{"name":"recommended-minus-engine","upgrades":{"engine":7,"suspension":7,"tires":7,"tank":8},"n":100,"wins":76,"distanceRange":[467.63,3000.49],"failures":{"overturned":12,"route_exit":12}},{"name":"recommended-minus-suspension","upgrades":{"engine":8,"suspension":6,"tires":7,"tank":8},"n":100,"wins":78,"distanceRange":[417.77,3000.44],"failures":{"overturned":10,"route_exit":12}},{"name":"recommended-minus-tires","upgrades":{"engine":8,"suspension":7,"tires":6,"tank":8},"n":100,"wins":81,"distanceRange":[417.87,3000.52],"failures":{"overturned":7,"route_exit":12}},{"name":"recommended-minus-tank","upgrades":{"engine":8,"suspension":7,"tires":7,"tank":7},"n":100,"wins":79,"distanceRange":[417.84,3000.51],"failures":{"overturned":9,"route_exit":12}}],"reference":{"upgrades":{"engine":8,"suspension":7,"tires":7,"tank":8},"targetSpeed":24,"holdTicks":12,"ticks":8310,"seconds":138.5,"inputChanges":95}}},{"id":7,"stageId":"mastery-summit","campaignIndex":6,"name":"Вершина майстерності","meters":4000,"recommended":{"engine":9,"suspension":9,"tires":9,"tank":9},"finishReward":4600,"description":"Збалансоване авто проходить тягові, слизькі, хвилясті й паливні випробування.","challenge":"Усі механіки","hint":"Не тримай газ постійно: готуй розгін, посадку й наступну заправку.","modules":[{"id":"mastery-summit-0","type":"intro","name":"Знайомий початок","from":0,"to":200,"geometry":{"firstVertex":1,"lastVertex":201,"heightChange":5.329070518200751e-15,"maximumSlopeDegrees":7.8646124977245675},"material":"dirt","entry":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.35,0.35],"angularSpeed":[-1.2,1.2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"exit":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.5,0.5],"angularSpeed":[-2,2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"recovery":{"from":200,"to":200},"pickups":{"coins":[0,1,2,3,4,5,6,7,8,9,10,11,12,13],"fuel":[0]},"validation":{"state":"measured within complete route, not isolated proof","source":"artifacts/pixel-drive-campaign-balance.json","reference":{"entry":{"x":9,"speed":0,"bodyAngle":0,"angularSpeed":0,"groundedWheels":2,"suspensionCompression":[0,0],"fuelSeconds":76,"tick":0},"exit":{"x":200.3076,"speed":23.9753,"bodyAngle":-0.003,"angularSpeed":0.0167,"groundedWheels":2,"suspensionCompression":[0.2395,0.2556],"fuelSeconds":75.1,"tick":598}},"profiles":[{"name":"base","n":100,"entered":100,"exited":100,"fullCourseWins":0,"entrySpeedRange":[0.1514,0.1515],"entryFuelRange":[39.9833,39.9833]},{"name":"recommended","n":100,"entered":100,"exited":100,"fullCourseWins":49,"entrySpeedRange":[0.15,0.1505],"entryFuelRange":[75.9833,75.9833]},{"name":"maximum","n":100,"entered":100,"exited":100,"fullCourseWins":54,"entrySpeedRange":[0.1499,0.1504],"entryFuelRange":[79.9833,79.9833]},{"name":"engine-only","n":100,"entered":100,"exited":100,"fullCourseWins":0,"entrySpeedRange":[0.1514,0.152],"entryFuelRange":[39.9833,39.9833]},{"name":"tank-only","n":100,"entered":100,"exited":100,"fullCourseWins":0,"entrySpeedRange":[0.1514,0.1515],"entryFuelRange":[79.9833,79.9833]},{"name":"strong-F0","n":100,"entered":100,"exited":100,"fullCourseWins":0,"entrySpeedRange":[0.1499,0.1504],"entryFuelRange":[39.9833,39.9833]},{"name":"recommended-minus-engine","n":100,"entered":100,"exited":100,"fullCourseWins":53,"entrySpeedRange":[0.15,0.1504],"entryFuelRange":[75.9833,75.9833]},{"name":"recommended-minus-suspension","n":100,"entered":100,"exited":100,"fullCourseWins":57,"entrySpeedRange":[0.1502,0.1506],"entryFuelRange":[75.9833,75.9833]},{"name":"recommended-minus-tires","n":100,"entered":100,"exited":100,"fullCourseWins":56,"entrySpeedRange":[0.15,0.1505],"entryFuelRange":[75.9833,75.9833]},{"name":"recommended-minus-tank","n":100,"entered":100,"exited":100,"fullCourseWins":47,"entrySpeedRange":[0.15,0.1505],"entryFuelRange":[71.9833,71.9833]}]}},{"id":"mastery-summit-1","type":"torque","name":"Контрольний підйом","from":200,"to":500,"geometry":{"firstVertex":201,"lastVertex":501,"heightChange":143.68617675742883,"maximumSlopeDegrees":27.00002504067548},"material":"dirt","entry":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.35,0.35],"angularSpeed":[-1.2,1.2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"exit":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.5,0.5],"angularSpeed":[-2,2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"recovery":{"from":500,"to":580},"pickups":{"coins":[14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34],"fuel":[]},"validation":{"state":"measured within complete route, not isolated proof","source":"artifacts/pixel-drive-campaign-balance.json","reference":{"entry":{"x":200.3076,"speed":23.9753,"bodyAngle":-0.003,"angularSpeed":0.0167,"groundedWheels":2,"suspensionCompression":[0.2395,0.2556],"fuelSeconds":75.1,"tick":598},"exit":{"x":500.1303,"speed":19.1345,"bodyAngle":0.0979,"angularSpeed":-0.1531,"groundedWheels":0,"suspensionCompression":[0.0107,-0.0069],"fuelSeconds":59.65,"tick":1525}},"profiles":[{"name":"base","n":100,"entered":100,"exited":0,"fullCourseWins":0,"entrySpeedRange":[14.3533,23.3735],"entryFuelRange":[38.4833,39.0667]},{"name":"recommended","n":100,"entered":100,"exited":99,"fullCourseWins":49,"entrySpeedRange":[14.5994,31.0577],"entryFuelRange":[74.4833,75.2833]},{"name":"maximum","n":100,"entered":100,"exited":99,"fullCourseWins":54,"entrySpeedRange":[14.4007,31.6985],"entryFuelRange":[78.5,79.3]},{"name":"engine-only","n":100,"entered":100,"exited":99,"fullCourseWins":0,"entrySpeedRange":[14.1705,31.686],"entryFuelRange":[38.4833,39.3167]},{"name":"tank-only","n":100,"entered":100,"exited":0,"fullCourseWins":0,"entrySpeedRange":[14.3533,23.3735],"entryFuelRange":[78.4833,79.0667]},{"name":"strong-F0","n":100,"entered":100,"exited":99,"fullCourseWins":0,"entrySpeedRange":[14.4007,31.6985],"entryFuelRange":[38.5,39.3]},{"name":"recommended-minus-engine","n":100,"entered":100,"exited":99,"fullCourseWins":53,"entrySpeedRange":[14.2077,30.4063],"entryFuelRange":[74.4833,75.2833]},{"name":"recommended-minus-suspension","n":100,"entered":100,"exited":99,"fullCourseWins":57,"entrySpeedRange":[14.6888,31.0392],"entryFuelRange":[74.5,75.2833]},{"name":"recommended-minus-tires","n":100,"entered":100,"exited":99,"fullCourseWins":56,"entrySpeedRange":[14.5504,31.0472],"entryFuelRange":[74.4667,75.2833]},{"name":"recommended-minus-tank","n":100,"entered":100,"exited":99,"fullCourseWins":47,"entrySpeedRange":[14.5994,31.0577],"entryFuelRange":[70.4833,71.2833]}]}},{"id":"mastery-summit-2","type":"recovery","name":"Відновлення","from":500,"to":580,"geometry":{"firstVertex":501,"lastVertex":581,"heightChange":0,"maximumSlopeDegrees":0},"material":"dirt","entry":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.35,0.35],"angularSpeed":[-1.2,1.2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"exit":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.5,0.5],"angularSpeed":[-2,2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"recovery":{"from":580,"to":580},"pickups":{"coins":[35,36,37,38,39,40],"fuel":[]},"validation":{"state":"measured within complete route, not isolated proof","source":"artifacts/pixel-drive-campaign-balance.json","reference":{"entry":{"x":500.1303,"speed":19.1345,"bodyAngle":0.0979,"angularSpeed":-0.1531,"groundedWheels":0,"suspensionCompression":[0.0107,-0.0069],"fuelSeconds":59.65,"tick":1525},"exit":{"x":580.1871,"speed":24.2745,"bodyAngle":0.0142,"angularSpeed":-0.0535,"groundedWheels":2,"suspensionCompression":[0.2737,0.2447],"fuelSeconds":56.0167,"tick":1743}},"profiles":[{"name":"base","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"recommended","n":100,"entered":99,"exited":98,"fullCourseWins":49,"entrySpeedRange":[14.3683,19.4781],"entryFuelRange":[52.2667,61]},{"name":"maximum","n":100,"entered":99,"exited":99,"fullCourseWins":54,"entrySpeedRange":[14.466,21.0338],"entryFuelRange":[56.4833,65.7667]},{"name":"engine-only","n":100,"entered":99,"exited":99,"fullCourseWins":0,"entrySpeedRange":[14.4443,21.06],"entryFuelRange":[16.4,26.0333]},{"name":"tank-only","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"strong-F0","n":100,"entered":99,"exited":99,"fullCourseWins":0,"entrySpeedRange":[14.466,21.0338],"entryFuelRange":[16.4833,25.7667]},{"name":"recommended-minus-engine","n":100,"entered":99,"exited":99,"fullCourseWins":53,"entrySpeedRange":[14.2432,17.8576],"entryFuelRange":[52.2833,60.0167]},{"name":"recommended-minus-suspension","n":100,"entered":99,"exited":99,"fullCourseWins":57,"entrySpeedRange":[14.4123,19.4937],"entryFuelRange":[52.3167,61.0333]},{"name":"recommended-minus-tires","n":100,"entered":99,"exited":99,"fullCourseWins":56,"entrySpeedRange":[14.1689,19.4506],"entryFuelRange":[52.2667,60.9667]},{"name":"recommended-minus-tank","n":100,"entered":99,"exited":98,"fullCourseWins":47,"entrySpeedRange":[14.3683,19.4781],"entryFuelRange":[48.2667,57]}]}},{"id":"mastery-summit-3","type":"snow-climb","name":"Сніговий підйом","from":580,"to":940,"geometry":{"firstVertex":581,"lastVertex":941,"heightChange":222.09739687354806,"maximumSlopeDegrees":33.00001639415408},"material":"snow","entry":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.35,0.35],"angularSpeed":[-1.2,1.2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"exit":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.5,0.5],"angularSpeed":[-2,2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"recovery":{"from":940,"to":1030},"pickups":{"coins":[41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65],"fuel":[1]},"validation":{"state":"measured within complete route, not isolated proof","source":"artifacts/pixel-drive-campaign-balance.json","reference":{"entry":{"x":580.1871,"speed":24.2745,"bodyAngle":0.0142,"angularSpeed":-0.0535,"groundedWheels":2,"suspensionCompression":[0.2737,0.2447],"fuelSeconds":56.0167,"tick":1743},"exit":{"x":940.166,"speed":12.0965,"bodyAngle":0.0863,"angularSpeed":0.0587,"groundedWheels":2,"suspensionCompression":[0.2756,0.0569],"fuelSeconds":52.5333,"tick":3683}},"profiles":[{"name":"base","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"recommended","n":100,"entered":98,"exited":98,"fullCourseWins":49,"entrySpeedRange":[14.1224,28.6479],"entryFuelRange":[46.7167,57.5333]},{"name":"maximum","n":100,"entered":99,"exited":99,"fullCourseWins":54,"entrySpeedRange":[14.246,29.2595],"entryFuelRange":[50.85,62.4]},{"name":"engine-only","n":100,"entered":99,"exited":0,"fullCourseWins":0,"entrySpeedRange":[14.1365,29.1984],"entryFuelRange":[10.8167,22.6167]},{"name":"tank-only","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"strong-F0","n":100,"entered":99,"exited":98,"fullCourseWins":0,"entrySpeedRange":[14.246,29.2595],"entryFuelRange":[10.85,22.4]},{"name":"recommended-minus-engine","n":100,"entered":99,"exited":90,"fullCourseWins":53,"entrySpeedRange":[14.3106,27.9194],"entryFuelRange":[46.8,56.4667]},{"name":"recommended-minus-suspension","n":100,"entered":99,"exited":99,"fullCourseWins":57,"entrySpeedRange":[14.2901,28.6479],"entryFuelRange":[46.6833,57.5667]},{"name":"recommended-minus-tires","n":100,"entered":99,"exited":99,"fullCourseWins":56,"entrySpeedRange":[14.2185,28.6814],"entryFuelRange":[46.6333,57.4333]},{"name":"recommended-minus-tank","n":100,"entered":98,"exited":98,"fullCourseWins":47,"entrySpeedRange":[14.1224,28.6479],"entryFuelRange":[42.7167,53.5333]}]}},{"id":"mastery-summit-4","type":"recovery","name":"Відновлення","from":940,"to":1030,"geometry":{"firstVertex":941,"lastVertex":1031,"heightChange":0,"maximumSlopeDegrees":0},"material":"dirt","entry":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.35,0.35],"angularSpeed":[-1.2,1.2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"exit":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.5,0.5],"angularSpeed":[-2,2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"recovery":{"from":1030,"to":1030},"pickups":{"coins":[66,67,68,69,70,71,72],"fuel":[]},"validation":{"state":"measured within complete route, not isolated proof","source":"artifacts/pixel-drive-campaign-balance.json","reference":{"entry":{"x":940.166,"speed":12.0965,"bodyAngle":0.0863,"angularSpeed":0.0587,"groundedWheels":2,"suspensionCompression":[0.2756,0.0569],"fuelSeconds":52.5333,"tick":3683},"exit":{"x":1030.2034,"speed":24.1209,"bodyAngle":-0.0019,"angularSpeed":0.0017,"groundedWheels":2,"suspensionCompression":[0.2544,0.2636],"fuelSeconds":48.2667,"tick":3939}},"profiles":[{"name":"base","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"recommended","n":100,"entered":98,"exited":98,"fullCourseWins":49,"entrySpeedRange":[10.3916,12.4238],"entryFuelRange":[44.9667,55.0833]},{"name":"maximum","n":100,"entered":99,"exited":99,"fullCourseWins":54,"entrySpeedRange":[12.376,13.7194],"entryFuelRange":[56.6,62.5167]},{"name":"engine-only","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"tank-only","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"strong-F0","n":100,"entered":98,"exited":98,"fullCourseWins":0,"entrySpeedRange":[12.3596,13.7194],"entryFuelRange":[4.45,22.5167]},{"name":"recommended-minus-engine","n":100,"entered":90,"exited":90,"fullCourseWins":53,"entrySpeedRange":[9.4885,10.5748],"entryFuelRange":[15.3333,47.35]},{"name":"recommended-minus-suspension","n":100,"entered":99,"exited":99,"fullCourseWins":57,"entrySpeedRange":[10.4433,12.5237],"entryFuelRange":[45.9333,55.3833]},{"name":"recommended-minus-tires","n":100,"entered":99,"exited":99,"fullCourseWins":56,"entrySpeedRange":[10.7312,12.2125],"entryFuelRange":[43.7,54.6333]},{"name":"recommended-minus-tank","n":100,"entered":98,"exited":98,"fullCourseWins":47,"entrySpeedRange":[10.3916,12.4238],"entryFuelRange":[40.9667,51.0833]}]}},{"id":"mastery-summit-5","type":"rollers","name":"Хвиляста ділянка","from":1030,"to":1230,"geometry":{"firstVertex":1031,"lastVertex":1231,"heightChange":2.8421709430404007e-13,"maximumSlopeDegrees":27.39535875117699},"material":"dirt","entry":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.35,0.35],"angularSpeed":[-1.2,1.2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"exit":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.5,0.5],"angularSpeed":[-2,2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"recovery":{"from":1230,"to":1310},"pickups":{"coins":[73,74,75,76,77,78,79,80,81,82,83,84,85,86],"fuel":[]},"validation":{"state":"measured within complete route, not isolated proof","source":"artifacts/pixel-drive-campaign-balance.json","reference":{"entry":{"x":1030.2034,"speed":24.1209,"bodyAngle":-0.0019,"angularSpeed":0.0017,"groundedWheels":2,"suspensionCompression":[0.2544,0.2636],"fuelSeconds":48.2667,"tick":3939},"exit":{"x":1230.2693,"speed":21.6852,"bodyAngle":0.0935,"angularSpeed":-0.0482,"groundedWheels":2,"suspensionCompression":[0.3682,0.1265],"fuelSeconds":33.9833,"tick":4796}},"profiles":[{"name":"base","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"recommended","n":100,"entered":98,"exited":80,"fullCourseWins":49,"entrySpeedRange":[14.3592,28.9488],"entryFuelRange":[38.6833,51]},{"name":"maximum","n":100,"entered":99,"exited":75,"fullCourseWins":54,"entrySpeedRange":[13.4273,29.9773],"entryFuelRange":[50.35,58.6]},{"name":"engine-only","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"tank-only","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"strong-F0","n":100,"entered":98,"exited":72,"fullCourseWins":0,"entrySpeedRange":[13.8802,29.9773],"entryFuelRange":[0,18.6]},{"name":"recommended-minus-engine","n":100,"entered":90,"exited":65,"fullCourseWins":53,"entrySpeedRange":[18.6185,27.8247],"entryFuelRange":[10.1,42.9833]},{"name":"recommended-minus-suspension","n":100,"entered":99,"exited":80,"fullCourseWins":57,"entrySpeedRange":[14.4646,28.9613],"entryFuelRange":[39.8667,51.3167]},{"name":"recommended-minus-tires","n":100,"entered":99,"exited":76,"fullCourseWins":56,"entrySpeedRange":[14.3999,28.9242],"entryFuelRange":[37.5167,50.5333]},{"name":"recommended-minus-tank","n":100,"entered":98,"exited":80,"fullCourseWins":47,"entrySpeedRange":[14.3592,28.9488],"entryFuelRange":[34.6833,47]}]}},{"id":"mastery-summit-6","type":"recovery","name":"Відновлення","from":1230,"to":1310,"geometry":{"firstVertex":1231,"lastVertex":1311,"heightChange":0,"maximumSlopeDegrees":0},"material":"dirt","entry":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.35,0.35],"angularSpeed":[-1.2,1.2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"exit":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.5,0.5],"angularSpeed":[-2,2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"recovery":{"from":1310,"to":1310},"pickups":{"coins":[87,88,89,90,91,92],"fuel":[2]},"validation":{"state":"measured within complete route, not isolated proof","source":"artifacts/pixel-drive-campaign-balance.json","reference":{"entry":{"x":1230.2693,"speed":21.6852,"bodyAngle":0.0935,"angularSpeed":-0.0482,"groundedWheels":2,"suspensionCompression":[0.3682,0.1265],"fuelSeconds":33.9833,"tick":4796},"exit":{"x":1310.38,"speed":24.3022,"bodyAngle":0.0235,"angularSpeed":0.031,"groundedWheels":2,"suspensionCompression":[0.2843,0.2309],"fuelSeconds":74.2667,"tick":4997}},"profiles":[{"name":"base","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"recommended","n":100,"entered":80,"exited":80,"fullCourseWins":49,"entrySpeedRange":[14.6085,22.1103],"entryFuelRange":[20.6333,39.3167]},{"name":"maximum","n":100,"entered":75,"exited":75,"fullCourseWins":54,"entrySpeedRange":[14.3266,22.6407],"entryFuelRange":[32.85,48.0667]},{"name":"engine-only","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"tank-only","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"strong-F0","n":100,"entered":72,"exited":71,"fullCourseWins":0,"entrySpeedRange":[1.78,22.6407],"entryFuelRange":[0,8.0667]},{"name":"recommended-minus-engine","n":100,"entered":65,"exited":65,"fullCourseWins":53,"entrySpeedRange":[7.3404,21.7143],"entryFuelRange":[0,30.7]},{"name":"recommended-minus-suspension","n":100,"entered":80,"exited":80,"fullCourseWins":57,"entrySpeedRange":[14.2636,22.2791],"entryFuelRange":[22.1,38.9667]},{"name":"recommended-minus-tires","n":100,"entered":76,"exited":76,"fullCourseWins":56,"entrySpeedRange":[14.5291,22.1607],"entryFuelRange":[19.3333,38.45]},{"name":"recommended-minus-tank","n":100,"entered":80,"exited":80,"fullCourseWins":47,"entrySpeedRange":[14.6085,22.1103],"entryFuelRange":[16.6333,35.3167]}]}},{"id":"mastery-summit-7","type":"fuel-climb","name":"Перегін без заправки","from":1310,"to":2910,"geometry":{"firstVertex":1311,"lastVertex":2911,"heightChange":639.1694892712608,"maximumSlopeDegrees":22.000038131834994},"material":"dirt","entry":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.35,0.35],"angularSpeed":[-1.2,1.2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"exit":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.5,0.5],"angularSpeed":[-2,2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"recovery":{"from":2910,"to":3000},"pickups":{"coins":[93,94,95,96,97,98,99,100,101,102,103,104,105,106,107,108,109,110,111,112,113,114,115,116,117,118,119,120,121,122,123,124,125,126,127,128,129,130,131,132,133,134,135,136,137,138,139,140,141,142,143,144,145,146,147,148,149,150,151,152,153,154,155,156,157,158,159,160,161,162,163,164,165,166,167,168,169,170,171,172,173,174,175,176,177,178,179,180,181,182,183,184,185,186,187,188,189,190,191,192,193,194,195,196,197,198,199,200,201,202,203,204,205,206],"fuel":[3]},"validation":{"state":"measured within complete route, not isolated proof","source":"artifacts/pixel-drive-campaign-balance.json","reference":{"entry":{"x":1310.38,"speed":24.3022,"bodyAngle":0.0235,"angularSpeed":0.031,"groundedWheels":2,"suspensionCompression":[0.2843,0.2309],"fuelSeconds":74.2667,"tick":4997},"exit":{"x":2910.0841,"speed":22.7496,"bodyAngle":0.2111,"angularSpeed":-1.0711,"groundedWheels":0,"suspensionCompression":[0.0053,0.0098],"fuelSeconds":68.8,"tick":9287}},"profiles":[{"name":"base","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"recommended","n":100,"entered":80,"exited":67,"fullCourseWins":49,"entrySpeedRange":[14.1783,30.4352],"entryFuelRange":[73.0833,74.5667]},{"name":"maximum","n":100,"entered":75,"exited":65,"fullCourseWins":54,"entrySpeedRange":[14.3678,31.2655],"entryFuelRange":[77.0333,78.6]},{"name":"engine-only","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"tank-only","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"strong-F0","n":100,"entered":71,"exited":0,"fullCourseWins":0,"entrySpeedRange":[14.7421,31.2655],"entryFuelRange":[36.7667,38.6]},{"name":"recommended-minus-engine","n":100,"entered":65,"exited":62,"fullCourseWins":53,"entrySpeedRange":[18.6477,29.5251],"entryFuelRange":[73.0167,74.5167]},{"name":"recommended-minus-suspension","n":100,"entered":80,"exited":68,"fullCourseWins":57,"entrySpeedRange":[13.361,30.5091],"entryFuelRange":[73.0833,74.5667]},{"name":"recommended-minus-tires","n":100,"entered":76,"exited":63,"fullCourseWins":56,"entrySpeedRange":[14.1119,30.391],"entryFuelRange":[73.0833,74.5667]},{"name":"recommended-minus-tank","n":100,"entered":80,"exited":66,"fullCourseWins":47,"entrySpeedRange":[14.1783,30.4352],"entryFuelRange":[69.0833,70.5667]}]}},{"id":"mastery-summit-8","type":"recovery","name":"Відновлення","from":2910,"to":3000,"geometry":{"firstVertex":2911,"lastVertex":3001,"heightChange":0,"maximumSlopeDegrees":0},"material":"dirt","entry":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.35,0.35],"angularSpeed":[-1.2,1.2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"exit":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.5,0.5],"angularSpeed":[-2,2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"recovery":{"from":3000,"to":3000},"pickups":{"coins":[207,208,209,210,211,212],"fuel":[]},"validation":{"state":"measured within complete route, not isolated proof","source":"artifacts/pixel-drive-campaign-balance.json","reference":{"entry":{"x":2910.0841,"speed":22.7496,"bodyAngle":0.2111,"angularSpeed":-1.0711,"groundedWheels":0,"suspensionCompression":[0.0053,0.0098],"fuelSeconds":68.8,"tick":9287},"exit":{"x":3000.114,"speed":24.0624,"bodyAngle":-0.0043,"angularSpeed":-0.0087,"groundedWheels":2,"suspensionCompression":[0.2538,0.2615],"fuelSeconds":65,"tick":9515}},"profiles":[{"name":"base","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"recommended","n":100,"entered":67,"exited":67,"fullCourseWins":49,"entrySpeedRange":[18.6071,22.7539],"entryFuelRange":[67.8,68.8]},{"name":"maximum","n":100,"entered":65,"exited":65,"fullCourseWins":54,"entrySpeedRange":[17.5889,24.1954],"entryFuelRange":[71.2833,73.2167]},{"name":"engine-only","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"tank-only","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"strong-F0","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"recommended-minus-engine","n":100,"entered":62,"exited":62,"fullCourseWins":53,"entrySpeedRange":[16.222,21.2303],"entryFuelRange":[67.7667,68.2833]},{"name":"recommended-minus-suspension","n":100,"entered":68,"exited":68,"fullCourseWins":57,"entrySpeedRange":[18.4156,22.7567],"entryFuelRange":[67.7833,68.8]},{"name":"recommended-minus-tires","n":100,"entered":63,"exited":63,"fullCourseWins":56,"entrySpeedRange":[18.2242,22.7554],"entryFuelRange":[67.8,68.8]},{"name":"recommended-minus-tank","n":100,"entered":66,"exited":66,"fullCourseWins":47,"entrySpeedRange":[18.6071,22.7539],"entryFuelRange":[60.1,64.8]}]}},{"id":"mastery-summit-9","type":"climb","name":"Плавний схил","from":3000,"to":3270,"geometry":{"firstVertex":3001,"lastVertex":3271,"heightChange":-72.25983721120929,"maximumSlopeDegrees":16.00003251957412},"material":"dirt","entry":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.35,0.35],"angularSpeed":[-1.2,1.2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"exit":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.5,0.5],"angularSpeed":[-2,2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"recovery":{"from":3270,"to":3270},"pickups":{"coins":[213,214,215,216,217,218,219,220,221,222,223,224,225,226,227,228,229,230,231,232],"fuel":[]},"validation":{"state":"measured within complete route, not isolated proof","source":"artifacts/pixel-drive-campaign-balance.json","reference":{"entry":{"x":3000.114,"speed":24.0624,"bodyAngle":-0.0043,"angularSpeed":-0.0087,"groundedWheels":2,"suspensionCompression":[0.2538,0.2615],"fuelSeconds":65,"tick":9515},"exit":{"x":3270.0837,"speed":23.9429,"bodyAngle":-0.0251,"angularSpeed":-0.0132,"groundedWheels":2,"suspensionCompression":[0.5516,0.6289],"fuelSeconds":54.0333,"tick":10173}},"profiles":[{"name":"base","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"recommended","n":100,"entered":67,"exited":67,"fullCourseWins":49,"entrySpeedRange":[20.0572,30.1469],"entryFuelRange":[63.3667,65.3167]},{"name":"maximum","n":100,"entered":65,"exited":65,"fullCourseWins":54,"entrySpeedRange":[19.4201,30.8003],"entryFuelRange":[66.5833,69.8333]},{"name":"engine-only","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"tank-only","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"strong-F0","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"recommended-minus-engine","n":100,"entered":62,"exited":62,"fullCourseWins":53,"entrySpeedRange":[20.3234,29.2648],"entryFuelRange":[63.35,64.6667]},{"name":"recommended-minus-suspension","n":100,"entered":68,"exited":68,"fullCourseWins":57,"entrySpeedRange":[20.2955,30.1687],"entryFuelRange":[63.35,65.3167]},{"name":"recommended-minus-tires","n":100,"entered":63,"exited":63,"fullCourseWins":56,"entrySpeedRange":[20.151,30.161],"entryFuelRange":[63.3667,65.3167]},{"name":"recommended-minus-tank","n":100,"entered":66,"exited":66,"fullCourseWins":47,"entrySpeedRange":[20.8435,30.1469],"entryFuelRange":[55.7,61.3167]}]}},{"id":"mastery-summit-10","type":"jump","name":"Трамплін і посадка","from":3270,"to":3335,"geometry":{"firstVertex":3271,"lastVertex":3336,"heightChange":0,"maximumSlopeDegrees":8.247805878718848},"material":"dirt","entry":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.35,0.35],"angularSpeed":[-1.2,1.2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"exit":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.5,0.5],"angularSpeed":[-2,2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"recovery":{"from":3335,"to":3400},"pickups":{"coins":[233,234,235,236],"fuel":[]},"validation":{"state":"measured within complete route, not isolated proof","source":"artifacts/pixel-drive-campaign-balance.json","reference":{"entry":{"x":3270.0837,"speed":23.9429,"bodyAngle":-0.0251,"angularSpeed":-0.0132,"groundedWheels":2,"suspensionCompression":[0.5516,0.6289],"fuelSeconds":54.0333,"tick":10173},"exit":{"x":3335.0281,"speed":24.9132,"bodyAngle":-0.0152,"angularSpeed":0.3406,"groundedWheels":2,"suspensionCompression":[0.4432,0.4704],"fuelSeconds":51.35,"tick":10334}},"profiles":[{"name":"base","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"recommended","n":100,"entered":67,"exited":67,"fullCourseWins":49,"entrySpeedRange":[20.112,37.7151],"entryFuelRange":[50.3833,57.5]},{"name":"maximum","n":100,"entered":65,"exited":65,"fullCourseWins":54,"entrySpeedRange":[19.0616,37.0915],"entryFuelRange":[52.7833,62.1333]},{"name":"engine-only","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"tank-only","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"strong-F0","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"recommended-minus-engine","n":100,"entered":62,"exited":62,"fullCourseWins":53,"entrySpeedRange":[19.6736,37.536],"entryFuelRange":[50.35,56.7833]},{"name":"recommended-minus-suspension","n":100,"entered":68,"exited":68,"fullCourseWins":57,"entrySpeedRange":[20.4477,36.578],"entryFuelRange":[50.3667,57.4833]},{"name":"recommended-minus-tires","n":100,"entered":63,"exited":63,"fullCourseWins":56,"entrySpeedRange":[20.5044,37.8473],"entryFuelRange":[50.35,57.5833]},{"name":"recommended-minus-tank","n":100,"entered":66,"exited":66,"fullCourseWins":47,"entrySpeedRange":[20.4286,37.7151],"entryFuelRange":[42.8333,53.5]}]}},{"id":"mastery-summit-11","type":"recovery","name":"Відновлення","from":3335,"to":3400,"geometry":{"firstVertex":3336,"lastVertex":3401,"heightChange":0,"maximumSlopeDegrees":0},"material":"dirt","entry":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.35,0.35],"angularSpeed":[-1.2,1.2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"exit":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.5,0.5],"angularSpeed":[-2,2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"recovery":{"from":3400,"to":3400},"pickups":{"coins":[237,238,239,240,241],"fuel":[]},"validation":{"state":"measured within complete route, not isolated proof","source":"artifacts/pixel-drive-campaign-balance.json","reference":{"entry":{"x":3335.0281,"speed":24.9132,"bodyAngle":-0.0152,"angularSpeed":0.3406,"groundedWheels":2,"suspensionCompression":[0.4432,0.4704],"fuelSeconds":51.35,"tick":10334},"exit":{"x":3400.2895,"speed":24.029,"bodyAngle":-0.0035,"angularSpeed":0.0007,"groundedWheels":2,"suspensionCompression":[0.2542,0.2637],"fuelSeconds":48.6833,"tick":10494}},"profiles":[{"name":"base","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"recommended","n":100,"entered":67,"exited":67,"fullCourseWins":49,"entrySpeedRange":[19.6757,36.2041],"entryFuelRange":[47.2,55.6667]},{"name":"maximum","n":100,"entered":65,"exited":65,"fullCourseWins":54,"entrySpeedRange":[19.0638,35.7723],"entryFuelRange":[49.3833,60.3167]},{"name":"engine-only","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"tank-only","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"strong-F0","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"recommended-minus-engine","n":100,"entered":62,"exited":62,"fullCourseWins":53,"entrySpeedRange":[19.7235,36.044],"entryFuelRange":[47.1667,54.9833]},{"name":"recommended-minus-suspension","n":100,"entered":68,"exited":68,"fullCourseWins":57,"entrySpeedRange":[19.9022,35.2091],"entryFuelRange":[47.1667,55.6333]},{"name":"recommended-minus-tires","n":100,"entered":63,"exited":63,"fullCourseWins":56,"entrySpeedRange":[20.0354,36.3386],"entryFuelRange":[47.15,55.7667]},{"name":"recommended-minus-tank","n":100,"entered":66,"exited":66,"fullCourseWins":47,"entrySpeedRange":[20.3933,36.2041],"entryFuelRange":[39.6667,51.6667]}]}},{"id":"mastery-summit-12","type":"rollers","name":"Хвиляста ділянка","from":3400,"to":3700,"geometry":{"firstVertex":3401,"lastVertex":3701,"heightChange":-4.547473508864641e-13,"maximumSlopeDegrees":24.33576500708911},"material":"dirt","entry":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.35,0.35],"angularSpeed":[-1.2,1.2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"exit":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.5,0.5],"angularSpeed":[-2,2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"recovery":{"from":3700,"to":4000},"pickups":{"coins":[242,243,244,245,246,247,248,249,250,251,252,253,254,255,256,257,258,259,260,261,262],"fuel":[4]},"validation":{"state":"measured within complete route, not isolated proof","source":"artifacts/pixel-drive-campaign-balance.json","reference":{"entry":{"x":3400.2895,"speed":24.029,"bodyAngle":-0.0035,"angularSpeed":0.0007,"groundedWheels":2,"suspensionCompression":[0.2542,0.2637],"fuelSeconds":48.6833,"tick":10494},"exit":{"x":3700.0375,"speed":24.2427,"bodyAngle":0.0735,"angularSpeed":-0.1621,"groundedWheels":2,"suspensionCompression":[0.3414,0.15],"fuelSeconds":64.9333,"tick":11715}},"profiles":[{"name":"base","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"recommended","n":100,"entered":67,"exited":49,"fullCourseWins":49,"entrySpeedRange":[20.0774,34.2344],"entryFuelRange":[44,53.7]},{"name":"maximum","n":100,"entered":65,"exited":54,"fullCourseWins":54,"entrySpeedRange":[19.1426,35.2214],"entryFuelRange":[46,58.45]},{"name":"engine-only","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"tank-only","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"strong-F0","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"recommended-minus-engine","n":100,"entered":62,"exited":53,"fullCourseWins":53,"entrySpeedRange":[20.1863,34.0631],"entryFuelRange":[44,53.0833]},{"name":"recommended-minus-suspension","n":100,"entered":68,"exited":57,"fullCourseWins":57,"entrySpeedRange":[20.3894,34.038],"entryFuelRange":[43.9667,53.7167]},{"name":"recommended-minus-tires","n":100,"entered":63,"exited":56,"fullCourseWins":56,"entrySpeedRange":[20.1318,34.6239],"entryFuelRange":[43.95,53.8833]},{"name":"recommended-minus-tank","n":100,"entered":66,"exited":47,"fullCourseWins":47,"entrySpeedRange":[20.4033,34.2344],"entryFuelRange":[36.55,49.7]}]}},{"id":"mastery-summit-13","type":"recovery","name":"Відновлення","from":3700,"to":4000,"geometry":{"firstVertex":3701,"lastVertex":4001,"heightChange":0,"maximumSlopeDegrees":0},"material":"dirt","entry":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.35,0.35],"angularSpeed":[-1.2,1.2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"exit":{"speed":[0,40],"bodyAngleRelativeToSurface":[-0.5,0.5],"angularSpeed":[-2,2],"suspensionCompression":[-0.1,0.74],"fuelSeconds":[0,80]},"recovery":{"from":4000,"to":4000},"pickups":{"coins":[263,264,265,266,267,268,269,270,271,272,273,274,275,276,277,278,279,280,281,282,283,284],"fuel":[]},"validation":{"state":"measured within complete route, not isolated proof","source":"artifacts/pixel-drive-campaign-balance.json","reference":{"entry":{"x":3700.0375,"speed":24.2427,"bodyAngle":0.0735,"angularSpeed":-0.1621,"groundedWheels":2,"suspensionCompression":[0.3414,0.15],"fuelSeconds":64.9333,"tick":11715},"exit":{"x":4000.3653,"speed":24.2201,"bodyAngle":-0.0004,"angularSpeed":-0.0342,"groundedWheels":2,"suspensionCompression":[0.2576,0.2586],"fuelSeconds":52.5,"tick":12461}},"profiles":[{"name":"base","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"recommended","n":100,"entered":49,"exited":49,"fullCourseWins":49,"entrySpeedRange":[20.4521,25.0735],"entryFuelRange":[26.2167,65.6833]},{"name":"maximum","n":100,"entered":54,"exited":54,"fullCourseWins":54,"entrySpeedRange":[19.0038,25.7863],"entryFuelRange":[27.3833,69.8833]},{"name":"engine-only","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"tank-only","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"strong-F0","n":100,"entered":0,"exited":0,"fullCourseWins":0,"entrySpeedRange":null,"entryFuelRange":null},{"name":"recommended-minus-engine","n":100,"entered":53,"exited":53,"fullCourseWins":53,"entrySpeedRange":[20.4434,24.6791],"entryFuelRange":[26.4,65.6667]},{"name":"recommended-minus-suspension","n":100,"entered":57,"exited":57,"fullCourseWins":57,"entrySpeedRange":[20.524,25.0828],"entryFuelRange":[22.7,65.6167]},{"name":"recommended-minus-tires","n":100,"entered":56,"exited":56,"fullCourseWins":56,"entrySpeedRange":[20.4378,25.2041],"entryFuelRange":[29.1333,65.6167]},{"name":"recommended-minus-tank","n":100,"entered":47,"exited":47,"fullCourseWins":47,"entrySpeedRange":[20.8811,25.0735],"entryFuelRange":[18.25,61.6833]}]}}],"fuel":[180,720,1270,2750,3560],"seed":1940544799,"generatorVersion":3,"length":4000,"max_ticks":36000,"terrain":[[-100,12],[0,12],[1,12.000072],[2,12.000434],[3,12.00126],[4,12.002695],[5,12.004848],[6,12.007778],[7,12.011497],[8,12.01596],[9,12.021065],[10,12.026654],[11,12.032516],[12,12.038393],[13,12.043984],[14,12.048957],[15,12.052957],[16,12.055622],[17,12.05659],[18,12.05552],[19,12.0521],[20,12.046062],[21,12.037199],[22,12.02537],[23,12.010519],[24,11.992674],[25,11.971962],[26,11.948609],[27,11.922939],[28,11.895378],[29,11.866444],[30,11.836743],[31,11.806955],[32,11.777824],[33,11.750141],[34,11.724727],[35,11.702411],[36,11.684012],[37,11.670317],[38,11.662055],[39,11.659882],[40,11.664354],[41,11.675911],[42,11.694859],[43,11.721353],[44,11.75539],[45,11.796794],[46,11.845215],[47,11.900127],[48,11.960832],[49,12.026464],[50,12.096006],[51,12.168301],[52,12.242073],[53,12.315951],[54,12.388491],[55,12.45821],[56,12.523612],[57,12.583221],[58,12.635615],[59,12.679455],[60,12.713522],[61,12.736739],[62,12.748207],[63,12.747225],[64,12.733309],[65,12.706218],[66,12.665956],[67,12.612787],[68,12.547232],[69,12.470071],[70,12.382329],[71,12.285266],[72,12.180355],[73,12.069258],[74,11.953802],[75,11.835937],[76,11.717709],[77,11.601217],[78,11.488573],[79,11.381863],[80,11.2831],[81,11.194191],[82,11.116891],[83,11.052771],[84,11.00318],[85,10.969223],[86,10.951726],[87,10.951227],[88,10.967954],[89,11.001822],[90,11.05243],[91,11.119065],[92,11.200715],[93,11.296083],[94,11.403615],[95,11.521523],[96,11.647819],[97,11.780356],[98,11.916864],[99,12.054996],[100,12.192369],[101,12.326614],[102,12.455418],[103,12.576569],[104,12.687998],[105,12.787817],[106,12.874357],[107,12.946197],[108,13.002191],[109,13.041485],[110,13.063538],[111,13.068125],[112,13.05534],[113,13.025592],[114,12.979595],[115,12.918349],[116,12.843121],[117,12.755416],[118,12.656943],[119,12.549585],[120,12.435355],[121,12.316359],[122,12.194753],[123,12.072698],[124,11.952324],[125,11.835685],[126,11.72472],[127,11.621224],[128,11.526809],[129,11.442879],[130,11.370609],[131,11.310926],[132,11.264498],[133,11.231724],[134,11.212739],[135,11.207413],[136,11.215362],[137,11.235966],[138,11.268384],[139,11.311582],[140,11.364356],[141,11.425362],[142,11.493151],[143,11.566199],[144,11.642941],[145,11.721804],[146,11.801242],[147,11.879765],[148,11.955967],[149,12.028554],[150,12.096363],[151,12.158385],[152,12.213779],[153,12.261878],[154,12.302202],[155,12.334454],[156,12.358524],[157,12.374474],[158,12.382536],[159,12.383094],[160,12.37667],[161,12.363902],[162,12.345526],[163,12.322352],[164,12.295242],[165,12.265088],[166,12.232786],[167,12.199219],[168,12.165231],[169,12.131614],[170,12.099088],[171,12.068292],[172,12.039769],[173,12.013958],[174,11.991196],[175,11.97171],[176,11.95562],[177,11.942947],[178,11.933614],[179,11.92746],[180,11.924251],[181,11.92369],[182,11.92543],[183,11.929095],[184,11.934286],[185,11.940601],[186,11.947648],[187,11.955056],[188,11.962486],[189,11.969642],[190,11.97628],[191,11.982208],[192,11.987295],[193,11.991469],[194,11.994716],[195,11.997076],[196,11.998639],[197,11.999537],[198,11.999935],[199,12.000022],[200,12],[201,12.001158],[202,12.011183],[203,12.037939],[204,12.088241],[205,12.167854],[206,12.281497],[207,12.432839],[208,12.624501],[209,12.858055],[210,13.134026],[211,13.45189],[212,13.810073],[213,14.205956],[214,14.635868],[215,15.095092],[216,15.577861],[217,16.077361],[218,16.585729],[219,17.095254],[220,17.60478],[221,18.114305],[222,18.623831],[223,19.133356],[224,19.642882],[225,20.152407],[226,20.661933],[227,21.171458],[228,21.680984],[229,22.190509],[230,22.700034],[231,23.20956],[232,23.719085],[233,24.228611],[234,24.738136],[235,25.247662],[236,25.757187],[237,26.266713],[238,26.776238],[239,27.285763],[240,27.795289],[241,28.304814],[242,28.81434],[243,29.323865],[244,29.833391],[245,30.342916],[246,30.852442],[247,31.361967],[248,31.871493],[249,32.381018],[250,32.890543],[251,33.400069],[252,33.909594],[253,34.41912],[254,34.928645],[255,35.438171],[256,35.947696],[257,36.457222],[258,36.966747],[259,37.476272],[260,37.985798],[261,38.495323],[262,39.004849],[263,39.514374],[264,40.0239],[265,40.533425],[266,41.042951],[267,41.552476],[268,42.062002],[269,42.571527],[270,43.081052],[271,43.590578],[272,44.100103],[273,44.609629],[274,45.119154],[275,45.62868],[276,46.138205],[277,46.647731],[278,47.157256],[279,47.666781],[280,48.176307],[281,48.685832],[282,49.195358],[283,49.704883],[284,50.214409],[285,50.723934],[286,51.23346],[287,51.742985],[288,52.252511],[289,52.762036],[290,53.271561],[291,53.781087],[292,54.290612],[293,54.800138],[294,55.309663],[295,55.819189],[296,56.328714],[297,56.83824],[298,57.347765],[299,57.85729],[300,58.366816],[301,58.876341],[302,59.385867],[303,59.895392],[304,60.404918],[305,60.914443],[306,61.423969],[307,61.933494],[308,62.443019],[309,62.952545],[310,63.46207],[311,63.971596],[312,64.481121],[313,64.990647],[314,65.500172],[315,66.009698],[316,66.519223],[317,67.028749],[318,67.538274],[319,68.047799],[320,68.557325],[321,69.06685],[322,69.576376],[323,70.085901],[324,70.595427],[325,71.104952],[326,71.614478],[327,72.124003],[328,72.633528],[329,73.143054],[330,73.652579],[331,74.162105],[332,74.67163],[333,75.181156],[334,75.690681],[335,76.200207],[336,76.709732],[337,77.219258],[338,77.728783],[339,78.238308],[340,78.747834],[341,79.257359],[342,79.766885],[343,80.27641],[344,80.785936],[345,81.295461],[346,81.804987],[347,82.314512],[348,82.824037],[349,83.333563],[350,83.843088],[351,84.352614],[352,84.862139],[353,85.371665],[354,85.88119],[355,86.390716],[356,86.900241],[357,87.409767],[358,87.919292],[359,88.428817],[360,88.938343],[361,89.447868],[362,89.957394],[363,90.466919],[364,90.976445],[365,91.48597],[366,91.995496],[367,92.505021],[368,93.014546],[369,93.524072],[370,94.033597],[371,94.543123],[372,95.052648],[373,95.562174],[374,96.071699],[375,96.581225],[376,97.09075],[377,97.600276],[378,98.109801],[379,98.619326],[380,99.128852],[381,99.638377],[382,100.147903],[383,100.657428],[384,101.166954],[385,101.676479],[386,102.186005],[387,102.69553],[388,103.205055],[389,103.714581],[390,104.224106],[391,104.733632],[392,105.243157],[393,105.752683],[394,106.262208],[395,106.771734],[396,107.281259],[397,107.790785],[398,108.30031],[399,108.809835],[400,109.319361],[401,109.828886],[402,110.338412],[403,110.847937],[404,111.357463],[405,111.866988],[406,112.376514],[407,112.886039],[408,113.395564],[409,113.90509],[410,114.414615],[411,114.924141],[412,115.433666],[413,115.943192],[414,116.452717],[415,116.962243],[416,117.471768],[417,117.981293],[418,118.490819],[419,119.000344],[420,119.50987],[421,120.019395],[422,120.528921],[423,121.038446],[424,121.547972],[425,122.057497],[426,122.567023],[427,123.076548],[428,123.586073],[429,124.095599],[430,124.605124],[431,125.11465],[432,125.624175],[433,126.133701],[434,126.643226],[435,127.152752],[436,127.662277],[437,128.171802],[438,128.681328],[439,129.190853],[440,129.700379],[441,130.209904],[442,130.71943],[443,131.228955],[444,131.738481],[445,132.248006],[446,132.757532],[447,133.267057],[448,133.776582],[449,134.286108],[450,134.795633],[451,135.305159],[452,135.814684],[453,136.32421],[454,136.833735],[455,137.343261],[456,137.852786],[457,138.362311],[458,138.871837],[459,139.381362],[460,139.890888],[461,140.400413],[462,140.909939],[463,141.419464],[464,141.92899],[465,142.438515],[466,142.948041],[467,143.457566],[468,143.967091],[469,144.476617],[470,144.986142],[471,145.495668],[472,146.005193],[473,146.514719],[474,147.024244],[475,147.53377],[476,148.043295],[477,148.55282],[478,149.062346],[479,149.571871],[480,150.081397],[481,150.590922],[482,151.100448],[483,151.608816],[484,152.108316],[485,152.591085],[486,153.050309],[487,153.480221],[488,153.876103],[489,154.234287],[490,154.552151],[491,154.828122],[492,155.061676],[493,155.253338],[494,155.40468],[495,155.518323],[496,155.597936],[497,155.648238],[498,155.674994],[499,155.685019],[500,155.686177],[501,155.686177],[502,155.686177],[503,155.686177],[504,155.686177],[505,155.686177],[506,155.686177],[507,155.686177],[508,155.686177],[509,155.686177],[510,155.686177],[511,155.686177],[512,155.686177],[513,155.686177],[514,155.686177],[515,155.686177],[516,155.686177],[517,155.686177],[518,155.686177],[519,155.686177],[520,155.686177],[521,155.686177],[522,155.686177],[523,155.686177],[524,155.686177],[525,155.686177],[526,155.686177],[527,155.686177],[528,155.686177],[529,155.686177],[530,155.686177],[531,155.686177],[532,155.686177],[533,155.686177],[534,155.686177],[535,155.686177],[536,155.686177],[537,155.686177],[538,155.686177],[539,155.686177],[540,155.686177],[541,155.686177],[542,155.686177],[543,155.686177],[544,155.686177],[545,155.686177],[546,155.686177],[547,155.686177],[548,155.686177],[549,155.686177],[550,155.686177],[551,155.686177],[552,155.686177],[553,155.686177],[554,155.686177],[555,155.686177],[556,155.686177],[557,155.686177],[558,155.686177],[559,155.686177],[560,155.686177],[561,155.686177],[562,155.686177],[563,155.686177],[564,155.686177],[565,155.686177],[566,155.686177],[567,155.686177],[568,155.686177],[569,155.686177],[570,155.686177],[571,155.686177],[572,155.686177],[573,155.686177],[574,155.686177],[575,155.686177],[576,155.686177],[577,155.686177],[578,155.686177],[579,155.686177],[580,155.686177],[581,155.687652],[582,155.70043],[583,155.734532],[584,155.798643],[585,155.900113],[586,156.044954],[587,156.237845],[588,156.482124],[589,156.779797],[590,157.131532],[591,157.53666],[592,157.993177],[593,158.497743],[594,159.045681],[595,159.630977],[596,160.246283],[597,160.882913],[598,161.530845],[599,162.180253],[600,162.82966],[601,163.479068],[602,164.128475],[603,164.777883],[604,165.427291],[605,166.076698],[606,166.726106],[607,167.375513],[608,168.024921],[609,168.674329],[610,169.323736],[611,169.973144],[612,170.622551],[613,171.271959],[614,171.921367],[615,172.570774],[616,173.220182],[617,173.869589],[618,174.518997],[619,175.168405],[620,175.817812],[621,176.46722],[622,177.116627],[623,177.766035],[624,178.415443],[625,179.06485],[626,179.714258],[627,180.363665],[628,181.013073],[629,181.66248],[630,182.311888],[631,182.961296],[632,183.610703],[633,184.260111],[634,184.909518],[635,185.558926],[636,186.208334],[637,186.857741],[638,187.507149],[639,188.156556],[640,188.805964],[641,189.455372],[642,190.104779],[643,190.754187],[644,191.403594],[645,192.053002],[646,192.70241],[647,193.351817],[648,194.001225],[649,194.650632],[650,195.30004],[651,195.949448],[652,196.598855],[653,197.248263],[654,197.89767],[655,198.547078],[656,199.196486],[657,199.845893],[658,200.495301],[659,201.144708],[660,201.794116],[661,202.443523],[662,203.092931],[663,203.742339],[664,204.391746],[665,205.041154],[666,205.690561],[667,206.339969],[668,206.989377],[669,207.638784],[670,208.288192],[671,208.937599],[672,209.587007],[673,210.236415],[674,210.885822],[675,211.53523],[676,212.184637],[677,212.834045],[678,213.483453],[679,214.13286],[680,214.782268],[681,215.431675],[682,216.081083],[683,216.730491],[684,217.379898],[685,218.029306],[686,218.678713],[687,219.328121],[688,219.977528],[689,220.626936],[690,221.276344],[691,221.925751],[692,222.575159],[693,223.224566],[694,223.873974],[695,224.523382],[696,225.172789],[697,225.822197],[698,226.471604],[699,227.121012],[700,227.77042],[701,228.419827],[702,229.069235],[703,229.718642],[704,230.36805],[705,231.017458],[706,231.666865],[707,232.316273],[708,232.96568],[709,233.615088],[710,234.264496],[711,234.913903],[712,235.563311],[713,236.212718],[714,236.862126],[715,237.511534],[716,238.160941],[717,238.810349],[718,239.459756],[719,240.109164],[720,240.758571],[721,241.407979],[722,242.057387],[723,242.706794],[724,243.356202],[725,244.005609],[726,244.655017],[727,245.304425],[728,245.953832],[729,246.60324],[730,247.252647],[731,247.902055],[732,248.551463],[733,249.20087],[734,249.850278],[735,250.499685],[736,251.149093],[737,251.798501],[738,252.447908],[739,253.097316],[740,253.746723],[741,254.396131],[742,255.045539],[743,255.694946],[744,256.344354],[745,256.993761],[746,257.643169],[747,258.292576],[748,258.941984],[749,259.591392],[750,260.240799],[751,260.890207],[752,261.539614],[753,262.189022],[754,262.83843],[755,263.487837],[756,264.137245],[757,264.786652],[758,265.43606],[759,266.085468],[760,266.734875],[761,267.384283],[762,268.03369],[763,268.683098],[764,269.332506],[765,269.981913],[766,270.631321],[767,271.280728],[768,271.930136],[769,272.579544],[770,273.228951],[771,273.878359],[772,274.527766],[773,275.177174],[774,275.826581],[775,276.475989],[776,277.125397],[777,277.774804],[778,278.424212],[779,279.073619],[780,279.723027],[781,280.372435],[782,281.021842],[783,281.67125],[784,282.320657],[785,282.970065],[786,283.619473],[787,284.26888],[788,284.918288],[789,285.567695],[790,286.217103],[791,286.866511],[792,287.515918],[793,288.165326],[794,288.814733],[795,289.464141],[796,290.113549],[797,290.762956],[798,291.412364],[799,292.061771],[800,292.711179],[801,293.360587],[802,294.009994],[803,294.659402],[804,295.308809],[805,295.958217],[806,296.607624],[807,297.257032],[808,297.90644],[809,298.555847],[810,299.205255],[811,299.854662],[812,300.50407],[813,301.153478],[814,301.802885],[815,302.452293],[816,303.1017],[817,303.751108],[818,304.400516],[819,305.049923],[820,305.699331],[821,306.348738],[822,306.998146],[823,307.647554],[824,308.296961],[825,308.946369],[826,309.595776],[827,310.245184],[828,310.894592],[829,311.543999],[830,312.193407],[831,312.842814],[832,313.492222],[833,314.141629],[834,314.791037],[835,315.440445],[836,316.089852],[837,316.73926],[838,317.388667],[839,318.038075],[840,318.687483],[841,319.33689],[842,319.986298],[843,320.635705],[844,321.285113],[845,321.934521],[846,322.583928],[847,323.233336],[848,323.882743],[849,324.532151],[850,325.181559],[851,325.830966],[852,326.480374],[853,327.129781],[854,327.779189],[855,328.428597],[856,329.078004],[857,329.727412],[858,330.376819],[859,331.026227],[860,331.675635],[861,332.325042],[862,332.97445],[863,333.623857],[864,334.273265],[865,334.922672],[866,335.57208],[867,336.221488],[868,336.870895],[869,337.520303],[870,338.16971],[871,338.819118],[872,339.468526],[873,340.117933],[874,340.767341],[875,341.416748],[876,342.066156],[877,342.715564],[878,343.364971],[879,344.014379],[880,344.663786],[881,345.313194],[882,345.962602],[883,346.612009],[884,347.261417],[885,347.910824],[886,348.560232],[887,349.20964],[888,349.859047],[889,350.508455],[890,351.157862],[891,351.80727],[892,352.456677],[893,353.106085],[894,353.755493],[895,354.4049],[896,355.054308],[897,355.703715],[898,356.353123],[899,357.002531],[900,357.651938],[901,358.301346],[902,358.950753],[903,359.600161],[904,360.249569],[905,360.898976],[906,361.548384],[907,362.197791],[908,362.847199],[909,363.496607],[910,364.146014],[911,364.795422],[912,365.444829],[913,366.094237],[914,366.743645],[915,367.393052],[916,368.04246],[917,368.691867],[918,369.341275],[919,369.990683],[920,370.64009],[921,371.289498],[922,371.938905],[923,372.586837],[924,373.223467],[925,373.838773],[926,374.42407],[927,374.972007],[928,375.476573],[929,375.93309],[930,376.338219],[931,376.689953],[932,376.987626],[933,377.231906],[934,377.424796],[935,377.569638],[936,377.671108],[937,377.735219],[938,377.769321],[939,377.782098],[940,377.783574],[941,377.783574],[942,377.783574],[943,377.783574],[944,377.783574],[945,377.783574],[946,377.783574],[947,377.783574],[948,377.783574],[949,377.783574],[950,377.783574],[951,377.783574],[952,377.783574],[953,377.783574],[954,377.783574],[955,377.783574],[956,377.783574],[957,377.783574],[958,377.783574],[959,377.783574],[960,377.783574],[961,377.783574],[962,377.783574],[963,377.783574],[964,377.783574],[965,377.783574],[966,377.783574],[967,377.783574],[968,377.783574],[969,377.783574],[970,377.783574],[971,377.783574],[972,377.783574],[973,377.783574],[974,377.783574],[975,377.783574],[976,377.783574],[977,377.783574],[978,377.783574],[979,377.783574],[980,377.783574],[981,377.783574],[982,377.783574],[983,377.783574],[984,377.783574],[985,377.783574],[986,377.783574],[987,377.783574],[988,377.783574],[989,377.783574],[990,377.783574],[991,377.783574],[992,377.783574],[993,377.783574],[994,377.783574],[995,377.783574],[996,377.783574],[997,377.783574],[998,377.783574],[999,377.783574],[1000,377.783574],[1001,377.783574],[1002,377.783574],[1003,377.783574],[1004,377.783574],[1005,377.783574],[1006,377.783574],[1007,377.783574],[1008,377.783574],[1009,377.783574],[1010,377.783574],[1011,377.783574],[1012,377.783574],[1013,377.783574],[1014,377.783574],[1015,377.783574],[1016,377.783574],[1017,377.783574],[1018,377.783574],[1019,377.783574],[1020,377.783574],[1021,377.783574],[1022,377.783574],[1023,377.783574],[1024,377.783574],[1025,377.783574],[1026,377.783574],[1027,377.783574],[1028,377.783574],[1029,377.783574],[1030,377.783574],[1031,377.783723],[1032,377.784641],[1033,377.786634],[1034,377.789485],[1035,377.792411],[1036,377.794193],[1037,377.793436],[1038,377.788935],[1039,377.780061],[1040,377.767078],[1041,377.751317],[1042,377.735157],[1043,377.72176],[1044,377.71461],[1045,377.716889],[1046,377.730811],[1047,377.757005],[1048,377.794093],[1049,377.838552],[1050,377.884925],[1051,377.9264],[1052,377.955697],[1053,377.966167],[1054,377.952943],[1055,377.913966],[1056,377.850701],[1057,377.768413],[1058,377.675879],[1059,377.584549],[1060,377.507201],[1061,377.45625],[1062,377.441923],[1063,377.470555],[1064,377.543273],[1065,377.655288],[1066,377.795959],[1067,377.949682],[1068,378.097566],[1069,378.219699],[1070,378.297766],[1071,378.317663],[1072,378.27174],[1073,378.16036],[1074,377.992482],[1075,377.78513],[1076,377.561752],[1077,377.349591],[1078,377.176382],[1079,377.06676],[1080,377.038846],[1081,377.101475],[1082,377.252479],[1083,377.478304],[1084,377.755089],[1085,378.051151],[1086,378.330617],[1087,378.557783],[1088,378.701684],[1089,378.740266],[1090,378.663623],[1091,378.475821],[1092,378.195016],[1093,377.851779],[1094,377.485768],[1095,377.14111],[1096,376.861033],[1097,376.682403],[1098,376.630875],[1099,376.717278],[1100,376.935754],[1101,377.263937],[1102,377.66521],[1103,378.092825],[1104,378.495417],[1105,378.823249],[1106,379.034423],[1107,379.100277],[1108,379.009261],[1109,378.768768],[1110,378.404656],[1111,377.95845],[1112,377.482549],[1113,377.033981],[1114,376.667473],[1115,376.428681],[1116,376.348435],[1117,376.43873],[1118,376.690984],[1119,377.076823],[1120,377.55131],[1121,378.058263],[1122,378.537006],[1123,378.929751],[1124,379.188672],[1125,379.281818],[1126,379.197113],[1127,378.943928],[1128,378.552036],[1129,378.068052],[1130,377.549804],[1131,377.059307],[1132,376.655232],[1133,376.385772],[1134,376.282805],[1135,376.358062],[1136,376.601769],[1137,376.983928],[1138,377.458058],[1139,377.966937],[1140,378.449611],[1141,378.848806],[1142,379.117836],[1143,379.226144],[1144,379.162822],[1145,378.937695],[1146,378.579864],[1147,378.133915],[1148,377.654295],[1149,377.198575],[1150,376.82044],[1151,376.563269],[1152,376.455094],[1153,376.505522],[1154,376.70496],[1155,377.026204],[1156,377.428129],[1157,377.860995],[1158,378.272668],[1159,378.614981],[1160,378.84944],[1161,378.951591],[1162,378.91356],[1163,378.744483],[1164,378.468866],[1165,378.123105],[1166,377.750685],[1167,377.396672],[1168,377.102205],[1169,376.899678],[1170,376.809163],[1171,376.836486],[1172,376.973123],[1173,377.197849],[1174,377.479882],[1175,377.783051],[1176,378.07044],[1177,378.308898],[1178,378.472882],[1179,378.547157],[1180,378.5281],[1181,378.423498],[1182,378.250958],[1183,378.03518],[1184,377.804518],[1185,377.587289],[1186,377.408309],[1187,377.286082],[1188,377.230954],[1189,377.244404],[1190,377.319497],[1191,377.442359],[1192,377.594412],[1193,377.755048],[1194,377.904347],[1195,378.025508],[1196,378.106679],[1197,378.142014],[1198,378.131869],[1199,378.082179],[1200,378.003179],[1201,377.907675],[1202,377.809147],[1203,377.719941],[1204,377.649802],[1205,377.604887],[1206,377.587371],[1207,377.595633],[1208,377.624931],[1209,377.668433],[1210,377.718418],[1211,377.767449],[1212,377.809369],[1213,377.839979],[1214,377.857349],[1215,377.861745],[1216,377.855245],[1217,377.841122],[1218,377.823143],[1219,377.804883],[1220,377.789187],[1221,377.777829],[1222,377.771421],[1223,377.769536],[1224,377.771009],[1225,377.77433],[1226,377.778042],[1227,377.781063],[1228,377.782873],[1229,377.783535],[1230,377.783574],[1231,377.783574],[1232,377.783574],[1233,377.783574],[1234,377.783574],[1235,377.783574],[1236,377.783574],[1237,377.783574],[1238,377.783574],[1239,377.783574],[1240,377.783574],[1241,377.783574],[1242,377.783574],[1243,377.783574],[1244,377.783574],[1245,377.783574],[1246,377.783574],[1247,377.783574],[1248,377.783574],[1249,377.783574],[1250,377.783574],[1251,377.783574],[1252,377.783574],[1253,377.783574],[1254,377.783574],[1255,377.783574],[1256,377.783574],[1257,377.783574],[1258,377.783574],[1259,377.783574],[1260,377.783574],[1261,377.783574],[1262,377.783574],[1263,377.783574],[1264,377.783574],[1265,377.783574],[1266,377.783574],[1267,377.783574],[1268,377.783574],[1269,377.783574],[1270,377.783574],[1271,377.783574],[1272,377.783574],[1273,377.783574],[1274,377.783574],[1275,377.783574],[1276,377.783574],[1277,377.783574],[1278,377.783574],[1279,377.783574],[1280,377.783574],[1281,377.783574],[1282,377.783574],[1283,377.783574],[1284,377.783574],[1285,377.783574],[1286,377.783574],[1287,377.783574],[1288,377.783574],[1289,377.783574],[1290,377.783574],[1291,377.783574],[1292,377.783574],[1293,377.783574],[1294,377.783574],[1295,377.783574],[1296,377.783574],[1297,377.783574],[1298,377.783574],[1299,377.783574],[1300,377.783574],[1301,377.783574],[1302,377.783574],[1303,377.783574],[1304,377.783574],[1305,377.783574],[1306,377.783574],[1307,377.783574],[1308,377.783574],[1309,377.783574],[1310,377.783574],[1311,377.784492],[1312,377.792441],[1313,377.813657],[1314,377.853544],[1315,377.916673],[1316,378.006786],[1317,378.126792],[1318,378.278769],[1319,378.463965],[1320,378.682795],[1321,378.934844],[1322,379.218864],[1323,379.532778],[1324,379.873675],[1325,380.237815],[1326,380.620625],[1327,381.016701],[1328,381.41981],[1329,381.823836],[1330,382.227862],[1331,382.631888],[1332,383.035915],[1333,383.439941],[1334,383.843967],[1335,384.247993],[1336,384.652019],[1337,385.056046],[1338,385.460072],[1339,385.864098],[1340,386.268124],[1341,386.672151],[1342,387.076177],[1343,387.480203],[1344,387.884229],[1345,388.288256],[1346,388.692282],[1347,389.096308],[1348,389.500334],[1349,389.90436],[1350,390.308387],[1351,390.712413],[1352,391.116439],[1353,391.520465],[1354,391.924492],[1355,392.328518],[1356,392.732544],[1357,393.13657],[1358,393.540596],[1359,393.944623],[1360,394.348649],[1361,394.752675],[1362,395.156701],[1363,395.560728],[1364,395.964754],[1365,396.36878],[1366,396.772806],[1367,397.176832],[1368,397.580859],[1369,397.984885],[1370,398.388911],[1371,398.792937],[1372,399.196964],[1373,399.60099],[1374,400.005016],[1375,400.409042],[1376,400.813069],[1377,401.217095],[1378,401.621121],[1379,402.025147],[1380,402.429173],[1381,402.8332],[1382,403.237226],[1383,403.641252],[1384,404.045278],[1385,404.449305],[1386,404.853331],[1387,405.257357],[1388,405.661383],[1389,406.065409],[1390,406.469436],[1391,406.873462],[1392,407.277488],[1393,407.681514],[1394,408.085541],[1395,408.489567],[1396,408.893593],[1397,409.297619],[1398,409.701645],[1399,410.105672],[1400,410.509698],[1401,410.913724],[1402,411.31775],[1403,411.721777],[1404,412.125803],[1405,412.529829],[1406,412.933855],[1407,413.337882],[1408,413.741908],[1409,414.145934],[1410,414.54996],[1411,414.953986],[1412,415.358013],[1413,415.762039],[1414,416.166065],[1415,416.570091],[1416,416.974118],[1417,417.378144],[1418,417.78217],[1419,418.186196],[1420,418.590222],[1421,418.994249],[1422,419.398275],[1423,419.802301],[1424,420.206327],[1425,420.610354],[1426,421.01438],[1427,421.418406],[1428,421.822432],[1429,422.226458],[1430,422.630485],[1431,423.034511],[1432,423.438537],[1433,423.842563],[1434,424.24659],[1435,424.650616],[1436,425.054642],[1437,425.458668],[1438,425.862695],[1439,426.266721],[1440,426.670747],[1441,427.074773],[1442,427.478799],[1443,427.882826],[1444,428.286852],[1445,428.690878],[1446,429.094904],[1447,429.498931],[1448,429.902957],[1449,430.306983],[1450,430.711009],[1451,431.115035],[1452,431.519062],[1453,431.923088],[1454,432.327114],[1455,432.73114],[1456,433.135167],[1457,433.539193],[1458,433.943219],[1459,434.347245],[1460,434.751271],[1461,435.155298],[1462,435.559324],[1463,435.96335],[1464,436.367376],[1465,436.771403],[1466,437.175429],[1467,437.579455],[1468,437.983481],[1469,438.387508],[1470,438.791534],[1471,439.19556],[1472,439.599586],[1473,440.003612],[1474,440.407639],[1475,440.811665],[1476,441.215691],[1477,441.619717],[1478,442.023744],[1479,442.42777],[1480,442.831796],[1481,443.235822],[1482,443.639848],[1483,444.043875],[1484,444.447901],[1485,444.851927],[1486,445.255953],[1487,445.65998],[1488,446.064006],[1489,446.468032],[1490,446.872058],[1491,447.276084],[1492,447.680111],[1493,448.084137],[1494,448.488163],[1495,448.892189],[1496,449.296216],[1497,449.700242],[1498,450.104268],[1499,450.508294],[1500,450.912321],[1501,451.316347],[1502,451.720373],[1503,452.124399],[1504,452.528425],[1505,452.932452],[1506,453.336478],[1507,453.740504],[1508,454.14453],[1509,454.548557],[1510,454.952583],[1511,455.356609],[1512,455.760635],[1513,456.164661],[1514,456.568688],[1515,456.972714],[1516,457.37674],[1517,457.780766],[1518,458.184793],[1519,458.588819],[1520,458.992845],[1521,459.396871],[1522,459.800897],[1523,460.204924],[1524,460.60895],[1525,461.012976],[1526,461.417002],[1527,461.821029],[1528,462.225055],[1529,462.629081],[1530,463.033107],[1531,463.437134],[1532,463.84116],[1533,464.245186],[1534,464.649212],[1535,465.053238],[1536,465.457265],[1537,465.861291],[1538,466.265317],[1539,466.669343],[1540,467.07337],[1541,467.477396],[1542,467.881422],[1543,468.285448],[1544,468.689474],[1545,469.093501],[1546,469.497527],[1547,469.901553],[1548,470.305579],[1549,470.709606],[1550,471.113632],[1551,471.517658],[1552,471.921684],[1553,472.32571],[1554,472.729737],[1555,473.133763],[1556,473.537789],[1557,473.941815],[1558,474.345842],[1559,474.749868],[1560,475.153894],[1561,475.55792],[1562,475.961947],[1563,476.365973],[1564,476.769999],[1565,477.174025],[1566,477.578051],[1567,477.982078],[1568,478.386104],[1569,478.79013],[1570,479.194156],[1571,479.598183],[1572,480.002209],[1573,480.406235],[1574,480.810261],[1575,481.214287],[1576,481.618314],[1577,482.02234],[1578,482.426366],[1579,482.830392],[1580,483.234419],[1581,483.638445],[1582,484.042471],[1583,484.446497],[1584,484.850523],[1585,485.25455],[1586,485.658576],[1587,486.062602],[1588,486.466628],[1589,486.870655],[1590,487.274681],[1591,487.678707],[1592,488.082733],[1593,488.48676],[1594,488.890786],[1595,489.294812],[1596,489.698838],[1597,490.102864],[1598,490.506891],[1599,490.910917],[1600,491.314943],[1601,491.718969],[1602,492.122996],[1603,492.527022],[1604,492.931048],[1605,493.335074],[1606,493.7391],[1607,494.143127],[1608,494.547153],[1609,494.951179],[1610,495.355205],[1611,495.759232],[1612,496.163258],[1613,496.567284],[1614,496.97131],[1615,497.375336],[1616,497.779363],[1617,498.183389],[1618,498.587415],[1619,498.991441],[1620,499.395468],[1621,499.799494],[1622,500.20352],[1623,500.607546],[1624,501.011573],[1625,501.415599],[1626,501.819625],[1627,502.223651],[1628,502.627677],[1629,503.031704],[1630,503.43573],[1631,503.839756],[1632,504.243782],[1633,504.647809],[1634,505.051835],[1635,505.455861],[1636,505.859887],[1637,506.263913],[1638,506.66794],[1639,507.071966],[1640,507.475992],[1641,507.880018],[1642,508.284045],[1643,508.688071],[1644,509.092097],[1645,509.496123],[1646,509.900149],[1647,510.304176],[1648,510.708202],[1649,511.112228],[1650,511.516254],[1651,511.920281],[1652,512.324307],[1653,512.728333],[1654,513.132359],[1655,513.536386],[1656,513.940412],[1657,514.344438],[1658,514.748464],[1659,515.15249],[1660,515.556517],[1661,515.960543],[1662,516.364569],[1663,516.768595],[1664,517.172622],[1665,517.576648],[1666,517.980674],[1667,518.3847],[1668,518.788726],[1669,519.192753],[1670,519.596779],[1671,520.000805],[1672,520.404831],[1673,520.808858],[1674,521.212884],[1675,521.61691],[1676,522.020936],[1677,522.424962],[1678,522.828989],[1679,523.233015],[1680,523.637041],[1681,524.041067],[1682,524.445094],[1683,524.84912],[1684,525.253146],[1685,525.657172],[1686,526.061199],[1687,526.465225],[1688,526.869251],[1689,527.273277],[1690,527.677303],[1691,528.08133],[1692,528.485356],[1693,528.889382],[1694,529.293408],[1695,529.697435],[1696,530.101461],[1697,530.505487],[1698,530.909513],[1699,531.313539],[1700,531.717566],[1701,532.121592],[1702,532.525618],[1703,532.929644],[1704,533.333671],[1705,533.737697],[1706,534.141723],[1707,534.545749],[1708,534.949775],[1709,535.353802],[1710,535.757828],[1711,536.161854],[1712,536.56588],[1713,536.969907],[1714,537.373933],[1715,537.777959],[1716,538.181985],[1717,538.586012],[1718,538.990038],[1719,539.394064],[1720,539.79809],[1721,540.202116],[1722,540.606143],[1723,541.010169],[1724,541.414195],[1725,541.818221],[1726,542.222248],[1727,542.626274],[1728,543.0303],[1729,543.434326],[1730,543.838352],[1731,544.242379],[1732,544.646405],[1733,545.050431],[1734,545.454457],[1735,545.858484],[1736,546.26251],[1737,546.666536],[1738,547.070562],[1739,547.474588],[1740,547.878615],[1741,548.282641],[1742,548.686667],[1743,549.090693],[1744,549.49472],[1745,549.898746],[1746,550.302772],[1747,550.706798],[1748,551.110825],[1749,551.514851],[1750,551.918877],[1751,552.322903],[1752,552.726929],[1753,553.130956],[1754,553.534982],[1755,553.939008],[1756,554.343034],[1757,554.747061],[1758,555.151087],[1759,555.555113],[1760,555.959139],[1761,556.363165],[1762,556.767192],[1763,557.171218],[1764,557.575244],[1765,557.97927],[1766,558.383297],[1767,558.787323],[1768,559.191349],[1769,559.595375],[1770,559.999401],[1771,560.403428],[1772,560.807454],[1773,561.21148],[1774,561.615506],[1775,562.019533],[1776,562.423559],[1777,562.827585],[1778,563.231611],[1779,563.635638],[1780,564.039664],[1781,564.44369],[1782,564.847716],[1783,565.251742],[1784,565.655769],[1785,566.059795],[1786,566.463821],[1787,566.867847],[1788,567.271874],[1789,567.6759],[1790,568.079926],[1791,568.483952],[1792,568.887978],[1793,569.292005],[1794,569.696031],[1795,570.100057],[1796,570.504083],[1797,570.90811],[1798,571.312136],[1799,571.716162],[1800,572.120188],[1801,572.524214],[1802,572.928241],[1803,573.332267],[1804,573.736293],[1805,574.140319],[1806,574.544346],[1807,574.948372],[1808,575.352398],[1809,575.756424],[1810,576.160451],[1811,576.564477],[1812,576.968503],[1813,577.372529],[1814,577.776555],[1815,578.180582],[1816,578.584608],[1817,578.988634],[1818,579.39266],[1819,579.796687],[1820,580.200713],[1821,580.604739],[1822,581.008765],[1823,581.412791],[1824,581.816818],[1825,582.220844],[1826,582.62487],[1827,583.028896],[1828,583.432923],[1829,583.836949],[1830,584.240975],[1831,584.645001],[1832,585.049027],[1833,585.453054],[1834,585.85708],[1835,586.261106],[1836,586.665132],[1837,587.069159],[1838,587.473185],[1839,587.877211],[1840,588.281237],[1841,588.685264],[1842,589.08929],[1843,589.493316],[1844,589.897342],[1845,590.301368],[1846,590.705395],[1847,591.109421],[1848,591.513447],[1849,591.917473],[1850,592.3215],[1851,592.725526],[1852,593.129552],[1853,593.533578],[1854,593.937604],[1855,594.341631],[1856,594.745657],[1857,595.149683],[1858,595.553709],[1859,595.957736],[1860,596.361762],[1861,596.765788],[1862,597.169814],[1863,597.57384],[1864,597.977867],[1865,598.381893],[1866,598.785919],[1867,599.189945],[1868,599.593972],[1869,599.997998],[1870,600.402024],[1871,600.80605],[1872,601.210077],[1873,601.614103],[1874,602.018129],[1875,602.422155],[1876,602.826181],[1877,603.230208],[1878,603.634234],[1879,604.03826],[1880,604.442286],[1881,604.846313],[1882,605.250339],[1883,605.654365],[1884,606.058391],[1885,606.462417],[1886,606.866444],[1887,607.27047],[1888,607.674496],[1889,608.078522],[1890,608.482549],[1891,608.886575],[1892,609.290601],[1893,609.694627],[1894,610.098653],[1895,610.50268],[1896,610.906706],[1897,611.310732],[1898,611.714758],[1899,612.118785],[1900,612.522811],[1901,612.926837],[1902,613.330863],[1903,613.73489],[1904,614.138916],[1905,614.542942],[1906,614.946968],[1907,615.350994],[1908,615.755021],[1909,616.159047],[1910,616.563073],[1911,616.967099],[1912,617.371126],[1913,617.775152],[1914,618.179178],[1915,618.583204],[1916,618.98723],[1917,619.391257],[1918,619.795283],[1919,620.199309],[1920,620.603335],[1921,621.007362],[1922,621.411388],[1923,621.815414],[1924,622.21944],[1925,622.623466],[1926,623.027493],[1927,623.431519],[1928,623.835545],[1929,624.239571],[1930,624.643598],[1931,625.047624],[1932,625.45165],[1933,625.855676],[1934,626.259703],[1935,626.663729],[1936,627.067755],[1937,627.471781],[1938,627.875807],[1939,628.279834],[1940,628.68386],[1941,629.087886],[1942,629.491912],[1943,629.895939],[1944,630.299965],[1945,630.703991],[1946,631.108017],[1947,631.512043],[1948,631.91607],[1949,632.320096],[1950,632.724122],[1951,633.128148],[1952,633.532175],[1953,633.936201],[1954,634.340227],[1955,634.744253],[1956,635.148279],[1957,635.552306],[1958,635.956332],[1959,636.360358],[1960,636.764384],[1961,637.168411],[1962,637.572437],[1963,637.976463],[1964,638.380489],[1965,638.784516],[1966,639.188542],[1967,639.592568],[1968,639.996594],[1969,640.40062],[1970,640.804647],[1971,641.208673],[1972,641.612699],[1973,642.016725],[1974,642.420752],[1975,642.824778],[1976,643.228804],[1977,643.63283],[1978,644.036856],[1979,644.440883],[1980,644.844909],[1981,645.248935],[1982,645.652961],[1983,646.056988],[1984,646.461014],[1985,646.86504],[1986,647.269066],[1987,647.673092],[1988,648.077119],[1989,648.481145],[1990,648.885171],[1991,649.289197],[1992,649.693224],[1993,650.09725],[1994,650.501276],[1995,650.905302],[1996,651.309329],[1997,651.713355],[1998,652.117381],[1999,652.521407],[2000,652.925433],[2001,653.32946],[2002,653.733486],[2003,654.137512],[2004,654.541538],[2005,654.945565],[2006,655.349591],[2007,655.753617],[2008,656.157643],[2009,656.561669],[2010,656.965696],[2011,657.369722],[2012,657.773748],[2013,658.177774],[2014,658.581801],[2015,658.985827],[2016,659.389853],[2017,659.793879],[2018,660.197905],[2019,660.601932],[2020,661.005958],[2021,661.409984],[2022,661.81401],[2023,662.218037],[2024,662.622063],[2025,663.026089],[2026,663.430115],[2027,663.834142],[2028,664.238168],[2029,664.642194],[2030,665.04622],[2031,665.450246],[2032,665.854273],[2033,666.258299],[2034,666.662325],[2035,667.066351],[2036,667.470378],[2037,667.874404],[2038,668.27843],[2039,668.682456],[2040,669.086482],[2041,669.490509],[2042,669.894535],[2043,670.298561],[2044,670.702587],[2045,671.106614],[2046,671.51064],[2047,671.914666],[2048,672.318692],[2049,672.722718],[2050,673.126745],[2051,673.530771],[2052,673.934797],[2053,674.338823],[2054,674.74285],[2055,675.146876],[2056,675.550902],[2057,675.954928],[2058,676.358955],[2059,676.762981],[2060,677.167007],[2061,677.571033],[2062,677.975059],[2063,678.379086],[2064,678.783112],[2065,679.187138],[2066,679.591164],[2067,679.995191],[2068,680.399217],[2069,680.803243],[2070,681.207269],[2071,681.611295],[2072,682.015322],[2073,682.419348],[2074,682.823374],[2075,683.2274],[2076,683.631427],[2077,684.035453],[2078,684.439479],[2079,684.843505],[2080,685.247531],[2081,685.651558],[2082,686.055584],[2083,686.45961],[2084,686.863636],[2085,687.267663],[2086,687.671689],[2087,688.075715],[2088,688.479741],[2089,688.883768],[2090,689.287794],[2091,689.69182],[2092,690.095846],[2093,690.499872],[2094,690.903899],[2095,691.307925],[2096,691.711951],[2097,692.115977],[2098,692.520004],[2099,692.92403],[2100,693.328056],[2101,693.732082],[2102,694.136108],[2103,694.540135],[2104,694.944161],[2105,695.348187],[2106,695.752213],[2107,696.15624],[2108,696.560266],[2109,696.964292],[2110,697.368318],[2111,697.772344],[2112,698.176371],[2113,698.580397],[2114,698.984423],[2115,699.388449],[2116,699.792476],[2117,700.196502],[2118,700.600528],[2119,701.004554],[2120,701.408581],[2121,701.812607],[2122,702.216633],[2123,702.620659],[2124,703.024685],[2125,703.428712],[2126,703.832738],[2127,704.236764],[2128,704.64079],[2129,705.044817],[2130,705.448843],[2131,705.852869],[2132,706.256895],[2133,706.660921],[2134,707.064948],[2135,707.468974],[2136,707.873],[2137,708.277026],[2138,708.681053],[2139,709.085079],[2140,709.489105],[2141,709.893131],[2142,710.297157],[2143,710.701184],[2144,711.10521],[2145,711.509236],[2146,711.913262],[2147,712.317289],[2148,712.721315],[2149,713.125341],[2150,713.529367],[2151,713.933394],[2152,714.33742],[2153,714.741446],[2154,715.145472],[2155,715.549498],[2156,715.953525],[2157,716.357551],[2158,716.761577],[2159,717.165603],[2160,717.56963],[2161,717.973656],[2162,718.377682],[2163,718.781708],[2164,719.185734],[2165,719.589761],[2166,719.993787],[2167,720.397813],[2168,720.801839],[2169,721.205866],[2170,721.609892],[2171,722.013918],[2172,722.417944],[2173,722.82197],[2174,723.225997],[2175,723.630023],[2176,724.034049],[2177,724.438075],[2178,724.842102],[2179,725.246128],[2180,725.650154],[2181,726.05418],[2182,726.458207],[2183,726.862233],[2184,727.266259],[2185,727.670285],[2186,728.074311],[2187,728.478338],[2188,728.882364],[2189,729.28639],[2190,729.690416],[2191,730.094443],[2192,730.498469],[2193,730.902495],[2194,731.306521],[2195,731.710547],[2196,732.114574],[2197,732.5186],[2198,732.922626],[2199,733.326652],[2200,733.730679],[2201,734.134705],[2202,734.538731],[2203,734.942757],[2204,735.346783],[2205,735.75081],[2206,736.154836],[2207,736.558862],[2208,736.962888],[2209,737.366915],[2210,737.770941],[2211,738.174967],[2212,738.578993],[2213,738.98302],[2214,739.387046],[2215,739.791072],[2216,740.195098],[2217,740.599124],[2218,741.003151],[2219,741.407177],[2220,741.811203],[2221,742.215229],[2222,742.619256],[2223,743.023282],[2224,743.427308],[2225,743.831334],[2226,744.23536],[2227,744.639387],[2228,745.043413],[2229,745.447439],[2230,745.851465],[2231,746.255492],[2232,746.659518],[2233,747.063544],[2234,747.46757],[2235,747.871596],[2236,748.275623],[2237,748.679649],[2238,749.083675],[2239,749.487701],[2240,749.891728],[2241,750.295754],[2242,750.69978],[2243,751.103806],[2244,751.507833],[2245,751.911859],[2246,752.315885],[2247,752.719911],[2248,753.123937],[2249,753.527964],[2250,753.93199],[2251,754.336016],[2252,754.740042],[2253,755.144069],[2254,755.548095],[2255,755.952121],[2256,756.356147],[2257,756.760173],[2258,757.1642],[2259,757.568226],[2260,757.972252],[2261,758.376278],[2262,758.780305],[2263,759.184331],[2264,759.588357],[2265,759.992383],[2266,760.396409],[2267,760.800436],[2268,761.204462],[2269,761.608488],[2270,762.012514],[2271,762.416541],[2272,762.820567],[2273,763.224593],[2274,763.628619],[2275,764.032646],[2276,764.436672],[2277,764.840698],[2278,765.244724],[2279,765.64875],[2280,766.052777],[2281,766.456803],[2282,766.860829],[2283,767.264855],[2284,767.668882],[2285,768.072908],[2286,768.476934],[2287,768.88096],[2288,769.284986],[2289,769.689013],[2290,770.093039],[2291,770.497065],[2292,770.901091],[2293,771.305118],[2294,771.709144],[2295,772.11317],[2296,772.517196],[2297,772.921222],[2298,773.325249],[2299,773.729275],[2300,774.133301],[2301,774.537327],[2302,774.941354],[2303,775.34538],[2304,775.749406],[2305,776.153432],[2306,776.557459],[2307,776.961485],[2308,777.365511],[2309,777.769537],[2310,778.173563],[2311,778.57759],[2312,778.981616],[2313,779.385642],[2314,779.789668],[2315,780.193695],[2316,780.597721],[2317,781.001747],[2318,781.405773],[2319,781.809799],[2320,782.213826],[2321,782.617852],[2322,783.021878],[2323,783.425904],[2324,783.829931],[2325,784.233957],[2326,784.637983],[2327,785.042009],[2328,785.446035],[2329,785.850062],[2330,786.254088],[2331,786.658114],[2332,787.06214],[2333,787.466167],[2334,787.870193],[2335,788.274219],[2336,788.678245],[2337,789.082272],[2338,789.486298],[2339,789.890324],[2340,790.29435],[2341,790.698376],[2342,791.102403],[2343,791.506429],[2344,791.910455],[2345,792.314481],[2346,792.718508],[2347,793.122534],[2348,793.52656],[2349,793.930586],[2350,794.334612],[2351,794.738639],[2352,795.142665],[2353,795.546691],[2354,795.950717],[2355,796.354744],[2356,796.75877],[2357,797.162796],[2358,797.566822],[2359,797.970848],[2360,798.374875],[2361,798.778901],[2362,799.182927],[2363,799.586953],[2364,799.99098],[2365,800.395006],[2366,800.799032],[2367,801.203058],[2368,801.607085],[2369,802.011111],[2370,802.415137],[2371,802.819163],[2372,803.223189],[2373,803.627216],[2374,804.031242],[2375,804.435268],[2376,804.839294],[2377,805.243321],[2378,805.647347],[2379,806.051373],[2380,806.455399],[2381,806.859425],[2382,807.263452],[2383,807.667478],[2384,808.071504],[2385,808.47553],[2386,808.879557],[2387,809.283583],[2388,809.687609],[2389,810.091635],[2390,810.495662],[2391,810.899688],[2392,811.303714],[2393,811.70774],[2394,812.111766],[2395,812.515793],[2396,812.919819],[2397,813.323845],[2398,813.727871],[2399,814.131898],[2400,814.535924],[2401,814.93995],[2402,815.343976],[2403,815.748002],[2404,816.152029],[2405,816.556055],[2406,816.960081],[2407,817.364107],[2408,817.768134],[2409,818.17216],[2410,818.576186],[2411,818.980212],[2412,819.384238],[2413,819.788265],[2414,820.192291],[2415,820.596317],[2416,821.000343],[2417,821.40437],[2418,821.808396],[2419,822.212422],[2420,822.616448],[2421,823.020475],[2422,823.424501],[2423,823.828527],[2424,824.232553],[2425,824.636579],[2426,825.040606],[2427,825.444632],[2428,825.848658],[2429,826.252684],[2430,826.656711],[2431,827.060737],[2432,827.464763],[2433,827.868789],[2434,828.272815],[2435,828.676842],[2436,829.080868],[2437,829.484894],[2438,829.88892],[2439,830.292947],[2440,830.696973],[2441,831.100999],[2442,831.505025],[2443,831.909051],[2444,832.313078],[2445,832.717104],[2446,833.12113],[2447,833.525156],[2448,833.929183],[2449,834.333209],[2450,834.737235],[2451,835.141261],[2452,835.545288],[2453,835.949314],[2454,836.35334],[2455,836.757366],[2456,837.161392],[2457,837.565419],[2458,837.969445],[2459,838.373471],[2460,838.777497],[2461,839.181524],[2462,839.58555],[2463,839.989576],[2464,840.393602],[2465,840.797628],[2466,841.201655],[2467,841.605681],[2468,842.009707],[2469,842.413733],[2470,842.81776],[2471,843.221786],[2472,843.625812],[2473,844.029838],[2474,844.433864],[2475,844.837891],[2476,845.241917],[2477,845.645943],[2478,846.049969],[2479,846.453996],[2480,846.858022],[2481,847.262048],[2482,847.666074],[2483,848.070101],[2484,848.474127],[2485,848.878153],[2486,849.282179],[2487,849.686205],[2488,850.090232],[2489,850.494258],[2490,850.898284],[2491,851.30231],[2492,851.706337],[2493,852.110363],[2494,852.514389],[2495,852.918415],[2496,853.322441],[2497,853.726468],[2498,854.130494],[2499,854.53452],[2500,854.938546],[2501,855.342573],[2502,855.746599],[2503,856.150625],[2504,856.554651],[2505,856.958677],[2506,857.362704],[2507,857.76673],[2508,858.170756],[2509,858.574782],[2510,858.978809],[2511,859.382835],[2512,859.786861],[2513,860.190887],[2514,860.594914],[2515,860.99894],[2516,861.402966],[2517,861.806992],[2518,862.211018],[2519,862.615045],[2520,863.019071],[2521,863.423097],[2522,863.827123],[2523,864.23115],[2524,864.635176],[2525,865.039202],[2526,865.443228],[2527,865.847254],[2528,866.251281],[2529,866.655307],[2530,867.059333],[2531,867.463359],[2532,867.867386],[2533,868.271412],[2534,868.675438],[2535,869.079464],[2536,869.48349],[2537,869.887517],[2538,870.291543],[2539,870.695569],[2540,871.099595],[2541,871.503622],[2542,871.907648],[2543,872.311674],[2544,872.7157],[2545,873.119727],[2546,873.523753],[2547,873.927779],[2548,874.331805],[2549,874.735831],[2550,875.139858],[2551,875.543884],[2552,875.94791],[2553,876.351936],[2554,876.755963],[2555,877.159989],[2556,877.564015],[2557,877.968041],[2558,878.372067],[2559,878.776094],[2560,879.18012],[2561,879.584146],[2562,879.988172],[2563,880.392199],[2564,880.796225],[2565,881.200251],[2566,881.604277],[2567,882.008303],[2568,882.41233],[2569,882.816356],[2570,883.220382],[2571,883.624408],[2572,884.028435],[2573,884.432461],[2574,884.836487],[2575,885.240513],[2576,885.64454],[2577,886.048566],[2578,886.452592],[2579,886.856618],[2580,887.260644],[2581,887.664671],[2582,888.068697],[2583,888.472723],[2584,888.876749],[2585,889.280776],[2586,889.684802],[2587,890.088828],[2588,890.492854],[2589,890.89688],[2590,891.300907],[2591,891.704933],[2592,892.108959],[2593,892.512985],[2594,892.917012],[2595,893.321038],[2596,893.725064],[2597,894.12909],[2598,894.533116],[2599,894.937143],[2600,895.341169],[2601,895.745195],[2602,896.149221],[2603,896.553248],[2604,896.957274],[2605,897.3613],[2606,897.765326],[2607,898.169353],[2608,898.573379],[2609,898.977405],[2610,899.381431],[2611,899.785457],[2612,900.189484],[2613,900.59351],[2614,900.997536],[2615,901.401562],[2616,901.805589],[2617,902.209615],[2618,902.613641],[2619,903.017667],[2620,903.421693],[2621,903.82572],[2622,904.229746],[2623,904.633772],[2624,905.037798],[2625,905.441825],[2626,905.845851],[2627,906.249877],[2628,906.653903],[2629,907.057929],[2630,907.461956],[2631,907.865982],[2632,908.270008],[2633,908.674034],[2634,909.078061],[2635,909.482087],[2636,909.886113],[2637,910.290139],[2638,910.694166],[2639,911.098192],[2640,911.502218],[2641,911.906244],[2642,912.31027],[2643,912.714297],[2644,913.118323],[2645,913.522349],[2646,913.926375],[2647,914.330402],[2648,914.734428],[2649,915.138454],[2650,915.54248],[2651,915.946506],[2652,916.350533],[2653,916.754559],[2654,917.158585],[2655,917.562611],[2656,917.966638],[2657,918.370664],[2658,918.77469],[2659,919.178716],[2660,919.582742],[2661,919.986769],[2662,920.390795],[2663,920.794821],[2664,921.198847],[2665,921.602874],[2666,922.0069],[2667,922.410926],[2668,922.814952],[2669,923.218979],[2670,923.623005],[2671,924.027031],[2672,924.431057],[2673,924.835083],[2674,925.23911],[2675,925.643136],[2676,926.047162],[2677,926.451188],[2678,926.855215],[2679,927.259241],[2680,927.663267],[2681,928.067293],[2682,928.471319],[2683,928.875346],[2684,929.279372],[2685,929.683398],[2686,930.087424],[2687,930.491451],[2688,930.895477],[2689,931.299503],[2690,931.703529],[2691,932.107555],[2692,932.511582],[2693,932.915608],[2694,933.319634],[2695,933.72366],[2696,934.127687],[2697,934.531713],[2698,934.935739],[2699,935.339765],[2700,935.743792],[2701,936.147818],[2702,936.551844],[2703,936.95587],[2704,937.359896],[2705,937.763923],[2706,938.167949],[2707,938.571975],[2708,938.976001],[2709,939.380028],[2710,939.784054],[2711,940.18808],[2712,940.592106],[2713,940.996132],[2714,941.400159],[2715,941.804185],[2716,942.208211],[2717,942.612237],[2718,943.016264],[2719,943.42029],[2720,943.824316],[2721,944.228342],[2722,944.632368],[2723,945.036395],[2724,945.440421],[2725,945.844447],[2726,946.248473],[2727,946.6525],[2728,947.056526],[2729,947.460552],[2730,947.864578],[2731,948.268605],[2732,948.672631],[2733,949.076657],[2734,949.480683],[2735,949.884709],[2736,950.288736],[2737,950.692762],[2738,951.096788],[2739,951.500814],[2740,951.904841],[2741,952.308867],[2742,952.712893],[2743,953.116919],[2744,953.520945],[2745,953.924972],[2746,954.328998],[2747,954.733024],[2748,955.13705],[2749,955.541077],[2750,955.945103],[2751,956.349129],[2752,956.753155],[2753,957.157181],[2754,957.561208],[2755,957.965234],[2756,958.36926],[2757,958.773286],[2758,959.177313],[2759,959.581339],[2760,959.985365],[2761,960.389391],[2762,960.793418],[2763,961.197444],[2764,961.60147],[2765,962.005496],[2766,962.409522],[2767,962.813549],[2768,963.217575],[2769,963.621601],[2770,964.025627],[2771,964.429654],[2772,964.83368],[2773,965.237706],[2774,965.641732],[2775,966.045758],[2776,966.449785],[2777,966.853811],[2778,967.257837],[2779,967.661863],[2780,968.06589],[2781,968.469916],[2782,968.873942],[2783,969.277968],[2784,969.681994],[2785,970.086021],[2786,970.490047],[2787,970.894073],[2788,971.298099],[2789,971.702126],[2790,972.106152],[2791,972.510178],[2792,972.914204],[2793,973.318231],[2794,973.722257],[2795,974.126283],[2796,974.530309],[2797,974.934335],[2798,975.338362],[2799,975.742388],[2800,976.146414],[2801,976.55044],[2802,976.954467],[2803,977.358493],[2804,977.762519],[2805,978.166545],[2806,978.570571],[2807,978.974598],[2808,979.378624],[2809,979.78265],[2810,980.186676],[2811,980.590703],[2812,980.994729],[2813,981.398755],[2814,981.802781],[2815,982.206807],[2816,982.610834],[2817,983.01486],[2818,983.418886],[2819,983.822912],[2820,984.226939],[2821,984.630965],[2822,985.034991],[2823,985.439017],[2824,985.843044],[2825,986.24707],[2826,986.651096],[2827,987.055122],[2828,987.459148],[2829,987.863175],[2830,988.267201],[2831,988.671227],[2832,989.075253],[2833,989.47928],[2834,989.883306],[2835,990.287332],[2836,990.691358],[2837,991.095384],[2838,991.499411],[2839,991.903437],[2840,992.307463],[2841,992.711489],[2842,993.115516],[2843,993.519542],[2844,993.923568],[2845,994.327594],[2846,994.73162],[2847,995.135647],[2848,995.539673],[2849,995.943699],[2850,996.347725],[2851,996.751752],[2852,997.155778],[2853,997.559804],[2854,997.96383],[2855,998.367857],[2856,998.771883],[2857,999.175909],[2858,999.579935],[2859,999.983961],[2860,1000.387988],[2861,1000.792014],[2862,1001.19604],[2863,1001.600066],[2864,1002.004093],[2865,1002.408119],[2866,1002.812145],[2867,1003.216171],[2868,1003.620197],[2869,1004.024224],[2870,1004.42825],[2871,1004.832276],[2872,1005.236302],[2873,1005.640329],[2874,1006.044355],[2875,1006.448381],[2876,1006.852407],[2877,1007.256433],[2878,1007.66046],[2879,1008.064486],[2880,1008.468512],[2881,1008.872538],[2882,1009.276565],[2883,1009.680591],[2884,1010.084617],[2885,1010.488643],[2886,1010.89267],[2887,1011.296696],[2888,1011.700722],[2889,1012.104748],[2890,1012.508774],[2891,1012.912801],[2892,1013.316827],[2893,1013.719935],[2894,1014.116012],[2895,1014.498822],[2896,1014.862962],[2897,1015.203859],[2898,1015.517772],[2899,1015.801793],[2900,1016.053841],[2901,1016.272672],[2902,1016.457868],[2903,1016.609845],[2904,1016.729851],[2905,1016.819964],[2906,1016.883093],[2907,1016.922979],[2908,1016.944195],[2909,1016.952145],[2910,1016.953063],[2911,1016.953063],[2912,1016.953063],[2913,1016.953063],[2914,1016.953063],[2915,1016.953063],[2916,1016.953063],[2917,1016.953063],[2918,1016.953063],[2919,1016.953063],[2920,1016.953063],[2921,1016.953063],[2922,1016.953063],[2923,1016.953063],[2924,1016.953063],[2925,1016.953063],[2926,1016.953063],[2927,1016.953063],[2928,1016.953063],[2929,1016.953063],[2930,1016.953063],[2931,1016.953063],[2932,1016.953063],[2933,1016.953063],[2934,1016.953063],[2935,1016.953063],[2936,1016.953063],[2937,1016.953063],[2938,1016.953063],[2939,1016.953063],[2940,1016.953063],[2941,1016.953063],[2942,1016.953063],[2943,1016.953063],[2944,1016.953063],[2945,1016.953063],[2946,1016.953063],[2947,1016.953063],[2948,1016.953063],[2949,1016.953063],[2950,1016.953063],[2951,1016.953063],[2952,1016.953063],[2953,1016.953063],[2954,1016.953063],[2955,1016.953063],[2956,1016.953063],[2957,1016.953063],[2958,1016.953063],[2959,1016.953063],[2960,1016.953063],[2961,1016.953063],[2962,1016.953063],[2963,1016.953063],[2964,1016.953063],[2965,1016.953063],[2966,1016.953063],[2967,1016.953063],[2968,1016.953063],[2969,1016.953063],[2970,1016.953063],[2971,1016.953063],[2972,1016.953063],[2973,1016.953063],[2974,1016.953063],[2975,1016.953063],[2976,1016.953063],[2977,1016.953063],[2978,1016.953063],[2979,1016.953063],[2980,1016.953063],[2981,1016.953063],[2982,1016.953063],[2983,1016.953063],[2984,1016.953063],[2985,1016.953063],[2986,1016.953063],[2987,1016.953063],[2988,1016.953063],[2989,1016.953063],[2990,1016.953063],[2991,1016.953063],[2992,1016.953063],[2993,1016.953063],[2994,1016.953063],[2995,1016.953063],[2996,1016.953063],[2997,1016.953063],[2998,1016.953063],[2999,1016.953063],[3000,1016.953063],[3001,1016.952411],[3002,1016.946769],[3003,1016.931712],[3004,1016.903404],[3005,1016.8586],[3006,1016.794645],[3007,1016.709474],[3008,1016.601613],[3009,1016.470176],[3010,1016.314868],[3011,1016.135984],[3012,1015.934409],[3013,1015.711618],[3014,1015.469677],[3015,1015.21124],[3016,1014.939552],[3017,1014.658448],[3018,1014.372354],[3019,1014.085609],[3020,1013.798864],[3021,1013.512118],[3022,1013.225373],[3023,1012.938628],[3024,1012.651882],[3025,1012.365137],[3026,1012.078391],[3027,1011.791646],[3028,1011.504901],[3029,1011.218155],[3030,1010.93141],[3031,1010.644664],[3032,1010.357919],[3033,1010.071174],[3034,1009.784428],[3035,1009.497683],[3036,1009.210937],[3037,1008.924192],[3038,1008.637447],[3039,1008.350701],[3040,1008.063956],[3041,1007.777211],[3042,1007.490465],[3043,1007.20372],[3044,1006.916974],[3045,1006.630229],[3046,1006.343484],[3047,1006.056738],[3048,1005.769993],[3049,1005.483247],[3050,1005.196502],[3051,1004.909757],[3052,1004.623011],[3053,1004.336266],[3054,1004.049521],[3055,1003.762775],[3056,1003.47603],[3057,1003.189284],[3058,1002.902539],[3059,1002.615794],[3060,1002.329048],[3061,1002.042303],[3062,1001.755557],[3063,1001.468812],[3064,1001.182067],[3065,1000.895321],[3066,1000.608576],[3067,1000.321831],[3068,1000.035085],[3069,999.74834],[3070,999.461594],[3071,999.174849],[3072,998.888104],[3073,998.601358],[3074,998.314613],[3075,998.027867],[3076,997.741122],[3077,997.454377],[3078,997.167631],[3079,996.880886],[3080,996.594141],[3081,996.307395],[3082,996.02065],[3083,995.733904],[3084,995.447159],[3085,995.160414],[3086,994.873668],[3087,994.586923],[3088,994.300177],[3089,994.013432],[3090,993.726687],[3091,993.439941],[3092,993.153196],[3093,992.86645],[3094,992.579705],[3095,992.29296],[3096,992.006214],[3097,991.719469],[3098,991.432724],[3099,991.145978],[3100,990.859233],[3101,990.572487],[3102,990.285742],[3103,989.998997],[3104,989.712251],[3105,989.425506],[3106,989.13876],[3107,988.852015],[3108,988.56527],[3109,988.278524],[3110,987.991779],[3111,987.705034],[3112,987.418288],[3113,987.131543],[3114,986.844797],[3115,986.558052],[3116,986.271307],[3117,985.984561],[3118,985.697816],[3119,985.41107],[3120,985.124325],[3121,984.83758],[3122,984.550834],[3123,984.264089],[3124,983.977344],[3125,983.690598],[3126,983.403853],[3127,983.117107],[3128,982.830362],[3129,982.543617],[3130,982.256871],[3131,981.970126],[3132,981.68338],[3133,981.396635],[3134,981.10989],[3135,980.823144],[3136,980.536399],[3137,980.249654],[3138,979.962908],[3139,979.676163],[3140,979.389417],[3141,979.102672],[3142,978.815927],[3143,978.529181],[3144,978.242436],[3145,977.95569],[3146,977.668945],[3147,977.3822],[3148,977.095454],[3149,976.808709],[3150,976.521964],[3151,976.235218],[3152,975.948473],[3153,975.661727],[3154,975.374982],[3155,975.088237],[3156,974.801491],[3157,974.514746],[3158,974.228],[3159,973.941255],[3160,973.65451],[3161,973.367764],[3162,973.081019],[3163,972.794273],[3164,972.507528],[3165,972.220783],[3166,971.934037],[3167,971.647292],[3168,971.360547],[3169,971.073801],[3170,970.787056],[3171,970.50031],[3172,970.213565],[3173,969.92682],[3174,969.640074],[3175,969.353329],[3176,969.066583],[3177,968.779838],[3178,968.493093],[3179,968.206347],[3180,967.919602],[3181,967.632857],[3182,967.346111],[3183,967.059366],[3184,966.77262],[3185,966.485875],[3186,966.19913],[3187,965.912384],[3188,965.625639],[3189,965.338893],[3190,965.052148],[3191,964.765403],[3192,964.478657],[3193,964.191912],[3194,963.905167],[3195,963.618421],[3196,963.331676],[3197,963.04493],[3198,962.758185],[3199,962.47144],[3200,962.184694],[3201,961.897949],[3202,961.611203],[3203,961.324458],[3204,961.037713],[3205,960.750967],[3206,960.464222],[3207,960.177477],[3208,959.890731],[3209,959.603986],[3210,959.31724],[3211,959.030495],[3212,958.74375],[3213,958.457004],[3214,958.170259],[3215,957.883513],[3216,957.596768],[3217,957.310023],[3218,957.023277],[3219,956.736532],[3220,956.449787],[3221,956.163041],[3222,955.876296],[3223,955.58955],[3224,955.302805],[3225,955.01606],[3226,954.729314],[3227,954.442569],[3228,954.155823],[3229,953.869078],[3230,953.582333],[3231,953.295587],[3232,953.008842],[3233,952.722096],[3234,952.435351],[3235,952.148606],[3236,951.86186],[3237,951.575115],[3238,951.28837],[3239,951.001624],[3240,950.714879],[3241,950.428133],[3242,950.141388],[3243,949.854643],[3244,949.567897],[3245,949.281152],[3246,948.994406],[3247,948.707661],[3248,948.420916],[3249,948.13417],[3250,947.847425],[3251,947.56068],[3252,947.273934],[3253,946.98784],[3254,946.706737],[3255,946.435049],[3256,946.176612],[3257,945.93467],[3258,945.71188],[3259,945.510305],[3260,945.331421],[3261,945.176113],[3262,945.044676],[3263,944.936814],[3264,944.851644],[3265,944.787689],[3266,944.742885],[3267,944.714577],[3268,944.699519],[3269,944.693877],[3270,944.693226],[3271,944.700231],[3272,944.721181],[3273,944.755881],[3274,944.804007],[3275,944.865109],[3276,944.938616],[3277,945.023843],[3278,945.119993],[3279,945.22617],[3280,945.341381],[3281,945.464551],[3282,945.59453],[3283,945.730104],[3284,945.870008],[3285,946.012934],[3286,946.15755],[3287,946.302504],[3288,946.446444],[3289,946.588024],[3290,946.725924],[3291,946.858856],[3292,946.985578],[3293,947.104908],[3294,947.215731],[3295,947.317013],[3296,947.407808],[3297,947.487268],[3298,947.554651],[3299,947.609329],[3300,947.65079],[3301,947.678647],[3302,947.692642],[3303,947.692642],[3304,947.678647],[3305,947.65079],[3306,947.609329],[3307,947.554651],[3308,947.487268],[3309,947.407808],[3310,947.317013],[3311,947.215731],[3312,947.104908],[3313,946.985578],[3314,946.858856],[3315,946.725924],[3316,946.588024],[3317,946.446444],[3318,946.302504],[3319,946.15755],[3320,946.012934],[3321,945.870008],[3322,945.730104],[3323,945.59453],[3324,945.464551],[3325,945.341381],[3326,945.22617],[3327,945.119993],[3328,945.023843],[3329,944.938616],[3330,944.865109],[3331,944.804007],[3332,944.755881],[3333,944.721181],[3334,944.700231],[3335,944.693226],[3336,944.693226],[3337,944.693226],[3338,944.693226],[3339,944.693226],[3340,944.693226],[3341,944.693226],[3342,944.693226],[3343,944.693226],[3344,944.693226],[3345,944.693226],[3346,944.693226],[3347,944.693226],[3348,944.693226],[3349,944.693226],[3350,944.693226],[3351,944.693226],[3352,944.693226],[3353,944.693226],[3354,944.693226],[3355,944.693226],[3356,944.693226],[3357,944.693226],[3358,944.693226],[3359,944.693226],[3360,944.693226],[3361,944.693226],[3362,944.693226],[3363,944.693226],[3364,944.693226],[3365,944.693226],[3366,944.693226],[3367,944.693226],[3368,944.693226],[3369,944.693226],[3370,944.693226],[3371,944.693226],[3372,944.693226],[3373,944.693226],[3374,944.693226],[3375,944.693226],[3376,944.693226],[3377,944.693226],[3378,944.693226],[3379,944.693226],[3380,944.693226],[3381,944.693226],[3382,944.693226],[3383,944.693226],[3384,944.693226],[3385,944.693226],[3386,944.693226],[3387,944.693226],[3388,944.693226],[3389,944.693226],[3390,944.693226],[3391,944.693226],[3392,944.693226],[3393,944.693226],[3394,944.693226],[3395,944.693226],[3396,944.693226],[3397,944.693226],[3398,944.693226],[3399,944.693226],[3400,944.693226],[3401,944.693289],[3402,944.693658],[3403,944.694452],[3404,944.695591],[3405,944.696783],[3406,944.69757],[3407,944.697414],[3408,944.695832],[3409,944.692535],[3410,944.68755],[3411,944.681298],[3412,944.674604],[3413,944.668621],[3414,944.664687],[3415,944.664112],[3416,944.667931],[3417,944.676669],[3418,944.690149],[3419,944.707388],[3420,944.726608],[3421,944.745381],[3422,944.760897],[3423,944.770326],[3424,944.771246],[3425,944.762057],[3426,944.742343],[3427,944.713094],[3428,944.676761],[3429,944.637112],[3430,944.598874],[3431,944.56721],[3432,944.547066],[3433,944.542479],[3434,944.555937],[3435,944.587872],[3436,944.636382],[3437,944.697236],[3438,944.764184],[3439,944.829561],[3440,944.885138],[3441,944.923119],[3442,944.937171],[3443,944.923355],[3444,944.880834],[3445,944.812241],[3446,944.723637],[3447,944.624038],[3448,944.524526],[3449,944.437045],[3450,944.372991],[3451,944.341776],[3452,944.34953],[3453,944.398127],[3454,944.484659],[3455,944.60147],[3456,944.736774],[3457,944.875809],[3458,945.002432],[3459,945.100975],[3460,945.158155],[3461,945.164804],[3462,945.117203],[3463,945.017831],[3464,944.875415],[3465,944.704225],[3466,944.522677],[3467,944.351362],[3468,944.21072],[3469,944.118615],[3470,944.088106],[3471,944.125673],[3472,944.230154],[3473,944.392528],[3474,944.596625],[3475,944.820709],[3476,945.039785],[3477,945.228388],[3478,945.363537],[3479,945.427521],[3480,945.410171],[3481,945.31034],[3482,945.13637],[3483,944.905483],[3484,944.642096],[3485,944.375244],[3486,944.135369],[3487,943.950848],[3488,943.844627],[3489,943.831396],[3490,943.915626],[3491,944.090728],[3492,944.339484],[3493,944.635706],[3494,944.947004],[3495,945.238331],[3496,945.475953],[3497,945.63136],[3498,945.68469],[3499,945.627233],[3500,945.462719],[3501,945.2072],[3502,944.887504],[3503,944.538418],[3504,944.19888],[3505,943.90762],[3506,943.698712],[3507,943.597581],[3508,943.617911],[3509,943.759843],[3510,944.009687],[3511,944.341224],[3512,944.71846],[3513,945.099557],[3514,945.441503],[3515,945.704995],[3516,945.85898],[3517,945.884328],[3518,945.776197],[3519,945.544802],[3520,945.214472],[3521,944.821086],[3522,944.408148],[3523,944.021948],[3524,943.706333],[3525,943.497698],[3526,943.420765],[3527,943.485647],[3528,943.686537],[3529,944.002204],[3530,944.398244],[3531,944.83086],[3532,945.251737],[3533,945.613478],[3534,945.874979],[3535,946.006134],[3536,945.991319],[3537,945.831263],[3538,945.543064],[3539,945.158355],[3540,944.719804],[3541,944.27635],[3542,943.877695],[3543,943.568697],[3544,943.384282],[3545,943.34547],[3546,943.456958],[3547,943.706558],[3548,944.066532],[3549,944.496704],[3550,944.948973],[3551,945.372737],[3552,945.720596],[3553,945.95369],[3554,946.04608],[3555,945.987652],[3556,945.785234],[3557,945.461792],[3558,945.053811],[3559,944.60714],[3560,944.171812],[3561,943.796388],[3562,943.522506],[3563,943.380223],[3564,943.384697],[3565,943.534558],[3566,943.812162],[3567,944.185678],[3568,944.612758],[3569,945.045374],[3570,945.435258],[3571,945.739326],[3572,945.924474],[3573,945.971209],[3574,945.875704],[3575,945.650081],[3576,945.320879],[3577,944.925924],[3578,944.509956],[3579,944.119524],[3580,943.797747],[3581,943.579512],[3582,943.487675],[3583,943.530655],[3584,943.701694],[3585,943.979834],[3586,944.332483],[3587,944.719244],[3588,945.096571],[3589,945.422705],[3590,945.662319],[3591,945.790371],[3592,945.794724],[3593,945.677268],[3594,945.453444],[3595,945.15025],[3596,944.802984],[3597,944.451121],[3598,944.133802],[3599,943.885454],[3600,943.732041],[3601,943.688344],[3602,943.756566],[3603,943.926383],[3604,944.176403],[3605,944.476842],[3606,944.793068],[3607,945.089612],[3608,945.33416],[3609,945.501088],[3610,945.574145],[3611,945.548012],[3612,945.428576],[3613,945.231939],[3614,944.982305],[3615,944.709017],[3616,944.443108],[3617,944.213764],[3618,944.045119],[3619,943.953713],[3620,943.946906],[3621,944.022366],[3622,944.168684],[3623,944.366978],[3624,944.593295],[3625,944.82149],[3626,945.026241],[3627,945.185866],[3628,945.284605],[3629,945.31415],[3630,945.274264],[3631,945.172464],[3632,945.022836],[3633,944.844159],[3634,944.657579],[3635,944.484118],[3636,944.342317],[3637,944.246262],[3638,944.204217],[3639,944.217988],[3640,944.283044],[3641,944.389365],[3642,944.522864],[3643,944.667201],[3644,944.805758],[3645,944.923534],[3646,945.008754],[3647,945.054011],[3648,945.056845],[3649,945.019717],[3650,944.949419],[3651,944.856022],[3652,944.751513],[3653,944.648299],[3654,944.557756],[3655,944.489001],[3656,944.448011],[3657,944.43716],[3658,944.455223],[3659,944.497788],[3660,944.558019],[3661,944.627641],[3662,944.69802],[3663,944.761198],[3664,944.810762],[3665,944.842462],[3666,944.85451],[3667,944.847567],[3668,944.824425],[3669,944.789476],[3670,944.748019],[3671,944.705536],[3672,944.667011],[3673,944.636379],[3674,944.616166],[3675,944.607334],[3676,944.609354],[3677,944.620449],[3678,944.637973],[3679,944.658858],[3680,944.680068],[3681,944.698982],[3682,944.713684],[3683,944.723114],[3684,944.727084],[3685,944.726167],[3686,944.721497],[3687,944.714515],[3688,944.706705],[3689,944.699364],[3690,944.693438],[3691,944.689435],[3692,944.687432],[3693,944.687142],[3694,944.688047],[3695,944.689542],[3696,944.691081],[3697,944.69228],[3698,944.692974],[3699,944.693217],[3700,944.693226],[3701,944.693226],[3702,944.693226],[3703,944.693226],[3704,944.693226],[3705,944.693226],[3706,944.693226],[3707,944.693226],[3708,944.693226],[3709,944.693226],[3710,944.693226],[3711,944.693226],[3712,944.693226],[3713,944.693226],[3714,944.693226],[3715,944.693226],[3716,944.693226],[3717,944.693226],[3718,944.693226],[3719,944.693226],[3720,944.693226],[3721,944.693226],[3722,944.693226],[3723,944.693226],[3724,944.693226],[3725,944.693226],[3726,944.693226],[3727,944.693226],[3728,944.693226],[3729,944.693226],[3730,944.693226],[3731,944.693226],[3732,944.693226],[3733,944.693226],[3734,944.693226],[3735,944.693226],[3736,944.693226],[3737,944.693226],[3738,944.693226],[3739,944.693226],[3740,944.693226],[3741,944.693226],[3742,944.693226],[3743,944.693226],[3744,944.693226],[3745,944.693226],[3746,944.693226],[3747,944.693226],[3748,944.693226],[3749,944.693226],[3750,944.693226],[3751,944.693226],[3752,944.693226],[3753,944.693226],[3754,944.693226],[3755,944.693226],[3756,944.693226],[3757,944.693226],[3758,944.693226],[3759,944.693226],[3760,944.693226],[3761,944.693226],[3762,944.693226],[3763,944.693226],[3764,944.693226],[3765,944.693226],[3766,944.693226],[3767,944.693226],[3768,944.693226],[3769,944.693226],[3770,944.693226],[3771,944.693226],[3772,944.693226],[3773,944.693226],[3774,944.693226],[3775,944.693226],[3776,944.693226],[3777,944.693226],[3778,944.693226],[3779,944.693226],[3780,944.693226],[3781,944.693226],[3782,944.693226],[3783,944.693226],[3784,944.693226],[3785,944.693226],[3786,944.693226],[3787,944.693226],[3788,944.693226],[3789,944.693226],[3790,944.693226],[3791,944.693226],[3792,944.693226],[3793,944.693226],[3794,944.693226],[3795,944.693226],[3796,944.693226],[3797,944.693226],[3798,944.693226],[3799,944.693226],[3800,944.693226],[3801,944.693226],[3802,944.693226],[3803,944.693226],[3804,944.693226],[3805,944.693226],[3806,944.693226],[3807,944.693226],[3808,944.693226],[3809,944.693226],[3810,944.693226],[3811,944.693226],[3812,944.693226],[3813,944.693226],[3814,944.693226],[3815,944.693226],[3816,944.693226],[3817,944.693226],[3818,944.693226],[3819,944.693226],[3820,944.693226],[3821,944.693226],[3822,944.693226],[3823,944.693226],[3824,944.693226],[3825,944.693226],[3826,944.693226],[3827,944.693226],[3828,944.693226],[3829,944.693226],[3830,944.693226],[3831,944.693226],[3832,944.693226],[3833,944.693226],[3834,944.693226],[3835,944.693226],[3836,944.693226],[3837,944.693226],[3838,944.693226],[3839,944.693226],[3840,944.693226],[3841,944.693226],[3842,944.693226],[3843,944.693226],[3844,944.693226],[3845,944.693226],[3846,944.693226],[3847,944.693226],[3848,944.693226],[3849,944.693226],[3850,944.693226],[3851,944.693226],[3852,944.693226],[3853,944.693226],[3854,944.693226],[3855,944.693226],[3856,944.693226],[3857,944.693226],[3858,944.693226],[3859,944.693226],[3860,944.693226],[3861,944.693226],[3862,944.693226],[3863,944.693226],[3864,944.693226],[3865,944.693226],[3866,944.693226],[3867,944.693226],[3868,944.693226],[3869,944.693226],[3870,944.693226],[3871,944.693226],[3872,944.693226],[3873,944.693226],[3874,944.693226],[3875,944.693226],[3876,944.693226],[3877,944.693226],[3878,944.693226],[3879,944.693226],[3880,944.693226],[3881,944.693226],[3882,944.693226],[3883,944.693226],[3884,944.693226],[3885,944.693226],[3886,944.693226],[3887,944.693226],[3888,944.693226],[3889,944.693226],[3890,944.693226],[3891,944.693226],[3892,944.693226],[3893,944.693226],[3894,944.693226],[3895,944.693226],[3896,944.693226],[3897,944.693226],[3898,944.693226],[3899,944.693226],[3900,944.693226],[3901,944.693226],[3902,944.693226],[3903,944.693226],[3904,944.693226],[3905,944.693226],[3906,944.693226],[3907,944.693226],[3908,944.693226],[3909,944.693226],[3910,944.693226],[3911,944.693226],[3912,944.693226],[3913,944.693226],[3914,944.693226],[3915,944.693226],[3916,944.693226],[3917,944.693226],[3918,944.693226],[3919,944.693226],[3920,944.693226],[3921,944.693226],[3922,944.693226],[3923,944.693226],[3924,944.693226],[3925,944.693226],[3926,944.693226],[3927,944.693226],[3928,944.693226],[3929,944.693226],[3930,944.693226],[3931,944.693226],[3932,944.693226],[3933,944.693226],[3934,944.693226],[3935,944.693226],[3936,944.693226],[3937,944.693226],[3938,944.693226],[3939,944.693226],[3940,944.693226],[3941,944.693226],[3942,944.693226],[3943,944.693226],[3944,944.693226],[3945,944.693226],[3946,944.693226],[3947,944.693226],[3948,944.693226],[3949,944.693226],[3950,944.693226],[3951,944.693226],[3952,944.693226],[3953,944.693226],[3954,944.693226],[3955,944.693226],[3956,944.693226],[3957,944.693226],[3958,944.693226],[3959,944.693226],[3960,944.693226],[3961,944.693226],[3962,944.693226],[3963,944.693226],[3964,944.693226],[3965,944.693226],[3966,944.693226],[3967,944.693226],[3968,944.693226],[3969,944.693226],[3970,944.693226],[3971,944.693226],[3972,944.693226],[3973,944.693226],[3974,944.693226],[3975,944.693226],[3976,944.693226],[3977,944.693226],[3978,944.693226],[3979,944.693226],[3980,944.693226],[3981,944.693226],[3982,944.693226],[3983,944.693226],[3984,944.693226],[3985,944.693226],[3986,944.693226],[3987,944.693226],[3988,944.693226],[3989,944.693226],[3990,944.693226],[3991,944.693226],[3992,944.693226],[3993,944.693226],[3994,944.693226],[3995,944.693226],[3996,944.693226],[3997,944.693226],[3998,944.693226],[3999,944.693226],[4000,944.693226],[4080,944.6932256910281]],"linearTerrain":true,"surfaces":[{"from":580,"to":940,"kind":"snow"}],"gears":[16.72,30.87,45.01,60.65,74.8,89.43,100.59,114.83,131.23,143.06,158.23,171.4,187.1,198.89,215.34,227.86,240.62,255.45,269.37,283.83,298.7,310.6,324.98,340.85,354.62,366.54,383.15,395.8,409.1,423.66,439.12,451.31,467.3,479.29,492.64,508.69,521.88,537.33,551.26,564.9,578.91,591.18,606.24,620.7,634.95,648.02,663.48,674.79,689.66,702.64,718.38,731.08,745.99,759.03,773.19,787.29,800.75,815.21,831.09,842.61,858.57,870.82,886.13,901.46,914.75,926.61,941.06,955.65,969.03,983.5,999.1,1012.24,1026.69,1041.46,1054.65,1067.36,1081.68,1096.23,1110.7,1122.91,1137.33,1152.85,1166.47,1178.8,1194.85,1209.04,1221.5,1235.14,1250.59,1265.4,1278.44,1292.02,1305.32,1321.02,1332.62,1347.39,1363.28,1376.67,1390.06,1403.77,1418.9,1432.86,1445.57,1459.19,1474.34,1488.52,1501.55,1516.39,1530.79,1544.41,1557.2,1572.01,1587.14,1600.69,1614.72,1626.74,1642.78,1657.45,1669.55,1682.58,1697.95,1712.97,1727.15,1741.26,1753.89,1767.7,1781.13,1797.42,1810.1,1823.64,1837.54,1851.99,1866.22,1880.42,1893.68,1908.67,1921.44,1937.22,1950.69,1962.5,1977.98,1992.76,2006.58,2020.04,2034.08,2048.46,2060.81,2075.71,2089.08,2102.56,2119.09,2133.27,2144.81,2158.59,2174.64,2189.35,2202.9,2216.98,2231.42,2245.31,2258.4,2272.1,2284.8,2300.78,2313.11,2329.47,2342.17,2355.81,2371.45,2384.24,2399.1,2412.54,2425.5,2441.31,2453.47,2467.53,2483.39,2496.84,2510.2,2525.34,2536.67,2552.75,2566.62,2580.7,2592.97,2608.6,2621.76,2635.42,2651.41,2662.71,2679.49,2691.72,2704.96,2719.42,2733.49,2746.98,2761.87,2776.83,2791.09,2802.8,2818.26,2832.87,2847.25,2858.5,2874.28,2888.05,2901.18,2915.64,2929.42,2945.17,2956.77,2970.94,2986.64,3000.34,3015.18,3027.31,3042.99,3055.63,3071.17,3084.21,3096.6,3112.18,3124.61,3138.58,3155.49,3168.67,3180.59,3194.9,3208.95,3222.99,3238.96,3253.08,3264.95,3278.67,3293.02,3309.04,3320.51,3336.51,3349.65,3363.07,3378.97,3390.88,3405.68,3418.98,3434.17,3449.18,3460.71,3476.41,3489.29,3505.34,3517.65,3530.97,3545.13,3561.45,3575.22,3589.26,3601.58,3615.02,3630.83,3644.85,3658.05,3671.52,3687.04,3701.42,3713.43,3727.62,3743.23,3756.5,3770.76,3785.08,3796.57,3812.97,3825.72,3840.66,3854.4,3868.49,3882.43,3894.65,3910.52,3922.64,3938.48,3950.81,3965.42,3978.54,3993.32],"coinValues":[50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,55,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,70,75,75,75,75,75,75,75,75,75,75,75,75,75,75,75,75,75,75,75,75,75,75,75,75,75,75,75,75,75,75,75,75,75,75,75,75,75,75,75,75,75,75,80,80,80,80,80,80,80,80,80,80,80,80,80,80,80,80,80,80,80,80,80,80,80,80,80,80,80,80,80,80,80,80,80,80,80],"bridges":[],"checkpoints":[{"id":"mastery-summit-checkpoint-0","x":500,"reward":580},{"id":"mastery-summit-checkpoint-1","x":940,"reward":580},{"id":"mastery-summit-checkpoint-2","x":1230,"reward":580},{"id":"mastery-summit-checkpoint-3","x":2910,"reward":580},{"id":"mastery-summit-checkpoint-4","x":3700,"reward":580}],"fuelValidation":{"state":"measured in complete recommended-profile simulation","targetRho":[0.8,0.92],"referenceProfile":{"engine":9,"suspension":9,"tires":9,"tank":9},"legs":[{"from":9,"to":180,"T_ref":9.0667,"C_ref":76,"rho":0.1193,"fuelRemaining":66.9333,"arrivalTick":544},{"from":180,"to":720,"T_ref":28.85,"C_ref":76,"rho":0.3796,"fuelRemaining":47.15,"arrivalTick":2275},{"from":720,"to":1270,"T_ref":43.6333,"C_ref":76,"rho":0.5741,"fuelRemaining":32.3667,"arrivalTick":4893},{"from":1270,"to":2750,"T_ref":66.0333,"C_ref":76,"rho":0.8689,"fuelRemaining":9.9667,"arrivalTick":8855},{"from":2750,"to":3560,"T_ref":36.6,"C_ref":76,"rho":0.4816,"fuelRemaining":39.4,"arrivalTick":11051},{"from":3560,"to":4009,"T_ref":23.8667,"C_ref":76,"rho":0.314,"fuelRemaining":52.1333,"arrivalTick":12483,"finish":true}]},"streams":{"geometry":"geometry","coins":"coins","fuel":"fuel","decorations":"decorations","fuelMarker":0.8764433218166232},"decorationSeed":1879166209,"validation":{"state":"measured full-course attempts","sampleCount":1000,"source":"artifacts/pixel-drive-campaign-balance.json","notAnImpossibilityProof":true,"profiles":[{"name":"base","upgrades":{"engine":0,"suspension":0,"tires":0,"tank":0},"n":100,"wins":0,"distanceRange":[249.11,298.04],"failures":{"route_exit":100}},{"name":"recommended","upgrades":{"engine":9,"suspension":9,"tires":9,"tank":9},"n":100,"wins":49,"distanceRange":[214.4,4000.53],"failures":{"overturned":41,"route_exit":10}},{"name":"maximum","upgrades":{"engine":10,"suspension":10,"tires":10,"tank":10},"n":100,"wins":54,"distanceRange":[213.46,4000.43],"failures":{"overturned":36,"route_exit":10}},{"name":"engine-only","upgrades":{"engine":10,"suspension":0,"tires":0,"tank":0},"n":100,"wins":0,"distanceRange":[218.67,872.59],"failures":{"overturned":1,"route_exit":98,"fuel":1}},{"name":"tank-only","upgrades":{"engine":0,"suspension":0,"tires":0,"tank":10},"n":100,"wins":0,"distanceRange":[249.11,298.04],"failures":{"fuel":58,"route_exit":42}},{"name":"strong-F0","upgrades":{"engine":10,"suspension":10,"tires":10,"tank":0},"n":100,"wins":0,"distanceRange":[213.46,2314.72],"failures":{"overturned":43,"route_exit":54,"fuel":3}},{"name":"recommended-minus-engine","upgrades":{"engine":8,"suspension":9,"tires":9,"tank":9},"n":100,"wins":53,"distanceRange":[214.07,4000.44],"failures":{"overturned":35,"route_exit":12}},{"name":"recommended-minus-suspension","upgrades":{"engine":9,"suspension":8,"tires":9,"tank":9},"n":100,"wins":57,"distanceRange":[214.76,4000.5],"failures":{"overturned":31,"route_exit":12}},{"name":"recommended-minus-tires","upgrades":{"engine":9,"suspension":9,"tires":8,"tank":9},"n":100,"wins":56,"distanceRange":[213.93,4000.52],"failures":{"overturned":38,"route_exit":6}},{"name":"recommended-minus-tank","upgrades":{"engine":9,"suspension":9,"tires":9,"tank":8},"n":100,"wins":47,"distanceRange":[214.4,4000.53],"failures":{"overturned":40,"route_exit":13}}],"reference":{"upgrades":{"engine":9,"suspension":9,"tires":9,"tank":9},"targetSpeed":24,"holdTicks":12,"ticks":12483,"seconds":208.05,"inputChanges":148}}}]}');

/***/ }

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	const __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		const cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		const module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		__webpack_modules__[moduleId].call(module.exports, module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
let __webpack_exports__ = {};
// This entry needs to be wrapped in an IIFE because it needs to be in strict mode.
(() => {
"use strict";
/* Build-time entry only. Production executes the committed standalone bundle. */

const engine = __webpack_require__(879);
const progression = __webpack_require__(806);
// Planck 1.5.0 declares Node >=24; match its supported server runtime.
if (Number(process.versions.node.split(".")[0]) < 24) process.exit(1);
const MAX_BYTES = 1048576;
const metadata = {version: engine.CONFIG.version, config_sha256: "2be90f12364f0ddd093e83a240084fb5fef5486f61ce4d88b2e32b61d1edfd50"};
function reply(value) {
  const output = JSON.stringify({...metadata, ...value});
  if (Buffer.byteLength(output) > 262144) process.exit(1);
  process.stdout.write(output);
}
let size = 0;
const chunks = [];
process.stdin.on("data", chunk => {
  size += chunk.length;
  if (size > MAX_BYTES) process.exit(1);
  chunks.push(chunk);
});
process.stdin.on("error", () => process.exit(1));
process.stdin.on("end", () => {
  let data;
  try { data = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { return reply({ok:false, kind:"protocol"}); }
  if (!data || data.version !== metadata.version || data.config_sha256 !== metadata.config_sha256)
    return reply({ok:false, kind:"protocol"});
  if (data.op === "health") return reply({ok:true});
  if (["migrate", "award", "purchase"].includes(data.op)) {
    try {
      const result = data.op === "migrate" ? {progress: progression.migrateProgress(data.profile)} :
        data.op === "award" ? progression.awardProgress(data.profile, engine.getLevel(data.level), data.outcome) :
          progression.purchaseProgress(data.profile, data.part, data.from);
      return reply({ok:true, ...result});
    } catch (_) {return reply({ok:false, kind:"invalid_economy"});}
  }
  if (data.op !== "replay") return reply({ok:false, kind:"protocol"});
  try {
    if (!Number.isInteger(data.level) || data.level < 1 || data.level > engine.CONFIG.levels.length
        || !Array.isArray(data.events) || typeof data.abandon !== "boolean")
      return reply({ok:false, kind:"invalid_replay", error:"Некоректний заїзд"});
    const outcome = engine.replay(engine.getLevel(data.level), data.upgrades, data.events, data.ticks, data.abandon);
    reply({ok:true, outcome});
  } catch (error) {
    if (error.code === "INVALID_REPLAY" || error.name === "ReplayValidationError")
      reply({ok:false, kind:"invalid_replay", error:String(error.message).slice(0,200)});
    else reply({ok:false, kind:"worker_failure"});
  }
});

})();

/******/ })()
;