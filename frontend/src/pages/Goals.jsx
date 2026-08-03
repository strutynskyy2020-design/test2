import { useEffect, useMemo, useState } from "react";
import { Target, CreditCard, Landmark, WalletCards, Coins, Trophy, CalendarDays, ChevronRight, Eye, MessageSquareText, X, CheckCircle2, Circle, Save, BarChart3, UsersRound, ShieldCheck } from "lucide-react";
import { useApp } from "@/context/AppContext";
import { useDailyGoogleReports } from "@/hooks/useGoogleReports";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import api, { extractError, getToken } from "@/lib/api";
import { useGoalsAccess } from "@/hooks/useGoalsAccess";

const metricMeta = {
  credit: { label: "Кредитний напрямок", icon: CreditCard, color: "#FFB800", openLabel: "Переглянути рейтинг і показники" },
  debit: { label: "Дебетовий напрямок", icon: WalletCards, color: "#00F0FF", openLabel: "Переглянути рейтинг і видачі" },
  deposit: { label: "Депозитний напрямок", icon: Landmark, color: "#39FF14", openLabel: "Переглянути рейтинг і показники" },
};

const pct = (current, target) => target > 0 ? Math.min(100, Math.max(0, (current / target) * 100)) : 0;

const parseSheetNumber = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const normalized = String(value ?? "")
    .replace(/ /g, "")
    .replace(/\s+/g, "")
    .replace(/%$/, "")
    .replace(",", ".")
    .replace(/[^0-9.+-]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const firstDefined = (object, keys) => {
  for (const key of keys) {
    if (object?.[key] !== undefined && object?.[key] !== null && object?.[key] !== "") {
      return object[key];
    }
  }
  return 0;
};

function MetricCard({ name, metric, onOpen }) {
  const meta = metricMeta[name];
  const Icon = meta.icon;
  const complete = Boolean(metric?.complete);
  const current = Number(metric?.current || 0);
  const target = Number(metric?.target || 0);
  const Wrapper = onOpen ? "button" : "section";
  return (
    <Wrapper
      type={onOpen ? "button" : undefined}
      onClick={onOpen}
      className={`w-full rounded-3xl border border-white/10 bg-[#1A1A1E] p-4 text-left ${onOpen ? "transition-transform active:scale-[.99]" : ""}`}
    >
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl" style={{ background: `${meta.color}18`, border: `1px solid ${meta.color}55` }}>
          <Icon size={20} strokeWidth={3} color={meta.color} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-black text-white">{meta.label}</div>
          <div className="text-xs text-zinc-500">{metric?.mode === "maintain" ? `Утримати не нижче ${target}%` : `Підняти до ${target}%`}</div>
        </div>
        <div className="flex items-center gap-1.5">
          <div className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${complete ? "bg-[#39FF14]/15 text-[#39FF14]" : "bg-white/5 text-zinc-400"}`}>
            {complete ? "Виконано" : "В процесі"}
          </div>
          {onOpen && <ChevronRight size={17} className="text-zinc-600" />}
        </div>
      </div>
      <div className="mt-4 flex items-end justify-between">
        <div className="font-display text-3xl" style={{ color: meta.color }}>{current}%</div>
        <div className="text-xs font-black text-zinc-500">ціль {target}%</div>
      </div>
      <div className="mt-2 h-3 overflow-hidden rounded-full bg-black/45">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct(current, target)}%`, background: meta.color, boxShadow: `0 0 14px ${meta.color}55` }} />
      </div>
      {onOpen && <div className="mt-3 text-[10px] font-black uppercase tracking-wider" style={{ color: meta.color }}>{meta.openLabel}</div>}
    </Wrapper>
  );
}

export default function Goals() {
  const { mode, user } = useApp();
  const navigate = useNavigate();
  const { data: report, loading: reportsLoading, error } = useDailyGoogleReports();
  const { data: access, setData: setAccess } = useGoalsAccess();
  const [messageOpen, setMessageOpen] = useState(false);
  const [messageDraft, setMessageDraft] = useState("");
  const [messageSaving, setMessageSaving] = useState(false);
  const [viewsOpen, setViewsOpen] = useState(false);
  const [viewsLoading, setViewsLoading] = useState(false);
  const [viewStats, setViewStats] = useState(null);
  const [teamMessageRecord, setTeamMessageRecord] = useState(null);

  const isPrivilegedViewer = user?.role === "admin" || user?.role === "editor";
  const isTeamLeader = Boolean(user?.is_team_leader || (user?.role === "admin" && user?.team_id));
  const teamMessage = teamMessageRecord?.message ?? access?.team_message?.message ?? "";

  useEffect(() => {
    setMessageDraft(teamMessage);
  }, [teamMessage]);

  useEffect(() => {
    if (mode === "mock" || !user?.team_id || !getToken()) return undefined;
    let cancelled = false;
    fetch(`/.netlify/functions/goals-team-message?team_id=${encodeURIComponent(user.team_id)}`, {
      method: "GET",
      headers: { accept: "application/json", authorization: `Bearer ${getToken()}` },
      cache: "no-store",
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.error || "Не вдалося завантажити повідомлення");
        return payload;
      })
      .then((payload) => {
        if (!cancelled) {
          setTeamMessageRecord(payload);
          setAccess((current) => ({ ...(current || {}), team_message: payload }));
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [mode, setAccess, user?.team_id]);

  const saveTeamMessage = async () => {
    setMessageSaving(true);
    try {
      const response = await fetch("/.netlify/functions/goals-team-message", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ team_id: user?.team_id, message: messageDraft }),
        cache: "no-store",
      });
      const saved = await response.json().catch(() => null);
      if (!response.ok) throw new Error(saved?.error || "Не вдалося зберегти повідомлення");
      setTeamMessageRecord(saved);
      setAccess((current) => ({
        ...(current || {}),
        team_message: saved,
      }));
      setMessageOpen(false);
      toast.success(saved.message ? "Повідомлення для команди збережено" : "Повідомлення прибрано");
    } catch (nextError) {
      toast.error(extractError(nextError, nextError?.message || "Не вдалося зберегти повідомлення"));
    } finally {
      setMessageSaving(false);
    }
  };

  const openViews = async () => {
    setViewsOpen(true);
    setViewsLoading(true);
    try {
      const { data: stats } = await api.get("/leader/goals/views-today");
      setViewStats(stats);
    } catch (nextError) {
      toast.error(extractError(nextError, "Не вдалося завантажити перегляди"));
    } finally {
      setViewsLoading(false);
    }
  };

  const { data, emptyMessage } = useMemo(() => {
    if (mode === "mock") {
      return {
        data: {
          credit: { current: 92, target: 100, mode: "reach", complete: false },
          debit: { current: 111, target: 110, mode: "maintain", complete: true },
          deposit: { current: 86, target: 95, mode: "reach", complete: false },
          monthly_bonus_current: 14250,
          monthly_bonus_target: 18000,
          weekly_complete: false,
          monthly_complete: false,
          weekly_reward_awarded: false,
          monthly_reward_awarded: false,
        },
        emptyMessage: "",
      };
    }

    if (!report) {
      return {
        data: null,
        emptyMessage: error ? "Не вдалося завантажити цілі з опублікованого звіту." : "",
      };
    }

    if (!report.found || !report.goals) {
      const message = report.reason === "goals_login_missing"
        ? "Керівник ще не прив’язав ваш профіль до Google Таблиці."
        : report.reason === "reports_not_refreshed"
          ? 'У Google Таблиці ще не натискали кнопку "Оновити звіти".'
          : "Для вашого ключа ще не додано рядок із цілями в Google Таблиці.";
      return { data: null, emptyMessage: message };
    }

    const goals = report.goals;
    const metric = (name) => {
      const current = parseSheetNumber(firstDefined(goals, [`${name}_actual`, `${name}_current`]));
      const target = parseSheetNumber(firstDefined(goals, [`${name}_target`]));
      const modeValue = goals[`${name}_mode`] === "maintain" ? "maintain" : "reach";
      return {
        current,
        target,
        mode: modeValue,
        complete: target > 0 && current >= target,
      };
    };

    return {
      data: {
        credit: metric("credit"),
        debit: metric("debit"),
        deposit: metric("deposit"),
        monthly_bonus_current: parseSheetNumber(firstDefined(goals, ["monthly_bonus_actual", "monthly_bonus_current"])),
        monthly_bonus_target: parseSheetNumber(firstDefined(goals, ["monthly_bonus_target"])),
        weekly_complete: String(goals.weekly_complete || "").toLowerCase() === "true",
        monthly_complete: String(goals.monthly_complete || "").toLowerCase() === "true",
        weekly_reward_awarded: String(goals.weekly_reward_awarded || "").toLowerCase() === "true",
        monthly_reward_awarded: String(goals.monthly_reward_awarded || "").toLowerCase() === "true",
        note: goals.note || "",
        updated_at: report.snapshot_updated_at || goals.updated_at || "",
      },
      emptyMessage: "",
    };
  }, [error, mode, report]);

  const loading = mode !== "mock" && reportsLoading && !report;
  const weeklyDone = useMemo(() => data ? [data.credit, data.debit, data.deposit].filter(x => x?.complete).length : 0, [data]);
  if (loading) return <div className="p-8 text-center text-sm text-zinc-500">Завантаження цілей...</div>;
  if (isPrivilegedViewer && report?.privileged_overview) return (
    <div className="space-y-4 px-5 pb-8 pt-2" data-testid="admin-goals-overview">
      <section className="rounded-3xl border border-[#B78CFF]/35 bg-gradient-to-br from-[#B78CFF]/15 to-[#1A1A1E] p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[#B78CFF]/35 bg-[#B78CFF]/10"><ShieldCheck size={24} color="#B78CFF" /></div>
          <div>
            <div className="text-[10px] font-black uppercase tracking-[.2em] text-[#B78CFF]">Режим адміністратора</div>
            <h1 className="mt-1 font-display text-2xl text-white">Звіти команд</h1>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">Адміністратору не потрібен окремий рядок у Google Таблиці. Тут відкриваються командні рейтинги з останнього опублікованого знімка.</p>
          </div>
        </div>
        <div className="mt-4 rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-xs font-bold text-zinc-400">Оновлено: <span className="text-white">{report?.snapshot_updated_at || "ще не опубліковано"}</span></div>
      </section>
      <button type="button" onClick={() => navigate("/goals/credit")} className="flex w-full items-center gap-3 rounded-3xl border border-[#FFB800]/30 bg-[#FFB800]/[.07] p-4 text-left active:scale-[.99]">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#FFB800]/15"><BarChart3 size={21} color="#FFB800" /></div>
        <div className="min-w-0 flex-1"><div className="font-black text-white">Кредитний рейтинг</div><div className="mt-1 text-xs text-zinc-500">Команди, підсумки та оператори</div></div><ChevronRight size={19} className="text-[#FFB800]" />
      </button>
      <button type="button" onClick={() => navigate("/goals/debit")} className="flex w-full items-center gap-3 rounded-3xl border border-[#00F0FF]/30 bg-[#00F0FF]/[.07] p-4 text-left active:scale-[.99]">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#00F0FF]/15"><UsersRound size={21} color="#00F0FF" /></div>
        <div className="min-w-0 flex-1"><div className="font-black text-white">Дебетовий рейтинг</div><div className="mt-1 text-xs text-zinc-500">Командні результати та видачі</div></div><ChevronRight size={19} className="text-[#00F0FF]" />
      </button>
      <button type="button" onClick={() => navigate("/goals/deposit")} className="flex w-full items-center gap-3 rounded-3xl border border-[#39FF14]/30 bg-[#39FF14]/[.07] p-4 text-left active:scale-[.99]">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#39FF14]/15"><Landmark size={21} color="#39FF14" /></div>
        <div className="min-w-0 flex-1"><div className="font-black text-white">Депозитний рейтинг</div><div className="mt-1 text-xs text-zinc-500">Видачі, проекційні показники та команди</div></div><ChevronRight size={19} className="text-[#39FF14]" />
      </button>
    </div>
  );
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
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.25em] text-zinc-500">Персональний прогрес</div>
          <h1 className="mt-1 flex items-center gap-2 font-display text-3xl text-white"><Target size={28} strokeWidth={3} color="#B78CFF" />Мої цілі</h1>
          {access?.current_team?.name && <div className="mt-1 text-[10px] font-black uppercase tracking-wider text-[#00F0FF]">Команда: {access.current_team.name}</div>}
        </div>
        {isTeamLeader && <div className="flex shrink-0 gap-2">
          <button type="button" onClick={() => setMessageOpen(true)} className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#B78CFF]/30 bg-[#B78CFF]/10 text-[#B78CFF] active:scale-95" aria-label="Повідомлення для операторів"><MessageSquareText size={17} strokeWidth={2.8} /></button>
          <button type="button" onClick={openViews} className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#00F0FF]/30 bg-[#00F0FF]/10 text-[#00F0FF] active:scale-95" aria-label="Хто переглянув звіти"><Eye size={18} strokeWidth={2.8} /></button>
        </div>}
      </div>

      {teamMessage && <section className="rounded-2xl border border-[#00F0FF]/25 bg-[#00F0FF]/[.06] p-4">
        <div className="flex items-start gap-3"><MessageSquareText size={18} className="mt-0.5 shrink-0 text-[#00F0FF]" /><div><div className="text-[10px] font-black uppercase tracking-widest text-[#00F0FF]">Повідомлення керівника</div><p className="mt-1 whitespace-pre-wrap text-sm font-bold leading-relaxed text-zinc-200">{teamMessage}</p></div></div>
      </section>}

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

      {Object.keys(metricMeta).map((name) => {
        const route = name === "credit" ? "/goals/credit" : name === "debit" ? "/goals/debit" : "/goals/deposit";
        return <MetricCard key={name} name={name} metric={data[name]} onOpen={route ? () => navigate(route) : undefined} />;
      })}

      <section className="rounded-3xl border border-[#FFB800]/35 bg-[#1A1A1E] p-5">
        <div className="flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#FFB800]/15"><Coins size={22} strokeWidth={3} color="#FFB800" /></div><div><div className="font-black text-white">Місячна ціль по бонусу</div><div className="text-xs text-zinc-500">Нагорода за виконання: +1000 Point • +300 XP</div></div></div>
        <div className="mt-5 flex items-end justify-between"><div className="font-display text-3xl text-[#FFB800]">{bonusCurrent.toLocaleString("uk-UA")}</div><div className="text-xs font-black text-zinc-500">із {bonusTarget.toLocaleString("uk-UA")} грн</div></div>
        <div className="mt-2 h-3 overflow-hidden rounded-full bg-black/45"><div className="h-full rounded-full bg-gradient-to-r from-[#FF5C00] to-[#FFB800]" style={{ width: `${pct(bonusCurrent, bonusTarget)}%` }} /></div>
        <div className="mt-3 flex items-center gap-2 text-xs text-zinc-400"><CalendarDays size={14} />Оновлюється керівником протягом місяця</div>
      </section>

      {data.note && <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-zinc-300"><span className="font-black text-white">Коментар керівника: </span>{data.note}</section>}

      {messageOpen && <div className="fixed inset-0 z-50 flex items-end justify-center">
        <button type="button" className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setMessageOpen(false)} aria-label="Закрити" />
        <section className="relative w-full max-w-[480px] rounded-t-3xl border-t border-white/10 bg-[#1A1A1E] p-5 pb-[calc(env(safe-area-inset-bottom,0px)+24px)]">
          <div className="flex items-start justify-between gap-3"><div><div className="text-[10px] font-black uppercase tracking-widest text-[#B78CFF]">Для всієї команди</div><h2 className="mt-1 font-display text-2xl text-white">Повідомлення операторам</h2></div><button type="button" onClick={() => setMessageOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-black/30 text-zinc-400"><X size={16} /></button></div>
          <textarea value={messageDraft} onChange={(event) => setMessageDraft(event.target.value.slice(0, 1200))} rows={6} placeholder="Наприклад: сьогодні фокус на X-Sell і уважно перевіряємо заявки..." className="mt-4 w-full resize-none rounded-2xl border border-white/10 bg-black/30 p-4 text-sm font-bold text-white outline-none focus:border-[#B78CFF]" />
          <div className="mt-2 text-right text-[10px] font-bold text-zinc-600">{messageDraft.length}/1200</div>
          <button type="button" onClick={saveTeamMessage} disabled={messageSaving} className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#B78CFF] text-xs font-black uppercase text-black disabled:opacity-50"><Save size={16} />{messageSaving ? "Збереження…" : "Зберегти повідомлення"}</button>
        </section>
      </div>}

      {viewsOpen && <div className="fixed inset-0 z-50 flex items-end justify-center">
        <button type="button" className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setViewsOpen(false)} aria-label="Закрити" />
        <section className="relative max-h-[82vh] w-full max-w-[480px] overflow-y-auto rounded-t-3xl border-t border-white/10 bg-[#1A1A1E] p-5 pb-[calc(env(safe-area-inset-bottom,0px)+24px)]">
          <div className="flex items-start justify-between gap-3"><div><div className="text-[10px] font-black uppercase tracking-widest text-[#00F0FF]">Сьогодні · {viewStats?.team_name || access?.current_team?.name || "команда"}</div><h2 className="mt-1 font-display text-2xl text-white">Перегляди звітів</h2></div><button type="button" onClick={() => setViewsOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-black/30 text-zinc-400"><X size={16} /></button></div>
          {viewsLoading ? <div className="py-10 text-center text-sm font-bold text-zinc-500">Завантаження…</div> : <>
            <div className="mt-4 grid grid-cols-2 gap-2"><div className="rounded-2xl border border-[#00F0FF]/20 bg-[#00F0FF]/[.06] p-3 text-center"><div className="font-display text-2xl text-[#00F0FF]">{viewStats?.report_viewed_count || 0}/{viewStats?.total || 0}</div><div className="text-[9px] font-black uppercase text-zinc-500">Дивились звіти</div></div><div className="rounded-2xl border border-[#B78CFF]/20 bg-[#B78CFF]/[.06] p-3 text-center"><div className="font-display text-2xl text-[#B78CFF]">{viewStats?.metrics_viewed_count || 0}/{viewStats?.total || 0}</div><div className="text-[9px] font-black uppercase text-zinc-500">Дивились свої показники</div></div></div>
            <div className="mt-4 space-y-2">{(viewStats?.members || []).map((member) => <article key={member.id} className="rounded-2xl border border-white/10 bg-black/25 p-3"><div className="flex items-center gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-black text-black" style={{ backgroundColor: member.avatar_color || "#FFB800" }}>{member.avatar_initials || "?"}</div><div className="min-w-0 flex-1"><div className="truncate text-sm font-black text-white">{member.name}</div><div className="mt-1 grid grid-cols-2 gap-2"><div className={`flex items-center gap-1 text-[9px] font-black ${member.report_viewed ? "text-[#39FF14]" : "text-zinc-600"}`}>{member.report_viewed ? <CheckCircle2 size={12} /> : <Circle size={12} />} Звіти</div><div className={`flex items-center gap-1 text-[9px] font-black ${member.metrics_viewed ? "text-[#39FF14]" : "text-zinc-600"}`}>{member.metrics_viewed ? <CheckCircle2 size={12} /> : <Circle size={12} />} Мої показники</div></div></div></div></article>)}</div>
          </>}
        </section>
      </div>}
    </div>
  );
}
