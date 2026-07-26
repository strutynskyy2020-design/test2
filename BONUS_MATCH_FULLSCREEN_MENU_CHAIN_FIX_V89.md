# Bonus Match v89

## Виправлення

### 1. Повноекранний режим тільки для гри

У v88 викликався `document.documentElement.requestFullscreen()`, тому на desktop у fullscreen переходила вся програма разом із шапкою та нижньою навігацією.

У v89 fullscreen запитується для контейнера `data-bonus-game-surface="v89"`, який містить тільки активний рівень: статистику, поле, бонуси та результат.

### 2. Fallback для iPhone Safari

У діагностичному логу v88 зафіксовано, що `requestFullscreen` відсутній. Тепер код:

- використовує native Fullscreen API, якщо він доступний;
- інакше переходить у viewport-fullscreen: ігровий контейнер стає `fixed`, займає `100vw × 100dvh`, враховує safe-area та має власний scroll;
- блокує прокручування сторінки позаду;
- показує всередині гри кнопку виходу з fullscreen.

### 3. «Меню гри» більше не відкриває рівень назад

Причина v88: `leaveBoard()` очищав локальну гру, а потім викликав `loadStatus()`. Сервер повертав `active_session`, і `loadStatus()` одразу повторно застосовував її.

У v89 `loadStatus({ restoreActiveSession: false })` оновлює профіль і каталог рівнів, але не відновлює активну сесію. Сесія залишається збереженою на сервері та продовжується тільки після натискання «ГРАТИ».

### 4. Фішка під ланцюгом видима

Ланцюг є overlay-перешкодою, тому в v89:

- фішка рендериться у повному розмірі;
- chain sprite накладається через `mix-blend-mode: screen`;
- темний фон спрайта більше не закриває символ;
- рамка, ланцюги, замок і кількість ударів залишаються видимими.

## Версії

- Render engine: `v89`
- Diagnostics: `v89`
- Service Worker: `/service-worker.js?v=89`
- Cache: `tm6-v89`

## Перевірки

- `python -m py_compile backend/server.py`
- `node --check frontend/public/service-worker.js`
- `node --check frontend/src/lib/pwa.js`
- `node --check frontend/src/lib/bonusMatchDiagnostics.js`
- `python tests/test_bonus_match_v89_regression.py`

Повний production build не запускався, оскільки в архіві немає встановлених `node_modules`.
