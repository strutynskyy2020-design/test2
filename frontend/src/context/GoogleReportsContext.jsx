import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useApp } from "@/context/AppContext";
import { getToken } from "@/lib/api";
import {
  fetchGoogleReportsManifest,
  fetchGoogleReportsPayload,
  getGoogleReportsCacheKey,
  isSamePublishedSnapshot,
  readGoogleReportsCache,
} from "@/lib/googleReportsCache";

const GoogleReportsContext = createContext(null);
const FOREGROUND_CHECK_INTERVAL_MS = 30 * 60 * 1000;

const emptyEntry = (scheduleLogin = "") => ({
  scheduleLogin,
  data: null,
  loading: false,
  refreshing: false,
  hydrated: false,
  error: null,
});

export const GoogleReportsProvider = ({ children }) => {
  const { user, mode } = useApp();
  const [entries, setEntries] = useState({});
  const entriesRef = useRef({});
  const initializedRef = useRef(new Set());
  const inFlightRef = useRef(new Map());
  const activeIdentityRef = useRef("");
  const lastManifestCheckRef = useRef(0);

  const updateEntry = useCallback((key, updater) => {
    const current = entriesRef.current;
    const previous = current[key] || emptyEntry();
    const nextEntry = typeof updater === "function" ? updater(previous) : updater;
    const next = { ...current, [key]: nextEntry };
    entriesRef.current = next;
    setEntries(next);
  }, []);

  const identity = user
    ? String(user.id || user.goals_login || user.email || "anonymous")
    : "";

  useEffect(() => {
    if (activeIdentityRef.current === identity) return;
    activeIdentityRef.current = identity;
    initializedRef.current = new Set();
    inFlightRef.current = new Map();
    entriesRef.current = {};
    lastManifestCheckRef.current = 0;
    setEntries({});
  }, [identity]);

  const fetchFresh = useCallback(async (scheduleLogin = "", { silent = true } = {}) => {
    if (!user || mode === "mock" || !getToken()) return null;
    const key = getGoogleReportsCacheKey(user, scheduleLogin);
    if (inFlightRef.current.has(key)) return inFlightRef.current.get(key);

    updateEntry(key, (current) => ({
      ...current,
      scheduleLogin,
      loading: !silent && !current.data,
      refreshing: Boolean(current.data),
      error: null,
    }));

    const request = fetchGoogleReportsPayload(user, scheduleLogin)
      .then((data) => {
        if (activeIdentityRef.current !== identity) return data;
        updateEntry(key, {
          scheduleLogin,
          data,
          loading: false,
          refreshing: false,
          hydrated: true,
          error: null,
        });
        return data;
      })
      .catch((error) => {
        if (activeIdentityRef.current === identity) {
          updateEntry(key, (current) => ({
            ...current,
            loading: false,
            refreshing: false,
            hydrated: true,
            error: current.data ? null : error,
          }));
        }
        throw error;
      })
      .finally(() => inFlightRef.current.delete(key));

    inFlightRef.current.set(key, request);
    return request;
  }, [identity, mode, updateEntry, user]);

  const ensureReport = useCallback(async (scheduleLogin = "", { checkVersion = false } = {}) => {
    if (!user || mode === "mock") return null;
    const key = getGoogleReportsCacheKey(user, scheduleLogin);

    if (!initializedRef.current.has(key)) {
      initializedRef.current.add(key);
      updateEntry(key, (current) => ({
        ...current,
        scheduleLogin,
        loading: !current.data,
        error: null,
      }));

      const cached = await readGoogleReportsCache(user, scheduleLogin);
      if (activeIdentityRef.current !== identity) return null;

      if (cached?.data) {
        updateEntry(key, {
          scheduleLogin,
          data: cached.data,
          loading: false,
          refreshing: false,
          hydrated: true,
          error: null,
        });
      } else {
        updateEntry(key, (current) => ({ ...current, hydrated: true }));
        await fetchFresh(scheduleLogin, { silent: false }).catch(() => null);
      }
    }

    if (checkVersion) {
      const manifest = await fetchGoogleReportsManifest().catch(() => null);
      lastManifestCheckRef.current = Date.now();
      const current = entriesRef.current[key];
      if (manifest?.snapshot_version && current?.data && !isSamePublishedSnapshot(manifest, current.data)) {
        await fetchFresh(scheduleLogin, { silent: true }).catch(() => null);
      }
    }

    return entriesRef.current[key]?.data || null;
  }, [fetchFresh, identity, mode, updateEntry, user]);

  const checkPublishedUpdate = useCallback(async ({ force = false } = {}) => {
    if (!user || mode === "mock" || !getToken()) return;
    const now = Date.now();
    if (!force && now - lastManifestCheckRef.current < FOREGROUND_CHECK_INTERVAL_MS) return;

    const manifest = await fetchGoogleReportsManifest({ force }).catch(() => null);
    lastManifestCheckRef.current = now;
    if (!manifest?.snapshot_version) return;

    const loadedEntries = Object.entries(entriesRef.current);
    await Promise.all(loadedEntries.map(async ([key, entry]) => {
      if (!entry?.data || isSamePublishedSnapshot(manifest, entry.data)) return;
      await fetchFresh(entry.scheduleLogin || "", { silent: true }).catch(() => null);
    }));
  }, [fetchFresh, mode, user]);

  useEffect(() => {
    if (!user || mode !== "live" || !getToken()) return undefined;

    const isPrivileged = user.role === "admin" || user.role === "editor";
    const selectedScheduleLogin = isPrivileged
      ? window.localStorage.getItem("tm6_schedule_admin_login_v1") || ""
      : "";

    let cancelled = false;
    const boot = async () => {
      await ensureReport("");
      if (selectedScheduleLogin) await ensureReport(selectedScheduleLogin);
      if (!cancelled) await checkPublishedUpdate({ force: true });
    };
    boot().catch(() => {});

    const onVisible = () => {
      if (document.visibilityState === "visible") checkPublishedUpdate().catch(() => {});
    };
    const onFocus = () => checkPublishedUpdate().catch(() => {});
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, [checkPublishedUpdate, ensureReport, mode, user]);

  const getReportState = useCallback((scheduleLogin = "") => {
    if (!user || mode === "mock") return emptyEntry(scheduleLogin);
    const key = getGoogleReportsCacheKey(user, scheduleLogin);
    return entries[key] || {
      ...emptyEntry(scheduleLogin),
      loading: true,
    };
  }, [entries, mode, user]);

  const refresh = useCallback((scheduleLogin = "") => (
    fetchFresh(scheduleLogin, { silent: false })
  ), [fetchFresh]);

  const value = useMemo(() => ({
    ensureReport,
    getReportState,
    refresh,
    checkPublishedUpdate,
  }), [checkPublishedUpdate, ensureReport, getReportState, refresh]);

  return (
    <GoogleReportsContext.Provider value={value}>
      {children}
    </GoogleReportsContext.Provider>
  );
};

export const useGoogleReportsContext = (scheduleLogin = "") => {
  const context = useContext(GoogleReportsContext);
  if (!context) throw new Error("useGoogleReportsContext must be used within GoogleReportsProvider");
  const { ensureReport, getReportState, refresh } = context;
  const state = getReportState(scheduleLogin);

  useEffect(() => {
    ensureReport(scheduleLogin).catch(() => {});
  }, [ensureReport, scheduleLogin]);

  const refreshCurrent = useCallback(() => refresh(scheduleLogin), [refresh, scheduleLogin]);
  return { ...state, refresh: refreshCurrent };
};
