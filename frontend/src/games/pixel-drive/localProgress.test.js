import {createLocalDriveService, LOCAL_DRIVE_KEY} from './localProgress';
import {CONFIG, createDrive, getLevel, stepDrive, summarize} from './engine';
import {SCHEMA, freshProgress} from './progression';
const memory = initial => {const data = new Map(initial ? [[LOCAL_DRIVE_KEY,JSON.stringify(initial)]] : []); return {getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value)};};
const seed = () => ({schema:SCHEMA,version:CONFIG.version,progress:{...freshProgress(),balance:1000},sessions:[]});

test('local purchases and retries survive reload with ranks starting at zero', async () => {
  const storage=memory(seed()), service=createLocalDriveService({storage}), purchase={part:'engine',level:0,request_id:'buy-one'};
  await service.post('/upgrade',purchase);
  const restored=createLocalDriveService({storage}), {data}=await restored.get();
  expect(data.balance).toBe(650); expect(data.upgrades.engine).toBe(1); expect(data.vehicles.wanderer.upgrades).toEqual(data.upgrades);
  expect((await restored.post('/upgrade',purchase)).data.progress.balance).toBe(650);
  await expect(restored.post('/upgrade',{...purchase,part:'tank'})).rejects.toThrow('інші параметри');
});
test('two service instances serialize purchases against the current saved balance', async () => {
  const value=seed();value.progress.balance=350;
  const storage=memory(value), a=createLocalDriveService({storage}), b=createLocalDriveService({storage});
  const results=await Promise.allSettled([a.post('/upgrade',{part:'engine',level:0,request_id:'a'}),b.post('/upgrade',{part:'tank',level:0,request_id:'b'})]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  expect((await b.get()).data.balance).toBe(0);
});
test.each(['json','version','balance','upgrades'])('invalid %s save recovers safely', async kind => {
  const value=seed();if(kind==='version')value.version=99;if(kind==='balance')value.progress.balance=-1;if(kind==='upgrades')value.progress.upgrades.engine=99;
  const storage=memory(value);if(kind==='json')storage.setItem(LOCAL_DRIVE_KEY,'{broken');
  const {data}=await createLocalDriveService({storage}).get();
  expect(data.balance).toBe(0);expect(data.upgrades.engine).toBe(0);expect(data.storage_reset).toBe(true);
});
test('legacy local progress migrates once without turning old finishes into new ones', async () => {
  const storage=memory({schema:1,version:2,progress:{balance:100,upgrades:{engine:3,suspension:1,tires:2,tank:1},tracks:{'4':{best:1200,medals:['finish'],gears:[0]}}},purchases:[]});
  const first=(await createLocalDriveService({storage}).get()).data;
  expect(first.balance).toBe(100+CONFIG.levels[0].finishReward);expect(first.upgrades.engine).toBe(2);
  expect(first.tutorial_granted).toBe(true);expect(first.unlocked_level).toBe(2);expect(first.tracks['1'].medals).toEqual([]);
  expect((await createLocalDriveService({storage}).get()).data.balance).toBe(first.balance);
});
test('unavailable storage remains playable and discloses memory mode', async () => {
  const service=createLocalDriveService({storage:{getItem(){throw new Error('disabled');},setItem(){throw new Error('disabled');}}});
  expect((await service.get()).data.storage_mode).toBe('memory');
  expect((await service.post('/start',{level:1,request_id:'a'})).data.version).toBe(CONFIG.version);
});
test('browser outcome awards survive reload and a new run restores ordinary coins only', async () => {
  const storage=memory(), service=createLocalDriveService({storage}), level=getLevel(1), state=createDrive(level);
  while(state.status==='playing'&&state.tick<1800)stepDrive(level,state,1);
  const payload={outcome:summarize(level,state),ticks:state.tick,abandon:state.status==='playing'};
  await service.post('/start',{level:1,request_id:'first'});
  const first=(await service.post('/sessions/first/finish',payload)).data;
  const restored=createLocalDriveService({storage});
  expect((await restored.post('/sessions/first/finish',payload)).data.progress.balance).toBe(first.progress.balance);
  await restored.post('/start',{level:1,request_id:'second'});
  const second=(await restored.post('/sessions/second/finish',payload)).data;
  expect(second.receipt.parts).toBe(second.receipt.coin_parts);expect(second.receipt.parts).toBeGreaterThan(0);
  expect(second.progress.balance).toBe(first.progress.balance+second.receipt.parts);
  await expect(restored.post('/sessions/first/finish',{...payload,ticks:1})).rejects.toThrow('завершено');
  await expect(restored.post('/start',{level:0,request_id:'dev'})).rejects.toThrow('Невідома');
},30000);

test('a reported finish saves without replay and derives currency from configured pickups', async () => {
  const service=createLocalDriveService({storage:memory()}), level=getLevel(1);
  const status=(await service.get()).data;
  expect(status.result_mode).toBe('client');expect(status.save_scope).toBe('local');
  await service.post('/start',{level:1,request_id:'client-finish'});
  // A one-tick finish is deliberately trusted now; its invented coin amount is not.
  const payload={ticks:1,abandon:false,outcome:{status:'completed',gears:[0,0,99999],coinValue:999999,fuelSeconds:0}};
  const result=(await service.post('/sessions/client-finish/finish',payload)).data;
  expect(result.outcome.status).toBe('completed');expect(result.outcome.distance).toBe(level.meters);
  expect(result.receipt.coin_parts).toBe(level.coinValues[0]);
  expect(result.receipt.finish_parts).toBe(level.finishReward);
  expect(result.progress.unlocked_level).toBe(2);
});

test('legacy event-only payload asks for reload instead of replaying a run', async () => {
  const service=createLocalDriveService({storage:memory()});
  await service.post('/start',{level:1,request_id:'legacy'});
  await expect(service.post('/sessions/legacy/finish',{ticks:1,events:[[0,1]],abandon:true}))
    .rejects.toMatchObject({message:expect.stringContaining('Оновіть сторінку'),response:{status:409}});
  expect((await service.get()).data.balance).toBe(0);
});
test('local session storage remains bounded across repeated starts', async () => {
  const storage=memory(), service=createLocalDriveService({storage});
  for(let i=0;i<110;i++)await service.post('/start',{level:1,request_id:`run-${i}`});
  expect(JSON.parse(storage.getItem(LOCAL_DRIVE_KEY)).sessions).toHaveLength(100);
});
test('reload or another tab supersedes the old active run and keeps same-start retries idempotent', async () => {
  const storage=memory(), first=createLocalDriveService({storage});
  const initial=(await first.post('/start',{level:1,request_id:'before-reload'})).data;
  const restored=createLocalDriveService({storage});
  expect((await restored.post('/start',{level:1,request_id:'before-reload'})).data.session_id).toBe(initial.session_id);
  await restored.post('/start',{level:1,request_id:'after-reload'});
  await expect(first.post('/sessions/before-reload/finish',{ticks:30,events:[[0,1]],abandon:true})).rejects.toMatchObject({response:{status:409,data:{detail:{code:'run_superseded'}}}});
  expect((await restored.get()).data.balance).toBe(0);
  expect(JSON.parse(storage.getItem(LOCAL_DRIVE_KEY)).sessions.filter(s=>!s.superseded&&!s.result)).toHaveLength(1);
});
