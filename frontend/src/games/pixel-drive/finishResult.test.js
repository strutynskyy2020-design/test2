import {normalizeFinish} from './finishResult';
import {getLevel} from './engine';

const level=getLevel(2), upgrades={engine:0,suspension:0,tires:0,tank:3};
const finish=(outcome,body={})=>normalizeFinish(level,upgrades,{ticks:60,abandon:false,outcome,...body},
  {stageId:level.stageId,seed:level.seed,generatorVersion:level.generatorVersion});

test('reported pickups are deduplicated and only server-defined rewards and metadata survive', () => {
  const cp=level.checkpoints[0].id;
  const result=finish({status:'completed',ticks:999999,distance:999999,gears:[1,0,1,-1,0.5,'2',999999],
    checkpoints:[cp,cp,'fake'],coinValue:999999,medals:['collector','economy'],fuel:100,fuelSeconds:0,
    stageId:'fake',seed:123,generatorVersion:999});
  expect(result).toMatchObject({status:'completed',reason:'finish',ticks:60,distance:level.meters,
    gears:[0,1],checkpoints:[cp],coinValue:level.coinValues[0]+level.coinValues[1],medals:['finish'],
    fuel:0,fuelSeconds:0,stageId:level.stageId,seed:level.seed,generatorVersion:level.generatorVersion});
});

test('abandon forces a failure and excludes finish medals', () => {
  const result=finish({status:'completed',distance:17.8,gears:[],fuelSeconds:52},{abandon:true});
  expect(result).toMatchObject({status:'failed',reason:'abandoned',distance:17,medals:[],fuel:100});
});

test.each([NaN,Infinity,-3,'200',null,{}])('invalid distance and fuel %p cannot inflate results', value => {
  expect(finish({status:'failed',distance:value,fuelSeconds:value})).toMatchObject({distance:0,fuel:0,fuelSeconds:0});
});

test('values are bounded by track length and the session tank while fractional fuel remains precise', () => {
  expect(finish({status:'failed',reason:'stuck',distance:99999,fuelSeconds:999})).toMatchObject({distance:level.meters,fuelSeconds:52,fuel:100,reason:'stuck'});
  expect(finish({status:'completed',fuelSeconds:10.4})).toMatchObject({fuelSeconds:10.4,medals:['finish','economy']});
  expect(finish({status:'completed',fuelSeconds:10.399})).toMatchObject({medals:['finish']});
});

test('analysis is bounded, cleaned as text, and cannot inject extra fields', () => {
  const result=finish({status:'invalid',reason:'invented',analysis:[null,[],{message:'\u0000  '},
    {type:'\u0001',message:'\u0000  valid \u0007 ',secret:'discard'},
    {type:'🙂'.repeat(45),message:'🙂'.repeat(401)},{message:'third'},{message:'fourth'}]});
  expect(result.reason).toBe('ended');expect(result.analysis).toHaveLength(3);
  expect(result.analysis[0]).toEqual({type:'info',message:'valid'});
  expect(Array.from(result.analysis[1].type)).toHaveLength(40);
  expect(Array.from(result.analysis[1].message)).toHaveLength(400);
});

test.each([0,-1,1.5,'60',NaN,level.max_ticks+1])('rejects an invalid duration %p', ticks => {
  expect(()=>finish({status:'completed'},{ticks})).toThrow('Некоректна тривалість');
});

test('collector requires the configured pickup threshold', () => {
  const gears=level.gears.map((_,i)=>i).slice(0,Math.ceil(level.gears.length*.7));
  expect(finish({status:'completed',gears}).medals).toEqual(['finish','collector']);
  expect(finish({status:'completed',gears:gears.slice(1)}).medals).toEqual(['finish']);
});
