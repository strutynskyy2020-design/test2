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
      for (let c = 0; c < this.numCols; c += 1) row.push(String(source[this.col - 1 + c] ?? ""));
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
      sourceRow.forEach((value, c) => { this.sheet.values[targetRowIndex][this.col - 1 + c] = value; });
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
  constructor(sheets) { this.sheets = new Map(sheets.map((sheet) => [sheet.name, sheet])); this.toasts = []; }
  getSheetByName(name) { return this.sheets.get(name) || null; }
  insertSheet(name) { const sheet = new FakeSheet(name, []); this.sheets.set(name, sheet); return sheet; }
  toast(message, title) { this.toasts.push({ message, title }); }
}

const goalsSheet = new FakeSheet("Goals", [
  ["goals_login", "employee_name", "credit_actual", "credit_target"],
  ["alice", "Alice", "25%", "100%"],
]);
const spreadsheet = new FakeSpreadsheet([goalsSheet]);
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
      setProperties: (values) => Object.entries(values).forEach(([key, value]) => properties.set(key, value)),
    }),
  },
  LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
  Utilities: {
    formatDate: (_date, _timezone, format) => format === "yyyy-MM-dd" ? "2026-07-31" : "31.07.2026 18:30",
    getUuid: () => "snapshot-uuid",
  },
  Session: { getScriptTimeZone: () => "Europe/Kyiv" },
  ContentService: {
    MimeType: { JSON: "application/json" },
    createTextOutput: (value) => ({ value, setMimeType() { return this; } }),
  },
};

vm.createContext(sandbox);
vm.runInContext(fs.readFileSync("integrations/google-sheets/Code.gs", "utf8"), sandbox);

const firstRefresh = sandbox.refreshReports();
assert.equal(firstRefresh.success, true);
assert.equal(firstRefresh.updated_profiles, 1);
assert(spreadsheet.getSheetByName("_TM6_REPORT_CACHE")?.hidden, "cache sheet must be hidden");

const read = () => JSON.parse(sandbox.doGet({ parameter: { goals_login: "alice" } }).value);
const manifest = () => JSON.parse(sandbox.doGet({ parameter: { mode: "manifest" } }).value);
assert.equal(read().goals.credit_actual, "25%");
assert.equal(manifest().api_version, "v104-global-indexeddb");

goalsSheet.values[1][2] = "80%";
assert.equal(read().goals.credit_actual, "25%", "published snapshot changed without refreshReports()");
sandbox.refreshReports();
assert.equal(read().goals.credit_actual, "80%", "new snapshot was not published after refreshReports()");

const app = fs.readFileSync("frontend/src/App.js", "utf8");
assert(app.includes("GoogleReportsProvider"), "global reports provider is not mounted");
const appContext = fs.readFileSync("frontend/src/context/AppContext.jsx", "utf8");
assert(!appContext.includes("preloadGoogleReports"), "AppContext still starts a second report preload");
const provider = fs.readFileSync("frontend/src/context/GoogleReportsContext.jsx", "utf8");
assert(provider.includes("initializedRef"), "provider does not deduplicate page mounts");
assert(provider.includes("checkPublishedUpdate"), "provider does not silently check snapshot versions");
assert(provider.includes("current.data ? null : error"), "background refresh can replace cached content with an error");
const hook = fs.readFileSync("frontend/src/hooks/useGoogleReports.js", "utf8");
assert(!hook.includes("fetch("), "page hook still performs direct network requests");
assert(!hook.includes("loadGoogleReports"), "page hook still performs a report load on each mount");
const cache = fs.readFileSync("frontend/src/lib/googleReportsCache.js", "utf8");
assert(cache.includes("indexedDB"), "reports are not persisted in IndexedDB");
assert(cache.includes("LEGACY_CACHE_PREFIX"), "v103 browser cache is not migrated");
const layout = fs.readFileSync("frontend/src/components/AppLayout.jsx", "utf8");
assert(!layout.includes("<main key={loc.pathname}"), "route changes still forcibly remount the main container");
const sw = fs.readFileSync("frontend/public/service-worker.js", "utf8");
assert(sw.includes('const VERSION = "tm6-v104"'), "service worker version was not bumped");
const pwa = fs.readFileSync("frontend/src/lib/pwa.js", "utf8");
assert(pwa.includes('service-worker.js?v=104'), "PWA registration still points to the old service worker");

const reportPages = ["Home.jsx", "Goals.jsx", "CreditGoals.jsx", "DebitIssuances.jsx", "CreditLeaderboard.jsx", "DebitLeaderboard.jsx", "Schedule.jsx"];
for (const page of reportPages) {
  const source = fs.readFileSync(`frontend/src/pages/${page}`, "utf8");
  assert(source.includes("useDailyGoogleReports"), `${page} does not read the global report state`);
  assert(!source.includes('/.netlify/functions/google-goals"'), `${page} still fetches reports directly`);
}

console.log("Validated v104: manual Apps Script snapshots, global React provider, IndexedDB persistence, silent refresh, and no page-level report reloads");
