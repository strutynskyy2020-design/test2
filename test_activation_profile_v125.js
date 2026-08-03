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
  id: "dzhunuso-user",
  email: "dzhunuso@example.com",
  name: "Джунусова Марина",
  role: "employee",
  team_id: "team-7",
  team_name: "TM7",
  goals_login: "dzhunuso",
  report_profile: "activation",
};

const activationSnapshot = {
  success: true,
  api_version: "v125-activation-report-profiles",
  report_mode: "manual_snapshot",
  snapshot_version: "snapshot-v125",
  snapshot_updated_at: "03.08.2026 19:46",
  goals_login: "dzhunuso",
  found: true,
  report_found: true,
  goals: null,
  activation_pumb_metrics: [{
    goals_login: "dzhunuso",
    login: "dzhunuso",
    period: "month",
    processed_tasks: "1024",
    aht: "00:02:54",
    agreement_rate: "68%",
    completion_rate: "50%",
    activation_from_agreements_rate: "36,1%",
    activation_online_rate: "31,84%",
    projective_rate: "121%",
  }],
  activation_pumb_leaderboard: [
    { login: "dzhunuso", projective_rate: "121%", team_key: "tm7" },
    { login: "kubraky", projective_rate: "127%", team_key: "tm7" },
  ],
  activation_pumb_group_summaries: { month: { tm7: { projective_rate: "101,60%" } }, yesterday: {} },
  activation_pumb_giving: [{ login: "dzhunuso", period: "month", overall: "318" }],
  activation_pumb_giving_leaderboard: [
    { login: "dzhunuso", period: "month", overall: "318" },
    { login: "kubraky", period: "month", overall: "999" },
  ],
  activation_pumb_giving_group_summaries: { month: { tm7: { overall: "5371" } }, yesterday: {} },
  activation_cards_metrics: [{
    login: "dzhunuso",
    period: "month",
    processed_tasks: "1059",
    aht: "00:02:56",
    agreement_to_processed_rate: "73,90%",
    activation_from_agreements_rate: "43,70%",
    activation_from_processed_rate: "32,30%",
  }],
  activation_cards_leaderboard: [
    { login: "dzhunuso", full_name: "Джунусова Марина Сергіївна", projective_rate: "126,80%", team_key: "tm7" },
    { login: "kubraky", full_name: "Кубрак Юлія", projective_rate: "130%", team_key: "tm7" },
  ],
  activation_cards_group_summaries: { tm7: { projective_rate: "100,00%" } },
  activation_cards_transformation_group_summaries: { month: { tm7: { activation_from_processed_rate: "28,30%" } }, yesterday: {} },
  activation_cards_giving: [{
    login: "dzhunuso",
    period: "month",
    segment_a: "67",
    segment_b: "60",
    segment_c: "41",
    segment_d: "225",
    overall: "393",
  }],
  activation_cards_giving_leaderboard: [
    { login: "dzhunuso", period: "month", segment_a: "67", segment_b: "60", segment_c: "41", segment_d: "225", overall: "393" },
    { login: "kubraky", period: "month", segment_a: "1", segment_b: "2", segment_c: "3", segment_d: "4", overall: "10" },
  ],
  activation_cards_giving_group_summaries: { month: { tm7: { segment_a: "1636", segment_b: "1114", segment_c: "696", segment_d: "2890", overall: "6336" } }, yesterday: {} },
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
      allowed_goals_logins: ["dzhunuso", "kubraky"],
      participants: [
        { id: user.id, name: user.name, goals_login: "dzhunuso", team_id: "team-7", team_name: "TM7", team_key: "tm7", report_profile: "activation" },
        { id: "kubraky-user", name: "Кубрак Юлія", goals_login: "kubraky", team_id: "team-7", team_name: "TM7", team_key: "tm7", report_profile: "sales" },
      ],
      access_signature: "sig-v125",
    });
  }
  if (target.startsWith(process.env.GOOGLE_GOALS_SCRIPT_URL)) return jsonResponse(activationSnapshot);
  throw new Error(`Unexpected fetch ${target}`);
};

(async () => {
  const gas = fs.readFileSync("integrations/google-sheets/Code.gs", "utf8");
  assert(gas.includes('REPORT_CACHE_API_VERSION = "v125-activation-report-profiles"'));
  assert(gas.includes('ACTIVATION_PUMB_SHEET_NAME = "Activation Pumb Online"'));
  assert(gas.includes('ACTIVATION_CARDS_SHEET_NAME = "Activation Cards"'));
  assert(gas.includes("segment_a"));
  assert(gas.includes("segment_d"));

  const gateway = require("./netlify/functions/google-goals.js");
  const result = await gateway.handler({
    httpMethod: "GET",
    headers: { authorization: "Bearer token" },
    queryStringParameters: {},
  });
  assert.equal(result.statusCode, 200);
  const body = JSON.parse(result.body);
  assert.equal(body.found, true);
  assert.equal(body.viewer_has_own_report, true);
  assert.equal(body.report_profile, "activation");
  assert.equal(body.activation_goals.pumb_online_actual, "121%");
  assert.equal(body.activation_goals.cards_actual, "126,80%");
  assert.equal(body.activation_goals.pumb_online_target, "100");
  assert.equal(body.activation_goals.cards_target, "100");
  assert.equal(body.activation_pumb_metrics.length, 1);
  assert.equal(body.activation_cards_metrics.length, 1);
  assert.deepEqual(
    [
      body.activation_cards_giving[0].segment_a,
      body.activation_cards_giving[0].segment_b,
      body.activation_cards_giving[0].segment_c,
      body.activation_cards_giving[0].segment_d,
    ],
    ["67", "60", "41", "225"],
  );
  assert.equal(body.activation_cards_giving_group_summaries.month.tm7.segment_d, "2890");
  assert.deepEqual(body.activation_pumb_leaderboard.map((row) => row.login), ["dzhunuso"]);
  assert.deepEqual(body.activation_cards_leaderboard.map((row) => row.login), ["dzhunuso"]);
  assert.equal(body.report_access.participants.find((row) => row.goals_login === "dzhunuso").report_profile, "activation");
  console.log("Activation report profile v125 gateway: PASS");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
