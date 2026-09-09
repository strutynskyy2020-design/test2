import {useCallback,useEffect,useRef,useState} from "react";
import api,{extractError} from "@/lib/api";
import {CONFIG,TEST_LEVEL,captureDrive,createDrive,getLevel,interpolateDrive,stepDrive,summarize} from "./engine";
import {loadDriveArt} from "./art";
import {createFrameClock} from "./frameClock";
const requestId=()=>globalThis.crypto?.randomUUID?.()||`drive-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export default function useDriveGame(service=api){
  const [phase,setPhase]=useState("loading"),phaseRef=useRef("loading");
  const [progress,setProgress]=useState(null),[selected,setSelected]=useState(1),[art,setArt]=useState(null);
  const [error,setError]=useState(""),[online,setOnline]=useState(navigator.onLine),[busy,setBusy]=useState(false);
  const [hud,setHud]=useState(null),[result,setResult]=useState(null),[count,setCount]=useState(3);
  const [savePermanent,setSavePermanent]=useState(false);
  const [sound,setSound]=useState(false),[reduced,setReduced]=useState(false);
  const [diagnostics,setDiagnostics]=useState(false),[practice,setPractice]=useState(false);
  const runtime=useRef(null),session=useRef(null),inputs=useRef(new Set()),tapped=useRef(0),pending=useRef(false),alive=useRef(false);
  const startRequest=useRef(null),upgradeRequest=useRef(null),payload=useRef(null),audio=useRef(null),draw=useRef(null);
  const level=practice?TEST_LEVEL:getLevel(selected);
  const transition=useCallback(next=>{phaseRef.current=next;inputs.current.clear();tapped.current=0;if(alive.current)setPhase(next);},[]);
  const lock=()=>{pending.current=true;setBusy(true);};const unlock=()=>{pending.current=false;if(alive.current)setBusy(false);};
  useEffect(()=>{alive.current=true;const held=inputs.current;return()=>{alive.current=false;held.clear();audio.current?.close().catch(()=>{});};},[]);
  useEffect(()=>{
    const media=matchMedia("(prefers-reduced-motion: reduce)"),update=()=>setReduced(media.matches);update();media.addEventListener("change",update);
    return()=>media.removeEventListener("change",update);
  },[]);
  const load=useCallback(async()=>{
    if(pending.current)return;pending.current=true;setBusy(true);setError("");transition("loading");
    try{
      const [response,images]=await Promise.all([service.get("/games/pixel-drive/status"),loadDriveArt()]);
      if(!alive.current)return;
      if(response.data.version!==CONFIG.version)throw new Error("Гра оновилась. Перезавантажте сторінку");
      runtime.current=null;session.current=null;payload.current=null;startRequest.current=null;
      setPractice(false);setResult(null);setHud(null);setSavePermanent(false);
      setProgress(response.data);setSelected(response.data.unlocked_level);setArt(images);transition("garage");
    }catch(e){if(alive.current){setError(extractError(e));transition("load-error");}}
    finally{pending.current=false;if(alive.current)setBusy(false);}
  },[service,transition]);
  useEffect(()=>{void load();},[load]);
  const pause=useCallback(()=>{
    inputs.current.clear();tapped.current=0;
    if(["racing","countdown"].includes(phaseRef.current))transition("paused");
    audio.current?.suspend().catch(()=>{});
  },[transition]);
  useEffect(()=>{
    const visibility=()=>{if(document.hidden)pause();},offline=()=>{setOnline(false);pause();},on=()=>setOnline(true);
    document.addEventListener("visibilitychange",visibility);window.addEventListener("blur",pause);
    window.addEventListener("offline",offline);window.addEventListener("online",on);
    return()=>{document.removeEventListener("visibilitychange",visibility);window.removeEventListener("blur",pause);window.removeEventListener("offline",offline);window.removeEventListener("online",on);};
  },[pause]);
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
  const submit=useCallback(async()=>{
    if(pending.current||savePermanent||!payload.current||!session.current)return;
    if(session.current.practice){
      const outcome=summarize(runtime.current.level,runtime.current.state);
      if(payload.current.abandon){outcome.status="failed";outcome.reason="abandoned";}
      setResult({outcome,receipt:{parts:0,new_medals:[],new_gears:0}});transition("result");return;
    }
    pending.current=true;setBusy(true);setError("");transition("saving");
    try{
      const {data}=await service.post(`/games/pixel-drive/sessions/${session.current.session_id}/finish`,payload.current,{timeout:30000});
      if(!alive.current)return;setProgress(data.progress);setResult({...data,session_id:session.current.session_id});transition("result");
    }catch(e){if(alive.current){
      const detail=e?.response?.data?.detail;
      setSavePermanent([400,403,404,409,410,422].includes(e?.response?.status));
      setError(typeof detail?.message==="string"?detail.message:extractError(e));transition("save-error");
    }}
    finally{pending.current=false;if(alive.current)setBusy(false);}
  },[service,transition,savePermanent]);
  const begin=async()=>{
    if(pending.current||!online||!art||upgradeRequest.current||!progress||selected>progress.unlocked_level)return;
    lock();setError("");setSavePermanent(false);transition("starting");
    startRequest.current ||= {level:selected,request_id:requestId()};
    try{
      const {data}=await service.post("/games/pixel-drive/start",startRequest.current);
      if(!alive.current)return;
      if(data.version!==CONFIG.version||data.level_id!==selected)throw new Error("Версія траси змінилась. Оновіть гру");
      const runLevel=getLevel(data.level_id),state=createDrive(runLevel,data.upgrades);
      session.current=data;runtime.current={state,previous:captureDrive(state),level:runLevel,events:[],input:0};setPractice(false);
      payload.current=null;startRequest.current=null;setResult(null);setHud(summarize(runLevel,state));setCount(3);
      transition(navigator.onLine&&!document.hidden?"countdown":"paused");tone(340);
    }catch(e){if([400,403,409].includes(e?.response?.status))startRequest.current=null;if(alive.current){setError(extractError(e));transition("garage");}}
    finally{unlock();}
  };
  const beginTest=()=>{
    if(process.env.NODE_ENV==="production"||pending.current||!art||!progress)return;
    const state=createDrive(TEST_LEVEL,progress.upgrades);
    session.current={practice:true};runtime.current={state,previous:captureDrive(state),level:TEST_LEVEL,events:[],input:0};
    payload.current=null;startRequest.current=null;setResult(null);setPractice(true);setDiagnostics(true);
    setError("");setSavePermanent(false);setHud(summarize(TEST_LEVEL,state));setCount(3);transition(document.hidden?"paused":"countdown");
  };
  const buy=async part=>{
    if(pending.current||!online)return;
    if(upgradeRequest.current&&upgradeRequest.current.part!==part)return;
    upgradeRequest.current ||= {part,level:progress.upgrades[part],request_id:requestId()};
    lock();setError("");
    try{
      const {data}=await service.post("/games/pixel-drive/upgrade",upgradeRequest.current);
      if(alive.current){setProgress(data.progress);tone(680);}upgradeRequest.current=null;
    }catch(e){
      if(alive.current)setError(extractError(e));
      if([400,409].includes(e?.response?.status)){upgradeRequest.current=null;try{const {data}=await service.get("/games/pixel-drive/status");if(alive.current)setProgress(data);}catch(_){}}
    }finally{unlock();}
  };
  const choose=id=>{if(pending.current)return;setSelected(id);setPractice(false);startRequest.current=null;runtime.current=null;session.current=null;payload.current=null;setResult(null);setSavePermanent(false);setError("");transition("garage");};
  const toGarage=()=>{if(!pending.current)choose(selected);};
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
    payload.current={ticks:run.state.tick,events:run.events.map(e=>[...e]),abandon:true};
    setResult({outcome:{...summarize(run.level,run.state),status:"failed",reason:"abandoned"}});
    void submit();
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
        const input=(Array.from(inputs.current).some(k=>k.startsWith("gas"))?1:0)|(Array.from(inputs.current).some(k=>k.startsWith("brake"))?2:0)|tapped.current;
        tapped.current=0;
        if(input!==run.input){run.events.push([run.state.tick,input]);run.input=input;}
        const gears=run.state.gears.length,cans=run.state.cans.length;
        run.previous=captureDrive(run.state);stepDrive(l,run.state,input);
        if(run.state.gears.length>gears)tone();if(run.state.cans.length>cans)tone(310);
        return run.state.status==="playing";
      });
      if(frame.paused){pause();return;}
      draw.current?.(interpolateDrive(run.previous,run.state,run.state.status==="playing"?frame.alpha:1));
      if(time-lastHud>90){setHud(summarize(l,run.state));lastHud=time;}
      if(run.state.status!=="playing"){
        inputs.current.clear();setHud(summarize(l,run.state));setResult({outcome:summarize(l,run.state)});
        payload.current={ticks:run.state.tick,events:run.events.map(e=>[...e]),abandon:false};
        void submit();return;
      }
      raf=requestAnimationFrame(tick);
    };raf=requestAnimationFrame(tick);return()=>{cancelAnimationFrame(raf);clock.reset();};
  },[phase,pause,submit,tone]);
  const input=(key,pressed)=>{if(pressed&&phaseRef.current==="racing"){inputs.current.add(key);tapped.current|=key.startsWith("gas")?1:2;}else inputs.current.delete(key);};
  return {phase,phaseRef,progress,selected,level,art,error,online,busy,hud,result,count,sound,reduced,diagnostics,practice,savePermanent,runtime,draw,
    pendingUpgrade:upgradeRequest.current?.part,load,begin,beginTest,buy,choose,toGarage,resume,end,pause,submit,input,toggleDiagnostics:()=>setDiagnostics(v=>!v),
    showMap:()=>{if(!pending.current){setError("");transition("map");}},toggleSound:()=>{if(sound)audio.current?.suspend().catch(()=>{});setSound(!sound);},transition};
}
