# Bonus Match v88

## Зміни

- Debug-панель і збір діагностичних даних доступні лише користувачеві з роллю `admin`.
- Для звичайних користувачів React Error Boundary більше не показує кнопку експорту логів.
- Після вибору фішки підсвічування виконує один короткий імпульс і автоматично скидається через 2,5 секунди, якщо другий тап не зроблено.
- Додана кнопка повноекранного режиму через Fullscreen API.
- Під час рівня додані кнопки `МЕНЮ ГРИ` та `ЗДАТИСЬ / ПЕРЕГРАТИ`.
- Перегравання закриває активну сесію зі статусом `surrendered` і запускає рівень заново, витрачаючи ще одне життя.
- Додана покупка одного життя за 10 Point. Максимум залишається 5 життів.
- Ціни бонусів зберігаються на backend та повертаються через API:
  - Молоток: 10 Point
  - Ракета: 20 Point
  - Перемішати: 30 Point
  - Веселковий джокер: 50 Point
- `Райдужний джокер` перейменовано на `Веселковий джокер` у frontend і backend.
- Якщо протягом ходу знищено хоча б одну павутину, поширення павутини цього ходу повністю пропускається.
- Версії render engine, diagnostics, Service Worker і PWA cache підняті до v88.

## Нові API

- `POST /games/bonus-match/lives/purchase`
- `POST /games/bonus-match/surrender`

## Змінені файли

- `backend/server.py`
- `frontend/src/pages/BonusMatch.jsx`
- `frontend/src/components/BonusMatchErrorBoundary.jsx`
- `frontend/src/components/BonusMatchDebugOverlay.jsx`
- `frontend/src/lib/bonusMatchDiagnostics.js`
- `frontend/src/lib/pwa.js`
- `frontend/public/service-worker.js`
- `tests/test_bonus_match_v88_regression.py`

## Перевірки

- `python -m py_compile backend/server.py`
- dependency-free regression tests for prices, life price, web propagation and frontend wiring
- TypeScript JSX parser and transpiler checks for modified JSX files
- `node --check` for Service Worker, diagnostics and PWA registration

Повний production build не запускався, оскільки архів не містить `node_modules` або lock-файлу.
