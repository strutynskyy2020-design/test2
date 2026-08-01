const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { pathToFileURL } = require("url");

const root = __dirname;
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

(async () => {
  const helperPath = path.join(root, "frontend/src/lib/teamReports.js");
  const helperSource = read("frontend/src/lib/teamReports.js");
  const helperModule = await import(`data:text/javascript;base64,${Buffer.from(helperSource).toString("base64")}`);

  const rows = [
    { login: "Fedun", overall: "155,45%" },
    { login: "NECHYLOV", overall: "151,52%" },
  ];
  const participants = [
    { goals_login: "fedun", team_id: "team-tm6", team_name: "TM6", avatar_url: "/fedun.png" },
    { goals_login: "nechylov", team_id: "team-tm7", team_name: "TM7" },
  ];
  const enriched = helperModule.enrichReportRowsWithParticipants(rows, participants);
  assert.equal(enriched[0].login, "fedun");
  assert.equal(enriched[0].team_id, "team-tm6");
  assert.equal(enriched[0].team_key, "tm6");
  assert.equal(enriched[0].avatar_url, "/fedun.png");
  assert.equal(helperModule.rowMatchesTeam(enriched[0], { id: "team-tm6", name: "TM6" }), true);
  assert.equal(helperModule.rowMatchesTeam(enriched[0], { id: "another-id", name: "TM6" }), true);
  assert.equal(helperModule.rowMatchesTeam(enriched[0], { id: "team-tm7", name: "TM7" }), false);

  for (const page of ["CreditLeaderboard.jsx", "DebitLeaderboard.jsx"]) {
    const source = read(`frontend/src/pages/${page}`);
    assert(source.includes("team_id: String(row?.team_id || \"\").trim()"), `${page}: team_id must survive normalization`);
    assert(source.includes("team_key: normalizeTeamKey(row?.team_key || row?.team_name)"), `${page}: team_key must survive normalization`);
    assert(source.includes("enrichReportRowsWithParticipants(rawRows, participants)"), `${page}: rows must be enriched`);
    assert(source.includes("rowMatchesTeam(row, selectedTeam)"), `${page}: robust team filter missing`);
    assert(source.includes("gatewayAlreadyScoped"), `${page}: scoped compatibility fallback missing`);
  }

  const backend = read("backend/server.py");
  assert(backend.includes('"participants": participants'), "Backend report-access must return participants");
  assert(backend.includes('"participant_teams": participant_teams'), "Access signature must track team assignments");

  const gateway = read("netlify/functions/google-goals.js");
  assert(gateway.includes("const enrichRowsWithParticipants"), "Gateway enrichment helper missing");
  assert(gateway.includes("credit_leaderboard: creditLeaderboard"), "Credit rows are not enriched in gateway response");
  assert(gateway.includes("debit_leaderboard: debitLeaderboard"), "Debit rows are not enriched in gateway response");

  const serviceWorker = read("frontend/public/service-worker.js");
  assert(serviceWorker.includes('const VERSION = "vpdk-v111";'), "PWA cache version was not bumped");

  console.log("v111 Google reports team-filter validation passed");
})();
