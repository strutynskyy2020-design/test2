import { useCallback, useEffect, useState } from "react";
import api, { getToken } from "@/lib/api";
import { useApp } from "@/context/AppContext";

const cache = new Map();
const cacheCheckedAt = new Map();
const inFlight = new Map();
const ACCESS_CACHE_TTL_MS = 5 * 60 * 1000;

const fallbackAccess = async (user) => {
  const token = getToken();
  const [teamsResult, settingsResult] = await Promise.allSettled([
    api.get("/teams"),
    token
      ? fetch("/.netlify/functions/goals-settings", {
        method: "GET",
        headers: { accept: "application/json", authorization: `Bearer ${token}` },
        cache: "no-store",
      }).then(async (response) => {
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(data?.error || "Не вдалося прочитати налаштування");
        return data;
      })
      : Promise.resolve(null),
  ]);

  const teams = teamsResult.status === "fulfilled" && Array.isArray(teamsResult.value?.data)
    ? teamsResult.value.data
    : [];
  const settings = settingsResult.status === "fulfilled" ? settingsResult.value : null;
  const currentTeam = teams.find((team) => team.id === user?.team_id)
    || (user?.team_id ? { id: user.team_id, name: user.team_name || "" } : null);
  const privileged = user?.role === "admin" || user?.role === "editor";
  const allowCrossTeam = Boolean(privileged || settings?.allow_cross_team_reports);

  return {
    allow_cross_team_reports: allowCrossTeam,
    admin_allows_cross_team_reports: Boolean(settings?.allow_cross_team_reports),
    current_team: currentTeam,
    teams: allowCrossTeam ? teams : (currentTeam ? [currentTeam] : []),
    allowed_goals_logins: [],
    participants: null,
    access_signature: null,
    team_message: null,
    is_team_leader: Boolean(user?.is_team_leader),
    compatibility_mode: true,
  };
};

const loadForUser = async (user, force = false) => {
  const userId = user?.id;
  if (!userId) return null;
  const cachedAt = cacheCheckedAt.get(userId) || 0;
  if (!force && cache.has(userId) && Date.now() - cachedAt < ACCESS_CACHE_TTL_MS) return cache.get(userId);
  if (!force && inFlight.has(userId)) return inFlight.get(userId);

  const request = api.get("/goals/report-access")
    .then(({ data }) => data)
    .catch(() => fallbackAccess(user))
    .then((data) => {
      cache.set(userId, data);
      cacheCheckedAt.set(userId, Date.now());
      return data;
    })
    .finally(() => inFlight.delete(userId));

  inFlight.set(userId, request);
  return request;
};

export const invalidateGoalsAccess = (userId) => {
  if (userId) {
    cache.delete(userId);
    cacheCheckedAt.delete(userId);
  } else {
    cache.clear();
    cacheCheckedAt.clear();
  }
};

export const useGoalsAccess = () => {
  const { user, mode } = useApp();
  const [data, setData] = useState(() => user?.id ? cache.get(user.id) || null : null);
  const [loading, setLoading] = useState(Boolean(user && mode !== "mock" && !data));
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    if (!user?.id || mode === "mock") return null;
    setLoading(!cache.has(user.id));
    setError(null);
    try {
      const next = await loadForUser(user, true);
      setData(next);
      return next;
    } catch (nextError) {
      setError(nextError);
      return null;
    } finally {
      setLoading(false);
    }
  }, [mode, user]);

  const updateData = useCallback((nextOrUpdater) => {
    setData((current) => {
      const next = typeof nextOrUpdater === "function" ? nextOrUpdater(current) : nextOrUpdater;
      if (user?.id) {
        if (next) {
          cache.set(user.id, next);
          cacheCheckedAt.set(user.id, Date.now());
        } else {
          cache.delete(user.id);
          cacheCheckedAt.delete(user.id);
        }
      }
      return next;
    });
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id || mode === "mock") {
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    setLoading(!cache.has(user.id));
    loadForUser(user)
      .then((next) => {
        if (!cancelled) setData(next);
      })
      .catch((nextError) => {
        if (!cancelled) setError(nextError);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [mode, user]);

  return { data, loading, error, reload, setData: updateData };
};
