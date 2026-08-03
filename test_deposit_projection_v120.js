const fs = require('fs');
const vm = require('vm');

const code = fs.readFileSync('integrations/google-sheets/Code.gs', 'utf8');
const sandbox = {
  console,
  Utilities: {
    formatDate: () => '03.08.2026 15:00',
    getUuid: () => 'uuid',
  },
  Session: { getScriptTimeZone: () => 'Europe/Kyiv' },
};
vm.createContext(sandbox);
vm.runInContext(code, sandbox);

const values = [
  ['', '', '', 'Deposit', '', ''],
  ['', '', '', 'TM_1', '', '19,26%'],
  ['', '', '', '', 'burdelna', '144,44%'],
  ['', '', '', '', 'karpukhi', '72,22%'],
  ['', '', '', 'TM_6', '', '93,28%'],
  ['', '', '', '', 'fedun', '113,45%'],
  ['', '', '', '', 'znachkoo', '80,69%'],
  ['', '', '', 'TM_7', '', '127,85%'],
  ['', '', '', '', 'kalapish', '134,42%'],
];

const spreadsheet = {
  getSheetByName: () => ({
    getDataRange: () => ({ getDisplayValues: () => values }),
  }),
};

const result = sandbox.getDepositProjectionLeaderboard(spreadsheet);
if (result.rows.length !== 5) throw new Error(`Expected 5 rows, got ${result.rows.length}`);
if (result.group_summaries.tm6.projective_rate !== '93,28%') throw new Error('TM6 summary mismatch');
const fedun = result.rows.find((row) => row.login === 'fedun');
if (!fedun || fedun.team_key !== 'tm6' || fedun.projective_rate !== '113,45%') {
  throw new Error('TM6 operator mismatch');
}
console.log('Deposit projection parser v120: OK');
