import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/context/AppContext";
import {
  getGoogleReportsCacheKey,
  googleReportsCacheEventName,
  loadGoogleReports,
  readGoogleReportsCache,
} from "@/lib/googleReportsCache";

const initialState = (user, scheduleLogin, mode) => {
  const cached = readGoogleReportsCache(user, scheduleLogin);
  return {
    data: cached?.data || null,
    loading: mode !== "mock" && !cached?.data,
    refreshing: false,
    error: null,
  };
};

export const useDailyGoogleReports = ({ scheduleLogin = "" } = {}) => {
  const { user, mode } = useApp();
  const cacheKey = user ? getGoogleReportsCacheKey(user, scheduleLogin) : "";
  const [state, setState] = useState(() => initialState(user, scheduleLogin, mode));

  const syncFromStorage = useCallback(() => {
    const cached = readGoogleReportsCache(user, scheduleLogin);
    setState((current) => ({
      ...current,
      data: cached?.data || current.data || null,
      loading: mode !== "mock" && !cached?.data && !current.data,
    }));
  }, [user, scheduleLogin, mode]);

  useEffect(() => {
    if (mode === "mock" || !user) {
      setState({ data: null, loading: false, refreshing: false, error: null });
      return undefined;
    }

    let active = true;
    const cached = readGoogleReportsCache(user, scheduleLogin);
    setState({
      data: cached?.data || null,
      loading: !cached?.data,
      refreshing: Boolean(cached?.data),
      error: null,
    });

    const onCacheUpdate = (event) => {
      if (event?.detail?.key !== cacheKey) return;
      syncFromStorage();
    };
    window.addEventListener(googleReportsCacheEventName, onCacheUpdate);

    loadGoogleReports({ user, scheduleLogin, checkPublishedVersion: true })
      .then((data) => {
        if (!active) return;
        setState({ data, loading: false, refreshing: false, error: null });
      })
      .catch((error) => {
        if (!active) return;
        setState((current) => ({
          ...current,
          loading: false,
          refreshing: false,
          error,
        }));
      });

    return () => {
      active = false;
      window.removeEventListener(googleReportsCacheEventName, onCacheUpdate);
    };
  }, [cacheKey, mode, scheduleLogin, syncFromStorage, user]);

  const refresh = useCallback(async () => {
    if (!user || mode === "mock") return null;
    setState((current) => ({ ...current, refreshing: true, error: null }));
    try {
      const data = await loadGoogleReports({
        user,
        scheduleLogin,
        force: true,
        checkPublishedVersion: false,
      });
      setState({ data, loading: false, refreshing: false, error: null });
      return data;
    } catch (error) {
      setState((current) => ({ ...current, refreshing: false, error }));
      throw error;
    }
  }, [mode, scheduleLogin, user]);

  return { ...state, refresh };
};
