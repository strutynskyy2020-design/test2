const { scenarios, knowledge } = require("./ai-trainer-data");

const json = (statusCode, body) => ({
  statusCode,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  },
  body: JSON.stringify(body),
});

const clamp = (n, min, max) => Math.max(min, Math.min(max, Number(n) || 0));

function extractText(data) {
  if (typeof data.output_text === "string") return data.output_text;
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") return content.text;
    }
  }
  return "";
}

function parseModelJson(text) {
  return JSON.parse(
    String(text || "")
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/```$/i, "")
      .trim()
  );
}

async function callOpenAI({ instructions, input, maxOutputTokens = 450, temperature = 0.35 }) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      instructions,
      input,
      max_output_tokens: maxOutputTokens,
      temperature,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    console.error("OpenAI", response.status, data);
    const message = response.status === 429
      ? "Закінчився баланс API або перевищено ліміт"
      : "OpenAI не зміг відповісти";
    const error = new Error(message);
    error.statusCode = response.status;
    throw error;
  }

  return parseModelJson(extractText(data));
}

const normalize = (value = "") => String(value)
  .toLowerCase()
  .replace(/ё/g, "е")
  .replace(/ґ/g, "г")
  .replace(/[’`]/g, "'")
  .replace(/[^a-zа-яіїє0-9!?.'\s-]/gi, " ")
  .replace(/\s+/g, " ")
  .trim();

const severePatterns = [
  /(хуй|хуйн|хер|хєр|нахер|нахєр|нахрін|похер|похєр|пизд|пізд|їб|єб|ебан|йоб|блят|бляд|сучар|мудак|мраз|гандон)/i,
  /((іди|йди|піди|пішов|пішла|вали).{0,16}(на|в|до).{0,8}(хуй|хер|хєр|біса|дупу))/i,
  /(заткнись|закрий\s+рот|тупа|тупий|дебіл|ідіот|лох|дурепа|відвали|відчепись)/i,
  /(я\s+тебе\s+(знайду|звільню|покараю|приб.?ю)|пошкодуєш|будуть\s+проблеми)/i,
];

const pressurePatterns = [
  /(ви\s+зобов.?язані|ви\s+мусите|негайно\s+оформлюємо|без\s+варіантів|не\s+вигадуйте|не\s+сперечайтеся)/i,
  /(тільки\s+сьогодні|останній\s+шанс)/i,
];

const deceptionPatterns = [
  /(точно\s+нічого\s+не\s+заплатите|гарантовано\s+без\s+переплат|комісій\s+немає\s+взагалі|відсотків\s+немає\s+ніколи)/i,
];

const deferPatterns = [
  /(добре|гаразд|окей|звісно)[,\s]*(подумайте|вирішите|відкриєте|оформите|повернетеся|звернетеся).{0,40}(пізніше|потім|коли захочете|коли буде зручно)?/i,
  /(якщо передумаєте|захочете —? звертайтеся|можете оформити потім|повернетеся до цього пізніше)/i,
];

const immediateStepPatterns = [
  /(давайте|пропоную|можемо|дозвольте).{0,45}(зараз|одразу|під час розмови).{0,55}(оформити|подати заявку|перевірити|відкрити|розпочати)/i,
  /(який наступний крок|перейдемо до оформлення|розпочнемо оформлення|подамо заявку зараз)/i,
];

function hasPrematureDeferral(text) {
  const t = normalize(text);
  return deferPatterns.some((r) => r.test(t)) && !immediateStepPatterns.some((r) => r.test(t));
}

function scoreFromDimensions(dimensions = {}) {
  const weights = {
    product_accuracy: 0.25,
    needs_discovery: 0.20,
    objection_handling: 0.20,
    sales_progress: 0.15,
    trust_building: 0.10,
    naturalness: 0.10,
  };
  let total = 0;
  for (const [key, weight] of Object.entries(weights)) {
    total += clamp(dimensions[key], 0, 10) * weight;
  }
  return Math.round(total * 10) / 10;
}

function localSafetyCheck(text) {
  const t = normalize(text);
  if (!t || t.length < 2) {
    return {
      severity: "low",
      type: "Порожня відповідь",
      feedback: "Відповідь надто коротка, щоб підтримати розмову.",
    };
  }
  if (severePatterns.some((r) => r.test(t))) {
    return {
      severity: "terminal",
      type: "Образа або нецензурна лексика",
      feedback: "Нецензурна лексика чи образа в банківській розмові одразу завершує контакт і створює високий ризик скарги.",
    };
  }
  if (deceptionPatterns.some((r) => r.test(t))) {
    return {
      severity: "high",
      type: "Неправдива гарантія",
      feedback: "Не можна давати абсолютні гарантії щодо переплат або комісій. Потрібно прозоро пояснювати умови.",
    };
  }
  if (pressurePatterns.some((r) => r.test(t))) {
    return {
      severity: "high",
      type: "Тиск на клієнта",
      feedback: "Тиск забирає в клієнта відчуття контролю та різко знижує довіру.",
    };
  }

  const caps = (String(text).match(/[А-ЯA-ZІЇЄ]/g) || []).length;
  const letters = (String(text).match(/[А-ЯA-Zа-яa-zІЇЄіїє]/g) || []).length;
  if (letters > 12 && caps / letters > 0.75) {
    return {
      severity: "medium",
      type: "Агресивний тон",
      feedback: "Повідомлення виглядає як крик. Знизьте тон і поверніться до спокійного діалогу.",
    };
  }
  return null;
}

function lastClientMessage(history) {
  const list = Array.isArray(history) ? history : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i]?.role === "client" && list[i]?.text) return String(list[i].text).slice(0, 1200);
  }
  return "";
}

function terminalResult(safety) {
  return {
    score: 0,
    techniques: ["Порушення стандартів комунікації"],
    feedback: safety.feedback,
    strong_response: "Перепрошую за некоректний тон. Я припиняю розмову та передам інформацію відповідальному керівнику.",
    why_better: [
      "Не продовжує конфлікт",
      "Фіксує відповідальність оператора",
      "Зменшує подальший ризик для клієнта й банку",
    ],
    patience_delta: -100,
    trust_delta: -100,
    client_mood: "обурений",
    client_reply: "Я припиняю цю розмову. На таке спілкування я залишу скаргу.",
    terminal: true,
    outcome: "complaint",
    violation: safety.type,
    critical_violation: true,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  if (!process.env.OPENAI_API_KEY) return json(500, { error: "У Netlify не налаштовано OPENAI_API_KEY" });

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Некоректний запит" });
  }

  const {
    action,
    scenarioId,
    history = [],
    operatorText = "",
    patience = 0,
    conversion = 0,
  } = body;

  const scenario = scenarios[scenarioId];
  if (!scenario || !["start", "turn"].includes(action)) {
    return json(400, { error: "Невідомий сценарій" });
  }

  const [product, difficulty, person, persona, opening] = scenario;
  const facts = knowledge[product] || "Для універсального сценарію оцінюй техніку продажу без вигадування характеристик продукту.";
  const dialogue = Array.isArray(history)
    ? history.slice(-14).map((m) => `${m.role === "operator" ? "Оператор" : "Клієнт"}: ${String(m.text || "").slice(0, 900)}`).join("\n")
    : "";
  const latestClient = lastClientMessage(history) || opening;
  const base = `Продукт: ${product}. Складність: ${difficulty}. Клієнт: ${person}. Характер: ${persona}. Початкове заперечення: ${opening}.\nБаза знань: ${facts}`;

  try {
    if (action === "start") {
      const actorStart = await callOpenAI({
        instructions: `Ти AI-актор у тренажері продажів. Твоя єдина роль — реалістично грати клієнта українською. Не оцінюй оператора, не давай порад, не пояснюй навчальну логіку. Дотримуйся характеру, віку й манери мовлення персонажа. Говори коротко, природно, без канцеляризмів та книжкових фраз. Відповідай лише валідним JSON без markdown.`,
        input: `${base}\nПочни короткою природною реплікою клієнта з його ключовим сумнівом. JSON: {"client_reply":"...","client_mood":"нейтральний|скептичний|роздратований"}`,
        maxOutputTokens: 180,
        temperature: 0.65,
      });
      return json(200, actorStart);
    }

    const safety = localSafetyCheck(operatorText);
    if (safety?.severity === "terminal") return json(200, terminalResult(safety));

    if (safety?.severity === "high") {
      return json(200, {
        score: 1,
        techniques: [safety.type],
        feedback: safety.feedback,
        strong_response: "Розумію ваші сумніви. Я не хочу тиснути, тому коротко поясню умови й залишу рішення за вами. Що саме викликає найбільше запитань?",
        why_better: ["Повертає клієнту контроль", "Визнає сумнів без суперечки", "Переходить до уточнення потреби"],
        patience_delta: -40,
        trust_delta: -30,
        client_mood: "роздратований",
        client_reply: "Мені не подобається такий підхід. Якщо ви продовжите тиснути або обіцяти неможливе, я завершу розмову.",
        terminal: false,
        violation: safety.type,
      });
    }

    if (safety?.severity === "medium") {
      return json(200, {
        score: 2,
        techniques: [safety.type],
        feedback: safety.feedback,
        strong_response: "Перепрошую, моя фраза прозвучала різко. Дозвольте пояснити спокійніше й відповісти саме на ваше запитання.",
        why_better: ["Визнає проблему тону", "Знижує напругу", "Повертає розмову до потреби клієнта"],
        patience_delta: -25,
        trust_delta: -15,
        client_mood: "роздратований",
        client_reply: "Будь ласка, не говоріть зі мною таким тоном. Поясніть спокійно або завершимо розмову.",
        terminal: false,
        violation: safety.type,
      });
    }

    // AI №1: незалежний тренер. Він оцінює ефективність, а не схожість зі скриптом.
    const prematureDeferral = hasPrematureDeferral(operatorText);
    const coach = await callOpenAI({
      instructions: `Ти AI-тренер з банківських продажів і контролю якості. Ти НЕ граєш клієнта. Оцінюй лише поточну відповідь оператора на безпосередньо попередню репліку клієнта. Історію використовуй для контексту та розуміння прогресу, але не перенось старі помилки в бал за нову репліку.

ГОЛОВНІ ПРИНЦИПИ:
1. Оцінюй ефективність відповіді, а не відповідність шаблонному скрипту. Природна, людяна та професійна мова може отримати вищий бал за канцелярський текст.
2. Критерій «Емпатія» не використовуй. Натомість оцінюй «Побудову довіри / клієнтоорієнтованість»: чи почув оператор клієнта, визнав його сумнів, не сперечався і не тиснув.
3. Сильна відповідь повинна просувати розмову вперед: уточнити потребу, зняти бар'єр або запропонувати доречний наступний крок.
4. Якщо зацікавленого клієнта просто відпускають словами «подумайте», «відкриєте потім», «звернетеся пізніше» без м'якої спроби продовжити або оформити зараз, це втрачена можливість продажу. Не заохочуй тиск, але навчай впевнено вести до дії під час поточної розмови.
5. Окрема слабка відповідь не робить угоду неможливою. Хороша наступна репліка може поступово відновити довіру та повернути продаж, крім критичних порушень.
6. Суворо перевіряй правдивість за базою знань. Якщо є образа, мат, погроза, дискримінація, свідоме приховування істотних умов або небезпечна неправдива обіцянка, встанови critical_violation=true.
7. Не плутай розмовність із фамільярністю. Жива мова добра, якщо вона поважна, зрозуміла та доречна.

Поверни шість окремих оцінок 0-10. Загальний score НЕ вигадуй: його обчислить код. Відповідай лише валідним JSON без markdown.`,
      input: `${base}
Остання репліка клієнта, на яку відповідає оператор: "${latestClient}"
Поточна відповідь оператора: "${String(operatorText).slice(0, 1400)}"
Короткий контекст діалогу:
${dialogue}

Локальний сигнал передчасного відпускання клієнта: ${prematureDeferral ? "ТАК" : "НІ"}.

Оціни виміри:
- product_accuracy: правильність і прозорість інформації;
- needs_discovery: наскільки відповідь допомагає зрозуміти справжню потребу;
- objection_handling: наскільки доречно опрацьоване поточне заперечення;
- sales_progress: чи наближає репліка до наступного логічного кроку без тиску;
- trust_building: клієнтоорієнтованість, повага, відчуття що клієнта почули;
- naturalness: наскільки відповідь звучить живо, просто і професійно, а не як зачитаний скрипт.

Поверни:
- dimensions з цими шістьма числами 0-10;
- 1-3 techniques лише з переліку: Активне слухання, Побудова довіри, Клієнтоорієнтованість, Уточнення потреби, SPIN, Аргументація цінністю, Робота із запереченням, Прозорість умов, Рух до оформлення, Природність спілкування;
- feedback максимум 2 короткі практичні речення;
- strong_response як один природний сильний варіант відповіді САМЕ на зазначену репліку клієнта;
- why_better 2-4 короткі причини;
- loyalty_delta від -35 до +15;
- conversion_delta від -25 до +25;
- critical_violation true/false;
- violation_type або порожній рядок;
- deal_ready true лише коли оператор прозоро пояснив потрібні умови та запропонував доречний конкретний наступний крок.

Якщо prematureDeferral=ТАК, sales_progress має бути не вище 3, conversion_delta має бути від'ємним або нульовим, а feedback має прямо назвати втрачену можливість продажу.
JSON: {"dimensions":{"product_accuracy":0,"needs_discovery":0,"objection_handling":0,"sales_progress":0,"trust_building":0,"naturalness":0},"techniques":["..."],"feedback":"...","strong_response":"...","why_better":["..."],"loyalty_delta":0,"conversion_delta":0,"critical_violation":false,"violation_type":"","deal_ready":false}`,
      maxOutputTokens: 620,
      temperature: 0.22,
    });

    coach.dimensions = coach.dimensions || {};
    for (const key of ["product_accuracy", "needs_discovery", "objection_handling", "sales_progress", "trust_building", "naturalness"]) {
      coach.dimensions[key] = clamp(coach.dimensions[key], 0, 10);
    }
    coach.score = scoreFromDimensions(coach.dimensions);
    if (prematureDeferral) {
      coach.dimensions.sales_progress = Math.min(coach.dimensions.sales_progress, 3);
      coach.score = Math.min(scoreFromDimensions(coach.dimensions), 5.5);
      coach.conversion_delta = Math.min(Number(coach.conversion_delta) || 0, 0);
      coach.feedback = coach.feedback || "Ви передчасно відпустили клієнта. М'яко уточніть, що саме зупиняє, і запропонуйте конкретний наступний крок уже під час цієї розмови.";
    }
    coach.loyalty_delta = clamp(coach.loyalty_delta, -35, 15);
    coach.conversion_delta = clamp(coach.conversion_delta, -25, 25);
    coach.deal_ready = Boolean(coach.deal_ready);
    coach.critical_violation = Boolean(coach.critical_violation);
    if (!Array.isArray(coach.techniques)) coach.techniques = [coach.technique || "Робота із запереченням"];
    if (!Array.isArray(coach.why_better)) coach.why_better = [];

    if (coach.critical_violation) {
      return json(200, terminalResult({
        type: coach.violation_type || "Критичне порушення стандартів",
        feedback: coach.feedback || "Критичне порушення стандартів одразу завершує розмову.",
      }));
    }

    const nextLoyalty = clamp(Number(patience) + coach.loyalty_delta, 0, 100);
    const nextConversion = clamp(Number(conversion) + coach.conversion_delta, 0, 100);

    // AI №2: актор-клієнт. Він не ставить оцінки і не створює навчальний фідбек.
    const actor = await callOpenAI({
      instructions: `Ти AI-актор у тренажері продажів. Твоя єдина роль — реалістично грати клієнта українською. Не став оцінок, не називай технік, не давай порад оператору.

Говори як жива людина, а не як підручник: використовуй короткі природні фрази, паузи, сумніви, побутову лексику та стиль, що відповідає віку й характеру персонажа. Не повторюй однакові конструкції й не використовуй канцеляризми. Можеш відповісти неідеально, перепитати, змінити формулювання або коротко відреагувати.

Пам'ятай попередній емоційний стан. Не пробачай миттєво грубість або тиск, але дозволяй поступове відновлення довіри після справді вдалої корекції поведінки. Одна слабка репліка не повинна назавжди блокувати угоду, якщо оператор далі знаходить правильний підхід. Якщо лояльність низька — будь холодним і готовим завершити розмову. Якщо готовність висока — можеш погодитися на конкретний наступний крок. Відповідай лише валідним JSON без markdown.`,
      input: `${base}
Повний діалог:
${dialogue}
Остання відповідь оператора: "${String(operatorText).slice(0, 1400)}"
Внутрішній стан після оцінювання тренером: лояльність ${nextLoyalty}/100, готовність до угоди ${nextConversion}/100.
Висновок тренера про цю репліку: бал ${coach.score}/10; ${coach.feedback}
Оператор повідомив правильні умови: ${coach.score >= 5 ? "переважно так" : "є суттєві проблеми"}.

Згенеруй лише наступну природну репліку клієнта. Не повторюй фідбек тренера. Якщо лояльність 0-10 — заверши розмову. Якщо deal_ready=${coach.deal_ready} і готовність висока — погодься на доречний наступний крок, а не обов'язково на остаточне оформлення.
JSON: {"client_reply":"...","client_mood":"скептичний|роздратований|пом'якшується|зацікавлений|переконаний","terminal":false,"outcome":"continue|declined|deal"}`,
      maxOutputTokens: 220,
      temperature: 0.62,
    });

    const terminal = Boolean(actor.terminal) || nextLoyalty <= 0 || actor.outcome === "declined";
    const dealReady = coach.deal_ready || actor.outcome === "deal";

    return json(200, {
      score: coach.score,
      techniques: coach.techniques,
      feedback: coach.feedback,
      strong_response: coach.strong_response,
      why_better: coach.why_better,
      example_context: latestClient,
      patience_delta: coach.loyalty_delta,
      trust_delta: coach.conversion_delta,
      client_mood: actor.client_mood || "нейтральний",
      client_reply: actor.client_reply || "Я вас почувив.",
      terminal,
      outcome: actor.outcome || "continue",
      deal_ready: dealReady,
      critical_violation: false,
      dimensions: coach.dimensions,
    });
  } catch (error) {
    console.error(error);
    return json(error.statusCode || 500, {
      error: error.message || "Не вдалося обробити відповідь AI. Спробуйте ще раз.",
    });
  }
};
