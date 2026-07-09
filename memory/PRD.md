# CallHub Game Hub — PRD

## Roles
- `employee`: Home / Quests / Store / Leaderboard + /fun + /history
- `admin`: same + `/admin` (accessible via Shield in header)

## Tech stack
- Frontend: React 19, React Router 7, TailwindCSS 3, Shadcn/UI, sonner (bottom-center), canvas-confetti, lucide-react, axios
- Backend: FastAPI + Motor (async MongoDB), pyjwt, bcrypt
- Fonts: Unbounded (display) + Nunito (body)

## Backend endpoints
- Auth: `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/register` (admin only)
- Employee: `GET /api/quests`, `POST /api/quests/{id}/claim`, `GET /api/prizes`, `POST /api/prizes/{id}/buy`, `GET /api/orders`, `GET /api/transactions`
- Leaderboard: `GET /api/leaderboard?period=week|month|all` (my_entry populated only if not in top-10)
- Games: `GET /api/games/status`, `POST /api/games/cube/spin` (once/day, weighted tiers), `POST /api/games/prediction/reveal` (idempotent, deterministic per user+day)
- Admin: `/api/admin/users`, `/api/admin/users/{id}/points`, CRUD on `/api/admin/quests`, `/api/admin/prizes`, `/api/admin/orders`, `GET /api/admin/analytics`
- Bot (X-Bot-Token header): `/api/bot/health`, `/api/bot/link`, `/api/bot/user/{tg}`, `/api/bot/user/{tg}/quests`, `/api/bot/leaderboard`, `/api/bot/adjust`

## Collections
- users (email unique, telegram_id sparse)
- quests, prizes (soft `active` flag)
- orders, transactions (indexed by user+created_at)
- daily_progress (user+date unique), daily_games (user+date unique)

## Implemented — Phase 1..3

### Phase 1 (2026-02, mock only)
- [x] Login, Home (profile/XP/balance/streak/achievements), Quests, Store

### Phase 2 (2026-02)
- [x] FastAPI + MongoDB backend, JWT auth, 2 roles
- [x] Admin panel (analytics, users, quests, prizes, orders CRUD)
- [x] Telegram bot API endpoints
- [x] Hybrid mock-fallback

### Phase 3 (2026-02)
- [x] Leaderboard page — 3 periods (week/month/all), self-highlight, my_entry for out-of-top
- [x] Fun page — Щедрий Куб (weighted tiers 55/30/12/3%, once/day) + Prediction of the day (25 UA phrases, deterministic per user+day)
- [x] History page — filterable transaction log (all/plus/minus), kind icons, current balance
- [x] Home restructured: cube CTA banner, balance-card clickable → history
- [x] Admin moved to header Shield icon; bottom-nav now Home/Quests/Store/Leaderboard for everyone

### Phase 4 (2026-07) — PWA + Motivational Feed
- [x] **PWA support**: manifest.json, service-worker.js (network-first API, cache-first static), arcade-styled icons (192/512/maskable/apple-touch), iOS splash screens, iOS meta tags (apple-mobile-web-app-capable, status-bar-style, viewport-fit=cover)
- [x] **InstallPrompt** component — dismissible bottom sheet, iOS Safari shows Share→Add-to-Home-Screen steps, Chrome/Android triggers beforeinstallprompt native flow, 7-day dismiss cookie
- [x] **Motivational Feed** at `/feed` — aggregates transactions, orders (delivered), and level-up events (derived from cumulative XP replay). Filter chips: all/quest/level_up/purchase/cube. Shown to all users via 5th bottom-nav item (Newspaper icon)
- [x] Backend `GET /api/feed?limit=N` — 5 event kinds, sorted desc, joined with user info
- [x] Toaster repositioned back to top-center with `offset={{ top: 96 }}` — fixes bottom-nav being blocked by toast for 4s after login

## Backlog

### P0
- [ ] Streak auto-increment on daily login + multiplier bonus (3/7/30 days)
- [ ] Team/department leaderboard

### P1
- [ ] Persist `level_up` events as first-class rows (currently derived by XP replay on every /api/feed call — brittle & O(users×txs))
- [ ] Feed pagination / "load more" — currently caps at 60 events
- [ ] Split server.py into modules (auth/quests/prizes/games/feed/admin/bot) — server.py is 1273 lines
- [ ] Compound index on transactions.(created_at desc) for feed scaling
- [ ] Change cube transactions from kind='quest' to kind='game' (cleaner analytics)
- [ ] Real-time notifications
- [ ] Push notifications to Telegram from web
- [ ] Refresh token / expiry UX
- [ ] Analytics charts (line/bar)
- [ ] User settings: change password, upload avatar

### P2
- [ ] Team-lead role
- [ ] Sound effects
- [ ] Telegram Login Widget SSO
- [ ] Onboarding tutorial

## Test credentials
See `/app/memory/test_credentials.md`.
