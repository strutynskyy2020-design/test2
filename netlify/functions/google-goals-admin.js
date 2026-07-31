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

const googleGetAllCachedGoals = async (scriptUrl, token) => {
  const response = await fetch(scriptUrl, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ token, action: "read_all_goals" }),
    redirect: "follow",
    cache: "no-store",
  });
  const result = await readJson(response);
  if (!response.ok || !result.data) {
    throw new Error(`Google Apps Script snapshot GET failed (${response.status})`);
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

    const dashboardUrl = backendApiUrl("/admin/goals-dashboard");
    if (!dashboardUrl) {
      return makeResponse(500, { success: false, error: "Не налаштовано адресу backend" });
    }

    // This call verifies both the JWT and the admin role.
    const dashboardResponse = await fetch(dashboardUrl, {
      headers: { accept: "application/json", authorization },
      cache: "no-store",
    });
    const dashboardResult = await readJson(dashboardResponse);
    if (!dashboardResponse.ok || !Array.isArray(dashboardResult.data)) {
      return makeResponse(dashboardResponse.status === 403 ? 403 : 401, {
        success: false,
        error: dashboardResult.data?.detail || "Доступ лише для адміністратора",
      });
    }

    const scriptUrl = String(process.env.GOOGLE_GOALS_SCRIPT_URL || "").trim();
    if (!scriptUrl) {
      return makeResponse(500, { success: false, error: "Google Таблицю не налаштовано" });
    }

    if (event.httpMethod === "GET") {
      const writeToken = String(process.env.GOOGLE_GOALS_WRITE_TOKEN || "").trim();
      if (!writeToken) {
        return makeResponse(500, { success: false, error: "Не налаштовано GOOGLE_GOALS_WRITE_TOKEN" });
      }

      const allowedKeys = new Set(
        dashboardResult.data.map((user) => normalizeKey(user.goals_login)).filter(Boolean)
      );
      const snapshot = await googleGetAllCachedGoals(scriptUrl, writeToken);
      const goalsByLogin = Object.fromEntries(
        Object.entries(snapshot.goals_by_login || {})
          .filter(([key, value]) => allowedKeys.has(normalizeKey(key)) && value)
      );

      return makeResponse(200, {
        success: true,
        goals_by_login: goalsByLogin,
        snapshot_updated_at: snapshot.snapshot_updated_at || null,
      });
    }

    const payload = JSON.parse(event.body || "{}");
    const goalsLogin = normalizeKey(payload.goals_login);
    const goals = payload.goals;
    if (!goalsLogin || !goals || typeof goals !== "object") {
      return makeResponse(400, { success: false, error: "goals_login і goals обов'язкові" });
    }

    const allowed = dashboardResult.data.some(
      (user) => normalizeKey(user.goals_login) === goalsLogin
    );
    if (!allowed) {
      return makeResponse(404, { success: false, error: "Користувача з таким Google-ключем не знайдено" });
    }

    const writeToken = String(process.env.GOOGLE_GOALS_WRITE_TOKEN || "").trim();
    if (!writeToken) {
      return makeResponse(500, { success: false, error: "Не налаштовано GOOGLE_GOALS_WRITE_TOKEN" });
    }

    const googleResponse = await fetch(scriptUrl, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        token: writeToken,
        goals_login: goalsLogin,
        goals,
      }),
      redirect: "follow",
      cache: "no-store",
    });
    const googleResult = await readJson(googleResponse);
    if (!googleResponse.ok || !googleResult.data) {
      console.error("Google Apps Script POST failed", googleResponse.status, googleResult.text?.slice(0, 500));
      return makeResponse(502, { success: false, error: "Не вдалося записати дані в Google Таблицю" });
    }
    if (googleResult.data.success === false) {
      return makeResponse(502, { success: false, error: googleResult.data.error || "Помилка Google Таблиці" });
    }

    return makeResponse(200, {
      success: true,
      goals_login: goalsLogin,
      goals: googleResult.data.goals || null,
      reports_refresh_required: Boolean(googleResult.data.reports_refresh_required),
      message: googleResult.data.message || null,
    });
  } catch (error) {
    console.error("google-goals-admin error", error);
    return makeResponse(500, { success: false, error: error?.message || "Помилка синхронізації цілей" });
  }
};
