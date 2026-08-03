const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const code = fs.readFileSync('integrations/google-sheets/Code.gs', 'utf8');
const context = {
  console,
  Utilities: {
    formatDate: () => '03.08.2026 14:00',
    getUuid: () => 'uuid',
  },
  Session: { getScriptTimeZone: () => 'Europe/Kyiv' },
};
vm.createContext(context);
vm.runInContext(code, context);

const width = 18;
const row = (...values) => [...values, ...Array(Math.max(0, width - values.length)).fill('')];
const values = [
  row('Dep month'),
  row('', '', '', 'Відділ продажу', '', '', '', '', 'TM_1 Підсумок', 'TM_6', '', '', 'TM_6 Підсумок'),
  row('Values', '', '', 'alice', 'bob', '', '', '', '', 'fedun', 'znachkoo'),
  row('Обработано (#)', '', '', '20', '10', '', '', '', '30', '40', '25', '', '65'),
  row('Назначено встреч от обработанных (%)', '', '', '50,00%', '40,00%', '', '', '', '45,00%', '30,00%', '60,00%', '', '42,00%'),
  row('Выдано от обработанных (встреча) (%)', '', '', '25,00%', '20,00%', '', '', '', '22,50%', '15,00%', '24,00%', '', '18,00%'),
  row('выдачі', '', '', '5', '2', '', '', '', '7', '6', '6', '', '12'),
  row('Projective_rate', '', '', '120,00%', '80,00%', '', '', '', '100,00%', '90,00%', '110,00%', '', '95,00%'),
  row('Dep yesterday'),
  row('', '', '', 'TM_1 Підсумок', '', '', 'TM_6 Підсумок'),
  row('Values', '', 'alice', '', '', 'fedun'),
  row('Обработано (#)', '', '3', '3', '', '5', '5'),
  row('Назначено встреч от обработанных (%)', '', '50,00%', '50,00%', '', '40,00%', '40,00%'),
  row('Выдано от обработанных (встреча) (%)', '', '33,33%', '33,33%', '', '20,00%', '20,00%'),
  row('выдачі', '', '1', '1', '', '1', '1'),
  row('Projective_rate', '', '100,00%', '100,00%', '', '95,00%', '95,00%'),
  row('Giving month'),
  row('team', 'Агент', 'Inb', 'Vse', 'Web', 'Web_apps', 'Загальний підсумок'),
  row('TM_1', '', '4', '1', '0', '7', '12'),
  row('', 'alice', '1', '0', '0', '3', '4'),
  row('', 'bob', '3', '1', '0', '4', '8'),
  row('TM_6', '', '5', '0', '108', '7', '120'),
  row('', 'fedun', '2', '0', '26', '1', '29'),
  row('', 'znachkoo', '1', '0', '11', '1', '13'),
  row('Giving yesterday'),
  row('team', 'Агент', 'Inb', 'Vse', 'Web', 'Web_apps', 'Загальний підсумок'),
  row('TM_1', '', '1', '0', '4', '0', '5'),
  row('', 'alice', '1', '0', '4', '0', '5'),
  row('TM_6', '', '0', '0', '3', '1', '4'),
  row('', 'fedun', '0', '0', '3', '1', '4'),
];

const metrics = context.getDepositMetricRows('fedun', values);
assert.equal(metrics.length, 2);
const month = metrics.find((item) => item.period === 'month');
assert.equal(month.processed_tasks, '40');
assert.equal(month.issuances, '6');
assert.equal(month.projective_rate, '90,00%');
assert.equal(month.team_overall.tm6.projective_rate_overall, '95,00%');
assert.equal(month.team_overall.tm6.processed_tasks_overall, '65');

const giving = context.getDepositGivingData(values);
assert.equal(giving.rows.length, 6);
assert.equal(giving.group_summaries.month.tm6.overall, '120');
assert.equal(giving.group_summaries.yesterday.tm6.overall, '4');
const fedun = giving.rows.find((item) => item.login === 'fedun' && item.period === 'month');
assert.deepEqual({ inb: fedun.inb, web: fedun.web, web_apps: fedun.web_apps, overall: fedun.overall, team_key: fedun.team_key }, { inb: '2', web: '26', web_apps: '1', overall: '29', team_key: 'tm6' });
assert.deepEqual(context.getDepositLogins(giving).sort(), ['alice', 'bob', 'fedun', 'znachkoo']);
assert.equal(context.getDepositIssuanceRows('fedun', giving).length, 2);
console.log('Deposit parser v118: OK');
