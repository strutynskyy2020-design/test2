const normalizeKey = (value = "") => String(value ?? "")
  .replace(/[\u200B-\u200D\uFEFF]/g, "")
  .replace(/\u00A0/g, " ")
  .trim()
  .toLowerCase();

const hasValue = (value) => value !== undefined
  && value !== null
  && String(value).trim() !== "";

const firstValue = (object, keys) => {
  for (const key of keys) {
    if (hasValue(object?.[key])) return object[key];
  }
  return null;
};

const parseNullableSheetNumber = (value) => {
  if (!hasValue(value)) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const normalized = String(value)
    .replace(/\u00A0/g, "")
    .replace(/\s+/g, "")
    .replace(/%$/, "")
    .replace(",", ".")
    .replace(/[^0-9.+-]/g, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizePeriod = (value = "") => {
  const key = normalizeKey(value);
  return key.includes("yesterday") || key.includes("вчора") || key.includes("вчера")
    ? "yesterday"
    : "month";
};

const rowLogin = (row = {}) => normalizeKey(
  row.login || row.goals_login || row.operator || row.credit || row.debit,
);

const reportLoginCandidates = (report = {}, user = {}) => {
  const emailLogin = String(user?.email || "").split("@")[0];
  return new Set([
    report?.goals_login,
    report?.selected_report_login,
    user?.goals_login,
    emailLogin,
  ].map(normalizeKey).filter(Boolean));
};

const projectionFromLeaderboard = (report, candidates) => {
  const rows = Array.isArray(report?.deposit_projection_leaderboard)
    ? report.deposit_projection_leaderboard
    : [];
  const ownRow = rows.find((row) => candidates.has(rowLogin(row)));
  if (!ownRow) return null;

  const rawValue = firstValue(ownRow, [
    "projective_rate",
    "projection_rate",
    "projective",
    "projection",
    "overall",
    "result",
    "value",
  ]);
  const current = parseNullableSheetNumber(rawValue);
  if (current === null) return null;

  return {
    current,
    rawValue,
    source: "deposit_projection_leaderboard",
    row: ownRow,
  };
};

const projectionFromPersonalMetrics = (report) => {
  const rows = Array.isArray(report?.deposit_metrics) ? report.deposit_metrics : [];
  const monthRow = rows.find((row) => normalizePeriod(row?.period) === "month");
  if (!monthRow) return null;

  const rawValue = firstValue(monthRow, [
    "projective_rate",
    "projection_rate",
    "projective",
    "projection",
  ]);
  const current = parseNullableSheetNumber(rawValue);
  if (current === null) return null;

  return {
    current,
    rawValue,
    source: "deposit_metrics_month",
    row: monthRow,
  };
};

const projectionFromGoals = (report) => {
  const rawValue = firstValue(report?.goals, ["deposit_actual", "deposit_current"]);
  const current = parseNullableSheetNumber(rawValue);
  if (current === null) return null;
  return {
    current,
    rawValue,
    source: "goals_sheet",
    row: report?.goals || null,
  };
};

const resolveDepositProjectionCurrent = (report = {}, user = {}) => {
  const candidates = reportLoginCandidates(report, user);
  return projectionFromLeaderboard(report, candidates)
    || projectionFromPersonalMetrics(report)
    || projectionFromGoals(report)
    || { current: null, rawValue: null, source: "missing", row: null };
};

module.exports = {
  normalizeKey,
  parseNullableSheetNumber,
  resolveDepositProjectionCurrent,
};
