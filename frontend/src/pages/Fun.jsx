import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dice5, Sparkles, ArrowLeft, Coins, Lock, Zap } from "lucide-react";
import { toast } from "sonner";
import api, { extractError } from "@/lib/api";
import { useApp } from "@/context/AppContext";
import { fireConfetti } from "@/lib/confetti";

const TIER_COLORS = {
  small:   { color: "#39FF14", label: "Мало", emoji: "🎯" },
  medium:  { color: "#FFB800", label: "Норм", emoji: "⭐" },
  large:   { color: "#FF5C00", label: "Круто!", emoji: "🔥" },
  jackpot: { color: "#00F0FF", label: "ДЖЕКПОТ!", emoji: "💎" },
};

const CubeFace = ({ face, rolling }) => (
  <div
    className={`relative w-32 h-32 rounded-3xl bg-[#FFB800] border-b-8 border-[#7a5900] flex items-center justify-center text-[#0A0A0A] font-display text-6xl transition-transform ${rolling ? "animate-spin" : ""}`}
    style={{ animationDuration: rolling ? "0.4s" : undefined, boxShadow: "0 0 40px rgba(255,184,0,0.35)" }}
  >
    {face}
  </div>
);

const FACES = ["1", "2", "3", "4", "5", "6"];

export default function Fun() {
  const { refreshMe, mode } = useApp();
  const nav = useNavigate();
  const [status, setStatus] = useState(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [rolling, setRolling] = useState(false);
  const [face, setFace] = useState("?");
  const [lastReward, setLastReward] = useState(null);
  const [revealing, setRevealing] = useState(false);

  const load = async () => {
    if (mode === "mock") {
      setStatus({ date: "-", cube_spun: false, prediction_revealed: false });
      setLoadingStatus(false);
      return;
    }
    setLoadingStatus(true);
    try {
      const r = await api.get("/games/status");
      setStatus(r.data);
      if (r.data.cube_spun) {
        setLastReward({ reward: r.data.cube_reward, tier: r.data.cube_tier });
      }
    } catch (e) { toast.error(extractError(e)); }
    setLoadingStatus(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [mode]);

  const spin = async () => {
    if (mode === "mock") { toast.error("Гра доступна тільки з бекендом"); return; }
    if (status?.cube_spun || rolling) return;
    setRolling(true);
    setFace("?");
    // Rolling animation — cycle faces for ~1.4s
    let ticks = 0;
    const int = setInterval(() => {
      setFace(FACES[Math.floor(Math.random() * FACES.length)]);
      ticks++;
    }, 90);
    try {
      const r = await api.post("/games/cube/spin");
      setTimeout(() => {
        clearInterval(int);
        setRolling(false);
        setFace(FACES[Math.floor(Math.random() * FACES.length)]);
        setLastReward({ reward: r.data.reward, tier: r.data.tier });
        setStatus((s) => ({ ...s, cube_spun: true, cube_reward: r.data.reward, cube_tier: r.data.tier }));
        fireConfetti();
        toast.success(`+${r.data.reward} балів!`, { description: TIER_COLORS[r.data.tier].label, duration: 3000 });
        refreshMe();
      }, 1400);
    } catch (e) {
      clearInterval(int);
      setRolling(false);
      toast.error(extractError(e));
    }
  };

  const reveal = async () => {
    if (mode === "mock") { toast.error("Передбачення доступне тільки з бекендом"); return; }
    if (status?.prediction_revealed || revealing) return;
    setRevealing(true);
    try {
      const r = await api.post("/games/prediction/reveal");
      setStatus((s) => ({ ...s, prediction_revealed: true, prediction_text: r.data.text }));
      fireConfetti();
    } catch (e) { toast.error(extractError(e)); }
    setRevealing(false);
  };

  return (
    <div className="px-5 pt-2 pb-8 space-y-5" data-testid="fun-page">
      <div className="flex items-center gap-3">
        <button onClick={() => nav(-1)} className="w-10 h-10 rounded-2xl bg-[#1A1A1E] border border-white/10 flex items-center justify-center text-zinc-400 active:scale-95">
          <ArrowLeft size={18} strokeWidth={2.5} />
        </button>
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.25em] text-zinc-500">Розваги</div>
          <h1 className="font-display text-2xl text-white leading-none mt-1">Куб і Передбачення</h1>
        </div>
      </div>

      {mode === "mock" && (
        <div className="bg-[#FF5C00]/10 border border-[#FF5C00]/40 rounded-2xl p-4 text-[#FF5C00] font-black text-sm">
          Гра доступна тільки з реальним бекендом.
        </div>
      )}

      {/* Prediction card */}
      <section
        data-testid="prediction-card"
        className="relative bg-gradient-to-br from-[#FFB800]/15 via-[#1A1A1E] to-[#FF5C00]/10 border-2 border-[#FFB800]/30 rounded-3xl p-5 min-h-[180px]"
      >
        <div className="flex items-center gap-2 mb-3">
          <Sparkles size={16} strokeWidth={3} color="#FFB800" />
          <div className="text-[11px] font-black uppercase tracking-widest text-[#FFB800]">Передбачення дня</div>
        </div>

        {status?.prediction_revealed ? (
          <div data-testid="prediction-text" className="reward-pop">
            <div className="text-white font-display text-lg leading-tight">"{status.prediction_text}"</div>
            <div className="text-zinc-500 text-xs mt-3 font-black">Заходь завтра за новим передбаченням</div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-4">
            <div className="text-zinc-400 text-sm text-center mb-4">Розкрий свою картку на сьогодні</div>
            <button
              data-testid="reveal-prediction"
              onClick={reveal}
              disabled={revealing || loadingStatus}
              className="arcade-btn h-12 px-6 bg-[#FFB800] border-[#7a5900] text-[#0A0A0A] font-black text-sm uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-60"
            >
              <Sparkles size={16} strokeWidth={3} />
              {revealing ? "..." : "Розкрити"}
            </button>
          </div>
        )}
      </section>

      {/* Cube game */}
      <section
        data-testid="cube-card"
        className="bg-[#1A1A1E] border-2 border-white/10 rounded-3xl p-5 flex flex-col items-center"
      >
        <div className="flex items-center gap-2 mb-4 self-start">
          <Dice5 size={16} strokeWidth={3} color="#39FF14" />
          <div className="text-[11px] font-black uppercase tracking-widest text-[#39FF14]">Щедрий Куб</div>
        </div>

        <div className={rolling ? "" : "float-y"}>
          <CubeFace face={face} rolling={rolling} />
        </div>

        <div className="mt-6 text-center w-full">
          {status?.cube_spun && lastReward ? (
            <div className="space-y-2" data-testid="cube-result">
              <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Твій виграш сьогодні</div>
              <div className="flex items-center justify-center gap-2">
                <span className="text-3xl">{TIER_COLORS[lastReward.tier].emoji}</span>
                <span className="font-display text-3xl" style={{ color: TIER_COLORS[lastReward.tier].color }}>
                  +{lastReward.reward}
                </span>
              </div>
              <div className="text-[11px] font-black uppercase tracking-widest" style={{ color: TIER_COLORS[lastReward.tier].color }}>
                {TIER_COLORS[lastReward.tier].label}
              </div>
              <div className="mt-4 w-full h-11 rounded-xl bg-[#0A0A0A] border-2 border-white/5 flex items-center justify-center gap-2 text-zinc-500">
                <Lock size={14} strokeWidth={3} />
                <span className="text-xs font-black uppercase tracking-wider">Заходь завтра</span>
              </div>
            </div>
          ) : (
            <>
              <div className="text-zinc-400 text-sm mb-4">Кинь куб і отримай від 10 до 350 балів!</div>
              <button
                data-testid="spin-cube"
                onClick={spin}
                disabled={rolling || loadingStatus}
                className="arcade-btn w-full h-14 bg-[#39FF14] border-[#1a7a0a] text-[#0A0A0A] font-black text-base uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-60"
              >
                <Zap size={18} strokeWidth={3} />
                {rolling ? "Кубик крутиться..." : "КИНУТИ КУБ"}
              </button>
              <div className="grid grid-cols-4 gap-1.5 mt-4 text-[10px] font-black">
                <div className="rounded-lg py-1.5 bg-[#39FF14]/15 text-[#39FF14]">10-30<br/>55%</div>
                <div className="rounded-lg py-1.5 bg-[#FFB800]/15 text-[#FFB800]">40-80<br/>30%</div>
                <div className="rounded-lg py-1.5 bg-[#FF5C00]/15 text-[#FF5C00]">90-150<br/>12%</div>
                <div className="rounded-lg py-1.5 bg-[#00F0FF]/15 text-[#00F0FF]">200+<br/>3%</div>
              </div>
            </>
          )}
        </div>
      </section>

      <div className="text-[11px] text-zinc-500 text-center font-black">
        <Coins size={12} strokeWidth={3} className="inline -mt-0.5 mr-1" />
        Обидві гри — безкоштовно, раз на добу. Оновлення о 00:00.
      </div>
    </div>
  );
}
