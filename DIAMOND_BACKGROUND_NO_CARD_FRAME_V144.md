# VPDK Bonus v144 — diamond background without rectangular card frame

## Зміна концепції

Прямокутна декоративна рамка працівника повністю видалена з інтерфейсу.

Алмазна аватарка й надалі працює двошарово:

- `avatar_url` — портрет;
- `avatar_rarity: "diamond"` — кругла алмазна рамка аватарки через `AvatarFrame`.

Але навколо всієї картки працівника більше не малюється PNG-рамка.

## Нове оформлення карток

У кожному компоненті з класом `diamond-card-auto`, де всередині є `AvatarFrame` з рідкісністю `diamond`, автоматично застосовується фон у стилі преміальної події стрічки активності:

- темний синьо-фіолетовий градієнт;
- блакитне світіння;
- фіолетова aurora;
- м’який анімований відблиск;
- адаптивне оформлення без залежності від висоти або ширини картки.

Це працює на профілі, у LeaderBoard, стрічці активності, рейтингах, звітах та адмінських списках, де вже використовується `diamond-card-auto`.

## Що видалено

- `frontend/public/card-frames/diamond-employee-card-v137.png`
- `frontend/src/assets/card-frames/diamond-employee-card-v137.png`
- CSS `border-image` для прямокутної рамки;
- анімацію `diamond-card-frame-breathe`;
- спеціальні відступи v143, створені для великої декоративної рамки;
- precache старої рамки в Service Worker.

## Змінені файли

- `frontend/src/index.css`
- `frontend/public/service-worker.js`
- `frontend/src/pages/Home.jsx`
- `frontend/src/components/FeedItem.jsx`

## Кеш

Service Worker оновлено до `vpdk-v144`.
