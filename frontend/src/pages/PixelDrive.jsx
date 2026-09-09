import { PixelGameLink, PixelGameReward, usePixelOrigin } from "@/components/PixelGameBridge";
import {useEffect,useRef,useState} from "react";
import {useNavigate} from "react-router-dom";
import {ArrowLeft,ArrowRight,Bug,Check,Coins,Flag,FlaskConical,Fuel,Gauge,LockKeyhole,Map,Maximize2,Pause,RotateCcw,Settings2,Trophy,Volume2,VolumeX,WifiOff,Wrench} from "lucide-react";
import useDriveGame from "@/games/pixel-drive/useDriveGame";
import {CONFIG,getUpgradeStats} from "@/games/pixel-drive/engine";
import {drawDrive,drawGarage,drawRoute} from "@/games/pixel-drive/renderer";
import "@/games/pixel-drive/drive.css";

const PARTS=[
  {id:"engine",code:"E",name:"Двигун",Icon:Gauge},
  {id:"suspension",code:"S",name:"Підвіска",Icon:Settings2},
  {id:"tires",code:"G",name:"Шини",Icon:Wrench},
  {id:"tank",code:"F",name:"Бак",Icon:Fuel},
];
const REASONS={head:"Контакт голови із землею",head_contact:"Контакт голови із землею",stuck:"Авто застрягло",overturned:"Контакт голови із землею",fuel:"Паливо скінчилося, авто зупинилося",route_exit:"Авто виїхало за початок траси",time:"Час заїзду вичерпано",abandoned:"Заїзд завершено гравцем"};
const profileText=upgrades=>PARTS.map(({id,code})=>`${code}${upgrades?.[id]??0}`).join(" / ");
const number=(value,digits=0)=>Number(value).toLocaleString("uk-UA",{maximumFractionDigits:digits});
const delta=(before,after,unit,digits=0)=>`${number(before,digits)}${after===before?"":` → ${number(after,digits)}`} ${unit}`;
function upgradeDetails(part,current,next){
  if(part==="engine")return [delta(current.torqueNm,next.torqueNm,"Н·м"),`Оберти приводу: ${delta(current.driveOmega,next.driveOmega,"рад/с",1)}`];
  if(part==="tires")return [delta(current.gripMultiplier,next.gripMultiplier,"× зчеплення",2),"Множник контакту шин із незмінною дорогою"];
  if(part==="tank")return [delta(current.fuelSeconds,next.fuelSeconds,"с пального"),"1 с заїзду = 1 с пального; каністра заповнює бак"];
  return [delta(current.suspension.travel*100,next.suspension.travel*100,"см ходу",1),`Пружини, задня / передня: ${current.suspension.stiffness.map((v,i)=>delta(v/1000,next.suspension.stiffness[i]/1000,"кН/м",1)).join(" · ")}`,`Амортизація: ${current.suspension.damping.map((v,i)=>delta(v/1000,next.suspension.damping[i]/1000,"кН·с/м",2)).join(" · ")}`];
}
function RouteTile({level,record,locked,selected,onChoose}){
  const ref=useRef(null),complete=record?.medals?.includes("finish");
  useEffect(()=>{drawRoute(ref.current,level,selected,complete);},[level,selected,complete]);
  return <button className={`drive-route ${selected?"is-current":""} ${locked?"is-locked":""}`} onClick={onChoose} aria-label={`${level.name}: ${locked?"переглянути закриту трасу":"обрати трасу"}`} data-testid={`drive-track-${level.id}`}>
    <span className="drive-route-top"><b>{level.campaignIndex===0?"СТАРТ":String(level.campaignIndex).padStart(2,"0")}</b>{locked?<LockKeyhole size={20}/>:complete?<Check size={22}/>:<ArrowRight size={20}/>}</span>
    <canvas ref={ref} width="600" height="160" aria-hidden="true"/>
    <strong>{level.name}</strong><span>{level.meters} м · {locked?"Опис доступний до відкриття":record?.best?`Рекорд ${record.best} м`:"Новий маршрут"}</span>
    <span className="drive-route-profile">Орієнтир: {profileText(level.recommended)}</span>
    <span className="drive-route-status">{complete?"Фініш досягнуто":locked?"Відкриється після попереднього фінішу":level.campaignIndex===0?"Доступне без покращень":"Монети залишаються після кожної спроби"}</span>
  </button>;
}
function Pedal({kind,game}){
  const gas=kind==="gas";
  const release=e=>game.input(`${kind}:pointer:${e.pointerId}`,false);
  return <button type="button" className={`drive-pedal ${gas?"drive-pedal-gas":""}`} disabled={game.phase!=="racing"} aria-label={gas?"Газ":"Гальмо"}
    onPointerDown={e=>{if(e.button!==0)return;e.preventDefault();e.currentTarget.setPointerCapture?.(e.pointerId);game.input(`${kind}:pointer:${e.pointerId}`,true);}}
    onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}
    onKeyDown={e=>{if(["Space","Enter"].includes(e.code)){e.preventDefault();game.input(`${kind}:button:${e.code}`,true);}}}
    onKeyUp={e=>{if(["Space","Enter"].includes(e.code)){e.preventDefault();game.input(`${kind}:button:${e.code}`,false);}}}
    onBlur={()=>{game.input(`${kind}:button:Space`,false);game.input(`${kind}:button:Enter`,false);}}>
    <span className="drive-pedal-face"><i/><i/><i/><i/></span><strong>{gas?"ГАЗ":"ГАЛЬМО"}</strong><small>{gas?"D / →":"A / ← · задній хід"}</small>
  </button>;
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
  const record=progress?.tracks?.[String(selected)],locked=Boolean(progress&&selected>progress.unlocked_level);
  const campaign=CONFIG.levels.filter(l=>l.campaignIndex>0),tutorial=CONFIG.levels.find(l=>l.campaignIndex===0),nextLevel=CONFIG.levels.find(l=>l.id>selected);
  const stats=progress?getUpgradeStats(progress.upgrades):null;
  const upgradeRows=progress?PARTS.map(part=>{const rank=progress.upgrades[part.id],max=rank===10,next=getUpgradeStats({...progress.upgrades,[part.id]:Math.min(10,rank+1)});return {...part,rank,max,price:CONFIG.upgradePrices[part.id][rank],details:upgradeDetails(part.id,stats,next)};}):[];
  const localSaveLabel=progress?.storage_mode==="memory"?"Сховище недоступне: прогрес лише у вкладці":"Прогрес зберігається у цьому браузері";
  useEffect(()=>{if(phase==="racing")root.current?.focus({preventScroll:true});},[phase]);
  useEffect(()=>{
    const target=canvas.current;if(!target||!art||!progress)return;
    camera.current={};
    const render=state=>{
      if(inRun&&state)drawDrive(target,level,state,art,{reduced:game.reduced,diagnostics:game.diagnostics,camera:camera.current});
      else drawGarage(target,art,progress.upgrades);
    };
    game.draw.current=render;
    const resize=()=>{const rect=target.getBoundingClientRect(),dpr=Math.min(window.devicePixelRatio||1,2);target.width=Math.max(1,Math.round(rect.width*dpr));target.height=Math.max(1,Math.round(rect.height*dpr));render(game.runtime.current?.state);};
    const observer=new ResizeObserver(resize);observer.observe(target);resize();
    return()=>{observer.disconnect();game.draw.current=null;};
  },[phase,inRun,art,progress,selected,level,game.reduced,game.diagnostics,game.practice,game.draw,game.runtime]);
  const keyboard=(e,pressed)=>{
    if(e.code==="F2"){e.preventDefault();if(pressed&&!e.repeat)game.toggleDiagnostics();return;}
    if(e.code==="Escape"&&pressed){if(["racing","countdown"].includes(game.phaseRef.current))game.pause();return;}
    const kind=["KeyD","ArrowRight"].includes(e.code)?"gas":["KeyA","ArrowLeft"].includes(e.code)?"brake":null;
    if(kind&&game.phaseRef.current==="racing"){e.preventDefault();game.input(`${kind}:key:${e.code}`,pressed);}
  };
  const fullscreen=async()=>{setFullError("");try{if(document.fullscreenElement)await document.exitFullscreen();else if(root.current?.requestFullscreen)await root.current.requestFullscreen();else setFullError("Розгорни телефон горизонтально для ширшого огляду.");}catch(e){setFullError("Повноекранний режим недоступний у цьому браузері.");}};
  const back=()=>{if(busy)return;if(["racing","countdown"].includes(phase))game.pause();else if(phase==="map")game.toGarage();else if(inRun){if(phase==="paused")game.end();else if(phase==="result")game.toGarage();}else navigate(fromPixel ? "/pet/room" : "/");};
  return <section ref={root} tabIndex={-1} style={{"--drive-landscape":"url('/games/pixel-drive/v1/landscape.webp')"}} className={`drive-page ${inRun?"drive-page-running":""}`} onKeyDown={e=>keyboard(e,true)} onKeyUp={e=>keyboard(e,false)} data-testid="pixel-drive-page" data-phase={phase}>
    <div className="drive-shell">
      <header className="drive-header">
        <button className="drive-icon-button" onClick={back} disabled={busy||phase==="save-error"} aria-label={inRun||phase==="map"?"Назад до гаража":fromPixel?"До кімнати Пікселя":"На головну"}><ArrowLeft size={21}/></button>
        <div className="drive-brand"><span title={preview?localSaveLabel:undefined} aria-label={preview?`Локальна гра. ${localSaveLabel}`:undefined}>{preview?"ЛОКАЛЬНА ГРА":"ПІКСЕЛЬ"}</span><h1>Повний газ</h1></div>
        <div className="drive-header-actions">
          {progress&&!inRun&&<span className="drive-wallet" title="Монети"><Coins size={19}/><b>{number(progress.balance)}</b><small>монет</small></span>}
          <button className="drive-icon-button drive-debug-toggle" onClick={game.toggleDiagnostics} aria-label="Діагностика фізики" aria-pressed={game.diagnostics} title="Діагностика фізики · F2"><Bug size={19}/></button>
          <button className="drive-icon-button" onClick={game.toggleSound} aria-label={game.sound?"Вимкнути звук":"Увімкнути звук"} aria-pressed={game.sound}>{game.sound?<Volume2 size={19}/>:<VolumeX size={19}/>}</button>
          <button className="drive-icon-button drive-fullscreen-toggle" onClick={fullscreen} aria-label="На весь екран"><Maximize2 size={19}/></button>
        </div>
      </header>
      <PixelGameLink enabled={fromPixel && !inRun} onReturn={returnToPixel} disabled={busy} />
      {preview&&progress?.storage_reset&&phase==="garage"&&<p className="drive-notice" role="status">Пошкоджене локальне збереження відновлено з початковими налаштуваннями.</p>}
      {progress?.migration&&phase==="garage"&&<p className="drive-notice" role="status">Гараж перенесено до нової кампанії. Куплені покращення й баланс збережено; перша основна траса доступна.</p>}
      {!online&&<p className="drive-notice" role="status"><WifiOff size={16}/>Немає з’єднання. Заїзд на паузі.</p>}
      {fullError&&<p className="drive-notice" role="status">{fullError}</p>}
      {game.error&&!["save-error","load-error"].includes(phase)&&<p className="drive-notice" role="alert">{game.error}</p>}
      {["loading","load-error"].includes(phase)&&<div className="drive-loading"><Gauge size={44}/><h2>{phase==="loading"?"Готуємо пригоду…":"Не вдалося відкрити гараж"}</h2>{phase==="load-error"?<><p role="alert">{game.error}</p><button className="drive-primary" onClick={game.load}>Спробувати ще раз</button></>:<p>Піксель перевіряє колеса</p>}</div>}
      {phase==="map"&&progress&&<div className="drive-map">
        <div className="drive-map-intro"><span className="drive-eyebrow">ВІД ПЕРШОГО ВИЇЗДУ ДО ВЕРШИНИ</span><h2>Далі за обрій</h2><p>Знайома дорога. Нові можливості твого автомобіля.</p><span className="drive-map-progress">{campaign.filter(l=>progress.tracks[String(l.id)]?.medals?.includes("finish")).length} / {campaign.length} трас кампанії пройдено</span></div>
        {tutorial&&<div className="drive-tutorial-route"><div><span className="drive-eyebrow">НАВЧАННЯ</span><h3>Освой дві педалі</h3><p>Базовий автомобіль проходить навчання. Перші монети допоможуть обрати покращення.</p></div><RouteTile level={tutorial} record={progress.tracks[String(tutorial.id)]} selected={tutorial.id===selected} locked={false} onChoose={()=>game.choose(tutorial.id)}/></div>}
        <div className="drive-routes">{campaign.map(l=><RouteTile key={l.id} level={l} record={progress.tracks[String(l.id)]} selected={l.id===selected} locked={l.id>progress.unlocked_level} onChoose={()=>game.choose(l.id)}/>)}</div>
        <p className="drive-footnote">E — двигун · S — підвіска · G — шини · F — бак. Профілі — орієнтири, а не умова доступу. Фініш відкриває наступну трасу.</p>
      </div>}
      {progress&&art&&phase!=="map"&&!["loading","load-error"].includes(phase)&&<div className={inRun?"drive-race-wrap":"drive-garage-wrap"}>
        <div className={inRun?"drive-stage":"drive-garage-scene"}>
          <canvas ref={canvas} width="1280" height="720" role="img" aria-label={inRun?"Піксель їде пагорбами на бірюзовому авто":"Піксель за кермом автомобіля Мандрівник у гаражі"}/>
          {!inRun&&<>
            <div className="drive-car-label"><span className="drive-eyebrow">ТВІЙ АВТОМОБІЛЬ</span><h2>Мандрівник</h2><p>{profileText(progress.upgrades)}</p></div>
            <aside className="drive-upgrades" aria-label="Покращення автомобіля"><div className="drive-upgrade-heading"><Wrench size={18}/><h3>Гараж Пікселя</h3></div>
              {upgradeRows.map(({id,code,name,Icon,rank,max,price,details})=><button key={id} type="button" className="drive-upgrade" onClick={()=>game.buy(id)} disabled={busy||!online||max||(!game.pendingUpgrade&&progress.balance<price)||(game.pendingUpgrade&&game.pendingUpgrade!==id)} aria-label={max?`${name}: максимальний рівень`:`${name}: покращити за ${price} монет`} aria-describedby={`drive-stat-${id}`} data-testid={`drive-upgrade-${id}`}>
                <Icon size={29}/><span className="drive-upgrade-copy"><strong>{code} · {name}</strong><span className="drive-ranks">{Array.from({length:10},(_,i)=>i+1).map(n=><i key={n} className={n<=rank?"on":""}/>)}<small>{rank}/10</small></span><small>{details[0]}</small></span>
                <b className="drive-upgrade-price">{max?<Check size={21}/>:game.pendingUpgrade===id?"Повторити":<><Coins size={15}/>{number(price)}</>}</b>
              </button>)}
              <p>Дорога залишається тією самою після покупки.</p>
            </aside>
            <div className="drive-garage-bottom">
              <button className="drive-next-route" onClick={game.showMap} disabled={busy}><Map size={23}/><span><small>{level.campaignIndex===0?"НАВЧАННЯ":"ТРАСА КАМПАНІЇ"} · ОБРАТИ МАРШРУТ</small><strong>{level.name}</strong><span>{level.meters} м · {locked?"Перегляд закритої траси":`рекорд ${record?.best||0} м`}</span></span><ArrowRight size={19}/></button>
              <button className="drive-primary drive-depart" onClick={game.begin} disabled={busy||!online||locked||Boolean(game.pendingUpgrade)}>{phase==="starting"?"Готуємо заїзд…":locked?"Траса ще закрита":"Виїхати"}{locked?<LockKeyhole size={22}/>:<ArrowRight size={24}/>}</button>
            </div>
          </>}
          {inRun&&<>
            <div className="drive-hud">
              <div className="drive-distance"><small>{game.practice?"ВИПРОБУВАННЯ":level.campaignIndex===0?"НАВЧАННЯ":`ТРАСА · ${String(level.campaignIndex).padStart(2,"0")}`}</small><strong>{game.hud?.distance||0}<span> / {level.meters} м</span></strong><progress value={game.hud?.distance||0} max={level.meters} aria-label="Дистанція до фінішу"/>{!game.practice&&Boolean(level.checkpoints?.length)&&<small className="drive-checkpoint-count">Позначки {game.hud?.checkpoints?.length||0} / {level.checkpoints.length}</small>}</div>
              <div className={`drive-fuel ${(game.hud?.fuel??100)<20?"is-low":""}`}><Fuel size={22}/><progress value={game.hud?.fuel??100} max="100" aria-label="Паливо"/><b aria-label="Залишок пального у секундах">{Math.ceil(game.hud?.fuelSeconds??stats.fuelSeconds)} с</b></div>
              <div className="drive-collected" title="Монети заїзду"><Coins size={22}/><b>{number(game.hud?.coinValue||0)}</b></div>
              <button className="drive-icon-button" onClick={game.pause} disabled={phase!=="racing"} aria-label="Пауза"><Pause size={22}/></button>
            </div>
            {phase==="racing"&&!game.diagnostics&&selected===1&&(game.hud?.distance||0)<140&&<p className="drive-tutorial">{(game.hud?.distance||0)<35?"Утримуй ГАЗ, щоб рушити":(game.hud?.distance||0)<75?"ГАЛЬМО: спочатку зупинка, потім задній хід":"У повітрі: ГАЗ — ніс угору, ГАЛЬМО — вниз"}</p>}
            {phase==="racing"&&(game.hud?.ticks||0)>level.max_ticks-900&&<p className="drive-tutorial">До завершення: {Math.max(0,Math.ceil((level.max_ticks-(game.hud?.ticks||0))/60))} с</p>}
            {phase==="countdown"&&<div className="drive-countdown" role="status"><strong>{game.count}</strong><span>Приготуйся до дороги</span></div>}
            {phase==="paused"&&<div className="drive-overlay"><div className="drive-dialog" role="dialog" aria-modal="true" aria-label="Пауза заїзду"><span className="drive-eyebrow">ДОРОГА ЗАЧЕКАЄ</span><h2>Перепочинемо?</h2><p>{level.hint}</p><p>Гальмо після зупинки вмикає задній хід. Обидві педалі разом: на землі гальмування без заднього ходу, у повітрі — нейтраль.</p><button autoFocus className="drive-primary" onClick={game.resume} disabled={busy||(!online&&!game.practice)}>Продовжити<ArrowRight size={20}/></button><button className="drive-secondary" onClick={game.end} disabled={busy||(!online&&!game.practice)}>{game.practice?"Завершити випробування":"Завершити та зберегти"}</button></div></div>}
            {["saving","save-error","result"].includes(phase)&&outcome&&<div className="drive-overlay"><div className="drive-dialog drive-result" role="dialog" aria-modal="true" aria-label="Результат заїзду">
              <div className="drive-result-symbol">{completed?<Flag size={30}/>:<RotateCcw size={30}/>}</div><span className="drive-eyebrow">{completed?"ЩЕ ОДНА ДОРОГА ПОЗАДУ":REASONS[outcome.reason]||"Спробуй ще"}</span><h2>{completed?"Фініш, Пікселю!":"Ще один заїзд?"}</h2>
              <div className="drive-result-distance">{outcome.distance}<small> / {level.meters} м</small></div>
              {!game.practice&&<div className="drive-result-facts"><span><Trophy size={16}/>{phase==="result"?"Особистий рекорд":"Попередній рекорд"}<b>{record?.best||0} м</b></span><span><Flag size={16}/>Контрольні позначки<b>{outcome.checkpoints?.length||0} / {level.checkpoints?.length||0}</b></span></div>}
              {game.practice?<p className="drive-reward" role="status">Випробування завершено. Прогрес і монети не змінюються.</p>:phase==="result"?<div className="drive-reward" role="status"><b>+{number(game.result.receipt.parts)} монет</b><span>На дорозі: {number(game.result.receipt.coin_parts??outcome.coinValue??0)} · позначки: {number(game.result.receipt.checkpoint_parts||0)} · перший фініш: {number(game.result.receipt.finish_parts||0)}</span>{game.result.receipt.new_record&&<strong>Новий особистий рекорд!</strong>}<span>Зібрані монети залишаються з тобою.</span></div>:<p className="drive-save-status" role="status">{phase==="saving"?"Перевіряємо й зберігаємо заїзд…":game.savePermanent?"Цей результат не можна зберегти":"Результат ще не збережено"}</p>}
              {Boolean(outcome.analysis?.some(item=>typeof item?.message==="string"))&&<ul className="drive-run-analysis" aria-label="Що показав заїзд">{outcome.analysis.filter(item=>typeof item?.message==="string").map((item,i)=><li key={`${item.type||"fact"}-${i}`}>{item.message}</li>)}</ul>}
              {phase==="save-error"&&<><p role="alert">{game.error}</p>{game.savePermanent?<button className="drive-primary" onClick={game.load} disabled={busy}>До гаража</button>:<><button className="drive-primary" onClick={game.submit} disabled={!online||busy}>Надіслати ще раз</button><button className="drive-secondary" onClick={game.toGarage}>До гаража без збереження</button></>}</>}
              <PixelGameReward enabled={fromPixel && !game.practice && phase==="result" && completed} game="pixel_drive" sessionId={game.result?.session_id} onReturn={returnToPixel} />
              {phase==="result"&&<><button autoFocus className="drive-primary" onClick={!game.practice&&completed&&nextLevel?()=>game.choose(nextLevel.id):restart} disabled={!online&&!game.practice}>{!game.practice&&completed&&nextLevel?"Наступна траса":"Ще раз"}<ArrowRight size={20}/></button><div className="drive-result-links"><button className="drive-secondary" onClick={game.toGarage}>До гаража</button>{!game.practice&&completed&&nextLevel&&<button className="drive-secondary" onClick={game.begin} disabled={!online}><RotateCcw size={15}/>Повторити</button>}</div>{!game.practice&&completed&&!nextLevel&&<p>Вершину досягнуто. Усі {campaign.length} трас кампанії пройдено!</p>}</>}
            </div></div>}
          </>}
        </div>
        {inRun&&<><div className="drive-pedals"><Pedal kind="brake" game={game}/><span className="drive-pedals-note">Дві педалі: на землі — гальмо,<br/>у повітрі — нейтраль.</span><Pedal kind="gas" game={game}/></div><p className="drive-rotate-hint">Поверни телефон горизонтально для ширшого огляду.</p></>}
        {!inRun&&<section className="drive-route-preview" aria-label="Обрана траса"><div><span className="drive-eyebrow">{locked?"ПЕРЕГЛЯД МАЙБУТНЬОЇ ТРАСИ":"ТВІЙ НАСТУПНИЙ ВИЇЗД"}</span><h3>{level.name}</h3><p>{level.description||level.hint}</p>{locked&&<p className="drive-unlock-hint"><LockKeyhole size={15}/>Щоб виїхати, заверши «{CONFIG.levels.find(l=>l.id===selected-1)?.name||"попередню трасу"}».</p>}</div><div><b>Орієнтир комплектації</b><strong>{profileText(level.recommended)}</strong><p>E — двигун · S — підвіска · G — шини · F — бак</p><small>Це рекомендація. Можна спробувати іншу комплектацію.</small></div></section>}
        {!inRun&&<section className="drive-garage-stats" aria-label="Що змінить наступне покращення">{upgradeRows.map(({id,name,rank,max,details})=><article key={id} id={`drive-stat-${id}`}><h3>{name}<span>{max?"10 / 10":`${rank} → ${rank+1}`}</span></h3>{details.map((line,i)=><p key={line} className={i===0?"drive-stat-main":""}>{line}</p>)}</article>)}</section>}
        {!inRun&&process.env.NODE_ENV!=="production"&&<button className="drive-test-course drive-secondary" onClick={game.beginTest} disabled={busy||Boolean(game.pendingUpgrade)}><FlaskConical size={17}/>Випробувати фізику<span>Коротка траса · без нагород</span></button>}
        {!inRun&&<p className="drive-footnote">Монети відновлюються в кожному заїзді. Заробляй навіть після невдачі й повертайся на знайому дорогу. Керування: A / D або дві педалі.</p>}
      </div>}
      {preview&&<p className="drive-preview-note">Локальна гра · {localSaveLabel}</p>}
    </div>
  </section>;
}
