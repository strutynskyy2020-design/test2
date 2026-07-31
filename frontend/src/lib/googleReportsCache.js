import { getToken } from "@/lib/api";

const CACHE_PREFIX = "tm6-google-reports-v103:";
const CACHE_EVENT = "tm6-google-reports-cache-updated";
const VERSION_ENDPOINT = "/.netlify/functions/google-goals-version";
const REPORTS_ENDPOINT = "/.netlify/functions/google-goals";
const inFlightReports = new Map();
let inFlightManifest = null;
let manifestMemoryCache = null;
const MANIFEST_MEMORY_TTL_MS = 60 * 1000;

const normalize = (value = "") => String(value ?? "")
  .replace(/[\u200B-\u200D\uFEFF]/g, "")
  .replace(/\u00A0/g, " ")
  .trim()
  .toLowerCase();

const kyivDayKey = (date = new Date()) => {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Kyiv",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  } catch (_) {
    return date.toISOString().slice(0, 10);
  }
};

export const getGoogleReportsCacheKey = (user, scheduleLogin = "") => {
  const identity = normalize(user?.id || user?.goals_login || user?.email || "anonymous");
  const schedule = normalize(scheduleLogin || "self");
  return `${CACHE_PREFIX}${identity}:${schedule}`;
};

const parseRecord = (raw) => {
  try {
    const value = JSON.parse(raw || "null");
    if (!value || typeof value !== "object" || !value.data) return null;
    return value;
  } catch (_) {
    return null;
  }
};

export const readGoogleReportsCache = (user, scheduleLogin = "") => {
  if (typeof window === "undefined" || !user) return null;
  try {
    const key = getGoogleReportsCacheKey(user, scheduleLogin);
    const record = parseRecord(window.localStorage.getItem(key));
    if (!record) return null;
    return {
      ...record,
      key,
      isCurrentDay: record.day === kyivDayKey(),
    };
  } catch (_) {
    return null;
  }
};

const writeGoogleReportsCache = (user, scheduleLogin, data) => {
  if (typeof window === "undefined") return;
  const key = getGoogleReportsCacheKey(user, scheduleLogin);
  const record = {
    schema: 1,
    day: kyivDayKey(),
    saved_at: new Date().toISOString(),
    snapshot_version: data?.snapshot_version || null,
    snapshot_updated_at: data?.snapshot_updated_at || null,
    data,
  };

  try {
    window.localStorage.setItem(key, JSON.stringify(record));

    // Admin schedule previews can create several per-login entries. Keep the newest
    // six so the browser cache cannot grow into an attic full of duplicate reports.
    const identityPrefix = key.slice(0, key.lastIndexOf(":") + 1);
    const related = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const candidate = window.localStorage.key(index);
      if (!candidate?.startsWith(identityPrefix) || candidate === key) continue;
      const parsed = parseRecord(window.localStorage.getItem(candidate));
      related.push({ key: candidate, savedAt: Date.parse(parsed?.saved_at || "") || 0 });
    }
    related
      .sort((left, right) => right.savedAt - left.savedAt)
      .slice(5)
      .forEach((entry) => window.localStorage.removeItem(entry.key));
  } catch (_) {
    // The live response still reaches React even when browser storage is restricted.
  }

  window.dispatchEvent(new CustomEvent(CACHE_EVENT, {
    detail: { key, record },
  }));
};

export const clearGoogleReportsCache = () => {
  if (typeof window === "undefined") return;
  const keys = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (key?.startsWith(CACHE_PREFIX)) keys.push(key);
  }
  keys.forEach((key) => window.localStorage.removeItem(key));
};

const fetchJson = async (url, options = {}) => {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.success === false) {
    throw new Error(data?.error || "Не вдалося завантажити звіти");
  }
  return data;
};

export const fetchGoogleReportsManifest = async () => {
  if (manifestMemoryCache && Date.now() - manifestMemoryCache.checkedAt < MANIFEST_MEMORY_TTL_MS) {
    return manifestMemoryCache.data;
  }
  if (inFlightManifest) return inFlightManifest;
  inFlightManifest = fetchJson(VERSION_ENDPOINT, {
    method: "GET",
    headers: { accept: "application/json" },
    cache: "default",
  }).then((data) => {
    manifestMemoryCache = { checkedAt: Date.now(), data };
    return data;
  }).finally(() => {
    inFlightManifest = null;
  });
  return inFlightManifest;
};

const fetchGoogleReportsPayload = async (user, scheduleLogin = "") => {
  const token = getToken();
  if (!token) throw new Error("Потрібна авторизація");

  const params = new URLSearchParams();
  if (scheduleLogin) params.set("schedule_login", scheduleLogin);
  const query = params.toString();
  const data = await fetchJson(`${REPORTS_ENDPOINT}${query ? `?${query}` : ""}`, {
    method: "GET",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });
  writeGoogleReportsCache(user, scheduleLogin, data);
  return data;
};

export const loadGoogleReports = async ({
  user,
  scheduleLogin = "",
  force = false,
  checkPublishedVersion = true,
} = {}) => {
  if (!user) throw new Error("Користувача не визначено");

  const cacheKey = getGoogleReportsCacheKey(user, scheduleLogin);
  const cached = readGoogleReportsCache(user, scheduleLogin);

  if (!force && cached?.data) {
    if (!checkPublishedVersion && cached.isCurrentDay) return cached.data;

    try {
      const manifest = await fetchGoogleReportsManifest();
      const sameVersion = Boolean(
        manifest?.snapshot_version
        && cached.snapshot_version
        && manifest.snapshot_version === cached.snapshot_version
      );
      if (sameVersion) return cached.data;
      if (!manifest?.snapshot_version && cached.isCurrentDay) return cached.data;
    } catch (_) {
      if (cached.isCurrentDay) return cached.data;
      // Keep rendering the stale snapshot, but refresh it in the background below.
    }
  }

  if (inFlightReports.has(cacheKey)) return inFlightReports.get(cacheKey);
  const request = fetchGoogleReportsPayload(user, scheduleLogin)
    .finally(() => inFlightReports.delete(cacheKey));
  inFlightReports.set(cacheKey, request);
  return request;
};

export const preloadGoogleReports = ({ user, scheduleLogin = "" } = {}) => {
  if (!user || !getToken()) return Promise.resolve(null);
  return loadGoogleReports({ user, scheduleLogin, checkPublishedVersion: true });
};

export const googleReportsCacheEventName = CACHE_EVENT;
