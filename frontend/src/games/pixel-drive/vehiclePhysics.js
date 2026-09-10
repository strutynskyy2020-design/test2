const BASE = require('./physicsConfig');
const {getVehicle, getWorld} = require('./fleetConfig');
const mix = (values, rank) => values[0] + (values[1] - values[0]) * rank / 10;

// The fleet contains design values; this adapter distributes the total mass
// between the chassis and actual contact bodies and derives each spring.
function vehiclePhysics(vehicleId = 'wanderer', worldId = 'earth', upgrades = {}) {
  const v = getVehicle(vehicleId), world = getWorld(worldId);
  const type = v.type;
  const tracked = type === 'tracked', snowmobile = type === 'snowmobile';
  const count = tracked ? Math.max(5, v.wheelCount || 6) : snowmobile ? 5 : type === 'hover' ? 0 : 2;
  const supportFraction = tracked ? .16 : snowmobile ? .14 : type === 'hover' ? 0 : .08;
  const radius = v.wheelRadius;
  const supportMass = v.mass * supportFraction / Math.max(1, count);
  const chassisMass = v.mass * (1 - supportFraction);
  const length = v.bodyLength || v.wheelbase + 1;
  const height = v.bodyHeight || .65;
  const travel = v.travel;
  const offsets = tracked ? Array.from({length: count}, (_, i) => -v.wheelbase / 2 + v.wheelbase * i / (count - 1)) :
    snowmobile ? [-v.wheelbase / 2, -v.wheelbase / 2 + .32, -v.wheelbase / 2 + .64, -v.wheelbase / 2 + .96, v.wheelbase / 2] : [-v.wheelbase / 2, v.wheelbase / 2];
  const roles = offsets.map((_, i) => snowmobile && i === count - 1 ? 'ski' : tracked || snowmobile ? 'roller' : 'wheel');
  let shares = tracked ? offsets.map(() => 1 / count) : snowmobile ? [.25, .25, .25, .25, 0] : v.axleShares || [.6, .4];
  const sus = upgrades.suspension || 0;
  const p = {...BASE, vehicleId: v.id, worldId: world.id, type, totalMass: v.mass,
    gravity: world.gravity, density: world.density, chassisMass, wheelMass: supportMass,
    wheelRadius: radius, wheelbase: v.wheelbase, bodyLength: length, bodyHeight: height,
    comX: v.comX ?? -.1, comY: v.comY ?? 0, inertiaScale: v.inertiaScale || 1,
    bodyVertices: [[-length / 2, -height / 2], [length / 2, -height / 2], [length / 2, height * .12], [length * .32, height / 2], [-length * .34, height / 2], [-length / 2, height * .1]],
    head: {x: v.driverX ?? .12, y: height / 2 + .33, radius: v.driverRadius || .24},
    wheelRestY: -(height / 2 + .2 + travel * .30), mountY: -height * .1,
    travelMin: -travel * .14, travelMax: travel * .86, stopZone: Math.min(.1, travel * .2),
    stopK: v.mass * 340, stopDamping: v.mass * 4.5, maxStopForce: v.mass * 48,
    supportOffsets: offsets.slice(0, count), supportRoles: roles, axleShares: shares.slice(0, count),
    airAlpha: v.airAlpha || 4, airSoftOmega: v.airSoftOmega || 4,
    dragArea: v.dragArea ?? .52, downforceArea: v.downforceArea || 0,
    rollingResistance: tracked ? .026 : snowmobile ? .019 : .013,
    brakeTorque: v.mass * radius * 8, reverseTorque: v.mass * radius * 3.2,
    reverseOmega: 5 / radius, forwardTorque: v.torque[0], forwardOmega: v.speed[0] / 3.6 / radius * 1.04,
    torqueRange: v.torque, omegaRange: v.speed.map(speed => speed / 3.6 / radius * 1.04),
    fuelRange: v.fuel, gripRange: v.grip || [1, 1.4],
    jetForce: v.jetForce || 9000,
    hoverHeight: v.hoverHeight || 1.1, hoverRange: v.hoverRange || 2.4, hoverK: v.mass * (18 + sus * .6),
    hoverC: v.mass * (3.3 + sus * .15), hoverMaxForce: (v.hoverMaxForce || v.mass * 20) / 2 * (1 + sus * .03),
  };
  const loadShares = tracked ? offsets.map(() => 1 / count) : snowmobile ? [.15,.15,.15,.15,.4] : [.55,.45];
  p.springK = loadShares.map(share => chassisMass * 9.81 * share / (travel * .34));
  p.springC = p.springK.map((k, i) => 2 * .72 * Math.sqrt(k * (chassisMass * loadShares[i])));
  return p;
}

function upgradeStats(upgrades, p) {
  const s = upgrades.suspension || 0, e = upgrades.engine || 0;
  return {
    torqueNm: p.torqueRange ? mix(p.torqueRange, e) : p.forwardTorque * (1 + .14 * e),
    driveOmega: p.omegaRange ? mix(p.omegaRange, e) : p.forwardOmega * (1 + .04 * e),
    gripMultiplier: p.gripRange ? mix(p.gripRange, upgrades.tires || 0) : 1 + .04 * (upgrades.tires || 0),
    fuelSeconds: mix(p.fuelRange || [40,80], upgrades.tank || 0),
    suspension: {travel: (p.travelMax - p.travelMin) * (1 + .025 * s),
      stiffness: p.springK.map(k => k / (1 + .018 * s)),
      damping: p.springC.map(c => c * (1 + .018 * s))},
    vehicleId: p.vehicleId, mass: p.totalMass,
    hover: p.type === 'hover' ? {range:p.hoverRange,height:p.hoverHeight,maxForcePerSupport:p.hoverMaxForce,stiffness:p.hoverK,damping:p.hoverC,supportCount:2,tractionCoefficient:.9*(p.gripRange ? mix(p.gripRange,upgrades.tires||0) : 1+.04*(upgrades.tires||0))} : undefined,
    speedTarget: mix((p.omegaRange || [p.forwardOmega,p.forwardOmega * 1.4]).map(n => n * p.wheelRadius * 3.6 / 1.04), e),
  };
}
module.exports = {vehiclePhysics, upgradeStats};
