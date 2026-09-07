import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CalendarDays, CalendarRange, TrendingDown, TrendingUp } from "lucide-react";

const normalizeDateValue = (value) => {
  if (!value) return "";
  const source = String(value).trim();
  const iso = source.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const ua = source.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/);
  if (ua) return `${ua[3]}-${String(Number(ua[2])).padStart(2, "0")}-${String(Number(ua[1])).padStart(2, "0")}`;
  return source;
};

const formatDateLabel = (value) => {
  const normalized = normalizeDateValue(value);
  const parts = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return parts ? `${parts[3]}.${parts[2]}` : (normalized || "—").slice(0, 10);
};

const weekKey = (value) => {
  const normalized = normalizeDateValue(value);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? new Date(`${normalized}T12:00:00Z`) : new Date(normalized);
  if (Number.isNaN(date.getTime())) return String(value || "");
  const utcDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil((((utcDate - yearStart) / 86400000) + 1) / 7);
  return `${utcDate.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
};

const weekLabel = (value) => String(value || "").replace("-W", " тиж. ");

const valueFormatter = (value, unit) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  const numeric = Number(value);
  if (unit === "count" || unit === "number") return numeric.toLocaleString("uk-UA", { maximumFractionDigits: 0 });
  return `${numeric.toLocaleString("uk-UA", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}%`;
};

export default function OperatorReportTrendChart({
  title = "Динаміка показника",
  subtitle = "Порівняння останніх оновлень звіту",
  color = "#39FF14",
  target = null,
  metricKey = "value",
  metricLabel = "Показник",
  unit = "percent",
  records = [],
  loading = false,
  emptyText = "Тренд з’явиться після кількох оновлень звіту.",
}) {
  const [mode, setMode] = useState("days");

  const points = useMemo(() => (Array.isArray(records) ? records : []).map((record) => {
    const metric = Array.isArray(record?.metrics) ? record.metrics.find((item) => item?.key === metricKey) : null;
    const value = metric?.value;
    return {
      rawDate: normalizeDateValue(record?.date_key || record?.snapshot_updated_at || record?.created_at || record?.updated_at),
      label: formatDateLabel(record?.date_key || record?.snapshot_updated_at || record?.created_at || record?.updated_at),
      value: value === null || value === undefined ? null : Number(value),
    };
  }).filter((item) => item.value !== null && Number.isFinite(item.value)), [metricKey, records]);

  const chartData = useMemo(() => {
    if (mode === "days") return points;
    const buckets = new Map();
    points.forEach((point) => {
      const key = weekKey(point.rawDate);
      const existing = buckets.get(key) || { rawDate: point.rawDate, label: weekLabel(key), values: [] };
      existing.values.push(point.value);
      existing.rawDate = point.rawDate;
      buckets.set(key, existing);
    });
    return Array.from(buckets.values()).map((bucket) => ({
      rawDate: bucket.rawDate,
      label: bucket.label,
      value: bucket.values[bucket.values.length - 1],
    }));
  }, [mode, points]);

  const latest = chartData[chartData.length - 1]?.value ?? null;
  const previous = chartData.length > 1 ? chartData[chartData.length - 2]?.value : null;
  const delta = latest !== null && previous !== null ? latest - previous : null;
  const trendUp = delta !== null ? delta >= 0 : null;

  return (
    <section className="rounded-3xl border border-white/10 bg-[#1A1A1E] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[.18em]" style={{ color }}>{title}</div>
          <h2 className="mt-1 font-display text-xl text-white">{metricLabel}</h2>
          <p className="mt-1 text-xs leading-relaxed text-zinc-500">{subtitle}</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setMode("days")} className={`flex h-10 items-center gap-1 rounded-full border px-3 text-[10px] font-black uppercase ${mode === "days" ? "border-white/15 bg-white/10 text-white" : "border-white/10 bg-black/20 text-zinc-500"}`}><CalendarDays size={13} />Дні</button>
          <button type="button" onClick={() => setMode("weeks")} className={`flex h-10 items-center gap-1 rounded-full border px-3 text-[10px] font-black uppercase ${mode === "weeks" ? "border-white/15 bg-white/10 text-white" : "border-white/10 bg-black/20 text-zinc-500"}`}><CalendarRange size={13} />Тижні</button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
          <div className="text-[9px] font-black uppercase tracking-wider text-zinc-600">Останнє значення</div>
          <div className="mt-1 text-2xl font-black" style={{ color }}>{valueFormatter(latest, unit)}</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
          <div className="text-[9px] font-black uppercase tracking-wider text-zinc-600">Зміна до попереднього</div>
          <div className="mt-1 flex items-center gap-2 text-2xl font-black" style={{ color: trendUp === null ? "#A1A1AA" : trendUp ? "#39FF14" : "#FF4D55" }}>
            {trendUp === null ? null : trendUp ? <TrendingUp size={20} /> : <TrendingDown size={20} />}
            <span>{delta === null ? "—" : `${delta >= 0 ? "+" : ""}${valueFormatter(delta, unit)}`}</span>
          </div>
        </div>
      </div>

      <div className="mt-4 h-64 w-full">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm font-bold text-zinc-500">Завантаження тренду…</div>
        ) : chartData.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ left: -18, right: 6, top: 8, bottom: 4 }}>
              <defs>
                <linearGradient id={`trend-${metricKey}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={color} stopOpacity={0.32} />
                  <stop offset="95%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,140,.18)" />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#71717A" }} />
              <YAxis tick={{ fontSize: 10, fill: "#71717A" }} width={40} />
              <Tooltip
                contentStyle={{ borderRadius: 14, border: "1px solid rgba(255,255,255,.1)", background: "#17171B", color: "#fff", fontSize: 12 }}
                formatter={(value) => [valueFormatter(value, unit), metricLabel]}
                labelFormatter={(label) => `Період: ${label}`}
              />
              {target !== null && target !== undefined && Number.isFinite(Number(target)) && (
                <ReferenceLine y={Number(target)} stroke="rgba(255,184,0,.7)" strokeDasharray="4 4" />
              )}
              <Area type="monotone" dataKey="value" name={metricLabel} stroke={color} fill={`url(#trend-${metricKey})`} strokeWidth={3} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-center text-sm font-bold text-zinc-500">{emptyText}</div>
        )}
      </div>
    </section>
  );
}
