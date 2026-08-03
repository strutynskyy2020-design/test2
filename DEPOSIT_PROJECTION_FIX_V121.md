# Deposit Projection Parser Fix v121

Парсер більше не довіряє першому входженню слова `Deposit`. Він оцінює кожен можливий блок за структурою:

1. колонка з командами `TM_1`, `TM_6`, `TM_7` тощо;
2. колонка з логінами операторів;
3. колонка з відсотковими значеннями;
4. кількість знайдених командних підсумків та операторів.

Найкращий валідний блок використовується для формування:

- `deposit_projection_leaderboard`;
- `deposit_projection_group_summaries`;
- `deposit_projection_diagnostics`.

Версія API snapshot: `v121-deposit-projection-block-detection`.
