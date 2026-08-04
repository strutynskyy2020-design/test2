const fs = require("fs");
const assert = require("assert");

const jsonResponse = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json" },
});

process.env.BACKEND_API_URL = "https://backend.example/api";
process.env.GOOGLE_GOALS_SCRIPT_URL = "https://script.example/exec";
delete process.env.GOOGLE_GOALS_WRITE_TOKEN;

const user = {
  id: "kubraky-user",
  email: "kubraky@example.com",
  name: "Кубрак Юлія",
  role: "employee",
  team_id: "team-7",
  team_name: "TM7",
  goals_login: "kubraky",
};

const oldSnapshotWithoutGoalsRow = {
  success: true,
  api_version: "v122-deposit-projection-compact-layout",
  report_mode: "manual_snapshot",
  snapshot_version: "snapshot-old",
  snapshot_updated_at: "03.08.2026 19:00",
  goals_login: "kubraky",
  found: false,
  reason: "key_not_found",
  goals: null,
  credit_metrics: [{ channel: "xsell", period: "month", projective_rate: "108,20%" }],
  credit_leaderboard: [{ login: "kubraky", overall: "107,63%" }],
  credit_group_summaries: { tm7: { overall: "109,50%" } },
  debit_leaderboard: [{ login: "kubraky", overall: "116,90%" }],
  debit_group_summaries: { tm7: { overall: "109,50%" } },
  debit_issuances: [{ goals_login: "kubraky", period: "month", overall: "12" }],
  deposit_metrics: [{ goals_login: "kubraky", period: "month", projective_rate: "127,63%" }],
  deposit_projection_leaderboard: [{ login: "kubraky", projective_rate: "127,63%", team_key: "tm7" }],
  deposit_projection_group_summaries: { tm7: { projective_rate: "127,85%" } },
  deposit_leaderboard: [{ login: "kubraky", period: "month", overall: "8", team_key: "tm7" }],
  deposit_group_summaries: { month: { tm7: { overall: "20" } }, yesterday: {} },
  deposit_issuances: [{ login: "kubraky", period: "month", overall: "8" }],
  schedule: { found: false, days: [] },
};

global.fetch = async (url) => {
  const target = String(url);
  if (target.endsWith("/api/auth/me")) return jsonResponse(user);
  if (target.endsWith("/api/goals/report-access")) {
    return jsonResponse({
      allow_cross_team_reports: false,
      current_team: { id: "team-7", name: "TM7" },
      teams: [{ id: "team-7", name: "TM7" }],
      allowed_goals_logins: ["kubraky"],
      participants: [{ id: user.id, name: user.name, goals_login: "kubraky", team_id: "team-7", team_name: "TM7", team_key: "tm7" }],
      access_signature: "sig-v124",
    });
  }
  if (target.startsWith(process.env.GOOGLE_GOALS_SCRIPT_URL)) return jsonResponse(oldSnapshotWithoutGoalsRow);
  throw new Error(`Unexpected fetch ${target}`);
};

(async () => {
  const gas = fs.readFileSync("integrations/google-sheets/Code.gs", "utf8");
  assert(gas.includes('REPORT_CACHE_API_VERSION = "v129-pumb-period-boundary-fix"'));
  assert(gas.includes("scheduleLogins, creditLogins, debitLogins, depositLogins, depositProjectionLogins"));
  assert(gas.includes("credit_metrics: creditMetrics"));
  assert(!gas.includes("credit_metrics: hasGoalRow ? getCreditMetricRows"));
  assert(gas.includes("goals_auto_generated"));

  const gateway = require("./netlify/functions/google-goals.js");
  const result = await gateway.handler({
    httpMethod: "GET",
    headers: { authorization: "Bearer token" },
    queryStringParameters: {},
  });
  assert.equal(result.statusCode, 200);
  const body = JSON.parse(result.body);
  assert.equal(body.found, true);
  assert.equal(body.report_found, true);
  assert.equal(body.viewer_has_own_report, true);
  assert.equal(body.goals_found, false);
  assert.equal(body.goals.goals_auto_generated, "true");
  assert.equal(body.goals.credit_actual, "107,63%");
  assert.equal(body.goals.debit_actual, "116,90%");
  assert.equal(body.goals.deposit_actual, "127,63%");
  assert.equal(body.goals.credit_target, "110");
  assert.equal(body.goals.debit_target, "105");
  assert.equal(body.goals.deposit_target, "100");
  assert.equal(body.credit_metrics.length, 1);
  assert.equal(body.debit_issuances.length, 1);
  assert.equal(body.deposit_metrics.length, 1);
  console.log("All-operators reports v124: PASS");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
