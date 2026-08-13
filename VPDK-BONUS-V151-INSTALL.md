# VPDK Bonus v151 — Battle idempotency + activator task expansion

## Deployment
This release changes the backend only.

1. Deploy `backend/server.py` from v151.
2. Restart the backend service.
3. Frontend / Netlify does not need to be rebuilt for this release.
4. Google Apps Script does not change.

## Daily battle fix
The previous battle settlement flow checked for an existing transaction and only then credited +50 Point. Two simultaneous requests could both pass that check before either transaction had been inserted.

V151 adds an atomic per-user/per-day guard on the user document:

`daily_battle:YYYY-MM-DD`

The guard and balance increment happen in one MongoDB update, so only one request can credit the reward.

Daily battle creation also now uses deterministic Mongo `_id` locks for the day and for each user/day battle row, preventing duplicate daily battle generation under concurrent requests.

### Historical audit
Read-only admin endpoint:

`GET /api/admin/daily-battles/duplicate-audit`

It reports historical cases where one employee has more than one battle reward transaction for the same battle date. It does not change balances automatically.

## Activator tasks
23 new activator tasks were appended to `ACTIVATION_DAILY_TASK_CATALOG` with IDs `1031`–`1053`.

The current-day catalog version intentionally stays `activation-v1`. This avoids regenerating today's task set for operators who may already have had tasks approved. New missions naturally enter the random pool for newly generated task sets.
