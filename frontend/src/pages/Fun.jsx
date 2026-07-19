import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dice5, Sparkles, ArrowLeft, Coins, Zap } from "lucide-react";
import { toast } from "sonner";
import api, { extractError } from "@/lib/api";
import { useApp } from "@/context/AppContext";
import { fireConfetti } from "@/lib/confetti";

const TIER_COLORS = {
  one:   { color: "#9CA3AF", label: "Грань 1" },
  two:   { color: "#39FF14", label: "Грань 2" },
  three: { color: "#00F0FF", label: "Грань 3" },
  four:  { color: "#FFB800", label: "Грань 4" },
  five:  { color: "#B575FF", label: "Грань 5" },
  six:   { color: "#FF5C00", label: "Грань 6" },
};

const CubeFace = ({ face, rolling }) => (
  <div
    className={`relative w-32 h-32 rounded-3xl bg-[#FFB800] border-b-8 border-[#7a5900] flex items-center justify-center text-[#0A0A0A] font-display text-6xl transition-transform ${rolling ? "animate-spin" : ""}`}
    style={{ animationDuration: rolling ? "0.4s" : undefined, boxShadow: "0 0 40px rgba(255,184,0,0.35)" }}
  >
    {face}
  </div>
);

const FACES = ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
const faceGlyph = (face) => FACES[Math.max(0, Math.min(5, Number(face || 1) - 1))];

export default function Fun() {
  const { refreshMe, mode, user } = useApp();
  const nav = useNavigate();
  const [status, setStatus] = useState(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [rolling, setRolling] = useState(false);
  const [face, setFace] = useState("?");
  const [lastReward, setLastReward] = useState(null);
  const [revealing, setRevealing] = useState(false);

  const load = async () => {
    if (mode === "mock") {
      setStatus({ date: "-", cube_spun: false, cube_spin_count: 0, next_spin_cost: 0, prediction_revealed: false });
      setLoadingStatus(false);
      return;
    }
    setLoadingStatus(true);
    try {
      const r = await api.get("/games/status");
      setStatus(r.data);
      if (r.data.cube_spun) {
        setLastReward({ reward: r.data.cube_reward, tier: r.data.cube_tier, face: r.data.cube_face });
        if (r.data.cube_face) setFace(faceGlyph(r.data.cube_face));
      }
    } catch (e) { toast.error(extractError(e)); }
    setLoadingStatus(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [mode]);

  const spin = async () => {
    if (mode === "mock") { toast.error("Гра доступна тільки з бекендом"); return; }
    if (rolling) return;
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
        setFace(faceGlyph(r.data.face));
        setLastReward({ reward: r.data.reward, tier: r.data.tier, face: r.data.face, cost: r.data.cost });
        setStatus((s) => ({
          ...s,
          cube_spun: true,
          cube_spin_count: r.data.spin_count,
          cube_reward: r.data.reward,
          cube_face: r.data.face,
          cube_tier: r.data.tier,
          next_spin_cost: r.data.next_spin_cost,
        }));
        fireConfetti();
        toast.success(`+${r.data.reward} Point`, { description: r.data.cost ? `Вартість кидка: ${r.data.cost} Point` : "Перший кидок безкоштовний", duration: 3500 });
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
          {lastReward && (
            <div className="mb-5 space-y-2 reward-pop" data-testid="cube-result">
              <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Останній результат</div>
              <div className="flex items-center justify-center gap-3">
                <span className="text-4xl">{faceGlyph(lastReward.face)}</span>
                <span className="font-display text-3xl" style={{ color: TIER_COLORS[lastReward.tier]?.color || "#FFB800" }}>
                  +{lastReward.reward}
                </span>
              </div>
              <div className="text-[11px] font-black uppercase tracking-widest" style={{ color: TIER_COLORS[lastReward.tier]?.color || "#FFB800" }}>
                {TIER_COLORS[lastReward.tier]?.label || `Грань ${lastReward.face}`}
              </div>
              {Number(lastReward.cost || 0) > 0 && (
                <div className="text-[11px] font-black text-zinc-500">Вартість спроби: −{lastReward.cost} Point</div>
              )}
            </div>
          )}

          <div className="text-zinc-400 text-sm mb-4">
            {Number(status?.cube_spin_count || 0) === 0
              ? "Перша спроба сьогодні безкоштовна"
              : "Наступна спроба коштує 50 Point"}
          </div>
          <button
            data-testid="spin-cube"
            onClick={spin}
            disabled={rolling || loadingStatus || (Number(status?.cube_spin_count || 0) > 0 && Number(user?.balance || 0) < 50)}
            className="arcade-btn w-full h-14 bg-[#39FF14] border-[#1a7a0a] text-[#0A0A0A] font-black text-base uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-60"
          >
            <Zap size={18} strokeWidth={3} />
            {rolling
              ? "Кубик крутиться..."
              : Number(status?.cube_spin_count || 0) === 0
                ? "КИНУТИ БЕЗКОШТОВНО"
                : "КИНУТИ ЗА 50 POINT"}
          </button>
          {Number(status?.cube_spin_count || 0) > 0 && Number(user?.balance || 0) < 50 && (
            <div className="mt-3 text-xs font-black text-[#FF5C00]">Недостатньо Point для наступної спроби</div>
          )}
          <div className="mt-3 text-[11px] font-black text-zinc-500">
            Спроб сьогодні: {Number(status?.cube_spin_count || 0)}
          </div>
        </div>
      </section>

      <div className="text-[11px] text-zinc-500 text-center font-black">
        <Coins size={12} strokeWidth={3} className="inline -mt-0.5 mr-1" />
        Передбачення безкоштовне раз на добу. Перший кидок куба безкоштовний, наступні — по 50 Point.
      </div>
    </div>
  );
}
