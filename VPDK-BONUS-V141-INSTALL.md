# VPDK Bonus v141 — виправлення Netlify build

## Причина помилки

`frontend/src/index.css` посилався на файл із `frontend/public` через CSS URL:

```css
url("/card-frames/diamond-employee-card-v137.png")
```

Під час production-збірки CRA/css-loader намагався трактувати абсолютний шлях як модуль і завершувався помилкою `Module not found`.

## Виправлення

Рамку додано до:

```text
frontend/src/assets/card-frames/diamond-employee-card-v137.png
```

CSS тепер використовує збірний відносний шлях:

```css
url("./assets/card-frames/diamond-employee-card-v137.png")
```

Service Worker оновлено до `vpdk-v141`.

## Встановлення

1. Розгорніть frontend/Netlify з пакета v141.
2. Backend залишається версії v140.
3. Google Apps Script залишається без змін.
4. Після успішного deploy повністю закрийте PWA та відкрийте знову або виконайте `Ctrl + Shift + R`.
