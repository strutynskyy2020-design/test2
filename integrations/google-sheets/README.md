# Google Sheets report integration · V155

V155 використовує **дві Google-таблиці**.

## Основна таблиця

```text
SPREADSHEET_ID = 1J6pgu1HEuufkSA_O3EpcMwrylenAg685sQH4lRMjAic
```

З неї читаються:

- `Credit`
- `X-Sell`
- `Web`
- `INB`
- `Debit`
- `Debit giving`
- `Deposit `
- `Deposit transformation`
- `Deposit giving`
- `Schedule`

У ній також живуть `_TM6_REPORT_CACHE` та `_TM6_TEAM_MESSAGES`.

## Activators projective

```text
ACTIVATORS_SPREADSHEET_ID = 1X2zXNw52SAIpysVdmkiSbtm346pDes3s_uzdWPC6v2c
```

З неї читаються тільки звіти активаторів:

- `Pumb Online` → проекція PUMB Online;
- `Pumb Online transformation` → month / yesterday transformation;
- `Giving Pumb Online` → month / yesterday giving;
- `Card activation` → проекція активації картки;
- `Card transformation` → month / yesterday transformation;
- `Giving card` → month / yesterday giving.

`Activation Deb` і `Activation CC` в основній таблиці більше не є runtime-джерелами.

## Проекції замість Goals

`Goals` не читається і не записується. Поле `goals` у JSON збережене тільки як read-only API alias.

Для Credit, Debit, Deposit, PUMB Online та Card activation ціль проекції фіксована на `100%`.

## Встановлення

1. Відкрий Apps Script, який використовується застосунком.
2. Встав `Code.gs` з цієї папки.
3. Переконайся, що акаунт Apps Script має доступ до обох таблиць.
4. Онови deployment Web App, якщо потрібно.
5. Запусти `refreshReports()`.

Деталі: `../../VPDK-BONUS-V155-INSTALL.md`.
