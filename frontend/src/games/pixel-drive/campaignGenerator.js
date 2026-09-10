// Authoring-time deterministic campaign generator. It does not accept upgrades,
// wallet balance, attempts or wins; the saved track cannot chase the player.
const GENERATOR_VERSION = 5;
const {VEHICLES,WORLDS,SURFACES} = require('./fleetConfig');
const {reliefHeight} = require('./campaignRelief');
const BASE_SEED = 0x20260910;
function random(seed) {
  let state = seed >>> 0;
  return () => { state += 0x6D2B79F5; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
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
    modules:[['intro',150,.7],['recovery',20,0],['torque',240,22],['recovery',35,0],['climb',100,-12],['recovery',55,0]],fuel:[125,391]},
  {id:3,stageId:'stone-quarry',campaignIndex:2,name:'Кам’янистий кар’єр',meters:1000,recommended:profile(4,3,3,2),finishReward:1000,
    description:'Хвилі, короткі підйоми й посадки перевіряють підвіску та збереження швидкості.',challenge:'Підвіска й темп',hint:'Після нерівності дай підвісці заспокоїтися й збережи темп до фінішу.',
    modules:[['intro',140,.8],['torque',240,22],['recovery',40,0],['rollers',180,1.35,18],['climb',65,14],['jump',55,2.4],['recovery',45,0],['rollers',180,1.8,18],['recovery',55,0]],fuel:[120,546]},
  {id:4,stageId:'mountain-pass',campaignIndex:3,name:'Гірський перевал',meters:1600,recommended:profile(6,4,5,4),finishReward:1700,
    description:'Довгі навантаження чергуються з гребенями. Тяга і шини допомагають зберігати інерцію.',challenge:'Тривала тяга та зчеплення',hint:'Збережи розгін перед підйомом і вирівняй авто на гребені.',
    modules:[['intro',160,1],['torque',260,26],['recovery',60,0],['climb',160,-10],['snow-climb',300,25],['recovery',70,0],['rollers',180,1.2],['climb',260,24],['recovery',150,0]],fuel:[561,1120]},
  {id:5,stageId:'winter-route',campaignIndex:4,name:'Зимовий маршрут',meters:2200,recommended:profile(7,6,7,5),finishReward:2500,
    description:'Снігові підйоми, короткий лід і сухі зони відновлення навчають дозувати тягу.',challenge:'Зчеплення та контроль газу',hint:'Колеса буксують — спробуй м’якший газ або кращі шини.',
    modules:[['intro',180,1],['torque',260,24],['recovery',70,0],['snow-climb',380,25],['recovery',80,0],['climb',220,-12],['ice',65,0],['recovery',75,0],['rollers',220,.9],['snow-climb',430,24],['recovery',220,0]],fuel:[605,1318,1957]},
  {id:6,stageId:'long-haul',campaignIndex:5,name:'Далекий перегін',meters:3000,recommended:profile(8,7,7,8),finishReward:3400,
    description:'Довгий контрольний перегін вимагає запасу пального й рівного темпу.',challenge:'Автономність',hint:'Повний бак перед затяжним перегоном важливіший за зайвий стрибок.',
    modules:[['intro',170,1],['torque',240,23],['recovery',90,0],['fuel-climb',1500,20],['recovery',100,0],['climb',250,-13],['rollers',230,1.1],['climb',250,18],['recovery',170,0]],fuel:[787,1622,2538]},
  {id:7,stageId:'mastery-summit',campaignIndex:6,name:'Вершина майстерності',meters:6000,recommended:profile(9,9,9,9),finishReward:4600,
    description:'Збалансоване авто проходить тягові, слизькі, хвилясті й паливні випробування.',challenge:'Усі механіки',hint:'Не тримай газ постійно: готуй розгін, посадку й наступну заправку.',
    modules:[['intro',200,1.1],['torque',300,27],['recovery',80,0],['snow-climb',360,26],['recovery',90,0],['rollers',200,1.5],['recovery',80,0],['fuel-climb',1600,22],['recovery',90,0],['climb',270,-16],['jump',65,3],['recovery',65,0],['rollers',300,1.35],['recovery',300,0],['recovery',100,0],['climb',300,-13],['rollers',400,1.4,24],['snow-climb',400,24],['recovery',100,0],['jump',100,2.8],['recovery',100,0],['rollers',300,1.2,26],['recovery',200,0]],fuel:[806,1626,2526,3539,4544,5418]},
  {id:8,stageId:'crater-edge',worldId:'moon',requires:[4],campaignIndex:7,name:'Край кратера',meters:1200,recommended:profile(4,3,4,3),finishReward:2000,
    description:'Широкий кратер і довгий пологий виїзд навчають берегти пальне та керувати кутом у слабкому тяжінні.',challenge:'Кут відриву й запас ходу',hint:'На Місяці відпускай газ завчасно: високий політ може пронести тебе над каністрою.',
    modules:[['intro',160,.4],['climb',170,-10],['recovery',70,0],['regolith-climb',470,25],['recovery',170,0],['jump',80,2],['recovery',80,0]],fuel:[542,998]},
  {id:9,stageId:'quiet-plain',worldId:'moon',requires:[8],campaignIndex:8,name:'Тиха рівнина',meters:2000,recommended:profile(6,5,6,5),finishReward:2900,
    description:'Довгі хвилі й широкі посадки: швидкість легко набрати й складно вчасно погасити.',challenge:'Керування довгим польотом',hint:'Слідкуй за запасом пального навіть у польоті — час витрачається так само.',
    modules:[['intro',180,.5],['regolith-climb',600,27],['recovery',120,0],['climb',180,-12],['jump',140,5],['recovery',160,0],['rollers',240,3,100],['regolith-climb',220,18],['recovery',160,0]],fuel:[576,1295]},
  {id:10,stageId:'far-side',worldId:'moon',requires:[9],campaignIndex:9,name:'Далекий бік',meters:3000,recommended:profile(8,7,8,8),finishReward:4000,
    description:'Віддалені кратери й довгі ділянки між заправками перевіряють запас ходу.',challenge:'Автономність у вакуумі',hint:'Не витрачай реактивну тягу без потреби. Під час довгої дуги каністра може залишитися внизу.',
    modules:[['intro',200,.5],['regolith-climb',650,28],['recovery',150,0],['climb',240,-12],['jump',160,7],['recovery',200,0],['rollers',400,3.5,110],['regolith-climb',650,20],['recovery',350,0]],fuel:[680,1584,2479]},
  {id:11,stageId:'red-dunes',worldId:'mars',requires:[9,6],campaignIndex:10,name:'Червоні дюни',meters:1500,recommended:profile(6,5,5,5),finishReward:2800,
    description:'Пилові схили переходять у кам’яні гряди. Тримай тягу без зайвого підскоку.',challenge:'Тяга на пилу',hint:'На марсіанському пилу важливе зчеплення; антикрило майже не допомагає.',
    modules:[['intro',160,.7],['dust-climb',520,33],['recovery',100,0],['climb',150,-10],['rollers',200,1.3,38],['tunnel',170,.35,55],['recovery',200,0]],fuel:[488,1099]},
  {id:12,stageId:'underground-route',worldId:'mars',requires:[11],campaignIndex:11,name:'Підземний маршрут',meters:2600,recommended:profile(8,7,7,7),finishReward:3900,
    description:'Відкриті улоговини чергуються з печерами. Зайва висота стає ризиком під низькою стелею.',challenge:'Контроль висоти',hint:'Перед печерою загальмуй: дорога читається краще, коли колеса тримають опору.',
    modules:[['intro',180,.7],['dust-climb',550,33],['recovery',100,0],['tunnel',260,.45,60],['recovery',120,0],['climb',230,-12],['rollers',240,1.2,44],['tunnel',300,.55,70],['dust-climb',400,20],['recovery',220,0]],fuel:[592,1546,2470]},
  {id:13,stageId:'canyon-labyrinth',worldId:'mars',requires:[12],campaignIndex:12,name:'Лабіринт каньйонів',meters:6800,recommended:profile(9,9,9,9),finishReward:5100,
    description:'Кам’яні гряди, відкриті прольоти й печери складаються в довгий маршрут із різним темпом.',challenge:'Розгін і точні приземлення',hint:'Розганяйся у відкритій частині й завчасно знижуй темп перед стелею.',
    modules:[['intro',200,.8],['dust-climb',550,33],['recovery',150,0],['tunnel',320,.55,65],['climb',280,-12],['recovery',100,0],['jump',120,3],['recovery',160,0],['rollers',320,1.5,45],['dust-climb',700,23],['recovery',150,0],['tunnel',400,.6,75],['recovery',550,0],['dust-climb',600,25],['recovery',100,0],['climb',300,-12],['tunnel',550,.6,70],['rollers',300,1.4,48],['recovery',100,0],['jump',120,4],['recovery',130,0],['dust-climb',400,23],['recovery',200,0]],fuel:[684,1774,2699,3696,4469,5558,6508]},
  {id:14,stageId:'heavy-ground',worldId:'basalt',requires:[12],campaignIndex:13,name:'Важкий ґрунт',meters:1600,recommended:profile(8,7,8,7),finishReward:3500,
    description:'Сильне тяжіння навантажує підвіску та швидко гасить невдалий розгін.',challenge:'Силова тяга',hint:'Збережи інерцію перед підйомом. На Базальті однакова тяга дає менше прискорення вгору.',
    modules:[['intro',180,.6],['torque',360,25],['recovery',80,0],['rollers',220,.8,27],['climb',160,-10],['mineral',160,.2,55],['climb',260,16],['recovery',180,0]],fuel:[691]},
  {id:15,stageId:'slippery-ridge',worldId:'basalt',requires:[14],campaignIndex:14,name:'Слизький хребет',meters:2600,recommended:profile(9,8,9,8),finishReward:4400,
    description:'Кам’яні підйоми й мінеральні ділянки вимагають розділяти розгін і точне керування.',challenge:'Опора під великим навантаженням',hint:'На мінеральній ділянці краще плавний газ, ніж пробуксовування.',
    modules:[['intro',180,.6],['torque',420,25],['recovery',100,0],['mineral',240,.3,65],['climb',200,-10],['rollers',280,1,28],['climb',420,22],['recovery',160,0],['mineral',240,.35,70],['recovery',360,0]],fuel:[813,1821]},
  {id:16,stageId:'last-ascent',worldId:'basalt',requires:[15],campaignIndex:15,name:'Останній підйом',meters:6800,recommended:profile(10,9,10,10),finishReward:6000,
    description:'Довгий фінал із силовими підйомами, короткими стрибками та мінливим зчепленням.',challenge:'Майстерність у сильному тяжінні',hint:'На максимальних деталях усе одно важливі кут посадки та своєчасне гальмування.',
    modules:[['intro',220,.7],['torque',460,26],['recovery',140,0],['mineral',260,.35,65],['climb',260,-10],['rollers',300,1.05,28],['recovery',160,0],['climb',600,24],['recovery',160,0],['jump',100,1.5],['recovery',140,0],['mineral',300,.3,70],['climb',550,17],['recovery',350,0],['climb',320,-12],['recovery',100,0],['mineral',300,.3,65],['torque',550,26],['recovery',130,0],['rollers',400,1,29],['climb',350,20],['recovery',100,0],['jump',100,1.5],['recovery',450,0]],fuel:[932,2097,3187,4344,5320,6444]},
];

function moduleSlope(type, length, amount, x, phase, wavelength) {
  if (['climb','torque','snow-climb','fuel-climb','regolith-climb','dust-climb'].includes(type)) {
    const round = Math.min(18, length / 4);
    const envelope = x < round ? smooth(x / round) : x > length - round ? smooth((length - x) / round) : 1;
    return Math.tan(radians(amount)) * envelope;
  }
  if (['intro','rollers','tunnel','mineral'].includes(type)) {
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
  definition={worldId:'earth',requires:definition.id===1?[]:[definition.id-1],...definition};
  const seed = (BASE_SEED + definition.id * 0x9E3779B9) >>> 0;
  const geometry = stream(seed, 'geometry'), coins = stream(seed, 'coins'), fuel = stream(seed, 'fuel'), decorations = stream(seed, 'decorations');
  const terrain = [[-100,12],[0,12]], modules = [], surfaces = [];
  let x = 0, y = 12;
  for (let index = 0; index < definition.modules.length; index++) {
    const [type,length,amount,wavelength] = definition.modules[index], start = x, startY = y, phase = geometry() * .25;
    const defaultMaterial={earth:'dirt',moon:'moon_dust',mars:'mars_dust',basalt:'stone'}[definition.worldId];
    const material = type === 'snow-climb' ? 'snow' : type === 'ice' ? 'ice' : type==='mineral'?'mineral':defaultMaterial;
    const geometryStart = terrain.length - 1;
    for (let local = 1; local <= length; local++) {
      y += moduleSlope(type, length, amount, local - .5, phase, wavelength);
      x = start + local;
      // Settle before a low cave roof; a recovery approach must not become a
      // takeoff ramp pointed at the ceiling. Outdoor sections retain full relief.
      const beforeCave=definition.modules[index+1]?.[0]==='tunnel';
      const approach=beforeCave?smooth(Math.min(1,(length-local)/80)):1;
      const relief=reliefHeight(type,length,local,phase,definition.worldId,definition.id===1)*approach;
      terrain.push([x, Math.round((y+relief) * 1e6) / 1e6]);
    }
    if (material !== 'dirt') surfaces.push({from:start,to:x,kind:material});
    modules.push({
      id: `${definition.stageId}-${index}`, type, name:MODULE_NAMES[type]||({tunnel:'Печера',mineral:'Мінеральна ділянка','regolith-climb':'Виїзд із кратера','dust-climb':'Пиловий схил'}[type]), from:start, to:x,
      geometry: {firstVertex:geometryStart,lastVertex:terrain.length-1,heightChange:y-startY,
        maximumSlopeDegrees:Math.max(...terrain.slice(geometryStart+1).map((point,i)=>Math.abs(Math.atan((point[1]-terrain[geometryStart+i][1])/(point[0]-terrain[geometryStart+i][0]))*180/Math.PI)))},
      material,
      entry: {speed:[0,48],bodyAngleRelativeToSurface:[-.35,.35],angularSpeed:[-1.2,1.2],support:'at least one contact',suspensionCompression:[-.1,1.25],fuelSeconds:[0,110]},
      exit: {speed:[0,48],bodyAngleRelativeToSurface:[-.5,.5],angularSpeed:[-2,2],support:'contact or measured flight',suspensionCompression:[-.1,1.25],fuelSeconds:[0,110]},
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
  const level = {...definition,mode:'campaign',seed,generatorVersion:GENERATOR_VERSION,length:definition.meters,max_ticks:54000,
    terrain,linearTerrain:true,modules,surfaces,gears,coinValues,fuel:[...definition.fuel],bridges:[],
    ceilings:modules.filter(m=>m.type==='tunnel').map(m=>({from:m.from+8,to:m.to-8,height:4.2})),
    gaps:[],liquids:[],
    checkpoints: modules.filter(m=>['torque','snow-climb','fuel-climb','rollers','regolith-climb','dust-climb'].includes(m.type)&&m.to<definition.meters-30).map((m,i)=>({id:`${definition.stageId}-checkpoint-${i}`,x:m.to,reward:100+definition.campaignIndex*80})),
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
  const config={version:4,dataVersion:4,generatorVersion:GENERATOR_VERSION,parts:['engine','suspension','tires','tank'],maxTicks:54000,minUpgrade:0,maxUpgrade:10,
    vehicles:VEHICLES,worlds:WORLDS,surfaces:SURFACES,
    upgradePrices,
    calibration:{initialMainMeters:34900,mainMeters:42500,extendedFinalRoutes:[7,13,16],reason:'Final routes extended with physical terrain after 180–234s measured runs, toward 5–8 minute target; metre scale and vehicle forces unchanged.'},
    economy:{startingFormula:'round50(basePrice * 1.38^L)',basePrices:bases,startingUpgradePrices,
      calibrationVersion:1,calibrationId:'A-shorter-campaign',measurementSource:'artifacts/pixel-drive-v3-economy-analysis.json',
      explanation:'Prices from L3 calibrated to measured repeat earnings; L0–2 and ordinary coin values unchanged. Some middle upgrades intentionally remain faster than the 2–4 target to reduce campaign repetition.'},
    levels:DEFINITIONS.map(generateLevel)};
  // Historical v3 measurements are not certification of the v4 physics.
  return config;
}
function generationSignature(levels){
  const text=JSON.stringify(levels.map(l=>({id:l.id,seed:l.seed,terrain:l.terrain,surfaces:l.surfaces,fuel:l.fuel,recommended:l.recommended})));
  let hash=2166136261;for(let i=0;i<text.length;i++)hash=Math.imul(hash^text.charCodeAt(i),16777619);
  return(hash>>>0).toString(16);
}
module.exports={GENERATOR_VERSION,DEFINITIONS,stream,moduleSlope,generateLevel,generateCampaign,generationSignature};
