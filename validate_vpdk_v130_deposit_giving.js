const fs = require("fs");
const vm = require("vm");

const code = fs.readFileSync(`${__dirname}/VPDK-Code-v130.gs`, "utf8");
const context = {
  console,
  Utilities: { formatDate: () => "04.08.2026 17:35" },
  Session: { getScriptTimeZone: () => "Europe/Kyiv" },
};
vm.createContext(context);
vm.runInContext(code, context);

const values = [
  ["giving month"],
  ["team", "Агент", "Inb", "Web", "Web_apps", "Загальний підсумок"],
  ["TM_3", "", "", "1", "", "1"],
  ["", "mishchey", "", "1", "", "1"],
  ["TM_6", "", "", "3", "", "3"],
  ["", "khomenaa", "", "3", "", "3"],
  ["TM_7", "", "1", "3", "2", "6"],
  ["", "kalapish", "1", "1", "2", "4"],
  ["", "kubraky", "", "1", "", "1"],
  ["", "chornosh", "", "1", "", "1"],
];

const result = context.getDepositGivingData(values);
const kubraky = result.rows.find((row) => row.login === "kubraky" && row.period === "month");
if (!kubraky || kubraky.web !== "1" || kubraky.overall !== "1") {
  throw new Error(`Deposit giving parser failed: ${JSON.stringify(result)}`);
}
if (result.group_summaries.month.tm7.overall !== "6") {
  throw new Error(`TM7 summary failed: ${JSON.stringify(result.group_summaries)}`);
}
console.log("v130 deposit giving parser: OK");
