// Random-access terrain: every fragment can be regenerated without retaining
// previous fragments or using the selected vehicle/upgrades as an input.
const {getWorld}=require('./fleetConfig');
const CHUNK_SIZE=120;
const GENERATOR_VERSION=5;
const MILESTONES=[1000,3000,5000,10000];
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const smooth=t=>t*t*(3-2*t);
const hash=(seed,tag)=>{let h=seed>>>0;for(const c of tag)h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0;};
const PROFILES={
  earth:{moduleLength:120,crest:2.6,width:15,valley:2.1,long:[5,4,170,1.2,1,47]},
  moon:{moduleLength:240,crest:4.1,width:28,valley:3.6,long:[9,9,340,1.2,1.5,135]},
  mars:{moduleLength:160,crest:2.9,width:19,valley:2.5,long:[5,5,220,1,1,68]},
  basalt:{moduleLength:140,crest:2.1,width:17,valley:1.7,long:[3,3,200,.6,.7,62]},
};
// Compact raised-cosine features have zero height AND zero slope at their
// boundaries. A module boundary is therefore not a collision seam or a wall.
const mound=(x,center,width,height)=>{
  const t=(x-center)/width;
  return Math.abs(t)>=1?0:height*(1+Math.cos(Math.PI*t))/2;
};
const featureAt=(x,profile,seed,difficulty)=>{
  if(x<18)return 0;
  const length=profile.moduleLength,index=Math.floor(x/length),local=x-index*length;
  const phase=index===0?0:hash(seed,`module:${index}`)%5;
  const scale=1+Math.min(1,difficulty)*.30;
  const height=profile.crest*scale,width=profile.width,valley=profile.valley*scale;
  // The opening feature is deliberately visible before the first 100 metres,
  // even on the Moon's longer modules. Subsequent motifs use the full module.
  if(index===0)return mound(local,Math.max(43,width+20),width,height*.95)-mound(local,83,width*1.15,valley*.85);
  if(phase===0)return mound(local,length*.26,width,height)-mound(local,length*.55,width*1.3,valley)+mound(local,length*.81,width*.8,height*.55);
  if(phase===1)return -mound(local,length*.3,width*1.45,valley)+mound(local,length*.64,width*.95,height);
  if(phase===2)return mound(local,length*.25,width*.7,height*.60)+mound(local,length*.48,width*.8,height*.85)+mound(local,length*.73,width*.9,height*.65);
  if(phase===3)return mound(local,length*.32,width*1.4,height*.8)-mound(local,length*.70,width*1.7,valley*.8);
  // A short takeoff ridge followed by a broad, slightly raised landing zone.
  // This is geometry only: the physics engine never adds a jump impulse.
  return mound(local,length*.24,width*.8,height*.95)+mound(local,length*.68,width*2.1,height*.32);
};
function createEndlessLevel(worldId='earth',seed=0x20460910){
  const world=getWorld(worldId),cache=new Map(),geometrySeed=hash(seed,`geometry:${world.id}`),profile=PROFILES[world.id];
  const phase=(geometrySeed%10000)/10000*Math.PI*2;
  const terrainAt=x=>{
    const t=smooth(clamp(Math.max(0,x)/15000,0,1));
    // A finite maximum difficulty, with long smooth recoveries in every cycle.
    // The analytic curve is shared across chunk seams, collision and drawing.
    const envelope=smooth(clamp((x-18)/65,0,1));
    const [a0,da,w,b0,db,v]=profile.long,a=a0+da*t,b=b0+db*t;
    // Caves have a visible smooth approach and floor. Short takeoff features
    // belong outdoors; putting one directly below a low roof is not a fair jump.
    const cavePhase=((x%(CHUNK_SIZE*12))+CHUNK_SIZE*12)%(CHUNK_SIZE*12);
    const caveDetail=world.id==='mars'&&x>0
      ? cavePhase>=500&&cavePhase<=580?0:cavePhase>430&&cavePhase<500?1-smooth((cavePhase-430)/70):cavePhase>580&&cavePhase<625?smooth((cavePhase-580)/45):1
      :1;
    return 12+envelope*(a*Math.sin(x*2*Math.PI/w+phase)+b*Math.sin(x*2*Math.PI/v+phase*.73))+featureAt(x,profile,geometrySeed,t)*caveDetail;
  };
  const getChunk=index=>{
    if(!Number.isSafeInteger(index))throw new Error('Некоректний фрагмент дороги');
    if(cache.has(index))return cache.get(index);
    const from=index*CHUNK_SIZE,to=from+CHUNK_SIZE,terrain=[];
    // Same half-metre samples as physics; drawing and collider share terrainAt.
    for(let x=from;x<=to;x+=.5)terrain.push([x,terrainAt(x)]);
    const cycle=((index%12)+12)%12;
    const kind=world.id==='earth'?['dirt','stone','dirt','asphalt','sand','dirt','snow','snow','dirt','ice','dirt','stone'][cycle]
      :world.id==='moon'?(cycle===8?'stone':'moon_dust')
      :world.id==='mars'?(cycle===7?'stone':'mars_dust'):(cycle===5||cycle===9?'mineral':'stone');
    const gears=[],coinValues=[],fuel=[];
    for(let x=Math.max(25,Math.ceil(from/25)*25);x<to;x+=25){gears.push(x);coinValues.push(5);}
    const fuelSpacing={earth:480,moon:540,mars:480,basalt:420}[world.id];
    for(let x=Math.max(fuelSpacing,Math.ceil(from/fuelSpacing)*fuelSpacing);x<to;x+=fuelSpacing)fuel.push(x);
    const ceilings=world.id==='mars'&&index>3&&cycle===4?[{from:from+20,to:to-20,height:4.5}]:[];
    const chunk={id:index,index,from,to,terrain,surfaces:[{from,to,kind}],surface:kind,gears,coinValues,fuel,ceilings,gaps:[],liquids:[],
      decorationSeed:hash(seed,`decoration:${world.id}:${index}`),
      modules:[{id:`endless-${world.id}-${index}`,type:ceilings.length?'tunnel':'rolling-obstacles',name:ceilings.length?'Печерна ділянка':'Гребені та долини',from,to}]};
    cache.set(index,chunk);
    // Rendering may request a fragment before physics prunes. Keep even that
    // path bounded; regeneration is deterministic, not dependent on cache order.
    if(cache.size>48)cache.delete(cache.keys().next().value);
    return chunk;
  };
  return {id:1,stageId:`endless-${world.id}`,worldId:world.id,mode:'endless',endless:true,seed:seed>>>0,generatorVersion:GENERATOR_VERSION,
    name:`${world.name} · нескінченний заїзд`,meters:Infinity,length:Infinity,max_ticks:Number.MAX_SAFE_INTEGER,startX:9,
    hint:'Позначки — це досягнення, дорога продовжується. Бережи пальне й обирай безпечну посадку.',
    description:'Відтворювана дорога без фіксованого фінішу.',recommended:{engine:5,suspension:5,tires:5,tank:5},
    finishReward:0,chunkSize:CHUNK_SIZE,terrainAt,getChunk,pruneChunks:(first,last)=>{for(const index of cache.keys())if(index<first||index>last)cache.delete(index);},
    cachedChunkCount:()=>cache.size,terrain:[[-100,terrainAt(-100)],[0,terrainAt(0)],[120,terrainAt(120)]],linearTerrain:true,
    surface:world.surfaces[0],surfaces:[],gears:[],coinValues:[],fuel:[],bridges:[],ceilings:[],gaps:[],liquids:[],modules:[],
    checkpoints:MILESTONES.map((m,i)=>({id:`endless-${world.id}-${m}`,x:m+9,reward:[100,200,300,500][i]}))};
}
module.exports={CHUNK_SIZE,GENERATOR_VERSION,MILESTONES,createEndlessLevel,getEndlessLevel:createEndlessLevel};
