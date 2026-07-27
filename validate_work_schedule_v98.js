const fs = require("fs");
const vm = require("vm");

const code = fs.readFileSync("integrations/google-sheets/Code.gs", "utf8");
const display = [
  ["", "", "", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
  ["ПІБ", "Логін", "ставка", "сб", "нд", "пн", "вт", "ср", "чт", "пт", "сб", "нд", "пн"],
  ["Муковоз Віра", "mukovoz", "1", "", "В", "9-18", "9-16", "9-14", "11-20", "10-19", "Відпустка", "", "9-18"],
];
const raw = display.map((row) => row.slice());
const range = { getDisplayValues: () => display, getValues: () => raw };
const sheet = { getDataRange: () => range };
const spreadsheet = { getSheetByName: (name) => (name === "Schedule" ? sheet : null) };
const context = {
  console,
  SpreadsheetApp: { openById: () => spreadsheet },
  Utilities: {
    formatDate: (date, _timeZone, format) => {
      if (format === "yyyy-MM-dd") return date.toISOString().slice(0, 10);
      if (format === "EEE") return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getDay()];
      return "27.07.2026 12:00";
    },
  },
  Session: { getScriptTimeZone: () => "Europe/Kyiv" },
};
vm.createContext(context);
vm.runInContext(code, context);
const result = context.getScheduleForLogin("mukovoz");

const types = result.days.map((day) => day.type);
const expected = [
  "day_off",
  "day_off",
  "work",
  "work",
  "work",
  "late_shift",
  "weekend_shift",
  "vacation",
  "day_off",
  "work",
];

if (!result.found) throw new Error("Schedule row was not found");
if (JSON.stringify(types) !== JSON.stringify(expected)) {
  throw new Error(`Unexpected schedule types: ${JSON.stringify(types)}`);
}
if (result.range_start !== "2026-08-01" || result.range_end !== "2026-08-10") {
  throw new Error(`Unexpected inferred date range: ${result.range_start}..${result.range_end}`);
}
console.log("Validated Google Sheets Schedule parser and empty-cell day-off rule");
