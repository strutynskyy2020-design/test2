const CLIENTS = {
  easy: `Олена, 34 роки. Ввічлива й трохи невпевнена. Початкові заперечення: "треба подумати", "не зараз", "порадитися". Добре реагує на теплий тон, уточнювальні питання та персональну вигоду. Не любить тиску.`,
  medium: `Максим, 41 рік, керівник закупівель. Прагматичний, порівнює конкурентів, торгується щодо ціни й умов. Реагує на конкретику, цифри, ризики та аргументацію цінністю. Не приймає порожніх обіцянок.`,
  hard: `Ігор, 52 роки. Роздратований і недовірливий через негативний досвід. Підозрює нав'язливий продаж, різко реагує на шаблонні фрази й тиск. Пом'якшується лише від щирого розуміння, чесності та контролю з його боку.`,
};

const json = (statusCode, body) => ({
  statusCode,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
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
  const clean = text.trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  return JSON.parse(clean);
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  if (!process.env.OPENAI_API_KEY) return json(500, { error: "У Netlify не налаштовано OPENAI_API_KEY" });

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "Некоректний запит" }); }

  const { action, clientKey, history = [], operatorText = "", patience = 0, conversion = 0 } = body;
  const persona = CLIENTS[clientKey];
  if (!persona || !["start", "turn"].includes(action)) return json(400, { error: "Невідомий режим тренування" });

  const dialogue = Array.isArray(history)
    ? history.slice(-12).map((m) => `${m.role === "operator" ? "Оператор" : "Клієнт"}: ${String(m.text || "").slice(0, 900)}`).join("\n")
    : "";

  const instructions = `Ти працюєш як рушій симулятора для навчання операторів контакт-центру. Відповідай українською. Завжди залишайся в характері клієнта. Оцінюй саме якість комунікації та продажу, а не граматику. Не погоджуйся занадто швидко. Не повторюй одне й те саме заперечення. Відповідай ВИКЛЮЧНО валідним JSON без markdown.`;

  const prompt = action === "start"
    ? `Персонаж: ${persona}\n\nЦе початок розмови. Дай коротку реалістичну першу репліку клієнта з природним запереченням. Формат: {"client_reply":"...","client_mood":"нейтральний або скептичний"}`
    : `Персонаж: ${persona}\nПоточне терпіння: ${clamp(patience,0,100)}/100. Готовність до угоди: ${clamp(conversion,0,100)}/100.\nОстання відповідь оператора: ${String(operatorText).slice(0,1200)}\nДіалог:\n${dialogue}\n\nОціни відповідь оператора від 0 до 10. Назви головну застосовану техніку (наприклад: активне слухання, приєднання, уточнення потреби, SPIN, аргументація цінністю, робота з ціною, закриття угоди, або без чіткої техніки). Дай одне коротке речення практичного фідбеку. patience_delta від -25 до +12. trust_delta від 0 до +20. Наступна репліка клієнта має логічно продовжити розмову. Формат: {"score":0,"technique":"...","feedback":"...","patience_delta":0,"trust_delta":0,"client_mood":"скептичний|роздратований|пом'якшується|зацікавлений|переконаний","client_reply":"..."}`;

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
        instructions,
        input: prompt,
        max_output_tokens: 500,
        temperature: 0.75,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("OpenAI error", response.status, data);
      const message = response.status === 429 ? "Закінчився баланс API або перевищено ліміт" : "OpenAI не зміг відповісти";
      return json(response.status, { error: message });
    }

    const result = parseModelJson(extractText(data));
    if (action === "turn") {
      result.score = clamp(result.score, 0, 10);
      result.patience_delta = clamp(result.patience_delta, -25, 12);
      result.trust_delta = clamp(result.trust_delta, 0, 20);
    }
    return json(200, result);
  } catch (error) {
    console.error("AI trainer function failed", error);
    return json(500, { error: "Не вдалося обробити відповідь AI. Спробуйте ще раз." });
  }
};
