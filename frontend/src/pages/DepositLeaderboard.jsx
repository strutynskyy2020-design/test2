import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, HandCoins, Landmark, RefreshCcw, Target, Trophy, UsersRound } from "lucide-react";
import { useApp } from "@/context/AppContext";
import { useDailyGoogleReports } from "@/hooks/useGoogleReports";
import { useGoalsAccess } from "@/hooks/useGoalsAccess";
import { enrichReportRowsWithParticipants, normalizeReportLogin, normalizeTeamKey, rowMatchesTeam } from "@/lib/teamReports";
import { resolveAvatarUrl } from "@/lib/avatar";

const PERIODS = [
  { id: "month", label: "Місяць" },
  { id: "yesterday", label: "Вчора" },
];

const DIRECTIONS = [
  { key: "inb", label: "INB", color: "#B78CFF" },
  { key: "vse", label: "VSE", color: "#39FF14" },
  { key: "web", label: "WEB", color: "#FFB800" },
  { key: "web_apps", label: "WEB APPS", color: "#00F0FF" },
];

const parseCount = (value) => {
  const parsed = Number(String(value ?? "").replace(/\u00a0/g, "").replace(/\s+/g, "").replace(",", ".").replace(/[^0-9.+-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeRows = (rows = []) => (Array.isArray(rows) ? rows : []).map((row) => ({
  ...row,
  login: normalizeReportLogin(row?.login || row?.goals_login),
  period: String(row?.period || "month").includes("yesterday") ? "yesterday" : "month",
  inb: parseCount(row?.inb),
  vse: parseCount(row?.vse),
  web: parseCount(row?.web),
  web_apps: parseCount(row?.web_apps),
  overall: parseCount(row?.overall),
}));

function Avatar({ row }) {
  const src = resolveAvatarUrl(row?.avatar_url);
  const fallback = String(row?.avatar_initials || row?.login || "?").slice(0, 2).toUpperCase();
  return (
    <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-[#27272A] text-xs font-black text-white" style={{ backgroundColor: row?.avatar_color || "#27272A" }}>
      {src ? <img src={src} alt={row?.login || "Аватар"} className="h-full w-full object-cover" /> : fallback}
    </div>
  );
}

export default function DepositLeaderboard() {
  const { user } = useApp();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: report, loading, error } = useDailyGoogleReports();
  const { data: access } = useGoalsAccess();
  const [selectedTeamId, setSelectedTeamId] = useState(user?.team_id || "");
  const requestedPeriod = searchParams.get("period");
  const period = PERIODS.some((item) => item.id === requestedPeriod) ? requestedPeriod : "month";

  useEffect(() => {
    if (!selectedTeamId && (access?.current_team?.id || user?.team_id)) setSelectedTeamId(access?.current_team?.id || user?.team_id || "");
  }, [access?.current_team?.id, selectedTeamId, user?.team_id]);

  const teams = Array.isArray(access?.teams) ? access.teams : [];
  const selectedTeam = teams.find((team) => String(team.id) === String(selectedTeamId)) || access?.current_team || teams[0] || null;
  const enriched = useMemo(() => enrichReportRowsWithParticipants(normalizeRows(report?.deposit_leaderboard), access?.participants || []), [access?.participants, report?.deposit_leaderboard]);
  const rows = useMemo(() => {
    const periodRows = enriched.filter((row) => row.period === period);
    if (!selectedTeam) return periodRows.sort((a, b) => b.overall - a.overall);
    const matched = periodRows.filter((row) => rowMatchesTeam(row, selectedTeam));
    const gatewayScoped = !access?.allow_cross_team_reports || teams.length <= 1;
    return (matched.length ? matched : gatewayScoped ? periodRows : []).sort((a, b) => b.overall - a.overall);
  }, [access?.allow_cross_team_reports, enriched, period, selectedTeam, teams.length]);

  const teamKey = normalizeTeamKey(selectedTeam?.name);
  const rawSummary = report?.deposit_group_summaries?.[period]?.[teamKey] || null;
  const summary = rawSummary ? {
    inb: parseCount(rawSummary.inb), vse: parseCount(rawSummary.vse), web: parseCount(rawSummary.web), web_apps: parseCount(rawSummary.web_apps), overall: parseCount(rawSummary.overall),
  } : {
    inb: rows.reduce((sum, row) => sum + row.inb, 0),
    vse: rows.reduce((sum, row) => sum + row.vse, 0),
    web: rows.reduce((sum, row) => sum + row.web, 0),
    web_apps: rows.reduce((sum, row) => sum + row.web_apps, 0),
    overall: rows.reduce((sum, row) => sum + row.overall, 0),
  };
  const currentLogin = normalizeReportLogin(user?.goals_login);
  const bestDirection = DIRECTIONS.map((direction) => ({ ...direction, row: [...rows].sort((a, b) => b[direction.key] - a[direction.key])[0] })).sort((a, b) => (b.row?.[b.key] || 0) - (a.row?.[a.key] || 0))[0];

  const setPeriod = (value) => {
    const next = new URLSearchParams(searchParams);
    next.set("period", value);
    setSearchParams(next, { replace: true });
  };

  if (loading && !report) return <div className="p-8 text-center text-sm font-bold text-zinc-500">Завантаження депозитного рейтингу…</div>;

  return (
    <div className="space-y-4 px-5 pb-8 pt-2" data-testid="deposit-leaderboard-page">
      <section className="flex items-start gap-3">
        <button type="button" onClick={() => navigate("/goals")} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-[#1A1A1E] text-zinc-300 active:scale-95"><ArrowLeft size={21} strokeWidth={2.7} /></button>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[26px] leading-tight text-white">Депозитний рейтинг</h1>
          <div className="mt-1 text-xs font-bold text-zinc-500">{period === "month" ? "Місячні видачі" : "Видачі за вчора"} · {selectedTeam?.name || "ваша команда"}</div>
          <div className="mt-1 flex items-center gap-1.5 text-[10px] font-bold text-zinc-600"><RefreshCcw size={11} />Оновлено: {report?.deposit_leaderboard_updated_at || report?.snapshot_updated_at || "з Google Таблиці"}</div>
        </div>
      </section>

      <div className="grid grid-cols-2 rounded-2xl border border-white/10 bg-[#151519] p-1">
        {PERIODS.map((item) => <button key={item.id} onClick={() => setPeriod(item.id)} className={`min-h-12 rounded-xl text-xs font-black ${period === item.id ? "border border-[#39FF14]/45 bg-[#39FF14]/10 text-[#39FF14]" : "text-zinc-400"}`}>{item.label}</button>)}
      </div>

      {access?.allow_cross_team_reports && teams.length > 1 && (
        <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
          {teams.map((team) => <button key={team.id} onClick={() => setSelectedTeamId(team.id)} className={`h-10 shrink-0 rounded-full border px-4 text-xs font-black ${String(selectedTeam?.id) === String(team.id) ? "border-[#39FF14] bg-[#39FF14]/10 text-[#39FF14]" : "border-white/10 bg-[#1A1A1E] text-zinc-400"}`}>{team.name}</button>)}
        </div>
      )}

      <section className="rounded-3xl border border-[#39FF14]/30 bg-gradient-to-br from-[#39FF14]/10 to-[#1A1A1E] p-5">
        <div className="flex items-center justify-between gap-3">
          <div><div className="text-[10px] font-black uppercase tracking-[.18em] text-[#39FF14]">Підсумок команди</div><div className="mt-1 text-xs font-bold text-zinc-500">{rows.length} операторів у звіті</div></div>
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[#FFB800]/35 bg-[#FFB800]/10 text-[#FFB800]"><Trophy size={23} strokeWidth={2.8} /></div>
        </div>
        <div className="mt-4 font-display text-[46px] leading-none text-[#39FF14]">{summary.overall.toLocaleString("uk-UA")}</div>
        <div className="mt-1 text-xs font-black uppercase tracking-wider text-zinc-500">загальний підсумок видач</div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {DIRECTIONS.map((direction) => <div key={direction.key} className="rounded-2xl border border-white/10 bg-black/25 p-3"><div className="text-[9px] font-black uppercase tracking-wider text-zinc-600">{direction.label}</div><div className="mt-1 text-xl font-black" style={{ color: direction.color }}>{summary[direction.key].toLocaleString("uk-UA")}</div></div>)}
        </div>
      </section>

      <button type="button" onClick={() => navigate(`/goals/deposit/me?period=${period}`)} className="flex w-full items-center gap-3 rounded-2xl border border-[#39FF14]/25 bg-[#39FF14]/[.06] p-4 text-left active:scale-[.99]">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#39FF14]/10 text-[#39FF14]"><Target size={21} strokeWidth={2.8} /></div>
        <div className="min-w-0 flex-1"><div className="font-black text-white">Мої депозитні показники</div><div className="mt-1 text-xs text-zinc-500">Проекційний результат, конверсії та видачі</div></div>
      </button>

      {!rows.length ? (
        <section className="rounded-3xl border border-white/10 bg-[#1A1A1E] p-7 text-center">
          <Landmark size={38} className="mx-auto text-[#39FF14]" />
          <h2 className="mt-3 font-display text-xl text-white">ДЕПОЗИТНИЙ РЕЙТИНГ ЩЕ НЕ ЗНАЙДЕНО</h2>
          <p className="mt-2 text-sm leading-relaxed text-zinc-500">{error ? "Не вдалося завантажити опублікований звіт." : 'Перевірте блоки "Giving month" і "Giving yesterday" на вкладці Deposit.'}</p>
        </section>
      ) : (
        <section className="overflow-hidden rounded-3xl border border-white/10 bg-[#1A1A1E]">
          <div className="flex items-center justify-between p-4"><div><h2 className="font-display text-xl text-white">Рейтинг операторів</h2><p className="mt-1 text-xs text-zinc-500">Сортування за загальним підсумком</p></div><UsersRound size={21} className="text-[#39FF14]" /></div>
          {bestDirection?.row && <div className="mx-4 mb-3 flex items-center gap-3 rounded-2xl border border-[#FFB800]/20 bg-[#FFB800]/[.06] p-3"><Trophy size={18} className="text-[#FFB800]" /><div className="min-w-0 flex-1"><div className="text-[9px] font-black uppercase tracking-wider text-zinc-500">Найкращий напрямок · {bestDirection.label}</div><div className="truncate text-sm font-black text-white">{bestDirection.row.name || bestDirection.row.login}</div></div><div className="text-xl font-black text-[#FFB800]">{bestDirection.row[bestDirection.key]}</div></div>}
          <div>
            {rows.map((row, index) => {
              const current = row.login === currentLogin;
              return (
                <article key={`${row.login}-${index}`} className={`border-t border-white/[.07] px-4 py-3 ${current ? "bg-[#39FF14]/[.05]" : ""}`}>
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-black/25 text-xs font-black text-zinc-400">{index + 1}</div>
                    <Avatar row={row} />
                    <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><div className="truncate text-sm font-black text-white">{row.name || row.login}</div>{current && <span className="rounded-full bg-[#39FF14]/10 px-2 py-0.5 text-[8px] font-black uppercase text-[#39FF14]">Ви</span>}</div><div className="mt-1 truncate text-[10px] font-bold text-zinc-500">{row.login}</div></div>
                    <div className="text-right"><div className="font-display text-2xl text-[#39FF14]">{row.overall}</div><div className="text-[8px] font-black uppercase tracking-wider text-zinc-600">видач</div></div>
                  </div>
                  <div className="mt-3 grid grid-cols-4 gap-1.5">
                    {DIRECTIONS.map((direction) => <div key={direction.key} className="rounded-xl bg-black/20 px-1 py-2 text-center"><div className="text-[7px] font-black uppercase text-zinc-600">{direction.label}</div><div className="mt-1 text-[11px] font-black" style={{ color: direction.color }}>{row[direction.key]}</div></div>)}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
