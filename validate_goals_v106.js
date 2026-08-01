const fs = require("fs");
const vm = require("vm");
const assert = require("assert");

class FakeRange {
  constructor(sheet, row = 1, col = 1, numRows = 1, numCols = 1) {
    this.sheet = sheet; this.row = row; this.col = col; this.numRows = numRows; this.numCols = numCols;
  }
  getDisplayValues() {
    return Array.from({ length: this.numRows }, (_, r) => Array.from({ length: this.numCols }, (_, c) => {
      const value = this.sheet.values[this.row - 1 + r]?.[this.col - 1 + c];
      return value == null ? "" : String(value);
    }));
  }
  getValues() { return this.getDisplayValues(); }
  setValues(values) {
    values.forEach((source, r) => {
      const targetRow = this.row - 1 + r;
      while (this.sheet.values.length <= targetRow) this.sheet.values.push([]);
      source.forEach((value, c) => { this.sheet.values[targetRow][this.col - 1 + c] = value; });
    });
    return this;
  }
  setValue(value) { return this.setValues([[value]]); }
  setNumberFormat() { return this; }
  createTextFinder(search) {
    const range = this;
    return {
      matchEntireCell() { return this; },
      matchCase() { return this; },
      findNext() {
        const needle = String(search).toLowerCase();
        const rows = range.getDisplayValues();
        for (let r = 0; r < rows.length; r += 1) {
          for (let c = 0; c < rows[r].length; c += 1) {
            if (String(rows[r][c]).toLowerCase() === needle) {
              return { getRow: () => range.row + r, getColumn: () => range.col + c };
            }
          }
        }
        return null;
      },
    };
  }
}

class FakeSheet {
  constructor(name, values = []) { this.name = name; this.values = values.map((row) => [...row]); this.hidden = false; }
  maxColumns() { return this.values.reduce((max, row) => Math.max(max, row.length), 0); }
  getDataRange() { return new FakeRange(this, 1, 1, this.values.length, this.maxColumns()); }
  getRange(row, col, numRows = 1, numCols = 1) { return new FakeRange(this, row, col, numRows, numCols); }
  getLastRow() { return this.values.length; }
  getLastColumn() { return this.maxColumns(); }
  clearContents() { this.values = []; return this; }
  setFrozenRows() { return this; }
  hideSheet() { this.hidden = true; return this; }
}

class FakeSpreadsheet {
  constructor(sheets) { this.sheets = new Map(sheets.map((sheet) => [sheet.name, sheet])); }
  getSheetByName(name) { return this.sheets.get(name) || null; }
  insertSheet(name) { const sheet = new FakeSheet(name); this.sheets.set(name, sheet); return sheet; }
  toast() {}
}

const goals = new FakeSheet("Goals", [
  ["goals_login", "employee_name", "credit_actual", "credit_target"],
  ["alice", "Alice", "25%", "100%"],
]);
const transformation = new FakeSheet("Transformation", [
  ["X-Sell month", "", "", ""],
  ["Показник", "alice", "Підсумок TM6", "Підсумок TM7"],
  ["Проекційний результат", "91%", "84%", "78%"],
]);
const spreadsheet = new FakeSpreadsheet([goals, transformation]);
const properties = new Map([["WRITE_TOKEN", "secret"]]);
const sandbox = {
  console, Date, JSON, Math, Set, Map, Array, Object, String, Number, Boolean, Error, isFinite, isNaN,
  SpreadsheetApp: {
    openById: () => spreadsheet,
    flush: () => {},
    getUi: () => ({ createMenu: () => ({ addItem() { return this; }, addToUi() { return this; } }) }),
  },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: (key) => properties.get(key) || null,
      setProperties: (values) => Object.entries(values).forEach(([key, value]) => properties.set(key, String(value))),
    }),
  },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  Utilities: { formatDate: () => "01.08.2026 20:00", getUuid: () => "v106-test" },
  Session: { getScriptTimeZone: () => "Europe/Kyiv" },
  ContentService: {
    MimeType: { JSON: "application/json" },
    createTextOutput: (value) => ({ value, setMimeType() { return this; } }),
  },
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync("integrations/google-sheets/Code.gs", "utf8"), sandbox);

const projectionRows = sandbox.getTransformationMetricRows("alice", transformation.values);
assert.equal(projectionRows.length, 1);
assert.equal(projectionRows[0].projective_rate, "91%");
assert.equal(projectionRows[0].projective_rate_overall, undefined, "must not silently use TM6 as a general projection");
assert.equal(projectionRows[0].team_overall.tm6.projective_rate_overall, "84%");
assert.equal(projectionRows[0].projective_source.row_label, "Проекційний результат");

const refreshed = sandbox.refreshReports();
assert.equal(refreshed.success, true);
const firstReport = JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify({
  token: "secret", action: "read_cached_report", goals_login: "",
}) } }).value);
assert.equal(firstReport.goals_login, "alice", "admin must receive the first published report without having a Google row");

const savedMessage = JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify({
  token: "secret", action: "set_team_message", team_id: "team-6", message: "Фокус на X-Sell", updated_by: "u1", updated_by_name: "Leader",
}) } }).value);
assert.equal(savedMessage.message, "Фокус на X-Sell");
const readMessage = JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify({
  token: "secret", action: "get_team_message", team_id: "team-6",
}) } }).value);
assert.equal(readMessage.message, "Фокус на X-Sell");

const settings = JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify({
  token: "secret", action: "set_goals_settings", allow_cross_team_reports: true, updated_by_name: "Admin",
}) } }).value);
assert.equal(settings.allow_cross_team_reports, true);
const readSettings = JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify({
  token: "secret", action: "get_goals_settings",
}) } }).value);
assert.equal(readSettings.allow_cross_team_reports, true);

const adminGateway = fs.readFileSync("netlify/functions/google-goals-admin.js", "utf8");
assert(adminGateway.includes('/auth/me'), "admin gateway must authenticate through the stable auth route");
assert(!adminGateway.includes('backendApiUrl("/admin/goals-dashboard")'), "admin gateway must not depend on the newer dashboard route");
const goalsPage = fs.readFileSync("frontend/src/pages/Goals.jsx", "utf8");
assert(goalsPage.includes("/.netlify/functions/goals-team-message"), "team messages must use the compatible Netlify gateway");
assert(goalsPage.includes("privileged_overview"), "admin goals overview is missing");
const adminPage = fs.readFileSync("frontend/src/pages/Admin.jsx", "utf8");
assert(adminPage.includes("Promise.allSettled"), "admin goals loading must tolerate optional missing endpoints");

console.log("Validated v106: admin access, team messages, resilient admin goals, and explicit projection mapping");
