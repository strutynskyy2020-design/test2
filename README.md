# Here are your Instructions

## AI-тренажер

Додано вкладку `/ai-trainer`, яка працює прямо всередині сайту через Netlify Function.

У Netlify відкрийте **Site configuration → Environment variables** і додайте:

- `OPENAI_API_KEY` — ваш секретний ключ OpenAI
- `OPENAI_MODEL` — необов'язково, за замовчуванням `gpt-4.1-mini`

Після додавання змінних запустіть новий deploy. Ключ не потрапляє у браузер і зберігається лише на серверній стороні Netlify.
