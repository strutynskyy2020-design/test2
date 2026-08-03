# VPDK Bonus v119 — Netlify dependency installation fix

## Причина падіння build
Netlify запускав Yarn Classic, оскільки у `frontend/package.json` вказано `packageManager: yarn`.
У `resolutions` проєкту був примусово встановлений `webpack-dev-server 5.2.4`, хоча `react-scripts 5.0.1` використовує гілку webpack-dev-server 4.x.
Це підтягнуло неповністю опубліковане сімейство `memfs/@jsonjoy.com` версії 4.65.0, де пакет `@jsonjoy.com/fs-node-builtins@4.65.0` відсутній.

## Що виправлено
- `webpack-dev-server` зафіксовано на сумісній з Create React App 5 версії `4.15.2`.
- `memfs` зафіксовано на повній опублікованій версії `4.64.0`.
- `@jsonjoy.com/fs-node-builtins` зафіксовано на `4.64.0`.
- Функціонал депозитних звітів v118 не змінено.

## Як розгорнути
1. Замініть файли репозиторію вмістом ZIP v119.
2. Commit і push у гілку `main`.
3. У Netlify відкрийте `Deploys` → `Trigger deploy` → `Clear cache and deploy site`.
4. Не використовуйте звичайний cached deploy для першої спроби після виправлення.

Google Apps Script залишається v118.
