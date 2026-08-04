import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ChevronRight, HandCoins, Landmark, RefreshCcw, Target, Trophy, UsersRound } from "lucide-react";
import { useApp } from "@/context/AppContext";
import { useDailyGoogleReports } from "@/hooks/useGoogleReports";
import { useGoalsAccess } from "@/hooks/useGoalsAccess";
import { enrichReportRowsWithParticipants, normalizeReportLogin, normalizeTeamKey, rowMatchesTeam } from "@/lib/teamReports";
import AvatarFrame from "@/components/AvatarFrame";

const parsePercent = (value) => {
  const parsed = Number(
    String(value ?? "")
      .replace(/\u00a0/g, "")
      .replace(/\s+/g, "")
      .replace(",", ".")
      .replace(/[^0-9.+-]/g, "")
  );
  return Number.isFinite(parsed) ? parsed : 0;
};

const fmtPercent = (value) => `${parsePercent(value).toFixed(2).replace(".", ",")}%`;

const normalizeRows = (rows = []) => (Array.isArray(rows) ? rows : []).map((row) => ({
  ...row,
  login: normalizeReportLogin(row?.login || row?.goals_login),
  projective_rate: parsePercent(row?.projective_rate ?? row?.overall),
}));

function Avatar({ row }) {
  const fallback = String(row?.avatar_initials || row?.login || "?").slice(0, 2).toUpperCase();
  return (
    <AvatarFrame
      src={row?.avatar_url}
      alt={row?.login || "Аватар"}
      initials={fallback}
      color={row?.avatar_color || "#27272A"}
      rarity={row?.avatar_rarity}
      size="xs"
    />
  );
}

export default function DepositLeaderboard() {
  const { user } = useApp();
  const navigate = useNavigate();
  const { data: report, loading, error } = useDailyGoogleReports();
  const { data: access } = useGoalsAccess();
  const [selectedTeamId, setSelectedTeamId] = useState(user?.team_id || "");

  useEffect(() => {
    if (!selectedTeamId && (access?.current_team?.id || user?.team_id)) {
      setSelectedTeamId(access?.current_team?.id || user?.team_id || "");
    }
  }, [access?.current_team?.id, selectedTeamId, user?.team_id]);

  const teams = Array.isArray(access?.teams) ? access.teams : [];
  const selectedTeam = teams.find((team) => String(team.id) === String(selectedTeamId))
    || access?.current_team
    || teams[0]
    || null;

  const enriched = useMemo(
    () => enrichReportRowsWithParticipants(
      normalizeRows(report?.deposit_projection_leaderboard),
      access?.participants || []
    ),
    [access?.participants, report?.deposit_projection_leaderboard]
  );

  const rows = useMemo(() => {
    if (!selectedTeam) return [...enriched].sort((a, b) => b.projective_rate - a.projective_rate);
    const matched = enriched.filter((row) => rowMatchesTeam(row, selectedTeam));
    const accessIsTeamScoped = !access?.allow_cross_team_reports || teams.length <= 1;
    return [...(matched.length ? matched : accessIsTeamScoped ? enriched : [])]
      .sort((a, b) => b.projective_rate - a.projective_rate || String(a.login).localeCompare(String(b.login), "uk"));
  }, [access?.allow_cross_team_reports, enriched, selectedTeam, teams.length]);

  const teamKey = normalizeTeamKey(selectedTeam?.name);
  const rawSummary = report?.deposit_projection_group_summaries?.[teamKey];
  const teamProjective = parsePercent(rawSummary?.projective_rate ?? rawSummary?.overall);
  const currentLogin = normalizeReportLogin(user?.goals_login);
  const leader = rows[0] || null;
  const currentRow = rows.find((row) => row.login === currentLogin) || null;

  if (loading && !report) {
    return <div className="p-8 text-center text-sm font-bold text-zinc-500">Завантаження проекційного рейтингу…</div>;
  }

  return (
    <div className="space-y-4 px-5 pb-8 pt-2" data-testid="deposit-projection-leaderboard-page">
      <section className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => navigate("/goals")}
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-[#1A1A1E] text-zinc-300 active:scale-95"
          aria-label="Назад до цілей"
        >
          <ArrowLeft size={21} strokeWidth={2.7} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[25px] leading-tight text-white">Депозитний напрямок</h1>
          <div className="mt-1 text-xs font-bold text-zinc-500">Проекційний рейтинг · {selectedTeam?.name || "ваша команда"}</div>
          <div className="mt-1 flex items-center gap-1.5 text-[10px] font-bold text-zinc-600">
            <RefreshCcw size={11} />
            Оновлено: {report?.deposit_projection_updated_at || report?.snapshot_updated_at || "з Google Таблиці"}
          </div>
        </div>
      </section>

      {access?.allow_cross_team_reports && teams.length > 1 && (
        <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
          {teams.map((team) => (
            <button
              key={team.id}
              onClick={() => setSelectedTeamId(team.id)}
              className={`h-10 shrink-0 rounded-full border px-4 text-xs font-black ${String(selectedTeam?.id) === String(team.id) ? "border-[#39FF14] bg-[#39FF14]/10 text-[#39FF14]" : "border-white/10 bg-[#1A1A1E] text-zinc-400"}`}
            >
              {team.name}
            </button>
          ))}
        </div>
      )}

      <section className="rounded-3xl border border-[#39FF14]/30 bg-gradient-to-br from-[#39FF14]/10 to-[#1A1A1E] p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[.18em] text-[#39FF14]">Проекційний результат команди</div>
            <div className="mt-2 font-display text-[46px] leading-none text-[#39FF14]">{rawSummary ? fmtPercent(teamProjective) : "—"}</div>
            <div className="mt-2 text-xs font-bold text-zinc-500">{rows.length} операторів у рейтингу</div>
          </div>
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[#FFB800]/35 bg-[#FFB800]/10 text-[#FFB800]">
            <Trophy size={23} strokeWidth={2.8} />
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
            <div className="text-[9px] font-black uppercase tracking-wider text-zinc-600">Лідер команди</div>
            <div className="mt-1 truncate text-sm font-black text-white">{leader?.name || leader?.login || "—"}</div>
            <div className="mt-1 text-lg font-black text-[#FFB800]">{leader ? fmtPercent(leader.projective_rate) : "—"}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
            <div className="text-[9px] font-black uppercase tracking-wider text-zinc-600">Мій результат</div>
            <div className="mt-1 truncate text-sm font-black text-white">{currentRow ? "У рейтингу" : "Немає даних"}</div>
            <div className="mt-1 text-lg font-black text-[#B78CFF]">{currentRow ? fmtPercent(currentRow.projective_rate) : "—"}</div>
          </div>
        </div>
      </section>

      <div className="grid gap-2.5 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => navigate("/goals/deposit/me?period=month")}
          className="flex min-h-[76px] w-full items-center gap-3 rounded-2xl border border-[#39FF14]/25 bg-[#39FF14]/[.06] p-4 text-left active:scale-[.99]"
        >
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#39FF14]/10 text-[#39FF14]">
            <Target size={21} strokeWidth={2.8} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-black text-white">Переглянути мої показники</div>
            <div className="mt-1 text-xs text-zinc-500">Конверсії, обробка та проекційний результат</div>
          </div>
          <ChevronRight size={18} className="shrink-0 text-zinc-600" />
        </button>

        <button
          type="button"
          onClick={() => navigate("/goals/deposit/issuances?period=month")}
          className="flex min-h-[76px] w-full items-center gap-3 rounded-2xl border border-[#FFB800]/25 bg-[#FFB800]/[.06] p-4 text-left active:scale-[.99]"
        >
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#FFB800]/10 text-[#FFB800]">
            <HandCoins size={21} strokeWidth={2.8} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-black text-white">Рейтинг по видачах</div>
            <div className="mt-1 text-xs text-zinc-500">Місяць, вчора та розподіл за напрямками</div>
          </div>
          <ChevronRight size={18} className="shrink-0 text-zinc-600" />
        </button>
      </div>

      {!rows.length ? (
        <section className="rounded-3xl border border-white/10 bg-[#1A1A1E] p-7 text-center">
          <Landmark size={38} className="mx-auto text-[#39FF14]" />
          <h2 className="mt-3 font-display text-xl text-white">ПРОЕКЦІЙНИЙ РЕЙТИНГ ЩЕ НЕ ЗНАЙДЕНО</h2>
          <p className="mt-2 text-sm leading-relaxed text-zinc-500">
            {error
              ? "Не вдалося завантажити опублікований звіт."
              : 'Перевірте таблицю "Deposit" на вкладці «Аркуш2» та натисніть «Оновити звіти».'}
          </p>
        </section>
      ) : (
        <section className="overflow-hidden rounded-3xl border border-white/10 bg-[#1A1A1E]">
          <div className="flex items-center justify-between p-4">
            <div>
              <h2 className="font-display text-xl text-white">Рейтинг операторів</h2>
              <p className="mt-1 text-xs text-zinc-500">Сортування за проекційним результатом</p>
            </div>
            <UsersRound size={21} className="text-[#39FF14]" />
          </div>

          <div>
            {rows.map((row, index) => {
              const current = row.login === currentLogin;
              return (
                <article
                  key={`${row.login}-${index}`}
                  className={`border-t border-white/[.07] px-4 py-3 ${current ? "bg-[#39FF14]/[.05]" : ""}`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-xs font-black ${index < 3 ? "border-[#FFB800]/30 bg-[#FFB800]/10 text-[#FFB800]" : "border-white/10 bg-black/25 text-zinc-400"}`}>
                      {index + 1}
                    </div>
                    <Avatar row={row} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <div className="truncate text-sm font-black text-white">{row.name || row.login}</div>
                        {current && <span className="rounded-full bg-[#39FF14]/10 px-2 py-0.5 text-[8px] font-black uppercase text-[#39FF14]">Ви</span>}
                      </div>
                      <div className="mt-1 truncate text-[10px] font-bold text-zinc-500">{row.login}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-display text-2xl text-[#39FF14]">{fmtPercent(row.projective_rate)}</div>
                      <div className="text-[8px] font-black uppercase tracking-wider text-zinc-600">проекційний</div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
