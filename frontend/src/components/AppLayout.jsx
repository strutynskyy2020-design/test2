import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Home, ClipboardList, Gift, LogOut, Shield, Trophy, UsersRound, Bot, Target } from "lucide-react";
import { useEffect } from "react";
import { useApp } from "@/context/AppContext";
import api from "@/lib/api";
import InstallPrompt from "@/components/InstallPrompt";
import NotificationBell from "@/components/NotificationBell";

const PAGE_LABELS = {
  "/": "Головна",
  "/tasks": "Завдання",
  "/quests": "Квести",
  "/teams": "Команди",
  "/ai-trainer": "AI-тренажер",
  "/goals": "Цілі",
  "/goals/credit": "Кредитний рейтинг",
  "/goals/credit/me": "Мої кредитні показники",
  "/goals/debit": "Дебетовий рейтинг",
  "/goals/debit/me": "Мої дебетові видачі",
  "/store": "Магазин",
  "/leaderboard": "Загальний рейтинг",
  "/fun": "Щедрий куб",
  "/history": "Історія Point",
  "/feed": "Стрічка активності",
};

const getPageLabel = (pathname, search) => {
  const base = PAGE_LABELS[pathname] || pathname;
  const params = new URLSearchParams(search || "");
  if (pathname === "/goals/debit/me") {
    return `${base} · ${params.get("period") === "yesterday" ? "Вчора" : "Місяць"}`;
  }
  if (pathname === "/goals/credit/me") {
    const channel = params.get("channel");
    const channelLabel = { xsell: "X-Sell", web_apps: "Web Apps", inb: "INB" }[channel] || "Показники";
    const periodLabel = params.get("period") === "yesterday" ? "Вчора" : "Місяць";
    return `${base} · ${channelLabel} · ${periodLabel}`;
  }
  return base;
};

const NavItem = ({ to, icon: Icon, label, testId, exact = true }) => (
  <NavLink
    to={to}
    data-testid={testId}
    end={exact}
    className={({ isActive }) =>
      `flex flex-col items-center justify-center gap-1 flex-1 min-w-0 h-full transition-transform active:scale-95 ${
        isActive ? "text-[#FFB800]" : "text-zinc-500"
      }`
    }
  >
    {({ isActive }) => (
      <>
        <div
          className={`w-10 h-10 rounded-2xl flex items-center justify-center transition-colors ${
            isActive ? "bg-[#FFB800]/15" : "bg-transparent"
          }`}
        >
          <Icon strokeWidth={isActive ? 3 : 2.5} size={20} />
        </div>
        {isActive && (
          <span className="text-[9px] font-black uppercase tracking-wider truncate max-w-full px-0.5">
            {label}
          </span>
        )}
      </>
    )}
  </NavLink>
);

export default function AppLayout() {
  const { user, logout } = useApp();
  const nav = useNavigate();
  const loc = useLocation();

  useEffect(() => {
    if (!user) nav("/login", { replace: true });
  }, [user, nav]);

  useEffect(() => {
    if (!user || loc.pathname.startsWith("/admin")) return;
    const path = `${loc.pathname}${loc.search || ""}`;
    const now = Date.now();
    const previous = sessionStorage.getItem("tm6-last-page-view") || "";
    const [previousPath, previousTime] = previous.split("|");
    if (previousPath === path && now - Number(previousTime || 0) < 2000) return;
    sessionStorage.setItem("tm6-last-page-view", `${path}|${now}`);
    let sessionId = sessionStorage.getItem("tm6-usage-session-id");
    if (!sessionId) {
      sessionId = `${now}-${Math.random().toString(36).slice(2, 10)}`;
      sessionStorage.setItem("tm6-usage-session-id", sessionId);
    }
    api.post("/analytics/page-view", {
      path,
      label: getPageLabel(loc.pathname, loc.search),
      session_id: sessionId,
    }).catch(() => {});
  }, [user?.id, loc.pathname, loc.search]);

  if (!user) return null;
  const isAdmin = ["admin", "editor"].includes(user.role);
  const isAdminRoute = loc.pathname.startsWith("/admin");

  return (
    <div className="min-h-screen w-full flex justify-center">
      <div
        className={`relative w-full min-h-screen flex flex-col bg-[#0A0A0A] border-x border-white/5 ${isAdminRoute ? "app-shell app-shell-admin" : "app-shell"}`}
        style={{ maxWidth: isAdminRoute ? "1500px" : "480px" }}
      >
        <header
          className="sticky top-0 z-30 bg-[#0A0A0A]/95 backdrop-blur-sm border-b border-white/5 px-5 pb-4 flex items-center justify-between"
          style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 14px)", minHeight: "calc(74px + env(safe-area-inset-top, 0px))" }}
        >
          <div className="min-w-0">
            <div className="font-display text-[22px] text-white leading-none tracking-tight whitespace-nowrap">
              TM6 <span className="text-[#FFB800]">BONUS</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <NotificationBell />
            <button
              data-testid="nav-teams"
              onClick={() => nav("/teams")}
              className="w-12 h-12 touch-manipulation rounded-2xl bg-[#1A1A1E] border border-white/10 flex items-center justify-center text-[#00F0FF] active:scale-95 transition-transform"
              aria-label="Команди"
            >
              <UsersRound size={18} strokeWidth={2.5} />
            </button>
            {isAdmin && (
              <button
                data-testid="nav-admin"
                onClick={() => nav("/admin")}
                className="w-12 h-12 touch-manipulation rounded-2xl bg-[#FF5C00]/15 border-2 border-[#FF5C00]/60 flex items-center justify-center text-[#FF5C00] active:scale-95 transition-transform"
                aria-label="Адмін-панель"
              >
                <Shield size={18} strokeWidth={3} />
              </button>
            )}
            <button
              data-testid="logout-btn"
              onClick={() => { logout(); nav("/login"); }}
              className="w-12 h-12 touch-manipulation rounded-2xl bg-[#1A1A1E] border border-white/10 flex items-center justify-center text-zinc-400 active:scale-95 transition-transform"
              aria-label="Вийти"
            >
              <LogOut size={18} strokeWidth={2.5} />
            </button>
          </div>
        </header>

        <main key={loc.pathname} className="flex-1 pb-28 page-enter" data-testid="main-content">
          <Outlet />
        </main>

        <InstallPrompt />

        <nav
          data-testid="bottom-nav"
          className={`fixed bottom-0 left-1/2 -translate-x-1/2 w-full bg-[#0A0A0A] border-t border-white/10 items-stretch z-40 px-1 max-w-[480px] flex ${isAdminRoute ? "admin-bottom-nav" : ""}`}
          style={{ height: "5rem", paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <NavItem to="/" icon={Home} label="Головна" testId="nav-home" />
          <NavItem to="/tasks" icon={ClipboardList} label="Квести" testId="nav-tasks" />
          <NavItem to="/goals" icon={Target} label="Цілі" testId="nav-goals" exact={false} />
          <NavItem to="/ai-trainer" icon={Bot} label="AI" testId="nav-ai-trainer" />
          <NavItem to="/store" icon={Gift} label="Магазин" testId="nav-store" />
          <NavItem to="/leaderboard" icon={Trophy} label="Рейтинг" testId="nav-board" />
        </nav>
      </div>
    </div>
  );
}
