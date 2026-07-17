const SPREADSHEET_ID = "ВСТАВТЕ_ID_ВАШОЇ_GOOGLE_ТАБЛИЦІ";
const SHEET_NAME = "Goals";

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase();
}

function doGet(e) {
  try {
    const goalsLogin = normalizeKey(e && e.parameter && e.parameter.goals_login);

    if (!goalsLogin) {
      return jsonResponse({
        success: false,
        error: "goals_login is required",
      });
    }

    if (!SPREADSHEET_ID || SPREADSHEET_ID.includes("ВСТАВТЕ_ID")) {
      return jsonResponse({
        success: false,
        error: "SPREADSHEET_ID is not configured",
      });
    }

    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = spreadsheet.getSheetByName(SHEET_NAME);

    if (!sheet) {
      return jsonResponse({
        success: false,
        error: `Аркуш "${SHEET_NAME}" не знайдено`,
      });
    }

    const values = sheet.getDataRange().getDisplayValues();

    if (values.length < 2) {
      return jsonResponse({
        success: true,
        found: false,
        reason: "sheet_is_empty",
        goals: null,
      });
    }

    const [headerRow, ...rows] = values;
    const headers = headerRow.map((header) => String(header).trim());
    const normalizedHeaders = headers.map(normalizeKey);
    const keyIndex = normalizedHeaders.indexOf("goals_login");

    if (keyIndex === -1) {
      return jsonResponse({
        success: false,
        error: 'Немає колонки "goals_login"',
      });
    }

    const row = rows.find(
      (item) => normalizeKey(item[keyIndex]) === goalsLogin
    );

    if (!row) {
      return jsonResponse({
        success: true,
        found: false,
        reason: "key_not_found",
        goals_login: goalsLogin,
        goals: null,
      });
    }

    const goals = Object.fromEntries(
      headers.map((header, index) => [header, row[index] ?? ""])
    );

    return jsonResponse({
      success: true,
      found: true,
      goals_login: goalsLogin,
      goals,
    });
  } catch (error) {
    return jsonResponse({
      success: false,
      error: error && error.message ? error.message : "Помилка читання таблиці",
    });
  }
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
