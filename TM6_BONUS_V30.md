# TM6 Bonus v30 — PWA live refresh fix

- Netlify Function and API requests are network-only in the service worker.
- Google goals requests use `cache: no-store` and a timestamp query parameter.
- Home and Goals refresh when the app regains focus, becomes visible, returns from the mobile app switcher, and every 60 seconds while open.
- Service worker checks for a new deployment every 5 minutes and on focus/visibility changes.
- A newly activated service worker reloads the app once automatically.
- Netlify headers prevent caching of service-worker.js, index.html, and function responses.
