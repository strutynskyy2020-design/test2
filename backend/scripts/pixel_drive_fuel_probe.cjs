'use strict';
// AUTHORING ONLY. Fuel is replenished each tick to measure travel time. These
// runs are not evidence of campaign completion; proposed placements need legal
// no-intervention runs before adoption. Never imported by game or API code.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=path.resolve(__dirname,'../..'),source=path.join(root,'frontend/src/games/pixel-drive');
const e=require(path.join(source,'engine')),{pilotInput}=require(path.join(source,'physicsTestHelpers.cjs'));
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(source,file))).digest('hex');
const sourceHashes=Object.fromEntries(['config.json','engine.js','vehiclePhysics.js','physicsControllers.js','terrainPhysics.js','fleetConfig.js','physicsTestHelpers.cjs'].map(f=>[f,hash(f)]));
const round=n=>+n.toFixed(3),results=[];
for(const configured of e.CONFIG.levels){
  const level=e.getLevel(configured.id),s=e.createDrive(level,level.recommended,{vehicleId:'wanderer'});
  const samples=[],eligible=[];let input=0,previousMax=-Infinity;
  while(s.status==='playing'){
    // Only exception in this authoring probe; no production state is modified.
    s.fuel=s.capacity;
    if(s.tick%12===0)input=pilotInput(level,s,24);
    e.stepDrive(level,s,input);
    const yAbove=s.y-e.terrain(level,s.x),forward=s.x>=previousMax-.15&&s.vx>.5;
    previousMax=Math.max(previousMax,s.x);
    if(s.tick%60===0 || s.status!=='playing')samples.push({time:round(s.tick/60),x:round(s.x),progress:round(s.best),height:round(yAbove),grounded:s.grounded,speed:round(s.vx)});
    // Margin inside the real +/-2.1m pickup-height envelope. First forward pass
    // avoids choosing a refill that would be collected before a backtracking loop.
    if(s.tick%6===0&&forward&&Math.abs(yAbove-1.15)<1.5&&Math.abs(s.angle)<.9)
      eligible.push({time:s.tick/60,x:s.x,height:yAbove,grounded:s.grounded});
  }
  const seconds=s.tick/60,capacity=s.capacity,placements=[],warnings=[];
  let lastTime=0,lastX=level.startX||9;
  if(level.id<=3 && level.fuel.length){
    const intro=s.telemetry.fuelStops.find(f=>f.index===0);
    if(intro){placements.push({x:level.fuel[0],time:intro.tick/60,spentFraction:intro.tick/60/capacity,preservedIntro:true});lastTime=intro.tick/60;lastX=level.fuel[0];}
    else warnings.push('Existing intro can was missed; preserve it but revalidate its reachability.');
  }
  while(seconds-lastTime>capacity*.85){
    const target=lastTime+capacity*.75,deadline=lastTime+Math.min(capacity*.85,capacity-4);
    let candidates=eligible.filter(v=>v.time>=lastTime+capacity*.62&&v.time<=deadline&&v.x>lastX+20&&v.x<(level.startX||9)+level.meters-20);
    if(!candidates.length){
      candidates=eligible.filter(v=>v.time>lastTime+5&&v.time<=deadline&&v.x>lastX+20);
      if(!candidates.length){warnings.push('No safe first-pass low-height refill before deadline. Needs geometry/pilot review.');break;}
      warnings.push('Long flight or difficult section requires a refill earlier than 62% of capacity.');
    }
    candidates.sort((a,b)=>Math.abs(a.time-target)-Math.abs(b.time-target));
    const chosen=candidates[0],x=Math.round(chosen.x);
    placements.push({x,time:round(chosen.time),spentFraction:round((chosen.time-lastTime)/capacity),height:round(chosen.height),grounded:chosen.grounded});
    lastTime=chosen.time;lastX=x;
  }
  const finalLeg=round((seconds-lastTime)/capacity);
  if(s.status!=='completed')warnings.push(`Fuel-supported pilot failed: ${s.reason}; placements only cover sampled geometry.`);
  const firstLegSeconds=placements[0]?.time || seconds;
  if(level.id>=4&&firstLegSeconds<=40)warnings.push('First leg <=40s; F0 barrier must come from torque/traction or placement adjustment.');
  results.push({id:level.id,worldId:level.worldId,meters:level.meters,upgrades:level.recommended,capacity,status:s.status,reason:s.reason,
    seconds:round(seconds),distance:round(s.best),existingFuel:level.fuel,proposedFuel:placements.map(p=>p.x),placements,firstLegSeconds:round(firstLegSeconds),finalLegFraction:finalLeg,warnings,samples});
}
const stale=Object.keys(sourceHashes).filter(f=>hash(f)!==sourceHashes[f]);
const report={generatedAt:new Date().toISOString(),method:'AUTHORING ONLY: fuel reset to capacity every tick, Wanderer recommended profiles, pilotInput target24 m/s at12tick cadence. One-second trajectory samples; safe pickup candidates at0.1s cadence, within height envelope and first forward pass. Proposals target75% capacity, keep4s reserve; first intro can retained only for levels1–3. Not proof of unassisted completion.',sourceHashes,stale,results};
fs.writeFileSync(path.join(root,`artifacts/pixel-drive-v${e.CONFIG.generatorVersion}-fuel-probe.json`),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({stale,results:results.map(({samples,...row})=>row)},null,2));
if(stale.length)process.exitCode=2;
