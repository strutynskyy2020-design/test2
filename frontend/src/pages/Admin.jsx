import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Users, Swords, Gift, ShoppingBag, BarChart3, Plus, Pencil, Trash2, X, Minus, Check, Coins, Trophy, ChevronRight,
  UserCog, ShieldCheck, Crown, UsersRound, Inbox, UserCheck, ClipboardList, CheckCircle2, XCircle,
  ArrowUp, ArrowDown, FileText,
} from "lucide-react";
import api, { extractError, API_BASE } from "@/lib/api";
import { useApp } from "@/context/AppContext";

const TABS = [
  { id: "analytics", label: "Огляд", icon: BarChart3 },
  { id: "moderation", label: "Модерація", icon: UserCheck },
  { id: "applications", label: "Заявки", icon: Inbox },
  { id: "tasks", label: "Завдання", icon: ClipboardList },
  { id: "users", label: "Юзери", icon: Users },
  { id: "teams", label: "Команди", icon: UsersRound },
  { id: "quests", label: "Квести", icon: Swords },
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
const CATEGORIES = ["merch", "privilege", "certificate"];

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

// ─────────────── Users ───────────────
const UsersView = () => {
  const [users, setUsers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adjustFor, setAdjustFor] = useState(null);
  const [editFor, setEditFor] = useState(null);
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
              {u.role === "admin" && <span className="text-[#FF5C00] text-[10px]">[admin]</span>}
              {u.is_team_leader && <Crown size={12} strokeWidth={3} className="text-[#FFB800]" />}
              {!u.approved && <span className="text-[#FF3B30] text-[9px] font-black">PENDING</span>}
            </div>
            <div className="text-zinc-500 text-xs truncate">{u.email}</div>
            <div className="text-[10px] text-zinc-600 mt-0.5 flex items-center gap-2">
              <span>LVL {u.level} • {u.balance.toLocaleString("uk-UA")} б.</span>
              {u.team_name && <span className="text-[#00F0FF] truncate">{u.team_name}</span>}
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
      {editFor && <UserEditSheet user={editFor} teams={teams} onClose={() => setEditFor(null)} onDone={load} />}
      {showCreate && <CreateUserSheet onClose={() => setShowCreate(false)} onDone={load} />}
    </div>
  );
};

const UserEditSheet = ({ user, teams, onClose, onDone }) => {
  const [f, setF] = useState({
    first_name: user.first_name || "",
    last_name: user.last_name || "",
    phone: user.phone || "",
    telegram: user.telegram || "",
    department: user.department || "",
    position: user.position || "Оператор",
    team_id: user.team_id || "",
    is_team_leader: !!user.is_team_leader,
    approved: user.approved !== false,
  });
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const payload = { ...f };
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

// ─────────────── Admin page shell ───────────────
export default function Admin() {
  const { user, mode } = useApp();
  const [tab, setTab] = useState("analytics");

  if (!user) return null;
  if (user.role !== "admin") {
    return <div className="p-8 text-center text-zinc-400">Доступ тільки для адміністраторів</div>;
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

  const V = { analytics: AnalyticsView, moderation: ModerationView, applications: ApplicationsView, tasks: TasksAdminView, users: UsersView, teams: TeamsView, quests: QuestsView, prizes: PrizesView, orders: OrdersView }[tab];

  return (
    <div className="px-5 pt-2 pb-8 space-y-4" data-testid="admin-page">
      <div>
        <div className="text-[10px] font-black uppercase tracking-[0.25em] text-zinc-500">Панель управління</div>
        <h1 className="font-display text-3xl text-white mt-1">Адмін</h1>
      </div>

      <div className="flex gap-2 overflow-x-auto -mx-5 px-5 pb-1" data-testid="admin-tabs">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              data-testid={`admin-tab-${t.id}`}
              onClick={() => setTab(t.id)}
              className={`shrink-0 h-10 px-3 rounded-full font-black text-[11px] uppercase tracking-wider transition-colors border-2 flex items-center gap-1.5 ${
                tab === t.id ? "bg-[#FFB800] border-[#FFB800] text-[#0A0A0A]" : "bg-[#1A1A1E] border-white/10 text-zinc-400"
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
  );
}
