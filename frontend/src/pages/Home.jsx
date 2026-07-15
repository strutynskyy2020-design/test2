import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Flame, Trophy, GraduationCap, Sparkles, Crown, Zap, ChevronRight, Coins, TrendingUp, Swords, Gift, Lock, Dice5, ScrollText, Camera, Loader2, Target, Newspaper } from "lucide-react";
import { useApp } from "@/context/AppContext";
import api, { API_BASE } from "@/lib/api";
import { getAchievements } from "@/lib/achievements";
import { FeedItem } from "@/pages/Feed";

const ICONS = { flame: Flame, trophy: Trophy, "graduation-cap": GraduationCap, sparkles: Sparkles, crown: Crown };

const Badge = ({ ach }) => {
  const Icon = ICONS[ach.icon] || Sparkles;
  return <div className={`relative flex aspect-square flex-col items-center justify-center rounded-2xl border-2 p-3 ${ach.unlocked ? "border-white/10 bg-[#1A1A1E]" : "border-white/5 bg-[#141416] opacity-60"}`}>
    <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-2xl" style={{ backgroundColor: ach.unlocked ? ach.color + "22" : "#27272A", border: `2px solid ${ach.unlocked ? ach.color : "#2D2D2D"}` }}>
      {ach.unlocked ? <Icon size={22} strokeWidth={2.75} color={ach.color} /> : <Lock size={18} color="#52525b" />}
    </div>
    <div className="line-clamp-2 text-center text-[10px] font-black uppercase leading-tight tracking-tight text-white/90">{ach.title}</div>
  </div>;
};

const defaultGoals = {
  credit: { current: 0, target: 0, complete: false }, debit: { current: 0, target: 0, complete: false }, deposit: { current: 0, target: 0, complete: false },
  monthly_bonus_current: 0, monthly_bonus_target: 0,
};

export default function Home() {
  const { user, mode, updateAvatar } = useApp();
  const nav = useNavigate();
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState("");
  const [goals, setGoals] = useState(defaultGoals);
  const [feed, setFeed] = useState([]);
  const avatarInputRef = useRef(null);

  useEffect(() => {
    if (!user) return;
    if (mode === "mock") {
      setGoals({ credit: { current: 92, target: 100, complete: false }, debit: { current: 111, target: 110, complete: true }, deposit: { current: 86, target: 95, complete: false }, monthly_bonus_current: 14250, monthly_bonus_target: 18000 });
      return;
    }
    api.get("/goals/me").then(r => setGoals(r.data)).catch(() => {});
    api.get("/feed", { params: { limit: 5 } }).then(r => setFeed(r.data.events || [])).catch(() => {});
  }, [user?.id, mode]);

  if (!user) return null;
  const level = user.level ?? 1;
  const xp = user.xp ?? 0;
  const xpNext = user.xp_to_next ?? 1000;
  const xpPct = Math.min(100, Math.round((xp / xpNext) * 100));
  const achievements = getAchievements(user);
  const backendOrigin = API_BASE.replace(/\/api$/, "");
  const avatarSrc = user.avatar_url ? (user.avatar_url.startsWith("http") || user.avatar_url.startsWith("data:") ? user.avatar_url : `${backendOrigin}${user.avatar_url}`) : null;
  const weeklyDone = [goals.credit, goals.debit, goals.deposit].filter(g => g?.complete).length;
  const bonusCurrent = Number(goals.monthly_bonus_current || 0);
  const bonusTarget = Number(goals.monthly_bonus_target || 0);
  const bonusPct = bonusTarget > 0 ? Math.min(100, Math.round(bonusCurrent / bonusTarget * 100)) : 0;

  const onAvatarSelected = async (event) => {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
    setAvatarBusy(true); setAvatarError("");
    const result = await updateAvatar(file);
    if (!result.ok) setAvatarError(result.error || "Не вдалося змінити фото");
    setAvatarBusy(false);
  };

  return <div className="space-y-6 px-5 pb-8 pt-2">
    {mode === "mock" && <div className="rounded-2xl border border-[#FF5C00]/40 bg-[#FF5C00]/10 px-3 py-2 text-[11px] font-black text-[#FF5C00]">ОФЛАЙН РЕЖИМ • використовуються демо-дані</div>}

    {/* 1. Avatar / profile */}
    <section className="rounded-3xl border border-white/10 bg-[#1A1A1E] p-5">
      <div className="flex items-center gap-4">
        <div className="relative shrink-0">
          <button type="button" onClick={() => avatarInputRef.current?.click()} className={`relative block h-16 w-16 cursor-pointer overflow-hidden rounded-2xl border border-white/10 font-display text-xl text-[#0A0A0A] active:scale-95 ${avatarBusy ? "pointer-events-none opacity-60" : ""}`} style={{ backgroundColor: user.avatar_color }}>
            {avatarSrc ? <img src={avatarSrc} alt={user.name} className="h-full w-full object-cover" /> : <span className="absolute inset-0 flex items-center justify-center">{user.avatar_initials}</span>}
            <span className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-[#1A1A1E] bg-[#00F0FF] text-[#0A0A0A] shadow-lg">{avatarBusy ? <Loader2 size={12} className="animate-spin" /> : <Camera size={12} strokeWidth={3} />}</span>
          </button>
          <input ref={avatarInputRef} type="file" accept="image/*,.heic,.heif" className="sr-only" onChange={onAvatarSelected} disabled={avatarBusy} />
          <div className="absolute -bottom-1 -right-1 rounded-full border-2 border-[#0A0A0A] bg-[#FFB800] px-2 py-0.5 text-[11px] font-black text-[#0A0A0A]">LVL {level}</div>
        </div>
        <div className="min-w-0 flex-1"><div className="truncate font-display text-lg text-white">{user.name}</div><div className="truncate text-xs text-zinc-500">{user.position}</div><div className="truncate text-xs text-zinc-600">{user.team_name || user.department || "—"}</div></div>
      </div>
      {avatarError && <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] font-bold text-red-300">{avatarError}</div>}
      <div className="mt-5"><div className="mb-2 flex justify-between"><div className="text-[11px] font-black uppercase tracking-widest text-zinc-500">Рівень {level}</div><div className="text-[11px] font-black text-white">{xp} / {xpNext} XP</div></div><div className="h-4 overflow-hidden rounded-full border border-white/5 bg-[#0A0A0A]"><div className="xp-stripes h-full rounded-full" style={{ width: `${xpPct}%`, background: "linear-gradient(90deg,#FF5C00,#FFB800)" }} /></div></div>
    </section>

    {/* 2. Balance */}
    <section className="grid grid-cols-2 gap-3">
      <button onClick={() => nav("/history")} className="rounded-3xl border-2 border-[#FFB800]/30 bg-[#1A1A1E] p-4 text-left active:scale-[.98]"><div className="flex items-center justify-between text-[11px] font-black uppercase tracking-widest text-zinc-500"><span className="flex items-center gap-2"><Coins size={14}/>Баланс</span><ScrollText size={12}/></div><div className="mt-1 font-display text-3xl text-[#FFB800]">{user.balance.toLocaleString("uk-UA")}</div><div className="mt-1 text-xs text-zinc-500">Point</div></button>
      <div className="rounded-3xl border border-white/10 bg-[#1A1A1E] p-4"><div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-zinc-500"><TrendingUp size={14}/>Всього</div><div className="mt-1 font-display text-3xl text-white">{user.total_earned.toLocaleString("uk-UA")}</div><div className="mt-1 text-xs text-zinc-500">зароблено</div></div>
    </section>

    {/* 3. Goals banner */}
    <button onClick={() => nav("/goals")} className="w-full rounded-3xl border border-[#B78CFF]/45 bg-gradient-to-br from-[#B78CFF]/18 to-[#1A1A1E] p-5 text-left active:scale-[.99]">
      <div className="flex items-center gap-3"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#B78CFF]/20"><Target size={24} strokeWidth={3} color="#B78CFF" /></div><div className="flex-1"><div className="font-display text-xl text-white">МОЇ ЦІЛІ</div><div className="text-xs text-zinc-400">Тиждень: {weeklyDone}/3 • Бонус: {bonusPct}%</div></div><ChevronRight color="#B78CFF" /></div>
      <div className="mt-4 grid grid-cols-4 gap-2">{[["Кредити",goals.credit],["Дебет",goals.debit],["Депозити",goals.deposit]].map(([label,g]) => <div key={label}><div className="truncate text-[9px] font-black uppercase text-zinc-500">{label}</div><div className={`mt-1 text-sm font-black ${g?.complete ? "text-[#39FF14]" : "text-white"}`}>{Number(g?.current||0)}%</div></div>)}<div><div className="text-[9px] font-black uppercase text-zinc-500">Бонус</div><div className="mt-1 text-sm font-black text-[#FFB800]">{bonusPct}%</div></div></div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/40"><div className="h-full rounded-full bg-[#B78CFF]" style={{ width: `${weeklyDone / 3 * 100}%` }} /></div>
    </button>

    {/* 4. Quests / store */}
    <section className="grid grid-cols-2 gap-3"><button onClick={() => nav("/tasks")} className="arcade-btn bg-[#39FF14] border-[#1a7a0a] p-4 text-left text-[#0A0A0A]"><Swords size={22}/><div className="mt-2 font-display text-lg">КВЕСТИ</div><div className="mt-1 text-xs font-black opacity-80">3 нові щодня</div></button><button onClick={() => nav("/store")} className="arcade-btn bg-[#00F0FF] border-[#005f66] p-4 text-left text-[#0A0A0A]"><Gift size={22}/><div className="mt-2 font-display text-lg">МАГАЗИН</div><div className="mt-1 text-xs font-black opacity-80">Витрачай Point</div></button></section>

    {/* 5. Cube */}
    <button onClick={() => nav("/fun")} className="arcade-btn flex w-full items-center gap-4 border-[#7a1c00] bg-gradient-to-r from-[#FFB800] to-[#FF5C00] p-4 text-left text-[#0A0A0A]"><div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-black/25"><Dice5 size={28}/></div><div className="min-w-0 flex-1"><div className="text-[10px] font-black uppercase tracking-widest opacity-70">Щоденний бонус</div><div className="mt-1 font-display text-xl">ЩЕДРИЙ КУБ</div><div className="mt-1 text-xs font-black opacity-90">До 350 балів</div></div><ChevronRight /></button>

    {/* 6. Streak */}
    <section className="flex items-center gap-3 rounded-3xl border border-[#FF5C00]/30 bg-gradient-to-r from-[#FF5C00]/15 to-transparent p-4"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#FF5C00]"><Flame size={24} color="#0A0A0A" /></div><div className="flex-1"><div className="font-black text-white">{user.streak} днів поспіль</div><div className="text-xs text-zinc-400">Не втрачай серію</div></div></section>

    {/* 7. Feed */}
    <section><div className="mb-3 flex items-center justify-between px-1"><div className="flex items-center gap-2 font-display text-lg text-white"><Newspaper size={19} color="#39FF14"/>Стрічка активності</div></div>{feed.length ? <ul className="space-y-3">{feed.slice(0,4).map(ev => <FeedItem key={ev.id} ev={ev}/>)}</ul> : <div className="rounded-3xl border border-white/10 bg-[#1A1A1E] p-5 text-center text-xs text-zinc-500">Поки що немає нової активності</div>}</section>

    {/* 8. Achievements */}
    <section><div className="mb-3 flex items-center justify-between px-1"><div className="font-display text-lg text-white">Досягнення</div><div className="text-xs font-black text-zinc-500">{achievements.filter(a=>a.unlocked).length} / {achievements.length}</div></div><div className="grid grid-cols-3 gap-3">{achievements.map(a=><Badge key={a.id} ach={a}/>)}</div></section>

    <section className="flex items-center gap-4 rounded-3xl border border-white/10 bg-[#1A1A1E] p-5"><div className="flex h-12 w-12 items-center justify-center rounded-2xl border-2 border-[#FFB800]/50 bg-[#FFB800]/15"><Zap size={22} color="#FFB800" /></div><div className="flex-1"><div className="text-sm font-black text-white">До нового рівня</div><div className="text-xs text-zinc-500">{xpNext-xp} XP</div></div><ChevronRight color="#FFB800" /></section>
  </div>;
}
