import { createContext, useContext, useEffect, useMemo, useState } from "react";
import api, { clearToken, extractError, getToken, setToken } from "@/lib/api";

const AppContext = createContext(null);
const CACHE_KEY = "callhub_cache_v2";

const emptyState = {
  mode: "loading",
  user: null,
  quests: [],
  prizes: [],
  orders: [],
};

export const AppProvider = ({ children }) => {
  const [state, setState] = useState(emptyState);

  useEffect(() => {
    const boot = async () => {
      const token = getToken();

      if (token) {
        try {
          const { data: user } = await api.get("/auth/me");
          setState({ mode: "live", user, quests: [], prizes: [], orders: [] });
          return;
        } catch (error) {
          clearToken();
        }
      }

      setState({ ...emptyState, mode: "live" });
    };

    boot();
  }, []);

  const login = async (email, password) => {
    try {
      const { data } = await api.post("/auth/login", {
        email: email.trim(),
        password,
      });

      setToken(data.token);
      setState({ mode: "live", user: data.user, quests: [], prizes: [], orders: [] });
      return { ok: true, mode: "live" };
    } catch (error) {
      return {
        ok: false,
        error: extractError(
          error,
          error.response ? "Невірний email або пароль" : "Сервер тимчасово недоступний"
        ),
      };
    }
  };

  const logout = () => {
    clearToken();
    localStorage.removeItem(CACHE_KEY);
    setState({ ...emptyState, mode: "live" });
  };

  const refreshMe = async () => {
    const { data } = await api.get("/auth/me");
    setState((current) => ({ ...current, user: data }));
  };

  const imageToAvatarDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Не вдалося прочитати фото"));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("Формат фото не підтримується браузером. Оберіть JPG, PNG або WEBP"));
      image.onload = () => {
        const maxSide = 512;
        const scale = Math.min(1, maxSide / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
        const width = Math.max(1, Math.round(image.naturalWidth * scale));
        const height = Math.max(1, Math.round(image.naturalHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) return reject(new Error("Не вдалося підготувати фото"));
        context.drawImage(image, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.84));
      };
      image.src = String(reader.result || "");
    };
    reader.readAsDataURL(file);
  });

  const updateAvatar = async (file) => {
    if (!file || !state.user) return { ok: false, error: "Фото не вибрано" };

    const imageByMime = file.type?.startsWith("image/");
    const imageByName = /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(file.name || "");
    if (!imageByMime && !imageByName) return { ok: false, error: "Оберіть файл зображення" };
    if (file.size > 8 * 1024 * 1024) return { ok: false, error: "Фото має бути менше 8 МБ" };

    try {
      // Store a compact avatar directly in the user profile. Unlike local /uploads,
      // it survives backend redeploys and also avoids HEIC/static-file URL issues.
      const avatarUrl = await imageToAvatarDataUrl(file);
      const { data: user } = await api.patch("/auth/me/avatar", { avatar_url: avatarUrl });
      setState((current) => ({ ...current, user }));
      return { ok: true };
    } catch (error) {
      return { ok: false, error: extractError(error, error?.message || "Не вдалося змінити фото") };
    }
  };

  const loadPrizes = async () => {
    const { data } = await api.get("/prizes");
    setState((current) => ({ ...current, prizes: data }));
  };

  const loadOrders = async () => {
    const { data } = await api.get("/orders");
    setState((current) => ({ ...current, orders: data }));
  };

  const claimQuest = async () => ({ ok: false, error: "Стара система квестів вимкнена" });

  const buyPrize = async (prizeId) => {
    try {
      const { data } = await api.post(`/prizes/${prizeId}/buy`);
      setState((current) => ({
        ...current,
        user: data.user,
        orders: [data.order, ...current.orders],
        prizes: current.prizes.map((prize) =>
          prize.id === prizeId
            ? { ...prize, stock: Math.max(0, prize.stock - 1) }
            : prize
        ),
      }));
      return { ok: true };
    } catch (error) {
      return { ok: false, error: extractError(error, "Не вдалося обміняти Point") };
    }
  };

  useEffect(() => {
    if (state.mode === "live" && state.user) {
      loadPrizes().catch(() => {});
      loadOrders().catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.mode, state.user?.id]);

  const value = useMemo(
    () => ({
      ...state,
      login,
      logout,
      claimQuest,
      buyPrize,
      refreshMe,
      updateAvatar,
      loadPrizes,
      loadOrders,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error("useApp must be used within AppProvider");
  return context;
};
