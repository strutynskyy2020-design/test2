# Google reports manual refresh v102

## What changed

- Removed 60-second polling and focus/visibility refreshes from Home, Goals, credit/debit detail pages, leaderboards, and Schedule.
- Removed timestamp cache-busters from `google-goals` requests.
- Apps Script now publishes a report snapshot only when `refreshReports()` runs.
- `doGet()` reads the hidden `_TM6_REPORT_CACHE` sheet instead of scanning all source sheets.
- Admin goals loading now uses one protected bulk snapshot request instead of one Apps Script request per employee.
- Saving goals in Admin marks the report as awaiting publication and tells the administrator to click **Оновити звіти**.

## Google Sheets setup

1. Paste `integrations/google-sheets/Code.gs` into the bound Apps Script project.
2. Deploy a new Web App version.
3. Reload the spreadsheet.
4. Assign `refreshReports` to the drawing/button labeled **Оновити звіти**.
5. Run it once and grant permissions when Google asks.

The script also adds the menu item `TM6 → Оновити звіти` as a fallback.

## Expected flow

1. Edit source data in Google Sheets.
2. Click **Оновити звіти**.
3. Apps Script rebuilds `_TM6_REPORT_CACHE` and shows a completion toast.
4. Users reload or revisit the relevant site page to receive the new snapshot.

Until step 2, the website keeps serving the previous published snapshot.
