const integer = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
};

export const normalizeGameId = (gameId) => gameId === "light" ? "laser" : gameId;

export const publicGameChallenge = (session = {}) => {
  const challenge = session.public_challenge || {};
  const gameId = normalizeGameId(session.game_id);
  if (gameId === "memory") {
    return {
      kind: "sequence",
      paletteSize: Math.max(2, integer(challenge.palette_size, 4)),
      cues: Array.isArray(challenge.cues) ? challenge.cues.map((value) => integer(value)) : [],
      cueMs: Math.max(250, integer(challenge.cue_ms, 520)),
      durationMs: Math.max(1_000, integer(challenge.duration_ms, 25_000)),
      minDurationMs: Math.max(0, integer(challenge.min_duration_ms)),
    };
  }
  if (gameId === "laser") {
    return {
      kind: "timed-targets",
      lanes: Math.max(1, integer(challenge.lanes, 4)),
      targets: Array.isArray(challenge.targets) ? challenge.targets.map((target) => ({
        id: integer(target?.id, -1),
        lane: integer(target?.lane),
        atMs: Math.max(0, integer(target?.at_ms)),
        windowMs: Math.max(180, integer(target?.window_ms, 420)),
      })).filter((target) => target.id >= 0) : [],
      durationMs: Math.max(1_000, integer(challenge.duration_ms, 10_000)),
      minDurationMs: Math.max(0, integer(challenge.min_duration_ms)),
    };
  }
  if (gameId === "sorting") {
    return {
      kind: "sorting",
      lanes: Array.isArray(challenge.lanes) ? challenge.lanes.map((lane, index) => ({
        id: integer(lane?.id, index), label: String(lane?.label || `Місце ${index + 1}`),
      })) : [],
      cards: Array.isArray(challenge.cards) ? challenge.cards.map((card, index) => ({
        id: integer(card?.id, index), label: String(card?.label || `Предмет ${index + 1}`), icon: String(card?.icon || "package"),
      })) : [],
      durationMs: Math.max(1_000, integer(challenge.duration_ms, 14_000)),
      minDurationMs: Math.max(0, integer(challenge.min_duration_ms)),
    };
  }
  return { kind: "unsupported", minDurationMs: 0 };
};

export const activeLaserTargets = (targets, elapsedMs, caughtIds = new Set()) => (
  (targets || []).filter((target) => (
    !caughtIds.has(target.id)
    && elapsedMs >= target.atMs - 75
    && elapsedMs <= target.atMs + target.windowMs
  ))
);

export const laserTargetPosition = (target, laneCount = 4) => {
  const safeLanes = Math.max(1, integer(laneCount, 4));
  const lane = Math.max(0, Math.min(safeLanes - 1, integer(target?.lane)));
  const id = Math.max(0, integer(target?.id));
  return {
    left: `${((lane + 0.5) / safeLanes) * 100}%`,
    top: `${24 + ((id * 37) % 50)}%`,
  };
};

export const memoryFinishPayload = (moves) => ({
  moves: (moves || []).map((value) => integer(value)),
});

export const eventFinishPayload = (events) => ({
  events: (events || []).map((event) => ({
    target_id: integer(event.target_id),
    at_ms: Math.max(0, integer(event.at_ms)),
    ...(event.lane === undefined || event.lane === null ? {} : { lane: integer(event.lane) }),
  })),
});

export const withClientDuration = (payload, elapsedMs, minDurationMs = 0, maxDurationMs = null) => ({
  ...payload,
  client_duration_ms: Math.min(
    maxDurationMs === null ? 120_000 : Math.max(integer(minDurationMs), integer(maxDurationMs) + 1_000),
    Math.max(integer(minDurationMs), Math.max(0, integer(elapsedMs))),
  ),
});
