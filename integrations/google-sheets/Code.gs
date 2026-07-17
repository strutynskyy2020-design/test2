const SPREADSHEET_ID = "ВСТАВТЕ_ID_ВАШОЇ_GOOGLE_ТАБЛИЦІ";
const SHEET_NAME = "Goals";

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase();
}

function openGoalsSheet() {
  if (!SPREADSHEET_ID || SPREADSHEET_ID.includes("ВСТАВТЕ_ID")) {
    throw new Error("SPREADSHEET_ID is not configured");
  }
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error(`Аркуш "${SHEET_NAME}" не знайдено`);
  return sheet;
}

function getSheetContext() {
  const sheet = openGoalsSheet();
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

function doGet(e) {
  try {
    const goalsLogin = normalizeKey(e && e.parameter && e.parameter.goals_login);
    if (!goalsLogin) return jsonResponse({ success: false, error: "goals_login is required" });

    const context = getSheetContext();
    if (context.rows.length === 0) {
      return jsonResponse({ success: true, found: false, reason: "sheet_is_empty", goals: null });
    }

    const found = findGoalRow(context, goalsLogin);
    if (found.rowOffset === -1) {
      return jsonResponse({ success: true, found: false, reason: "key_not_found", goals_login: goalsLogin, goals: null });
    }

    return jsonResponse({
      success: true,
      found: true,
      goals_login: goalsLogin,
      goals: rowToObject(context.headers, context.rows[found.rowOffset]),
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
