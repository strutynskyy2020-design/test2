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
  if (!["GET", "PUT", "POST"].includes(event.httpMethod)) {
    return makeResponse(405, { success: false, error: "Method not allowed" });
  }

  try {
    const authorization = event.headers?.authorization || event.headers?.Authorization || "";
    if (!authorization.startsWith("Bearer ")) {
      return makeResponse(401, { success: false, error: "Потрібна авторизація" });
    }
    const user = await getProfile(authorization);
    const body = event.httpMethod === "GET" ? {} : JSON.parse(event.body || "{}");
    const requestedTeamId = String(
      body.team_id || event.queryStringParameters?.team_id || user.team_id || "",
    ).trim();
    const isAdmin = user.role === "admin" || user.role === "editor";

    if (!requestedTeamId) {
      return makeResponse(200, {
        success: true,
        team_id: null,
        message: "",
        updated_at: null,
        updated_by_name: null,
      });
    }
    if (!isAdmin && requestedTeamId !== String(user.team_id || "")) {
      return makeResponse(403, { success: false, error: "Немає доступу до іншої команди" });
    }

    if (event.httpMethod === "GET") {
      const data = await googleAction("get_team_message", { team_id: requestedTeamId });
      return makeResponse(200, data);
    }

    if (!isAdmin && !user.is_team_leader) {
      return makeResponse(403, { success: false, error: "Повідомлення може змінювати лише керівник команди" });
    }
    const message = String(body.message || "").trim().slice(0, 1200);
    const [googleData, backendData] = await Promise.all([
      googleAction("set_team_message", {
        team_id: requestedTeamId,
        message,
        updated_by: user.id || "",
        updated_by_name: user.name || "Керівник",
      }),
      requestedTeamId === String(user.team_id || "")
        ? backendRequest("/leader/goals/team-message", authorization, {
          method: "PUT",
          body: { message },
          optional: true,
        })
        : Promise.resolve(null),
    ]);
    return makeResponse(200, { ...googleData, ...(backendData || {}), success: true });
  } catch (error) {
    console.error("goals-team-message error", error);
    return makeResponse(error?.status === 401 ? 401 : 500, {
      success: false,
      error: error?.message || "Не вдалося зберегти повідомлення",
    });
  }
};
