const nonNegativeNumber = (value) => {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : null;
};

const firstNumber = (...values) => {
  for (const value of values) {
    const number = nonNegativeNumber(value);
    if (number !== null) return number;
  }
  return null;
};

export const getMistakeLimit = (session) => firstNumber(
  session?.mistake_limit,
  session?.max_misses,
  session?.max_mistakes,
);

export const getMistakesUsed = (session) => firstNumber(
  session?.mistakes,
  session?.misses_used,
) ?? 0;

export const getMistakesRemaining = (session) => {
  const limit = getMistakeLimit(session);
  const explicit = firstNumber(session?.mistakes_remaining, session?.misses_remaining);
  if (explicit !== null) return limit === null ? explicit : Math.min(limit, explicit);
  return limit === null ? null : Math.max(0, limit - getMistakesUsed(session));
};

export const isHiddenObjectSessionFailed = (session, event) => (
  String(session?.status || "").toLowerCase() === "failed" || event?.failed === true
);

