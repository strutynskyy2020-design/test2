export const SCHEDULE_STATUS = {
  work: {
    label: "Робочий день",
    shortLabel: "Робочий",
    color: "#22C55E",
    soft: "rgba(34,197,94,.12)",
    border: "rgba(34,197,94,.28)",
  },
  late_shift: {
    label: "Пізня зміна",
    shortLabel: "Пізня",
    color: "#F4B740",
    soft: "rgba(244,183,64,.14)",
    border: "rgba(244,183,64,.34)",
  },
  weekend_shift: {
    label: "Зміна у вихідний",
    shortLabel: "10–19",
    color: "#6D3DF5",
    soft: "rgba(109,61,245,.12)",
    border: "rgba(109,61,245,.30)",
  },
  vacation: {
    label: "Відпустка",
    shortLabel: "Відпустка",
    color: "#3B82F6",
    soft: "rgba(59,130,246,.12)",
    border: "rgba(59,130,246,.28)",
  },
  day_off: {
    label: "Вихідний",
    shortLabel: "Вихідний",
    color: "#EF5350",
    soft: "rgba(239,83,80,.11)",
    border: "rgba(239,83,80,.25)",
  },
  unknown: {
    label: "Графік не вказаний",
    shortLabel: "Немає даних",
    color: "#70738A",
    soft: "rgba(112,115,138,.10)",
    border: "rgba(112,115,138,.22)",
  },
};

const pad = (value) => String(value).padStart(2, "0");

export const parseIsoDay = (value) => {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0);
};

export const dateToIso = (date) => (
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
);

export const kyivTodayIso = () => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
};

export const addIsoDays = (iso, amount) => {
  const date = parseIsoDay(iso);
  if (!date) return "";
  date.setDate(date.getDate() + amount);
  return dateToIso(date);
};

export const monthKeyFromIso = (iso) => String(iso || "").slice(0, 7);

export const formatMonthTitle = (monthKey) => {
  const match = String(monthKey || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return "Графік";
  return new Intl.DateTimeFormat("uk-UA", { month: "long", year: "numeric" })
    .format(new Date(Number(match[1]), Number(match[2]) - 1, 1, 12))
    .replace(/^./, (letter) => letter.toUpperCase());
};

export const formatFullDate = (iso) => {
  const date = parseIsoDay(iso);
  if (!date) return "";
  return new Intl.DateTimeFormat("uk-UA", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
};

export const getScheduleStatus = (day) => SCHEDULE_STATUS[day?.type] || SCHEDULE_STATUS.unknown;

export const formatShiftTime = (day) => {
  if (!day?.start || !day?.end) return "Весь день";
  return `${day.start} – ${day.end}`;
};

export const dayMapFromSchedule = (schedule) => new Map(
  (Array.isArray(schedule?.days) ? schedule.days : []).map((day) => [day.date, day]),
);

export const getScheduleMonths = (schedule) => {
  const keys = [];
  const seen = new Set();
  (Array.isArray(schedule?.days) ? schedule.days : []).forEach((day) => {
    const key = monthKeyFromIso(day.date);
    if (key && !seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  });
  return keys.sort();
};

export const buildMonthCells = (monthKey, schedule) => {
  const match = String(monthKey || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return [];
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const first = new Date(year, month, 1, 12);
  const daysInMonth = new Date(year, month + 1, 0, 12).getDate();
  const leading = (first.getDay() + 6) % 7;
  const byDate = dayMapFromSchedule(schedule);
  const cells = Array.from({ length: leading }, () => null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = dateToIso(new Date(year, month, day, 12));
    cells.push({ date, day, schedule: byDate.get(date) || null });
  }
  while (cells.length % 7) cells.push(null);
  return cells;
};
