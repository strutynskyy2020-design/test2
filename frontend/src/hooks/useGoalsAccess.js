import { useCallback, useEffect, useState } from "react";
import api from "@/lib/api";
import { useApp } from "@/context/AppContext";

const cache = new Map();
const cacheCheckedAt = new Map();
const inFlight = new Map();
const ACCESS_CACHE_TTL_MS = 5 * 60 * 1000;

const loadForUser = async (userId, force = false) => {
  if (!userId) return null;
  const cachedAt = cacheCheckedAt.get(userId) || 0;
  if (!force && cache.has(userId) && Date.now() - cachedAt < ACCESS_CACHE_TTL_MS) return cache.get(userId);
  if (!force && inFlight.has(userId)) return inFlight.get(userId);

  const request = api.get("/goals/report-access")
    .then(({ data }) => {
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
      const next = await loadForUser(user.id, true);
      setData(next);
      return next;
    } catch (nextError) {
      setError(nextError);
      return null;
    } finally {
      setLoading(false);
    }
  }, [mode, user?.id]);

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
    loadForUser(user.id)
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
  }, [mode, user?.id]);

  return { data, loading, error, reload, setData: updateData };
};
