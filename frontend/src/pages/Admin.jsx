import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Users, Swords, Gift, ShoppingBag, BarChart3, Plus, Pencil, Trash2, X, Minus, Check, Coins, Trophy, ChevronRight,
  UserCog, ShieldCheck, Crown, UsersRound, Inbox, UserCheck, ClipboardList, CheckCircle2, XCircle,
  ArrowUp, ArrowDown, FileText, BrainCircuit, Clock3, TrendingUp, Search, CalendarDays, Target, Save, ChevronDown,
  KeyRound, Award, Medal, Star, Sparkles, Send, Gamepad2, RotateCcw,
} from "lucide-react";
import api, { extractError, API_BASE, getToken } from "@/lib/api";
import { useApp } from "@/context/AppContext";

const TABS = [
  { id: "analytics", label: "Огляд", icon: BarChart3 },
  { id: "ai-team", label: "AI команда", icon: BrainCircuit },
  { id: "daily-tasks", label: "Завдання дня", icon: CalendarDays },
  { id: "goals", label: "Цілі", icon: Target },
  { id: "moderation", label: "Модерація", icon: UserCheck },
  { id: "applications", label: "Заявки", icon: Inbox },
  { id: "users", label: "Юзери", icon: Users },
  { id: "teams", label: "Команди", icon: UsersRound },
  { id: "achievements", label: "Досягнення", icon: Award },
  { id: "bonus-match", label: "Bonus Match", icon: Gamepad2 },
  { id: "prizes", label: "Призи", icon: Gift },
  { id: "orders", label: "Замовлення", icon: ShoppingBag },
];

const FIELD_TYPES = [
  { v: "text", l: "Текст" }, { v: "textarea", l: "Довгий текст" }, { v: "number", l: "Число" },
  { v: "date", l: "Дата" }, { v: "phone", l: "Телефон" }, { v: "email", l: "Email" },
  { v: "select", l: "Список" }, { v: "checkbox", l: "Чекбокс" }, { v: "file", l: "Файл" },
  { v: "photo", l: "Фото" }, { v: "photos", l: "Кілька фото" }, { v: "video", l: "Відео" },
];
const TASK_CATS = [
  { v: "sales", l: "Продажі" }, { v: "support", l: "Підтримка" }, { v: "quality", l: "Якість" },
  { v: "training", l: "Навчання" }, { v: "discipline", l: "Дисципліна" }, { v: "general", l: "Загальне" },
];
const APP_STATUS = {
  submitted: { label: "Надіслано", color: "#00F0FF" },
  pending_review: { label: "На перевірці", color: "#FFB800" },
  approved: { label: "Підтверджено", color: "#39FF14" },
  rejected: { label: "Відхилено", color: "#FF3B30" },
};

const DIFFICULTIES = ["easy", "medium", "hard"];
const CATEGORIES = ["avatar", "merch", "privilege", "certificate"];

// ─────────────── Analytics ───────────────
const StatBox = ({ label, value, accent }) => (
  <div className="bg-[#1A1A1E] border border-white/10 rounded-2xl p-4">
    <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500">{label}</div>
    <div className="font-display text-2xl mt-1" style={{ color: accent || "#F5F5F5" }}>{value}</div>
  </div>
);

const AnalyticsView = () => {
  const [data, setData] = useState(null);
  useEffect(() => {
    api.get("/admin/analytics").then((r) => setData(r.data)).catch((e) => toast.error(extractError(e)));
  }, []);
  if (!data) return <div className="text-zinc-500 text-sm py-8 text-center">Завантаження...</div>;
  return (
    <div className="space-y-4" data-testid="analytics-view">
      <div className="grid grid-cols-2 gap-3">
        <StatBox label="Юзерів" value={data.total_users} />
        <StatBox label="Активних квестів" value={data.total_quests} />
        <StatBox label="Призів у каталозі" value={data.total_prizes} />
        <StatBox label="Замовлень в обробці" value={data.orders_processing} accent="#00F0FF" />
        <StatBox label="Балів нараховано" value={data.total_points_earned.toLocaleString("uk-UA")} accent="#39FF14" />
        <StatBox label="Балів витрачено" value={data.total_points_spent.toLocaleString("uk-UA")} accent="#FF5C00" />
        <StatBox label="Переглядів сторінок · 30 днів" value={Number(data.total_page_views || 0).toLocaleString("uk-UA")} accent="#B78CFF" />
        <StatBox label="Активних працівників · 30 днів" value={Number(data.unique_page_users || 0)} accent="#00F0FF" />
      </div>

      <div className="bg-[#1A1A1E] border border-white/10 rounded-2xl p-4" data-testid="page-usage-analytics">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <div className="font-black text-white text-sm uppercase tracking-wider">Найпопулярніші вкладки та сторінки</div>
            <div className="mt-1 text-[10px] font-bold text-zinc-500">За останні {data.page_usage_period_days || 30} днів · адмін-панель не враховується</div>
          </div>
          <BarChart3 size={18} className="shrink-0 text-[#B78CFF]" />
        </div>
        <div className="space-y-3">
          {(data.popular_pages || []).map((page, index) => {
            const maxViews = Math.max(1, Number(data.popular_pages?.[0]?.views || 1));
            const width = Math.max(5, Math.round(Number(page.views || 0) / maxViews * 100));
            return <div key={`${page.path}-${index}`} className="rounded-xl bg-black/25 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-black text-white">{page.label || page.path}</div>
                  <div className="mt-0.5 truncate text-[10px] text-zinc-600">{page.path}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-sm font-black text-[#B78CFF]">{Number(page.views || 0).toLocaleString("uk-UA")}</div>
                  <div className="text-[9px] font-bold text-zinc-600">{page.unique_users || 0} працівн.</div>
                </div>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/5"><div className="h-full rounded-full bg-[#B78CFF]" style={{width:`${width}%`}} /></div>
            </div>;
          })}
          {!(data.popular_pages || []).length && <div className="py-4 text-center text-xs text-zinc-500">Статистика почне збиратися після оновлення frontend.</div>}
        </div>
      </div>

      <div className="bg-[#1A1A1E] border border-white/10 rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Trophy size={16} color="#FFB800" strokeWidth={3} />
          <div className="font-black text-white text-sm uppercase tracking-wider">Топ 5 працівників</div>
        </div>
        <div className="space-y-2">
          {data.top_earners.map((u, i) => (
            <div key={u.id} className="flex items-center gap-3">
              <div className="w-6 text-center font-display text-lg text-[#FFB800]">{i + 1}</div>
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center font-display text-xs text-[#0A0A0A]"
                style={{ backgroundColor: u.avatar_color || "#FFB800" }}
              >
                {u.avatar_initials || "?"}
              </div>
              <div className="flex-1 text-white font-black text-sm truncate">{u.name}</div>
              <div className="flex items-center gap-1 text-[#FFB800] font-display">
                <Coins size={14} strokeWidth={3} />
                {u.total_earned.toLocaleString("uk-UA")}
              </div>
            </div>
          ))}
          {data.top_earners.length === 0 && <div className="text-zinc-500 text-xs">Немає даних</div>}
        </div>
      </div>

      <div className="bg-[#1A1A1E] border border-white/10 rounded-2xl p-4">
        <div className="font-black text-white text-sm uppercase tracking-wider mb-3">Популярні квести</div>
        <div className="space-y-2">
          {data.popular_quests.map((q, i) => (
            <div key={i} className="flex items-center justify-between">
              <div className="text-white text-sm truncate flex-1">{q.title}</div>
              <div className="text-[#39FF14] font-black text-xs">{q.claims} claims</div>
            </div>
          ))}
          {data.popular_quests.length === 0 && <div className="text-zinc-500 text-xs">Ще не забирали</div>}
        </div>
      </div>
    </div>
  );
};



// ─────────────── AI team manager dashboard ───────────────
const AITeamDashboard = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [openSession, setOpenSession] = useState(null);
  useEffect(() => {
    api.get("/admin/ai-training-dashboard")
      .then((r) => setData(r.data))
      .catch((e) => toast.error(extractError(e)))
      .finally(() => setLoading(false));
  }, []);
  if (loading) return <div className="text-zinc-500 text-sm py-8 text-center">Завантаження статистики...</div>;
  if (!data) return <div className="text-zinc-500 text-sm py-8 text-center">Немає даних тренувань</div>;
  return <div className="space-y-4" data-testid="ai-team-dashboard">
    <div className="grid grid-cols-2 gap-3">
      <StatBox label="Середній бал команди" value={`${data.team_average}/10`} accent="#00F0FF" />
      <StatBox label="Тренувань" value={data.total_trainings} accent="#FFB800" />
      <StatBox label="Тренувалися" value={`${data.trained_count}/${data.total_operators}`} accent="#39FF14" />
      <StatBox label="Неактивні 7+ днів" value={data.inactive.length} accent="#FF5C00" />
    </div>

    <div className="bg-[#1A1A1E] border border-white/10 rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-3"><Trophy size={16} className="text-[#FFB800]"/><div className="font-black text-white text-sm uppercase tracking-wider">Рейтинг операторів</div></div>
      <div className="space-y-2">{data.ranking.map((u,i)=><div key={u.id} className="flex items-center gap-3 rounded-xl bg-black/25 p-3">
        <div className="font-display text-[#FFB800] w-6">#{i+1}</div>
        <div className="w-9 h-9 rounded-xl flex items-center justify-center text-black font-black" style={{backgroundColor:u.avatar_color||"#FFB800"}}>{u.avatar_initials||"?"}</div>
        <div className="flex-1 min-w-0"><div className="font-black text-white text-sm truncate">{u.name}</div><div className="text-[10px] text-zinc-500">{u.attempts} кейсів • {u.win_rate}% успіху</div></div>
        <div className="font-display text-[#00F0FF]">{u.average_score}</div>
      </div>)}</div>
    </div>

    <div className="bg-[#1A1A1E] border border-white/10 rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-3"><BrainCircuit size={16} className="text-[#B56CFF]"/><div className="font-black text-white text-sm uppercase tracking-wider">Слабкі навички команди</div></div>
      <div className="space-y-3">{data.weak_skills.length ? data.weak_skills.map((skill)=><div key={skill.name}><div className="flex justify-between text-xs mb-1"><span className="text-zinc-300">{skill.name}</span><span className="font-black text-white">{skill.score}%</span></div><div className="h-2 rounded-full bg-black/50 overflow-hidden"><div className="h-full bg-[#B56CFF]" style={{width:`${skill.score}%`}}/></div></div>) : <div className="text-zinc-500 text-xs">Потрібно більше завершених тренувань.</div>}</div>
    </div>

    <div className="bg-[#1A1A1E] border border-white/10 rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-3"><Clock3 size={16} className="text-[#FF5C00]"/><div className="font-black text-white text-sm uppercase tracking-wider">Хто давно не тренувався</div></div>
      <div className="space-y-2">{data.inactive.length ? data.inactive.map((u)=><div key={u.id} className="flex items-center justify-between rounded-xl bg-black/25 px-3 py-2.5"><div><div className="text-white font-black text-sm">{u.name}</div><div className="text-[10px] text-zinc-500">{u.attempts ? `Останнє тренування: ${u.days_inactive} дн. тому` : "Ще не тренувався"}</div></div><span className="text-[#FF5C00] font-black text-xs">{u.attempts} кейсів</span></div>) : <div className="text-[#39FF14] text-xs font-black">Усі тренувалися протягом останніх 7 днів.</div>}</div>
    </div>

    <div className="bg-[#1A1A1E] border border-white/10 rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-3"><TrendingUp size={16} className="text-[#39FF14]"/><div className="font-black text-white text-sm uppercase tracking-wider">Прогрес співробітників</div></div>
      <div className="space-y-3">{data.operators.map((u)=><div key={u.id} className="rounded-xl bg-black/25 p-3"><div className="flex items-center justify-between"><div className="font-black text-white text-sm">{u.name}</div><div className="text-[#00F0FF] font-display">{u.average_score}/10</div></div><div className="flex gap-1 items-end h-10 mt-2">{(u.progress||[]).length ? u.progress.map((p,i)=><div key={i} className="flex-1 rounded-t bg-[#39FF14]/80 min-w-[5px]" style={{height:`${Math.max(8, Number(p.score||0)*10)}%`}} title={`${p.score}/10`}/>) : <div className="text-[10px] text-zinc-600">Немає тренувань</div>}</div>{u.weakest_skills?.length>0&&<div className="text-[9px] text-zinc-500 mt-2">Покращити: {u.weakest_skills.map(x=>x[0]).join(", ")}</div>}</div>)}</div>
    </div>

    <div className="bg-[#1A1A1E] border border-white/10 rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-3"><FileText size={16} className="text-[#00F0FF]"/><div className="font-black text-white text-sm uppercase tracking-wider">Діалоги операторів</div></div>
      <div className="space-y-2">
        {(data.sessions || []).length ? (data.sessions || []).map((session) => {
          const isOpen = openSession === session.id;
          return <div key={session.id} className="rounded-2xl border border-white/10 bg-black/25 overflow-hidden">
            <button type="button" onClick={() => setOpenSession(isOpen ? null : session.id)} className="w-full p-3 flex items-center gap-3 text-left">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center text-black font-black shrink-0" style={{backgroundColor:session.avatar_color||"#FFB800"}}>{session.avatar_initials||"?"}</div>
              <div className="flex-1 min-w-0"><div className="font-black text-white text-sm truncate">{session.user_name}</div><div className="text-[10px] text-zinc-500 truncate">{session.scenario_title} • {session.average_score}/10</div></div>
              <div className={`text-[10px] font-black ${session.won ? "text-[#39FF14]" : "text-[#FF5C00]"}`}>{session.won ? "УСПІХ" : "НЕ ЗАВЕРШЕНО"}</div>
              <ChevronDown size={16} className={`text-zinc-500 transition-transform ${isOpen ? "rotate-180" : ""}`}/>
            </button>
            {isOpen && <div className="border-t border-white/10 p-3 space-y-2">
              {(session.conversation || []).length ? session.conversation.map((message, index) => <div key={index} className={`rounded-xl px-3 py-2 ${message.role === "operator" ? "bg-[#FFB800]/10 border border-[#FFB800]/20" : message.role === "client" ? "bg-[#00F0FF]/10 border border-[#00F0FF]/20" : "bg-[#B56CFF]/10 border border-[#B56CFF]/20"}`}>
                <div className="text-[9px] font-black uppercase tracking-wider text-zinc-500 mb-1">{message.role === "operator" ? "Оператор" : message.role === "client" ? "AI клієнт" : "AI коуч"}</div>
                <div className="text-xs text-zinc-200 whitespace-pre-wrap">{message.text || message.feedback || "—"}</div>
              </div>) : <div className="text-xs text-zinc-500">Для цього тренування діалог не збережено.</div>}
              {session.outcome_text && <div className="text-[10px] text-zinc-500 pt-1">Результат: {session.outcome_text}</div>}
            </div>}
          </div>;
        }) : <div className="text-zinc-500 text-xs">Завершені AI-тренування ще не збережені.</div>}
      </div>
    </div>
  </div>;
};



// ─────────────── Daily tasks manager ───────────────
const resolveAvatarUrl = (url) => {
  if (!url) return null;
  if (url.startsWith("http") || url.startsWith("data:")) return url;
  const base = (process.env.REACT_APP_BACKEND_URL || "").replace(/\/api\/?$/, "");
  return `${base}${url}`;
};

const DAILY_DIFFICULTY = {
  easy: { label: "Легке", color: "#39FF14" },
  medium: { label: "Середнє", color: "#FFB800" },
  hard: { label: "Важке", color: "#FF5C00" },
};

const DailyTasksManager = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [busyKey, setBusyKey] = useState(null);

  const load = async () => {
    try {
      const response = await api.get("/admin/daily-tasks-dashboard");
      setData(response.data);
    } catch (e) {
      toast.error(extractError(e, "Не вдалося завантажити завдання"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const decide = async (operator, task, decision) => {
    const key = `${operator.id}:${task.id}`;
    setBusyKey(key);
    try {
      const response = await api.post(`/admin/daily-tasks/${operator.id}/${task.id}/${decision}`);
      const result = response.data;
      setData((prev) => ({
        ...prev,
        awarded_points: prev.awarded_points + (result.reward || 0),
        decided_count: prev.decided_count + 1,
        operators: prev.operators.map((item) => item.id !== operator.id ? item : {
          ...item,
          approved_count: item.approved_count + (result.status === "approved" ? 1 : 0),
          decided_count: item.decided_count + 1,
          tasks: item.tasks.map((current) => current.id !== task.id ? current : {
            ...current,
            status: result.status,
            reviewed_at: result.reviewed_at,
            reviewed_by_name: result.reviewed_by_name,
          }),
        }),
      }));
      if (result.status === "approved") {
        toast.success(`+${result.reward} Point та +${result.xp || 0} XP нараховано`, { description: operator.name });
      } else {
        toast.success("Завдання відхилено", { description: operator.name });
      }
    } catch (e) {
      toast.error(extractError(e, "Не вдалося зберегти рішення"));
    } finally {
      setBusyKey(null);
    }
  };

  if (loading) return <div className="py-10 text-center text-sm font-black text-zinc-500">Завантаження…</div>;
  if (!data) return <div className="py-10 text-center text-sm font-black text-zinc-500">Немає даних</div>;

  const query = search.trim().toLowerCase();
  const operators = data.operators.filter((operator) => !query || operator.name.toLowerCase().includes(query));

  const taskActions = (operator, task, compact = false) => {
    const key = `${operator.id}:${task.id}`;
    const decided = task.status !== "pending";
    if (decided) {
      return (
        <div className={`flex items-center justify-between rounded-xl border px-3 py-2 ${task.status === "approved" ? "border-[#39FF14]/30 bg-[#39FF14]/10" : "border-[#FF3B30]/30 bg-[#FF3B30]/10"}`}>
          <div className={`flex items-center gap-2 text-[10px] font-black uppercase tracking-wider ${task.status === "approved" ? "text-[#39FF14]" : "text-[#FF3B30]"}`}>
            {task.status === "approved" ? <CheckCircle2 size={14} strokeWidth={3} /> : <XCircle size={14} strokeWidth={3} />}
            {task.status === "approved" ? `Нараховано +${task.reward}` : "Відхилено"}
          </div>
          {!compact && <div className="text-[9px] font-bold text-zinc-500">{task.reviewed_by_name || "Адмін"}</div>}
        </div>
      );
    }
    return (
      <div className={`grid grid-cols-2 gap-2 ${compact ? "mt-2" : "mt-3"}`}>
        <button
          onClick={() => decide(operator, task, "approve")}
          disabled={busyKey === key}
          className="min-h-10 touch-manipulation rounded-xl border border-[#39FF14]/50 bg-[#39FF14]/15 px-2 text-[10px] font-black uppercase tracking-wide text-[#39FF14] active:scale-95 disabled:opacity-50"
        >
          <span className="inline-flex items-center gap-1"><CheckCircle2 size={14} strokeWidth={3} /> Нарахувати</span>
        </button>
        <button
          onClick={() => decide(operator, task, "reject")}
          disabled={busyKey === key}
          className="min-h-10 touch-manipulation rounded-xl border border-[#FF3B30]/50 bg-[#FF3B30]/10 px-2 text-[10px] font-black uppercase tracking-wide text-[#FF3B30] active:scale-95 disabled:opacity-50"
        >
          <span className="inline-flex items-center gap-1"><XCircle size={14} strokeWidth={3} /> Відхилити</span>
        </button>
      </div>
    );
  };

  return (
    <div className="space-y-4" data-testid="daily-tasks-manager">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatBox label="Операторів" value={data.operator_count} accent="#00F0FF" />
        <StatBox label="Point сьогодні" value={data.awarded_points} accent="#39FF14" />
        <StatBox label="XP сьогодні" value={data.awarded_xp || 0} accent="#B78CFF" />
        <StatBox label="Рішень" value={`${data.decided_count}/${data.total_tasks}`} accent="#FFB800" />
        <StatBox label="Дата" value={data.date.split("-").reverse().join(".")} />
      </div>

      <div className="relative lg:max-w-md">
        <Search size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Пошук оператора…"
          className="h-12 w-full rounded-2xl border-2 border-white/10 bg-[#1A1A1E] pl-11 pr-4 text-sm font-bold text-white outline-none focus:border-[#FFB800]"
        />
      </div>

      {/* Mobile and tablet: native TM6 Bonus cards */}
      <div className="admin-mobile-task-list space-y-4">
        {operators.map((operator) => (
          <section key={operator.id} className="overflow-hidden rounded-3xl border border-white/10 bg-[#1A1A1E]">
            <div className="flex items-center gap-3 border-b border-white/10 p-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl font-display text-sm text-[#0A0A0A]" style={{ backgroundColor: operator.avatar_color || "#FFB800" }}>
                {operator.avatar_url ? <img src={resolveAvatarUrl(operator.avatar_url)} alt={operator.name} className="h-full w-full scale-[1.22] object-cover" /> : (operator.avatar_initials || "?")}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-base font-black text-white">{operator.name}</div>
                <div className="mt-0.5 text-[10px] font-black uppercase tracking-wider text-zinc-500">{operator.position || "Оператор"}</div>
              </div>
              <div className="rounded-2xl border border-[#FFB800]/30 bg-[#FFB800]/10 px-3 py-2 text-center">
                <div className="font-display text-lg text-[#FFB800]">{operator.decided_count}/3</div>
                <div className="text-[8px] font-black uppercase tracking-wider text-zinc-500">Перевірено</div>
              </div>
            </div>

            <div className="divide-y divide-white/5">
              {operator.tasks.map((task) => {
                const difficulty = DAILY_DIFFICULTY[task.difficulty] || DAILY_DIFFICULTY.easy;
                return (
                  <div key={task.id} className="p-4" data-testid={`admin-daily-task-${operator.id}-${task.id}`}>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-[#0A0A0A]" style={{ backgroundColor: difficulty.color }}>{difficulty.label}</span>
                        <span className="text-xs font-black text-[#FFB800]">{task.reward} Point</span><span className="text-xs font-black text-[#B78CFF]">+{task.xp} XP</span>
                      </div>
                      <div className="mt-2 text-sm font-black leading-snug text-white">{task.title}</div>
                      <div className="mt-1 line-clamp-2 text-xs font-semibold leading-relaxed text-zinc-400">{task.text}</div>
                    </div>
                    {taskActions(operator, task)}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {/* Laptop and desktop: wide operator table */}
      <div className="admin-desktop-task-table overflow-hidden rounded-3xl border border-white/10 bg-[#121318] shadow-2xl shadow-black/30">
        <div className="grid grid-cols-[230px_repeat(3,minmax(210px,1fr))_190px] items-center border-b border-white/10 bg-white/[0.025] px-5 py-4 text-[10px] font-black uppercase tracking-[0.14em] text-zinc-500">
          <div>Оператор</div>
          <div>Легке завдання</div>
          <div>Середнє завдання</div>
          <div>Важке завдання</div>
          <div className="text-center">Статус</div>
        </div>
        <div className="divide-y divide-white/5">
          {operators.map((operator) => (
            <div key={operator.id} className="grid grid-cols-[230px_repeat(3,minmax(210px,1fr))_190px] items-stretch px-5 transition-colors hover:bg-white/[0.02]">
              <div className="flex items-center gap-3 border-r border-white/5 py-5 pr-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl font-display text-sm text-[#0A0A0A]" style={{ backgroundColor: operator.avatar_color || "#FFB800" }}>
                  {operator.avatar_url ? <img src={resolveAvatarUrl(operator.avatar_url)} alt={operator.name} className="h-full w-full scale-[1.22] object-cover" /> : (operator.avatar_initials || "?")}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-black text-white">{operator.name}</div>
                  <div className="mt-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500">{operator.position || "Оператор"}</div>
                  <div className="mt-1 text-[10px] font-black text-[#FFB800]">{operator.decided_count}/3 перевірено</div>
                </div>
              </div>

              {operator.tasks.map((task) => {
                const difficulty = DAILY_DIFFICULTY[task.difficulty] || DAILY_DIFFICULTY.easy;
                return (
                  <div key={task.id} className="border-r border-white/5 p-4" data-testid={`admin-desktop-task-${operator.id}-${task.id}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="rounded-full px-2 py-0.5 text-[8px] font-black uppercase tracking-wider text-[#0A0A0A]" style={{ backgroundColor: difficulty.color }}>{difficulty.label}</span>
                      <span className="text-[10px] font-black text-[#FFB800]">{task.reward} Point</span><span className="text-[10px] font-black text-[#B78CFF]">+{task.xp} XP</span>
                    </div>
                    <div className="mt-2 line-clamp-1 text-xs font-black text-white" title={task.title}>{task.title}</div>
                    <div className="mt-1 line-clamp-2 min-h-9 text-[10px] font-semibold leading-relaxed text-zinc-500" title={task.text}>{task.text}</div>
                    {taskActions(operator, task, true)}
                  </div>
                );
              })}

              <div className="flex flex-col items-center justify-center gap-2 py-5 pl-4 text-center">
                <div className={`rounded-full px-3 py-1.5 text-[10px] font-black uppercase tracking-wider ${operator.decided_count === 3 ? "bg-[#39FF14]/10 text-[#39FF14]" : operator.decided_count > 0 ? "bg-[#FFB800]/10 text-[#FFB800]" : "bg-white/5 text-zinc-500"}`}>
                  {operator.decided_count === 3 ? "Готово" : operator.decided_count > 0 ? "В роботі" : "Не перевірено"}
                </div>
                <div className="font-display text-2xl text-white">{operator.decided_count}/3</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {!operators.length && <div className="rounded-3xl border border-white/10 bg-[#1A1A1E] py-12 text-center text-sm font-black text-zinc-500">Операторів не знайдено</div>}
    </div>
  );
};


// ─────────────── Users ───────────────
const UsersView = () => {
  const [users, setUsers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adjustFor, setAdjustFor] = useState(null);
  const [editFor, setEditFor] = useState(null);
  const [passwordFor, setPasswordFor] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [uR, tR] = await Promise.all([api.get("/admin/users"), api.get("/admin/teams")]);
      setUsers(uR.data);
      setTeams(tR.data);
    } catch (e) { toast.error(extractError(e)); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const del = async (u) => {
    if (!window.confirm(`Видалити ${u.name}?`)) return;
    try {
      await api.delete(`/admin/users/${u.id}`);
      toast.success("Видалено");
      load();
    } catch (e) { toast.error(extractError(e)); }
  };

  return (
    <div className="space-y-3" data-testid="users-view">
      <button
        data-testid="btn-create-user"
        onClick={() => setShowCreate(true)}
        className="arcade-btn w-full h-11 bg-[#FFB800] border-[#7a5900] text-[#0A0A0A] font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2"
      >
        <Plus size={16} strokeWidth={3} /> Новий юзер
      </button>

      {loading && <div className="text-zinc-500 text-sm py-4 text-center">Завантаження...</div>}

      {users.map((u) => (
        <div key={u.id} data-testid={`user-row-${u.id}`} className="bg-[#1A1A1E] border border-white/10 rounded-2xl p-3 flex items-center gap-3">
          <div
            className="w-11 h-11 rounded-xl flex items-center justify-center font-display text-sm text-[#0A0A0A] shrink-0"
            style={{ backgroundColor: u.avatar_color }}
          >
            {u.avatar_initials || "?"}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-white font-black text-sm truncate flex items-center gap-1.5">
              {u.name}
              {u.role === "admin" && <span className="text-[#FF5C00] text-[10px]">[admin]</span>}{u.role === "editor" && <span className="text-[#B78CFF] text-[10px]">[редактор]</span>}
              {u.is_team_leader && <Crown size={12} strokeWidth={3} className="text-[#FFB800]" />}
              {!u.approved && <span className="text-[#FF3B30] text-[9px] font-black">PENDING</span>}
            </div>
            <div className="text-zinc-500 text-xs truncate">{u.email}</div>
            <div className="text-[10px] text-zinc-600 mt-0.5 flex items-center gap-2">
              <span>LVL {u.level} • {u.balance.toLocaleString("uk-UA")} б.</span>
              {u.team_name && <span className="text-[#00F0FF] truncate">{u.team_name}</span>}
              {u.goals_login && <span className="text-[#B78CFF] truncate">Цілі: {u.goals_login}</span>}
            </div>
          </div>
          <div className="flex gap-1.5 shrink-0">
            <button
              data-testid={`edit-user-${u.id}`}
              onClick={() => setEditFor(u)}
              className="w-9 h-9 rounded-xl bg-[#0A0A0A] border border-[#00F0FF]/40 text-[#00F0FF] flex items-center justify-center active:scale-95"
              aria-label="Редагувати"
            >
              <UserCog size={14} strokeWidth={3} />
            </button>
            <button
              data-testid={`password-user-${u.id}`}
              onClick={() => setPasswordFor(u)}
              className="w-9 h-9 rounded-xl bg-[#0A0A0A] border border-[#B78CFF]/40 text-[#B78CFF] flex items-center justify-center active:scale-95"
              aria-label="Змінити пароль"
            >
              <KeyRound size={14} strokeWidth={3} />
            </button>
            <button
              data-testid={`adjust-${u.id}`}
              onClick={() => setAdjustFor(u)}
              className="w-9 h-9 rounded-xl bg-[#0A0A0A] border border-[#FFB800]/40 text-[#FFB800] flex items-center justify-center active:scale-95"
              aria-label="Змінити бали"
            >
              <Coins size={14} strokeWidth={3} />
            </button>
            {u.role !== "admin" && (
              <button
                data-testid={`delete-user-${u.id}`}
                onClick={() => del(u)}
                className="w-9 h-9 rounded-xl bg-[#0A0A0A] border border-[#FF3B30]/40 text-[#FF3B30] flex items-center justify-center active:scale-95"
                aria-label="Видалити"
              >
                <Trash2 size={14} strokeWidth={3} />
              </button>
            )}
          </div>
        </div>
      ))}

      {adjustFor && <AdjustPointsSheet user={adjustFor} onClose={() => setAdjustFor(null)} onDone={load} />}
      {passwordFor && <PasswordResetSheet user={passwordFor} onClose={() => setPasswordFor(null)} />}
      {editFor && <UserEditSheet user={editFor} teams={teams} onClose={() => setEditFor(null)} onDone={load} />}
      {showCreate && <CreateUserSheet onClose={() => setShowCreate(false)} onDone={load} />}
    </div>
  );
};

const PasswordResetSheet = ({ user, onClose }) => {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (password.length < 6) {
      toast.error("Пароль має містити щонайменше 6 символів");
      return;
    }
    if (password !== confirmPassword) {
      toast.error("Паролі не збігаються");
      return;
    }
    if (!window.confirm(`Змінити пароль для ${user.name}? Усі активні сесії цього акаунта буде завершено.`)) return;
    setBusy(true);
    try {
      const { data } = await api.patch(`/admin/users/${user.id}/password`, { new_password: password });
      toast.success(data?.message || "Пароль змінено. Усі сесії завершено");
      onClose();
    } catch (e) {
      toast.error(extractError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet onClose={onClose} title={`Новий пароль: ${user.name}`}>
      <div className="rounded-2xl border border-[#B78CFF]/25 bg-[#B78CFF]/[.07] p-3 text-xs leading-relaxed text-zinc-300">
        Після збереження акаунт автоматично вийде з усіх телефонів і браузерів. Для повторного входу потрібен новий пароль.
      </div>
      <label className="block text-[11px] font-black uppercase text-zinc-500 mt-4 mb-1">Новий пароль</label>
      <input
        data-testid="reset-password-new"
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Мінімум 6 символів"
        className="w-full h-12 px-4 rounded-xl bg-[#0A0A0A] border-2 border-white/10 text-white focus:border-[#B78CFF] outline-none"
      />
      <label className="block text-[11px] font-black uppercase text-zinc-500 mt-3 mb-1">Повтори пароль</label>
      <input
        data-testid="reset-password-confirm"
        type="password"
        autoComplete="new-password"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
        placeholder="Ще раз новий пароль"
        className="w-full h-12 px-4 rounded-xl bg-[#0A0A0A] border-2 border-white/10 text-white focus:border-[#B78CFF] outline-none"
      />
      <button
        data-testid="reset-password-submit"
        type="button"
        onClick={submit}
        disabled={busy || !password || !confirmPassword}
        className="arcade-btn w-full h-12 mt-5 bg-[#B78CFF] border-[#5B21B6] text-[#0A0A0A] font-black text-sm uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-50"
      >
        <KeyRound size={16} strokeWidth={3} />
        {busy ? "Змінюємо..." : "Змінити пароль"}
      </button>
    </BottomSheet>
  );
};

const UserEditSheet = ({ user, teams, onClose, onDone }) => {
  const [f, setF] = useState({
    first_name: user.first_name || "",
    last_name: user.last_name || "",
    phone: user.phone || "",
    telegram: user.telegram || "",
    goals_login: user.goals_login || "",
    department: user.department || "",
    position: user.position || "Оператор",
    team_id: user.team_id || "",
    is_team_leader: !!user.is_team_leader,
    approved: user.approved !== false,
    role: user.role || "employee",
  });
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const payload = {
        ...f,
        goals_login: String(f.goals_login || "").trim().toLowerCase() || null,
      };
      if (!payload.team_id) payload.team_id = null;
      await api.patch(`/admin/users/${user.id}`, payload);
      toast.success("Оновлено");
      onDone();
      onClose();
    } catch (e) { toast.error(extractError(e)); }
    setBusy(false);
  };

  return (
    <BottomSheet onClose={onClose} title={`Редагувати: ${user.name}`}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-black uppercase text-zinc-500 mb-1">Ім'я</label>
            <input data-testid="user-edit-first" value={f.first_name} onChange={(e) => setF({ ...f, first_name: e.target.value })} className="w-full h-11 px-3 rounded-xl bg-[#0A0A0A] border-2 border-white/10 text-white focus:border-[#FFB800] outline-none" />
          </div>
          <div>
            <label className="block text-[11px] font-black uppercase text-zinc-500 mb-1">Прізвище</label>
            <input data-testid="user-edit-last" value={f.last_name} onChange={(e) => setF({ ...f, last_name: e.target.value })} className="w-full h-11 px-3 rounded-xl bg-[#0A0A0A] border-2 border-white/10 text-white focus:border-[#FFB800] outline-none" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-black uppercase text-zinc-500 mb-1">Телефон</label>
            <input data-testid="user-edit-phone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} className="w-full h-11 px-3 rounded-xl bg-[#0A0A0A] border-2 border-white/10 text-white focus:border-[#FFB800] outline-none" />
          </div>
          <div>
            <label className="block text-[11px] font-black uppercase text-zinc-500 mb-1">Telegram</label>
            <input data-testid="user-edit-tg" value={f.telegram} onChange={(e) => setF({ ...f, telegram: e.target.value })} className="w-full h-11 px-3 rounded-xl bg-[#0A0A0A] border-2 border-white/10 text-white focus:border-[#FFB800] outline-none" />
          </div>
        </div>
        <div>
          <label className="block text-[11px] font-black uppercase text-zinc-500 mb-1">Ключ Google цілей</label>
          <input
            data-testid="user-edit-goals-login"
            value={f.goals_login}
            onChange={(e) => setF({ ...f, goals_login: e.target.value })}
            placeholder="Наприклад: operator_001"
            autoCapitalize="none"
            autoCorrect="off"
            className="w-full h-11 px-3 rounded-xl bg-[#0A0A0A] border-2 border-white/10 text-white focus:border-[#B78CFF] outline-none"
          />
          <div className="mt-1 text-[10px] leading-4 text-zinc-600">Має точно збігатися зі значенням goals_login у Google Таблиці.</div>
        </div>
        <div>
          <label className="block text-[11px] font-black uppercase text-zinc-500 mb-1">Роль</label>
          <select data-testid="user-edit-role" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} className="w-full h-11 px-3 rounded-xl bg-[#0A0A0A] border-2 border-white/10 text-white focus:border-[#B78CFF] outline-none">
            <option value="employee">Працівник</option>
            <option value="editor">Редактор</option>
            <option value="admin">Адміністратор</option>
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-black uppercase text-zinc-500 mb-1">Посада</label>
          <input data-testid="user-edit-position" value={f.position} onChange={(e) => setF({ ...f, position: e.target.value })} className="w-full h-11 px-3 rounded-xl bg-[#0A0A0A] border-2 border-white/10 text-white focus:border-[#FFB800] outline-none" />
        </div>
        <div>
          <label className="block text-[11px] font-black uppercase text-zinc-500 mb-1">Відділ</label>
          <input data-testid="user-edit-department" value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} className="w-full h-11 px-3 rounded-xl bg-[#0A0A0A] border-2 border-white/10 text-white focus:border-[#FFB800] outline-none" />
        </div>
        <div>
          <label className="block text-[11px] font-black uppercase text-zinc-500 mb-1">Команда</label>
          <select data-testid="user-edit-team" value={f.team_id} onChange={(e) => setF({ ...f, team_id: e.target.value })} className="w-full h-11 px-3 rounded-xl bg-[#0A0A0A] border-2 border-white/10 text-white focus:border-[#FFB800] outline-none">
            <option value="">— Без команди —</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-2 pt-1">
          <label className="flex items-center gap-2 cursor-pointer">
            <input data-testid="user-edit-leader" type="checkbox" checked={f.is_team_leader} onChange={(e) => setF({ ...f, is_team_leader: e.target.checked })} className="w-5 h-5 accent-[#FFB800]" />
            <span className="text-white text-sm font-black flex items-center gap-1.5">
              <Crown size={14} strokeWidth={3} className="text-[#FFB800]" /> Керівник команди
            </span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input data-testid="user-edit-approved" type="checkbox" checked={f.approved} onChange={(e) => setF({ ...f, approved: e.target.checked })} className="w-5 h-5 accent-[#39FF14]" />
            <span className="text-white text-sm font-black flex items-center gap-1.5">
              <ShieldCheck size={14} strokeWidth={3} className="text-[#39FF14]" /> Підтверджений
            </span>
          </label>
        </div>
      </div>
      <button data-testid="user-edit-save" onClick={save} disabled={busy} className="arcade-btn w-full h-12 mt-4 bg-[#FFB800] border-[#7a5900] text-[#0A0A0A] font-black text-sm uppercase tracking-wider disabled:opacity-60">
        {busy ? "..." : "Зберегти"}
      </button>
    </BottomSheet>
  );
};

// ─────────────── Achievements admin ───────────────
const ACHIEVEMENT_ICON_OPTIONS = [
  { value: "trophy", label: "Кубок", Icon: Trophy },
  { value: "award", label: "Нагорода", Icon: Award },
  { value: "medal", label: "Медаль", Icon: Medal },
  { value: "star", label: "Зірка", Icon: Star },
  { value: "crown", label: "Корона", Icon: Crown },
  { value: "sparkles", label: "Особливе", Icon: Sparkles },
];
const achievementIcon = (name) => ACHIEVEMENT_ICON_OPTIONS.find((item) => item.value === name)?.Icon || Award;

const AchievementsView = () => {
  const [data, setData] = useState({ achievements: [], users: [] });
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [granting, setGranting] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data: dashboard } = await api.get("/admin/achievements-dashboard");
      setData({ achievements: dashboard.achievements || [], users: dashboard.users || [] });
    } catch (e) { toast.error(extractError(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  return <div className="space-y-3" data-testid="achievements-admin-view">
    <button type="button" onClick={() => setEditing({ isNew: true })} className="arcade-btn flex h-11 w-full items-center justify-center gap-2 border-[#7a5900] bg-[#FFB800] text-xs font-black uppercase tracking-wider text-[#0A0A0A]">
      <Plus size={16} strokeWidth={3}/> Створити досягнення
    </button>
    {loading && <div className="py-8 text-center text-sm text-zinc-500">Завантаження...</div>}
    {!loading && !data.achievements.length && <div className="rounded-2xl border border-white/10 bg-[#1A1A1E] p-6 text-center text-sm text-zinc-500">Ще немає створених досягнень.</div>}
    {data.achievements.map((achievement) => {
      const Icon = achievementIcon(achievement.icon);
      return <div key={achievement.id} className={`rounded-2xl border bg-[#1A1A1E] p-4 ${achievement.active ? "border-white/10" : "border-white/5 opacity-60"}`}>
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border-2" style={{color:achievement.color,borderColor:`${achievement.color}66`,backgroundColor:`${achievement.color}18`}}><Icon size={22} strokeWidth={2.8}/></div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2"><div className="font-black text-white">{achievement.title}</div><span className={`rounded-full px-2 py-0.5 text-[8px] font-black uppercase ${achievement.active ? "bg-[#39FF14]/10 text-[#39FF14]" : "bg-white/5 text-zinc-500"}`}>{achievement.active ? "Активне" : "Приховане"}</span></div>
            <div className="mt-1 text-xs leading-relaxed text-zinc-500">{achievement.description || "Без опису"}</div>
            <div className="mt-2 text-[10px] font-black uppercase tracking-wider text-[#B78CFF]">Видано: {achievement.granted_count || 0}</div>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setEditing(achievement)} className="flex h-10 items-center justify-center gap-2 rounded-xl border border-[#00F0FF]/30 bg-black/25 text-xs font-black text-[#00F0FF]"><Pencil size={14}/>Редагувати</button>
          <button type="button" onClick={() => setGranting(achievement)} className="flex h-10 items-center justify-center gap-2 rounded-xl border border-[#B78CFF]/35 bg-[#B78CFF]/10 text-xs font-black text-[#D7C0FF]"><Send size={14}/>Видати</button>
        </div>
      </div>;
    })}
    {editing && <AchievementEditSheet achievement={editing} onClose={() => setEditing(null)} onDone={load}/>} 
    {granting && <AchievementGrantSheet achievement={granting} users={data.users} onClose={() => setGranting(null)} onDone={load}/>} 
  </div>;
};

const AchievementEditSheet = ({ achievement, onClose, onDone }) => {
  const isNew = !!achievement?.isNew;
  const [form, setForm] = useState({
    title: isNew ? "" : achievement.title || "",
    description: isNew ? "" : achievement.description || "",
    icon: isNew ? "trophy" : achievement.icon || "trophy",
    color: isNew ? "#FFB800" : achievement.color || "#FFB800",
    active: isNew ? true : achievement.active !== false,
  });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (form.title.trim().length < 2) return toast.error("Введіть назву досягнення");
    setBusy(true);
    try {
      if (isNew) await api.post("/admin/achievements", form);
      else await api.patch(`/admin/achievements/${achievement.id}`, form);
      toast.success(isNew ? "Досягнення створено" : "Досягнення оновлено");
      onDone(); onClose();
    } catch (e) { toast.error(extractError(e)); }
    finally { setBusy(false); }
  };
  return <BottomSheet onClose={onClose} title={isNew ? "Нове досягнення" : "Редагувати досягнення"}>
    <label className="mb-1 block text-[11px] font-black uppercase text-zinc-500">Назва</label>
    <input value={form.title} onChange={(e)=>setForm({...form,title:e.target.value})} maxLength={80} className="h-12 w-full rounded-xl border-2 border-white/10 bg-[#0A0A0A] px-4 text-white outline-none focus:border-[#FFB800]" placeholder="Наприклад: Майстер продажів"/>
    <label className="mb-1 mt-3 block text-[11px] font-black uppercase text-zinc-500">Опис</label>
    <textarea value={form.description} onChange={(e)=>setForm({...form,description:e.target.value})} maxLength={300} rows={3} className="w-full resize-none rounded-xl border-2 border-white/10 bg-[#0A0A0A] p-4 text-white outline-none focus:border-[#FFB800]" placeholder="За що працівник отримує нагороду"/>
    <div className="mt-3 grid grid-cols-[1fr_90px] gap-3">
      <div><label className="mb-1 block text-[11px] font-black uppercase text-zinc-500">Іконка</label><select value={form.icon} onChange={(e)=>setForm({...form,icon:e.target.value})} className="h-12 w-full rounded-xl border-2 border-white/10 bg-[#0A0A0A] px-3 text-white outline-none focus:border-[#B78CFF]">{ACHIEVEMENT_ICON_OPTIONS.map((item)=><option key={item.value} value={item.value}>{item.label}</option>)}</select></div>
      <div><label className="mb-1 block text-[11px] font-black uppercase text-zinc-500">Колір</label><input type="color" value={form.color} onChange={(e)=>setForm({...form,color:e.target.value})} className="h-12 w-full rounded-xl border-2 border-white/10 bg-[#0A0A0A] p-1"/></div>
    </div>
    <label className="mt-4 flex cursor-pointer items-center gap-2"><input type="checkbox" checked={form.active} onChange={(e)=>setForm({...form,active:e.target.checked})} className="h-5 w-5 accent-[#39FF14]"/><span className="text-sm font-black text-white">Показувати працівникам після видачі</span></label>
    <button type="button" onClick={save} disabled={busy} className="arcade-btn mt-5 flex h-12 w-full items-center justify-center gap-2 border-[#7a5900] bg-[#FFB800] text-sm font-black uppercase tracking-wider text-[#0A0A0A] disabled:opacity-50"><Save size={16}/>{busy ? "Зберігаємо..." : "Зберегти"}</button>
  </BottomSheet>;
};

const AchievementGrantSheet = ({ achievement, users, onClose, onDone }) => {
  const [localUsers, setLocalUsers] = useState(users || []);
  const [busyId, setBusyId] = useState(null);
  const toggle = async (user) => {
    const granted = (user.achievement_ids || []).includes(achievement.id);
    setBusyId(user.id);
    try {
      if (granted) await api.delete(`/admin/users/${user.id}/achievements/${achievement.id}`);
      else await api.post(`/admin/users/${user.id}/achievements/${achievement.id}`);
      setLocalUsers((current)=>current.map((item)=>item.id===user.id ? {...item,achievement_ids:granted ? (item.achievement_ids||[]).filter((id)=>id!==achievement.id) : [...(item.achievement_ids||[]),achievement.id]} : item));
      toast.success(granted ? "Досягнення відкликано" : "Досягнення видано");
      onDone();
    } catch (e) { toast.error(extractError(e)); }
    finally { setBusyId(null); }
  };
  return <BottomSheet onClose={onClose} title={`Видати: ${achievement.title}`}>
    <div className="max-h-[58vh] space-y-2 overflow-y-auto pr-1">
      {localUsers.map((user)=>{
        const granted=(user.achievement_ids||[]).includes(achievement.id);
        return <div key={user.id} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/25 p-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-display text-xs text-black" style={{backgroundColor:user.avatar_color||"#FFB800"}}>{user.avatar_initials||"?"}</div>
          <div className="min-w-0 flex-1"><div className="truncate text-sm font-black text-white">{user.name}</div><div className="truncate text-[10px] text-zinc-500">{user.email}</div></div>
          <button type="button" onClick={()=>toggle(user)} disabled={busyId===user.id} className={`h-9 shrink-0 rounded-xl border px-3 text-[10px] font-black uppercase ${granted ? "border-[#FF3B30]/35 bg-[#FF3B30]/10 text-[#FF6B65]" : "border-[#39FF14]/35 bg-[#39FF14]/10 text-[#39FF14]"}`}>{busyId===user.id ? "..." : granted ? "Відкликати" : "Видати"}</button>
        </div>;
      })}
      {!localUsers.length && <div className="py-6 text-center text-sm text-zinc-500">Немає працівників</div>}
    </div>
  </BottomSheet>;
};

// ─────────────── Teams admin ───────────────
const TEAM_COLORS = ["#FFB800", "#00F0FF", "#39FF14", "#FF5C00", "#B78CFF", "#FF3B8A"];

const TeamsView = () => {
  const [teams, setTeams] = useState([]);
  const [users, setUsers] = useState([]);
  const [editing, setEditing] = useState(null);

  const load = async () => {
    try {
      const [tR, uR] = await Promise.all([api.get("/admin/teams"), api.get("/admin/users")]);
      setTeams(tR.data);
      setUsers(uR.data);
    } catch (e) { toast.error(extractError(e)); }
  };
  useEffect(() => { load(); }, []);

  const del = async (t) => {
    if (!window.confirm(`Видалити команду "${t.name}"? Учасники залишаться без команди.`)) return;
    try {
      await api.delete(`/admin/teams/${t.id}`);
      toast.success("Видалено");
      load();
    } catch (e) { toast.error(extractError(e)); }
  };

  return (
    <div className="space-y-3" data-testid="teams-view">
      <button
        data-testid="btn-create-team"
        onClick={() => setEditing({})}
        className="arcade-btn w-full h-11 bg-[#FFB800] border-[#7a5900] text-[#0A0A0A] font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2"
      >
        <Plus size={16} strokeWidth={3} /> Нова команда
      </button>

      {teams.length === 0 && <div className="text-zinc-500 text-sm py-6 text-center">Ще немає команд</div>}

      {teams.map((t) => {
        const leader = users.find((u) => u.id === t.leader_id);
        return (
          <div key={t.id} data-testid={`admin-team-${t.id}`} className="bg-[#1A1A1E] border border-white/10 rounded-2xl p-3">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ backgroundColor: t.color + "22", border: `2px solid ${t.color}` }}>
                <UsersRound size={18} strokeWidth={3} color={t.color} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-white font-black text-sm truncate">{t.name}</div>
                <div className="text-zinc-500 text-[11px] truncate">{t.description || t.department || "—"}</div>
                <div className="text-[10px] text-zinc-600 mt-0.5">
                  {t.member_count} учасн. • {t.total_earned.toLocaleString("uk-UA")} б.
                  {leader && <span className="text-[#FFB800] ml-1.5">• 👑 {leader.name}</span>}
                </div>
              </div>
              <div className="flex gap-1.5 shrink-0">
                <button data-testid={`edit-team-${t.id}`} onClick={() => setEditing(t)} className="w-9 h-9 rounded-xl bg-[#0A0A0A] border border-white/10 text-white flex items-center justify-center active:scale-95">
                  <Pencil size={14} strokeWidth={3} />
                </button>
                <button data-testid={`delete-team-${t.id}`} onClick={() => del(t)} className="w-9 h-9 rounded-xl bg-[#0A0A0A] border border-[#FF3B30]/40 text-[#FF3B30] flex items-center justify-center active:scale-95">
                  <Trash2 size={14} strokeWidth={3} />
                </button>
              </div>
            </div>
          </div>
        );
      })}

      {editing !== null && (
        <TeamEditor team={editing} users={users} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      )}
    </div>
  );
};

const TeamEditor = ({ team, users, onClose, onSaved }) => {
  const isNew = !team.id;
  const [f, setF] = useState({
    name: team.name || "",
    description: team.description || "",
    department: team.department || "",
    color: team.color || TEAM_COLORS[0],
    leader_id: team.leader_id || "",
  });
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!f.name.trim()) { toast.error("Назва обов'язкова"); return; }
    setBusy(true);
    try {
      const payload = { ...f, leader_id: f.leader_id || null };
      if (isNew) await api.post("/admin/teams", payload);
      else await api.patch(`/admin/teams/${team.id}`, payload);
      toast.success(isNew ? "Створено" : "Оновлено");
      onSaved();
    } catch (e) { toast.error(extractError(e)); }
    setBusy(false);
  };

  return (
    <BottomSheet onClose={onClose} title={isNew ? "Нова команда" : "Редагування"}>
      <div className="space-y-3">
        <div>
          <label className="block text-[11px] font-black uppercase text-zinc-500 mb-1">Назва</label>
          <input data-testid="team-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className="w-full h-11 px-3 rounded-xl bg-[#0A0A0A] border-2 border-white/10 text-white focus:border-[#FFB800] outline-none" />
        </div>
        <div>
          <label className="block text-[11px] font-black uppercase text-zinc-500 mb-1">Опис</label>
          <textarea rows={2} data-testid="team-description" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} className="w-full px-3 py-2 rounded-xl bg-[#0A0A0A] border-2 border-white/10 text-white focus:border-[#FFB800] outline-none resize-none" />
        </div>
        <div>
          <label className="block text-[11px] font-black uppercase text-zinc-500 mb-1">Відділ</label>
          <input data-testid="team-department" value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} className="w-full h-11 px-3 rounded-xl bg-[#0A0A0A] border-2 border-white/10 text-white focus:border-[#FFB800] outline-none" />
        </div>
        <div>
          <label className="block text-[11px] font-black uppercase text-zinc-500 mb-1">Колір</label>
          <div className="grid grid-cols-6 gap-2">
            {TEAM_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                data-testid={`team-color-${c}`}
                onClick={() => setF({ ...f, color: c })}
                className={`h-10 rounded-xl border-2 ${f.color === c ? "border-white" : "border-transparent"}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>
        <div>
          <label className="block text-[11px] font-black uppercase text-zinc-500 mb-1">Керівник</label>
          <select data-testid="team-leader" value={f.leader_id} onChange={(e) => setF({ ...f, leader_id: e.target.value })} className="w-full h-11 px-3 rounded-xl bg-[#0A0A0A] border-2 border-white/10 text-white focus:border-[#FFB800] outline-none">
            <option value="">— Без керівника —</option>
            {users.filter((u) => u.role !== "admin").map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </div>
      </div>
      <button data-testid="team-save" onClick={save} disabled={busy} className="arcade-btn w-full h-12 mt-4 bg-[#FFB800] border-[#7a5900] text-[#0A0A0A] font-black text-sm uppercase tracking-wider disabled:opacity-60">
        {busy ? "..." : "Зберегти"}
      </button>
    </BottomSheet>
  );
};

const AdjustPointsSheet = ({ user, onClose, onDone }) => {
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (sign) => {
    const n = parseInt(amount, 10);
    if (!n || isNaN(n)) { toast.error("Введи число"); return; }
    setBusy(true);
    try {
      await api.patch(`/admin/users/${user.id}/points`, { amount: sign * Math.abs(n), description: description || "Ручне коригування" });
      toast.success(`${sign > 0 ? "+" : "-"}${Math.abs(n)} балів`);
      onDone();
      onClose();
    } catch (e) { toast.error(extractError(e)); }
    setBusy(false);
  };

  return (
    <BottomSheet onClose={onClose}>
      <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Коригування балів</div>
      <h3 className="font-display text-xl text-white mt-1">{user.name}</h3>
      <div className="text-zinc-400 text-xs mt-1">Поточний баланс: {user.balance.toLocaleString("uk-UA")}</div>

      <label className="block text-[11px] font-black uppercase text-zinc-500 mt-4 mb-1">Кількість</label>
      <input
        data-testid="adjust-amount"
        type="number"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="100"
        className="w-full h-12 px-4 rounded-xl bg-[#0A0A0A] border-2 border-white/10 text-white focus:border-[#FFB800] outline-none"
      />

      <label className="block text-[11px] font-black uppercase text-zinc-500 mt-3 mb-1">Причина</label>
      <input
        data-testid="adjust-description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Бонус за проєкт"
        className="w-full h-12 px-4 rounded-xl bg-[#0A0A0A] border-2 border-white/10 text-white focus:border-[#FFB800] outline-none"
      />

      <div className="grid grid-cols-2 gap-3 mt-5">
        <button
          data-testid="adjust-subtract"
          onClick={() => submit(-1)}
          disabled={busy}
          className="arcade-btn h-12 bg-[#FF3B30] border-[#7a1c17] text-white font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-60"
        >
          <Minus size={14} strokeWidth={3} /> Списати
        </button>
        <button
          data-testid="adjust-add"
          onClick={() => submit(1)}
          disabled={busy}
          className="arcade-btn h-12 bg-[#39FF14] border-[#1a7a0a] text-[#0A0A0A] font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-60"
        >
          <Plus size={14} strokeWidth={3} /> Нарахувати
        </button>
      </div>
    </BottomSheet>
  );
};

const CreateUserSheet = ({ onClose, onDone }) => {
  const [f, setF] = useState({ email: "", password: "demo123", name: "", position: "Оператор", department: "", avatar_color: "#FFB800" });
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!f.email || !f.name) { toast.error("Email і ім'я обов'язкові"); return; }
    setBusy(true);
    try {
      await api.post("/auth/register", f);
      toast.success("Юзера створено");
      onDone();
      onClose();
    } catch (e) { toast.error(extractError(e)); }
    setBusy(false);
  };

  return (
    <BottomSheet onClose={onClose} title="Новий юзер">
      {[
        ["email", "Email", "operator@callhub.ua"],
        ["password", "Пароль", "demo123"],
        ["name", "Ім'я", "Іван Петров"],
        ["position", "Посада", "Оператор"],
        ["department", "Відділ", "Продажі • Зміна А"],
      ].map(([k, label, ph]) => (
        <div key={k} className="mb-3">
          <label className="block text-[11px] font-black uppercase text-zinc-500 mb-1">{label}</label>
          <input
            data-testid={`create-user-${k}`}
            value={f[k]}
            onChange={(e) => setF({ ...f, [k]: e.target.value })}
            placeholder={ph}
            className="w-full h-11 px-3 rounded-xl bg-[#0A0A0A] border-2 border-white/10 text-white focus:border-[#FFB800] outline-none"
          />
        </div>
      ))}
      <button
        data-testid="create-user-submit"
        onClick={save}
        disabled={busy}
        className="arcade-btn w-full h-12 mt-2 bg-[#FFB800] border-[#7a5900] text-[#0A0A0A] font-black text-sm uppercase tracking-wider disabled:opacity-60"
      >
        {busy ? "..." : "Створити"}
      </button>
    </BottomSheet>
  );
};

// ─────────────── Quests admin ───────────────
const QuestsView = () => {
  const [quests, setQuests] = useState([]);
  const [editing, setEditing] = useState(null); // null | {} for new | quest object

  const load = async () => {
    try {
      const { data } = await api.get("/admin/quests");
      setQuests(data);
    } catch (e) { toast.error(extractError(e)); }
  };

  useEffect(() => { load(); }, []);

  const del = async (q) => {
    if (!window.confirm(`Видалити квест "${q.title}"?`)) return;
    try {
      await api.delete(`/admin/quests/${q.id}`);
      toast.success("Видалено");
      load();
    } catch (e) { toast.error(extractError(e)); }
  };

  return (
    <div className="space-y-3" data-testid="quests-view">
      <button
        data-testid="btn-create-quest"
        onClick={() => setEditing({})}
        className="arcade-btn w-full h-11 bg-[#FFB800] border-[#7a5900] text-[#0A0A0A] font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2"
      >
        <Plus size={16} strokeWidth={3} /> Новий квест
      </button>

      {quests.map((q) => (
        <div key={q.id} data-testid={`admin-quest-${q.id}`} className={`bg-[#1A1A1E] border rounded-2xl p-3 flex items-center gap-3 ${q.active ? "border-white/10" : "border-white/5 opacity-50"}`}>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full text-[#0A0A0A]"
                style={{ backgroundColor: q.difficulty === "easy" ? "#39FF14" : q.difficulty === "medium" ? "#FFB800" : "#FF5C00" }}>
                {q.difficulty}
              </span>
              <span className="text-[#39FF14] font-black text-xs">+{q.reward}</span>
              {!q.active && <span className="text-[9px] font-black text-zinc-500">ВИМКНЕНО</span>}
            </div>
            <div className="text-white font-black text-sm truncate mt-1">{q.title}</div>
            <div className="text-zinc-500 text-xs truncate">ціль: {q.goal}</div>
          </div>
          <div className="flex gap-1.5 shrink-0">
            <button data-testid={`edit-quest-${q.id}`} onClick={() => setEditing(q)} className="w-9 h-9 rounded-xl bg-[#0A0A0A] border border-white/10 text-white flex items-center justify-center active:scale-95" aria-label="Редагувати">
              <Pencil size={14} strokeWidth={3} />
            </button>
            <button data-testid={`delete-quest-${q.id}`} onClick={() => del(q)} className="w-9 h-9 rounded-xl bg-[#0A0A0A] border border-[#FF3B30]/40 text-[#FF3B30] flex items-center justify-center active:scale-95" aria-label="Видалити">
              <Trash2 size={14} strokeWidth={3} />
            </button>
          </div>
        </div>
      ))}

      {editing !== null && (
        <QuestEditor
          quest={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
};

const QuestEditor = ({ quest, onClose, onSaved }) => {
  const isNew = !quest.id;
  const [f, setF] = useState({
    title: quest.title || "",
    description: quest.description || "",
    difficulty: quest.difficulty || "easy",
    reward: quest.reward ?? 50,
    goal: quest.goal ?? 1,
    icon: quest.icon || "target",
    active: quest.active ?? true,
  });
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!f.title.trim()) { toast.error("Назва обов'язкова"); return; }
    setBusy(true);
    try {
      if (isNew) await api.post("/admin/quests", f);
      else await api.patch(`/admin/quests/${quest.id}`, f);
      toast.success(isNew ? "Створено" : "Оновлено");
      onSaved();
    } catch (e) { toast.error(extractError(e)); }
    setBusy(false);
  };

  return (
    <BottomSheet onClose={onClose} title={isNew ? "Новий квест" : "Редагування"}>
      <div className="space-y-3">
        <div>
          <label className="block text-[11px] font-black uppercase text-zinc-500 mb-1">Назва</label>
          <input data-testid="quest-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} className="w-full h-11 px-3 rounded-xl bg-[#0A0A0A] border-2 border-white/10 text-white focus:border-[#FFB800] outline-none" />
        </div>
        <div>
          <label className="block text-[11px] font-black uppercase text-zinc-500 mb-1">Опис</label>
          <textarea rows={2} data-testid="quest-description" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} className="w-full px-3 py-2 rounded-xl bg-[#0A0A0A] border-2 border-white/10 text-white focus:border-[#FFB800] outline-none resize-none" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-black uppercase text-zinc-500 mb-1">Складність</label>
            <select data-testid="quest-difficulty" value={f.difficulty} onChange={(e) => setF({ ...f, difficulty: e.target.value })} className="w-full h-11 px-3 rounded-xl bg-[#0A0A0A] border-2 border-white/10 text-white focus:border-[#FFB800] outline-none">
              {DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-black uppercase text-zinc-500 mb-1">Іконка</label>
            <input data-testid="quest-icon" value={f.icon} onChange={(e) => setF({ ...f, icon: e.target.value })} className="w-full h-11 px-3 rounded-xl bg-[#0A0A0A] border-2 border-white/10 text-white focus:border-[#FFB800] outline-none" />
          </div>
          <div>
            <label className="block text-[11px] font-black uppercase text-zinc-500 mb-1">Нагорода</label>
            <input data-testid="quest-reward" type="number" value={f.reward} onChange={(e) => setF({ ...f, reward: parseInt(e.target.value) || 0 })} className="w-full h-11 px-3 rounded-xl bg-[#0A0A0A] border-2 border-white/10 text-white focus:border-[#FFB800] outline-none" />
          </div>
          <div>
            <label className="block text-[11px] font-black uppercase text-zinc-500 mb-1">Ціль</label>
            <input data-testid="quest-goal" type="number" value={f.goal} onChange={(e) => setF({ ...f, goal: parseInt(e.target.value) || 1 })} className="w-full h-11 px-3 rounded-xl bg-[#0A0A0A] border-2 border-white/10 text-white focus:border-[#FFB800] outline-none" />
          </div>
        </div>
        <label className="flex items-center gap-2 mt-2">
          <input data-testid="quest-active" type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} className="w-5 h-5 accent-[#FFB800]" />
          <span className="text-white text-sm font-black">Активний</span>
        </label>
      </div>
      <button data-testid="quest-save" onClick={save} disabled={busy} className="arcade-btn w-full h-12 mt-4 bg-[#FFB800] border-[#7a5900] text-[#0A0A0A] font-black text-sm uppercase tracking-wider disabled:opacity-60">
        {busy ? "..." : "Зберегти"}
      </button>
    </BottomSheet>
  );
};

// ─────────────── Prizes admin ───────────────
const PrizesView = () => {
  const [prizes, setPrizes] = useState([]);
  const [editing, setEditing] = useState(null);

  const load = async () => {
    try {
      const { data } = await api.get("/admin/prizes");
      setPrizes(data);
    } catch (e) { toast.error(extractError(e)); }
  };
  useEffect(() => { load(); }, []);

  const del = async (p) => {
    if (!window.confirm(`Видалити приз "${p.title}"?`)) return;
    try {
      await api.delete(`/admin/prizes/${p.id}`);
      toast.success("Видалено");
      load();
    } catch (e) { toast.error(extractError(e)); }
  };

  return (
    <div className="space-y-3" data-testid="prizes-view">
      <button
        data-testid="btn-create-prize"
        onClick={() => setEditing({})}
        className="arcade-btn w-full h-11 bg-[#FFB800] border-[#7a5900] text-[#0A0A0A] font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2"
      >
        <Plus size={16} strokeWidth={3} /> Новий приз
      </button>
      {prizes.map((p) => (
        <div key={p.id} data-testid={`admin-prize-${p.id}`} className={`bg-[#1A1A1E] border rounded-2xl p-3 flex items-center gap-3 ${p.active ? "border-white/10" : "border-white/5 opacity-50"}`}>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-[#FFB800] text-[#0A0A0A]">{p.category}</span>
              <span className="text-[#FFB800] font-black text-xs">{p.price} балів</span>
              <span className="text-zinc-500 text-[10px]">• {p.stock} шт</span>
            </div>
            <div className="text-white font-black text-sm truncate mt-1">{p.title}</div>
          </div>
          <div className="flex gap-1.5 shrink-0">
            <button data-testid={`edit-prize-${p.id}`} onClick={() => setEditing(p)} className="w-9 h-9 rounded-xl bg-[#0A0A0A] border border-white/10 text-white flex items-center justify-center active:scale-95"><Pencil size={14} strokeWidth={3} /></button>
            <button data-testid={`delete-prize-${p.id}`} onClick={() => del(p)} className="w-9 h-9 rounded-xl bg-[#0A0A0A] border border-[#FF3B30]/40 text-[#FF3B30] flex items-center justify-center active:scale-95"><Trash2 size={14} strokeWidth={3} /></button>
          </div>
        </div>
      ))}
      {editing !== null && (
        <PrizeEditor prize={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      )}
    </div>
  );
};

const PrizeEditor = ({ prize, onClose, onSaved }) => {
  const isNew = !prize.id;
  const [f, setF] = useState({
    title: prize.title || "",
    description: prize.description || "",
    price: prize.price ?? 500,
    category: prize.category || "merch",
    image: prize.image || "",
    icon: prize.icon || "gift",
    stock: prize.stock ?? 10,
    active: prize.active ?? true,
    avatar_rarity: prize.avatar_rarity || "basic",
    daily_bonus: prize.daily_bonus ?? 0,
    task_replacements: prize.task_replacements ?? 0,
  });
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!f.title.trim()) { toast.error("Назва обов'язкова"); return; }
    const payload = { ...f, image: f.image.trim() || null };
    setBusy(true);
    try {
      if (isNew) await api.post("/admin/prizes", payload);
      else await api.patch(`/admin/prizes/${prize.id}`, payload);
      toast.success(isNew ? "Створено" : "Оновлено");
      onSaved();
    } catch (e) { toast.error(extractError(e)); }
    setBusy(false);
  };

  return (
    <BottomSheet onClose={onClose} title={isNew ? "Новий приз" : "Редагування"}>
      <div className="space-y-3">
        <div>
          <label className="block text-[11px] font-black uppercase text-zinc-500 mb-1">Назва</label>
          <input data-testid="prize-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} className="w-full h-11 px-3 rounded-xl bg-[#0A0A0A] border-2 border-white/10 text-white focus:border-[#FFB800] outline-none" />
        </div>
        <div>
          <label className="block text-[11px] font-black uppercase text-zinc-500 mb-1">Опис</label>
          <textarea rows={2} data-testid="prize-description" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} className="w-full px-3 py-2 rounded-xl bg-[#0A0A0A] border-2 border-white/10 text-white focus:border-[#FFB800] outline-none resize-none" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-black uppercase text-zinc-500 mb-1">Ціна</label>
            <input data-testid="prize-price" type="number" value={f.price} onChange={(e) => setF({ ...f, price: parseInt(e.target.value) || 0 })} className="w-full h-11 px-3 rounded-xl bg-[#0A0A0A] border-2 border-white/10 text-white focus:border-[#FFB800] outline-none" />
          </div>
          <div>
            <label className="block text-[11px] font-black uppercase text-zinc-500 mb-1">Категорія</label>
            <select data-testid="prize-category" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} className="w-full h-11 px-3 rounded-xl bg-[#0A0A0A] border-2 border-white/10 text-white focus:border-[#FFB800] outline-none">
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-black uppercase text-zinc-500 mb-1">Іконка</label>
            <input data-testid="prize-icon" value={f.icon} onChange={(e) => setF({ ...f, icon: e.target.value })} className="w-full h-11 px-3 rounded-xl bg-[#0A0A0A] border-2 border-white/10 text-white focus:border-[#FFB800] outline-none" />
          </div>
          <div>
            <label className="block text-[11px] font-black uppercase text-zinc-500 mb-1">Залишок</label>
            <input data-testid="prize-stock" type="number" value={f.stock} onChange={(e) => setF({ ...f, stock: parseInt(e.target.value) || 0 })} className="w-full h-11 px-3 rounded-xl bg-[#0A0A0A] border-2 border-white/10 text-white focus:border-[#FFB800] outline-none" />
          </div>
        </div>
        <div>
          <label className="block text-[11px] font-black uppercase text-zinc-500 mb-1">URL зображення (необов'язково)</label>
          <input data-testid="prize-image" value={f.image} onChange={(e) => setF({ ...f, image: e.target.value })} placeholder="https://..." className="w-full h-11 px-3 rounded-xl bg-[#0A0A0A] border-2 border-white/10 text-white focus:border-[#FFB800] outline-none" />
        </div>
        <label className="flex items-center gap-2 mt-2">
          <input data-testid="prize-active" type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} className="w-5 h-5 accent-[#FFB800]" />
          <span className="text-white text-sm font-black">Активний</span>
        </label>
      </div>
      <button data-testid="prize-save" onClick={save} disabled={busy} className="arcade-btn w-full h-12 mt-4 bg-[#FFB800] border-[#7a5900] text-[#0A0A0A] font-black text-sm uppercase tracking-wider disabled:opacity-60">
        {busy ? "..." : "Зберегти"}
      </button>
    </BottomSheet>
  );
};

// ─────────────── Orders admin ───────────────
const OrdersView = () => {
  const [orders, setOrders] = useState([]);
  const load = async () => {
    try {
      const { data } = await api.get("/admin/orders");
      setOrders(data);
    } catch (e) { toast.error(extractError(e)); }
  };
  useEffect(() => { load(); }, []);

  const setStatus = async (o, status) => {
    try {
      await api.patch(`/admin/orders/${o.id}`, { status });
      toast.success("Статус оновлено");
      load();
    } catch (e) { toast.error(extractError(e)); }
  };

  const STATUS_STYLES = {
    processing: { label: "в обробці", color: "#FFB800" },
    ready: { label: "готово", color: "#39FF14" },
    delivered: { label: "видано", color: "#00F0FF" },
    cancelled: { label: "скасовано", color: "#FF3B30" },
  };

  return (
    <div className="space-y-3" data-testid="orders-view">
      {orders.length === 0 && <div className="text-zinc-500 text-sm py-8 text-center">Замовлень немає</div>}
      {orders.map((o) => {
        const st = STATUS_STYLES[o.status] || STATUS_STYLES.processing;
        return (
          <div key={o.id} data-testid={`admin-order-${o.id}`} className="bg-[#1A1A1E] border border-white/10 rounded-2xl p-3">
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-white font-black text-sm truncate">{o.prize_title}</div>
                <div className="text-zinc-500 text-xs truncate">{o.user_name} • {new Date(o.created_at).toLocaleString("uk-UA")}</div>
              </div>
              <div className="text-[10px] font-black uppercase px-2 py-1 rounded-full" style={{ backgroundColor: st.color + "22", color: st.color }}>
                {st.label}
              </div>
            </div>
            <div className="grid grid-cols-4 gap-1.5 mt-3">
              {Object.entries(STATUS_STYLES).map(([s, style]) => (
                <button
                  key={s}
                  data-testid={`order-status-${o.id}-${s}`}
                  onClick={() => setStatus(o, s)}
                  className={`h-8 rounded-lg text-[9px] font-black uppercase tracking-wider border ${
                    o.status === s ? "border-transparent text-[#0A0A0A]" : "border-white/10 text-zinc-400"
                  }`}
                  style={{ backgroundColor: o.status === s ? style.color : "transparent" }}
                >
                  {style.label}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ─────────────── Shared bottom sheet ───────────────
const BottomSheet = ({ children, onClose, title }) => (
  <div className="fixed inset-0 z-50 flex items-end justify-center">
    <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
    <div className="relative w-full max-w-[480px] bg-[#1A1A1E] border-t border-white/10 rounded-t-3xl p-6 pb-24 max-h-[90vh] overflow-y-auto" style={{ animation: "slide-in-right 300ms ease-out" }}>
      <div className="flex justify-center mb-4">
        <div className="w-12 h-1.5 rounded-full bg-white/20" />
      </div>
      {title && <div className="font-display text-xl text-white mb-3">{title}</div>}
      <button
        onClick={onClose}
        data-testid="sheet-close"
        className="absolute top-5 right-5 w-9 h-9 rounded-full bg-[#0A0A0A] border border-white/10 flex items-center justify-center text-zinc-400"
        aria-label="Закрити"
      >
        <X size={16} strokeWidth={3} />
      </button>
      {children}
    </div>
  </div>
);

// ─────────────── Moderation: pending user approvals ───────────────
const ModerationView = () => {
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try { const { data } = await api.get("/admin/users/pending"); setPending(data); }
    catch (e) { toast.error(extractError(e)); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const approve = async (u) => {
    try { await api.post(`/admin/users/${u.id}/approve`); toast.success(`${u.name} підтверджено`); load(); }
    catch (e) { toast.error(extractError(e)); }
  };
  const reject = async (u) => {
    if (!window.confirm(`Відхилити та видалити заявку ${u.name}?`)) return;
    try { await api.delete(`/admin/users/${u.id}`); toast.success("Відхилено"); load(); }
    catch (e) { toast.error(extractError(e)); }
  };

  return (
    <div className="space-y-3" data-testid="moderation-view">
      {loading && <div className="text-zinc-500 text-sm py-6 text-center">Завантаження...</div>}
      {!loading && pending.length === 0 && (
        <div className="text-center text-zinc-500 py-10 text-sm font-black">Немає заявок на підтвердження 🎉</div>
      )}
      {pending.map((u) => (
        <div key={u.id} data-testid={`pending-user-${u.id}`} className="bg-[#1A1A1E] border-2 border-[#FFB800]/30 rounded-2xl p-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center font-display text-sm text-[#0A0A0A] shrink-0" style={{ backgroundColor: u.avatar_color }}>{u.avatar_initials || "?"}</div>
            <div className="flex-1 min-w-0">
              <div className="text-white font-black text-sm truncate">{u.name}</div>
              <div className="text-zinc-500 text-xs truncate">{u.email}</div>
              <div className="text-[10px] text-zinc-600 mt-0.5 truncate">
                {u.position}{u.team_name && <span className="text-[#00F0FF]"> • {u.team_name}</span>}{u.phone && <span> • {u.phone}</span>}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-3">
            <button data-testid={`reject-user-${u.id}`} onClick={() => reject(u)} className="arcade-btn h-10 bg-[#FF3B30] border-[#7a1c17] text-white font-black text-[11px] uppercase tracking-wider flex items-center justify-center gap-1.5">
              <X size={14} strokeWidth={3} /> Відхилити
            </button>
            <button data-testid={`approve-user-${u.id}`} onClick={() => approve(u)} className="arcade-btn h-10 bg-[#39FF14] border-[#1a7a0a] text-[#0A0A0A] font-black text-[11px] uppercase tracking-wider flex items-center justify-center gap-1.5">
              <Check size={14} strokeWidth={3} /> Підтвердити
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};

// ─────────────── Applications moderation ───────────────
const fileUrl = (u) => (u?.startsWith("http") ? u : `${API_BASE.replace(/\/api$/, "")}${u}`);

const ApplicationsView = () => {
  const [apps, setApps] = useState([]);
  const [filter, setFilter] = useState("submitted");
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const q = filter === "all" ? "" : `?status=${filter}`;
      const { data } = await api.get(`/admin/applications${q}`);
      setApps(data);
    } catch (e) { toast.error(extractError(e)); }
    setLoading(false);
  };
  useEffect(() => { load(); }, [filter]);

  const FILTERS = [
    { v: "submitted", l: "Нові" }, { v: "pending_review", l: "На перевірці" },
    { v: "approved", l: "Підтверджені" }, { v: "rejected", l: "Відхилені" }, { v: "all", l: "Всі" },
  ];

  return (
    <div className="space-y-3" data-testid="applications-view">
      <div className="flex gap-2 overflow-x-auto -mx-5 px-5 pb-1">
        {FILTERS.map((f) => (
          <button key={f.v} data-testid={`app-filter-${f.v}`} onClick={() => setFilter(f.v)}
            className={`shrink-0 h-9 px-3 rounded-full font-black text-[11px] uppercase tracking-wider border-2 ${filter === f.v ? "bg-[#FFB800] border-[#FFB800] text-[#0A0A0A]" : "bg-[#1A1A1E] border-white/10 text-zinc-400"}`}>
            {f.l}
          </button>
        ))}
      </div>

      {loading && <div className="text-zinc-500 text-sm py-6 text-center">Завантаження...</div>}
      {!loading && apps.length === 0 && <div className="text-center text-zinc-500 py-10 text-sm font-black">Немає заявок</div>}

      {apps.map((a) => {
        const st = APP_STATUS[a.status] || APP_STATUS.submitted;
        return (
          <button key={a.id} data-testid={`admin-app-${a.id}`} onClick={() => setDetail(a)} className="w-full text-left bg-[#1A1A1E] border border-white/10 rounded-2xl p-3 active:scale-[0.98] transition-transform">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center font-display text-xs text-[#0A0A0A] shrink-0" style={{ backgroundColor: a.avatar_color }}>{a.avatar_initials || "?"}</div>
              <div className="flex-1 min-w-0">
                <div className="text-white font-black text-sm truncate">{a.task_title}</div>
                <div className="text-zinc-500 text-xs truncate">{a.user_name} • {new Date(a.submitted_at || a.updated_at).toLocaleString("uk-UA")}</div>
              </div>
              <span className="text-[9px] font-black uppercase px-2 py-1 rounded-full shrink-0" style={{ backgroundColor: st.color + "22", color: st.color }}>{st.label}</span>
            </div>
          </button>
        );
      })}

      {detail && <ApplicationDetailSheet app={detail} onClose={() => setDetail(null)} onDone={() => { setDetail(null); load(); }} />}
    </div>
  );
};

const ApplicationDetailSheet = ({ app, onClose, onDone }) => {
  const [task, setTask] = useState(null);
  const [reason, setReason] = useState(app.review_reason || "");
  const [busy, setBusy] = useState(false);
  const isOpen = app.status === "submitted" || app.status === "pending_review";

  useEffect(() => {
    api.get(`/tasks/${app.task_id}`).then((r) => setTask(r.data)).catch(() => setTask(null));
    if (app.status === "submitted") api.patch(`/admin/applications/${app.id}/start`).catch(() => {});
  }, [app.id, app.task_id, app.status]);

  const review = async (action) => {
    if (action === "reject" && !reason.trim()) { toast.error("Вкажи причину відхилення"); return; }
    setBusy(true);
    try {
      await api.post(`/admin/applications/${app.id}/review`, { action, reason });
      toast.success(action === "approve" ? "Заявку підтверджено" : "Заявку відхилено");
      onDone();
    } catch (e) { toast.error(extractError(e)); }
    setBusy(false);
  };

  const renderValue = (f) => {
    const v = app.values?.[f.key];
    if (v === undefined || v === null || v === "") return <span className="text-zinc-600">—</span>;
    if (["photo", "photos", "video", "file"].includes(f.type)) {
      const arr = Array.isArray(v) ? v : [v];
      return (
        <div className="grid grid-cols-3 gap-2 mt-1">
          {arr.map((u, i) => (
            <a key={i} href={fileUrl(u)} target="_blank" rel="noreferrer" className="block aspect-square rounded-lg overflow-hidden border border-white/10 bg-[#0A0A0A]">
              {f.type === "video" ? <video src={fileUrl(u)} className="w-full h-full object-cover" />
                : f.type === "file" ? <div className="w-full h-full flex items-center justify-center"><FileText size={20} className="text-[#00F0FF]" /></div>
                : <img src={fileUrl(u)} alt="" className="w-full h-full object-cover" />}
            </a>
          ))}
        </div>
      );
    }
    if (f.type === "checkbox") return <span className={v ? "text-[#39FF14]" : "text-zinc-500"}>{v ? "Так" : "Ні"}</span>;
    return <span className="text-white">{String(v)}</span>;
  };

  return (
    <BottomSheet onClose={onClose} title={app.task_title}>
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center font-display text-[10px] text-[#0A0A0A]" style={{ backgroundColor: app.avatar_color }}>{app.avatar_initials}</div>
        <span className="text-white font-black text-sm">{app.user_name}</span>
        <span className="text-[#FFB800] text-xs font-black ml-auto">+{app.reward} • +{app.xp}XP</span>
      </div>

      <div className="space-y-3">
        {(task?.fields || []).map((f) => (
          <div key={f.key} className="bg-[#0A0A0A] border border-white/10 rounded-xl p-3">
            <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1">{f.label}</div>
            <div className="text-sm">{renderValue(f)}</div>
          </div>
        ))}
        {!task && <div className="text-zinc-500 text-xs">Завантаження полів...</div>}
      </div>

      {isOpen ? (
        <>
          <label className="block text-[11px] font-black uppercase text-zinc-500 mt-4 mb-1">Причина (для відхилення)</label>
          <textarea data-testid="review-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Що потрібно виправити..." className="w-full px-3 py-2 rounded-xl bg-[#0A0A0A] border-2 border-white/10 text-white focus:border-[#FFB800] outline-none resize-none" />
          <div className="grid grid-cols-2 gap-3 mt-4">
            <button data-testid="review-reject" onClick={() => review("reject")} disabled={busy} className="arcade-btn h-12 bg-[#FF3B30] border-[#7a1c17] text-white font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-60">
              <XCircle size={16} strokeWidth={3} /> Відхилити
            </button>
            <button data-testid="review-approve" onClick={() => review("approve")} disabled={busy} className="arcade-btn h-12 bg-[#39FF14] border-[#1a7a0a] text-[#0A0A0A] font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-60">
              <CheckCircle2 size={16} strokeWidth={3} /> Підтвердити
            </button>
          </div>
        </>
      ) : (
        <div className="mt-4 p-3 rounded-xl border-2" style={{ borderColor: (APP_STATUS[app.status]?.color || "#666") + "55" }}>
          <div className="text-xs font-black uppercase" style={{ color: APP_STATUS[app.status]?.color }}>{APP_STATUS[app.status]?.label}</div>
          {app.review_reason && <div className="text-white text-sm mt-1">{app.review_reason}</div>}
        </div>
      )}
    </BottomSheet>
  );
};

// ─────────────── Task constructor ───────────────
const TasksAdminView = () => {
  const [tasks, setTasks] = useState([]);
  const [editing, setEditing] = useState(null);

  const load = async () => {
    try { const { data } = await api.get("/admin/tasks"); setTasks(data); }
    catch (e) { toast.error(extractError(e)); }
  };
  useEffect(() => { load(); }, []);

  const del = async (t) => {
    if (!window.confirm(`Видалити завдання "${t.title}"?`)) return;
    try { await api.delete(`/admin/tasks/${t.id}`); toast.success("Видалено"); load(); }
    catch (e) { toast.error(extractError(e)); }
  };

  return (
    <div className="space-y-3" data-testid="tasks-admin-view">
      <button data-testid="btn-create-task" onClick={() => setEditing({})} className="arcade-btn w-full h-11 bg-[#FFB800] border-[#7a5900] text-[#0A0A0A] font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2">
        <Plus size={16} strokeWidth={3} /> Новий конструктор завдання
      </button>
      {tasks.map((t) => (
        <div key={t.id} data-testid={`admin-task-${t.id}`} className={`bg-[#1A1A1E] border rounded-2xl p-3 flex items-center gap-3 ${t.active ? "border-white/10" : "border-white/5 opacity-50"}`}>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-[#00F0FF] text-[#0A0A0A]">{(TASK_CATS.find((c) => c.v === t.category) || {}).l || t.category}</span>
              <span className="text-[#FFB800] font-black text-xs">+{t.reward}</span>
              <span className="text-[#39FF14] font-black text-xs">+{t.xp}XP</span>
              {!t.active && <span className="text-[9px] font-black text-zinc-500">ВИМКНЕНО</span>}
            </div>
            <div className="text-white font-black text-sm truncate mt-1">{t.title}</div>
            <div className="text-zinc-500 text-xs truncate">{t.fields?.length || 0} полів</div>
          </div>
          <div className="flex gap-1.5 shrink-0">
            <button data-testid={`edit-task-${t.id}`} onClick={() => setEditing(t)} className="w-9 h-9 rounded-xl bg-[#0A0A0A] border border-white/10 text-white flex items-center justify-center active:scale-95"><Pencil size={14} strokeWidth={3} /></button>
            <button data-testid={`delete-task-${t.id}`} onClick={() => del(t)} className="w-9 h-9 rounded-xl bg-[#0A0A0A] border border-[#FF3B30]/40 text-[#FF3B30] flex items-center justify-center active:scale-95"><Trash2 size={14} strokeWidth={3} /></button>
          </div>
        </div>
      ))}
      {editing !== null && <TaskEditor task={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
};

const TaskEditor = ({ task, onClose, onSaved }) => {
  const isNew = !task.id;
  const [f, setF] = useState({
    title: task.title || "", description: task.description || "", category: task.category || "general",
    icon: task.icon || "clipboard-list", reward: task.reward ?? 100, xp: task.xp ?? 50,
    active: task.active ?? true, fields: task.fields ? [...task.fields] : [],
  });
  const [busy, setBusy] = useState(false);

  const addField = () => setF((s) => ({ ...s, fields: [...s.fields, { key: `field_${s.fields.length + 1}`, label: "Нове поле", type: "text", required: false, placeholder: "", options: [] }] }));
  const updateField = (i, patch) => setF((s) => ({ ...s, fields: s.fields.map((fl, idx) => (idx === i ? { ...fl, ...patch } : fl)) }));
  const removeField = (i) => setF((s) => ({ ...s, fields: s.fields.filter((_, idx) => idx !== i) }));
  const moveField = (i, dir) => setF((s) => {
    const arr = [...s.fields]; const j = i + dir;
    if (j < 0 || j >= arr.length) return s;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    return { ...s, fields: arr };
  });

  const save = async () => {
    if (!f.title.trim()) { toast.error("Назва обов'язкова"); return; }
    for (const fl of f.fields) {
      if (!fl.key.trim() || !fl.label.trim()) { toast.error("У кожного поля має бути ключ і назва"); return; }
    }
    const keys = f.fields.map((x) => x.key);
    if (new Set(keys).size !== keys.length) { toast.error("Ключі полів мають бути унікальні"); return; }
    setBusy(true);
    try {
      const payload = {
        ...f,
        fields: f.fields.map((fl) => ({ ...fl, options: fl.type === "select" ? (fl.options || []) : [] })),
      };
      if (isNew) await api.post("/admin/tasks", payload);
      else await api.patch(`/admin/tasks/${task.id}`, payload);
      toast.success(isNew ? "Створено" : "Оновлено");
      onSaved();
    } catch (e) { toast.error(extractError(e)); }
    setBusy(false);
  };

  const inp = "w-full h-11 px-3 rounded-xl bg-[#0A0A0A] border-2 border-white/10 text-white focus:border-[#FFB800] outline-none";

  return (
    <BottomSheet onClose={onClose} title={isNew ? "Конструктор завдання" : "Редагування завдання"}>
      <div className="space-y-3">
        <div>
          <label className="block text-[11px] font-black uppercase text-zinc-500 mb-1">Назва</label>
          <input data-testid="task-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} className={inp} />
        </div>
        <div>
          <label className="block text-[11px] font-black uppercase text-zinc-500 mb-1">Опис</label>
          <textarea data-testid="task-description" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} className="w-full px-3 py-2 rounded-xl bg-[#0A0A0A] border-2 border-white/10 text-white focus:border-[#FFB800] outline-none resize-none" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-black uppercase text-zinc-500 mb-1">Категорія</label>
            <select data-testid="task-category" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} className={inp}>
              {TASK_CATS.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-black uppercase text-zinc-500 mb-1">Іконка</label>
            <select data-testid="task-icon" value={f.icon} onChange={(e) => setF({ ...f, icon: e.target.value })} className={inp}>
              {["clipboard-list", "camera", "clipboard-check", "video", "target"].map((i) => <option key={i} value={i}>{i}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-black uppercase text-zinc-500 mb-1">Бали</label>
            <input data-testid="task-reward" type="number" value={f.reward} onChange={(e) => setF({ ...f, reward: parseInt(e.target.value) || 0 })} className={inp} />
          </div>
          <div>
            <label className="block text-[11px] font-black uppercase text-zinc-500 mb-1">XP</label>
            <input data-testid="task-xp" type="number" value={f.xp} onChange={(e) => setF({ ...f, xp: parseInt(e.target.value) || 0 })} className={inp} />
          </div>
        </div>
        <label className="flex items-center gap-2">
          <input data-testid="task-active" type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} className="w-5 h-5 accent-[#FFB800]" />
          <span className="text-white text-sm font-black">Активне (одразу видно працівникам)</span>
        </label>

        <div className="pt-3 border-t border-white/10">
          <div className="flex items-center justify-between mb-2">
            <div className="text-white font-black text-sm uppercase tracking-wider">Поля форми</div>
            <button data-testid="add-field" onClick={addField} className="h-8 px-3 rounded-full bg-[#39FF14]/15 border-2 border-[#39FF14]/50 text-[#39FF14] font-black text-[11px] uppercase flex items-center gap-1 active:scale-95">
              <Plus size={13} strokeWidth={3} /> Поле
            </button>
          </div>
          <div className="space-y-3">
            {f.fields.map((fl, i) => (
              <div key={i} data-testid={`field-editor-${i}`} className="bg-[#0A0A0A] border-2 border-white/10 rounded-xl p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-zinc-500 text-[10px] font-black">#{i + 1}</span>
                  <div className="ml-auto flex gap-1">
                    <button onClick={() => moveField(i, -1)} className="w-7 h-7 rounded-lg bg-[#1A1A1E] border border-white/10 text-zinc-400 flex items-center justify-center"><ArrowUp size={12} strokeWidth={3} /></button>
                    <button onClick={() => moveField(i, 1)} className="w-7 h-7 rounded-lg bg-[#1A1A1E] border border-white/10 text-zinc-400 flex items-center justify-center"><ArrowDown size={12} strokeWidth={3} /></button>
                    <button data-testid={`remove-field-${i}`} onClick={() => removeField(i)} className="w-7 h-7 rounded-lg bg-[#1A1A1E] border border-[#FF3B30]/40 text-[#FF3B30] flex items-center justify-center"><Trash2 size={12} strokeWidth={3} /></button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input data-testid={`field-label-${i}`} value={fl.label} onChange={(e) => updateField(i, { label: e.target.value })} placeholder="Назва поля" className="h-10 px-2.5 rounded-lg bg-[#1A1A1E] border border-white/10 text-white text-sm focus:border-[#FFB800] outline-none" />
                  <input data-testid={`field-key-${i}`} value={fl.key} onChange={(e) => updateField(i, { key: e.target.value.replace(/\s/g, "_") })} placeholder="ключ (латиницею)" className="h-10 px-2.5 rounded-lg bg-[#1A1A1E] border border-white/10 text-white text-sm focus:border-[#FFB800] outline-none" />
                </div>
                <div className="grid grid-cols-2 gap-2 items-center">
                  <select data-testid={`field-type-${i}`} value={fl.type} onChange={(e) => updateField(i, { type: e.target.value })} className="h-10 px-2.5 rounded-lg bg-[#1A1A1E] border border-white/10 text-white text-sm focus:border-[#FFB800] outline-none">
                    {FIELD_TYPES.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
                  </select>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={fl.required} onChange={(e) => updateField(i, { required: e.target.checked })} className="w-4 h-4 accent-[#FF5C00]" />
                    <span className="text-zinc-300 text-xs font-black">Обов'язкове</span>
                  </label>
                </div>
                {fl.type === "select" && (
                  <input data-testid={`field-options-${i}`} value={(fl.options || []).join(", ")} onChange={(e) => updateField(i, { options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} placeholder="Варіанти через кому" className="w-full h-10 px-2.5 rounded-lg bg-[#1A1A1E] border border-white/10 text-white text-sm focus:border-[#FFB800] outline-none" />
                )}
              </div>
            ))}
            {f.fields.length === 0 && <div className="text-zinc-600 text-xs text-center py-3">Ще немає полів. Додай перше поле.</div>}
          </div>
        </div>
      </div>
      <button data-testid="task-save" onClick={save} disabled={busy} className="arcade-btn w-full h-12 mt-4 bg-[#FFB800] border-[#7a5900] text-[#0A0A0A] font-black text-sm uppercase tracking-wider disabled:opacity-60">
        {busy ? "..." : "Зберегти"}
      </button>
    </BottomSheet>
  );
};


// ─────────────── Personal goals manager ───────────────
const EMPTY_METRIC = { current: 0, target: 100, mode: "reach" };
const normalizeGoalForm = (g = {}) => ({
  credit: { ...EMPTY_METRIC, ...(g.credit || {}) },
  debit: { ...EMPTY_METRIC, ...(g.debit || {}) },
  deposit: { ...EMPTY_METRIC, ...(g.deposit || {}) },
  monthly_bonus_current: Number(g.monthly_bonus_current || 0),
  monthly_bonus_target: Number(g.monthly_bonus_target || 0),
  note: g.note || "",
});

const parseGoogleGoalNumber = (value) => {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const normalized = String(value)
    .replace(/\s/g, "")
    .replace(/%/g, "")
    .replace(/,/g, ".")
    .replace(/[^\d.-]/g, "");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const googleRowToGoalForm = (row = {}, fallback = {}) => normalizeGoalForm({
  ...fallback,
  credit: {
    current: parseGoogleGoalNumber(row.credit_actual ?? row.credit_current),
    target: parseGoogleGoalNumber(row.credit_target),
    mode: row.credit_mode || fallback?.credit?.mode || "reach",
  },
  debit: {
    current: parseGoogleGoalNumber(row.debit_actual ?? row.debit_current),
    target: parseGoogleGoalNumber(row.debit_target),
    mode: row.debit_mode || fallback?.debit?.mode || "reach",
  },
  deposit: {
    current: parseGoogleGoalNumber(row.deposit_actual ?? row.deposit_current),
    target: parseGoogleGoalNumber(row.deposit_target),
    mode: row.deposit_mode || fallback?.deposit?.mode || "reach",
  },
  monthly_bonus_current: parseGoogleGoalNumber(row.monthly_bonus_actual ?? row.monthly_bonus_current),
  monthly_bonus_target: parseGoogleGoalNumber(row.monthly_bonus_target),
  note: row.note ?? fallback?.note ?? "",
});

const GoalMetricEditor = ({ label, value, onChange, color }) => (
  <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
    <div className="mb-2 text-[10px] font-black uppercase tracking-widest" style={{ color }}>{label}</div>
    <div className="grid grid-cols-2 gap-2">
      <label className="text-[9px] font-black uppercase text-zinc-600">Поточний %
        <input type="number" min="0" step="0.1" value={value.current} onChange={(e) => onChange({ ...value, current: Number(e.target.value) })} className="mt-1 h-10 w-full rounded-xl border border-white/10 bg-[#121318] px-2 text-white outline-none focus:border-[#FFB800]" />
      </label>
      <label className="text-[9px] font-black uppercase text-zinc-600">Ціль %
        <input type="number" min="0" step="0.1" value={value.target} onChange={(e) => onChange({ ...value, target: Number(e.target.value) })} className="mt-1 h-10 w-full rounded-xl border border-white/10 bg-[#121318] px-2 text-white outline-none focus:border-[#FFB800]" />
      </label>
    </div>
    <select value={value.mode} onChange={(e) => onChange({ ...value, mode: e.target.value })} className="mt-2 h-10 w-full rounded-xl border border-white/10 bg-[#121318] px-2 text-xs font-black text-zinc-300 outline-none focus:border-[#FFB800]">
      <option value="reach">Підняти до цілі</option>
      <option value="maintain">Утримати не нижче</option>
    </select>
  </div>
);

const GoalsManager = () => {
  const [items, setItems] = useState([]);
  const [forms, setForms] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState({});
  const [search, setSearch] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const [{ data: dashboardData }, { data: adminUsersData }] = await Promise.all([
        api.get("/admin/goals-dashboard"),
        api.get("/admin/users"),
      ]);
      const dashboardUsers = dashboardData || [];
      const adminUsers = adminUsersData || [];
      const adminUsersById = Object.fromEntries(
        adminUsers.map((user) => [user.id, user])
      );
      const users = dashboardUsers.map((user) => {
        const fullUser = adminUsersById[user.id] || {};
        return {
          ...fullUser,
          ...user,
          goals_login:
            user.goals_login ||
            fullUser.goals_login ||
            fullUser.goalsLogin ||
            fullUser.login2 ||
            null,
        };
      });
      const token = getToken();

      const googleResponse = await fetch("/.netlify/functions/google-goals-admin", {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      });
      const googleData = await googleResponse.json().catch(() => null);

      if (!googleResponse.ok) {
        throw new Error(googleData?.error || "Не вдалося завантажити Google-цілі");
      }

      const byLogin = googleData?.goals_by_login || {};
      const merged = users.map((u) => {
        const key = String(u.goals_login || "").trim().toLowerCase();
        const googleRow = key ? byLogin[key] : null;
        const goals = googleRow ? googleRowToGoalForm(googleRow, u.goals) : normalizeGoalForm(u.goals);
        return { ...u, goals, google_synced: Boolean(googleRow) };
      });

      setItems(merged);
      setForms(Object.fromEntries(merged.map((u) => [u.id, normalizeGoalForm(u.goals)])));
    } catch (e) {
      toast.error(extractError(e, e?.message || "Не вдалося завантажити цілі"));
    }
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const save = async (u) => {
    setSaving((v) => ({ ...v, [u.id]: true }));
    try {
      const goalsLogin = String(u.goals_login || "").trim().toLowerCase();
      if (!goalsLogin) throw new Error(`Для ${u.name} не задано ключ Google Goals`);

      const token = getToken();
      const googleResponse = await fetch("/.netlify/functions/google-goals-admin", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ goals_login: goalsLogin, goals: forms[u.id] }),
        cache: "no-store",
      });
      const googleData = await googleResponse.json().catch(() => null);
      if (!googleResponse.ok) {
        throw new Error(googleData?.error || "Не вдалося оновити Google Таблицю");
      }

      const { data } = await api.put(`/admin/goals/${u.id}`, forms[u.id]);
      const refreshed = googleData?.goals ? googleRowToGoalForm(googleData.goals, data) : normalizeGoalForm(data);
      setItems((rows) => rows.map((row) => row.id === u.id ? { ...row, goals: refreshed, google_synced: true } : row));
      setForms((all) => ({ ...all, [u.id]: refreshed }));
      if (data.weekly_reward_just_awarded) toast.success(`${u.name}: Google оновлено, +200 Point та +100 XP`);
      else if (data.monthly_reward_just_awarded) toast.success(`${u.name}: Google оновлено, +1000 Point та +300 XP`);
      else toast.success(`Цілі ${u.name} синхронізовано з Google`);
    } catch (e) {
      toast.error(extractError(e, e?.message || "Не вдалося зберегти цілі"));
    }
    setSaving((v) => ({ ...v, [u.id]: false }));
  };

  const visible = items.filter((u) => u.name.toLowerCase().includes(search.toLowerCase()));
  if (loading) return <div className="py-10 text-center text-sm text-zinc-500">Завантаження цілей...</div>;
  return <div className="space-y-4" data-testid="admin-goals-view">
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatBox label="Операторів" value={items.length} />
      <StatBox label="Тиждень виконано" value={items.filter(x => x.goals?.weekly_complete).length} accent="#39FF14" />
      <StatBox label="Місяць виконано" value={items.filter(x => x.goals?.monthly_complete).length} accent="#FFB800" />
      <StatBox label="Потребують уваги" value={items.filter(x => !x.goals?.weekly_complete).length} accent="#FF5C00" />
    </div>
    <div className="relative"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600"/><input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Пошук оператора" className="h-12 w-full rounded-2xl border border-white/10 bg-[#1A1A1E] pl-10 pr-3 text-white outline-none focus:border-[#FFB800]"/></div>
    <div className="space-y-4">
      {visible.map((u) => {
        const f = forms[u.id] || normalizeGoalForm();
        const avatar = u.avatar_url ? (u.avatar_url.startsWith("http") ? u.avatar_url : `${API_BASE.replace(/\/api$/, "")}${u.avatar_url}`) : null;
        return <section key={u.id} className="rounded-3xl border border-white/10 bg-[#1A1A1E] p-4 lg:p-5">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl font-display text-sm text-black" style={{ backgroundColor: u.avatar_color || "#FFB800" }}>{avatar ? <img src={avatar} alt={u.name} className="h-full w-full scale-[1.22] object-cover"/> : u.avatar_initials || "?"}</div>
            <div className="min-w-0 flex-1"><div className="truncate font-black text-white">{u.name}</div><div className="truncate text-xs text-zinc-500">{u.position || u.department || "Оператор"}</div><div className={`mt-1 text-[9px] font-black uppercase ${u.google_synced ? "text-[#39FF14]" : "text-zinc-600"}`}>{u.goals_login ? (u.google_synced ? `Google: ${u.goals_login}` : `Ключ: ${u.goals_login} • рядок не знайдено`) : "Google-ключ не задано"}</div></div>
            <div className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${u.goals?.weekly_complete ? "bg-[#39FF14]/15 text-[#39FF14]" : "bg-[#FFB800]/10 text-[#FFB800]"}`}>{u.goals?.weekly_complete ? "3/3" : `${[u.goals?.credit,u.goals?.debit,u.goals?.deposit].filter(x=>x?.complete).length}/3`}</div>
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            <GoalMetricEditor label="Кредитний" value={f.credit} color="#FFB800" onChange={(v)=>setForms(all=>({...all,[u.id]:{...f,credit:v}}))}/>
            <GoalMetricEditor label="Дебетний" value={f.debit} color="#00F0FF" onChange={(v)=>setForms(all=>({...all,[u.id]:{...f,debit:v}}))}/>
            <GoalMetricEditor label="Депозитний" value={f.deposit} color="#39FF14" onChange={(v)=>setForms(all=>({...all,[u.id]:{...f,deposit:v}}))}/>
          </div>
          <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_1fr_2fr_auto]">
            <label className="text-[9px] font-black uppercase text-zinc-600">Поточний бонус, грн<input type="number" min="0" value={f.monthly_bonus_current} onChange={(e)=>setForms(all=>({...all,[u.id]:{...f,monthly_bonus_current:Number(e.target.value)}}))} className="mt-1 h-11 w-full rounded-xl border border-white/10 bg-[#121318] px-3 text-white outline-none focus:border-[#FFB800]"/></label>
            <label className="text-[9px] font-black uppercase text-zinc-600">Ціль бонусу, грн<input type="number" min="0" value={f.monthly_bonus_target} onChange={(e)=>setForms(all=>({...all,[u.id]:{...f,monthly_bonus_target:Number(e.target.value)}}))} className="mt-1 h-11 w-full rounded-xl border border-white/10 bg-[#121318] px-3 text-white outline-none focus:border-[#FFB800]"/></label>
            <label className="text-[9px] font-black uppercase text-zinc-600">Коментар<input value={f.note} onChange={(e)=>setForms(all=>({...all,[u.id]:{...f,note:e.target.value}}))} placeholder="Наприклад: фокус на депозитах" className="mt-1 h-11 w-full rounded-xl border border-white/10 bg-[#121318] px-3 text-white outline-none focus:border-[#FFB800]"/></label>
            <button onClick={()=>save(u)} disabled={saving[u.id]} className="arcade-btn mt-auto flex h-11 items-center justify-center gap-2 border-[#7a5900] bg-[#FFB800] px-5 text-xs font-black uppercase text-[#0A0A0A] disabled:opacity-50"><Save size={15}/>{saving[u.id] ? "..." : "Зберегти"}</button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-black uppercase"><span className="rounded-full bg-[#B78CFF]/10 px-2 py-1 text-[#B78CFF]">3 тижневі цілі = +200 Point • +100 XP</span><span className="rounded-full bg-[#FFB800]/10 px-2 py-1 text-[#FFB800]">Місячний бонус = +1000 Point • +300 XP</span></div>
        </section>;
      })}
    </div>
  </div>;
};

// ─────────────── Editor points manager ───────────────
const PointsManager = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adjustFor, setAdjustFor] = useState(null);
  const load = async () => {
    setLoading(true);
    try { setUsers((await api.get("/admin/users")).data); }
    catch (e) { toast.error(extractError(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);
  return <div className="space-y-3">
    {loading && <div className="py-8 text-center text-sm text-zinc-500">Завантаження...</div>}
    {users.map((u) => <div key={u.id} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-[#1A1A1E] p-3">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl font-display text-sm text-black" style={{backgroundColor:u.avatar_color||"#FFB800"}}>{u.avatar_initials||"?"}</div>
      <div className="min-w-0 flex-1"><div className="truncate text-sm font-black text-white">{u.name}</div><div className="text-xs text-zinc-500">Баланс: {u.balance.toLocaleString("uk-UA")} Point</div></div>
      <button type="button" onClick={() => setAdjustFor(u)} className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#FFB800]/40 bg-black/30 text-[#FFB800]" aria-label="Нарахувати бали"><Coins size={16}/></button>
    </div>)}
    {adjustFor && <AdjustPointsSheet user={adjustFor} onClose={() => setAdjustFor(null)} onDone={load}/>}
  </div>;
};


// ─────────────── Bonus Match level editor ───────────────
const BONUS_MATCH_OBSTACLE_STYLE = {
  ice: { label: "Крига", color: "#7DD3FC" },
  chain: { label: "Ланцюг", color: "#A1A1AA" },
  crate: { label: "Ящик", color: "#FDBA74" },
  stone: { label: "Камінь", color: "#D4D4D8" },
  crystal: { label: "Кристал", color: "#C084FC" },
  web: { label: "Павутина", color: "#E4E4E7" },
  shield: { label: "Щит", color: "#60A5FA" },
  slime: { label: "Слиз", color: "#4ADE80" },
  metal: { label: "Метал", color: "#CBD5E1" },
  core: { label: "Ядро", color: "#FF4D55" },
};

const BonusMatchLevelEditor = ({ level, obstacleCatalog, onClose, onSaved }) => {
  const isNew = Boolean(level?._new);
  const [f, setF] = useState({
    level: Number(level?.level || 1),
    title: level?.title || `Рівень ${level?.level || 1}`,
    moves: Number(level?.moves || 20),
    target_score: Number(level?.target_score || 2500),
    target_coins: Number(level?.target_coins || 10),
    star_thresholds: Array.isArray(level?.star_thresholds) && level.star_thresholds.length === 3
      ? level.star_thresholds.map(Number)
      : [2500, 3400, 4300],
    is_milestone: Boolean(level?.is_milestone),
    is_boss: Boolean(level?.is_boss),
    reward_multiplier: Number(level?.reward_multiplier || 1),
    obstacles: Array.isArray(level?.obstacles) ? level.obstacles : [],
    new_obstacle: level?.new_obstacle || "",
    obstacle_count: Number(level?.obstacle_count || 0),
    obstacle_layout: Array.isArray(level?.obstacle_layout) ? level.obstacle_layout : [],
    active: level?.active !== false,
  });
  const [paint, setPaint] = useState(obstacleCatalog?.[0]?.id || "ice");
  const [busy, setBusy] = useState(false);

  const setNumber = (key, value, min = 0) => setF((current) => ({
    ...current,
    [key]: Math.max(min, Number(value || 0)),
  }));

  const toggleAllowedObstacle = (id) => {
    setF((current) => ({
      ...current,
      obstacles: current.obstacles.includes(id)
        ? current.obstacles.filter((item) => item !== id)
        : [...current.obstacles, id],
    }));
  };

  const paintCell = (row, col) => {
    setF((current) => {
      const without = current.obstacle_layout.filter((item) => !(item.row === row && item.col === col));
      if (paint === "erase") return { ...current, obstacle_layout: without };
      const obstacle = obstacleCatalog.find((item) => item.id === paint);
      return {
        ...current,
        obstacle_layout: [
          ...without,
          { row, col, obstacle: paint, hits: Number(obstacle?.hits || 1) },
        ],
      };
    });
  };

  const layoutMap = new Map(f.obstacle_layout.map((item) => [`${item.row}:${item.col}`, item]));

  const save = async () => {
    if (!f.title.trim()) return toast.error("Вкажіть назву рівня");
    if (f.star_thresholds.some((value) => Number(value) < Number(f.target_score))) {
      return toast.error("Пороги зірок не можуть бути нижчими за цільовий рахунок");
    }
    setBusy(true);
    try {
      const payload = {
        ...f,
        star_thresholds: f.star_thresholds.map(Number),
        new_obstacle: f.new_obstacle || null,
      };
      if (isNew) await api.post("/admin/bonus-match/levels", payload);
      else await api.patch(`/admin/bonus-match/levels/${f.level}`, payload);
      toast.success(isNew ? "Рівень створено" : "Рівень оновлено");
      onSaved();
    } catch (error) {
      toast.error(extractError(error, "Не вдалося зберегти рівень"));
    } finally {
      setBusy(false);
    }
  };

  return <BottomSheet onClose={onClose} title={isNew ? "НОВИЙ РІВЕНЬ" : `РІВЕНЬ ${f.level}`}>
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        <label className="text-[9px] font-black uppercase text-zinc-600">Номер рівня
          <input type="number" min="1" max="200" disabled={!isNew} value={f.level} onChange={(e) => setNumber("level", e.target.value, 1)} className="mt-1 h-11 w-full rounded-xl border border-white/10 bg-[#121318] px-3 text-white outline-none disabled:opacity-50" />
        </label>
        <label className="text-[9px] font-black uppercase text-zinc-600">Кількість ходів
          <input type="number" min="5" max="80" value={f.moves} onChange={(e) => setNumber("moves", e.target.value, 5)} className="mt-1 h-11 w-full rounded-xl border border-white/10 bg-[#121318] px-3 text-white outline-none focus:border-[#B78CFF]" />
        </label>
      </div>

      <label className="block text-[9px] font-black uppercase text-zinc-600">Назва
        <input value={f.title} onChange={(e) => setF((current) => ({ ...current, title: e.target.value }))} className="mt-1 h-11 w-full rounded-xl border border-white/10 bg-[#121318] px-3 text-white outline-none focus:border-[#B78CFF]" />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="text-[9px] font-black uppercase text-zinc-600">Цільовий рахунок
          <input type="number" min="100" value={f.target_score} onChange={(e) => setNumber("target_score", e.target.value, 100)} className="mt-1 h-11 w-full rounded-xl border border-white/10 bg-[#121318] px-3 text-white outline-none focus:border-[#B78CFF]" />
        </label>
        <label className="text-[9px] font-black uppercase text-zinc-600">Ціль монет
          <input type="number" min="0" value={f.target_coins} onChange={(e) => setNumber("target_coins", e.target.value, 0)} className="mt-1 h-11 w-full rounded-xl border border-white/10 bg-[#121318] px-3 text-white outline-none focus:border-[#B78CFF]" />
        </label>
      </div>

      <div>
        <div className="text-[9px] font-black uppercase tracking-wider text-zinc-600">Пороги зірок</div>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {f.star_thresholds.map((value, index) => <label key={index} className="text-[9px] font-black text-zinc-500">{index + 1} ★
            <input type="number" min={f.target_score} value={value} onChange={(e) => setF((current) => ({ ...current, star_thresholds: current.star_thresholds.map((item, itemIndex) => itemIndex === index ? Number(e.target.value || 0) : item) }))} className="mt-1 h-10 w-full rounded-xl border border-white/10 bg-[#121318] px-2 text-xs text-white outline-none" />
          </label>)}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => setF((current) => ({ ...current, is_milestone: !current.is_milestone }))} className={`h-11 rounded-xl border text-[10px] font-black uppercase ${f.is_milestone ? "border-[#B78CFF] bg-[#B78CFF]/15 text-[#C9A7FF]" : "border-white/10 bg-black/20 text-zinc-500"}`}>РІВЕНЬ-ВИКЛИК</button>
        <button type="button" onClick={() => setF((current) => ({ ...current, is_boss: !current.is_boss }))} className={`h-11 rounded-xl border text-[10px] font-black uppercase ${f.is_boss ? "border-[#FF5C00] bg-[#FF5C00]/15 text-[#FF8A4C]" : "border-white/10 bg-black/20 text-zinc-500"}`}>БОС-РІВЕНЬ</button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="text-[9px] font-black uppercase text-zinc-600">Множник нагороди
          <input type="number" min="1" max="10" value={f.reward_multiplier} onChange={(e) => setNumber("reward_multiplier", e.target.value, 1)} className="mt-1 h-11 w-full rounded-xl border border-white/10 bg-[#121318] px-3 text-white outline-none" />
        </label>
        <label className="text-[9px] font-black uppercase text-zinc-600">Автоперешкод
          <input type="number" min="0" max="35" value={f.obstacle_count} onChange={(e) => setNumber("obstacle_count", e.target.value, 0)} className="mt-1 h-11 w-full rounded-xl border border-white/10 bg-[#121318] px-3 text-white outline-none" />
        </label>
      </div>

      <div>
        <div className="flex items-center justify-between gap-3">
          <div><div className="text-[10px] font-black uppercase text-white">ДОЗВОЛЕНІ ПЕРЕШКОДИ</div><div className="text-[9px] text-zinc-600">Використовуються для випадкового заповнення</div></div>
          <select value={f.new_obstacle} onChange={(e) => setF((current) => ({ ...current, new_obstacle: e.target.value }))} className="h-10 max-w-[150px] rounded-xl border border-white/10 bg-[#121318] px-2 text-[10px] font-black text-white">
            <option value="">Без нової</option>
            {obstacleCatalog.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {obstacleCatalog.map((item) => <button key={item.id} type="button" onClick={() => toggleAllowedObstacle(item.id)} className={`rounded-full border px-3 py-2 text-[9px] font-black uppercase ${f.obstacles.includes(item.id) ? "border-[#B78CFF] bg-[#B78CFF]/15 text-[#D8C1FF]" : "border-white/10 bg-black/20 text-zinc-500"}`}>{item.label}</button>)}
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
        <div className="flex items-start justify-between gap-3">
          <div><div className="text-[10px] font-black uppercase text-white">СХЕМА ПЕРЕШКОД 7×7</div><div className="mt-1 text-[9px] text-zinc-600">Якщо схема заповнена, вона має пріоритет над випадковою генерацією.</div></div>
          <div className="text-[10px] font-black text-[#B78CFF]">{f.obstacle_layout.length}/35</div>
        </div>
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          <button type="button" onClick={() => setPaint("erase")} className={`h-9 shrink-0 rounded-xl border px-3 text-[9px] font-black uppercase ${paint === "erase" ? "border-[#FF4D55] bg-[#FF4D55]/15 text-[#FF767C]" : "border-white/10 text-zinc-500"}`}>Гумка</button>
          {obstacleCatalog.map((item) => <button key={item.id} type="button" onClick={() => setPaint(item.id)} className={`h-9 shrink-0 rounded-xl border px-3 text-[9px] font-black uppercase ${paint === item.id ? "border-[#B78CFF] bg-[#B78CFF]/15 text-white" : "border-white/10 text-zinc-500"}`}>{item.label}</button>)}
        </div>
        <div className="mt-3 grid grid-cols-7 gap-1">
          {Array.from({ length: 49 }, (_, index) => {
            const row = Math.floor(index / 7);
            const col = index % 7;
            const item = layoutMap.get(`${row}:${col}`);
            const style = item ? BONUS_MATCH_OBSTACLE_STYLE[item.obstacle] : null;
            return <button key={index} type="button" onClick={() => paintCell(row, col)} className="relative aspect-square rounded-lg border border-white/10 bg-[#11101A] text-[8px] font-black" style={{ color: style?.color || "#3F3F46", background: item ? `${style?.color || "#B78CFF"}18` : undefined }} title={item ? `${style?.label}: ${item.hits} уд.` : "Порожньо"}>{item ? item.hits : "·"}</button>;
          })}
        </div>
      </div>

      <button type="button" onClick={() => setF((current) => ({ ...current, active: !current.active }))} className={`flex h-12 w-full items-center justify-center rounded-2xl border text-xs font-black uppercase ${f.active ? "border-[#39FF14]/40 bg-[#39FF14]/10 text-[#39FF14]" : "border-[#FF4D55]/40 bg-[#FF4D55]/10 text-[#FF686F]"}`}>{f.active ? "РІВЕНЬ АКТИВНИЙ" : "РІВЕНЬ ВИМКНЕНО"}</button>
      <button type="button" onClick={save} disabled={busy} className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#FFB800] text-xs font-black uppercase text-[#0A0A0A] disabled:opacity-50"><Save size={17} />{busy ? "ЗБЕРЕЖЕННЯ..." : "ЗБЕРЕГТИ РІВЕНЬ"}</button>
    </div>
  </BottomSheet>;
};

const BonusMatchLevelsView = () => {
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const response = await api.get("/admin/bonus-match/levels");
      setData(response.data);
    } catch (error) {
      toast.error(extractError(error, "Не вдалося завантажити рівні"));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const resetOrDelete = async (level) => {
    const isDefault = Number(level.level) <= Number(data?.default_level_count || 50);
    const message = isDefault
      ? `Скинути рівень ${level.level} до стандартних параметрів?`
      : `Видалити рівень ${level.level}?`;
    if (!window.confirm(message)) return;
    try {
      await api.delete(`/admin/bonus-match/levels/${level.level}`);
      toast.success(isDefault ? "Стандартні параметри відновлено" : "Рівень видалено");
      load();
    } catch (error) {
      toast.error(extractError(error));
    }
  };

  if (loading) return <div className="py-10 text-center text-sm font-black text-zinc-500">Завантаження рівнів…</div>;
  if (!data) return <div className="py-10 text-center text-sm font-black text-zinc-500">Немає даних</div>;
  const nextLevel = Math.min(data.level_limit, Math.max(...data.levels.map((item) => Number(item.level)), 0) + 1);

  return <div className="space-y-3" data-testid="bonus-match-levels-admin">
    <div className="rounded-2xl border border-[#B78CFF]/30 bg-[#B78CFF]/10 p-4">
      <div className="flex items-center gap-3"><Gamepad2 size={22} className="text-[#B78CFF]" /><div><div className="text-sm font-black uppercase text-white">РЕДАКТОР BONUS MATCH</div><div className="mt-1 text-[10px] text-zinc-500">Змінюй складність, цілі, ходи та точне розташування перешкод.</div></div></div>
    </div>
    <button type="button" onClick={() => setEditing({ _new: true, level: nextLevel, title: `Рівень ${nextLevel}`, moves: 18, target_score: 5000, target_coins: 15, star_thresholds: [5000, 6750, 8600], reward_multiplier: 1, obstacles: [], obstacle_layout: [], active: true })} className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#FFB800] text-xs font-black uppercase text-[#0A0A0A]"><Plus size={17} />СТВОРИТИ НОВИЙ РІВЕНЬ</button>

    <div className="space-y-2">
      {data.levels.map((level) => <div key={level.level} className={`rounded-2xl border p-3 ${level.active ? "border-white/10 bg-[#1A1A1E]" : "border-[#FF4D55]/20 bg-[#FF4D55]/[.04] opacity-70"}`}>
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[#B78CFF]/30 bg-[#B78CFF]/10 font-display text-xl text-[#C9A7FF]">{level.level}</div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5"><div className="truncate text-sm font-black text-white">{level.title || `Рівень ${level.level}`}</div>{level.is_boss && <span className="rounded-full bg-[#FF5C00]/15 px-2 py-0.5 text-[8px] font-black text-[#FF7D36]">БОС</span>}{level.custom && <span className="rounded-full bg-[#00F0FF]/10 px-2 py-0.5 text-[8px] font-black text-[#00F0FF]">ЗМІНЕНО</span>}</div>
            <div className="mt-1 text-[10px] font-bold text-zinc-500">{level.moves} ходів · {Number(level.target_score).toLocaleString("uk-UA")} очок · {level.target_coins} монет</div>
            <div className="mt-1 text-[9px] text-zinc-600">Перешкоди: {level.obstacle_layout?.length ? `схема ${level.obstacle_layout.length}` : level.obstacle_count ? `${level.obstacle_count} випадково` : "немає"} · нагорода ×{level.reward_multiplier}</div>
          </div>
          <div className="flex shrink-0 gap-1.5">
            <button type="button" onClick={() => setEditing(level)} className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-black/30 text-white"><Pencil size={14} /></button>
            <button type="button" onClick={() => resetOrDelete(level)} className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#FF4D55]/30 bg-[#FF4D55]/10 text-[#FF5B63]">{Number(level.level) <= data.default_level_count ? <RotateCcw size={14} /> : <Trash2 size={14} />}</button>
          </div>
        </div>
      </div>)}
    </div>

    {editing && <BonusMatchLevelEditor level={editing} obstacleCatalog={data.obstacles || []} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
  </div>;
};

// ─────────────── Admin page shell ───────────────
export default function Admin() {
  const { user, mode } = useApp();
  const isEditor = user?.role === "editor";
  const editorTabs = [
    { id: "daily-tasks", label: "Завдання дня", icon: CalendarDays },
    { id: "points", label: "Нарахувати бали", icon: Coins },
  ];
  const availableTabs = isEditor ? editorTabs : TABS;
  const [tab, setTab] = useState(user?.role === "editor" ? "daily-tasks" : "analytics");

  if (!user) return null;
  if (!["admin", "editor"].includes(user.role)) {
    return <div className="p-8 text-center text-zinc-400">Немає доступу до панелі</div>;
  }
  if (mode === "mock") {
    return (
      <div className="p-6 space-y-3">
        <div className="bg-[#FF5C00]/10 border border-[#FF5C00]/40 rounded-2xl px-4 py-3 text-[#FF5C00] font-black text-sm">
          Адмін-панель недоступна в офлайн-режимі. Запусти бекенд для доступу.
        </div>
      </div>
    );
  }

  const V = { analytics: AnalyticsView, "ai-team": AITeamDashboard, "daily-tasks": DailyTasksManager, points: PointsManager, goals: GoalsManager, moderation: ModerationView, applications: ApplicationsView, users: UsersView, teams: TeamsView, achievements: AchievementsView, "bonus-match": BonusMatchLevelsView, prizes: PrizesView, orders: OrdersView }[tab];

  return (
    <div className="px-5 pt-2 pb-8 lg:px-7 lg:pt-6" data-testid="admin-page">
      <div className="lg:grid lg:grid-cols-[230px_minmax(0,1fr)] lg:gap-7">
        <aside className="hidden lg:block">
          <div className="sticky top-28 overflow-hidden rounded-3xl border border-white/10 bg-[#121318] p-3">
            <div className="px-3 pb-4 pt-2">
              <div className="text-[9px] font-black uppercase tracking-[0.25em] text-zinc-600">Панель управління</div>
              <div className="mt-1 font-display text-2xl text-white">{isEditor ? "Редактор" : "Адміністратор"}</div>
            </div>
            <div className="space-y-1" data-testid="admin-desktop-tabs">
              {availableTabs.map((t) => {
                const Icon = t.icon;
                return (
                  <button
                    key={t.id}
                    data-testid={`admin-desktop-tab-${t.id}`}
                    onClick={() => setTab(t.id)}
                    className={`flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 text-left text-xs font-black uppercase tracking-wider transition-all ${tab === t.id ? "bg-[#FFB800] text-[#0A0A0A] shadow-lg shadow-[#FFB800]/10" : "text-zinc-400 hover:bg-white/5 hover:text-white"}`}
                  >
                    <Icon size={17} strokeWidth={3} />
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        <div className="min-w-0 space-y-4">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.25em] text-zinc-500">Панель управління</div>
            <h1 className="mt-1 font-display text-3xl text-white lg:text-4xl">{availableTabs.find((item) => item.id === tab)?.label || "Панель"}</h1>
          </div>

          <div className="flex flex-wrap gap-2 pb-1 lg:hidden" data-testid="admin-tabs">
            {availableTabs.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  data-testid={`admin-tab-${t.id}`}
                  onClick={() => setTab(t.id)}
                  className={`flex h-10 shrink-0 items-center gap-1.5 rounded-full border-2 px-3 text-[11px] font-black uppercase tracking-wider transition-colors ${
                    tab === t.id ? "border-[#FFB800] bg-[#FFB800] text-[#0A0A0A]" : "border-white/10 bg-[#1A1A1E] text-zinc-400"
                  }`}
                >
                  <Icon size={14} strokeWidth={3} />
                  {t.label}
                </button>
              );
            })}
          </div>

          <V />
        </div>
      </div>
    </div>
  );
}
