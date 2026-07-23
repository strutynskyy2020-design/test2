const SPREADSHEET_ID = "1TV7NHvEmLf6i19yPt7SENl2TOn1Y04ToW1CjSGhtrf0";
const SHEET_NAME = "Goals";
const CREDIT_METRICS_SHEET_NAME = "CreditMetrics";
const CREDIT_LEADERBOARD_SHEET_NAME = "Аркуш2";
const TRANSFORMATION_SHEET_NAME = "Transformation";

// The app reads only these published snapshots. Source sheets may continue to
// recalculate, but users will not see new values until updateResultsSnapshot()
// is run from Google Sheets.
const SNAPSHOT_PREFIX = "_TM6_PUBLISHED_";
const RESULTS_PUBLISHED_AT_PROPERTY = "TM6_RESULTS_PUBLISHED_AT";
const RESULTS_PUBLISHED_VERSION_PROPERTY = "TM6_RESULTS_PUBLISHED_VERSION";

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase();
}

function getSpreadsheet() {
  if (!SPREADSHEET_ID || SPREADSHEET_ID.includes("ВСТАВТЕ_ID")) {
    throw new Error("SPREADSHEET_ID is not configured");
  }
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function snapshotSheetName(sourceSheetName) {
  return `${SNAPSHOT_PREFIX}${sourceSheetName}`.slice(0, 100);
}

function getSourceSheet(sourceSheetName, required) {
  const sheet = getSpreadsheet().getSheetByName(sourceSheetName);
  if (!sheet && required !== false) throw new Error(`Аркуш "${sourceSheetName}" не знайдено`);
  return sheet;
}

function getPublishedSheet(sourceSheetName, required) {
  const sheet = getSpreadsheet().getSheetByName(snapshotSheetName(sourceSheetName));
  if (!sheet && required !== false) {
    throw new Error('Результати ще не опубліковано. Натисніть "Оновити результати" в Google Таблиці.');
  }
  return sheet;
}

function openGoalsSheet(usePublished) {
  return usePublished === false
    ? getSourceSheet(SHEET_NAME, true)
    : getPublishedSheet(SHEET_NAME, true);
}

function getSheetContext(usePublished) {
  const sheet = openGoalsSheet(usePublished);
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

function getPublishedResultsAt() {
  return PropertiesService.getScriptProperties().getProperty(RESULTS_PUBLISHED_AT_PROPERTY) || "";
}

function getPublishedResultsVersion() {
  return PropertiesService.getScriptProperties().getProperty(RESULTS_PUBLISHED_VERSION_PROPERTY) || "";
}

function ensureSheetSize(sheet, rows, columns) {
  const requiredRows = Math.max(1, rows);
  const requiredColumns = Math.max(1, columns);
  if (sheet.getMaxRows() < requiredRows) {
    sheet.insertRowsAfter(sheet.getMaxRows(), requiredRows - sheet.getMaxRows());
  }
  if (sheet.getMaxColumns() < requiredColumns) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), requiredColumns - sheet.getMaxColumns());
  }
}

function publishSheetSnapshot(sourceSheetName, required) {
  const spreadsheet = getSpreadsheet();
  const source = spreadsheet.getSheetByName(sourceSheetName);
  if (!source) {
    if (required !== false) throw new Error(`Аркуш "${sourceSheetName}" не знайдено`);
    return false;
  }

  const values = source.getDataRange().getDisplayValues();
  const rowCount = Math.max(1, values.length);
  const columnCount = Math.max(1, values.reduce((max, row) => Math.max(max, row.length), 0));
  const targetName = snapshotSheetName(sourceSheetName);
  let target = spreadsheet.getSheetByName(targetName);
  if (!target) target = spreadsheet.insertSheet(targetName);

  ensureSheetSize(target, rowCount, columnCount);
  target.clear();
  if (values.length && columnCount) {
    const normalizedValues = values.map((row) => {
      const output = row.slice(0, columnCount);
      while (output.length < columnCount) output.push("");
      return output;
    });
    target.getRange(1, 1, normalizedValues.length, columnCount).setValues(normalizedValues);
  }
  target.hideSheet();
  return true;
}

/**
 * Run this from the TM6 Bonus menu or assign this function to a drawing/button
 * named "Оновити результати" in Google Sheets.
 */
function updateResultsSnapshot() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30_000);
  try {
    publishSheetSnapshot(SHEET_NAME, true);
    publishSheetSnapshot(CREDIT_LEADERBOARD_SHEET_NAME, true);
    publishSheetSnapshot(TRANSFORMATION_SHEET_NAME, false);
    publishSheetSnapshot(CREDIT_METRICS_SHEET_NAME, false);

    const timezone = Session.getScriptTimeZone() || "Europe/Kyiv";
    const publishedAt = Utilities.formatDate(new Date(), timezone, "dd.MM.yyyy HH:mm");
    const properties = PropertiesService.getScriptProperties();
    properties.setProperty(RESULTS_PUBLISHED_AT_PROPERTY, publishedAt);
    properties.setProperty(RESULTS_PUBLISHED_VERSION_PROPERTY, String(Date.now()));

    SpreadsheetApp.flush();
    try {
      SpreadsheetApp.getActive().toast(
        `Опубліковано: ${publishedAt}`,
        "TM6 Bonus · результати оновлено",
        6
      );
    } catch (toastError) {
      // The function can also run outside an active spreadsheet UI.
    }
    return publishedAt;
  } finally {
    lock.releaseLock();
  }
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("TM6 Bonus")
    .addItem("Оновити результати", "updateResultsSnapshot")
    .addToUi();
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

function getCreditLeaderboard() {
  const sheet = getPublishedSheet(CREDIT_LEADERBOARD_SHEET_NAME, false);
  if (!sheet) return { rows: [], group_summary: null, updated_at: "" };

  const values = sheet.getDataRange().getDisplayValues();
  if (!values.length) return { rows: [], group_summary: null, updated_at: "" };

  const loginHeaders = ["credit", "кредит", "operator", "оператор", "login", "goals_login"];
  const xsellHeaders = ["x-sell", "xsell", "x_sell"];
  const webHeaders = ["web apps", "web_apps", "webapps", "web app"];
  const inbHeaders = ["inb"];
  const overallHeaders = ["загальний", "загальний підсумок", "overall", "total", "summary"];
  const groupAliases = ["tm6", "tm_6", "тм6", "група tm6", "group tm6"];

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
    return { rows: [], group_summary: null, updated_at: "" };
  }

  const rows = [];
  let groupSummary = null;
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

    if (groupAliases.some((alias) => normalizeKey(alias) === login)) {
      groupSummary = entry;
    } else {
      rows.push(entry);
    }
  }

  return {
    rows,
    group_summary: groupSummary,
    updated_at: getPublishedResultsAt(),
  };
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

function findSummaryColumn(values, blockRowIndex, headerRowIndex) {
  let fallback = -1;
  const endRow = Math.min(values.length - 1, headerRowIndex + 2);
  for (let rowIndex = blockRowIndex; rowIndex <= endRow; rowIndex += 1) {
    const row = values[rowIndex];
    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      const key = normalizeHeaderKey(row[columnIndex]);
      const isSummary = key.includes("підсумок") || key.includes("итог") || key.includes("summary") || key.includes("total");
      if (!isSummary) continue;
      if (key.includes("tm_6") || key.includes("tm6")) return columnIndex;
      if (fallback === -1 && (key.includes("загальний") || key.includes("general") || key.includes("overall"))) fallback = columnIndex;
    }
  }
  return fallback;
}

function getTransformationMetricRows(goalsLogin) {
  const sheet = getPublishedSheet(TRANSFORMATION_SHEET_NAME, false);
  if (!sheet) return [];

  const values = sheet.getDataRange().getDisplayValues();
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

    const overallColumnIndex = findSummaryColumn(values, blockRowIndex, headerRowIndex);
    if (overallColumnIndex === -1) continue;

    const output = {
      goals_login: goalsLogin,
      channel: block.channel,
      period: block.period,
      updated_at: getPublishedResultsAt(),
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
      const overall = String(row[overallColumnIndex] || "").trim();
      if (metricKey === "processed_tasks") {
        output.processed_tasks = mine;
        output.processed_tasks_overall = overall;
      } else {
        output[metricKey] = mine;
        output[`${metricKey}_overall`] = overall;
      }
      foundMetric = true;
    }

    if (foundMetric) {
      rows.push(output);
      seen[blockKey] = true;
    }
  }

  return rows;
}

function getCreditMetricRows(goalsLogin) {
  const transformationRows = getTransformationMetricRows(goalsLogin);
  if (transformationRows.length) return transformationRows;

  const sheet = getPublishedSheet(CREDIT_METRICS_SHEET_NAME, false);
  if (!sheet) return [];

  const values = sheet.getDataRange().getDisplayValues();
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

function doGet(e) {
  try {
    const goalsLogin = normalizeKey(e && e.parameter && e.parameter.goals_login);
    if (!goalsLogin) return jsonResponse({ success: false, error: "goals_login is required" });

    const publishedAt = getPublishedResultsAt();
    const publishedVersion = getPublishedResultsVersion();
    if (!publishedAt) {
      return jsonResponse({
        success: true,
        found: false,
        reason: "results_not_published",
        goals_login: goalsLogin,
        goals: null,
        credit_metrics: [],
        credit_leaderboard: [],
        credit_group_summary: null,
        credit_leaderboard_updated_at: "",
        results_published_at: "",
        results_version: "",
      });
    }

    const leaderboard = getCreditLeaderboard();
    const context = getSheetContext(true);
    if (context.rows.length === 0) {
      return jsonResponse({
        success: true,
        found: false,
        reason: "sheet_is_empty",
        goals_login: goalsLogin,
        goals: null,
        credit_metrics: [],
        credit_leaderboard: leaderboard.rows,
        credit_group_summary: leaderboard.group_summary,
        credit_leaderboard_updated_at: leaderboard.updated_at,
        results_published_at: publishedAt,
        results_version: publishedVersion,
      });
    }

    const found = findGoalRow(context, goalsLogin);
    if (found.rowOffset === -1) {
      return jsonResponse({
        success: true,
        found: false,
        reason: "key_not_found",
        goals_login: goalsLogin,
        goals: null,
        credit_metrics: [],
        credit_leaderboard: leaderboard.rows,
        credit_group_summary: leaderboard.group_summary,
        credit_leaderboard_updated_at: leaderboard.updated_at,
        results_published_at: publishedAt,
        results_version: publishedVersion,
      });
    }

    return jsonResponse({
      success: true,
      found: true,
      goals_login: goalsLogin,
      goals: rowToObject(context.headers, context.rows[found.rowOffset]),
      credit_metrics: getCreditMetricRows(goalsLogin),
      credit_leaderboard: leaderboard.rows,
      credit_group_summary: leaderboard.group_summary,
      credit_leaderboard_updated_at: leaderboard.updated_at,
      results_published_at: publishedAt,
      results_version: publishedVersion,
    });
  } catch (error) {
    return jsonResponse({ success: false, error: error && error.message ? error.message : "Помилка читання таблиці" });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    const expectedToken = PropertiesService.getScriptProperties().getProperty("WRITE_TOKEN");
    if (!expectedToken || String(body.token || "") !== expectedToken) {
      return jsonResponse({ success: false, error: "Unauthorized write" });
    }

    const goalsLogin = normalizeKey(body.goals_login);
    const goals = body.goals || {};
    if (!goalsLogin) return jsonResponse({ success: false, error: "goals_login is required" });

    const context = getSheetContext(false);
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
