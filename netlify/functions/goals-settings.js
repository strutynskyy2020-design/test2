const makeResponse = (statusCode, body) => ({
  statusCode,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store, no-cache, must-revalidate",
  },
  body: JSON.stringify(body),
});

const backendApiBase = () => {
  const raw = String(process.env.BACKEND_API_URL || process.env.REACT_APP_BACKEND_URL || "").replace(/\/$/, "");
  if (!raw) return "";
  return raw.endsWith("/api") ? raw : `${raw}/api`;
};

const readJson = async (response) => {
  const text = await response.text();
  try { return { data: text ? JSON.parse(text) : null, text }; }
  catch { return { data: null, text }; }
};

const getProfile = async (authorization) => {
  const base = backendApiBase();
  if (!base) throw new Error("Не налаштовано адресу backend");
  const response = await fetch(`${base}/auth/me`, {
    headers: { accept: "application/json", authorization },
    cache: "no-store",
  });
  const result = await readJson(response);
  if (!response.ok || !result.data) {
    const error = new Error(result.data?.detail || "Сесію завершено. Увійдіть повторно");
    error.status = response.status;
    throw error;
  }
  return result.data;
};

const backendRequest = async (path, authorization, { method = "GET", body = null, optional = false } = {}) => {
  const base = backendApiBase();
  if (!base) return null;
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      accept: "application/json",
      authorization,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const result = await readJson(response);
  if (!response.ok) {
    if (optional) return null;
    const error = new Error(result.data?.detail || `Backend request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return result.data;
};

const googleAction = async (action, payload = {}) => {
  const scriptUrl = String(process.env.GOOGLE_GOALS_SCRIPT_URL || "").trim();
  const token = String(process.env.GOOGLE_GOALS_WRITE_TOKEN || "").trim();
  if (!scriptUrl) throw new Error("Google Таблицю не налаштовано");
  if (!token) throw new Error("Не налаштовано GOOGLE_GOALS_WRITE_TOKEN");
  const response = await fetch(scriptUrl, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ token, action, ...payload }),
    redirect: "follow",
    cache: "no-store",
  });
  const result = await readJson(response);
  if (!response.ok || !result.data) throw new Error(`Google Apps Script request failed (${response.status})`);
  if (result.data.success === false) throw new Error(result.data.error || "Помилка Google Таблиці");
  return result.data;
};

exports.handler = async (event) => {
  if (!["GET", "PATCH", "POST"].includes(event.httpMethod)) {
    return makeResponse(405, { success: false, error: "Method not allowed" });
  }
  try {
    const authorization = event.headers?.authorization || event.headers?.Authorization || "";
    if (!authorization.startsWith("Bearer ")) {
      return makeResponse(401, { success: false, error: "Потрібна авторизація" });
    }
    const user = await getProfile(authorization);
    if (event.httpMethod === "GET") {
      const backendData = user.role === "admin"
        ? await backendRequest("/admin/goals-settings", authorization, { optional: true })
        : await backendRequest("/goals/report-access", authorization, { optional: true });
      if (backendData) {
        return makeResponse(200, {
          success: true,
          allow_cross_team_reports: Boolean(
            backendData.allow_cross_team_reports || backendData.admin_allows_cross_team_reports,
          ),
          updated_at: backendData.updated_at || null,
          source: "backend",
        });
      }
      const data = await googleAction("get_goals_settings");
      return makeResponse(200, { ...data, source: "google_apps_script" });
    }
    if (user.role !== "admin") {
      return makeResponse(403, { success: false, error: "Доступ лише для адміністратора" });
    }
    const body = JSON.parse(event.body || "{}");
    const allowCrossTeamReports = Boolean(body.allow_cross_team_reports);
    const [googleResult, backendResult] = await Promise.all([
      googleAction("set_goals_settings", {
        allow_cross_team_reports: allowCrossTeamReports,
        updated_by_name: user.name || "Адміністратор",
      }),
      backendRequest("/admin/goals-settings", authorization, {
        method: "PATCH",
        body: { allow_cross_team_reports: allowCrossTeamReports },
        optional: true,
      }),
    ]);
    return makeResponse(200, {
      ...googleResult,
      ...(backendResult || {}),
      success: true,
      allow_cross_team_reports: allowCrossTeamReports,
      source: backendResult ? "backend_and_google" : "google_apps_script",
    });
  } catch (error) {
    console.error("goals-settings error", error);
    return makeResponse(error?.status === 401 ? 401 : 500, {
      success: false,
      error: error?.message || "Не вдалося змінити налаштування цілей",
    });
  }
};
