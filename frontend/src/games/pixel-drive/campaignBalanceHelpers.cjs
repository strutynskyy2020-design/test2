// Only imported by authoring/verification tools, never by the playable game.
const {terrain} = require('./engine');
const {stream} = require('./campaignGenerator');
const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
function strategyFor(index, levelId) {
  const rng = stream(0xBA1A2026 + levelId * 65537 + index, 'driver');
  const family = ['aggressive','cautious','run-up','back-up','momentum','low-jump'][index % 6];
  return {
    id:index,family,holdTicks:12+Math.floor(rng()*7),
    targetSpeed:family==='cautious'?14+rng()*7:family==='aggressive'?28+rng()*10:22+rng()*10,
    airP:6+rng()*3,airD:2.4+rng()*1.1,deadband:.3+rng()*.5,
    backupTicks:family==='back-up'?60+Math.floor(rng()*240):0,
    angleMargin:.35+rng()*.25,
    constantGas:index===0,
  };
}
function strategyInput(level,s,strategy) {
  if(strategy.constantGas)return 1;
  if(s.tick<strategy.backupTicks)return 2;
  const angle=wrap(s.angle),slopeAt=x=>Math.atan((terrain(level,x+3)-terrain(level,x-3))/6);
  const slope=slopeAt(s.x);
  if(!s.grounded){
    const target=slopeAt(s.x+s.vx*.4),alpha=strategy.airP*wrap(target-angle)-strategy.airD*s.av;
    return alpha>strategy.deadband?1:alpha< -strategy.deadband?2:0;
  }
  let speed=strategy.targetSpeed;
  if(strategy.family==='run-up'&&slopeAt(s.x+35)>.20)speed=45;
  if(strategy.family==='low-jump'&&slope-slopeAt(s.x+12)>.16)speed=Math.min(speed,15);
  if(angle>slope+strategy.angleMargin)return 2;
  if(strategy.family==='momentum'&&slope< -.08)return s.vx>speed+7?2:0;
  if(s.vx>speed+1)return 2;
  return s.vx>speed?0:1;
}
function profilesFor(level){
  const zero={engine:0,suspension:0,tires:0,tank:0},max={engine:10,suspension:10,tires:10,tank:10};
  const result=[['base',zero],['recommended',level.recommended],['maximum',max],['engine-only',{...zero,engine:10}],['tank-only',{...zero,tank:10}],['strong-F0',{...max,tank:0}]];
  for(const part of ['engine','suspension','tires','tank'])result.push([`recommended-minus-${part}`,{...level.recommended,[part]:Math.max(0,level.recommended[part]-1)}]);
  // Paired with the same 100 recommended-profile controls: isolates what the
  // three suspension purchases contribute on the quarry's rough sections.
  if(level.id===3)result.push(['recommended-S0',{...level.recommended,suspension:0}]);
  return result;
}
module.exports={strategyFor,strategyInput,profilesFor};
