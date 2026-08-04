const SPREADSHEET_ID = "1TV7NHvEmLf6i19yPt7SENl2TOn1Y04ToW1CjSGhtrf0";
const SHEET_NAME = "Goals";
const CREDIT_METRICS_SHEET_NAME = "CreditMetrics";
const CREDIT_LEADERBOARD_SHEET_NAME = "Аркуш2";
const TRANSFORMATION_SHEET_NAME = "Transformation";
const DEBIT_LEADERBOARD_SHEET_NAME = "Аркуш2";
const DEBIT_ISSUANCES_SHEET_NAME = "Transformation Deb";
const DEPOSIT_SHEET_NAME = "Deposit";
const ACTIVATION_PUMB_SHEET_NAME = "Activation Pumb Online";
const ACTIVATION_CARDS_SHEET_NAME = "Activation Cards";
const SCHEDULE_SHEET_NAME = "Schedule";
const SCHEDULE_TIMEZONE = "Europe/Kyiv";
const REPORT_CACHE_SHEET_NAME = "_TM6_REPORT_CACHE";
const REPORT_CACHE_CHUNK_SIZE = 45000;
const REPORT_CACHE_API_VERSION = "v128-activation-data-tasks-team-filters";
const TEAM_MESSAGES_SHEET_NAME = "_TM6_TEAM_MESSAGES";

function normalizeKey(value) {
  return String(value == null ? "" : value)
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\u00A0/g, " ")
    .trim()
    .toLowerCase();
}

function openGoalsSheet(spreadsheet) {
  if (!SPREADSHEET_ID || SPREADSHEET_ID.includes("ВСТАВТЕ_ID")) {
    throw new Error("SPREADSHEET_ID is not configured");
  }
  const sourceSpreadsheet = spreadsheet || SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = sourceSpreadsheet.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error(`Аркуш "${SHEET_NAME}" не знайдено`);
  return sheet;
}

function getSheetContext(spreadsheet) {
  const sheet = openGoalsSheet(spreadsheet);
  const values = sheet.getDataRange().getDisplayValues();
  if (!values.length) return { sheet, headers: [], normalizedHeaders: [], rows: [] };
  const [headerRow, ...rows] = values;
  const headers = headerRow.map((header) => String(header).trim());
  return { sheet, headers, normalizedHeaders: headers.map(normalizeKey), rows };
}

function findGoalRow(context, goalsLogin) {
  const keyIndex = context.normalizedHeaders.indexOf("goals_login");
  if (keyIndex === -1) throw new Error('Немає колонки "goals_login"');
  const rowOffset = context.rows.findIndex(
    (row) => normalizeKey(row[keyIndex]) === goalsLogin
  );
  return { keyIndex, rowOffset, sheetRow: rowOffset === -1 ? -1 : rowOffset + 2 };
}

function rowToObject(headers, row) {
  return Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]));
}


const AUTO_GOAL_DEFAULTS = {
  credit_target: "110",
  debit_target: "105",
  deposit_target: "100",
  monthly_bonus_target: "10000",
};

function reportRowByLogin(rows, goalsLogin) {
  return (Array.isArray(rows) ? rows : []).find(
    (row) => normalizeKey(row && (row.login || row.goals_login || row.operator || row.credit || row.debit)) === goalsLogin
  ) || null;
}

function firstPresentValue(object, keys) {
  for (let index = 0; index < keys.length; index += 1) {
    const value = object && object[keys[index]];
    if (value !== undefined && value !== null && String(value).trim() !== "") return String(value).trim();
  }
  return "";
}

function mostCommonGoalValue(context, headerName, fallbackValue) {
  const index = context.normalizedHeaders.indexOf(normalizeKey(headerName));
  if (index === -1) return fallbackValue;
  const counts = {};
  const originals = {};
  context.rows.forEach((row) => {
    const raw = String(row[index] == null ? "" : row[index]).trim();
    const key = normalizeKey(raw);
    if (!key) return;
    counts[key] = (counts[key] || 0) + 1;
    if (!originals[key]) originals[key] = raw;
  });
  const winner = Object.keys(counts).sort((left, right) => {
    if (counts[right] !== counts[left]) return counts[right] - counts[left];
    return left.localeCompare(right);
  })[0];
  return winner ? originals[winner] : fallbackValue;
}

function buildAutomaticGoals(context, goalsLogin, personal) {
  const creditRow = personal.creditRow || {};
  const debitRow = personal.debitRow || {};
  const depositProjectionRow = personal.depositProjectionRow || {};
  const depositMonth = (personal.depositMetrics || []).find(
    (row) => normalizeKey(row && row.period).includes("month") || normalizeKey(row && row.period).includes("міся")
  ) || (personal.depositMetrics || [])[0] || {};

  const creditActual = firstPresentValue(creditRow, ["overall", "projective_rate", "result", "value"]) || "0";
  const debitActual = firstPresentValue(debitRow, ["overall", "projective_rate", "result", "value"]) || "0";
  const depositActual = firstPresentValue(
    depositProjectionRow,
    ["projective_rate", "projection_rate", "projective", "projection", "overall", "result", "value"]
  ) || firstPresentValue(depositMonth, ["projective_rate", "projection_rate", "projective", "projection"]) || "0";

  return {
    goals_login: goalsLogin,
    credit_actual: creditActual,
    credit_current: creditActual,
    credit_target: mostCommonGoalValue(context, "credit_target", AUTO_GOAL_DEFAULTS.credit_target),
    credit_mode: mostCommonGoalValue(context, "credit_mode", "reach"),
    debit_actual: debitActual,
    debit_current: debitActual,
    debit_target: mostCommonGoalValue(context, "debit_target", AUTO_GOAL_DEFAULTS.debit_target),
    debit_mode: mostCommonGoalValue(context, "debit_mode", "reach"),
    deposit_actual: depositActual,
    deposit_current: depositActual,
    deposit_target: mostCommonGoalValue(context, "deposit_target", AUTO_GOAL_DEFAULTS.deposit_target),
    deposit_mode: mostCommonGoalValue(context, "deposit_mode", "reach"),
    monthly_bonus_actual: "0",
    monthly_bonus_current: "0",
    monthly_bonus_target: mostCommonGoalValue(
      context,
      "monthly_bonus_target",
      AUTO_GOAL_DEFAULTS.monthly_bonus_target
    ),
    weekly_complete: "false",
    monthly_complete: "false",
    weekly_reward_awarded: "false",
    monthly_reward_awarded: "false",
    note: "",
    goals_auto_generated: "true",
  };
}

function hasPersonalReportData(personal) {
  return Boolean(
    personal.creditRow
    || personal.debitRow
    || personal.depositProjectionRow
    || (personal.creditMetrics || []).length
    || (personal.debitIssuances || []).length
    || (personal.depositMetrics || []).length
    || (personal.depositIssuances || []).length
    || (personal.activationPumbMetrics || []).length
    || (personal.activationPumbGiving || []).length
    || personal.activationPumbProjectionRow
    || (personal.activationCardsMetrics || []).length
    || (personal.activationCardsGiving || []).length
    || personal.activationCardsProjectionRow
    || (personal.schedule && personal.schedule.found)
  );
}



function normalizeHeaderKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[’'`]/g, "")
    .replace(/[^a-zа-яіїєґ0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "");
}

function headerMatches(value, aliases) {
  const normalized = normalizeHeaderKey(value);
  return aliases.some((alias) => normalizeHeaderKey(alias) === normalized);
}

function teamReportKey(value) {
  const normalized = normalizeHeaderKey(value);
  const match = normalized.match(/(?:^|_)(?:tm|тм)_?(\d+)(?:_|$)/i);
  return match ? `tm${match[1]}` : "";
}

function isTeamSummaryLogin(value) {
  const normalized = normalizeHeaderKey(value)
    .replace(/^group_/, "")
    .replace(/^група_/, "");
  return /^(?:tm|тм)_?\d+$/i.test(normalized);
}

function getCreditLeaderboard(spreadsheet) {
  const sourceSpreadsheet = spreadsheet || SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = sourceSpreadsheet.getSheetByName(CREDIT_LEADERBOARD_SHEET_NAME);
  if (!sheet) return { rows: [], group_summary: null, group_summaries: {}, updated_at: "" };

  const values = sheet.getDataRange().getDisplayValues();
  if (!values.length) return { rows: [], group_summary: null, group_summaries: {}, updated_at: "" };

  const loginHeaders = ["credit", "кредит", "operator", "оператор", "login", "goals_login"];
  const xsellHeaders = ["x-sell", "xsell", "x_sell"];
  const webHeaders = ["web apps", "web_apps", "webapps", "web app"];
  const inbHeaders = ["inb"];
  const overallHeaders = ["загальний", "загальний підсумок", "overall", "total", "summary"];

  let headerRowIndex = -1;
  let startColumnIndex = -1;

  for (let rowIndex = 0; rowIndex < values.length; rowIndex += 1) {
    const row = values[rowIndex];
    for (let columnIndex = 0; columnIndex <= row.length - 5; columnIndex += 1) {
      if (
        headerMatches(row[columnIndex], loginHeaders) &&
        headerMatches(row[columnIndex + 1], xsellHeaders) &&
        headerMatches(row[columnIndex + 2], webHeaders) &&
        headerMatches(row[columnIndex + 3], inbHeaders) &&
        headerMatches(row[columnIndex + 4], overallHeaders)
      ) {
        headerRowIndex = rowIndex;
        startColumnIndex = columnIndex;
        break;
      }
    }
    if (headerRowIndex !== -1) break;
  }

  if (headerRowIndex === -1 || startColumnIndex === -1) {
    return { rows: [], group_summary: null, group_summaries: {}, updated_at: "" };
  }

  const rows = [];
  const groupSummaries = {};
  let foundData = false;
  let emptyRowsAfterData = 0;

  for (let rowIndex = headerRowIndex + 1; rowIndex < values.length; rowIndex += 1) {
    const row = values[rowIndex];
    const login = normalizeKey(row[startColumnIndex]);
    if (!login) {
      if (foundData) {
        emptyRowsAfterData += 1;
        if (emptyRowsAfterData >= 3) break;
      }
      continue;
    }

    const overall = String(row[startColumnIndex + 4] || "").trim();
    if (!overall) continue;
    foundData = true;
    emptyRowsAfterData = 0;

    const entry = {
      login,
      xsell: String(row[startColumnIndex + 1] || "").trim(),
      web_apps: String(row[startColumnIndex + 2] || "").trim(),
      inb: String(row[startColumnIndex + 3] || "").trim(),
      overall,
    };

    if (isTeamSummaryLogin(login)) {
      const key = teamReportKey(login);
      if (key) groupSummaries[key] = entry;
    } else {
      rows.push(entry);
    }
  }

  const firstSummaryKey = Object.keys(groupSummaries)[0] || "";
  return {
    rows,
    group_summary: groupSummaries.tm6 || (firstSummaryKey ? groupSummaries[firstSummaryKey] : null),
    group_summaries: groupSummaries,
    updated_at: Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "Europe/Kyiv", "dd.MM.yyyy HH:mm"),
  };
}

function getDebitLeaderboard(spreadsheet) {
  const sourceSpreadsheet = spreadsheet || SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = sourceSpreadsheet.getSheetByName(DEBIT_LEADERBOARD_SHEET_NAME);
  if (!sheet) return { rows: [], group_summary: null, group_summaries: {}, updated_at: "" };

  const values = sheet.getDataRange().getDisplayValues();
  if (!values.length) return { rows: [], group_summary: null, group_summaries: {}, updated_at: "" };

  const loginHeaders = ["debit", "debet", "дебет", "operator", "оператор", "login", "goals_login"];
  const inbDebitHeaders = ["inb_deb", "inb deb", "inb debit"];
  const vseCardHeaders = ["vse_card", "vse card", "все card"];
  const webFuibHeaders = ["web_fuib", "web fuib"];
  const webAppsHeaders = ["web_apps", "web apps", "webapps"];
  const xSellHeaders = ["x_sell", "x-sell", "xsell"];
  const overallHeaders = ["загальний deb", "загальний debit", "загальний", "overall", "total", "summary"];

  let headerRowIndex = -1;
  let startColumnIndex = -1;

  for (let rowIndex = 0; rowIndex < values.length; rowIndex += 1) {
    const row = values[rowIndex];
    for (let columnIndex = 0; columnIndex <= row.length - 7; columnIndex += 1) {
      if (
        headerMatches(row[columnIndex], loginHeaders) &&
        headerMatches(row[columnIndex + 1], inbDebitHeaders) &&
        headerMatches(row[columnIndex + 2], vseCardHeaders) &&
        headerMatches(row[columnIndex + 3], webFuibHeaders) &&
        headerMatches(row[columnIndex + 4], webAppsHeaders) &&
        headerMatches(row[columnIndex + 5], xSellHeaders) &&
        headerMatches(row[columnIndex + 6], overallHeaders)
      ) {
        headerRowIndex = rowIndex;
        startColumnIndex = columnIndex;
        break;
      }
    }
    if (headerRowIndex !== -1) break;
  }

  if (headerRowIndex === -1 || startColumnIndex === -1) {
    return { rows: [], group_summary: null, group_summaries: {}, updated_at: "" };
  }

  const rows = [];
  const groupSummaries = {};
  let foundData = false;
  let emptyRowsAfterData = 0;

  for (let rowIndex = headerRowIndex + 1; rowIndex < values.length; rowIndex += 1) {
    const row = values[rowIndex];
    const login = normalizeKey(row[startColumnIndex]);
    if (!login) {
      if (foundData) {
        emptyRowsAfterData += 1;
        if (emptyRowsAfterData >= 3) break;
      }
      continue;
    }

    const overall = String(row[startColumnIndex + 6] || "").trim();
    if (!overall) continue;
    foundData = true;
    emptyRowsAfterData = 0;

    const entry = {
      login,
      inb_deb: String(row[startColumnIndex + 1] || "").trim(),
      vse_card: String(row[startColumnIndex + 2] || "").trim(),
      web_fuib: String(row[startColumnIndex + 3] || "").trim(),
      web_apps: String(row[startColumnIndex + 4] || "").trim(),
      x_sell: String(row[startColumnIndex + 5] || "").trim(),
      overall,
    };

    if (isTeamSummaryLogin(login)) {
      const key = teamReportKey(login);
      if (key) groupSummaries[key] = entry;
    } else {
      rows.push(entry);
    }
  }

  const firstSummaryKey = Object.keys(groupSummaries)[0] || "";
  return {
    rows,
    group_summary: groupSummaries.tm6 || (firstSummaryKey ? groupSummaries[firstSummaryKey] : null),
    group_summaries: groupSummaries,
    updated_at: Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "Europe/Kyiv", "dd.MM.yyyy HH:mm"),
  };
}

function isDepositProjectionValue(value) {
  const text = String(value == null ? "" : value)
    .replace(/\u00A0/g, " ")
    .trim()
    .replace(/\s+/g, "");
  if (!text) return false;
  return /^-?\d+(?:[.,]\d+)?%$/.test(text) || /^-?\d+(?:[.,]\d+)?$/.test(text);
}

function isDepositProjectionLogin(value) {
  const text = normalizeKey(value);
  if (!text || teamReportKey(text)) return false;
  const key = normalizeHeaderKey(text);
  if (["deposit", "депозит", "депозити", "values", "value", "значення", "підсумок", "итого"].includes(key)) {
    return false;
  }
  return /^[a-zа-яіїєґ0-9._-]{2,}$/i.test(text);
}

function scoreDepositProjectionBlock(values, headerRowIndex, teamColumnIndex, loginColumnIndex, valueColumnIndex, layout) {
  let currentTeamKey = "";
  let teamCount = 0;
  let summaryCount = 0;
  let operatorCount = 0;
  let rowsWithData = 0;
  let emptyRowsAfterData = 0;
  const lastRowIndex = Math.min(values.length, headerRowIndex + 140);

  for (let rowIndex = headerRowIndex + 1; rowIndex < lastRowIndex; rowIndex += 1) {
    const row = values[rowIndex] || [];
    const rawTeam = String(row[teamColumnIndex] || "").trim();
    const rawLogin = String(row[loginColumnIndex] || "").trim();
    const rawValue = String(row[valueColumnIndex] || "").trim();

    if (!rawTeam && !rawLogin && !rawValue) {
      if (rowsWithData) {
        emptyRowsAfterData += 1;
        if (emptyRowsAfterData >= 8) break;
      }
      continue;
    }
    emptyRowsAfterData = 0;

    const teamFromTeamColumn = teamReportKey(rawTeam);
    const teamFromLoginColumn = loginColumnIndex === teamColumnIndex ? "" : teamReportKey(rawLogin);
    const detectedTeamKey = teamFromTeamColumn || teamFromLoginColumn;
    if (detectedTeamKey) {
      currentTeamKey = detectedTeamKey;
      teamCount += 1;
      rowsWithData += 1;
      if (isDepositProjectionValue(rawValue)) summaryCount += 1;
      continue;
    }

    let operatorLogin = isDepositProjectionLogin(rawLogin) ? rawLogin : "";
    if (!operatorLogin && loginColumnIndex !== teamColumnIndex && isDepositProjectionLogin(rawTeam)) {
      operatorLogin = rawTeam;
    }
    if (currentTeamKey && operatorLogin && isDepositProjectionValue(rawValue)) {
      operatorCount += 1;
      rowsWithData += 1;
    }
  }

  const valid = teamCount > 0 && operatorCount > 0;
  return {
    valid,
    layout,
    score: valid ? operatorCount * 20 + summaryCount * 8 + teamCount * 3 : -1,
    team_count: teamCount,
    summary_count: summaryCount,
    operator_count: operatorCount,
  };
}

function findDepositProjectionBlock(values) {
  const candidates = [];

  for (let rowIndex = 0; rowIndex < values.length; rowIndex += 1) {
    const row = values[rowIndex] || [];
    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      const key = normalizeHeaderKey(row[columnIndex]);
      const isDepositHeader = key === "deposit" || key === "депозит" || key === "депозити" || key.startsWith("deposit_");
      if (!isDepositHeader) continue;

      // Compact production layout: the team labels and operator logins share
      // one column, while the percentage is stored in the next nearby column.
      // Example: T = TM_6 / fedun / stets, U = 93,28% / 113,45% / 98,43%.
      for (let valueOffset = 1; valueOffset <= 3; valueOffset += 1) {
        const evaluation = scoreDepositProjectionBlock(
          values,
          rowIndex,
          columnIndex,
          columnIndex,
          columnIndex + valueOffset,
          "compact"
        );
        if (evaluation.valid) {
          candidates.push({
            header_row_index: rowIndex,
            team_column_index: columnIndex,
            login_column_index: columnIndex,
            value_column_index: columnIndex + valueOffset,
            layout: evaluation.layout,
            score: evaluation.score,
            team_count: evaluation.team_count,
            summary_count: evaluation.summary_count,
            operator_count: evaluation.operator_count,
          });
        }
      }

      // Split layout fallback: Team | Login | Result, with optional helper
      // columns inserted between the logical fields.
      for (let loginOffset = 1; loginOffset <= 3; loginOffset += 1) {
        for (let valueOffset = loginOffset + 1; valueOffset <= loginOffset + 3; valueOffset += 1) {
          const evaluation = scoreDepositProjectionBlock(
            values,
            rowIndex,
            columnIndex,
            columnIndex + loginOffset,
            columnIndex + valueOffset,
            "split"
          );
          if (!evaluation.valid) continue;
          candidates.push({
            header_row_index: rowIndex,
            team_column_index: columnIndex,
            login_column_index: columnIndex + loginOffset,
            value_column_index: columnIndex + valueOffset,
            layout: evaluation.layout,
            score: evaluation.score,
            team_count: evaluation.team_count,
            summary_count: evaluation.summary_count,
            operator_count: evaluation.operator_count,
          });
        }
      }
    }
  }

  candidates.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    if (right.operator_count !== left.operator_count) return right.operator_count - left.operator_count;
    if (right.summary_count !== left.summary_count) return right.summary_count - left.summary_count;
    if (left.layout !== right.layout) return left.layout === "compact" ? -1 : 1;
    if (left.header_row_index !== right.header_row_index) return left.header_row_index - right.header_row_index;
    return left.team_column_index - right.team_column_index;
  });

  return candidates[0] || null;
}

function getDepositProjectionLeaderboard(spreadsheet) {
  const sourceSpreadsheet = spreadsheet || SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = sourceSpreadsheet.getSheetByName(CREDIT_LEADERBOARD_SHEET_NAME);
  if (!sheet) return { rows: [], group_summaries: {}, updated_at: "", diagnostics: { reason: "sheet_missing" } };

  const values = sheet.getDataRange().getDisplayValues();
  if (!values.length) return { rows: [], group_summaries: {}, updated_at: "", diagnostics: { reason: "sheet_empty" } };

  const block = findDepositProjectionBlock(values);
  if (!block) {
    return {
      rows: [],
      group_summaries: {},
      updated_at: Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "Europe/Kyiv", "dd.MM.yyyy HH:mm"),
      diagnostics: { reason: "deposit_projection_block_not_found" },
    };
  }

  const rows = [];
  const groupSummaries = {};
  let currentTeamKey = "";
  let currentTeamName = "";
  let foundData = false;
  let emptyRowsAfterData = 0;
  const lastRowIndex = Math.min(values.length, block.header_row_index + 140);

  for (let rowIndex = block.header_row_index + 1; rowIndex < lastRowIndex; rowIndex += 1) {
    const row = values[rowIndex] || [];
    const rawTeam = String(row[block.team_column_index] || "").trim();
    const rawLogin = String(row[block.login_column_index] || "").trim();
    const rawValue = String(row[block.value_column_index] || "").trim();

    if (!rawTeam && !rawLogin && !rawValue) {
      if (foundData) {
        emptyRowsAfterData += 1;
        if (emptyRowsAfterData >= 8) break;
      }
      continue;
    }
    emptyRowsAfterData = 0;

    const teamFromTeamColumn = teamReportKey(rawTeam);
    const teamFromLoginColumn = block.login_column_index === block.team_column_index ? "" : teamReportKey(rawLogin);
    const detectedTeamKey = teamFromTeamColumn || teamFromLoginColumn;
    if (detectedTeamKey) {
      currentTeamKey = detectedTeamKey;
      currentTeamName = teamFromTeamColumn ? rawTeam : rawLogin;
      if (isDepositProjectionValue(rawValue)) {
        groupSummaries[currentTeamKey] = {
          team_key: currentTeamKey,
          team_name: currentTeamName,
          projective_rate: rawValue,
          overall: rawValue,
        };
        foundData = true;
      }
      continue;
    }

    let operatorLogin = isDepositProjectionLogin(rawLogin) ? rawLogin : "";
    if (!operatorLogin && block.login_column_index !== block.team_column_index && isDepositProjectionLogin(rawTeam)) {
      operatorLogin = rawTeam;
    }
    if (!currentTeamKey || !operatorLogin || !isDepositProjectionValue(rawValue)) continue;

    rows.push({
      login: normalizeKey(operatorLogin),
      team_key: currentTeamKey,
      team_name: currentTeamName,
      projective_rate: rawValue,
      overall: rawValue,
    });
    foundData = true;
  }

  return {
    rows,
    group_summaries: groupSummaries,
    updated_at: Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "Europe/Kyiv", "dd.MM.yyyy HH:mm"),
    diagnostics: {
      reason: rows.length ? null : "deposit_projection_rows_not_found",
      layout: block.layout,
      header_row: block.header_row_index + 1,
      team_column: block.team_column_index + 1,
      login_column: block.login_column_index + 1,
      value_column: block.value_column_index + 1,
      candidate_score: block.score,
      detected_teams: Object.keys(groupSummaries),
      detected_rows: rows.length,
    },
  };
}

function detectDepositMetricPeriod(value) {
  const key = normalizeHeaderKey(value);
  const isDeposit = key.includes("deposit") || key.includes("депозит") || /(^|_)dep(_|$)/.test(key);
  if (!isDeposit) return "";
  if (key.includes("yesterday") || key.includes("вчора") || key.includes("вчера")) return "yesterday";
  if (key.includes("month") || key.includes("місяць") || key.includes("месяц")) return "month";
  return "";
}

function depositMetricKey(value) {
  const key = normalizeHeaderKey(value);
  if (!key) return "";
  if (key.includes("projective") || key.includes("проекц")) return "projective_rate";
  if ((key.includes("назнач") || key.includes("признач")) && (key.includes("встреч") || key.includes("зустр"))) return "meeting_rate";
  if ((key.includes("выдан") || key.includes("видан")) && (key.includes("обработ") || key.includes("оброб") || key.includes("встреч") || key.includes("зустр"))) return "issuance_rate";
  if (key.includes("обработ") || key.includes("оброб") || key.includes("processed")) return "processed_tasks";
  if (key === "выдачі" || key === "видачі" || key === "выдачи" || key === "видач" || key.includes("issuances")) return "issuances";
  return "";
}

function getDepositMetricRows(goalsLogin, sourceValues) {
  let values = sourceValues;
  if (!values) {
    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = spreadsheet.getSheetByName(DEPOSIT_SHEET_NAME);
    if (!sheet) return [];
    values = sheet.getDataRange().getDisplayValues();
  }
  if (!values.length) return [];

  const outputRows = [];
  const seen = {};
  const updatedAt = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "Europe/Kyiv", "dd.MM.yyyy HH:mm");

  for (let blockRowIndex = 0; blockRowIndex < values.length; blockRowIndex += 1) {
    const row = values[blockRowIndex] || [];
    let period = "";
    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      period = detectDepositMetricPeriod(row[columnIndex]);
      if (period) break;
    }
    if (!period || seen[period]) continue;

    let headerRowIndex = -1;
    let userColumnIndex = -1;
    const headerSearchEnd = Math.min(values.length - 1, blockRowIndex + 10);
    for (let rowIndex = blockRowIndex + 1; rowIndex <= headerSearchEnd; rowIndex += 1) {
      const candidateColumn = (values[rowIndex] || []).findIndex((value) => normalizeKey(value) === goalsLogin);
      if (candidateColumn !== -1) {
        headerRowIndex = rowIndex;
        userColumnIndex = candidateColumn;
        break;
      }
    }
    if (headerRowIndex === -1 || userColumnIndex === -1) continue;

    const summaryColumns = findSummaryColumns(values, blockRowIndex, headerRowIndex);
    const result = {
      goals_login: goalsLogin,
      period,
      team_overall: {},
      updated_at: updatedAt,
    };
    let foundMetric = false;
    const metricSearchEnd = Math.min(values.length - 1, headerRowIndex + 10);

    for (let rowIndex = headerRowIndex + 1; rowIndex <= metricSearchEnd; rowIndex += 1) {
      const metricRow = values[rowIndex] || [];
      let label = "";
      const labelSearchEnd = Math.min(userColumnIndex, 5);
      for (let columnIndex = 0; columnIndex < labelSearchEnd; columnIndex += 1) {
        if (String(metricRow[columnIndex] || "").trim()) {
          label = metricRow[columnIndex];
          break;
        }
      }
      if (detectDepositMetricPeriod(label)) break;
      const metricKey = depositMetricKey(label);
      if (!metricKey) continue;

      const mine = String(metricRow[userColumnIndex] || "").trim();
      result[metricKey] = mine;
      if (summaryColumns.defaultColumn >= 0) {
        const generalValue = String(metricRow[summaryColumns.defaultColumn] || "").trim();
        if (generalValue) result[`${metricKey}_overall`] = generalValue;
      }
      Object.keys(summaryColumns.teamColumns).forEach((teamKey) => {
        const columnIndex = summaryColumns.teamColumns[teamKey];
        const teamValue = String(metricRow[columnIndex] || "").trim();
        if (!result.team_overall[teamKey]) result.team_overall[teamKey] = {};
        result.team_overall[teamKey][`${metricKey}_overall`] = teamValue;
      });
      if (metricKey === "projective_rate") {
        result.projective_source = {
          sheet: DEPOSIT_SHEET_NAME,
          row_label: String(label || "").trim(),
          operator_column: String(values[headerRowIndex][userColumnIndex] || goalsLogin).trim(),
          general_column: summaryColumns.defaultColumn >= 0 ? String(summaryColumns.labels.general || "").trim() : "",
          team_columns: Object.assign({}, summaryColumns.labels),
        };
      }
      foundMetric = true;
    }

    if (foundMetric) {
      outputRows.push(result);
      seen[period] = true;
    }
  }

  return outputRows;
}

function detectDepositGivingPeriod(value) {
  const key = normalizeHeaderKey(value);
  if (!key.includes("giving")) return "";
  if (key.includes("yesterday") || key.includes("вчора") || key.includes("вчера")) return "yesterday";
  if (key.includes("month") || key.includes("місяць") || key.includes("месяц")) return "month";
  return "";
}

function findDepositGivingHeader(values, blockRowIndex) {
  const aliases = {
    team: ["team", "команда", "група"],
    agent: ["агент", "agent", "operator", "оператор", "login", "goals_login"],
    inb: ["inb"],
    vse: ["vse", "все"],
    web: ["web"],
    web_apps: ["web_apps", "web apps", "webapps"],
    overall: ["загальний підсумок", "загальний", "overall", "total", "summary"],
  };
  const searchEnd = Math.min(values.length - 1, blockRowIndex + 6);
  for (let rowIndex = blockRowIndex + 1; rowIndex <= searchEnd; rowIndex += 1) {
    const row = values[rowIndex] || [];
    const columns = {};
    Object.keys(aliases).forEach((key) => {
      columns[key] = row.findIndex((value) => headerMatches(value, aliases[key]));
    });
    if (Object.keys(columns).every((key) => columns[key] !== -1)) {
      return { rowIndex, columns };
    }
  }
  return null;
}

function getDepositGivingData(sourceValues) {
  let values = sourceValues;
  if (!values) {
    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = spreadsheet.getSheetByName(DEPOSIT_SHEET_NAME);
    if (!sheet) return { rows: [], group_summaries: { month: {}, yesterday: {} }, updated_at: "" };
    values = sheet.getDataRange().getDisplayValues();
  }
  if (!values.length) return { rows: [], group_summaries: { month: {}, yesterday: {} }, updated_at: "" };

  const rows = [];
  const groupSummaries = { month: {}, yesterday: {} };
  const seenPeriods = {};
  const updatedAt = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "Europe/Kyiv", "dd.MM.yyyy HH:mm");

  for (let blockRowIndex = 0; blockRowIndex < values.length; blockRowIndex += 1) {
    const blockRow = values[blockRowIndex] || [];
    let period = "";
    for (let columnIndex = 0; columnIndex < blockRow.length; columnIndex += 1) {
      period = detectDepositGivingPeriod(blockRow[columnIndex]);
      if (period) break;
    }
    if (!period || seenPeriods[period]) continue;
    const header = findDepositGivingHeader(values, blockRowIndex);
    if (!header) continue;

    let currentTeamKey = "";
    let currentTeamName = "";
    let foundData = false;
    let emptyRows = 0;
    for (let rowIndex = header.rowIndex + 1; rowIndex < values.length; rowIndex += 1) {
      const row = values[rowIndex] || [];
      const nextBlock = row.some((value) => Boolean(detectDepositGivingPeriod(value)));
      if (nextBlock) break;

      const rawTeam = String(row[header.columns.team] || "").trim();
      const rawAgent = String(row[header.columns.agent] || "").trim();
      const hasValues = ["inb", "vse", "web", "web_apps", "overall"].some((key) => String(row[header.columns[key]] || "").trim() !== "");
      if (!rawTeam && !rawAgent && !hasValues) {
        if (foundData) {
          emptyRows += 1;
          if (emptyRows >= 3) break;
        }
        continue;
      }
      emptyRows = 0;

      if (rawTeam) {
        const detectedTeamKey = teamReportKey(rawTeam);
        if (detectedTeamKey) {
          currentTeamKey = detectedTeamKey;
          currentTeamName = rawTeam;
        }
      }
      if (!currentTeamKey || !hasValues) continue;

      const entry = {
        period,
        team_key: currentTeamKey,
        team_name: currentTeamName,
        inb: String(row[header.columns.inb] || "").trim(),
        vse: String(row[header.columns.vse] || "").trim(),
        web: String(row[header.columns.web] || "").trim(),
        web_apps: String(row[header.columns.web_apps] || "").trim(),
        overall: String(row[header.columns.overall] || "").trim(),
        updated_at: updatedAt,
      };

      if (!rawAgent) {
        groupSummaries[period][currentTeamKey] = entry;
      } else {
        entry.login = normalizeKey(rawAgent);
        if (entry.login) rows.push(entry);
      }
      foundData = true;
    }
    seenPeriods[period] = true;
  }

  return { rows, group_summaries: groupSummaries, updated_at: updatedAt };
}

function getDepositIssuanceRows(goalsLogin, depositData) {
  const data = depositData || getDepositGivingData();
  return (data.rows || []).filter((row) => normalizeKey(row.login) === goalsLogin);
}

function getDepositLogins(depositData) {
  const data = depositData || getDepositGivingData();
  return Array.from(new Set((data.rows || []).map((row) => normalizeKey(row.login)).filter(Boolean)));
}

function detectDebitIssuancePeriod(value) {
  const key = normalizeHeaderKey(value);
  if (!key.includes("giving")) return "";
  if (key.includes("yesterday") || key.includes("вчора")) return "yesterday";
  if (key.includes("month") || key.includes("місяць")) return "month";
  return "";
}

function headerStartsWithAlias(value, aliases) {
  const normalized = normalizeHeaderKey(value);
  return aliases.some((alias) => normalized.indexOf(normalizeHeaderKey(alias)) === 0);
}

function getDebitIssuanceRows(goalsLogin, sourceValues) {
  let values = sourceValues;
  if (!values) {
    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = spreadsheet.getSheetByName(DEBIT_ISSUANCES_SHEET_NAME);
    if (!sheet) return [];
    values = sheet.getDataRange().getDisplayValues();
  }
  if (!values.length) return [];

  const rows = [];
  const seen = {};
  const availablePeriods = {};
  const updatedAt = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "Europe/Kyiv", "dd.MM.yyyy HH:mm");

  for (let headerRowIndex = 0; headerRowIndex < values.length; headerRowIndex += 1) {
    const headerRow = values[headerRowIndex];
    for (let startColumnIndex = 0; startColumnIndex <= headerRow.length - 7; startColumnIndex += 1) {
      const period = detectDebitIssuancePeriod(headerRow[startColumnIndex]);
      if (!period || seen[period]) continue;

      const validHeaders =
        headerStartsWithAlias(headerRow[startColumnIndex + 1], ["inb_deb", "inb deb"]) &&
        headerStartsWithAlias(headerRow[startColumnIndex + 2], ["vse_card", "vse card"]) &&
        headerStartsWithAlias(headerRow[startColumnIndex + 3], ["web_fuib", "web fuib"]) &&
        headerStartsWithAlias(headerRow[startColumnIndex + 4], ["web_apps", "web apps"]) &&
        headerStartsWithAlias(headerRow[startColumnIndex + 5], ["x_sell", "x-sell", "xsell"]) &&
        headerStartsWithAlias(headerRow[startColumnIndex + 6], ["загальний", "overall", "total"]);
      if (!validHeaders) continue;
      availablePeriods[period] = true;

      for (let rowIndex = headerRowIndex + 1; rowIndex < values.length; rowIndex += 1) {
        const row = values[rowIndex];
        if (detectDebitIssuancePeriod(row[startColumnIndex])) break;
        const login = normalizeKey(row[startColumnIndex]);
        if (!login) continue;
        if (login !== goalsLogin) continue;

        rows.push({
          goals_login: goalsLogin,
          period,
          inb_deb: String(row[startColumnIndex + 1] || "").trim(),
          vse_card: String(row[startColumnIndex + 2] || "").trim(),
          web_fuib: String(row[startColumnIndex + 3] || "").trim(),
          web_apps: String(row[startColumnIndex + 4] || "").trim(),
          x_sell: String(row[startColumnIndex + 5] || "").trim(),
          overall: String(row[startColumnIndex + 6] || "").trim(),
          updated_at: updatedAt,
        });
        seen[period] = true;
        break;
      }
    }
  }

  ["month", "yesterday"].forEach((period) => {
    if (!availablePeriods[period] || seen[period]) return;
    rows.push({
      goals_login: goalsLogin,
      period,
      inb_deb: "0",
      vse_card: "0",
      web_fuib: "0",
      web_apps: "0",
      x_sell: "0",
      overall: "0",
      updated_at: updatedAt,
    });
  });

  return rows;
}


function detectTransformationBlock(value) {
  const key = normalizeHeaderKey(value);
  let channel = "";
  let period = "";

  if (key.includes("x_sell") || key.includes("xsell")) channel = "xsell";
  else if (key.includes("web_apps") || key.includes("webapps") || key.includes("web_app")) channel = "web_apps";
  else if (key === "inb" || key.startsWith("inb_")) channel = "inb";

  if (key.includes("month") || key.includes("monthly") || key.includes("місяць")) period = "month";
  else if (key.includes("yesterday") || key.includes("вчора")) period = "yesterday";

  return channel && period ? { channel, period } : null;
}

function transformationMetricKey(value) {
  const key = normalizeHeaderKey(value);
  if (!key) return "";
  if ((key.includes("обработ") || key.includes("оброблен") || key.includes("processed")) && (key.includes("задач") || key.includes("task"))) return "processed_tasks";
  if (key.includes("уровень_соглас") || key.includes("рівень_згод") || key.includes("agreement")) return "agreement_rate";
  if (key.includes("callback")) return "callback_rate";
  if (key === "aht" || key.includes("average_handle_time")) return "aht";
  if (key.includes("reject")) return "reject_rate";
  if ((key.includes("выдач") || key.includes("видач") || key.includes("issuance") || key.includes("issue")) && (key.includes("обработ") || key.includes("оброблен") || key.includes("processed"))) return "issuance_rate";
  if (key.includes("projective") || key.includes("проекц")) return "projective_rate";
  return "";
}

function findSummaryColumns(values, blockRowIndex, headerRowIndex) {
  let defaultColumn = -1;
  const teamColumns = {};
  const labels = {};
  const endRow = Math.min(values.length - 1, headerRowIndex + 2);
  for (let rowIndex = blockRowIndex; rowIndex <= endRow; rowIndex += 1) {
    const row = values[rowIndex];
    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      const rawLabel = String(row[columnIndex] || "").trim();
      const key = normalizeHeaderKey(rawLabel);
      const isSummary = key.includes("підсумок") || key.includes("итог") || key.includes("summary") || key.includes("total");
      if (!isSummary) continue;
      const teamKey = teamReportKey(key);
      if (teamKey) {
        teamColumns[teamKey] = columnIndex;
        labels[teamKey] = rawLabel;
      }
      // A general comparison is used only when the sheet explicitly says that it is general.
      // We intentionally do not fall back to TM6 or to the first team column.
      if (!teamKey && defaultColumn === -1 && (key.includes("загальний") || key.includes("general") || key.includes("overall"))) {
        defaultColumn = columnIndex;
        labels.general = rawLabel;
      }
    }
  }
  return { defaultColumn, teamColumns, labels };
}

function getTransformationMetricRows(goalsLogin, sourceValues) {
  let values = sourceValues;
  if (!values) {
    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = spreadsheet.getSheetByName(TRANSFORMATION_SHEET_NAME);
    if (!sheet) return [];
    values = sheet.getDataRange().getDisplayValues();
  }
  if (!values.length) return [];

  const rows = [];
  const seen = {};

  for (let blockRowIndex = 0; blockRowIndex < values.length; blockRowIndex += 1) {
    const blockRow = values[blockRowIndex];
    let block = null;
    for (let columnIndex = 0; columnIndex < blockRow.length; columnIndex += 1) {
      block = detectTransformationBlock(blockRow[columnIndex]);
      if (block) break;
    }
    if (!block) continue;

    const blockKey = `${block.channel}:${block.period}`;
    if (seen[blockKey]) continue;

    let headerRowIndex = -1;
    let userColumnIndex = -1;
    const headerSearchEnd = Math.min(values.length - 1, blockRowIndex + 10);
    for (let rowIndex = blockRowIndex + 1; rowIndex <= headerSearchEnd; rowIndex += 1) {
      const candidateColumn = values[rowIndex].findIndex(
        (value) => normalizeKey(value) === goalsLogin
      );
      if (candidateColumn !== -1) {
        headerRowIndex = rowIndex;
        userColumnIndex = candidateColumn;
        break;
      }
    }
    if (headerRowIndex === -1 || userColumnIndex === -1) continue;

    const summaryColumns = findSummaryColumns(values, blockRowIndex, headerRowIndex);
    const overallColumnIndex = summaryColumns.defaultColumn;

    const output = {
      goals_login: goalsLogin,
      channel: block.channel,
      period: block.period,
      team_overall: {},
      updated_at: Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "Europe/Kyiv", "dd.MM.yyyy HH:mm"),
    };
    let foundMetric = false;
    const metricSearchEnd = Math.min(values.length - 1, headerRowIndex + 14);

    for (let rowIndex = headerRowIndex + 1; rowIndex <= metricSearchEnd; rowIndex += 1) {
      const row = values[rowIndex];
      let label = "";
      const labelSearchEnd = Math.min(userColumnIndex, 6);
      for (let columnIndex = 0; columnIndex < labelSearchEnd; columnIndex += 1) {
        if (String(row[columnIndex] || "").trim()) {
          label = row[columnIndex];
          break;
        }
      }

      if (detectTransformationBlock(label)) break;
      const metricKey = transformationMetricKey(label);
      if (!metricKey) continue;

      const mine = String(row[userColumnIndex] || "").trim();
      const overall = overallColumnIndex >= 0 ? String(row[overallColumnIndex] || "").trim() : "";
      if (metricKey === "processed_tasks") {
        output.processed_tasks = mine;
        if (overall) output.processed_tasks_overall = overall;
      } else {
        output[metricKey] = mine;
        if (overall) output[`${metricKey}_overall`] = overall;
      }
      if (metricKey === "projective_rate") {
        output.projective_source = {
          sheet: TRANSFORMATION_SHEET_NAME,
          row_label: String(label || "").trim(),
          operator_column: String(values[headerRowIndex][userColumnIndex] || goalsLogin).trim(),
          general_column: overallColumnIndex >= 0 ? String(summaryColumns.labels.general || "").trim() : "",
          team_columns: Object.assign({}, summaryColumns.labels),
        };
      }
      Object.keys(summaryColumns.teamColumns).forEach((teamKey) => {
        const columnIndex = summaryColumns.teamColumns[teamKey];
        const teamValue = String(row[columnIndex] || "").trim();
        if (!output.team_overall[teamKey]) output.team_overall[teamKey] = {};
        if (metricKey === "processed_tasks") output.team_overall[teamKey].processed_tasks_overall = teamValue;
        else output.team_overall[teamKey][`${metricKey}_overall`] = teamValue;
      });
      foundMetric = true;
    }

    if (foundMetric) {
      rows.push(output);
      seen[blockKey] = true;
    }
  }

  return rows;
}

function getCreditMetricRows(goalsLogin, sources) {
  const transformationRows = getTransformationMetricRows(
    goalsLogin,
    sources && sources.transformationValues
  );
  if (transformationRows.length) return transformationRows;

  let values = sources && sources.creditMetricValues;
  if (!values) {
    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = spreadsheet.getSheetByName(CREDIT_METRICS_SHEET_NAME);
    if (!sheet) return [];
    values = sheet.getDataRange().getDisplayValues();
  }
  if (values.length < 2) return [];
  const [headerRow, ...rows] = values;
  const headers = headerRow.map((header) => String(header).trim());
  const normalizedHeaders = headers.map(normalizeKey);
  const keyIndex = normalizedHeaders.indexOf("goals_login");
  if (keyIndex === -1) throw new Error('В аркуші "CreditMetrics" немає колонки "goals_login"');

  return rows
    .filter((row) => normalizeKey(row[keyIndex]) === goalsLogin)
    .map((row) => rowToObject(headers, row));
}




// ────────────────────────────────────────────────────────────────────────
// V125 activation reports: PUMB Online + Card activation
// ────────────────────────────────────────────────────────────────────────
function activationPeriodFromTitle(value) {
  const key = normalizeHeaderKey(value);
  if (key.includes("yesterday") || key.includes("вчора")) return "yesterday";
  if (key.includes("month") || key.includes("monthly") || key.includes("міся")) return "month";
  return "";
}

function isActivationTransformTitle(value, kind) {
  const key = normalizeHeaderKey(value);
  if (!activationPeriodFromTitle(value)) return false;
  if (kind === "pumb") {
    return key.includes("pumb_online") && (key.includes("transformation") || key.includes("tranformation"));
  }
  return key.includes("card_activation") && (key.includes("transformation") || key.includes("tranformation"));
}

function isActivationLoginValue(value) {
  const raw = String(value == null ? "" : value).trim();
  const key = normalizeKey(raw);
  if (!key || key.length < 3 || key.length > 80) return false;
  if (teamReportKey(key) || isTeamSummaryLogin(key)) return false;
  if (/[%:]/.test(raw) || /^\d+(?:[.,]\d+)?$/.test(raw)) return false;
  const headerKey = normalizeHeaderKey(raw);
  if (
    headerKey.includes("підсумок") || headerKey.includes("итог") || headerKey.includes("summary") ||
    headerKey.includes("значен") || headerKey.includes("values") || headerKey.includes("позначки") ||
    headerKey.includes("general") || headerKey.includes("overall") || headerKey.includes("загальний")
  ) return false;
  return /^[a-z0-9._-]+$/i.test(raw);
}

function activationHeaderRow(values, blockRowIndex, maxLookahead) {
  const end = Math.min(values.length - 1, blockRowIndex + (maxLookahead || 10));
  let fallback = null;
  for (let rowIndex = blockRowIndex + 1; rowIndex <= end; rowIndex += 1) {
    const row = values[rowIndex] || [];
    const logins = [];
    for (let columnIndex = 1; columnIndex < row.length; columnIndex += 1) {
      if (isActivationLoginValue(row[columnIndex])) logins.push(columnIndex);
    }
    if (logins.length < 2) continue;
    const firstKey = normalizeHeaderKey(row[0]);
    const candidate = { rowIndex, loginColumns: logins };
    if (firstKey.includes("значен") || firstKey.includes("values") || firstKey.includes("позначки")) return candidate;
    if (!fallback) fallback = candidate;
  }
  return fallback;
}

function activationSummaryColumns(values, blockRowIndex, headerRowIndex, loginColumns) {
  const base = findSummaryColumns(values, blockRowIndex, headerRowIndex);
  const result = {
    defaultColumn: base.defaultColumn,
    teamColumns: Object.assign({}, base.teamColumns || {}),
    labels: Object.assign({}, base.labels || {}),
  };
  const loginSet = {};
  (loginColumns || []).forEach((columnIndex) => { loginSet[columnIndex] = true; });
  for (let rowIndex = blockRowIndex; rowIndex <= headerRowIndex; rowIndex += 1) {
    const row = values[rowIndex] || [];
    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      const raw = String(row[columnIndex] || "").trim();
      const key = normalizeHeaderKey(raw);
      if (!raw) continue;
      const teamKey = teamReportKey(raw);
      if (teamKey && !loginSet[columnIndex]) {
        result.teamColumns[teamKey] = columnIndex;
        if (!result.labels[teamKey]) result.labels[teamKey] = raw;
      }
      if (
        result.defaultColumn === -1 && !loginSet[columnIndex] &&
        (key.includes("загальний") || key.includes("general") || key.includes("overall")) &&
        (key.includes("підсумок") || key.includes("итог") || key.includes("summary") || key.includes("overall"))
      ) {
        result.defaultColumn = columnIndex;
        result.labels.general = raw;
      }
    }
  }
  return result;
}

function activationTeamKeyForColumn(values, blockRowIndex, headerRowIndex, columnIndex) {
  let winner = "";
  let winnerColumn = -1;
  for (let rowIndex = blockRowIndex; rowIndex < headerRowIndex; rowIndex += 1) {
    const row = values[rowIndex] || [];
    for (let candidateColumn = 0; candidateColumn <= columnIndex && candidateColumn < row.length; candidateColumn += 1) {
      const key = teamReportKey(row[candidateColumn]);
      if (key && candidateColumn >= winnerColumn) {
        winner = key;
        winnerColumn = candidateColumn;
      }
    }
  }
  return winner;
}

function pumbActivationMetricKey(value) {
  const key = normalizeHeaderKey(value);
  if (!key) return "";
  if (key === "aht" || key.includes("average_handle_time") || key === "ант") return "aht";
  if (key.includes("проекц") || key.includes("project")) return "projective_rate";
  if (key.includes("активац") && (key.includes("пумб") || key.includes("pumb")) && (key.includes("обработ") || key.includes("оброблен") || key.includes("processed"))) return "activation_online_rate";
  if (key.includes("активац") && (key.includes("соглас") || key.includes("згод") || key.includes("consent") || key.includes("agreement"))) return "activation_from_agreements_rate";
  if (key.includes("всего_выполн") || key.includes("всього_викон") || key.includes("completed")) return "completion_rate";
  if (key.includes("уровень_соглас") || key.includes("рівень_згод") || key.includes("agreement")) return "agreement_rate";
  if (key.includes("клиент") || key.includes("клієнт") || key.includes("processed")) return "processed_tasks";
  return "";
}

function cardActivationMetricKey(value) {
  const key = normalizeHeaderKey(value);
  if (!key) return "";
  if (key === "aht" || key.includes("average_handle_time") || key === "ант") return "aht";
  if (key.includes("активац") && (key.includes("соглас") || key.includes("згод") || key.includes("consent") || key.includes("agreement"))) return "activation_from_agreements_rate";
  if (key.includes("активац") && (key.includes("обработ") || key.includes("оброблен") || key.includes("processed"))) return "activation_from_processed_rate";
  if ((key.includes("соглас") || key.includes("згод") || key.includes("consent")) && (key.includes("обработ") || key.includes("оброблен") || key.includes("processed"))) return "agreement_to_processed_rate";
  if (key.includes("обработ") || key.includes("оброблен") || key.includes("processed")) return "processed_tasks";
  return "";
}

function parseActivationTransformation(values, kind, sheetName) {
  const rows = [];
  const groupSummaries = { month: {}, yesterday: {} };
  const diagnostics = { sheet: sheetName, blocks: [] };
  const metricKeyFor = kind === "pumb" ? pumbActivationMetricKey : cardActivationMetricKey;
  const updatedAt = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || SCHEDULE_TIMEZONE, "dd.MM.yyyy HH:mm");

  for (let blockRowIndex = 0; blockRowIndex < values.length; blockRowIndex += 1) {
    const blockRow = values[blockRowIndex] || [];
    const titleColumn = blockRow.findIndex((cell) => isActivationTransformTitle(cell, kind));
    if (titleColumn === -1) continue;
    const title = blockRow[titleColumn];
    const period = activationPeriodFromTitle(title);
    const header = activationHeaderRow(values, blockRowIndex, 10);
    if (!header || !period) {
      diagnostics.blocks.push({ title: String(title || ""), row: blockRowIndex + 1, reason: "header_not_found" });
      continue;
    }

    const summary = activationSummaryColumns(values, blockRowIndex, header.rowIndex, header.loginColumns);
    const outputs = {};
    header.loginColumns.forEach((columnIndex) => {
      const login = normalizeKey(values[header.rowIndex][columnIndex]);
      if (!login) return;
      outputs[columnIndex] = {
        goals_login: login,
        login,
        period,
        team_key: activationTeamKeyForColumn(values, blockRowIndex, header.rowIndex, columnIndex),
        updated_at: updatedAt,
      };
    });

    let foundMetrics = 0;
    const metricEnd = Math.min(values.length - 1, header.rowIndex + 16);
    for (let rowIndex = header.rowIndex + 1; rowIndex <= metricEnd; rowIndex += 1) {
      const row = values[rowIndex] || [];
      const nextTitle = row.some((cell) => isActivationTransformTitle(cell, kind));
      if (nextTitle) break;
      const firstLabel = String(row[0] || "").trim();
      const firstKey = normalizeHeaderKey(firstLabel);
      if (firstKey.includes("giving") || firstKey.includes("видач")) break;
      const metricKey = metricKeyFor(firstLabel);
      if (!metricKey) continue;
      foundMetrics += 1;
      Object.keys(outputs).forEach((columnText) => {
        const columnIndex = Number(columnText);
        const value = String(row[columnIndex] || "").trim();
        outputs[columnIndex][metricKey] = value;
        const operatorTeamKey = outputs[columnIndex].team_key;
        const operatorTeamColumn = operatorTeamKey && Object.prototype.hasOwnProperty.call(summary.teamColumns, operatorTeamKey)
          ? summary.teamColumns[operatorTeamKey]
          : -1;
        if (operatorTeamColumn >= 0) {
          const teamValue = String(row[operatorTeamColumn] || "").trim();
          if (teamValue) outputs[columnIndex][`${metricKey}_team`] = teamValue;
        }
        if (summary.defaultColumn >= 0) {
          const overall = String(row[summary.defaultColumn] || "").trim();
          if (overall) outputs[columnIndex][`${metricKey}_overall`] = overall;
        }
        if (metricKey === "projective_rate") {
          outputs[columnIndex].projective_source = {
            sheet: sheetName,
            row_label: firstLabel,
            operator_column: String(values[header.rowIndex][columnIndex] || "").trim(),
            general_column: summary.defaultColumn >= 0 ? String(summary.labels.general || "").trim() : "",
            team_columns: Object.assign({}, summary.labels),
          };
        }
      });
      Object.keys(summary.teamColumns).forEach((teamKey) => {
        const columnIndex = summary.teamColumns[teamKey];
        const value = String(row[columnIndex] || "").trim();
        if (!groupSummaries[period][teamKey]) groupSummaries[period][teamKey] = {};
        if (metricKey === "processed_tasks") groupSummaries[period][teamKey].processed_tasks = value;
        else groupSummaries[period][teamKey][metricKey] = value;
      });
      if (summary.defaultColumn >= 0) {
        const value = String(row[summary.defaultColumn] || "").trim();
        if (!groupSummaries[period].general) groupSummaries[period].general = {};
        if (metricKey === "processed_tasks") groupSummaries[period].general.processed_tasks = value;
        else groupSummaries[period].general[metricKey] = value;
      }
    }

    Object.keys(outputs).forEach((columnText) => {
      const output = outputs[Number(columnText)];
      if (foundMetrics) rows.push(output);
    });
    diagnostics.blocks.push({
      title: String(title || ""),
      row: blockRowIndex + 1,
      header_row: header.rowIndex + 1,
      period,
      operators: Object.keys(outputs).length,
      metrics: foundMetrics,
    });
  }

  // Bind the exact team summary for the same period to every personal row.
  // This prevents the UI from accidentally mixing a yesterday team summary
  // with a month personal row when legacy/stale snapshots contain extra rows.
  rows.forEach((row) => {
    const teamSummary = row && row.period && row.team_key
      ? groupSummaries[row.period] && groupSummaries[row.period][row.team_key]
      : null;
    if (!teamSummary || typeof teamSummary !== "object") return;
    row.team_summary = Object.assign({}, teamSummary);
    Object.keys(teamSummary).forEach((metricKey) => {
      const value = teamSummary[metricKey];
      if (value !== undefined && value !== null && String(value).trim() !== "") {
        row[`${metricKey}_team`] = value;
      }
    });
  });

  return { rows, group_summaries: groupSummaries, updated_at: updatedAt, diagnostics };
}

function getActivationPumbGivingData(values) {
  const rows = [];
  const groupSummaries = { month: {}, yesterday: {} };
  const updatedAt = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || SCHEDULE_TIMEZONE, "dd.MM.yyyy HH:mm");
  for (let titleRowIndex = 0; titleRowIndex < values.length; titleRowIndex += 1) {
    const row = values[titleRowIndex] || [];
    const title = row.find((cell) => normalizeHeaderKey(cell).includes("pumb_online_giving"));
    if (!title) continue;
    const period = activationPeriodFromTitle(title) || "month";
    let currentTeamKey = "";
    let blankRun = 0;
    for (let rowIndex = titleRowIndex + 1; rowIndex < Math.min(values.length, titleRowIndex + 35); rowIndex += 1) {
      const current = values[rowIndex] || [];
      const first = String(current[0] || "").trim();
      const second = String(current[1] || "").trim();
      const third = String(current[2] || "").trim();
      const nextTitle = current.some((cell) => {
        const key = normalizeHeaderKey(cell);
        return key.includes("pumb_online_giving") || key.includes("card_activation");
      });
      if (nextTitle) break;
      if (!first && !second && !third) {
        blankRun += 1;
        if (blankRun >= 2 && rows.some((item) => item.period === period)) break;
        continue;
      }
      blankRun = 0;
      const teamKey = teamReportKey(first);
      if (teamKey) currentTeamKey = teamKey;
      const firstKey = normalizeHeaderKey(first);
      if (firstKey.includes("підсумок") || firstKey.includes("итог") || firstKey.includes("summary")) {
        if (currentTeamKey) groupSummaries[period][currentTeamKey] = { overall: third, updated_at: updatedAt };
        continue;
      }
      if (!isActivationLoginValue(second) || !third) continue;
      rows.push({
        goals_login: normalizeKey(second),
        login: normalizeKey(second),
        period,
        team_key: currentTeamKey,
        overall: third,
        updated_at: updatedAt,
      });
    }
  }
  rows.forEach((row) => {
    const summary = row && row.period && row.team_key
      ? groupSummaries[row.period] && groupSummaries[row.period][row.team_key]
      : null;
    if (summary && String(summary.overall || "").trim()) {
      row.team_overall = String(summary.overall).trim();
    }
  });
  return { rows, group_summaries: groupSummaries, updated_at: updatedAt };
}

function getActivationPumbData(spreadsheet) {
  const sourceSpreadsheet = spreadsheet || SpreadsheetApp.openById(SPREADSHEET_ID);
  const values = sheetDisplayValues(sourceSpreadsheet, ACTIVATION_PUMB_SHEET_NAME);
  if (!values.length) {
    return { metrics: [], leaderboard: [], group_summaries: { month: {}, yesterday: {} }, giving: [], giving_group_summaries: { month: {}, yesterday: {} }, updated_at: "", diagnostics: { reason: "sheet_missing_or_empty" } };
  }
  const transformation = parseActivationTransformation(values, "pumb", ACTIVATION_PUMB_SHEET_NAME);
  const giving = getActivationPumbGivingData(values);
  const leaderboard = transformation.rows
    .filter((row) => row.period === "month" && String(row.projective_rate || "").trim())
    .map((row) => ({
      login: row.login,
      goals_login: row.goals_login,
      team_key: row.team_key,
      projective_rate: row.projective_rate,
      updated_at: row.updated_at,
    }));
  return {
    metrics: transformation.rows,
    leaderboard,
    group_summaries: transformation.group_summaries,
    giving: giving.rows,
    giving_group_summaries: giving.group_summaries,
    updated_at: transformation.updated_at,
    diagnostics: transformation.diagnostics,
  };
}

function activationTransliterate(value) {
  const map = {
    а:"a", б:"b", в:"v", г:"h", ґ:"g", д:"d", е:"e", є:"ie", ж:"zh", з:"z", и:"y", і:"i", ї:"i", й:"i",
    к:"k", л:"l", м:"m", н:"n", о:"o", п:"p", р:"r", с:"s", т:"t", у:"u", ф:"f", х:"kh", ц:"ts", ч:"ch",
    ш:"sh", щ:"shch", ь:"", ю:"iu", я:"ia", ы:"y", э:"e", ё:"io", ъ:"",
  };
  return String(value || "").toLowerCase().split("").map((char) => map[char] !== undefined ? map[char] : char).join("");
}

function activationLatinKey(value) {
  return activationTransliterate(value)
    .replace(/[^a-z0-9]+/g, "")
    .replace(/y/g, "i")
    .replace(/j/g, "i")
    .replace(/kh/g, "h")
    .replace(/ai/g, "a")
    .replace(/ie/g, "e");
}

function activationCommonPrefix(left, right) {
  const limit = Math.min(left.length, right.length);
  let length = 0;
  while (length < limit && left[length] === right[length]) length += 1;
  return length;
}

function activationEditDistance(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  const previous = [];
  for (let column = 0; column <= b.length; column += 1) previous[column] = column;
  for (let row = 1; row <= a.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= b.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1)
      );
    }
    for (let column = 0; column <= b.length; column += 1) previous[column] = current[column];
  }
  return previous[b.length];
}

function activationMatchNameToLogin(fullName, logins, usedLogins) {
  const surname = String(fullName || "").trim().split(/\s+/)[0] || "";
  const nameKey = activationLatinKey(surname);
  let best = null;
  (logins || []).forEach((login) => {
    const normalizedLogin = normalizeKey(login);
    if (!normalizedLogin || (usedLogins && usedLogins[normalizedLogin])) return;
    const loginKey = activationLatinKey(normalizedLogin);
    const prefix = activationCommonPrefix(nameKey, loginKey);
    const distance = activationEditDistance(nameKey, loginKey);
    const maxLength = Math.max(nameKey.length, loginKey.length, 1);
    const similarity = 1 - distance / maxLength;
    let score = similarity * 100 + prefix * 5;
    if (nameKey === loginKey) score += 100;
    if (nameKey.startsWith(loginKey) || loginKey.startsWith(nameKey)) score += 45;
    if (!best || score > best.score) best = { login: normalizedLogin, score, prefix, similarity };
  });
  return best && (best.prefix >= 4 || best.similarity >= 0.55) ? best : null;
}

function getActivationCardsProjection(values, availableLogins) {
  const rows = [];
  const groupSummaries = {};
  const diagnostics = { mappings: [] };
  const used = {};
  const updatedAt = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || SCHEDULE_TIMEZONE, "dd.MM.yyyy HH:mm");
  let titleRowIndex = -1;
  for (let rowIndex = 0; rowIndex < Math.min(values.length, 20); rowIndex += 1) {
    const key = normalizeHeaderKey(values[rowIndex] && values[rowIndex][0]);
    if (key === "card_activation" || (key.includes("card_activation") && !key.includes("transformation") && !key.includes("giving"))) {
      titleRowIndex = rowIndex;
      break;
    }
  }
  if (titleRowIndex === -1) return { rows, group_summaries: groupSummaries, updated_at: updatedAt, diagnostics: { reason: "projection_block_not_found" } };

  let currentTeamKey = "";
  for (let rowIndex = titleRowIndex + 1; rowIndex < Math.min(values.length, titleRowIndex + 25); rowIndex += 1) {
    const row = values[rowIndex] || [];
    const label = String(row[0] || "").trim();
    const value = String(row[1] || "").trim();
    const labelKey = normalizeHeaderKey(label);
    if (!label && !value) {
      if (rows.length) break;
      continue;
    }
    if (labelKey.includes("transformation")) break;
    const teamKey = teamReportKey(label);
    if (teamKey) {
      currentTeamKey = teamKey;
      if (value) groupSummaries[teamKey] = { projective_rate: value, updated_at: updatedAt };
      continue;
    }
    if (!value || !/%/.test(value)) continue;
    const match = activationMatchNameToLogin(label, availableLogins, used);
    diagnostics.mappings.push({ name: label, login: match ? match.login : "", score: match ? Math.round(match.score * 10) / 10 : 0 });
    if (!match) continue;
    used[match.login] = true;
    rows.push({
      login: match.login,
      goals_login: match.login,
      name: label,
      team_key: currentTeamKey,
      projective_rate: value,
      updated_at: updatedAt,
    });
  }
  return { rows, group_summaries: groupSummaries, updated_at: updatedAt, diagnostics };
}

function getActivationCardsGivingData(values) {
  const rows = [];
  const groupSummaries = { month: {}, yesterday: {} };
  const diagnostics = { blocks: [] };
  const updatedAt = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || SCHEDULE_TIMEZONE, "dd.MM.yyyy HH:mm");
  for (let blockRowIndex = 0; blockRowIndex < values.length; blockRowIndex += 1) {
    const title = (values[blockRowIndex] || []).find((cell) => {
      const key = normalizeHeaderKey(cell);
      return key.includes("card_activation_giving");
    });
    if (!title) continue;
    const period = activationPeriodFromTitle(title) || "month";
    const header = activationHeaderRow(values, blockRowIndex, 8);
    if (!header) {
      diagnostics.blocks.push({ row: blockRowIndex + 1, period, reason: "header_not_found" });
      continue;
    }
    const summary = activationSummaryColumns(values, blockRowIndex, header.rowIndex, header.loginColumns);
    const outputs = {};
    header.loginColumns.forEach((columnIndex) => {
      const login = normalizeKey(values[header.rowIndex][columnIndex]);
      outputs[columnIndex] = {
        goals_login: login,
        login,
        period,
        team_key: activationTeamKeyForColumn(values, blockRowIndex, header.rowIndex, columnIndex),
        segment_a: "0",
        segment_b: "0",
        segment_c: "0",
        segment_d: "0",
        overall: "0",
        updated_at: updatedAt,
      };
    });
    const metricEnd = Math.min(values.length - 1, header.rowIndex + 16);
    for (let rowIndex = header.rowIndex + 1; rowIndex <= metricEnd; rowIndex += 1) {
      const row = values[rowIndex] || [];
      const label = String(row[0] || "").trim();
      const key = normalizeHeaderKey(label);
      if (row.some((cell) => normalizeHeaderKey(cell).includes("card_activation_giving"))) break;
      let metricKey = "";
      if (key === "a") metricKey = "segment_a";
      else if (key === "b") metricKey = "segment_b";
      else if (key === "c") metricKey = "segment_c";
      else if (key === "d") metricKey = "segment_d";
      else if (key.includes("загальний_підсумок") || key.includes("общий_итог") || key.includes("grand_total")) metricKey = "overall";
      if (!metricKey) continue;
      Object.keys(outputs).forEach((columnText) => {
        const columnIndex = Number(columnText);
        outputs[columnIndex][metricKey] = String(row[columnIndex] || "0").trim() || "0";
      });
      Object.keys(summary.teamColumns).forEach((teamKey) => {
        if (!groupSummaries[period][teamKey]) groupSummaries[period][teamKey] = {};
        groupSummaries[period][teamKey][metricKey] = String(row[summary.teamColumns[teamKey]] || "0").trim() || "0";
      });
      if (summary.defaultColumn >= 0) {
        if (!groupSummaries[period].general) groupSummaries[period].general = {};
        groupSummaries[period].general[metricKey] = String(row[summary.defaultColumn] || "0").trim() || "0";
      }
    }
    Object.keys(outputs).forEach((columnText) => rows.push(outputs[Number(columnText)]));
    diagnostics.blocks.push({ row: blockRowIndex + 1, header_row: header.rowIndex + 1, period, operators: Object.keys(outputs).length });
  }
  return { rows, group_summaries: groupSummaries, updated_at: updatedAt, diagnostics };
}

function getActivationCardsData(spreadsheet) {
  const sourceSpreadsheet = spreadsheet || SpreadsheetApp.openById(SPREADSHEET_ID);
  const values = sheetDisplayValues(sourceSpreadsheet, ACTIVATION_CARDS_SHEET_NAME);
  if (!values.length) {
    return { metrics: [], leaderboard: [], group_summaries: {}, giving: [], giving_group_summaries: { month: {}, yesterday: {} }, updated_at: "", diagnostics: { reason: "sheet_missing_or_empty" } };
  }
  const transformation = parseActivationTransformation(values, "cards", ACTIVATION_CARDS_SHEET_NAME);
  const availableLogins = Array.from(new Set(transformation.rows.map((row) => normalizeKey(row.login)).filter(Boolean)));
  const projection = getActivationCardsProjection(values, availableLogins);
  const giving = getActivationCardsGivingData(values);
  return {
    metrics: transformation.rows,
    leaderboard: projection.rows,
    group_summaries: projection.group_summaries,
    transformation_group_summaries: transformation.group_summaries,
    giving: giving.rows,
    giving_group_summaries: giving.group_summaries,
    updated_at: transformation.updated_at || projection.updated_at,
    diagnostics: {
      transformation: transformation.diagnostics,
      projection: projection.diagnostics,
      giving: giving.diagnostics,
    },
  };
}

function activationRowsForLogin(rows, goalsLogin) {
  return (Array.isArray(rows) ? rows : []).filter((row) => normalizeKey(row && (row.login || row.goals_login)) === goalsLogin);
}


function scheduleWeekdayIndex(value) {
  const key = normalizeHeaderKey(value);
  const aliases = {
    "нд": 0, "неділя": 0, "sun": 0, "sunday": 0,
    "пн": 1, "понеділок": 1, "mon": 1, "monday": 1,
    "вт": 2, "вівторок": 2, "tue": 2, "tuesday": 2,
    "ср": 3, "середа": 3, "wed": 3, "wednesday": 3,
    "чт": 4, "четвер": 4, "thu": 4, "thursday": 4,
    "пт": 5, "пятниця": 5, "п'ятниця": 5, "fri": 5, "friday": 5,
    "сб": 6, "субота": 6, "sat": 6, "saturday": 6,
  };
  return Object.prototype.hasOwnProperty.call(aliases, key) ? aliases[key] : -1;
}

function isValidDateValue(value) {
  return Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value.getTime());
}

function scheduleDayNumber(rawValue, displayValue) {
  if (isValidDateValue(rawValue)) return rawValue.getDate();

  if (typeof rawValue === "number" && isFinite(rawValue)) {
    const rounded = Math.round(rawValue);
    if (Math.abs(rawValue - rounded) < 0.000001 && rounded >= 1 && rounded <= 31) return rounded;
  }

  const display = String(displayValue == null || displayValue === "" ? rawValue : displayValue)
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\u00A0/g, " ")
    .trim();
  if (!display) return 0;

  const plainNumber = display.replace(",", ".");
  if (/^\d{1,2}(?:\.0+)?$/.test(plainNumber)) {
    const day = Math.round(Number(plainNumber));
    return day >= 1 && day <= 31 ? day : 0;
  }

  const dateMatch = display.match(/^(\d{1,2})[.\/-](\d{1,2})(?:[.\/-](\d{2,4}))?$/);
  if (dateMatch) {
    const day = Number(dateMatch[1]);
    return day >= 1 && day <= 31 ? day : 0;
  }

  return 0;
}

function findScheduleDateRow(displayValues, rawValues, headerRowIndex, firstScheduleColumn) {
  const upperBound = Math.min(displayValues.length, Math.max(headerRowIndex + 4, 15));
  let best = null;

  for (let rowIndex = 0; rowIndex < upperBound; rowIndex += 1) {
    let dayCellCount = 0;
    let sequentialPairs = 0;
    let previousDay = null;
    const samples = [];
    const row = displayValues[rowIndex] || [];
    const rawRow = rawValues[rowIndex] || [];

    for (let columnIndex = firstScheduleColumn; columnIndex < row.length; columnIndex += 1) {
      const day = scheduleDayNumber(rawRow[columnIndex], row[columnIndex]);
      if (!day) continue;
      dayCellCount += 1;
      if (samples.length < 8) samples.push(day);
      if (previousDay !== null && (day === previousDay + 1 || (previousDay >= 28 && day === 1))) {
        sequentialPairs += 1;
      }
      previousDay = day;
    }

    if (dayCellCount < 3) continue;
    const distance = Math.abs(rowIndex - headerRowIndex);
    const aboveHeaderBonus = rowIndex < headerRowIndex ? 20 : 0;
    const score = dayCellCount * 20 + sequentialPairs * 5 + aboveHeaderBonus - distance;
    if (!best || score > best.score) {
      best = { rowIndex, dayCellCount, sequentialPairs, samples, score };
    }
  }

  return best;
}

function scheduleIsoDate(date) {
  return Utilities.formatDate(date, SCHEDULE_TIMEZONE, "yyyy-MM-dd");
}

function scheduleDateCandidate(year, month, day, weekdayIndex) {
  const candidate = new Date(year, month, day, 12, 0, 0, 0);
  if (candidate.getMonth() !== month || candidate.getDate() !== day) return null;
  if (weekdayIndex >= 0 && candidate.getDay() !== weekdayIndex) return null;
  return candidate;
}

function inferScheduleDate(day, weekdayIndex, previousDate) {
  const now = new Date();
  const candidates = [];
  const base = previousDate || now;
  const startOffset = previousDate ? 0 : -3;
  const endOffset = previousDate ? 4 : 7;

  for (let offset = startOffset; offset <= endOffset; offset += 1) {
    const year = base.getFullYear();
    const month = base.getMonth() + offset;
    const normalized = new Date(year, month, 1, 12, 0, 0, 0);
    const candidate = scheduleDateCandidate(normalized.getFullYear(), normalized.getMonth(), day, weekdayIndex);
    if (!candidate) continue;
    if (previousDate && candidate.getTime() <= previousDate.getTime()) continue;
    candidates.push(candidate);
  }

  if (!candidates.length) {
    const fallbackMonth = previousDate && day < previousDate.getDate()
      ? previousDate.getMonth() + 1
      : base.getMonth();
    return new Date(base.getFullYear(), fallbackMonth, day, 12, 0, 0, 0);
  }

  const target = previousDate
    ? new Date(previousDate.getFullYear(), previousDate.getMonth(), previousDate.getDate() + 1, 12, 0, 0, 0)
    : now;
  candidates.sort((a, b) => Math.abs(a.getTime() - target.getTime()) - Math.abs(b.getTime() - target.getTime()));
  return candidates[0];
}

function normalizeScheduleCell(value) {
  const raw = String(value == null ? "" : value).trim();
  const compact = raw.replace(/\s+/g, "").replace(/[–—−]/g, "-");
  const key = normalizeKey(compact);

  if (!compact || key === "в" || key === "в." || key === "off" || key === "вихідний") {
    return {
      type: "day_off",
      title: "Вихідний",
      start: "",
      end: "",
      raw,
    };
  }

  if (key.includes("відпуст") || key.includes("отпуск") || key.includes("vacation")) {
    return {
      type: "vacation",
      title: "Відпустка",
      start: "",
      end: "",
      raw,
    };
  }

  const match = compact.match(/^(\d{1,2})(?::(\d{2}))?-(\d{1,2})(?::(\d{2}))?$/);
  if (match) {
    const startHour = Number(match[1]);
    const startMinute = Number(match[2] || 0);
    const endHour = Number(match[3]);
    const endMinute = Number(match[4] || 0);
    const start = `${String(startHour).padStart(2, "0")}:${String(startMinute).padStart(2, "0")}`;
    const end = `${String(endHour).padStart(2, "0")}:${String(endMinute).padStart(2, "0")}`;
    let type = "work";
    let title = "Робочий день";
    if (startHour === 11 && endHour === 20) {
      type = "late_shift";
      title = "Пізня зміна";
    } else if (startHour === 10 && endHour === 19) {
      type = "weekend_shift";
      title = "Зміна у вихідний";
    }
    return { type, title, start, end, raw };
  }

  return {
    type: "unknown",
    title: raw || "Графік не вказаний",
    start: "",
    end: "",
    raw,
  };
}

function getScheduleForLogin(goalsLogin, sourceData) {
  let displayValues = sourceData && sourceData.displayValues;
  let rawValues = sourceData && sourceData.rawValues;
  if (!displayValues || !rawValues) {
    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = spreadsheet.getSheetByName(SCHEDULE_SHEET_NAME);
    if (!sheet) {
      return { found: false, reason: "schedule_sheet_missing", sheet_name: SCHEDULE_SHEET_NAME, days: [] };
    }
    const range = sheet.getDataRange();
    displayValues = range.getDisplayValues();
    rawValues = range.getValues();
  }
  if (!displayValues.length) {
    return { found: false, reason: "schedule_sheet_empty", sheet_name: SCHEDULE_SHEET_NAME, days: [] };
  }

  const loginAliases = ["логін", "логин", "login", "goals_login"];
  const nameAliases = ["піб", "фио", "пиб", "employee_name", "name", "працівник"];
  const rateAliases = ["ставка", "rate", "fte"];
  let headerRowIndex = -1;
  let loginColumnIndex = -1;

  for (let rowIndex = 0; rowIndex < Math.min(displayValues.length, 25); rowIndex += 1) {
    const row = displayValues[rowIndex];
    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      if (headerMatches(row[columnIndex], loginAliases)) {
        headerRowIndex = rowIndex;
        loginColumnIndex = columnIndex;
        break;
      }
    }
    if (headerRowIndex !== -1) break;
  }

  if (headerRowIndex === -1 || loginColumnIndex === -1) {
    return { found: false, reason: "schedule_login_header_missing", sheet_name: SCHEDULE_SHEET_NAME, days: [] };
  }

  const headerRow = displayValues[headerRowIndex];
  const nameColumnIndex = headerRow.findIndex((value) => headerMatches(value, nameAliases));
  const rateColumnIndex = headerRow.findIndex((value) => headerMatches(value, rateAliases));
  const firstScheduleColumn = Math.max(loginColumnIndex, nameColumnIndex, rateColumnIndex) + 1;
  const dateRowMatch = findScheduleDateRow(
    displayValues,
    rawValues,
    headerRowIndex,
    Math.max(0, firstScheduleColumn)
  );
  const dateRowIndex = dateRowMatch ? dateRowMatch.rowIndex : -1;

  if (dateRowIndex === -1) {
    return {
      found: false,
      reason: "schedule_date_row_missing",
      sheet_name: SCHEDULE_SHEET_NAME,
      days: [],
      diagnostics: {
        header_row: headerRowIndex + 1,
        login_column: loginColumnIndex + 1,
        first_schedule_column: firstScheduleColumn + 1,
        scanned_rows: Math.min(displayValues.length, Math.max(headerRowIndex + 4, 15)),
        top_rows: displayValues.slice(0, Math.min(4, displayValues.length)).map((row) => row.slice(0, 12)),
      },
    };
  }

  let employeeRowIndex = -1;
  for (let rowIndex = headerRowIndex + 1; rowIndex < displayValues.length; rowIndex += 1) {
    if (normalizeKey(displayValues[rowIndex][loginColumnIndex]) === goalsLogin) {
      employeeRowIndex = rowIndex;
      break;
    }
  }

  if (employeeRowIndex === -1) {
    return {
      found: false,
      reason: "schedule_login_not_found",
      sheet_name: SCHEDULE_SHEET_NAME,
      goals_login: goalsLogin,
      days: [],
    };
  }

  const dateColumns = [];
  const dateDisplayRow = displayValues[dateRowIndex];
  const dateRawRow = rawValues[dateRowIndex];
  for (let columnIndex = Math.max(0, firstScheduleColumn); columnIndex < dateDisplayRow.length; columnIndex += 1) {
    const day = scheduleDayNumber(dateRawRow[columnIndex], dateDisplayRow[columnIndex]);
    if (!day) continue;
    dateColumns.push({
      columnIndex,
      day,
      weekdayIndex: scheduleWeekdayIndex(headerRow[columnIndex]),
      rawDate: dateRawRow[columnIndex],
    });
  }

  let previousDate = null;
  const days = dateColumns.map((column) => {
    let date;
    if (isValidDateValue(column.rawDate)) {
      date = new Date(column.rawDate.getFullYear(), column.rawDate.getMonth(), column.rawDate.getDate(), 12, 0, 0, 0);
    } else {
      date = inferScheduleDate(column.day, column.weekdayIndex, previousDate);
    }
    previousDate = date;
    const parsed = normalizeScheduleCell(displayValues[employeeRowIndex][column.columnIndex]);
    return {
      date: scheduleIsoDate(date),
      day: date.getDate(),
      weekday: Utilities.formatDate(date, SCHEDULE_TIMEZONE, "EEE").toLowerCase(),
      type: parsed.type,
      title: parsed.title,
      start: parsed.start,
      end: parsed.end,
      raw: parsed.raw,
    };
  });

  return {
    found: true,
    reason: null,
    sheet_name: SCHEDULE_SHEET_NAME,
    goals_login: goalsLogin,
    employee: {
      name: nameColumnIndex >= 0 ? String(displayValues[employeeRowIndex][nameColumnIndex] || "").trim() : "",
      login: String(displayValues[employeeRowIndex][loginColumnIndex] || goalsLogin).trim(),
      rate: rateColumnIndex >= 0 ? String(displayValues[employeeRowIndex][rateColumnIndex] || "").trim() : "",
    },
    range_start: days.length ? days[0].date : "",
    range_end: days.length ? days[days.length - 1].date : "",
    updated_at: Utilities.formatDate(new Date(), SCHEDULE_TIMEZONE, "dd.MM.yyyy HH:mm"),
    diagnostics: {
      header_row: headerRowIndex + 1,
      date_row: dateRowIndex + 1,
      employee_row: employeeRowIndex + 1,
      login_column: loginColumnIndex + 1,
      first_schedule_column: firstScheduleColumn + 1,
      detected_day_cells: dateRowMatch ? dateRowMatch.dayCellCount : dateColumns.length,
      date_samples: dateRowMatch ? dateRowMatch.samples : [],
    },
    days,
  };
}

function sheetDisplayValues(spreadsheet, sheetName) {
  const sheet = spreadsheet.getSheetByName(sheetName);
  return sheet ? sheet.getDataRange().getDisplayValues() : [];
}

function scheduleSourceData(spreadsheet) {
  const sheet = spreadsheet.getSheetByName(SCHEDULE_SHEET_NAME);
  if (!sheet) return null;
  const range = sheet.getDataRange();
  return {
    displayValues: range.getDisplayValues(),
    rawValues: range.getValues(),
  };
}

function getScheduleLogins(sourceData) {
  const displayValues = sourceData && sourceData.displayValues;
  if (!displayValues || !displayValues.length) return [];

  const loginAliases = ["логін", "логин", "login", "goals_login"];
  let headerRowIndex = -1;
  let loginColumnIndex = -1;

  for (let rowIndex = 0; rowIndex < Math.min(displayValues.length, 25); rowIndex += 1) {
    const row = displayValues[rowIndex];
    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      if (headerMatches(row[columnIndex], loginAliases)) {
        headerRowIndex = rowIndex;
        loginColumnIndex = columnIndex;
        break;
      }
    }
    if (headerRowIndex !== -1) break;
  }

  if (headerRowIndex === -1 || loginColumnIndex === -1) return [];
  return Array.from(new Set(
    displayValues
      .slice(headerRowIndex + 1)
      .map((row) => normalizeKey(row[loginColumnIndex]))
      .filter(Boolean)
  ));
}

function emptyScheduleSnapshot(reason, goalsLogin) {
  return {
    found: false,
    reason,
    sheet_name: SCHEDULE_SHEET_NAME,
    goals_login: goalsLogin || "",
    days: [],
  };
}

function loadReportSources(spreadsheet) {
  return {
    transformationValues: sheetDisplayValues(spreadsheet, TRANSFORMATION_SHEET_NAME),
    creditMetricValues: sheetDisplayValues(spreadsheet, CREDIT_METRICS_SHEET_NAME),
    debitIssuanceValues: sheetDisplayValues(spreadsheet, DEBIT_ISSUANCES_SHEET_NAME),
    depositValues: sheetDisplayValues(spreadsheet, DEPOSIT_SHEET_NAME),
    schedule: scheduleSourceData(spreadsheet),
  };
}

function buildReportSnapshots(spreadsheet) {
  const context = getSheetContext(spreadsheet);
  const goalsLoginIndex = context.normalizedHeaders.indexOf("goals_login");
  if (goalsLoginIndex === -1) throw new Error('Немає колонки "goals_login"');

  const sources = loadReportSources(spreadsheet);
  const leaderboard = getCreditLeaderboard(spreadsheet);
  const debitLeaderboard = getDebitLeaderboard(spreadsheet);
  const depositProjection = getDepositProjectionLeaderboard(spreadsheet);
  const depositGiving = getDepositGivingData(sources.depositValues);
  const activationPumb = getActivationPumbData(spreadsheet);
  const activationCards = getActivationCardsData(spreadsheet);
  const now = new Date();
  const timezone = Session.getScriptTimeZone() || SCHEDULE_TIMEZONE;
  const snapshotUpdatedAt = Utilities.formatDate(now, timezone, "dd.MM.yyyy HH:mm");
  const snapshotDay = Utilities.formatDate(now, timezone, "yyyy-MM-dd");
  const snapshotVersion = `${Date.now()}-${Utilities.getUuid()}`;

  const goalLogins = context.rows
    .map((row) => normalizeKey(row[goalsLoginIndex]))
    .filter(Boolean);
  const scheduleLogins = getScheduleLogins(sources.schedule);
  const creditLogins = (leaderboard.rows || []).map((row) => normalizeKey(row.login)).filter(Boolean);
  const debitLogins = (debitLeaderboard.rows || []).map((row) => normalizeKey(row.login)).filter(Boolean);
  const depositLogins = getDepositLogins(depositGiving);
  const depositProjectionLogins = (depositProjection.rows || []).map((row) => normalizeKey(row.login)).filter(Boolean);
  const activationPumbLogins = (activationPumb.metrics || []).concat(activationPumb.giving || [], activationPumb.leaderboard || []).map((row) => normalizeKey(row.login || row.goals_login)).filter(Boolean);
  const activationCardsLogins = (activationCards.metrics || []).concat(activationCards.giving || [], activationCards.leaderboard || []).map((row) => normalizeKey(row.login || row.goals_login)).filter(Boolean);
  const logins = Array.from(new Set(
    goalLogins
      .concat(scheduleLogins, creditLogins, debitLogins, depositLogins, depositProjectionLogins, activationPumbLogins, activationCardsLogins)
  )).sort();

  const reports = logins.map((goalsLogin) => {
    const found = findGoalRow(context, goalsLogin);
    const hasGoalRow = found.rowOffset !== -1;
    const schedule = sources.schedule
      ? getScheduleForLogin(goalsLogin, sources.schedule)
      : emptyScheduleSnapshot("schedule_sheet_missing", goalsLogin);
    const creditMetrics = getCreditMetricRows(goalsLogin, sources);
    const debitIssuances = getDebitIssuanceRows(goalsLogin, sources.debitIssuanceValues);
    const depositMetrics = getDepositMetricRows(goalsLogin, sources.depositValues);
    const depositIssuances = getDepositIssuanceRows(goalsLogin, depositGiving);
    const activationPumbMetrics = activationRowsForLogin(activationPumb.metrics, goalsLogin);
    const activationPumbGiving = activationRowsForLogin(activationPumb.giving, goalsLogin);
    const activationCardsMetrics = activationRowsForLogin(activationCards.metrics, goalsLogin);
    const activationCardsGiving = activationRowsForLogin(activationCards.giving, goalsLogin);
    const personal = {
      creditRow: reportRowByLogin(leaderboard.rows, goalsLogin),
      debitRow: reportRowByLogin(debitLeaderboard.rows, goalsLogin),
      depositProjectionRow: reportRowByLogin(depositProjection.rows, goalsLogin),
      creditMetrics,
      debitIssuances,
      depositMetrics,
      depositIssuances,
      activationPumbMetrics,
      activationPumbGiving,
      activationPumbProjectionRow: reportRowByLogin(activationPumb.leaderboard, goalsLogin),
      activationCardsMetrics,
      activationCardsGiving,
      activationCardsProjectionRow: reportRowByLogin(activationCards.leaderboard, goalsLogin),
      schedule,
    };
    const reportFound = hasGoalRow || hasPersonalReportData(personal);
    const goals = hasGoalRow
      ? rowToObject(context.headers, context.rows[found.rowOffset])
      : buildAutomaticGoals(context, goalsLogin, personal);

    return {
      goals_login: goalsLogin,
      payload: {
        success: true,
        api_version: REPORT_CACHE_API_VERSION,
        report_mode: "manual_snapshot",
        snapshot_version: snapshotVersion,
        snapshot_updated_at: snapshotUpdatedAt,
        snapshot_day: snapshotDay,
        goals_login: goalsLogin,
        found: reportFound,
        report_found: reportFound,
        goals_found: hasGoalRow,
        reason: hasGoalRow ? null : (reportFound ? "goals_auto_generated" : "key_not_found"),
        goals,
        credit_metrics: creditMetrics,
        credit_leaderboard: leaderboard.rows,
        credit_group_summary: leaderboard.group_summary,
        credit_group_summaries: leaderboard.group_summaries || {},
        credit_leaderboard_updated_at: snapshotUpdatedAt,
        debit_leaderboard: debitLeaderboard.rows,
        debit_group_summary: debitLeaderboard.group_summary,
        debit_group_summaries: debitLeaderboard.group_summaries || {},
        debit_leaderboard_updated_at: snapshotUpdatedAt,
        debit_issuances: debitIssuances,
        deposit_metrics: depositMetrics,
        deposit_projection_leaderboard: depositProjection.rows,
        deposit_projection_group_summaries: depositProjection.group_summaries || {},
        deposit_projection_updated_at: depositProjection.updated_at || snapshotUpdatedAt,
        deposit_projection_diagnostics: depositProjection.diagnostics || {},
        deposit_leaderboard: depositGiving.rows,
        deposit_group_summaries: depositGiving.group_summaries || { month: {}, yesterday: {} },
        deposit_leaderboard_updated_at: snapshotUpdatedAt,
        deposit_issuances: depositIssuances,
        activation_pumb_metrics: activationPumbMetrics,
        activation_pumb_leaderboard: activationPumb.leaderboard || [],
        activation_pumb_group_summaries: activationPumb.group_summaries || { month: {}, yesterday: {} },
        activation_pumb_giving: activationPumbGiving,
        activation_pumb_giving_leaderboard: activationPumb.giving || [],
        activation_pumb_giving_group_summaries: activationPumb.giving_group_summaries || { month: {}, yesterday: {} },
        activation_pumb_updated_at: activationPumb.updated_at || snapshotUpdatedAt,
        activation_pumb_diagnostics: activationPumb.diagnostics || {},
        activation_cards_metrics: activationCardsMetrics,
        activation_cards_leaderboard: activationCards.leaderboard || [],
        activation_cards_group_summaries: activationCards.group_summaries || {},
        activation_cards_transformation_group_summaries: activationCards.transformation_group_summaries || { month: {}, yesterday: {} },
        activation_cards_giving: activationCardsGiving,
        activation_cards_giving_leaderboard: activationCards.giving || [],
        activation_cards_giving_group_summaries: activationCards.giving_group_summaries || { month: {}, yesterday: {} },
        activation_cards_updated_at: activationCards.updated_at || snapshotUpdatedAt,
        activation_cards_diagnostics: activationCards.diagnostics || {},
        schedule,
      },
    };
  });

  return {
    reports,
    snapshotVersion,
    snapshotUpdatedAt,
    snapshotDay,
  };
}

function splitReportJson(value) {
  const text = String(value || "");
  const chunks = [];
  for (let offset = 0; offset < text.length; offset += REPORT_CACHE_CHUNK_SIZE) {
    chunks.push(text.slice(offset, offset + REPORT_CACHE_CHUNK_SIZE));
  }
  return chunks.length ? chunks : [""];
}

function getOrCreateReportCacheSheet(spreadsheet) {
  let sheet = spreadsheet.getSheetByName(REPORT_CACHE_SHEET_NAME);
  if (!sheet) sheet = spreadsheet.insertSheet(REPORT_CACHE_SHEET_NAME);
  return sheet;
}

function writeReportCache(spreadsheet, snapshot) {
  const prepared = snapshot.reports.map((entry) => ({
    goalsLogin: entry.goals_login,
    chunks: splitReportJson(JSON.stringify(entry.payload)),
  }));
  const maxChunks = Math.max(1, ...prepared.map((entry) => entry.chunks.length));
  const width = 3 + maxChunks;
  const header = ["goals_login", "snapshot_updated_at", "chunk_count"];
  for (let index = 0; index < maxChunks; index += 1) header.push(`payload_${index + 1}`);

  const rows = prepared.map((entry) => [
    entry.goalsLogin,
    snapshot.snapshotUpdatedAt,
    entry.chunks.length,
    ...entry.chunks,
    ...Array(Math.max(0, maxChunks - entry.chunks.length)).fill(""),
  ]);

  const sheet = getOrCreateReportCacheSheet(spreadsheet);
  sheet.clearContents();
  sheet.getRange(1, 1, 1, width).setValues([header]);
  if (rows.length) sheet.getRange(2, 1, rows.length, width).setValues(rows);
  sheet.setFrozenRows(1);
  sheet.hideSheet();

  PropertiesService.getScriptProperties().setProperties({
    REPORT_CACHE_VERSION: snapshot.snapshotVersion,
    REPORT_CACHE_UPDATED_AT: snapshot.snapshotUpdatedAt,
    REPORT_CACHE_DAY: snapshot.snapshotDay,
  });
}

function readCachedReport(goalsLogin) {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = spreadsheet.getSheetByName(REPORT_CACHE_SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) return null;

  const finder = sheet
    .getRange(2, 1, sheet.getLastRow() - 1, 1)
    .createTextFinder(goalsLogin)
    .matchEntireCell(true)
    .matchCase(false);
  const cell = finder.findNext();
  if (!cell) return null;

  const row = sheet.getRange(cell.getRow(), 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const chunkCount = Math.max(0, Number(row[2] || 0));
  const json = row.slice(3, 3 + chunkCount).join("");
  if (!json) return null;
  const payload = JSON.parse(json);
  payload.snapshot_updated_at = payload.snapshot_updated_at || row[1] || "";
  return payload;
}

function readFirstCachedReport() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = spreadsheet.getSheetByName(REPORT_CACHE_SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) return null;
  const row = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const chunkCount = Math.max(0, Number(row[2] || 0));
  const json = row.slice(3, 3 + chunkCount).join("");
  if (!json) return null;
  const payload = JSON.parse(json);
  payload.snapshot_updated_at = payload.snapshot_updated_at || row[1] || "";
  return payload;
}

function getOrCreateTeamMessagesSheet() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = spreadsheet.getSheetByName(TEAM_MESSAGES_SHEET_NAME);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(TEAM_MESSAGES_SHEET_NAME);
    sheet.getRange(1, 1, 1, 5).setValues([["team_id", "message", "updated_at", "updated_by", "updated_by_name"]]);
    sheet.setFrozenRows(1);
    sheet.hideSheet();
  }
  return sheet;
}

function readTeamMessage(teamId) {
  const normalizedTeamId = String(teamId || "").trim();
  if (!normalizedTeamId) return { team_id: null, message: "", updated_at: null, updated_by: null, updated_by_name: null };
  const sheet = getOrCreateTeamMessagesSheet();
  if (sheet.getLastRow() < 2) return { team_id: normalizedTeamId, message: "", updated_at: null, updated_by: null, updated_by_name: null };
  const finder = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1)
    .createTextFinder(normalizedTeamId)
    .matchEntireCell(true)
    .matchCase(false);
  const cell = finder.findNext();
  if (!cell) return { team_id: normalizedTeamId, message: "", updated_at: null, updated_by: null, updated_by_name: null };
  const row = sheet.getRange(cell.getRow(), 1, 1, 5).getDisplayValues()[0];
  return {
    team_id: normalizedTeamId,
    message: String(row[1] || ""),
    updated_at: row[2] || null,
    updated_by: row[3] || null,
    updated_by_name: row[4] || null,
  };
}

function writeTeamMessage(teamId, message, updatedBy, updatedByName) {
  const normalizedTeamId = String(teamId || "").trim();
  if (!normalizedTeamId) throw new Error("team_id is required");
  const sheet = getOrCreateTeamMessagesSheet();
  let rowNumber = sheet.getLastRow() + 1;
  if (sheet.getLastRow() >= 2) {
    const finder = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1)
      .createTextFinder(normalizedTeamId)
      .matchEntireCell(true)
      .matchCase(false);
    const cell = finder.findNext();
    if (cell) rowNumber = cell.getRow();
  }
  const updatedAt = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || SCHEDULE_TIMEZONE, "dd.MM.yyyy HH:mm");
  const payload = [
    normalizedTeamId,
    String(message || "").trim().slice(0, 1200),
    updatedAt,
    String(updatedBy || ""),
    String(updatedByName || "Керівник"),
  ];
  sheet.getRange(rowNumber, 1, 1, 5).setValues([payload]);
  SpreadsheetApp.flush();
  return {
    team_id: normalizedTeamId,
    message: payload[1],
    updated_at: updatedAt,
    updated_by: payload[3] || null,
    updated_by_name: payload[4] || null,
  };
}

function readGoalsSettings() {
  const properties = PropertiesService.getScriptProperties();
  return {
    allow_cross_team_reports: properties.getProperty("ALLOW_CROSS_TEAM_REPORTS") === "true",
    updated_at: properties.getProperty("GOALS_SETTINGS_UPDATED_AT") || null,
    updated_by_name: properties.getProperty("GOALS_SETTINGS_UPDATED_BY_NAME") || null,
  };
}

function writeGoalsSettings(allowCrossTeamReports, updatedByName) {
  const updatedAt = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || SCHEDULE_TIMEZONE, "dd.MM.yyyy HH:mm");
  PropertiesService.getScriptProperties().setProperties({
    ALLOW_CROSS_TEAM_REPORTS: allowCrossTeamReports ? "true" : "false",
    GOALS_SETTINGS_UPDATED_AT: updatedAt,
    GOALS_SETTINGS_UPDATED_BY_NAME: String(updatedByName || "Адміністратор"),
  });
  return {
    allow_cross_team_reports: Boolean(allowCrossTeamReports),
    updated_at: updatedAt,
    updated_by_name: String(updatedByName || "Адміністратор"),
  };
}

function readAllCachedGoals() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = spreadsheet.getSheetByName(REPORT_CACHE_SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) {
    return { goals_by_login: {}, snapshot_updated_at: "" };
  }

  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getDisplayValues();
  const goalsByLogin = {};
  let snapshotUpdatedAt = "";
  values.forEach((row) => {
    const goalsLogin = normalizeKey(row[0]);
    const chunkCount = Math.max(0, Number(row[2] || 0));
    const json = row.slice(3, 3 + chunkCount).join("");
    if (!goalsLogin || !json) return;
    const payload = JSON.parse(json);
    if (payload.found && payload.goals) goalsByLogin[goalsLogin] = payload.goals;
    if (!snapshotUpdatedAt) snapshotUpdatedAt = payload.snapshot_updated_at || row[1] || "";
  });
  return { goals_by_login: goalsByLogin, snapshot_updated_at: snapshotUpdatedAt };
}

function getReportManifest() {
  const properties = PropertiesService.getScriptProperties();
  return {
    success: true,
    api_version: REPORT_CACHE_API_VERSION,
    report_mode: "manual_snapshot",
    snapshot_version: properties.getProperty("REPORT_CACHE_VERSION") || "",
    snapshot_updated_at: properties.getProperty("REPORT_CACHE_UPDATED_AT") || "",
    snapshot_day: properties.getProperty("REPORT_CACHE_DAY") || "",
  };
}

function reportsNotRefreshedPayload(goalsLogin) {
  const manifest = getReportManifest();
  const updatedAt = manifest.snapshot_updated_at || "";
  return {
    success: true,
    api_version: REPORT_CACHE_API_VERSION,
    report_mode: "manual_snapshot",
    snapshot_version: manifest.snapshot_version,
    snapshot_updated_at: updatedAt,
    snapshot_day: manifest.snapshot_day,
    goals_login: goalsLogin,
    found: false,
    report_found: false,
    goals_found: false,
    reason: "reports_not_refreshed",
    goals: null,
    credit_metrics: [],
    credit_leaderboard: [],
    credit_group_summary: null,
    credit_group_summaries: {},
    credit_leaderboard_updated_at: updatedAt,
    debit_leaderboard: [],
    debit_group_summary: null,
    debit_group_summaries: {},
    debit_leaderboard_updated_at: updatedAt,
    debit_issuances: [],
    deposit_metrics: [],
    deposit_projection_leaderboard: [],
    deposit_projection_group_summaries: {},
    deposit_projection_updated_at: updatedAt,
    deposit_leaderboard: [],
    deposit_group_summaries: { month: {}, yesterday: {} },
    deposit_leaderboard_updated_at: updatedAt,
    deposit_issuances: [],
    activation_pumb_metrics: [],
    activation_pumb_leaderboard: [],
    activation_pumb_group_summaries: { month: {}, yesterday: {} },
    activation_pumb_giving: [],
    activation_pumb_giving_leaderboard: [],
    activation_pumb_giving_group_summaries: { month: {}, yesterday: {} },
    activation_pumb_updated_at: updatedAt,
    activation_pumb_diagnostics: {},
    activation_cards_metrics: [],
    activation_cards_leaderboard: [],
    activation_cards_group_summaries: {},
    activation_cards_transformation_group_summaries: { month: {}, yesterday: {} },
    activation_cards_giving: [],
    activation_cards_giving_leaderboard: [],
    activation_cards_giving_group_summaries: { month: {}, yesterday: {} },
    activation_cards_updated_at: updatedAt,
    activation_cards_diagnostics: {},
    schedule: emptyScheduleSnapshot("reports_not_refreshed", goalsLogin),
  };
}

function notifyBackendReportsPublished(snapshot) {
  const properties = PropertiesService.getScriptProperties();
  const backendUrl = String(properties.getProperty("VPDK_BACKEND_URL") || "").replace(/\/+$/, "");
  const token = String(properties.getProperty("REPORTS_WEBHOOK_TOKEN") || "");
  if (!backendUrl || !token || !snapshot) return { skipped: true, reason: "webhook_not_configured" };

  const firstReport = snapshot.reports && snapshot.reports.length ? snapshot.reports[0].payload : {};
  const payload = {
    snapshot_version: snapshot.snapshotVersion,
    snapshot_updated_at: snapshot.snapshotUpdatedAt,
    snapshot_day: snapshot.snapshotDay,
    updated_profiles: snapshot.reports ? snapshot.reports.length : 0,
    credit_group_summaries: firstReport.credit_group_summaries || {},
    debit_group_summaries: firstReport.debit_group_summaries || {},
    deposit_group_summaries: (firstReport.deposit_group_summaries && firstReport.deposit_group_summaries.month) || {},
  };

  try {
    const response = UrlFetchApp.fetch(`${backendUrl}/api/internal/reports-published`, {
      method: "post",
      contentType: "application/json",
      headers: { "X-Reports-Token": token },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });
    const status = response.getResponseCode();
    if (status < 200 || status >= 300) {
      console.warn(`VPDK reports webhook returned ${status}: ${response.getContentText()}`);
      return { success: false, status };
    }
    return { success: true, status };
  } catch (error) {
    console.warn(`VPDK reports webhook failed: ${error && error.message ? error.message : error}`);
    return { success: false, error: String(error) };
  }
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Звіти")
    .addItem("Оновити звіти", "refreshReports")
    .addToUi();
}

function refreshReports() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  try {
    spreadsheet.toast("Збираю новий знімок даних…", "VPDK · Оновлення звітів", -1);
    SpreadsheetApp.flush();
    const snapshot = buildReportSnapshots(spreadsheet);
    writeReportCache(spreadsheet, snapshot);
    const webhookResult = notifyBackendReportsPublished(snapshot);
    spreadsheet.toast(
      `Готово: ${snapshot.reports.length} профілів · PWA оновить локальний кеш у фоні без повторних екранів завантаження`,
      "VPDK · Звіти опубліковано",
      8
    );
    return {
      success: true,
      updated_profiles: snapshot.reports.length,
      snapshot_updated_at: snapshot.snapshotUpdatedAt,
      snapshot_version: snapshot.snapshotVersion,
      snapshot_day: snapshot.snapshotDay,
      webhook_notified: Boolean(webhookResult && webhookResult.success),
    };
  } catch (error) {
    spreadsheet.toast(
      error && error.message ? error.message : "Не вдалося оновити звіти",
      "VPDK · Помилка",
      10
    );
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  try {
    const parameters = (e && e.parameter) || {};
    const mode = normalizeKey(parameters.mode);
    if (mode === "manifest" || mode === "version") {
      return jsonResponse(getReportManifest());
    }

    const goalsLogin = normalizeKey(parameters.goals_login);
    if (!goalsLogin) return jsonResponse({ success: false, error: "goals_login is required" });

    const cached = readCachedReport(goalsLogin);
    return jsonResponse(cached || reportsNotRefreshedPayload(goalsLogin));
  } catch (error) {
    return jsonResponse({ success: false, error: error && error.message ? error.message : "Помилка читання кешу звітів" });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    const expectedToken = PropertiesService.getScriptProperties().getProperty("WRITE_TOKEN");
    if (!expectedToken || String(body.token || "") !== expectedToken) {
      return jsonResponse({ success: false, error: "Unauthorized write" });
    }

    const action = normalizeKey(body.action);
    if (action === "read_all_goals") {
      const all = readAllCachedGoals();
      return jsonResponse({
        success: true,
        api_version: REPORT_CACHE_API_VERSION,
        report_mode: "manual_snapshot",
        ...all,
      });
    }

    if (action === "read_cached_report") {
      const requestedLogin = normalizeKey(body.goals_login);
      const payload = requestedLogin ? readCachedReport(requestedLogin) : readFirstCachedReport();
      return jsonResponse(payload || reportsNotRefreshedPayload(requestedLogin));
    }

    if (action === "get_team_message") {
      return jsonResponse({ success: true, ...readTeamMessage(body.team_id) });
    }

    if (action === "set_team_message") {
      return jsonResponse({
        success: true,
        ...writeTeamMessage(body.team_id, body.message, body.updated_by, body.updated_by_name),
      });
    }

    if (action === "get_goals_settings") {
      return jsonResponse({ success: true, ...readGoalsSettings() });
    }

    if (action === "set_goals_settings") {
      return jsonResponse({
        success: true,
        ...writeGoalsSettings(Boolean(body.allow_cross_team_reports), body.updated_by_name),
      });
    }

    const goalsLogin = normalizeKey(body.goals_login);
    const goals = body.goals || {};
    if (!goalsLogin) return jsonResponse({ success: false, error: "goals_login is required" });

    const context = getSheetContext();
    const found = findGoalRow(context, goalsLogin);
    if (found.sheetRow === -1) {
      return jsonResponse({ success: false, error: `Рядок для ключа ${goalsLogin} не знайдено` });
    }

    const valuesByHeader = {
      credit_actual: numberValue(goals.credit && goals.credit.current),
      credit_current: numberValue(goals.credit && goals.credit.current),
      credit_target: numberValue(goals.credit && goals.credit.target),
      credit_mode: String((goals.credit && goals.credit.mode) || "reach"),
      debit_actual: numberValue(goals.debit && goals.debit.current),
      debit_current: numberValue(goals.debit && goals.debit.current),
      debit_target: numberValue(goals.debit && goals.debit.target),
      debit_mode: String((goals.debit && goals.debit.mode) || "reach"),
      deposit_actual: numberValue(goals.deposit && goals.deposit.current),
      deposit_current: numberValue(goals.deposit && goals.deposit.current),
      deposit_target: numberValue(goals.deposit && goals.deposit.target),
      deposit_mode: String((goals.deposit && goals.deposit.mode) || "reach"),
      monthly_bonus_actual: numberValue(goals.monthly_bonus_current),
      monthly_bonus_current: numberValue(goals.monthly_bonus_current),
      monthly_bonus_target: numberValue(goals.monthly_bonus_target),
      note: String(goals.note || ""),
    };

    context.normalizedHeaders.forEach((header, index) => {
      if (!(header in valuesByHeader)) return;
      const cell = context.sheet.getRange(found.sheetRow, index + 1);
      const value = valuesByHeader[header];
      if (["credit_actual", "credit_current", "credit_target", "debit_actual", "debit_current", "debit_target", "deposit_actual", "deposit_current", "deposit_target"].includes(header)) {
        cell.setValue(value / 100).setNumberFormat("0.00%");
      } else {
        cell.setValue(value);
      }
    });

    SpreadsheetApp.flush();
    const refreshed = context.sheet.getRange(found.sheetRow, 1, 1, context.headers.length).getDisplayValues()[0];
    return jsonResponse({
      success: true,
      found: true,
      goals_login: goalsLogin,
      goals: rowToObject(context.headers, refreshed),
      reports_refresh_required: true,
      message: 'Зміни записано в таблицю. Натисніть кнопку "Оновити звіти", щоб опублікувати їх на сайті.',
    });
  } catch (error) {
    return jsonResponse({ success: false, error: error && error.message ? error.message : "Помилка запису таблиці" });
  }
}

function numberValue(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
