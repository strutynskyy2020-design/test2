const FUNCTION_VERSION = "google-goals-admin-v4";

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

const backendBaseUrl = () =>
  String(
    process.env.BACKEND_API_URL ||
      process.env.REACT_APP_BACKEND_URL ||
      ""
  )
    .trim()
    .replace(/\/+$/, "");

const backendApiUrl = (path) => {
  const base = backendBaseUrl();

  if (!base) {
    return "";
  }

  return base.endsWith("/api")
    ? `${base}${path}`
    : `${base}/api${path}`;
};

const readJson = async (response) => {
  const text = await response.text();

  try {
    return {
      data: text ? JSON.parse(text) : null,
      text,
    };
  } catch {
    return {
      data: null,
      text,
    };
  }
};

const fetchBackend = async (url, authorization) => {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      accept: "application/json",
      authorization,
    },
    cache: "no-store",
  });

  const result = await readJson(response);

  return {
    response,
    result,
  };
};

const extractArray = (payload) => {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (Array.isArray(payload?.users)) {
    return payload.users;
  }

  if (Array.isArray(payload?.data)) {
    return payload.data;
  }

  if (Array.isArray(payload?.items)) {
    return payload.items;
  }

  return [];
};

const getUserId = (user) =>
  String(
    user?.id ||
      user?._id ||
      user?.user_id ||
      ""
  );

const googleGet = async (scriptUrl, goalsLogin) => {
  const url = new URL(scriptUrl);

  url.searchParams.set(
    "goals_login",
    goalsLogin
  );

  url.searchParams.set(
    "_ts",
    String(Date.now())
  );

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      accept: "application/json",
    },
    redirect: "follow",
    cache: "no-store",
  });

  const result = await readJson(response);

  if (!response.ok || !result.data) {
    throw new Error(
      `Google Apps Script GET failed (${response.status})`
    );
  }

  if (result.data.success === false) {
    throw new Error(
      result.data.error || "Google Sheets error"
    );
  }

  return result.data;
};

exports.handler = async (event) => {
  if (!["GET", "POST"].includes(event.httpMethod)) {
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
      return makeResponse(401, {
        success: false,
        error: "Потрібна авторизація",
      });
    }

    const dashboardUrl = backendApiUrl(
      "/admin/goals-dashboard"
    );

    const usersUrl = backendApiUrl(
      "/admin/users"
    );

    if (!dashboardUrl || !usersUrl) {
      return makeResponse(500, {
        success: false,
        error: "Не налаштовано адресу backend",
      });
    }

    /*
     * goals-dashboard перевіряє JWT та роль адміністратора.
     */
    const dashboardRequest = await fetchBackend(
      dashboardUrl,
      authorization
    );

    if (!dashboardRequest.response.ok) {
      return makeResponse(
        dashboardRequest.response.status === 403
          ? 403
          : 401,
        {
          success: false,
          error:
            dashboardRequest.result.data?.detail ||
            "Доступ лише для адміністратора",
        }
      );
    }

    const dashboardUsers = extractArray(
      dashboardRequest.result.data
    );

    /*
     * Окремо завантажуємо повні профілі,
     * оскільки goals-dashboard може не повертати goals_login.
     */
    const usersRequest = await fetchBackend(
      usersUrl,
      authorization
    );

    if (!usersRequest.response.ok) {
      console.error(
        `[${FUNCTION_VERSION}] /admin/users failed`,
        {
          status: usersRequest.response.status,
          response:
            usersRequest.result.text?.slice(0, 500),
        }
      );

      return makeResponse(502, {
        success: false,
        error:
          "Не вдалося завантажити профілі користувачів",
      });
    }

    const fullUsers = extractArray(
      usersRequest.result.data
    );

    const fullUsersById = new Map(
      fullUsers.map((user) => [
        getUserId(user),
        user,
      ])
    );

    /*
     * Об'єднуємо дані двох endpoint.
     * goals_login беремо насамперед із /admin/users.
     */
    const mergedUsers = dashboardUsers.map(
      (dashboardUser) => {
        const userId = getUserId(dashboardUser);
        const fullUser =
          fullUsersById.get(userId) || {};

        return {
          ...dashboardUser,
          ...fullUser,
          goals_login:
            fullUser.goals_login ||
            fullUser.goalsLogin ||
            fullUser.login2 ||
            dashboardUser.goals_login ||
            dashboardUser.goalsLogin ||
            dashboardUser.login2 ||
            "",
        };
      }
    );

    console.log(
      `[${FUNCTION_VERSION}] Users resolved`,
      mergedUsers.map((user) => ({
        id: getUserId(user),
        name: user.name || user.full_name || null,
        goals_login:
          normalizeKey(user.goals_login) || null,
      }))
    );

    const scriptUrl = String(
      process.env.GOOGLE_GOALS_SCRIPT_URL || ""
    ).trim();

    if (!scriptUrl) {
      return makeResponse(500, {
        success: false,
        error: "Google Таблицю не налаштовано",
      });
    }

    if (event.httpMethod === "GET") {
      const keys = [
        ...new Set(
          mergedUsers
            .map((user) =>
              normalizeKey(user.goals_login)
            )
            .filter(Boolean)
        ),
      ];

      console.log(
        `[${FUNCTION_VERSION}] Loading Google keys`,
        keys
      );

      const entries = await Promise.all(
        keys.map(async (key) => {
          try {
            const data = await googleGet(
              scriptUrl,
              key
            );

            console.log(
              `[${FUNCTION_VERSION}] Google row`,
              {
                key,
                found: data.found === true,
              }
            );

            return [
              key,
              data.found === true
                ? data.goals
                : null,
            ];
          } catch (error) {
            console.error(
              `[${FUNCTION_VERSION}] Google load failed`,
              {
                key,
                message: error?.message,
              }
            );

            return [key, null];
          }
        })
      );

      const goalsByLogin =
        Object.fromEntries(
          entries.filter(
            ([, value]) => value !== null
          )
        );

      return makeResponse(200, {
        success: true,
        keys,
        goals_by_login: goalsByLogin,
      });
    }

    const payload = JSON.parse(
      event.body || "{}"
    );

    const goalsLogin = normalizeKey(
      payload.goals_login
    );

    const goals = payload.goals;

    if (
      !goalsLogin ||
      !goals ||
      typeof goals !== "object"
    ) {
      return makeResponse(400, {
        success: false,
        error:
          "goals_login і goals обов'язкові",
      });
    }

    const allowed = mergedUsers.some(
      (user) =>
        normalizeKey(user.goals_login) ===
        goalsLogin
    );

    if (!allowed) {
      return makeResponse(404, {
        success: false,
        error:
          "Користувача з таким Google-ключем не знайдено",
      });
    }

    const writeToken = String(
      process.env
        .GOOGLE_GOALS_WRITE_TOKEN || ""
    ).trim();

    if (!writeToken) {
      return makeResponse(500, {
        success: false,
        error:
          "Не налаштовано GOOGLE_GOALS_WRITE_TOKEN",
      });
    }

    const googleResponse = await fetch(
      scriptUrl,
      {
        method: "POST",
        headers: {
          "content-type":
            "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          token: writeToken,
          goals_login: goalsLogin,
          goals,
        }),
        redirect: "follow",
        cache: "no-store",
      }
    );

    const googleResult = await readJson(
      googleResponse
    );

    if (
      !googleResponse.ok ||
      !googleResult.data
    ) {
      console.error(
        `[${FUNCTION_VERSION}] Google POST failed`,
        {
          status: googleResponse.status,
          response:
            googleResult.text?.slice(0, 500),
        }
      );

      return makeResponse(502, {
        success: false,
        error:
          "Не вдалося записати дані в Google Таблицю",
      });
    }

    if (
      googleResult.data.success === false
    ) {
      return makeResponse(502, {
        success: false,
        error:
          googleResult.data.error ||
          "Помилка Google Таблиці",
      });
    }

    return makeResponse(200, {
      success: true,
      goals_login: goalsLogin,
      goals:
        googleResult.data.goals || null,
    });
  } catch (error) {
    console.error(
      `[${FUNCTION_VERSION}] Unexpected error`,
      error
    );

    return makeResponse(500, {
      success: false,
      error:
        error?.message ||
        "Помилка синхронізації цілей",
    });
  }
};
