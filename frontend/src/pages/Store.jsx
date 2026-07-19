import { useMemo, useState } from "react";
import { Coins, Gift, CalendarOff, Coffee, Clock4, ShoppingBag, X, Check, UserRound } from "lucide-react";
import { toast } from "sonner";
import { useApp } from "@/context/AppContext";
import { fireConfetti } from "@/lib/confetti";

const ICONS = {
  gift: Gift,
  "calendar-off": CalendarOff,
  coffee: Coffee,
  "clock-4": Clock4,
  "user-round": UserRound,
};

const PRIZE_CATEGORIES = [
  { id: "all", label: "Все" },
  { id: "privilege", label: "Привілеї" },
  { id: "avatar", label: "Аватарки" },
];

const PrizeCard = ({ prize, balance, onBuy, owned, active }) => {
  const effectivePrice = owned ? 0 : prize.price;
  const affordable = balance >= effectivePrice && (prize.category === "avatar" || prize.stock > 0);
  const IconFallback = ICONS[prize.icon] || Gift;

  return (
    <div
      data-testid={`prize-${prize.id}`}
      className={`bg-[#1A1A1E] border-2 rounded-3xl overflow-hidden flex flex-col transition-all ${
        affordable ? "border-white/10" : "border-white/5 opacity-70"
      }`}
    >
      <div className="relative aspect-[4/3] bg-[#0A0A0A] flex items-center justify-center overflow-hidden">
        {prize.image ? (
          <img src={prize.image} alt={prize.title} className={`w-full h-full object-cover ${prize.category === "avatar" ? "scale-[1.08]" : ""}`} loading="lazy" />
        ) : (
          <IconFallback size={56} strokeWidth={2.25} color="#FFB800" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0A0A0A]/70 via-transparent to-transparent" />
        <div className="absolute top-2 left-2 text-[9px] font-black uppercase tracking-widest bg-black/50 backdrop-blur-sm text-white px-2 py-1 rounded-full border border-white/10">
          {prize.category === "avatar" ? (active ? "Обрано" : owned ? "Придбано" : prize.avatar_rarity || "Аватар") : (prize.stock > 0 ? `${prize.stock} шт` : "Немає")}
        </div>
      </div>
      <div className="p-4 flex-1 flex flex-col">
        <div className="text-white font-black text-sm leading-tight">{prize.title}</div>
        <div className="text-zinc-500 text-xs mt-1 line-clamp-2">{prize.description}</div>
        {prize.category === "avatar" && (prize.daily_bonus > 0 || prize.task_replacements > 0) && <div className="mt-2 flex flex-wrap gap-1"><span className="rounded-full bg-[#39FF14]/10 px-2 py-1 text-[9px] font-black text-[#39FF14]">+{prize.daily_bonus} Point/день</span>{prize.task_replacements > 0 && <span className="rounded-full bg-[#B78CFF]/10 px-2 py-1 text-[9px] font-black text-[#B78CFF]">+{prize.task_replacements} заміни</span>}</div>}
        <div className="mt-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Coins size={16} strokeWidth={3} color="#FFB800" />
            <span className="font-display text-lg text-[#FFB800]">{(owned ? 0 : prize.price).toLocaleString("uk-UA")}</span>
          </div>
          <button
            data-testid={`buy-${prize.id}`}
            disabled={!affordable || active}
            onClick={() => onBuy(prize)}
            className={`arcade-btn h-10 px-4 text-xs font-black uppercase tracking-wider ${
              affordable
                ? "bg-[#FFB800] border-[#7a5900] text-[#0A0A0A]"
                : "bg-[#27272A] border-[#141416] text-zinc-500 cursor-not-allowed"
            }`}
          >
            {active ? "Обрано" : owned ? "Обрати" : prize.stock <= 0 && prize.category !== "avatar" ? "Немає" : affordable ? (prize.category === "avatar" ? "Придбати" : "Взяти") : "Мало балів"}
          </button>
        </div>
      </div>
    </div>
  );
};

const ConfirmSheet = ({ prize, balance, onConfirm, onClose, submitting, owned }) => {
  if (!prize) return null;
  const effectivePrice = owned ? 0 : prize.price;
  const after = balance - effectivePrice;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} data-testid="confirm-backdrop" />
      <div
        data-testid="confirm-sheet"
        className="relative w-full max-w-[480px] bg-[#1A1A1E] border-t border-white/10 rounded-t-3xl p-6 pb-24"
        style={{ animation: "slide-in-right 300ms ease-out" }}
      >
        <div className="flex justify-center mb-4">
          <div className="w-12 h-1.5 rounded-full bg-white/20" />
        </div>
        <button
          onClick={onClose}
          className="absolute top-5 right-5 w-9 h-9 rounded-full bg-[#0A0A0A] border border-white/10 flex items-center justify-center text-zinc-400"
          aria-label="Закрити"
        >
          <X size={16} strokeWidth={3} />
        </button>
        <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Підтвердження обміну</div>
        <h3 className="font-display text-2xl text-white mt-1 leading-tight">{prize.title}</h3>
        <p className="text-zinc-400 text-sm mt-1">{prize.description}</p>
        <div className="mt-5 bg-[#0A0A0A] border border-white/5 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-zinc-500 text-xs font-black uppercase tracking-widest">Ціна</span>
            <div className="flex items-center gap-1.5">
              <Coins size={16} strokeWidth={3} color="#FFB800" />
              <span className="font-display text-lg text-[#FFB800]">{effectivePrice.toLocaleString("uk-UA")}</span>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-zinc-500 text-xs font-black uppercase tracking-widest">Баланс зараз</span>
            <span className="font-black text-white">{balance.toLocaleString("uk-UA")}</span>
          </div>
          <div className="border-t border-white/5 pt-3 flex items-center justify-between">
            <span className="text-zinc-500 text-xs font-black uppercase tracking-widest">Залишиться</span>
            <span className="font-black text-[#39FF14]">{after.toLocaleString("uk-UA")}</span>
          </div>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3">
          <button
            data-testid="confirm-cancel"
            onClick={onClose}
            className="arcade-btn h-14 bg-[#27272A] border-[#141416] text-white font-black text-sm uppercase tracking-wider"
          >
            Скасувати
          </button>
          <button
            data-testid="confirm-buy"
            disabled={submitting}
            onClick={onConfirm}
            className="arcade-btn h-14 bg-[#FFB800] border-[#7a5900] text-[#0A0A0A] font-black text-sm uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-60"
          >
            <Check size={16} strokeWidth={3} />
            {submitting ? "..." : "Обміняти"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default function Store() {
  const { user, prizes, orders, buyPrize } = useApp();
  const [cat, setCat] = useState("all");
  const [pending, setPending] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const filtered = useMemo(() => {
    const visible = prizes.filter((prize) =>
      ["privilege", "avatar"].includes(prize.category)
    );

    if (cat === "all") {
      return [...visible].sort((a, b) => {
        const categoryOrder = { privilege: 0, avatar: 1 };
        const categoryDiff =
          (categoryOrder[a.category] ?? 99) -
          (categoryOrder[b.category] ?? 99);

        if (categoryDiff !== 0) return categoryDiff;

        if (a.category === "avatar" && b.category === "avatar") {
          const rarityOrder = {
            basic: 0,
            improved: 1,
            rare: 2,
            epic: 3,
            legendary: 4,
          };
          const rarityDiff =
            (rarityOrder[a.avatar_rarity] ?? 99) -
            (rarityOrder[b.avatar_rarity] ?? 99);
          if (rarityDiff !== 0) return rarityDiff;
        }

        return Number(a.price || 0) - Number(b.price || 0);
      });
    }

    return visible.filter((prize) => prize.category === cat);
  }, [cat, prizes]);

  if (!user) return null;

  const doBuy = async () => {
    if (!pending) return;
    setSubmitting(true);
    const res = await buyPrize(pending.id);
    setSubmitting(false);
    if (!res.ok) {
      toast.error(res.error);
      setPending(null);
      return;
    }
    fireConfetti();
    toast.success(pending.category === "avatar" ? "Аватар активовано!" : "Замовлення оформлено!", { description: pending.category === "avatar" ? `${pending.title} тепер у профілі` : `${pending.title} — в обробці`, duration: 3000 });
    setPending(null);
  };

  return (
    <div className="px-5 pt-2 pb-8 space-y-5">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.25em] text-zinc-500">Обмін балів</div>
          <h1 className="font-display text-3xl text-white mt-1">Магазин</h1>
        </div>
        <div data-testid="store-balance" className="bg-[#1A1A1E] border-2 border-[#FFB800]/40 rounded-2xl px-4 py-2 flex items-center gap-2">
          <Coins size={16} strokeWidth={3} color="#FFB800" />
          <span className="font-display text-lg text-[#FFB800]">{user.balance.toLocaleString("uk-UA")}</span>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto -mx-5 px-5 pb-1" data-testid="category-tabs">
        {PRIZE_CATEGORIES.map((c) => (
          <button
            key={c.id}
            data-testid={`cat-${c.id}`}
            onClick={() => setCat(c.id)}
            className={`shrink-0 h-10 px-4 rounded-full font-black text-xs uppercase tracking-wider transition-colors border-2 ${
              cat === c.id ? "bg-[#FFB800] border-[#FFB800] text-[#0A0A0A]" : "bg-[#1A1A1E] border-white/10 text-zinc-400"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {orders.length > 0 && (
        <div data-testid="orders-strip" className="bg-[#1A1A1E] border border-white/10 rounded-3xl p-4 flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-[#00F0FF]/15 border-2 border-[#00F0FF]/50 flex items-center justify-center">
            <ShoppingBag size={20} strokeWidth={3} color="#00F0FF" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-white font-black text-sm">
              {orders.length} {orders.length === 1 ? "замовлення" : "замовлень"}
            </div>
            <div className="text-zinc-500 text-xs truncate">Останнє: {orders[0].prize_title}</div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3" data-testid="prize-grid">
        {filtered.map((p) => (
          <PrizeCard key={p.id} prize={p} balance={user.balance} onBuy={setPending} owned={(user.owned_avatar_ids || []).includes(p.id)} active={user.active_avatar_prize_id === p.id} />
        ))}
      </div>

      <ConfirmSheet prize={pending} balance={user.balance} onConfirm={doBuy} onClose={() => setPending(null)} submitting={submitting} owned={Boolean(pending && (user.owned_avatar_ids || []).includes(pending.id))} />
    </div>
  );
}
