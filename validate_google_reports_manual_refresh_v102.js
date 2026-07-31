const fs = require("fs");
const vm = require("vm");
const assert = require("assert");

class FakeRange {
  constructor(sheet, row = 1, col = 1, numRows = null, numCols = null) {
    this.sheet = sheet;
    this.row = row;
    this.col = col;
    this.numRows = numRows ?? Math.max(0, sheet.values.length - row + 1);
    this.numCols = numCols ?? Math.max(0, sheet.maxColumns() - col + 1);
  }
  getDisplayValues() {
    const out = [];
    for (let r = 0; r < this.numRows; r += 1) {
      const source = this.sheet.values[this.row - 1 + r] || [];
      const row = [];
      for (let c = 0; c < this.numCols; c += 1) {
        const value = source[this.col - 1 + c];
        row.push(value == null ? "" : String(value));
      }
      out.push(row);
    }
    return out;
  }
  getValues() {
    const out = [];
    for (let r = 0; r < this.numRows; r += 1) {
      const source = this.sheet.values[this.row - 1 + r] || [];
      const row = [];
      for (let c = 0; c < this.numCols; c += 1) row.push(source[this.col - 1 + c] ?? "");
      out.push(row);
    }
    return out;
  }
  setValues(values) {
    values.forEach((sourceRow, r) => {
      const targetRowIndex = this.row - 1 + r;
      while (this.sheet.values.length <= targetRowIndex) this.sheet.values.push([]);
      sourceRow.forEach((value, c) => {
        this.sheet.values[targetRowIndex][this.col - 1 + c] = value;
      });
    });
    return this;
  }
  setValue(value) {
    return this.setValues([[value]]);
  }
  setNumberFormat() { return this; }
  createTextFinder(search) {
    const range = this;
    return {
      matchEntireCell() { return this; },
      matchCase() { return this; },
      findNext() {
        const needle = String(search).toLowerCase();
        const values = range.getDisplayValues();
        for (let r = 0; r < values.length; r += 1) {
          for (let c = 0; c < values[r].length; c += 1) {
            if (String(values[r][c]).toLowerCase() === needle) {
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
  constructor(name, values = []) {
    this.name = name;
    this.values = values.map((row) => [...row]);
    this.hidden = false;
  }
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
  constructor(sheets) {
    this.sheets = new Map(sheets.map((sheet) => [sheet.name, sheet]));
    this.toasts = [];
  }
  getSheetByName(name) { return this.sheets.get(name) || null; }
  insertSheet(name) {
    const sheet = new FakeSheet(name, []);
    this.sheets.set(name, sheet);
    return sheet;
  }
  toast(message, title) { this.toasts.push({ message, title }); }
}

const goalsSheet = new FakeSheet("Goals", [
  ["goals_login", "employee_name", "credit_actual", "credit_target"],
  ["alice", "Alice", "25%", "100%"],
]);
const spreadsheet = new FakeSpreadsheet([goalsSheet]);
const properties = new Map([["WRITE_TOKEN", "secret"]]);

const sandbox = {
  console,
  Date,
  JSON,
  Math,
  Set,
  Map,
  Array,
  Object,
  String,
  Number,
  Boolean,
  Error,
  isFinite,
  isNaN,
  SpreadsheetApp: {
    openById: () => spreadsheet,
    flush: () => {},
    getUi: () => ({ createMenu: () => ({ addItem() { return this; }, addToUi() { return this; } }) }),
  },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: (key) => properties.get(key) || null,
      setProperties: (values) => Object.entries(values).forEach(([key, value]) => properties.set(key, value)),
    }),
  },
  LockService: {
    getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }),
  },
  Utilities: {
    formatDate: () => "31.07.2026 16:35",
    getUuid: () => "snapshot-uuid",
  },
  Session: { getScriptTimeZone: () => "Europe/Kyiv" },
  ContentService: {
    MimeType: { JSON: "application/json" },
    createTextOutput: (value) => ({
      value,
      setMimeType() { return this; },
    }),
  },
};

vm.createContext(sandbox);
vm.runInContext(fs.readFileSync("integrations/google-sheets/Code.gs", "utf8"), sandbox);

const firstRefresh = sandbox.refreshReports();
assert.equal(firstRefresh.success, true);
assert.equal(firstRefresh.updated_profiles, 1);
assert(spreadsheet.getSheetByName("_TM6_REPORT_CACHE")?.hidden, "cache sheet must be hidden");

const read = () => JSON.parse(sandbox.doGet({ parameter: { goals_login: "alice" } }).value);
assert.equal(read().goals.credit_actual, "25%");

// Editing source data alone must not change the published report.
goalsSheet.values[1][2] = "80%";
assert.equal(read().goals.credit_actual, "25%", "published snapshot changed without refreshReports()");

sandbox.refreshReports();
assert.equal(read().goals.credit_actual, "80%", "new snapshot was not published after refreshReports()");

const all = JSON.parse(sandbox.doPost({
  postData: { contents: JSON.stringify({ token: "secret", action: "read_all_goals" }) },
}).value);
assert.equal(all.success, true);
assert.equal(all.goals_by_login.alice.credit_actual, "80%");


const noPollingPages = [
  "Home.jsx",
  "Goals.jsx",
  "CreditGoals.jsx",
  "DebitIssuances.jsx",
  "CreditLeaderboard.jsx",
  "DebitLeaderboard.jsx",
  "Schedule.jsx",
];
for (const page of noPollingPages) {
  const source = fs.readFileSync(`frontend/src/pages/${page}`, "utf8");
  assert(!source.includes("google-goals?_ts"), `${page} still cache-busts google-goals`);
  assert(!source.includes("setInterval"), `${page} still polls on an interval`);
  assert(!source.includes('addEventListener("visibilitychange"'), `${page} still refreshes on visibility`);
  assert(!source.includes('addEventListener("focus"'), `${page} still refreshes on focus`);
}
const gatewaySource = fs.readFileSync("netlify/functions/google-goals.js", "utf8");
assert(!gatewaySource.includes('url.searchParams.set("_ts"'), "google-goals gateway still cache-busts Apps Script");
const adminGatewaySource = fs.readFileSync("netlify/functions/google-goals-admin.js", "utf8");
assert(adminGatewaySource.includes('action: "read_all_goals"'), "admin gateway does not use bulk cached goals");

console.log("Validated v102: Google reports change only after refreshReports() publishes a new snapshot");
