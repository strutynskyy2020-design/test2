import { Swords, Gift, TrendingUp, Dice5, PackageCheck, Gem, Sparkles } from "lucide-react";
import FeedSocial from "@/components/FeedSocial";
import AvatarFrame from "@/components/AvatarFrame";

const KIND_META = {
  quest: { label: "квест", color: "#6D3DF5", Icon: Swords, tone: "text-[#6D3DF5]", ring: "border-[#6D3DF5]/40", bg: "bg-[#6D3DF5]/10" },
  purchase: { label: "покупка", color: "#00F0FF", Icon: Gift, tone: "text-[#00F0FF]", ring: "border-[#00F0FF]/40", bg: "bg-[#00F0FF]/10" },
  cube: { label: "куб", color: "#FFB800", Icon: Dice5, tone: "text-[#FFB800]", ring: "border-[#FFB800]/40", bg: "bg-[#FFB800]/10" },
  level_up: { label: "рівень", color: "#FF5C00", Icon: TrendingUp, tone: "text-[#FF5C00]", ring: "border-[#FF5C00]/40", bg: "bg-[#FF5C00]/10" },
  goal: { label: "ціль", color: "#B78CFF", Icon: TrendingUp, tone: "text-[#B78CFF]", ring: "border-[#B78CFF]/40", bg: "bg-[#B78CFF]/10" },
  prize_delivered: { label: "видано", color: "#B78CFF", Icon: PackageCheck, tone: "text-[#B78CFF]", ring: "border-[#B78CFF]/40", bg: "bg-[#B78CFF]/10" },
  diamond_avatar: { label: "алмаз", color: "#7DD3FC", Icon: Gem, tone: "text-[#A5F3FC]", ring: "border-[#7DD3FC]/70", bg: "bg-[#0EA5E9]/20" },
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
  const isDiamond = ev.kind === "diamond_avatar";
  return (
    <li
      data-testid={`feed-item-${ev.id}`}
      className={`diamond-card-auto diamond-feed-shell relative overflow-hidden rounded-3xl border p-4 transition-transform ${meta.ring} ${isDiamond ? "diamond-feed-card" : "border-white/10 bg-[#1A1A1E]"}`}
    >
      {isDiamond && <div className="diamond-feed-aurora" aria-hidden="true" />}
      {isDiamond && (
        <div className="relative z-[1] mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-cyan-100">
            <Sparkles size={12} /> Особлива нагорода адміністратора
          </div>
          <span className="rounded-full border border-cyan-200/30 bg-cyan-300/10 px-2 py-1 text-[9px] font-black uppercase tracking-wider text-cyan-100">Diamond</span>
        </div>
      )}
      <div className="relative z-[1] flex items-start gap-3">
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
            {isDiamond && typeof ev.daily_bonus === "number" && <span className="rounded-lg border border-emerald-300/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-black text-emerald-200">+{ev.daily_bonus} Point щодня</span>}
            {isDiamond && typeof ev.task_replacements === "number" && <span className="rounded-lg border border-violet-300/30 bg-violet-400/10 px-2 py-0.5 text-[10px] font-black text-violet-200">+{ev.task_replacements} замін</span>}
            {isDiamond && typeof ev.duration_days === "number" && <span className="rounded-lg border border-cyan-300/30 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-black text-cyan-100">{ev.duration_days} дні</span>}
            {typeof ev.amount === "number" && ev.amount !== 0 && <span className={`rounded-lg border px-2 py-0.5 text-[11px] font-black ${ev.amount > 0 ? "border-[#FFB800]/50 bg-[#FFB800]/10 text-[#FFB800]" : "border-[#FF5C00]/50 bg-[#FF5C00]/10 text-[#FF5C00]"}`}>{sign}{ev.amount.toLocaleString("uk-UA")} б.</span>}
            {ev.department && <span className={`truncate text-[10px] ${isDiamond ? "text-cyan-100/55" : "text-zinc-500"}`}>{ev.department}</span>}
          </div>
        </div>
      </div>
      <FeedSocial ev={ev} />
    </li>
  );
}
