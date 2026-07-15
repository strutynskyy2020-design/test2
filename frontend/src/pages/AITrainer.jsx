import { useMemo, useRef, useState, useEffect } from "react";
import { Bot, ChevronLeft, Flame, RotateCcw, Send, Sparkles, Target, Zap } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";

const CLIENTS = {
  easy: {
    name: "Олена",
    age: 34,
    level: "ЛЕГКИЙ",
    emoji: "🙂",
    accent: "#39FF14",
    patience: 75,
    description: "Ввічлива, але вагається. Їй треба відчути особисту вигоду без тиску.",
  },
  medium: {
    name: "Максим",
    age: 41,
    level: "СЕРЕДНІЙ",
    emoji: "🧐",
    accent: "#FFB800",
    patience: 55,
    description: "Прагматик. Порівнює ціни, просить цифри та перевіряє цінність пропозиції.",
  },
  hard: {
    name: "Ігор",
    age: 52,
    level: "ВАЖКИЙ",
    emoji: "😠",
    accent: "#FF5C00",
    patience: 35,
    description: "Недовірливий після поганого досвіду. Різко реагує на шаблони й нав'язування.",
  },
};

const clamp = (value) => Math.max(0, Math.min(100, value));

function Meter({ label, value, color, icon: Icon }) {
  return (
    <div className="rounded-2xl bg-[#1A1A1E] border border-white/10 p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.14em] text-zinc-500">
          <Icon size={14} /> {label}
        </span>
        <span className="font-display text-sm" style={{ color }}>{value}%</span>
      </div>
      <div className="h-3 rounded-full bg-black/50 overflow-hidden border border-white/5">
        <motion.div
          initial={false}
          animate={{ width: `${value}%` }}
          transition={{ type: "spring", stiffness: 120, damping: 20 }}
          className="h-full rounded-full xp-stripes"
          style={{ backgroundColor: color }}
        />
      </div>
    </div>
  );
}

function ClientPicker({ onPick }) {
  return (
    <div className="px-5 py-6">
      <div className="mb-6">
        <div className="inline-flex items-center gap-2 rounded-full border border-[#00F0FF]/25 bg-[#00F0FF]/10 px-3 py-1 text-[10px] font-black tracking-[0.18em] text-[#00F0FF]">
          <Sparkles size={13} /> LIVE AI SIMULATION
        </div>
        <h1 className="font-display text-3xl text-white mt-4 leading-tight">СКЛАДНИЙ<br/><span className="text-[#FFB800]">КЛІЄНТ</span></h1>
        <p className="text-zinc-400 text-sm mt-3 leading-relaxed">Обери характер. AI зіграє клієнта, оцінить кожну відповідь і змінюватиме хід розмови наживо.</p>
      </div>

      <div className="space-y-3">
        {Object.entries(CLIENTS).map(([key, client], index) => (
          <motion.button
            key={key}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.07 }}
            onClick={() => onPick(key)}
            className="w-full text-left rounded-3xl bg-[#1A1A1E] border border-white/10 p-4 active:scale-[0.98] transition-transform relative overflow-hidden"
          >
            <div className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: client.accent }} />
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-black/40 border border-white/10 flex items-center justify-center text-3xl">{client.emoji}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-display text-base text-white">{client.name}, {client.age}</div>
                  <span className="text-[9px] font-black rounded-full px-2.5 py-1 border" style={{ color: client.accent, borderColor: `${client.accent}55`, backgroundColor: `${client.accent}14` }}>{client.level}</span>
                </div>
                <p className="text-xs text-zinc-500 mt-2 leading-relaxed">{client.description}</p>
              </div>
            </div>
          </motion.button>
        ))}
      </div>

      <div className="mt-5 rounded-2xl border border-white/5 bg-white/[0.025] p-4 text-xs text-zinc-500 leading-relaxed">
        <span className="text-white font-black">Мета:</span> виявити потребу, опрацювати заперечення та довести клієнта до угоди до того, як закінчиться терпіння.
      </div>
    </div>
  );
}

export default function AITrainer() {
  const [clientKey, setClientKey] = useState(null);
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [patience, setPatience] = useState(0);
  const [conversion, setConversion] = useState(0);
  const [scores, setScores] = useState([]);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [mood, setMood] = useState("нейтральний");
  const [finished, setFinished] = useState(null);
  const endRef = useRef(null);

  const client = clientKey ? CLIENTS[clientKey] : null;
  const average = useMemo(() => scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : "—", [scores]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading, finished]);

  const callTrainer = async (payload) => {
    const response = await fetch("/.netlify/functions/ai-trainer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "AI-сервіс тимчасово недоступний");
    return data;
  };

  const start = async (key) => {
    const chosen = CLIENTS[key];
    setClientKey(key);
    setPatience(chosen.patience);
    setConversion(0);
    setScores([]);
    setStreak(0);
    setBestStreak(0);
    setMessages([]);
    setFinished(null);
    setMood("нейтральний");
    setLoading(true);
    try {
      const result = await callTrainer({ action: "start", clientKey: key });
      setMessages([{ role: "client", text: result.client_reply }]);
      setMood(result.client_mood || "нейтральний");
    } catch (error) {
      toast.error(error.message);
      setClientKey(null);
    } finally { setLoading(false); }
  };

  const reset = () => {
    setClientKey(null); setMessages([]); setInput(""); setFinished(null); setLoading(false);
  };

  const send = async () => {
    const text = input.trim();
    if (!text || loading || finished) return;
    const operatorMessage = { role: "operator", text };
    const nextMessages = [...messages, operatorMessage];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);

    try {
      const result = await callTrainer({
        action: "turn",
        clientKey,
        patience,
        conversion,
        history: nextMessages.slice(-12),
        operatorText: text,
      });

      const score = Number(result.score) || 0;
      const nextPatience = clamp(patience + (Number(result.patience_delta) || 0));
      const nextConversion = clamp(conversion + (Number(result.trust_delta) || 0));
      const nextStreak = score >= 7 ? streak + 1 : 0;
      const nextBest = Math.max(bestStreak, nextStreak);

      setScores((prev) => [...prev, score]);
      setPatience(nextPatience);
      setConversion(nextConversion);
      setStreak(nextStreak);
      setBestStreak(nextBest);
      setMood(result.client_mood || "нейтральний");
      setMessages((prev) => [
        ...prev,
        { role: "feedback", score, technique: result.technique, text: result.feedback },
        { role: "client", text: result.client_reply },
      ]);

      const turnCount = scores.length + 1;
      if (nextPatience <= 0) setFinished({ win: false, text: "Клієнт втратив терпіння та завершив розмову." });
      else if (nextConversion >= 100) setFinished({ win: true, text: "Клієнт погодився на пропозицію. Угоду закрито!" });
      else if (turnCount >= 8) setFinished({ win: nextConversion >= 60, text: nextConversion >= 60 ? "Клієнт готовий до наступного кроку." : "Ліміт реплік вичерпано, сумніви залишилися." });
    } catch (error) {
      toast.error(error.message);
    } finally { setLoading(false); }
  };

  if (!client) return <ClientPicker onPick={start} />;

  return (
    <div className="min-h-[calc(100vh-90px)] flex flex-col">
      <div className="px-4 pt-4 pb-3 border-b border-white/5 bg-[#0A0A0A]/80 sticky top-[85px] z-20 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <button onClick={reset} className="w-10 h-10 rounded-2xl border border-white/10 bg-[#1A1A1E] flex items-center justify-center text-zinc-400"><ChevronLeft size={20}/></button>
          <div className="w-11 h-11 rounded-2xl bg-[#1A1A1E] border border-white/10 flex items-center justify-center text-2xl">{client.emoji}</div>
          <div className="min-w-0 flex-1">
            <div className="font-display text-sm text-white">{client.name}, {client.age}</div>
            <div className="text-[10px] font-black uppercase tracking-wider" style={{ color: client.accent }}>{client.level} • {mood}</div>
          </div>
          <div className="rounded-2xl bg-[#FFB800]/10 border border-[#FFB800]/20 px-3 py-2 text-center">
            <div className="text-[8px] text-zinc-500 font-black uppercase">Середній</div>
            <div className="font-display text-sm text-[#FFB800]">{average}</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 mt-3">
          <Meter label="Терпіння" value={patience} color={patience < 30 ? "#FF3B30" : client.accent} icon={Zap}/>
          <Meter label="Готовність" value={conversion} color="#00F0FF" icon={Target}/>
        </div>
        <div className="flex items-center justify-between mt-2 px-1 text-[10px] font-black uppercase tracking-wider text-zinc-500">
          <span>Реплік: {scores.length}/8</span>
          <span className="flex items-center gap-1 text-[#FF5C00]"><Flame size={13}/> Стрік {streak} • рекорд {bestStreak}</span>
        </div>
      </div>

      <div className="flex-1 px-4 py-5 space-y-4">
        <AnimatePresence initial={false}>
          {messages.map((message, index) => {
            if (message.role === "feedback") {
              const color = message.score >= 7 ? "#39FF14" : message.score <= 4 ? "#FF3B30" : "#FFB800";
              return (
                <motion.div key={index} initial={{ opacity: 0, scale: .96 }} animate={{ opacity: 1, scale: 1 }} className="ml-8 rounded-2xl bg-[#151519] border p-3" style={{ borderColor: `${color}44` }}>
                  <div className="flex items-center gap-2">
                    <div className="font-display text-lg" style={{ color }}>{message.score}/10</div>
                    <div className="text-[10px] font-black uppercase tracking-wider text-white">{message.technique || "Без чіткої техніки"}</div>
                  </div>
                  <p className="text-xs text-zinc-400 mt-1.5 leading-relaxed">{message.text}</p>
                </motion.div>
              );
            }
            const operator = message.role === "operator";
            return (
              <motion.div key={index} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={`flex ${operator ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[84%] rounded-3xl px-4 py-3 text-sm leading-relaxed border ${operator ? "bg-[#FFB800] text-black border-[#FFB800] rounded-br-md font-bold" : "bg-[#1A1A1E] text-zinc-100 border-white/10 rounded-bl-md"}`}>
                  {message.text}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>

        {loading && (
          <div className="flex justify-start">
            <div className="rounded-3xl rounded-bl-md bg-[#1A1A1E] border border-white/10 px-4 py-3 flex items-center gap-2 text-xs text-zinc-500">
              <Bot size={15} className="text-[#00F0FF]"/><span className="animate-pulse">клієнт думає...</span>
            </div>
          </div>
        )}

        {finished && (
          <motion.div initial={{ opacity: 0, scale: .92 }} animate={{ opacity: 1, scale: 1 }} className={`rounded-3xl border-2 p-5 text-center ${finished.win ? "border-[#39FF14]/60 bg-[#39FF14]/10" : "border-[#FF3B30]/60 bg-[#FF3B30]/10"}`}>
            <div className="text-4xl">{finished.win ? "🏆" : "💥"}</div>
            <div className="font-display text-lg text-white mt-3">{finished.win ? "УГОДУ ЗАКРИТО" : "КЛІЄНТА ВТРАЧЕНО"}</div>
            <p className="text-xs text-zinc-400 mt-2">{finished.text}</p>
            <div className="grid grid-cols-2 gap-2 mt-4 text-xs">
              <div className="rounded-xl bg-black/30 p-3"><span className="text-zinc-500">Середній бал</span><div className="font-display text-[#FFB800] mt-1">{average}</div></div>
              <div className="rounded-xl bg-black/30 p-3"><span className="text-zinc-500">Найкращий стрік</span><div className="font-display text-[#FF5C00] mt-1">{bestStreak}</div></div>
            </div>
            <button onClick={() => start(clientKey)} className="arcade-btn mt-4 w-full bg-white text-black border-zinc-400 py-3 font-black flex items-center justify-center gap-2"><RotateCcw size={17}/> ЗІГРАТИ ЩЕ РАЗ</button>
          </motion.div>
        )}
        <div ref={endRef}/>
      </div>

      {!finished && (
        <div className="sticky bottom-20 z-20 px-4 py-3 bg-[#0A0A0A]/95 backdrop-blur-md border-t border-white/5">
          <div className="flex gap-2 items-end">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Ваша відповідь клієнту..."
              rows={1}
              disabled={loading}
              className="flex-1 min-h-12 max-h-28 resize-none rounded-2xl bg-[#1A1A1E] border border-white/10 px-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-[#FFB800]/60"
            />
            <button onClick={send} disabled={loading || !input.trim()} className="w-12 h-12 shrink-0 rounded-2xl bg-[#FFB800] text-black flex items-center justify-center disabled:opacity-30 active:scale-95 transition-transform"><Send size={19} strokeWidth={3}/></button>
          </div>
        </div>
      )}
    </div>
  );
}
