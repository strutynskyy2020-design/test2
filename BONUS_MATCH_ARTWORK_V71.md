# TM6 Bonus v71 — нові фішки та перешкоди Bonus Match

## Що змінено

- Шість звичайних фішок тепер рендеряться з окремих чітких WebP-асетів:
  - coin, star, gift, cube, zap, trophy.
- Усі десять перешкод отримали окремі WebP-зображення:
  - ice, chain, crate, stone, crystal, web, shield, slime, metal, core.
- `BonusMatch.jsx` використовує серверні `symbol` та `obstacle` як ключі до локальних асетів.
- Стабільний `cell.id`, серверні кадри каскадів, спецфішки та авторитетна серверна логіка не змінені.
- Спецфішки залишилися анімованими поверх нової базової графіки.
- В адмін-редакторі рівнів перешкоди тепер показуються тими самими зображеннями у каталозі, палітрі й схемі 7×7.
- Усі асети оптимізовані до 512×512 WebP. Загальний розмір набору близько 0.9 MB.
- Service Worker оновлено до `tm6-v71` та попередньо кешує весь набір фішок і перешкод.

## Шляхи асетів

- `frontend/public/bonus-match/pieces/*.webp`
- `frontend/public/bonus-match/obstacles/*.webp`

## Змінені файли

- `frontend/src/pages/BonusMatch.jsx`
- `frontend/src/pages/Admin.jsx`
- `frontend/public/service-worker.js`
- `frontend/public/bonus-match/pieces/*`
- `frontend/public/bonus-match/obstacles/*`
