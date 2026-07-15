import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Flame, Trophy, GraduationCap, Sparkles, Crown, Zap, ChevronRight, Coins, TrendingUp, Swords, Gift, Lock, Dice5, ScrollText, Camera, Loader2 } from "lucide-react";
import { useApp } from "@/context/AppContext";
import { API_BASE } from "@/lib/api";
import { getAchievements } from "@/lib/achievements";

const ICONS = {
  flame: Flame,
  trophy: Trophy,
  "graduation-cap": GraduationCap,
  sparkles: Sparkles,
  crown: Crown,
};

const Badge = ({ ach }) => {
  const Icon = ICONS[ach.icon] || Sparkles;
  return (
    <div
      data-testid={`achievement-${ach.id}`}
      className={`relative flex flex-col items-center justify-center rounded-2xl p-3 aspect-square border-2 transition-transform active:scale-95 ${
        ach.unlocked ? "bg-[#1A1A1E] border-white/10" : "bg-[#141416] border-white/5 opacity-60"
      }`}
    >
      <div
        className="w-12 h-12 rounded-2xl flex items-center justify-center mb-2"
        style={{
          backgroundColor: ach.unlocked ? ach.color + "22" : "#27272A",
          border: `2px solid ${ach.unlocked ? ach.color : "#2D2D2D"}`,
        }}
      >
        {ach.unlocked ? (
          <Icon size={22} strokeWidth={2.75} color={ach.color} />
        ) : (
          <Lock size={18} strokeWidth={2.5} color="#52525b" />
        )}
      </div>
      <div className="text-[10px] font-black uppercase tracking-tight text-center leading-tight text-white/90 line-clamp-2">
        {ach.title}
      </div>
    </div>
  );
};

export default function Home() {
  const { user, mode, updateAvatar } = useApp();
  const nav = useNavigate();
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState("");
  const avatarInputRef = useRef(null);

  if (!user) return null;

  const level = user.level ?? 1;
  const xp = user.xp ?? 0;
  const xpNext = user.xp_to_next ?? 1000;
  const xpPct = Math.min(100, Math.round((xp / xpNext) * 100));
  const achievements = getAchievements(user);
  const backendOrigin = API_BASE.replace(/\/api$/, "");
  const avatarSrc = user.avatar_url
    ? (user.avatar_url.startsWith("http") || user.avatar_url.startsWith("data:")
      ? user.avatar_url
      : `${backendOrigin}${user.avatar_url}`)
    : null;

  const onAvatarSelected = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setAvatarBusy(true);
    setAvatarError("");
    const result = await updateAvatar(file);
    if (!result.ok) setAvatarError(result.error || "Не вдалося змінити фото");
    setAvatarBusy(false);
  };

  return (
    <div className="px-5 pt-2 pb-8 space-y-6">
      {/* Mode indicator */}
      {mode === "mock" && (
        <div className="bg-[#FF5C00]/10 border border-[#FF5C00]/40 rounded-2xl px-3 py-2 text-[11px] font-black text-[#FF5C00]">
          ОФЛАЙН РЕЖИМ • Бекенд недоступний, використовуються демо-дані
        </div>
      )}

      {/* Profile card */}
      <section data-testid="profile-card" className="bg-[#1A1A1E] border border-white/10 rounded-3xl p-5">
        <div className="flex items-center gap-4">
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => avatarInputRef.current?.click()}
              className={`relative block w-16 h-16 rounded-2xl overflow-hidden font-display text-xl text-[#0A0A0A] border border-white/10 active:scale-95 transition-transform cursor-pointer ${avatarBusy ? "opacity-60 pointer-events-none" : ""}`}
              style={{ backgroundColor: user.avatar_color }}
              aria-label="Обрати фото профілю з галереї"
              data-testid="profile-avatar-button"
            >
              <span className="absolute inset-0 flex items-center justify-center">
                {avatarSrc ? (
                  <img src={avatarSrc} alt={user.name} className="w-full h-full object-cover" />
                ) : (
                  user.avatar_initials
                )}
              </span>
              <span className="absolute inset-x-0 bottom-0 z-10 h-6 bg-black/75 flex items-center justify-center text-white pointer-events-none">
                {avatarBusy ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} strokeWidth={2.8} />}
              </span>
            </button>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*,.heic,.heif"
              className="sr-only"
              onChange={onAvatarSelected}
              disabled={avatarBusy}
              data-testid="profile-avatar-file-input"
            />
            <div className="absolute -bottom-1 -right-1 z-30 bg-[#FFB800] text-[#0A0A0A] text-[11px] font-black rounded-full px-2 py-0.5 border-2 border-[#0A0A0A] pointer-events-none">
              LVL {level}
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-white font-display text-lg truncate">{user.name}</div>
            <div className="text-zinc-500 text-xs truncate">{user.position}</div>
            <div className="text-zinc-600 text-xs truncate">
              {user.team_name ? (
                <span className="text-[#00F0FF] font-black">👥 {user.team_name}</span>
              ) : (
                user.department || "—"
              )}
              {user.is_team_leader && <span className="text-[#FFB800] ml-1.5">• 👑 Керівник</span>}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => avatarInputRef.current?.click()}
          disabled={avatarBusy}
          className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 text-[10px] font-black uppercase tracking-wider text-zinc-400 active:scale-[0.98] disabled:opacity-50"
          data-testid="change-avatar-button"
        >
          <Camera size={14} /> {avatarBusy ? "Завантаження..." : "Змінити фото"}
        </button>
        {avatarError && (
          <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] font-bold text-red-300">
            {avatarError}
          </div>
        )}

        <div className="mt-5">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[11px] font-black uppercase tracking-widest text-zinc-500">Рівень {level}</div>
            <div className="text-[11px] font-black text-white" data-testid="xp-text">
              {xp} / {xpNext} XP
            </div>
          </div>
          <div className="h-4 rounded-full bg-[#0A0A0A] border border-white/5 overflow-hidden">
            <div
              className="h-full rounded-full xp-stripes"
              style={{
                width: `${xpPct}%`,
                background: "linear-gradient(90deg, #FF5C00, #FFB800)",
                boxShadow: "0 0 16px rgba(255,184,0,0.5)",
              }}
              data-testid="xp-bar"
            />
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3">
        <div
          data-testid="balance-card"
          onClick={() => nav("/history")}
          role="button"
          className="bg-[#1A1A1E] border-2 border-[#FFB800]/30 rounded-3xl p-4 active:scale-[0.98] transition-transform cursor-pointer"
        >
          <div className="flex items-center justify-between text-zinc-500 text-[11px] font-black uppercase tracking-widest">
            <span className="flex items-center gap-2"><Coins size={14} strokeWidth={3} />Баланс</span>
            <ScrollText size={12} strokeWidth={3} />
          </div>
          <div className="font-display text-3xl text-[#FFB800] mt-1 drop-shadow-[0_0_8px_rgba(255,184,0,0.4)]">
            {user.balance.toLocaleString("uk-UA")}
          </div>
          <div className="text-zinc-500 text-xs mt-1">натисни → історія</div>
        </div>
        <div className="bg-[#1A1A1E] border border-white/10 rounded-3xl p-4">
          <div className="flex items-center gap-2 text-zinc-500 text-[11px] font-black uppercase tracking-widest">
            <TrendingUp size={14} strokeWidth={3} />
            Всього
          </div>
          <div className="font-display text-3xl text-white mt-1">
            {user.total_earned.toLocaleString("uk-UA")}
          </div>
          <div className="text-zinc-500 text-xs mt-1">зароблено</div>
        </div>
      </section>

      <section className="bg-gradient-to-r from-[#FF5C00]/15 to-transparent border border-[#FF5C00]/30 rounded-3xl p-4 flex items-center gap-3">
        <div className="w-12 h-12 rounded-2xl bg-[#FF5C00] flex items-center justify-center float-y">
          <Flame size={24} strokeWidth={3} color="#0A0A0A" />
        </div>
        <div className="flex-1">
          <div className="text-white font-black text-base">{user.streak} днів поспіль</div>
          <div className="text-zinc-400 text-xs">Заходь завтра — не втрачай серію</div>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3">
        <button
          data-testid="cta-quests"
          onClick={() => nav("/tasks")}
          className="arcade-btn bg-[#39FF14] border-[#1a7a0a] text-[#0A0A0A] p-4 text-left"
        >
          <Swords size={22} strokeWidth={3} />
          <div className="font-display text-lg mt-2 leading-none">КВЕСТИ</div>
          <div className="text-xs font-black opacity-80 mt-1">
            3 нові щодня
          </div>
        </button>
        <button
          data-testid="cta-store"
          onClick={() => nav("/store")}
          className="arcade-btn bg-[#00F0FF] border-[#005f66] text-[#0A0A0A] p-4 text-left"
        >
          <Gift size={22} strokeWidth={3} />
          <div className="font-display text-lg mt-2 leading-none">МАГАЗИН</div>
          <div className="text-xs font-black opacity-80 mt-1">Витрачай бали</div>
        </button>
      </section>

      {/* Fun / Cube CTA — hero card */}
      <button
        data-testid="cta-fun"
        onClick={() => nav("/fun")}
        className="arcade-btn w-full bg-gradient-to-r from-[#FFB800] to-[#FF5C00] border-[#7a1c00] text-[#0A0A0A] p-4 text-left flex items-center gap-4"
      >
        <div className="w-14 h-14 rounded-2xl bg-black/25 flex items-center justify-center shrink-0">
          <Dice5 size={28} strokeWidth={3} color="#0A0A0A" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-black uppercase tracking-widest opacity-70">Щоденний бонус</div>
          <div className="font-display text-xl leading-none mt-1">ЩЕДРИЙ КУБ</div>
          <div className="text-xs font-black mt-1 opacity-90">+ Передбачення дня. До 350 балів!</div>
        </div>
        <ChevronRight size={20} strokeWidth={3} />
      </button>

      <section>
        <div className="flex items-center justify-between mb-3 px-1">
          <div className="font-display text-lg text-white">Досягнення</div>
          <div className="text-zinc-500 text-xs font-black">
            {achievements.filter((a) => a.unlocked).length} / {achievements.length}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3" data-testid="achievements-grid">
          {achievements.map((a) => (
            <Badge key={a.id} ach={a} />
          ))}
        </div>
      </section>

      <section className="bg-[#1A1A1E] border border-white/10 rounded-3xl p-5 flex items-center gap-4">
        <div className="w-12 h-12 rounded-2xl bg-[#FFB800]/15 border-2 border-[#FFB800]/50 flex items-center justify-center">
          <Zap size={22} strokeWidth={3} color="#FFB800" />
        </div>
        <div className="flex-1">
          <div className="text-white font-black text-sm">До нового рівня</div>
          <div className="text-zinc-500 text-xs mt-0.5">
            {xpNext - xp} XP • виконай ще пару квестів
          </div>
        </div>
        <ChevronRight size={20} strokeWidth={3} color="#FFB800" />
      </section>
    </div>
  );
}
