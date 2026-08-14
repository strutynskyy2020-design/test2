# VPDK Bonus V155: окреме джерело звітів активаторів

## Джерела даних

V155 використовує **дві Google-таблиці**, кожна зі своєю чіткою роллю.

### 1. Основна таблиця

`SPREADSHEET_ID = 1J6pgu1HEuufkSA_O3EpcMwrylenAg685sQH4lRMjAic`

Таблиця **«Електронна таблиця без назви»** залишається джерелом для:

- Credit;
- X-Sell;
- Web;
- INB;
- Debit;
- Debit giving;
- Deposit;
- Deposit transformation;
- Deposit giving;
- Schedule;
- `_TM6_REPORT_CACHE`;
- `_TM6_TEAM_MESSAGES`.

Логіка `Goals` не повертається: персональні цілі не читаються з окремої вкладки, а ціль кожної проекції залишається фіксованою **100%**.

### 2. Таблиця активаторів

`ACTIVATORS_SPREADSHEET_ID = 1X2zXNw52SAIpysVdmkiSbtm346pDes3s_uzdWPC6v2c`

Таблиця **«Activators projective»** використовується **виключно для звітів активаторів**.

Мапінг аркушів:

- `Pumb Online` → персональна проекція ПУМБ Online;
- `Pumb Online transformation` → деталізація ПУМБ Online за місяць і за вчора;
- `Giving Pumb Online` → видачі/продажі ПУМБ Online за місяць і за вчора;
- `Card activation` → персональна проекція активації картки;
- `Card transformation` → деталізація активації картки за місяць і за вчора;
- `Giving card` → видачі активації картки за місяць і за вчора.

Аркуші `Activation Deb` та `Activation CC` з основної таблиці більше не використовуються як джерело даних застосунку.

## Що змінено в парсерах

Структура `Activators projective` відрізняється від старих вкладок, тому V155 додатково підтримує:

- метрики transformation, де назва показника розташована в колонці `Значения`, а не обов'язково в першій колонці;
- довші службові шапки `Card transformation`;
- окремий pivot `Pumb Online` для проекцій операторів;
- табличний формат `Giving Pumb Online` з колонками `team`, `agent` та значенням продажів;
- існуючий pivot `Giving card` із сегментами A/B/C/D;
- окремі блоки `month` та `yesterday`.

API-поля фронтенду не перейменовувались: `activation_pumb_*` і `activation_cards_*` залишаються сумісними з поточним UI.

## Встановлення

1. Відкрий Apps Script, який використовується застосунком і прив'язаний до основної таблиці.
2. Замінити `Code.gs` файлом `integrations/google-sheets/Code.gs` з V155.
3. Переконатися, що акаунт, від імені якого працює Apps Script, має доступ до таблиці **«Activators projective»**.
4. Зберегти скрипт і оновити deployment Web App, якщо для змін коду це потрібно у твоєму поточному deployment.
5. Запустити `refreshReports()` або **Звіти → Оновити звіти**.
6. Після оновлення перевірити одного активатора: проекція та transformation/giving мають прийти з `Activators projective`, тоді як Schedule і решта напрямків залишаються з основної таблиці.

## Перевірка

```bash
node test_report_source_v155.js
node test_activators_source_v155.js
node test_activation_reports_v125.js
```

Перевірки V155 покривають:

- основні звіти та Schedule без повернення Goals;
- фіксовану ціль проекцій 100%;
- окремий `ACTIVATORS_SPREADSHEET_ID`;
- Pumb Online projection/transformation/giving;
- Card activation projection/transformation/giving;
- month/yesterday;
- сумісність старого transformation-парсера там, де це ще потрібно.
