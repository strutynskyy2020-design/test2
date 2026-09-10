// Height offsets for the authored road. This is collision geometry, not a
// camera effect. Every offset and its derivative vanish at a module boundary.
const clamp=x=>Math.max(0,Math.min(1,x));
const smooth=x=>{const t=clamp(x);return t*t*(3-2*t);};
const WORLD_SCALE={earth:{length:1,height:1},moon:{length:1.65,height:1.25},mars:{length:1.25,height:1.1},basalt:{length:.95,height:.9}};

function reliefHeight(type,length,x,phase,worldId='earth',tutorial=false){
  if(x<=0||x>=length)return 0;
  const world=WORLD_SCALE[worldId]||WORLD_SCALE.earth;
  // Long grades retain their climbing demand while no longer looking like a
  // straight ramp. Recovery sections have rolling hills between challenges.
  const settings=type==='intro'?[tutorial ? .42 : .92,24]
    :type==='recovery'?[tutorial ? .4 : 1.15,28]
    :type==='rollers'?[.38,30]
    :type==='jump'?[.6,24]
    :type==='tunnel'?[.1,35]
    :type==='ice'||type==='mineral'?[.45,32]
    :[tutorial ? .3 : .65,32];
  const amplitude=settings[0]*world.height,wavelength=settings[1]*world.length;
  const edge=Math.min(length/3,worldId==='moon'?14:8);
  const envelope=smooth(x/edge)*smooth((length-x)/edge);
  const angle=2*Math.PI*x/wavelength+phase*16;
  const wave=Math.sin(angle)+.2*Math.sin(angle*1.9+.8);
  return amplitude*envelope*wave;
}

module.exports={reliefHeight};
