import { PixelGameLink, PixelGameReward, usePixelOrigin } from "@/components/PixelGameBridge";
import {useEffect,useRef,useState} from "react";
import {useNavigate} from "react-router-dom";
import {ArrowLeft,ArrowRight,Bug,Check,Coins,Flag,FlaskConical,Fuel,Gauge,LockKeyhole,Map,Maximize2,Pause,Rocket,RotateCcw,Settings2,Volume2,VolumeX,WifiOff,Wrench} from "lucide-react";
import useDriveGame from "@/games/pixel-drive/useDriveGame";
import {VEHICLES,WORLDS,getVehicle,getWorld} from "@/games/pixel-drive/fleetConfig";
import {CONFIG,getUpgradeStats} from "@/games/pixel-drive/engine";
import {getUpgradePrice} from "@/games/pixel-drive/progression";
import {drawDrive,drawGarage,drawRoute} from "@/games/pixel-drive/renderer";
import "@/games/pixel-drive/drive.css";

const PARTS=[
  {id:"engine",code:"E",name:"Двигун",Icon:Gauge},
  {id:"suspension",code:"S",name:"Підвіска",Icon:Settings2},
  {id:"tires",code:"G",name:"Зчеплення",Icon:Wrench},
  {id:"tank",code:"F",name:"Бак",Icon:Fuel},
];
const WORLD_UNLOCK={earth:"Після навчання доступна перша земна траса.",moon:"Заверши «Гірський перевал».",mars:"Заверши «Тиха рівнина» і «Далекий перегін».",basalt:"Заверши «Підземний маршрут»."};
const REASONS={head:"Авто перекинулося",head_contact:"Авто перекинулося",stuck:"Авто застрягло",overturned:"Авто перекинулося",fuel:"Пальне закінчилося",route_exit:"Поза трасою",time:"Час вичерпано",abandoned:"Заїзд завершено"};
const SPECIALTIES={wanderer:"Універсальний позашляховик",swift:"Легкий для трюків",dune_buggy:"Зручний на нерівностях",hauler:"Великий запас пального",boar:"Для каміння й уступів",rally:"Швидкий на змішаних трасах",arrow:"Швидкість на рівній дорозі",bastion:"Стійка гусенична опора",polar:"Сильний на снігу",sprinter:"Швидкий гусеничний всюдихід",glider:"Плавно над нерівностями",orbiter:"Короткочасна реактивна тяга"};
const number=(value,digits=0)=>Number(value).toLocaleString("uk-UA",{maximumFractionDigits:digits});
function RouteTile({level,record,locked,selected,onChoose}){
  const ref=useRef(null),complete=record?.medals?.includes("finish");
  useEffect(()=>{drawRoute(ref.current,level,selected,complete);},[level,selected,complete]);
  return <button className={`drive-route ${selected?"is-current":""} ${locked?"is-locked":""}`} onClick={onChoose} aria-label={`${level.name}: ${locked?"переглянути закриту трасу":"обрати трасу"}`} data-testid={`drive-track-${level.id}`}>
    <span className="drive-route-top"><b>{level.campaignIndex===0?"СТАРТ":String(level.campaignIndex).padStart(2,"0")}</b>{locked?<LockKeyhole size={20}/>:complete?<Check size={22}/>:<ArrowRight size={20}/>}</span>
    <canvas ref={ref} width="600" height="160" aria-hidden="true"/>
    <strong>{level.name}</strong><span>{number(level.meters)} м{record?.best?` · рекорд ${number(record.best)} м`:""}</span>
  </button>;
}
function Pedal({kind,game}){
  const gas=kind==="gas",jet=kind==="jet";
  const release=e=>game.input(`${kind}:pointer:${e.pointerId}`,false);
  return <button type="button" className={`drive-pedal ${gas?"drive-pedal-gas":jet?"drive-pedal-jet":""}`} disabled={game.phase!=="racing"} aria-label={jet?"Реактивна тяга":gas?"Газ":"Гальмо"}
    onPointerDown={e=>{if(e.button!==0)return;e.preventDefault();e.currentTarget.setPointerCapture?.(e.pointerId);game.input(`${kind}:pointer:${e.pointerId}`,true);}}
    onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}
    onKeyDown={e=>{if((e.code==="Enter"||(e.code==="Space"&&(jet||game.vehicleId!=="orbiter")))){e.preventDefault();game.input(`${kind}:button:${e.code}`,true);}}}
    onKeyUp={e=>{if((e.code==="Enter"||(e.code==="Space"&&(jet||game.vehicleId!=="orbiter")))){e.preventDefault();game.input(`${kind}:button:${e.code}`,false);}}}
    onBlur={()=>{game.input(`${kind}:button:Space`,false);game.input(`${kind}:button:Enter`,false);}}>
    {jet?<Rocket size={26}/>:<span className="drive-pedal-face"><i/><i/><i/><i/></span>}<strong>{jet?"ТЯГА":gas?"ГАЗ":"ГАЛЬМО"}</strong><small>{jet?"SPACE":gas?"D / →":"A / ← · задній хід"}</small>
  </button>;
}
function FleetPicker({game}){
  return <section className="drive-fleet" aria-label="Гараж: 12 автомобілів"><div className="drive-fleet-list">{VEHICLES.map(v=>{const owned=Boolean(game.progress?.vehicles?.[v.id]||(!game.progress?.vehicles&&v.id==="wanderer"));return <button key={v.id} className={`drive-vehicle-card ${game.vehicleId===v.id?"is-selected":""}`} aria-pressed={game.vehicleId===v.id} aria-label={`Переглянути ${v.name}`} onClick={()=>game.browseVehicle(v.id)} disabled={game.busy||Boolean(game.pendingUpgrade)||Boolean(game.pendingVehicle)} style={{"--vehicle-color":v.color}}><span className="drive-vehicle-swatch" aria-hidden="true"/><strong>{v.name}</strong><small>{owned?"У гаражі":`${number(v.price)} монет`}</small></button>;})}</div></section>;
}
function WorldPicker({game}){
  return <section className="drive-world-picker" aria-label="Обрати світ"><div className="drive-world-tabs">{WORLDS.map(w=><button key={w.id} aria-pressed={w.id===game.worldId} aria-label={`Світ ${w.name}`} onClick={()=>game.chooseWorld(w.id)} style={{"--world-color":w.color}}><span aria-hidden="true"/>{w.name}{!game.unlockedWorlds.includes(w.id)&&<LockKeyhole size={13}/>}</button>)}</div>{!game.unlockedWorlds.includes(game.worldId)&&<p className="drive-unlock-hint"><LockKeyhole size={14}/>{WORLD_UNLOCK[game.worldId]}</p>}</section>;
}
function VehicleActions({game,vehicle}){
  return <div className="drive-vehicle-actions">{!game.owned?<button className="drive-primary" onClick={()=>game.transactVehicle("purchase")} disabled={game.busy||!game.online||Boolean(game.pendingUpgrade)||(!game.pendingVehicle&&game.progress.balance<vehicle.price)}>{game.pendingVehicle?"Повторити покупку":`Придбати за ${number(vehicle.price)}`}<Coins size={16}/></button>:game.progress.vehicle_id!==vehicle.id||game.pendingVehicle?<button className="drive-secondary" onClick={()=>game.transactVehicle("select")} disabled={game.busy||!game.online||Boolean(game.pendingUpgrade)}>Обрати авто<Check size={16}/></button>:null}<button className="drive-test-course drive-secondary" onClick={game.beginTest} disabled={game.busy||Boolean(game.pendingUpgrade)||Boolean(game.pendingVehicle)}><FlaskConical size={17}/>Безкоштовний тест</button></div>;
}
export default function PixelDrive({service,preview=false}){
  const game=useDriveGame(service),navigate=useNavigate(),root=useRef(null),canvas=useRef(null),camera=useRef({});
  const fromPixel=usePixelOrigin() && !preview;
  const returnToPixel=async()=>{if(document.fullscreenElement){try{await document.exitFullscreen();}catch(e){/* Navigation still leaves the run. */}}navigate("/pet/room");};
  const [fullError,setFullError]=useState("");
  const {phase,progress,level,art,selected,busy,online}=game;
  const inRun=["racing","countdown","paused","saving","save-error","result"].includes(phase);
  const outcome=game.result?.outcome,completed=outcome?.status==="completed";
  const restart=game.practice?game.beginTest:game.begin;
  const vehicle=getVehicle(game.vehicleId),world=getWorld(game.worldId),endless=game.mode==="endless"&&!game.practice;
  const records=progress?.vehicles?.[game.vehicleId]?.records;
  const record=endless?records?.endless?.[game.worldId]:progress?.vehicles?records?.campaign?.[String(selected)]:progress?.tracks?.[String(selected)];
  const locked=Boolean(progress&&(endless?!game.unlockedWorlds.includes(game.worldId):!game.unlockedLevels.includes(selected)));
  const campaign=CONFIG.levels.filter(l=>l.campaignIndex>0),tutorial=CONFIG.levels.find(l=>l.campaignIndex===0);
  const worldCampaign=campaign.filter(l=>(l.worldId||"earth")===game.worldId);
  const nextLevel=!endless&&CONFIG.levels.find(l=>l.id!==selected&&game.unlockedLevels.includes(l.id)&&!progress?.tracks?.[String(l.id)]?.medals?.includes("finish"));
  const stats=progress?getUpgradeStats(game.upgrades,game.vehicleId):null;
  const upgradeRows=progress?PARTS.map(part=>{const rank=game.upgrades[part.id];return {...part,name:part.id==="suspension"&&["hover","tracked","snowmobile"].includes(vehicle.type)?"Опора":part.name,rank,max:rank===10,price:getUpgradePrice(part.id,rank,game.vehicleId)};}):[];
  const nextMilestone=[1000,3000,5000,10000].find(m=>m>(game.hud?.distance||0));
  const localSaveLabel=progress?.storage_mode==="memory"?"Сховище недоступне: прогрес лише у вкладці":"Прогрес зберігається у цьому браузері";
  useEffect(()=>{if(phase==="racing")root.current?.focus({preventScroll:true});},[phase]);
  useEffect(()=>{
    const target=canvas.current;if(!target||!art||!progress)return;
    camera.current={};
    const render=state=>{
      if(inRun&&state)drawDrive(target,level,state,art,{reduced:game.reduced,diagnostics:game.diagnostics,camera:camera.current});
      else drawGarage(target,art,game.upgrades,game.vehicleId);
    };
    game.draw.current=render;
    const resize=()=>{const rect=target.getBoundingClientRect(),dpr=Math.min(window.devicePixelRatio||1,2);target.width=Math.max(1,Math.round(rect.width*dpr));target.height=Math.max(1,Math.round(rect.height*dpr));render(game.runtime.current?.state);};
    const observer=new ResizeObserver(resize);observer.observe(target);resize();
    return()=>{observer.disconnect();game.draw.current=null;};
  },[phase,inRun,art,progress,selected,level,game.reduced,game.diagnostics,game.practice,game.vehicleId,game.upgrades,game.draw,game.runtime]);
  const keyboard=(e,pressed)=>{
    if(e.code==="F2"){e.preventDefault();if(pressed&&!e.repeat)game.toggleDiagnostics();return;}
    if(e.code==="Escape"&&pressed){if(["racing","countdown"].includes(game.phaseRef.current))game.pause();return;}
    const kind=e.code==="Space"&&game.vehicleId==="orbiter"?"jet":["KeyD","ArrowRight"].includes(e.code)?"gas":["KeyA","ArrowLeft"].includes(e.code)?"brake":null;
    if(kind&&game.phaseRef.current==="racing"){e.preventDefault();game.input(`${kind}:key:${e.code}`,pressed);}
  };
  const fullscreen=async()=>{setFullError("");try{if(document.fullscreenElement)await document.exitFullscreen();else if(root.current?.requestFullscreen)await root.current.requestFullscreen();else setFullError("Розгорни телефон горизонтально для ширшого огляду.");}catch(e){setFullError("Повноекранний режим недоступний у цьому браузері.");}};
  const back=()=>{if(busy)return;if(["racing","countdown"].includes(phase))game.pause();else if(phase==="map")game.toGarage();else if(inRun){if(phase==="paused")game.end();else if(phase==="result")game.toGarage();}else navigate(fromPixel ? "/pet/room" : "/");};
  return <section ref={root} tabIndex={-1} style={{"--drive-landscape":"url('/games/pixel-drive/v1/landscape.webp')"}} className={`drive-page ${inRun?"drive-page-running":""}`} onKeyDown={e=>keyboard(e,true)} onKeyUp={e=>keyboard(e,false)} data-testid="pixel-drive-page" data-phase={phase}>
    <div className="drive-shell">
      <header className="drive-header">
        <button className="drive-icon-button" onClick={back} disabled={busy||phase==="save-error"} aria-label={inRun||phase==="map"?"Назад до гаража":fromPixel?"До кімнати Пікселя":"На головну"}><ArrowLeft size={21}/></button>
        <div className="drive-brand"><span title={preview?localSaveLabel:undefined} aria-label={preview?`Локальна гра. ${localSaveLabel}`:undefined}>{preview?"ЛОКАЛЬНА ГРА":"ПІКСЕЛЬ"}</span><h1>За обрій</h1></div>
        <div className="drive-header-actions">
          {progress&&!inRun&&<span className="drive-wallet" title="Монети"><Coins size={19}/><b>{number(progress.balance)}</b><small>монет</small></span>}
          <button className="drive-icon-button drive-debug-toggle" onClick={game.toggleDiagnostics} aria-label="Діагностика фізики" aria-pressed={game.diagnostics} title="Діагностика фізики · F2"><Bug size={19}/></button>
          <button className="drive-icon-button" onClick={game.toggleSound} aria-label={game.sound?"Вимкнути звук":"Увімкнути звук"} aria-pressed={game.sound}>{game.sound?<Volume2 size={19}/>:<VolumeX size={19}/>}</button>
          <button className="drive-icon-button drive-fullscreen-toggle" onClick={fullscreen} aria-label="На весь екран"><Maximize2 size={19}/></button>
        </div>
      </header>
      <PixelGameLink enabled={fromPixel && !inRun} onReturn={returnToPixel} disabled={busy} />
      {preview&&progress?.storage_reset&&phase==="garage"&&<p className="drive-notice" role="status">Локальне збереження пошкоджено. Створено новий гараж.</p>}
      
      {!online&&<p className="drive-notice" role="status"><WifiOff size={16}/>{["saving","save-error"].includes(phase)?"Офлайн. Збережемо після підключення.":"Немає з’єднання. Заїзд на паузі."}</p>}
      {fullError&&<p className="drive-notice" role="status">{fullError}</p>}
      {game.error&&!["save-error","load-error"].includes(phase)&&<p className="drive-notice" role="alert">{game.error}</p>}
      {["loading","load-error"].includes(phase)&&<div className="drive-loading"><Gauge size={44}/><h2>{phase==="loading"?"Готуємо пригоду…":"Не вдалося відкрити гараж"}</h2>{phase==="load-error"?<><p role="alert">{game.error}</p><button className="drive-primary" onClick={game.load}>Спробувати ще раз</button></>:null}</div>}
      {phase==="map"&&progress&&<div className="drive-map">
        <div className="drive-map-heading"><h2>Маршрут</h2><span>{campaign.filter(l=>progress.tracks[String(l.id)]?.medals?.includes("finish")).length}/{campaign.length}</span></div>
        <WorldPicker game={game}/>
        <div className="drive-mode-switch" aria-label="Режим гри"><button aria-pressed={!endless} onClick={()=>game.chooseMode("campaign")}>Кампанія</button><button aria-pressed={endless} onClick={()=>game.chooseMode("endless")}>Нескінченна подорож</button></div>
        {endless?<section className="drive-endless-intro"><h3>{world.name} · ∞</h3><p>Без фінішу · рекорд {number(records?.endless?.[game.worldId]?.best||0)} м</p><button className="drive-primary" onClick={game.toGarage}>До автомобіля<ArrowRight size={20}/></button></section>:<div className="drive-routes">{[...(game.worldId==="earth"&&tutorial?[tutorial]:[]),...worldCampaign].map(l=><RouteTile key={l.id} level={l} record={progress.vehicles?records?.campaign?.[String(l.id)]:progress.tracks[String(l.id)]} selected={l.id===selected} locked={!game.unlockedLevels.includes(l.id)} onChoose={()=>game.choose(l.id)}/>)}</div>}
      </div>}
      {progress&&art&&phase!=="map"&&!["loading","load-error"].includes(phase)&&<div className={inRun?"drive-race-wrap":"drive-garage-wrap"}>
        {!inRun&&<FleetPicker game={game}/> }
        <div className={inRun?"drive-stage":"drive-garage-scene"}>
          <canvas ref={canvas} width="1280" height="720" role="img" aria-label={inRun?`Піксель їде: ${vehicle.name}, ${world.name}`:`Піксель за кермом: ${vehicle.name}, гараж`}/>
          {!inRun&&<div className="drive-car-label"><h2>{vehicle.name}</h2><p>{SPECIALTIES[vehicle.id]}</p></div>}
          {inRun&&<>
            <div className="drive-hud">
              <div className="drive-distance"><small>{game.practice?"ВИПРОБУВАННЯ":endless?`${world.name.toUpperCase()} · ∞`:level.campaignIndex===0?"НАВЧАННЯ":`ТРАСА · ${String(level.campaignIndex).padStart(2,"0")}`}</small><strong>{game.hud?.distance||0}<span>{endless?" м":` / ${level.meters} м`}</span></strong>{(!endless||nextMilestone)&&<progress value={game.hud?.distance||0} max={endless?nextMilestone:level.meters} aria-label={endless?"Дистанція до досягнення":"Дистанція до фінішу"}/>}{endless&&<small className="drive-checkpoint-count" aria-live="polite">{nextMilestone?`До ${number(nextMilestone/1000)} км`:"10 км ✓"}</small>}</div>
              <div className={`drive-fuel ${(game.hud?.fuel??100)<20?"is-low":""}`}><Fuel size={22}/><progress value={game.hud?.fuel??100} max="100" aria-label="Паливо"/><b aria-label="Залишок пального у секундах">{Math.ceil(game.hud?.fuelSeconds??stats.fuelSeconds)} с</b></div>
              <div className="drive-collected" title="Монети заїзду"><Coins size={22}/><b>{number(game.hud?.coinValue||0)}</b></div>
              <button className="drive-icon-button" onClick={game.pause} disabled={phase!=="racing"} aria-label="Пауза"><Pause size={22}/></button>
            </div>
            {phase==="racing"&&!game.diagnostics&&!endless&&selected===1&&(game.hud?.distance||0)<140&&<p className="drive-tutorial">{(game.hud?.distance||0)<35?"Утримуй ГАЗ, щоб рушити":(game.hud?.distance||0)<75?"ГАЛЬМО: спочатку зупинка, потім задній хід":"У повітрі: ГАЗ — ніс угору, ГАЛЬМО — вниз"}</p>}
            {phase==="racing"&&!endless&&(game.hud?.ticks||0)>level.max_ticks-900&&<p className="drive-tutorial">До завершення: {Math.max(0,Math.ceil((level.max_ticks-(game.hud?.ticks||0))/60))} с</p>}
            {phase==="countdown"&&<div className="drive-countdown" role="status"><strong>{game.count}</strong></div>}
            {phase==="paused"&&<div className="drive-overlay"><div className="drive-dialog" role="dialog" aria-modal="true" aria-label="Пауза заїзду"><h2>Пауза</h2><button autoFocus className="drive-primary" onClick={game.resume} disabled={busy||(!online&&!game.practice)}>Продовжити<ArrowRight size={20}/></button><button className="drive-secondary" onClick={game.end} disabled={busy}>{game.practice?"Завершити випробування":"Завершити та зберегти"}</button></div></div>}
            {["saving","save-error","result"].includes(phase)&&outcome&&<div className="drive-overlay"><div className="drive-dialog drive-result" role="dialog" aria-modal="true" aria-label="Результат заїзду">
              <div className="drive-result-symbol">{completed?<Flag size={30}/>:<RotateCcw size={30}/>}</div><h2>{completed?"Фініш, Пікселю!":REASONS[outcome.reason]||"Заїзд завершено"}</h2>
              <div className="drive-result-distance">{outcome.distance}<small>{endless?" м":` / ${level.meters} м`}</small></div>
              {game.practice?<p className="drive-reward" role="status">Тест завершено · без нагород.</p>:phase==="result"?<div className="drive-reward" role="status"><b>+{number(game.result.receipt.parts)} монет</b>{game.result.receipt.new_record&&<strong>Новий рекорд!</strong>}<span>{preview&&progress?.storage_mode==="memory"?"Збережено лише у вкладці. Не закривайте її.":"Заїзд збережено."}</span></div>:<p className="drive-save-status" role="status">{phase==="saving"?"Зберігаємо заїзд…":game.savePermanent?"Не вдалося зберегти":"Очікує збереження"}</p>}
              {phase==="save-error"&&<><p role="alert">{game.error}</p>{game.savePermanent?<button className="drive-primary" onClick={game.returnAfterRejectedSave} disabled={busy}>До гаража</button>:<><p role="status">{game.saveDurable?(game.retryExhausted?"Результат у черзі. Спробуйте надіслати ще раз.":"Результат у черзі акаунта. Повторимо автоматично."):"Результат лише у цій вкладці. Не закривайте її."}</p><button className="drive-primary" onClick={game.submit} disabled={!online||busy}>Надіслати ще раз</button></>}</>}
              <PixelGameReward enabled={fromPixel && !game.practice && phase==="result" && completed} game="pixel_drive" sessionId={game.result?.session_id} onReturn={returnToPixel} />
              {phase==="result"&&<><button autoFocus className="drive-primary" onClick={!game.practice&&completed&&nextLevel?()=>game.choose(nextLevel.id):restart} disabled={!online&&!game.practice}>{!game.practice&&completed&&nextLevel?"Наступна траса":"Ще раз"}<ArrowRight size={20}/></button><div className="drive-result-links"><button className="drive-secondary" onClick={game.toGarage}>До гаража</button>{!game.practice&&completed&&nextLevel&&<button className="drive-secondary" onClick={game.begin} disabled={!online}><RotateCcw size={15}/>Повторити</button>}</div>{!game.practice&&completed&&!nextLevel&&campaign.every(l=>progress.tracks[String(l.id)]?.medals?.includes("finish"))&&<p>Усі {campaign.length} трас кампанії пройдено!</p>}</>}
            </div></div>}
          </>}
        </div>
        {inRun&&<div className="drive-pedals"><Pedal kind="brake" game={game}/>{game.vehicleId==="orbiter"&&<Pedal kind="jet" game={game}/>}<Pedal kind="gas" game={game}/></div>}
        {!inRun&&<div className="drive-garage-controls">
          <aside className="drive-upgrades" aria-label="Покращення автомобіля">{upgradeRows.map(({id,name,Icon,rank,max,price})=><button key={id} type="button" className="drive-upgrade" onClick={()=>game.buy(id)} disabled={!game.owned||Boolean(game.pendingVehicle)||busy||!online||max||(!game.pendingUpgrade&&progress.balance<price)||(game.pendingUpgrade&&game.pendingUpgrade!==id)} aria-label={max?`${name}: максимальний рівень`:`${name}: покращити за ${price} монет`} data-testid={`drive-upgrade-${id}`}><Icon size={20}/><span className="drive-upgrade-copy"><strong>{name}</strong><small>{rank}/10</small></span><b className="drive-upgrade-price">{max?<Check size={18}/>:game.pendingUpgrade===id?"Повторити":<><Coins size={13}/>{number(price)}</>}</b></button>)}</aside>
          <VehicleActions game={game} vehicle={vehicle}/>
          <button className="drive-next-route" onClick={game.showMap} disabled={busy}><Map size={22}/><span><small>{world.name}</small><strong>{endless?"Нескінченна подорож":level.name}</strong><span>{endless?"Без фінішу":`${level.meters} м`} · {locked?"Закрито":`рекорд ${record?.best||0} м`}</span></span><ArrowRight size={19}/></button>
          {locked&&<p className="drive-unlock-hint"><LockKeyhole size={14}/>{!game.unlockedWorlds.includes(game.worldId)?WORLD_UNLOCK[game.worldId]:`Заверши «${CONFIG.levels.find(l=>l.id===selected-1)?.name||"попередню трасу"}».`}</p>}
          <button className="drive-primary drive-depart" onClick={game.begin} disabled={busy||!online||locked||!game.owned||Boolean(game.pendingUpgrade)||Boolean(game.pendingVehicle)}>{phase==="starting"?"Готуємо…":!game.owned?"Спершу придбай авто":locked?"Траса ще закрита":"Виїхати"}{locked?<LockKeyhole size={20}/>:<ArrowRight size={22}/>}</button>
          <details className="drive-specs"><summary>Характеристики</summary><dl><div><dt>Маса</dt><dd>{number(vehicle.mass)} кг</dd></div><div><dt>Пальне</dt><dd>{number(stats.fuelSeconds,1)} с</dd></div></dl></details>
        </div>}
      </div>}
      {preview&&progress?.storage_mode==="memory"&&<p className="drive-notice" role="status">Прогрес лише у вкладці. Не закривайте її.</p>}
    </div>
  </section>;
}
