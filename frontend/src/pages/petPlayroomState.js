export const PLAY_FOOD = [
  { id: "balanced", label: "Корм", symbol: "🥣" },
  { id: "fish", label: "Рибка", symbol: "🐟" },
  { id: "crunchy", label: "Хрумкий корм", symbol: "🍘" },
];
export const PLAY_TOYS = [
  { id: "wand", label: "Пір’їнка", symbol: "🪶" },
  { id: "ball", label: "М’ячик", symbol: "🧶" },
];
export const makePlayRequestId = () => globalThis.crypto?.randomUUID?.() || `play-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const playContext = (snapshot) => ({ date_key: snapshot.date_key, generation: snapshot.pet.survival?.generation || 1 });
export const petItemAsset = (id) => `/pet/room/v3/items/${id === "default" ? "sponge" : id}.webp`;
export function interactionRequest(snapshot, action, option, context = playContext(snapshot), zone = "head") {
  const repeated = [...(snapshot.pet.daily?.care_actions || []), ...(snapshot.pet.daily?.rejected_actions || [])].includes(action);
  if (action === "rest" && repeated) return { url: "/pet/sleep", body: { action: "start", ...context, request_id: makePlayRequestId() } };
  const touch = action === "pet" && zone !== "head" ? { zone } : {};
  return repeated
    ? { url: "/pet/interact", body: { action, option, ...context, ...touch, request_id: makePlayRequestId() } }
    : { url: "/pet/care", body: { action, option, ...context, ...touch }, idempotent: true };
}
export function interactionFeedback(result, action) {
  if (action === "clean" && result.pet?.stats?.cleanliness <= 92 && result.interaction?.replenished !== false && result.accepted !== false) return { reaction: "clean", accepted: true, message: "Стало чистіше! Трохи бруду ще залишилося." };
  if (result.interaction) return result.interaction;
  const rejected = result.rejected || result.accepted === false || Number(result.trust_gained) < 0;
  if (rejected) return { reaction: "refuse", message: "Побудь поруч, але поки не гладь мене.", accepted: false };
  if (result.reaction === "picky") return { reaction: "sniff", message: "Знову те саме… Може, іншу їжу?", accepted: true };
  if (result.reaction === "bored") return { reaction: "refuse", message: "Ця іграшка вже набридла.", accepted: true };
  if (result.reaction === "exhausted") return { reaction: "tired", message: "Я втомився…", accepted: true };
  const reactions = { feed: "eat", pet: "purr", play: "pounce", clean: "clean", rest: "sleep" };
  if (action === "pet" && result.zone === "back") return { reaction: "purr", message: "О-о, почухай спинку ще!", accepted: true, zone: "back" };
  if (action === "pet" && result.zone === "belly") return { reaction: "purr", message: "Тобі навіть животик довіряю.", accepted: true, zone: "belly" };
  return { reaction: reactions[action], accepted: true, message: result.life_note || ({ feed: "Ням!", pet: "Мур-р-р…", play: "Лови мене!", clean: "Тепер чистенько!", rest: "Тихенько… я відпочиваю." }[action]) };
}
export function petThought(snapshot, sleeping) {
  const { stats = {}, survival = {} } = snapshot.pet;
  if (survival.illness || stats.health < 35) return { symbol: "💊", text: "Мені недобре…", action: "health" };
  if (stats.satiety < 35) return { symbol: "🐟", text: "Животик бурчить…", action: "feed" };
  if (stats.cleanliness < 45) return { symbol: "🫧", text: "Час умиватися!", action: "clean" };
  if (sleeping || stats.energy < 30) return { symbol: "💤", text: "Трохи посплю…", action: "rest" };
  if (survival.mood_state === "do_not_touch" || stats.mood < 25) return { symbol: "🐾", text: "Просто побудь поруч", action: "rest" };
  if (stats.mood < 60) return { symbol: "🪶", text: "Пограємося?", action: "play" };
  return { symbol: "💛", text: "Погладь мене", action: "pet" };
}
export const insideRect = (point, rect, padding = 0) => Boolean(rect && point.x >= rect.left - padding && point.x <= rect.right + padding && point.y >= rect.top - padding && point.y <= rect.bottom + padding);
export function gestureCompleted(gesture, point, catRect, sceneRect) {
  if (!gesture || gesture.cancelled) return false;
  if (gesture.action === "feed") return gesture.distance > 12 && insideRect(point, catRect, 12);
  if (gesture.action === "play") return gesture.distance >= 100 && insideRect(point, sceneRect);
  return gesture.contactDistance >= (gesture.action === "clean" ? 140 : 60);
}
