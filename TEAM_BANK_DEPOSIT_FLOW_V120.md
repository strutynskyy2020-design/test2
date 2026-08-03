# V120 — технічний опис

## Банка Команди

Виправлено MongoDB upsert у `_ensure_team_bank()`. Початкові поля записуються лише через `$setOnInsert`, а публічна конфігурація банки — через `$set`. Це прибирає помилку `Updating the path would create a conflict`.

API залишаються:
- `GET /api/team-bank`
- `POST /api/team-bank/contribute`
- `GET /api/admin/team-banks`
- `POST /api/admin/team-banks/{team_id}/reset`

## Депозитний проекційний рейтинг

Apps Script додає до snapshot:
- `deposit_projection_leaderboard`
- `deposit_projection_group_summaries`
- `deposit_projection_updated_at`

Netlify Function фільтрує дані за дозволеними логінами та додає команди й аватари операторів.

Маршрути frontend:
- `/goals/deposit` — проекційний рейтинг;
- `/goals/deposit/me` — особисті депозитні показники;
- `/goals/deposit/issuances` — рейтинг видач.
