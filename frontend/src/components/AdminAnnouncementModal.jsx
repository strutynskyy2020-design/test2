import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Megaphone, Sparkles, X } from "lucide-react";
import api from "@/lib/api";

const localDismissedKey = (userId) => `vpdk_dismissed_admin_announcements_v140:${String(userId || "guest")}`;

const readLocalDismissed = (userId) => {
  if (typeof window === "undefined") return new Set();
  try {
    const value = JSON.parse(window.localStorage.getItem(localDismissedKey(userId)) || "[]");
    return new Set(Array.isArray(value) ? value.map(String) : []);
  } catch (_) {
    return new Set();
  }
};

const writeLocalDismissed = (userId, ids) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(localDismissedKey(userId), JSON.stringify([...ids].slice(-100)));
  } catch (_) {
    // Private browsing or restricted storage must not block the app.
  }
};

export default function AdminAnnouncementModal({ user }) {
  const [announcement, setAnnouncement] = useState(null);
  const [closing, setClosing] = useState(false);

  const loadPending = useCallback(async () => {
    if (!user?.id || user.role === "admin") {
      setAnnouncement(null);
      return;
    }
    try {
      // Local storage is only a fallback for a temporarily unavailable backend.
      // Reconcile locally dismissed ids first, then ask for the next unread item.
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const { data } = await api.get("/announcements/pending", {
          params: { _: Date.now() + attempt },
          headers: { "Cache-Control": "no-cache" },
        });
        if (!data?.id) {
          setAnnouncement(null);
          return;
        }
        const dismissed = readLocalDismissed(user.id);
        if (!dismissed.has(String(data.id))) {
          setAnnouncement(data);
          return;
        }
        try {
          await api.post(`/announcements/${data.id}/dismiss`);
        } catch (_) {
          setAnnouncement(null);
          return;
        }
      }
      setAnnouncement(null);
    } catch (_) {
      // Announcements are helpful, but never allowed to block app startup.
    }
  }, [user?.id, user?.role]);

  useEffect(() => {
    loadPending();
    const onFocus = () => loadPending();
    const onVisibility = () => {
      if (document.visibilityState === "visible") loadPending();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [loadPending]);

  const dismiss = async () => {
    if (!announcement?.id || closing) return;
    setClosing(true);
    const dismissed = readLocalDismissed(user.id);
    dismissed.add(String(announcement.id));
    writeLocalDismissed(user.id, dismissed);
    try {
      await api.post(`/announcements/${announcement.id}/dismiss`);
    } catch (_) {
      // The local marker prevents the same message from flashing again on this device.
    }
    setAnnouncement(null);
    setClosing(false);
    window.setTimeout(loadPending, 250);
  };

  if (!announcement) return null;

  return (
    <div className="admin-announcement-overlay fixed inset-0 z-[90] flex items-center justify-center px-5 py-8" role="presentation">
      <button
        type="button"
        aria-label="Закрити повідомлення"
        className="absolute inset-0 cursor-default bg-black/75 backdrop-blur-md"
        onClick={dismiss}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-announcement-title"
        className="admin-announcement-card relative z-10 w-full max-w-[430px] overflow-hidden rounded-[30px] border border-[#7DD3FC]/45 p-5 shadow-2xl"
        data-testid="admin-announcement-modal"
      >
        <div className="admin-announcement-orbit" aria-hidden="true" />
        <div className="relative z-10">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[#7DD3FC]/35 bg-[#7DD3FC]/10 text-[#7DD3FC]">
                <Megaphone size={22} strokeWidth={2.8} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.22em] text-[#7DD3FC]">
                  <Sparkles size={12} strokeWidth={3} /> Повідомлення адміністратора
                </div>
                <h2 id="admin-announcement-title" className="mt-1 font-display text-2xl leading-tight text-white">
                  {announcement.title}
                </h2>
              </div>
            </div>
            <button
              type="button"
              onClick={dismiss}
              disabled={closing}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-black/25 text-zinc-400 active:scale-95 disabled:opacity-50"
              aria-label="Закрити"
            >
              <X size={17} strokeWidth={3} />
            </button>
          </div>

          <div className="mt-5 whitespace-pre-wrap rounded-2xl border border-white/10 bg-black/20 px-4 py-4 text-sm font-bold leading-relaxed text-zinc-200">
            {announcement.message}
          </div>

          <button
            type="button"
            onClick={dismiss}
            disabled={closing}
            className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-[#7a5900] bg-[#FFB800] px-4 text-sm font-black uppercase tracking-wider text-[#0A0A0A] active:scale-[.99] disabled:opacity-60"
            data-testid="dismiss-admin-announcement"
          >
            <CheckCircle2 size={18} strokeWidth={3} /> {closing ? "Закриваємо…" : "Зрозуміло"}
          </button>
          <p className="mt-3 text-center text-[10px] font-bold text-zinc-500">
            Після закриття це повідомлення більше не зʼявиться у вашому профілі.
          </p>
        </div>
      </section>
    </div>
  );
}
