export const ACTIVATION_PROFILE = "activation";

export const normalizeReportProfile = (value) => (
  String(value || "").trim().toLowerCase() === ACTIVATION_PROFILE ? ACTIVATION_PROFILE : "sales"
);

export const normalizeLogin = (value) => String(value || "")
  .replace(/[\u200B-\u200D\uFEFF]/g, "")
  .replace(/\u00A0/g, " ")
  .trim()
  .toLowerCase();

export const normalizePeriod = (value) => {
  const key = normalizeLogin(value);
  return key.includes("yesterday") || key.includes("вчора") ? "yesterday" : "month";
};

export const parseReportNumber = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const source = String(value ?? "").trim();
  if (!source) return null;
  const parsed = Number(source
    .replace(/\u00A0/g, "")
    .replace(/\s+/g, "")
    .replace(/%$/, "")
    .replace(",", ".")
    .replace(/[^0-9.+-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};

export const formatPercent = (value, fallback = "—") => {
  const number = parseReportNumber(value);
  return number === null
    ? fallback
    : `${number.toLocaleString("uk-UA", { maximumFractionDigits: 2 })}%`;
};

export const formatCount = (value, fallback = "0") => {
  const number = parseReportNumber(value);
  return number === null
    ? fallback
    : number.toLocaleString("uk-UA", { maximumFractionDigits: 0 });
};

export const formatDuration = (value) => {
  const source = String(value ?? "").trim();
  return source || "—";
};

export const teamReportKey = (value) => {
  const normalized = String(value || "").trim().toLowerCase().replace(/[^a-zа-яіїєґ0-9]+/gi, "");
  const match = normalized.match(/(?:tm|тм)(\d+)/i);
  return match ? `tm${match[1]}` : normalized;
};

export const currentTeamKey = (report, user) => teamReportKey(
  report?.report_access?.current_team?.name
  || report?.report_access?.current_team?.key
  || user?.team_name
  || "",
);

export const rowForLogin = (rows, login) => {
  const target = normalizeLogin(login);
  return (Array.isArray(rows) ? rows : []).find((row) => (
    normalizeLogin(row?.goals_login || row?.login || row?.agent || row?.operator) === target
  )) || null;
};

export const periodRow = (rows, period) => (
  (Array.isArray(rows) ? rows : []).find((row) => normalizePeriod(row?.period) === period) || null
);

export const periodSummary = (summaries, period, teamKey) => {
  const periodObject = summaries?.[period] && typeof summaries[period] === "object"
    ? summaries[period]
    : {};
  if (teamKey && periodObject[teamKey]) return periodObject[teamKey];
  return periodObject.general || periodObject.overall || Object.values(periodObject)[0] || null;
};

export const valueStatus = (value, target = 100) => {
  const number = parseReportNumber(value);
  if (number === null) return { label: "Немає даних", color: "#8B93A7" };
  if (number >= target) return { label: "Ціль виконано", color: "#39FF14" };
  if (number >= target * 0.85) return { label: "На рівні", color: "#00F0FF" };
  if (number >= target * 0.65) return { label: "Зона росту", color: "#FFB800" };
  return { label: "Потрібна увага", color: "#FF4D55" };
};
