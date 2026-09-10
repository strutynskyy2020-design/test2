// SI units, Y up, continuous counter-clockwise radians. Browser physics; replay is a development tool only.
const {
  Vec2,
  World,
  Polygon,
  Circle,
  WheelJoint,
  PrismaticJoint
} = require('./vendor/planck');
const CONFIG = require('./config.json'),
  PHYSICS = require('./physicsConfig'),
  TEST_LEVEL = require('./testCourse');
const {SURFACES} = require('./fleetConfig');
const {vehiclePhysics, upgradeStats} = require('./vehiclePhysics');
const {applyAerodynamics, applyJet, applyRepulsors} = require('./physicsControllers');
const {terrain, surfaceAt, supportSurface, syncTerrain} = require('./terrainPhysics');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const freshUpgrades = () => ({
  engine: 0,
  suspension: 0,
  tires: 0,
  tank: 0
});
function getUpgradeStats(upgrades = freshUpgrades(), vehicle = 'wanderer') {
  const u = {...freshUpgrades(), ...upgrades};
  const p = typeof vehicle === 'string' ? vehiclePhysics(vehicle, 'earth', u) : vehicle;
  return upgradeStats(u, p);
}
function getTestLevel(worldId = 'earth') { return {...TEST_LEVEL, worldId, mode: 'test', stageId: `test-${worldId}`}; }
function getEndlessLevel(worldId = 'earth', seed) { return require('./endlessGenerator').createEndlessLevel(worldId,seed); }
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
function surfaceFriction(l, x, p = PHYSICS, role = 'wheel') {
  const kind = surfaceAt(l,x), base = p.materials?.[kind] ?? SURFACES[kind]?.friction ?? 1;
  if (role === 'ski') return kind === 'snow' ? .035 : kind === 'ice' ? .02 : .28;
  if (role === 'roller') return Math.min(1.35, base * (kind === 'snow' ? 1.65 : kind === 'sand' ? 1.2 : 1.05));
  return base;
}
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
function readContacts(s) {
  const f = s._physics,
    contacts = [],
    support = f.wheels.map(() => false);
  let head = false;
  for (let c = f.world.getContactList(); c; c = c.getNext()) {
    if (!c.isTouching() || !c.isEnabled()) continue;
    const a = c.getFixtureA().getUserData() || {},
      b = c.getFixtureB().getUserData() || {};
    if (a.kind === 'head' && ['road','ceiling'].includes(b.kind) || b.kind === 'head' && ['road','ceiling'].includes(a.kind)) {
      head = true;
      continue;
    }
    const wheel = a.kind === 'wheel' ? a : b.kind === 'wheel' ? b : null;
    if (!wheel || !['road','ceiling'].includes(a.kind) && !['road','ceiling'].includes(b.kind)) continue;
    const m = c.getWorldManifold(null);
    if (!m) continue;
    const sign = a.kind === 'wheel' ? -1 : 1,
      nx = m.normal.x * sign,
      ny = m.normal.y * sign;
    if (ny > .12) support[wheel.index] = true;
    for (let i = 0; i < c.getManifold().pointCount; i++) contacts.push({
      x: m.points[i].x + f.originX,
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
  s.x = pos.x + f.originX;
  s.y = pos.y;
  s.vx = v.x;
  s.vy = v.y;
  s.angle = b.getAngle();
  s.av = b.getAngularVelocity();
  s.grounded = contact.support.filter(Boolean).length + (f.repulsors || []).filter(r => r.active && r.force > 0).length;
  s.wheels = f.wheels.map((w, i) => {
    const pos = w.getPosition(),
      v = w.getLinearVelocity(),
      a = b.getWorldPoint(Vec2(p.supportOffsets[i], p.mountY)),
      omega = w.getAngularVelocity(),
      normal = contact.contacts.find(c => c.wheel === i) || {
        nx: 0,
        ny: 1
      };
    return {
      x: pos.x + f.originX,
      y: pos.y,
      vx: v.x,
      vy: v.y,
      angle: w.getAngle(),
      av: omega,
      radius: p.wheelRadius,
      role: p.supportRoles[i],
      grounded: contact.support[i],
      anchorX: a.x + f.originX,
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
  const com = totalCOM([b, ...f.wheels]); com.x += f.originX;
  s.diagnostics = {
    com,
    chassisCOM: {
      ...b.getWorldCenter(), x: b.getWorldCenter().x + f.originX
    },
    contacts: contact.contacts,
    colliders: [{
      type: 'polygon',
      vertices: p.bodyVertices.map(v => ({
        ...b.getWorldPoint(Vec2(...v)), x: b.getWorldPoint(Vec2(...v)).x + f.originX
      }))
    }, ...s.wheels.map((w,i) => w.role === 'ski' ? ({
      type: 'polygon', vertices: [[-.65,-p.wheelRadius],[.5,-p.wheelRadius],[.75,-.04],[.55,.02],[-.65,-.04]].map(v=>{
        const point=f.wheels[i].getWorldPoint(Vec2(...v));return {x:point.x+f.originX,y:point.y};
      })
    }) : ({
      type: 'circle',
      x: w.x,
      y: w.y,
      r: w.radius,
      radius: w.radius
    })), {
      type: 'circle',
      x: h.x + f.originX,
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
    physicsHz: 120,
    gravity: p.gravity, density: p.density, vehicleId: p.vehicleId,
    aeroForce: f.aeroForce, jetForce: f.jetForce || 0, jetLevel: f.jetLevel || 0,
    repulsors: f.repulsors || [], loadedRange: f.loadedRange, terrainChunks: f.terrainBodies.size,
    originX: f.originX, originShifts: f.originShifts
  };
  return contact;
}
function createDrive(l, upgrades = freshUpgrades(), options = {}) {
  const p = {
      ...vehiclePhysics(options.vehicleId || 'wanderer', options.worldId || l.worldId || 'earth', upgrades),
      ...options.physics
    },
    world = new World(Vec2(0, -p.gravity)),
    u = {
      ...freshUpgrades(),
      ...upgrades
    };
  for (const key of CONFIG.parts) if (!Number.isInteger(u[key]) || u[key] < 0 || u[key] > 10) throw new ReplayValidationError('Некоректне покращення');
  const sus = u.suspension, stats = upgradeStats(u, p);
  if (options.physics?.airDrag === 0) {p.dragArea = 0; p.downforceArea = 0;}
  // Matched travel/rate/damping upgrades retain useful sag instead of locking
  // wheels to the chassis. Tank upgrades never modify these masses or shapes.
  p.travelMax += (p.travelMax - p.travelMin) * sus * .025;
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
    center: Vec2(p.comX, p.comY),
    I: inertia + p.chassisMass * (p.comX * p.comX + p.comY * p.comY)
  });
  const wheels = [],
    joints = [],
    springs = [];
  for (let i = 0; i < p.supportOffsets.length; i++) {
    const offset = Vec2(p.supportOffsets[i], p.wheelRestY),
      pos = chassis.getWorldPoint(offset),
      w = world.createDynamicBody({
        position: pos,
        angle,
        bullet: true,
        linearVelocity: chassis.getLinearVelocityFromWorldPoint(pos),
        angularVelocity: options.wheelOmega ?? options.av ?? 0
      });
    const ski = p.supportRoles[i] === 'ski';
    w.createFixture(ski ? new Polygon([Vec2(-.65,-p.wheelRadius),Vec2(.5,-p.wheelRadius),Vec2(.75,-.04),Vec2(.55,.02),Vec2(-.65,-.04)]) : new Circle(p.wheelRadius), {
      density: ski ? 1 : p.wheelMass / (Math.PI * p.wheelRadius ** 2),
      friction: 1,
      restitution: p.restitution,
      filterGroupIndex: -1,
      userData: {
        kind: 'wheel',
        index: i
      }
    });
    if(ski) w.setMassData({mass:p.wheelMass,center:Vec2(),I:p.wheelMass*.18});
    // WheelJoint computes its spring using this axial constraint effective mass,
    // including chassis rotational compliance, rather than all 870 kg.
    const mass = 1 / (1 / p.chassisMass + 1 / p.wheelMass + (offset.x - p.comX) ** 2 / inertia),
      k = stats.suspension.stiffness[i],
      c = stats.suspension.damping[i],
      frequency = Math.sqrt(k / mass) / (2 * Math.PI),
      dampingRatio = c / (2 * Math.sqrt(k * mass));
    const SupportJoint = ski ? PrismaticJoint : WheelJoint;
    joints.push(world.createJoint(new SupportJoint({
      bodyA: chassis,
      bodyB: w,
      localAnchorA: offset,
      localAnchorB: Vec2(),
      localAxisA: Vec2(0, 1),
      referenceAngle: 0,
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
      vehicleId: p.vehicleId, worldId: p.worldId,
      upgrades: u,
      gears: [],
      cans: [],
      coinValue: 0,
      coinsCollected: 0,
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
      mode: 'coast', runMode: l.mode || (l.endless ? 'endless' : l.id === 0 ? 'test' : 'campaign')
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
    originX: 0, originShifts: 0, terrainBodies: new Map(),
    loads: wheels.map(() => 0),
    driveTorques: wheels.map(() => 0),
    brakeTorques: wheels.map(() => 0),
    airTorque: 0,
    landingImpulse: 0,
    headTime: 0,
    stuckTime: 0,
    tractionTime: 0,
    slipTime: 0,
    airEntrySpeed: null,
    landing: null,
    visitedModules: new Set(),
    retiredPickupBefore: -Infinity,
    pickupChunks: new Map()
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
      c.setFriction(surfaceFriction(l, body.getPosition().x + f.originX, p, p.supportRoles[(a.kind === 'wheel' ? a : b).index]) * stats.gripMultiplier);
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
  syncTerrain(f, l, s);
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
  if (p.supportRoles[i] === 'ski') {
    const spring = f.springs[i];
    const force = Vec2.mul(axis, -spring.k * t - spring.c * v);
    w.applyForce(force, wheel, true);
    b.applyForce(Vec2.neg(force), anchor, true);
  }
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
    grounded = c.support.filter(Boolean).length + (f.repulsors || []).filter(r => r.active && r.force > 0).length,
    pedal = input & 3,
    both = pedal === 3,
    gas = pedal === 1 && s.fuel > 0,
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
  f.driveTorques = f.wheels.map(() => 0);
  f.brakeTorques = f.wheels.map(() => 0);
  s.mode = grounded ? both ? 'brake' : drive === -1 ? 'reverse' : brake ? 'brake' : gas ? 'drive' : 'coast' : both || !pedal ? 'air-neutral' : pedal === 1 ? 'air-gas' : 'air-brake';
  let reaction = 0;
  for (let i = 0; i < f.wheels.length; i++) {
    const w = f.wheels[i],
      j = f.joints[i],
      omega = w.getAngularVelocity() - b.getAngularVelocity(),
      shouldBrake = brake && !f.reverse && grounded;
    // A bounded zero-speed motor supplies ground braking. Drive instead uses
    // explicit equal-and-opposite torque pairs; the two never run together.
    if (p.supportRoles[i] !== 'ski') {
      j.enableMotor(shouldBrake);
      j.setMotorSpeed(0);
      j.setMaxMotorTorque(shouldBrake ? p.brakeTorque / f.wheels.length : 0);
    }
    let torque = 0;
    if (drive && !shouldBrake) {
      const maxOmega = drive > 0 ? f.stats.driveOmega : p.reverseOmega,
        q = clamp(-omega * drive / maxOmega, 0, 1);
      torque = -drive * f.throttle * (drive > 0 ? f.stats.torqueNm : p.reverseTorque) * p.axleShares[i] * (1 - q * q);
      f.driveTorques[i] = -torque;
    } else if (brake && !both && !grounded && p.supportRoles[i] !== 'ski') {
      const inertia = w.getInertia();
      torque = -Math.sign(omega) * Math.min(p.brakeTorque / f.wheels.length, Math.abs(omega) / (dt * (1 / inertia + 1 / b.getInertia())));
      f.brakeTorques[i] = Math.abs(torque);
    }
    if (shouldBrake) f.brakeTorques[i] = p.brakeTorque / f.wheels.length;
    if (torque) {
      w.applyTorque(torque, true);
      b.applyTorque(-torque, true);
      reaction -= torque;
    }
    if (c.support[i] && p.rollingResistance && p.supportRoles[i] !== 'ski') {
      const load = f.loads[i] || p.gravity * (p.chassisMass / f.wheels.length + p.wheelMass),
        omega = w.getAngularVelocity(),
        limit = p.rollingResistance * load * p.wheelRadius,
        resistance = -Math.sign(omega) * Math.min(limit, Math.abs(omega) * w.getInertia() / dt);
      w.applyTorque(resistance, true);
    }
    applyTravelStop(f, i);
  }
  if (!grounded) {
    const direction = pedal === 1 ? 1 : pedal === 2 ? -1 : 0,
      omega = b.getAngularVelocity(),
      soft = direction * omega > 0 ? Math.max(0, 1 - (direction * omega / p.airSoftOmega) ** 2) : 1,
      target = direction * b.getInertia() * p.airAlpha * soft;
    // The drive already reacts on the chassis. Budget the separate arcade
    // assist against that known reaction so nominal input does not double it.
    f.airTorque = direction ? target - reaction : 0;
    b.applyTorque(f.airTorque - p.airAngularDamping * b.getInertia() * omega, true);
  }
  applyRepulsors(f, s, pedal, terrain, x => supportSurface(l,x));
  applyJet(f, s, input);
  applyAerodynamics(f);
}
function recordTelemetry(l, s, input, previous) {
  const f = s._physics, t = s.telemetry, dt = f.p.fixedDt;
  const slope = (terrain(l, s.x + .5) - terrain(l, s.x - .5));
  const supported = s.wheels.filter(w => w.grounded);
  const slip = supported.length ? Math.max(...supported.map(w => Math.abs(w.slip))) : 0;
  const gas = (input & 3) === 1 && s.fuel > 0 && f.throttle > .8;
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
function crossedPickup(previous, current, x, y) {
  // Segment-versus-pickup rectangle: a fast vehicle can cross an item between
  // fixed ticks without its final position remaining inside the pickup area.
  let enter=0,exit=1;
  for(const [axis,center,radius] of [['x',x,1.65],['y',y,2.1]]){
    const from=previous[axis],delta=current[axis]-from,min=center-radius,max=center+radius;
    if(Math.abs(delta)<1e-10){if(from<min||from>max)return false;continue;}
    const a=(min-from)/delta,b=(max-from)/delta;
    enter=Math.max(enter,Math.min(a,b));exit=Math.min(exit,Math.max(a,b));
    if(enter>exit)return false;
  }
  return true;
}
function stepDrive(l, s, input = 0) {
  if (s.status !== 'playing') return s;
  if (!s._physics) throw new Error('Фізичний стан потрібно створити через createDrive');
  const f = s._physics,
    p = f.p,
    dt = p.fixedDt / p.substeps;
  const previous = {x:s.x,y:s.y,grounded: s.grounded, speed: Math.hypot(s.vx, s.vy)};
  f.landingImpulse = 0;
  syncTerrain(f,l,s);
  for (let n = 0; n < p.substeps; n++) {
    applyControls(l, s, input, dt);
    f.loads = f.wheels.map(() => 0);
    // Two real 1/120-second steps; solver iterations are a separate parameter.
    f.world.step(dt, p.velocityIterations, p.positionIterations);
  }
  const c = updateState(s);
  s.tick++;
  s.best = Math.max(s.best, s.x - 9);
  // Ordinary fuel burn is one unit per second, plus Orbiter's explicit 8*jet
  // surcharge. Empty fuel leaves inertia, braking and air correction alive.
  const beforeFuel = s.fuel;
  s.fuel = Math.max(0, Math.round(s.fuel * 600000) - Math.round((1 + 8 * (f.jetLevel || 0)) * 10000)) / 600000;
  if (beforeFuel > 0 && s.fuel === 0) s.telemetry.dryAt = {x: s.x, tick: s.tick, cans: [...s.cans]};
  const pickupSources=[];
  if (l.endless) {
    for(const [id] of f.pickupChunks) if(id * (l.chunkSize || 120) < f.loadedRange[0]) {
      f.retiredPickupBefore = Math.max(f.retiredPickupBefore,(id+1)*(l.chunkSize||120));
      f.pickupChunks.delete(id);
    }
    const size=l.chunkSize||120;
    for(let id=Math.floor((Math.min(previous.x,s.x)-1.65)/size);id<=Math.floor((Math.max(previous.x,s.x)+1.65)/size);id++)pickupSources.push({id,data:l.getChunk(id)});
  } else pickupSources.push({id:0,data:l});
  for(const {id:chunkId,data:pickupData} of pickupSources) {
    let activePickups;
    if(l.endless){
      if((chunkId+1)*(l.chunkSize||120)>f.retiredPickupBefore&&!f.pickupChunks.has(chunkId))f.pickupChunks.set(chunkId,{gears:new Set(),cans:new Set()});
      activePickups=f.pickupChunks.get(chunkId)||{gears:new Set(),cans:new Set()};
    }
    (pickupData.gears || []).forEach((x, i) => {
      if(l.endless && (x < f.retiredPickupBefore || activePickups.gears.has(i))) return;
      if (!s.gears.includes(i) && crossedPickup(previous,s,x,terrain(l,x)+1.15)) {
        if(l.endless) activePickups.gears.add(i); else s.gears.push(i);
        s.coinsCollected++;
        s.coinValue += pickupData.coinValues?.[i] ?? 1;
      }
    });
    (pickupData.fuel || []).forEach((x, i) => {
      if(l.endless && (x < f.retiredPickupBefore || activePickups.cans.has(i))) return;
      if (!s.cans.includes(i) && crossedPickup(previous,s,x,terrain(l,x)+1.15)) {
        if(l.endless) activePickups.cans.add(i); else s.cans.push(i);
        s.telemetry.fuelStops.push({index: i, x, tick: s.tick, before: s.fuel, capacity: s.capacity});
        if(l.endless && s.telemetry.fuelStops.length > 20) s.telemetry.fuelStops.shift();
        s.fuel = s.capacity;
      }
    });
  }
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
  if (!l.endless && s.x >= l.length + 9) {
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
  } else if (s.x < -90 || s.y < terrain(l,s.x) - 60) {
    s.status = 'failed';
    s.reason = 'route_exit';
  } else if (!l.endless && s.tick >= l.max_ticks) {
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
    pickupChunks: s.runMode === 'endless' ? s._physics ? Object.fromEntries([...s._physics.pickupChunks].map(([id,items])=>[id,{gears:[...items.gears],cans:[...items.cans]}])) : s.pickupChunks : undefined,
    retiredPickupBefore: s.runMode === 'endless' ? s._physics ? s._physics.retiredPickupBefore : s.retiredPickupBefore : undefined,
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
  if (!a || a.tick === b.tick) return captureDrive(b);
  const t = clamp(alpha, 0, 1),
    mix = (a, b) => a + (b - a) * t,
    out = captureDrive(b);
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
    vehicleId: s.vehicleId, worldId: s.worldId, mode: s.runMode,
    ticks: s.tick,
    distance: Math.min(l.meters, Math.floor(s.best)),
    fuel: Math.floor(s.fuel * 100 / s.capacity),
    fuelSeconds: +s.fuel.toFixed(3),
    coinValue: s.coinValue,
    coinsCollected: s.coinsCollected,
    checkpoints: [...s.checkpoints],
    stageId: s.stageId,
    seed: s.seed,
    generatorVersion: s.generatorVersion,
    analysis: analyzeRun(l, s),
    gears: [...s.gears].sort((a, b) => a - b),
    medals
  };
}
function replay(l, u, events, ticks, abandon = false, options = {}) {
  if (!Number.isInteger(ticks) || ticks < 1 || ticks > l.max_ticks || !Array.isArray(events) || events.length > CONFIG.maxTicks) throw new ReplayValidationError('Некоректна тривалість');
  let last = -1;
  for (const e of events) {
    if (!Array.isArray(e) || e.length !== 2 || !Number.isInteger(e[0]) || !Number.isInteger(e[1]) || e[0] <= last || e[0] < 0 || e[0] >= ticks || e[1] < 0 || e[1] > 7) throw new ReplayValidationError('Некоректне керування');
    last = e[0];
  }
  const s = createDrive(l, u, options);
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
  PHYSICS,
  TEST_LEVEL,
  ReplayValidationError,
  clamp,
  terrain,
  surfaceAt,
  surfaceFriction,
  getLevel,
  getTestLevel,
  getEndlessLevel,
  freshUpgrades,
  getUpgradeStats,
  createDrive,
  wheelGeometry,
  stepDrive,
  captureDrive,
  interpolateDrive,
  summarize,
  replay
};
