import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ClipboardList, Camera, ClipboardCheck, Video, Target, Coins, Zap, X, Send, Save,
  FileText, ChevronRight, Clock, CheckCircle2, XCircle, Loader2, Swords, Trash2, Pencil,
} from "lucide-react";
import { toast } from "sonner";
import api, { extractError } from "@/lib/api";
import { useApp } from "@/context/AppContext";
import { fireConfetti } from "@/lib/confetti";
import TaskFormField from "@/components/TaskFormField";

const TASK_ICONS = { "clipboard-list": ClipboardList, camera: Camera, "clipboard-check": ClipboardCheck, video: Video, target: Target };

const CAT = {
  sales: { label: "Продажі", color: "#FFB800" },
  support: { label: "Підтримка", color: "#00F0FF" },
  quality: { label: "Якість", color: "#39FF14" },
  training: { label: "Навчання", color: "#B78CFF" },
  discipline: { label: "Дисципліна", color: "#FF5C00" },
  general: { label: "Загальне", color: "#A1A1AA" },
};

export const STATUS = {
  draft: { label: "Чернетка", color: "#A1A1AA", Icon: FileText },
  submitted: { label: "Надіслано", color: "#00F0FF", Icon: Send },
  pending_review: { label: "На перевірці", color: "#FFB800", Icon: Clock },
  approved: { label: "Підтверджено", color: "#39FF14", Icon: CheckCircle2 },
  rejected: { label: "Відхилено", color: "#FF3B30", Icon: XCircle },
};

const StatusPill = ({ status }) => {
  const s = STATUS[status] || STATUS.draft;
  const Icon = s.Icon;
  return (
    <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider px-2 py-1 rounded-full" style={{ backgroundColor: s.color + "22", color: s.color }}>
      <Icon size={11} strokeWidth={3} /> {s.label}
    </span>
  );
};

const TaskCard = ({ task, onOpen }) => {
  const Icon = TASK_ICONS[task.icon] || ClipboardList;
  const cat = CAT[task.category] || CAT.general;
  return (
    <button
      data-testid={`task-${task.id}`}
      onClick={() => onOpen(task)}
      className="w-full text-left bg-[#1A1A1E] border-2 border-white/10 rounded-3xl p-4 active:scale-[0.98] transition-transform hover:border-[#FFB800]/40"
    >
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0" style={{ backgroundColor: cat.color + "22", border: `2px solid ${cat.color}` }}>
          <Icon size={22} strokeWidth={2.75} color={cat.color} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full text-[#0A0A0A]" style={{ backgroundColor: cat.color }}>{cat.label}</span>
          </div>
          <div className="text-white font-black text-sm leading-tight">{task.title}</div>
          {task.description && <div className="text-zinc-500 text-xs mt-0.5 line-clamp-2">{task.description}</div>}
        </div>
        <ChevronRight size={18} className="text-zinc-600 shrink-0 mt-1" />
      </div>
      <div className="flex items-center gap-4 mt-3 pt-3 border-t border-white/5">
        <div className="flex items-center gap-1 text-[#FFB800] font-black text-sm"><Coins size={14} strokeWidth={3} /> +{task.reward}</div>
        <div className="flex items-center gap-1 text-[#39FF14] font-black text-sm"><Zap size={14} strokeWidth={3} /> +{task.xp} XP</div>
        <div className="ml-auto text-zinc-600 text-[11px] font-black">{task.fields?.length || 0} полів</div>
      </div>
    </button>
  );
};

const TaskSheet = ({ task, existing, onClose, onDone }) => {
  const [values, setValues] = useState(existing?.values || {});
  const [busy, setBusy] = useState(false);

  const setVal = (key, v) => setValues((s) => ({ ...s, [key]: v }));

  const validate = () => {
    for (const f of task.fields || []) {
      if (!f.required) continue;
      const v = values[f.key];
      const empty = v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0) || (f.type === "checkbox" && !v);
      if (empty) { toast.error(`Заповни поле: ${f.label}`); return false; }
    }
    return true;
  };

  const submit = async (asDraft) => {
    if (!asDraft && !validate()) return;
    setBusy(true);
    try {
      if (existing && (existing.status === "draft" || existing.status === "rejected")) {
        await api.patch(`/applications/${existing.id}`, { values, submit: !asDraft });
      } else {
        await api.post("/applications", { task_id: task.id, values, submit: !asDraft });
      }
      if (!asDraft) { fireConfetti(); toast.success("Заявку надіслано на перевірку!"); }
      else toast.success("Чернетку збережено");
      onDone();
      onClose();
    } catch (e) {
      toast.error(extractError(e, "Помилка"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" data-testid="task-sheet">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-[480px] bg-[#1A1A1E] border-t border-white/10 rounded-t-3xl p-6 pb-28 max-h-[92vh] overflow-y-auto" style={{ animation: "slide-in-right 300ms ease-out" }}>
        <div className="flex justify-center mb-4"><div className="w-12 h-1.5 rounded-full bg-white/20" /></div>
        <button onClick={onClose} className="absolute top-5 right-5 w-9 h-9 rounded-full bg-[#0A0A0A] border border-white/10 flex items-center justify-center text-zinc-400" aria-label="Закрити"><X size={16} strokeWidth={3} /></button>

        <h2 className="font-display text-2xl text-white pr-10">{task.title}</h2>
        {task.description && <p className="text-zinc-400 text-sm mt-1">{task.description}</p>}
        <div className="flex items-center gap-3 mt-3 mb-5">
          <div className="flex items-center gap-1 text-[#FFB800] font-black"><Coins size={16} strokeWidth={3} /> +{task.reward}</div>
          <div className="flex items-center gap-1 text-[#39FF14] font-black"><Zap size={16} strokeWidth={3} /> +{task.xp} XP</div>
        </div>

        {existing?.status === "rejected" && existing.review_reason && (
          <div className="bg-[#FF3B30]/10 border-2 border-[#FF3B30]/40 rounded-2xl p-3 mb-4">
            <div className="text-[#FF3B30] font-black text-xs uppercase tracking-wider mb-1">Причина відхилення</div>
            <div className="text-white text-sm">{existing.review_reason}</div>
          </div>
        )}

        <div className="space-y-4">
          {(task.fields || []).map((f) => (
            <TaskFormField key={f.key} field={f} value={values[f.key]} onChange={(v) => setVal(f.key, v)} />
          ))}
          {(task.fields || []).length === 0 && <div className="text-zinc-500 text-sm text-center py-4">Це завдання без додаткових полів — просто надішли заявку.</div>}
        </div>

        <div className="grid grid-cols-2 gap-3 mt-6">
          <button data-testid="task-save-draft" onClick={() => submit(true)} disabled={busy} className="arcade-btn h-12 bg-[#27272A] border-[#141416] text-white font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-60">
            <Save size={15} strokeWidth={3} /> Чернетка
          </button>
          <button data-testid="task-submit" onClick={() => submit(false)} disabled={busy} className="arcade-btn h-12 bg-[#39FF14] border-[#1a7a0a] text-[#0A0A0A] font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-60">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} strokeWidth={3} />} Надіслати
          </button>
        </div>
      </div>
    </div>
  );
};

const ApplicationCard = ({ app, task, onReopen, onDelete }) => {
  const cat = CAT[app.task_category] || CAT.general;
  const editable = app.status === "draft" || app.status === "rejected";
  return (
    <div data-testid={`application-${app.id}`} className="bg-[#1A1A1E] border-2 border-white/10 rounded-3xl p-4">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: cat.color + "22", border: `2px solid ${cat.color}` }}>
          <ClipboardList size={18} strokeWidth={2.75} color={cat.color} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-white font-black text-sm leading-tight">{app.task_title}</div>
          <div className="text-zinc-600 text-[11px] font-black mt-1">{new Date(app.updated_at).toLocaleString("uk-UA")}</div>
        </div>
        <StatusPill status={app.status} />
      </div>
      {app.status === "rejected" && app.review_reason && (
        <div className="mt-3 text-xs text-[#FF3B30] bg-[#FF3B30]/10 rounded-xl px-3 py-2 border border-[#FF3B30]/30">{app.review_reason}</div>
      )}
      {app.status === "approved" && (
        <div className="mt-3 flex items-center gap-3 text-xs font-black">
          <span className="text-[#FFB800]">+{app.reward} балів</span>
          <span className="text-[#39FF14]">+{app.xp} XP</span>
        </div>
      )}
      {editable && (
        <div className="flex gap-2 mt-3 pt-3 border-t border-white/5">
          <button data-testid={`reopen-${app.id}`} onClick={() => onReopen(app, task)} disabled={!task} className="flex-1 h-10 rounded-xl bg-[#0A0A0A] border-2 border-[#FFB800]/40 text-[#FFB800] font-black text-[11px] uppercase tracking-wider flex items-center justify-center gap-1.5 active:scale-95 disabled:opacity-40">
            <Pencil size={13} strokeWidth={3} /> {app.status === "rejected" ? "Виправити" : "Редагувати"}
          </button>
          <button data-testid={`delete-app-${app.id}`} onClick={() => onDelete(app)} className="w-10 h-10 rounded-xl bg-[#0A0A0A] border-2 border-[#FF3B30]/40 text-[#FF3B30] flex items-center justify-center active:scale-95">
            <Trash2 size={14} strokeWidth={3} />
          </button>
        </div>
      )}
    </div>
  );
};

export default function Tasks() {
  const { refreshMe } = useApp();
  const [tab, setTab] = useState("available");
  const [tasks, setTasks] = useState([]);
  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sheet, setSheet] = useState(null); // { task, existing }

  const load = async () => {
    setLoading(true);
    try {
      const [tR, aR] = await Promise.all([api.get("/tasks"), api.get("/applications")]);
      setTasks(tR.data || []);
      setApps(aR.data || []);
    } catch (e) { toast.error(extractError(e)); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const afterChange = async () => { await load(); await refreshMe?.(); };

  const reopen = (app, task) => setSheet({ task, existing: app });

  const deleteApp = async (app) => {
    if (!window.confirm("Видалити цю заявку?")) return;
    try { await api.delete(`/applications/${app.id}`); toast.success("Видалено"); load(); }
    catch (e) { toast.error(extractError(e)); }
  };

  const pendingCount = useMemo(() => apps.filter((a) => ["submitted", "pending_review"].includes(a.status)).length, [apps]);
  const taskById = useMemo(() => Object.fromEntries(tasks.map((t) => [t.id, t])), [tasks]);

  return (
    <div className="px-5 pt-2 pb-8 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.25em] text-zinc-500">Виконуй та заробляй</div>
          <h1 className="font-display text-3xl text-white mt-1">Завдання</h1>
        </div>
        <Link to="/quests" data-testid="link-daily-quests" className="h-10 px-3 rounded-full bg-[#1A1A1E] border-2 border-white/10 text-zinc-300 font-black text-[11px] uppercase tracking-wider flex items-center gap-1.5 active:scale-95">
          <Swords size={14} strokeWidth={3} className="text-[#FFB800]" /> Квести
        </Link>
      </div>

      <div className="flex gap-2 bg-[#1A1A1E] border border-white/10 rounded-2xl p-1.5">
        <button data-testid="tab-available" onClick={() => setTab("available")} className={`flex-1 h-10 rounded-xl font-black text-xs uppercase tracking-wider transition-colors ${tab === "available" ? "bg-[#FFB800] text-[#0A0A0A]" : "text-zinc-400"}`}>Доступні</button>
        <button data-testid="tab-applications" onClick={() => setTab("applications")} className={`flex-1 h-10 rounded-xl font-black text-xs uppercase tracking-wider transition-colors flex items-center justify-center gap-1.5 ${tab === "applications" ? "bg-[#FFB800] text-[#0A0A0A]" : "text-zinc-400"}`}>
          Мої заявки
          {pendingCount > 0 && <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-[#FF5C00] text-white text-[10px] flex items-center justify-center">{pendingCount}</span>}
        </button>
      </div>

      {loading && <div className="text-zinc-500 text-sm py-8 text-center font-black">Завантаження...</div>}

      {!loading && tab === "available" && (
        <div className="space-y-3" data-testid="tasks-list">
          {tasks.length === 0 && <div className="text-center text-zinc-500 py-10 text-sm font-black">Немає активних завдань. Загляни пізніше!</div>}
          {tasks.map((t) => <TaskCard key={t.id} task={t} onOpen={(task) => setSheet({ task, existing: null })} />)}
        </div>
      )}

      {!loading && tab === "applications" && (
        <div className="space-y-3" data-testid="applications-list">
          {apps.length === 0 && <div className="text-center text-zinc-500 py-10 text-sm font-black">Ти ще не подавав жодної заявки</div>}
          {apps.map((a) => <ApplicationCard key={a.id} app={a} task={taskById[a.task_id]} onReopen={reopen} onDelete={deleteApp} />)}
        </div>
      )}

      {sheet && <TaskSheet task={sheet.task} existing={sheet.existing} onClose={() => setSheet(null)} onDone={afterChange} />}
    </div>
  );
}
