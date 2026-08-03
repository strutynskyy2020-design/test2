const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const code = fs.readFileSync('integrations/google-sheets/Code.gs', 'utf8');
const sandbox = {
  console,
  Utilities: { formatDate: () => '03.08.2026 19:46', getUuid: () => 'uuid' },
  Session: { getScriptTimeZone: () => 'Europe/Kyiv' },
};
vm.createContext(sandbox);
vm.runInContext(code, sandbox);

const pumb = Array.from({ length: 64 }, () => Array(16).fill(''));
pumb[15][0] = 'Pumb Online tranformation month';
pumb[16][1] = 'TM_7'; pumb[16][12] = 'TM_7 Підсумок'; pumb[16][13] = 'TM_9'; pumb[16][14] = 'Загальний підсумок';
pumb[17] = ['Значения','kamaeva','kamyanka','mayboroi','sharkova','sukharny','yasko','leukhina','dzhunuso','kulidai','plashkar','saenkanv','','','',''];
pumb[19] = ['Клиенты на кот',2344,3220,2183,1178,1313,1795,2843,1024,2155,1392,1903,21350,23749,45099,''];
pumb[20] = ['AHT','00:01:40','00:01:37','00:01:38','00:01:44','00:02:14','00:01:31','00:01:24','00:02:54','00:01:55','00:02:14','00:01:55','00:01:47','00:01:36','00:01:42',''];
pumb[21] = ['Уровень согласий','60%','65%','73%','57%','68%','66%','76%','68%','63%','61%','61%','66%','70%','68%',''];
pumb[22] = ['Всего выполнено','43%','46%','56%','45%','49%','48%','54%','50%','45%','44%','42%','48%','50%','49%',''];
pumb[23] = ['Активаций от согласий (%)','33,4%','29,1%','30,9%','39,0%','34,5%','33,9%','30,5%','36,1%','28,8%','37,0%','31,0%','32,1%','29,6%','30,7%',''];
pumb[24] = ['Активаций ПУМБ онлайн от обработанных','26,35%','23,57%','28,03%','28,10%','30,16%','27,26%','27,22%','31,84%','23,57%','29,02%','24,75%','26,64%','24,81%','25,68%',''];
pumb[25] = ['Проекционный','94%','89,30%','110,10%','107,90%','116,50%','107%','109%','121%','88%','107%','93%','101,60%','98,60%','100%',''];
pumb[27][0] = 'Pumb Online tranformation yesterday';
pumb[28][1] = 'TM_7'; pumb[28][8] = 'TM_7 Підсумок'; pumb[28][9] = 'TM_9'; pumb[28][10] = 'Загальний підсумок';
pumb[29] = ['Значения','kamaeva','sukharny','yasko','leukhina','kulidai','plashkar','saenkanv','','','','','','','',''];
pumb[31] = ['Клиенты на кот',1,55,52,18,70,51,77,324,163,487,'','','','','',''];
pumb[32] = ['AHT','00:00:21','00:02:13','00:01:15','00:00:44','00:01:43','00:01:48','00:01:34','00:01:38','00:01:09','00:01:29','','','','','',''];
pumb[33] = ['Уровень согласий','100%','45%','40%','33%','60%','37%','49%','47%','59%','51%','','','','','',''];
pumb[34] = ['Всего выполнено','0%','22%','23%','33%','29%','25%','27%','26%','29%','27%','','','','','',''];
pumb[35] = ['Активаций от согласий (%)','0%','16,0%','28,6%','50,0%','11,9%','15,8%','26,3%','20,4%','13,5%','17,7%','','','','','',''];
pumb[36] = ['Активаций ПУМБ онлайн от обработанных','0%','9,09%','17,31%','22,22%','7,14%','5,88%','15,58%','11,73%','8,59%','10,68%','','','','','',''];
pumb[37] = ['Проекционный 3.0 (%) NEW','0%','75,40%','139%','230%','74%','61%','148%','108,70%','82,60%','100%','','','','','',''];
pumb[39][0] = 'Pumb Online giving';
pumb[40] = ['TM_7','leukhina','759','','','','','','','','','','','','',''];
pumb[41] = ['','kamyanka','710','','','','','','','','','','','','',''];
pumb[42] = ['','mayboroi','596','','','','','','','','','','','','',''];
pumb[43] = ['','kamaeva','555','','','','','','','','','','','','',''];
pumb[44] = ['','yasko','479','','','','','','','','','','','','',''];
pumb[45] = ['','kulidai','454','','','','','','','','','','','','',''];
pumb[46] = ['','saenkanv','429','','','','','','','','','','','','',''];
pumb[47] = ['','sukharny','394','','','','','','','','','','','','',''];
pumb[48] = ['','plashkar','365','','','','','','','','','','','','',''];
pumb[49] = ['','dzhunuso','318','','','','','','','','','','','','',''];
pumb[50] = ['','sharkova','312','','','','','','','','','','','','',''];
pumb[51] = ['TM_7 Підсумок','','5371','','','','','','','','','','','','',''];
pumb[53][0] = 'Pumb Online giving yesterday';
pumb[54] = ['TM_7','saenkanv','9','','','','','','','','','','','','',''];
pumb[55] = ['','yasko','6','','','','','','','','','','','','',''];
pumb[56] = ['','sukharny','4','','','','','','','','','','','','',''];
pumb[57] = ['','leukhina','3','','','','','','','','','','','','',''];
pumb[58] = ['','kulidai','3','','','','','','','','','','','','',''];
pumb[59] = ['','plashkar','2','','','','','','','','','','','','',''];
pumb[60] = ['TM_7 Підсумок','','27','','','','','','','','','','','','',''];

const pumbTransform = sandbox.parseActivationTransformation(pumb, 'pumb', 'Activation Pumb Online');
assert.equal(pumbTransform.rows.length, 18);
assert.equal(pumbTransform.rows.find(r => r.login === 'dzhunuso' && r.period === 'month').projective_rate, '121%');
assert.equal(pumbTransform.group_summaries.month.tm7.projective_rate, '101,60%');
assert.equal(pumbTransform.group_summaries.yesterday.tm7.projective_rate, '108,70%');
const pumbGiving = sandbox.getActivationPumbGivingData(pumb);
assert.equal(pumbGiving.rows.find(r => r.login === 'leukhina' && r.period === 'month').overall, '759');
assert.equal(pumbGiving.group_summaries.month.tm7.overall, '5371');
assert.equal(pumbGiving.group_summaries.yesterday.tm7.overall, '27');

const cards = Array.from({ length: 60 }, () => Array(16).fill(''));
cards[0][0] = 'Card activation';
cards[1][0] = 'TM_7'; cards[1][1] = '100,00%';
const names = [
  ['Джунусова Марина Сергіївна','126,80%'],['Майборода Інна Миколаївна','110,70%'],['Сухарник Соломія Іванівна','108,90%'],['Шаркова Снежана Валеріївна','104,60%'],['Леухіна Катерина Віталіївна','103,30%'],['Плашкарьова Олена Олександрівна','101,40%'],['Саєнко Анна Володимирівна','97,50%'],['Камаєва Людмила Анатоліївна','96,50%'],['Ясько Марія Олександрівна','96,30%'],["Кам'янка Ірина Ігорівна",'91,70%'],['Куліда Ілона Михайлівна','84,70%'],
];
names.forEach((item,index)=>{ cards[2+index][0]=item[0]; cards[2+index][1]=item[1]; });
cards[14][0] = 'Card activation transformation month';
cards[16][1] = 'TM_7'; cards[16][12] = 'TM_7 Підсумок'; cards[16][13] = 'TM_9'; cards[16][14] = 'LUI Підсумок';
cards[17] = ['Значения','sharkova','kamyanka','mayboroi','kamaeva','leukhina','kulidai','sukharny','yasko','plashkar','saenkanv','dzhunuso','','','',''];
cards[18] = ['Обработано (#)',1140,3177,2142,2441,2745,2167,1296,1770,1401,1822,1059,21160,22169,43329,''];
cards[19] = ['AHT','00:01:42','00:01:33','00:01:36','00:01:40','00:01:24','00:01:50','00:02:09','00:01:30','00:02:13','00:01:53','00:02:56','00:01:45','00:01:37','00:01:41',''];
cards[20] = ['Согласий к обработанным (%)','65,20%','74,20%','78,70%','65,70%','84,20%','73,90%','73,90%','71,50%','73,70%','70,60%','73,90%','73,80%','82,00%','78,00%',''];
cards[21] = ['Активация от согласий (%)','44,00%','34,80%','40,20%','41,20%','36,20%','33,10%','40,00%','38,80%','39,10%','40,40%','43,70%','38,30%','35,50%','36,80%',''];
cards[22] = ['Активаций к обработанным (%)','28,70%','25,80%','31,70%','27,10%','30,50%','24,50%','29,60%','27,70%','28,80%','28,50%','32,30%','28,30%','29,10%','28,70%',''];
cards[24][0] = 'Card activation transformation yesterday';
cards[26][1] = 'TM_7'; cards[26][8] = 'TM_7 Підсумок'; cards[26][9] = 'TM_9'; cards[26][10] = 'LUI Підсумок';
cards[27] = ['Значения','leukhina','kulidai','sukharny','yasko','plashkar','saenkanv','','','','','','','','',''];
cards[28] = ['Обработано (#)',6,54,39,43,42,64,248,109,357,357,'','','','',''];
cards[29] = ['AHT','00:01:24','00:01:52','00:02:15','00:01:29','00:01:51','00:01:31','00:01:45','00:01:22','00:01:38','00:01:38','','','','','',''];
cards[30] = ['Согласий к обработанным (%)','66,70%','79,60%','64,10%','53,50%','52,40%','57,80%','62,10%','77,10%','66,70%','66,70%','','','','','',''];
cards[31] = ['Активация от согласий (%)','50,00%','9,30%','24,00%','30,40%','31,80%','29,70%','24,00%','22,60%','23,50%','23,50%','','','','','',''];
cards[32] = ['Активаций к обработанным (%)','33,30%','7,40%','15,40%','16,30%','16,70%','17,20%','14,90%','17,40%','15,70%','15,70%','','','','','',''];
cards[34][0] = 'Card activation giving';
cards[35][1] = 'TM_7'; cards[35][12] = 'TM_7 Підсумок'; cards[35][13] = 'TM_9'; cards[35][14] = 'Загальний підсумок';
cards[36] = ['Позначки рядків','dzhunuso','kamaeva','kamyanka','kulidai','leukhina','mayboroi','plashkar','saenkanv','sharkova','sukharny','yasko','','','',''];
cards[37] = ['2026',393,692,850,535,878,725,437,549,340,406,531,6336,6703,13039,''];
cards[38] = ['7',393,692,850,535,878,725,437,549,340,406,531,6336,6703,13039,''];
cards[39] = ['A',67,184,212,147,258,186,112,144,79,103,144,1636,1814,3450,''];
cards[40] = ['B',60,106,152,106,160,136,77,104,65,59,89,1114,1229,2343,''];
cards[41] = ['C',41,75,98,46,89,90,45,63,35,47,67,696,779,1475,''];
cards[42] = ['D',225,327,388,236,371,313,203,238,161,197,231,2890,2881,5771,''];
cards[43] = ['Загальний підсумок',393,692,850,535,878,725,437,549,340,406,531,6336,6703,13039,''];
cards[45][0] = 'Card activation giving yesterday';
cards[46][1] = 'TM_7'; cards[46][11] = 'TM_7 Підсумок'; cards[46][12] = 'TM_9'; cards[46][13] = 'Загальний підсумок';
cards[47] = ['Позначки рядків','kamaeva','kamyanka','kulidai','leukhina','mayboroi','plashkar','saenkanv','sharkova','sukharny','yasko','','','','',''];
cards[48] = ['2026',10,17,12,23,1,10,28,1,18,30,150,132,282,'',''];
cards[49] = ['7',10,17,12,23,1,10,28,1,18,30,150,132,282,'',''];
cards[50] = ['A',0,8,2,4,0,3,4,0,3,3,27,31,58,'',''];
cards[51] = ['B',1,1,3,3,0,1,4,0,2,7,22,16,38,'',''];
cards[52] = ['C',1,1,1,4,0,2,2,0,2,5,18,17,35,'',''];
cards[53] = ['D',8,7,6,12,1,4,18,1,11,15,83,68,151,'',''];
cards[54] = ['Загальний підсумок',10,17,12,23,1,10,28,1,18,30,150,132,282,'',''];

const cardTransform = sandbox.parseActivationTransformation(cards, 'cards', 'Activation Cards');
assert.equal(cardTransform.rows.length, 17);
assert.equal(cardTransform.rows.find(r => r.login === 'dzhunuso' && r.period === 'month').activation_from_processed_rate, '32,30%');
assert.equal(cardTransform.group_summaries.month.tm7.activation_from_processed_rate, '28,30%');
const projection = sandbox.getActivationCardsProjection(cards, cardTransform.rows.filter(r=>r.period==='month').map(r=>r.login));
assert.equal(projection.rows.length, 11);
assert.equal(projection.rows.find(r => r.login === 'dzhunuso').projective_rate, '126,80%');
assert.equal(projection.rows.find(r => r.login === 'saenkanv').projective_rate, '97,50%');
assert.equal(projection.group_summaries.tm7.projective_rate, '100,00%');
const cardGiving = sandbox.getActivationCardsGivingData(cards);
const dzhMonth = cardGiving.rows.find(r=>r.login==='dzhunuso' && r.period==='month');
assert.deepEqual([dzhMonth.segment_a,dzhMonth.segment_b,dzhMonth.segment_c,dzhMonth.segment_d,dzhMonth.overall], ['67','60','41','225','393']);
const kamaYesterday = cardGiving.rows.find(r=>r.login==='kamaeva' && r.period==='yesterday');
assert.deepEqual([kamaYesterday.segment_a,kamaYesterday.segment_b,kamaYesterday.segment_c,kamaYesterday.segment_d,kamaYesterday.overall], ['0','1','1','8','10']);
assert.equal(cardGiving.group_summaries.month.tm7.segment_d, '2890');
assert.equal(cardGiving.group_summaries.yesterday.tm7.overall, '150');

console.log('Activation reports v125 parser: PASS');
