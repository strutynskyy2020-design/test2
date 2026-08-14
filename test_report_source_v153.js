const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const fixture = JSON.parse(fs.readFileSync(require('path').join(__dirname, 'tests/fixtures/report_source_v153.json'), 'utf8'));
const displayFixture = {};
for (const [name, rows] of Object.entries(fixture)) {
  displayFixture[name] = rows.map((row) => row.map((value) => value == null ? '' : String(value)));
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
  Utilities: {
    formatDate: () => '14.08.2026 18:32',
    getUuid: () => 'test-uuid',
  },
  Session: {
    getScriptTimeZone: () => 'Europe/Kyiv',
  },
};
vm.createContext(sandbox);
const code = fs.readFileSync(require('path').join(__dirname, 'integrations/google-sheets/Code.gs'), 'utf8');
vm.runInContext(code, sandbox, { filename: 'Code.gs' });

function fakeSpreadsheet(data) {
  return {
    getSheetByName(name) {
      const values = data[name];
      if (!values) return null;
      return {
        getDataRange() {
          return { getDisplayValues: () => values };
        },
      };
    },
  };
}

const ss = fakeSpreadsheet(displayFixture);

const credit = sandbox.getCreditLeaderboard(ss);
assert(credit.rows.length > 30, 'Credit leaderboard should contain operators');
assert(credit.rows.some((row) => row.login === 'kubraky' && row.team_key === 'tm7'), 'Credit: kubraky should be in TM7');
assert(credit.group_summaries.tm7, 'Credit: TM7 summary is missing');

const debit = sandbox.getDebitLeaderboard(ss);
assert(debit.rows.length > 30, 'Debit leaderboard should contain operators');
assert(debit.rows.some((row) => row.login === 'marutsen' && row.team_key === 'tm10'), 'Debit: marutsen should be in TM10');
assert(debit.group_summaries.tm6, 'Debit: TM6 summary is missing');

const creditSources = {
  creditTransformationSources: [
    { sheetName: 'X-Sell', values: displayFixture['X-Sell'] },
    { sheetName: 'Web', values: displayFixture['Web'] },
    { sheetName: 'INB', values: displayFixture['INB'] },
  ],
  transformationValues: [],
  creditMetricValues: [],
};
const creditMetrics = sandbox.getCreditMetricRows('paliya', creditSources);
assert.strictEqual(creditMetrics.length, 6, 'Credit metrics should have 3 channels x 2 periods for paliya');
assert.deepStrictEqual(new Set(creditMetrics.map((row) => row.channel)), new Set(['xsell', 'web_apps', 'inb']));
assert.deepStrictEqual(new Set(creditMetrics.map((row) => row.period)), new Set(['month', 'yesterday']));
assert(creditMetrics.every((row) => row.projective_source && ['X-Sell','Web','INB'].includes(row.projective_source.sheet)), 'Credit projective source should point to new sheet');

const debitGiving = sandbox.getDebitIssuanceRows('marutsen', displayFixture['Debit giving']);
assert(debitGiving.some((row) => row.period === 'month' && row.overall !== '0'), 'Debit giving month missing for marutsen');
assert(debitGiving.some((row) => row.period === 'yesterday' && row.overall !== '0'), 'Debit giving yesterday missing for marutsen');
assert(debitGiving.every((row) => row.vse_card === '0'), 'Debit giving VSE fallback should be zero');

const depositProjection = sandbox.getDepositProjectionLeaderboard(ss);
assert(depositProjection.rows.some((row) => row.login === 'karpukhi' && row.team_key === 'tm1'), 'Deposit projection: karpukhi/TM1 missing');
assert(depositProjection.group_summaries.tm6, 'Deposit projection TM6 summary missing');

const depositMetrics = sandbox.getDepositMetricRows('fedun', displayFixture['Deposit transformation']);
assert.strictEqual(depositMetrics.length, 2, 'Deposit metrics should contain month + yesterday for fedun');
assert(depositMetrics.some((row) => row.period === 'month' && row.projective_source.sheet === 'Deposit transformation'));
assert(depositMetrics.some((row) => row.period === 'yesterday'));

const depositGiving = sandbox.getDepositGivingData(displayFixture['Deposit giving']);
const karpDepositGiving = depositGiving.rows.filter((row) => row.login === 'karpukhi');
assert(karpDepositGiving.some((row) => row.period === 'month'), 'Deposit giving month missing for fedun');
assert(depositGiving.group_summaries.month.tm1, 'Deposit giving TM1 month summary missing');
assert(depositGiving.rows.every((row) => row.vse === '0'), 'Deposit giving VSE fallback should be zero');

const activationDeb = sandbox.getActivationPumbData(ss);
assert(activationDeb.metrics.length > 40, 'Activation Deb should parse operator metrics');
assert(activationDeb.metrics.some((row) => row.login === 'fedun' && row.team_key === 'tm6'), 'Activation Deb: fedun/TM6 missing');
assert(activationDeb.group_summaries.month.tm6, 'Activation Deb: TM6 summary missing');

const activationCc = sandbox.getActivationCardsData(ss);
assert(activationCc.metrics.length > 40, 'Activation CC should parse operator metrics');
assert(activationCc.metrics.some((row) => row.login === 'leonenki'), 'Activation CC: leonenki missing');
assert(Object.keys(activationCc.group_summaries).some((key) => key.startsWith('tm')), 'Activation CC team summaries missing');

console.log(JSON.stringify({
  credit_rows: credit.rows.length,
  debit_rows: debit.rows.length,
  credit_metric_rows_for_paliya: creditMetrics.length,
  debit_giving_rows_for_marutsen: debitGiving.length,
  deposit_projection_rows: depositProjection.rows.length,
  deposit_metric_rows_for_fedun: depositMetrics.length,
  deposit_giving_rows: depositGiving.rows.length,
  activation_deb_rows: activationDeb.metrics.length,
  activation_cc_rows: activationCc.metrics.length,
}, null, 2));
console.log('V153 report-source parser tests passed');
