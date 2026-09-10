const {assertSessionMap}=require('./sessionMap');
const {normalizeFinish}=require('./finishResult');
const CONFIG=require('./config.json');
const requested={mode:'campaign',worldId:'earth',vehicleId:'wanderer'};
const level={...CONFIG.levels[0],generatorVersion:5,seed:123,stageId:'tutorial-map'};
const session={version:4,generatorVersion:5,seed:123,stageId:'tutorial-map',mode:'campaign',world_id:'earth',vehicle_id:'wanderer'};

test('a new generator does not require a new save schema when the start map agrees',()=>{
  expect(()=>assertSessionMap(session,level,requested)).not.toThrow();
});
test.each([
  {generatorVersion:4},{generatorVersion:undefined},{seed:124},{stageId:'old-map'},
  {mode:'endless'},{world_id:'moon'},{vehicle_id:'swift'},
])('start rejects a different immutable map or vehicle %j',changes=>{
  expect(()=>assertSessionMap({...session,...changes},level,requested)).toThrow('Перезавантажте сторінку');
  try{assertSessionMap({...session,...changes},level,requested);}catch(error){expect(error.response.status).toBe(409);}
});
test('endless accepts the server seed on the same generator and world',()=>{
  expect(()=>assertSessionMap({...session,mode:'endless',world_id:'moon'},level,{...requested,mode:'endless',worldId:'moon'})).not.toThrow();
});
test('a previously played map can still normalize its queued outcome after a generator update',()=>{
  const old={...session,generatorVersion:4,seed:99,stageId:'old-map'};
  const outcome=normalizeFinish(level,{tank:0},{ticks:1,outcome:{status:'completed',generatorVersion:999,gears:[0]}},old);
  expect(outcome.generatorVersion).toBe(4);expect(outcome.seed).toBe(99);expect(outcome.stageId).toBe('old-map');
  expect(outcome.coinValue).toBe(level.coinValues[0]);
});
