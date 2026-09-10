const {CONFIG} = require('./engine');
const {SCHEMA,freshProgress,migrateProgress,publicProgress,awardProgress,purchaseProgress,purchaseVehicle,selectVehicle,getUpgradePrice} = require('./progression');
const {normalizeFinish} = require('./finishResult');
const {createLocalDriveService,LOCAL_DRIVE_KEY} = require('./localProgress');
const {fuelCapacity} = require('./fleetConfig');
const win = id => ({status:'completed',distance:CONFIG.levels[id-1].meters,gears:[],checkpoints:[],medals:['finish']});
const complete = (p,id,vehicle_id='wanderer') => awardProgress(p,CONFIG.levels[id-1],win(id),{vehicle_id}).progress;
const memory = data => ({getItem:()=>data || null,setItem:(k,v)=>{data=v;}});

test('v3 migration preserves paid balance, ranks, earth completions, receipts and outbox without another welcome credit',()=>{
  const old={...complete(freshProgress(),1),profile_schema:3,balance:7123,pending_award:{session_id:'old',attempt_id:'nonce',receipt:{parts:80}}};
  old.upgrades.engine=6;old.vehicles.wanderer.upgrades.engine=6;
  const after=migrateProgress(old);
  expect(after.balance).toBe(7123);expect(after.upgrades.engine).toBe(6);expect(after.tracks).toEqual(old.tracks);
  expect(after.pending_award).toEqual(old.pending_award);expect(after.vehicles.wanderer.records.campaign['1'].best).toBe(200);
  expect(migrateProgress(after)).toEqual(after);expect(after.migration.tutorial_credit).toBe(0);
});
test('world branches unlock only their explicit prerequisites, not every smaller numeric route',()=>{
  let p=freshProgress();for(const id of [1,2,3,4])p=complete(p,id);
  expect(publicProgress(p).unlocked_levels).toEqual([1,2,3,4,5,8]);
  expect(publicProgress(p).unlocked_worlds).toEqual(['earth','moon']);
  p=complete(complete(p,8),9);expect(publicProgress(p).unlocked_levels).not.toContain(11);
  p=complete(complete(p,5),6);expect(publicProgress(p).unlocked_levels).toContain(11);
  p=complete(complete(p,11),12);expect(publicProgress(p).unlocked_worlds).toEqual(['earth','moon','mars','basalt']);
  expect(publicProgress(p).unlocked_levels).toContain(14);expect(publicProgress(p).unlocked_levels).not.toContain(15);
});
test('buying and upgrading every vehicle keeps each machine independent and charges configured prices',()=>{
  let p={...freshProgress(),balance:10000000},spent=0;
  for(const vehicle of CONFIG.vehicles) {
    if(vehicle.id!=='wanderer') {p=purchaseVehicle(p,vehicle.id).progress;spent+=vehicle.price;}
    for(const part of CONFIG.parts) for(let rank=0;rank<10;rank++) {
      const next=purchaseProgress(p,part,rank,vehicle.id);spent+=getUpgradePrice(part,rank,vehicle.id);p=next.progress;
      expect(next.purchase.vehicle_id).toBe(vehicle.id);expect(p.upgrades).toEqual(p.vehicles[p.vehicle_id].upgrades);
    }
  }
  expect(p.balance).toBe(10000000-spent);expect(Object.keys(p.vehicles)).toHaveLength(12);
  expect(()=>purchaseVehicle(p,'swift')).toThrow('вже придбано');expect(()=>selectVehicle(freshProgress(),'orbiter')).toThrow('не придбано');
});
test('records are per vehicle while finish and checkpoint bonuses remain account-wide',()=>{
  let p={...freshProgress(),balance:10000};p=purchaseVehicle(p,'swift').progress;
  p=complete(p,1);const second=awardProgress(p,CONFIG.levels[0],win(1),{vehicle_id:'swift'});
  expect(second.receipt.finish_parts).toBe(0);
  expect(second.progress.vehicles.wanderer.records.campaign['1'].attempts).toBe(1);
  expect(second.progress.vehicles.swift.records.campaign['1'].attempts).toBe(1);
});
test.each(CONFIG.vehicles.map(v=>v.id))('%s outcome fuel uses its own C0/C10 and ignores spoofed vehicle metadata',id=>{
  const body={ticks:1,outcome:{status:'failed',fuelSeconds:999,vehicleId:'other'}};
  const outcome=normalizeFinish(CONFIG.levels[0],{tank:5},body,{vehicle_id:id});
  expect(outcome.fuelSeconds).toBe(fuelCapacity(id,5));expect(outcome.vehicleId).toBe(id);
});
test('endless 100km normalizes bounded counts without a finish or stored pickup history',()=>{
  const level={id:1,mode:'endless',worldId:'earth',max_ticks:Number.MAX_SAFE_INTEGER,stageId:'endless-earth',seed:1,generatorVersion:4};
  const metadata={mode:'endless',world_id:'earth',vehicle_id:'wanderer'};
  const outcome=normalizeFinish(level,{tank:0},{ticks:1000000,outcome:{status:'completed',distance:100000,coinsCollected:999999,gears:[1,2]}},metadata);
  expect(outcome.status).toBe('failed');expect(outcome.distance).toBe(100000);expect(outcome.coinsCollected).toBe(4000);expect(outcome.gears).toEqual([]);
  const first=awardProgress(freshProgress(),level,outcome,metadata),second=awardProgress(first.progress,level,outcome,metadata);
  expect(first.receipt.parts).toBe(20000+1100);expect(second.receipt.parts).toBe(20000);
  expect(first.progress.endless.earth.milestones).toEqual([1000,3000,5000,10000]);
  expect(Object.keys(first.progress.tracks)).toHaveLength(0);expect(JSON.stringify(second.progress).length).toBeLessThan(1600);
});
test('endless currency retains a legitimate coin collected at the edge of its pickup radius',()=>{
  const level={id:1,mode:'endless',worldId:'earth',max_ticks:Number.MAX_SAFE_INTEGER,stageId:'endless-earth',seed:1,generatorVersion:4};
  const metadata={mode:'endless',world_id:'earth',vehicle_id:'wanderer'};
  const outcome=normalizeFinish(level,{tank:0},{ticks:60,outcome:{status:'failed',distance:14,coinsCollected:1}},metadata);
  expect(outcome.coinValue).toBe(5);expect(awardProgress(freshProgress(),level,outcome,metadata).receipt.parts).toBe(5);
});
test('local vehicle purchases are idempotent across tabs and persist selected upgrades/endless records',async()=>{
  const storage=memory(JSON.stringify({schema:SCHEMA,version:CONFIG.version,progress:{...freshProgress(),balance:10000},sessions:[]}));
  const a=createLocalDriveService({storage}),b=createLocalDriveService({storage});
  const request={vehicle_id:'swift',request_id:'same-vehicle'};
  const results=await Promise.all([a.post('/vehicle/purchase',request),b.post('/vehicle/purchase',request)]);
  expect(results[0].data.progress.balance).toBe(results[1].data.progress.balance);
  await a.post('/upgrade',{vehicle_id:'swift',part:'tank',level:0,request_id:'swift-tank'});
  const session=(await b.post('/start',{mode:'endless',world_id:'earth',vehicle_id:'swift',level:1,request_id:'endless-run'})).data;
  expect(session.upgrades.tank).toBe(1);
  const body={ticks:100,outcome:{distance:1200,coinsCollected:30,status:'failed',reason:'fuel'}};
  const result=(await a.post('/sessions/endless-run/finish',body)).data;
  expect(result.receipt.parts).toBe(250);
  const restored=createLocalDriveService({storage});expect((await restored.post('/sessions/endless-run/finish',body)).data.receipt).toEqual(result.receipt);
  expect((await restored.get()).data.vehicles.swift.records.endless.earth.best).toBe(1200);
});
test('local migration can acknowledge an already saved v3 result without awarding twice',async()=>{
  const body={ticks:1,outcome:{status:'failed',distance:10,gears:[]},abandon:false};
  const storage=memory();const service=createLocalDriveService({storage});
  await service.post('/start',{level:1,request_id:'old-run'});await service.post('/sessions/old-run/finish',body);
  const saved=JSON.parse(storage.getItem(LOCAL_DRIVE_KEY));saved.version=3;saved.schema=3;saved.progress.profile_schema=3;saved.sessions[0].version=3;
  storage.setItem(LOCAL_DRIVE_KEY,JSON.stringify(saved));const restored=createLocalDriveService({storage});
  const retry=(await restored.post('/sessions/old-run/finish',body)).data;
  expect(retry.progress.balance).toBe(saved.progress.balance);expect(retry.progress.tracks['1'].attempts).toBe(1);
});

test('same-schema queued results keep their original generator metadata after terrain updates',async()=>{
  const storage=memory(),service=createLocalDriveService({storage});
  await service.post('/start',{level:1,request_id:'old-map-result'});
  const saved=JSON.parse(storage.getItem(LOCAL_DRIVE_KEY));
  saved.sessions[0].generatorVersion=4;saved.sessions[0].seed=12345;
  storage.setItem(LOCAL_DRIVE_KEY,JSON.stringify(saved));
  const restored=createLocalDriveService({storage}),body={ticks:1,outcome:{status:'completed',gears:[0],generatorVersion:999}};
  const first=(await restored.post('/sessions/old-map-result/finish',body)).data;
  const retry=(await restored.post('/sessions/old-map-result/finish',body)).data;
  expect(first.outcome.generatorVersion).toBe(4);expect(first.outcome.seed).toBe(12345);
  expect(first.progress.profile_schema).toBe(4);expect(retry.progress.balance).toBe(first.progress.balance);
});
