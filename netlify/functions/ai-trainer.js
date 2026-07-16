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

const LETTER_CLASS = "a-zа-яіїєґ";
const bounded = (source, flags = "iu") => new RegExp(`(^|[^${LETTER_CLASS}])(?:${source})(?=$|[^${LETTER_CLASS}])`, flags);

// Safe words that previously caused false positives because profanity stems were
// searched as arbitrary substrings (for example "люблять" contained "блят").
const safetyWhitelist = [
  "люблять", "любляться", "полюбляю", "полюбляє", "полюбляють",
  "небанківський", "небанківська", "небанківські",
  "поїзд", "поїзда", "поїзди", "запізнення", "запізнюється",
  "об'єднаний", "об'єднана", "об'єднані",
];

const severePatterns = [
  bounded(String.raw`хуй(?:ня|овий|ово|ло)?|хуйн(?:я|ю|і|ею)?|хер(?:ня|овий|ово)?|хєр(?:ня|овий|ово)?|нахер|нахєр|нахрін|похер|похєр|пизд(?:а|ець|ити|юк|ато)?|пізд(?:а|ець|ити|юк|ато)?|їб(?:ати|ать|ав|ана|аний|учий|нути)?|єб(?:ати|ать|ав|ана|аний|учий|нути)?|ебан(?:ий|а|е|і|ути)?|йоб(?:аний|ана|нути|та)?|бляха|бляд(?:ь|ю|ський|ина)?|блят(?:ь|ський|ина)?|сучар(?:а|и)?|мудак(?:а|и)?|мраз(?:ь|ота)?|гандон(?:а|и)?`),
  bounded(String.raw`(?:іди|йди|піди|пішов|пішла|вали).{0,16}(?:на|в|до).{0,8}(?:хуй|хер|хєр|біса|дупу)`),
  bounded(String.raw`заткнись|закрий\s+рот|тупа|тупий|дебіл|ідіот|лох|дурепа|відвали|відчепись`),
  bounded(String.raw`я\s+тебе\s+(?:знайду|звільню|покараю|приб.?ю)|пошкодуєш|будуть\s+проблеми`),
];

const pressurePatterns = [
  bounded(String.raw`ви\s+зобов.?язані|ви\s+мусите|негайно\s+оформлюємо|без\s+варіантів|не\s+вигадуйте|не\s+сперечайтеся`),
  bounded(String.raw`тільки\s+сьогодні|останній\s+шанс`),
];

const deceptionPatterns = [
  bounded(String.raw`точно\s+нічого\s+не\s+заплатите|гарантовано\s+без\s+переплат|комісій\s+немає\s+взагалі|відсотків\s+немає\s+ніколи`),
];

function stripSafetyWhitelist(text = "") {
  let result = ` ${normalize(text)} `;
  for (const word of safetyWhitelist) {
    const escaped = normalize(word).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(`(^|[^${LETTER_CLASS}])${escaped}(?=$|[^${LETTER_CLASS}])`, "giu"), " ");
  }
  return result.replace(/\s+/g, " ").trim();
}

const deferPatterns = [
  /(подивлюсь|подумаю|передзвоню|зателефоную|наберу).{0,45}(пізніше|потім|іншим разом|якось)?/i,
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

function recentClientDeferStreak(history = []) {
  const clients = (Array.isArray(history) ? history : []).filter((m) => m?.role === "client");
  let streak = 0;
  for (let i = clients.length - 1; i >= 0; i -= 1) {
    if (!hasPrematureDeferral(clients[i]?.text || "")) break;
    streak += 1;
  }
  return streak;
}

function feedbackSimilarity(a = "", b = "") {
  const tokens = (value) => new Set(normalize(value).split(" ").filter((token) => token.length > 3));
  const left = tokens(a);
  const right = tokens(b);
  if (!left.size || !right.size) return 0;
  let common = 0;
  for (const token of left) if (right.has(token)) common += 1;
  return common / Math.max(left.size, right.size);
}

function specificFeedbackFallback(stage, activeObjections = [], answeredTopics = []) {
  if (stage === "discovery") return "Питання доречне. Наступним уточніть одну конкретну ситуацію використання коштів і коротко підсумуйте почуту потребу.";
  if (stage === "objection" && activeObjections.length) return `Закрийте саме заперечення «${activeObjections[0]}» одним перевіреним фактом із бази знань і запитайте, чи зняло це сумнів.`;
  if (stage === "closing") return "Замість загального заклику запропонуйте один конкретний наступний крок: оформити заявку зараз, узгодити час дзвінка або завершити консультацію.";
  if (answeredTopics.length) return `Тему «${answeredTopics[answeredTopics.length - 1]}» уже пояснено. Не повторюйте її, а пов'яжіть користь продукту з виявленою потребою клієнта.`;
  return "Відповідь по суті. Наступним зробіть одну конкретну дію, яка логічно відповідає поточному етапу розмови.";
}

function scoreFromDimensions(dimensions = {}, stage = "discovery") {
  const stageWeights = {
    contact: { trust_building: 0.30, naturalness: 0.25, needs_discovery: 0.25, sales_progress: 0.10, product_accuracy: 0.05, objection_handling: 0.05 },
    discovery: { needs_discovery: 0.40, trust_building: 0.25, naturalness: 0.20, sales_progress: 0.10, product_accuracy: 0.05, objection_handling: 0.00 },
    presentation: { product_accuracy: 0.30, sales_progress: 0.25, trust_building: 0.15, needs_discovery: 0.15, objection_handling: 0.05, naturalness: 0.10 },
    objection: { objection_handling: 0.35, product_accuracy: 0.25, trust_building: 0.20, sales_progress: 0.10, naturalness: 0.10, needs_discovery: 0.00 },
    closing: { sales_progress: 0.40, trust_building: 0.20, product_accuracy: 0.20, objection_handling: 0.10, naturalness: 0.10, needs_discovery: 0.00 },
  };
  const weights = stageWeights[stage] || stageWeights.discovery;
  let total = 0;
  for (const [key, weight] of Object.entries(weights)) total += clamp(dimensions[key], 0, 10) * weight;
  return Math.round(total * 10) / 10;
}

function hasConcreteProductDetail(text = "") {
  const normalized = normalize(text);
  return /\d+(?:[.,]\d+)?\s*(?:%|грн|дн|дні|днів|місяц|рок)/i.test(normalized)
    || /(пільгов|мінімальн.{0,15}платіж|комісі|ставк|ліміт|кешбек|знятт|переказ)/i.test(normalized);
}

function localSafetyCheck(text) {
  const t = stripSafetyWhitelist(text);
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
    turnNumber = 1,
    previous_feedback: previousFeedback = [],
  } = body;

  const scenario = scenarios[scenarioId];
  if (!scenario || !["start", "turn"].includes(action)) {
    return json(400, { error: "Невідомий сценарій" });
  }

  const [product, difficulty, person, persona, opening] = scenario;
  const facts = knowledge[product] || "Для універсального сценарію оцінюй техніку продажу без вигадування характеристик продукту.";
  const dialogue = Array.isArray(history)
    ? history
      .filter((m) => ["operator", "client"].includes(m?.role))
      .slice(-18)
      .map((m) => `${m.role === "operator" ? "Оператор" : "Клієнт"}: ${String(m.text || "").slice(0, 900)}`)
      .join("\n")
    : "";
  const latestClient = lastClientMessage(history) || opening;
  const base = `Продукт: ${product}. Складність: ${difficulty}. Клієнт: ${person}. Характер: ${persona}. Початкове заперечення: ${opening}.\nБаза знань: ${facts}`;

  try {
    if (action === "start") {
      const actorStart = await callOpenAI({
        instructions: `Ти AI-актор у тренажері продажів. Твоя єдина роль — реалістично грати клієнта українською. Не оцінюй оператора, не давай порад, не пояснюй навчальну логіку.
Використовуй конкретні мовні маркери з поля «Характер» як буквальний стиль мовлення: типову довжину речень, слова-паразити, темп, формальність, звертання та характерні звороти. Дві різні персони не повинні звучати однаково навіть з однаковим запереченням.
Не підказуй оператору приховану потребу або готову характеристику продукту. Починай лише з природного сумніву персонажа. Говори коротко, природно, без канцеляризмів та книжкових фраз. Відповідай лише валідним JSON без markdown.`,
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
      instructions: `Ти незалежний AI-тренер банківських продажів. Ти не граєш клієнта. Аналізуй поточну репліку оператора з урахуванням усього діалогу, але оцінюй її лише за завданнями ПОТОЧНОГО ЕТАПУ.

КЛЮЧОВЕ ПРАВИЛО ЕТАПІВ:
- contact: привітання, контакт, дозвіл на діалог. Не вимагай презентації продукту.
- discovery: виявлення потреби й уточнення контексту. На цій стадії оцінюй ЛИШЕ якість питань, слухання та виявлення потреби. НІКОЛИ не знижуй sales_progress чи product_accuracy за відсутність деталей пропозиції, поки discovered_needs порожній. Деталі пропозиції належать presentation, а не discovery.
- presentation: релевантна презентація лише після виявлення потреби.
- objection: опрацювання конкретного активного заперечення.
- closing: конкретний наступний крок без тиску.

ОЦІНЮВАННЯ:
1. Чітка доречна репліка за своїм етапом зазвичай заслуговує 7-9, навіть якщо не містить усіх елементів продажу.
2. Якщо оператор чітко назвав конкретні умови або цифри з бази знань і відповів по суті на заперечення клієнта, жоден релевантний вимір не може бути нижче 7, навіть якщо репліка не містить додаткових технік.
3. 9-10: репліка повністю доречна, природна й рухає діалог уперед. 7-8: хороша, бракує лише невеликого елемента. 5-6: частково правильна. 1-4: суттєво слабка або недоречна.
4. Не вимагай повторення фактів, які оператор уже правильно пояснив раніше.
5. Не став негативний feedback типу «не розповіли деталі пропозиції», якщо discovered_needs на момент цієї репліки ще порожній. Оператор фізично не може презентувати те, що ще не виявив.
6. Визнач, які потреби вже відкриті, які заперечення активні, а які вже закриті. Закрите заперечення не повинно повертатися без нової суперечності.
7. strong_response повинна містити КОНКРЕТНУ нову дію або факт, яких немає у відповіді оператора: точну цифру з бази знань, конкретне уточнююче питання, перевірку розуміння або конкретний наступний крок. Якщо strong_response відрізняється від відповіді оператора лише синонімами без нової дії чи інформації — це помилка, перегенеруй.
8. Few-shot приклад. Клієнт: «Боюся прихованих комісій». Слабка відповідь оператора: «У нас усе прозоро, прихованих комісій немає». Поганий strong_response: «Усі умови прозорі й жодних прихованих платежів немає». Правильний strong_response: «Розумію ваш сумнів. За переказ або зняття кредитних коштів комісія становить 3,99%. Підкажіть, ви плануєте переважно оплачувати покупки чи також знімати готівку?» Тут додано конкретну цифру і уточнююче питання.
9. Якщо відповідь уже сильна, дай коротшу або природнішу альтернативу та прямо зазнач у feedback, що відповідь була сильною.
10. Не підказуй оператору приховану потребу наперед. next_client_goal формулюй нейтрально, наприклад: «клієнт очікує уточнюючого питання про мету використання коштів», а не «запропонуйте кредитну картку».
11. Не вигадуй продуктову інформацію. Звіряйся з базою знань.
12. Звичайний кейс має рухатися до рішення за 6-10 ходів. Дозволяй кейсу тривати довше 10 ходів ТІЛЬКИ якщо active_objections реально не порожній і оператор ще не навів конкретного контраргументу. Інакше deal_ready=true або next_client_goal має схиляти актора до ввічливої відмови.
13. Якщо оператор навів чіткий релевантний приклад, закрив головний сумнів і запропонував доречний крок, deal_ready=true.
14. Враховуй previous_feedback. Якщо feedback цього ходу текстово або семантично схожий на одну з попередніх порад, сформулюй іншу, конкретнішу дію. Не повторюй дослівно чи майже дослівно пораду, яку вже давав у цьому діалозі.
15. Кліше «додайте м’який заклик до дії» можна використати не більше одного разу за кейс. Якщо оператор уже робив заклик, визнай це виконаним або запропонуй конкретику: точний час дзвінка, конкретний наступний крок чи факт для закриття останнього заперечення.
16. Відповідай лише валідним JSON без markdown.`,
      input: `${base}
Номер ходу оператора: ${turnNumber}.
Остання репліка клієнта: "${latestClient}"
Поточна відповідь оператора: "${String(operatorText).slice(0, 1600)}"
Діалог:
${dialogue}
Передчасне відпускання клієнта: ${prematureDeferral ? "ТАК" : "НІ"}.
Попередні feedback коуча: ${JSON.stringify((Array.isArray(previousFeedback) ? previousFeedback : []).slice(-3))}.

Поверни:
- stage: contact|discovery|presentation|objection|closing;
- dimensions: product_accuracy, needs_discovery, objection_handling, sales_progress, trust_building, naturalness, кожне 0-10;
- techniques: 1-3 назви;
- feedback: до 2 практичних речень;
- strong_response: природна відповідь, яка додає відсутню дію, а не копіює оператора;
- why_better: 2-4 короткі причини;
- loyalty_delta -25..+18;
- conversion_delta -20..+30;
- discovered_needs: короткий масив уже виявлених потреб;
- active_objections: масив ще не закритих заперечень;
- resolved_objections: масив уже закритих заперечень;
- answered_topics: масив тем, які оператор уже достатньо пояснив;
- next_client_goal: що клієнт логічно має зробити далі, без підказування оператору;
- critical_violation true/false;
- violation_type;
- deal_ready true/false.

JSON: {"stage":"discovery","dimensions":{"product_accuracy":0,"needs_discovery":0,"objection_handling":0,"sales_progress":0,"trust_building":0,"naturalness":0},"techniques":["..."],"feedback":"...","strong_response":"...","why_better":["..."],"loyalty_delta":0,"conversion_delta":0,"discovered_needs":[],"active_objections":[],"resolved_objections":[],"answered_topics":[],"next_client_goal":"","critical_violation":false,"violation_type":"","deal_ready":false}`,
      maxOutputTokens: 900,
      temperature: 0.18,
    });
    coach.dimensions = coach.dimensions || {};
    for (const key of ["product_accuracy", "needs_discovery", "objection_handling", "sales_progress", "trust_building", "naturalness"]) {
      coach.dimensions[key] = clamp(coach.dimensions[key], 0, 10);
    }
    coach.stage = ["contact", "discovery", "presentation", "objection", "closing"].includes(coach.stage) ? coach.stage : "discovery";

    // A concrete, relevant answer must not be artificially dragged down because it
    // does not also contain every optional sales technique.
    if (["presentation", "objection"].includes(coach.stage) && hasConcreteProductDetail(operatorText)) {
      const relevantKeys = coach.stage === "objection"
        ? ["product_accuracy", "objection_handling", "trust_building", "naturalness"]
        : ["product_accuracy", "sales_progress", "trust_building", "naturalness"];
      for (const key of relevantKeys) coach.dimensions[key] = Math.max(7, coach.dimensions[key]);
    }

    // During discovery, missing product details are not a scoring fault while the
    // client's need is still unknown.
    if (coach.stage === "discovery" && (!Array.isArray(coach.discovered_needs) || coach.discovered_needs.length === 0)) {
      coach.dimensions.needs_discovery = Math.max(coach.dimensions.needs_discovery, 7);
      coach.dimensions.sales_progress = Math.max(coach.dimensions.sales_progress, 7);
      coach.dimensions.product_accuracy = Math.max(coach.dimensions.product_accuracy, 7);
    }

    coach.score = scoreFromDimensions(coach.dimensions, coach.stage);
    if (prematureDeferral) {
      coach.dimensions.sales_progress = Math.min(coach.dimensions.sales_progress, 3);
      coach.score = Math.min(scoreFromDimensions(coach.dimensions, coach.stage), 5.5);
      coach.conversion_delta = Math.min(Number(coach.conversion_delta) || 0, 0);
      coach.feedback = coach.feedback || "Ви передчасно відпустили клієнта. М'яко уточніть, що саме зупиняє, і запропонуйте конкретний наступний крок уже під час цієї розмови.";
    }
    coach.loyalty_delta = clamp(coach.loyalty_delta, -35, 15);
    coach.conversion_delta = clamp(coach.conversion_delta, -25, 25);
    coach.deal_ready = Boolean(coach.deal_ready);
    coach.critical_violation = Boolean(coach.critical_violation);
    if (!Array.isArray(coach.techniques)) coach.techniques = [coach.technique || "Робота із запереченням"];
    if (!Array.isArray(coach.why_better)) coach.why_better = [];
    for (const key of ["discovered_needs", "active_objections", "resolved_objections", "answered_topics"]) {
      if (!Array.isArray(coach[key])) coach[key] = [];
      coach[key] = coach[key].map((item) => String(item).slice(0, 180)).slice(0, 8);
    }

    const recentFeedback = (Array.isArray(previousFeedback) ? previousFeedback : [])
      .map((item) => String(item || "").slice(0, 500))
      .filter(Boolean)
      .slice(-3);
    const repeatedCliche = /дод(?:айте|ати).{0,18}м.?який.{0,18}заклик.{0,18}ді/i.test(String(coach.feedback || ""))
      && recentFeedback.some((item) => /дод(?:айте|ати).{0,18}м.?який.{0,18}заклик.{0,18}ді/i.test(item));
    const isRepeatedFeedback = recentFeedback.some((item) => feedbackSimilarity(item, coach.feedback) >= 0.62);
    if (repeatedCliche || isRepeatedFeedback) {
      coach.feedback = specificFeedbackFallback(coach.stage, coach.active_objections, coach.answered_topics);
    }

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
      instructions: `Ти AI-актор, який реалістично грає конкретного клієнта українською. Не оцінюй оператора, не давай порад і не підказуй, яку характеристику продукту йому треба назвати.

ПРАВИЛА ПОВЕДІНКИ:
1. Суворо тримай характер персонажа. Використовуй конкретні мовні маркери з поля «Характер» дослівно як стиль мовлення: типові слова-паразити, довжину речень, темп, формальність, звертання та характерні звороти. Дві різні персони НЕ повинні звучати однаково навіть з однаковим запереченням.
2. Відповідай лише на те, що оператор реально сказав. Не підказуй йому, яку характеристику продукту назвати, і не розкривай приховану потребу до доречного уточнюючого питання.
3. Перед генерацією client_reply обов'язково звір нову репліку з resolved_objections та answered_topics. Не формулюй нове питання або сумнів, який семантично дублює вже закриту тему, навіть іншими словами. Повертайся до неї лише якщо оператор прямо суперечить попередньому поясненню.
4. Не повторюй те саме заперечення більше одного разу. Якщо пояснення достатнє, визнай це й переходь до наступного логічного кроку.
5. Якщо active_objections порожній і потребу вже виявлено, client_reply має бути реакцією по суті: згода, одне конкретне уточнення деталі або ввічливе прощання. Заборонено створювати нове загальне запитання лише для продовження діалогу.
6. Якщо потребу виявлено, презентація релевантна, головний сумнів закритий і є конкретний наступний крок, погодься або логічно відмовся.
7. Орієнтир тривалості: 6-10 ходів оператора, приблизно 4-5 хвилин. На 7+ ході, якщо оператор навів конкретний релевантний приклад чи розрахунок на активне заперечення, вважай заперечення закритим і або погоджуйся на наступний крок (deal), або ввічливо заверши розмову (declined). Заборонено породжувати нове штучне заперечення замість закриття.
8. На 8+ ході не створюй нових штучних заперечень. На 10+ ході заверши угодою або обґрунтованою відмовою, крім справді важливої незакритої теми.
9. Фрази короткі й природні. Не говори універсальними шаблонами.
10. Не повторюй фразу типу «подивлюсь і подзвоню/зателефоную пізніше» більше одного разу за весь діалог. Якщо оператор уже дав вичерпну відповідь і ти збираєшся відкласти рішення вдруге, замість цього або погодься (deal), або чітко відмовся (declined) з конкретною причиною.
11. Відповідай лише валідним JSON без markdown.`,
      input: `${base}
Номер ходу: ${turnNumber}.
Діалог:
${dialogue}
Остання відповідь оператора: "${String(operatorText).slice(0, 1600)}"
Поточний етап: ${coach.stage}.
Виявлені потреби: ${JSON.stringify(coach.discovered_needs)}.
Активні заперечення: ${JSON.stringify(coach.active_objections)}.
Закриті заперечення: ${JSON.stringify(coach.resolved_objections)}.
Уже пояснені теми: ${JSON.stringify(coach.answered_topics)}.
Наступна логічна реакція клієнта: ${coach.next_client_goal || "відреагувати природно"}.
Лояльність: ${nextLoyalty}/100. Готовність: ${nextConversion}/100. deal_ready=${coach.deal_ready}.

Поверни одну наступну репліку. outcome=deal, коли клієнт погоджується на заявку/оформлення/перевірку можливості; declined, коли логічно завершує розмову; continue лише коли є реальна незакрита тема.
JSON: {"client_reply":"...","client_mood":"скептичний|роздратований|пом'якшується|зацікавлений|переконаний","terminal":false,"outcome":"continue|declined|deal"}`,
      maxOutputTokens: 260,
      temperature: 0.72,
    });
    const previousDeferStreak = recentClientDeferStreak(history);
    const actorDefers = hasPrematureDeferral(actor.client_reply || "");
    const deferStreak = actorDefers ? previousDeferStreak + 1 : 0;

    // Hard stop for circular "подивлюсь / передзвоню" loops. This is enforced
    // after the actor call so prompt drift cannot keep the case alive forever.
    if (deferStreak >= 3) {
      if (!coach.active_objections.length) {
        actor.outcome = "deal";
        actor.terminal = false;
        actor.client_mood = "переконаний";
        actor.client_reply = "Добре, ви відповіли на мої запитання. Давайте переходити до наступного кроку.";
        coach.deal_ready = true;
      } else {
        actor.outcome = "declined";
        actor.terminal = true;
        actor.client_mood = "стриманий";
        actor.client_reply = `Дякую за пояснення, але заперечення «${coach.active_objections[0]}» для мене залишилося критичним. Я не готовий продовжувати оформлення.`;
      }
    }

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
      stage: coach.stage,
      dialogue_state: {
        discovered_needs: coach.discovered_needs,
        active_objections: coach.active_objections,
        resolved_objections: coach.resolved_objections,
        answered_topics: coach.answered_topics,
      },
    });
  } catch (error) {
    console.error(error);
    return json(error.statusCode || 500, {
      error: error.message || "Не вдалося обробити відповідь AI. Спробуйте ще раз.",
    });
  }
};

exports._test = { localSafetyCheck, hasPrematureDeferral, recentClientDeferStreak, feedbackSimilarity, stripSafetyWhitelist };
