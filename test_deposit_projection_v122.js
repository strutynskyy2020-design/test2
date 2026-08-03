const fs = require('fs');
const vm = require('vm');

const code = fs.readFileSync('integrations/google-sheets/Code.gs', 'utf8');
const sandbox = {
  console,
  Utilities: {
    formatDate: () => '03.08.2026 16:20',
    getUuid: () => 'uuid',
  },
  Session: { getScriptTimeZone: () => 'Europe/Kyiv' },
};
vm.createContext(sandbox);
vm.runInContext(code, sandbox);

const runParser = (values) => sandbox.getDepositProjectionLeaderboard({
  getSheetByName: () => ({
    getDataRange: () => ({ getDisplayValues: () => values }),
  }),
});

// Actual production layout from the supplied screenshot:
// one shared identifier column (team labels + operator logins) and one value column.
const compactValues = [
  ['', '', '', 'Deposit', ''],
  ['', '', '', 'TM_1', '19,26%'],
  ['', '', '', 'burdelna', '144,44%'],
  ['', '', '', 'karpukhi', '72,22%'],
  ['', '', '', 'TM_10', '107,25%'],
  ['', '', '', 'kachalod', '144,44%'],
  ['', '', '', 'TM_6', '93,28%'],
  ['', '', '', 'fedun', '113,45%'],
  ['', '', '', 'stets', '98,43%'],
  ['', '', '', 'kolomiek', '96,30%'],
  ['', '', '', 'khomenaa', '90,89%'],
  ['', '', '', 'mukovoz', '89,16%'],
  ['', '', '', 'nechyolv', '80,69%'],
  ['', '', '', 'dmytriez', '48,15%'],
  ['', '', '', 'TM_7', '127,85%'],
  ['', '', '', 'kalapish', '134,42%'],
];

const compact = runParser(compactValues);
if (compact.diagnostics.layout !== 'compact') {
  throw new Error(`Expected compact layout, got ${compact.diagnostics.layout}`);
}
if (compact.rows.length !== 11) {
  throw new Error(`Expected 11 compact operator rows, got ${compact.rows.length}`);
}
if (compact.group_summaries.tm6.projective_rate !== '93,28%') {
  throw new Error('Compact TM6 summary mismatch');
}
const compactFedun = compact.rows.find((row) => row.login === 'fedun');
if (!compactFedun || compactFedun.team_key !== 'tm6' || compactFedun.projective_rate !== '113,45%') {
  throw new Error('Compact TM6 operator mismatch');
}

// Regression: keep supporting a split Team | Login | Result layout.
const splitValues = [
  ['', '', '', 'Deposit', '', ''],
  ['', '', '', 'TM_1', '', '19,26%'],
  ['', '', '', '', 'burdelna', '144,44%'],
  ['', '', '', 'TM_6', '', '93,28%'],
  ['', '', '', '', 'fedun', '113,45%'],
  ['', '', '', '', 'stets', '98,43%'],
];

const split = runParser(splitValues);
if (split.diagnostics.layout !== 'split') {
  throw new Error(`Expected split layout, got ${split.diagnostics.layout}`);
}
if (split.rows.length !== 3) {
  throw new Error(`Expected 3 split operator rows, got ${split.rows.length}`);
}
if (split.group_summaries.tm6.projective_rate !== '93,28%') {
  throw new Error('Split TM6 summary mismatch');
}

console.log('Deposit projection parser v122: compact + split layouts OK');
