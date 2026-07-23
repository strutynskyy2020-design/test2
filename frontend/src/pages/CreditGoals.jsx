import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  Clock3,
  PhoneCall,
  RefreshCcw,
  ShieldCheck,
  Target,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  UsersRound,
} from "lucide-react";
import { toast } from "sonner";
import { getToken } from "@/lib/api";
import { useApp } from "@/context/AppContext";

const CHANNELS = [
  { id: "xsell", label: "X-Sell", aliases: ["xsell", "x_sell", "x-sell"] },
  { id: "web_apps", label: "Web Apps", aliases: ["web_apps", "webapps", "web_app"] },
  { id: "inb", label: "INB", aliases: ["inb"] },
];

const PERIODS = [
  { id: "month", label: "Місяць", aliases: ["month", "monthly", "mtd"] },
  { id: "yesterday", label: "Вчора", aliases: ["yesterday", "day", "daily"] },
];

const STATUS_THEME = {
  good: {
    color: "#39FF14",
    bg: "rgba(57,255,20,.09)",
    border: "rgba(57,255,20,.32)",
    label: "Добре",
  },
  warning: {
    color: "#FFB800",
    bg: "rgba(255,184,0,.09)",
    border: "rgba(255,184,0,.32)",
    label: "Зона росту",
  },
  bad: {
    color: "#FF4D55",
    bg: "rgba(255,77,85,.09)",
    border: "rgba(255,77,85,.32)",
    label: "Потрібна увага",
  },
  neutral: {
    color: "#00F0FF",
    bg: "rgba(0,240,255,.08)",
    border: "rgba(0,240,255,.28)",
    label: "На рівні",
  },
};

const METRICS = [
  {
    id: "agreement",
    label: "Рівень згод",
    aliases: ["agreement_rate", "consent_rate", "agreement", "level_of_agreement"],
    unit: "percent",
    rule: "higher",
    icon: ShieldCheck,
  },
  {
    id: "callback",
    label: "Рівень колбеків",
    aliases: ["callback_rate", "callback", "callback_to_processed"],
    unit: "percent",
    rule: "lower",
    icon: PhoneCall,
  },
  {
    id: "aht",
    label: "Довжина розмови",
    aliases: ["aht", "aht_seconds", "average_handle_time"],
    unit: "time",
    rule: "aht15",
    icon: Clock3,
  },
  {
    id: "reject",
    label: "Відмови банку",
    aliases: ["reject_rate", "reject", "decline_rate"],
    unit: "percent",
    rule: "lower",
    icon: ShieldCheck,
  },
  {
    id: "issuance",
    label: "Выдач к обработанным",
    aliases: ["issuance_rate", "issue_rate", "issuance_to_processed", "issued_to_processed"],
    unit: "percent",
    rule: "higher",
    icon: BarChart3,
  },
  {
    id: "projective",
    label: "Проекційний",
    aliases: ["projective_rate", "projective", "projective_tr_rate_xsaleo"],
    unit: "percent",
    rule: "projective100",
    icon: Target,
  },
];

const FEDUN_DEMO = {
  updated_at: "сьогодні, 09:30",
  xsell: {
    month: {
      processed: 62,
      processed_overall: 641,
      metrics: {
        agreement: { mine: 11.29, overall: 5.93 },
        callback: { mine: 50.0, overall: 42.12 },
        aht: { mine: 96, overall: 70 },
        reject: { mine: 0.0, overall: 5.56 },
        issuance: { mine: 1.61, overall: 2.03 },
        projective: { mine: 90.63, overall: 80.39 },
      },
    },
    yesterday: {
      processed: 8,
      processed_overall: 71,
      metrics: {
        agreement: { mine: 12.5, overall: 6.6 },
        callback: { mine: 37.5, overall: 29.2 },
        aht: { mine: 82, overall: 65 },
        reject: { mine: 0.0, overall: 9.01 },
        issuance: { mine: 0.0, overall: 1.28 },
        projective: { mine: 96.4, overall: 80.39 },
      },
    },
  },
  web_apps: {
    month: {
      processed: 34,
      processed_overall: 302,
      metrics: {
        agreement: { mine: 9.8, overall: 7.1 },
        callback: { mine: 31.4, overall: 35.8 },
        aht: { mine: 74, overall: 68 },
        reject: { mine: 4.2, overall: 5.1 },
        issuance: { mine: 2.8, overall: 2.2 },
        projective: { mine: 104.2, overall: 92.6 },
      },
    },
    yesterday: {
      processed: 4,
      processed_overall: 36,
      metrics: {
        agreement: { mine: 10.2, overall: 7.0 },
        callback: { mine: 25.0, overall: 33.3 },
        aht: { mine: 69, overall: 66 },
        reject: { mine: 0.0, overall: 4.9 },
        issuance: { mine: 3.1, overall: 2.3 },
        projective: { mine: 108.0, overall: 93.0 },
      },
    },
  },
  inb: {
    month: {
      processed: 21,
      processed_overall: 188,
      metrics: {
        agreement: { mine: 8.4, overall: 7.9 },
        callback: { mine: 46.2, overall: 40.6 },
        aht: { mine: 78, overall: 72 },
        reject: { mine: 3.2, overall: 4.4 },
        issuance: { mine: 2.6, overall: 2.1 },
        projective: { mine: 101.8, overall: 95.4 },
      },
    },
    yesterday: {
      processed: 3,
      processed_overall: 22,
      metrics: {
        agreement: { mine: 9.1, overall: 7.7 },
        callback: { mine: 33.3, overall: 39.5 },
        aht: { mine: 75, overall: 70 },
        reject: { mine: 0.0, overall: 4.1 },
        issuance: { mine: 3.0, overall: 2.0 },
        projective: { mine: 103.5, overall: 94.9 },
      },
    },
  },
};

const normalizeHeader = (value) => String(value || "")
  .trim()
  .toLowerCase()
  .replace(/[^a-zа-яіїєґ0-9]+/gi, "_")
  .replace(/^_+|_+$/g, "");

const normalizeRow = (row = {}) => Object.fromEntries(
  Object.entries(row).map(([key, value]) => [normalizeHeader(key), value])
);

const parseNumber = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const source = String(value ?? "").trim();
  if (!source) return null;
  const normalized = source
    .replace(/\u00a0/g, "")
    .replace(/\s+/g, "")
    .replace(/%$/, "")
    .replace(",", ".")
    .replace(/[^0-9.+-]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseTimeSeconds = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const source = String(value ?? "").trim();
  if (!source) return null;
  if (/^\d+(?:[.,]\d+)?$/.test(source)) return Number(source.replace(",", "."));
  const parts = source.split(":").map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part))) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
};

const formatTime = (seconds) => {
  const safe = Math.max(0, Math.round(Number(seconds || 0)));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
};

const formatValue = (value, unit) => unit === "time"
  ? formatTime(value)
  : `${Number(value || 0).toLocaleString("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

const findValue = (row, candidates) => {
  for (const candidate of candidates) {
    const key = normalizeHeader(candidate);
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== "") return row[key];
  }
  return null;
};

const combinations = (channel, period, metricAliases, kind = "mine") => {
  const channelAliases = CHANNELS.find((item) => item.id === channel)?.aliases || [channel];
  const periodAliases = PERIODS.find((item) => item.id === period)?.aliases || [period];
  const kindAliases = kind === "overall" ? ["overall", "general", "summary", "team", "total"] : ["mine", "my", "actual", "result", ""];
  const values = [];

  for (const channelAlias of channelAliases) {
    for (const periodAlias of periodAliases) {
      for (const metricAlias of metricAliases) {
        for (const kindAlias of kindAliases) {
          const suffix = kindAlias ? `${kindAlias}_${metricAlias}` : metricAlias;
          values.push(`credit_${channelAlias}_${periodAlias}_${suffix}`);
          values.push(`${channelAlias}_${periodAlias}_${suffix}`);
          values.push(`credits_${channelAlias}_${periodAlias}_${suffix}`);
        }
      }
    }
  }

  if (kind === "overall") {
    for (const metricAlias of metricAliases) {
      values.push(`credit_overall_${metricAlias}`);
      values.push(`overall_${metricAlias}`);
      values.push(`general_${metricAlias}`);
    }
  }

  return values;
};

const buildDetailsFromMetricRows = (rows = []) => {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const result = { updated_at: "" };
  let foundAny = false;

  for (const channel of CHANNELS) result[channel.id] = {};

  for (const rawRow of rows) {
    const row = normalizeRow(rawRow);
    const rawChannel = normalizeHeader(findValue(row, ["channel", "direction", "credit_channel"]));
    const rawPeriod = normalizeHeader(findValue(row, ["period", "report_period", "range"]));
    const channel = CHANNELS.find((item) => item.aliases.map(normalizeHeader).includes(rawChannel));
    const period = PERIODS.find((item) => item.aliases.map(normalizeHeader).includes(rawPeriod));
    if (!channel || !period) continue;

    const metrics = {};
    for (const metric of METRICS) {
      const mineRaw = findValue(row, metric.aliases);
      const overallRaw = findValue(row, metric.aliases.flatMap((alias) => [
        `${alias}_overall`,
        `${alias}_general`,
        `${alias}_summary`,
        `overall_${alias}`,
        `general_${alias}`,
      ]));
      const parser = metric.unit === "time" ? parseTimeSeconds : parseNumber;
      const mine = parser(mineRaw);
      const overall = parser(overallRaw);
      metrics[metric.id] = { mine, overall };
      if (mine !== null || overall !== null) foundAny = true;
    }

    const processed = parseNumber(findValue(row, ["processed_tasks", "processed", "tasks"])) ?? 0;
    const processedOverall = parseNumber(findValue(row, [
      "processed_tasks_overall",
      "processed_overall",
      "overall_processed_tasks",
      "team_processed_tasks",
    ])) ?? 0;
    const updatedAt = findValue(row, ["updated_at", "updated", "report_updated_at"]);
    if (updatedAt) result.updated_at = String(updatedAt);
    if (processed || processedOverall) foundAny = true;

    result[channel.id][period.id] = {
      processed,
      processed_overall: processedOverall,
      metrics,
    };
  }

  return foundAny ? result : null;
};

const buildDetailsFromSheet = (rawGoals) => {
  const row = normalizeRow(rawGoals);
  const result = { updated_at: findValue(row, ["credit_updated_at", "updated_at"]) || "", };
  let foundAny = false;

  for (const channel of CHANNELS) {
    result[channel.id] = {};
    for (const period of PERIODS) {
      const processedCandidates = combinations(channel.id, period.id, ["processed_tasks", "processed", "tasks"], "mine");
      const processedOverallCandidates = combinations(channel.id, period.id, ["processed_tasks", "processed", "tasks"], "overall");
      const processed = parseNumber(findValue(row, processedCandidates));
      const processedOverall = parseNumber(findValue(row, processedOverallCandidates));
      const metrics = {};

      for (const metric of METRICS) {
        const mineRaw = findValue(row, combinations(channel.id, period.id, metric.aliases, "mine"));
        const overallRaw = findValue(row, combinations(channel.id, period.id, metric.aliases, "overall"));
        const parser = metric.unit === "time" ? parseTimeSeconds : parseNumber;
        const mine = parser(mineRaw);
        const overall = parser(overallRaw);
        metrics[metric.id] = { mine, overall };
        if (mine !== null || overall !== null) foundAny = true;
      }

      if (processed !== null || processedOverall !== null) foundAny = true;
      result[channel.id][period.id] = {
        processed: processed ?? 0,
        processed_overall: processedOverall ?? 0,
        metrics,
      };
    }
  }

  return foundAny ? result : null;
};

const evaluateMetric = (metric, values) => {
  if (values?.mine === null || values?.mine === undefined || values?.overall === null || values?.overall === undefined) {
    return { status: "neutral", delta: 0, copy: "Немає даних для порівняння", score: 0 };
  }
  const mine = Number(values.mine);
  const overall = Number(values.overall);
  if (!Number.isFinite(mine) || !Number.isFinite(overall)) {
    return { status: "neutral", delta: 0, copy: "Немає даних для порівняння", score: 0 };
  }

  if (metric.rule === "higher") {
    const delta = mine - overall;
    if (delta > 0) return { status: "good", delta, copy: `Вище загального на +${delta.toFixed(2)} п.п.`, score: Math.abs(delta) };
    if (delta < 0) return { status: "bad", delta, copy: `Нижче загального на ${delta.toFixed(2)} п.п.`, score: -Math.abs(delta) };
    return { status: "neutral", delta, copy: "На рівні загального показника", score: 0 };
  }

  if (metric.rule === "lower") {
    const delta = mine - overall;
    if (delta < 0) return { status: "good", delta, copy: `Нижче загального на ${Math.abs(delta).toFixed(2)} п.п.`, score: Math.abs(delta) };
    if (delta > 0) return { status: "bad", delta, copy: `Вище загального на +${delta.toFixed(2)} п.п.`, score: -Math.abs(delta) };
    return { status: "neutral", delta, copy: "На рівні загального показника", score: 0 };
  }

  if (metric.rule === "aht15") {
    const delta = mine - overall;
    if (Math.abs(delta) <= 15) {
      return { status: "good", delta, copy: `У допустимому діапазоні ±15 сек`, score: 15 - Math.abs(delta) };
    }
    return {
      status: "bad",
      delta,
      copy: `Відхилення ${delta > 0 ? "+" : ""}${Math.round(delta)} сек від загального`,
      score: -Math.abs(delta),
    };
  }

  if (metric.rule === "projective100") {
    const delta = mine - 100;
    if (mine > 100) return { status: "good", delta, copy: `Вище цілі на +${delta.toFixed(2)} п.п.`, score: delta };
    if (mine >= 90) return { status: "warning", delta, copy: `До цілі ${Math.abs(delta).toFixed(2)} п.п.`, score: -Math.abs(delta) };
    return { status: "bad", delta, copy: `До цілі ${Math.abs(delta).toFixed(2)} п.п.`, score: -Math.abs(delta) };
  }

  return { status: "neutral", delta: 0, copy: "Без оцінки", score: 0 };
};

function SegmentedTabs({ items, value, onChange, ariaLabel }) {
  return (
    <div className="grid rounded-2xl border border-white/10 bg-[#151519] p-1" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }} role="tablist" aria-label={ariaLabel}>
      {items.map((item) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.id)}
            className={`min-h-12 rounded-xl px-2 text-xs font-black transition-all active:scale-[.98] ${active ? "border border-[#B78CFF]/60 bg-[#B78CFF]/16 text-[#C9A7FF] shadow-[0_0_18px_rgba(183,140,255,.12)]" : "text-zinc-400"}`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

function MetricRow({ metric, values }) {
  const evaluation = evaluateMetric(metric, values);
  const theme = STATUS_THEME[evaluation.status];
  const Icon = metric.icon;
  const StatusIcon = evaluation.status === "bad" ? TrendingDown : evaluation.status === "warning" ? TriangleAlert : TrendingUp;
  const mineAvailable = values?.mine !== null && values?.mine !== undefined && Number.isFinite(Number(values.mine));
  const overallAvailable = values?.overall !== null && values?.overall !== undefined && Number.isFinite(Number(values.overall));

  return (
    <article className="rounded-2xl border border-white/10 bg-[#1A1A1E] p-3.5">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ color: theme.color, background: theme.bg, border: `1px solid ${theme.border}` }}>
          <Icon size={18} strokeWidth={2.7} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-[13px] font-black leading-tight text-white">{metric.label}</h3>
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full" style={{ color: theme.color, background: theme.bg, border: `1px solid ${theme.border}` }} title={theme.label}>
              <StatusIcon size={14} strokeWidth={3} />
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-black/25 px-3 py-2">
              <div className="text-[9px] font-black uppercase tracking-wider text-zinc-600">Мій результат</div>
              <div className="mt-1 text-lg font-black" style={{ color: theme.color }}>{mineAvailable ? formatValue(values.mine, metric.unit) : "—"}</div>
            </div>
            <div className="rounded-xl bg-black/25 px-3 py-2">
              <div className="text-[9px] font-black uppercase tracking-wider text-zinc-600">Загальний</div>
              <div className="mt-1 text-lg font-black text-zinc-300">{overallAvailable ? formatValue(values.overall, metric.unit) : "—"}</div>
            </div>
          </div>
          <div className="mt-2 text-[11px] font-bold" style={{ color: theme.color }}>{evaluation.copy}</div>
        </div>
      </div>
    </article>
  );
}

function InsightCard({ title, metric, values, status }) {
  if (!metric || !values) return null;
  const theme = STATUS_THEME[status];
  const evaluation = evaluateMetric(metric, values);
  const Icon = status === "good" ? CheckCircle2 : status === "warning" ? Target : TriangleAlert;
  return (
    <article className="rounded-2xl border p-4" style={{ borderColor: theme.border, background: theme.bg }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-black uppercase tracking-wider" style={{ color: theme.color }}>{title}</div>
          <div className="mt-1 truncate text-xs font-black text-white">{metric.label}</div>
        </div>
        <Icon size={20} strokeWidth={2.7} style={{ color: theme.color }} />
      </div>
      <div className="mt-3 text-2xl font-black" style={{ color: theme.color }}>{formatValue(values.mine, metric.unit)}</div>
      <div className="mt-1 text-[10px] font-bold text-zinc-400">{evaluation.copy}</div>
    </article>
  );
}

export default function CreditGoals() {
  const { mode, user } = useApp();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedChannel = searchParams.get("channel");
  const requestedPeriod = searchParams.get("period");
  const channel = CHANNELS.some((item) => item.id === requestedChannel) ? requestedChannel : "xsell";
  const period = PERIODS.some((item) => item.id === requestedPeriod) ? requestedPeriod : "month";
  const [details, setDetails] = useState(mode === "mock" ? FEDUN_DEMO : null);
  const [loading, setLoading] = useState(mode !== "mock");
  const [emptyMessage, setEmptyMessage] = useState("");

  const updateFilter = (key, value) => {
    const next = new URLSearchParams(searchParams);
    next.set(key, value);
    setSearchParams(next, { replace: true });
  };

  useEffect(() => {
    if (mode === "mock") {
      setDetails(FEDUN_DEMO);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const load = async ({ silent = false } = {}) => {
      try {
        if (!silent) setLoading(true);
        setEmptyMessage("");
        const token = getToken();
        if (!token) throw new Error("Потрібна авторизація");
        const response = await fetch(`/.netlify/functions/google-goals?_ts=${Date.now()}`, {
          method: "GET",
          headers: {
            accept: "application/json",
            authorization: `Bearer ${token}`,
            "cache-control": "no-cache",
          },
          cache: "no-store",
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "Не вдалося завантажити показники");
        if (cancelled) return;
        if (!result.found || !result.goals) {
          setDetails(null);
          setEmptyMessage(
            result.reason === "results_not_published"
              ? 'Результати ще не опубліковано. У Google Таблиці натисніть «TM6 Bonus → Оновити результати».'
              : "Для вашого профілю ще не додано детальні показники кредитного напрямку."
          );
          return;
        }
        const parsed = buildDetailsFromMetricRows(result.credit_metrics) || buildDetailsFromSheet(result.goals);
        setDetails(parsed);
        if (!parsed) {
          setEmptyMessage("У Google Таблиці є цілі, але ще немає колонок деталізації X-Sell, Web Apps та INB.");
        }
      } catch (error) {
        if (!cancelled && !silent) {
          setDetails(null);
          setEmptyMessage("Не вдалося завантажити деталізацію з Google Таблиці.");
          toast.error(error.message || "Помилка завантаження показників");
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

  const activeData = details?.[channel]?.[period];
  const metricRows = useMemo(() => METRICS.map((metric) => ({
    metric,
    values: activeData?.metrics?.[metric.id] || { mine: null, overall: null },
    evaluation: evaluateMetric(metric, activeData?.metrics?.[metric.id]),
  })), [activeData]);

  const strongest = metricRows.find((row) => row.evaluation.status === "good");
  const growth = metricRows.find((row) => row.evaluation.status === "warning")
    || [...metricRows].filter((row) => row.evaluation.status === "bad").sort((a, b) => b.evaluation.score - a.evaluation.score)[0];
  const attention = [...metricRows].filter((row) => row.evaluation.status === "bad").sort((a, b) => a.evaluation.score - b.evaluation.score)[0];
  const projective = activeData?.metrics?.projective?.mine;
  const overallProjective = activeData?.metrics?.projective?.overall;
  const projectiveAvailable = projective !== null && projective !== undefined && Number.isFinite(Number(projective));
  const overallProjectiveAvailable = overallProjective !== null && overallProjective !== undefined && Number.isFinite(Number(overallProjective));
  const progress = projectiveAvailable ? Math.max(0, Math.min(120, Number(projective))) : 0;
  const projectiveEvaluation = evaluateMetric(METRICS.find((item) => item.id === "projective"), activeData?.metrics?.projective);
  const summaryTheme = STATUS_THEME[projectiveEvaluation.status];

  if (loading) return <div className="p-8 text-center text-sm text-zinc-500">Завантаження показників...</div>;

  return (
    <div className="space-y-4 px-5 pb-8 pt-2" data-testid="credit-goals-page">
      <section className="flex items-start gap-3">
        <button type="button" onClick={() => navigate("/goals/credit")} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-[#1A1A1E] text-zinc-300 active:scale-95" aria-label="Назад до цілей">
          <ArrowLeft size={21} strokeWidth={2.7} />
        </button>
        <div className="min-w-0 flex-1 pt-0.5">
          <h1 className="font-display text-[24px] leading-tight text-white">Мої показники</h1>
          <div className="mt-1 text-xs font-bold text-zinc-500">Кредитний напрямок · {user?.goals_login || user?.name || "оператор"}</div>
          <div className="mt-1 flex items-center gap-1.5 text-[10px] font-bold text-zinc-600"><RefreshCcw size={11} />Оновлено: {details?.updated_at || "з Google Таблиці"}</div>
        </div>
      </section>

      <SegmentedTabs items={CHANNELS} value={channel} onChange={(value) => updateFilter("channel", value)} ariaLabel="Кредитний піднапрямок" />
      <SegmentedTabs items={PERIODS} value={period} onChange={(value) => updateFilter("period", value)} ariaLabel="Період показників" />

      {!details || !activeData ? (
        <section className="rounded-3xl border border-white/10 bg-[#1A1A1E] p-6 text-center">
          <Target size={34} color="#B78CFF" className="mx-auto" />
          <h2 className="mt-3 font-display text-xl text-white">ДЕТАЛІЗАЦІЇ ЩЕ НЕМАЄ</h2>
          <p className="mt-2 text-sm leading-relaxed text-zinc-500">{emptyMessage || "Додайте показники в Google Таблицю."}</p>
        </section>
      ) : (
        <>
          <section className="rounded-3xl border p-5" style={{ borderColor: summaryTheme.border, background: "linear-gradient(145deg, rgba(183,140,255,.14), rgba(26,26,30,.98) 52%)" }}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Проекційний результат</div>
                <div className="mt-1 font-display text-[40px] leading-none" style={{ color: summaryTheme.color }}>{projectiveAvailable ? `${Number(projective).toFixed(2)}%` : "—"}</div>
              </div>
              <div className="rounded-full px-3 py-1.5 text-[10px] font-black uppercase" style={{ color: summaryTheme.color, background: summaryTheme.bg, border: `1px solid ${summaryTheme.border}` }}>{summaryTheme.label}</div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <div className="rounded-2xl bg-black/25 px-3 py-3">
                <div className="text-[9px] font-black uppercase tracking-wider text-zinc-600">Оброблено</div>
                <div className="mt-1 text-lg font-black text-[#00F0FF]">{Number(activeData.processed || 0).toLocaleString("uk-UA")}</div>
                <div className="text-[10px] font-bold text-zinc-600">загалом {Number(activeData.processed_overall || 0).toLocaleString("uk-UA")}</div>
              </div>
              <div className="rounded-2xl bg-black/25 px-3 py-3">
                <div className="text-[9px] font-black uppercase tracking-wider text-zinc-600">Загальний підсумок</div>
                <div className="mt-1 text-lg font-black text-[#B78CFF]">{overallProjectiveAvailable ? `${Number(overallProjective).toFixed(2)}%` : "—"}</div>
                <div className="text-[10px] font-bold text-zinc-600">ціль 100%</div>
              </div>
            </div>
            <div className="mt-4 h-3 overflow-hidden rounded-full bg-black/45">
              <div className="h-full rounded-full bg-gradient-to-r from-[#7C3AED] to-[#B78CFF] transition-all" style={{ width: `${Math.min(100, progress)}%` }} />
            </div>
            <div className="mt-3 text-xs font-black" style={{ color: summaryTheme.color }}>{projectiveEvaluation.copy}</div>
          </section>

          <section>
            <div className="mb-3 flex items-end justify-between px-1">
              <h2 className="font-display text-xl text-white">Детальна інформація</h2>
              <div className="flex items-center gap-1 text-[9px] font-black uppercase tracking-wider text-zinc-600"><UsersRound size={12} />порівняння із загальним</div>
            </div>
            <div className="space-y-2.5">
              {metricRows.map(({ metric, values }) => <MetricRow key={metric.id} metric={metric} values={values} />)}
            </div>
          </section>

          <section className="grid grid-cols-3 gap-2">
            <InsightCard title="Найсильніша зона" metric={strongest?.metric} values={strongest?.values} status="good" />
            <InsightCard title="Зона росту" metric={growth?.metric} values={growth?.values} status="warning" />
            <InsightCard title="Зона уваги" metric={attention?.metric} values={attention?.values} status="bad" />
          </section>

          <section className="rounded-3xl border border-white/10 bg-[#1A1A1E] p-5">
            <h2 className="font-display text-lg text-white">Підсумок по напрямку</h2>
            <div className="mt-4 grid grid-cols-3 divide-x divide-white/10">
              <div className="px-2 first:pl-0">
                <div className="text-[9px] font-black uppercase tracking-wider text-zinc-600">Задач</div>
                <div className="mt-1 text-xl font-black text-[#B78CFF]">{Number(activeData.processed || 0)}</div>
              </div>
              <div className="px-3">
                <div className="text-[9px] font-black uppercase tracking-wider text-zinc-600">Відмови банку</div>
                <div className="mt-1 text-xl font-black text-[#39FF14]">{formatValue(activeData.metrics.reject?.mine || 0, "percent")}</div>
              </div>
              <div className="px-3 pr-0">
                <div className="text-[9px] font-black uppercase tracking-wider text-zinc-600">Рівень згод</div>
                <div className="mt-1 text-xl font-black text-[#B78CFF]">{formatValue(activeData.metrics.agreement?.mine || 0, "percent")}</div>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
