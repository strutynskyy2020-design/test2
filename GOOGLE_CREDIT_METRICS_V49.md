# TM6 Bonus v49: деталізація кредитного напрямку

## Що додано

- Натискання на картку **Кредитний напрямок** відкриває `/goals/credit`.
- Вкладки напрямків: `X-Sell`, `Web Apps`, `INB`.
- Вкладки періодів: `Місяць`, `Вчора`.
- Порівняння особистого результату із загальним показником.
- Автоматичне визначення сильної зони, зони росту та зони уваги.

## Логіка оцінювання

- `Рівень згод`: особистий показник вище загального = добре.
- `CallBack`: особистий показник вище загального = погано.
- `AHT`: добре, якщо різниця із загальним показником не перевищує ±15 секунд.
- `Reject rate`: особистий показник вище загального = погано.
- `Выдач к обработанным`: особистий показник вище загального = добре.
- `Проекційний`: більше 100% = добре; 90–100% = зона росту; менше 90% = зона уваги.

## Google Sheets

Детальні показники зберігаються в окремому аркуші **CreditMetrics**. Один рядок відповідає одному оператору, одному напрямку та одному періоду.

Обов’язкові колонки:

```text
goals_login
channel
period
processed_tasks
processed_tasks_overall
agreement_rate
agreement_rate_overall
callback_rate
callback_rate_overall
aht
aht_overall
reject_rate
reject_rate_overall
issuance_rate
issuance_rate_overall
projective_rate
projective_rate_overall
updated_at
```

Допустимі значення `channel`:

```text
xsell
web_apps
inb
```

Допустимі значення `period`:

```text
month
yesterday
```

`AHT` можна записувати як `01:36` або як кількість секунд `96`.

Після зміни `Code.gs` потрібно опублікувати нову версію Google Apps Script:

```text
Deploy → Manage deployments → Edit → New version → Deploy
```
