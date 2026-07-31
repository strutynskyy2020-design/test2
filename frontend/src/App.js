import "@/App.css";
import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { ThemeProvider, useTheme } from "next-themes";
import { AppProvider, useApp } from "@/context/AppContext";
import { GoogleReportsProvider } from "@/context/GoogleReportsContext";
import AppLayout from "@/components/AppLayout";
import Login from "@/pages/Login";
import Home from "@/pages/Home";
import Register from "@/pages/Register";

// V96: make the light theme the one-time default for every existing and new user.
// After this migration runs once, the user may freely switch to dark and that
// explicit choice remains stored under `tm6-color-theme`.
const LIGHT_THEME_MIGRATION_KEY = "tm6-light-theme-default-v96";
if (typeof window !== "undefined") {
  try {
    if (window.localStorage.getItem(LIGHT_THEME_MIGRATION_KEY) !== "done") {
      window.localStorage.setItem("tm6-color-theme", "light");
      window.localStorage.setItem(LIGHT_THEME_MIGRATION_KEY, "done");
    }
  } catch (_) {
    // Storage can be unavailable in private/restricted browser contexts.
  }
}

const Quests = lazy(() => import("@/pages/Quests"));
const Store = lazy(() => import("@/pages/Store"));
const Admin = lazy(() => import("@/pages/Admin"));
const Leaderboard = lazy(() => import("@/pages/Leaderboard"));
const Fun = lazy(() => import("@/pages/Fun"));
const History = lazy(() => import("@/pages/History"));
const Feed = lazy(() => import("@/pages/Feed"));
const Tasks = lazy(() => import("@/pages/Tasks"));
const Teams = lazy(() => import("@/pages/Teams"));
const AITrainer = lazy(() => import("@/pages/AITrainer"));
const Goals = lazy(() => import("@/pages/Goals"));
const CreditGoals = lazy(() => import("@/pages/CreditGoals"));
const CreditLeaderboard = lazy(() => import("@/pages/CreditLeaderboard"));
const DebitLeaderboard = lazy(() => import("@/pages/DebitLeaderboard"));
const DebitIssuances = lazy(() => import("@/pages/DebitIssuances"));
const BonusMatch = lazy(() => import("@/pages/BonusMatch"));
const Schedule = lazy(() => import("@/pages/Schedule"));

const Splash = () => (
  <div className="min-h-screen w-full flex items-center justify-center">
    <div className="w-16 h-16 rounded-3xl bg-[#FFB800] animate-pulse glow-yellow" />
  </div>
);

const LazyPage = ({ children }) => (
  <Suspense fallback={<div className="px-5 py-12 text-center text-sm font-bold text-zinc-500">Завантаження розділу...</div>}>
    {children}
  </Suspense>
);


const AppToaster = () => {
  const { resolvedTheme } = useTheme();
  const isLight = resolvedTheme === "light";

  useEffect(() => {
    const color = isLight ? "#FBFBFC" : "#0A0A0A";
    document.documentElement.style.colorScheme = isLight ? "light" : "dark";
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "theme-color");
      document.head.appendChild(meta);
    }
    meta.setAttribute("content", color);
  }, [isLight]);

  return (
    <Toaster
      position="top-center"
      theme={isLight ? "light" : "dark"}
      offset={{ top: 96 }}
      mobileOffset={{ top: 88 }}
      toastOptions={{
        style: {
          background: isLight ? "#FFFFFF" : "#1A1A1E",
          color: isLight ? "#252832" : "#F5F5F5",
          border: isLight ? "1px solid #E6E3EF" : "1px solid rgba(255,255,255,.1)",
          boxShadow: isLight ? "0 14px 34px rgba(44,44,60,.10)" : undefined,
          fontWeight: 900,
          fontFamily: "'Nunito', sans-serif",
        },
      }}
    />
  );
};

const RequireAuth = ({ children }) => {
  const { user, mode } = useApp();
  if (mode === "loading") return <Splash />;
  if (!user) return <Navigate to="/login" replace />;
  return children;
};

const RequireAdmin = ({ children }) => {
  const { user } = useApp();
  if (!user) return <Navigate to="/login" replace />;
  if (!["admin", "editor"].includes(user.role)) return <Navigate to="/" replace />;
  return children;
};

function App() {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      storageKey="tm6-color-theme"
      disableTransitionOnChange
    >
      <AppProvider>
        <GoogleReportsProvider>
          <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route
            element={
              <RequireAuth>
                <AppLayout />
              </RequireAuth>
            }
          >
            <Route path="/" element={<Home />} />
            <Route path="/quests" element={<LazyPage><Quests /></LazyPage>} />
            <Route path="/tasks" element={<LazyPage><Tasks /></LazyPage>} />
            <Route path="/teams" element={<LazyPage><Teams /></LazyPage>} />
            <Route path="/ai-trainer" element={<LazyPage><AITrainer /></LazyPage>} />
            <Route path="/goals" element={<LazyPage><Goals /></LazyPage>} />
            <Route path="/goals/credit" element={<LazyPage><CreditLeaderboard /></LazyPage>} />
            <Route path="/goals/credit/me" element={<LazyPage><CreditGoals /></LazyPage>} />
            <Route path="/goals/debit" element={<LazyPage><DebitLeaderboard /></LazyPage>} />
            <Route path="/goals/debit/me" element={<LazyPage><DebitIssuances /></LazyPage>} />
            <Route path="/store" element={<LazyPage><Store /></LazyPage>} />
            <Route path="/leaderboard" element={<LazyPage><Leaderboard /></LazyPage>} />
            <Route path="/fun" element={<LazyPage><Fun /></LazyPage>} />
            <Route path="/games/bonus-match" element={<LazyPage><BonusMatch /></LazyPage>} />
            <Route path="/history" element={<LazyPage><History /></LazyPage>} />
            <Route path="/schedule" element={<LazyPage><Schedule /></LazyPage>} />
            <Route path="/feed" element={<LazyPage><Feed /></LazyPage>} />
            <Route path="/admin" element={<RequireAdmin><LazyPage><Admin /></LazyPage></RequireAdmin>} />
          </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
          </BrowserRouter>
          <AppToaster />
        </GoogleReportsProvider>
      </AppProvider>
    </ThemeProvider>
  );
}

export default App;
