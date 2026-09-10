import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import api,{extractError} from "@/lib/api";
import {CONFIG,TEST_LEVEL,captureDrive,createDrive,getLevel,getEndlessLevel,getTestLevel,interpolateDrive,stepDrive,summarize} from "./engine";
import {loadDriveArt} from "./art";
import {createFrameClock} from "./frameClock";
import {persistPendingSave,readPendingSaves,removePendingSave} from "./pendingSave";
import {assertSessionMap} from "./sessionMap";
const requestId=()=>window.crypto?.randomUUID?.()||`drive-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const ZERO={engine:0,suspension:0,tires:0,tank:0};
const RETRY_DELAYS=[1000,2500,5000,10000,30000];
export default function useDriveGame(service=api){
  const [phase,setPhase]=useState("loading"),phaseRef=useRef("loading");
  const [progress,setProgress]=useState(null),[selected,setSelected]=useState(1),[art,setArt]=useState(null);
  const [vehicleId,setVehicleId]=useState("wanderer"),[worldId,setWorldId]=useState("earth"),[mode,setMode]=useState("campaign");
  const [error,setError]=useState(""),[online,setOnline]=useState(navigator.onLine),[busy,setBusy]=useState(false);
  const [hud,setHud]=useState(null),[result,setResult]=useState(null),[count,setCount]=useState(3);
  const [savePermanent,setSavePermanent]=useState(false);
  const [saveDurable,setSaveDurable]=useState(false),[retrySignal,setRetrySignal]=useState(0);
  const [sound,setSound]=useState(false),[reduced,setReduced]=useState(false);
  const [diagnostics,setDiagnostics]=useState(false),[practice,setPractice]=useState(false);
  const runtime=useRef(null),session=useRef(null),inputs=useRef(new Set()),tapped=useRef(0),pending=useRef(false),alive=useRef(false);
  const startRequest=useRef(null),upgradeRequest=useRef(null),vehicleRequest=useRef(null),payload=useRef(null),audio=useRef(null),draw=useRef(null);
  const saveScope=useRef(null),queuedResult=useRef(null),retryAttempts=useRef(0);
  const selectedLevel=useMemo(()=>mode==="endless"?getEndlessLevel(worldId):getLevel(selected),[mode,selected,worldId]);
  const level=["racing","countdown","paused","saving","save-error","result"].includes(phase)&&runtime.current?runtime.current.level:practice?TEST_LEVEL:selectedLevel;
  const upgrades=progress?.vehicles?.[vehicleId]?.upgrades||(vehicleId===(progress?.vehicle_id||"wanderer")?progress?.upgrades:ZERO)||ZERO;
  const owned=Boolean(progress?.vehicles?.[vehicleId]||(!progress?.vehicles&&vehicleId==="wanderer"));
  const unlockedLevels=progress?.unlocked_levels||CONFIG.levels.filter(l=>l.id<=(progress?.unlocked_level||1)).map(l=>l.id);
  const unlockedWorlds=progress?.unlocked_worlds||["earth"];
  const transition=useCallback(next=>{phaseRef.current=next;inputs.current.clear();tapped.current=0;if(alive.current)setPhase(next);},[]);
  const lock=()=>{pending.current=true;setBusy(true);};const unlock=()=>{pending.current=false;if(alive.current)setBusy(false);};
  useEffect(()=>{alive.current=true;const held=inputs.current;return()=>{alive.current=false;held.clear();audio.current?.close().catch(()=>{});};},[]);
  useEffect(()=>{
    const media=matchMedia("(prefers-reduced-motion: reduce)"),update=()=>setReduced(media.matches);update();media.addEventListener("change",update);
    return()=>media.removeEventListener("change",update);
  },[]);
  const restorePending=useCallback(entry=>{
    queuedResult.current=entry;payload.current=entry.payload;session.current={session_id:entry.sessionId};runtime.current=null;
    setSelected(entry.levelId);setVehicleId(entry.payload.outcome.vehicleId||"wanderer");setWorldId(entry.payload.outcome.worldId||getLevel(entry.levelId)?.worldId||"earth");setMode(entry.payload.outcome.mode||"campaign");setPractice(false);setResult({outcome:entry.payload.outcome});setHud(entry.payload.outcome);
    setSaveDurable(true);retryAttempts.current=0;
    const outdated=![3,CONFIG.version].includes(entry.version);
    setSavePermanent(outdated);setError(outdated?"Незбережений заїзд належить до попередньої версії гри.":"Відновлено незбережений результат. Надішлемо його автоматично, щойно буде з’єднання.");
    transition("save-error");setRetrySignal(value=>value+1);
  },[transition]);
  const load=useCallback(async()=>{
    if(pending.current)return;pending.current=true;setBusy(true);setError("");transition("loading");
    try{
      const [response,images]=await Promise.all([service.get("/games/pixel-drive/status"),loadDriveArt()]);
      if(!alive.current)return;
      if(response.data.version!==CONFIG.version)throw new Error("Гра оновилась. Перезавантажте сторінку");
      if(response.data.result_mode!=="client"||typeof response.data.save_scope!=="string"||!response.data.save_scope)throw new Error("Оновіть сторінку: формат збереження гри змінився.");
      saveScope.current=response.data.save_scope;
      runtime.current=null;session.current=null;payload.current=null;startRequest.current=null;
      queuedResult.current=null;retryAttempts.current=0;
      setPractice(false);setResult(null);setHud(null);setSavePermanent(false);setSaveDurable(false);
      setProgress(response.data);setSelected(response.data.unlocked_level||1);setVehicleId(response.data.vehicle_id||"wanderer");setWorldId(getLevel(response.data.unlocked_level||1).worldId||"earth");setMode("campaign");setArt(images);
      const restored=readPendingSaves(saveScope.current)[0];
      if(restored)restorePending(restored);else transition("garage");
    }catch(e){if(alive.current){setError(extractError(e));transition("load-error");}}
    finally{pending.current=false;if(alive.current)setBusy(false);}
  },[service,transition,restorePending]);
  useEffect(()=>{void load();},[load]);
  const pause=useCallback(()=>{
    inputs.current.clear();tapped.current=0;
    if(["racing","countdown"].includes(phaseRef.current))transition("paused");
    audio.current?.suspend().catch(()=>{});
  },[transition]);
  useEffect(()=>{
    const visibility=()=>{if(document.hidden)pause();},offline=()=>{setOnline(false);pause();},on=()=>{setOnline(true);retryAttempts.current=0;setRetrySignal(value=>value+1);if(phaseRef.current==="load-error")void load();};
    document.addEventListener("visibilitychange",visibility);window.addEventListener("blur",pause);
    window.addEventListener("offline",offline);window.addEventListener("online",on);
    return()=>{document.removeEventListener("visibilitychange",visibility);window.removeEventListener("blur",pause);window.removeEventListener("offline",offline);window.removeEventListener("online",on);};
  },[pause,load]);
  const tone=useCallback((frequency=520)=>{
    if(!sound)return;
    try{
      const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)return;
      audio.current ||= new Audio();const a=audio.current;void a.resume().catch(()=>{});
      const o=a.createOscillator(),g=a.createGain();o.type="triangle";o.frequency.setValueAtTime(frequency,a.currentTime);
      o.frequency.exponentialRampToValueAtTime(frequency*1.45,a.currentTime+.08);
      g.gain.setValueAtTime(.035,a.currentTime);g.gain.exponentialRampToValueAtTime(.001,a.currentTime+.15);
      o.connect(g);g.connect(a.destination);o.start();o.stop(a.currentTime+.15);
    }catch(e){/* Audio must never interrupt a drive. */}
  },[sound]);
  const submit=useCallback(async({automatic=false}={})=>{
    if(pending.current||savePermanent||!payload.current||!session.current)return;
    if(session.current.practice){
      const outcome=summarize(runtime.current.level,runtime.current.state);
      if(payload.current.abandon){outcome.status="failed";outcome.reason="abandoned";}
      setResult({outcome,receipt:{parts:0,new_medals:[],new_gears:0}});transition("result");return;
    }
    if(!automatic)retryAttempts.current=0;
    const entry=queuedResult.current||{schema:1,id:requestId(),scope:saveScope.current,version:session.current.version||CONFIG.version,levelId:Math.max(1,runtime.current.level.id),sessionId:session.current.session_id,createdAt:Date.now(),payload:payload.current};
    queuedResult.current=entry;
    let durableEntry=null;
    pending.current=true;setBusy(true);setError("");transition("saving");
    try{
      // The complete immutable result is durable before any finish request.
      durableEntry=persistPendingSave(entry);queuedResult.current=durableEntry;setSaveDurable(true);
      if(!navigator.onLine)throw new Error("Немає з’єднання. Результат записано в браузері та буде надіслано після повернення мережі.");
      const {data:current}=await service.get("/games/pixel-drive/status");
      if(!alive.current)return;
      if(current.save_scope!==entry.scope){
        saveScope.current=null;queuedResult.current=null;payload.current=null;session.current=null;runtime.current=null;
        setProgress(null);setResult(null);setError("Акаунт змінився. Результат залишився у черзі попереднього акаунта; відкрийте гараж ще раз.");transition("load-error");return;
      }
      if(current.result_mode!=="client"){
        const changed=new Error("Формат збереження змінився. Оновіть сторінку.");changed.response={status:409};throw changed;
      }
      const {data}=await service.post(`/games/pixel-drive/sessions/${encodeURIComponent(entry.sessionId)}/finish`,entry.payload,{timeout:30000});
      // Remove only this exact acknowledged record, even if the component left.
      let cleanupError="";try{removePendingSave(durableEntry);}catch(e){cleanupError="Заїзд збережено. Браузер не зміг очистити чергу; повторна відправка не нарахує нагороду вдруге.";}
      if(!alive.current)return;
      queuedResult.current=null;payload.current=null;retryAttempts.current=0;setSaveDurable(false);
      setProgress(data.progress);setResult({...data,session_id:entry.sessionId});setError(cleanupError);transition("result");
    }catch(e){if(alive.current){
      const detail=e?.response?.data?.detail;
      const status=e?.response?.status;
      setSavePermanent(status>=400&&status<500&&![408,425,429].includes(status));
      if(!e?.response&&queuedResult.current===entry){
        try{setSaveDurable(readPendingSaves(entry.scope).some(saved=>saved.id===entry.id));}catch(_){setSaveDurable(false);}
      }
      setError(typeof detail?.message==="string"?detail.message:extractError(e));transition("save-error");setRetrySignal(value=>value+1);
    }}
    finally{pending.current=false;if(alive.current)setBusy(false);}
  },[service,transition,savePermanent]);
  useEffect(()=>{
    if(phase!=="save-error"||savePermanent||!saveDurable||!online||retryAttempts.current>=RETRY_DELAYS.length)return;
    const timer=setTimeout(()=>{retryAttempts.current++;void submit({automatic:true});},RETRY_DELAYS[retryAttempts.current]);
    return()=>clearTimeout(timer);
  },[phase,savePermanent,saveDurable,online,retrySignal,submit]);
  const finish=abandon=>{
    const run=runtime.current,outcome=summarize(run.level,run.state);
    if(abandon){outcome.status="failed";outcome.reason="abandoned";}
    payload.current={ticks:run.state.tick,abandon,outcome};setHud(outcome);setResult({outcome});void submit();
  };
  const returnAfterRejectedSave=()=>{
    if(pending.current||!savePermanent)return;
    try{if(queuedResult.current)removePendingSave(queuedResult.current);}catch(e){setError(extractError(e));return;}
    queuedResult.current=null;payload.current=null;session.current=null;setSavePermanent(false);void load();
  };
  const begin=async()=>{
    if(pending.current||!online||!art||upgradeRequest.current||vehicleRequest.current||!progress||!owned||(mode==="campaign"?!unlockedLevels.includes(selected):!unlockedWorlds.includes(worldId)))return;
    try{const restored=queuedResult.current||readPendingSaves(saveScope.current)[0];if(restored){restorePending(restored);return;}}catch(e){setError(extractError(e));return;}
    lock();setError("");setSavePermanent(false);transition("starting");
    startRequest.current ||= {level:selected,vehicle_id:vehicleId,world_id:worldId,mode,request_id:requestId()};
    try{
      const {data}=await service.post("/games/pixel-drive/start",startRequest.current);
      if(!alive.current)return;
      if(data.version!==CONFIG.version||(mode==="campaign"&&data.level_id!==selected))throw new Error("Версія траси змінилась. Оновіть гру");
      const runLevel=mode==="endless"?getEndlessLevel(data.world_id||worldId,data.seed):getLevel(data.level_id);
      assertSessionMap(data,runLevel,{mode,worldId,vehicleId});
      const state=createDrive(runLevel,data.upgrades,{vehicleId:data.vehicle_id||vehicleId,worldId:data.world_id||worldId});
      session.current=data;runtime.current={state,previous:captureDrive(state),level:runLevel,input:0};setPractice(false);
      payload.current=null;queuedResult.current=null;setSaveDurable(false);startRequest.current=null;setResult(null);setHud(summarize(runLevel,state));setCount(3);
      transition(navigator.onLine&&!document.hidden?"countdown":"paused");tone(340);
    }catch(e){if([400,403,409].includes(e?.response?.status))startRequest.current=null;if(alive.current){setError(extractError(e));transition("garage");}}
    finally{unlock();}
  };
  const beginTest=()=>{
    if(pending.current||queuedResult.current||upgradeRequest.current||vehicleRequest.current||!art||!progress)return;
    const trialLevel=getTestLevel(worldId),state=createDrive(trialLevel,upgrades,{vehicleId,worldId});
    session.current={practice:true};runtime.current={state,previous:captureDrive(state),level:trialLevel,input:0};
    payload.current=null;startRequest.current=null;setResult(null);setPractice(true);
    setError("");setSavePermanent(false);setHud(summarize(trialLevel,state));setCount(3);transition(document.hidden?"paused":"countdown");
  };
  const buy=async part=>{
    if(pending.current||!online||!owned||vehicleRequest.current)return;
    if(upgradeRequest.current&&upgradeRequest.current.part!==part)return;
    upgradeRequest.current ||= {part,vehicle_id:vehicleId,level:upgrades[part],request_id:requestId()};
    lock();setError("");
    try{
      const {data}=await service.post("/games/pixel-drive/upgrade",upgradeRequest.current);
      if(alive.current){setProgress(data.progress);tone(680);}upgradeRequest.current=null;
    }catch(e){
      if(alive.current)setError(extractError(e));
      if([400,409].includes(e?.response?.status)){upgradeRequest.current=null;try{const {data}=await service.get("/games/pixel-drive/status");if(alive.current)setProgress(data);}catch(_){}}
    }finally{unlock();}
  };
  const transactVehicle=async(action,id=vehicleId)=>{
    if(pending.current||!online||upgradeRequest.current)return;
    if(vehicleRequest.current&&(vehicleRequest.current.vehicle_id!==id||vehicleRequest.current.action!==action))return;
    vehicleRequest.current ||= {action,vehicle_id:id,request_id:requestId()};
    lock();setError("");
    try{
      const {action:kind,...body}=vehicleRequest.current;
      const {data}=await service.post(`/games/pixel-drive/vehicle/${kind}`,body);
      if(alive.current){setProgress(data.progress);setVehicleId(id);tone(680);}vehicleRequest.current=null;
    }catch(e){
      if(alive.current)setError(extractError(e));
      if([400,403,409].includes(e?.response?.status)){vehicleRequest.current=null;try{const {data}=await service.get("/games/pixel-drive/status");if(alive.current)setProgress(data);}catch(_){}}
    }finally{unlock();}
  };
  const browseVehicle=id=>{if(pending.current||queuedResult.current||upgradeRequest.current||vehicleRequest.current)return;setVehicleId(id);startRequest.current=null;setError("");};
  const chooseWorld=id=>{if(pending.current||queuedResult.current)return;setWorldId(id);const first=CONFIG.levels.find(l=>(l.worldId||"earth")===id&&l.campaignIndex>0);if(first)setSelected(first.id);startRequest.current=null;};
  const chooseMode=next=>{if(pending.current||queuedResult.current)return;setMode(next);startRequest.current=null;};
  const choose=id=>{if(pending.current||queuedResult.current)return;setSelected(id);setWorldId(getLevel(id).worldId||"earth");setMode("campaign");setPractice(false);startRequest.current=null;runtime.current=null;session.current=null;payload.current=null;setResult(null);setSavePermanent(false);setSaveDurable(false);setError("");transition("garage");};
  const toGarage=()=>{if(pending.current||queuedResult.current)return;setPractice(false);runtime.current=null;session.current=null;payload.current=null;setResult(null);setError("");transition("garage");};
  const resume=async()=>{
    if(session.current?.practice){setError("");setCount(3);transition(document.hidden?"paused":"countdown");return;}
    if(pending.current||!online)return;
    if(Date.parse(session.current?.expires_at||"")<=Date.now()){setError("Час сесії минув. Почніть новий заїзд.");transition("garage");return;}
    lock();setError("");
    try{
      // Re-read the immutable start session when returning from a lost connection.
      const {data}=await service.get("/games/pixel-drive/status");
      if(alive.current){if(data.version!==CONFIG.version)throw new Error("Гра оновилась. Почніть нову спробу.");setProgress(data);setCount(3);transition(!document.hidden&&navigator.onLine?"countdown":"paused");}
    }catch(e){if(alive.current)setError(extractError(e));}finally{unlock();}
  };
  const end=()=>{
    if(!runtime.current||pending.current)return;
    const run=runtime.current;
    if(run.state.tick===0){toGarage();return;}
    finish(true);
  };
  useEffect(()=>{
    if(phase!=="countdown")return;let left=3;
    const timer=setInterval(()=>{left--;if(!left){clearInterval(timer);transition("racing");}else setCount(left);},650);
    return()=>clearInterval(timer);
  },[phase,transition]);
  useEffect(()=>{
    if(phase!=="racing")return;
    let raf,lastHud=0;const clock=createFrameClock();
    runtime.current.previous=captureDrive(runtime.current.state);
    const tick=time=>{
      if(phaseRef.current!=="racing")return;
      const run=runtime.current,l=run.level;
      const frame=clock.advance(time,()=>{
        if(run.state.status!=="playing")return false;
        const input=(Array.from(inputs.current).some(k=>k.startsWith("gas"))?1:0)|(Array.from(inputs.current).some(k=>k.startsWith("brake"))?2:0)|(Array.from(inputs.current).some(k=>k.startsWith("jet"))?4:0)|tapped.current;
        tapped.current=0;
        if(input!==run.input)run.input=input;
        const coins=run.state.coinsCollected??run.state.gears.length,fuel=run.state.fuel;
        run.previous=captureDrive(run.state);stepDrive(l,run.state,input);
        if((run.state.coinsCollected??run.state.gears.length)>coins)tone();if(run.state.fuel>fuel)tone(310);
        return run.state.status==="playing";
      });
      if(frame.paused){pause();return;}
      draw.current?.(interpolateDrive(run.previous,run.state,run.state.status==="playing"?frame.alpha:1));
      if(time-lastHud>90){setHud(summarize(l,run.state));lastHud=time;}
      if(run.state.status!=="playing"){
        inputs.current.clear();const outcome=summarize(l,run.state);setHud(outcome);setResult({outcome});
        payload.current={ticks:run.state.tick,abandon:false,outcome};
        void submit();return;
      }
      raf=requestAnimationFrame(tick);
    };raf=requestAnimationFrame(tick);return()=>{cancelAnimationFrame(raf);clock.reset();};
  },[phase,pause,submit,tone]);
  const input=(key,pressed)=>{if(pressed&&phaseRef.current==="racing"){inputs.current.add(key);tapped.current|=key.startsWith("gas")?1:key.startsWith("jet")?4:2;}else inputs.current.delete(key);};
  return {phase,phaseRef,progress,selected,level,art,vehicleId,worldId,mode,upgrades,owned,unlockedLevels,unlockedWorlds,browseVehicle,chooseWorld,chooseMode,transactVehicle,pendingVehicle:vehicleRequest.current,error,online,busy,hud,result,count,sound,reduced,diagnostics,practice,savePermanent,saveDurable,retryExhausted:retryAttempts.current>=RETRY_DELAYS.length,runtime,draw,
    pendingUpgrade:upgradeRequest.current?.part,load,begin,beginTest,buy,choose,toGarage,returnAfterRejectedSave,resume,end,pause,submit,input,toggleDiagnostics:()=>setDiagnostics(v=>!v),
    showMap:()=>{if(!pending.current&&!queuedResult.current){setError("");transition("map");}},toggleSound:()=>{if(sound)audio.current?.suspend().catch(()=>{});setSound(!sound);},transition};
}
