# Технічний опис V118

## Потік даних

```text
Google Sheet: Deposit
  → Apps Script Code-v118.gs
  → ручний snapshot після refreshReports()
  → Netlify Function google-goals
  → IndexedDB/PWA cache
  → DepositLeaderboard і DepositGoals
```

## Дані snapshot

Apps Script додає до кожного персонального звіту:

```text
deposit_metrics
deposit_leaderboard
deposit_group_summaries
deposit_leaderboard_updated_at
deposit_issuances
```

## Командна приватність

Netlify Function:

- доповнює операторів профілями та аватарами;
- фільтрує логіни відповідно до доступу користувача;
- повертає лише дозволені командні підсумки;
- для персональних метрик підставляє підсумок саме команди користувача.

## Аналітика

Після публікації snapshot backend зберігає:

```text
deposit_overall
deposit
```

Це дозволяє будувати депозитний тренд в аналітиці керівника.

## Перевірки

- синтаксис backend;
- синтаксис Netlify Functions;
- синтаксис Apps Script;
- синтаксис усіх frontend JS/JSX-файлів;
- тест парсера Deposit;
- 12 регресійних тестів Bonus Match і Sudoku.
