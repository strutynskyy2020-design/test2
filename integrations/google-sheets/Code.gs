const SHEET_NAME = "Goals";

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase();
}

function doGet(e) {
  try {
    const goalsLogin = normalizeKey(e && e.parameter && e.parameter.goals_login);
    if (!goalsLogin) {
      return jsonResponse({ success: false, error: "goals_login is required" });
    }

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    if (!sheet) {
      return jsonResponse({ success: false, error: `Аркуш "${SHEET_NAME}" не знайдено` });
    }

    const values = sheet.getDataRange().getDisplayValues();
    if (values.length < 2) {
      return jsonResponse({ success: true, found: false, goals: null });
    }

    const [headerRow, ...rows] = values;
    const headers = headerRow.map((header) => String(header).trim());
    const keyIndex = headers.indexOf("goals_login");
    if (keyIndex === -1) {
      return jsonResponse({ success: false, error: 'Немає колонки "goals_login"' });
    }

    const row = rows.find((item) => normalizeKey(item[keyIndex]) === goalsLogin);
    if (!row) {
      return jsonResponse({ success: true, found: false, goals: null });
    }

    const goals = Object.fromEntries(
      headers.map((header, index) => [header, row[index] == null ? "" : row[index]])
    );
    return jsonResponse({ success: true, found: true, goals });
  } catch (error) {
    return jsonResponse({ success: false, error: error.message || "Помилка читання таблиці" });
  }
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
