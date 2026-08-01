const makeResponse = (statusCode, body) => ({
  statusCode,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store, no-cache, must-revalidate",
  },
  body: JSON.stringify(body),
});

const normalizeKey = (value = "") => String(value ?? "").trim().toLowerCase();

const backendBaseUrl = () => String(
  process.env.BACKEND_API_URL || process.env.REACT_APP_BACKEND_URL || ""
).trim().replace(/\/+$/, "");

const backendApiUrl = (path) => {
  const base = backendBaseUrl();
  if (!base) return "";
  return base.endsWith("/api") ? `${base}${path}` : `${base}/api${path}`;
};

const readJson = async (response) => {
  const text = await response.text();
  try { return { data: text ? JSON.parse(text) : null, text }; }
  catch { return { data: null, text }; }
};

const backendGet = async (path, authorization, { optional = false } = {}) => {
  const url = backendApiUrl(path);
  if (!url) return null;
  const response = await fetch(url, {
    headers: { accept: "application/json", authorization },
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

const googleAction = async (scriptUrl, token, action, payload = {}) => {
  const response = await fetch(scriptUrl, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ token, action, ...payload }),
    redirect: "follow",
    cache: "no-store",
  });
  const result = await readJson(response);
  if (!response.ok || !result.data) {
    throw new Error(`Google Apps Script request failed (${response.status})`);
  }
  if (result.data.success === false) throw new Error(result.data.error || "Google Sheets error");
  return result.data;
};

exports.handler = async (event) => {
  if (!["GET", "POST"].includes(event.httpMethod)) {
    return makeResponse(405, { success: false, error: "Method not allowed" });
  }

  try {
    const authorization = event.headers?.authorization || event.headers?.Authorization || "";
    if (!authorization.startsWith("Bearer ")) {
      return makeResponse(401, { success: false, error: "Потрібна авторизація" });
    }

    // v106 authenticates through /auth/me. This route exists in old backend deployments,
    // so the admin goals panel no longer collapses with "Not Found" when newer routes are absent.
    const profile = await backendGet("/auth/me", authorization);
    if (!profile || !["admin", "editor"].includes(profile.role)) {
      return makeResponse(403, { success: false, error: "Доступ лише для адміністратора" });
    }

    const scriptUrl = String(process.env.GOOGLE_GOALS_SCRIPT_URL || "").trim();
    const writeToken = String(process.env.GOOGLE_GOALS_WRITE_TOKEN || "").trim();
    if (!scriptUrl) return makeResponse(500, { success: false, error: "Google Таблицю не налаштовано" });
    if (!writeToken) return makeResponse(500, { success: false, error: "Не налаштовано GOOGLE_GOALS_WRITE_TOKEN" });

    const adminUsers = await backendGet("/admin/users", authorization, { optional: true });
    const userList = Array.isArray(adminUsers) ? adminUsers : [];
    const allowedKeys = new Set(
      userList
        .map((user) => normalizeKey(user.goals_login || user.goalsLogin || user.login2))
        .filter(Boolean),
    );

    if (event.httpMethod === "GET") {
      const snapshot = await googleAction(scriptUrl, writeToken, "read_all_goals");
      const source = snapshot.goals_by_login || {};
      const goalsByLogin = allowedKeys.size
        ? Object.fromEntries(
          Object.entries(source).filter(([key, value]) => allowedKeys.has(normalizeKey(key)) && value),
        )
        : source;

      return makeResponse(200, {
        success: true,
        goals_by_login: goalsByLogin,
        snapshot_updated_at: snapshot.snapshot_updated_at || null,
        compatibility_mode: true,
      });
    }

    const payload = JSON.parse(event.body || "{}");
    const goalsLogin = normalizeKey(payload.goals_login);
    const goals = payload.goals;
    if (!goalsLogin || !goals || typeof goals !== "object") {
      return makeResponse(400, { success: false, error: "goals_login і goals обов'язкові" });
    }
    if (allowedKeys.size && !allowedKeys.has(goalsLogin)) {
      return makeResponse(404, { success: false, error: "Користувача з таким Google-ключем не знайдено" });
    }

    const googleResult = await googleAction(scriptUrl, writeToken, "write_goals", {
      goals_login: goalsLogin,
      goals,
    });

    return makeResponse(200, {
      success: true,
      goals_login: goalsLogin,
      goals: googleResult.goals || null,
      reports_refresh_required: Boolean(googleResult.reports_refresh_required),
      message: googleResult.message || null,
    });
  } catch (error) {
    console.error("google-goals-admin error", error);
    return makeResponse(error?.status === 401 ? 401 : 500, {
      success: false,
      error: error?.message || "Помилка синхронізації цілей",
    });
  }
};
