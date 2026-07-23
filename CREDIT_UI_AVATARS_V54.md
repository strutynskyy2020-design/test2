# Credit UI and avatars v54

## Changes

- Credit leaderboard operator rows now use a mobile card layout so every `goals_login` is visible in full.
- Employee avatars are loaded from the TM6 backend and matched to Google Sheets rows by `goals_login`.
- Added authenticated endpoint `GET /api/goals/participants` with public profile fields needed by the internal ranking.
- TM6 group summary now shows `TM6 · Загальний` as a full-width centered card, with X-Sell, Web Apps and INB in three cards below.
- Best-by-direction cards now display employee avatars.
- Personal metric labels were renamed:
  - `CallBack к обработанным` → `Рівень колбеків`
  - `AHT` → `Довжина розмови`
  - `Reject rate` → `Відмови банку`

## Deployment

Deploy both the backend and frontend because avatar enrichment uses the new authenticated backend endpoint.
Google Apps Script / `Code.gs` does not need to be republished for these UI changes.
