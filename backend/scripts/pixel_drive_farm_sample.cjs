'use strict';
// Reuse recorded legal input from the campaign benchmark to measure actual pickups.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=path.resolve(__dirname,'../..'),source=path.join(root,'frontend/src/games/pixel-drive');
const inputPath=path.join(root,'artifacts/pixel-drive-v4-campaign-check.json');
const report=JSON.parse(fs.readFileSync(inputPath)),e=require(path.join(source,'engine')),p=require(path.join(source,'progression'));
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(source,file))).digest('hex');
for(const [file,expected] of Object.entries(report.sourceHashes)) if(sha(file)!==expected) throw Error('Campaign trace is stale: '+file);
const picks=[[1,'base'],[2,'base'],[2,'recommended'],[7,'maximum'],[13,'maximum'],[16,'maximum']];
const samples=picks.map(([id,profile])=>{
  const g=report.groups.find(g=>g.level===id&&g.profile===profile&&g.vehicleId==='wanderer'),l=e.getLevel(id),r=g.best;
  const outcome=e.replay(l,g.upgrades,r.events,Math.round(r.seconds*60),false,{vehicleId:g.vehicleId});
  const first=p.awardProgress(p.freshProgress(),l,outcome),repeat=p.awardProgress(first.progress,l,outcome);
  return{level:id,profile,status:outcome.status,reason:outcome.reason,distance:outcome.distance,seconds:outcome.ticks/60,
    pickupCount:outcome.gears.length,coinParts:repeat.receipt.coin_parts,firstReward:first.receipt.parts,
    repeatReward:repeat.receipt.parts,repeatCoinsPerMinute:+(repeat.receipt.parts/(outcome.ticks/60)*60).toFixed(2)};
});
for(const [file,expected] of Object.entries(report.sourceHashes)) if(sha(file)!==expected) throw Error('Sources changed during sample: '+file);
const swift=e.CONFIG.vehicles.find(v=>v.id==='swift').price,tutorial=samples.find(s=>s.level===1).firstReward,early=samples.find(s=>s.level===2&&s.profile==='base');
const output={generatedAt:new Date().toISOString(),method:'Replayed the fastest successful or farthest failed recorded Wanderer strategy from campaign-check. Actual pickups/receipts, no assumption of collecting every coin; no guarantee of human performance. This is a few representative samples, not universal optimal farm.',sourceHashes:report.sourceHashes,samples,
  swiftFromZeroWithoutUpgrades:{price:swift,tutorialReward:tutorial,firstPartialReward:early.firstReward,repeatPartialReward:early.repeatReward,
    partialAttemptsAfterTutorial:Math.max(0,1+Math.ceil(Math.max(0,swift-tutorial-early.firstReward)/early.repeatReward))}};
const target=path.join(root,'artifacts/pixel-drive-v4-farm-sample.json');fs.writeFileSync(target,JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify(output,null,2));
