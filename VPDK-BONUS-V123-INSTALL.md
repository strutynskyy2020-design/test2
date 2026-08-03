# Встановлення VPDK Bonus v123

Це виправлення стосується саме сторінки **«Цілі»**, тому потрібен новий деплой frontend на Netlify.

## Netlify

1. Завантажте весь проєкт із цього пакета у ваш репозиторій або Netlify deploy.
2. Переконайтеся, що Netlify використовує кореневий `netlify.toml`:
   - base: `frontend`;
   - build command: `npm run build`;
   - publish: `frontend/build`;
   - functions: `netlify/functions`.
3. Запустіть новий deploy.
4. Після успішного deploy відкрийте застосунок заново. За потреби виконайте жорстке оновлення сторінки.

## Google Apps Script

Парсер v122 вже підтримує обидва макети депозитного блоку:

- `Team/Login | Result`;
- `Team | Login | Result`.

Тому повторно замінювати Apps Script не потрібно, якщо вже встановлено `VPDK-Code-v122.gs` і після цього запускалася `refreshReports`.

## Перевірка

Для користувача `mukovoz` очікуваний результат у картці **«Депозитний напрямок»**: `89,16%` при цілі `100%`.

Запуск локальної регресійної перевірки:

```bash
node test_goals_deposit_projection_v123.js
node test_deposit_projection_v122.js
```
