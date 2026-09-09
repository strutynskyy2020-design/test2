const ACTION_POSES = { feed: "eat", play: "play", rest: "sleep", pet: "sit" };

export const isUsablePetImage = (image) => Number(image?.naturalWidth) > 1 && Number(image?.naturalHeight) > 1;

const CONDITION_COPY = {
  healthy: {
    label: "Усе добре",
    tone: "healthy",
    summary: "Потреби стабільні. Підтримуйте різноманітний догляд щодня.",
    consequence: "Голод, бруд і самотність поступово погіршують здоров’я та довіру.",
  },
  unhappy: {
    label: "Засмучений",
    tone: "warning",
    summary: "Одна або кілька потреб уже знижені. Котику потрібна доречна турбота.",
    consequence: "Тривале ігнорування переведе стан у занедбаний і почне забирати довіру.",
  },
  neglected: {
    label: "Занедбаний",
    tone: "danger",
    summary: "Піклування було недостатньо: довіра та здоров’я тепер під загрозою.",
    consequence: "За нульової довіри котик може піти. Тривалий голод або бруд шкодять здоров’ю.",
  },
  sick: {
    label: "Захворів",
    tone: "danger",
    summary: "Хвороба сама не мине — потрібні лікування, чистота та спокій.",
    consequence: "Без лікування здоров’я продовжить падати й стан стане критичним.",
  },
  critical: {
    label: "Критичний стан",
    tone: "critical",
    summary: "Потрібно діяти зараз: нагодувати, прибрати або вилікувати — залежно від потреби.",
    consequence: "Якщо здоров’я впаде до нуля, життя котика завершиться.",
  },
};

const MOOD_STATE_LABELS = {
  do_not_touch: "Не чіпай мене",
  dont_touch: "Не чіпай мене",
  leave_me_alone: "Не чіпай мене",
  picky: "Вередує через однакову їжу",
  bored: "Набридла ця іграшка",
  exhausted: "Виснажений",
  overstimulated: "Перезбуджений",
};

const ILLNESS_LABELS = {
  cold: "Застуда",
  stomach: "Розлад шлунку",
  stomach_ache: "Розлад шлунку",
  infection: "Інфекція",
  weakness: "Сильна слабкість",
};

const asFutureDate = (value, nowMs) => {
  const timestamp = new Date(value || "").getTime();
  return Number.isFinite(timestamp) && timestamp > nowMs ? timestamp : null;
};

const formatProtectionTime = (timestamp) => new Intl.DateTimeFormat("uk-UA", {
  day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Kyiv",
}).format(timestamp);

const hoursCopy = (value) => {
  const hours = Math.max(0, Number(value) || 0);
  if (hours < 1) return "менше години";
  return `${Math.ceil(hours)} год`;
};

export const derivePetLifeView = (pet, nowMs = Date.now()) => {
  const survival = pet?.survival || {};
  const stats = pet?.stats || {};
  const status = ["alive", "runaway", "dead"].includes(survival.status) ? survival.status : "alive";
  const illness = typeof survival.illness === "object" ? survival.illness?.id || survival.illness?.type : survival.illness;
  let condition = survival.condition;
  if (!CONDITION_COPY[condition]) {
    if (Number(stats.health) <= 25 || Number(stats.satiety) <= 10) condition = "critical";
    else if (illness) condition = "sick";
    else if (Number(stats.cleanliness) < 25 || Number(stats.satiety) < 25 || Number(stats.mood) < 25) condition = "neglected";
    else if ([stats.satiety, stats.mood, stats.energy, stats.health, stats.cleanliness].some((value) => Number(value) < 50)) condition = "unhappy";
    else condition = "healthy";
  }

  const copy = CONDITION_COPY[condition];
  const moodState = survival.mood_state || survival.reaction_state;
  const debuffs = [];
  if (illness) debuffs.push(ILLNESS_LABELS[illness] || "Почувається зле");
  if (moodState && MOOD_STATE_LABELS[moodState]) debuffs.push(MOOD_STATE_LABELS[moodState]);
  if (Number(stats.satiety) <= 20) debuffs.push("Сильний голод");
  if (Number(stats.cleanliness) <= 25) debuffs.push("Брудно");
  if (Number(stats.energy) <= 20) debuffs.push("Майже немає сил");

  const protection = survival.protection || {};
  const protectionUntil = asFutureDate(
    survival.hotel_until || survival.protected_until || survival.grace_until || protection.until,
    nowMs,
  );
  const protectedNow = Boolean(
    survival.protected || survival.weekend_protected || protection.active || protectionUntil,
  );
  let protectionLabel = null;
  if (protectedNow) {
    if (survival.weekend_protected || protection.reason === "weekend") protectionLabel = "Вихідна перетримка: потреби захищені";
    else if (protectionUntil) protectionLabel = `Захист до ${formatProtectionTime(protectionUntil)}`;
    else protectionLabel = "Потреби тимчасово захищені";
  }

  const runawayHours = survival.runaway_hours_remaining ?? survival.hours_to_runaway;
  const criticalHours = survival.critical_hours_remaining ?? survival.hours_to_death;
  const warning = survival.warning;
  let riskLabel = typeof warning === "string" ? warning : warning?.message || warning?.title || null;
  if (!riskLabel && Number.isFinite(Number(runawayHours))) riskLabel = `Може піти через ${hoursCopy(runawayHours)}`;
  if (!riskLabel && Number.isFinite(Number(criticalHours))) riskLabel = `Критичний наслідок через ${hoursCopy(criticalHours)}`;

  if (status === "runaway") return {
    status, condition: "critical", alive: false, tone: "ended", label: "Котик пішов",
    summary: "Через тривалу самотність і нульову довіру котик залишив кімнату.",
    consequence: "Колекція кімнати збережена, але стосунки з новим улюбленцем почнуться заново.",
    debuffs: [], protectionLabel: null, riskLabel: null,
  };
  if (status === "dead") return {
    status, condition: "critical", alive: false, tone: "ended", label: "Життя завершилося",
    summary: "Тривалий критичний стан вичерпав здоров’я котика.",
    consequence: "Колекція кімнати збережена, але стосунки з новим улюбленцем почнуться заново.",
    debuffs: [], protectionLabel: null, riskLabel: null,
  };

  return {
    status, condition, alive: true, tone: copy.tone, label: copy.label,
    summary: survival.message || copy.summary,
    consequence: copy.consequence,
    debuffs: [...new Set(debuffs)], protectionLabel, riskLabel,
  };
};

export const petRefetchInterval = (snapshot) => {
  if (snapshot?.pet?.survival?.status && snapshot.pet.survival.status !== "alive") return false;
  return snapshot?.pet?.expedition?.status === "active" ? 30_000 : 60_000;
};

export const ROOM_GRID_PERCENT = 2;

export const ROOM_REACTIONS = {
  "bed-basic": "О, тут можна солодко подрімати!",
  "bowl-amber": "Ця миска точно для мене.",
  "toy-wand": "Полюємо на пір'їнку?",
  "wall-neon": "Лапки світяться!",
  "rug-cyan": "М'якенько під лапами.",
  "collar-violet": "Мені пасує фіолетовий?",
  "plant-moon": "Цікаво, воно ворушиться?",
  "fort-cardboard": "Фортецю прийнято!",
  "camera-retro": "Час для нового фото.",
  "pillow-starlight": "Це моє нове улюблене місце!",
};

export const derivePetPose = (pet, nowMs = Date.now()) => {
  if (pet?.survival?.status && pet.survival.status !== "alive") return "away";
  if (pet?.expedition?.status === "active") return "away";
  const narrativeAt = new Date(pet?.daily?.narrative_reaction_at || "").getTime();
  const narrativeAge = nowMs - narrativeAt;
  if (Number.isFinite(narrativeAt) && narrativeAge >= 0 && narrativeAge <= 12_000) {
    return ["sit", "sleep", "eat", "play"].includes(pet?.daily?.narrative_pose)
      ? pet.daily.narrative_pose
      : "sit";
  }
  const actedAt = new Date(pet?.daily?.last_action_at || "").getTime();
  const age = nowMs - actedAt;
  if (Number.isFinite(actedAt) && age >= 0 && age <= 12_000) {
    return ACTION_POSES[pet?.daily?.last_action] || "sit";
  }
  return Number(pet?.stats?.energy) < 35 ? "sleep" : "sit";
};

const finiteNumber = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const readBound = (bounds, axis, edge, fallback) => {
  const canonical = bounds?.[`${edge}_${axis}`];
  if (Number.isFinite(Number(canonical))) return Number(canonical);
  const snakeCase = bounds?.[`${axis}_${edge}`];
  if (Number.isFinite(Number(snakeCase))) return Number(snakeCase);
  const pair = bounds?.[axis];
  const pairIndex = edge === "min" ? 0 : 1;
  if (Array.isArray(pair) && Number.isFinite(Number(pair[pairIndex]))) return Number(pair[pairIndex]);
  return fallback;
};

export const roomMoveBounds = (room = {}) => {
  const bounds = room.move_bounds || room.bounds || {};
  const halfWidth = Math.max(0, finiteNumber(room.width, 0) / 2);
  const xMin = Math.max(0, readBound(bounds, "x", "min", Math.max(4, halfWidth)));
  const xMax = Math.min(100, readBound(bounds, "x", "max", Math.min(96, 100 - halfWidth)));
  const yMin = Math.max(0, readBound(bounds, "y", "min", 8));
  const yMax = Math.min(100, readBound(bounds, "y", "max", 86));
  return {
    xMin: Math.min(xMin, xMax),
    xMax: Math.max(xMin, xMax),
    yMin: Math.min(yMin, yMax),
    yMax: Math.max(yMin, yMax),
  };
};

export const snapRoomPlacement = (room = {}, nextX, nextY, grid = ROOM_GRID_PERCENT) => {
  const { xMin, xMax, yMin, yMax } = roomMoveBounds(room);
  const safeGrid = Math.max(0.1, finiteNumber(grid, ROOM_GRID_PERCENT));
  const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
  const snap = (value) => Math.round(value / safeGrid) * safeGrid;
  const normalize = (value, fallback, minimum, maximum) => {
    const clamped = clamp(finiteNumber(value, fallback), minimum, maximum);
    return Number(clamp(snap(clamped), minimum, maximum).toFixed(1));
  };
  return {
    x: normalize(nextX, finiteNumber(room.x, 50), xMin, xMax),
    y: normalize(nextY, finiteNumber(room.y, 50), yMin, yMax),
  };
};

export const mergeRoomPlacement = (item, roomLayout) => {
  if (!item?.room) return item;
  const placement = roomLayout?.[item.id];
  if (!placement || typeof placement.x !== "number" || typeof placement.y !== "number" || !Number.isFinite(placement.x) || !Number.isFinite(placement.y)) return item;
  return {
    ...item,
    room: {
      ...item.room,
      x: placement.x,
      y: placement.y,
    },
  };
};

export const getRoomLayers = (snapshot, layoutOverride) => {
  const items = snapshot?.catalog?.items || [];
  const inventory = snapshot?.pet?.inventory || {};
  const equipped = inventory.equipped || {};
  const owned = new Set(inventory.items || []);
  const roomLayout = layoutOverride || snapshot?.pet?.room_layout || {};
  return items
    .filter((item) => {
      if (!owned.has(item?.id) || !item?.room?.asset || item.slot === "collar") return false;
      const roomSlot = item.room.slot || item.slot;
      return roomSlot !== "expedition" && equipped[roomSlot] === item.id;
    })
    .map((item) => mergeRoomPlacement(item, roomLayout))
    .sort((first, second) => (first.room.z_index || 0) - (second.room.z_index || 0));
};

export const groundLayerIndex = (y) => Math.round(30 + (y - 55) * .8);

export const roomLayerStyle = (room, rotation = 0) => ({
  left: `${room.x}%`,
  top: `${room.y}%`,
  width: `${room.width}%`,
  zIndex: room.z_index || 1,
  transform: `translate(-50%, ${room.anchor === "bottom" ? "-100%" : "-50%"}) rotate(${rotation}deg)`,
});

export const getKyivLight = (value = Date.now()) => {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: "Europe/Kyiv" }).format(value));
  return hour >= 19 || hour < 7 ? "evening" : "day";
};
