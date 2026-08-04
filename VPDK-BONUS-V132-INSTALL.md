# VPDK Bonus v132 — встановлення

Дата: 04.08.2026  
База: v131 / робоча гілка v126.

## Що змінено

У звіті **«Активація карток»** п'ять персональних карток тепер порівнюють результат оператора з колонкою **«Загальний підсумок»** таблиці `Activation Cards`.

Нижній підпис у цих картках змінено:

`Команда` → `Проект`

Верхній блок проекції та блок сегментів видач `A · B · C · D` залишаються командними.

## Що розгортати

### Frontend / Netlify

Розгорнути frontend із пакета v132.

Змінено:

- `frontend/src/pages/ActivationCardsGoals.jsx`;
- `frontend/src/lib/googleReportsCache.js`;
- `frontend/public/service-worker.js`.

### Backend

Оновлювати не потрібно. Залишається backend v131.

### Google Apps Script

Оновлювати не потрібно. Залишається `VPDK-Code-v130.gs`.

Apps Script уже записує значення колонки **«Загальний підсумок»** у поля:

- `processed_tasks_overall`;
- `aht_overall`;
- `agreement_to_processed_rate_overall`;
- `activation_from_agreements_rate_overall`;
- `activation_from_processed_rate_overall`.

## Після деплою

1. Виконати `Ctrl + Shift + R` або повністю закрити й відкрити PWA.
2. Відкрити **Цілі → Активація карток**.
3. Перевірити режими **«Місяць»** і **«Вчора»**.
4. У п'яти картках нижній рядок має називатися **«Проект»**.
5. Значення мають відповідати колонці **«Загальний підсумок»**, а не `TM_7 Підсумок`.

Окремо запускати `refreshReports` не обов'язково, якщо останній snapshot уже створено кодом v130.
