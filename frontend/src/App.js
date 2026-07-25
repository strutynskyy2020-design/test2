import "@/App.css";
import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
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
      <Toaster
        position="top-center"
        theme="dark"
        offset={{ top: 96 }}
        mobileOffset={{ top: 88 }}
        toastOptions={{
          style: {
            background: "#1A1A1E",
            color: "#F5F5F5",
            border: "1px solid rgba(255,255,255,0.1)",
            fontWeight: 900,
            fontFamily: "'Nunito', sans-serif",
          },
        }}
      />
    </AppProvider>
  );
}

export default App;
