import { useEffect, useState } from "react";
import { UsersRound, Crown, Coins, TrendingUp, Medal } from "lucide-react";
import { toast } from "sonner";
import api, { extractError } from "@/lib/api";
import { useApp } from "@/context/AppContext";

const RANK_COLORS = ["#FFB800", "#C0C0C0", "#CD7F32"];

export default function Teams() {
  const { user } = useApp();
  const [ranking, setRanking] = useState([]);
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [rR, tR] = await Promise.all([api.get("/leaderboard/teams"), api.get("/teams")]);
        setRanking(rR.data || []);
        setTeams(tR.data || []);
      } catch (e) { toast.error(extractError(e)); }
      setLoading(false);
    })();
  }, []);

  const teamById = Object.fromEntries(teams.map((t) => [t.id, t]));
  const maxEarned = Math.max(1, ...ranking.map((r) => r.total_earned));

  return (
    <div className="px-5 pt-2 pb-8 space-y-5">
      <div>
        <div className="text-[10px] font-black uppercase tracking-[0.25em] text-zinc-500">Разом сильніші</div>
        <h1 className="font-display text-3xl text-white mt-1">Команди</h1>
      </div>

      {loading && <div className="text-zinc-500 text-sm py-8 text-center font-black">Завантаження...</div>}

      {!loading && ranking.length === 0 && (
        <div className="text-center text-zinc-500 py-10 text-sm font-black">Ще немає команд</div>
      )}

      <div className="space-y-3" data-testid="teams-ranking">
        {ranking.map((t) => {
          const isMine = user?.team_id === t.team_id;
          const rankColor = RANK_COLORS[t.rank - 1];
          const team = teamById[t.team_id] || {};
          const pct = Math.round((t.total_earned / maxEarned) * 100);
          return (
            <div
              key={t.team_id}
              data-testid={`team-card-${t.team_id}`}
              className={`bg-[#1A1A1E] border-2 rounded-3xl p-4 ${isMine ? "border-[#FFB800]/60 glow-yellow" : "border-white/10"}`}
            >
              <div className="flex items-center gap-3">
                <div className="w-9 text-center font-display text-2xl shrink-0" style={{ color: rankColor || "#52525b" }}>
                  {t.rank <= 3 ? <Medal size={26} strokeWidth={2.5} className="mx-auto" /> : t.rank}
                </div>
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0" style={{ backgroundColor: t.color + "22", border: `2px solid ${t.color}` }}>
                  <UsersRound size={22} strokeWidth={2.75} color={t.color} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-white font-black text-sm truncate flex items-center gap-1.5">
                    {t.name}
                    {isMine && <span className="text-[9px] text-[#FFB800] font-black">• ТИ ТУТ</span>}
                  </div>
                  <div className="text-zinc-500 text-[11px] truncate">{t.department || "—"} • {t.member_count} учасн.</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="flex items-center gap-1 text-[#FFB800] font-display text-lg justify-end"><Coins size={15} strokeWidth={3} />{t.total_earned.toLocaleString("uk-UA")}</div>
                  <div className="text-zinc-500 text-[10px] font-black flex items-center gap-1 justify-end"><TrendingUp size={11} strokeWidth={3} /> сер. {t.avg_earned.toLocaleString("uk-UA")}</div>
                </div>
              </div>
              <div className="mt-3 h-2.5 rounded-full bg-[#0A0A0A] border border-white/5 overflow-hidden">
                <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${t.color}, #FFB800)` }} />
              </div>
              {team.description && <div className="text-zinc-600 text-[11px] mt-2">{team.description}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
