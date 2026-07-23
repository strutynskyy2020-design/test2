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
import { toast } from "sonner";
import api, { getToken } from "@/lib/api";
import { useApp } from "@/context/AppContext";
import { resolveAvatarUrl } from "@/lib/avatar";

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
    return { color: "#39FF14", bg: "rgba(57,255,20,.09)", border: "rgba(57,255,20,.28)", label: "Виконано" };
  }
  if (value >= 90) {
    return { color: "#FFB800", bg: "rgba(255,184,0,.09)", border: "rgba(255,184,0,.28)", label: "Зона росту" };
  }
  return { color: "#FF4D55", bg: "rgba(255,77,85,.09)", border: "rgba(255,77,85,.28)", label: "Зона уваги" };
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
});

const profileMapFromRows = (profiles = []) => new Map(
  (Array.isArray(profiles) ? profiles : [])
    .map((profile) => [normalizeLogin(profile?.goals_login), profile])
    .filter(([login]) => login)
);

const enrichRowsWithProfiles = (rows = [], profiles = []) => {
  const profilesByLogin = profileMapFromRows(profiles);
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const login = normalizeLogin(row?.login || row?.goals_login || row?.operator || row?.credit);
    const profile = profilesByLogin.get(login);
    return profile ? { ...row, ...profile, login } : row;
  });
};

const normalizeLeaderboard = (rows) => {
  if (!Array.isArray(rows)) return [];
  return rows
    .map(normalizeRow)
    .filter((row) => row.login && !GROUP_ALIASES.has(row.login) && row.overall !== null)
    .sort((a, b) => b.overall - a.overall || a.login.localeCompare(b.login, "uk"));
};

const normalizeGroupSummary = (summary, rows = []) => {
  const direct = summary ? normalizeRow(summary) : null;
  if (direct?.login && GROUP_ALIASES.has(direct.login)) return direct;

  const fallback = Array.isArray(rows)
    ? rows.map(normalizeRow).find((row) => GROUP_ALIASES.has(row.login))
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

function GroupOverallValue({ value }) {
  const theme = getStatus(value);
  return (
    <div className="rounded-2xl border px-4 py-4 text-center" style={{ borderColor: theme.border, background: "linear-gradient(135deg, rgba(124,58,237,.2), rgba(26,26,30,.94))" }}>
      <div className="text-[10px] font-black uppercase tracking-[.16em] text-[#B78CFF]">TM6 · Загальний</div>
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
      className="border-t px-3 py-3"
      style={{
        borderColor: "rgba(255,255,255,.075)",
        background: isCurrent ? "linear-gradient(90deg, rgba(124,58,237,.22), rgba(26,26,30,.94))" : "transparent",
      }}
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
  const [rows, setRows] = useState(mode === "mock" ? DEMO_LEADERBOARD : []);
  const [groupSummary, setGroupSummary] = useState(mode === "mock" ? DEMO_GROUP_SUMMARY : null);
  const [loading, setLoading] = useState(mode !== "mock");
  const [emptyMessage, setEmptyMessage] = useState("");
  const [updatedAt, setUpdatedAt] = useState("");

  useEffect(() => {
    if (mode === "mock") {
      setRows(DEMO_LEADERBOARD);
      setGroupSummary(DEMO_GROUP_SUMMARY);
      setLoading(false);
      setUpdatedAt("демо-дані");
      return;
    }

    let cancelled = false;
    const load = async ({ silent = false } = {}) => {
      try {
        if (!silent) setLoading(true);
        setEmptyMessage("");
        const token = getToken();
        if (!token) throw new Error("Потрібна авторизація");
        const [response, participantsResponse] = await Promise.all([
          fetch(`/.netlify/functions/google-goals?_ts=${Date.now()}`, {
            method: "GET",
            headers: {
              accept: "application/json",
              authorization: `Bearer ${token}`,
              "cache-control": "no-cache",
            },
            cache: "no-store",
          }),
          api.get("/goals/participants").catch(() => ({ data: [] })),
        ]);
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "Не вдалося завантажити рейтинг");
        if (cancelled) return;

        const rawRows = Array.isArray(result.credit_leaderboard) ? result.credit_leaderboard : [];
        const enrichedRows = enrichRowsWithProfiles(rawRows, participantsResponse?.data);
        const leaderboard = normalizeLeaderboard(enrichedRows);
        const summary = normalizeGroupSummary(result.credit_group_summary, rawRows);
        setRows(leaderboard);
        setGroupSummary(summary);
        setUpdatedAt(result.results_published_at || result.credit_leaderboard_updated_at || "з Google Таблиці");
        if (!leaderboard.length) {
          setEmptyMessage(
            result.reason === "results_not_published"
              ? 'Результати ще не опубліковано. У Google Таблиці натисніть «TM6 Bonus → Оновити результати».'
              : 'На вкладці "Аркуш2" не знайдено таблицю, де Credit є колонкою логінів операторів, а далі йдуть X-sell / Web apps / Inb / Загальний.'
          );
        }
      } catch (error) {
        if (!cancelled && !silent) {
          setRows([]);
          setGroupSummary(null);
          setEmptyMessage("Не вдалося завантажити рейтинг з Google Таблиці.");
          toast.error(error.message || "Помилка завантаження рейтингу");
        }
      } finally {
        if (!cancelled && !silent) setLoading(false);
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [mode]);

  const currentLogin = normalizeLogin(user?.goals_login);
  const leaderboard = useMemo(() => normalizeLeaderboard(rows), [rows]);
  const currentIndex = leaderboard.findIndex((row) => row.login === currentLogin);
  const currentOperator = currentIndex >= 0 ? leaderboard[currentIndex] : null;
  const completed = leaderboard.filter((row) => row.overall >= 100).length;
  const attention = leaderboard.filter((row) => row.overall < 90).length;
  const bestXsell = useMemo(() => findBestByDirection(leaderboard, "xsell"), [leaderboard]);
  const bestWebApps = useMemo(() => findBestByDirection(leaderboard, "web_apps"), [leaderboard]);
  const bestInb = useMemo(() => findBestByDirection(leaderboard, "inb"), [leaderboard]);

  if (loading) return <div className="p-8 text-center text-sm text-zinc-500">Завантаження рейтингу...</div>;

  return (
    <div className="space-y-4 px-5 pb-8 pt-2" data-testid="credit-leaderboard-page">
      <section className="flex items-start gap-3">
        <button type="button" onClick={() => navigate("/goals")} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-[#1A1A1E] text-zinc-300 active:scale-95" aria-label="Назад до цілей">
          <ArrowLeft size={21} strokeWidth={2.7} />
        </button>
        <div className="min-w-0 flex-1 pt-0.5">
          <h1 className="font-display text-[24px] leading-tight text-white">Кредитний рейтинг</h1>
          <div className="mt-1 text-xs font-bold text-zinc-500">Місячний результат усієї компанії</div>
          <div className="mt-1 flex items-center gap-1.5 text-[10px] font-bold text-zinc-600"><RefreshCcw size={11} />Оновлено: {updatedAt || "з Google Таблиці"}</div>
        </div>
      </section>

      {leaderboard.length ? (
        <>
          <section className="rounded-3xl border border-[#B78CFF]/35 bg-gradient-to-br from-[#B78CFF]/15 to-[#1A1A1E] p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-black uppercase tracking-widest text-[#B78CFF]">Підсумок групи TM6</div>
                <div className="mt-1 text-xs font-bold text-zinc-500">{leaderboard.length} операторів</div>
              </div>
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[#FFB800]/40 bg-[#FFB800]/15">
                <Trophy size={24} strokeWidth={2.8} color="#FFB800" />
              </div>
            </div>

            <div className="mt-4">
              <GroupOverallValue value={groupSummary?.overall} />
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
