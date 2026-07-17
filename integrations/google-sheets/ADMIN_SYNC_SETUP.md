# Google Goals admin sync

1. Replace the Apps Script code with `Code.gs` from this folder.
2. Keep your real `SPREADSHEET_ID` in the first line.
3. In Apps Script open **Project Settings → Script properties** and add:
   - Property: `WRITE_TOKEN`
   - Value: a long random string (for example 40+ characters).
4. Deploy a **new Web app version**: Deploy → Manage deployments → Edit → New version → Deploy.
5. In Netlify Environment variables add:
   - `GOOGLE_GOALS_WRITE_TOKEN` with exactly the same value as `WRITE_TOKEN`.
6. Deploy Netlify with **Clear cache and deploy site**.

The admin goals screen now reads current values from Google Sheets. Saving in admin first writes to Google Sheets and then mirrors the values to the backend so existing rewards and history continue to work.
