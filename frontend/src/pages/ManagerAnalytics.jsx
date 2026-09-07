import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Activity, ArrowLeft, BarChart3, CheckCircle2, ChevronDown, Coins, Eye, Gamepad2, Gift, Search,
  RefreshCcw, TrendingUp, UserRoundCheck, UserRoundX, UsersRound,
} from "lucide-react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import { toast } from "sonner";
import api, { extractError } from "@/lib/api";
import { useApp } from "@/context/AppContext";

const PERIODS = [
  ["day", "День"],
  ["week", "Тиждень"],
  ["month", "Місяць"],
];

const formatNumber = (value) => Number(value || 0).toLocaleString("uk-UA");
const shortDate = (value) => {
  const source = String(value || "").trim();
  const iso = source.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}.${iso[2]}`;
  const ua = source.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/);
  if (ua) return `${String(Number(ua[1])).padStart(2, "0")}.${String(Number(ua[2])).padStart(2, "0")}`;
  return source;
};


const REPORT_VIEW_GROUPS = [
  {
    title: "Огляд",
    rows: [{ label: "Мої проекційні", single: "overview" }],
  },
  {
    title: "Кредит",
    rows: [
      { label: "Рейтинг", single: "credit_leaderboard" },
      { label: "X-Sell / Крос", month: "credit_xsell_month", yesterday: "credit_xsell_yesterday" },
      { label: "Web Apps", month: "credit_web_apps_month", yesterday: "credit_web_apps_yesterday" },
      { label: "INB", month: "credit_inb_month", yesterday: "credit_inb_yesterday" },
    ],
  },
  {
    title: "Дебет",
    rows: [
      { label: "Рейтинг", single: "debit_leaderboard" },
      { label: "Видачі", month: "debit_issuances_month", yesterday: "debit_issuances_yesterday" },
    ],
  },
  {
    title: "Депозит",
    rows: [
      { label: "Проекційний рейтинг", single: "deposit_projection" },
      { label: "Показники", month: "deposit_metrics_month", yesterday: "deposit_metrics_yesterday" },
      { label: "Видачі", month: "deposit_giving_month", yesterday: "deposit_giving_yesterday" },
    ],
  },
  {
    title: "Активатори",
    rows: [
      { label: "ПУМБ Online", month: "activation_pumb_month", yesterday: "activation_pumb_yesterday" },
      { label: "Активація карток", month: "activation_cards_month", yesterday: "activation_cards_yesterday" },
    ],
  },
];

const viewedAtLabel = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
};

const ViewPill = ({ viewedAt, label }) => (
  <span
    title={viewedAt ? `Переглянуто: ${viewedAtLabel(viewedAt)}` : "Не переглянуто за вибраний період"}
    className={`inline-flex min-w-7 items-center justify-center gap-1 rounded-full border px-1.5 py-1 text-[8px] font-black uppercase ${viewedAt ? "border-[#16A34A]/30 bg-[#16A34A]/10 text-[#16A34A]" : "border-zinc-200 bg-white text-zinc-400 dark:border-white/10 dark:bg-white/[.03] dark:text-zinc-600"}`}
  >
    {viewedAt ? <CheckCircle2 size={9} strokeWidth={3} /> : null}{label}
  </span>
);

const Card = ({ icon: Icon, label, value, detail, accent = "#8B5CF6" }) => (
  <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-[#1A1A1E]">
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="text-[9px] font-black uppercase tracking-[0.16em] text-zinc-500">{label}</div>
        <div className="mt-1 font-display text-2xl text-[#242735] dark:text-white">{value}</div>
        {detail && <div className="mt-1 text-[10px] font-bold text-zinc-500">{detail}</div>}
      </div>
      <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ color: accent, backgroundColor: `${accent}16`, border: `1px solid ${accent}38` }}>
        <Icon size={19} strokeWidth={2.8} />
      </div>
    </div>
  </div>
);

const Panel = ({ title, subtitle, icon: Icon, children }) => (
  <section className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-[#1A1A1E]">
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <h2 className="text-sm font-black uppercase tracking-wider text-[#242735] dark:text-white">{title}</h2>
        {subtitle && <div className="mt-1 text-[10px] font-bold text-zinc-500">{subtitle}</div>}
      </div>
      {Icon && <Icon size={18} className="shrink-0 text-[#8B5CF6]" />}
    </div>
    {children}
  </section>
);

export default function ManagerAnalytics() {
  const navigate = useNavigate();
  const { user } = useApp();
  const [period, setPeriod] = useState("week");
  const [teamId, setTeamId] = useState(user?.team_id || "");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expandedOperators, setExpandedOperators] = useState({});

  const load = async () => {
    setLoading(true);
    try {
      const response = await api.get("/manager-analytics", {
        params: { period, team_id: teamId || undefined },
        timeout: 30000,
      });
      setData(response.data);
      if (!teamId && response.data?.team?.id) setTeamId(response.data.team.id);
    } catch (error) {
      toast.error(extractError(error, "Не вдалося завантажити аналітику"));
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [period, teamId]);

  const trend = useMemo(() => (data?.trend || []).map((item) => ({ ...item, label: shortDate(item.date) })), [data?.trend]);
  const reportTrend = useMemo(() => (data?.report_trends || []).map((item) => ({
    ...item,
    label: shortDate(item.snapshot_updated_at || item.created_at),
  })), [data?.report_trends]);
  const inactive = useMemo(() => (data?.operators || []).filter((item) => item.days_inactive >= 7), [data?.operators]);

  if (!user) return null;

  return (
    <div className="space-y-4 px-5 pb-8 pt-2" data-testid="manager-analytics-page">
      <section className="flex items-start gap-3">
        <button onClick={() => navigate("/teams")} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-zinc-200 bg-white text-zinc-700 active:scale-95 dark:border-white/10 dark:bg-[#1A1A1E] dark:text-zinc-300" aria-label="Назад">
          <ArrowLeft size={21} strokeWidth={2.7} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-black uppercase tracking-[0.22em] text-[#7C3AED] dark:text-[#B78CFF]">Панель керівника</div>
          <h1 className="mt-1 font-display text-[26px] leading-tight text-[#202431] dark:text-white">Динаміка команди</h1>
          <div className="mt-1 text-[11px] font-bold text-zinc-500">Не тільки місце в рейтингу, а напрямок руху.</div>
        </div>
        <button onClick={load} disabled={loading} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-zinc-200 bg-white text-[#7C3AED] disabled:opacity-50 dark:border-white/10 dark:bg-[#1A1A1E] dark:text-[#B78CFF]" aria-label="Оновити">
          <RefreshCcw size={18} className={loading ? "animate-spin" : ""} />
        </button>
      </section>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {PERIODS.map(([id, label]) => (
          <button key={id} onClick={() => setPeriod(id)} className={`h-10 shrink-0 rounded-full border-2 px-4 text-[11px] font-black uppercase ${period === id ? "border-[#8B5CF6] bg-[#8B5CF6] text-white" : "border-zinc-200 bg-white text-zinc-600 dark:border-white/10 dark:bg-[#1A1A1E] dark:text-zinc-400"}`}>{label}</button>
        ))}
      </div>

      {user.role === "admin" && (data?.teams || []).length > 0 && (
        <select value={teamId} onChange={(event) => setTeamId(event.target.value)} className="h-12 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-black text-[#242735] outline-none focus:border-[#8B5CF6] dark:border-white/10 dark:bg-[#1A1A1E] dark:text-white">
          <option value="">Усі команди</option>
          {(data.teams || []).map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
        </select>
      )}

      {loading && !data && <div className="py-16 text-center text-sm font-black text-zinc-500">Збираємо аналітику…</div>}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Card icon={UsersRound} label="Операторів" value={data.summary.operators} detail={`${data.summary.active_operators} активні`} />
            <Card icon={Eye} label="Дивились звіти" value={data.summary.report_viewers} detail={`із ${data.summary.operators}`} accent="#0891B2" />
            <Card icon={Coins} label="Зароблено" value={formatNumber(data.summary.points_earned)} detail="Point за період" accent="#16A34A" />
            <Card icon={TrendingUp} label="Витрачено" value={formatNumber(data.summary.points_spent)} detail="Point за період" accent="#EA580C" />
            <Card icon={Gamepad2} label="Bonus Match" value={data.summary.bonus_match_activity} detail={`сер. рівень ${data.summary.average_bonus_level}`} accent="#7C3AED" />
            <Card icon={Search} label="VPDK Детектив" value={data.summary.hidden_object_activity} detail={`сер. рівень ${data.summary.average_hidden_object_level}`} accent="#FFB800" />
          </div>

          <Panel title="Активність і Point" subtitle="Щоденна динаміка за вибраний період" icon={Activity}>
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend} margin={{ left: -22, right: 4, top: 8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="activeGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#8B5CF6" stopOpacity={0.35}/><stop offset="95%" stopColor="#8B5CF6" stopOpacity={0}/></linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,140,.18)" />
                  <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#71717A" }} />
                  <YAxis tick={{ fontSize: 9, fill: "#71717A" }} />
                  <Tooltip contentStyle={{ borderRadius: 14, border: "1px solid #E4E4E7", fontSize: 11 }} />
                  <Area type="monotone" dataKey="active_users" name="Активні" stroke="#8B5CF6" fill="url(#activeGradient)" strokeWidth={2.5} />
                  <Area type="monotone" dataKey="views" name="Перегляди" stroke="#0891B2" fillOpacity={0} strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-3 h-52 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trend} margin={{ left: -22, right: 4, top: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,140,.18)" />
                  <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#71717A" }} />
                  <YAxis tick={{ fontSize: 9, fill: "#71717A" }} />
                  <Tooltip contentStyle={{ borderRadius: 14, border: "1px solid #E4E4E7", fontSize: 11 }} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Bar dataKey="earned" name="Зароблено" fill="#16A34A" radius={[5,5,0,0]} />
                  <Bar dataKey="spent" name="Витрачено" fill="#EA580C" radius={[5,5,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          <Panel title="Оператори" subtitle="Детально: які звіти й періоди відкривали за вибраний проміжок" icon={UserRoundCheck}>
            <div className="space-y-2">
              {(data.operators || []).map((operator) => {
                const expanded = Boolean(expandedOperators[operator.id]);
                const reportViews = operator.report_views || {};
                return (
                  <div key={operator.id} className="overflow-hidden rounded-2xl border border-zinc-100 bg-zinc-50 dark:border-white/5 dark:bg-black/20">
                    <div className="flex items-center gap-3 p-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-black text-black" style={{ backgroundColor: operator.avatar_color || "#FFB800" }}>{operator.avatar_initials || "?"}</div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-black text-[#242735] dark:text-white">{operator.name}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[9px] font-bold text-zinc-500">
                          <span className={operator.active ? "text-[#16A34A]" : "text-zinc-500"}>{operator.active ? "активний" : "не заходив"}</span>
                          <span className={operator.report_view_count ? "text-[#0891B2]" : "text-zinc-500"}>{operator.report_view_count || 0}/{operator.report_view_total || 0} звітів</span>
                        </div>
                      </div>
                      <div className="shrink-0 text-right text-[10px] font-black">
                        <div className="text-[#16A34A]">+{formatNumber(operator.earned)}</div>
                        <div className="text-[#EA580C]">−{formatNumber(operator.spent)}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setExpandedOperators((current) => ({ ...current, [operator.id]: !current[operator.id] }))}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-500 transition-transform active:scale-95 dark:border-white/10 dark:bg-white/[.04]"
                        aria-label={expanded ? "Згорнути деталізацію звітів" : "Розгорнути деталізацію звітів"}
                        aria-expanded={expanded}
                      >
                        <ChevronDown size={16} className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
                      </button>
                    </div>

                    {expanded && (
                      <div className="border-t border-zinc-200/70 px-3 pb-3 pt-2 dark:border-white/5">
                        <div className="mb-2 text-[8px] font-black uppercase tracking-[.15em] text-zinc-500">М = місяць · В = вчора</div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {REPORT_VIEW_GROUPS.map((group) => (
                            <div key={group.title} className="rounded-xl border border-zinc-200 bg-white/70 p-2 dark:border-white/5 dark:bg-white/[.025]">
                              <div className="mb-1.5 text-[9px] font-black uppercase tracking-wider text-[#7C3AED] dark:text-[#B78CFF]">{group.title}</div>
                              <div className="space-y-1">
                                {group.rows.map((row) => (
                                  <div key={row.label} className="flex min-h-7 items-center justify-between gap-2 rounded-lg bg-zinc-50 px-2 py-1 dark:bg-black/20">
                                    <span className="min-w-0 flex-1 truncate text-[9px] font-bold text-zinc-600 dark:text-zinc-400" title={row.label}>{row.label}</span>
                                    <div className="flex shrink-0 gap-1">
                                      {row.single ? (
                                        <ViewPill viewedAt={reportViews[row.single]} label={reportViews[row.single] ? "✓" : "—"} />
                                      ) : (
                                        <>
                                          <ViewPill viewedAt={reportViews[row.month]} label="М" />
                                          <ViewPill viewedAt={reportViews[row.yesterday]} label="В" />
                                        </>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Panel>

          {inactive.length > 0 && (
            <Panel title="Давно не заходили" subtitle="7 днів або більше без активності" icon={UserRoundX}>
              <div className="space-y-2">
                {inactive.map((operator) => <div key={operator.id} className="flex items-center justify-between rounded-xl bg-[#EF4444]/8 px-3 py-2.5"><span className="text-sm font-black text-[#242735] dark:text-white">{operator.name}</span><span className="text-[10px] font-black text-[#DC2626]">{operator.days_inactive >= 999 ? "ще не заходив" : `${operator.days_inactive} дн.`}</span></div>)}
              </div>
            </Panel>
          )}

          <Panel title="Популярні призи" subtitle="Що команда замовляє найчастіше" icon={Gift}>
            <div className="space-y-2">
              {(data.popular_prizes || []).map((prize, index) => <div key={`${prize.prize_id}-${index}`} className="flex items-center justify-between gap-3 rounded-xl bg-zinc-50 px-3 py-2.5 dark:bg-black/20"><div className="min-w-0 truncate text-sm font-black text-[#242735] dark:text-white">{prize.title || "Приз"}</div><div className="shrink-0 text-right"><div className="text-xs font-black text-[#8B5CF6]">{prize.orders} зам.</div><div className="text-[9px] text-zinc-500">{formatNumber(prize.points)} Point</div></div></div>)}
              {!(data.popular_prizes || []).length && <div className="py-5 text-center text-xs font-bold text-zinc-500">За цей період замовлень не було.</div>}
            </div>
          </Panel>

          <Panel title="Порівняння команд" subtitle="Активність і баланс руху Point" icon={BarChart3}>
            <div className="space-y-2">
              {(data.team_comparison || []).map((team, index) => {
                const net = Number(team.earned || 0) - Number(team.spent || 0);
                return <div key={team.team_id} className="rounded-2xl border border-zinc-100 bg-zinc-50 p-3 dark:border-white/5 dark:bg-black/20"><div className="flex items-center gap-3"><div className="font-display text-lg text-zinc-400">#{index + 1}</div><div className="h-3 w-3 rounded-full" style={{ backgroundColor: team.color }} /><div className="min-w-0 flex-1 truncate text-sm font-black text-[#242735] dark:text-white">{team.name}</div><div className={`font-black ${net >= 0 ? "text-[#16A34A]" : "text-[#DC2626]"}`}>{net >= 0 ? "+" : ""}{formatNumber(net)}</div></div><div className="mt-2 text-[9px] font-bold text-zinc-500">{team.active_users}/{team.members} активні · +{formatNumber(team.earned)} / −{formatNumber(team.spent)}</div></div>;
              })}
            </div>
          </Panel>

          <Panel title="Тренд Google-звітів" subtitle="Кредитний, дебетовий і депозитний підсумок після натискання «Оновити звіти»" icon={TrendingUp}>
            {reportTrend.length ? <div className="h-60 w-full"><ResponsiveContainer width="100%" height="100%"><AreaChart data={reportTrend} margin={{ left: -18, right: -8, top: 8 }}><CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,140,.18)"/><XAxis dataKey="label" tick={{ fontSize: 8, fill: "#71717A" }}/><YAxis yAxisId="percent" tick={{ fontSize: 9, fill: "#71717A" }}/><YAxis yAxisId="deposit" orientation="right" tick={{ fontSize: 9, fill: "#71717A" }}/><Tooltip contentStyle={{ borderRadius: 14, border: "1px solid #E4E4E7", fontSize: 11 }}/><Legend wrapperStyle={{ fontSize: 10 }}/><Area yAxisId="percent" type="monotone" dataKey="credit_overall" name="Кредит, %" stroke="#8B5CF6" fill="#8B5CF622" strokeWidth={2.5}/><Area yAxisId="percent" type="monotone" dataKey="debit_overall" name="Дебет, %" stroke="#0891B2" fill="#0891B222" strokeWidth={2.5}/><Area yAxisId="deposit" type="monotone" dataKey="deposit_overall" name="Депозити, видачі" stroke="#22C55E" fill="#22C55E22" strokeWidth={2.5}/></AreaChart></ResponsiveContainer></div> : <div className="py-6 text-center text-xs font-bold text-zinc-500">Тренд з’явиться після публікації наступних знімків Google-звітів.</div>}
          </Panel>
        </>
      )}
    </div>
  );
}
