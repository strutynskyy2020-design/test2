const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const path = require('path');

const code = fs.readFileSync(path.join(__dirname, 'integrations/google-sheets/Code.gs'), 'utf8');
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
  Utilities: { formatDate: () => '14.08.2026 20:00', getUuid: () => 'v155-uuid' },
  Session: { getScriptTimeZone: () => 'Europe/Kyiv' },
};
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'Code.gs' });

assert(code.includes('const ACTIVATORS_SPREADSHEET_ID = "1X2zXNw52SAIpysVdmkiSbtm346pDes3s_uzdWPC6v2c"'));
assert(code.includes('Pumb Online transformation'));
assert(code.includes('Giving Pumb Online'));
assert(code.includes('Card transformation'));
assert(code.includes('Giving card'));
assert(!code.includes('const ACTIVATION_PUMB_SHEET_NAME = "Activation Deb"'));
assert(!code.includes('const ACTIVATION_CARDS_SHEET_NAME = "Activation CC"'));

const pumbProjection = [
  [],
  ['Pumb Online'],
  ['isAgent','1'],
  [],
  ['Проекционный 3.0 (%) NEW','','','','','processed_year','processed_month',''],
  ['','','','','','2026','2026 Підсумок','Загальний підсумок'],
  ['channel_name','subdiv','team','agent','processed_date','8','',''],
  ['CardActivation','Відділ продажу через дистанційні канали №1','TM_7','sukharny','','122,44%','122,44%','122,44%'],
  ['','','','dzhunuso','','115,90%','115,90%','115,90%'],
  ['','','','kamaeva','','111,48%','111,48%','111,48%'],
  ['','','TM_7 Підсумок','','','103,95%','103,95%','103,95%'],
  ['','Відділ продажу через дистанційні канали №2','TM_9','','','96,58%','96,58%','96,58%'],
  ['Загальний підсумок','','','','','100,00%','100,00%','100,00%'],
];

const pumbTransformation = [
  [],
  ['', 'Pumb Online tranformation month'],
  ['processed_year','2026'],
  ['processed_month','8'],
  ['processed_date','All'],
  ['cp_code','All'],
  ['calc_type','Уникальные продажи'],
  [],
  ['', '', 'team','agent'],
  ['', '', 'TM_7','','','','TM_7 Підсумок','TM_9','Загальний підсумок'],
  ['channel_name','Значения','kamaeva','sukharny','dzhunuso','', '','', ''],
  ['CardActivation'],
  ['', 'Клиенты на которых был оффер в момент звонка (#)','522','760','735','','2017','500','2517'],
  ['', 'AHT','00:01:40','00:02:24','00:02:51','','00:02:00','00:01:35','00:01:50'],
  ['', 'Уровень согласий (к обработанным) (%)','65,71%','63,29%','59,86%','','62,00%','65,04%','63,00%'],
  ['', 'Всего выполнивших вход в ИБ после согласия от Reached (%)','36,85%','35,97%','36,60%','','36,50%','37,81%','36,90%'],
  ['', 'Активаций от согласий (%)','24,78%','26,40%','26,82%','','26,00%','20,68%','24,00%'],
  ['', 'Активаций ПУМБ онлайн от обработанных контактов с офферами (%)','19,19%','20,42%','19,46%','','19,70%','15,68%','18,90%'],
  ['', 'Проекционный 3.0 (%) NEW','111,48%','122,44%','115,90%','','103,95%','96,58%','100,00%'],
  [],
  ['', 'Pumb Online tranformation yesterday'],
  ['processed_year','2026'],
  ['processed_month','8'],
  ['processed_date','13 серпень 2026 р.'],
  ['cp_code','All'],
  ['calc_type','Уникальные продажи'],
  [],
  ['', '', 'team','agent'],
  ['', '', 'TM_7','','','TM_7 Підсумок','TM_9','Загальний підсумок'],
  ['channel_name','Значения','kamaeva','sukharny','dzhunuso','','',''],
  ['CardActivation'],
  ['', 'Клиенты на которых был оффер в момент звонка (#)','124','78','72','','274','80','354'],
  ['', 'AHT','00:01:39','00:02:30','00:02:44','','00:02:02','00:01:32','00:01:49'],
  ['', 'Уровень согласий (к обработанным) (%)','54,84%','53,85%','54,17%','','54,30%','58,29%','55,16%'],
  ['', 'Всего выполнивших вход в ИБ после согласия от Reached (%)','24,39%','14,10%','25,00%','','21,00%','20,33%','20,68%'],
  ['', 'Активаций от согласий (%)','14,71%','9,52%','15,38%','','13,00%','9,84%','11,03%'],
  ['', 'Активаций ПУМБ онлайн от обработанных контактов с офферами (%)','8,94%','5,13%','9,72%','','8,00%','5,94%','6,58%'],
  ['', 'Проекционный 3.0 (%) NEW','132,31%','83,46%','158,22%','','107,26%','93,34%','100,00%'],
];

const pumbGiving = [
  [],
  ['Pumb Online giving'],
  ['channel_name','CardActivation'],
  ['processed_date','All'],
  ['po_gr','All'],
  [],
  ['oper_year','oper_month','team','agent','token','Продаж после обещаний (#)'],
  ['2026','8','TM_7','dzhunuso','','133'],
  ['','','','kamaeva','','101'],
  ['','','','sukharny','','159'],
  ['','','TM_7 Підсумок','','','393'],
  ['','','TM_9','','','1762'],
  ['Загальний підсумок','','','','','2155'],
  [],
  ['Pumb Online giving yesterday'],
  ['channel_name','CardActivation'],
  ['processed_date','13 серпень 2026 р.'],
  ['po_gr','All'],
  [],
  ['oper_year','oper_month','team','agent','token','Продаж после обещаний (#)'],
  ['2026','8','TM_7','dzhunuso','','7'],
  ['','','','kamaeva','','10'],
  ['','','','sukharny','','4'],
  ['','','TM_7 Підсумок','','','21'],
  ['','','TM_9','','','55'],
  ['Загальний підсумок','','','','','76'],
];

const cardProjection = [
  [],
  ['Card activation'],
  ['ct_client_type','All'],
  ['ct_base_type','All'],
  ['div','All'],
  ['leftt','All'],
  ['processed_date','All'],
  [],
  ['Проекционный (операторы) (базы) (%) (ПУМБ/АКЦ)','Позначки стовпців'],
  ['', '8','8 Підсумок','Загальний підсумок'],
  ['Позначки рядків','2026','',''],
  ['LUI','100,00%','100,00%','100,00%'],
  ['TM_7','106,48%','106,48%','106,48%'],
  ['dzhunuso','120,74%','120,74%','120,74%'],
  ['kamaeva','93,74%','93,74%','93,74%'],
  ['sukharny','119,81%','119,81%','119,81%'],
  ['TM_9','94,37%','94,37%','94,37%'],
  ['Загальний підсумок','100,00%','100,00%','100,00%'],
];

const cardTransformation = [
  [],
  ['', 'Card activation transformation month'],
  ['', 'processed_year','2026'],
  ['', 'processed_month','8'],
  ['', 'processed_date','All'],
  ['', 'ct_client_type','All'],
  ['', 'div','All'],
  ['', 'communication_type','All'],
  ['', 'isReached','All'],
  ['', 'ct_base_type','All'],
  [],
  ['', '', 'Позначки стовпців'],
  ['', '', 'LUI','','','','LUI Підсумок','Загальний підсумок'],
  ['', '', 'TM_7','','','TM_7 Підсумок','TM_9','',''],
  ['', 'Значения','kamaeva','sukharny','dzhunuso','','','',''],
  ['', 'Обработано (#)','508','726','733','','1967','9600','11567'],
  ['', 'AHT','00:01:39','00:02:21','00:02:57','','00:02:05','00:01:34','00:01:39'],
  ['', 'Согласий к обработанным (%)','68,11%','72,31%','64,12%','','68,00%','75,67%','71,91%'],
  ['', 'Активация от согласий (%)','19,36%','24,95%','31,06%','','25,00%','21,42%','23,30%'],
  ['', 'Активаций к обработанным (%)','13,19%','18,04%','19,92%','','17,00%','16,21%','16,76%'],
  [],
  ['', 'Card activation transformation yesterday'],
  ['', 'processed_year','2026'],
  ['', 'processed_month','8'],
  ['', 'processed_date','13 серпень 2026 р.'],
  ['', 'ct_client_type','All'],
  ['', 'div','All'],
  ['', 'communication_type','All'],
  ['', 'isReached','All'],
  ['', 'ct_base_type','All'],
  [],
  ['', '', 'Позначки стовпців'],
  ['', '', 'LUI','','','','LUI Підсумок','Загальний підсумок'],
  ['', '', 'TM_7','','','TM_7 Підсумок','TM_9','',''],
  ['', 'Значения','kamaeva','sukharny','dzhunuso','','','',''],
  ['', 'Обработано (#)','108','69','62','','239','765','1004'],
  ['', 'AHT','00:01:41','00:02:29','00:03:20','','00:02:18','00:01:36','00:01:47'],
  ['', 'Согласий к обработанным (%)','64,81%','72,46%','64,52%','','67,00%','75,82%','73,71%'],
  ['', 'Активация от согласий (%)','5,71%','0,00%','7,50%','','4,00%','3,28%','3,15%'],
  ['', 'Активаций к обработанным (%)','3,70%','0,00%','4,84%','','3,00%','2,48%','2,27%'],
];

const cardGiving = [
  [],
  ['Card activation giving'],
  ['transaction_after_try_date','All'],
  ['campaign','All'],
  [],
  ['transaction_after_promise_count','Позначки стовпців'],
  ['', 'TM_7','','','TM_7 Підсумок','TM_9','Загальний підсумок'],
  ['Позначки рядків','dzhunuso','kamaeva','sukharny','','',''],
  ['2026','147','94','168','409','1875','2284'],
  ['8','147','94','168','409','1875','2284'],
  ['A','23','10','37','70','391','461'],
  ['B','23','14','27','64','319','383'],
  ['C','25','16','23','64','254','318'],
  ['D','76','54','81','211','911','1122'],
  ['Загальний підсумок','147','94','168','409','1875','2284'],
  [],
  ['Card activation giving yesterday'],
  ['transaction_after_try_date','All'],
  ['campaign','All'],
  [],
  ['transaction_after_promise_count','Позначки стовпців'],
  ['', 'TM_7','','','TM_7 Підсумок','TM_9','Загальний підсумок'],
  ['Позначки рядків','dzhunuso','kamaeva','sukharny','','',''],
  ['2026','7','10','4','21','55','76'],
  ['8','7','10','4','21','55','76'],
  ['A','1','2','1','4','10','14'],
  ['B','1','1','1','3','9','12'],
  ['C','1','1','0','2','8','10'],
  ['D','4','6','2','12','28','40'],
  ['Загальний підсумок','7','10','4','21','55','76'],
];

function fakeSpreadsheet(map) {
  const sheets = Object.entries(map).map(([name, display]) => ({
    getName: () => name,
    isSheetHidden: () => false,
    getDataRange: () => ({ getDisplayValues: () => display, getValues: () => display }),
  }));
  return {
    getSheets: () => sheets,
    getSheetByName: (name) => sheets.find((s) => s.getName() === name) || null,
  };
}

const activators = fakeSpreadsheet({
  'Pumb Online': pumbProjection,
  'Pumb Online transformation': pumbTransformation,
  'Giving Pumb Online': pumbGiving,
  'Card activation': cardProjection,
  'Card transformation': cardTransformation,
  'Giving card': cardGiving,
});

const pumb = sandbox.getActivationPumbData(activators);
assert.equal(pumb.leaderboard.find(r => r.login === 'dzhunuso').projective_rate, '115,90%');
assert.equal(pumb.metrics.find(r => r.login === 'dzhunuso' && r.period === 'month').activation_online_rate, '19,46%');
assert.equal(pumb.metrics.find(r => r.login === 'kamaeva' && r.period === 'yesterday').projective_rate, '132,31%');
assert.equal(pumb.giving.find(r => r.login === 'dzhunuso' && r.period === 'month').overall, '133');
assert.equal(pumb.giving.find(r => r.login === 'kamaeva' && r.period === 'yesterday').overall, '10');
assert.equal(pumb.giving_group_summaries.month.tm7.overall, '393');
assert.equal(pumb.group_summaries.month.tm7.projective_rate, '103,95%');

const cards = sandbox.getActivationCardsData(activators);
assert.equal(cards.leaderboard.find(r => r.login === 'dzhunuso').projective_rate, '120,74%');
assert.equal(cards.metrics.find(r => r.login === 'dzhunuso' && r.period === 'month').activation_from_processed_rate, '19,92%');
assert.equal(cards.metrics.find(r => r.login === 'kamaeva' && r.period === 'yesterday').activation_from_agreements_rate, '5,71%');
assert.equal(cards.giving.find(r => r.login === 'dzhunuso' && r.period === 'month').segment_d, '76');
assert.equal(cards.giving.find(r => r.login === 'kamaeva' && r.period === 'yesterday').overall, '10');
assert.equal(cards.giving_group_summaries.month.tm7.overall, '409');

console.log(JSON.stringify({
  pumb_projection_rows: pumb.leaderboard.length,
  pumb_metric_rows: pumb.metrics.length,
  pumb_giving_rows: pumb.giving.length,
  card_projection_rows: cards.leaderboard.length,
  card_metric_rows: cards.metrics.length,
  card_giving_rows: cards.giving.length,
}, null, 2));
console.log('V155 activators separate source tests passed');
