const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

const rows = Array.from({ length: 66 }, () => Array(15).fill(""));
const set = (row, column, value) => { rows[row][column] = value; };
const monthLogins = ["kameava", "kamyanka", "mayboroi", "sharkova", "sukharny", "yasko", "leukhina", "dzhunuso", "kulidai", "plashkar", "saenkanv"];

set(15, 0, "Pumb Online tranformation month");
set(16, 1, "TM_7");
set(16, 12, "TM_7 Підсумок");
set(16, 13, "TM_9");
set(16, 14, "Загальний підсумок");
set(17, 0, "Значения");
monthLogins.forEach((login, index) => set(17, index + 1, login));

const monthRows = [
  [19, "Клиенты на кот", ["2344", "3220", "2183", "1178", "1313", "1795", "2843", "1024", "2155", "1392", "1903", "21350", "23749", "45099"]],
  [20, "АНТ", ["00:01:40", "00:01:37", "00:01:38", "00:01:44", "00:02:14", "00:01:31", "00:01:24", "00:02:54", "00:01:55", "00:02:14", "00:01:55", "00:01:47", "00:01:36", "00:01:42"]],
  [21, "Уровень соглас", ["60%", "65%", "73%", "57%", "68%", "66%", "76%", "68%", "63%", "61%", "61%", "66%", "70%", "68%"]],
  [22, "Всего выполнено", ["43%", "46%", "56%", "45%", "49%", "48%", "54%", "50%", "45%", "44%", "42%", "48%", "50%", "49%"]],
  [23, "Активаций от согласий (%)", ["33,4%", "29,1%", "30,9%", "39,0%", "34,5%", "33,9%", "30,5%", "36,1%", "28,8%", "37,0%", "31,0%", "32,1%", "29,6%", "30,7%"]],
  [24, "Активаций ПУМБ онлайн от обработанных", ["26,35%", "23,57%", "28,03%", "28,10%", "30,16%", "27,26%", "27,22%", "31,84%", "23,57%", "29,02%", "24,75%", "26,64%", "24,81%", "25,68%"]],
  [25, "Проекционный", ["94%", "89,30%", "110,10%", "107,90%", "116,50%", "107%", "109%", "121%", "88%", "107%", "93%", "101,60%", "98,60%", "100%"]],
];
monthRows.forEach(([row, label, values]) => {
  set(row, 0, label);
  values.forEach((value, index) => set(row, index + 1, value));
});

// This typo is present in the live spreadsheet and caused v128 to continue
// reading the lower table as if it still belonged to the monthly block.
set(28, 0, "Pumb Online tranformation yestarday");
set(29, 1, "TM_7");
set(29, 8, "TM_7 Підсумок");
set(29, 9, "TM_9");
set(29, 10, "Загальний підсумок");
set(30, 0, "Значения");
["kameava", "sukharny", "yasko", "leukhina", "kulidai", "plashkar", "saenkanv"].forEach((login, index) => set(30, index + 1, login));

const yesterdayRows = [
  [31, "Клиенты на кот", ["1", "55", "52", "18", "70", "51", "77", "324", "163", "487"]],
  [32, "АНТ", ["00:00:21", "00:02:13", "00:01:15", "00:00:44", "00:01:43", "00:01:48", "00:01:34", "00:01:38", "00:01:09", "00:01:29"]],
  [33, "Уровень соглас", ["100%", "45%", "40%", "33%", "60%", "37%", "49%", "47%", "59%", "51%"]],
  [34, "Всего выполнено", ["0%", "22%", "23%", "33%", "29%", "25%", "27%", "26%", "29%", "27%"]],
  [35, "Активаций от согласий (%)", ["", "16,0%", "28,6%", "50,0%", "11,9%", "15,8%", "26,3%", "20,4%", "13,5%", "17,7%"]],
  [36, "Активаций ПУМБ онлайн от обработанных", ["9,09%", "17,31%", "22,22%", "7,14%", "5,88%", "15,58%", "", "11,73%", "8,59%", "10,68%"]],
  [37, "Проекционный 3.0 (%) NEW", ["75,40%", "139%", "230%", "74%", "61%", "148%", "", "108,70%", "82,60%", "100%"]],
];
yesterdayRows.forEach(([row, label, values]) => {
  set(row, 0, label);
  values.forEach((value, index) => set(row, index + 1, value));
});

const gasSource = fs.readFileSync("integrations/google-sheets/Code.gs", "utf8");
const sandbox = {
  console,
  Utilities: { formatDate: () => "04.08.2026 11:30" },
  Session: { getScriptTimeZone: () => "Europe/Kyiv" },
};
vm.createContext(sandbox);
vm.runInContext(`${gasSource}\nthis.__parseActivationTransformation = parseActivationTransformation;`, sandbox);

const transformation = sandbox.__parseActivationTransformation(rows, "pumb", "Activation Pumb Online");
const month = transformation.rows.find((row) => row.login === "mayboroi" && row.period === "month");
const yesterday = transformation.rows.find((row) => row.login === "yasko" && row.period === "yesterday");

assert(month, "month row for mayboroi must exist");
assert.equal(month.processed_tasks, "2183");
assert.equal(month.aht, "00:01:38");
assert.equal(month.agreement_rate, "73%");
assert.equal(month.completion_rate, "56%");
assert.equal(month.activation_from_agreements_rate, "30,9%");
assert.equal(month.activation_online_rate, "28,03%");
assert.equal(month.projective_rate, "110,10%");

assert(yesterday, "misspelled yestarday block must still be parsed as yesterday");
assert.equal(yesterday.processed_tasks, "52");
assert.equal(yesterday.aht, "00:01:15");
assert.equal(yesterday.projective_rate, "230%");

assert(gasSource.includes('REPORT_CACHE_API_VERSION = "v129-pumb-period-boundary-fix"'));
console.log("Activation PUMB misspelled period boundary v129: PASS");
