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
        instructions: `Ти AI-актор у тренажері продажів. Твоя єдина роль — реалістично грати клієнта українською. Не оцінюй оператора, не давай порад, не пояснюй навчальну логіку. Дотримуйся характеру персонажа. Відповідай лише валідним JSON без markdown.`,
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

    // AI №1: незалежний тренер. Він оцінює лише поточну відповідь на останню репліку клієнта.
    const coach = await callOpenAI({
      instructions: `Ти AI-тренер з банківських продажів і контролю якості. Ти НЕ граєш клієнта. Оцінюй лише поточну відповідь оператора на безпосередньо попередню репліку клієнта. Історію використовуй лише для контексту, але не перенось старі помилки у бал за нову репліку. Суворо перевіряй правдивість за базою знань. Якщо є образа, мат, погроза, дискримінація, свідоме приховування істотних умов або небезпечна неправдива обіцянка, встанови critical_violation=true. Відповідай лише валідним JSON без markdown.`,
      input: `${base}
Остання репліка клієнта, на яку відповідає оператор: "${latestClient}"
Поточна відповідь оператора: "${String(operatorText).slice(0, 1400)}"
Короткий контекст діалогу:
${dialogue}

Поверни:
- score 0-10;
- 1-3 техніки лише з переліку: Активне слухання, Емпатія, Уточнення потреби, SPIN, Аргументація цінністю, Робота із запереченням, Прозорість умов, Закриття угоди;
- feedback максимум 2 короткі практичні речення;
- strong_response як один природний сильний варіант відповіді САМЕ на зазначену репліку клієнта;
- why_better 2-4 короткі причини;
- loyalty_delta від -35 до +15;
- conversion_delta від -25 до +25;
- critical_violation true/false;
- violation_type або порожній рядок;
- deal_ready true лише коли оператор коректно підсумував потребу, прозоро пояснив умови та запропонував доречний наступний крок.

Орієнтир: 9-10 дає +10..+15 лояльності і +18..+25 готовності; 7-8 дає +4..+9 і +12..+18; 5-6 дає -3..+3 і +3..+10; 3-4 дає -10..-4 і -8..+2; 0-2 дає -35..-15 і -25..-10.
JSON: {"score":0,"techniques":["..."],"feedback":"...","strong_response":"...","why_better":["..."],"loyalty_delta":0,"conversion_delta":0,"critical_violation":false,"violation_type":"","deal_ready":false}`,
      maxOutputTokens: 520,
      temperature: 0.25,
    });

    coach.score = clamp(coach.score, 0, 10);
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
      instructions: `Ти AI-актор у тренажері продажів. Твоя єдина роль — реалістично грати клієнта українською. Не став оцінок, не називай технік, не давай порад оператору. Пам'ятай попередній емоційний стан. Не пробачай миттєво грубість або тиск. Якщо лояльність низька — будь холодним і готовим завершити розмову. Якщо готовність висока — можеш погодитися на конкретний наступний крок. Відповідай лише валідним JSON без markdown.`,
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
    });
  } catch (error) {
    console.error(error);
    return json(error.statusCode || 500, {
      error: error.message || "Не вдалося обробити відповідь AI. Спробуйте ще раз.",
    });
  }
};
