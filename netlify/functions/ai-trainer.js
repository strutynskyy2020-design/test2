const PERSONAS = {
  easy: "Олена, 34 роки. Ввічлива, невпевнена, заперечує: треба подумати, не зараз, пораджуся. Добре реагує на теплий тон, уточнення й персональну вигоду. Не любить тиску.",
  medium: "Максим, 41 рік, керівник закупівель. Прагматичний, порівнює конкурентів, ціну та умови. Реагує на цифри, факти й аргументацію цінністю.",
  hard: "Ігор, 52 роки. Роздратований і недовірливий після поганого досвіду. Підозрює нав'язування, різко реагує на шаблони та тиск. Пом'якшується лише через щире розуміння й чесність.",
};

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    score: { type: "number", minimum: 0, maximum: 10 },
    technique: { type: "string" },
    feedback: { type: "string" },
    patience_delta: { type: "integer", minimum: -25, maximum: 12 },
    trust_delta: { type: "integer", minimum: 0, maximum: 20 },
    client_mood: { type: "string", enum: ["skeptical", "frustrated", "softening", "convinced", "annoyed"] },
    client_reply: { type: "string" },
  },
  required: ["score", "technique", "feedback", "patience_delta", "trust_delta", "client_mood", "client_reply"],
};

function textFromResponse(data) {
  if (data.output_text) return data.output_text;
  for (const item of data.output || []) for (const part of item.content || []) if (part.type === "output_text" && part.text) return part.text;
  return "";
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return { statusCode: 500, body: JSON.stringify({ error: "На Netlify не додано OPENAI_API_KEY" }) };
    const body = JSON.parse(event.body || "{}");
    const persona = PERSONAS[body.level];
    if (!persona) return { statusCode: 400, body: JSON.stringify({ error: "Невідомий рівень" }) };

    if (body.action === "opening") {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
          input: `Ти граєш клієнта у тренажері продажів. Персонаж: ${persona}\nПочни розмову українською короткою природною реплікою з першим запереченням. Відповідай лише реплікою клієнта, без пояснень.`,
          max_output_tokens: 180,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || "OpenAI API error");
      return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_reply: textFromResponse(data).trim() }) };
    }

    const history = Array.isArray(body.history) ? body.history.slice(-10).map(x => `${x.role === "operator" ? "Оператор" : "Клієнт"}: ${String(x.text || "").slice(0, 800)}`).join("\n") : "";
    const state = body.state || {};
    const prompt = `Ти одночасно граєш клієнта та працюєш тренером з продажів.\nПерсонаж: ${persona}\nСтан: терпіння ${state.patience}/100, готовність ${state.conversion}/100, хід ${state.turn}.\nІсторія:\n${history}\n\nОціни останню відповідь оператора за 0-10 за емпатією, уточненнями, аргументацією цінністю, персоналізацією та відсутністю тиску. Назви техніку, дай одне коротке речення фідбеку на «ти», визнач зміни показників і продовж діалог природною реплікою клієнта. Не повторюй заперечення дослівно.`;

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
        input: prompt,
        max_output_tokens: 450,
        text: { format: { type: "json_schema", name: "trainer_turn", strict: true, schema } },
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "OpenAI API error");
    const parsed = JSON.parse(textFromResponse(data));
    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed) };
  } catch (error) {
    console.error(error);
    return { statusCode: 500, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: error.message || "Помилка сервера" }) };
  }
};
