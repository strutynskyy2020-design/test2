const response = (statusCode, body, cacheable = false) => ({
  statusCode,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": cacheable
      ? "public, max-age=60"
      : "no-store",
    ...(cacheable ? {
      "netlify-cdn-cache-control": "public, durable, max-age=300",
      "netlify-cache-tag": "tm6-google-reports-manifest",
    } : {}),
  },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return response(405, { success: false, error: "Method not allowed" });
  }

  try {
    const scriptUrl = String(process.env.GOOGLE_GOALS_SCRIPT_URL || "").trim();
    if (!scriptUrl) {
      return response(500, { success: false, error: "Google Таблицю не налаштовано" });
    }

    const url = new URL(scriptUrl);
    url.searchParams.set("mode", "manifest");
    const googleResponse = await fetch(url, {
      headers: { accept: "application/json" },
      redirect: "follow",
    });
    const data = await googleResponse.json().catch(() => null);

    if (!googleResponse.ok || !data || data.success === false) {
      return response(502, {
        success: false,
        error: data?.error || "Не вдалося перевірити версію звітів",
      });
    }

    return response(200, {
      success: true,
      api_version: data.api_version || null,
      report_mode: data.report_mode || "manual_snapshot",
      snapshot_version: data.snapshot_version || null,
      snapshot_updated_at: data.snapshot_updated_at || null,
      snapshot_day: data.snapshot_day || null,
    }, true);
  } catch (error) {
    console.error("google-goals-version error", error);
    return response(500, {
      success: false,
      error: error?.message || "Не вдалося перевірити версію звітів",
    });
  }
};
