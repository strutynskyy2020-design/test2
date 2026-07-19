import { useEffect, useState } from "react";
import { Trophy, Coins, Crown, Medal, Award, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import api, { extractError } from "@/lib/api";
import { useApp } from "@/context/AppContext";
import AvatarFrame from "@/components/AvatarFrame";

const PERIODS = [
  { id: "day", label: "День" },
  { id: "week", label: "Тиждень" },
  { id: "month", label: "Місяць" },
  { id: "all", label: "Всього" },
];

const RankBadge = ({ rank }) => {
  if (rank === 1) return <Crown size={20} strokeWidth={3} color="#FFB800" />;
  if (rank === 2) return <Medal size={20} strokeWidth={3} color="#C0C7D0" />;
  if (rank === 3) return <Award size={20} strokeWidth={3} color="#CD7F32" />;
  return <span className="w-5 text-center font-display text-base text-zinc-500">{rank}</span>;
};

const Row = ({ entry, dim }) => (
  <div
    data-testid={`lb-row-${entry.rank}`}
    className={`flex min-h-[88px] items-center gap-3 rounded-2xl border-2 px-3 py-2.5 transition-all ${
      entry.is_me
        ? "border-[#FFB800]/60 bg-[#FFB800]/10"
        : dim
        ? "border-white/5 bg-[#141416]"
        : "border-white/10 bg-[#1A1A1E]"
    }`}
  >
    <div className="flex w-8 shrink-0 items-center justify-center"><RankBadge rank={entry.rank} /></div>
    <AvatarFrame
      src={entry.avatar_url}
      alt={entry.name}
      initials={entry.avatar_initials || "?"}
      color={entry.avatar_color}
      rarity={entry.avatar_rarity}
      size="md"
    />
    <div className="min-w-0 flex-1">
      <div className={`truncate text-sm font-black ${entry.is_me ? "text-[#FFB800]" : "text-white"}`}>
        {entry.name}{entry.is_me && <span className="ml-2 text-[10px] font-black uppercase tracking-wider text-[#FFB800]">ти</span>}
      </div>
      <div className="truncate text-[11px] text-zinc-500">{entry.department || "—"}</div>
    </div>
    <div className="flex min-w-[82px] shrink-0 items-center justify-end gap-1.5">
      <Coins size={14} strokeWidth={3} color="#FFB800" />
      <span className="font-display text-base text-[#FFB800]">{entry.score.toLocaleString("uk-UA")}</span>
    </div>
  </div>
);

export default function Leaderboard() {
  const { mode } = useApp();
  const [period, setPeriod] = useState("week");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async (selectedPeriod) => {
    if (mode === "mock") {
      setData({ period: selectedPeriod, top: [], my_entry: null });
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const response = await api.get(`/leaderboard?period=${selectedPeriod}`);
      setData(response.data);
    } catch (error) {
      toast.error(extractError(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(period); /* eslint-disable-next-line */ }, [period, mode]);

  return (
    <div className="space-y-5 px-5 pb-8 pt-2" data-testid="leaderboard-page">
      <div>
        <div className="text-[10px] font-black uppercase tracking-[0.25em] text-zinc-500">Рейтинг</div>
        <h1 className="mt-1 flex items-center gap-2 font-display text-3xl text-white"><Trophy size={28} strokeWidth={3} color="#FFB800" />LeaderBoard</h1>
      </div>

      <div className="-mx-1 flex gap-2 overflow-x-auto px-1" data-testid="lb-periods">
        {PERIODS.map((item) => (
          <button key={item.id} data-testid={`lb-period-${item.id}`} onClick={() => setPeriod(item.id)} className={`h-11 shrink-0 rounded-full border-2 px-4 text-xs font-black uppercase tracking-wider transition-colors ${period === item.id ? "border-[#FFB800] bg-[#FFB800] text-[#0A0A0A]" : "border-white/10 bg-[#1A1A1E] text-zinc-400"}`}>
            {item.label}
          </button>
        ))}
      </div>

      {mode === "mock" && <div className="rounded-2xl border border-[#FF5C00]/40 bg-[#FF5C00]/10 p-4 text-sm font-black text-[#FF5C00]">Рейтинг доступний тільки з реальним бекендом.</div>}
      {loading && <div className="py-8 text-center text-sm text-zinc-500">Завантаження...</div>}

      {!loading && data && data.top.length === 0 && mode !== "mock" && (
        <div className="rounded-3xl border border-white/10 bg-[#1A1A1E] p-8 text-center">
          <TrendingUp size={40} strokeWidth={2.5} className="mx-auto mb-3 text-zinc-600" />
          <div className="text-sm font-black text-white">Ще немає результатів</div>
          <div className="mt-1 text-xs text-zinc-500">Виконуй квести, і потрапиш у топ</div>
        </div>
      )}
      {!loading && data && data.top.length > 0 && <div className="space-y-2" data-testid="lb-top">{data.top.map((entry) => <Row key={entry.user_id} entry={entry} />)}</div>}
      {!loading && data?.my_entry && (
        <div className="pt-2" data-testid="lb-my-entry">
          <div className="mb-2 px-1 text-[10px] font-black uppercase tracking-widest text-zinc-500">Твоя позиція</div>
          <Row entry={data.my_entry} />
        </div>
      )}
    </div>
  );
}
