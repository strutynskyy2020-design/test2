const assert = require("assert");

const jsonResponse = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json" },
});

process.env.BACKEND_API_URL = "https://backend.example/api";
process.env.GOOGLE_GOALS_SCRIPT_URL = "https://script.example/exec";
delete process.env.GOOGLE_GOALS_WRITE_TOKEN;

const report = {
  success: true,
  api_version: "v114",
  report_mode: "manual_snapshot",
  snapshot_version: "snapshot-overall-1",
  snapshot_updated_at: "03.08.2026 12:00",
  snapshot_day: "2026-08-03",
  found: true,
  goals_login: "znachkoo",
  goals: {},
  credit_metrics: [{
    goals_login: "znachkoo",
    channel: "xsell",
    period: "month",
    processed_tasks: "188",
    processed_tasks_overall: "24532",
    projective_rate: "66,71%",
    projective_rate_overall: "8,63%",
    agreement_rate_overall: "30,75%",
    team_overall: {
      tm6: {
        processed_tasks_overall: "3096",
        projective_rate_overall: "100,47%",
        agreement_rate_overall: "32,66%",
      },
    },
    projective_source: {
      sheet: "Transformation",
      general_column: "Загальний підсумок",
      team_columns: { tm6: "TM_6 Підсумок" },
    },
  }],
  credit_leaderboard: [],
  credit_group_summaries: {},
  debit_leaderboard: [],
  debit_group_summaries: {},
  debit_issuances: [],
  schedule: { found: false, reason: "none", days: [] },
};

global.fetch = async (url) => {
  const target = String(url);
  if (target.endsWith("/api/auth/me")) {
    return jsonResponse({
      id: "u1",
      email: "znachkoo@callhub.ua",
      goals_login: "znachkoo",
      role: "employee",
      team_id: "team-6",
      team_name: "TM6",
    });
  }
  if (target.endsWith("/api/goals/report-access")) {
    return jsonResponse({
      allow_cross_team_reports: false,
      current_team: { id: "team-6", name: "TM6" },
      teams: [{ id: "team-6", name: "TM6" }],
      allowed_goals_logins: ["znachkoo"],
      participants: [{ goals_login: "znachkoo", team_id: "team-6", team_name: "TM6", team_key: "tm6" }],
      access_signature: "access-1",
    });
  }
  if (target.startsWith(process.env.GOOGLE_GOALS_SCRIPT_URL)) return jsonResponse(report);
  throw new Error(`Unexpected fetch: ${target}`);
};

(async () => {
  const { handler } = require("./netlify/functions/google-goals.js");
  const response = await handler({
    httpMethod: "GET",
    headers: { authorization: "Bearer test" },
    queryStringParameters: {},
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.credit_metrics.length, 1);
  const metric = body.credit_metrics[0];

  assert.equal(metric.projective_rate, "66,71%");
  assert.equal(metric.projective_rate_overall, "8,63%", "must preserve global summary");
  assert.equal(metric.processed_tasks_overall, "24532", "must preserve global processed total");
  assert.equal(metric.agreement_rate_overall, "30,75%", "must preserve all global metrics");
  assert.equal(Object.prototype.hasOwnProperty.call(metric, "team_overall"), false, "private team metadata must not leak");

  console.log("VPDK v115 global overall summary test passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
