# VPDK Bonus v122 — виправлення депозитного проекційного рейтингу

## Основне встановлення

1. Відкрийте Google Apps Script, прив'язаний до таблиці `Goals`.
2. Повністю замініть код на вміст файлу `VPDK-Code-v122.gs`.
3. Натисніть **Зберегти**.
4. Запустіть функцію `refreshReports` і підтвердьте дозволи, якщо Google їх попросить.
5. Дочекайтеся успішного завершення виконання.
6. У додатку натисніть **Оновити звіти** або закрийте PWA та відкрийте її знову.

Цього достатньо, щоб рейтинг почав підтягуватися. Передеплой frontend не потрібен для самого виправлення парсера.

## Необов'язковий повний деплой

У пакеті також оновлено `netlify/functions/google-goals.js`, щоб API повертав поле `deposit_projection_diagnostics`. Для цього додаткового діагностичного поля потрібно передеплоїти Netlify.

## Контроль після оновлення

У відповіді snapshot очікується:

```text
api_version: v122-deposit-projection-compact-layout
deposit_projection_diagnostics.layout: compact або split
deposit_projection_group_summaries.tm6.projective_rate: 93,28%
```
