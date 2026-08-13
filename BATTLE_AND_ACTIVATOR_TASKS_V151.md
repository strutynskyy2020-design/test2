# V151 technical notes

## Battle-day +50 Point audit
Code review found a concurrency race in the old settlement path:

1. request A checks that no `battle_win_bonus` transaction exists;
2. request B performs the same check before A inserts the transaction;
3. both requests can increment the wallet by +50;
4. both can then create separate ledger rows.

So duplicate +50 awards were possible under simultaneous settlement calls.

### V151 protection
- `battle_reward_keys` is stored on the employee document.
- The key is based on employee + battle calendar day, not pair ID.
- MongoDB performs the guard and `$inc` in the same atomic update.
- Only `modified_count == 1` is allowed to create/notify the reward.
- The marker list is capped at the latest 730 battle days.
- Existing historical ledger rewards are recognized and only receive a backfilled marker, never a second award.
- Daily battle day creation uses a deterministic Mongo `_id` concurrency lock.
- Daily battle user rows use deterministic Mongo `_id` values.

## Historical duplicate detection
`GET /api/admin/daily-battles/duplicate-audit`

The endpoint groups `battle_win_bonus` and `battle_tie_bonus` by `user_id + battle_date` and returns any day with more than one reward transaction.

No automatic money correction is performed, because historical balance corrections should be reviewed before mutation.

## Activator daily-task expansion
Added 23 tasks supplied for the activation profile. The pool now contains 53 activator missions.

Distribution after the update:
- Easy: 17
- Medium: 19
- Hard: 17

The task generator continues to choose one easy, one medium, and one hard mission per Kyiv day and continues its 14-day anti-repeat logic.
