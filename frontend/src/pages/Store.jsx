import { useMemo, useState } from "react";
import {
  Check,
  Coins,
  Coffee,
  CalendarOff,
  Clock4,
  Gift,
  ShoppingBag,
  UserRound,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useApp } from "@/context/AppContext";
import { fireConfetti } from "@/lib/confetti";
import AvatarFrame from "@/components/AvatarFrame";

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

const HIDDEN_STORE_CATEGORIES = new Set(["merch", "certificate"]);
const AVATAR_RARITIES = [
  { id: "basic", label: "Базові", hint: "Стартова колекція", color: "#8B93A7" },
  { id: "improved", label: "Покращені", hint: "Щоденний бонус", color: "#22C55E" },
  { id: "rare", label: "Рідкісні", hint: "Більше Point щодня", color: "#3B82F6" },
  { id: "epic", label: "Епічні", hint: "Бонус і заміна завдання", color: "#7C3AED" },
  { id: "legendary", label: "Легендарні", hint: "Максимальні переваги", color: "#D18A00" },
];

const shortAvatarTitle = (title) => {
  const value = String(title || "Аватар");
  const parts = value.split("•");
  return (parts[1] || parts[0]).trim().replace(/^аватар\s*/i, "") || "Аватар";
};

const canBuyPrize = (prize, balance, owned) => {
  const effectivePrice = owned ? 0 : Number(prize.price || 0);
  return Number(balance || 0) >= effectivePrice && (prize.category === "avatar" || Number(prize.stock || 0) > 0);
};

const PrizeCard = ({ prize, balance, onBuy }) => {
  const affordable = canBuyPrize(prize, balance, false);
  const IconFallback = ICONS[prize.icon] || Gift;

  return (
    <article
      data-testid={`prize-${prize.id}`}
      className={`store-prize-card overflow-hidden rounded-3xl border-2 bg-[#1A1A1E] transition-all ${
        affordable ? "border-white/10" : "border-white/5 opacity-75"
      }`}
    >
      <div className="store-prize-media relative flex aspect-[4/3] min-h-[142px] items-center justify-center overflow-hidden bg-[#0A0A0A]">
        {prize.image ? (
          <img src={prize.image} alt={prize.title} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <IconFallback size={52} strokeWidth={2.25} className="text-[#FFB800]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0A0A0A]/35 via-transparent to-transparent" />
        <div className="absolute left-2 top-2 rounded-full border border-white/10 bg-black/50 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-white backdrop-blur-sm">
          {Number(prize.stock || 0) > 0 ? `${prize.stock} шт` : "Немає"}
        </div>
      </div>

      <div className="flex min-h-[154px] flex-col p-4">
        <div className="line-clamp-2 text-sm font-black leading-tight text-white">{prize.title}</div>
        {prize.team_id && (
          <div className="mt-1 inline-flex w-fit rounded-full bg-[#00F0FF]/10 px-2 py-0.5 text-[9px] font-black uppercase text-[#00F0FF]">
            Лише {prize.team_name || "ваша команда"}
          </div>
        )}
        <div className="mt-1 line-clamp-2 text-xs leading-relaxed text-zinc-500">{prize.description}</div>
        <div className="mt-auto flex items-center justify-between gap-2 pt-3">
          <div className="flex min-w-0 items-center gap-1.5">
            <Coins size={16} strokeWidth={3} className="shrink-0 text-[#FFB800]" />
            <span className="truncate font-display text-base text-[#FFB800]">{Number(prize.price || 0).toLocaleString("uk-UA")}</span>
          </div>
          <button
            data-testid={`buy-${prize.id}`}
            disabled={!affordable}
            onClick={() => onBuy(prize)}
            className={`arcade-btn h-10 shrink-0 px-3 text-[10px] font-black uppercase tracking-wider ${
              affordable
                ? "border-[#7a5900] bg-[#FFB800] text-[#0A0A0A]"
                : "cursor-not-allowed border-[#141416] bg-[#27272A] text-zinc-500"
            }`}
          >
            {Number(prize.stock || 0) <= 0 ? "Немає" : affordable ? "Взяти" : "Мало Point"}
          </button>
        </div>
      </div>
    </article>
  );
};

const AvatarPrizeCard = ({ prize, balance, onBuy, owned, active, rarityColor }) => {
  const effectivePrice = owned ? 0 : Number(prize.price || 0);
  const affordable = canBuyPrize(prize, balance, owned);
  const buttonLabel = active ? "Обрано" : owned ? "Обрати" : affordable ? "Купити" : "Мало Point";

  return (
    <article
      data-testid={`prize-${prize.id}`}
      className={`store-avatar-card w-[136px] shrink-0 rounded-2xl border bg-[#1A1A1E] p-2.5 text-center ${active ? "is-active" : ""}`}
      style={{ "--avatar-rarity-color": rarityColor }}
    >
      <div className="store-avatar-preview mx-auto flex h-[76px] w-[76px] items-center justify-center rounded-2xl">
        <AvatarFrame
          src={prize.image}
          alt={prize.title}
          initials="?"
          rarity={prize.avatar_rarity}
          size="sm"
        />
      </div>

      <div className="mt-1.5 min-h-[30px] line-clamp-2 text-[10px] font-black leading-[1.25] text-white">
        {shortAvatarTitle(prize.title)}
      </div>

      <div className="mt-1 flex min-h-[22px] flex-wrap items-center justify-center gap-1 text-[8px] font-black">
        {Number(prize.daily_bonus || 0) > 0 && (
          <span className="rounded-full bg-[#39FF14]/10 px-1.5 py-0.5 text-[#39FF14]">+{prize.daily_bonus}/день</span>
        )}
        {Number(prize.task_replacements || 0) > 0 && (
          <span className="rounded-full bg-[#B78CFF]/10 px-1.5 py-0.5 text-[#B78CFF]">+{prize.task_replacements} зам.</span>
        )}
        {!prize.daily_bonus && !prize.task_replacements && (
          <span className="text-zinc-500">Без бонусу</span>
        )}
      </div>

      <div className="mt-2 flex items-center justify-center gap-1 text-[#FFB800]">
        <Coins size={12} strokeWidth={3} />
        <span className="font-display text-xs">{effectivePrice.toLocaleString("uk-UA")}</span>
      </div>

      <button
        data-testid={`buy-${prize.id}`}
        disabled={!affordable || active}
        onClick={() => onBuy(prize)}
        className={`mt-2 h-9 w-full rounded-xl border text-[9px] font-black uppercase tracking-wide transition-transform active:scale-95 ${
          active
            ? "cursor-default border-[#39FF14]/35 bg-[#39FF14]/10 text-[#39FF14]"
            : affordable
              ? "border-[#FFB800]/50 bg-[#FFB800] text-[#0A0A0A]"
              : "cursor-not-allowed border-white/10 bg-[#27272A] text-zinc-500"
        }`}
      >
        {buttonLabel}
      </button>
    </article>
  );
};

const AvatarCatalog = ({ groups, balance, onBuy, ownedIds, activeId }) => (
  <div className="space-y-4" data-testid="avatar-catalog">
    {AVATAR_RARITIES.map((rarity) => {
      const items = groups[rarity.id] || [];
      if (!items.length) return null;
      return (
        <section key={rarity.id} className="store-avatar-tier rounded-3xl border border-white/10 bg-[#1A1A1E] p-3">
          <div className="mb-2 flex items-center justify-between gap-3 px-0.5">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: rarity.color }} />
                <h2 className="truncate text-xs font-black uppercase tracking-wider text-white">{rarity.label}</h2>
              </div>
              <p className="mt-0.5 truncate pl-[18px] text-[9px] font-bold text-zinc-500">{rarity.hint}</p>
            </div>
            <span className="shrink-0 rounded-full bg-black/25 px-2 py-1 text-[9px] font-black text-zinc-400">{items.length}</span>
          </div>
          <div className="store-avatar-row -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {items.map((prize) => (
              <AvatarPrizeCard
                key={prize.id}
                prize={prize}
                balance={balance}
                onBuy={onBuy}
                owned={ownedIds.includes(prize.id)}
                active={activeId === prize.id}
                rarityColor={rarity.color}
              />
            ))}
          </div>
        </section>
      );
    })}
  </div>
);

const ConfirmSheet = ({ prize, balance, onConfirm, onClose, submitting, owned }) => {
  if (!prize) return null;
  const effectivePrice = owned ? 0 : Number(prize.price || 0);
  const after = Number(balance || 0) - effectivePrice;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} data-testid="confirm-backdrop" />
      <div
        data-testid="confirm-sheet"
        className="store-confirm-sheet relative w-full max-w-[480px] rounded-t-3xl border-t border-white/10 bg-[#1A1A1E] p-6 pb-24"
        style={{ animation: "slide-in-right 300ms ease-out" }}
      >
        <div className="mb-4 flex justify-center"><div className="h-1.5 w-12 rounded-full bg-white/20" /></div>
        <button onClick={onClose} className="absolute right-5 top-5 flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-[#0A0A0A] text-zinc-400" aria-label="Закрити">
          <X size={16} strokeWidth={3} />
        </button>
        <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Підтвердження обміну</div>
        <h3 className="mt-1 pr-10 font-display text-xl leading-tight text-white">{prize.title}</h3>
        <p className="mt-1 text-sm leading-relaxed text-zinc-400">{prize.description}</p>
        <div className="mt-5 space-y-3 rounded-2xl border border-white/5 bg-[#0A0A0A] p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase tracking-widest text-zinc-500">Ціна</span>
            <div className="flex items-center gap-1.5 text-[#FFB800]"><Coins size={16} strokeWidth={3} /><span className="font-display text-lg">{effectivePrice.toLocaleString("uk-UA")}</span></div>
          </div>
          <div className="flex items-center justify-between"><span className="text-xs font-black uppercase tracking-widest text-zinc-500">Баланс зараз</span><span className="font-black text-white">{Number(balance || 0).toLocaleString("uk-UA")}</span></div>
          <div className="flex items-center justify-between border-t border-white/5 pt-3"><span className="text-xs font-black uppercase tracking-widest text-zinc-500">Залишиться</span><span className="font-black text-[#39FF14]">{after.toLocaleString("uk-UA")}</span></div>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3">
          <button data-testid="confirm-cancel" onClick={onClose} className="arcade-btn h-14 border-[#141416] bg-[#27272A] text-sm font-black uppercase tracking-wider text-white">Скасувати</button>
          <button data-testid="confirm-buy" disabled={submitting} onClick={onConfirm} className="arcade-btn flex h-14 items-center justify-center gap-2 border-[#7a5900] bg-[#FFB800] text-sm font-black uppercase tracking-wider text-[#0A0A0A] disabled:opacity-60">
            <Check size={16} strokeWidth={3} />{submitting ? "..." : prize.category === "avatar" && owned ? "Обрати" : "Обміняти"}
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

  const storefrontPrizes = useMemo(
    () => (Array.isArray(prizes) ? prizes : []).filter((prize) => !HIDDEN_STORE_CATEGORIES.has(prize.category)),
    [prizes]
  );

  const generalPrizes = useMemo(() => {
    const nonAvatars = storefrontPrizes.filter((prize) => prize.category !== "avatar");
    const filtered = cat === "privilege" ? nonAvatars.filter((prize) => prize.category === "privilege") : nonAvatars;
    return [...filtered].sort((a, b) => Number(a.price || 0) - Number(b.price || 0));
  }, [cat, storefrontPrizes]);

  const avatarGroups = useMemo(() => {
    const groups = Object.fromEntries(AVATAR_RARITIES.map((rarity) => [rarity.id, []]));
    storefrontPrizes
      .filter((prize) => prize.category === "avatar")
      .sort((a, b) => Number(a.price || 0) - Number(b.price || 0) || String(a.title || "").localeCompare(String(b.title || ""), "uk"))
      .forEach((prize) => {
        const key = groups[prize.avatar_rarity] ? prize.avatar_rarity : "basic";
        groups[key].push(prize);
      });
    return groups;
  }, [storefrontPrizes]);

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
    toast.success(pending.category === "avatar" ? "Аватар активовано!" : "Замовлення оформлено!", {
      description: pending.category === "avatar" ? `${pending.title} тепер у профілі` : `${pending.title} — в обробці`,
      duration: 3000,
    });
    setPending(null);
  };

  const ownedAvatarIds = user.owned_avatar_ids || [];

  return (
    <div className="store-page space-y-5 px-5 pb-8 pt-2" data-testid="store-page">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-black uppercase tracking-[0.25em] text-zinc-500">Обмін балів</div>
          <h1 className="mt-1 truncate font-display text-3xl text-white">Магазин</h1>
        </div>
        <div data-testid="store-balance" className="flex shrink-0 items-center gap-2 rounded-2xl border-2 border-[#FFB800]/40 bg-[#1A1A1E] px-3 py-2">
          <Coins size={16} strokeWidth={3} className="text-[#FFB800]" />
          <span className="font-display text-base text-[#FFB800]">{Number(user.balance || 0).toLocaleString("uk-UA")}</span>
        </div>
      </div>

      <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1" data-testid="category-tabs">
        {PRIZE_CATEGORIES.map((category) => (
          <button
            key={category.id}
            data-testid={`cat-${category.id}`}
            onClick={() => setCat(category.id)}
            className={`h-10 shrink-0 rounded-full border-2 px-4 text-xs font-black uppercase tracking-wider transition-colors ${
              cat === category.id ? "border-[#FFB800] bg-[#FFB800] text-[#0A0A0A]" : "border-white/10 bg-[#1A1A1E] text-zinc-400"
            }`}
          >
            {category.label}
          </button>
        ))}
      </div>

      {cat !== "avatar" && orders.length > 0 && (
        <div data-testid="orders-strip" className="flex items-center gap-3 rounded-3xl border border-white/10 bg-[#1A1A1E] p-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border-2 border-[#00F0FF]/50 bg-[#00F0FF]/15 text-[#00F0FF]">
            <ShoppingBag size={20} strokeWidth={3} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-black text-white">{orders.length} {orders.length === 1 ? "замовлення" : "замовлень"}</div>
            <div className="truncate text-xs text-zinc-500">Останнє: {orders[0].prize_title}</div>
          </div>
        </div>
      )}

      {cat === "avatar" ? (
        <AvatarCatalog
          groups={avatarGroups}
          balance={user.balance}
          onBuy={setPending}
          ownedIds={ownedAvatarIds}
          activeId={user.active_avatar_prize_id}
        />
      ) : generalPrizes.length ? (
        <div className="grid grid-cols-2 gap-3" data-testid="prize-grid">
          {generalPrizes.map((prize) => <PrizeCard key={prize.id} prize={prize} balance={user.balance} onBuy={setPending} />)}
        </div>
      ) : (
        <div className="rounded-3xl border border-white/10 bg-[#1A1A1E] p-8 text-center">
          <Gift size={36} className="mx-auto text-zinc-500" />
          <div className="mt-3 text-sm font-black text-white">У цій категорії поки порожньо</div>
          <div className="mt-1 text-xs text-zinc-500">Нові привілеї зʼявляться тут після публікації адміністратором.</div>
        </div>
      )}

      <ConfirmSheet
        prize={pending}
        balance={user.balance}
        onConfirm={doBuy}
        onClose={() => setPending(null)}
        submitting={submitting}
        owned={Boolean(pending && ownedAvatarIds.includes(pending.id))}
      />
    </div>
  );
}
