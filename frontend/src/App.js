import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { AppProvider, useApp } from "@/context/AppContext";
import AppLayout from "@/components/AppLayout";
import Login from "@/pages/Login";
import Home from "@/pages/Home";
import Quests from "@/pages/Quests";
import Store from "@/pages/Store";
import Admin from "@/pages/Admin";
import Leaderboard from "@/pages/Leaderboard";
import Fun from "@/pages/Fun";
import History from "@/pages/History";
import Feed from "@/pages/Feed";
import Register from "@/pages/Register";
import Tasks from "@/pages/Tasks";
import Teams from "@/pages/Teams";
import AITrainer from "@/pages/AITrainer";
import Goals from "@/pages/Goals";
import CreditGoals from "@/pages/CreditGoals";
import CreditLeaderboard from "@/pages/CreditLeaderboard";
import DebitLeaderboard from "@/pages/DebitLeaderboard";
import DebitIssuances from "@/pages/DebitIssuances";
import BonusMatch from "@/pages/BonusMatch";

const Splash = () => (
  <div className="min-h-screen w-full flex items-center justify-center">
    <div className="w-16 h-16 rounded-3xl bg-[#FFB800] animate-pulse glow-yellow" />
  </div>
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
            <Route path="/quests" element={<Quests />} />
            <Route path="/tasks" element={<Tasks />} />
            <Route path="/teams" element={<Teams />} />
            <Route path="/ai-trainer" element={<AITrainer />} />
            <Route path="/goals" element={<Goals />} />
            <Route path="/goals/credit" element={<CreditLeaderboard />} />
            <Route path="/goals/credit/me" element={<CreditGoals />} />
            <Route path="/goals/debit" element={<DebitLeaderboard />} />
            <Route path="/goals/debit/me" element={<DebitIssuances />} />
            <Route path="/store" element={<Store />} />
            <Route path="/leaderboard" element={<Leaderboard />} />
            <Route path="/fun" element={<Fun />} />
            <Route path="/games/bonus-match" element={<BonusMatch />} />
            <Route path="/history" element={<History />} />
            <Route path="/feed" element={<Feed />} />
            <Route path="/admin" element={<RequireAdmin><Admin /></RequireAdmin>} />
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
