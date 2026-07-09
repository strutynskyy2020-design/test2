import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bell, CheckCircle2, XCircle, ClipboardList, Inbox, PartyPopper, UserPlus, X, CheckCheck,
} from "lucide-react";
import api from "@/lib/api";

const ICONS = {
  "check-circle-2": { Icon: CheckCircle2, color: "#39FF14" },
  "x-circle": { Icon: XCircle, color: "#FF3B30" },
  "clipboard-list": { Icon: ClipboardList, color: "#FFB800" },
  inbox: { Icon: Inbox, color: "#00F0FF" },
  "party-popper": { Icon: PartyPopper, color: "#39FF14" },
  "user-plus": { Icon: UserPlus, color: "#B78CFF" },
  bell: { Icon: Bell, color: "#FFB800" },
};

const timeAgo = (iso) => {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "щойно";
  if (s < 3600) return `${Math.floor(s / 60)} хв тому`;
  if (s < 86400) return `${Math.floor(s / 3600)} год тому`;
  return `${Math.floor(s / 86400)} дн тому`;
};

export default function NotificationBell() {
  const nav = useNavigate();
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const timer = useRef(null);

  const loadCount = useCallback(async () => {
    try {
      const { data } = await api.get("/notifications/unread_count");
      setCount(data.count || 0);
    } catch (e) { /* ignore */ }
  }, []);

  useEffect(() => {
    loadCount();
    timer.current = setInterval(loadCount, 20000);
    return () => clearInterval(timer.current);
  }, [loadCount]);

  const openPanel = async () => {
    setOpen(true);
    try {
      const { data } = await api.get("/notifications?limit=40");
      setItems(data || []);
    } catch (e) { setItems([]); }
  };

  const markAll = async () => {
    try {
      await api.post("/notifications/read-all");
      setItems((s) => s.map((n) => ({ ...n, read: true })));
      setCount(0);
    } catch (e) { /* ignore */ }
  };

  const openItem = async (n) => {
    if (!n.read) {
      try { await api.patch(`/notifications/${n.id}/read`); } catch (e) { /* ignore */ }
      setItems((s) => s.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      setCount((c) => Math.max(0, c - 1));
    }
    setOpen(false);
    if (n.link) nav(n.link);
  };

  return (
    <>
      <button
        data-testid="notif-bell"
        onClick={openPanel}
        className="relative w-11 h-11 rounded-2xl bg-[#1A1A1E] border border-white/10 flex items-center justify-center text-zinc-300 active:scale-95 transition-transform"
        aria-label="Сповіщення"
      >
        <Bell size={18} strokeWidth={2.5} />
        {count > 0 && (
          <span
            data-testid="notif-badge"
            className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#FF3B30] text-white text-[10px] font-black flex items-center justify-center border-2 border-[#0A0A0A]"
          >
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center" data-testid="notif-panel">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-[480px] mt-16 mx-3 bg-[#1A1A1E] border border-white/10 rounded-3xl overflow-hidden max-h-[75vh] flex flex-col" style={{ animation: "slide-in-right 250ms ease-out" }}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <div className="font-display text-lg text-white">Сповіщення</div>
              <div className="flex items-center gap-2">
                <button data-testid="notif-mark-all" onClick={markAll} className="text-[#00F0FF] text-[11px] font-black uppercase flex items-center gap-1 active:scale-95">
                  <CheckCheck size={14} strokeWidth={3} /> Всі
                </button>
                <button onClick={() => setOpen(false)} className="w-8 h-8 rounded-full bg-[#0A0A0A] border border-white/10 flex items-center justify-center text-zinc-400" aria-label="Закрити">
                  <X size={14} strokeWidth={3} />
                </button>
              </div>
            </div>
            <div className="overflow-y-auto flex-1 divide-y divide-white/5">
              {items.length === 0 && (
                <div className="text-center text-zinc-500 py-12 text-sm font-black">Немає сповіщень</div>
              )}
              {items.map((n) => {
                const conf = ICONS[n.icon] || ICONS.bell;
                const Icon = conf.Icon;
                return (
                  <button
                    key={n.id}
                    data-testid={`notif-item-${n.id}`}
                    onClick={() => openItem(n)}
                    className={`w-full flex items-start gap-3 px-5 py-3.5 text-left active:bg-white/5 transition-colors ${n.read ? "opacity-55" : ""}`}
                  >
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5" style={{ backgroundColor: conf.color + "22", border: `2px solid ${conf.color}` }}>
                      <Icon size={18} strokeWidth={2.75} color={conf.color} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-white font-black text-sm leading-tight flex items-center gap-2">
                        {n.title}
                        {!n.read && <span className="w-2 h-2 rounded-full bg-[#FF3B30] shrink-0" />}
                      </div>
                      {n.body && <div className="text-zinc-400 text-xs mt-0.5 line-clamp-2">{n.body}</div>}
                      <div className="text-zinc-600 text-[10px] font-black uppercase mt-1">{timeAgo(n.created_at)}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
