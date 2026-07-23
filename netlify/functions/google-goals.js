const makeResponse = (statusCode, body) => ({
  statusCode,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  },
  body: JSON.stringify(body),
});

const normalizeKey = (value = "") => String(value).trim().toLowerCase();

const backendProfileUrl = () => {
  const raw = String(
    process.env.BACKEND_API_URL ||
    process.env.REACT_APP_BACKEND_URL ||
    ""
  ).replace(/\/$/, "");
  if (!raw) return "";
  return raw.endsWith("/api") ? `${raw}/auth/me` : `${raw}/api/auth/me`;
};

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

    const goalsLogin = normalizeKey(user.goals_login);
    if (!goalsLogin) {
      return makeResponse(200, {
        success: true,
        found: false,
        reason: "goals_login_missing",
        goals: null,
      });
    }

    const scriptUrl = process.env.GOOGLE_GOALS_SCRIPT_URL;
    if (!scriptUrl) {
      return makeResponse(500, { success: false, error: "Google Таблицю не налаштовано" });
    }

    const url = new URL(scriptUrl);
    url.searchParams.set("goals_login", goalsLogin);
    const googleResponse = await fetch(url, {
      headers: { accept: "application/json" },
      redirect: "follow",
    });
    const data = await googleResponse.json().catch(() => null);
    if (!googleResponse.ok || !data) {
      console.error("Google Apps Script response error", { status: googleResponse.status });
      return makeResponse(502, { success: false, error: "Не вдалося отримати цілі з Google Таблиці" });
    }
    if (data.success === false) {
      return makeResponse(502, { success: false, error: data.error || "Помилка Google Таблиці" });
    }

    return makeResponse(200, {
      success: true,
      found: Boolean(data.found),
      reason: data.reason || null,
      goals_login: goalsLogin,
      goals: data.goals || null,
      credit_metrics: Array.isArray(data.credit_metrics) ? data.credit_metrics : [],
      credit_leaderboard: Array.isArray(data.credit_leaderboard) ? data.credit_leaderboard : [],
      credit_group_summary: data.credit_group_summary || null,
      credit_leaderboard_updated_at: data.credit_leaderboard_updated_at || null,
      debit_leaderboard: Array.isArray(data.debit_leaderboard) ? data.debit_leaderboard : [],
      debit_group_summary: data.debit_group_summary || null,
      debit_leaderboard_updated_at: data.debit_leaderboard_updated_at || null,
      debit_issuances: Array.isArray(data.debit_issuances) ? data.debit_issuances : [],
    });
  } catch (error) {
    console.error("google-goals error", error);
    return makeResponse(500, { success: false, error: "Не вдалося завантажити цілі" });
  }
};
