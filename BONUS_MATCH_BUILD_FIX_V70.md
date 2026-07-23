# TM6 Bonus v70 — виправлення Netlify build

Netlify зупиняв production build через правило ESLint `react-hooks/rules-of-hooks`.

Причина: звичайна async-функція обробки бустера називалась `useBooster`. ESLint трактував будь-яку функцію з префіксом `use` як React Hook, хоча вона викликалась всередині `selectBooster` та `handlePiece`.

Виправлення:

- `useBooster` перейменовано на `applyBooster`;
- оновлено обидва місця виклику;
- функціональна логіка купівлі/застосування бустерів не змінювалась;
- PWA cache version піднято до `tm6-v70`.

Змінені файли:

- `frontend/src/pages/BonusMatch.jsx`
- `frontend/public/service-worker.js`
