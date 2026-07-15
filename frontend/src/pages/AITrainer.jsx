import { useMemo, useRef, useState } from "react";
import { Bot, ChevronLeft, Flame, Gauge, RotateCcw, Send, Sparkles, Star, Trophy } from "lucide-react";
import { toast } from "sonner";

const CLIENTS = {
  easy: { name: "Олена", age: 34, level: "Легкий", emoji: "🙂", patience: 75, accent: "#39FF14", desc: "Ввічлива, але невпевнена. Їй треба подумати й вона не любить тиску." },
  medium: { name: "Максим", age: 41, level: "Середній", emoji: "🧐", patience: 55, accent: "#FFB800", desc: "Прагматичний закупівельник. Порівнює ціни, умови та цінність." },
  hard: { name: "Ігор", age: 52, level: "Важкий", emoji: "😠", patience: 35, accent: "#FF5C00", desc: "Недовірливий після негативного досвіду. Різко реагує на шаблони й тиск." },
};

const Meter = ({ label, value, color }) => (
  <div>
    <div className="flex justify-between text-[10px] font-black uppercase tracking-wider text-zinc-500 mb-2"><span>{label}</span><span style={{ color }}>{value}%</span></div>
    <div className="h-2.5 rounded-full bg-white/5 overflow-hidden border border-white/5">
      <div className="h-full rounded-full transition-all duration-500 xp-stripes" style={{ width: `${Math.max(0, Math.min(100, value))}%`, backgroundColor: color }} />
    </div>
  </div>
);

export default function AITrainer() {
  const [level, setLevel] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [game, setGame] = useState({ patience: 0, conversion: 0, scores: [], streak: 0, bestStreak: 0, turn: 0, finished: false, won: false });
  const scrollRef = useRef(null);
  const client = level ? CLIENTS[level] : null;
  const average = useMemo(() => game.scores.length ? (game.scores.reduce((a,b) => a+b, 0) / game.scores.length).toFixed(1) : "—", [game.scores]);

  const scrollDown = () => setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }), 50);

  const callAI = async (payload) => {
    const res = await fetch("/.netlify/functions/ai-trainer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "AI не відповів");
    return data;
  };

  const start = async (key) => {
    const c = CLIENTS[key];
    setLevel(key);
    setBusy(true);
    setMessages([]);
    setGame({ patience: c.patience, conversion: 0, scores: [], streak: 0, bestStreak: 0, turn: 0, finished: false, won: false });
    try {
      const data = await callAI({ action: "opening", level: key });
      setMessages([{ role: "client", text: data.client_reply }]);
      scrollDown();
    } catch (e) {
      toast.error(e.message);
      setLevel(null);
    } finally { setBusy(false); }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy || game.finished) return;
    const nextMessages = [...messages, { role: "operator", text }];
    setMessages(nextMessages);
    setInput("");
    setBusy(true);
    scrollDown();
    try {
      const data = await callAI({ action: "turn", level, operatorText: text, history: nextMessages.slice(-10), state: { patience: game.patience, conversion: game.conversion, turn: game.turn } });
      const score = Number(data.score) || 0;
      const patience = Math.max(0, Math.min(100, game.patience + (Number(data.patience_delta) || 0)));
      const conversion = Math.max(0, Math.min(100, game.conversion + (Number(data.trust_delta) || 0)));
      const streak = score >= 7 ? game.streak + 1 : 0;
      const turn = game.turn + 1;
      const finished = patience <= 0 || conversion >= 100 || turn >= 8;
      const won = conversion >= 100 || (turn >= 8 && conversion >= 60);
      setGame(g => ({ ...g, patience, conversion, scores: [...g.scores, score], streak, bestStreak: Math.max(g.bestStreak, streak), turn, finished, won }));
      setMessages(m => [...m, { role: "feedback", score, technique: data.technique, text: data.feedback }, { role: "client", text: data.client_reply }]);
      scrollDown();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  const reset = () => { setLevel(null); setMessages([]); setInput(""); };

  if (!client) return (
    <div className="px-5 py-6 space-y-5" data-testid="ai-trainer-page">
      <section className="relative overflow-hidden rounded-[2rem] bg-[#151516] border border-white/10 p-6">
        <div className="absolute -top-20 -right-16 w-48 h-48 rounded-full bg-[#FFB800]/20 blur-3xl" />
        <div className="relative">
          <div className="inline-flex items-center gap-2 rounded-full bg-[#FFB800]/15 border border-[#FFB800]/30 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-[#FFB800]"><Sparkles size={13}/> Живий AI-тренажер</div>
          <div className="mt-5 w-16 h-16 rounded-[1.4rem] bg-[#FFB800] text-black flex items-center justify-center glow-yellow"><Bot size={32} strokeWidth={2.8}/></div>
          <h1 className="font-display text-3xl text-white leading-tight mt-5">СКЛАДНИЙ<br/>КЛІЄНТ</h1>
          <p className="text-sm text-zinc-400 font-bold leading-relaxed mt-3">Обери рівень. AI створить живий діалог, оцінить техніку та змінюватиме поведінку клієнта залежно від твоїх відповідей.</p>
        </div>
      </section>
      <div className="space-y-3">
        {Object.entries(CLIENTS).map(([key, c]) => (
          <button key={key} onClick={() => start(key)} disabled={busy} className="w-full text-left rounded-[1.6rem] bg-[#151516] border border-white/10 p-4 flex items-center gap-4 active:scale-[0.98] transition-transform">
            <div className="w-14 h-14 rounded-2xl bg-white/5 flex items-center justify-center text-3xl border border-white/10">{c.emoji}</div>
            <div className="flex-1 min-w-0"><div className="flex items-center justify-between"><span className="font-display text-base text-white">{c.name}, {c.age}</span><span className="text-[9px] font-black uppercase tracking-widest" style={{color:c.accent}}>{c.level}</span></div><p className="text-xs text-zinc-500 font-bold leading-relaxed mt-1">{c.desc}</p></div>
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="px-4 py-4 space-y-3" data-testid="ai-trainer-game">
      <div className="flex items-center justify-between">
        <button onClick={reset} className="w-11 h-11 rounded-2xl bg-[#1A1A1E] border border-white/10 flex items-center justify-center text-zinc-400"><ChevronLeft size={20}/></button>
        <div className="text-center"><div className="font-display text-sm text-white">{client.name}, {client.age}</div><div className="text-[9px] uppercase font-black tracking-widest" style={{color:client.accent}}>{client.level}</div></div>
        <button onClick={() => start(level)} className="w-11 h-11 rounded-2xl bg-[#1A1A1E] border border-white/10 flex items-center justify-center text-zinc-400"><RotateCcw size={18}/></button>
      </div>

      <section className="rounded-[1.6rem] bg-[#151516] border border-white/10 p-4 space-y-4">
        <div className="grid grid-cols-2 gap-3"><Meter label="Терпіння" value={game.patience} color={game.patience < 30 ? "#FF3B30" : "#FFB800"}/><Meter label="Угода" value={game.conversion} color="#39FF14"/></div>
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-2xl bg-white/5 p-3 text-center"><Star size={15} className="mx-auto text-[#FFB800]"/><div className="font-display text-lg mt-1">{average}</div><div className="text-[8px] uppercase text-zinc-500 font-black">Середній</div></div>
          <div className="rounded-2xl bg-white/5 p-3 text-center"><Flame size={15} className="mx-auto text-[#FF5C00]"/><div className="font-display text-lg mt-1">{game.bestStreak}</div><div className="text-[8px] uppercase text-zinc-500 font-black">Стрік</div></div>
          <div className="rounded-2xl bg-white/5 p-3 text-center"><Gauge size={15} className="mx-auto text-[#00F0FF]"/><div className="font-display text-lg mt-1">{game.turn}/8</div><div className="text-[8px] uppercase text-zinc-500 font-black">Хід</div></div>
        </div>
      </section>

      <section className="rounded-[1.6rem] bg-[#111113] border border-white/10 overflow-hidden">
        <div ref={scrollRef} className="h-[390px] overflow-y-auto p-4 space-y-3">
          {messages.map((m, i) => m.role === "feedback" ? (
            <div key={i} className="ml-8 rounded-2xl bg-[#FFB800]/8 border border-[#FFB800]/20 p-3 text-xs"><div className="font-black text-[#FFB800]">{m.score}/10 · {m.technique}</div><div className="text-zinc-400 font-bold mt-1 leading-relaxed">{m.text}</div></div>
          ) : (
            <div key={i} className={`flex ${m.role === "operator" ? "justify-end" : "justify-start"}`}><div className={`max-w-[84%] rounded-2xl px-4 py-3 text-sm font-bold leading-relaxed ${m.role === "operator" ? "bg-[#FFB800] text-black rounded-br-md" : "bg-[#1A1A1E] border border-white/10 text-zinc-100 rounded-bl-md"}`}>{m.text}</div></div>
          ))}
          {busy && <div className="text-xs text-zinc-500 font-black animate-pulse">клієнт думає...</div>}
          {game.finished && <div className={`rounded-3xl p-5 text-center border ${game.won ? "bg-[#39FF14]/10 border-[#39FF14]/30" : "bg-[#FF3B30]/10 border-[#FF3B30]/30"}`}><Trophy className="mx-auto" style={{color:game.won ? "#39FF14" : "#FF3B30"}}/><div className="font-display text-lg mt-2">{game.won ? "УГОДУ ЗАКРИТО" : "КЛІЄНТА ВТРАЧЕНО"}</div><div className="text-xs text-zinc-400 mt-2">Середній бал {average}/10 · найкращий стрік {game.bestStreak}</div></div>}
        </div>
        <div className="border-t border-white/10 p-3 flex gap-2">
          <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if(e.key === "Enter" && !e.shiftKey){ e.preventDefault(); send(); } }} disabled={busy || game.finished} placeholder="Твоя відповідь клієнту..." className="flex-1 h-12 max-h-24 resize-none rounded-2xl bg-[#1A1A1E] border border-white/10 px-4 py-3 text-sm text-white outline-none focus:border-[#FFB800]/60"/>
          <button onClick={send} disabled={busy || game.finished || !input.trim()} className="w-12 h-12 rounded-2xl bg-[#FFB800] text-black flex items-center justify-center disabled:opacity-40 active:scale-95"><Send size={19} strokeWidth={3}/></button>
        </div>
      </section>
    </div>
  );
}
