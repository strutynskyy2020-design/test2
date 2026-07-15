# Here are your Instructions

## AI-тренажер

Додано окрему вкладку `/ai-trainer`, яка відкриває тренажер у ChatGPT без OpenAI API-ключа.

За замовчуванням кнопка веде на `https://chatgpt.com/`. Щоб вона відкривала конкретний власний GPT, додайте у налаштування Netlify змінну середовища:

```text
REACT_APP_TRAINER_GPT_URL=https://chatgpt.com/g/g-ВАШ_ID
```

Після зміни змінної запустіть новий deploy. Дизайн інших сторінок не змінювався.
