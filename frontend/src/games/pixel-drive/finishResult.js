// Lightweight normalization only. The user opted out of authoritative physics
// replay; reported driving/pickups are trusted, currency values are not.
const REASONS = new Set(['overturned', 'stuck', 'fuel', 'route_exit', 'time', 'abandoned']);
const {fuelCapacity} = require('./fleetConfig');
const finite = value => typeof value === 'number' && Number.isFinite(value) ? value : 0;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const text = (value, limit) => typeof value === 'string'
  ? Array.from(value.replace(/[\u0000-\u001f\u007f]/g, '').trim()).slice(0, limit).join('') : '';

function normalizeFinish(level, upgrades, body, metadata = {}) {
  if (!body || !Number.isSafeInteger(body.ticks) || body.ticks < 1 || body.ticks > level.max_ticks)
    throw new Error('Некоректна тривалість');
  if (!body.outcome || typeof body.outcome !== 'object' || Array.isArray(body.outcome)) {
    const error = new Error('Оновіть сторінку гри, щоб зберігати результат без повторної перевірки.');
    error.status = 409;
    throw error;
  }
  const report = body.outcome, abandoned = body.abandon === true;
  const endless = (metadata.mode || level.mode) === 'endless';
  const completed = !endless && !abandoned && report.status === 'completed';
  const vehicleId = metadata.vehicle_id || 'wanderer';
  const capacity = fuelCapacity(vehicleId, upgrades.tank);
  const fuelSeconds = clamp(finite(report.fuelSeconds), 0, capacity);
  const gears = [...new Set((!endless && Array.isArray(report.gears) ? report.gears : [])
    .filter(id => Number.isInteger(id) && id >= 0 && id < level.gears.length))].sort((a, b) => a - b);
  const checkpoints = [...new Set((!endless && Array.isArray(report.checkpoints) ? report.checkpoints : [])
    .filter(id => typeof id === 'string' && level.checkpoints.some(cp => cp.id === id)))].sort();
  const analysis = (Array.isArray(report.analysis) ? report.analysis : [])
    .filter(note => note && typeof note === 'object' && !Array.isArray(note))
    .map(note => ({type: text(note.type, 40) || 'info', message: text(note.message, 400)}))
    .filter(note => note.message).slice(0, 3);
  const medals = completed ? ['finish',
    ...(gears.length >= Math.ceil(level.gears.length * .7) ? ['collector'] : []),
    ...(fuelSeconds * 5 >= capacity ? ['economy'] : [])] : [];
  const distance = completed ? level.meters : Math.floor(clamp(finite(report.distance), 0, endless ? 1000000000 : level.meters));
  // Start x=9 plus 3m for the 1.65m pickup radius and floored distance.
  const coinsCollected = endless ? Math.min(Math.floor(clamp(finite(report.coinsCollected),0,Number.MAX_SAFE_INTEGER)),Math.floor((distance+12)/25)) : 0;
  return {
    status: completed ? 'completed' : 'failed',
    reason: abandoned ? 'abandoned' : completed ? 'finish' : REASONS.has(report.reason) ? report.reason : 'ended',
    ticks: body.ticks,
    distance,
    fuel: Math.floor(fuelSeconds * 100 / capacity), fuelSeconds,
    coinValue: endless ? coinsCollected*5 : gears.reduce((sum, id) => sum + (level.coinValues?.[id] ?? 1), 0),
    checkpoints, stageId: metadata.stageId || level.stageId,
    seed: metadata.seed ?? level.seed, generatorVersion: metadata.generatorVersion ?? level.generatorVersion,
    analysis, gears, medals, ...(endless ? {coinsCollected} : {}),
    vehicleId, worldId: metadata.world_id || level.worldId || 'earth', mode: endless ? 'endless' : 'campaign',
  };
}
module.exports = {normalizeFinish};
