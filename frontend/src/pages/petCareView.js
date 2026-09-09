// Server hints are advisory; every action is still validated by the API.
export function careHint(snapshot, action, now = Date.now(), option, zone = "head") {
  const { stats = {}, survival = {} } = snapshot.pet;
  const sleeping = snapshot.life?.sleep?.active;
  if (sleeping && action !== "rest" && !(action === "feed" && stats.satiety < 20)) return { blocked: true, text: "Я сплю. Розбуди мене лампою, коли відпочину." };
  if (action === "feed" && stats.satiety > 92) return { blocked: true, text: "Я вже наївся. Перекусимо пізніше." };
  if (action === "feed" && survival.mood_state === "picky" && option === survival.recent_foods?.at(-1)) return { blocked: true, text: "Спробуй інший смак — цей уже набрид." };
  if (action === "clean" && stats.cleanliness > 92 && !snapshot.life?.scene_marks?.some((mark) => mark.kind === "mess")) return { blocked: true, text: "У кімнаті вже чисто ✨" };
  if (action === "play" && (stats.energy < 25 || stats.health < 35 || survival.illness)) return { blocked: true, text: "Спершу відпочинок і турбота, тоді пограємося." };
  if (action === "play" && survival.mood_state === "bored" && option === survival.recent_toys?.at(-1)) return { blocked: true, text: "Обери іншу іграшку — хочеться чогось нового." };
  if (action === "pet" && (survival.mood_state === "do_not_touch" || stats.mood < 25 || survival.illness || Date.parse(survival.touch_cooldown_until) > now)) return { blocked: true, text: "Поки не гладь мене. Мені потрібен спокій." };
  if (action === "pet" && zone === "belly" && (snapshot.pet.trust < 10 || stats.mood < 60)) return { blocked: true, text: "Животик поки не чіпай. Краще погладь голівку." };
  const availability = snapshot.care_availability?.[action];
  if (availability?.limited_today) return { limited: true, text: "Можемо побути разом. Відновлення потреб — знову завтра." };
  const minutes = Math.ceil((Date.parse(availability?.ready_at) - now) / 60000);
  if (minutes > 0) return { waiting: true, text: `Коротка пауза: ще ${minutes} хв до відновлення потреб.` };
  return { text: "" };
}

export function sleepHint(snapshot, now) {
  const sleep = snapshot.life?.sleep;
  if (!sleep?.active) return "Проведи пальцем по голівці";
  const left = Math.max(0, Math.ceil((Date.parse(sleep.ends_at) - now) / 60000));
  if (!left) return "Сон завершується… оновлюємо стан";
  if (now - Date.parse(sleep.started_at) < 900000 && snapshot.pet.stats.energy < 80) return "Щойно заснув. Не буди зарано — засмутиться.";
  return `Відпочиває · ще ${left >= 60 ? `${Math.floor(left / 60)} год ` : ""}${left % 60} хв`;
}
