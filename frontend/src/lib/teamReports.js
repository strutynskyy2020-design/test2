export const normalizeTeamKey = (value) => {
  const source = String(value || "").trim().toLowerCase();
  const compact = source.replace(/[^a-zа-яіїєґ0-9]+/gi, "");
  const match = compact.match(/(?:tm|тм)(\d+)/i);
  return match ? `tm${match[1]}` : compact;
};

export const normalizeReportLogin = (value) => String(value || "").trim().toLowerCase();

export const participantTeamMap = (participants = []) => new Map(
  (Array.isArray(participants) ? participants : [])
    .map((participant) => [normalizeReportLogin(participant?.goals_login || participant?.login), participant])
    .filter(([login]) => login)
);

export const enrichReportRowsWithParticipants = (rows = [], participants = []) => {
  const byLogin = participantTeamMap(participants);
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const login = normalizeReportLogin(
      row?.login || row?.goals_login || row?.operator || row?.credit || row?.debit
    );
    const participant = byLogin.get(login);
    if (!participant) {
      return {
        ...row,
        login,
        team_id: row?.team_id || "",
        team_name: row?.team_name || "",
        team_key: row?.team_key || normalizeTeamKey(row?.team_name),
      };
    }
    return {
      ...row,
      ...participant,
      login,
      goals_login: participant.goals_login || login,
      team_id: participant.team_id || row?.team_id || "",
      team_name: participant.team_name || row?.team_name || "",
      team_key: participant.team_key || normalizeTeamKey(participant.team_name || row?.team_name),
    };
  });
};

export const rowMatchesTeam = (row = {}, team = null) => {
  if (!team) return true;
  const rowTeamId = String(row?.team_id || "").trim();
  const teamId = String(team?.id || "").trim();
  if (rowTeamId && teamId && rowTeamId === teamId) return true;

  const rowTeamKey = normalizeTeamKey(row?.team_key || row?.team_name);
  const selectedTeamKey = normalizeTeamKey(team?.name);
  return Boolean(rowTeamKey && selectedTeamKey && rowTeamKey === selectedTeamKey);
};

export const filterRowsForTeam = (rows = [], participants = [], team = null) => {
  const enriched = enrichReportRowsWithParticipants(rows, participants);
  if (!team) return enriched;
  return enriched.filter((row) => rowMatchesTeam(row, team));
};

export const hasTeamMetadata = (rows = []) => (
  (Array.isArray(rows) ? rows : []).some((row) => Boolean(
    String(row?.team_id || "").trim()
    || normalizeTeamKey(row?.team_key || row?.team_name)
  ))
);

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
