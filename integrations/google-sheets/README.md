# Google Sheets goals integration

## Required sheet columns

The `Goals` sheet should use these headers:

- `goals_login`
- `employee_name`
- `week_start`
- `credit_target`
- `credit_actual`
- `debit_target`
- `debit_actual`
- `deposit_target`
- `deposit_actual`
- `monthly_bonus_target`
- `monthly_bonus_actual`

The frontend also accepts the older `*_current` aliases.
Localized percentages such as `158,54%` are supported.

## Apps Script

1. Open the Google Sheet URL.
2. Copy the value between `/d/` and `/edit`. That is the spreadsheet ID.
3. Paste it into `SPREADSHEET_ID` in `Code.gs`.
4. Deploy the script as a **Web app**.
5. Use the deployment URL ending in `/exec` as `GOOGLE_GOALS_SCRIPT_URL` in Netlify.

A URL containing `/macros/library/` is a library URL and must not be used.

After every Apps Script code change, deploy a new version:
`Deploy -> Manage deployments -> Edit -> New version -> Deploy`.

## Credit direction details (v49)

Create an optional sheet named `CreditMetrics`. The app reads one row per employee/channel/period.
See `CreditMetrics-example.csv` and `/GOOGLE_CREDIT_METRICS_V49.md` for the complete schema and status rules.


## Manual publishing (v56)

The app reads hidden published snapshots instead of live sheet formulas.
After replacing `Code.gs`, reload the spreadsheet and use:
`TM6 Bonus → Оновити результати`.

To create a visible sheet button, assign the function `updateResultsSnapshot` to a drawing.
See `/MANUAL_RESULTS_PUBLISHING_V56.md` for the complete setup.
