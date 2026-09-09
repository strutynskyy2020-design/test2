import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Home, ClipboardList, Gift, LogOut, Shield, Trophy, UsersRound, Cat, Target } from "lucide-react";
import { useEffect } from "react";
import { useApp } from "@/context/AppContext";
import api from "@/lib/api";
import InstallPrompt from "@/components/InstallPrompt";
import NotificationBell from "@/components/NotificationBell";
import AdminAnnouncementModal from "@/components/AdminAnnouncementModal";

const PAGE_LABELS = {
  "/": "Головна",
  "/profile": "Особистий кабінет",
  "/tasks": "Завдання",
  "/quests": "Квести",
  "/teams": "Команди",
  "/analytics": "Аналітика команди",
  "/pet": "Мій кіт",
  "/pet/room": "Мій кіт",
  "/pet/games": "Ігри з котом",
  "/pet/journal": "Щоденник кота",
  "/pet/collection": "Колекція кота",
  "/goals": "Мої проекційні",
  "/goals/credit": "Кредитний рейтинг",
  "/goals/credit/me": "Мої кредитні показники",
  "/goals/debit": "Дебетовий рейтинг",
  "/goals/debit/me": "Мої дебетові видачі",
  "/goals/deposit": "Депозитний рейтинг",
  "/goals/deposit/me": "Мої депозитні показники",
  "/goals/deposit/issuances": "Депозитні видачі",
  "/goals/activation/pumb": "ПУМБ Online",
  "/goals/activation/cards": "Активація карток",
  "/store": "Магазин",
  "/leaderboard": "Загальний рейтинг",
  "/fun": "Щедрий куб",
  "/games/bonus-match": "Bonus Match",
  "/games/hidden-objects": "VPDK Детектив",
  "/games/flappy-pixel": "Flappy Піксель",
  "/games/pixel-drive": "Піксель: Повний газ",
  "/history": "Історія Point",
  "/schedule": "Мій графік",
  "/feed": "Стрічка активності",
};

const getPageLabel = (pathname, search) => {
  const base = pathname.startsWith("/pet/games/")
    ? "Ігри з котом"
    : PAGE_LABELS[pathname] || pathname;
  const params = new URLSearchParams(search || "");
  if (["/goals/debit/me", "/goals/deposit/me", "/goals/deposit/issuances", "/goals/activation/pumb", "/goals/activation/cards"].includes(pathname)) {
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
    aria-label={label}
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
  const userId = user?.id;
  const nav = useNavigate();
  const loc = useLocation();

  useEffect(() => {
    if (!user) nav("/login", { replace: true });
  }, [user, nav]);

  useEffect(() => {
    if (!userId || loc.pathname.startsWith("/admin")) return;
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
  }, [userId, loc.pathname, loc.search]);

  if (!user) return null;
  const isAdmin = ["admin", "editor"].includes(user.role);
  const isAdminRoute = loc.pathname.startsWith("/admin");
  const isBonusMatchRoute = loc.pathname === "/games/bonus-match";
  const isHiddenObjectRoute = loc.pathname === "/games/hidden-objects";
  const isFlappyRoute = loc.pathname === "/games/flappy-pixel";
  const isPixelDriveRoute = /^\/games\/pixel-drive\/?$/.test(loc.pathname);
  const isPetRoomRoute = /^\/pet(?:\/(?:room|games|journal|collection))?\/?$/.test(loc.pathname);
  const isGameRoute = isBonusMatchRoute || isHiddenObjectRoute || isPetRoomRoute || isFlappyRoute || isPixelDriveRoute;

  return (
    <div className={`${isGameRoute ? "h-[100dvh] overflow-hidden" : "min-h-screen"} w-full flex justify-center`}>
      <div
        className={`app-theme-shell relative w-full flex flex-col ${isGameRoute ? "h-[100dvh] min-h-0 overflow-hidden border-0 game-only-app-shell" : "min-h-screen border-x"} ${isBonusMatchRoute ? "bonus-match-app-shell" : ""} ${isHiddenObjectRoute ? "hidden-objects-app-shell" : ""} ${isAdminRoute ? "app-shell app-shell-admin" : "app-shell"}`}
        style={{ maxWidth: isAdminRoute ? "1500px" : isPetRoomRoute ? "606px" : isGameRoute ? "none" : "480px" }}
      >
        {!isGameRoute && <header
          className="app-theme-header sticky top-0 z-30 backdrop-blur-sm px-3 min-[390px]:px-5 pb-4 flex items-center justify-between"
          style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 14px)", minHeight: "calc(74px + env(safe-area-inset-top, 0px))" }}
        >
          <div className="min-w-0 flex-1 overflow-hidden">
            <div className="app-theme-heading overflow-hidden text-ellipsis font-display text-[15px] min-[350px]:text-[17px] min-[390px]:text-[20px] leading-none tracking-[-0.04em] whitespace-nowrap">
              VPDK <span className="text-[#FFB800]">BONUS</span>
            </div>
          </div>
          <div className="flex items-center gap-1 min-[390px]:gap-1.5 shrink-0">
            <NotificationBell />
            <button
              data-testid="nav-teams"
              onClick={() => nav("/teams")}
              className="app-header-action w-12 h-12 max-[370px]:w-10 max-[370px]:h-10 touch-manipulation rounded-2xl flex items-center justify-center text-[#00F0FF] active:scale-95 transition-transform"
              aria-label="Команди"
            >
              <UsersRound size={18} strokeWidth={2.5} />
            </button>
            {isAdmin && (
              <button
                data-testid="nav-admin"
                onClick={() => nav("/admin")}
                className="w-12 h-12 max-[370px]:w-10 max-[370px]:h-10 touch-manipulation rounded-2xl bg-[#FF5C00]/15 border-2 border-[#FF5C00]/60 flex items-center justify-center text-[#FF5C00] active:scale-95 transition-transform"
                aria-label="Адмін-панель"
              >
                <Shield size={18} strokeWidth={3} />
              </button>
            )}
            <button
              data-testid="logout-btn"
              onClick={async () => { await logout(); nav("/login"); }}
              className="app-header-action w-12 h-12 max-[370px]:w-10 max-[370px]:h-10 touch-manipulation rounded-2xl flex items-center justify-center text-zinc-400 active:scale-95 transition-transform"
              aria-label="Вийти"
            >
              <LogOut size={18} strokeWidth={2.5} />
            </button>
          </div>
        </header>}

        <main
          className={isPetRoomRoute ? "flex-1 min-h-0 overflow-hidden" : isGameRoute
            ? "flex-1 min-h-0 overflow-y-auto overscroll-contain page-enter"
            : "flex-1 pb-28 page-enter"}
          data-testid="main-content"
          data-game-route={isGameRoute ? "true" : "false"}
        >
          <Outlet />
        </main>

        {!isGameRoute && <InstallPrompt />}
        {!isGameRoute && <AdminAnnouncementModal user={user} />}

        {!isGameRoute && <nav
          data-testid="bottom-nav"
          className={`app-theme-bottom-nav fixed bottom-0 left-1/2 -translate-x-1/2 w-full items-stretch z-40 px-1 max-w-[480px] flex border-t ${isBonusMatchRoute ? "bonus-match-bottom-nav" : ""} ${isAdminRoute ? "admin-bottom-nav" : ""}`}
          style={{ height: "5rem", paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <NavItem to="/" icon={Home} label="Головна" testId="nav-home" />
          <NavItem to="/tasks" icon={ClipboardList} label="Квести" testId="nav-tasks" />
          <NavItem to="/goals" icon={Target} label="Проекційні" testId="nav-goals" exact={false} />
          <NavItem to="/pet" icon={Cat} label="Кіт" testId="nav-pet" exact={false} />
          <NavItem to="/store" icon={Gift} label="Магазин" testId="nav-store" />
          <NavItem to="/leaderboard" icon={Trophy} label="Рейтинг" testId="nav-board" />
        </nav>}
      </div>
    </div>
  );
}
