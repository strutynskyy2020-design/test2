import { useEffect, useMemo, useState } from "react";
import { PhoneCall, Star, Clock, GraduationCap, Target, CheckCircle2, Timer, Zap, Check } from "lucide-react";
import { toast } from "sonner";
import { useApp } from "@/context/AppContext";
import { fireConfetti } from "@/lib/confetti";

const ICONS = {
  "phone-call": PhoneCall,
  star: Star,
  clock: Clock,
  "graduation-cap": GraduationCap,
  target: Target,
  "check-circle-2": CheckCircle2,
};

const DIFF = {
  easy:   { label: "Легко",   color: "#39FF14" },
  medium: { label: "Середнє", color: "#FFB800" },
  hard:   { label: "Складно", color: "#FF5C00" },
};

const useCountdown = () => {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const next = new Date();
  next.setHours(24, 0, 0, 0);
  const diff = Math.max(0, next.getTime() - now);
  const h = String(Math.floor(diff / 3600000)).padStart(2, "0");
  const m = String(Math.floor((diff % 3600000) / 60000)).padStart(2, "0");
  const s = String(Math.floor((diff % 60000) / 1000)).padStart(2, "0");
  return `${h}:${m}:${s}`;
};

const QuestCard = ({ quest, onClaim, claiming }) => {
  const Icon = ICONS[quest.icon] || Target;
  const diff = DIFF[quest.difficulty] || DIFF.easy;
  const pct = Math.min(100, Math.round((quest.progress / quest.goal) * 100));
  const ready = quest.progress >= quest.goal && !quest.claimed;
  const done = quest.claimed;

  return (
    <div
      data-testid={`quest-${quest.id}`}
      className={`bg-[#1A1A1E] border-2 rounded-3xl p-4 transition-all ${
        done ? "border-white/5 opacity-60" : ready ? "border-[#39FF14]/60 glow-green" : "border-white/10"
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0"
          style={{ backgroundColor: diff.color + "22", border: `2px solid ${diff.color}` }}
        >
          <Icon size={22} strokeWidth={2.75} color={diff.color} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span
              className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full text-[#0A0A0A]"
              style={{ backgroundColor: diff.color }}
            >
              {diff.label}
            </span>
            <span className="text-[#39FF14] font-black text-sm">+{quest.reward}</span>
          </div>
          <div className="text-white font-black text-sm leading-tight">{quest.title}</div>
          <div className="text-zinc-500 text-xs mt-0.5">{quest.description}</div>
        </div>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between mb-1.5">
          <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Прогрес</div>
          <div className="text-[11px] font-black text-white">{quest.progress} / {quest.goal}</div>
        </div>
        <div className="h-3 rounded-full bg-[#0A0A0A] border border-white/5 overflow-hidden">
          <div
            className={`h-full rounded-full transition-[width] duration-500 ${ready && !done ? "xp-stripes" : ""}`}
            style={{
              width: `${pct}%`,
              background: done ? "#3f3f46" : ready ? "linear-gradient(90deg, #39FF14, #00F0FF)" : `linear-gradient(90deg, ${diff.color}, #FFB800)`,
            }}
          />
        </div>
      </div>

      <div className="mt-4">
        {done ? (
          <div className="w-full h-11 rounded-xl bg-[#0A0A0A] border-2 border-white/5 flex items-center justify-center gap-2 text-zinc-500">
            <Check size={16} strokeWidth={3} />
            <span className="text-xs font-black uppercase tracking-wider">Отримано</span>
          </div>
        ) : ready ? (
          <button
            data-testid={`claim-${quest.id}`}
            disabled={claiming}
            onClick={() => onClaim(quest)}
            className="arcade-btn w-full h-12 bg-[#39FF14] border-[#1a7a0a] text-[#0A0A0A] font-black text-sm uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-60"
          >
            <Zap size={16} strokeWidth={3} />
            {claiming ? "..." : `Забрати +${quest.reward}`}
          </button>
        ) : (
          <div className="text-[11px] text-zinc-500 font-black text-center">
            Виконай {quest.goal - quest.progress} з {quest.goal}, щоб отримати нагороду
          </div>
        )}
      </div>
    </div>
  );
};

export default function Quests() {
  const { quests, claimQuest } = useApp();
  const countdown = useCountdown();
  const [busyId, setBusyId] = useState(null);

  const stats = useMemo(() => {
    const total = quests.length;
    const claimed = quests.filter((q) => q.claimed).length;
    const ready = quests.filter((q) => !q.claimed && q.progress >= q.goal).length;
    return { total, claimed, ready };
  }, [quests]);

  const handleClaim = async (quest) => {
    setBusyId(quest.id);
    const res = await claimQuest(quest.id);
    setBusyId(null);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    fireConfetti();
    toast.success(`+${quest.reward} балів!`, { description: `Квест "${quest.title}" виконано`, duration: 2500 });
  };

  const sorted = [...quests].sort((a, b) => {
    const aReady = !a.claimed && a.progress >= a.goal;
    const bReady = !b.claimed && b.progress >= b.goal;
    if (aReady !== bReady) return aReady ? -1 : 1;
    if (a.claimed !== b.claimed) return a.claimed ? 1 : -1;
    return 0;
  });

  return (
    <div className="px-5 pt-2 pb-8 space-y-5">
      <div>
        <div className="text-[10px] font-black uppercase tracking-[0.25em] text-zinc-500">Сьогодні</div>
        <h1 className="font-display text-3xl text-white mt-1">Квести дня</h1>
      </div>

      <div className="bg-[#1A1A1E] border border-white/10 rounded-3xl p-4 flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl bg-[#FFB800]/15 border-2 border-[#FFB800]/50 flex items-center justify-center">
          <Timer size={20} strokeWidth={3} color="#FFB800" />
        </div>
        <div className="flex-1">
          <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Оновлення квестів</div>
          <div className="font-display text-2xl text-white leading-none mt-1 tabular-nums" data-testid="countdown">{countdown}</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Виконано</div>
          <div className="font-black text-white text-lg" data-testid="quests-done">{stats.claimed}/{stats.total}</div>
        </div>
      </div>

      {stats.ready > 0 && (
        <div data-testid="ready-banner" className="bg-[#39FF14]/10 border-2 border-[#39FF14]/40 rounded-3xl p-4 flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-[#39FF14] flex items-center justify-center">
            <Zap size={20} strokeWidth={3} color="#0A0A0A" />
          </div>
          <div className="flex-1">
            <div className="text-white font-black text-sm">
              {stats.ready} {stats.ready === 1 ? "нагорода готова" : "нагороди готові"}
            </div>
            <div className="text-zinc-400 text-xs">Забирай бали прямо зараз</div>
          </div>
        </div>
      )}

      <div className="space-y-3" data-testid="quest-list">
        {sorted.length === 0 && (
          <div className="text-center text-zinc-500 py-8 text-sm font-black">
            Немає активних квестів. Загляни пізніше!
          </div>
        )}
        {sorted.map((q) => (
          <QuestCard key={q.id} quest={q} onClaim={handleClaim} claiming={busyId === q.id} />
        ))}
      </div>
    </div>
  );
}
