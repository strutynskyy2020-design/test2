'use strict';
// Config-based upper bounds: collecting every pickup, not measured driving income.
const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'../..'),c=require(path.join(root,'frontend/src/games/pixel-drive/config.json'));
const sum=values=>values.reduce((a,b)=>a+b,0);
const routes=c.levels.map(l=>({id:l.id,name:l.name,meters:l.meters,pickups:l.gears.length,
  repeat_coin_upper_bound:sum(l.coinValues),first_finish_upper_bound:sum(l.coinValues)+sum(l.checkpoints.map(cp=>cp.reward))+l.finishReward,
  recommended_wanderer_cost:sum(Object.entries(l.recommended).map(([part,rank])=>sum(c.upgradePrices[part].slice(0,rank))))}));
const tutorial=routes[0].first_finish_upper_bound,swift=c.vehicles.find(v=>v.id==='swift').price,early=c.levels[1];
const partial=[100,150,200,250,300].map(distance=>{const coins=sum(early.gears.map((x,i)=>x<=distance?early.coinValues[i]:0));
  return {distance,coins,additional_attempts_for_swift_after_full_tutorial:Math.max(0,Math.ceil((swift-tutorial)/coins))};});
const result={version:c.version,scope:'Configuration upper bounds; assumes all pickups collected. No physical playthrough or timing claim.',
  routes,partial,all_vehicle_base_prices:sum(c.vehicles.map(v=>v.price)),wanderer_all_upgrades:sum(Object.values(c.upgradePrices).map(sum)),
  endless_repeat_coins_per_meter:.2,endless_first_world_milestones:1100};
const output=path.join(root,'artifacts/pixel-drive-v4-economy-audit.json');fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
console.log(output);
