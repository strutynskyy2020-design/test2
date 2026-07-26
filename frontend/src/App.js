import "@/App.css";
import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { ThemeProvider, useTheme } from "next-themes";
import { AppProvider, useApp } from "@/context/AppContext";
import AppLayout from "@/components/AppLayout";
import Login from "@/pages/Login";
import Home from "@/pages/Home";
import Register from "@/pages/Register";

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
    const color = isLight ? "#F5F5DC" : "#0A0A0A";
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
          background: isLight ? "#FFFDF4" : "#1A1A1E",
          color: isLight ? "#252832" : "#F5F5F5",
          border: isLight ? "1px solid rgba(104,96,73,.18)" : "1px solid rgba(255,255,255,.1)",
          boxShadow: isLight ? "0 14px 34px rgba(89,77,48,.14)" : undefined,
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
      defaultTheme="dark"
      enableSystem={false}
      storageKey="tm6-color-theme"
      disableTransitionOnChange
    >
      <AppProvider>
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
            <Route path="/feed" element={<LazyPage><Feed /></LazyPage>} />
            <Route path="/admin" element={<RequireAdmin><LazyPage><Admin /></LazyPage></RequireAdmin>} />
          </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <AppToaster />
      </AppProvider>
    </ThemeProvider>
  );
}

export default App;
