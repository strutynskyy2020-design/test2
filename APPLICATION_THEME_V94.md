# TM6 Bonus V94 — global light/dark theme

## What changed

- Added an application-wide light/dark theme switcher.
- The current dark interface remains the default for users without a saved preference.
- The selected theme is stored locally under `tm6-color-theme` and remains active after reload or logout.
- The theme button is available in the authenticated header and on the login/registration screens.
- The browser status-bar `theme-color`, Sonner notifications, header, navigation and common cards/forms now follow the selected theme.
- Light mode uses the approved soft beige palette based on `#F5F5DC`.
- Bonus Match keeps its lavender playfield in light mode. Chips and obstacles remain frameless in both themes.

## Main files

- `frontend/src/App.js`
- `frontend/src/components/ThemeToggle.jsx`
- `frontend/src/components/AppLayout.jsx`
- `frontend/src/components/NotificationBell.jsx`
- `frontend/src/pages/Login.jsx`
- `frontend/src/pages/Register.jsx`
- `frontend/src/index.css`

## User behaviour

Press the sun/moon button in the top bar. The choice applies immediately to every section of the app and persists on that device.
