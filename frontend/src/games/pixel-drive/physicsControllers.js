// Force-based special controllers. No controller assigns vehicle velocity or pose.
const {Vec2} = require('./vendor/planck');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function applyAerodynamics(f) {
  const {p, chassis: body} = f, velocity = body.getLinearVelocity();
  const density = p.density;
  f.aeroForce = {x: 0, y: 0};
  if (!density) return;
  const speed = Math.hypot(velocity.x, velocity.y);
  const drag = .5 * density * p.dragArea * speed;
  const local = body.getLocalVector(velocity);
  // Wing force is normal to the chassis and follows its orientation, never
  // a sampled road normal. Reversed airflow does not produce forward downforce.
  const wing = .5 * density * p.downforceArea * Math.max(0, local.x) ** 2;
  const normal = body.getWorldVector(Vec2(0, -1));
  f.aeroForce = {x: -drag * velocity.x + normal.x * wing, y: -drag * velocity.y + normal.y * wing};
  body.applyForceToCenter(Vec2(f.aeroForce.x, f.aeroForce.y), true);
}

function applyJet(f, state, input) {
  const active = Boolean(input & 4) && f.p.type === 'orbiter' && state.fuel > 0;
  // Reserve this tick's ordinary burn, then scale the final jet pulse to the
  // remaining fuel. Both 120 Hz substeps use the same 60 Hz fuel budget.
  const level = active ? clamp((state.fuel * 60 - 1) / 8, 0, 1) : 0;
  f.jetLevel = level;
  f.jetForce = level * f.p.jetForce;
  if (level) {
    const force = f.chassis.getWorldVector(Vec2(0, f.jetForce));
    f.chassis.applyForceToCenter(force, true);
  }
}

function applyRepulsors(f, state, pedal, terrain, supportSurface) {
  if (f.p.type !== 'hover') return;
  const {p, chassis: body} = f;
  f.repulsors = [];
  const normal = body.getWorldVector(Vec2(0, -1));
  const usable = normal.y < -.35 && state.fuel > 0;
  for (const offset of [-p.wheelbase / 2, p.wheelbase / 2]) {
    const point = body.getWorldPoint(Vec2(offset, -.25));
    const x = point.x + f.originX, floor = supportSurface(x);
    const distance = floor === null ? Infinity : point.y - floor;
    const velocity = body.getLinearVelocityFromWorldPoint(point);
    const target = p.hoverHeight, range = p.hoverRange;
    const inRange = usable && distance > 0 && distance < range;
    // Positive bounded spring/damper, with no integral term or energy storage.
    // The preload is based on Earth design gravity, unchanged across worlds.
    const force = inRange ? clamp(p.totalMass * 9.81 / 2 +
      p.hoverK * (target - distance) - p.hoverC * velocity.y, 0, p.hoverMaxForce) : 0;
    if (force) body.applyForce(Vec2(0, force), point, true);
    f.repulsors.push({x, y: point.y, distance, force, range, active: inRange});
  }
  const supported = f.repulsors.filter(r => r.force > 0).length;
  if (!supported) return;
  const local = body.getLocalVector(body.getLinearVelocity());
  const drive = pedal === 1 ? 1 : pedal === 2 && f.reverse ? -1 : 0;
  const desired = drive * f.throttle * f.stats.torqueNm / p.wheelRadius;
  const q = Math.abs(local.x) / (f.stats.driveOmega * p.wheelRadius);
  let force = desired * Math.max(0, 1 - q * q);
  if (pedal & 2 && !f.reverse) force = -Math.sign(local.x) * Math.min(p.totalMass * Math.abs(local.x) * 60, p.brakeTorque / p.wheelRadius);
  const supportLoad = f.repulsors.reduce((sum, r) => sum + r.force, 0);
  // G upgrades the field's supported tangential coupling. It still cannot
  // produce thrust in free flight or exceed a bounded multiple of support load.
  const tractionLimit = supportLoad * .9 * f.stats.gripMultiplier;
  force = clamp(force, -tractionLimit, tractionLimit);
  const tangent = body.getWorldVector(Vec2(force, 0));
  body.applyForceToCenter(tangent, true);
  f.driveTorques = [force * p.wheelRadius];
}

module.exports = {applyAerodynamics, applyJet, applyRepulsors};
