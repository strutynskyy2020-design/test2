const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const path = require('path');

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'tests/fixtures/report_source_v153.json'), 'utf8'));
const toDisplay = (rows) => rows.map((row) => row.map((value) => value == null ? '' : String(value)));

const weekdays = ['нд','пн','вт','ср','чт','пт','сб'];
const scheduleHeader = ['Логін', 'ставка', ...Array.from({ length: 31 }, (_, i) => String(i + 1))];
const scheduleWeekdays = ['', '', ...Array.from({ length: 31 }, (_, i) => weekdays[new Date(2026, 7, i + 1, 12).getDay()])];
const fedunSchedule = ['fedun', '1', ...Array.from({ length: 31 }, (_, i) => {
  const day = i + 1;
  if (day === 23) return 'В';
  if (day >= 25 && day <= 28) return 'Відпустка';
  return '9-18';
})];
const scheduleDisplay = [scheduleHeader, scheduleWeekdays, fedunSchedule];
const scheduleRaw = [
  ['Логін', 'ставка', ...Array.from({ length: 31 }, (_, i) => i + 1)],
  scheduleWeekdays,
  fedunSchedule,
];

const hiddenDepositHelper = [
  ['team', 'Агент', '2026'],
  ['TM_1', '', '999%'],
  ['', 'helper-only', '999%'],
];

function formatDate(date, tz, pattern) {
  const pad = (value) => String(value).padStart(2, '0');
  if (pattern === 'yyyy-MM-dd') return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  if (pattern === 'EEE') return ['sun','mon','tue','wed','thu','fri','sat'][date.getDay()];
  if (pattern === 'dd.MM.yyyy HH:mm') return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return String(date);
}

const sandbox = {
  console,
  Date,
  Math,
  JSON,
  Object,
  Array,
  String,
  Number,
  Boolean,
  RegExp,
  Error,
  Set,
  Map,
  Utilities: { formatDate, getUuid: () => 'v154-test-uuid' },
  Session: { getScriptTimeZone: () => 'Europe/Kyiv' },
};
vm.createContext(sandbox);
const codePath = path.join(__dirname, 'integrations/google-sheets/Code.gs');
const code = fs.readFileSync(codePath, 'utf8');
vm.runInContext(code, sandbox, { filename: 'Code.gs' });

assert(!code.includes('1TV7NHvEmLf6i19yPt7SENl2TOn1Y04ToW1CjSGhtrf0'), 'Active Apps Script must not reference the legacy spreadsheet ID');
assert(!code.includes('REPORT_SOURCE_SPREADSHEET_ID'), 'There must be only one spreadsheet source');
assert(!code.includes('function openGoalsSheet'), 'Legacy Goals sheet opener must be removed');
assert(!code.includes('function getSheetContext'), 'Legacy Goals context parser must be removed');
assert(!code.includes('function findGoalRow'), 'Legacy Goals row lookup must be removed');

const sheetSpecs = [];
for (const [name, rows] of Object.entries(fixture)) {
  if (name === 'Deposit') continue;
  sheetSpecs.push({ name, hidden: false, display: toDisplay(rows), raw: rows });
}
sheetSpecs.push({ name: 'Deposit', hidden: true, display: toDisplay(hiddenDepositHelper), raw: hiddenDepositHelper });
sheetSpecs.push({ name: 'Deposit ', hidden: false, display: toDisplay(fixture.Deposit), raw: fixture.Deposit });
sheetSpecs.push({ name: 'Schedule', hidden: false, display: scheduleDisplay, raw: scheduleRaw });

function makeSheet(spec) {
  return {
    getName: () => spec.name,
    isSheetHidden: () => Boolean(spec.hidden),
    getDataRange() {
      return {
        getDisplayValues: () => spec.display,
        getValues: () => spec.raw,
      };
    },
  };
}

function fakeSpreadsheet(specs) {
  const sheets = specs.map(makeSheet);
  return {
    getSheets: () => sheets,
    getSheetByName(name) { return sheets.find((sheet) => sheet.getName() === name) || null; },
  };
}

const ss = fakeSpreadsheet(sheetSpecs);

const depositProjection = sandbox.getDepositProjectionLeaderboard(ss);
assert(depositProjection.rows.some((row) => row.login === 'karpukhi'), 'Visible "Deposit " sheet must win over hidden helper "Deposit" sheet');
assert(!depositProjection.rows.some((row) => row.login === 'helper-only'), 'Hidden Deposit helper must not be used as projection source');

const scheduleSource = sandbox.scheduleSourceData(ss);
const schedule = sandbox.getScheduleForLogin('fedun', scheduleSource);
assert.strictEqual(schedule.found, true, 'Schedule should find fedun');
assert.strictEqual(schedule.days.length, 31, 'Schedule should parse all 31 day columns');
assert.strictEqual(schedule.range_start, '2026-08-01', 'Schedule start should be inferred from two-row day/weekday header');
assert.strictEqual(schedule.range_end, '2026-08-31', 'Schedule end should be inferred from two-row day/weekday header');
assert.strictEqual(schedule.days.find((day) => day.day === 23).type, 'day_off', 'Schedule day off must parse');
assert.strictEqual(schedule.days.find((day) => day.day === 25).type, 'vacation', 'Schedule vacation must parse');

const projectionGoals = sandbox.buildProjectionGoals('fedun', {
  creditRow: { overall: '107,50%' },
  debitRow: { overall: '98,40%' },
  depositProjectionRow: { projective_rate: '181,35%' },
  depositMetrics: [],
  activationPumbProjectionRow: { projective_rate: '104,10%' },
  activationPumbMetrics: [],
  activationCardsProjectionRow: { projective_rate: '99,90%' },
  activationCardsMetrics: [],
});
for (const name of ['credit','debit','deposit','pumb_online','cards']) {
  assert.strictEqual(projectionGoals[`${name}_target`], '100', `${name} target must be fixed at 100%`);
}
assert.strictEqual(projectionGoals.monthly_bonus_target, '0', 'Legacy bonus target must be disabled');

const snapshot = sandbox.buildReportSnapshots(ss);
assert(snapshot.reports.length > 0, 'Snapshot must build without any Goals sheet');
const fedun = snapshot.reports.find((entry) => entry.goals_login === 'fedun');
assert(fedun, 'Snapshot must contain fedun');
assert.strictEqual(fedun.payload.goals_found, false, 'No Goals sheet row should be used');
assert.strictEqual(fedun.payload.goals_editable, false, 'Projection values must be read-only');
assert.strictEqual(fedun.payload.projection_target, 100, 'Snapshot projection target must be 100');
assert.strictEqual(fedun.payload.goals.credit_target, '100');
assert.strictEqual(fedun.payload.goals.debit_target, '100');
assert.strictEqual(fedun.payload.goals.deposit_target, '100');
assert.strictEqual(fedun.payload.schedule.found, true, 'Schedule must be embedded in personal snapshot');

console.log(JSON.stringify({
  snapshot_profiles: snapshot.reports.length,
  visible_deposit_rows: depositProjection.rows.length,
  fedun_schedule_days: schedule.days.length,
  projection_target: fedun.payload.projection_target,
}, null, 2));
console.log('V154 single-source projection tests passed');
