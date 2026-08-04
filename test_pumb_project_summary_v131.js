const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

const rows = Array.from({ length: 30 }, () => Array(15).fill(""));
const set = (row, column, value) => { rows[row][column] = value; };
const logins = ["kameava", "kamyanka", "mayboroi", "sharkova", "sukharny", "yasko", "leukhina", "dzhunuso", "kulidai", "plashkar", "saenkanv"];

set(0, 0, "Pumb Online tranformation month");
set(1, 1, "TM_7");
set(1, 12, "TM_7 Підсумок");
set(1, 13, "TM_9");
set(1, 14, "Загальний підсумок");
set(2, 0, "Значения");
logins.forEach((login, index) => set(2, index + 1, login));

const metrics = [
  [3, "Клиенты на кот", "2183", "21350", "45099"],
  [4, "АНТ", "00:01:38", "00:01:47", "00:01:42"],
  [5, "Уровень соглас", "73%", "66%", "68%"],
  [6, "Всего выполнено", "56%", "48%", "49%"],
  [7, "Активаций от согласий (%)", "30,9%", "32,1%", "30,7%"],
  [8, "Активаций ПУМБ онлайн от обработанных", "28,03%", "26,64%", "25,68%"],
  [9, "Проекционный", "110,10%", "101,60%", "100%"],
];
metrics.forEach(([row, label, personal, team, overall]) => {
  set(row, 0, label);
  set(row, 3, personal); // mayboroi
  set(row, 12, team);
  set(row, 14, overall);
});

const source = fs.readFileSync("VPDK-Code-v130.gs", "utf8");
const sandbox = {
  console,
  Utilities: { formatDate: () => "04.08.2026 17:50" },
  Session: { getScriptTimeZone: () => "Europe/Kyiv" },
};
vm.createContext(sandbox);
vm.runInContext(`${source}\nthis.__parse = parseActivationTransformation;`, sandbox);

const result = sandbox.__parse(rows, "pumb", "Activation Pumb Online");
const mayboroi = result.rows.find((row) => row.login === "mayboroi" && row.period === "month");
assert(mayboroi, "mayboroi month row missing");
assert.equal(mayboroi.processed_tasks, "2183");
assert.equal(mayboroi.processed_tasks_team, "21350");
assert.equal(mayboroi.processed_tasks_overall, "45099");
assert.equal(mayboroi.aht_team, "00:01:47");
assert.equal(mayboroi.aht_overall, "00:01:42");
assert.equal(mayboroi.agreement_rate_team, "66%");
assert.equal(mayboroi.agreement_rate_overall, "68%");
assert.equal(mayboroi.completion_rate_overall, "49%");
assert.equal(mayboroi.activation_from_agreements_rate_overall, "30,7%");
assert.equal(mayboroi.activation_online_rate_overall, "25,68%");
assert.equal(mayboroi.projective_rate_team, "101,60%");
assert.equal(mayboroi.projective_rate_overall, "100%");
assert.equal(result.group_summaries.month.general.processed_tasks, "45099");

console.log("PUMB project summary v131: PASS");
