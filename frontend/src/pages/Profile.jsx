import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft, Award, CalendarDays, Check, ChevronRight, Coins, Crown,
  Dice5, Flame, Gamepad2, Gift, History, Loader2, Lock, Medal, Pin,
  Search, Share2, ShoppingBag, Sparkles, Star, Target, Trophy, TrendingUp, Users, X,
} from "lucide-react";
import { toast } from "sonner";
import { useApp } from "@/context/AppContext";
import { useDailyGoogleReports } from "@/hooks/useGoogleReports";
import { normalizeLogin, parseReportNumber } from "@/lib/activationReports";
import api, { extractError } from "@/lib/api";
import { getAchievements } from "@/lib/achievements";
import { resolveAvatarUrl } from "@/lib/avatar";
import AvatarFrame from "@/components/AvatarFrame";

const ICONS = {
  flame: Flame, trophy: Trophy, sparkles: Sparkles, crown: Crown, award: Award,
  medal: Medal, star: Star, target: Target, users: Users, gift: Gift,
  "shopping-bag": ShoppingBag, "dice-5": Dice5, "dice-6": Dice5,
  "gamepad-2": Gamepad2, search: Search, "help-circle": Lock,
};

const STATUS_FILTERS = [
  { id: "all", label: "Всі" },
  { id: "unlocked", label: "Відкриті" },
  { id: "locked", label: "В процесі" },
];

const RARITY = {
  bronze: { label: "Бронза", color: "#D97745" },
  silver: { label: "Срібло", color: "#A7B0C0" },
  gold: { label: "Золото", color: "#FFB800" },
  diamond: { label: "Діамант", color: "#00F0FF" },
};

const roleLabel = (user) => {
  if (user?.role === "admin") return "Адміністратор";
  if (user?.role === "editor") return "Редактор";
  if (user?.is_team_leader) return "Тімлід";
  return user?.position || "Учасник команди";
};

const percent = (value) => {
  const parsed = parseReportNumber(value);
  return parsed === null ? null : Math.max(0, parsed);
};

const reportSnapshotForUser = (report, user) => {
  if (!report?.found || !report?.snapshot_version || !user) return null;
  const login = normalizeLogin(user.goals_login || user.email?.split("@")[0]);
  if (!login) return null;
  if (String(user.report_profile || report.report_profile || "sales") === "activation") {
    const goals = report.activation_goals || {};
    const metrics = {
      pumb_online: percent(goals.pumb_online_actual ?? goals.pumb_online_current),
      cards: percent(goals.cards_actual ?? goals.cards_current),
    };
    const values = Object.values(metrics).filter((value) => value !== null);
    if (!values.length) return null;
    return {
      snapshot_version: String(report.snapshot_version),
      snapshot_updated_at: String(report.snapshot_updated_at || ""),
      overall: values.reduce((sum, value) => sum + value, 0) / values.length,
      metrics: Object.fromEntries(Object.entries(metrics).filter(([, value]) => value !== null)),
      rank: null,
      total_participants: null,
    };
  }
  const rows = (Array.isArray(report.credit_leaderboard) ? report.credit_leaderboard : [])
    .map((row) => ({
      login: normalizeLogin(row?.login || row?.goals_login || row?.operator || row?.credit),
      xsell: percent(row?.xsell ?? row?.x_sell ?? row?.["X-sell"]),
      web_apps: percent(row?.web_apps ?? row?.webapps ?? row?.["Web apps"]),
      inb: percent(row?.inb ?? row?.INB),
      overall: percent(row?.overall ?? row?.general ?? row?.summary ?? row?.["Загальний"]),
    }))
    .filter((row) => row.login && row.overall !== null)
    .sort((left, right) => right.overall - left.overall);
  const index = rows.findIndex((row) => row.login === login);
  if (index < 0) return null;
  const row = rows[index];
  return {
    snapshot_version: String(report.snapshot_version),
    snapshot_updated_at: String(report.credit_leaderboard_updated_at || report.snapshot_updated_at || ""),
    overall: row.overall,
    metrics: Object.fromEntries(Object.entries({ xsell: row.xsell, web_apps: row.web_apps, inb: row.inb }).filter(([, value]) => value !== null)),
    rank: index + 1,
    total_participants: rows.length,
  };
};

function AchievementCard({ achievement, pinned, onTogglePin, busy }) {
  const Icon = ICONS[achievement.icon] || Award;
  const target = Number(achievement.progress_target || 0);
  const value = Number(achievement.progress_value || 0);
  const progress = target > 0 ? Math.min(100, Math.round((value / target) * 100)) : (achievement.unlocked ? 100 : 0);
  const rarity = RARITY[achievement.rarity] || RARITY.silver;
  return (
    <article className={`relative overflow-hidden rounded-3xl border p-4 ${achievement.unlocked ? "bg-[#1A1A1E]" : "border-white/5 bg-[#141416]"}`} style={achievement.unlocked ? { borderColor: `${rarity.color}40` } : undefined} data-testid={`profile-achievement-${achievement.id}`}>
      {achievement.unlocked && <button type="button" onClick={() => onTogglePin(achievement.id)} disabled={busy} className={`absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-xl border active:scale-95 ${pinned ? "border-[#FFB800]/50 bg-[#FFB800]/15 text-[#FFB800]" : "border-white/10 bg-black/20 text-zinc-500"}`} aria-label={pinned ? "Відкріпити досягнення" : "Закріпити досягнення"}><Pin size={14} fill={pinned ? "currentColor" : "none"} /></button>}
      <div className={`achievement-badge-icon flex h-12 w-12 items-center justify-center rounded-2xl ${achievement.unlocked ? "is-unlocked" : "is-locked"}`} style={achievement.unlocked ? { backgroundColor: `${achievement.color || rarity.color}22`, borderColor: achievement.color || rarity.color } : undefined}>{achievement.unlocked ? <Icon size={22} strokeWidth={2.8} color={achievement.color || rarity.color} /> : <Lock size={18} className="achievement-lock-icon" />}</div>
      <div className="mt-3 flex items-center gap-2 text-[8px] font-black uppercase tracking-[0.14em]"><span className="text-zinc-600">{achievement.category || "Особливе"}</span><span style={{ color: rarity.color }}>• {rarity.label}</span></div>
      <h3 className="mt-1 min-h-10 text-sm font-black leading-tight text-white">{achievement.title}</h3>
      <p className="mt-2 min-h-12 text-[11px] font-bold leading-relaxed text-zinc-500">{achievement.description}</p>
      <div className="mt-3 flex items-center justify-between text-[9px] font-black uppercase tracking-wide"><span className={achievement.unlocked ? "text-[#39FF14]" : "text-zinc-600"}>{achievement.unlocked ? "Виконано" : "Прогрес"}</span><span className="text-[#FFB800]">+{achievement.xp_reward || 0} XP</span></div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-black/45"><div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, backgroundColor: achievement.unlocked ? (achievement.color || rarity.color) : "#52525B" }} /></div>
      <div className="mt-1.5 truncate text-right text-[9px] font-bold text-zinc-500">{achievement.progress || (achievement.unlocked ? "Отримано" : "—")}</div>
    </article>
  );
}

function CelebrationModal({ item, busy, onClose, onShare }) {
  if (!item) return null;
  const achievement = item.type === "achievement" ? item.value : null;
  const level = item.type === "level" ? item.value : null;
  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/80 p-4 backdrop-blur-sm sm:items-center" data-testid="progression-celebration-modal">
      <div className="relative w-full max-w-md overflow-hidden rounded-[32px] border border-[#FFB800]/45 bg-[#18181C] p-6 text-center shadow-[0_0_80px_rgba(255,184,0,.2)]">
        <button type="button" onClick={onClose} disabled={busy} className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 text-zinc-400" aria-label="Закрити"><X size={18} /></button>
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-[#FFB800]/50 bg-[#FFB800]/15 text-[#FFB800]">{level ? <Crown size={38} /> : <Trophy size={38} />}</div>
        <div className="mt-5 text-[10px] font-black uppercase tracking-[0.22em] text-[#FFB800]">{level ? "Новий рівень" : "Нове досягнення"}</div>
        <h2 className="mt-2 font-display text-3xl text-white">{level ? `Рівень ${level.level}` : achievement?.title}</h2>
        <p className="mt-2 text-sm font-bold leading-relaxed text-zinc-400">{level ? `Новий статус: ${level.level_title}` : achievement?.description}</p>
        {achievement && <div className="mt-4 font-display text-xl text-[#39FF14]">+{achievement.xp_reward || 0} XP</div>}
        <div className="mt-6 grid grid-cols-2 gap-2">{achievement && <button type="button" onClick={onShare} disabled={busy} className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[.04] text-xs font-black uppercase text-white"><Share2 size={16} /> У команду</button>}<button type="button" onClick={onClose} disabled={busy} className={`${achievement ? "" : "col-span-2"} flex h-12 items-center justify-center rounded-2xl bg-[#FFB800] text-xs font-black uppercase text-black`}>{busy ? <Loader2 size={17} className="animate-spin" /> : "Чудово"}</button></div>
      </div>
    </div>
  );
}

export default function Profile() {
  const { user, mode, refreshMe } = useApp();
  const nav = useNavigate();
  const { data: googleReports } = useDailyGoogleReports();
  const syncedReportRef = useRef("");
  const [avatarImageFailed, setAvatarImageFailed] = useState(false);
  const [progression, setProgression] = useState(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("Всі категорії");
  const [busy, setBusy] = useState("");
  const [celebration, setCelebration] = useState(null);

  const applyProgression = useCallback((data) => {
    setProgression(data);
    if (data?.latest_level_up) setCelebration({ type: "level", value: data.latest_level_up });
    else if (data?.newly_unlocked?.length) setCelebration({ type: "achievement", value: data.newly_unlocked[0] });
  }, []);

  const loadProgression = useCallback(async () => {
    if (!user || mode === "mock") { setLoading(false); return; }
    try { const { data } = await api.get("/progression/me"); applyProgression(data); }
    catch (error) { toast.error(extractError(error, "Не вдалося завантажити прогрес")); }
    finally { setLoading(false); }
  }, [applyProgression, mode, user]);

  useEffect(() => { loadProgression(); }, [loadProgression]);
  useEffect(() => {
    if (!user || mode !== "live") return;
    const snapshot = reportSnapshotForUser(googleReports, user);
    if (!snapshot) return;
    const syncKey = `${snapshot.snapshot_version}:${snapshot.overall}:${snapshot.rank || 0}`;
    if (syncedReportRef.current === syncKey) return;
    syncedReportRef.current = syncKey;
    api.post("/progression/report-sync", snapshot).then(({ data }) => { applyProgression(data); refreshMe().catch(() => {}); }).catch(() => { syncedReportRef.current = ""; });
  }, [applyProgression, googleReports, mode, refreshMe, user]);

  const achievements = useMemo(() => progression?.achievements || getAchievements(user), [progression, user]);
  const pinnedIds = progression?.pinned_achievement_ids || [];
  const categories = useMemo(() => ["Всі категорії", ...new Set(achievements.map((item) => item.category).filter(Boolean))], [achievements]);
  const filteredAchievements = achievements.filter((item) => (statusFilter === "all" || (statusFilter === "unlocked" ? item.unlocked : !item.unlocked)) && (categoryFilter === "Всі категорії" || item.category === categoryFilter));
  const unlocked = achievements.filter((item) => item.unlocked);
  const recentAchievements = [...unlocked].sort((left, right) => Number(pinnedIds.includes(right.id)) - Number(pinnedIds.includes(left.id)) || String(right.granted_at || "").localeCompare(String(left.granted_at || ""))).slice(0, 3);

  if (!user) return null;
  const profileUser = progression?.user || user;
  const levelData = progression?.level || { current: user.level || 1, title: user.level_title || "Новачок", xp: user.xp || 0, xp_to_next: user.xp_to_next || 125, max_level: 50 };
  const level = Number(levelData.current || 1);
  const xp = Number(levelData.xp || 0);
  const xpNext = Number(levelData.xp_to_next || 0);
  const xpPct = level >= 50 ? 100 : Math.min(100, Math.round((xp / Math.max(1, xpNext)) * 100));
  const xpRemaining = Math.max(0, xpNext - xp);
  const monthlyRank = progression?.monthly_rank || { tier: "D", title: "Старт", overall: 0 };
  const avatarSrc = resolveAvatarUrl(profileUser.avatar_url);
  const profileFrameRarity = profileUser.active_profile_frame?.includes("50") ? "diamond" : profileUser.active_profile_frame?.includes("45") ? "legendary" : profileUser.active_profile_frame?.includes("35") ? "epic" : profileUser.active_profile_frame?.includes("20") ? "rare" : null;

  const togglePin = async (achievementId) => {
    const next = pinnedIds.includes(achievementId) ? pinnedIds.filter((id) => id !== achievementId) : [...pinnedIds, achievementId];
    if (next.length > 3) return toast.error("У профілі можна закріпити максимум 3 досягнення");
    setBusy(`pin:${achievementId}`);
    try { await api.put("/progression/achievements/pins", { achievement_ids: next }); setProgression((current) => ({ ...current, pinned_achievement_ids: next })); toast.success(next.includes(achievementId) ? "Досягнення закріплено" : "Досягнення відкріплено"); }
    catch (error) { toast.error(extractError(error)); }
    finally { setBusy(""); }
  };
  const claimReward = async (reward) => {
    setBusy(`reward:${reward.level}`);
    try { const { data } = await api.post(`/progression/level-rewards/${reward.level}/claim`); setProgression(data); await refreshMe(); toast.success(`Отримано: ${reward.title}`); }
    catch (error) { toast.error(extractError(error)); }
    finally { setBusy(""); }
  };
  const closeCelebration = async () => {
    if (!celebration) return;
    setBusy("celebration");
    try { if (celebration.type === "level") await api.post(`/progression/level-up/${celebration.value.level}/seen`); else await api.post(`/progression/achievements/${celebration.value.id}/seen`); setCelebration(null); await loadProgression(); }
    finally { setBusy(""); }
  };
  const shareCelebration = async () => {
    if (celebration?.type !== "achievement") return;
    setBusy("celebration");
    try { await api.post(`/progression/achievements/${celebration.value.id}/share`); toast.success("Досягнення опубліковано для команди"); await closeCelebration(); }
    catch (error) { toast.error(extractError(error)); setBusy(""); }
  };

  return (
    <div className="space-y-5 px-5 pb-8 pt-2" data-testid="personal-profile-page">
      <CelebrationModal item={celebration} busy={busy === "celebration"} onClose={closeCelebration} onShare={shareCelebration} />
      <section className="flex items-center gap-3"><button type="button" onClick={() => nav("/")} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-[#1A1A1E] text-zinc-300 active:scale-95" aria-label="Назад на головну"><ArrowLeft size={21} strokeWidth={2.8} /></button><div><div className="text-[9px] font-black uppercase tracking-[0.2em] text-[#FFB800]">Мій простір</div><h1 className="font-display text-2xl leading-tight text-white">Особистий кабінет</h1></div></section>

      <section className="diamond-card-auto relative overflow-hidden rounded-3xl border bg-[#1A1A1E] p-5" style={{ borderColor: profileUser.active_profile_frame ? "#FFB80099" : "rgba(255,255,255,.1)" }}>
        <div className="absolute -right-12 -top-14 h-40 w-40 rounded-full bg-[#FFB800]/10 blur-3xl" />
        <div className="relative flex items-center gap-4"><AvatarFrame src={avatarSrc && !avatarImageFailed ? avatarSrc : null} alt="Аватар профілю" initials={profileUser.avatar_initials} color={profileUser.avatar_color} rarity={profileFrameRarity || profileUser.avatar_rarity} size="lg" className={profileUser.active_profile_frame?.includes("35") ? "animate-pulse" : ""} onLoad={() => setAvatarImageFailed(false)} onError={() => setAvatarImageFailed(true)} /><div className="min-w-0 flex-1"><div className="truncate font-display text-xl leading-tight" style={{ color: profileUser.active_name_color || "white" }}>{profileUser.name}</div><div className="mt-1 truncate text-xs font-black text-zinc-400">{profileUser.active_profile_title || roleLabel(profileUser)}</div><div className="mt-0.5 truncate text-xs text-zinc-600">{profileUser.team_name || profileUser.department || "Без команди"}</div></div><div className="rounded-2xl border border-[#FFB800]/35 bg-[#FFB800]/10 px-3 py-2 text-center"><div className="text-[8px] font-black uppercase tracking-wider text-[#FFB800]">Рівень</div><div className="font-display text-2xl text-white">{level}</div></div></div>
        <div className="relative mt-5 rounded-2xl border border-white/8 bg-black/25 p-3.5"><div className="mb-2 flex items-center justify-between gap-3"><div><div className="text-[9px] font-black uppercase tracking-widest text-[#FFB800]">{levelData.title}</div><div className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Постійний прогрес</div></div><div className="text-xs font-black text-white">{level >= 50 ? "MAX" : `${xp.toLocaleString("uk-UA")} / ${xpNext.toLocaleString("uk-UA")} XP`}</div></div><div className="h-3 overflow-hidden rounded-full border border-white/5 bg-[#0A0A0A]"><div className="xp-stripes h-full rounded-full" style={{ width: `${xpPct}%`, background: "linear-gradient(90deg,#FF5C00,#FFB800)" }} /></div><div className="mt-2 text-[10px] font-bold text-zinc-500">{level >= 50 ? "Досягнуто максимальний рівень VPDK Champion" : `Ще ${xpRemaining.toLocaleString("uk-UA")} XP до рівня ${level + 1}`}</div></div>
        {!!recentAchievements.length && <div className="relative mt-4 flex items-center gap-2"><span className="mr-1 text-[9px] font-black uppercase text-zinc-600">Вітрина</span>{recentAchievements.map((item) => { const Icon = ICONS[item.icon] || Award; return <div key={item.id} title={item.title} className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-black/20" style={{ color: item.color || "#FFB800" }}><Icon size={16} /></div>; })}</div>}
        <button type="button" onClick={() => nav("/store")} className="relative mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[.04] text-xs font-black uppercase tracking-wider text-zinc-300 active:scale-[.98]">Змінити аватар <ChevronRight size={16} /></button>
      </section>

      <section className="rounded-3xl border border-[#B78CFF]/35 bg-[linear-gradient(135deg,rgba(183,140,255,.12),rgba(26,26,30,1))] p-4" data-testid="monthly-rank-card"><div className="flex items-center justify-between gap-3"><div><div className="text-[9px] font-black uppercase tracking-[0.18em] text-[#B78CFF]">Місячний ранг · {monthlyRank.month || "поточний місяць"}</div><h2 className="mt-1 font-display text-xl text-white">{monthlyRank.title || "Старт"}</h2></div><div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-[#B78CFF]/40 bg-[#B78CFF]/15 font-display text-3xl text-[#B78CFF]">{monthlyRank.tier || "D"}</div></div><div className="mt-4 grid grid-cols-2 gap-2"><div className="rounded-2xl bg-black/25 p-3"><div className="text-[9px] font-black uppercase text-zinc-600">Результат</div><div className="mt-1 font-display text-xl text-white">{Number(monthlyRank.overall || 0).toLocaleString("uk-UA", { maximumFractionDigits: 1 })}%</div></div><div className="rounded-2xl bg-black/25 p-3"><div className="text-[9px] font-black uppercase text-zinc-600">Місце</div><div className="mt-1 font-display text-xl text-white">{monthlyRank.rank ? `${monthlyRank.rank} / ${monthlyRank.total_participants || "—"}` : "—"}</div></div></div><p className="mt-3 text-[10px] font-bold leading-relaxed text-zinc-500">Ранг оновлюється з Google-звіту та починається заново щомісяця. Рівень профілю при цьому не скидається.</p></section>

      <section className="grid grid-cols-2 gap-3"><div className="rounded-3xl border border-[#FFB800]/25 bg-[#1A1A1E] p-4"><Coins size={18} className="text-[#FFB800]" /><div className="mt-2 font-display text-2xl text-white">{Number(profileUser.balance || 0).toLocaleString("uk-UA")}</div><div className="text-[10px] font-black uppercase tracking-wider text-zinc-500">Баланс Point</div></div><div className="rounded-3xl border border-[#00F0FF]/20 bg-[#1A1A1E] p-4"><TrendingUp size={18} className="text-[#00F0FF]" /><div className="mt-2 font-display text-2xl text-white">{Number(levelData.total_xp || profileUser.total_xp || 0).toLocaleString("uk-UA")}</div><div className="text-[10px] font-black uppercase tracking-wider text-zinc-500">Всього XP</div></div><div className="rounded-3xl border border-[#FF5C00]/20 bg-[#1A1A1E] p-4"><Flame size={18} className="text-[#FF5C00]" /><div className="mt-2 font-display text-2xl text-white">{Number(profileUser.streak || 0)}</div><div className="text-[10px] font-black uppercase tracking-wider text-zinc-500">Днів поспіль</div></div><div className="rounded-3xl border border-[#B78CFF]/25 bg-[#1A1A1E] p-4"><Award size={18} className="text-[#B78CFF]" /><div className="mt-2 font-display text-2xl text-white">{unlocked.length} / {achievements.length}</div><div className="text-[10px] font-black uppercase tracking-wider text-zinc-500">Досягнень</div></div></section>

      <section data-testid="profile-level-rewards"><div className="flex items-end justify-between gap-3 px-1"><div><div className="text-[9px] font-black uppercase tracking-[0.18em] text-[#39FF14]">Кожні 5 рівнів</div><h2 className="mt-1 font-display text-2xl text-white">Нагороди рівнів</h2></div><Gift size={22} className="text-[#39FF14]" /></div><div className="mt-3 flex gap-3 overflow-x-auto pb-2">{(progression?.level_rewards || []).map((reward) => <article key={reward.level} className={`w-56 shrink-0 rounded-3xl border p-4 ${reward.unlocked ? "border-[#39FF14]/30 bg-[#172018]" : "border-white/8 bg-[#18181C]"}`}><div className="flex items-center justify-between"><span className="rounded-full bg-black/25 px-2.5 py-1 text-[9px] font-black uppercase text-zinc-400">LVL {reward.level}</span>{reward.claimed ? <Check size={17} className="text-[#39FF14]" /> : reward.unlocked ? <Gift size={17} className="text-[#FFB800]" /> : <Lock size={16} className="text-zinc-600" />}</div><h3 className="mt-3 min-h-10 text-sm font-black leading-tight text-white">{reward.title}</h3><p className="mt-1 min-h-10 text-[10px] font-bold leading-relaxed text-zinc-500">{reward.description}</p><button type="button" disabled={!reward.unlocked || reward.claimed || !!busy} onClick={() => claimReward(reward)} className="mt-3 flex h-10 w-full items-center justify-center rounded-2xl bg-[#FFB800] text-[10px] font-black uppercase text-black disabled:bg-white/5 disabled:text-zinc-600">{busy === `reward:${reward.level}` ? <Loader2 size={16} className="animate-spin" /> : reward.claimed ? "Отримано" : reward.unlocked ? "Забрати" : `Відкриється на ${reward.level}`}</button></article>)}</div></section>

      {!!progression?.xp_history?.length && <section className="rounded-3xl border border-white/10 bg-[#1A1A1E] p-4" data-testid="profile-xp-history"><div className="flex items-center gap-2"><History size={17} className="text-[#00F0FF]" /><h2 className="font-display text-lg text-white">Останній XP</h2></div><div className="mt-3 space-y-2">{progression.xp_history.slice(0, 4).map((event) => <div key={event.id} className="flex items-center justify-between gap-3 rounded-2xl bg-black/20 px-3 py-2.5"><div className="min-w-0"><div className="truncate text-[11px] font-black text-zinc-300">{event.description}</div><div className="mt-0.5 flex items-center gap-1 text-[9px] text-zinc-600"><CalendarDays size={10} />{new Date(event.created_at).toLocaleDateString("uk-UA")}</div></div><div className="shrink-0 font-display text-base text-[#39FF14]">+{event.amount}</div></div>)}</div></section>}

      <section data-testid="profile-achievements-section"><div className="flex items-end justify-between gap-3 px-1"><div><div className="text-[9px] font-black uppercase tracking-[0.18em] text-[#B78CFF]">Колекція нагород</div><h2 className="mt-1 font-display text-2xl text-white">Досягнення</h2></div><div className="rounded-full border border-white/10 bg-[#1A1A1E] px-3 py-1.5 text-[10px] font-black text-zinc-400">{unlocked.length} відкрито</div></div><div className="mt-4 flex gap-2 overflow-x-auto pb-1" data-testid="achievement-filters">{STATUS_FILTERS.map((item) => <button key={item.id} type="button" onClick={() => setStatusFilter(item.id)} className={`h-10 shrink-0 rounded-2xl border px-4 text-[10px] font-black uppercase tracking-wider active:scale-95 ${statusFilter === item.id ? "border-[#FFB800] bg-[#FFB800] text-[#0A0A0A]" : "border-white/10 bg-[#1A1A1E] text-zinc-400"}`}>{item.label}</button>)}</div><div className="mt-2 flex gap-2 overflow-x-auto pb-1" data-testid="achievement-category-filters">{categories.map((category) => <button key={category} type="button" onClick={() => setCategoryFilter(category)} className={`h-8 shrink-0 rounded-xl border px-3 text-[9px] font-black ${categoryFilter === category ? "border-[#B78CFF]/60 bg-[#B78CFF]/15 text-[#D9C3FF]" : "border-white/8 text-zinc-600"}`}>{category}</button>)}</div>{loading ? <div className="mt-3 flex h-40 items-center justify-center rounded-3xl border border-white/10 bg-[#1A1A1E]"><Loader2 className="animate-spin text-[#FFB800]" /></div> : filteredAchievements.length ? <div className="mt-3 grid grid-cols-2 gap-3">{filteredAchievements.map((achievement) => <AchievementCard key={achievement.id} achievement={achievement} pinned={pinnedIds.includes(achievement.id)} onTogglePin={togglePin} busy={busy === `pin:${achievement.id}`} />)}</div> : <div className="mt-3 rounded-3xl border border-dashed border-white/10 bg-[#1A1A1E] p-6 text-center text-sm font-bold text-zinc-500">У цьому фільтрі поки немає досягнень.</div>}</section>
    </div>
  );
}
