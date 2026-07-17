import { useEffect, useMemo, useState } from "react";
import { Target, CreditCard, Landmark, WalletCards, Coins, Trophy, CalendarDays } from "lucide-react";
import { toast } from "sonner";
import { getToken } from "@/lib/api";
import { useApp } from "@/context/AppContext";

const metricMeta = {
  credit: { label: "Кредитний напрямок", icon: CreditCard, color: "#FFB800" },
  debit: { label: "Дебетний напрямок", icon: WalletCards, color: "#00F0FF" },
  deposit: { label: "Депозитний напрямок", icon: Landmark, color: "#39FF14" },
};

const pct = (current, target) => target > 0 ? Math.min(100, Math.max(0, (current / target) * 100)) : 0;

function MetricCard({ name, metric }) {
  const meta = metricMeta[name];
  const Icon = meta.icon;
  const complete = Boolean(metric?.complete);
  const current = Number(metric?.current || 0);
  const target = Number(metric?.target || 0);
  return (
    <section className="rounded-3xl border border-white/10 bg-[#1A1A1E] p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl" style={{ background: `${meta.color}18`, border: `1px solid ${meta.color}55` }}>
          <Icon size={20} strokeWidth={3} color={meta.color} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-black text-white">{meta.label}</div>
          <div className="text-xs text-zinc-500">{metric?.mode === "maintain" ? `Утримати не нижче ${target}%` : `Підняти до ${target}%`}</div>
        </div>
        <div className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${complete ? "bg-[#39FF14]/15 text-[#39FF14]" : "bg-white/5 text-zinc-400"}`}>
          {complete ? "Виконано" : "В процесі"}
        </div>
      </div>
      <div className="mt-4 flex items-end justify-between">
        <div className="font-display text-3xl" style={{ color: meta.color }}>{current}%</div>
        <div className="text-xs font-black text-zinc-500">ціль {target}%</div>
      </div>
      <div className="mt-2 h-3 overflow-hidden rounded-full bg-black/45">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct(current, target)}%`, background: meta.color, boxShadow: `0 0 14px ${meta.color}55` }} />
      </div>
    </section>
  );
}

export default function Goals() {
  const { mode } = useApp();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [emptyMessage, setEmptyMessage] = useState("");

  useEffect(() => {
    if (mode === "mock") {
      setData({
        credit: { current: 92, target: 100, mode: "reach", complete: false },
        debit: { current: 111, target: 110, mode: "maintain", complete: true },
        deposit: { current: 86, target: 95, mode: "reach", complete: false },
        monthly_bonus_current: 14250, monthly_bonus_target: 18000,
        weekly_complete: false, monthly_complete: false,
        weekly_reward_awarded: false, monthly_reward_awarded: false,
      });
      setLoading(false);
      return;
    }
    let cancelled = false;

    const loadGoogleGoals = async () => {
      try {
        setLoading(true);
        setEmptyMessage("");
        const token = getToken();
        if (!token) throw new Error("Потрібна авторизація");

        const response = await fetch("/.netlify/functions/google-goals", {
          method: "GET",
          headers: {
            accept: "application/json",
            authorization: `Bearer ${token}`,
          },
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "Не вдалося завантажити цілі");
        if (cancelled) return;

        if (!result.found || !result.goals) {
          setData(null);
          setEmptyMessage(
            result.reason === "goals_login_missing"
              ? "Керівник ще не прив’язав ваш профіль до Google Таблиці."
              : "Для вашого ключа ще не додано рядок із цілями в Google Таблиці."
          );
          return;
        }

        const goals = result.goals;
        const metric = (name) => {
          const current = Number(goals[`${name}_current`] || 0);
          const target = Number(goals[`${name}_target`] || 0);
          const modeValue = goals[`${name}_mode`] === "maintain" ? "maintain" : "reach";
          return {
            current,
            target,
            mode: modeValue,
            complete: target > 0 && (modeValue === "maintain" ? current >= target : current >= target),
          };
        };

        setData({
          credit: metric("credit"),
          debit: metric("debit"),
          deposit: metric("deposit"),
          monthly_bonus_current: Number(goals.monthly_bonus_current || 0),
          monthly_bonus_target: Number(goals.monthly_bonus_target || 0),
          weekly_complete: String(goals.weekly_complete || "").toLowerCase() === "true",
          monthly_complete: String(goals.monthly_complete || "").toLowerCase() === "true",
          weekly_reward_awarded: String(goals.weekly_reward_awarded || "").toLowerCase() === "true",
          monthly_reward_awarded: String(goals.monthly_reward_awarded || "").toLowerCase() === "true",
          note: goals.note || "",
          updated_at: goals.updated_at || "",
        });
      } catch (error) {
        if (!cancelled) {
          setData(null);
          setEmptyMessage("Не вдалося завантажити цілі з Google Таблиці.");
          toast.error(error.message || "Не вдалося завантажити цілі");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadGoogleGoals();
    return () => { cancelled = true; };
  }, [mode]);

  const weeklyDone = useMemo(() => data ? [data.credit, data.debit, data.deposit].filter(x => x?.complete).length : 0, [data]);
  if (loading) return <div className="p-8 text-center text-sm text-zinc-500">Завантаження цілей...</div>;
  if (!data) return (
    <div className="px-5 pt-6">
      <div className="rounded-3xl border border-white/10 bg-[#1A1A1E] p-6 text-center">
        <Target size={34} color="#B78CFF" className="mx-auto" />
        <div className="mt-3 font-display text-xl text-white">ЦІЛІ ЩЕ НЕ ДОДАНО</div>
        <p className="mt-2 text-sm text-zinc-500">{emptyMessage || "Керівник ще не додав ваші цілі."}</p>
      </div>
    </div>
  );
  const bonusCurrent = Number(data.monthly_bonus_current || 0);
  const bonusTarget = Number(data.monthly_bonus_target || 0);

  return (
    <div className="space-y-5 px-5 pb-8 pt-2" data-testid="goals-page">
      <div>
        <div className="text-[10px] font-black uppercase tracking-[0.25em] text-zinc-500">Персональний прогрес</div>
        <h1 className="mt-1 flex items-center gap-2 font-display text-3xl text-white"><Target size={28} strokeWidth={3} color="#B78CFF" />Мої цілі</h1>
      </div>

      <section className="rounded-3xl border border-[#B78CFF]/35 bg-gradient-to-br from-[#B78CFF]/15 to-[#1A1A1E] p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] font-black uppercase tracking-widest text-[#B78CFF]">Цілі тижня</div>
            <div className="mt-1 font-display text-2xl text-white">{weeklyDone} із 3 виконано</div>
          </div>
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#FFB800]/15 border border-[#FFB800]/40"><Trophy size={26} strokeWidth={3} color="#FFB800" /></div>
        </div>
        <div className="mt-4 h-3 overflow-hidden rounded-full bg-black/40"><div className="h-full rounded-full bg-[#B78CFF]" style={{ width: `${weeklyDone / 3 * 100}%` }} /></div>
        <div className="mt-3 text-xs font-black text-zinc-300">Нагорода за всі три цілі: <span className="text-[#FFB800]">+200 Point</span> <span className="text-[#B78CFF]">• +100 XP</span></div>
      </section>

      {Object.keys(metricMeta).map(name => <MetricCard key={name} name={name} metric={data[name]} />)}

      <section className="rounded-3xl border border-[#FFB800]/35 bg-[#1A1A1E] p-5">
        <div className="flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#FFB800]/15"><Coins size={22} strokeWidth={3} color="#FFB800" /></div><div><div className="font-black text-white">Місячна ціль по бонусу</div><div className="text-xs text-zinc-500">Нагорода за виконання: +1000 Point • +300 XP</div></div></div>
        <div className="mt-5 flex items-end justify-between"><div className="font-display text-3xl text-[#FFB800]">{bonusCurrent.toLocaleString("uk-UA")}</div><div className="text-xs font-black text-zinc-500">із {bonusTarget.toLocaleString("uk-UA")} грн</div></div>
        <div className="mt-2 h-3 overflow-hidden rounded-full bg-black/45"><div className="h-full rounded-full bg-gradient-to-r from-[#FF5C00] to-[#FFB800]" style={{ width: `${pct(bonusCurrent, bonusTarget)}%` }} /></div>
        <div className="mt-3 flex items-center gap-2 text-xs text-zinc-400"><CalendarDays size={14} />Оновлюється керівником протягом місяця</div>
      </section>

      {data.note && <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-zinc-300"><span className="font-black text-white">Коментар керівника: </span>{data.note}</section>}
    </div>
  );
}
