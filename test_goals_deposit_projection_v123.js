const assert = require("assert");
const fs = require("fs");
const {
  parseNullableSheetNumber,
  resolveDepositProjectionCurrent,
} = require("./frontend/src/lib/depositProjection");

assert.equal(parseNullableSheetNumber("89,16%"), 89.16);
assert.equal(parseNullableSheetNumber(" 113,45 % "), 113.45);
assert.equal(parseNullableSheetNumber(""), null);

const user = { goals_login: "Mukovoz", email: "mukovoz@example.com" };

const fromLeaderboard = resolveDepositProjectionCurrent({
  goals_login: "mukovoz",
  goals: { deposit_actual: "0%", deposit_target: "100%" },
  deposit_projection_leaderboard: [
    { login: "fedun", projective_rate: "113,45%" },
    { login: "mukovoz", projective_rate: "89,16%" },
  ],
  deposit_metrics: [{ period: "month", projective_rate: "88,00%" }],
}, user);
assert.equal(fromLeaderboard.current, 89.16);
assert.equal(fromLeaderboard.source, "deposit_projection_leaderboard");

const fromMetrics = resolveDepositProjectionCurrent({
  goals_login: "mukovoz",
  goals: { deposit_actual: "0%" },
  deposit_projection_leaderboard: [],
  deposit_metrics: [
    { period: "yesterday", projective_rate: "74,00%" },
    { period: "Місяць", projective_rate: "91,25%" },
  ],
}, user);
assert.equal(fromMetrics.current, 91.25);
assert.equal(fromMetrics.source, "deposit_metrics_month");

const fromGoals = resolveDepositProjectionCurrent({
  goals: { deposit_actual: "77,50%" },
  deposit_projection_leaderboard: [],
  deposit_metrics: [],
}, user);
assert.equal(fromGoals.current, 77.5);
assert.equal(fromGoals.source, "goals_sheet");

const goalsSource = fs.readFileSync("frontend/src/pages/Goals.jsx", "utf8");
assert(goalsSource.includes("resolveDepositProjectionCurrent(report, user)"));
assert(goalsSource.includes('name === "deposit" && depositProjection.current !== null'));
assert(goalsSource.includes('source: name === "deposit" ? depositProjection.source : "goals_sheet"'));

console.log("Goals deposit projection v123: leaderboard -> personal metrics -> goals fallback OK");
