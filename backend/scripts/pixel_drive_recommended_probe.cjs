'use strict';
// Unassisted input-only campaign checks; no edits to state, fuel or forces.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=path.resolve(__dirname,'../..'),source=path.join(root,'frontend/src/games/pixel-drive');
const e=require(path.join(source,'engine')),{controlledRun}=require(path.join(source,'physicsTestHelpers.cjs'));
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(source,file))).digest('hex');
const sourceHashes=Object.fromEntries(['config.json','engine.js','vehiclePhysics.js','physicsControllers.js','terrainPhysics.js','fleetConfig.js','physicsTestHelpers.cjs'].map(f=>[f,hash(f)]));
const started=Date.now(),results=[];
for(const configured of e.CONFIG.levels)for(const speed of [24,18]){
  const level=e.getLevel(configured.id),{state,events}=controlledRun(level,level.recommended,speed,12),outcome=e.summarize(level,state);
  const fuelStops=state.telemetry.fuelStops.map(f=>({x:f.x,tick:f.tick,time:f.tick/60,remaining:f.before,capacity:f.capacity,spentFraction:(f.capacity-f.before)/f.capacity}));
  const row={id:level.id,worldId:level.worldId,meters:level.meters,speedTarget:speed,upgrades:level.recommended,capacity:state.capacity,
    seconds:state.tick/60,status:outcome.status,reason:outcome.reason,distance:outcome.distance,fuelRemaining:outcome.fuelSeconds,
    fuelStops,dryAt:state.telemetry.dryAt,analysis:outcome.analysis,events};
  results.push(row);
  console.log(JSON.stringify({id:row.id,speed,status:row.status,reason:row.reason,distance:row.distance,seconds:+row.seconds.toFixed(3),fuelStops:fuelStops.map(f=>({x:f.x,spent:+f.spentFraction.toFixed(3)}))}));
}
const stale=Object.keys(sourceHashes).filter(f=>hash(f)!==sourceHashes[f]);
const report={generatedAt:new Date().toISOString(),method:'Actual fixed-step unassisted Wanderer runs at recommended ranks, pilotInput target24 and18 m/s, held12ticks. No position, velocity, fuel, force or outcome modifications. Bot failure does not prove impossibility.',sourceHashes,stale,wallSeconds:(Date.now()-started)/1000,results};
fs.writeFileSync(path.join(root,`artifacts/pixel-drive-v${e.CONFIG.generatorVersion}-recommended-probe.json`),JSON.stringify(report,null,2)+'\n');
if(stale.length)process.exitCode=2;
