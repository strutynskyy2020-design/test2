const FUNCTION_VERSION = "google-goals-v3";

const makeResponse = (statusCode, body) => ({
  statusCode,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store, no-cache, must-revalidate",
    pragma: "no-cache",
    expires: "0",
  },
  body: JSON.stringify({
    version: FUNCTION_VERSION,
    ...body,
  }),
});

const normalizeKey = (value = "") =>
  String(value ?? "")
    .trim()
    .toLowerCase();

const getBackendProfileUrl = () => {
  const rawUrl = String(
    process.env.BACKEND_API_URL ||
      process.env.REACT_APP_BACKEND_URL ||
      ""
  )
    .trim()
    .replace(/\/+$/, "");

  if (!rawUrl) {
    return "";
  }

  if (rawUrl.endsWith("/api")) {
    return `${rawUrl}/auth/me`;
  }

  return `${rawUrl}/api/auth/me`;
};

const fetchWithTimeout = async (
  url,
  options = {},
  timeoutMs = 15000
) => {
  const controller = new AbortController();

  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
};

const safelyParseJson = async (response) => {
  const text = await response.text();

  if (!text) {
    return {
      data: null,
      rawText: "",
    };
  }

  try {
    return {
      data: JSON.parse(text),
      rawText: text,
    };
  } catch {
    return {
      data: null,
      rawText: text,
    };
  }
};

const extractUser = (payload) => {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  /*
   * Підтримуємо можливі формати:
   *
   * { goals_login: "fedun" }
   * { user: { goals_login: "fedun" } }
   * { data: { goals_login: "fedun" } }
   * { data: { user: { goals_login: "fedun" } } }
   */
  return (
    payload.user ||
    payload.data?.user ||
    payload.data ||
    payload
  );
};

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return makeResponse(405, {
      success: false,
      error: "Method not allowed",
    });
  }

  try {
    const authorization =
      event.headers?.authorization ||
      event.headers?.Authorization ||
      "";

    if (!authorization.startsWith("Bearer ")) {
      console.warn(`[${FUNCTION_VERSION}] Authorization header missing`);

      return makeResponse(401, {
        success: false,
        error: "Потрібна авторизація",
      });
    }

    const profileUrl = getBackendProfileUrl();

    if (!profileUrl) {
      console.error(`[${FUNCTION_VERSION}] Backend URL is missing`);

      return makeResponse(500, {
        success: false,
        error: "Не налаштовано адресу backend",
      });
    }

    console.log(`[${FUNCTION_VERSION}] Profile URL:`, profileUrl);

    const profileResponse = await fetchWithTimeout(
      profileUrl,
      {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization,
        },
      },
      15000
    );

    const profileResult = await safelyParseJson(
      profileResponse
    );

    if (!profileResponse.ok) {
      console.error(`[${FUNCTION_VERSION}] Profile request failed`, {
        status: profileResponse.status,
        response: profileResult.rawText.slice(0, 500),
      });

      return makeResponse(401, {
        success: false,
        error: "Сесію завершено. Увійдіть повторно",
        profile_status: profileResponse.status,
      });
    }

    const user = extractUser(profileResult.data);

    if (!user) {
      console.error(
        `[${FUNCTION_VERSION}] User profile has invalid format`,
        profileResult.rawText.slice(0, 500)
      );

      return makeResponse(502, {
        success: false,
        error: "Backend повернув неправильний профіль",
      });
    }

    const goalsLogin = normalizeKey(
      user.goals_login ||
        user.goalsLogin ||
        user.login2
    );

    console.log(`[${FUNCTION_VERSION}] User profile resolved`, {
      userId: user.id || user._id || null,
      email: user.email || null,
      goalsLogin: goalsLogin || null,
      availableKeys: Object.keys(user),
    });

    if (!goalsLogin) {
      return makeResponse(200, {
        success: true,
        found: false,
        reason: "goals_login_missing",
        goals_login: null,
        goals: null,
      });
    }

    const scriptUrl = String(
      process.env.GOOGLE_GOALS_SCRIPT_URL || ""
    ).trim();

    if (!scriptUrl) {
      console.error(
        `[${FUNCTION_VERSION}] GOOGLE_GOALS_SCRIPT_URL is missing`
      );

      return makeResponse(500, {
        success: false,
        error: "Google Таблицю не налаштовано",
      });
    }

    let googleUrl;

    try {
      googleUrl = new URL(scriptUrl);
    } catch {
      console.error(
        `[${FUNCTION_VERSION}] Invalid Google Apps Script URL`
      );

      return makeResponse(500, {
        success: false,
        error: "Некоректне посилання Google Apps Script",
      });
    }

    googleUrl.searchParams.set(
      "goals_login",
      goalsLogin
    );

    /*
     * Додаємо службовий параметр, щоб уникнути кешованої
     * відповіді Google або Service Worker.
     */
    googleUrl.searchParams.set("_ts", String(Date.now()));

    console.log(`[${FUNCTION_VERSION}] Google request`, {
      goalsLogin,
      url: googleUrl.toString(),
    });

    const googleResponse = await fetchWithTimeout(
      googleUrl.toString(),
      {
        method: "GET",
        headers: {
          accept: "application/json",
        },
        redirect: "follow",
      },
      20000
    );

    const googleResult = await safelyParseJson(
      googleResponse
    );

    console.log(`[${FUNCTION_VERSION}] Google response`, {
      status: googleResponse.status,
      data: googleResult.data,
      rawPreview: googleResult.rawText.slice(0, 500),
    });

    if (!googleResponse.ok) {
      return makeResponse(502, {
        success: false,
        error: "Google Apps Script повернув помилку",
        google_status: googleResponse.status,
      });
    }

    if (!googleResult.data) {
      return makeResponse(502, {
        success: false,
        error:
          "Google Apps Script повернув відповідь не у форматі JSON",
        google_response_preview:
          googleResult.rawText.slice(0, 300),
      });
    }

    if (googleResult.data.success === false) {
      return makeResponse(502, {
        success: false,
        error:
          googleResult.data.error ||
          "Помилка Google Таблиці",
      });
    }

    return makeResponse(200, {
      success: true,
      found: googleResult.data.found === true,
      reason: googleResult.data.found
        ? null
        : googleResult.data.reason ||
          "google_row_not_found",
      goals_login: goalsLogin,
      google_goals_login:
        googleResult.data.goals_login || null,
      goals: googleResult.data.goals || null,
    });
  } catch (error) {
    const isTimeout = error?.name === "AbortError";

    console.error(`[${FUNCTION_VERSION}] Unexpected error`, {
      name: error?.name,
      message: error?.message,
      stack: error?.stack,
    });

    return makeResponse(
      isTimeout ? 504 : 500,
      {
        success: false,
        error: isTimeout
          ? "Перевищено час очікування відповіді"
          : "Не вдалося завантажити цілі",
      }
    );
  }
};
