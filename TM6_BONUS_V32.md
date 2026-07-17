# TM6 Bonus v32

- Fixed admin Goals tab losing `goals_login` when `/admin/goals-dashboard` comes from an older backend deployment.
- GoalsManager now merges `/admin/goals-dashboard` with `/admin/users` by user ID and uses the populated Google key.
- Google Sheets Apps Script now contains the configured spreadsheet ID.
- Existing Google read/write synchronization remains unchanged.
