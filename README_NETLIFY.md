# VPDK Bonus — актуальний пакет для Netlify

Зібрано зі збережених файлів проєкту: 10.09.2026 13:51:19 +0300.

Це ZIP з актуальними вихідними файлами frontend, Netlify Functions, backend та Google Apps Script.
Локальні .env, ключі, node_modules, бази даних, uploads, журнали та кеші виключено.

Пакет містить поточні збережені зміни на момент формування архіву.
Оптимізовані зображення та налаштування кешування включено.
При перенесенні в існуючий репозиторій повністю замініть frontend/public/hidden-objects
папкою з цього ZIP, щоб старі PNG не залишилися у деплої.
Деталі та перевірки: NETLIFY_ASSET_OPTIMIZATION_2026-09-10.md.

## Розгортання через Git

1. Розпакуйте ZIP і перенесіть його вміст у репозиторій, підключений до вашого Netlify-сайту.
2. Збережіть чинні Environment variables сайту. Для frontend потрібна публічна адреса
   REACT_APP_BACKEND_URL=https://адреса-backend (без /api наприкінці).
3. Netlify прочитає netlify.toml і збере застосунок:
   base = frontend; command = npm run build; publish = build;
   functions = ../netlify/functions.

## Розгортання через Netlify CLI

Потрібні Node.js, Netlify CLI та доступ до вашого чинного сайту.
Виконайте з кореня розпакованого архіву:

    npm --prefix frontend install --legacy-peer-deps
    npx netlify-cli login
    npx netlify-cli link
    npx netlify-cli deploy --build --prod

Перед збіркою налаштуйте REACT_APP_BACKEND_URL у Netlify.
Залиште чинні серверні змінні BACKEND_API_URL, BACKEND_URL, GOOGLE_GOALS_SCRIPT_URL,
GOOGLE_GOALS_WRITE_TOKEN, PUSH_SCHEDULER_TOKEN та ключі потрібних інтеграцій у Netlify.
Не додавайте серверні секрети до REACT_APP_* або публічних файлів.

## Ручне перетягування ZIP

Цей архів містить вихідний код та Netlify Functions. Для розгортання всього пакету
використовуйте описаний вище спосіб через Git або CLI з netlify.toml.
Для production-збірки потрібна публічна адреса backend: локальний 127.0.0.1
не працюватиме у відвідувачів сайту.

## Backend

FastAPI та MongoDB працюють на окремому сервері. Netlify не запускає backend/server.py.
Папка backend містить актуальні серверні модулі, конфігурацію ігор, runtime та requirements.txt
для оновлення вашого чинного backend. Дані користувачів і локальні секрети сюди не входять.
integrations/google-sheets/Code.gs містить поточний код Google Apps Script.

Офіційні інструкції:
https://docs.netlify.com/deploy/create-deploys/
https://docs.netlify.com/api-and-cli-guides/cli-guides/get-started-with-cli/
https://docs.netlify.com/build/functions/get-started/
