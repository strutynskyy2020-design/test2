import { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  BriefcaseBusiness,
  CalendarCheck2,
  CheckCircle2,
  HandCoins,
  Landmark,
  RefreshCcw,
  Target,
  UsersRound,
} from "lucide-react";
import { useApp } from "@/context/AppContext";
import { useDailyGoogleReports } from "@/hooks/useGoogleReports";

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

const parseNumber = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const source = String(value ?? "").trim();
  if (!source) return null;
  const parsed = Number(source.replace(/\u00a0/g, "").replace(/\s+/g, "").replace(/%$/, "").replace(",", ".").replace(/[^0-9.+-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};

const fmtPercent = (value) => {
  const number = parseNumber(value);
  return number === null ? "—" : `${number.toLocaleString("uk-UA", { maximumFractionDigits: 2 })}%`;
};

const fmtCount = (value) => {
  const number = parseNumber(value);
  return number === null ? "0" : number.toLocaleString("uk-UA", { maximumFractionDigits: 0 });
};

const normalizePeriod = (value) => {
  const key = String(value || "").toLowerCase();
  return key.includes("yesterday") || key.includes("вчора") ? "yesterday" : "month";
};

const statusFor = (value, target = 100) => {
  const number = parseNumber(value);
  if (number === null) return { label: "Немає даних", color: "#8B93A7" };
  if (number >= target) return { label: "Ціль виконано", color: "#39FF14" };
  if (number >= target * 0.85) return { label: "На рівні", color: "#00F0FF" };
  if (number >= target * 0.65) return { label: "Зона росту", color: "#FFB800" };
  return { label: "Потрібна увага", color: "#FF4D55" };
};

function PeriodTabs({ value, onChange }) {
  return (
    <div className="grid grid-cols-2 rounded-2xl border border-white/10 bg-[#151519] p-1">
      {PERIODS.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onChange(item.id)}
          className={`min-h-12 rounded-xl text-xs font-black transition-all ${value === item.id ? "border border-[#39FF14]/45 bg-[#39FF14]/10 text-[#39FF14]" : "text-zinc-400"}`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, overall, percent = true, color = "#39FF14" }) {
  return (
    <article className="rounded-2xl border border-white/10 bg-[#1A1A1E] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ color, background: `${color}14`, border: `1px solid ${color}40` }}>
          <Icon size={19} strokeWidth={2.8} />
        </div>
        <div className="text-right">
          <div className="text-[9px] font-black uppercase tracking-wider text-zinc-600">Мій результат</div>
          <div className="mt-1 text-xl font-black" style={{ color }}>{percent ? fmtPercent(value) : fmtCount(value)}</div>
        </div>
      </div>
      <div className="mt-3 text-sm font-black text-white">{label}</div>
      <div className="mt-2 flex items-center justify-between rounded-xl bg-black/25 px-3 py-2 text-xs">
        <span className="font-bold text-zinc-500">Підсумок команди</span>
        <span className="font-black text-white">{percent ? fmtPercent(overall) : fmtCount(overall)}</span>
      </div>
    </article>
  );
}

export default function DepositGoals() {
  const { user } = useApp();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: report, loading, error } = useDailyGoogleReports();
  const requested = searchParams.get("period");
  const period = PERIODS.some((item) => item.id === requested) ? requested : "month";

  const metrics = useMemo(() => (Array.isArray(report?.deposit_metrics) ? report.deposit_metrics : []).map((row) => ({ ...row, period: normalizePeriod(row.period) })), [report]);
  const issuances = useMemo(() => (Array.isArray(report?.deposit_issuances) ? report.deposit_issuances : []).map((row) => ({ ...row, period: normalizePeriod(row.period) })), [report]);
  const active = metrics.find((row) => row.period === period) || null;
  const activeIssuances = issuances.find((row) => row.period === period) || null;
  const projectiveStatus = statusFor(active?.projective_rate, 100);

  const setPeriod = (value) => {
    const next = new URLSearchParams(searchParams);
    next.set("period", value);
    setSearchParams(next, { replace: true });
  };

  if (loading && !report) return <div className="p-8 text-center text-sm font-bold text-zinc-500">Завантаження депозитних показників…</div>;

  return (
    <div className="space-y-4 px-5 pb-8 pt-2" data-testid="deposit-goals-page">
      <section className="flex items-start gap-3">
        <button type="button" onClick={() => navigate("/goals/deposit")} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-[#1A1A1E] text-zinc-300 active:scale-95" aria-label="Назад до депозитного рейтингу">
          <ArrowLeft size={21} strokeWidth={2.7} />
        </button>
        <div className="min-w-0 flex-1 pt-0.5">
          <h1 className="font-display text-[24px] leading-tight text-white">Мої депозитні показники</h1>
          <div className="mt-1 text-xs font-bold text-zinc-500">Депозитний напрямок · {user?.goals_login || user?.name || "оператор"}</div>
          <div className="mt-1 flex items-center gap-1.5 text-[10px] font-bold text-zinc-600"><RefreshCcw size={11} />Оновлено: {active?.updated_at || report?.snapshot_updated_at || "з Google Таблиці"}</div>
        </div>
      </section>

      <PeriodTabs value={period} onChange={setPeriod} />

      {!active ? (
        <section className="rounded-3xl border border-white/10 bg-[#1A1A1E] p-7 text-center">
          <Landmark size={38} className="mx-auto text-[#39FF14]" />
          <h2 className="mt-3 font-display text-xl text-white">ДЕПОЗИТНІ ДАНІ ЩЕ НЕ ЗНАЙДЕНО</h2>
          <p className="mt-2 text-sm leading-relaxed text-zinc-500">{error ? "Не вдалося отримати опублікований звіт." : 'Перевірте блоки "Dep month" і "Dep yesterday" на вкладці Deposit та натисніть «Оновити звіти».'}</p>
        </section>
      ) : (
        <>
          <section className="rounded-3xl border border-[#39FF14]/30 bg-gradient-to-br from-[#39FF14]/10 to-[#1A1A1E] p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[.18em] text-[#39FF14]">Проекційний результат</div>
                <div className="mt-2 font-display text-[46px] leading-none" style={{ color: projectiveStatus.color }}>{fmtPercent(active.projective_rate)}</div>
                <div className="mt-2 text-xs font-black uppercase tracking-wider" style={{ color: projectiveStatus.color }}>{projectiveStatus.label}</div>
              </div>
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[#39FF14]/30 bg-[#39FF14]/10 text-[#39FF14]"><Target size={23} strokeWidth={2.8} /></div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className="rounded-2xl border border-white/10 bg-black/25 p-3"><div className="text-[9px] font-black uppercase tracking-wider text-zinc-600">Команда</div><div className="mt-1 text-xl font-black text-white">{fmtPercent(active.projective_rate_overall)}</div></div>
              <div className="rounded-2xl border border-white/10 bg-black/25 p-3"><div className="text-[9px] font-black uppercase tracking-wider text-zinc-600">Фактичні видачі</div><div className="mt-1 text-xl font-black text-[#FFB800]">{fmtCount(active.issuances)}</div></div>
            </div>
          </section>

          <section className="grid grid-cols-2 gap-2.5">
            <MetricCard icon={BriefcaseBusiness} label="Оброблено" value={active.processed_tasks} overall={active.processed_tasks_overall} percent={false} color="#B78CFF" />
            <MetricCard icon={CalendarCheck2} label="Зустрічі від оброблених" value={active.meeting_rate} overall={active.meeting_rate_overall} color="#00F0FF" />
            <MetricCard icon={CheckCircle2} label="Видачі від оброблених" value={active.issuance_rate} overall={active.issuance_rate_overall} color="#39FF14" />
            <MetricCard icon={HandCoins} label="Кількість видач" value={active.issuances} overall={active.issuances_overall} percent={false} color="#FFB800" />
          </section>

          <section className="rounded-3xl border border-white/10 bg-[#1A1A1E] p-5">
            <div className="flex items-center justify-between gap-3">
              <div><h2 className="font-display text-lg text-white">Видачі за напрямками</h2><p className="mt-1 text-xs text-zinc-500">Дані з блоку {period === "month" ? "Giving month" : "Giving yesterday"}</p></div>
              <UsersRound size={22} className="text-[#39FF14]" />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {DIRECTIONS.map((direction) => (
                <div key={direction.key} className="rounded-2xl border border-white/10 bg-black/25 p-3">
                  <div className="text-[9px] font-black uppercase tracking-wider text-zinc-600">{direction.label}</div>
                  <div className="mt-1 text-2xl font-black" style={{ color: direction.color }}>{fmtCount(activeIssuances?.[direction.key])}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between rounded-2xl border border-[#39FF14]/20 bg-[#39FF14]/[.06] px-4 py-3">
              <span className="text-xs font-black uppercase tracking-wider text-zinc-400">Загальний підсумок</span>
              <span className="font-display text-2xl text-[#39FF14]">{fmtCount(activeIssuances?.overall)}</span>
            </div>
          </section>

          {active.projective_source && (
            <section className="rounded-2xl border border-white/10 bg-white/[.03] p-4 text-xs leading-relaxed text-zinc-500">
              <span className="font-black text-zinc-300">Джерело:</span> аркуш «{active.projective_source.sheet || "Deposit"}», рядок «{active.projective_source.row_label || "Projective_rate"}», колонка оператора «{active.projective_source.operator_column || user?.goals_login || "—"}».
            </section>
          )}
        </>
      )}
    </div>
  );
}
