import { useEffect, useState } from "react";
import { Trophy, Coins, Crown, Medal, Award, TrendingUp, UsersRound } from "lucide-react";
import { toast } from "sonner";
import api, { extractError } from "@/lib/api";
import { useApp } from "@/context/AppContext";

const PERIODS = [
  { id: "week", label: "Тиждень" },
  { id: "month", label: "Місяць" },
  { id: "all", label: "Всього" },
  { id: "teams", label: "Команди" },
];

const RankBadge = ({ rank }) => {
  if (rank === 1) return <Crown size={20} strokeWidth={3} color="#FFB800" />;
  if (rank === 2) return <Medal size={20} strokeWidth={3} color="#C0C7D0" />;
  if (rank === 3) return <Award size={20} strokeWidth={3} color="#CD7F32" />;
  return <span className="font-display text-base text-zinc-500 w-5 text-center">{rank}</span>;
};

const Row = ({ entry, dim }) => (
  <div
    data-testid={`lb-row-${entry.rank}`}
    className={`flex items-center gap-3 p-3 rounded-2xl border-2 transition-all ${
      entry.is_me
        ? "bg-[#FFB800]/10 border-[#FFB800]/60 glow-yellow"
        : dim
        ? "bg-[#141416] border-white/5"
        : "bg-[#1A1A1E] border-white/10"
    }`}
  >
    <div className="w-8 flex items-center justify-center shrink-0">
      <RankBadge rank={entry.rank} />
    </div>
    <div
      className="w-11 h-11 rounded-xl flex items-center justify-center font-display text-sm text-[#0A0A0A] shrink-0"
      style={{ backgroundColor: entry.avatar_color }}
    >
      {entry.avatar_initials || "?"}
    </div>
    <div className="flex-1 min-w-0">
      <div className={`font-black text-sm truncate ${entry.is_me ? "text-[#FFB800]" : "text-white"}`}>
        {entry.name}
        {entry.is_me && <span className="ml-2 text-[10px] font-black uppercase tracking-wider text-[#FFB800]">ти</span>}
      </div>
      <div className="text-zinc-500 text-[11px] truncate">{entry.department || "—"}</div>
    </div>
    <div className="flex items-center gap-1.5 shrink-0">
      <Coins size={14} strokeWidth={3} color="#FFB800" />
      <span className="font-display text-base text-[#FFB800]">{entry.score.toLocaleString("uk-UA")}</span>
    </div>
  </div>
);

const TeamRow = ({ entry }) => (
  <div
    data-testid={`lb-team-${entry.rank}`}
    className="flex items-center gap-3 p-3 rounded-2xl border-2 bg-[#1A1A1E] border-white/10"
  >
    <div className="w-8 flex items-center justify-center shrink-0">
      <RankBadge rank={entry.rank} />
    </div>
    <div
      className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
      style={{ backgroundColor: entry.color + "22", border: `2px solid ${entry.color}` }}
    >
      <UsersRound size={18} strokeWidth={3} color={entry.color} />
    </div>
    <div className="flex-1 min-w-0">
      <div className="font-black text-sm truncate text-white">{entry.name}</div>
      <div className="text-zinc-500 text-[11px] truncate">
        {entry.department || "—"} • {entry.member_count} учасн.
      </div>
    </div>
    <div className="flex flex-col items-end shrink-0">
      <div className="flex items-center gap-1 text-[#FFB800] font-display text-base">
        <Coins size={14} strokeWidth={3} />
        {entry.total_earned.toLocaleString("uk-UA")}
      </div>
      <div className="text-[10px] text-zinc-500 font-black">
        ~{entry.avg_earned.toLocaleString("uk-UA")} / person
      </div>
    </div>
  </div>
);

export default function Leaderboard() {
  const { mode } = useApp();
  const [period, setPeriod] = useState("week");
  const [data, setData] = useState(null);
  const [teamsData, setTeamsData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async (p) => {
    if (mode === "mock") {
      setData({ period: p, top: [], my_entry: null });
      setTeamsData([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      if (p === "teams") {
        const r = await api.get("/leaderboard/teams");
        setTeamsData(r.data);
      } else {
        const r = await api.get(`/leaderboard?period=${p}`);
        setData(r.data);
      }
    } catch (e) {
      toast.error(extractError(e));
    }
    setLoading(false);
  };

  useEffect(() => { load(period); /* eslint-disable-next-line */ }, [period, mode]);

  return (
    <div className="px-5 pt-2 pb-8 space-y-5" data-testid="leaderboard-page">
      <div>
        <div className="text-[10px] font-black uppercase tracking-[0.25em] text-zinc-500">Рейтинг</div>
        <h1 className="font-display text-3xl text-white mt-1 flex items-center gap-2">
          <Trophy size={28} strokeWidth={3} color="#FFB800" />
          LeaderBoard
        </h1>
      </div>

      <div className="flex gap-2 overflow-x-auto -mx-1 px-1" data-testid="lb-periods">
        {PERIODS.map((p) => (
          <button
            key={p.id}
            data-testid={`lb-period-${p.id}`}
            onClick={() => setPeriod(p.id)}
            className={`shrink-0 h-11 px-4 rounded-full font-black text-xs uppercase tracking-wider transition-colors border-2 ${
              period === p.id ? "bg-[#FFB800] border-[#FFB800] text-[#0A0A0A]" : "bg-[#1A1A1E] border-white/10 text-zinc-400"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {mode === "mock" && (
        <div className="bg-[#FF5C00]/10 border border-[#FF5C00]/40 rounded-2xl p-4 text-[#FF5C00] font-black text-sm">
          Рейтинг доступний тільки з реальним бекендом.
        </div>
      )}

      {loading && <div className="text-zinc-500 text-sm py-8 text-center">Завантаження...</div>}

      {period === "teams" ? (
        <>
          {!loading && teamsData && teamsData.length === 0 && (
            <div className="bg-[#1A1A1E] border border-white/10 rounded-3xl p-8 text-center">
              <UsersRound size={40} strokeWidth={2.5} className="mx-auto text-zinc-600 mb-3" />
              <div className="text-white font-black text-sm">Ще немає команд</div>
              <div className="text-zinc-500 text-xs mt-1">Адмін створить їх у панелі</div>
            </div>
          )}
          {!loading && teamsData && teamsData.length > 0 && (
            <div className="space-y-2" data-testid="lb-teams-list">
              {teamsData.map((t) => <TeamRow key={t.team_id} entry={t} />)}
            </div>
          )}
        </>
      ) : (
        <>
          {!loading && data && data.top.length === 0 && mode !== "mock" && (
            <div className="bg-[#1A1A1E] border border-white/10 rounded-3xl p-8 text-center">
              <TrendingUp size={40} strokeWidth={2.5} className="mx-auto text-zinc-600 mb-3" />
              <div className="text-white font-black text-sm">Ще немає результатів</div>
              <div className="text-zinc-500 text-xs mt-1">Виконуй квести — і потрапиш у топ</div>
            </div>
          )}
          {!loading && data && data.top.length > 0 && (
            <div className="space-y-2" data-testid="lb-top">
              {data.top.map((e) => <Row key={e.user_id} entry={e} />)}
            </div>
          )}
          {!loading && data?.my_entry && (
            <div className="pt-2" data-testid="lb-my-entry">
              <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2 px-1">Твоя позиція</div>
              <Row entry={data.my_entry} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
