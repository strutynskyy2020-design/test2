import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import api, { clearToken, extractError, getToken, setToken } from "@/lib/api";
import { DEMO_USERS as MOCK_USERS, DAILY_QUESTS as MOCK_QUESTS, PRIZES as MOCK_PRIZES } from "@/lib/mockData";

const AppContext = createContext(null);

// Hybrid strategy: if backend unreachable, allow demo login using mock data.
const CACHE_KEY = "callhub_cache_v2";

const emptyState = {
  mode: "loading",  // 'loading' | 'live' | 'mock'
  user: null,
  quests: [],
  prizes: [],
  orders: [],
};

const loadCache = () => {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    // ignore
  }
  return null;
};

const saveCache = (data) => {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch (e) {
    // ignore
  }
};

// Convert mock user (no XP-derived level) into the same shape as backend UserWithProgress
const enrichMockUser = (u) => {
  const xp = u.xp ?? 0;
  const xpToNext = u.xpToNext ?? 2000;
  return {
    id: `mock_${u.email}`,
    email: u.email,
    name: u.name,
    role: "employee",
    department: u.department,
    position: u.role,
    avatar_initials: u.avatarInitials,
    avatar_color: u.avatarColor,
    balance: u.balance,
    total_earned: u.totalEarned,
    total_xp: xp,
    streak: u.streak,
    telegram_id: null,
    created_at: new Date().toISOString(),
    level: u.level,
    xp,
    xp_to_next: xpToNext,
  };
};

export const AppProvider = ({ children }) => {
  const [state, setState] = useState(emptyState);

  const persist = useCallback((next) => {
    setState(next);
    if (next.mode === "mock") saveCache(next);
  }, []);

  // On mount: verify token, otherwise try cache/mock
  useEffect(() => {
    const boot = async () => {
      const token = getToken();
      if (token) {
        try {
          const { data: user } = await api.get("/auth/me");
          setState({ mode: "live", user, quests: [], prizes: [], orders: [] });
          return;
        } catch (e) {
          clearToken();
        }
      }
      // Try to detect backend availability, but don't force auth
      try {
        await api.get("/health");
        setState({ ...emptyState, mode: "live" });
      } catch (e) {
        const cached = loadCache();
        if (cached?.user) {
          setState({ ...cached, mode: "mock" });
        } else {
          setState({ ...emptyState, mode: "mock" });
        }
      }
    };
    boot();
  }, []);

  // ─────────────── Auth ───────────────
  const login = async (email, password) => {
    // Try live backend first
    try {
      const { data } = await api.post("/auth/login", { email, password });
      setToken(data.token);
      setState({ mode: "live", user: data.user, quests: [], prizes: [], orders: [] });
      return { ok: true, mode: "live" };
    } catch (err) {
      // If it's a network error, fall back to mock
      const isNetwork = !err.response;
      if (!isNetwork) {
        return { ok: false, error: extractError(err, "Невірний email або пароль") };
      }
    }
    // Mock fallback
    const found = MOCK_USERS.find(
      (u) => u.email.toLowerCase() === email.trim().toLowerCase() && u.password === password
    );
    if (!found) return { ok: false, error: "Бекенд недоступний і мок-логін не підійшов" };
    const user = enrichMockUser(found);
    const next = {
      mode: "mock",
      user,
      quests: MOCK_QUESTS.map((q) => ({ ...q, claimed: false })),
      prizes: MOCK_PRIZES,
      orders: [],
    };
    persist(next);
    return { ok: true, mode: "mock" };
  };

  const logout = () => {
    clearToken();
    localStorage.removeItem(CACHE_KEY);
    setState({ ...emptyState, mode: state.mode === "mock" ? "mock" : "live" });
  };

  // ─────────────── Live-mode helpers ───────────────
  const refreshMe = async () => {
    const { data } = await api.get("/auth/me");
    setState((s) => ({ ...s, user: data }));
  };

  const loadQuests = async () => {
    if (state.mode !== "live") return;
    const { data } = await api.get("/quests");
    setState((s) => ({ ...s, quests: data }));
  };

  const loadPrizes = async () => {
    if (state.mode !== "live") return;
    const { data } = await api.get("/prizes");
    setState((s) => ({ ...s, prizes: data }));
  };

  const loadOrders = async () => {
    if (state.mode !== "live") return;
    const { data } = await api.get("/orders");
    setState((s) => ({ ...s, orders: data }));
  };

  // ─────────────── Actions (unified interface) ───────────────
  const claimQuest = async (questId) => {
    if (state.mode === "live") {
      try {
        const { data: user } = await api.post(`/quests/${questId}/claim`);
        setState((s) => ({
          ...s,
          user,
          quests: s.quests.map((q) => (q.id === questId ? { ...q, claimed: true } : q)),
        }));
        return { ok: true };
      } catch (err) {
        return { ok: false, error: extractError(err, "Не вдалось забрати нагороду") };
      }
    }
    // Mock
    setState((s) => {
      const q = s.quests.find((x) => x.id === questId);
      if (!q || q.claimed || q.progress < q.goal || !s.user) return s;
      const next = {
        ...s,
        quests: s.quests.map((x) => (x.id === questId ? { ...x, claimed: true } : x)),
        user: {
          ...s.user,
          balance: s.user.balance + q.reward,
          total_earned: s.user.total_earned + q.reward,
          xp: Math.min(s.user.xp + Math.floor(q.reward / 2), s.user.xp_to_next),
        },
      };
      saveCache(next);
      return next;
    });
    return { ok: true };
  };

  const buyPrize = async (prizeId) => {
    if (state.mode === "live") {
      try {
        const { data } = await api.post(`/prizes/${prizeId}/buy`);
        setState((s) => ({
          ...s,
          user: data.user,
          orders: [data.order, ...s.orders],
          prizes: s.prizes.map((p) => (p.id === prizeId ? { ...p, stock: Math.max(0, p.stock - 1) } : p)),
        }));
        return { ok: true };
      } catch (err) {
        return { ok: false, error: extractError(err, "Не вдалось обміняти") };
      }
    }
    // Mock
    const prize = state.prizes.find((p) => p.id === prizeId);
    if (!prize || !state.user) return { ok: false, error: "Приз не знайдено" };
    if (state.user.balance < prize.price) return { ok: false, error: "Недостатньо балів" };
    setState((s) => {
      const next = {
        ...s,
        user: { ...s.user, balance: s.user.balance - prize.price },
        orders: [
          {
            id: `o_${Date.now()}`,
            user_id: s.user.id,
            user_name: s.user.name,
            prize_id: prizeId,
            prize_title: prize.title,
            price: prize.price,
            status: "processing",
            created_at: new Date().toISOString(),
          },
          ...s.orders,
        ],
      };
      saveCache(next);
      return next;
    });
    return { ok: true };
  };

  // Load data when user is available (live mode)
  useEffect(() => {
    if (state.mode === "live" && state.user) {
      loadQuests();
      loadPrizes();
      loadOrders();
    }
    // Bootstrap mock data if in mock mode and no quests loaded
    if (state.mode === "mock" && state.user && state.quests.length === 0) {
      setState((s) => ({
        ...s,
        quests: MOCK_QUESTS.map((q) => ({ ...q, claimed: false })),
        prizes: MOCK_PRIZES,
      }));
    }
    // eslint-disable-next-line
  }, [state.mode, state.user?.id]);

  const value = useMemo(
    () => ({ ...state, login, logout, claimQuest, buyPrize, refreshMe, loadQuests, loadPrizes, loadOrders }),
    // eslint-disable-next-line
    [state]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export const useApp = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
};
