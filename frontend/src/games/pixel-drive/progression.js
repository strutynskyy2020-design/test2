// Shared by local storage and the authoritative bundled server worker.
const CONFIG = require('./config.json');
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
module.exports = {SCHEMA, VEHICLE, PARTS, freshProgress, migrateProgress, unlockedLevel, publicProgress, awardProgress, purchaseProgress, validateProgress};
