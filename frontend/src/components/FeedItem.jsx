import { Swords, Gift, TrendingUp, Dice5, PackageCheck } from "lucide-react";
import FeedSocial from "@/components/FeedSocial";
import AvatarFrame from "@/components/AvatarFrame";

const KIND_META = {
  quest: { label: "квест", color: "#6D3DF5", Icon: Swords, tone: "text-[#6D3DF5]", ring: "border-[#6D3DF5]/40", bg: "bg-[#6D3DF5]/10" },
  purchase: { label: "покупка", color: "#00F0FF", Icon: Gift, tone: "text-[#00F0FF]", ring: "border-[#00F0FF]/40", bg: "bg-[#00F0FF]/10" },
  cube: { label: "куб", color: "#FFB800", Icon: Dice5, tone: "text-[#FFB800]", ring: "border-[#FFB800]/40", bg: "bg-[#FFB800]/10" },
  level_up: { label: "рівень", color: "#FF5C00", Icon: TrendingUp, tone: "text-[#FF5C00]", ring: "border-[#FF5C00]/40", bg: "bg-[#FF5C00]/10" },
  goal: { label: "ціль", color: "#B78CFF", Icon: TrendingUp, tone: "text-[#B78CFF]", ring: "border-[#B78CFF]/40", bg: "bg-[#B78CFF]/10" },
  prize_delivered: { label: "видано", color: "#B78CFF", Icon: PackageCheck, tone: "text-[#B78CFF]", ring: "border-[#B78CFF]/40", bg: "bg-[#B78CFF]/10" },
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

export default function FeedItem({ ev }) {
  const meta = KIND_META[ev.kind] || KIND_META.quest;
  const { Icon } = meta;
  const sign = ev.amount ? (ev.amount > 0 ? "+" : "") : "";
  return (
    <li data-testid={`feed-item-${ev.id}`} className={`relative rounded-3xl border border-white/10 bg-[#1A1A1E] p-4 transition-transform ${meta.ring}`}>
      <div className="flex items-start gap-3">
        <div className="relative shrink-0">
          <AvatarFrame src={ev.avatar_url} alt={ev.user_name} initials={ev.avatar_initials} color={ev.avatar_color} rarity={ev.avatar_rarity} size="sm" />
          <div className={`absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-xl border-2 border-[#0A0A0A] ${meta.bg}`}>
            <Icon size={12} strokeWidth={3} color={meta.color} />
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <div className="truncate text-sm font-black text-white">{ev.user_name}</div>
            <div className="shrink-0 text-[10px] font-black uppercase tracking-wider text-zinc-500">{relativeTime(ev.created_at)}</div>
          </div>
          <div className="text-xs text-zinc-400">
            <span className={`font-black ${meta.tone}`}>{ev.title}</span>
            {ev.subtitle && <span className="text-zinc-300"> — {ev.subtitle}</span>}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {ev.kind === "level_up" && <span className="rounded-lg border px-2 py-0.5 text-[10px] font-black uppercase tracking-widest" style={{ color: meta.color, borderColor: `${meta.color}66`, background: `${meta.color}1a` }}>LVL {ev.level}</span>}
            {typeof ev.amount === "number" && ev.amount !== 0 && <span className={`rounded-lg border px-2 py-0.5 text-[11px] font-black ${ev.amount > 0 ? "border-[#FFB800]/50 bg-[#FFB800]/10 text-[#FFB800]" : "border-[#FF5C00]/50 bg-[#FF5C00]/10 text-[#FF5C00]"}`}>{sign}{ev.amount.toLocaleString("uk-UA")} б.</span>}
            {ev.department && <span className="truncate text-[10px] text-zinc-500">{ev.department}</span>}
          </div>
        </div>
      </div>
      <FeedSocial ev={ev} />
    </li>
  );
}
