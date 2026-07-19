import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dice5, Sparkles, ArrowLeft, Coins, Zap, Gift, Info, WalletCards } from "lucide-react";
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

const FACE_DOTS = {
  1: [5],
  2: [1, 9],
  3: [1, 5, 9],
  4: [1, 3, 7, 9],
  5: [1, 3, 5, 7, 9],
  6: [1, 3, 4, 6, 7, 9],
};

const CUBE_VISUAL_VERSION = "v43-real-3d";

const FACE_ROTATIONS = {
  // A small permanent tilt keeps the die visibly three-dimensional after it lands.
  1: { x: -16, y: 24 },
  2: { x: -106, y: 24 },
  3: { x: -16, y: -66 },
  4: { x: -16, y: 114 },
  5: { x: 74, y: 24 },
  6: { x: -16, y: 204 },
};

const CubeSide = ({ value, side }) => (
  <div className={`generous-cube-side generous-cube-side--${side}`}>
    <div className="generous-cube-grid">
      {Array.from({ length: 9 }, (_, index) => (
        <span key={index} className={FACE_DOTS[value].includes(index + 1) ? "generous-cube-dot" : ""} />
      ))}
    </div>
  </div>
);

const CubeFace = ({ face, rolling, rollId }) => {
  const numericFace = Number(face) || 1;
  const rotation = FACE_ROTATIONS[numericFace] || FACE_ROTATIONS[1];
  const cubeRef = useRef(null);
  const flightRef = useRef(null);

  useEffect(() => {
    const cube = cubeRef.current;
    const flight = flightRef.current;
    if (!cube || !flight) return undefined;

    const finalTransform = `rotateX(${rotation.x}deg) rotateY(${rotation.y}deg) rotateZ(0deg)`;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

    if (!rolling || reducedMotion) {
      cube.getAnimations().forEach((animation) => animation.cancel());
      flight.getAnimations().forEach((animation) => animation.cancel());
      cube.style.transform = finalTransform;
      flight.style.transform = "translate3d(0,-18px,0) scale(1)";
      return undefined;
    }

    const spin = cube.animate(
      [
        { transform: cube.style.transform || finalTransform, offset: 0 },
        { transform: `rotateX(${rotation.x + 310}deg) rotateY(${rotation.y + 450}deg) rotateZ(120deg)`, offset: 0.25 },
        { transform: `rotateX(${rotation.x + 760}deg) rotateY(${rotation.y + 930}deg) rotateZ(255deg)`, offset: 0.58 },
        { transform: `rotateX(${rotation.x + 1180}deg) rotateY(${rotation.y + 1410}deg) rotateZ(330deg)`, offset: 0.82 },
        { transform: `rotateX(${rotation.x + 1440}deg) rotateY(${rotation.y + 1800}deg) rotateZ(360deg)`, offset: 1 },
      ],
      { duration: 1500, easing: "cubic-bezier(.18,.72,.18,1)", fill: "forwards" }
    );

    const flightAnimation = flight.animate(
      [
        { transform: "translate3d(0,-18px,0) scale(1)", offset: 0 },
        { transform: "translate3d(0,-72px,28px) scale(1.08)", offset: 0.28 },
        { transform: "translate3d(0,-30px,10px) scale(.98)", offset: 0.68 },
        { transform: "translate3d(0,-10px,0) scale(1.035)", offset: 0.88 },
        { transform: "translate3d(0,-18px,0) scale(1)", offset: 1 },
      ],
      { duration: 1500, easing: "cubic-bezier(.2,.7,.2,1)", fill: "forwards" }
    );

    spin.onfinish = () => {
      spin.cancel();
      cube.style.transform = finalTransform;
    };
    flightAnimation.onfinish = () => {
      flightAnimation.cancel();
      flight.style.transform = "translate3d(0,-18px,0) scale(1)";
    };

    return () => {
      spin.cancel();
      flightAnimation.cancel();
    };
  }, [numericFace, rolling, rollId, rotation.x, rotation.y]);

  return (
    <div className={`generous-cube-stage ${rolling ? "is-rolling" : ""}`} aria-label={`Грань куба ${numericFace}`} data-cube-version={CUBE_VISUAL_VERSION}>
      <div className="generous-cube-energy generous-cube-energy--outer" />
      <div className="generous-cube-energy generous-cube-energy--inner" />
      <div className="generous-cube-aura" />
      <div ref={flightRef} className="generous-cube-flight">
        <div ref={cubeRef} className="generous-cube" style={{ transform: `rotateX(${rotation.x}deg) rotateY(${rotation.y}deg) rotateZ(0deg)` }}>
          <CubeSide value={1} side="front" />
          <CubeSide value={6} side="back" />
          <CubeSide value={3} side="right" />
          <CubeSide value={4} side="left" />
          <CubeSide value={2} side="top" />
          <CubeSide value={5} side="bottom" />
        </div>
      </div>
      <div className="generous-cube-shadow" />
      <div className="generous-cube-platform">
        <span />
        <i />
      </div>
    </div>
  );
};

const FACES = ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
const faceGlyph = (face) => FACES[Math.max(0, Math.min(5, Number(face || 1) - 1))];

export default function Fun() {
  const { refreshMe, mode, user } = useApp();
  const nav = useNavigate();
  const [status, setStatus] = useState(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [rolling, setRolling] = useState(false);
  const [lastReward, setLastReward] = useState(null);
  const [pendingFace, setPendingFace] = useState(null);
  const [rollId, setRollId] = useState(0);
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
      }
    } catch (e) { toast.error(extractError(e)); }
    setLoadingStatus(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [mode]);

  const spin = async () => {
    if (mode === "mock") { toast.error("Гра доступна тільки з бекендом"); return; }
    if (rolling) return;
    setRolling(true);
    try {
      const r = await api.post("/games/cube/spin");
      setPendingFace(r.data.face);
      setRollId((value) => value + 1);
      setTimeout(() => {
        setRolling(false);
        setPendingFace(null);
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
      }, 1500);
    } catch (e) {
      setRolling(false);
      setPendingFace(null);
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
        className="generous-cube-card"
      >
        <div className="generous-cube-header">
          <div className="flex items-center gap-2">
            <span className="generous-cube-header-icon"><Dice5 size={18} strokeWidth={3} /></span>
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.22em] text-[#39FF14]">Щедрий куб</div>
              <div className="mt-0.5 text-xs font-bold text-zinc-500">Кидай і забирай до 350 Point</div>
            </div>
          </div>
          <details className="generous-cube-info">
            <summary><Info size={14} /> Як працює?</summary>
            <div className="generous-cube-prizes">
              {[
                [1, "0–30"], [2, "31–55"], [3, "56–70"],
                [4, "71–90"], [5, "91–125"], [6, "126–350"],
              ].map(([value, range]) => (
                <div key={value}><span>{faceGlyph(value)}</span><b>{value}</b><em>{range} Point</em></div>
              ))}
              <p>Ймовірності граней приховані. Кожен виграш визначається випадково в межах діапазону.</p>
            </div>
          </details>
        </div>

        <div className="generous-cube-meta-grid">
          <div className="generous-cube-meta">
            <Gift size={18} />
            <span>
              <small>Перший кидок</small>
              <strong>{Number(status?.cube_spin_count || 0) === 0 ? "Безкоштовний" : "Використано"}</strong>
            </span>
          </div>
          <div className="generous-cube-meta generous-cube-meta--balance">
            <WalletCards size={18} />
            <span>
              <small>Ваш баланс</small>
              <strong>{Number(user?.balance || 0).toLocaleString("uk-UA")} Point</strong>
            </span>
          </div>
        </div>

        <CubeFace
          face={Number(pendingFace || lastReward?.face || status?.cube_face || 1)}
          rolling={rolling && pendingFace !== null}
          rollId={rollId}
        />

        <div className="generous-cube-result" aria-live="polite">
          {lastReward ? (
            <div className="reward-pop" data-testid="cube-result">
              <div className="generous-cube-result-label">Останній результат</div>
              <div className="generous-cube-result-main">
                <span className="generous-cube-result-face">{faceGlyph(lastReward.face)}</span>
                <div>
                  <small>{TIER_COLORS[lastReward.tier]?.label || `Грань ${lastReward.face}`}</small>
                  <strong style={{ color: TIER_COLORS[lastReward.tier]?.color || "#B575FF" }}>+{lastReward.reward}</strong>
                  <em>Point</em>
                </div>
              </div>
              {Number(lastReward.cost || 0) > 0 && (
                <div className="generous-cube-cost-note">Вартість кидка: −{lastReward.cost} Point</div>
              )}
            </div>
          ) : (
            <div className="generous-cube-empty-result">
              <Sparkles size={18} />
              <span>Зроби кидок, щоб побачити свій виграш</span>
            </div>
          )}
        </div>

        <button
          data-testid="spin-cube"
          onClick={spin}
          disabled={rolling || loadingStatus || (Number(status?.cube_spin_count || 0) > 0 && Number(user?.balance || 0) < 50)}
          className="generous-cube-button"
        >
          <Zap size={20} strokeWidth={3} />
          {rolling
            ? "КУБ НАБИРАЄ ЕНЕРГІЮ..."
            : Number(status?.cube_spin_count || 0) === 0
              ? "КИНУТИ БЕЗКОШТОВНО"
              : "КИНУТИ ЗА 50 POINT"}
        </button>

        {Number(status?.cube_spin_count || 0) > 0 && Number(user?.balance || 0) < 50 && (
          <div className="mt-3 text-center text-xs font-black text-[#FF5C00]">Недостатньо Point для наступної спроби</div>
        )}
        <div className="generous-cube-attempts">Спроб сьогодні: <b>{Number(status?.cube_spin_count || 0)}</b></div>
      </section>

      <div className="text-[11px] text-zinc-500 text-center font-black">
        <Coins size={12} strokeWidth={3} className="inline -mt-0.5 mr-1" />
        Передбачення безкоштовне раз на добу. Перший кидок куба безкоштовний, наступні — по 50 Point.
      </div>
    </div>
  );
}
