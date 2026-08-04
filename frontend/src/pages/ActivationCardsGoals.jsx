import { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  BadgeCheck,
  CheckCircle2,
  Clock3,
  CreditCard,
  Headphones,
  Layers3,
  RefreshCcw,
  Target,
  UsersRound,
} from "lucide-react";
import { useApp } from "@/context/AppContext";
import { useDailyGoogleReports } from "@/hooks/useGoogleReports";
import { resolveAvatarUrl } from "@/lib/avatar";
import {
  currentTeamKey,
  formatCount,
  formatDuration,
  formatPercent,
  normalizeLogin,
  normalizeReportProfile,
  parseReportNumber,
  periodRowForLogin,
  periodSummary,
  rowForLogin,
  valueStatus,
} from "@/lib/activationReports";

const PERIODS = [
  { id: "month", label: "Місяць" },
  { id: "yesterday", label: "Вчора" },
];

const METRICS = [
  { key: "processed_tasks", label: "Оброблено", icon: Headphones, count: true, color: "#B78CFF" },
  { key: "aht", label: "Середній час AHT", icon: Clock3, duration: true, color: "#00F0FF" },
  { key: "agreement_to_processed_rate", label: "Згоди до оброблених", icon: BadgeCheck, color: "#FFB800" },
  { key: "activation_from_agreements_rate", label: "Активації від згод", icon: CheckCircle2, color: "#39FF14" },
  { key: "activation_from_processed_rate", label: "Активації до оброблених", icon: CreditCard, color: "#FF6B9D" },
];

const SEGMENTS = [
  { key: "segment_a", label: "A", color: "#39FF14" },
  { key: "segment_b", label: "B", color: "#00F0FF" },
  { key: "segment_c", label: "C", color: "#B78CFF" },
  { key: "segment_d", label: "D", color: "#FFB800" },
];

const formatted = (value, metric) => {
  if (metric.duration) return formatDuration(value);
  if (metric.count) return formatCount(value, "—");
  return formatPercent(value);
};

function PeriodTabs({ value, onChange }) {
  return (
    <div className="grid grid-cols-2 rounded-2xl border border-white/10 bg-[#151519] p-1">
      {PERIODS.map((item) => (
        <button key={item.id} type="button" onClick={() => onChange(item.id)} className={`min-h-12 rounded-xl text-xs font-black transition-all ${value === item.id ? "border border-[#00F0FF]/45 bg-[#00F0FF]/10 text-[#00F0FF]" : "text-zinc-400"}`}>
          {item.label}
        </button>
      ))}
    </div>
  );
}

function MetricCard({ metric, own, team }) {
  const Icon = metric.icon;
  return (
    <article className="rounded-2xl border border-white/10 bg-[#1A1A1E] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ color: metric.color, background: `${metric.color}14`, border: `1px solid ${metric.color}40` }}><Icon size={19} strokeWidth={2.8} /></div>
        <div className="text-right"><div className="text-[9px] font-black uppercase tracking-wider text-zinc-600">Мій результат</div><div className="mt-1 text-lg font-black" style={{ color: metric.color }}>{formatted(own, metric)}</div></div>
      </div>
      <div className="mt-3 min-h-10 text-sm font-black leading-tight text-white">{metric.label}</div>
      <div className="mt-2 flex items-center justify-between rounded-xl bg-black/25 px-3 py-2 text-xs"><span className="font-bold text-zinc-500">Команда</span><span className="font-black text-white">{formatted(team, metric)}</span></div>
    </article>
  );
}

function Avatar({ row }) {
  const src = resolveAvatarUrl(row?.avatar_url);
  const fallback = String(row?.avatar_initials || row?.login || row?.name || "?").slice(0, 2).toUpperCase();
  return <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-[#27272A] text-xs font-black text-white" style={{ backgroundColor: row?.avatar_color || undefined }}>{src ? <img src={src} alt="" className="h-full w-full object-cover" /> : fallback}</div>;
}

export default function ActivationCardsGoals() {
  const { user } = useApp();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: report, loading, error } = useDailyGoogleReports();
  const requested = searchParams.get("period");
  const period = PERIODS.some((item) => item.id === requested) ? requested : "month";
  const login = normalizeLogin(user?.goals_login || report?.goals_login || user?.email?.split("@")[0]);
  const teamKey = currentTeamKey(report, user);
  const reportProfile = normalizeReportProfile(report?.report_profile || user?.report_profile);
  const canViewActivationReports = reportProfile === "activation" || user?.role === "admin" || user?.role === "editor" || Boolean(user?.is_team_leader);

  const active = useMemo(() => periodRowForLogin(report?.activation_cards_metrics, period, login), [period, report, login]);
  const giving = useMemo(() => periodRowForLogin(report?.activation_cards_giving, period, login), [period, report, login]);
  const teamMetrics = useMemo(() => periodSummary(report?.activation_cards_transformation_group_summaries, period, teamKey), [period, report, teamKey]);
  const teamGiving = useMemo(() => periodSummary(report?.activation_cards_giving_group_summaries, period, teamKey), [period, report, teamKey]);
  const projectionRow = useMemo(() => rowForLogin(report?.activation_cards_leaderboard, login), [login, report]);
  const projectionTeam = report?.activation_cards_group_summaries?.[teamKey]
    || report?.activation_cards_group_summaries?.general
    || Object.values(report?.activation_cards_group_summaries || {})[0]
    || null;
  const leaderboard = useMemo(() => (Array.isArray(report?.activation_cards_leaderboard) ? report.activation_cards_leaderboard : [])
    .filter((row) => parseReportNumber(row?.projective_rate) !== null)
    .sort((left, right) => (parseReportNumber(right.projective_rate) || 0) - (parseReportNumber(left.projective_rate) || 0)), [report]);
  const projection = projectionRow?.projective_rate;
  const status = valueStatus(projection, 100);
  const teamGivingValue = giving?.team_overall || teamGiving?.overall;

  const setPeriod = (value) => {
    const next = new URLSearchParams(searchParams);
    next.set("period", value);
    setSearchParams(next, { replace: true });
  };

  if (loading && !report) return <div className="p-8 text-center text-sm font-bold text-zinc-500">Завантаження активації карток…</div>;

  if (report && !canViewActivationReports) {
    return (
      <div className="space-y-4 px-5 pb-8 pt-2" data-testid="activation-report-access-denied">
        <button type="button" onClick={() => navigate("/goals")} className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-[#1A1A1E] text-zinc-300 active:scale-95" aria-label="Назад до цілей">
          <ArrowLeft size={21} strokeWidth={2.7} />
        </button>
        <section className="rounded-3xl border border-white/10 bg-[#1A1A1E] p-7 text-center">
          <Target size={38} className="mx-auto text-[#B78CFF]" />
          <h1 className="mt-3 font-display text-xl text-white">ЦЕЙ ЗВІТ ДОСТУПНИЙ АКТИВАТОРАМ</h1>
          <p className="mt-2 text-sm leading-relaxed text-zinc-500">Для вашого профілю залишаються доступними продажні звіти у вкладці «Цілі».</p>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-4 px-5 pb-8 pt-2" data-testid="activation-cards-goals-page">
      <section className="flex items-start gap-3">
        <button type="button" onClick={() => navigate("/goals")} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-[#1A1A1E] text-zinc-300 active:scale-95" aria-label="Назад до цілей"><ArrowLeft size={21} strokeWidth={2.7} /></button>
        <div className="min-w-0 flex-1 pt-0.5">
          <h1 className="font-display text-[25px] leading-tight text-white">Активація карток</h1>
          <div className="mt-1 text-xs font-bold text-zinc-500">Звіт активатора · {user?.goals_login || user?.name || "оператор"}</div>
          <div className="mt-1 flex items-center gap-1.5 text-[10px] font-bold text-zinc-600"><RefreshCcw size={11} />Оновлено: {active?.updated_at || report?.activation_cards_updated_at || report?.snapshot_updated_at || "з Google Таблиці"}</div>
        </div>
      </section>

      <PeriodTabs value={period} onChange={setPeriod} />

      {!active && !leaderboard.length ? (
        <section className="rounded-3xl border border-white/10 bg-[#1A1A1E] p-7 text-center">
          <CreditCard size={38} className="mx-auto text-[#00F0FF]" />
          <h2 className="mt-3 font-display text-xl text-white">ДАНІ АКТИВАЦІЇ КАРТОК ЩЕ НЕ ЗНАЙДЕНО</h2>
          <p className="mt-2 text-sm leading-relaxed text-zinc-500">{error ? "Не вдалося отримати опублікований звіт." : 'Перевірте вкладку "Activation Cards" та натисніть «Оновити звіти».'}</p>
        </section>
      ) : (
        <>
          <section className="rounded-3xl border border-[#00F0FF]/30 bg-gradient-to-br from-[#00F0FF]/10 to-[#1A1A1E] p-5">
            <div className="flex items-start justify-between gap-3">
              <div><div className="text-[10px] font-black uppercase tracking-[.18em] text-[#00F0FF]">Місячний проекційний результат</div><div className="mt-2 font-display text-[46px] leading-none" style={{ color: status.color }}>{formatPercent(projection)}</div><div className="mt-2 text-xs font-black uppercase tracking-wider" style={{ color: status.color }}>{status.label}</div></div>
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[#00F0FF]/30 bg-[#00F0FF]/10 text-[#00F0FF]"><Target size={23} strokeWidth={2.8} /></div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className="rounded-2xl border border-white/10 bg-black/25 p-3"><div className="text-[9px] font-black uppercase tracking-wider text-zinc-600">Команда</div><div className="mt-1 text-xl font-black text-white">{formatPercent(projectionTeam?.projective_rate)}</div></div>
              <div className="rounded-2xl border border-white/10 bg-black/25 p-3"><div className="text-[9px] font-black uppercase tracking-wider text-zinc-600">Видачі карток</div><div className="mt-1 text-xl font-black text-[#FFB800]">{formatCount(giving?.overall, "—")}</div><div className="mt-0.5 text-[9px] font-bold text-zinc-600">команда {formatCount(teamGivingValue, "—")}</div></div>
            </div>
          </section>

          {active ? <section className="grid grid-cols-2 gap-2.5">
            {METRICS.map((metric, index) => <div key={metric.key} className={index === METRICS.length - 1 ? "col-span-2" : ""}><MetricCard metric={metric} own={active?.[metric.key]} team={active?.[`${metric.key}_team`] || active?.team_summary?.[metric.key] || teamMetrics?.[metric.key] || active?.[`${metric.key}_overall`]} /></div>)}
          </section> : <section className="rounded-2xl border border-white/10 bg-[#1A1A1E] p-5 text-center text-sm font-bold text-zinc-500">Для вибраного періоду особисті показники відсутні.</section>}

          <section className="rounded-3xl border border-[#FFB800]/30 bg-[#1A1A1E] p-5">
            <div className="flex items-center justify-between gap-3">
              <div><div className="text-[10px] font-black uppercase tracking-widest text-[#FFB800]">Card activation giving</div><h2 className="mt-1 font-display text-xl text-white">Сегменти видач A · B · C · D</h2></div>
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[#FFB800]/30 bg-[#FFB800]/10 text-[#FFB800]"><Layers3 size={21} /></div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2.5">
              {SEGMENTS.map((segment) => (
                <article key={segment.key} className="rounded-2xl border border-white/10 bg-black/25 p-4">
                  <div className="flex items-center justify-between"><div className="flex h-9 w-9 items-center justify-center rounded-xl text-lg font-black" style={{ color: segment.color, background: `${segment.color}16`, border: `1px solid ${segment.color}40` }}>{segment.label}</div><div className="font-display text-3xl" style={{ color: segment.color }}>{formatCount(giving?.[segment.key], "—")}</div></div>
                  <div className="mt-3 flex items-center justify-between text-[10px] font-black"><span className="uppercase tracking-wider text-zinc-600">Команда</span><span className="text-white">{formatCount(giving?.team_summary?.[segment.key] || teamGiving?.[segment.key], "—")}</span></div>
                </article>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between rounded-2xl border border-white/10 bg-black/30 p-4"><div><div className="text-[9px] font-black uppercase tracking-wider text-zinc-600">Загальний підсумок</div><div className="mt-1 text-xs font-bold text-zinc-500">Усі чотири сегменти</div></div><div className="text-right"><div className="font-display text-3xl text-[#FFB800]">{formatCount(giving?.overall, "—")}</div><div className="text-[10px] font-black text-zinc-500">команда {formatCount(teamGivingValue, "—")}</div></div></div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-[#1A1A1E] p-5">
            <div className="flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#00F0FF]/10 text-[#00F0FF]"><UsersRound size={21} /></div><div><div className="font-display text-xl text-white">Рейтинг проекції</div><div className="text-xs text-zinc-500">Оператори доступної команди</div></div></div>
            <div className="mt-4 space-y-2">
              {leaderboard.map((row, index) => {
                const isMe = normalizeLogin(row?.login || row?.goals_login) === login;
                return <article key={`${row?.login || row?.name}-${index}`} className={`flex items-center gap-3 rounded-2xl border p-3 ${isMe ? "border-[#00F0FF]/45 bg-[#00F0FF]/[.07]" : "border-white/10 bg-black/20"}`}>
                  <div className="w-6 text-center text-xs font-black text-zinc-500">{index + 1}</div><Avatar row={row} /><div className="min-w-0 flex-1"><div className="truncate text-sm font-black text-white">{row?.name || row?.full_name || row?.login}</div><div className="truncate text-[10px] font-bold text-zinc-600">{row?.login}{isMe ? " · це ви" : ""}</div></div><div className="text-lg font-black text-[#00F0FF]">{formatPercent(row?.projective_rate)}</div>
                </article>;
              })}
              {!leaderboard.length && <div className="py-6 text-center text-sm font-bold text-zinc-600">Рейтинг ще порожній.</div>}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
