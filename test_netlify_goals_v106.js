const assert = require("assert");

const jsonResponse = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json" },
});

process.env.BACKEND_API_URL = "https://backend.example/api";
process.env.GOOGLE_GOALS_SCRIPT_URL = "https://script.example/exec";
process.env.GOOGLE_GOALS_WRITE_TOKEN = "secret";

const adminProfile = { id: "admin-1", email: "admin@callhub.ua", name: "Admin", role: "admin", team_id: null };
const leaderProfile = { id: "leader-1", email: "lead@callhub.ua", name: "Leader", role: "editor", team_id: "team-6", is_team_leader: true };
const teams = [{ id: "team-6", name: "TM6" }, { id: "team-7", name: "TM7" }];
const users = [
  { id: "u1", role: "employee", goals_login: "alice", team_id: "team-6" },
  { id: "u2", role: "employee", goals_login: "bob", team_id: "team-7" },
];
const firstReport = {
  success: true,
  api_version: "v106-admin-message-projection-fix",
  report_mode: "manual_snapshot",
  snapshot_version: "snap-1",
  snapshot_updated_at: "01.08.2026 20:00",
  snapshot_day: "2026-08-01",
  goals_login: "alice",
  found: true,
  goals: { credit_actual: "90%" },
  credit_metrics: [],
  credit_leaderboard: [{ login: "alice", overall: "100%" }, { login: "bob", overall: "95%" }],
  credit_group_summaries: { tm6: { overall: "100%" }, tm7: { overall: "95%" } },
  debit_leaderboard: [{ login: "alice", overall: "101%" }, { login: "bob", overall: "97%" }],
  debit_group_summaries: { tm6: { overall: "101%" }, tm7: { overall: "97%" } },
  debit_issuances: [],
  schedule: { found: false, reason: "none", days: [] },
};

let activeProfile = adminProfile;
let savedMessage = "";
let crossTeam = false;

global.fetch = async (url, options = {}) => {
  const target = String(url);
  if (target.endsWith("/api/auth/me")) return jsonResponse(activeProfile);
  if (target.endsWith("/api/goals/report-access")) return jsonResponse({ detail: "Not Found" }, 404);
  if (target.endsWith("/api/admin/goals-settings")) return jsonResponse({ detail: "Not Found" }, 404);
  if (target.endsWith("/api/leader/goals/team-message")) return jsonResponse({ detail: "Not Found" }, 404);
  if (target.endsWith("/api/teams")) return jsonResponse(teams);
  if (target.endsWith("/api/admin/users")) return jsonResponse(users);
  if (target === process.env.GOOGLE_GOALS_SCRIPT_URL) {
    const body = JSON.parse(options.body || "{}");
    assert.equal(body.token, "secret");
    if (body.action === "get_goals_settings") return jsonResponse({ success: true, allow_cross_team_reports: crossTeam });
    if (body.action === "set_goals_settings") {
      crossTeam = Boolean(body.allow_cross_team_reports);
      return jsonResponse({ success: true, allow_cross_team_reports: crossTeam });
    }
    if (body.action === "read_cached_report") return jsonResponse(firstReport);
    if (body.action === "read_all_goals") return jsonResponse({ success: true, goals_by_login: { alice: firstReport.goals }, snapshot_updated_at: firstReport.snapshot_updated_at });
    if (body.action === "get_team_message") return jsonResponse({ success: true, team_id: body.team_id, message: savedMessage });
    if (body.action === "set_team_message") {
      savedMessage = body.message;
      return jsonResponse({ success: true, team_id: body.team_id, message: savedMessage, updated_by_name: body.updated_by_name });
    }
    return jsonResponse({ success: false, error: `Unknown action ${body.action}` });
  }
  throw new Error(`Unexpected fetch ${target}`);
};

const authHeaders = { authorization: "Bearer token" };

(async () => {
  const googleGoals = require("./netlify/functions/google-goals.js");
  const adminResult = await googleGoals.handler({ httpMethod: "GET", headers: authHeaders, queryStringParameters: {} });
  assert.equal(adminResult.statusCode, 200);
  const adminBody = JSON.parse(adminResult.body);
  assert.equal(adminBody.privileged_overview, true);
  assert.equal(adminBody.viewer_has_own_report, false);
  assert.equal(adminBody.goals, null);
  assert.equal(adminBody.credit_leaderboard.length, 2);
  assert.equal(adminBody.report_access.teams.length, 2);

  const googleAdmin = require("./netlify/functions/google-goals-admin.js");
  const dashboardResult = await googleAdmin.handler({ httpMethod: "GET", headers: authHeaders });
  assert.equal(dashboardResult.statusCode, 200);
  assert.equal(JSON.parse(dashboardResult.body).goals_by_login.alice.credit_actual, "90%");

  const settingsFn = require("./netlify/functions/goals-settings.js");
  const settingsResult = await settingsFn.handler({
    httpMethod: "PATCH",
    headers: authHeaders,
    body: JSON.stringify({ allow_cross_team_reports: true }),
  });
  assert.equal(settingsResult.statusCode, 200);
  assert.equal(JSON.parse(settingsResult.body).allow_cross_team_reports, true);

  activeProfile = leaderProfile;
  const messageFn = require("./netlify/functions/goals-team-message.js");
  const messageResult = await messageFn.handler({
    httpMethod: "PUT",
    headers: authHeaders,
    body: JSON.stringify({ team_id: "team-6", message: "Сьогодні фокус на X-Sell" }),
    queryStringParameters: {},
  });
  assert.equal(messageResult.statusCode, 200);
  assert.equal(JSON.parse(messageResult.body).message, "Сьогодні фокус на X-Sell");

  console.log("Validated v106 Netlify compatibility gateways");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
