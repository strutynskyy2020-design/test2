import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  Banknote,
  CreditCard,
  Layers3,
  RefreshCcw,
  Smartphone,
  Target,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import { toast } from "sonner";
import { getToken } from "@/lib/api";
import { useApp } from "@/context/AppContext";
import { resolveAvatarUrl } from "@/lib/avatar";

const PERIODS = [
  { id: "month", label: "Місяць" },
  { id: "yesterday", label: "Вчора" },
];

const DIRECTIONS = [
  { key: "inb_deb", label: "INB Debit", icon: Smartphone, color: "#B78CFF" },
  { key: "vse_card", label: "Vse Card", icon: CreditCard, color: "#39FF14" },
  { key: "web_fuib", label: "Web Fuib", icon: WalletCards, color: "#FFB800" },
  { key: "web_apps", label: "Web Apps", icon: Layers3, color: "#00F0FF" },
  { key: "x_sell", label: "X-Sell", icon: TrendingUp, color: "#FF6B9D" },
];

const DEMO_ROWS = [
  { period: "month", inb_deb: 0, vse_card: 0, web_fuib: 3, web_apps: 10, x_sell: 1, overall: 14, updated_at: "демо-дані" },
  { period: "yesterday", inb_deb: 0, vse_card: 0, web_fuib: 0, web_apps: 1, x_sell: 0, overall: 1, updated_at: "демо-дані" },
];

const parseCount = (value) => {
  if (value === null || value === undefined || String(value).trim() === "") return 0;
  const parsed = Number(String(value).replace(/\u00a0/g, "").replace(/\s+/g, "").replace(",", ".").replace(/[^0-9.+-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizePeriod = (value) => {
  const key = String(value || "").trim().toLowerCase();
  if (key.includes("yesterday") || key.includes("вчора")) return "yesterday";
  return "month";
};

const normalizeRows = (rows = []) => (Array.isArray(rows) ? rows : []).map((row) => ({
  period: normalizePeriod(row?.period),
  inb_deb: parseCount(row?.inb_deb),
  vse_card: parseCount(row?.vse_card),
  web_fuib: parseCount(row?.web_fuib),
  web_apps: parseCount(row?.web_apps),
  x_sell: parseCount(row?.x_sell),
  overall: parseCount(row?.overall),
  updated_at: String(row?.updated_at || "").trim(),
}));

function SegmentedTabs({ value, onChange }) {
  return (
    <div className="grid grid-cols-2 rounded-2xl border border-white/10 bg-[#151519] p-1" role="tablist" aria-label="Період видач">
      {PERIODS.map((item) => {
        const active = item.id === value;
        return (
          <button key={item.id} type="button" role="tab" aria-selected={active} onClick={() => onChange(item.id)} className={`min-h-12 rounded-xl text-xs font-black transition-all active:scale-[.98] ${active ? "border border-[#00F0FF]/55 bg-[#00F0FF]/12 text-[#00F0FF]" : "text-zinc-400"}`}>
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

function DirectionCard({ direction, value, maxValue }) {
  const Icon = direction.icon;
  const percent = maxValue > 0 ? Math.max(6, Math.min(100, (value / maxValue) * 100)) : 0;
  return (
    <article className="rounded-2xl border border-white/10 bg-[#1A1A1E] p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ color: direction.color, background: `${direction.color}14`, border: `1px solid ${direction.color}40` }}>
          <Icon size={19} strokeWidth={2.8} />
        </div>
        <div className="text-right">
          <div className="text-[9px] font-black uppercase tracking-wider text-zinc-600">Видачі</div>
          <div className="mt-0.5 text-2xl font-black" style={{ color: direction.color }}>{Number(value || 0).toLocaleString("uk-UA")}</div>
        </div>
      </div>
      <div className="mt-3 text-sm font-black text-white">{direction.label}</div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/45"><div className="h-full rounded-full" style={{ width: `${percent}%`, background: direction.color }} /></div>
    </article>
  );
}

export default function DebitIssuances() {
  const { mode, user } = useApp();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedPeriod = searchParams.get("period");
  const period = PERIODS.some((item) => item.id === requestedPeriod) ? requestedPeriod : "month";
  const [rows, setRows] = useState(mode === "mock" ? DEMO_ROWS : []);
  const [loading, setLoading] = useState(mode !== "mock");
  const [emptyMessage, setEmptyMessage] = useState("");

  const updatePeriod = (value) => {
    const next = new URLSearchParams(searchParams);
    next.set("period", value);
    setSearchParams(next, { replace: true });
  };

  useEffect(() => {
    if (mode === "mock") {
      setRows(DEMO_ROWS);
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
          headers: { accept: "application/json", authorization: `Bearer ${token}`, "cache-control": "no-cache" },
          cache: "no-store",
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "Не вдалося завантажити видачі");
        if (cancelled) return;
        const normalized = normalizeRows(result.debit_issuances);
        setRows(normalized);
        if (!normalized.length) setEmptyMessage('На вкладці "Transformation Deb" не знайдено рядок вашого логіна у блоках giving month або giving yesterday.');
      } catch (error) {
        if (!cancelled && !silent) {
          setRows([]);
          setEmptyMessage("Не вдалося завантажити видачі з Google Таблиці.");
          toast.error(error.message || "Помилка завантаження видач");
        }
      } finally {
        if (!cancelled && !silent) setLoading(false);
      }
    };
    load();
    const refreshWhenVisible = () => { if (document.visibilityState === "visible") load({ silent: true }); };
    const refreshOnFocus = () => load({ silent: true });
    const refreshTimer = window.setInterval(() => load({ silent: true }), 60_000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      cancelled = true;
      window.clearInterval(refreshTimer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, [mode]);

  const activeData = rows.find((row) => row.period === period) || null;
  const maxValue = useMemo(() => activeData ? Math.max(0, ...DIRECTIONS.map((direction) => Number(activeData[direction.key] || 0))) : 0, [activeData]);
  const strongest = useMemo(() => activeData ? DIRECTIONS.reduce((best, direction) => {
    const value = Number(activeData[direction.key] || 0);
    return !best || value > best.value ? { ...direction, value } : best;
  }, null) : null, [activeData]);
  const activeDirections = activeData ? DIRECTIONS.filter((direction) => Number(activeData[direction.key] || 0) > 0).length : 0;
  const avatar = resolveAvatarUrl(user?.avatar_url);
  const fallback = String(user?.avatar_initials || user?.goals_login || user?.name || "?").slice(0, 2).toUpperCase();

  if (loading) return <div className="p-8 text-center text-sm text-zinc-500">Завантаження видач...</div>;

  return (
    <div className="space-y-4 px-5 pb-8 pt-2" data-testid="debit-issuances-page">
      <section className="flex items-start gap-3">
        <button type="button" onClick={() => navigate("/goals/debit")} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-[#1A1A1E] text-zinc-300 active:scale-95" aria-label="Назад до дебетового рейтингу"><ArrowLeft size={21} strokeWidth={2.7} /></button>
        <div className="min-w-0 flex-1 pt-0.5">
          <h1 className="font-display text-[24px] leading-tight text-white">Мої видачі</h1>
          <div className="mt-1 text-xs font-bold text-zinc-500">Дебетовий напрямок · {user?.goals_login || user?.name || "оператор"}</div>
          <div className="mt-1 flex items-center gap-1.5 text-[10px] font-bold text-zinc-600"><RefreshCcw size={11} />Оновлено: {activeData?.updated_at || "з Google Таблиці"}</div>
        </div>
      </section>

      <SegmentedTabs value={period} onChange={updatePeriod} />

      {!activeData ? (
        <section className="rounded-3xl border border-white/10 bg-[#1A1A1E] p-6 text-center">
          <Target size={34} color="#00F0FF" className="mx-auto" />
          <h2 className="mt-3 font-display text-xl text-white">ВИДАЧ ЩЕ НЕМАЄ</h2>
          <p className="mt-2 text-sm leading-relaxed text-zinc-500">{emptyMessage || "Додайте видачі на вкладку Transformation Deb."}</p>
        </section>
      ) : (
        <>
          <section className="rounded-3xl border border-[#00F0FF]/30 bg-gradient-to-br from-[#00F0FF]/12 to-[#1A1A1E] p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[#00F0FF]/35 bg-[#27272A] font-black text-white">
                {avatar ? <img src={avatar} alt="Аватар" className="h-full w-full object-cover" /> : fallback}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-black uppercase tracking-widest text-[#00F0FF]">Загальна кількість видач</div>
                <div className="mt-1 font-display text-[38px] leading-none text-white">{Number(activeData.overall || 0).toLocaleString("uk-UA")}</div>
                <div className="mt-1 text-xs font-bold text-zinc-500">{period === "month" ? "за поточний місяць" : "за вчора"}</div>
              </div>
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[#00F0FF]/30 bg-[#00F0FF]/10 text-[#00F0FF]"><Banknote size={23} strokeWidth={2.8} /></div>
            </div>
          </section>

          <section className="grid grid-cols-2 gap-2.5">
            {DIRECTIONS.map((direction, index) => (
              <div key={direction.key} className={index === DIRECTIONS.length - 1 ? "col-span-2" : ""}>
                <DirectionCard direction={direction} value={activeData[direction.key]} maxValue={maxValue} />
              </div>
            ))}
          </section>

          <section className="rounded-3xl border border-white/10 bg-[#1A1A1E] p-5">
            <h2 className="font-display text-lg text-white">Підсумок видач</h2>
            <div className="mt-4 grid grid-cols-3 divide-x divide-white/10">
              <div className="px-2 first:pl-0"><div className="text-[9px] font-black uppercase tracking-wider text-zinc-600">Загалом</div><div className="mt-1 text-xl font-black text-[#00F0FF]">{Number(activeData.overall || 0)}</div></div>
              <div className="px-3"><div className="text-[9px] font-black uppercase tracking-wider text-zinc-600">Активних напрямків</div><div className="mt-1 text-xl font-black text-[#39FF14]">{activeDirections}</div></div>
              <div className="px-3 pr-0"><div className="text-[9px] font-black uppercase tracking-wider text-zinc-600">Найкращий</div><div className="mt-1 truncate text-sm font-black text-[#FFB800]">{strongest?.label || "—"}</div><div className="text-[10px] font-black text-zinc-500">{strongest?.value || 0} видач</div></div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
