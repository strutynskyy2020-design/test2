# Work Schedule V101

The `Schedule` parser now supports the actual Google Sheet layout used by TM6:

- row 1 contains calendar dates (`1`, `2`, `3`, ...);
- row 2 contains `ПІБ`, `Логін`, `ставка` and weekday abbreviations;
- employee data starts below the header row.

## Fixes

- Date-row detection now scans the top section of the sheet instead of checking only a narrow fixed position.
- The first schedule column is calculated after `ПІБ`, `Логін`, and `ставка`.
- Day cells support integers, decimal-formatted integers, real Google Sheets dates, and displayed full dates such as `01.08.2026`.
- The API response includes diagnostics with detected header/date/employee rows and sample dates.
- The schedule error screen displays the deployed Apps Script API version and parser diagnostics.
- Apps Script API and PWA cache version are `v101`.

## Deployment

1. Replace the Apps Script project code with `integrations/google-sheets/Code.gs`.
2. Deploy a **new Web App version** using `Deploy → Manage deployments → Edit → New version → Deploy`.
3. Redeploy Netlify with cache clearing.
4. Open `/schedule`, refresh, and confirm that the error card reports `Apps Script API: v101` if any issue remains.
