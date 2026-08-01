export const normalizeTeamKey = (value) => {
  const source = String(value || "").trim().toLowerCase();
  const compact = source.replace(/[^a-zа-яіїєґ0-9]+/gi, "");
  const match = compact.match(/(?:tm|тм)(\d+)/i);
  return match ? `tm${match[1]}` : compact;
};

export const participantTeamMap = (participants = []) => new Map(
  (Array.isArray(participants) ? participants : [])
    .map((participant) => [String(participant?.goals_login || "").trim().toLowerCase(), participant])
    .filter(([login]) => login)
);

export const filterRowsForTeam = (rows = [], participants = [], teamId = "") => {
  if (!teamId) return Array.isArray(rows) ? rows : [];
  const byLogin = participantTeamMap(participants);
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const login = String(row?.login || row?.goals_login || row?.operator || row?.credit || row?.debit || "").trim().toLowerCase();
    return byLogin.get(login)?.team_id === teamId;
  });
};

const average = (rows, field) => {
  const values = rows
    .map((row) => row?.[field])
    .filter((value) => value !== null && value !== undefined && String(value).trim() !== "")
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

export const calculatedGroupSummary = (rows = [], fields = [], teamName = "") => {
  if (!rows.length) return null;
  return {
    login: normalizeTeamKey(teamName) || "team",
    ...Object.fromEntries(fields.map((field) => [field, average(rows, field)])),
  };
};
