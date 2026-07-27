# TM6 Bonus V98 · Google Sheets work schedule

## Implemented

- Added the `/schedule` page with a monthly calendar, today/tomorrow cards, legend, and selected-day details.
- Added a compact `Мій графік` card to the Home page.
- Schedule data is read from the existing Google spreadsheet, sheet `Schedule`.
- Authentication and row matching reuse the existing user `goals_login` field and `GOOGLE_GOALS_SCRIPT_URL` Netlify variable.
- Empty schedule cells are treated as days off.
- Supported schedule values: `9-14`, `9-16`, `9-18`, `11-20`, `10-19`, `В`, `Відпустка`.
- Added separate UI identities for ordinary shifts, late shifts, weekend shifts, vacation, and days off.
- Existing light and dark themes remain supported.
- Service Worker cache version bumped to `tm6-v98`.

## Deployment step

Replace the Google Apps Script with `integrations/google-sheets/Code.gs` and deploy a new Web App version. No new Netlify environment variable is required.
