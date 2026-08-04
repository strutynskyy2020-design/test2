const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

const rows = Array.from({ length: 66 }, () => Array(15).fill(""));
const set = (r, c, value) => { rows[r][c] = value; };
const monthLogins = ["kameava", "kamyanka", "mayboroi", "sharkova", "sukharny", "yasko", "leukhina", "dzhunuso", "kulidai", "plashkar", "saenkanv"];

set(15, 0, "Pumb Online tranformation month");
set(16, 1, "TM_7");
set(16, 12, "TM_7 Підсумок");
set(16, 13, "TM_9");
set(16, 14, "Загальний підсумок");
set(17, 0, "Значения");
monthLogins.forEach((login, index) => set(17, index + 1, login));
const dzColumn = monthLogins.indexOf("dzhunuso") + 1;
const metric = (r, label, own, tm7, tm9, overall) => {
  set(r, 0, label);
  set(r, dzColumn, own);
  set(r, 12, tm7);
  set(r, 13, tm9);
  set(r, 14, overall);
};
metric(19, "Клиенты на кот", "1024", "21350", "23749", "45099");
metric(20, "АНТ", "00:02:54", "00:01:47", "00:01:36", "00:01:42");
metric(21, "Уровень соглас", "68%", "66%", "70%", "68%");
metric(22, "Всего выполнено", "50%", "48%", "50%", "49%");
metric(23, "Активаций от согласий (%)", "36,1%", "32,1%", "29,6%", "30,7%");
metric(24, "Активаций ПУМБ онлайн от обработанных", "31,84%", "26,64%", "24,81%", "25,68%");
metric(25, "Проекционный", "121%", "101,60%", "98,60%", "100%");

set(28, 0, "Pumb Online tranformation yesterday");
set(29, 1, "TM_7");
set(29, 8, "TM_7 Підсумок");
set(29, 9, "TM_9");
set(29, 10, "Загальний підсумок");
set(30, 0, "Значения");
["kameava", "sukharny", "yasko", "leukhina", "kulidai", "plashkar", "saenkanv"].forEach((login, index) => set(30, index + 1, login));
set(31, 0, "Клиенты на кот"); set(31, 8, "324"); set(31, 9, "163"); set(31, 10, "487");
set(32, 0, "АНТ"); set(32, 8, "00:01:38"); set(32, 9, "00:01:09"); set(32, 10, "00:01:29");
set(33, 0, "Уровень соглас"); set(33, 8, "47%"); set(33, 9, "59%"); set(33, 10, "51%");
set(34, 0, "Всего выполнено"); set(34, 8, "26%"); set(34, 9, "29%"); set(34, 10, "27%");
set(35, 0, "Активаций от согласий (%)"); set(35, 8, "20,4%"); set(35, 9, "13,5%"); set(35, 10, "17,7%");
set(36, 0, "Активаций ПУМБ онлайн от обработанных"); set(36, 8, "11,73%"); set(36, 9, "8,59%"); set(36, 10, "10,68%");
set(37, 0, "Проекционный 3.0 (%) NEW"); set(37, 8, "108,70%"); set(37, 9, "82,60%"); set(37, 10, "100%");

set(39, 0, "Pumb Online giving");
set(40, 0, "TM_7"); set(40, 1, "leukhina"); set(40, 2, "759");
set(41, 1, "kamyanka"); set(41, 2, "710");
set(42, 1, "mayboroi"); set(42, 2, "596");
set(43, 1, "kameava"); set(43, 2, "555");
set(44, 1, "yasko"); set(44, 2, "479");
set(45, 1, "kulidai"); set(45, 2, "454");
set(46, 1, "saenkanv"); set(46, 2, "429");
set(47, 1, "sukharny"); set(47, 2, "394");
set(48, 1, "plashkar"); set(48, 2, "365");
set(49, 1, "dzhunuso"); set(49, 2, "318");
set(50, 1, "sharkova"); set(50, 2, "312");
set(51, 0, "TM_7 Підсумок"); set(51, 2, "5371");

set(53, 0, "Pumb Online giving yesterday");
set(54, 0, "TM_7"); set(54, 1, "saenkanv"); set(54, 2, "9");
set(55, 1, "yasko"); set(55, 2, "6");
set(56, 1, "sukharny"); set(56, 2, "4");
set(57, 1, "leukhina"); set(57, 2, "3");
set(58, 1, "kulidai"); set(58, 2, "3");
set(59, 1, "plashkar"); set(59, 2, "2");
set(60, 0, "TM_7 Підсумок"); set(60, 2, "27");

const gasSource = fs.readFileSync("integrations/google-sheets/Code.gs", "utf8");
const sandbox = {
  console,
  Utilities: { formatDate: () => "04.08.2026 10:19" },
  Session: { getScriptTimeZone: () => "Europe/Kyiv" },
};
vm.createContext(sandbox);
vm.runInContext(`${gasSource}\nthis.__parseActivationTransformation = parseActivationTransformation; this.__getActivationPumbGivingData = getActivationPumbGivingData;`, sandbox);

const transformation = sandbox.__parseActivationTransformation(rows, "pumb", "Activation Pumb Online");
const personal = transformation.rows.find((row) => row.login === "dzhunuso" && row.period === "month");
assert(personal, "month row for dzhunuso must be parsed");
assert.equal(personal.processed_tasks, "1024");
assert.equal(personal.aht, "00:02:54");
assert.equal(personal.agreement_rate, "68%");
assert.equal(personal.completion_rate, "50%");
assert.equal(personal.activation_from_agreements_rate, "36,1%");
assert.equal(personal.activation_online_rate, "31,84%");
assert.equal(personal.projective_rate, "121%");
assert.equal(personal.processed_tasks_team, "21350");
assert.equal(personal.aht_team, "00:01:47");
assert.equal(personal.projective_rate_team, "101,60%");
assert.equal(personal.team_summary.processed_tasks, "21350");
assert.equal(personal.team_summary.projective_rate, "101,60%");
assert.equal(transformation.rows.some((row) => row.login === "dzhunuso" && row.period === "yesterday"), false);

const giving = sandbox.__getActivationPumbGivingData(rows);
const givingMonth = giving.rows.find((row) => row.login === "dzhunuso" && row.period === "month");
assert(givingMonth, "month giving row for dzhunuso must be parsed");
assert.equal(givingMonth.overall, "318");
assert.equal(givingMonth.team_overall, "5371");
assert.equal(giving.group_summaries.month.tm7.overall, "5371");
assert.equal(giving.rows.some((row) => row.login === "dzhunuso" && row.period === "yesterday"), false);

assert(gasSource.includes('REPORT_CACHE_API_VERSION = "v128-activation-data-tasks-team-filters"'));
console.log("Activation PUMB exact-period parser v128: PASS");
