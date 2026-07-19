import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, CheckCircle2, Coins, RefreshCw, Sparkles, Swords, Trophy, XCircle, Zap } from "lucide-react";
import { toast } from "sonner";
import api, { extractError } from "@/lib/api";

const DIFFICULTY = {
  easy: { label: "Легке", color: "#39FF14", glow: "rgba(57,255,20,0.18)" },
  medium: { label: "Середнє", color: "#FFB800", glow: "rgba(255,184,0,0.18)" },
  hard: { label: "Важке", color: "#FF5C00", glow: "rgba(255,92,0,0.18)" },
};

const useCountdown = (refreshAt, onExpired) => {
  const [value, setValue] = useState("--:--:--");
  useEffect(() => {
    if (!refreshAt) return undefined;
    let expired = false;
    const tick = () => {
      const diff = new Date(refreshAt).getTime() - Date.now();
      if (diff <= 0) {
        setValue("00:00:00");
        if (!expired) {
          expired = true;
          onExpired?.();
        }
        return;
      }
      const h = String(Math.floor(diff / 3600000)).padStart(2, "0");
      const m = String(Math.floor((diff % 3600000) / 60000)).padStart(2, "0");
      const s = String(Math.floor((diff % 60000) / 1000)).padStart(2, "0");
      setValue(`${h}:${m}:${s}`);
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [refreshAt, onExpired]);
  return value;
};

const TaskCard = ({ task, canReplace, replacing, onReplace }) => {
  const difficulty = DIFFICULTY[task.difficulty] || DIFFICULTY.easy;
  return (
    <article
      data-testid={`daily-task-${task.id}`}
      className="relative overflow-hidden rounded-3xl border-2 bg-[#1A1A1E] p-5"
      style={{ borderColor: `${difficulty.color}55`, boxShadow: `0 16px 40px ${difficulty.glow}` }}
    >
      <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full blur-2xl" style={{ background: difficulty.glow }} />
      <div className="relative">
        <div className="flex items-start justify-between gap-3">
          <div>
            <span
              className="inline-flex rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-[#0A0A0A]"
              style={{ background: difficulty.color }}
            >
              {difficulty.label}
            </span>
            <h2 className="mt-3 text-lg font-black leading-tight text-white">«{task.title}»</h2>
          </div>
          <div className="flex shrink-0 flex-col gap-1.5">
            <div className="flex items-center gap-1 rounded-2xl border border-[#FFB800]/30 bg-[#FFB800]/10 px-3 py-2 text-[#FFB800]">
              <Coins size={15} strokeWidth={3} />
              <span className="font-black">{task.reward}</span>
            </div>
            <div className="flex items-center justify-center gap-1 rounded-xl border border-[#B78CFF]/30 bg-[#B78CFF]/10 px-2 py-1 text-[10px] font-black text-[#B78CFF]">
              <Zap size={12} strokeWidth={3} /> +{task.xp} XP
            </div>
          </div>
        </div>

        <p className="mt-3 text-sm font-semibold leading-relaxed text-zinc-300">{task.text}</p>

        {task.status === "approved" && (
          <div className="mt-4 flex items-center justify-between rounded-2xl border border-[#39FF14]/30 bg-[#39FF14]/10 px-4 py-3">
            <span className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-wider text-[#39FF14]"><CheckCircle2 size={16} strokeWidth={3} /> Нараховано</span>
            <span className="text-right"><span className="block font-display text-[#39FF14]">+{task.reward}</span><span className="block text-[10px] font-black text-[#B78CFF]">+{task.xp} XP</span></span>
          </div>
        )}
        {task.status === "rejected" && (
          <div className="mt-4 flex items-center gap-2 rounded-2xl border border-[#FF3B30]/30 bg-[#FF3B30]/10 px-4 py-3 text-xs font-black uppercase tracking-wider text-[#FF3B30]">
            <XCircle size={16} strokeWidth={3} /> Відхилено
          </div>
        )}
        {canReplace && task.status === "pending" && (
          <button
            type="button"
            onClick={() => onReplace(task.id)}
            disabled={replacing}
            className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-2xl border border-white/10 bg-[#0A0A0A] px-4 text-xs font-black uppercase tracking-wider text-zinc-300 transition active:scale-95 disabled:opacity-50"
          >
            <RefreshCw size={15} strokeWidth={3} className={replacing ? "animate-spin" : ""} />
            {replacing ? "Замінюю…" : "Замінити завдання"}
          </button>
        )}
      </div>
    </article>
  );
};

const BattleCard = ({ battle }) => {
  if (!battle || battle.status === "waiting") {
    return (
      <section className="rounded-3xl border border-[#B78CFF]/30 bg-[#B78CFF]/10 p-5">
        <div className="flex items-center gap-3">
          <Swords size={22} strokeWidth={3} color="#B78CFF" />
          <div>
            <div className="text-sm font-black text-white">Щоденний батл</div>
            <div className="mt-1 text-xs text-zinc-400">Суперник ще підбирається.</div>
          </div>
        </div>
      </section>
    );
  }

  const leadText = battle.is_tied
    ? "Зараз нічия"
    : battle.is_leading
    ? "Ти попереду"
    : "Суперник попереду";

  return (
    <section className="overflow-hidden rounded-3xl border-2 border-[#B78CFF]/40 bg-[#1A1A1E] p-5 shadow-[0_16px_40px_rgba(183,140,255,0.12)]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#B78CFF]/15 text-[#B78CFF]">
            <Swords size={24} strokeWidth={3} />
          </div>
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-[#B78CFF]">Батл дня</div>
            <div className="mt-1 text-lg font-black text-white">Ти проти {battle.opponent?.name || "суперника"}</div>
          </div>
        </div>
        <div className="rounded-2xl border border-[#FFB800]/30 bg-[#FFB800]/10 px-3 py-2 text-right">
          <div className="text-[9px] font-black uppercase tracking-wider text-zinc-500">Приз</div>
          <div className="flex items-center gap-1 font-black text-[#FFB800]"><Trophy size={14} /> +{battle.reward || 50}</div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div className="rounded-2xl bg-black/25 p-3 text-center">
          <div className="text-[10px] font-black uppercase tracking-wider text-zinc-500">Ти</div>
          <div className="mt-1 font-display text-3xl text-[#00F0FF]">{battle.my_score || 0}</div>
        </div>
        <div className="font-display text-zinc-600">VS</div>
        <div className="rounded-2xl bg-black/25 p-3 text-center">
          <div className="truncate text-[10px] font-black uppercase tracking-wider text-zinc-500">{battle.opponent?.name || "Суперник"}</div>
          <div className="mt-1 font-display text-3xl text-[#FF5C00]">{battle.opponent_score || 0}</div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 text-xs">
        <span className={`font-black ${battle.is_tied ? "text-zinc-400" : battle.is_leading ? "text-[#39FF14]" : "text-[#FF5C00]"}`}>{leadText}</span>
        <span className="text-right font-semibold text-zinc-500">Перемога: +50 Point. Нічия: обом по +{battle.tie_reward || 25} Point.</span>
      </div>
    </section>
  );
};

export default function Tasks() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [replacingId, setReplacingId] = useState(null);
  const [battle, setBattle] = useState(null);

  const load = useCallback(async () => {
    try {
      const [tasksResponse, battleResponse] = await Promise.all([
        api.get("/daily-tasks"),
        api.get("/daily-battle"),
      ]);
      setData(tasksResponse.data);
      setBattle(battleResponse.data);
    } catch (error) {
      toast.error(extractError(error, "Не вдалося завантажити завдання"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 60000);
    const refreshOnFocus = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", refreshOnFocus);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshOnFocus);
    };
  }, [load]);

  const countdown = useCountdown(data?.refresh_at, load);
  const sortedTasks = useMemo(() => {
    const order = { easy: 0, medium: 1, hard: 2 };
    return [...(data?.tasks || [])].sort((a, b) => order[a.difficulty] - order[b.difficulty]);
  }, [data]);

  const replaceTask = async (taskId) => {
    setReplacingId(taskId);
    try {
      const response = await api.post(`/daily-tasks/${taskId}/replace`);
      setData(response.data);
      await load();
      toast.success("Завдання замінено", { description: response.data.replacements_remaining > 0 ? `Ще доступно замін: ${response.data.replacements_remaining}` : "Ліміт замін на сьогодні вичерпано" });
    } catch (error) {
      toast.error(extractError(error, "Не вдалося замінити завдання"));
    } finally {
      setReplacingId(null);
    }
  };

  return (
    <div className="space-y-5 px-5 pb-8 pt-2">
      <header>
        <div className="text-[10px] font-black uppercase tracking-[0.25em] text-zinc-500">TM6 Bonus</div>
        <h1 className="mt-1 font-display text-3xl text-white">Завдання дня</h1>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
          Щодня о 00:00 за київським часом з’являються три нові завдання: легке, середнє та важке.
        </p>
      </header>

      <section className="flex items-center gap-3 rounded-3xl border border-white/10 bg-[#1A1A1E] p-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border-2 border-[#00F0FF]/40 bg-[#00F0FF]/10">
          <CalendarClock size={22} strokeWidth={3} color="#00F0FF" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500">До оновлення</div>
          <div className="mt-1 font-display text-2xl tabular-nums text-white">{countdown}</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Заміна</div>
          <div className={`mt-1 text-xs font-black ${data?.replacement_used ? "text-zinc-500" : "text-[#39FF14]"}`}>
            {`${data?.replacements_remaining ?? (data?.replacement_used ? 0 : 1)} з ${data?.replacement_limit ?? 1} доступно`}
          </div>
        </div>
      </section>

      <BattleCard battle={battle} />

      {loading ? (
        <div className="py-12 text-center text-sm font-black text-zinc-500">Завантаження…</div>
      ) : (
        <div className="space-y-4" data-testid="daily-task-list">
          {sortedTasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              canReplace={(data?.replacements_remaining ?? (data?.replacement_used ? 0 : 1)) > 0}
              replacing={replacingId === task.id}
              onReplace={replaceTask}
            />
          ))}
          {sortedTasks.length === 0 && (
            <div className="rounded-3xl border border-white/10 bg-[#1A1A1E] p-8 text-center">
              <Sparkles className="mx-auto text-[#FFB800]" />
              <div className="mt-3 text-sm font-black text-white">Завдання ще не сформовані</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
