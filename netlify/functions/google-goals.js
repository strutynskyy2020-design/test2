const makeResponse = (statusCode, body) => ({
  statusCode,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  },
  body: JSON.stringify(body),
});

const normalizeKey = (value = "") => String(value ?? "")
  .replace(/[\u200B-\u200D\uFEFF]/g, "")
  .replace(/\u00A0/g, " ")
  .trim()
  .toLowerCase();

const uniqueKeys = (values) => Array.from(new Set(values.map(normalizeKey).filter(Boolean)));

const backendProfileUrl = () => {
  const raw = String(
    process.env.BACKEND_API_URL ||
    process.env.REACT_APP_BACKEND_URL ||
    ""
  ).replace(/\/$/, "");
  if (!raw) return "";
  return raw.endsWith("/api") ? `${raw}/auth/me` : `${raw}/api/auth/me`;
};

const fetchGooglePayload = async (scriptUrl, goalsLogin) => {
  const url = new URL(scriptUrl);
  url.searchParams.set("goals_login", goalsLogin);
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    redirect: "follow",
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    const error = new Error("Не вдалося отримати дані з Google Таблиці");
    error.status = response.status;
    throw error;
  }
  if (data.success === false) {
    throw new Error(data.error || "Помилка Google Таблиці");
  }
  return data;
};

const emptySchedule = (reason, lookup = {}) => ({
  found: false,
  reason,
  days: [],
  lookup,
});

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return makeResponse(405, { success: false, error: "Method not allowed" });
  }

  try {
    const authorization = event.headers.authorization || event.headers.Authorization || "";
    if (!authorization.startsWith("Bearer ")) {
      return makeResponse(401, { success: false, error: "Потрібна авторизація" });
    }

    const profileUrl = backendProfileUrl();
    if (!profileUrl) {
      return makeResponse(500, { success: false, error: "Не налаштовано адресу backend" });
    }

    const profileResponse = await fetch(profileUrl, {
      headers: { accept: "application/json", authorization },
    });
    const user = await profileResponse.json().catch(() => null);
    if (!profileResponse.ok || !user) {
      return makeResponse(401, { success: false, error: "Сесію завершено. Увійдіть повторно" });
    }

    const scriptUrl = String(process.env.GOOGLE_GOALS_SCRIPT_URL || "").trim();
    if (!scriptUrl) {
      return makeResponse(500, { success: false, error: "Google Таблицю не налаштовано" });
    }

    const isPrivileged = user.role === "admin" || user.role === "editor";
    const requestedScheduleLogin = isPrivileged
      ? normalizeKey(event.queryStringParameters?.schedule_login)
      : "";
    const profileGoalsLogin = normalizeKey(user.goals_login);
    const emailLogin = normalizeKey(String(user.email || "").split("@")[0]);
    const profileCandidates = uniqueKeys([profileGoalsLogin, emailLogin]);
    const baseLogin = profileCandidates[0] || "";
    const scheduleCandidates = uniqueKeys([
      requestedScheduleLogin,
      profileGoalsLogin,
      emailLogin,
    ]);

    let baseData = null;
    if (baseLogin) {
      baseData = await fetchGooglePayload(scriptUrl, baseLogin);
    } else if (scheduleCandidates[0]) {
      baseData = await fetchGooglePayload(scriptUrl, scheduleCandidates[0]);
    }

    if (!baseData) {
      const lookup = {
        requested_login: requestedScheduleLogin || null,
        profile_login: profileGoalsLogin || null,
        email_login: emailLogin || null,
        matched_login: null,
      };
      return makeResponse(200, {
        success: true,
        found: false,
        reason: "goals_login_missing",
        goals_login: null,
        goals: null,
        credit_metrics: [],
        credit_leaderboard: [],
        credit_group_summary: null,
        credit_leaderboard_updated_at: null,
        debit_leaderboard: [],
        debit_group_summary: null,
        debit_leaderboard_updated_at: null,
        debit_issuances: [],
        schedule: emptySchedule("schedule_login_missing", lookup),
      });
    }

    let schedule = null;
    let matchedScheduleLogin = null;
    let payloadMissingSchedule = false;

    for (const candidate of scheduleCandidates) {
      const candidateData = candidate === baseLogin
        ? baseData
        : await fetchGooglePayload(scriptUrl, candidate);
      if (!Object.prototype.hasOwnProperty.call(candidateData, "schedule")) {
        payloadMissingSchedule = true;
        continue;
      }
      if (candidateData.schedule && typeof candidateData.schedule === "object") {
        schedule = candidateData.schedule;
        if (schedule.found) {
          matchedScheduleLogin = candidate;
          break;
        }
      }
    }

    const lookup = {
      requested_login: requestedScheduleLogin || null,
      profile_login: profileGoalsLogin || null,
      email_login: emailLogin || null,
      tried_logins: scheduleCandidates,
      matched_login: matchedScheduleLogin,
      script_api_version: baseData.api_version || null,
    };

    if (!schedule) {
      schedule = emptySchedule(
        payloadMissingSchedule ? "schedule_payload_missing" : "schedule_login_missing",
        lookup,
      );
    } else {
      schedule = { ...schedule, lookup };
    }

    return makeResponse(200, {
      success: true,
      api_version: baseData.api_version || null,
      report_mode: baseData.report_mode || null,
      snapshot_version: baseData.snapshot_version || null,
      snapshot_updated_at: baseData.snapshot_updated_at || null,
      snapshot_day: baseData.snapshot_day || null,
      found: Boolean(baseData.found),
      reason: baseData.reason || null,
      goals_login: baseLogin || null,
      goals: baseData.goals || null,
      credit_metrics: Array.isArray(baseData.credit_metrics) ? baseData.credit_metrics : [],
      credit_leaderboard: Array.isArray(baseData.credit_leaderboard) ? baseData.credit_leaderboard : [],
      credit_group_summary: baseData.credit_group_summary || null,
      credit_leaderboard_updated_at: baseData.credit_leaderboard_updated_at || null,
      debit_leaderboard: Array.isArray(baseData.debit_leaderboard) ? baseData.debit_leaderboard : [],
      debit_group_summary: baseData.debit_group_summary || null,
      debit_leaderboard_updated_at: baseData.debit_leaderboard_updated_at || null,
      debit_issuances: Array.isArray(baseData.debit_issuances) ? baseData.debit_issuances : [],
      schedule,
    });
  } catch (error) {
    console.error("google-goals error", error);
    return makeResponse(500, {
      success: false,
      error: error?.message || "Не вдалося завантажити дані Google Таблиці",
    });
  }
};
