// Pure economy shared by local saves and checked against the Python API.
const CONFIG = require('./config.json');
const SCHEMA = 4, VEHICLE = 'wanderer';
const PARTS = ['engine', 'suspension', 'tires', 'tank'];
const WORLD_IDS = ['earth', 'moon', 'mars', 'basalt'];
const REQUIREMENTS = {1:[],2:[1],3:[2],4:[3],5:[4],6:[5],7:[6],8:[4],9:[8],10:[9],11:[9,6],12:[11],13:[12],14:[12],15:[14],16:[15]};
const ENDLESS_MILESTONES = {1000:100,3000:200,5000:300,10000:500};
const copy = value => JSON.parse(JSON.stringify(value));
const freshUpgrades = () => Object.fromEntries(PARTS.map(part => [part, 0]));
const freshVehicle = upgrades => ({upgrades: {...(upgrades || freshUpgrades())}, records:{campaign:{}, endless:{}}});
const freshTrack = () => ({gears:[],medals:[],checkpoints:[],best:0,attempts:0,finish_reward_claimed:false});
const integer = (n, low, high = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(n) && n >= low && n <= high;
const vehicleConfig = id => (CONFIG.vehicles || [{id:VEHICLE,price:0}]).find(v => v.id === id);
const vehicleId = profile => profile.vehicle_id || VEHICLE;
const getUpgradePrice=(part,rank,id=VEHICLE)=>Math.round(CONFIG.upgradePrices[part][rank]*(vehicleConfig(id)?.upgradeCostFactor || 1));
function freshProgress() {
  const upgrades = freshUpgrades();
  return {profile_schema: SCHEMA, vehicle_id: VEHICLE, balance: 0, upgrades,
    vehicles: {[VEHICLE]: freshVehicle(upgrades)}, tracks:{}, endless:{}, tutorial_granted:false, migration:null, purchases:{}};
}
function migrateProgress(before) {
  if (before.profile_schema === SCHEMA) return copy(before);
  if (before.profile_schema === 3) {
    if (!integer(before.balance,0) || !before.upgrades || !PARTS.every(p => integer(before.upgrades[p],0,10))) throw new Error('Некоректне попереднє збереження');
    const result = {...copy(before), profile_schema:SCHEMA, vehicle_id:VEHICLE, endless:{}};
    result.vehicles = {[VEHICLE]:freshVehicle(before.upgrades)};
    result.vehicles[VEHICLE].records.campaign = Object.fromEntries(Object.entries(result.tracks || {}).map(([id,t]) =>
      [id,{best:t.best,attempts:t.attempts || 0,medals:copy(t.medals || [])}]));
    result.migration = {from_version:3,tutorial_credit:0,previous:copy(before.migration || null)};
    return result;
  }
  const result = {...copy(before), ...freshProgress()};
  if (!integer(before.balance, 0) || !before.upgrades || !PARTS.every(part => integer(before.upgrades[part], 1, 5)))
    throw new Error('Некоректне попереднє збереження');
  const credit = CONFIG.levels[0].finishReward;
  result.legacy = {version:before.version || 'pre-3',balance:before.balance,upgrades:copy(before.upgrades),tracks:copy(before.tracks || {}),purchases:copy(before.purchases || {})};
  result.balance = before.balance + credit;
  result.upgrades = Object.fromEntries(PARTS.map(part => [part, before.upgrades[part] - 1]));
  result.vehicles[VEHICLE] = freshVehicle(result.upgrades);
  result.tutorial_granted = true;
  result.migration = {from_version:before.version || 'pre-3',tutorial_credit:credit};
  result.tracks['1'] = {...freshTrack(),finish_reward_claimed:true};
  delete result.rewards;
  return result;
}
function unlockedLevels(profile) {
  const complete = id => id === 1 && profile.tutorial_granted || profile.tracks[String(id)]?.medals?.includes('finish');
  return CONFIG.levels.filter(l => (REQUIREMENTS[l.id] || []).every(complete)).map(l => l.id);
}
function unlockedLevel(profile) {return Math.max(...unlockedLevels(profile).filter(id => id <= 7));}
function unlockedWorlds(profile) {
  const levels = unlockedLevels(profile);
  return WORLD_IDS.filter((world,index) => index === 0 || levels.includes([1,8,11,14][index]));
}
function publicProgress(profile) {
  const selected = vehicleId(profile);
  return {version:CONFIG.version,profile_schema:SCHEMA,vehicle_id:selected,balance:profile.balance,
    upgrades:copy(profile.vehicles[selected].upgrades),vehicles:copy(profile.vehicles),tracks:copy(profile.tracks),endless:copy(profile.endless || {}),
    tutorial_granted:Boolean(profile.tutorial_granted),migration:copy(profile.migration || null),
    unlocked_level:unlockedLevel(profile),unlocked_levels:unlockedLevels(profile),unlocked_worlds:unlockedWorlds(profile),
    levels:CONFIG.levels.map(({id,name,meters,hint,recommended,stageId,worldId,seed,generatorVersion}) => ({id,name,meters,hint,recommended,stageId,worldId,seed,generatorVersion}))};
}
function awardProgress(before, level, outcome, metadata = {}) {
  if (!integer(before.balance,0) || !['completed','failed'].includes(outcome.status)) throw new Error('Некоректний результат');
  const id = metadata.vehicle_id || outcome.vehicleId || VEHICLE;
  if (!before.vehicles[id]) throw new Error('Машину не придбано');
  if ((metadata.mode || level.mode) === 'endless') return awardEndless(before,level,outcome,{...metadata,vehicle_id:id});
  const gears = [...new Set(outcome.gears || [])], checkpoints = [...new Set(outcome.checkpoints || [])];
  if (gears.some(n => !integer(n,0,level.gears.length-1)) || checkpoints.some(n => !level.checkpoints.some(c => c.id === n)) ||
      !integer(outcome.distance,0,level.meters)) throw new Error('Некоректні нагороди');
  const result=copy(before),key=String(level.id),track=result.tracks[key] || freshTrack(),previous=track.best;
  const newCheckpoints=checkpoints.filter(n => !track.checkpoints.includes(n));
  const newMedals=(outcome.medals || []).filter(n => !track.medals.includes(n));
  const coinParts=gears.reduce((sum,n) => sum+level.coinValues[n],0);
  const checkpointParts=newCheckpoints.reduce((sum,n) => sum+level.checkpoints.find(c => c.id === n).reward,0);
  const finishParts=outcome.status === 'completed' && !track.finish_reward_claimed ? level.finishReward : 0;
  const parts=coinParts+checkpointParts+finishParts;
  if (!integer(parts,0) || !integer(result.balance+parts,0)) throw new Error('Некоректна сума нагороди');
  result.balance+=parts;
  track.gears=[...new Set([...track.gears,...gears])].sort((a,b)=>a-b);
  track.medals=[...new Set([...track.medals,...newMedals])].sort();
  track.checkpoints=[...new Set([...track.checkpoints,...checkpoints])].sort();
  track.best=Math.max(previous,outcome.distance);track.attempts=(track.attempts || 0)+1;
  if(outcome.status === 'completed') track.finish_reward_claimed=true;
  result.tracks[key]=track;
  const records=result.vehicles[id].records || (result.vehicles[id].records={campaign:{},endless:{}});
  const record=records.campaign[key] || {best:0,attempts:0,medals:[]};
  record.best=Math.max(record.best,outcome.distance);record.attempts++;
  record.medals=[...new Set([...record.medals,...(outcome.medals || [])])].sort();records.campaign[key]=record;
  return {progress:result,receipt:{parts,coin_parts:coinParts,checkpoint_parts:checkpointParts,finish_parts:finishParts,
    new_medals:newMedals.sort(),new_gears:gears.length,new_checkpoints:newCheckpoints.sort(),new_record:outcome.distance>previous,previous_best:previous}};
}
function awardEndless(before,level,outcome,metadata) {
  const world=metadata.world_id || level.worldId;
  if (!WORLD_IDS.includes(world) || !integer(outcome.distance,0,1000000000)) throw new Error('Некоректні нагороди');
  const result=copy(before),track=result.endless[world] || {best:0,attempts:0,milestones:[]},previous=track.best;
  const milestones=Object.keys(ENDLESS_MILESTONES).map(Number).filter(n => n<=outcome.distance && !track.milestones.includes(n));
  const coinParts=Math.min(integer(outcome.coinsCollected,0)?outcome.coinsCollected:0,Math.floor((outcome.distance+12)/25))*5;
  const checkpointParts=milestones.reduce((sum,n)=>sum+ENDLESS_MILESTONES[n],0);
  const parts=coinParts+checkpointParts;
  if(!integer(result.balance+parts,0)) throw new Error('Некоректна сума нагороди');
  result.balance+=parts;track.best=Math.max(previous,outcome.distance);track.attempts++;
  track.milestones=[...new Set([...track.milestones,...milestones])].sort((a,b)=>a-b);result.endless[world]=track;
  const records=result.vehicles[metadata.vehicle_id].records;
  const record=records.endless[world] || {best:0,attempts:0,milestones:[]};
  record.best=Math.max(record.best,outcome.distance);record.attempts++;record.milestones=Object.keys(ENDLESS_MILESTONES).map(Number).filter(n=>n<=record.best);
  records.endless[world]=record;
  return {progress:result,receipt:{parts,coin_parts:coinParts,checkpoint_parts:checkpointParts,finish_parts:0,new_medals:[],new_gears:0,
    new_checkpoints:milestones.map(String),new_record:outcome.distance>previous,previous_best:previous}};
}
function purchaseProgress(before,part,from,id=vehicleId(before)) {
  if(!before.vehicles[id]) throw new Error('Машину не придбано');
  if(!PARTS.includes(part) || !integer(from,0,9) || before.vehicles[id].upgrades[part]!==from) throw new Error('Рівень покращення змінився');
  const price=getUpgradePrice(part,from,id);
  if(before.balance<price) throw new Error('Недостатньо монет');
  const result=copy(before);result.balance-=price;result.vehicles[id].upgrades[part]++;
  result.upgrades={...result.vehicles[vehicleId(result)].upgrades};
  return {progress:result,purchase:{part,from,to:from+1,price,vehicle_id:id}};
}
function purchaseVehicle(before,id) {
  const vehicle=vehicleConfig(id);
  if(!vehicle) throw new Error('Невідома машина');
  if(before.vehicles[id]) throw new Error('Машину вже придбано');
  if(!integer(vehicle.price,0) || before.balance<vehicle.price) throw new Error('Недостатньо монет');
  const result=copy(before);result.balance-=vehicle.price;result.vehicles[id]=freshVehicle();
  result.vehicle_id=id;result.upgrades={...result.vehicles[id].upgrades};
  return {progress:result,purchase:{kind:'vehicle',vehicle_id:id,price:vehicle.price}};
}
function selectVehicle(before,id) {
  if(!before.vehicles[id]) throw new Error('Машину не придбано');
  const result=copy(before);result.vehicle_id=id;result.upgrades={...result.vehicles[id].upgrades};
  return {progress:result,purchase:{kind:'select',vehicle_id:id,price:0}};
}
function validateProgress(profile) {
  if(!profile || profile.profile_schema!==SCHEMA || !integer(profile.balance,0) || !profile.vehicles?.[profile.vehicle_id] ||
    !profile.tracks || typeof profile.tracks!=='object' || Array.isArray(profile.tracks)) throw new Error('Некоректне збереження');
  for(const [id,vehicle] of Object.entries(profile.vehicles)) {
    if(!vehicleConfig(id) || !vehicle.upgrades || !PARTS.every(p=>integer(vehicle.upgrades[p],0,10))) throw new Error('Некоректна машина');
  }
  if(PARTS.some(p=>profile.upgrades?.[p]!==profile.vehicles[profile.vehicle_id].upgrades[p])) throw new Error('Некоректне збереження');
  for(const [id,track] of Object.entries(profile.tracks)) {
    const level=CONFIG.levels.find(l=>String(l.id)===id);
    if(!level || !integer(track.best,0,level.meters) || !integer(track.attempts || 0,0) ||
      !Array.isArray(track.gears) || track.gears.some(n=>!integer(n,0,level.gears.length-1)) ||
      !Array.isArray(track.medals) || track.medals.some(m=>!['finish','collector','economy'].includes(m)) ||
      !Array.isArray(track.checkpoints) || track.checkpoints.some(n=>!level.checkpoints.some(c=>c.id===n))) throw new Error('Некоректний рекорд');
  }
  return copy(profile);
}
module.exports={SCHEMA,VEHICLE,PARTS,WORLD_IDS,REQUIREMENTS,ENDLESS_MILESTONES,getUpgradePrice,freshProgress,migrateProgress,unlockedLevel,unlockedLevels,unlockedWorlds,publicProgress,awardProgress,purchaseProgress,purchaseVehicle,selectVehicle,validateProgress};
