import {CONFIG, getLevel, replay} from './engine';
import {SCHEMA, PARTS, freshProgress, migrateProgress, publicProgress, awardProgress, purchaseProgress, validateProgress} from './progression';

export const LOCAL_DRIVE_KEY = 'pixel-drive-local-progress';
const copy = value => JSON.parse(JSON.stringify(value));
const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
let localQueue = Promise.resolve();
function lock(action) {
  if (globalThis.navigator?.locks?.request) return navigator.locks.request(LOCAL_DRIVE_KEY, action);
  const result = localQueue.then(action, action);
  localQueue = result.catch(() => {});
  return result;
}
// Only for local retry matching; authenticated receipts use SHA-256 on the server.
function fingerprint(body) {
  const text = JSON.stringify([body.ticks, body.events || [], Boolean(body.abandon)]);
  let a = 2166136261, b = 5381;
  for (let i = 0; i < text.length; i++) {a = Math.imul(a ^ text.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ text.charCodeAt(i);}
  return `${text.length}:${a >>> 0}:${b >>> 0}`;
}
function decode(raw) {
  if (raw.length > 2000000) throw new Error('Збереження завелике');
  const saved = JSON.parse(raw);
  if (saved.schema === 1 && [1, 2].includes(saved.version))
    return {progress: migrateProgress({...saved.progress, version: saved.version}), sessions: []};
  if (saved.schema !== SCHEMA || saved.version !== CONFIG.version) throw new Error('Невідома версія');
  const progress = validateProgress(saved.progress), sessions = saved.sessions || [];
  if (!Array.isArray(sessions) || sessions.length > 100 || sessions.some(s => !s || typeof s.session_id !== 'string') ||
      !progress.purchases || Object.keys(progress.purchases).length > 40) throw new Error('Некоректні спроби');
  return {progress, sessions};
}

// Campaign currency in this adapter stays local and is never imported into server balances.
export function createLocalDriveService(options = {}) {
  let storage, progress = freshProgress(), sessions = new Map(), persistent = true, saveReset = false;
  try {storage = Object.prototype.hasOwnProperty.call(options, 'storage') ? options.storage : window.localStorage; if (!storage) persistent = false;}
  catch (_) {persistent = false;}
  const refresh = () => {
    if (!storage || !persistent) return;
    try {
      const raw = storage.getItem(LOCAL_DRIVE_KEY);
      if (raw) {const data = decode(raw); progress = data.progress; sessions = new Map(data.sessions.map(s => [s.session_id, s]));}
    } catch (_) {saveReset = true;}
  };
  const persist = () => {
    if (!storage || !persistent) return;
    try {storage.setItem(LOCAL_DRIVE_KEY, JSON.stringify({schema: SCHEMA, version: CONFIG.version, progress, sessions: [...sessions.values()]}));}
    catch (_) {persistent = false;}
  };
  refresh();
  persist();
  const status = () => ({...publicProgress(progress), storage_mode: persistent ? 'local' : 'memory', storage_reset: saveReset});
  const fail = (message, status = 400) => {const error = new Error(message); error.response = {status}; throw error;};
  const superseded = () => {const message='Заїзд замінено новою спробою в цій або іншій вкладці. Поверніться до гаража.';
    const error=new Error(message);error.response={status:409,data:{detail:{code:'run_superseded',message}}};throw error;};
  const validRequest = body => {if (typeof body.request_id !== 'string' || !body.request_id || body.request_id.length > 120) fail('Невідома спроба');};
  return {
    get: async () => lock(() => {refresh(); return {data: status()};}),
    post: async (url, body) => lock(() => {
      refresh();
      if (url.endsWith('/start')) {
        validRequest(body);
        if (!integer(body.level, 1, CONFIG.levels.length) || (body.vehicle_id && body.vehicle_id !== 'wanderer')) fail('Невідома траса або машина');
        const previous = sessions.get(body.request_id);
        if (previous) {
          if (previous.superseded) superseded();
          if (previous.level_id !== body.level || previous.result || Date.parse(previous.expires_at) <= Date.now()) fail('Цю спробу вже використано', 409);
          return {data: copy(previous)};
        }
        if (body.level > status().unlocked_level) fail('Спочатку пройдіть попередню трасу', 403);
        for (const session of sessions.values()) if (!session.result && !session.superseded) session.superseded = true;
        if (sessions.size >= 100) sessions.delete(sessions.keys().next().value);
        const level = getLevel(body.level);
        const session = {session_id: body.request_id, level_id: body.level, vehicle_id: 'wanderer', version: CONFIG.version,
          stageId: level.stageId, seed: level.seed, generatorVersion: level.generatorVersion,
          upgrades: copy(progress.upgrades), expires_at: new Date(Date.now() + 3600000).toISOString()};
        sessions.set(session.session_id, session); persist(); return {data: copy(session)};
      }
      if (url.endsWith('/upgrade')) {
        validRequest(body);
        if (body.vehicle_id && body.vehicle_id !== 'wanderer') fail('Невідома машина');
        const previous = progress.purchases[body.request_id];
        if (previous) {
          if (previous.part !== body.part || previous.from !== body.level) fail('Покупка вже має інші параметри', 409);
          return {data: {progress: status(), purchase: copy(previous)}};
        }
        if (!PARTS.includes(body.part) || !integer(body.level, 0, 9)) fail('Покращення недоступне');
        if (progress.upgrades[body.part] !== body.level) fail('Рівень покращення змінився', 409);
        if (progress.balance < CONFIG.upgradePrices[body.part][body.level]) fail('Недостатньо монет');
        const result = purchaseProgress(progress, body.part, body.level);
        progress = result.progress; progress.purchases[body.request_id] = result.purchase; persist();
        return {data: {progress: status(), purchase: result.purchase}};
      }
      if (url.endsWith('/finish')) {
        if (body.abandon !== undefined && typeof body.abandon !== 'boolean') fail('Некоректний стан заїзду');
        const session = sessions.get(url.split('/').at(-2));
        if (!session) fail('Сесію не знайдено', 404);
        if (session.superseded) superseded();
        const digest = fingerprint(body);
        if (session.result) {
          if (session.digest !== digest) fail('Цю спробу вже завершено', 409);
          return {data: copy({...session.result, progress: status()})};
        }
        if (session.version !== CONFIG.version || Date.parse(session.expires_at) <= Date.now()) fail('Час сесії минув або гра оновилась', 409);
        const outcome = replay(getLevel(session.level_id), session.upgrades, body.events || [], body.ticks, Boolean(body.abandon));
        const result = awardProgress(progress, getLevel(session.level_id), outcome);
        progress = result.progress;
        session.digest = digest; session.result = {outcome, receipt: result.receipt};
        persist(); return {data: copy({...session.result, progress: status()})};
      }
      fail('Невідомий маршрут локальної гри');
    })
  };
}
