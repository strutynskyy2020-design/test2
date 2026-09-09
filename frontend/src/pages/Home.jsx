import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Flame, Sparkles, Award, Zap, ChevronRight, Coins, TrendingUp, Swords, Gift, Dice5, ScrollText, Target, Newspaper, Gamepad2, BriefcaseBusiness, CalendarClock, CalendarDays, Coffee, Search } from "lucide-react";
import { useApp } from "@/context/AppContext";
import { useDailyGoogleReports } from "@/hooks/useGoogleReports";
import api from "@/lib/api";
import { resolveAvatarUrl } from "@/lib/avatar";
import AvatarFrame from "@/components/AvatarFrame";
import FeedItem from "@/components/FeedItem";
import ThemeToggle from "@/components/ThemeToggle";
import PalmOnSandIcon from "@/components/PalmOnSandIcon";
import { addIsoDays, formatShiftTime, getScheduleStatus, kyivTodayIso } from "@/lib/workSchedule";
import depositProjection from "@/lib/depositProjection";
import { normalizeReportProfile } from "@/lib/activationReports";
import FlappyHomeCard from "@/games/flappy/FlappyHomeCard";
import DriveHomeCard from "@/games/pixel-drive/DriveHomeCard";

const { resolveDepositProjectionCurrent } = depositProjection;

const ScheduleMiniIcon = ({ type, size = 21 }) => {
  if (type === "late_shift") return <CalendarClock size={size} strokeWidth={2.6} />;
  if (type === "weekend_shift") return <CalendarDays size={size} strokeWidth={2.6} />;
  if (type === "vacation") return <PalmOnSandIcon size={size} strokeWidth={2.35} />;
  if (type === "day_off") return <Coffee size={size} strokeWidth={2.6} />;
  return <BriefcaseBusiness size={size} strokeWidth={2.6} />;
};


const parseSheetNumber = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const normalized = String(value ?? "")
    .replace(/ /g, "")
    .replace(/\s+/g, "")
    .replace(/%$/, "")
    .replace(",", ".")
    .replace(/[^0-9.+-]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const firstDefined = (object, keys) => {
  for (const key of keys) {
    if (object?.[key] !== undefined && object?.[key] !== null && object?.[key] !== "") {
      return object[key];
    }
  }
  return 0;
};

const mapGoogleGoals = (sheetGoals, report, user) => {
  const depositProjection = resolveDepositProjectionCurrent(report, user);
  const metric = (name) => {
    const sheetCurrent = parseSheetNumber(firstDefined(sheetGoals, [`${name}_actual`, `${name}_current`]));
    const current = name === "deposit" && depositProjection.current !== null
      ? depositProjection.current
      : sheetCurrent;
    const target = 100;
    return {
      current,
      target,
      complete: current >= target,
    };
  };

  return {
    report_profile: "sales",
    credit: metric("credit"),
    debit: metric("debit"),
    deposit: metric("deposit"),
  };
};

const mapActivationGoals = (sheetGoals) => {
  const metric = (name) => {
    const current = parseSheetNumber(firstDefined(sheetGoals, [`${name}_actual`, `${name}_current`]));
    const target = 100;
    return { current, target, complete: current >= target };
  };
  return {
    report_profile: "activation",
    pumb_online: metric("pumb_online"),
    cards: metric("cards"),
  };
};

const defaultGoals = {
  report_profile: "sales",
  credit: { current: 0, target: 100, complete: false },
  debit: { current: 0, target: 100, complete: false },
  deposit: { current: 0, target: 100, complete: false },
  pumb_online: { current: 0, target: 100, complete: false },
  cards: { current: 0, target: 100, complete: false },
};

let bonusMatchWarmup = null;
const warmBonusMatch = () => {
  if (!bonusMatchWarmup) {
    bonusMatchWarmup = Promise.all([
      import("@/pages/BonusMatch"),
      import("@/lib/bonusMatchAssets").then(({ preloadBonusMatchArtwork }) => preloadBonusMatchArtwork()),
    ]).catch(() => null);
  }
  return bonusMatchWarmup;
};

let hiddenObjectsWarmup = null;
const warmHiddenObjects = () => {
  if (!hiddenObjectsWarmup) {
    hiddenObjectsWarmup = import("@/pages/HiddenObjects")
      .then(({ preloadHiddenObjectArtwork }) => preloadHiddenObjectArtwork([
        { image: "/hidden-objects/v5/scenes/illustrated-easy-office-panorama-v5.png" },
      ]))
      .catch(() => null);
  }
  return hiddenObjectsWarmup;
};

export default function Home() {
  const { user, mode } = useApp();
  const nav = useNavigate();
  const [avatarImageFailed, setAvatarImageFailed] = useState(false);
  const [goals, setGoals] = useState(defaultGoals);
  const [feed, setFeed] = useState([]);
  const [workSchedule, setWorkSchedule] = useState(null);
  const selectedScheduleLogin = (user?.role === "admin" || user?.role === "editor") && typeof window !== "undefined"
    ? localStorage.getItem("tm6_schedule_admin_login_v1") || ""
    : "";
  const { data: googleReports } = useDailyGoogleReports({ scheduleLogin: selectedScheduleLogin });

  useEffect(() => {
    const schedule = window.requestIdleCallback
      ? window.requestIdleCallback(() => { warmBonusMatch(); warmHiddenObjects(); }, { timeout: 2200 })
      : window.setTimeout(() => { warmBonusMatch(); warmHiddenObjects(); }, 1500);
    return () => {
      if (window.cancelIdleCallback && typeof schedule === "number") window.cancelIdleCallback(schedule);
      else window.clearTimeout(schedule);
    };
  }, []);

  useEffect(() => {
    if (!user) return;

    if (mode === "mock") {
      const mockProfile = normalizeReportProfile(user?.report_profile);
      setGoals(mockProfile === "activation"
        ? { ...defaultGoals, report_profile: "activation", pumb_online: { current: 108.7, target: 100, complete: true }, cards: { current: 103.3, target: 100, complete: true } }
        : { ...defaultGoals, report_profile: "sales", credit: { current: 92, target: 100, complete: false }, debit: { current: 111, target: 100, complete: true }, deposit: { current: 86, target: 100, complete: false } });
      const mockToday = kyivTodayIso();
      setWorkSchedule({
        found: true,
        employee: { name: user.name, login: user.goals_login || "demo", rate: "1" },
        days: [
          { date: mockToday, type: "work", title: "Робочий день", start: "09:00", end: "18:00" },
          { date: addIsoDays(mockToday, 1), type: "late_shift", title: "Пізня зміна", start: "11:00", end: "20:00" },
        ],
      });
      return;
    }

    const reportProfile = normalizeReportProfile(googleReports?.report_profile || user?.report_profile);
    if (googleReports?.found && reportProfile === "activation" && googleReports.activation_goals) {
      setGoals(mapActivationGoals(googleReports.activation_goals));
    } else if (googleReports?.found && googleReports.goals) {
      setGoals(mapGoogleGoals(googleReports.goals, googleReports, user));
    } else {
      setGoals({ ...defaultGoals, report_profile: reportProfile });
    }
    setWorkSchedule(googleReports?.schedule && typeof googleReports.schedule === "object" ? googleReports.schedule : null);
  }, [googleReports, mode, user]);

  useEffect(() => {
    if (!user || mode === "mock") return undefined;
    let cancelled = false;

    api.get("/feed", { params: { limit: 5 } }).then(r => {
      if (!cancelled) setFeed(r.data.events || []);
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user?.id, mode]);

  if (!user) return null;
  const level = user.level ?? 1;
  const xp = user.xp ?? 0;
  const xpNext = user.xp_to_next ?? 1000;
  const xpPct = Math.min(100, Math.round((xp / xpNext) * 100));
  const avatarSrc = resolveAvatarUrl(user.avatar_url);
  const isActivationProfile = normalizeReportProfile(goals.report_profile || user?.report_profile) === "activation";
  const goalEntries = isActivationProfile
    ? [["ПУМБ Online", goals.pumb_online], ["Картки", goals.cards]]
    : [["Кредити", goals.credit], ["Дебет", goals.debit], ["Депозити", goals.deposit]];
  const todayIso = kyivTodayIso();
  const scheduleDays = Array.isArray(workSchedule?.days) ? workSchedule.days : [];
  const todaySchedule = scheduleDays.find((day) => day.date === todayIso) || null;
  const tomorrowSchedule = scheduleDays.find((day) => day.date === addIsoDays(todayIso, 1)) || null;
  const todayScheduleStatus = getScheduleStatus(todaySchedule);
  const tomorrowScheduleStatus = getScheduleStatus(tomorrowSchedule);


  return <div className="space-y-6 px-5 pb-8 pt-2">
    {mode === "mock" && <div className="rounded-2xl border border-[#FF5C00]/40 bg-[#FF5C00]/10 px-3 py-2 text-[11px] font-black text-[#FF5C00]">ОФЛАЙН РЕЖИМ • використовуються демо-дані</div>}

    {/* 1. Avatar / profile */}
    <section className="diamond-card-auto relative overflow-hidden rounded-3xl border border-white/10 bg-[#1A1A1E]">
      <ThemeToggle className="absolute right-4 top-4 z-10" compact />
      <button
        type="button"
        onClick={() => nav("/profile")}
        className="block w-full p-5 text-left active:scale-[.99]"
        aria-label="Відкрити особистий кабінет"
        data-testid="open-personal-profile"
      >
        <div className="flex items-center gap-4 pr-14">
          <div className="relative shrink-0">
            <AvatarFrame
              src={avatarSrc && !avatarImageFailed ? avatarSrc : null}
              alt="Аватар профілю"
              initials={user.avatar_initials}
              color={user.avatar_color}
              rarity={user.avatar_rarity}
              size="lg"
              onLoad={() => setAvatarImageFailed(false)}
              onError={() => setAvatarImageFailed(true)}
            />
            <div className="absolute -bottom-1 right-0 rounded-full border-2 border-[#0A0A0A] bg-[#FFB800] px-1.5 py-0.5 text-[9px] font-black text-[#0A0A0A]">LVL {level}</div>
          </div>
          <div className="min-w-0 flex-1 overflow-hidden">
            <div className="truncate font-display text-[17px] leading-tight text-white">{user.name}</div>
            <div className="truncate text-xs text-zinc-500">{user.position}</div>
            <div className="truncate text-xs text-zinc-600">{user.team_name || user.department || "—"}</div>
          </div>
        </div>
        <div className="mt-5"><div className="mb-2 flex justify-between"><div className="text-[11px] font-black uppercase tracking-widest text-zinc-500">Рівень {level}</div><div className="text-[11px] font-black text-white">{xp} / {xpNext} XP</div></div><div className="h-4 overflow-hidden rounded-full border border-white/5 bg-[#0A0A0A]"><div className="xp-stripes h-full rounded-full" style={{ width: `${xpPct}%`, background: "linear-gradient(90deg,#FF5C00,#FFB800)" }} /></div></div>
        <div className="mt-4 flex items-center justify-between border-t border-white/8 pt-3">
          <span className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.14em] text-[#B78CFF]"><Award size={16} />Особистий кабінет</span>
          <span className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-zinc-500">Рівні та досягнення <ChevronRight size={16} /></span>
        </div>
      </button>
    </section>

    {/* 3. Balance */}
    <section className="grid grid-cols-2 gap-3">
      <button onClick={() => nav("/history")} className="rounded-3xl border-2 border-[#FFB800]/30 bg-[#1A1A1E] p-4 text-left active:scale-[.98]"><div className="flex items-center justify-between text-[11px] font-black uppercase tracking-widest text-zinc-500"><span className="flex items-center gap-2"><Coins size={14}/>Баланс</span><ScrollText size={12}/></div><div className="mt-1 font-display text-3xl text-[#FFB800]">{user.balance.toLocaleString("uk-UA")}</div><div className="mt-1 text-xs text-zinc-500">Point</div></button>
      <div className="rounded-3xl border border-white/10 bg-[#1A1A1E] p-4"><div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-zinc-500"><TrendingUp size={14}/>Всього</div><div className="mt-1 font-display text-3xl text-white">{user.total_earned.toLocaleString("uk-UA")}</div><div className="mt-1 text-xs text-zinc-500">зароблено</div></div>
    </section>

    {/* 4. Projections banner */}
    <button onClick={() => nav("/goals")} className="w-full rounded-3xl border border-[#B78CFF]/45 bg-gradient-to-br from-[#B78CFF]/18 to-[#1A1A1E] p-5 text-left active:scale-[.99]">
      <div className="flex items-center gap-3"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#B78CFF]/20"><Target size={24} strokeWidth={3} color="#B78CFF" /></div><div className="flex-1"><div className="font-display text-xl text-white">МОЇ ПРОЕКЦІЙНІ</div><div className="text-xs text-zinc-400">Ціль кожного напрямку: 100%</div></div><ChevronRight color="#B78CFF" /></div>
      <div className={`mt-4 grid gap-2 ${isActivationProfile ? "grid-cols-2" : "grid-cols-3"}`}>{goalEntries.map(([label,g]) => <div key={label}><div className="truncate text-[9px] font-black uppercase text-zinc-500">{label}</div><div className={`mt-1 text-sm font-black ${g?.complete ? "text-[#39FF14]" : "text-white"}`}>{Number(g?.current||0)}%</div><div className="mt-0.5 text-[8px] font-black uppercase text-zinc-600">ціль 100%</div></div>)}</div>
    </button>

    {/* 5. Quests / store */}
    <section className="grid grid-cols-2 gap-3"><button onClick={() => nav("/tasks")} className="arcade-btn bg-[#39FF14] border-[#1a7a0a] p-4 text-left text-[#0A0A0A]"><Swords size={22}/><div className="mt-2 font-display text-lg">КВЕСТИ</div><div className="mt-1 text-xs font-black opacity-80">3 нові щодня</div></button><button onClick={() => nav("/store")} className="arcade-btn bg-[#00F0FF] border-[#005f66] p-4 text-left text-[#0A0A0A]"><Gift size={22}/><div className="mt-2 font-display text-lg">МАГАЗИН</div><div className="mt-1 text-xs font-black opacity-80">Витрачай Point</div></button></section>

    {/* 6. Cube */}
    <button onClick={() => nav("/fun")} className="arcade-btn flex w-full items-center gap-4 border-[#7a1c00] bg-gradient-to-r from-[#FFB800] to-[#FF5C00] p-4 text-left text-[#0A0A0A]"><div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-black/25"><Dice5 size={28}/></div><div className="min-w-0 flex-1"><div className="text-[10px] font-black uppercase tracking-widest opacity-70">Щоденний бонус</div><div className="mt-1 font-display text-xl">ЩЕДРИЙ КУБ</div><div className="mt-1 text-xs font-black opacity-90">До 500 балів</div></div><ChevronRight /></button>

    <FlappyHomeCard onClick={() => nav("/games/flappy-pixel?from=pixel")} />

    {/* 7. Streak */}
    <section className="flex items-center gap-3 rounded-3xl border border-[#FF5C00]/30 bg-gradient-to-r from-[#FF5C00]/15 to-transparent p-4"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#FF5C00]"><Flame size={24} color="#0A0A0A" /></div><div className="flex-1"><div className="font-black text-white">{user.streak} днів поспіль</div><div className="text-xs text-zinc-400">Не втрачай серію</div></div></section>

    {/* 8. Feed */}
    <section><div className="mb-3 flex items-center justify-between px-1"><div className="flex items-center gap-2 font-display text-lg text-white"><Newspaper size={19} color="#39FF14"/>Стрічка активності</div><button type="button" onClick={() => nav("/feed")} className="rounded-full border border-white/10 bg-[#1A1A1E] px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-zinc-300 active:scale-95">Переглянути все</button></div>{feed.length ? <ul className="space-y-3">{feed.slice(0,4).map(ev => <FeedItem key={ev.id} ev={ev}/>)}</ul> : <div className="rounded-3xl border border-white/10 bg-[#1A1A1E] p-5 text-center text-xs text-zinc-500">Поки що немає нової активності</div>}</section>

    {/* Pixel is the shared entrance to both existing games. */}
    <button type="button" onPointerEnter={() => { warmBonusMatch(); warmHiddenObjects(); }} onFocus={() => { warmBonusMatch(); warmHiddenObjects(); }} onClick={() => nav("/pet/room")} className="group relative flex w-full items-center gap-4 overflow-hidden rounded-3xl border border-[#D3AF72]/50 bg-gradient-to-r from-[#24312E] via-[#1D2827] to-[#182323] p-5 text-left shadow-lg active:scale-[.99]" data-testid="home-pixel-story">
      <img src="/pet/room/v6/rig/sit-poster.webp" alt="" className="h-20 w-20 shrink-0 object-contain" />
      <div className="relative min-w-0 flex-1"><div className="font-display text-xl text-[#F0DFC1]">ПІКСЕЛЬ</div><div className="mt-1 text-sm text-[#D8BD8B]">Кімната з історією</div><div className="mt-2 text-[11px] leading-relaxed text-[#B7C2B5]">Bonus Match · Детектив · Flappy · Повний газ<br />24 розділи, ваші рішення й спільний дім</div></div>
      <ChevronRight className="relative shrink-0 text-[#D9B67C]" />
    </button>

    {/* 11. Work schedule */}
    <DriveHomeCard onClick={() => nav("/games/pixel-drive?from=pixel")} />

    {/* Work schedule */}
    <button
      type="button"
      onClick={() => nav("/schedule")}
      className="group w-full rounded-3xl border border-white/10 bg-[#1A1A1E] p-4 text-left shadow-[0_14px_36px_rgba(44,44,60,.06)] active:scale-[.99]"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CalendarDays size={18} className="text-[#6D3DF5]" strokeWidth={2.8} />
          <div className="font-display text-base text-white">МІЙ ГРАФІК</div>
        </div>
        <ChevronRight size={19} className="text-[#8B5CF6] transition-transform group-active:translate-x-1" />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        {[
          ["Сьогодні", todaySchedule, todayScheduleStatus],
          ["Завтра", tomorrowSchedule, tomorrowScheduleStatus],
        ].map(([label, day, status]) => (
          <div key={label} className="min-w-0 rounded-2xl border border-white/10 bg-black/20 p-3">
            <div className="text-[9px] font-black uppercase tracking-widest text-zinc-500">{label}</div>
            <div className="mt-2 flex items-center gap-2.5">
              <div
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border"
                style={{ color: status.color, background: status.soft, borderColor: status.border }}
              >
                <ScheduleMiniIcon type={day?.type} size={18} />
              </div>
              <div className="min-w-0">
                <div className="truncate text-xs font-black text-white">{day ? status.label : "Немає даних"}</div>
                <div className="mt-0.5 truncate text-[10px] font-black" style={{ color: status.color }}>
                  {day ? formatShiftTime(day) : "Відкрити календар"}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </button>

  </div>;
}
