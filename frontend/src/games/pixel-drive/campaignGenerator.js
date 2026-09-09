// Authoring-time deterministic campaign generator. It does not accept upgrades,
// wallet balance, attempts or wins; the saved track cannot chase the player.
const GENERATOR_VERSION = 3;
const CERTIFICATION = require('./campaignCertification.json');
const BASE_SEED = 0x20260910;
function random(seed) {
  let state = seed >>> 0;
  return () => { state += 0x6D2B79F5; let t = state; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function stream(seed, tag) {
  let hash = seed >>> 0;
  for (const char of tag) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return random(hash);
}
const radians = angle => angle * Math.PI / 180;
const smooth = t => t * t * (3 - 2 * t);
const profile = (engine, suspension, tires, tank) => ({engine, suspension, tires, tank});
const MODULE_NAMES={intro:'Знайомий початок',recovery:'Відновлення',climb:'Плавний схил',torque:'Контрольний підйом',rollers:'Хвиляста ділянка','snow-climb':'Сніговий підйом','fuel-climb':'Перегін без заправки',ice:'Короткий лід',jump:'Трамплін і посадка'};
const DEFINITIONS = [
  {id:1,stageId:'first-drive',campaignIndex:0,name:'Перший виїзд',meters:200,recommended:profile(0,0,0,0),finishReward:400,
    description:'Навчися розганятися, зібрати пальне й м’яко приземлитися.',challenge:'Навчання',hint:'Відпускай газ перед спуском. Пальне — це час активного заїзду.',
    modules:[['intro',45,0],['rollers',45,.24],['climb',35,7],['climb',30,-9],['recovery',45,0]],fuel:[90]},
  {id:2,stageId:'green-hills',campaignIndex:1,name:'Зелені пагорби',meters:600,recommended:profile(2,1,1,1),finishReward:550,
    description:'Набери розгін перед довгим підйомом. Перші покращення двигуна відкриють шлях вище.',challenge:'Тяга та розгін',hint:'На довгому підйомі потрібен запас тяги, а не лише швидкий стрибок.',
    modules:[['intro',150,.7],['recovery',20,0],['torque',240,22],['recovery',35,0],['climb',100,-12],['recovery',55,0]],fuel:[125,430]},
  {id:3,stageId:'stone-quarry',campaignIndex:2,name:'Кам’янистий кар’єр',meters:1000,recommended:profile(4,3,3,2),finishReward:1000,
    description:'Хвилі, короткі підйоми й посадки перевіряють підвіску та збереження швидкості.',challenge:'Підвіска й темп',hint:'Після нерівності дай підвісці заспокоїтися й збережи темп до фінішу.',
    modules:[['intro',140,.8],['torque',240,22],['recovery',40,0],['rollers',180,1.35,18],['climb',65,14],['jump',55,2.4],['recovery',45,0],['rollers',180,1.8,18],['recovery',55,0]],fuel:[120,420]},
  {id:4,stageId:'mountain-pass',campaignIndex:3,name:'Гірський перевал',meters:1600,recommended:profile(6,4,5,4),finishReward:1700,
    description:'Довгі навантаження чергуються з гребенями. Тяга і шини допомагають зберігати інерцію.',challenge:'Тривала тяга та зчеплення',hint:'Збережи розгін перед підйомом і вирівняй авто на гребені.',
    modules:[['intro',160,1],['torque',260,26],['recovery',60,0],['climb',160,-10],['snow-climb',300,29],['recovery',70,0],['rollers',180,1.2],['climb',260,24],['recovery',150,0]],fuel:[140,800,1400]},
  {id:5,stageId:'winter-route',campaignIndex:4,name:'Зимовий маршрут',meters:2200,recommended:profile(7,6,7,5),finishReward:2500,
    description:'Снігові підйоми, короткий лід і сухі зони відновлення навчають дозувати тягу.',challenge:'Зчеплення та контроль газу',hint:'Колеса буксують — спробуй м’якший газ або кращі шини.',
    modules:[['intro',180,1],['torque',260,24],['recovery',70,0],['snow-climb',380,31],['recovery',80,0],['climb',220,-12],['ice',65,0],['recovery',75,0],['rollers',220,.9],['snow-climb',430,30],['recovery',220,0]],fuel:[150,690,1420,2010]},
  {id:6,stageId:'long-haul',campaignIndex:5,name:'Далекий перегін',meters:3000,recommended:profile(8,7,7,8),finishReward:3400,
    description:'Довгий контрольний перегін вимагає запасу пального й рівного темпу.',challenge:'Автономність',hint:'Повний бак перед затяжним перегоном важливіший за зайвий стрибок.',
    modules:[['intro',170,1],['torque',240,23],['recovery',90,0],['fuel-climb',1500,20],['recovery',100,0],['climb',250,-13],['rollers',230,1.1],['climb',250,18],['recovery',170,0]],fuel:[150,470,1810,2600]},
  {id:7,stageId:'mastery-summit',campaignIndex:6,name:'Вершина майстерності',meters:4000,recommended:profile(9,9,9,9),finishReward:4600,
    description:'Збалансоване авто проходить тягові, слизькі, хвилясті й паливні випробування.',challenge:'Усі механіки',hint:'Не тримай газ постійно: готуй розгін, посадку й наступну заправку.',
    modules:[['intro',200,1.1],['torque',300,27],['recovery',80,0],['snow-climb',360,33],['recovery',90,0],['rollers',200,1.5],['recovery',80,0],['fuel-climb',1600,22],['recovery',90,0],['climb',270,-16],['jump',65,3],['recovery',65,0],['rollers',300,1.35],['recovery',300,0]],fuel:[180,720,1270,2750,3560]},
];

function moduleSlope(type, length, amount, x, phase, wavelength) {
  if (['climb','torque','snow-climb','fuel-climb'].includes(type)) {
    const round = Math.min(18, length / 4);
    const envelope = x < round ? smooth(x / round) : x > length - round ? smooth((length - x) / round) : 1;
    return Math.tan(radians(amount)) * envelope;
  }
  if (type === 'intro' || type === 'rollers') {
    const waves = Math.max(1, Math.round(length / (wavelength || (type === 'intro' ? 55 : 19))));
    // Height and derivative are zero at both boundaries. Small seeded phase
    // changes shape inside the module without breaking its fixed joins.
    const t = x / length, window = Math.sin(Math.PI * t) ** 2;
    const omega = 2 * Math.PI * waves / length;
    const sine = Math.sin(omega * x + phase);
    return amount * (2 * Math.sin(Math.PI * t) * Math.cos(Math.PI * t) * Math.PI / length * sine + window * omega * Math.cos(omega * x + phase));
  }
  if (type === 'jump') {
    // Rounded ramp with a predictable recovery slope; no vertical ledges.
    const t = x / length;
    return amount * Math.PI / length * Math.sin(2 * Math.PI * t);
  }
  return 0;
}

function generateLevel(definition) {
  const seed = (BASE_SEED + definition.id * 0x9E3779B9) >>> 0;
  const geometry = stream(seed, 'geometry'), coins = stream(seed, 'coins'), fuel = stream(seed, 'fuel'), decorations = stream(seed, 'decorations');
  const terrain = [[-100,12],[0,12]], modules = [], surfaces = [];
  let x = 0, y = 12;
  for (let index = 0; index < definition.modules.length; index++) {
    const [type,length,amount,wavelength] = definition.modules[index], start = x, startY = y, phase = geometry() * .25;
    const material = type === 'snow-climb' ? 'snow' : type === 'ice' ? 'ice' : 'dirt';
    const geometryStart = terrain.length - 1;
    for (let local = 1; local <= length; local++) {
      y += moduleSlope(type, length, amount, local - .5, phase, wavelength);
      x = start + local;
      terrain.push([x, Math.round(y * 1e6) / 1e6]);
    }
    if (material !== 'dirt') surfaces.push({from:start,to:x,kind:material});
    modules.push({
      id: `${definition.stageId}-${index}`, type, name:MODULE_NAMES[type], from:start, to:x,
      geometry: {firstVertex:geometryStart,lastVertex:terrain.length-1,heightChange:y-startY,
        maximumSlopeDegrees:Math.max(...terrain.slice(geometryStart+1).map((point,i)=>Math.abs(Math.atan((point[1]-terrain[geometryStart+i][1])/(point[0]-terrain[geometryStart+i][0]))*180/Math.PI)))},
      material,
      entry: {speed:[0,40],bodyAngleRelativeToSurface:[-.35,.35],angularSpeed:[-1.2,1.2],suspensionCompression:[-.1,.74],fuelSeconds:[0,80]},
      exit: {speed:[0,40],bodyAngleRelativeToSurface:[-.5,.5],angularSpeed:[-2,2],suspensionCompression:[-.1,.74],fuelSeconds:[0,80]},
      recovery: {from:x,to:Math.min(definition.meters,x+(definition.modules[index+1]?.[0]==='recovery'?definition.modules[index+1][1]:0))},
      pickups: {coins:[],fuel:[]},
      validation: {state:'awaiting full-course simulation',recommended:definition.recommended},
    });
  }
  if (x !== definition.meters) throw new Error(`${definition.stageId}: module lengths ${x} do not equal ${definition.meters}`);
  terrain.push([x+80,y]);
  const gears = [], coinValues = [];
  const coinStep = definition.campaignIndex === 0 ? 12 : 14;
  for (let at = 18; at < definition.meters - 5; at += coinStep) {
    const position = Math.round((at + (coins()-.5)*3)*100)/100;
    const value = Math.round((definition.campaignIndex===0?12:12+definition.campaignIndex*6)*(1+position/definition.meters*.7)/5)*5;
    gears.push(position); coinValues.push(value);
  }
  // Reserve a distinct stream even for hand-certified fuel placements. Fuel
  // randomness can never move because a visual or coin algorithm changed.
  const fuelStreamMarker = fuel();
  const level = {...definition,seed,generatorVersion:GENERATOR_VERSION,length:definition.meters,max_ticks:36000,
    terrain,linearTerrain:true,modules,surfaces,gears,coinValues,fuel:[...definition.fuel],bridges:[],
    checkpoints: modules.filter(m=>['torque','snow-climb','fuel-climb','rollers'].includes(m.type)&&m.to<definition.meters-30).map((m,i)=>({id:`${definition.stageId}-checkpoint-${i}`,x:m.to,reward:100+definition.campaignIndex*80})),
    fuelValidation:{state:'awaiting measured T_ref',targetRho:definition.campaignIndex<3?[.60,.75]:definition.campaignIndex<5?[.70,.85]:[.80,.92]},
    streams:{geometry:'geometry',coins:'coins',fuel:'fuel',decorations:'decorations',fuelMarker:fuelStreamMarker},
    decorationSeed:Math.floor(decorations()*4294967296),
  };
  for(const module of modules){module.pickups.coins=gears.map((v,i)=>v>=module.from&&v<=module.to?i:-1).filter(i=>i>=0);module.pickups.fuel=level.fuel.map((v,i)=>v>=module.from&&v<=module.to?i:-1).filter(i=>i>=0);}
  return level;
}

function generateCampaign() {
  const bases={engine:350,suspension:300,tires:300,tank:350};
  const startingUpgradePrices=Object.fromEntries(Object.entries(bases).map(([part,base])=>[part,Array.from({length:10},(_,level)=>Math.round(base*1.38**level/50)*50)]));
  const upgradePrices={
    engine:[350,500,650,2250,4500,7000,10500,21000,30000,38000],
    suspension:[300,400,550,2000,5000,9000,15000,28000,33000,36000],
    tires:[300,400,550,2000,5000,9000,15000,28000,33000,36000],
    tank:[350,500,650,2250,4500,7000,10500,21000,30000,38000],
  };
  const config={version:3,dataVersion:3,generatorVersion:GENERATOR_VERSION,parts:['engine','suspension','tires','tank'],maxTicks:36000,minUpgrade:0,maxUpgrade:10,
    upgradePrices,
    economy:{startingFormula:'round50(basePrice * 1.38^L)',basePrices:bases,startingUpgradePrices,
      calibrationVersion:1,calibrationId:'A-shorter-campaign',measurementSource:'artifacts/pixel-drive-v3-economy-analysis.json',
      explanation:'Prices from L3 calibrated to measured repeat earnings; L0–2 and ordinary coin values unchanged. Some middle upgrades intentionally remain faster than the 2–4 target to reduce campaign repetition.'},
    levels:DEFINITIONS.map(generateLevel)};
  if(CERTIFICATION.sourceSignature===generationSignature(config.levels))for(const level of config.levels){
    const certificate=CERTIFICATION.levels.find(item=>item.id===level.id);if(!certificate)continue;
    level.validation=certificate.validation;level.fuelValidation={...level.fuelValidation,...certificate.fuelValidation};
    for(const module of level.modules){const measured=certificate.modules.find(item=>item.id===module.id);if(measured)module.validation=measured.validation;}
  }
  return config;
}
function generationSignature(levels){
  const text=JSON.stringify(levels.map(l=>({id:l.id,seed:l.seed,terrain:l.terrain,surfaces:l.surfaces,fuel:l.fuel,recommended:l.recommended})));
  let hash=2166136261;for(let i=0;i<text.length;i++)hash=Math.imul(hash^text.charCodeAt(i),16777619);
  return(hash>>>0).toString(16);
}
module.exports={GENERATOR_VERSION,DEFINITIONS,stream,moduleSlope,generateLevel,generateCampaign,generationSignature};
