const SPREADSHEET_ID = "1TV7NHvEmLf6i19yPt7SENl2TOn1Y04ToW1CjSGhtrf0";
const SHEET_NAME = "Goals";
const CREDIT_METRICS_SHEET_NAME = "CreditMetrics";
const CREDIT_LEADERBOARD_SHEET_NAME = "Аркуш2";
const TRANSFORMATION_SHEET_NAME = "Transformation";
const DEBIT_LEADERBOARD_SHEET_NAME = "Аркуш2";
const DEBIT_ISSUANCES_SHEET_NAME = "Transformation Deb";
const SCHEDULE_SHEET_NAME = "Schedule";
const SCHEDULE_TIMEZONE = "Europe/Kyiv";
const REPORT_CACHE_SHEET_NAME = "_TM6_REPORT_CACHE";
const REPORT_CACHE_CHUNK_SIZE = 45000;
const REPORT_CACHE_API_VERSION = "v102-manual-refresh";

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

function getCreditLeaderboard(spreadsheet) {
  const sourceSpreadsheet = spreadsheet || SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = sourceSpreadsheet.getSheetByName(CREDIT_LEADERBOARD_SHEET_NAME);
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
    updated_at: Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "Europe/Kyiv", "dd.MM.yyyy HH:mm"),
  };
}


function getDebitLeaderboard(spreadsheet) {
  const sourceSpreadsheet = spreadsheet || SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = sourceSpreadsheet.getSheetByName(DEBIT_LEADERBOARD_SHEET_NAME);
  if (!sheet) return { rows: [], group_summary: null, updated_at: "" };

  const values = sheet.getDataRange().getDisplayValues();
  if (!values.length) return { rows: [], group_summary: null, updated_at: "" };

  const loginHeaders = ["debit", "debet", "дебет", "operator", "оператор", "login", "goals_login"];
  const inbDebitHeaders = ["inb_deb", "inb deb", "inb debit"];
  const vseCardHeaders = ["vse_card", "vse card", "все card"];
  const webFuibHeaders = ["web_fuib", "web fuib"];
  const webAppsHeaders = ["web_apps", "web apps", "webapps"];
  const xSellHeaders = ["x_sell", "x-sell", "xsell"];
  const overallHeaders = ["загальний deb", "загальний debit", "загальний", "overall", "total", "summary"];
  const groupAliases = ["tm6", "tm_6", "тм6", "група tm6", "group tm6"];

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

    if (groupAliases.some((alias) => normalizeKey(alias) === login)) groupSummary = entry;
    else rows.push(entry);
  }

  return {
    rows,
    group_summary: groupSummary,
    updated_at: Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "Europe/Kyiv", "dd.MM.yyyy HH:mm"),
  };
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

    const overallColumnIndex = findSummaryColumn(values, blockRowIndex, headerRowIndex);
    if (overallColumnIndex === -1) continue;

    const output = {
      goals_login: goalsLogin,
      channel: block.channel,
      period: block.period,
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
  const snapshotUpdatedAt = Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone() || SCHEDULE_TIMEZONE,
    "dd.MM.yyyy HH:mm"
  );
  const snapshotVersion = `${Date.now()}-${Utilities.getUuid()}`;

  const goalLogins = context.rows
    .map((row) => normalizeKey(row[goalsLoginIndex]))
    .filter(Boolean);
  const scheduleLogins = getScheduleLogins(sources.schedule);
  const logins = Array.from(new Set(goalLogins.concat(scheduleLogins))).sort();

  const reports = logins.map((goalsLogin) => {
    const found = findGoalRow(context, goalsLogin);
    const hasGoalRow = found.rowOffset !== -1;
    const schedule = sources.schedule
      ? getScheduleForLogin(goalsLogin, sources.schedule)
      : emptyScheduleSnapshot("schedule_sheet_missing", goalsLogin);

    return {
      goals_login: goalsLogin,
      payload: {
        success: true,
        api_version: REPORT_CACHE_API_VERSION,
        report_mode: "manual_snapshot",
        snapshot_version: snapshotVersion,
        snapshot_updated_at: snapshotUpdatedAt,
        goals_login: goalsLogin,
        found: hasGoalRow,
        reason: hasGoalRow ? null : "key_not_found",
        goals: hasGoalRow ? rowToObject(context.headers, context.rows[found.rowOffset]) : null,
        credit_metrics: hasGoalRow ? getCreditMetricRows(goalsLogin, sources) : [],
        credit_leaderboard: leaderboard.rows,
        credit_group_summary: leaderboard.group_summary,
        credit_leaderboard_updated_at: snapshotUpdatedAt,
        debit_leaderboard: debitLeaderboard.rows,
        debit_group_summary: debitLeaderboard.group_summary,
        debit_leaderboard_updated_at: snapshotUpdatedAt,
        debit_issuances: getDebitIssuanceRows(goalsLogin, sources.debitIssuanceValues),
        schedule,
      },
    };
  });

  return {
    reports,
    snapshotVersion,
    snapshotUpdatedAt,
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

function reportsNotRefreshedPayload(goalsLogin) {
  const updatedAt = PropertiesService.getScriptProperties().getProperty("REPORT_CACHE_UPDATED_AT") || "";
  return {
    success: true,
    api_version: REPORT_CACHE_API_VERSION,
    report_mode: "manual_snapshot",
    snapshot_updated_at: updatedAt,
    goals_login: goalsLogin,
    found: false,
    reason: "reports_not_refreshed",
    goals: null,
    credit_metrics: [],
    credit_leaderboard: [],
    credit_group_summary: null,
    credit_leaderboard_updated_at: updatedAt,
    debit_leaderboard: [],
    debit_group_summary: null,
    debit_leaderboard_updated_at: updatedAt,
    debit_issuances: [],
    schedule: emptyScheduleSnapshot("reports_not_refreshed", goalsLogin),
  };
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("TM6")
    .addItem("Оновити звіти", "refreshReports")
    .addToUi();
}

function refreshReports() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  try {
    spreadsheet.toast("Збираю новий знімок даних…", "TM6 · Оновлення звітів", -1);
    SpreadsheetApp.flush();
    const snapshot = buildReportSnapshots(spreadsheet);
    writeReportCache(spreadsheet, snapshot);
    spreadsheet.toast(
      `Готово: оновлено ${snapshot.reports.length} профілів · ${snapshot.snapshotUpdatedAt}`,
      "TM6 · Звіти оновлено",
      8
    );
    return {
      success: true,
      updated_profiles: snapshot.reports.length,
      snapshot_updated_at: snapshot.snapshotUpdatedAt,
      snapshot_version: snapshot.snapshotVersion,
    };
  } catch (error) {
    spreadsheet.toast(
      error && error.message ? error.message : "Не вдалося оновити звіти",
      "TM6 · Помилка",
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

    if (normalizeKey(body.action) === "read_all_goals") {
      const all = readAllCachedGoals();
      return jsonResponse({
        success: true,
        api_version: REPORT_CACHE_API_VERSION,
        report_mode: "manual_snapshot",
        ...all,
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
