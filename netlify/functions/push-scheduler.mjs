const normalizeBackendUrl = (value) => String(value || "").replace(/\/+$/, "");

export default async () => {
  const backendUrl = normalizeBackendUrl(
    process.env.BACKEND_URL || process.env.REACT_APP_BACKEND_URL
  );
  const schedulerToken = String(process.env.PUSH_SCHEDULER_TOKEN || "");

  if (!backendUrl || !schedulerToken) {
    console.error("push-scheduler: BACKEND_URL or PUSH_SCHEDULER_TOKEN is missing");
    return new Response("Push scheduler is not configured", { status: 503 });
  }

  const response = await fetch(`${backendUrl}/api/internal/push-schedule`, {
    method: "POST",
    headers: {
      "X-Scheduler-Token": schedulerToken,
      "Content-Type": "application/json",
    },
    body: "{}",
  });

  const body = await response.text();
  if (!response.ok) {
    console.error(`push-scheduler: backend returned ${response.status}: ${body}`);
    return new Response(body || "Push scheduler failed", { status: response.status });
  }

  console.log(`push-scheduler: ${body}`);
  return new Response(body || "ok", {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
};

// Netlify runs this once per UTC hour. The backend evaluates Europe/Kyiv time,
// so 09:00, 12:00, 15:00 and 17:00 remain correct across daylight-saving time.
export const config = {
  schedule: "@hourly",
};
