import {CONFIG, getLevel} from './engine';
import {normalizeFinish} from './finishResult';
import LEGACY_CONFIG from './config-v3.json';
import {SCHEMA, PARTS, getUpgradePrice, freshProgress, migrateProgress, publicProgress, awardProgress, purchaseProgress, purchaseVehicle, selectVehicle, validateProgress} from './progression';

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
  const text = JSON.stringify([body.ticks, body.outcome, Boolean(body.abandon)]);
  let a = 2166136261, b = 5381;
  for (let i = 0; i < text.length; i++) {a = Math.imul(a ^ text.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ text.charCodeAt(i);}
  return `${text.length}:${a >>> 0}:${b >>> 0}`;
}
function decode(raw) {
  if (raw.length > 2000000) throw new Error('Збереження завелике');
  const saved = JSON.parse(raw);
  if (saved.schema === 1 && [1, 2].includes(saved.version))
    return {progress: migrateProgress({...saved.progress, version: saved.version}), sessions: []};
  if (saved.schema === 3 && saved.version === 3)
    return {progress:validateProgress(migrateProgress(saved.progress)),sessions:saved.sessions || []};
  if (saved.schema !== SCHEMA || saved.version !== CONFIG.version) throw new Error('Невідома версія');
  const progress = validateProgress(saved.progress), sessions = saved.sessions || [];
  if (!Array.isArray(sessions) || sessions.length > 100 || sessions.some(s => !s || typeof s.session_id !== 'string') ||
      !progress.purchases || Object.keys(progress.purchases).length > 512) throw new Error('Некоректні спроби');
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
  const status = () => ({...publicProgress(progress), result_mode: 'client', save_scope: 'local',
    storage_mode: persistent ? 'local' : 'memory', storage_reset: saveReset});
  const fail = (message, status = 400) => {const error = new Error(message); error.response = {status}; throw error;};
  const superseded = () => {const message='Заїзд замінено новою спробою в цій або іншій вкладці. Поверніться до гаража.';
    const error=new Error(message);error.response={status:409,data:{detail:{code:'run_superseded',message}}};throw error;};
  const validRequest = body => {if (typeof body.request_id !== 'string' || !body.request_id || body.request_id.length > 120) fail('Невідома спроба');};
  const sessionLevel = session => session.mode === 'endless' ? {...session,id:session.level_id,mode:'endless',worldId:session.world_id,
    meters:1000000000,max_ticks:Number.MAX_SAFE_INTEGER,gears:[],checkpoints:[],coinValues:[],finishReward:0} :
    session.version===3 ? LEGACY_CONFIG.levels[session.level_id-1] : getLevel(session.level_id);
  return {
    get: async () => lock(() => {refresh(); return {data: status()};}),
    post: async (url, body) => lock(() => {
      refresh();
      if (url.endsWith('/start')) {
        validRequest(body);
        const levelId=body.level ?? 1,vehicleId=body.vehicle_id || progress.vehicle_id,mode=body.mode || 'campaign';
        if (!integer(levelId,1,CONFIG.levels.length) || !progress.vehicles[vehicleId] || !['campaign','endless'].includes(mode)) fail('Невідома траса або машина');
        const level=getLevel(levelId),worldId=body.world_id || level.worldId || 'earth';
        const previous = sessions.get(body.request_id);
        if (previous) {
          if (previous.superseded) superseded();
          if (previous.level_id !== levelId || previous.vehicle_id!==vehicleId || (previous.mode || 'campaign')!==mode ||
              (previous.world_id || 'earth')!==worldId || previous.result || Date.parse(previous.expires_at) <= Date.now()) fail('Цю спробу вже використано', 409);
          return {data: copy(previous)};
        }
        if (mode==='campaign' && (!status().unlocked_levels.includes(levelId) || worldId!==(level.worldId || 'earth'))) fail('Спочатку пройдіть попередню трасу',403);
        if (mode==='endless' && !status().unlocked_worlds.includes(worldId)) fail('Спочатку відкрийте цей світ у кампанії',403);
        for (const session of sessions.values()) if (!session.result && !session.superseded) session.superseded = true;
        if (sessions.size >= 100) sessions.delete(sessions.keys().next().value);
        const session = {session_id:body.request_id,level_id:levelId,vehicle_id:vehicleId,mode,world_id:worldId,version:CONFIG.version,result_mode:'client',
          stageId:mode==='endless'?`endless-${worldId}`:level.stageId,seed:mode==='endless'?Math.floor(Math.random()*4294967296):level.seed,
          generatorVersion:mode==='endless'?(CONFIG.generatorVersion || 4):level.generatorVersion,
          upgrades:copy(progress.vehicles[vehicleId].upgrades),expires_at:new Date(Date.now()+(mode==='endless'?7*86400000:3600000)).toISOString()};
        sessions.set(session.session_id, session); persist(); return {data: copy(session)};
      }
      if (url.endsWith('/upgrade')) {
        validRequest(body);
        const vehicleId=body.vehicle_id || progress.vehicle_id;
        if (!progress.vehicles[vehicleId]) fail('Машину не придбано',403);
        const previous = progress.purchases[body.request_id];
        if (previous) {
          if (previous.part !== body.part || previous.from !== body.level || (previous.vehicle_id || 'wanderer')!==vehicleId) fail('Покупка вже має інші параметри', 409);
          return {data: {progress: status(), purchase: copy(previous)}};
        }
        if (!PARTS.includes(body.part) || !integer(body.level, 0, 9)) fail('Покращення недоступне');
        if (progress.vehicles[vehicleId].upgrades[body.part] !== body.level) fail('Рівень покращення змінився', 409);
        if (progress.balance < getUpgradePrice(body.part,body.level,vehicleId)) fail('Недостатньо монет');
        const result = purchaseProgress(progress, body.part, body.level,vehicleId);
        progress = result.progress; progress.purchases[body.request_id] = result.purchase; persist();
        return {data: {progress: status(), purchase: result.purchase}};
      }
      if (url.endsWith('/vehicle/purchase') || url.endsWith('/vehicle/select')) {
        validRequest(body);
        const select=url.endsWith('/select'),bucket=select?'selections':'purchases',kind=select?'select':'vehicle';
        const previous=progress[bucket]?.[body.request_id];
        if(previous) {
          if(previous.kind!==kind || previous.vehicle_id!==body.vehicle_id) fail('Покупка вже має інші параметри',409);
          return {data:{progress:status(),purchase:copy(previous)}};
        }
        let result;
        try {result=(select?selectVehicle:purchaseVehicle)(progress,body.vehicle_id);} catch(error) {fail(error.message);}
        progress=result.progress;progress[bucket]=progress[bucket] || {};progress[bucket][body.request_id]=result.purchase;
        if(select && Object.keys(progress[bucket]).length>64) delete progress[bucket][Object.keys(progress[bucket])[0]];
        persist();return {data:{progress:status(),purchase:result.purchase}};
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
        if (![3,CONFIG.version].includes(session.version) || Date.parse(session.expires_at) <= Date.now()) fail('Час сесії минув або гра оновилась', 409);
        let outcome;
        try {outcome = normalizeFinish(sessionLevel(session), session.upgrades, body, session);}
        catch (error) {fail(error.message, error.status || 400);}
        const result = awardProgress(progress, sessionLevel(session), outcome,session);
        progress = result.progress;
        session.digest = digest; session.result = {outcome, receipt: result.receipt};
        persist(); return {data: copy({...session.result, progress: status()})};
      }
      fail('Невідомий маршрут локальної гри');
    })
  };
}
