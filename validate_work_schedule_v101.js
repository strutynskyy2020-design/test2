const fs = require('fs');
const vm = require('vm');

const code = fs.readFileSync('integrations/google-sheets/Code.gs', 'utf8');

function runFixture(display, raw, login = 'mukovoz') {
  const range = { getDisplayValues: () => display, getValues: () => raw };
  const sheet = { getDataRange: () => range };
  const spreadsheet = { getSheetByName: (name) => (name === 'Schedule' ? sheet : null) };
  const context = {
    console,
    SpreadsheetApp: { openById: () => spreadsheet },
    Utilities: {
      formatDate: (date, _timeZone, format) => {
        if (format === 'yyyy-MM-dd') return date.toISOString().slice(0, 10);
        if (format === 'EEE') return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
        return '27.07.2026 12:00';
      },
    },
    Session: { getScriptTimeZone: () => 'Europe/Kyiv' },
  };
  vm.createContext(context);
  vm.runInContext(code, context);
  return context.getScheduleForLogin(login);
}

const display = [
  ['', '', '', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'],
  ['ПІБ', 'Логін', 'ставка', 'сб', 'нд', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'нд', 'пн', 'вт', 'ср'],
  ['Муковоз Віра', 'mukovoz', '1', '', '', '9-18', '9-18', '9-18', '9-18', '11-20', '', '', '9-18', '9-18', '9-18'],
];
const raw = display.map((row) => row.slice());
const result = runFixture(display, raw);
if (!result.found) throw new Error(`Expected schedule, got ${result.reason}`);
if (result.diagnostics.date_row !== 1) throw new Error(`Expected date row 1, got ${result.diagnostics.date_row}`);
if (result.diagnostics.header_row !== 2) throw new Error(`Expected header row 2, got ${result.diagnostics.header_row}`);
if (result.days.length !== 12) throw new Error(`Expected 12 days, got ${result.days.length}`);
if (result.days[0].type !== 'day_off' || result.days[6].type !== 'late_shift') {
  throw new Error('Unexpected schedule status mapping');
}

const displayWithFormattedDates = [
  ['', '', '', '01.08.2026', '02.08.2026', '03.08.2026', '04.08.2026'],
  ['', '', '', '', '', '', ''],
  ['ПІБ', 'Логін', 'ставка', 'сб', 'нд', 'пн', 'вт'],
  ['Муковоз Віра', 'mukovoz', '1', 'В', '', '9-18', '10-19'],
];
const rawFormatted = displayWithFormattedDates.map((row) => row.slice());
const formattedResult = runFixture(displayWithFormattedDates, rawFormatted);
if (!formattedResult.found) throw new Error(`Formatted dates failed: ${formattedResult.reason}`);
if (formattedResult.diagnostics.date_row !== 1) throw new Error('Formatted date row not detected');
if (formattedResult.days[3].type !== 'weekend_shift') throw new Error('10-19 mapping failed');

console.log('Validated V101 robust Schedule date-row detection and status mapping');
