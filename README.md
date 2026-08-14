# VPDK Bonus V155

Ця збірка зберігає основну логіку V154 без `Goals`, але виносить **усі звіти активаторів в окрему Google-таблицю `Activators projective`**.

Основні зміни:

- основні продажні/депозитні звіти, `Schedule`, кеш і командні повідомлення залишаються в `Електронна таблиця без назви`;
- `Goals` не читається і не записується;
- ціль кожної проекції залишається фіксованою `100%`;
- PUMB Online і Card activation більше не читаються з `Activation Deb` / `Activation CC` основної таблиці;
- для активаторів використовується окремий `ACTIVATORS_SPREADSHEET_ID`;
- підтримані окремі projection / transformation / giving аркуші та періоди month / yesterday;
- `Schedule` і решта напрямків не змінювались.

Інструкція: `VPDK-BONUS-V155-INSTALL.md`.

Основний Apps Script: `integrations/google-sheets/Code.gs`.

Перевірки:

```bash
node test_report_source_v155.js
node test_activators_source_v155.js
node test_activation_reports_v125.js
```
