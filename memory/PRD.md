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

## Phase 5 (2026-07) — Corporate Motivation Scale-up: CORE (Phase 1 of roadmap) ✅
Built ON TOP of existing app; nothing removed.
- [x] **Task Constructor** (admin): dynamic-field builder — text, textarea, number, date, phone, email, select(options), checkbox, file, photo, photos(multi), video. Reorder/required/category/reward/xp. `GET/POST/PATCH/DELETE /api/admin/tasks`.
- [x] **Applications (заявки)** lifecycle: Draft → Submitted → Pending Review → Approved → Rejected. `POST/GET/PATCH/DELETE /api/applications`, admin `/api/admin/applications`, `/start`, `/review`. Approval auto-awards balance+XP+transaction (shows in feed). Rejection requires reason.
- [x] **Camera/gallery/file upload** in task forms via `TaskFormField.jsx` (accept + capture="environment", multi-file), stored on local disk via existing `/api/uploads`.
- [x] **Registration with admin approval**: `/api/auth/register/self` now sets `approved=False`, returns pending message (no auto-login). Login blocked (403) until approved. Signup bonus granted on approval.
- [x] **User moderation** (admin 'Модерація' tab): `GET /api/admin/users/pending`, `POST /api/admin/users/{id}/approve`.
- [x] **Teams page** `/teams`: ranking + stats + progress bars (uses existing `/api/leaderboard/teams`).
- [x] **In-app notifications**: `notifications` collection, `GET /api/notifications`, `unread_count`, `read-all`, `PATCH /{id}/read`. Header bell w/ badge (`NotificationBell.jsx`). Events: new_task, application_submitted, application_approved, application_rejected, user_pending, account_approved.
- [x] Bottom nav updated: Головна / Завдання(/tasks) / Стрічка / Магазин / Рейтинг. Daily quests remain at /quests (linked from Tasks page).
- Verified: `/app/backend/tests/test_phase6.py` (14/14) + Playwright E2E (100%).

## Phase 6 (2026-07) — Social: Reactions + Comments ✅
- [x] **Reactions** on feed activities: like, fire, clap, rocket, heart, laugh, star (lucide icons, not emoji). One reaction per user per item (toggle/replace). `POST /api/feed/{event_id}/react`. Feed enriched with reactions summary + my_reaction.
- [x] **Comments** under activities: `GET/POST /api/feed/{event_id}/comments`, `DELETE /api/comments/{id}` (own or admin). comment_count on feed items.
- [x] Notifications to activity owner on cross-user reaction/comment (kinds: reaction, comment). `FeedSocial.jsx` component.
- Verified: 10/10 backend tests + Playwright E2E (100%).

## Remaining roadmap (next phases)
### P0 (next)
- [ ] Achievements expansion: 100+, categories, hidden, progress bars, %, rarity tiers
### P1
- [ ] Analytics: user activity, task completion, task popularity, avg completion time, charts (recharts already installed)
- [ ] Leaderboard by XP/level/points + week/month/season windows
- [ ] Store upgrade: categories, stock, photos, purchase history, moderation
- [ ] Extended profile: stats, history, reactions received, achievement collection, titles, avatar frames
- [ ] Notifications for purchases + full notification center page
### Known non-blocking
- [ ] backend_test.py::TestBotAPI uses stale hardcoded BOT_TOKEN (pre-existing test artifact; bot endpoints work)
- [ ] test_phase5.py self-register tests expect old token response (update when revisited)

## Old Backlog (pre-scale-up)

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
