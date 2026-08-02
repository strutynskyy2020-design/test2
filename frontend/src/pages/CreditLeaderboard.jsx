import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Eye,
  RefreshCcw,
  Target,
  Trophy,
  UserRound,
  UsersRound,
} from "lucide-react";
import api from "@/lib/api";
import { useApp } from "@/context/AppContext";
import { useDailyGoogleReports } from "@/hooks/useGoogleReports";
import { resolveAvatarUrl } from "@/lib/avatar";
import { useGoalsAccess } from "@/hooks/useGoalsAccess";
import {
  calculatedGroupSummary,
  enrichReportRowsWithParticipants,
  hasTeamMetadata,
  normalizeTeamKey,
  rowMatchesTeam,
} from "@/lib/teamReports";

const DEMO_GROUP_SUMMARY = {
  login: "tm6",
  xsell: 97.84,
  web_apps: 100.82,
  inb: 85.42,
  overall: 96.55,
};

const DEMO_LEADERBOARD = [
  { login: "nechylov", xsell: 187.46, web_apps: 132.44, inb: 99.12, overall: 147.78 },
  { login: "dmytriez", xsell: 138.97, web_apps: 159.82, inb: 0, overall: 147.31 },
  { login: "fedun", xsell: 120.96, web_apps: 163.83, inb: null, overall: 138.11 },
  { login: "kolomiek", xsell: 148.29, web_apps: 125.79, inb: 63.26, overall: 122.28 },
  { login: "kadura", xsell: 118.58, web_apps: 126.19, inb: null, overall: 121.63 },
  { login: "totkal", xsell: 150.45, web_apps: 76.09, inb: 0, overall: 120.71 },
  { login: "mukovoz", xsell: 102.81, web_apps: 122.61, inb: 91.58, overall: 108.49 },
  { login: "znachkoo", xsell: 112.49, web_apps: 85.26, inb: 122.25, overall: 103.55 },
  { login: "malashea", xsell: 124.03, web_apps: 94.86, inb: 43.05, overall: 96.17 },
  { login: "kostrubo", xsell: 89.23, web_apps: 106.75, inb: 82.14, overall: 94.82 },
  { login: "ipupatenko", xsell: 74.58, web_apps: 124.66, inb: null, overall: 94.61 },
  { login: "stets", xsell: 68.89, web_apps: 125.2, inb: null, overall: 91.41 },
  { login: "khomenaa", xsell: 78.35, web_apps: 106.78, inb: 0, overall: 89.72 },
  { login: "khamraku", xsell: 81.42, web_apps: 62.56, inb: null, overall: 73.87 },
  { login: "metelyud", xsell: 54.37, web_apps: 57.78, inb: null, overall: 55.73 },
  { login: "derpa", xsell: 28.57, web_apps: 59.04, inb: null, overall: 40.76 },
  { login: "danyledv", xsell: 24.98, web_apps: 47.73, inb: null, overall: 34.08 },
];

const GROUP_ALIASES = new Set(["tm6", "tm_6", "тм6", "група_tm6", "group_tm6"]);
const isGroupLogin = (value) => {
  const login = String(value || "").trim().toLowerCase();
  return GROUP_ALIASES.has(login)
    || /^(?:tm|тм)_?\d+$/i.test(login)
    || /^(?:група|group)_(?:tm|тм)_?\d+$/i.test(login);
};

const normalizeLogin = (value) => String(value || "").trim().toLowerCase();

const parsePercent = (value) => {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Number(
    String(value)
      .replace(/\u00a0/g, "")
      .replace(/\s+/g, "")
      .replace(/%$/, "")
      .replace(",", ".")
      .replace(/[^0-9.+-]/g, "")
  );
  return Number.isFinite(parsed) ? parsed : null;
};

const formatPercent = (value) => value === null || value === undefined
  ? "—"
  : `${Number(value).toLocaleString("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

const getStatus = (value) => {
  if (value === null || value === undefined) {
    return { color: "#71717A", bg: "rgba(113,113,122,.08)", border: "rgba(113,113,122,.22)", label: "Немає даних" };
  }
  if (value >= 100) {
    return { color: "#22C55E", bg: "rgba(34,197,94,.09)", border: "rgba(34,197,94,.28)", label: "Виконано" };
  }
  if (value >= 80) {
    return { color: "#F4B740", bg: "rgba(244,183,64,.10)", border: "rgba(244,183,64,.30)", label: "Зона росту" };
  }
  return { color: "#EF5350", bg: "rgba(239,83,80,.09)", border: "rgba(239,83,80,.28)", label: "Зона уваги" };
};

const normalizeRow = (row) => ({
  login: normalizeLogin(row?.login || row?.goals_login || row?.operator || row?.credit),
  xsell: parsePercent(row?.xsell ?? row?.x_sell ?? row?.["X-sell"]),
  web_apps: parsePercent(row?.web_apps ?? row?.webapps ?? row?.["Web apps"]),
  inb: parsePercent(row?.inb ?? row?.INB),
  overall: parsePercent(row?.overall ?? row?.general ?? row?.summary ?? row?.["Загальний"]),
  name: String(row?.name || "").trim(),
  avatar_url: row?.avatar_url || null,
  avatar_initials: String(row?.avatar_initials || "").trim(),
  avatar_color: row?.avatar_color || "#27272A",
  avatar_rarity: row?.avatar_rarity || "basic",
  team_id: String(row?.team_id || "").trim(),
  team_name: String(row?.team_name || "").trim(),
  team_key: normalizeTeamKey(row?.team_key || row?.team_name),
});

const normalizeLeaderboard = (rows) => {
  if (!Array.isArray(rows)) return [];
  return rows
    .map(normalizeRow)
    .filter((row) => row.login && !isGroupLogin(row.login) && row.overall !== null)
    .sort((a, b) => b.overall - a.overall || a.login.localeCompare(b.login, "uk"));
};

const normalizeGroupSummary = (summary, rows = []) => {
  const direct = summary ? normalizeRow(summary) : null;
  if (direct) return direct;

  const fallback = Array.isArray(rows)
    ? rows.map(normalizeRow).find((row) => isGroupLogin(row.login))
    : null;

  return fallback || null;
};

const findBestByDirection = (rows, field) => rows.reduce((best, row) => {
  const value = row[field];
  if (value === null || value === undefined) return best;
  if (!best || value > best.value) return { ...row, value };
  return best;
}, null);

function TableMetricValue({ label, value }) {
  const theme = getStatus(value);
  return (
    <div className="min-w-0 rounded-xl bg-black/20 px-1.5 py-2 text-center">
      <div className="truncate text-[7px] font-black uppercase tracking-wide text-zinc-600">{label}</div>
      <div className="mt-1 text-[10px] font-black tabular-nums" style={{ color: theme.color }}>
        {formatPercent(value)}
      </div>
    </div>
  );
}

function ProfileAvatar({ profile, size = "md" }) {
  const avatar = resolveAvatarUrl(profile?.avatar_url);
  const fallback = String(profile?.avatar_initials || profile?.login || "?").slice(0, 2).toUpperCase();
  const sizeClass = size === "lg" ? "h-12 w-12 text-xs" : "h-9 w-9 text-[10px]";
  return (
    <div
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/[.12] font-black text-white ${sizeClass}`}
      style={{ backgroundColor: profile?.avatar_color || "#27272A" }}
    >
      {avatar ? (
        <img src={avatar} alt={profile?.login || "Аватар"} className="h-full w-full object-cover" loading="lazy" />
      ) : fallback}
    </div>
  );
}

function GroupDirectionValue({ label, value }) {
  const theme = getStatus(value);
  return (
    <div className="rounded-2xl border p-3 text-center" style={{ borderColor: theme.border, background: theme.bg }}>
      <div className="text-[9px] font-black uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="mt-1 text-lg font-black" style={{ color: theme.color }}>{formatPercent(value)}</div>
    </div>
  );
}

function GroupOverallValue({ value, teamName = "TM6" }) {
  const theme = getStatus(value);
  return (
    <div className="credit-leaderboard-metric-card rounded-2xl border px-4 py-4 text-center" style={{ borderColor: theme.border }}>
      <div className="text-[10px] font-black uppercase tracking-[.16em] text-[#B78CFF]">{teamName} · Загальний</div>
      <div className="mt-1 font-display text-[32px] leading-none" style={{ color: theme.color }}>{formatPercent(value)}</div>
    </div>
  );
}

function BestDirectionCard({ label, result }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/25 p-3 text-center">
      <div className="flex items-center justify-center gap-1.5 text-[9px] font-black uppercase tracking-wider text-[#B78CFF]">
        <Trophy size={12} strokeWidth={2.8} />
        {label}
      </div>
      <div className="mt-2 flex flex-col items-center">
        <ProfileAvatar profile={result} size="lg" />
        <div className="mt-2 w-full break-words text-[12px] font-black leading-tight text-white">{result?.login || "—"}</div>
        <div className="mt-1 text-[22px] font-black leading-none text-[#39FF14]">{formatPercent(result?.value)}</div>
      </div>
    </div>
  );
}

function OperatorRow({ operator, rank, isCurrent }) {
  const overallTheme = getStatus(operator.overall);
  return (
    <article
      className={`credit-operator-row border-t px-3 py-4 ${isCurrent ? "is-current" : ""}`}
      style={{ borderColor: "var(--operator-divider, rgba(255,255,255,.075))" }}
    >
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-black/30 text-[11px] font-black text-zinc-300">{rank}</div>
        <ProfileAvatar profile={operator} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="break-all text-[13px] font-black leading-tight text-white">{operator.login}</h3>
            {isCurrent && <span className="rounded-full bg-[#B78CFF]/16 px-1.5 py-0.5 text-[7px] font-black uppercase text-[#C9A7FF]">Ви</span>}
          </div>
          <div className="mt-0.5 text-[8px] font-black uppercase tracking-wider" style={{ color: overallTheme.color }}>{overallTheme.label}</div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[8px] font-black uppercase tracking-wide text-zinc-600">Загальний</div>
          <div className="mt-0.5 text-[12px] font-black tabular-nums" style={{ color: overallTheme.color }}>{formatPercent(operator.overall)}</div>
        </div>
      </div>
      <div className="mt-2.5 grid grid-cols-4 gap-1.5">
        <TableMetricValue label="X-Sell" value={operator.xsell} />
        <TableMetricValue label="Web Apps" value={operator.web_apps} />
        <TableMetricValue label="INB" value={operator.inb} />
        <TableMetricValue label="Загальний" value={operator.overall} />
      </div>
    </article>
  );
}

export default function CreditLeaderboard() {
  const { mode, user } = useApp();
  const navigate = useNavigate();
  const { data: report, loading: reportsLoading, error } = useDailyGoogleReports();
  const { data: access, loading: accessLoading } = useGoalsAccess();
  const [participants, setParticipants] = useState([]);
  const [participantsLoading, setParticipantsLoading] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState(user?.team_id || "");

  useEffect(() => {
    if (mode === "mock") {
      setParticipants([]);
      setParticipantsLoading(false);
      return undefined;
    }

    if (Array.isArray(access?.participants)) {
      setParticipants(access.participants);
      setParticipantsLoading(false);
      return undefined;
    }

    if (accessLoading) return undefined;

    let cancelled = false;
    setParticipantsLoading(true);
    const loadParticipants = async () => {
      try {
        const response = await api.get("/goals/participants");
        return Array.isArray(response.data) ? response.data : [];
      } catch (_) {
        if (user?.role !== "admin" && user?.role !== "editor") return [];
        const [usersResult, teamsResult] = await Promise.allSettled([
          api.get("/admin/users"),
          api.get("/teams"),
        ]);
        const users = usersResult.status === "fulfilled" && Array.isArray(usersResult.value?.data)
          ? usersResult.value.data
          : [];
        const teams = teamsResult.status === "fulfilled" && Array.isArray(teamsResult.value?.data)
          ? teamsResult.value.data
          : [];
        const teamNames = Object.fromEntries(teams.map((team) => [team.id, team.name]));
        return users
          .filter((member) => member.role !== "admin" && (member.goals_login || member.goalsLogin || member.login2))
          .map((member) => ({
            ...member,
            goals_login: member.goals_login || member.goalsLogin || member.login2,
            team_name: member.team_name || teamNames[member.team_id] || "",
            team_key: normalizeTeamKey(member.team_name || teamNames[member.team_id] || ""),
          }));
      }
    };
    loadParticipants()
      .then((rows) => {
        if (!cancelled) setParticipants(rows);
      })
      .catch(() => {
        if (!cancelled) setParticipants([]);
      })
      .finally(() => {
        if (!cancelled) setParticipantsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [access?.participants, accessLoading, mode, user?.role]);

  useEffect(() => {
    if (!selectedTeamId && (access?.current_team?.id || user?.team_id)) {
      setSelectedTeamId(access?.current_team?.id || user?.team_id || "");
    }
  }, [access?.current_team?.id, selectedTeamId, user?.team_id]);

  const rawRows = mode === "mock"
    ? DEMO_LEADERBOARD
    : Array.isArray(report?.credit_leaderboard) ? report.credit_leaderboard : [];
  const rows = useMemo(
    () => mode === "mock" ? DEMO_LEADERBOARD : enrichReportRowsWithParticipants(rawRows, participants),
    [mode, participants, rawRows]
  );
  const availableTeams = mode === "mock"
    ? [{ id: "tm6", name: "TM6" }]
    : (Array.isArray(access?.teams) ? access.teams : []);
  const selectedTeam = availableTeams.find((team) => String(team.id) === String(selectedTeamId))
    || access?.current_team
    || availableTeams[0]
    || null;
  const updatedAt = mode === "mock"
    ? "демо-дані"
    : report?.credit_leaderboard_updated_at || report?.snapshot_updated_at || "";

  const currentLogin = normalizeLogin(user?.goals_login);
  const allLeaderboard = useMemo(() => normalizeLeaderboard(rows), [rows]);
  const leaderboard = useMemo(() => {
    if (mode === "mock" || !selectedTeam) return allLeaderboard;
    const matched = allLeaderboard.filter((row) => rowMatchesTeam(row, selectedTeam));
    if (matched.length) return matched;

    // When cross-team viewing is disabled, the Netlify gateway has already
    // restricted the payload to the viewer's permitted logins. In that case
    // it is safe to display the rows even if an older cached snapshot has no
    // team metadata yet.
    const gatewayAlreadyScoped = !access?.allow_cross_team_reports || availableTeams.length <= 1;
    return gatewayAlreadyScoped ? allLeaderboard : [];
  }, [access?.allow_cross_team_reports, allLeaderboard, availableTeams.length, mode, selectedTeam]);
  const groupSummary = useMemo(() => {
    if (mode === "mock") return DEMO_GROUP_SUMMARY;
    const teamKey = normalizeTeamKey(selectedTeam?.name);
    const published = teamKey ? report?.credit_group_summaries?.[teamKey] : null;
    return normalizeGroupSummary(published, [])
      || calculatedGroupSummary(leaderboard, ["xsell", "web_apps", "inb", "overall"], selectedTeam?.name || "");
  }, [leaderboard, mode, report?.credit_group_summaries, selectedTeam?.name]);
  const currentIndex = leaderboard.findIndex((row) => row.login === currentLogin);
  const currentOperator = currentIndex >= 0 ? leaderboard[currentIndex] : null;
  const completed = leaderboard.filter((row) => row.overall >= 100).length;
  const attention = leaderboard.filter((row) => row.overall < 90).length;
  const bestXsell = useMemo(() => findBestByDirection(leaderboard, "xsell"), [leaderboard]);
  const bestWebApps = useMemo(() => findBestByDirection(leaderboard, "web_apps"), [leaderboard]);
  const bestInb = useMemo(() => findBestByDirection(leaderboard, "inb"), [leaderboard]);

  const needsTeamMapping = mode !== "mock"
    && Boolean(selectedTeam)
    && Boolean(access?.allow_cross_team_reports)
    && availableTeams.length > 1;
  const waitingForTeamMapping = needsTeamMapping
    && rawRows.length > 0
    && !hasTeamMetadata(allLeaderboard)
    && (accessLoading || participantsLoading);
  const loading = mode !== "mock" && ((reportsLoading && !report) || waitingForTeamMapping);
  const teamMappingMissing = rawRows.length > 0
    && allLeaderboard.length > 0
    && leaderboard.length === 0
    && needsTeamMapping
    && !waitingForTeamMapping;
  const emptyMessage = error
    ? "Не вдалося завантажити рейтинг з опублікованого звіту."
    : report && !rawRows.length
      ? 'На вкладці "Аркуш2" не знайдено таблицю, де Credit є колонкою логінів операторів, а далі йдуть X-sell / Web apps / Inb / Загальний.'
      : teamMappingMissing
        ? `Звіт із Google Таблиці завантажено, але логіни операторів не зіставлено з командою ${selectedTeam?.name || ""}. Перевірте goals_login і команду користувачів в адмін-панелі.`
        : rawRows.length > 0 && !allLeaderboard.length
          ? "У таблиці знайдено рядки, але в них немає коректного загального результату."
          : "";

  if (loading) return <div className="p-8 text-center text-sm text-zinc-500">Завантаження рейтингу...</div>;

  return (
    <div className="space-y-4 px-5 pb-8 pt-2" data-testid="credit-leaderboard-page">
      <section className="flex items-start gap-3">
        <button type="button" onClick={() => navigate("/goals")} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-[#1A1A1E] text-zinc-300 active:scale-95" aria-label="Назад до цілей">
          <ArrowLeft size={21} strokeWidth={2.7} />
        </button>
        <div className="min-w-0 flex-1 pt-0.5">
          <h1 className="font-display text-[24px] leading-tight text-white">Кредитний рейтинг</h1>
          <div className="mt-1 text-xs font-bold text-zinc-500">Місячний результат · {selectedTeam?.name || "ваша команда"}</div>
          <div className="mt-1 flex items-center gap-1.5 text-[10px] font-bold text-zinc-600"><RefreshCcw size={11} />Оновлено: {updatedAt || "з Google Таблиці"}</div>
        </div>
      </section>

      {access?.allow_cross_team_reports && availableTeams.length > 1 && <section className="rounded-2xl border border-white/10 bg-[#1A1A1E] p-3">
        <label className="text-[9px] font-black uppercase tracking-widest text-zinc-500">Переглянути команду</label>
        <select value={selectedTeam?.id || ""} onChange={(event) => setSelectedTeamId(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-[#B78CFF]/30 bg-black/30 px-3 text-sm font-black text-white outline-none focus:border-[#B78CFF]">
          {availableTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
        </select>
      </section>}

      {leaderboard.length ? (
        <>
          <section className="rounded-3xl border border-[#B78CFF]/35 bg-gradient-to-br from-[#B78CFF]/15 to-[#1A1A1E] p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-black uppercase tracking-widest text-[#B78CFF]">Підсумок групи {selectedTeam?.name || "команди"}</div>
                <div className="mt-1 text-xs font-bold text-zinc-500">{leaderboard.length} операторів</div>
              </div>
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[#FFB800]/40 bg-[#FFB800]/15">
                <Trophy size={24} strokeWidth={2.8} color="#FFB800" />
              </div>
            </div>

            <div className="mt-4">
              <GroupOverallValue value={groupSummary?.overall} teamName={selectedTeam?.name || "Команда"} />
              <div className="mt-2 grid grid-cols-3 gap-2">
                <GroupDirectionValue label="X-Sell" value={groupSummary?.xsell} />
                <GroupDirectionValue label="Web Apps" value={groupSummary?.web_apps} />
                <GroupDirectionValue label="INB" value={groupSummary?.inb} />
              </div>
            </div>

            <div className="mt-4 text-[10px] font-black uppercase tracking-widest text-zinc-500">Кращий результат за напрямком</div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <BestDirectionCard label="X-Sell" result={bestXsell} />
              <BestDirectionCard label="Web Apps" result={bestWebApps} />
              <BestDirectionCard label="INB" result={bestInb} />
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl border border-[#39FF14]/20 bg-[#39FF14]/[.06] px-2 py-2"><div className="text-lg font-black text-[#39FF14]">{completed}</div><div className="text-[8px] font-black uppercase text-zinc-600">Виконали</div></div>
              <div className="rounded-xl border border-[#FFB800]/20 bg-[#FFB800]/[.06] px-2 py-2"><div className="text-lg font-black text-[#FFB800]">{leaderboard.length - completed - attention}</div><div className="text-[8px] font-black uppercase text-zinc-600">Зона росту</div></div>
              <div className="rounded-xl border border-[#FF4D55]/20 bg-[#FF4D55]/[.06] px-2 py-2"><div className="text-lg font-black text-[#FF4D55]">{attention}</div><div className="text-[8px] font-black uppercase text-zinc-600">Зона уваги</div></div>
            </div>
          </section>

          <section>
            <div className="mb-3 flex items-end justify-between px-1">
              <div>
                <div className="flex items-center gap-2"><UsersRound size={18} color="#B78CFF" /><h2 className="font-display text-xl text-white">Рейтинг операторів</h2></div>
                <div className="mt-1 text-[10px] font-bold text-zinc-600">Credit = оператор · показники: X-Sell, Web Apps, INB та Загальний</div>
              </div>
              <div className="text-right">
                <div className="text-[9px] font-black uppercase tracking-wider text-zinc-600">Показано всі</div>
                <div className="mt-0.5 text-xs font-black text-[#B78CFF]">{leaderboard.length}</div>
              </div>
            </div>
            <div className="overflow-hidden rounded-3xl border border-white/10 bg-[#1A1A1E]">
              {leaderboard.map((operator, index) => (
                <OperatorRow key={operator.login} operator={operator} rank={index + 1} isCurrent={operator.login === currentLogin} />
              ))}
            </div>
          </section>

          <section className="rounded-3xl border border-[#B78CFF]/45 bg-gradient-to-br from-[#7C3AED]/20 to-[#1A1A1E] p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[#B78CFF]/35 bg-[#B78CFF]/12 text-[#C9A7FF]">
                <UserRound size={23} strokeWidth={2.8} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-black uppercase tracking-widest text-[#B78CFF]">Ваша позиція</div>
                <div className="mt-0.5 text-lg font-black text-white">{currentOperator ? `${currentIndex + 1} із ${leaderboard.length}` : "Профіль не знайдено"}</div>
                <div className="text-xs font-bold text-zinc-500">{currentOperator ? `Загальний результат ${formatPercent(currentOperator.overall)}` : "Перевірте goals_login у профілі"}</div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => navigate("/goals/credit/me?channel=xsell&period=month")}
              className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-[#B78CFF]/55 bg-[#7C3AED] text-sm font-black text-white shadow-[0_8px_24px_rgba(124,58,237,.25)] active:scale-[.98]"
            >
              <Eye size={18} strokeWidth={2.8} />
              Переглянути мої показники
            </button>
          </section>
        </>
      ) : (
        <section className="rounded-3xl border border-white/10 bg-[#1A1A1E] p-6 text-center">
          <Target size={34} color="#B78CFF" className="mx-auto" />
          <h2 className="mt-3 font-display text-xl text-white">РЕЙТИНГ ЩЕ НЕ НАЛАШТОВАНО</h2>
          <p className="mt-2 text-sm leading-relaxed text-zinc-500">{emptyMessage || 'Додайте таблицю на вкладку "Аркуш2".'}</p>
        </section>
      )}
    </div>
  );
}
