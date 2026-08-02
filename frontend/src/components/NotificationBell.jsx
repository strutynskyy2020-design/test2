import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bell, CheckCircle2, XCircle, ClipboardList, Inbox, PartyPopper, UserPlus, X, CheckCheck,
  Award, Coins, Gift, MessageSquare, BarChart3, Gamepad2, Grid3X3, TrendingUp, TrendingDown,
  Sunrise, Settings2, Smartphone, Send, ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import api, { extractError } from "@/lib/api";
import {
  getCurrentPushSubscription,
  pushIsSupported,
  subscribeToPush,
  unsubscribeFromPush,
} from "@/lib/pushNotifications";

const ICONS = {
  "check-circle-2": { Icon: CheckCircle2, color: "#22C55E" },
  "x-circle": { Icon: XCircle, color: "#EF4444" },
  "clipboard-list": { Icon: ClipboardList, color: "#F59E0B" },
  inbox: { Icon: Inbox, color: "#0891B2" },
  "party-popper": { Icon: PartyPopper, color: "#22C55E" },
  "user-plus": { Icon: UserPlus, color: "#8B5CF6" },
  award: { Icon: Award, color: "#F59E0B" },
  coins: { Icon: Coins, color: "#F59E0B" },
  gift: { Icon: Gift, color: "#EC4899" },
  "message-square": { Icon: MessageSquare, color: "#8B5CF6" },
  "bar-chart-3": { Icon: BarChart3, color: "#0891B2" },
  "gamepad-2": { Icon: Gamepad2, color: "#8B5CF6" },
  "grid-3x3": { Icon: Grid3X3, color: "#7C3AED" },
  "trending-up": { Icon: TrendingUp, color: "#22C55E" },
  "trending-down": { Icon: TrendingDown, color: "#F97316" },
  sunrise: { Icon: Sunrise, color: "#F59E0B" },
  bell: { Icon: Bell, color: "#F59E0B" },
};

const PREFS = [
  ["points", "Нові бали"],
  ["achievements", "Досягнення"],
  ["prizes", "Нові призи"],
  ["orders", "Статуси замовлень"],
  ["manager_messages", "Повідомлення керівника"],
  ["reports", "Оновлення звітів"],
  ["games", "Нові рівні ігор"],
  ["ranking", "Зміни в рейтингу"],
  ["scheduled_reminders", "Робочі нагадування 09:00 / 12:00 / 15:00 / 17:00"],
];

const timeAgo = (iso) => {
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (seconds < 60) return "щойно";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} хв тому`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} год тому`;
  return `${Math.floor(seconds / 86400)} дн тому`;
};

const Toggle = ({ checked, onChange, disabled = false }) => (
  <button
    type="button"
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={`relative h-7 w-12 shrink-0 rounded-full border transition-colors disabled:opacity-40 ${checked ? "border-[#8B5CF6] bg-[#8B5CF6]" : "border-zinc-300 bg-zinc-200 dark:border-white/10 dark:bg-black/40"}`}
    aria-pressed={checked}
  >
    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-5" : "translate-x-0.5"}`} />
  </button>
);

export default function NotificationBell() {
  const nav = useNavigate();
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [tab, setTab] = useState("all");
  const [loading, setLoading] = useState(false);
  const [preferences, setPreferences] = useState(null);
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const timer = useRef(null);

  const loadCount = useCallback(async () => {
    try {
      const { data } = await api.get("/notifications/unread_count");
      setCount(data.count || 0);
    } catch (_) { /* silent badge refresh */ }
  }, []);

  useEffect(() => {
    loadCount();
    timer.current = window.setInterval(loadCount, 60_000);
    const onVisible = () => document.visibilityState === "visible" && loadCount();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer.current);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [loadCount]);

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/notifications?limit=100");
      setItems(Array.isArray(data) ? data : []);
    } catch (_) {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPushSettings = useCallback(async () => {
    try {
      const [prefs, subscription] = await Promise.all([
        api.get("/push/preferences").then((response) => response.data),
        getCurrentPushSubscription().catch(() => null),
      ]);
      setPreferences(prefs);
      setPushSubscribed(Boolean(subscription));
    } catch (_) {
      setPreferences(null);
      setPushSubscribed(false);
    }
  }, []);

  const openPanel = async () => {
    setOpen(true);
    setTab("all");
    await Promise.all([loadItems(), loadPushSettings()]);
  };

  const markAll = async () => {
    try {
      await api.post("/notifications/read-all");
      setItems((current) => current.map((notification) => ({ ...notification, read: true })));
      setCount(0);
    } catch (error) {
      toast.error(extractError(error, "Не вдалося позначити сповіщення"));
    }
  };

  const openItem = async (notification) => {
    if (!notification.read) {
      try { await api.patch(`/notifications/${notification.id}/read`); } catch (_) { /* navigation still works */ }
      setItems((current) => current.map((item) => (item.id === notification.id ? { ...item, read: true } : item)));
      setCount((current) => Math.max(0, current - 1));
    }
    setOpen(false);
    if (notification.link) nav(notification.link);
  };

  const togglePush = async () => {
    setPushBusy(true);
    try {
      if (pushSubscribed) {
        await unsubscribeFromPush();
        setPushSubscribed(false);
        toast.success("Push-сповіщення вимкнено на цьому пристрої");
      } else {
        await subscribeToPush();
        setPushSubscribed(true);
        toast.success("Push-сповіщення увімкнено");
      }
      await loadPushSettings();
    } catch (error) {
      toast.error(error?.message || "Не вдалося змінити Push-налаштування");
    } finally {
      setPushBusy(false);
    }
  };

  const changePreference = async (key, value) => {
    if (!preferences) return;
    const previous = preferences;
    const next = { ...preferences, [key]: value };
    setPreferences(next);
    try {
      const payload = Object.fromEntries([
        "push_enabled", ...PREFS.map(([name]) => name),
      ].map((name) => [name, Boolean(next[name])]));
      await api.put("/push/preferences", payload);
    } catch (error) {
      setPreferences(previous);
      toast.error(extractError(error, "Не вдалося зберегти налаштування"));
    }
  };

  const testPush = async () => {
    setPushBusy(true);
    try {
      await api.post("/push/test");
      toast.success("Тестове сповіщення надіслано");
    } catch (error) {
      toast.error(extractError(error, "Не вдалося надіслати тест"));
    } finally {
      setPushBusy(false);
    }
  };

  const shownItems = useMemo(
    () => (tab === "unread" ? items.filter((item) => !item.read) : items),
    [items, tab],
  );

  return (
    <>
      <button
        data-testid="notif-bell"
        onClick={openPanel}
        className="app-header-action relative flex h-12 w-12 touch-manipulation items-center justify-center rounded-2xl text-zinc-600 transition-transform active:scale-95 dark:text-zinc-300 max-[370px]:h-10 max-[370px]:w-10"
        aria-label="Центр сповіщень"
      >
        <Bell size={18} strokeWidth={2.5} />
        {count > 0 && (
          <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-white bg-[#EF4444] px-1 text-[10px] font-black text-white dark:border-[#0A0A0A]">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center" data-testid="notif-panel">
          <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div
            className="relative mx-3 flex max-h-[80vh] w-full max-w-[500px] flex-col overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-2xl dark:border-white/10 dark:bg-[#1A1A1E]"
            style={{ marginTop: "calc(env(safe-area-inset-top, 0px) + 72px)" }}
          >
            <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-white/10">
              <div>
                <div className="font-display text-lg text-[#1F2330] dark:text-white">Центр сповіщень</div>
                <div className="text-[10px] font-bold text-zinc-500">Події, нагороди та робочі нагадування</div>
              </div>
              <div className="flex items-center gap-2">
                {tab !== "settings" && (
                  <button onClick={markAll} className="flex items-center gap-1 text-[10px] font-black uppercase text-[#6D28D9] dark:text-[#B78CFF]">
                    <CheckCheck size={14} strokeWidth={3} /> Всі
                  </button>
                )}
                <button onClick={() => setOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-white/10 dark:bg-black/30 dark:text-zinc-400" aria-label="Закрити">
                  <X size={14} strokeWidth={3} />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-1 border-b border-zinc-200 bg-zinc-50 p-2 dark:border-white/10 dark:bg-black/20">
              {[
                ["all", "Усі", Bell],
                ["unread", `Нові${count ? ` · ${count}` : ""}`, Inbox],
                ["settings", "Push", Settings2],
              ].map(([id, label, Icon]) => (
                <button key={id} onClick={() => setTab(id)} className={`flex h-9 items-center justify-center gap-1 rounded-xl text-[10px] font-black uppercase ${tab === id ? "bg-[#8B5CF6] text-white" : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-white/5"}`}>
                  <Icon size={13} strokeWidth={2.8} />{label}
                </button>
              ))}
            </div>

            {tab !== "settings" ? (
              <div className="flex-1 divide-y divide-zinc-100 overflow-y-auto dark:divide-white/5">
                {loading && <div className="py-12 text-center text-sm font-black text-zinc-500">Завантаження…</div>}
                {!loading && shownItems.length === 0 && <div className="py-12 text-center text-sm font-black text-zinc-500">Немає сповіщень</div>}
                {shownItems.map((notification) => {
                  const conf = ICONS[notification.icon] || ICONS.bell;
                  const Icon = conf.Icon;
                  return (
                    <button
                      key={notification.id}
                      onClick={() => openItem(notification)}
                      className={`flex w-full items-start gap-3 px-5 py-3.5 text-left transition-colors active:bg-zinc-100 dark:active:bg-white/5 ${notification.read ? "opacity-55" : ""}`}
                    >
                      <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: `${conf.color}18`, border: `1.5px solid ${conf.color}55` }}>
                        <Icon size={18} strokeWidth={2.75} color={conf.color} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-sm font-black leading-tight text-[#242735] dark:text-white">
                          <span>{notification.title}</span>
                          {!notification.read && <span className="h-2 w-2 shrink-0 rounded-full bg-[#EF4444]" />}
                        </div>
                        {notification.body && <div className="mt-0.5 line-clamp-3 text-xs text-zinc-600 dark:text-zinc-400">{notification.body}</div>}
                        <div className="mt-1 text-[10px] font-black uppercase text-zinc-400 dark:text-zinc-600">{timeAgo(notification.created_at)}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="flex-1 space-y-4 overflow-y-auto p-4">
                <section className="rounded-2xl border border-[#8B5CF6]/25 bg-[#8B5CF6]/8 p-4 dark:bg-[#8B5CF6]/10">
                  <div className="flex items-start gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#8B5CF6] text-white"><Smartphone size={21} /></div>
                    <div className="min-w-0 flex-1">
                      <div className="font-black text-[#242735] dark:text-white">Push на цьому пристрої</div>
                      <div className="mt-1 text-[11px] leading-4 text-zinc-600 dark:text-zinc-400">
                        Сповіщення працюють навіть коли PWA закрита. Дозвіл браузера запитується лише після натискання кнопки.
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={pushBusy || !pushIsSupported()}
                    onClick={togglePush}
                    className={`mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl text-xs font-black uppercase text-white disabled:opacity-50 ${pushSubscribed ? "bg-[#EF4444]" : "bg-[#8B5CF6]"}`}
                  >
                    {pushSubscribed ? <XCircle size={17} /> : <ShieldCheck size={17} />}
                    {pushSubscribed ? "Вимкнути Push" : "Увімкнути Push"}
                  </button>
                  {!pushIsSupported() && <div className="mt-2 text-center text-[10px] font-bold text-[#EF4444]">Браузер не підтримує Web Push або сторінка відкрита без HTTPS.</div>}
                  {pushSubscribed && (
                    <button type="button" disabled={pushBusy} onClick={testPush} className="mt-2 flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-zinc-200 text-[10px] font-black uppercase text-zinc-700 dark:border-white/10 dark:text-zinc-300">
                      <Send size={14} /> Надіслати тест
                    </button>
                  )}
                </section>

                <section className="overflow-hidden rounded-2xl border border-zinc-200 dark:border-white/10">
                  <div className="border-b border-zinc-200 px-4 py-3 text-[10px] font-black uppercase tracking-wider text-zinc-500 dark:border-white/10">Які Push надсилати</div>
                  <div className="divide-y divide-zinc-100 dark:divide-white/5">
                    {PREFS.map(([key, label]) => (
                      <div key={key} className="flex items-center justify-between gap-3 px-4 py-3">
                        <div className="text-xs font-bold leading-4 text-[#303442] dark:text-zinc-200">{label}</div>
                        <Toggle checked={Boolean(preferences?.[key])} onChange={(value) => changePreference(key, value)} disabled={!preferences} />
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
