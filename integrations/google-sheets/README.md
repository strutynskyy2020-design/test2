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

## Work schedule (v98)

The existing Apps Script also reads the `Schedule` sheet. No additional Netlify secret is required: it uses the same `SPREADSHEET_ID`, `GOOGLE_GOALS_SCRIPT_URL`, backend authentication, and user `goals_login` mapping as goals and projection metrics.

Expected layout:

- one header cell named `Логін` (aliases `Login` and `goals_login` are supported);
- optional employee columns `ПІБ` and `ставка`;
- a row above the header containing day numbers or actual Google Sheets dates;
- weekday labels in the header row (`пн`, `вт`, `ср`, `чт`, `пт`, `сб`, `нд`);
- one employee row per login.

Cell values:

- `9-14`, `9-16`, `9-18` → ordinary work shift with the exact displayed hours;
- `11-20` → late shift;
- `10-19` → weekend work shift;
- `Відпустка` → vacation;
- `В`, `В.` or an empty cell → day off.

After replacing `Code.gs`, deploy a new Apps Script web-app version. The frontend reads schedule data through the existing `/.netlify/functions/google-goals` endpoint.

## Manual report publishing (v102)

The website no longer rebuilds Google reports every minute. `doGet` serves a saved snapshot from the hidden sheet `_TM6_REPORT_CACHE`.

A new snapshot is created only by the Apps Script function:

```text
refreshReports
```

Setup:

1. Replace the Apps Script project code with `Code.gs` from this project.
2. Save the script and deploy a new Web App version.
3. Reload the Google Sheet. A new menu appears: `TM6 → Оновити звіти`.
4. For the existing drawing/button named **Оновити звіти**, choose **Assign script** and enter `refreshReports` without parentheses.
5. Click the button once to create the first snapshot.

During refresh, Apps Script reads the source sheets, creates one report payload per `goals_login`, and writes chunked JSON to `_TM6_REPORT_CACHE`. The sheet is hidden automatically. Normal website requests only read this cache and do not rebuild reports.

Changes made through the admin panel are written to the `Goals` sheet immediately, but they appear in website reports only after `Оновити звіти` is clicked. This is intentional.
