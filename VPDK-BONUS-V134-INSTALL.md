# VPDK Bonus v134 — правильна жіноча алмазна рамка

Версія v134 створена на базі v133.

## Що змінено

- Для всіх трьох жіночих алмазних аватарок використовується точний файл рамки, наданий користувачем:
  - `frontend/public/avatar-frames/diamond-female-floral-v134.webp`
- Чоловіча алмазна аватарка й надалі використовує:
  - `frontend/public/avatar-frames/diamond-male.png`
- Портрет і рамка залишаються окремими шарами.
- `avatar_rarity` залишається `diamond`.
- Компонент `AvatarFrame` автоматично визначає чоловічий або жіночий варіант за `avatar_url`.
- Змінено ім’я файлу рамки та версію Service Worker, щоб браузер не показував старий закешований ресурс.

## Встановлення

1. Розгорнути frontend/Netlify з цього пакета.
2. Backend залишити з v133.
3. Google Apps Script не змінювати.
4. Після деплою виконати `Ctrl + Shift + R` або повністю закрити й відкрити PWA.

## Очікувана логіка

- `male-diamond-1.webp` → `diamond-male.png`
- `female-diamond-1.webp` → `diamond-female-floral-v134.webp`
- `female-diamond-2.webp` → `diamond-female-floral-v134.webp`
- `female-diamond-3.webp` → `diamond-female-floral-v134.webp`
