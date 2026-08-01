import { useEffect, useMemo, useState } from "react";
import { UsersRound, Coins, TrendingUp, Medal } from "lucide-react";
import { toast } from "sonner";
import api, { extractError } from "@/lib/api";
import { useApp } from "@/context/AppContext";

const PERIODS = [
  { id: "day", label: "День" },
  { id: "week", label: "Тиждень" },
  { id: "month", label: "Місяць" },
  { id: "all", label: "Всього" },
];

const RANK_COLORS = ["#FFB800", "#C0C0C0", "#CD7F32"];
const teamScore = (entry) => Number(entry?.score ?? entry?.total_earned ?? 0);
const teamAverage = (entry) => Number(entry?.avg_score ?? entry?.avg_earned ?? 0);

export default function Teams() {
  const { user } = useApp();
  const [period, setPeriod] = useState("week");
  const [ranking, setRanking] = useState([]);
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.get("/teams")
      .then((response) => { if (!cancelled) setTeams(response.data || []); })
      .catch((error) => { if (!cancelled) toast.error(extractError(error)); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.get(`/leaderboard/teams?period=${period}`)
      .then((response) => { if (!cancelled) setRanking(response.data || []); })
      .catch((error) => { if (!cancelled) toast.error(extractError(error)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [period]);

  const teamById = useMemo(() => Object.fromEntries(teams.map((team) => [team.id, team])), [teams]);
  const maxPositiveScore = Math.max(1, ...ranking.map((entry) => Math.max(0, teamScore(entry))));

  return (
    <div className="space-y-5 px-5 pb-8 pt-2" data-testid="teams-page">
      <div>
        <div className="text-[10px] font-black uppercase tracking-[0.25em] text-zinc-500">Разом сильніші</div>
        <h1 className="mt-1 font-display text-3xl text-white">Рейтинг команд</h1>
      </div>

      <div className="-mx-1 flex gap-2 overflow-x-auto px-1" data-testid="team-lb-periods">
        {PERIODS.map((item) => (
          <button
            key={item.id}
            type="button"
            data-testid={`team-lb-period-${item.id}`}
            onClick={() => setPeriod(item.id)}
            className={`h-11 shrink-0 rounded-full border-2 px-4 text-xs font-black uppercase tracking-wider transition-colors ${
              period === item.id
                ? "border-[#FFB800] bg-[#FFB800] text-[#0A0A0A]"
                : "border-white/10 bg-[#1A1A1E] text-zinc-400"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="-mt-2 px-1 text-[11px] font-bold text-zinc-500">Командний результат = усі зароблені Point мінус усі витрачені Point учасників.</div>

      {loading && <div className="py-8 text-center text-sm font-black text-zinc-500">Завантаження...</div>}

      {!loading && ranking.length === 0 && (
        <div className="py-10 text-center text-sm font-black text-zinc-500">Ще немає команд</div>
      )}

      {!loading && (
        <div className="space-y-3" data-testid="teams-ranking">
          {ranking.map((entry) => {
            const isMine = user?.team_id === entry.team_id;
            const rankColor = RANK_COLORS[entry.rank - 1];
            const team = teamById[entry.team_id] || {};
            const score = teamScore(entry);
            const average = teamAverage(entry);
            const progress = score > 0 ? Math.round((score / maxPositiveScore) * 100) : 0;
            const scoreColor = score < 0 ? "#FF5C5C" : score === 0 ? "#71717A" : "#FFB800";
            return (
              <div
                key={entry.team_id}
                data-testid={`team-card-${entry.team_id}`}
                className={`rounded-3xl border-2 bg-[#1A1A1E] p-4 ${isMine ? "border-[#FFB800]/60 glow-yellow" : "border-white/10"}`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 shrink-0 text-center font-display text-2xl" style={{ color: rankColor || "#52525b" }}>
                    {entry.rank <= 3 ? <Medal size={26} strokeWidth={2.5} className="mx-auto" /> : entry.rank}
                  </div>
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl" style={{ backgroundColor: `${entry.color}22`, border: `2px solid ${entry.color}` }}>
                    <UsersRound size={22} strokeWidth={2.75} color={entry.color} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 truncate text-sm font-black text-white">
                      {entry.name}
                      {isMine && <span className="text-[9px] font-black text-[#FFB800]">• ТИ ТУТ</span>}
                    </div>
                    <div className="truncate text-[11px] text-zinc-500">{entry.department || "—"} • {entry.member_count} учасн.</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="flex items-center justify-end gap-1 font-display text-lg" style={{ color: scoreColor }}>
                      <Coins size={15} strokeWidth={3} />{score.toLocaleString("uk-UA")}
                    </div>
                    <div className="flex items-center justify-end gap-1 text-[10px] font-black text-zinc-500">
                      <TrendingUp size={11} strokeWidth={3} /> сер. {average.toLocaleString("uk-UA")}
                    </div>
                  </div>
                </div>
                <div className="mt-3 h-2.5 overflow-hidden rounded-full border border-white/5 bg-[#0A0A0A]">
                  <div
                    className="h-full rounded-full transition-[width] duration-700"
                    style={{ width: `${progress}%`, background: `linear-gradient(90deg, ${entry.color}, #FFB800)` }}
                  />
                </div>
                {score < 0 && <div className="mt-2 text-[10px] font-black uppercase tracking-wider text-[#FF5C5C]">За період витрачено більше, ніж зароблено</div>}
                {team.description && <div className="mt-2 text-[11px] text-zinc-600">{team.description}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
