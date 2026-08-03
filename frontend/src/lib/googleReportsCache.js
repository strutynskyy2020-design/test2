import { getToken } from "@/lib/api";

const CACHE_PREFIX = "vpdk-google-reports-v125:";
const LEGACY_CACHE_PREFIX = "tm6-google-reports-v104:";
const STALE_CACHE_PREFIXES = ["vpdk-google-reports-v124:", "vpdk-google-reports-v123:", "vpdk-google-reports-v120:", "vpdk-google-reports-v115:", "tm6-google-reports-v106:", LEGACY_CACHE_PREFIX];
const VERSION_ENDPOINT = "/.netlify/functions/google-goals-version";
const REPORTS_ENDPOINT = "/.netlify/functions/google-goals";
const DB_NAME = "vpdk-google-reports-v125";
const DB_VERSION = 1;
const REPORTS_STORE = "reports";
const FALLBACK_PREFIX = `${CACHE_PREFIX}fallback:`;
const inFlightReports = new Map();
let inFlightManifest = null;
let manifestMemoryCache = null;
let databasePromise = null;
const MANIFEST_MEMORY_TTL_MS = 5 * 60 * 1000;

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

const identityFor = (user) => normalize(user?.id || user?.goals_login || user?.email || "anonymous");
const scheduleFor = (scheduleLogin = "") => normalize(scheduleLogin || "self");

export const getGoogleReportsCacheKey = (user, scheduleLogin = "") => (
  `${CACHE_PREFIX}${identityFor(user)}:${scheduleFor(scheduleLogin)}`
);

const parseRecord = (raw) => {
  try {
    const value = typeof raw === "string" ? JSON.parse(raw || "null") : raw;
    if (!value || typeof value !== "object" || !value.data) return null;
    return value;
  } catch (_) {
    return null;
  }
};

const decorateRecord = (record, key) => record ? ({
  ...record,
  key,
  isCurrentDay: record.day === kyivDayKey(),
}) : null;

const openDatabase = () => {
  if (typeof window === "undefined" || !window.indexedDB) {
    return Promise.reject(new Error("IndexedDB unavailable"));
  }
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(REPORTS_STORE)) {
        const store = database.createObjectStore(REPORTS_STORE, { keyPath: "key" });
        store.createIndex("identity", "identity", { unique: false });
        store.createIndex("saved_at", "saved_at", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB open failed"));
    request.onblocked = () => reject(new Error("IndexedDB upgrade blocked"));
  }).catch((error) => {
    databasePromise = null;
    throw error;
  });

  return databasePromise;
};

const runStoreRequest = async (mode, createRequest) => {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(REPORTS_STORE, mode);
    const store = transaction.objectStore(REPORTS_STORE);
    let request;
    try {
      request = createRequest(store);
    } catch (error) {
      reject(error);
      return;
    }
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
  });
};

const idbGet = (key) => runStoreRequest("readonly", (store) => store.get(key));
const idbPut = (record) => runStoreRequest("readwrite", (store) => store.put(record));
const idbClear = () => runStoreRequest("readwrite", (store) => store.clear());
const idbGetAll = () => runStoreRequest("readonly", (store) => store.getAll());
const idbDelete = (key) => runStoreRequest("readwrite", (store) => store.delete(key));

const readLocalFallback = (key) => {
  if (typeof window === "undefined") return null;
  try {
    return parseRecord(window.localStorage.getItem(`${FALLBACK_PREFIX}${key}`));
  } catch (_) {
    return null;
  }
};

const writeLocalFallback = (key, record) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${FALLBACK_PREFIX}${key}`, JSON.stringify(record));
  } catch (_) {
    // Memory cache in the provider remains available for the current PWA session.
  }
};

export const readGoogleReportsCache = async (user, scheduleLogin = "") => {
  if (typeof window === "undefined" || !user) return null;
  const key = getGoogleReportsCacheKey(user, scheduleLogin);

  try {
    const record = parseRecord(await idbGet(key));
    if (record) return decorateRecord(record, key);
  } catch (_) {
    // Continue with the local fallback below.
  }

  const fallback = readLocalFallback(key);
  if (fallback) return decorateRecord(fallback, key);

  // v115 intentionally does not migrate old report payloads: v106 could remove
  // valid “Загальний підсумок” fields while applying the team filter.
  return null;
};

const pruneIdentityRecords = async (identity, keepKey) => {
  try {
    const records = (await idbGetAll())
      .filter((record) => record?.identity === identity && record.key !== keepKey)
      .sort((left, right) => Date.parse(right.saved_at || "") - Date.parse(left.saved_at || ""));
    await Promise.all(records.slice(7).map((record) => idbDelete(record.key)));
  } catch (_) {
    // Pruning is optional and must never block the report from being shown.
  }
};

export const writeGoogleReportsCache = async (user, scheduleLogin, data) => {
  if (typeof window === "undefined" || !user) return null;
  const key = getGoogleReportsCacheKey(user, scheduleLogin);
  const identity = identityFor(user);
  const record = {
    schema: 2,
    key,
    identity,
    schedule: scheduleFor(scheduleLogin),
    day: kyivDayKey(),
    saved_at: new Date().toISOString(),
    snapshot_version: data?.snapshot_version || null,
    snapshot_updated_at: data?.snapshot_updated_at || null,
    data,
  };

  try {
    await idbPut(record);
    pruneIdentityRecords(identity, key);
  } catch (_) {
    writeLocalFallback(key, record);
  }
  return decorateRecord(record, key);
};

export const clearGoogleReportsCache = async () => {
  if (typeof window === "undefined") return;
  try {
    await idbClear();
  } catch (_) {
    // IndexedDB may be unavailable or already removed by the browser.
  }

  try {
    const keys = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (
        STALE_CACHE_PREFIXES.some((prefix) => key?.startsWith(prefix))
        || key?.startsWith(FALLBACK_PREFIX)
        || key?.startsWith(CACHE_PREFIX)
      ) keys.push(key);
    }
    keys.forEach((key) => window.localStorage.removeItem(key));
  } catch (_) {
    // Ignore restricted storage contexts.
  }
};

const fetchJson = async (url, options = {}) => {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.success === false) {
    throw new Error(data?.error || "Не вдалося завантажити звіти");
  }
  return data;
};

export const fetchGoogleReportsManifest = async ({ force = false } = {}) => {
  if (!force && manifestMemoryCache && Date.now() - manifestMemoryCache.checkedAt < MANIFEST_MEMORY_TTL_MS) {
    return manifestMemoryCache.data;
  }
  if (inFlightManifest) return inFlightManifest;

  inFlightManifest = fetchJson(VERSION_ENDPOINT, {
    method: "GET",
    headers: { accept: "application/json" },
    cache: force ? "reload" : "default",
  }).then((data) => {
    manifestMemoryCache = { checkedAt: Date.now(), data };
    return data;
  }).finally(() => {
    inFlightManifest = null;
  });
  return inFlightManifest;
};

export const fetchGoogleReportsPayload = async (user, scheduleLogin = "") => {
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
  await writeGoogleReportsCache(user, scheduleLogin, data);
  return data;
};

export const loadGoogleReports = async ({
  user,
  scheduleLogin = "",
  force = false,
  checkPublishedVersion = true,
  cachedRecord = null,
} = {}) => {
  if (!user) throw new Error("Користувача не визначено");

  const cacheKey = getGoogleReportsCacheKey(user, scheduleLogin);
  const cached = cachedRecord || await readGoogleReportsCache(user, scheduleLogin);

  if (!force && cached?.data) {
    if (!checkPublishedVersion) return cached.data;
    try {
      const manifest = await fetchGoogleReportsManifest();
      const sameVersion = Boolean(
        manifest?.snapshot_version
        && cached.snapshot_version
        && manifest.snapshot_version === cached.snapshot_version
      );
      if (sameVersion || (!manifest?.snapshot_version && cached.isCurrentDay)) return cached.data;
    } catch (_) {
      return cached.data;
    }
  }

  if (inFlightReports.has(cacheKey)) return inFlightReports.get(cacheKey);
  const request = fetchGoogleReportsPayload(user, scheduleLogin)
    .finally(() => inFlightReports.delete(cacheKey));
  inFlightReports.set(cacheKey, request);
  return request;
};

export const isSamePublishedSnapshot = (manifest, data) => Boolean(
  manifest?.snapshot_version
  && data?.snapshot_version
  && manifest.snapshot_version === data.snapshot_version
);

export const googleReportsKyivDayKey = kyivDayKey;
