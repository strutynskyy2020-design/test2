import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import { ChevronLeft, Flame, Loader2, Mic, MicOff, RotateCcw, Send, Sparkles, Target, Trophy, Zap, BarChart3, Award, ChevronDown, Lightbulb, Volume2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { LEVELS, PRODUCT_CATEGORIES, SCENARIOS, TECHNIQUE_KEYS } from "@/data/aiTrainerScenarios";

const STORAGE_KEY = "pumb-ai-trainer-profile-v2";
const VOICE_LIMIT_SECONDS = 60;
const clamp = (value) => Math.max(0, Math.min(100, Number(value) || 0));
const blankTechniques = () => Object.fromEntries(TECHNIQUE_KEYS.map((key) => [key, { uses: 0, total: 0 }]));
const defaultProfile = () => ({ xp: 0, points: 0, wins: 0, attempts: 0, bestStreak: 0, completed: {}, achievements: [], techniques: blankTechniques(), results: [] });

function loadProfile() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!parsed) return defaultProfile();
    return { ...defaultProfile(), ...parsed, techniques: { ...blankTechniques(), ...(parsed.techniques || {}) } };
  } catch { return defaultProfile(); }
}

function currentLevel(xp) { return [...LEVELS].reverse().find((item) => xp >= item.min) || LEVELS[0]; }
function nextLevel(xp) { return LEVELS.find((item) => item.min > xp) || null; }
function normalizeTechnique(value = "") {
  const text = value.toLowerCase();
  const aliases = [
    ["Активне слухання", ["активн", "слухан"]], ["Емпатія", ["емпат", "приєднан"]],
    ["Уточнення потреби", ["уточнен", "потреб"]], ["SPIN", ["spin"]],
    ["Аргументація цінністю", ["цінніст", "вигод", "аргументац"]],
    ["Робота із запереченням", ["запереч"]], ["Прозорість умов", ["прозор", "чесн", "умов"]],
    ["Закриття угоди", ["закрит", "наступн", "оформ"]],
  ];
  return aliases.find(([, terms]) => terms.some((term) => text.includes(term)))?.[0] || "Робота із запереченням";
}

function Meter({ label, value, color, icon: Icon }) {
  return <div className="rounded-2xl bg-[#1A1A1E] border border-white/10 p-3">
    <div className="flex items-center justify-between mb-2">
      <span className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.12em] text-zinc-500"><Icon size={12}/>{label}</span>
      <span className="font-display text-sm" style={{ color }}>{value}%</span>
    </div>
    <div className="h-2 rounded-full bg-black/50 overflow-hidden"><motion.div initial={false} animate={{ width: `${value}%` }} className="h-full rounded-full" style={{ backgroundColor: color }}/></div>
  </div>;
}

function ProfileStrip({ profile }) {
  const level = currentLevel(profile.xp); const next = nextLevel(profile.xp);
  const progress = next ? clamp(((profile.xp - level.min) / (next.min - level.min)) * 100) : 100;
  return <div className="rounded-3xl bg-[#151519] border border-white/10 p-4 mb-5">
    <div className="flex items-center gap-3"><div className="text-3xl">{level.icon}</div><div className="flex-1 min-w-0"><div className="flex justify-between gap-2"><span className="font-display text-sm text-white">{level.name}</span><span className="text-xs font-black text-[#FFB800]">{profile.xp} XP</span></div><div className="h-2 mt-2 rounded-full bg-black/50 overflow-hidden"><div className="h-full bg-[#FFB800]" style={{ width: `${progress}%` }}/></div><div className="text-[9px] text-zinc-600 mt-1">{next ? `${next.min - profile.xp} XP до рівня «${next.name}»` : "Максимальний рівень"}</div></div><div className="text-right"><div className="font-display text-lg text-[#39FF14]">{profile.points}</div><div className="text-[8px] uppercase text-zinc-600 font-black">балів</div></div></div>
  </div>;
}

function Dashboard({ profile }) {
  const stats = Object.entries(profile.techniques).map(([name, data]) => ({ name, value: data.uses ? Math.round(data.total / data.uses) : 0, uses: data.uses })).sort((a,b)=>b.value-a.value);
  const ranking = [...profile.results].sort((a,b)=>b.points-a.points || b.average-a.average).slice(0,5);
  return <div className="grid md:grid-cols-2 gap-3 mt-5">
    <div className="rounded-3xl bg-[#151519] border border-white/10 p-4"><div className="flex items-center gap-2 font-display text-sm text-white mb-4"><BarChart3 size={17} className="text-[#00F0FF]"/>ТЕХНІКИ ПРОДАЖУ</div><div className="space-y-3">{stats.map((s)=><div key={s.name}><div className="flex justify-between text-[10px] mb-1"><span className="text-zinc-400">{s.name}</span><span className="text-white font-black">{s.uses ? `${s.value}%` : "—"}</span></div><div className="h-2 rounded-full bg-black/40 overflow-hidden"><div className="h-full bg-[#00F0FF]" style={{width:`${s.value}%`}}/></div></div>)}</div></div>
    <div className="rounded-3xl bg-[#151519] border border-white/10 p-4"><div className="flex items-center gap-2 font-display text-sm text-white mb-4"><Trophy size={17} className="text-[#FFB800]"/>ОСОБИСТИЙ РЕЙТИНГ</div>{ranking.length ? <div className="space-y-2">{ranking.map((r,i)=><div key={`${r.date}-${i}`} className="flex items-center gap-3 rounded-xl bg-black/25 p-3"><span className="font-display text-[#FFB800]">#{i+1}</span><div className="flex-1 min-w-0"><div className="text-xs text-white truncate">{r.title}</div><div className="text-[9px] text-zinc-600">{r.difficulty} • {r.average}/10</div></div><span className="font-black text-[#39FF14] text-xs">+{r.points}</span></div>)}</div> : <p className="text-xs text-zinc-600">Завершіть перший кейс, щоб з’явився рейтинг.</p>}</div>
    <div className="md:col-span-2 rounded-3xl bg-[#151519] border border-white/10 p-4"><div className="flex items-center gap-2 font-display text-sm text-white mb-3"><Award size={17} className="text-[#B56CFF]"/>ДОСЯГНЕННЯ</div>{profile.achievements?.length ? <div className="flex flex-wrap gap-2">{profile.achievements.map((item)=><span key={item} className="rounded-full border border-[#B56CFF]/30 bg-[#B56CFF]/10 px-3 py-1.5 text-[10px] font-black text-[#D9B5FF]">🏅 {item}</span>)}</div> : <p className="text-xs text-zinc-600">Перші досягнення відкриються після проходження кейсів.</p>}</div>
  </div>;
}

function ClientPicker({ onPick, profile, setProfile }) {
  const [category, setCategory] = useState("credit"); const [showStats, setShowStats] = useState(false);
  const list = SCENARIOS.filter((item) => item.category === category);
  const resetProgress = () => { if (window.confirm("Скинути XP, бали, статистику й досягнення?")) { const fresh = defaultProfile(); localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh)); setProfile(fresh); } };
  return <div className="mx-auto w-full max-w-5xl px-3 sm:px-6 py-5 pb-[calc(7rem+env(safe-area-inset-bottom))]">
    <div className="flex items-start justify-between gap-3"><div><div className="inline-flex items-center gap-2 rounded-full border border-[#00F0FF]/25 bg-[#00F0FF]/10 px-3 py-1 text-[10px] font-black tracking-[0.18em] text-[#00F0FF]"><Sparkles size={13}/>30 AI СЦЕНАРІЇВ</div><h1 className="font-display text-3xl text-white mt-4">ТРЕНАЖЕР <span className="text-[#FFB800]">ПРОДАЖІВ</span></h1><p className="text-zinc-400 text-sm mt-2">ПУМБ-продукти, універсальні кейси, XP, досягнення та рейтинг.</p></div><button onClick={()=>setShowStats(!showStats)} className="w-11 h-11 rounded-2xl bg-[#1A1A1E] border border-white/10 flex items-center justify-center text-[#00F0FF]"><BarChart3 size={20}/></button></div>
    <ProfileStrip profile={profile}/>{showStats && <><Dashboard profile={profile}/><button onClick={resetProgress} className="mt-3 text-[10px] text-zinc-700 underline">Скинути прогрес</button></>}
    <div className="flex gap-2 overflow-x-auto no-scrollbar py-4">{Object.entries(PRODUCT_CATEGORIES).map(([key,item])=><button key={key} onClick={()=>setCategory(key)} className={`shrink-0 rounded-2xl border px-3 py-2 text-left ${category===key ? "bg-white/10 border-white/25" : "bg-[#151519] border-white/5"}`}><div className="text-lg">{item.icon}</div><div className="text-[10px] font-black text-white whitespace-nowrap">{item.label}</div><div className="text-[8px] text-zinc-600">{SCENARIOS.filter(s=>s.category===key).length} кейсів</div></button>)}</div>
    <div className="grid gap-3 md:grid-cols-2">{list.map((scenario,index)=><motion.button key={scenario.id} initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} transition={{delay:index*.035}} onClick={()=>onPick(scenario.id)} className="w-full text-left rounded-3xl bg-[#1A1A1E] border border-white/10 p-4 active:scale-[.985] relative overflow-hidden"><div className="absolute left-0 inset-y-0 w-1" style={{background:scenario.color}}/><div className="flex gap-3"><div className="w-14 h-14 rounded-2xl bg-black/35 flex items-center justify-center text-2xl">{scenario.emoji}</div><div className="flex-1 min-w-0"><div className="flex justify-between gap-2"><div><div className="font-display text-sm text-white">{scenario.name}, {scenario.age}</div><div className="text-xs text-zinc-400 mt-1">{scenario.title}</div></div><div className="text-right"><div className="text-[8px] font-black" style={{color:scenario.color}}>{scenario.label}</div><div className="text-[10px] text-[#FFB800] font-black">+{scenario.points} балів</div></div></div><p className="text-[11px] text-zinc-600 mt-2 line-clamp-2">«{scenario.objection}»</p></div></div>{profile.completed?.[scenario.id] && <div className="absolute top-2 right-2 text-xs">✅</div>}</motion.button>)}</div>
    <Dashboard profile={profile}/>
  </div>;
}

function FeedbackCard({ message }) {
  const scoreColor = message.score >= 8 ? "#39FF14" : message.score >= 5 ? "#FFB800" : "#FF5C00";
  return <motion.div initial={{opacity:0,scale:.97}} animate={{opacity:1,scale:1}} className="rounded-3xl bg-[#151519] border border-white/10 overflow-hidden shadow-[0_14px_35px_rgba(0,0,0,.28)]">
    <div className="p-4 border-b border-white/5">
      <div className="flex items-start gap-3"><div className="font-display text-2xl leading-none" style={{color:scoreColor}}>{message.score}<span className="text-xs text-zinc-600">/10</span></div><div className="min-w-0 flex-1"><div className="text-[9px] uppercase tracking-[.12em] font-black text-zinc-500">Оцінка відповіді</div><div className="text-[10px] uppercase font-black text-white mt-1 leading-relaxed">{message.technique}</div></div></div>
      <p className="text-[13px] leading-5 text-zinc-300 mt-3">{message.text}</p>
    </div>
    {message.strongResponse && <details className="group">
      <summary className="list-none cursor-pointer p-4 flex items-center gap-2 text-[11px] font-black text-[#00F0FF]"><Lightbulb size={15}/>ПРИКЛАД СИЛЬНОЇ ВІДПОВІДІ <ChevronDown size={15} className="ml-auto transition-transform group-open:rotate-180"/></summary>
      <div className="px-4 pb-4"><div className="rounded-2xl border border-[#00F0FF]/20 bg-[#00F0FF]/5 p-3 text-[13px] leading-5 text-zinc-100">«{message.strongResponse}»</div>{message.whyBetter?.length > 0 && <div className="mt-3 space-y-1.5">{message.whyBetter.map((reason,i)=><div key={i} className="flex gap-2 text-[11px] leading-4 text-zinc-400"><span className="text-[#39FF14]">✓</span><span>{reason}</span></div>)}</div>}</div>
    </details>}
  </motion.div>;
}

export default function AITrainer() {
  const [profile, setProfile] = useState(loadProfile); const [scenarioId, setScenarioId] = useState(null);
  const [loading, setLoading] = useState(false); const [messages,setMessages]=useState([]); const [input,setInput]=useState("");
  const [patience,setPatience]=useState(0); const [conversion,setConversion]=useState(0); const [scores,setScores]=useState([]); const [streak,setStreak]=useState(0); const [bestStreak,setBestStreak]=useState(0); const [mood,setMood]=useState("нейтральний"); const [finished,setFinished]=useState(null);
  const [sessionTechniques,setSessionTechniques]=useState(blankTechniques);
  const [isListening,setIsListening]=useState(false); const [speechSupported,setSpeechSupported]=useState(true); const [voiceHint,setVoiceHint]=useState(""); const [voiceSeconds,setVoiceSeconds]=useState(0);
  const endRef=useRef(null); const chatRef=useRef(null); const recognitionRef=useRef(null); const voiceBaseRef=useRef(""); const voiceFinalRef=useRef(""); const listeningWantedRef=useRef(false); const voiceStartedAtRef=useRef(0); const voiceTimerRef=useRef(null);
  const scenario=useMemo(()=>SCENARIOS.find(s=>s.id===scenarioId),[scenarioId]);
  const average=scores.length?(scores.reduce((a,b)=>a+b,0)/scores.length).toFixed(1):"—";
  const stage = scores.length === 0 ? "Встановлення контакту" : scores.length <= 2 ? "Виявлення потреб" : conversion < 55 ? "Робота із запереченням" : "Підведення до рішення";

  useEffect(()=>{localStorage.setItem(STORAGE_KEY,JSON.stringify(profile))},[profile]);
  useEffect(()=>{endRef.current?.scrollIntoView({behavior:"smooth",block:"end"})},[messages,loading,finished]);

  const clearVoiceTimer = useCallback(() => { if (voiceTimerRef.current) { clearInterval(voiceTimerRef.current); voiceTimerRef.current = null; } }, []);
  const stopListening = useCallback(() => {
    listeningWantedRef.current = false; clearVoiceTimer(); setIsListening(false); setVoiceHint("");
    try { recognitionRef.current?.stop(); } catch {}
  }, [clearVoiceTimer]);

  useEffect(()=>{
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition; setSpeechSupported(Boolean(SR)); if(!SR)return undefined;
    const r=new SR(); r.lang="uk-UA"; r.continuous=true; r.interimResults=true;
    r.onstart=()=>{setIsListening(true);setVoiceHint("Слухаю… говоріть до 1 хвилини")};
    r.onresult=(e)=>{
      let interim="";
      for(let i=e.resultIndex;i<e.results.length;i++){
        const chunk=e.results[i][0].transcript;
        if(e.results[i].isFinal) voiceFinalRef.current += `${chunk} `; else interim += chunk;
      }
      const full=[voiceBaseRef.current,voiceFinalRef.current.trim(),interim.trim()].filter(Boolean).join(" ");
      setInput(full.trimStart());
    };
    r.onerror=(e)=>{
      if(["not-allowed","service-not-allowed"].includes(e.error)){listeningWantedRef.current=false;toast.error("Дозвольте доступ до мікрофона")}
      if(!["no-speech","aborted"].includes(e.error)){listeningWantedRef.current=false;toast.error("Голосове введення перервано")}
    };
    r.onend=()=>{
      const elapsed=(Date.now()-voiceStartedAtRef.current)/1000;
      if(listeningWantedRef.current && elapsed < VOICE_LIMIT_SECONDS){try{r.start();return}catch{}}
      listeningWantedRef.current=false; clearVoiceTimer(); setIsListening(false); setVoiceHint("");
    };
    recognitionRef.current=r;
    return()=>{listeningWantedRef.current=false;clearVoiceTimer();try{r.abort()}catch{} recognitionRef.current=null};
  },[clearVoiceTimer]);

  const toggleListening=()=>{
    if(isListening){stopListening();return}
    if(!speechSupported||!recognitionRef.current){toast.info("У Safari скористайтеся мікрофоном екранної клавіатури");return}
    voiceBaseRef.current=input.trim(); voiceFinalRef.current=""; voiceStartedAtRef.current=Date.now(); listeningWantedRef.current=true; setVoiceSeconds(0);
    clearVoiceTimer(); voiceTimerRef.current=setInterval(()=>{
      const seconds=Math.floor((Date.now()-voiceStartedAtRef.current)/1000); setVoiceSeconds(Math.min(seconds,VOICE_LIMIT_SECONDS));
      if(seconds>=VOICE_LIMIT_SECONDS){stopListening();toast.success("Голосове введення завершено: 1 хвилина")}
    },250);
    try{recognitionRef.current.start()}catch{listeningWantedRef.current=false;clearVoiceTimer();toast.error("Не вдалося запустити мікрофон")}
  };

  const callTrainer=async(payload)=>{const response=await fetch("/.netlify/functions/ai-trainer",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||"AI-сервіс недоступний");return data};
  const start=async(id)=>{const chosen=SCENARIOS.find(s=>s.id===id);setScenarioId(id);setPatience(chosen.patience);setConversion(0);setScores([]);setStreak(0);setBestStreak(0);setMessages([]);setFinished(null);setMood("нейтральний");setSessionTechniques(blankTechniques());setLoading(true);try{const result=await callTrainer({action:"start",scenarioId:id});setMessages([{role:"client",text:result.client_reply}]);setMood(result.client_mood||"нейтральний")}catch(e){toast.error(e.message);setScenarioId(null)}finally{setLoading(false)}};
  const reset=()=>{stopListening();setScenarioId(null);setMessages([]);setInput("");setFinished(null);setLoading(false)};
  const finishGame=(win,text,nextBest,nextScores,techniqueData)=>{const avg=nextScores.length?Number((nextScores.reduce((a,b)=>a+b,0)/nextScores.length).toFixed(1)):0;const points=win?scenario.points:0;const xpEarned=Math.round(nextScores.reduce((sum,s)=>sum+(s>=9?25:s>=7?18:s>=5?10:s>=3?5:0),0)+(win?50:10));const unlocked=[];setProfile(prev=>{const techniques={...prev.techniques};Object.entries(techniqueData).forEach(([key,val])=>{const old=techniques[key]||{uses:0,total:0};techniques[key]={uses:old.uses+val.uses,total:old.total+val.total}});const achievements=new Set(prev.achievements||[]);if(win)achievements.add("Перша угода");if(nextBest>=5)achievements.add("Стрік 5");if(avg>=9)achievements.add("Влучність 9+");if(scenario.category==="credit"&&win)achievements.add("Кредитний консультант");if(Object.keys(prev.completed||{}).length+(!prev.completed?.[scenario.id]&&win?1:0)>=10)achievements.add("10 кейсів");[...achievements].filter(a=>!(prev.achievements||[]).includes(a)).forEach(a=>unlocked.push(a));return {...prev,xp:prev.xp+xpEarned,points:prev.points+points,wins:prev.wins+(win?1:0),attempts:prev.attempts+1,bestStreak:Math.max(prev.bestStreak,nextBest),completed:{...prev.completed,...(win?{[scenario.id]:true}:{})},achievements:[...achievements],techniques,results:[...prev.results,{date:Date.now(),title:scenario.title,difficulty:scenario.label,average:avg,points,win}].slice(-50)}});setFinished({win,text,points,xpEarned,unlocked,avg,saleProbability:conversion})};
  const send=async()=>{const text=input.trim();if(!text||loading||finished)return;stopListening();const operator={role:"operator",text};const nextMessages=[...messages,operator];setMessages(nextMessages);setInput("");setLoading(true);try{const result=await callTrainer({action:"turn",scenarioId,patience,conversion,history:nextMessages.slice(-14),operatorText:text});const score=clamp(result.score);const nextPatience=clamp(patience+Number(result.patience_delta||0));const nextConversion=clamp(conversion+Number(result.trust_delta||0));const nextStreak=score>=7?streak+1:0;const nextBest=Math.max(bestStreak,nextStreak);const nextScores=[...scores,score];const techniqueNames=Array.isArray(result.techniques)?result.techniques:[result.technique||""];const updated={...sessionTechniques};techniqueNames.forEach((name)=>{const key=normalizeTechnique(name);const old=updated[key]||{uses:0,total:0};updated[key]={uses:old.uses+1,total:old.total+Math.round(score*10)}});setSessionTechniques(updated);setScores(nextScores);setPatience(nextPatience);setConversion(nextConversion);setStreak(nextStreak);setBestStreak(nextBest);setMood(result.client_mood||"нейтральний");setMessages(prev=>[...prev,{role:"feedback",score,technique:techniqueNames.join(" • "),text:result.feedback,strongResponse:result.strong_response,whyBetter:Array.isArray(result.why_better)?result.why_better:[]},{role:"client",text:result.client_reply}]);const target=scenario.target||80;if(result.terminal||result.outcome==="complaint")finishGame(false,result.outcome==="complaint"?"Розмову завершено зі скаргою через порушення стандартів спілкування.":"Клієнт завершив розмову.",nextBest,nextScores,updated);else if(nextPatience<=0)finishGame(false,"Клієнт завершив розмову через тон або зміст відповідей.",nextBest,nextScores,updated);else if(nextConversion>=target&&(result.deal_ready||score>=8))finishGame(true,"Клієнт погодився на доречний наступний крок.",nextBest,nextScores,updated)}catch(e){toast.error(e.message)}finally{setLoading(false)}};

  if(!scenario)return <ClientPicker onPick={start} profile={profile} setProfile={setProfile}/>;
  const level=currentLevel(profile.xp);
  return <div className="mx-auto w-full max-w-4xl h-[calc(100dvh-174px)] min-h-[520px] md:h-[calc(100dvh-120px)] flex flex-col overflow-hidden bg-[#0A0A0A]">
    <header className="shrink-0 px-3 sm:px-5 pt-3 pb-3 border-b border-white/5 bg-[#0A0A0A]/95 backdrop-blur-md">
      <div className="flex items-center gap-3"><button onClick={reset} className="w-10 h-10 rounded-2xl border border-white/10 bg-[#1A1A1E] flex items-center justify-center text-zinc-400"><ChevronLeft size={20}/></button><div className="w-11 h-11 rounded-2xl bg-[#1A1A1E] flex items-center justify-center text-2xl">{scenario.emoji}</div><div className="min-w-0 flex-1"><div className="font-display text-sm text-white">{scenario.name}, {scenario.age}</div><div className="text-[9px] font-black uppercase" style={{color:scenario.color}}>{scenario.label} • {mood} • +{scenario.points}</div></div><div className="text-right"><div className="text-lg">{level.icon}</div><div className="text-[8px] text-zinc-500">{profile.xp} XP</div></div></div>
      <div className="grid grid-cols-2 gap-2 mt-3"><Meter label="Лояльність" value={patience} color={patience<30?"#FF3B30":scenario.color} icon={Zap}/><Meter label="Ймовірність угоди" value={conversion} color="#00F0FF" icon={Target}/></div>
      <div className="flex items-center justify-between mt-2 gap-2"><div className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[9px] font-black text-zinc-300 truncate">ЕТАП: {stage}</div><div className="text-[9px] uppercase font-black text-zinc-600 whitespace-nowrap">Хід {scores.length+1} • середній {average}</div><div className="text-[#FF5C00] text-[9px] font-black flex gap-1 whitespace-nowrap"><Flame size={12}/> {streak}/{bestStreak}</div></div>
    </header>

    <main ref={chatRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 sm:px-5 py-4 space-y-4 scroll-pb-10">
      <div className="rounded-2xl border border-white/5 bg-white/[.025] p-3 text-[10px] leading-4 text-zinc-500"><span className="text-white font-black">Ваше завдання:</span> {scenario.goal}</div>
      <AnimatePresence initial={false}>{messages.map((m,i)=>m.role==="feedback"?<FeedbackCard key={i} message={m}/>:<motion.div key={i} initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} className={`flex items-end gap-2 ${m.role==="operator"?"justify-end":"justify-start"}`}>
        {m.role==="client"&&<div className="w-8 h-8 shrink-0 rounded-xl bg-[#1A1A1E] border border-white/10 flex items-center justify-center text-base">{scenario.emoji}</div>}
        <div className={`max-w-[82%] sm:max-w-[72%] ${m.role==="operator"?"order-1":""}`}>
          {m.role==="client"&&<div className="text-[9px] text-zinc-600 mb-1 ml-1">{scenario.name}</div>}
          <div className={`rounded-[22px] px-4 py-3 text-[14px] leading-[1.55] border break-words ${m.role==="operator"?"bg-[#FFB800] text-black border-[#FFB800] rounded-br-md font-semibold":"bg-[#1A1A1E] text-zinc-100 border-white/10 rounded-bl-md"}`}>{m.text}</div>
        </div>
      </motion.div>)}</AnimatePresence>
      {loading&&<div className="flex items-end gap-2"><div className="w-8 h-8 rounded-xl bg-[#1A1A1E] border border-white/10 flex items-center justify-center text-base">{scenario.emoji}</div><div className="rounded-[22px] rounded-bl-md bg-[#1A1A1E] border border-white/10 px-4 py-3"><div className="flex gap-1.5 items-center" aria-label="Клієнт друкує"><span className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce"/><span className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce [animation-delay:120ms]"/><span className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce [animation-delay:240ms]"/></div></div></div>}
      {finished&&<motion.div initial={{opacity:0,scale:.94}} animate={{opacity:1,scale:1}} className={`rounded-3xl border-2 p-5 text-center ${finished.win?"border-[#39FF14]/60 bg-[#39FF14]/10":"border-[#FF3B30]/60 bg-[#FF3B30]/10"}`}><div className="text-4xl">{finished.win?"🏆":"💥"}</div><div className="font-display text-lg text-white mt-2">{finished.win?"КЕЙС ПРОЙДЕНО":"КЕЙС НЕ ПРОЙДЕНО"}</div><p className="text-xs text-zinc-400 mt-2">{finished.text}</p><div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4"><div className="rounded-xl bg-black/30 p-3"><div className="text-[9px] text-zinc-500">Бали</div><div className="font-display text-[#39FF14]">+{finished.points}</div></div><div className="rounded-xl bg-black/30 p-3"><div className="text-[9px] text-zinc-500">XP</div><div className="font-display text-[#FFB800]">+{finished.xpEarned}</div></div><div className="rounded-xl bg-black/30 p-3"><div className="text-[9px] text-zinc-500">Якість консультації</div><div className="font-display text-[#00F0FF]">{finished.avg}/10</div></div><div className="rounded-xl bg-black/30 p-3"><div className="text-[9px] text-zinc-500">Ймовірність продажу</div><div className="font-display text-[#B56CFF]">{conversion}%</div></div></div>{finished.unlocked?.length>0&&<div className="mt-3 rounded-xl bg-[#B56CFF]/10 border border-[#B56CFF]/30 p-3"><div className="text-[9px] uppercase font-black text-[#B56CFF]">Нове досягнення</div><div className="text-sm text-white mt-1">🏅 {finished.unlocked.join(" • ")}</div></div>}<button onClick={()=>start(scenarioId)} className="arcade-btn mt-4 w-full bg-white text-black py-3 font-black flex justify-center gap-2"><RotateCcw size={17}/>ЩЕ РАЗ</button></motion.div>}
      <div ref={endRef}/>
    </main>

    {!finished&&<div className="shrink-0 z-20 px-3 sm:px-5 pt-2.5 pb-[calc(.6rem+env(safe-area-inset-bottom))] bg-[#0A0A0A]/98 border-t border-white/5 shadow-[0_-12px_32px_rgba(0,0,0,.45)]">
      {isListening&&<div className="mb-2 rounded-2xl border border-[#FF3B30]/30 bg-[#FF3B30]/10 px-3 py-2 flex items-center gap-3"><div className="flex gap-1 items-end h-5"><span className="w-1 h-2 bg-[#FF3B30] rounded-full animate-pulse"/><span className="w-1 h-4 bg-[#FF3B30] rounded-full animate-pulse [animation-delay:100ms]"/><span className="w-1 h-3 bg-[#FF3B30] rounded-full animate-pulse [animation-delay:200ms]"/><span className="w-1 h-5 bg-[#FF3B30] rounded-full animate-pulse [animation-delay:300ms]"/></div><div className="flex-1"><div className="text-[10px] font-black text-white">СЛУХАЮ…</div><div className="text-[9px] text-zinc-400">До 1 хвилини, натисніть мікрофон для зупинки</div></div><div className="font-display text-sm text-[#FF3B30]">0:{String(voiceSeconds).padStart(2,"0")}</div></div>}
      <div className="flex gap-2 items-end"><textarea value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send()}}} placeholder="Ваша відповідь клієнту…" rows={1} disabled={loading} className="flex-1 min-w-0 min-h-12 max-h-32 resize-none rounded-2xl bg-[#1A1A1E] border border-white/10 px-4 py-3 text-[15px] leading-5 text-white focus:outline-none focus:border-[#FFB800]/60 disabled:opacity-60"/><button onClick={toggleListening} disabled={loading} aria-label={isListening?"Зупинити голосове введення":"Почати голосове введення"} className={`w-12 h-12 shrink-0 rounded-2xl border flex items-center justify-center transition-transform active:scale-95 ${isListening?"bg-[#FF3B30] text-white border-[#FF3B30] animate-pulse":"bg-[#1A1A1E] text-[#00F0FF] border-[#00F0FF]/30"}`}>{isListening?<MicOff size={19}/>:<Mic size={19}/>}</button><button onClick={send} disabled={loading||!input.trim()} aria-label="Надіслати відповідь" className="w-12 h-12 shrink-0 rounded-2xl bg-[#FFB800] text-black flex items-center justify-center disabled:opacity-30 active:scale-95 transition-transform">{loading?<Loader2 size={19} className="animate-spin"/>:<Send size={19}/>}</button></div>
      {(voiceHint||!speechSupported)&&<div className="mt-1.5 text-[10px] text-zinc-600">{voiceHint||"Safari: використайте мікрофон екранної клавіатури, якщо кнопка недоступна."}</div>}
    </div>}
  </div>;
}
