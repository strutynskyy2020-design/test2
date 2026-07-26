# Bonus Match rewards and reset V93

- One-time deployment migration resets every Bonus Match profile to level 1.
- Previous Bonus Match completions, active sessions and daily counters are removed.
- Existing user wallet balances and total XP are preserved.
- First completion of each level awards **10 Point + 10 XP**.
- Every later completion of the same level awards **5 XP** and no Point.
- Bonus Match Point rewards have no daily cap.
- The migration is idempotent through `system_migrations` marker `bonus_match_v93_reset_all_to_level_1`.
