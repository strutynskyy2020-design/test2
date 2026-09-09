import {CONFIG,createDrive,stepDrive,replay,summarize,getLevel} from './engine';
const {generateCampaign,stream}=require('./campaignGenerator');
const {controlledRun}=require('./physicsTestHelpers.cjs');

describe('Pixel Drive authored campaign',()=>{
  test('tutorial and six main routes are reproducible from independent seed streams',()=>{
    const first=generateCampaign(),second=generateCampaign();
    expect(first).toEqual(second);
    expect(first.levels.map(l=>l.meters)).toEqual([200,600,1000,1600,2200,3000,4000]);
    const geometry=stream(123,'geometry'),same=stream(123,'geometry'),decorations=stream(123,'decorations');
    for(let i=0;i<40;i++){decorations();expect(geometry()).toBe(same());}
    for(const level of first.levels){expect(level.stageId).toBeTruthy();expect(level.generatorVersion).toBe(3);expect(level.seed).toBeGreaterThan(0);}
  });
  test('upgrades cannot alter geometry, surfaces or refill locations',()=>{
    const level=getLevel(2),before=JSON.stringify(level);
    const base=createDrive(level),max=createDrive(level,{engine:10,suspension:10,tires:10,tank:10});
    for(let tick=0;tick<180;tick++){stepDrive(level,base,1);stepDrive(level,max,1);}
    expect(JSON.stringify(level)).toBe(before);
    expect(generateCampaign({upgrades:max.upgrades}).levels[1].terrain).toEqual(generateCampaign({upgrades:base.upgrades}).levels[1].terrain);
  });
  test('modules join continuously with ordered collision geometry and real metadata',()=>{
    for(const level of CONFIG.levels){
      expect(level.modules[0].from).toBe(0);expect(level.modules.at(-1).to).toBe(level.meters);
      for(let i=1;i<level.modules.length;i++)expect(level.modules[i].from).toBe(level.modules[i-1].to);
      for(let i=1;i<level.terrain.length;i++)expect(level.terrain[i][0]).toBeGreaterThan(level.terrain[i-1][0]);
      for(const module of level.modules){
        expect(module.name).toBeTruthy();expect(module.entry.suspensionCompression).toHaveLength(2);
        expect(module.exit.angularSpeed).toHaveLength(2);expect(module.recovery.from).toBe(module.to);
        expect(module.pickups.coins.every(i=>i>=0&&i<level.gears.length)).toBe(true);
      }
      for(const x of level.fuel)expect(x).toBeGreaterThan(0);
    }
  });
  test('prices are explicit 0-to-10 levels and checkpoint rewards never move fuel',()=>{
    expect(CONFIG.minUpgrade).toBe(0);expect(CONFIG.maxUpgrade).toBe(10);
    for(const part of CONFIG.parts){
      expect(CONFIG.upgradePrices[part]).toHaveLength(10);
      expect(CONFIG.upgradePrices[part].every((v,i)=>v%50===0&&(i===0||v>CONFIG.upgradePrices[part][i-1]))).toBe(true);
      expect(CONFIG.economy.startingUpgradePrices[part]).toEqual(Array.from({length:10},(_,level)=>Math.round(CONFIG.economy.basePrices[part]*1.38**level/50)*50));
      expect(CONFIG.upgradePrices[part].slice(0,3)).toEqual(CONFIG.economy.startingUpgradePrices[part].slice(0,3));
    }
    expect(CONFIG.upgradePrices.engine[0]).toBe(350);expect(CONFIG.levels[0].finishReward).toBeGreaterThanOrEqual(350);
    for(const level of CONFIG.levels){expect(level.coinValues).toHaveLength(level.gears.length);expect(new Set(level.gears).size).toBe(level.gears.length);expect(level.checkpoints.every(c=>c.id&&c.reward>=0)).toBe(true);}
  });
  test('quarry suspension buys useful pace and fuel reserve, with a careful S0 alternative',()=>{
    const level=getLevel(3),weak={...level.recommended,suspension:0};
    for(const cadence of[12,18]){
      const upgraded=controlledRun(level,level.recommended,26,cadence).state;
      const pairedWeak=controlledRun(level,weak,26,cadence).state;
      const carefulWeak=controlledRun(level,weak,18,cadence).state;
      expect(upgraded.status).toBe('completed');expect(upgraded.fuel).toBeGreaterThan(7.5);
      expect(pairedWeak.status).toBe('failed');expect(pairedWeak.reason).toBe('overturned');
      expect(carefulWeak.status).toBe('completed');
      expect(carefulWeak.tick-upgraded.tick).toBeGreaterThan(6*60);
    }
  });
  test.each([1,2,3,4,5,6,7])('recommended legal 0.2s pedal commands finish route %i and replay agrees',id=>{
    const level=getLevel(id),{state,events}=controlledRun(level);
    expect(state.status).toBe('completed');expect(events.every((event,i)=>i===0||event[0]-events[i-1][0]>=12)).toBe(true);
    expect(replay(level,level.recommended,events,state.tick)).toEqual(summarize(level,state));
  });
});
