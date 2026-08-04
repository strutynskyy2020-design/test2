const makeResponse = (statusCode, body) => ({
  statusCode,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  },
  body: JSON.stringify(body),
});

const normalizeKey = (value = "") => String(value ?? "")
  .replace(/[\u200B-\u200D\uFEFF]/g, "")
  .replace(/\u00A0/g, " ")
  .trim()
  .toLowerCase();

const uniqueKeys = (values) => Array.from(new Set(values.map(normalizeKey).filter(Boolean)));

const backendApiBase = () => {
  const raw = String(
    process.env.BACKEND_API_URL ||
    process.env.REACT_APP_BACKEND_URL ||
    ""
  ).replace(/\/$/, "");
  if (!raw) return "";
  return raw.endsWith("/api") ? raw : `${raw}/api`;
};

const backendUrl = (path) => {
  const base = backendApiBase();
  return base ? `${base}${path}` : "";
};

const teamReportKey = (value = "") => {
  const normalized = String(value || "").trim().toLowerCase().replace(/[^a-zа-яіїєґ0-9]+/gi, "");
  const match = normalized.match(/(?:tm|тм)(\d+)/i);
  return match ? `tm${match[1]}` : normalized;
};

const normalizeReportProfile = (value) => normalizeKey(value) === "activation" ? "activation" : "sales";

const rowLogin = (row = {}) => normalizeKey(row.login || row.goals_login || row.operator || row.credit || row.debit);


const hasArrayItems = (value) => Array.isArray(value) && value.length > 0;

const reportRowForLogin = (rows, login) => (
  (Array.isArray(rows) ? rows : []).find((row) => rowLogin(row) === normalizeKey(login)) || null
);

const reportPeriod = (value) => {
  const key = normalizeKey(value);
  if (key.includes("yesterday") || key.includes("вчора")) return "yesterday";
  if (key.includes("month") || key.includes("міся")) return "month";
  return "";
};

const personalPeriodRows = (rows, login) => {
  const target = normalizeKey(login);
  const filtered = (Array.isArray(rows) ? rows : []).filter((row) => {
    const rowKey = rowLogin(row);
    return Boolean(target && rowKey === target && reportPeriod(row?.period));
  });
  const byPeriod = new Map();
  filtered.forEach((row) => {
    const period = reportPeriod(row?.period);
    // Prefer the first exact personal row for each period. Old snapshots could
    // contain duplicated/group rows; they must never replace personal data.
    if (!byPeriod.has(period)) byPeriod.set(period, row);
  });
  return ["month", "yesterday"].map((period) => byPeriod.get(period)).filter(Boolean);
};

const firstReportValue = (object, keys) => {
  for (const key of keys) {
    const value = object?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return String(value).trim();
  }
  return "";
};

const reportHasPersonalData = (data, login) => {
  if (!data || !login) return false;
  if (data.report_found === true || data.found === true || data.goals) return true;
  if (
    hasArrayItems(data.credit_metrics)
    || hasArrayItems(data.debit_issuances)
    || hasArrayItems(data.deposit_metrics)
    || hasArrayItems(data.deposit_issuances)
    || hasArrayItems(data.activation_pumb_metrics)
    || hasArrayItems(data.activation_pumb_giving)
    || hasArrayItems(data.activation_cards_metrics)
    || hasArrayItems(data.activation_cards_giving)
    || data.schedule?.found
  ) return true;
  return Boolean(
    reportRowForLogin(data.credit_leaderboard, login)
    || reportRowForLogin(data.debit_leaderboard, login)
    || reportRowForLogin(data.deposit_projection_leaderboard, login)
    || reportRowForLogin(data.deposit_leaderboard, login)
    || reportRowForLogin(data.activation_pumb_leaderboard, login)
    || reportRowForLogin(data.activation_pumb_giving_leaderboard, login)
    || reportRowForLogin(data.activation_cards_leaderboard, login)
    || reportRowForLogin(data.activation_cards_giving_leaderboard, login)
  );
};

const buildAutomaticGoals = (data, login) => {
  const creditRow = reportRowForLogin(data?.credit_leaderboard, login) || {};
  const debitRow = reportRowForLogin(data?.debit_leaderboard, login) || {};
  const depositProjectionRow = reportRowForLogin(data?.deposit_projection_leaderboard, login) || {};
  const depositMonth = (Array.isArray(data?.deposit_metrics) ? data.deposit_metrics : []).find((row) => {
    const period = normalizeKey(row?.period);
    return period.includes("month") || period.includes("міся");
  }) || data?.deposit_metrics?.[0] || {};

  const creditActual = firstReportValue(creditRow, ["overall", "projective_rate", "result", "value"]) || "0";
  const debitActual = firstReportValue(debitRow, ["overall", "projective_rate", "result", "value"]) || "0";
  const depositActual = firstReportValue(
    depositProjectionRow,
    ["projective_rate", "projection_rate", "projective", "projection", "overall", "result", "value"],
  ) || firstReportValue(depositMonth, ["projective_rate", "projection_rate", "projective", "projection"]) || "0";

  return {
    goals_login: normalizeKey(login),
    credit_actual: creditActual,
    credit_current: creditActual,
    credit_target: "110",
    credit_mode: "reach",
    debit_actual: debitActual,
    debit_current: debitActual,
    debit_target: "105",
    debit_mode: "reach",
    deposit_actual: depositActual,
    deposit_current: depositActual,
    deposit_target: "100",
    deposit_mode: "reach",
    monthly_bonus_actual: "0",
    monthly_bonus_current: "0",
    monthly_bonus_target: "10000",
    weekly_complete: "false",
    monthly_complete: "false",
    weekly_reward_awarded: "false",
    monthly_reward_awarded: "false",
    note: "",
    goals_auto_generated: "true",
  };
};

const buildAutomaticActivationGoals = (data, login) => {
  const pumbRow = reportRowForLogin(data?.activation_pumb_leaderboard, login) || {};
  const cardsRow = reportRowForLogin(data?.activation_cards_leaderboard, login) || {};
  const pumbMonth = (Array.isArray(data?.activation_pumb_metrics) ? data.activation_pumb_metrics : []).find((row) => normalizeKey(row?.period) === "month") || {};
  const pumbActual = firstReportValue(pumbRow, ["projective_rate", "projection_rate", "overall", "result", "value"])
    || firstReportValue(pumbMonth, ["projective_rate", "projection_rate"]) || "0";
  const cardsActual = firstReportValue(cardsRow, ["projective_rate", "projection_rate", "overall", "result", "value"]) || "0";
  return {
    goals_login: normalizeKey(login),
    pumb_online_actual: pumbActual,
    pumb_online_current: pumbActual,
    pumb_online_target: "100",
    pumb_online_mode: "reach",
    cards_actual: cardsActual,
    cards_current: cardsActual,
    cards_target: "100",
    cards_mode: "reach",
    monthly_bonus_actual: "0",
    monthly_bonus_current: "0",
    monthly_bonus_target: "10000",
    weekly_complete: "false",
    monthly_complete: "false",
    weekly_reward_awarded: "false",
    monthly_reward_awarded: "false",
    note: "",
    goals_auto_generated: "true",
  };
};

const participantMap = (participants = []) => new Map(
  (Array.isArray(participants) ? participants : [])
    .map((participant) => [normalizeKey(participant?.goals_login || participant?.login), participant])
    .filter(([login]) => login),
);

const allowedLoginsForProfile = (allowedLogins, participants, profile) => {
  const participantRows = Array.isArray(participants) ? participants : [];
  if (!participantRows.length) return allowedLogins;
  const profileLogins = new Set(participantRows
    .filter((participant) => normalizeReportProfile(participant?.report_profile) === profile)
    .map((participant) => normalizeKey(participant?.goals_login || participant?.login))
    .filter(Boolean));
  if (allowedLogins === null) return profileLogins;
  return new Set(Array.from(allowedLogins || []).filter((login) => profileLogins.has(normalizeKey(login))));
};

const enrichRowsWithParticipants = (rows, participants = []) => {
  const profiles = participantMap(participants);
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const login = rowLogin(row);
    const participant = profiles.get(login);
    if (!participant) {
      return {
        ...row,
        login,
        team_id: row?.team_id || "",
        team_name: row?.team_name || "",
        team_key: row?.team_key || teamReportKey(row?.team_name || ""),
      };
    }
    return {
      ...row,
      login,
      name: participant.name || row?.name || "",
      goals_login: participant.goals_login || login,
      team_id: participant.team_id || row?.team_id || "",
      team_name: participant.team_name || row?.team_name || "",
      team_key: participant.team_key || teamReportKey(participant.team_name || row?.team_name || ""),
      avatar_initials: participant.avatar_initials || row?.avatar_initials || "",
      avatar_color: participant.avatar_color || row?.avatar_color || "#27272A",
      avatar_url: participant.avatar_url || row?.avatar_url || null,
      avatar_rarity: participant.avatar_rarity || row?.avatar_rarity || "basic",
      report_profile: normalizeReportProfile(participant.report_profile),
    };
  });
};

const filterRowsByAllowedLogins = (rows, allowedLogins) => {
  if (!Array.isArray(rows)) return [];
  if (allowedLogins === null) return rows;
  if (!(allowedLogins instanceof Set) || !allowedLogins.size) return [];
  return rows.filter((row) => allowedLogins.has(rowLogin(row)));
};

const applyTeamOverall = (rows, _teamKey) => (Array.isArray(rows) ? rows : []).map((row) => {
  const { team_overall: _privateTeamValues, ...safeRow } = row || {};

  // Columns explicitly named “Загальний підсумок” are shared comparison values
  // for every team. Apps Script already writes them to the regular *_overall
  // fields. Team-specific summary columns are private parsing metadata and must
  // neither replace nor delete the published general values.
  return safeRow;
});

const applyDepositTeamOverall = (rows, teamKey) => (Array.isArray(rows) ? rows : []).map((row) => {
  const teamValues = row?.team_overall && teamKey ? row.team_overall[teamKey] : null;
  const { team_overall: _privateTeamValues, ...safeRow } = row || {};
  if (!teamValues || typeof teamValues !== "object") return safeRow;
  return Object.entries(teamValues).reduce((result, [key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== "") result[key] = value;
    return result;
  }, { ...safeRow });
});

const selectGroupSummaries = (summaries, teamKey, allowAll) => {
  const source = summaries && typeof summaries === "object" ? summaries : {};
  if (allowAll) return source;
  if (!teamKey || !source[teamKey]) return {};
  return { [teamKey]: source[teamKey] };
};

const selectDepositGroupSummaries = (summaries, teamKey, allowAll) => {
  const source = summaries && typeof summaries === "object" ? summaries : {};
  return ["month", "yesterday"].reduce((result, period) => {
    result[period] = selectGroupSummaries(source[period], teamKey, allowAll);
    return result;
  }, {});
};

const readJson = async (response) => {
  const text = await response.text();
  try { return { data: text ? JSON.parse(text) : null, text }; }
  catch { return { data: null, text }; }
};

const fetchBackendJson = async (path, authorization, { allowFailure = false } = {}) => {
  const url = backendUrl(path);
  if (!url) return null;
  const response = await fetch(url, {
    headers: { accept: "application/json", authorization },
    cache: "no-store",
  });
  const result = await readJson(response);
  if (!response.ok) {
    if (allowFailure) return null;
    const error = new Error(result.data?.detail || `Backend request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return result.data;
};

const fetchGooglePayload = async (scriptUrl, goalsLogin) => {
  const url = new URL(scriptUrl);
  url.searchParams.set("goals_login", goalsLogin);
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    redirect: "follow",
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    const error = new Error("Не вдалося отримати дані з Google Таблиці");
    error.status = response.status;
    throw error;
  }
  if (data.success === false) throw new Error(data.error || "Помилка Google Таблиці");
  return data;
};

const fetchProtectedScriptAction = async (scriptUrl, token, action, payload = {}) => {
  if (!token) throw new Error("Не налаштовано GOOGLE_GOALS_WRITE_TOKEN");
  const response = await fetch(scriptUrl, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ token, action, ...payload }),
    redirect: "follow",
    cache: "no-store",
  });
  const result = await readJson(response);
  if (!response.ok || !result.data) throw new Error(`Google Apps Script request failed (${response.status})`);
  if (result.data.success === false) throw new Error(result.data.error || "Помилка Google Таблиці");
  return result.data;
};

const emptySchedule = (reason, lookup = {}) => ({
  found: false,
  reason,
  days: [],
  lookup,
});

const currentTeamFrom = (user, teams) => {
  const list = Array.isArray(teams) ? teams : [];
  const found = list.find((team) => team?.id && team.id === user?.team_id);
  if (found) return found;
  if (!user?.team_id) return null;
  return { id: user.team_id, name: user.team_name || "", color: user.team_color || null };
};

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return makeResponse(405, { success: false, error: "Method not allowed" });
  }

  try {
    const authorization = event.headers.authorization || event.headers.Authorization || "";
    if (!authorization.startsWith("Bearer ")) {
      return makeResponse(401, { success: false, error: "Потрібна авторизація" });
    }

    const user = await fetchBackendJson("/auth/me", authorization);
    if (!user) return makeResponse(401, { success: false, error: "Сесію завершено. Увійдіть повторно" });

    const scriptUrl = String(process.env.GOOGLE_GOALS_SCRIPT_URL || "").trim();
    if (!scriptUrl) return makeResponse(500, { success: false, error: "Google Таблицю не налаштовано" });
    const writeToken = String(process.env.GOOGLE_GOALS_WRITE_TOKEN || "").trim();

    const isPrivileged = user.role === "admin" || user.role === "editor";
    const reportProfile = normalizeReportProfile(user.report_profile);
    let reportAccess = await fetchBackendJson("/goals/report-access", authorization, { allowFailure: true });

    let fallbackSettings = null;
    let fallbackTeams = [];
    let fallbackUsers = [];
    if (!reportAccess) {
      fallbackTeams = await fetchBackendJson("/teams", authorization, { allowFailure: true }) || [];
      if (writeToken) {
        fallbackSettings = await fetchProtectedScriptAction(scriptUrl, writeToken, "get_goals_settings").catch(() => null);
      }
      if (isPrivileged) {
        fallbackUsers = await fetchBackendJson("/admin/users", authorization, { allowFailure: true }) || [];
      }
      const currentTeam = currentTeamFrom(user, fallbackTeams);
      const fallbackAllowed = isPrivileged
        ? uniqueKeys(fallbackUsers.map((member) => member?.goals_login || member?.goalsLogin || member?.login2))
        : uniqueKeys([user.goals_login, String(user.email || "").split("@")[0]]);
      const fallbackTeamNames = new Map(
        (Array.isArray(fallbackTeams) ? fallbackTeams : []).map((team) => [team?.id, team?.name || ""]),
      );
      const fallbackParticipants = isPrivileged
        ? fallbackUsers
          .filter((member) => member?.role !== "admin" && normalizeKey(member?.goals_login || member?.goalsLogin || member?.login2))
          .map((member) => {
            const teamName = member?.team_name || fallbackTeamNames.get(member?.team_id) || "";
            return {
              ...member,
              goals_login: normalizeKey(member?.goals_login || member?.goalsLogin || member?.login2),
              team_name: teamName,
              team_key: teamReportKey(teamName),
            };
          })
        : (normalizeKey(user?.goals_login) ? [{
          id: user.id,
          name: user.name || "",
          goals_login: normalizeKey(user.goals_login),
          team_id: user.team_id || "",
          team_name: user.team_name || currentTeam?.name || "",
          team_key: teamReportKey(user.team_name || currentTeam?.name || ""),
          avatar_initials: user.avatar_initials || "",
          avatar_color: user.avatar_color || "#27272A",
          avatar_url: user.avatar_url || null,
          avatar_rarity: user.avatar_rarity || "basic",
          report_profile: normalizeReportProfile(user.report_profile),
        }] : []);
      reportAccess = {
        allow_cross_team_reports: Boolean(isPrivileged || fallbackSettings?.allow_cross_team_reports),
        admin_allows_cross_team_reports: Boolean(fallbackSettings?.allow_cross_team_reports),
        current_team: currentTeam,
        teams: isPrivileged || fallbackSettings?.allow_cross_team_reports
          ? fallbackTeams
          : (currentTeam ? [currentTeam] : []),
        allowed_goals_logins: fallbackAllowed,
        participants: fallbackParticipants,
        access_signature: null,
        compatibility_mode: true,
      };
    }

    const requestedScheduleLogin = isPrivileged
      ? normalizeKey(event.queryStringParameters?.schedule_login)
      : "";
    const requestedReportLogin = isPrivileged
      ? normalizeKey(event.queryStringParameters?.report_login)
      : "";
    const profileGoalsLogin = normalizeKey(user.goals_login);
    const emailLogin = normalizeKey(String(user.email || "").split("@")[0]);
    const ownCandidates = uniqueKeys([profileGoalsLogin, emailLogin]);
    let baseLogin = isPrivileged
      ? (uniqueKeys([requestedReportLogin, profileGoalsLogin])[0] || "")
      : (uniqueKeys([profileGoalsLogin, emailLogin])[0] || "");

    let baseData = null;
    if (isPrivileged && writeToken) {
      baseData = await fetchProtectedScriptAction(scriptUrl, writeToken, "read_cached_report", {
        goals_login: baseLogin || "",
      });
      if (!baseData?.found && !requestedReportLogin && !profileGoalsLogin) {
        baseData = await fetchProtectedScriptAction(scriptUrl, writeToken, "read_cached_report", {
          goals_login: "",
        });
      }
      baseLogin = normalizeKey(baseData?.goals_login || baseLogin);
    } else if (baseLogin) {
      baseData = await fetchGooglePayload(scriptUrl, baseLogin);
    }

    if (!baseData) {
      const lookup = {
        requested_login: requestedScheduleLogin || null,
        profile_login: profileGoalsLogin || null,
        email_login: emailLogin || null,
        matched_login: null,
      };
      return makeResponse(200, {
        success: true,
        found: false,
        report_found: false,
        goals_found: false,
        reason: "goals_login_missing",
        viewer_has_own_report: false,
        privileged_overview: isPrivileged,
        report_profile: reportProfile,
        goals_login: null,
        goals: null,
        activation_goals: null,
        credit_metrics: [],
        credit_leaderboard: [],
        credit_group_summary: null,
        credit_group_summaries: {},
        credit_leaderboard_updated_at: null,
        debit_leaderboard: [],
        debit_group_summary: null,
        debit_group_summaries: {},
        debit_leaderboard_updated_at: null,
        debit_issuances: [],
        deposit_metrics: [],
        deposit_projection_leaderboard: [],
        deposit_projection_group_summaries: {},
        deposit_projection_updated_at: null,
        deposit_projection_diagnostics: {},
        deposit_leaderboard: [],
        deposit_group_summaries: { month: {}, yesterday: {} },
        deposit_leaderboard_updated_at: null,
        deposit_issuances: [],
        activation_pumb_metrics: [],
        activation_pumb_leaderboard: [],
        activation_pumb_group_summaries: { month: {}, yesterday: {} },
        activation_pumb_giving: [],
        activation_pumb_giving_leaderboard: [],
        activation_pumb_giving_group_summaries: { month: {}, yesterday: {} },
        activation_pumb_updated_at: null,
        activation_pumb_diagnostics: {},
        activation_cards_metrics: [],
        activation_cards_leaderboard: [],
        activation_cards_group_summaries: {},
        activation_cards_transformation_group_summaries: { month: {}, yesterday: {} },
        activation_cards_giving: [],
        activation_cards_giving_leaderboard: [],
        activation_cards_giving_group_summaries: { month: {}, yesterday: {} },
        activation_cards_updated_at: null,
        activation_cards_diagnostics: {},
        report_access: reportAccess,
        schedule: emptySchedule("schedule_login_missing", lookup),
      });
    }

    const selectedReportLogin = normalizeKey(baseData.goals_login || baseLogin);
    const selectedHasReportData = reportHasPersonalData(baseData, selectedReportLogin);
    const viewerHasOwnReport = Boolean(
      selectedHasReportData && selectedReportLogin && ownCandidates.includes(selectedReportLogin),
    );
    const effectiveGoals = baseData.goals
      || (selectedHasReportData ? buildAutomaticGoals(baseData, selectedReportLogin) : null);
    const effectiveActivationGoals = selectedHasReportData
      ? buildAutomaticActivationGoals(baseData, selectedReportLogin)
      : null;

    const scheduleCandidates = isPrivileged
      ? uniqueKeys([requestedScheduleLogin, profileGoalsLogin, selectedReportLogin])
      : uniqueKeys([requestedScheduleLogin, profileGoalsLogin, emailLogin, selectedReportLogin]);
    let schedule = null;
    let matchedScheduleLogin = null;
    let payloadMissingSchedule = false;

    const loadCandidate = async (candidate) => {
      if (candidate === selectedReportLogin) return baseData;
      if (isPrivileged && writeToken) {
        return fetchProtectedScriptAction(scriptUrl, writeToken, "read_cached_report", { goals_login: candidate });
      }
      return fetchGooglePayload(scriptUrl, candidate);
    };

    for (const candidate of scheduleCandidates) {
      const candidateData = await loadCandidate(candidate);
      if (!Object.prototype.hasOwnProperty.call(candidateData, "schedule")) {
        payloadMissingSchedule = true;
        continue;
      }
      if (candidateData.schedule && typeof candidateData.schedule === "object") {
        schedule = candidateData.schedule;
        if (schedule.found) {
          matchedScheduleLogin = candidate;
          break;
        }
      }
    }

    const lookup = {
      requested_login: requestedScheduleLogin || null,
      profile_login: profileGoalsLogin || null,
      email_login: emailLogin || null,
      selected_report_login: selectedReportLogin || null,
      tried_logins: scheduleCandidates,
      matched_login: matchedScheduleLogin,
      script_api_version: baseData.api_version || null,
    };

    if (!schedule) {
      schedule = emptySchedule(
        payloadMissingSchedule ? "schedule_payload_missing" : "schedule_login_missing",
        lookup,
      );
    } else {
      schedule = { ...schedule, lookup };
    }

    const allowCrossTeamReports = Boolean(isPrivileged || reportAccess?.allow_cross_team_reports);
    const currentTeam = reportAccess?.current_team || currentTeamFrom(user, reportAccess?.teams || fallbackTeams);
    const currentTeamKey = teamReportKey(currentTeam?.name || user.team_name || "");

    const configuredAllowed = Array.isArray(reportAccess?.allowed_goals_logins)
      ? uniqueKeys(reportAccess.allowed_goals_logins)
      : [];
    const allowedLogins = allowCrossTeamReports && (isPrivileged || configuredAllowed.length === 0)
      ? null
      : new Set(configuredAllowed.length ? configuredAllowed : ownCandidates);

    const creditGroupSummaries = selectGroupSummaries(
      baseData.credit_group_summaries,
      currentTeamKey,
      allowCrossTeamReports,
    );
    const debitGroupSummaries = selectGroupSummaries(
      baseData.debit_group_summaries,
      currentTeamKey,
      allowCrossTeamReports,
    );
    const depositProjectionGroupSummaries = selectGroupSummaries(
      baseData.deposit_projection_group_summaries,
      currentTeamKey,
      allowCrossTeamReports,
    );
    const depositGroupSummaries = selectDepositGroupSummaries(
      baseData.deposit_group_summaries,
      currentTeamKey,
      allowCrossTeamReports,
    );
    const activationPumbGroupSummaries = selectDepositGroupSummaries(
      baseData.activation_pumb_group_summaries,
      currentTeamKey,
      allowCrossTeamReports,
    );
    const activationPumbGivingGroupSummaries = selectDepositGroupSummaries(
      baseData.activation_pumb_giving_group_summaries,
      currentTeamKey,
      allowCrossTeamReports,
    );
    const activationCardsGroupSummaries = selectGroupSummaries(
      baseData.activation_cards_group_summaries,
      currentTeamKey,
      allowCrossTeamReports,
    );
    const activationCardsTransformationGroupSummaries = selectDepositGroupSummaries(
      baseData.activation_cards_transformation_group_summaries,
      currentTeamKey,
      allowCrossTeamReports,
    );
    const activationCardsGivingGroupSummaries = selectDepositGroupSummaries(
      baseData.activation_cards_giving_group_summaries,
      currentTeamKey,
      allowCrossTeamReports,
    );
    const selectedCreditSummary = currentTeamKey
      ? (creditGroupSummaries[currentTeamKey] || null)
      : (isPrivileged ? null : (baseData.credit_group_summary || null));
    const selectedDebitSummary = currentTeamKey
      ? (debitGroupSummaries[currentTeamKey] || null)
      : (isPrivileged ? null : (baseData.debit_group_summary || null));
    const participants = Array.isArray(reportAccess?.participants) ? reportAccess.participants : [];
    const salesAllowedLogins = allowedLoginsForProfile(allowedLogins, participants, "sales");
    const activationAllowedLogins = allowedLoginsForProfile(allowedLogins, participants, "activation");
    const creditLeaderboard = enrichRowsWithParticipants(
      filterRowsByAllowedLogins(baseData.credit_leaderboard, salesAllowedLogins),
      participants,
    );
    const debitLeaderboard = enrichRowsWithParticipants(
      filterRowsByAllowedLogins(baseData.debit_leaderboard, salesAllowedLogins),
      participants,
    );
    const depositProjectionLeaderboard = enrichRowsWithParticipants(
      filterRowsByAllowedLogins(baseData.deposit_projection_leaderboard, salesAllowedLogins),
      participants,
    );
    const depositLeaderboard = enrichRowsWithParticipants(
      filterRowsByAllowedLogins(baseData.deposit_leaderboard, salesAllowedLogins),
      participants,
    );
    const activationPumbLeaderboard = enrichRowsWithParticipants(
      filterRowsByAllowedLogins(baseData.activation_pumb_leaderboard, activationAllowedLogins),
      participants,
    );
    const activationPumbGivingLeaderboard = enrichRowsWithParticipants(
      filterRowsByAllowedLogins(baseData.activation_pumb_giving_leaderboard, activationAllowedLogins),
      participants,
    );
    const activationCardsLeaderboard = enrichRowsWithParticipants(
      filterRowsByAllowedLogins(baseData.activation_cards_leaderboard, activationAllowedLogins),
      participants,
    );
    const activationCardsGivingLeaderboard = enrichRowsWithParticipants(
      filterRowsByAllowedLogins(baseData.activation_cards_giving_leaderboard, activationAllowedLogins),
      participants,
    );
    const activationPumbMetrics = viewerHasOwnReport
      ? personalPeriodRows(baseData.activation_pumb_metrics, selectedReportLogin)
      : [];
    const activationPumbGiving = viewerHasOwnReport
      ? personalPeriodRows(baseData.activation_pumb_giving, selectedReportLogin)
      : [];
    const activationCardsMetrics = viewerHasOwnReport
      ? personalPeriodRows(baseData.activation_cards_metrics, selectedReportLogin)
      : [];
    const activationCardsGiving = viewerHasOwnReport
      ? personalPeriodRows(baseData.activation_cards_giving, selectedReportLogin)
      : [];

    return makeResponse(200, {
      success: true,
      api_version: baseData.api_version || null,
      report_mode: baseData.report_mode || null,
      snapshot_version: baseData.snapshot_version || null,
      snapshot_updated_at: baseData.snapshot_updated_at || null,
      snapshot_day: baseData.snapshot_day || null,
      found: Boolean(baseData.found || baseData.report_found || selectedHasReportData),
      report_found: Boolean(baseData.report_found || selectedHasReportData),
      goals_found: Boolean(baseData.goals_found ?? baseData.goals),
      reason: selectedHasReportData ? null : (baseData.reason || null),
      viewer_has_own_report: viewerHasOwnReport,
      privileged_overview: Boolean(isPrivileged && !viewerHasOwnReport),
      report_profile: reportProfile,
      selected_report_login: selectedReportLogin || null,
      goals_login: viewerHasOwnReport ? selectedReportLogin : null,
      goals: viewerHasOwnReport ? effectiveGoals : null,
      activation_goals: viewerHasOwnReport ? effectiveActivationGoals : null,
      credit_metrics: viewerHasOwnReport ? applyTeamOverall(baseData.credit_metrics, currentTeamKey) : [],
      credit_leaderboard: creditLeaderboard,
      credit_group_summary: selectedCreditSummary,
      credit_group_summaries: creditGroupSummaries,
      credit_leaderboard_updated_at: baseData.credit_leaderboard_updated_at || null,
      debit_leaderboard: debitLeaderboard,
      debit_group_summary: selectedDebitSummary,
      debit_group_summaries: debitGroupSummaries,
      debit_leaderboard_updated_at: baseData.debit_leaderboard_updated_at || null,
      debit_issuances: viewerHasOwnReport && Array.isArray(baseData.debit_issuances) ? baseData.debit_issuances : [],
      deposit_metrics: viewerHasOwnReport ? applyDepositTeamOverall(baseData.deposit_metrics, currentTeamKey) : [],
      deposit_projection_leaderboard: depositProjectionLeaderboard,
      deposit_projection_group_summaries: depositProjectionGroupSummaries,
      deposit_projection_updated_at: baseData.deposit_projection_updated_at || baseData.snapshot_updated_at || null,
      deposit_projection_diagnostics: baseData.deposit_projection_diagnostics || {},
      deposit_leaderboard: depositLeaderboard,
      deposit_group_summaries: depositGroupSummaries,
      deposit_leaderboard_updated_at: baseData.deposit_leaderboard_updated_at || null,
      deposit_issuances: viewerHasOwnReport && Array.isArray(baseData.deposit_issuances) ? baseData.deposit_issuances : [],
      activation_pumb_metrics: activationPumbMetrics,
      activation_pumb_leaderboard: activationPumbLeaderboard,
      activation_pumb_group_summaries: activationPumbGroupSummaries,
      activation_pumb_giving: activationPumbGiving,
      activation_pumb_giving_leaderboard: activationPumbGivingLeaderboard,
      activation_pumb_giving_group_summaries: activationPumbGivingGroupSummaries,
      activation_pumb_updated_at: baseData.activation_pumb_updated_at || baseData.snapshot_updated_at || null,
      activation_pumb_diagnostics: baseData.activation_pumb_diagnostics || {},
      activation_cards_metrics: activationCardsMetrics,
      activation_cards_leaderboard: activationCardsLeaderboard,
      activation_cards_group_summaries: activationCardsGroupSummaries,
      activation_cards_transformation_group_summaries: activationCardsTransformationGroupSummaries,
      activation_cards_giving: activationCardsGiving,
      activation_cards_giving_leaderboard: activationCardsGivingLeaderboard,
      activation_cards_giving_group_summaries: activationCardsGivingGroupSummaries,
      activation_cards_updated_at: baseData.activation_cards_updated_at || baseData.snapshot_updated_at || null,
      activation_cards_diagnostics: baseData.activation_cards_diagnostics || {},
      report_access: {
        signature: reportAccess?.access_signature || null,
        allow_cross_team_reports: allowCrossTeamReports,
        admin_allows_cross_team_reports: Boolean(reportAccess?.admin_allows_cross_team_reports),
        current_team: currentTeam,
        teams: Array.isArray(reportAccess?.teams) ? reportAccess.teams : (currentTeam ? [currentTeam] : []),
        participants,
        compatibility_mode: Boolean(reportAccess?.compatibility_mode),
        report_profile: reportProfile,
      },
      schedule,
    });
  } catch (error) {
    console.error("google-goals error", error);
    return makeResponse(error?.status === 401 ? 401 : 500, {
      success: false,
      error: error?.message || "Не вдалося завантажити дані Google Таблиці",
    });
  }
};
