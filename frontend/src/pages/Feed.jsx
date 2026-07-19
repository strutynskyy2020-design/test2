import { useEffect, useState } from "react";
import { Swords, Gift, TrendingUp, Dice5, PackageCheck, Loader2, Newspaper } from "lucide-react";
import api, { extractError } from "@/lib/api";
import { toast } from "sonner";
import FeedSocial from "@/components/FeedSocial";
import AvatarFrame from "@/components/AvatarFrame";

const KIND_META = {
  quest: {
    label: "квест",
    color: "#39FF14",
    Icon: Swords,
    tone: "text-[#39FF14]",
    ring: "border-[#39FF14]/40",
    bg: "bg-[#39FF14]/10",
  },
  purchase: {
    label: "покупка",
    color: "#00F0FF",
    Icon: Gift,
    tone: "text-[#00F0FF]",
    ring: "border-[#00F0FF]/40",
    bg: "bg-[#00F0FF]/10",
  },
  cube: {
    label: "куб",
    color: "#FFB800",
    Icon: Dice5,
    tone: "text-[#FFB800]",
    ring: "border-[#FFB800]/40",
    bg: "bg-[#FFB800]/10",
  },
  level_up: {
    label: "рівень",
    color: "#FF5C00",
    Icon: TrendingUp,
    tone: "text-[#FF5C00]",
    ring: "border-[#FF5C00]/40",
    bg: "bg-[#FF5C00]/10",
  },
  goal: {
    label: "ціль",
    color: "#B78CFF",
    Icon: TrendingUp,
    tone: "text-[#B78CFF]",
    ring: "border-[#B78CFF]/40",
    bg: "bg-[#B78CFF]/10",
  },
  prize_delivered: {
    label: "видано",
    color: "#B78CFF",
    Icon: PackageCheck,
    tone: "text-[#B78CFF]",
    ring: "border-[#B78CFF]/40",
    bg: "bg-[#B78CFF]/10",
  },
};

const relativeTime = (iso) => {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "щойно";
  if (diff < 3600) return `${Math.floor(diff / 60)} хв тому`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} год тому`;
  const days = Math.floor(diff / 86400);
  if (days < 7) return `${days} дн тому`;
  return d.toLocaleDateString("uk-UA", { day: "numeric", month: "short" });
};

export const FeedItem = ({ ev }) => {
  const meta = KIND_META[ev.kind] || KIND_META.quest;
  const { Icon } = meta;
  const sign = ev.amount ? (ev.amount > 0 ? "+" : "") : "";
  return (
    <li
      data-testid={`feed-item-${ev.id}`}
      className={`relative bg-[#1A1A1E] border border-white/10 rounded-3xl p-4 transition-transform ${meta.ring}`}
    >
      <div className="flex items-start gap-3">
      {/* Avatar */}
      <div className="relative shrink-0">
        <AvatarFrame
          src={ev.avatar_url}
          alt={ev.user_name}
          initials={ev.avatar_initials}
          color={ev.avatar_color}
          rarity={ev.avatar_rarity}
          size="sm"
        />
        <div
          className={`absolute -bottom-1 -right-1 w-6 h-6 rounded-xl ${meta.bg} border-2 border-[#0A0A0A] flex items-center justify-center`}
          style={{ borderColor: "#0A0A0A" }}
        >
          <Icon size={12} strokeWidth={3} color={meta.color} />
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-white font-black text-sm truncate">{ev.user_name}</div>
          <div className="text-zinc-500 text-[10px] font-black uppercase tracking-wider shrink-0">
            {relativeTime(ev.created_at)}
          </div>
        </div>
        <div className="text-zinc-400 text-xs">
          <span className={`font-black ${meta.tone}`}>{ev.title}</span>
          {ev.subtitle && <span className="text-zinc-300"> — {ev.subtitle}</span>}
        </div>
        <div className="mt-1.5 flex items-center gap-2 flex-wrap">
          {ev.kind === "level_up" && (
            <span
              className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-lg border"
              style={{ color: meta.color, borderColor: meta.color + "66", background: meta.color + "1a" }}
            >
              LVL {ev.level}
            </span>
          )}
          {typeof ev.amount === "number" && ev.amount !== 0 && (
            <span
              className={`text-[11px] font-black rounded-lg px-2 py-0.5 border ${ev.amount > 0 ? "border-[#FFB800]/50 text-[#FFB800] bg-[#FFB800]/10" : "border-[#FF5C00]/50 text-[#FF5C00] bg-[#FF5C00]/10"}`}
            >
              {sign}
              {ev.amount.toLocaleString("uk-UA")} б.
            </span>
          )}
          {ev.department && (
            <span className="text-[10px] text-zinc-500 truncate">{ev.department}</span>
          )}
        </div>
      </div>
      </div>

      <FeedSocial ev={ev} />
    </li>
  );
};

export default function Feed() {
  const [events, setEvents] = useState([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/feed", { params: { limit: 60 } });
      setEvents(data.events || []);
    } catch (e) {
      toast.error(extractError(e, "Не вдалося завантажити стрічку"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filters = [
    { key: "all", label: "Все", color: "#F5F5F5" },
    { key: "quest", label: "Квести", color: "#39FF14" },
    { key: "level_up", label: "Рівні", color: "#FF5C00" },
    { key: "purchase", label: "Покупки", color: "#00F0FF" },
    { key: "cube", label: "Куб", color: "#FFB800" },
  ];

  const filtered = filter === "all" ? events : events.filter((e) => e.kind === filter);

  return (
    <div className="px-5 pt-2 pb-8 space-y-4">
      <section
        className="bg-gradient-to-r from-[#39FF14]/15 to-transparent border border-[#39FF14]/30 rounded-3xl p-4 flex items-center gap-3"
        data-testid="feed-header"
      >
        <div className="w-12 h-12 rounded-2xl bg-[#39FF14] flex items-center justify-center">
          <Newspaper size={24} strokeWidth={3} color="#0A0A0A" />
        </div>
        <div className="flex-1">
          <div className="text-white font-display text-lg leading-none">СТРІЧКА</div>
          <div className="text-zinc-400 text-xs mt-1">Що відбувається в команді прямо зараз</div>
        </div>
      </section>

      {/* Filter chips */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1" data-testid="feed-filters">
        {filters.map((f) => {
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              data-testid={`feed-filter-${f.key}`}
              onClick={() => setFilter(f.key)}
              className={`shrink-0 px-3 py-1.5 rounded-2xl border-2 text-[11px] font-black uppercase tracking-widest transition-transform active:scale-95 ${
                active ? "text-[#0A0A0A]" : "text-zinc-400 border-white/10 bg-[#1A1A1E]"
              }`}
              style={active ? { backgroundColor: f.color, borderColor: f.color } : {}}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-zinc-500 gap-2" data-testid="feed-loading">
          <Loader2 className="animate-spin" size={18} />
          <span className="text-xs font-black uppercase tracking-widest">Завантаження...</span>
        </div>
      ) : filtered.length === 0 ? (
        <div
          className="bg-[#1A1A1E] border border-white/10 rounded-3xl p-8 text-center"
          data-testid="feed-empty"
        >
          <div className="text-zinc-500 text-sm">Поки що тут порожньо</div>
          <div className="text-zinc-600 text-xs mt-1">Виконуй квести — і твоя активність з'явиться першою!</div>
        </div>
      ) : (
        <ul className="space-y-2.5" data-testid="feed-list">
          {filtered.map((ev) => (
            <FeedItem key={ev.id} ev={ev} />
          ))}
        </ul>
      )}
    </div>
  );
}
