# VPDK Bonus v131 — технічний опис

## 1. ПУМБ Online: проектний підсумок

Apps Script v130 уже записує для кожного персонального рядка два незалежні типи значень:

- `metric_team` — підсумок колонки конкретної групи, наприклад `TM_7 Підсумок`;
- `metric_overall` — підсумок останньої колонки `Загальний підсумок`.

Раніше `ActivationPumbGoals.jsx` ставив у нижній рядок картки командне значення:

```jsx
active?.[`${metric.key}_team`]
```

У v131 картка використовує:

```jsx
active?.[`${metric.key}_overall`]
```

із запасним джерелом `activation_pumb_group_summaries[period].general` для привілейованого огляду.

Верхня проекційна картка навмисно не змінена й далі використовує `teamProjection`.

## 2. Нова назва показника

UI-підпис `completion_rate` змінено з:

`Всього виконано`

на:

`Зайшли в додаток після згоди`

Ключ даних не змінювався, тому історичні snapshot сумісні.

## 3. Командний фільтр LeaderBoard

Backend endpoint отримав необов'язковий параметр `team_id`.

Порядок розрахунку:

1. вибираються тільки гравці з ролями `PLAYER_ROLES`;
2. коли передано `team_id`, MongoDB-фільтр доповнюється цим значенням;
3. Point рахуються за тією самою чинною формулою;
4. сортування та `rank` виконуються вже всередині вибраної групи.

Сповіщення про зміну позиції запускаються тільки для глобального LeaderBoard без `team_id`.

Frontend отримує кнопки через публічний endpoint `/api/teams` і передає вибрану команду в `/api/leaderboard`.

## 4. Кеш

Service Worker і Google Reports IndexedDB отримали версію v131, щоб браузер не залишав старий JSX після деплою.

## 5. Перевірки

Виконано:

- `python validate_vpdk_v131.py`;
- `python -m py_compile backend/server.py`;
- `node test_activation_pumb_v129.js`;
- `node test_pumb_project_summary_v131.js`;
- `node validate_vpdk_v130_deposit_giving.js`.

Усі актуальні перевірки пройшли.
