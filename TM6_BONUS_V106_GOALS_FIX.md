# TM6 Bonus v106: goals/admin/messages fix

## Fixed

- Team-leader messages no longer depend on the newest backend route. They use the authenticated Netlify `goals-team-message` gateway and are stored in the hidden Google Sheet `_TM6_TEAM_MESSAGES`.
- Admin goals loading no longer fails as a whole when `/admin/goals-settings` or `/goals/report-access` is missing on an older backend deployment.
- `google-goals-admin` authenticates through the stable `/api/auth/me` endpoint instead of requiring `/admin/goals-dashboard` just to validate the admin.
- An admin without a Google `goals_login` receives a team-report overview instead of `goals_login_missing`.
- The admin goals panel can fall back to `/admin/users`, merge published Google rows, and show operators even when a newer dashboard route is unavailable.
- Cross-team settings are written to Google Apps Script and, when available, to the backend too.
- Projection mapping is explicit. Personal projection comes from the operator's column in `Transformation`. Team comparison is used only from an exact `Підсумок TM1/TM6/TM7...` column. The old fallback to TM6 or the first summary column was removed.
- The projection card now displays its exact sheet, row, operator column, and team comparison column.
- PWA report storage and service-worker versions were bumped to v106 so stale v105 report payloads do not survive deployment.

## Required deployment

1. Deploy this repository to Netlify.
2. Replace the Google Apps Script code with `integrations/google-sheets/Code-v106.gs`.
3. Create a new Apps Script Web App version.
4. Keep the spreadsheet button assigned to `refreshReports`.
5. Press `Оновити звіти` once after deployment.
6. Fully close and reopen the installed PWA.

The existing environment variables remain required:

- `GOOGLE_GOALS_SCRIPT_URL`
- `GOOGLE_GOALS_WRITE_TOKEN`
- `BACKEND_API_URL` or `REACT_APP_BACKEND_URL`

For report-view statistics and the previous password persistence fix, deploy the included backend as well.
