import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowUpRight, ArrowDownRight, Coins, Swords, ShoppingBag, ShieldCheck, Dice5, Filter } from "lucide-react";
import { toast } from "sonner";
import api, { extractError } from "@/lib/api";
import { useApp } from "@/context/AppContext";

const KIND_META = {
  quest:         { label: "Квест",   icon: Swords,      color: "#39FF14" },
  purchase:      { label: "Покупка", icon: ShoppingBag, color: "#FF5C00" },
  admin_adjust:  { label: "Адмін",   icon: ShieldCheck, color: "#00F0FF" },
  signup_bonus:  { label: "Бонус",   icon: Dice5,       color: "#FFB800" },
};

const FILTERS = [
  { id: "all", label: "Все" },
  { id: "in", label: "Плюси" },
  { id: "out", label: "Мінуси" },
];

const formatDate = (iso) => {
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const timeStr = d.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });
  if (isToday) return `Сьогодні, ${timeStr}`;
  return d.toLocaleDateString("uk-UA", { day: "numeric", month: "short" }) + `, ${timeStr}`;
};

const Row = ({ tx }) => {
  const meta = KIND_META[tx.kind] || KIND_META.admin_adjust;
  const Icon = meta.icon;
  const isPositive = tx.amount > 0;
  return (
    <div data-testid={`tx-${tx.id}`} className="bg-[#1A1A1E] border border-white/10 rounded-2xl p-3 flex items-center gap-3">
      <div
        className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0"
        style={{ backgroundColor: meta.color + "22", border: `2px solid ${meta.color}` }}
      >
        <Icon size={20} strokeWidth={2.75} color={meta.color} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-white font-black text-sm truncate">{tx.description || meta.label}</div>
        <div className="text-zinc-500 text-[11px] truncate flex items-center gap-1">
          <span className="uppercase tracking-widest font-black text-[9px]" style={{ color: meta.color }}>{meta.label}</span>
          <span>•</span>
          <span>{formatDate(tx.created_at)}</span>
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {isPositive ? (
          <ArrowUpRight size={14} strokeWidth={3} color="#39FF14" />
        ) : (
          <ArrowDownRight size={14} strokeWidth={3} color="#FF3B30" />
        )}
        <span className="font-display text-base" style={{ color: isPositive ? "#39FF14" : "#FF3B30" }}>
          {isPositive ? "+" : ""}{tx.amount.toLocaleString("uk-UA")}
        </span>
      </div>
    </div>
  );
};

export default function History() {
  const { mode, user } = useApp();
  const nav = useNavigate();
  const [txs, setTxs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  const load = async () => {
    if (mode === "mock") { setTxs([]); setLoading(false); return; }
    setLoading(true);
    try {
      const r = await api.get("/transactions");
      setTxs(r.data);
    } catch (e) { toast.error(extractError(e)); }
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [mode]);

  const filtered = txs.filter((t) => {
    if (filter === "in") return t.amount > 0;
    if (filter === "out") return t.amount < 0;
    return true;
  });

  const totalIn = txs.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const totalOut = Math.abs(txs.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0));

  return (
    <div className="px-5 pt-2 pb-8 space-y-5" data-testid="history-page">
      <div className="flex items-center gap-3">
        <button onClick={() => nav(-1)} className="w-10 h-10 rounded-2xl bg-[#1A1A1E] border border-white/10 flex items-center justify-center text-zinc-400 active:scale-95">
          <ArrowLeft size={18} strokeWidth={2.5} />
        </button>
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.25em] text-zinc-500">Твоя активність</div>
          <h1 className="font-display text-2xl text-white leading-none mt-1">Історія балів</h1>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-[#1A1A1E] border-2 border-[#39FF14]/30 rounded-2xl p-4">
          <div className="flex items-center gap-2 text-zinc-500 text-[10px] font-black uppercase tracking-widest">
            <ArrowUpRight size={12} strokeWidth={3} /> Нараховано
          </div>
          <div className="font-display text-2xl text-[#39FF14] mt-1">+{totalIn.toLocaleString("uk-UA")}</div>
        </div>
        <div className="bg-[#1A1A1E] border-2 border-[#FF3B30]/30 rounded-2xl p-4">
          <div className="flex items-center gap-2 text-zinc-500 text-[10px] font-black uppercase tracking-widest">
            <ArrowDownRight size={12} strokeWidth={3} /> Витрачено
          </div>
          <div className="font-display text-2xl text-[#FF3B30] mt-1">-{totalOut.toLocaleString("uk-UA")}</div>
        </div>
      </div>

      <div className="bg-[#1A1A1E] border border-white/10 rounded-2xl p-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-[#FFB800]/15 border border-[#FFB800]/50 flex items-center justify-center">
          <Coins size={18} strokeWidth={3} color="#FFB800" />
        </div>
        <div className="flex-1">
          <div className="text-zinc-500 text-[10px] font-black uppercase tracking-widest">Поточний баланс</div>
          <div className="font-display text-2xl text-[#FFB800] leading-none mt-1">{(user?.balance ?? 0).toLocaleString("uk-UA")}</div>
        </div>
      </div>

      <div className="flex gap-2" data-testid="tx-filters">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            data-testid={`tx-filter-${f.id}`}
            onClick={() => setFilter(f.id)}
            className={`flex-1 h-10 rounded-full font-black text-xs uppercase tracking-wider border-2 flex items-center justify-center gap-1.5 ${
              filter === f.id ? "bg-[#FFB800] border-[#FFB800] text-[#0A0A0A]" : "bg-[#1A1A1E] border-white/10 text-zinc-400"
            }`}
          >
            <Filter size={12} strokeWidth={3} />
            {f.label}
          </button>
        ))}
      </div>

      {loading && <div className="text-zinc-500 text-sm py-8 text-center">Завантаження...</div>}

      {!loading && filtered.length === 0 && (
        <div className="bg-[#1A1A1E] border border-white/10 rounded-3xl p-8 text-center">
          <Coins size={40} strokeWidth={2.5} className="mx-auto text-zinc-600 mb-3" />
          <div className="text-white font-black text-sm">Транзакцій ще немає</div>
          <div className="text-zinc-500 text-xs mt-1">Виконуй квести — і твоя історія почне рости</div>
        </div>
      )}

      <div className="space-y-2" data-testid="tx-list">
        {filtered.map((tx) => <Row key={tx.id} tx={tx} />)}
      </div>
    </div>
  );
}
