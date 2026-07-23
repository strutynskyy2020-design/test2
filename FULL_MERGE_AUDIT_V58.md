# TM6 Bonus v58 — повна об'єднана збірка

Перевірено, що в цій збірці одночасно присутні:

- Щедрий куб:
  - frontend/src/pages/Fun.jsx
  - frontend/src/pages/Home.jsx — кнопка переходу на /fun
  - backend/server.py — /games/cube/status та /games/cube/spin
- AI-тренажер:
  - frontend/src/pages/AITrainer.jsx
  - frontend/src/App.js — маршрут /ai-trainer
  - frontend/src/components/AppLayout.jsx — пункт AI у нижній навігації
  - netlify/functions/ai-trainer.js
  - netlify/functions/ai-trainer-data.js
- Кредитний і дебетовий рейтинги
- Персональні кредитні показники
- Персональні дебетові видачі
- Нульовий fallback для відсутнього оператора у блоці giving yesterday

Service Worker оновлено до tm6-v58, щоб встановлена PWA очистила старі кеші після нового деплою.
