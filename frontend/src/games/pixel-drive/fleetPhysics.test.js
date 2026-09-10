const {createDrive,stepDrive,getTestLevel,getEndlessLevel,getUpgradeStats,surfaceFriction,summarize,terrain,replay,captureDrive,interpolateDrive} = require('./engine');
const {VEHICLES,WORLDS,getVehicle} = require('./fleetConfig');
const {flatLevel,runTicks} = require('./physicsTestHelpers.cjs');

describe('fleet and planetary force invariants',()=>{
  test.each(VEHICLES.map(v=>v.id))('%s has fixed total mass, inertia and construction in every world',vehicleId=>{
    const states=WORLDS.map(world=>createDrive(flatLevel({worldId:world.id}),{}, {vehicleId}));
    for(const s of states){
      expect(s.diagnostics.com.mass).toBeCloseTo(getVehicle(vehicleId).mass,8);
      expect(s._physics.chassis.getInertia()).toBe(states[0]._physics.chassis.getInertia());
      expect(s._physics.world.getGravity().y).toBe(-s._physics.p.gravity);
    }
  });
  test('Earth and Moon ballistic times match analytic values with no aerodynamic forces',()=>{
    for(const worldId of ['earth','moon']){
      const l=flatLevel({worldId}),s=createDrive(l,{}, {x:9,y:100,vx:15,vy:6,physics:{airDrag:0}});
      const start=s.diagnostics.com, g=s._physics.p.gravity, duration=2*6/g;
      runTicks(l,s,Math.round(duration*60));
      const t=s.tick/60;
      expect(s.diagnostics.com.x-start.x).toBeCloseTo(15*t,6);
      expect(s.diagnostics.com.y-start.y).toBeCloseTo(6*t-.5*g*t*(t+1/120),6);
      expect(Math.abs(t-duration)).toBeLessThan(1/60);
    }
  });
  test('light and heavy vehicles fall equally; ordinary pedals cannot produce linear thrust in vacuum',()=>{
    for(const vehicleId of ['swift','bastion','orbiter']){
      const l=flatLevel({worldId:'moon'}),states=[0,1,2,3].map(()=>createDrive(l,{}, {vehicleId,y:100,vx:12,vy:0}));
      states.forEach((s,input)=>runTicks(l,s,60,input));
      for(const s of states){expect(s.diagnostics.com.vy).toBeCloseTo(-2.3,7);expect(s.diagnostics.com.vx).toBeCloseTo(12,7);}
    }
  });
  test('wings use atmosphere density, and suspension sag responds naturally to gravity',()=>{
    const results={};
    for(const worldId of ['earth','moon','basalt']){
      const l=flatLevel({worldId}),r=createDrive(l,{}, {vehicleId:'rally',y:100,vx:20});stepDrive(l,r,0);
      results[worldId]=r.diagnostics.aeroForce;
      const s=createDrive(l);runTicks(l,s,360);results[`${worldId}Sag`]=s.wheels[0].compression;
    }
    expect(results.moon).toEqual({x:0,y:0});
    expect(results.earth.y).toBeLessThan(-100);
    expect(results.basalt.y).toBeLessThan(results.earth.y);
    expect(results.moonSag).toBeLessThan(results.earthSag);
    expect(results.basaltSag).toBeGreaterThan(results.earthSag);
  });
  test('tracks use multiple contacts and divide one bounded torque budget',()=>{
    for(const vehicleId of ['bastion','sprinter']){
      const l=flatLevel(),s=createDrive(l,{engine:10},{vehicleId});runTicks(l,s,60,1);
      expect(s.wheels.length).toBeGreaterThanOrEqual(5);
      expect(s.wheels.every(w=>w.role==='roller')).toBe(true);
      expect(s.wheels.filter(w=>w.grounded).length).toBeGreaterThanOrEqual(4);
      expect(s.wheels.reduce((sum,w)=>sum+Math.abs(w.driveTorque),0)).toBeLessThanOrEqual(getUpgradeStats({engine:10},vehicleId).torqueNm);
    }
  });
  test('snowmobile has a physical polygon ski, passive prismatic suspension and rear-only drive',()=>{
    const l=flatLevel({surface:'snow'}),s=createDrive(l,{}, {vehicleId:'polar'});runTicks(l,s,120,1);
    const front=s.wheels.length-1;
    expect(s.wheels[front].role).toBe('ski');expect(s.wheels[front].driveTorque).toBe(0);
    expect(s._physics.joints[front].getType()).toBe('prismatic-joint');
    expect(s._physics.wheels[front].getFixtureList().getShape().getType()).toBe('polygon');
    expect(surfaceFriction(l,0,s._physics.p,'roller')).toBeGreaterThan(surfaceFriction(l,0,s._physics.p,'wheel'));
    expect(surfaceFriction(l,0,s._physics.p,'ski')).toBeLessThan(.1);
  });
  test('repulsors support marked liquid but lose support beyond finite range and over gaps',()=>{
    for(const testCase of [{liquids:[{from:-100,to:1200,y:0}],supported:true},{gaps:[{from:-100,to:1200}],supported:false}]){
      const l=flatLevel(testCase),s=createDrive(l,{}, {vehicleId:'glider',y:1.3});runTicks(l,s,60,0);
      if(testCase.supported){expect(s.y).toBeGreaterThan(.8);expect(s.diagnostics.repulsors.some(r=>r.force>0)).toBe(true);}
      else {expect(s.y).toBeLessThan(-3);expect(s.diagnostics.repulsors.every(r=>r.force===0)).toBe(true);}
      for(const r of s.diagnostics.repulsors)expect(r.force).toBeLessThanOrEqual(s._physics.p.hoverMaxForce);
    }
    const l=flatLevel(),s=createDrive(l,{}, {vehicleId:'glider',y:20});runTicks(l,s,30,1);
    expect(s.diagnostics.repulsors.every(r=>r.force===0)).toBe(true);expect(s.vx).toBeCloseTo(0,8);
  });
  test('Orbiter jet is a separate finite force with same magnitude on every world and 9x fuel cost',()=>{
    const values={};
    for(const worldId of ['earth','moon','basalt']){
      const l=flatLevel({worldId}),s=createDrive(l,{}, {vehicleId:'orbiter',y:100,physics:{airDrag:0}});runTicks(l,s,60,4);
      values[worldId]=s.diagnostics.com.vy;
      expect(s.diagnostics.jetForce).toBe(8500);expect(s.fuel).toBe(41);
      expect(s.diagnostics.com.vy).toBeCloseTo(8500/700-s._physics.p.gravity,6);
    }
    expect(values.moon).toBeGreaterThan(values.earth);expect(values.basalt).toBeLessThan(0);
    const l=flatLevel(),s=createDrive(l,{}, {vehicleId:'orbiter',y:100});runTicks(l,s,60,3);
    expect(s.fuel).toBe(49);expect(s.diagnostics.jetForce).toBe(0);
    s.fuel=0;stepDrive(l,s,4);expect(s.diagnostics.jetForce).toBe(0);
    const last=createDrive(l,{}, {vehicleId:'orbiter',y:100});last.fuel=.1;stepDrive(l,last,4);
    expect(last.diagnostics.jetLevel).toBe(.625);expect(last.fuel).toBe(0);
  });
  test('test course has actual ceiling collision and gaps have no phantom floor',()=>{
    expect(getTestLevel('mars').ceilings.length).toBeGreaterThan(0);
    const l=flatLevel({ceilings:[{from:-100,to:1200,y:4}]}),s=createDrive(l,{}, {y:2.8,vy:8});runTicks(l,s,30);
    expect(s.reason).toBe('overturned');
    const gap=flatLevel({gaps:[{from:-100,to:1200}]}),fall=createDrive(gap);runTicks(gap,fall,60);
    expect(fall.grounded).toBe(0);expect(fall.y).toBeLessThan(-3);
  });
  test('endless milestones never finish the run and long-coordinate initialization preserves distances',()=>{
    for(const worldId of WORLDS.map(w=>w.id)){
      const l=getEndlessLevel(worldId,123),s=createDrive(l,{engine:10,suspension:10,tires:10,tank:10},{x:100009,y:terrain(l,100009)+2});
      stepDrive(l,s,0);
      expect(s.status).toBe('playing');expect(s.best).toBeGreaterThan(99999);
      expect(s.diagnostics.originX).toBe(100000);expect(s.diagnostics.terrainChunks).toBeLessThan(12);
      expect(l.cachedChunkCount()).toBeLessThan(15);expect(summarize(l,s).distance).toBeGreaterThanOrEqual(99999);
    }
  });
  test('specialist input can be replayed deterministically and public pickup snapshots stay bounded',()=>{
    const l=flatLevel({worldId:'moon'}),options={vehicleId:'orbiter'},s=createDrive(l,{},options);
    runTicks(l,s,30,4);s.status='failed';s.reason='abandoned';
    expect(replay(l,{},[[0,4]],30,true,options)).toEqual(summarize(l,s));
    const endless=getEndlessLevel('earth',4),state=createDrive(endless);
    runTicks(endless,state,120,1);const previous=captureDrive(state);stepDrive(endless,state,1);const view=interpolateDrive(previous,state,.5);
    expect(Object.keys(view.pickupChunks).length).toBeLessThan(8);
    expect(Object.values(view.pickupChunks).every(value=>Array.isArray(value.gears)&&Array.isArray(value.cans))).toBe(true);
    expect(view._physics).toBeUndefined();
    expect(interpolateDrive(null,state,0).pickupChunks).toEqual(view.pickupChunks);
    expect(interpolateDrive(previous,state,.5).retiredPickupBefore).toBe(state._physics.retiredPickupBefore);
    expect(captureDrive(view).pickupChunks).toEqual(view.pickupChunks);
  });
  test('retiring streamed pickup chunks prevents coin and fuel farming after returning',()=>{
    const {Vec2}=require('./vendor/planck'),level=getEndlessLevel('earth',7);
    level.terrainAt=()=>0;
    level.getChunk=index=>({gears:[index*120+25],coinValues:[5],fuel:[index*120+25],surfaces:[],gaps:[],liquids:[],ceilings:[]});
    const state=createDrive(level,{}, {x:25});state.fuel=12;stepDrive(level,state,0);
    expect(state.coinsCollected).toBe(1);expect(state.fuel).toBe(40);
    const relocate=x=>{
      const dx=x-state.x;
      for(const body of [state._physics.chassis,...state._physics.wheels]){
        const p=body.getPosition();body.setTransform(Vec2(p.x+dx,p.y),body.getAngle());
      }
      state.x=x;stepDrive(level,state,0);
    };
    relocate(1000);expect(state._physics.retiredPickupBefore).toBeGreaterThan(25);
    state.fuel=10;relocate(25);
    expect(state.coinsCollected).toBe(1);expect(state.fuel).toBeLessThan(10);
    expect(state._physics.pickupChunks.size).toBeLessThan(8);
  });
  test.each([['earth',480],['moon',1080],['mars',480],['basalt',840]])('pickups at %s chunk boundaries work from either side and cannot repeat',(worldId,position)=>{
    for(const side of [-1,1])for(const direction of [-1,1]){
      const l=getEndlessLevel(worldId,17),s=createDrive(l,{}, {x:position+side*.5,vx:direction});s.fuel=10;
      stepDrive(l,s,0);expect(s.fuel).toBe(40);
      stepDrive(l,s,0);expect(s.fuel).toBeLessThan(40);
    }
    for(const side of [-1,1]){
      const l=getEndlessLevel(worldId,17),s=createDrive(l,{}, {x:600+side*.5});
      stepDrive(l,s,0);expect(s.coinsCollected).toBe(1);stepDrive(l,s,0);expect(s.coinsCollected).toBe(1);
    }
  });
  test('fast movement sweeps pickups in both directions without collecting high overhead',()=>{
    for(const direction of [-1,1])for(const y of [1.2,10]){
      const l=getEndlessLevel('moon',23);l.terrainAt=()=>0;
      const s=createDrive(l,{}, {x:600-direction*2,vx:direction*250,y,vehicleId:'orbiter'});
      stepDrive(l,s,0);expect(s.coinsCollected).toBe(y===1.2?1:0);
      stepDrive(l,s,0);expect(s.coinsCollected).toBe(y===1.2?1:0);
    }
    const l=getEndlessLevel('earth',23);l.terrainAt=()=>0;
    const s=createDrive(l,{}, {x:478,vx:250,y:1.2});s.fuel=0;stepDrive(l,s,0);
    expect(s.fuel).toBe(40);
  });
});
