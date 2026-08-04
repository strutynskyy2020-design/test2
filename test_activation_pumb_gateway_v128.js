const assert = require("assert");

const jsonResponse = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json" },
});

process.env.BACKEND_API_URL = "https://backend.example/api";
process.env.GOOGLE_GOALS_SCRIPT_URL = "https://script.example/exec";
delete process.env.GOOGLE_GOALS_WRITE_TOKEN;

const user = {
  id: "dzhunuso-user",
  email: "dzhunuso@example.com",
  name: "Джунусова Марина",
  role: "employee",
  team_id: "team-7",
  team_name: "TM7",
  goals_login: "dzhunuso",
  report_profile: "activation",
};

const snapshot = {
  success: true,
  api_version: "v128-activation-data-tasks-team-filters",
  report_mode: "manual_snapshot",
  snapshot_version: "snapshot-v128",
  snapshot_updated_at: "04.08.2026 10:19",
  found: true,
  report_found: true,
  activation_pumb_metrics: [
    { login: "kameava", period: "month", processed_tasks: "2344", projective_rate: "94%" },
    { period: "yesterday", team_key: "tm7", processed_tasks: "324", aht: "00:01:38" },
    {
      login: "dzhunuso",
      goals_login: "dzhunuso",
      period: "month",
      team_key: "tm7",
      processed_tasks: "1024",
      processed_tasks_team: "21350",
      aht: "00:02:54",
      aht_team: "00:01:47",
      agreement_rate: "68%",
      agreement_rate_team: "66%",
      completion_rate: "50%",
      completion_rate_team: "48%",
      activation_from_agreements_rate: "36,1%",
      activation_from_agreements_rate_team: "32,1%",
      activation_online_rate: "31,84%",
      activation_online_rate_team: "26,64%",
      projective_rate: "121%",
      projective_rate_team: "101,60%",
      team_summary: { processed_tasks: "21350", projective_rate: "101,60%" },
    },
  ],
  activation_pumb_leaderboard: [{ login: "dzhunuso", team_key: "tm7", projective_rate: "121%" }],
  activation_pumb_group_summaries: {
    month: { tm7: { processed_tasks: "21350", aht: "00:01:47", projective_rate: "101,60%" } },
    yesterday: { tm7: { processed_tasks: "324", aht: "00:01:38", projective_rate: "108,70%" } },
  },
  activation_pumb_giving: [
    { login: "leukhina", period: "month", overall: "759" },
    { period: "yesterday", team_key: "tm7", overall: "27" },
    { login: "dzhunuso", period: "month", team_key: "tm7", overall: "318", team_overall: "5371" },
  ],
  activation_pumb_giving_leaderboard: [{ login: "dzhunuso", period: "month", overall: "318" }],
  activation_pumb_giving_group_summaries: {
    month: { tm7: { overall: "5371" } },
    yesterday: { tm7: { overall: "27" } },
  },
  activation_cards_metrics: [],
  activation_cards_leaderboard: [],
  activation_cards_giving: [],
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
      allowed_goals_logins: ["dzhunuso"],
      participants: [{ ...user, goals_login: "dzhunuso", team_key: "tm7" }],
      access_signature: "sig-v128",
    });
  }
  if (target.startsWith(process.env.GOOGLE_GOALS_SCRIPT_URL)) return jsonResponse(snapshot);
  throw new Error(`Unexpected fetch ${target}`);
};

(async () => {
  const gateway = require("./netlify/functions/google-goals.js");
  const result = await gateway.handler({
    httpMethod: "GET",
    headers: { authorization: "Bearer token" },
    queryStringParameters: {},
  });
  assert.equal(result.statusCode, 200);
  const body = JSON.parse(result.body);
  assert.equal(body.activation_pumb_metrics.length, 1);
  assert.equal(body.activation_pumb_metrics[0].login, "dzhunuso");
  assert.equal(body.activation_pumb_metrics[0].processed_tasks, "1024");
  assert.equal(body.activation_pumb_metrics[0].processed_tasks_team, "21350");
  assert.equal(body.activation_pumb_metrics[0].aht, "00:02:54");
  assert.equal(body.activation_pumb_metrics[0].aht_team, "00:01:47");
  assert.equal(body.activation_pumb_metrics[0].projective_rate_team, "101,60%");
  assert.equal(body.activation_pumb_giving.length, 1);
  assert.equal(body.activation_pumb_giving[0].overall, "318");
  assert.equal(body.activation_pumb_giving[0].team_overall, "5371");
  assert.equal(body.activation_goals.pumb_online_actual, "121%");
  console.log("Activation PUMB personal gateway v128: PASS");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
