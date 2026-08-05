import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Banknote,
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
import AvatarFrame from "@/components/AvatarFrame";
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
  inb_deb: 92.1,
  vse_card: null,
  web_fuib: 80.9,
  web_apps: 101.7,
  x_sell: 86.1,
  overall: 95,
};

const DEMO_LEADERBOARD = [
  { login: "kostrubo", inb_deb: 128, vse_card: null, web_fuib: null, web_apps: 112.8, x_sell: null, overall: 116.2 },
  { login: "danyledv", inb_deb: null, vse_card: null, web_fuib: null, web_apps: 112.8, x_sell: null, overall: 112.8 },
  { login: "kadura", inb_deb: null, vse_card: null, web_fuib: null, web_apps: 105.8, x_sell: 107.6, overall: 105.9 },
  { login: "ipupatenko", inb_deb: null, vse_card: null, web_fuib: null, web_apps: 105.3, x_sell: null, overall: 105.3 },
  { login: "nechylov", inb_deb: 120.5, vse_card: null, web_fuib: 59.3, web_apps: 112.8, x_sell: 107.6, overall: 104.6 },
  { login: "mukovoz", inb_deb: 128, vse_card: null, web_fuib: 106.7, web_apps: 97.3, x_sell: 107.6, overall: 102.1 },
  { login: "kolomiek", inb_deb: 108.3, vse_card: null, web_fuib: null, web_apps: 105.8, x_sell: 107.6, overall: 100.2 },
  { login: "malashea", inb_deb: 128, vse_card: null, web_fuib: null, web_apps: 98.7, x_sell: null, overall: 99.6 },
  { login: "fedun", inb_deb: null, vse_card: null, web_fuib: 106.7, web_apps: 94, x_sell: 107.6, overall: 98.3 },
  { login: "derpa", inb_deb: null, vse_card: null, web_fuib: null, web_apps: 95.5, x_sell: null, overall: 95.5 },
  { login: "totkal", inb_deb: 128, vse_card: null, web_fuib: null, web_apps: 56.4, x_sell: null, overall: 92.2 },
  { login: "stets", inb_deb: null, vse_card: null, web_fuib: null, web_apps: 112.8, x_sell: 107.6, overall: 91.8 },
  { login: "khomenaa", inb_deb: 73.1, vse_card: null, web_fuib: 88.9, web_apps: 112.8, x_sell: 107.6, overall: 90.6 },
  { login: "znachkoo", inb_deb: 76.8, vse_card: null, web_fuib: null, web_apps: 94, x_sell: 107.6, overall: 89.5 },
  { login: "dmytriez", inb_deb: 40.7, vse_card: null, web_fuib: null, web_apps: 104.1, x_sell: null, overall: 57.7 },
  { login: "metelyud", inb_deb: null, vse_card: null, web_fuib: null, web_apps: 37.6, x_sell: 107.6, overall: 55.1 },
];

const GROUP_ALIASES = new Set(["tm6", "tm_6", "тм6", "група_tm6", "group_tm6"]);
const isGroupLogin = (value) => {
  const login = String(value || "").trim().toLowerCase();
  return GROUP_ALIASES.has(login)
    || /^(?:tm|тм)_?\d+$/i.test(login)
    || /^(?:група|group)_(?:tm|тм)_?\d+$/i.test(login);
};

const DIRECTIONS = [
  { key: "inb_deb", label: "INB Debit" },
  { key: "vse_card", label: "Vse Card" },
  { key: "web_fuib", label: "Web Fuib" },
  { key: "web_apps", label: "Web Apps" },
  { key: "x_sell", label: "X-Sell" },
];

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
  login: normalizeLogin(row?.login || row?.goals_login || row?.operator || row?.debit),
  inb_deb: parsePercent(row?.inb_deb ?? row?.inbDebit ?? row?.["Inb_deb"]),
  vse_card: parsePercent(row?.vse_card ?? row?.vseCard ?? row?.["Vse_Card"]),
  web_fuib: parsePercent(row?.web_fuib ?? row?.webFuib ?? row?.["Web_Fuib"]),
  web_apps: parsePercent(row?.web_apps ?? row?.webapps ?? row?.["Web_apps"]),
  x_sell: parsePercent(row?.x_sell ?? row?.xsell ?? row?.["X_sell"]),
  overall: parsePercent(row?.overall ?? row?.general ?? row?.summary ?? row?.["Загальний deb"]),
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

function ProfileAvatar({ profile, size = "md" }) {
  const fallback = String(profile?.avatar_initials || profile?.login || "?").slice(0, 2).toUpperCase();
  return (
    <AvatarFrame
      src={profile?.avatar_url}
      alt={profile?.login || "Аватар"}
      initials={fallback}
      color={profile?.avatar_color || "#27272A"}
      rarity={profile?.avatar_rarity}
      size={size === "lg" ? "compact" : "xxs"}
    />
  );
}

function GroupOverallValue({ value, teamName = "TM6" }) {
  const theme = getStatus(value);
  return (
    <div className="debit-leaderboard-metric-card rounded-2xl border px-4 py-4 text-center" style={{ borderColor: theme.border }}>
      <div className="text-[10px] font-black uppercase tracking-[.16em] text-[#00F0FF]">{teamName} · Загальний</div>
      <div className="mt-1 font-display text-[32px] leading-none" style={{ color: theme.color }}>{formatPercent(value)}</div>
    </div>
  );
}

function GroupDirectionValue({ label, value }) {
  const theme = getStatus(value);
  return (
    <div className="rounded-2xl border p-3 text-center" style={{ borderColor: theme.border, background: theme.bg }}>
      <div className="text-[8px] font-black uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="mt-1 text-base font-black" style={{ color: theme.color }}>{formatPercent(value)}</div>
    </div>
  );
}

function BestDirectionCard({ label, result }) {
  return (
    <div className="diamond-card-auto rounded-2xl border border-white/10 bg-black/25 p-3 text-center">
      <div className="flex items-center justify-center gap-1.5 text-[8px] font-black uppercase tracking-wider text-[#00F0FF]">
        <Trophy size={11} strokeWidth={2.8} />
        {label}
      </div>
      <div className="mt-2 flex flex-col items-center">
        <ProfileAvatar profile={result} size="lg" />
        <div className="mt-2 w-full break-words text-[11px] font-black leading-tight text-white">{result?.login || "—"}</div>
        <div className="mt-1 text-lg font-black leading-none text-[#39FF14]">{formatPercent(result?.value)}</div>
      </div>
    </div>
  );
}

function TableMetricValue({ label, value }) {
  const theme = getStatus(value);
  return (
    <div className="min-w-0 rounded-xl bg-black/20 px-1.5 py-2 text-center">
      <div className="text-[7px] font-black uppercase leading-tight tracking-wide text-zinc-600">{label}</div>
      <div className="mt-1 text-[10px] font-black tabular-nums" style={{ color: theme.color }}>{formatPercent(value)}</div>
    </div>
  );
}

function OperatorRow({ operator, rank, isCurrent }) {
  const overallTheme = getStatus(operator.overall);
  return (
    <article
      className={`diamond-card-auto debit-operator-row border-t px-3 py-3 ${isCurrent ? "is-current" : ""}`}
      style={{ borderColor: "var(--operator-divider, rgba(255,255,255,.075))" }}
    >
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-black/30 text-[11px] font-black text-zinc-300">{rank}</div>
        <ProfileAvatar profile={operator} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="break-all text-[13px] font-black leading-tight text-white">{operator.login}</h3>
            {isCurrent && <span className="rounded-full bg-[#00F0FF]/12 px-1.5 py-0.5 text-[7px] font-black uppercase text-[#00F0FF]">Ви</span>}
          </div>
          <div className="mt-0.5 text-[8px] font-black uppercase tracking-wider" style={{ color: overallTheme.color }}>{overallTheme.label}</div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[8px] font-black uppercase tracking-wide text-zinc-600">Загальний</div>
          <div className="mt-0.5 text-[12px] font-black tabular-nums" style={{ color: overallTheme.color }}>{formatPercent(operator.overall)}</div>
        </div>
      </div>
      <div className="mt-2.5 grid grid-cols-3 gap-1.5">
        <TableMetricValue label="INB Debit" value={operator.inb_deb} />
        <TableMetricValue label="Vse Card" value={operator.vse_card} />
        <TableMetricValue label="Web Fuib" value={operator.web_fuib} />
        <TableMetricValue label="Web Apps" value={operator.web_apps} />
        <TableMetricValue label="X-Sell" value={operator.x_sell} />
        <TableMetricValue label="Загальний" value={operator.overall} />
      </div>
    </article>
  );
}

export default function DebitLeaderboard() {
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
    : Array.isArray(report?.debit_leaderboard) ? report.debit_leaderboard : [];
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
    : report?.debit_leaderboard_updated_at || report?.snapshot_updated_at || "";

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
    const published = teamKey ? report?.debit_group_summaries?.[teamKey] : null;
    return normalizeGroupSummary(published, [])
      || calculatedGroupSummary(leaderboard, ["inb_deb", "vse_card", "web_fuib", "web_apps", "x_sell", "overall"], selectedTeam?.name || "");
  }, [leaderboard, mode, report?.debit_group_summaries, selectedTeam?.name]);
  const currentIndex = leaderboard.findIndex((row) => row.login === currentLogin);
  const currentOperator = currentIndex >= 0 ? leaderboard[currentIndex] : null;
  const completed = leaderboard.filter((row) => row.overall >= 100).length;
  const attention = leaderboard.filter((row) => row.overall < 90).length;
  const bestByDirection = useMemo(
    () => DIRECTIONS.map((direction) => ({ ...direction, result: findBestByDirection(leaderboard, direction.key) })),
    [leaderboard]
  );

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
    ? "Не вдалося завантажити дебетовий рейтинг з опублікованого звіту."
    : report && !rawRows.length
      ? 'На вкладці "Аркуш2" не знайдено таблицю Debit / Inb_deb / Vse_Card / Web_Fuib / Web_apps / X_sell / Загальний deb.'
      : teamMappingMissing
        ? `Звіт із Google Таблиці завантажено, але логіни операторів не зіставлено з командою ${selectedTeam?.name || ""}. Перевірте goals_login і команду користувачів в адмін-панелі.`
        : rawRows.length > 0 && !allLeaderboard.length
          ? "У таблиці знайдено рядки, але в них немає коректного загального результату."
          : "";

  if (loading) return <div className="p-8 text-center text-sm text-zinc-500">Завантаження дебетового рейтингу...</div>;

  return (
    <div className="space-y-4 px-5 pb-8 pt-2" data-testid="debit-leaderboard-page">
      <section className="flex items-start gap-3">
        <button type="button" onClick={() => navigate("/goals")} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-[#1A1A1E] text-zinc-300 active:scale-95" aria-label="Назад до цілей">
          <ArrowLeft size={21} strokeWidth={2.7} />
        </button>
        <div className="min-w-0 flex-1 pt-0.5">
          <h1 className="font-display text-[24px] leading-tight text-white">Дебетовий рейтинг</h1>
          <div className="mt-1 text-xs font-bold text-zinc-500">Місячний результат · {selectedTeam?.name || "ваша команда"}</div>
          <div className="mt-1 flex items-center gap-1.5 text-[10px] font-bold text-zinc-600"><RefreshCcw size={11} />Оновлено: {updatedAt || "з Google Таблиці"}</div>
        </div>
      </section>

      {access?.allow_cross_team_reports && availableTeams.length > 1 && <section className="rounded-2xl border border-white/10 bg-[#1A1A1E] p-3">
        <label className="text-[9px] font-black uppercase tracking-widest text-zinc-500">Переглянути команду</label>
        <select value={selectedTeam?.id || ""} onChange={(event) => setSelectedTeamId(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-[#00F0FF]/30 bg-black/30 px-3 text-sm font-black text-white outline-none focus:border-[#00F0FF]">
          {availableTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
        </select>
      </section>}

      {leaderboard.length ? (
        <>
          <section className="rounded-3xl border border-[#00F0FF]/28 bg-gradient-to-br from-[#00F0FF]/10 to-[#1A1A1E] p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-black uppercase tracking-widest text-[#00F0FF]">Підсумок групи {selectedTeam?.name || "команди"}</div>
                <div className="mt-1 text-xs font-bold text-zinc-500">{leaderboard.length} операторів</div>
              </div>
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[#00F0FF]/35 bg-[#00F0FF]/10">
                <Banknote size={24} strokeWidth={2.8} color="#00F0FF" />
              </div>
            </div>

            <div className="mt-4">
              <GroupOverallValue value={groupSummary?.overall} teamName={selectedTeam?.name || "Команда"} />
              <div className="mt-2 grid grid-cols-2 gap-2">
                {DIRECTIONS.map((direction, index) => (
                  <div key={direction.key} className={index === DIRECTIONS.length - 1 ? "col-span-2" : ""}>
                    <GroupDirectionValue label={direction.label} value={groupSummary?.[direction.key]} />
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-4 text-[10px] font-black uppercase tracking-widest text-zinc-500">Кращий результат за напрямком</div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {bestByDirection.map((direction, index) => (
                <div key={direction.key} className={index === bestByDirection.length - 1 ? "col-span-2" : ""}>
                  <BestDirectionCard label={direction.label} result={direction.result} />
                </div>
              ))}
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
                <div className="flex items-center gap-2"><UsersRound size={18} color="#00F0FF" /><h2 className="font-display text-xl text-white">Рейтинг операторів</h2></div>
                <div className="mt-1 text-[10px] font-bold text-zinc-600">INB Debit, Vse Card, Web Fuib, Web Apps, X-Sell та Загальний</div>
              </div>
              <div className="text-right"><div className="text-[9px] font-black uppercase tracking-wider text-zinc-600">Показано всі</div><div className="mt-0.5 text-xs font-black text-[#00F0FF]">{leaderboard.length}</div></div>
            </div>
            <div className="overflow-hidden rounded-3xl border border-white/10 bg-[#1A1A1E]">
              {leaderboard.map((operator, index) => <OperatorRow key={operator.login} operator={operator} rank={index + 1} isCurrent={operator.login === currentLogin} />)}
            </div>
          </section>

          <section className="rounded-3xl border border-[#00F0FF]/35 bg-gradient-to-br from-[#00F0FF]/12 to-[#1A1A1E] p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[#00F0FF]/30 bg-[#00F0FF]/10 text-[#00F0FF]"><UserRound size={23} strokeWidth={2.8} /></div>
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-black uppercase tracking-widest text-[#00F0FF]">Ваша позиція</div>
                <div className="mt-0.5 text-lg font-black text-white">{currentOperator ? `${currentIndex + 1} із ${leaderboard.length}` : "Профіль не знайдено"}</div>
                <div className="text-xs font-bold text-zinc-500">{currentOperator ? `Загальний результат ${formatPercent(currentOperator.overall)}` : "Перевірте goals_login у профілі"}</div>
              </div>
            </div>
            <button type="button" onClick={() => navigate("/goals/debit/me?period=month")} className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-[#00F0FF]/45 bg-[#00BFD0] text-sm font-black text-black shadow-[0_8px_24px_rgba(0,240,255,.16)] active:scale-[.98]">
              <Eye size={18} strokeWidth={2.8} />
              Переглянути мої видачі
            </button>
          </section>
        </>
      ) : (
        <section className="rounded-3xl border border-white/10 bg-[#1A1A1E] p-6 text-center">
          <Target size={34} color="#00F0FF" className="mx-auto" />
          <h2 className="mt-3 font-display text-xl text-white">РЕЙТИНГ ЩЕ НЕ НАЛАШТОВАНО</h2>
          <p className="mt-2 text-sm leading-relaxed text-zinc-500">{emptyMessage || 'Додайте дебетову таблицю на вкладку "Аркуш2".'}</p>
        </section>
      )}
    </div>
  );
}
