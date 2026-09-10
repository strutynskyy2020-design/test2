# Pixel Drive v3 result saves and optional replay tools

Production saves accept the browser's reported outcome. They do not replay physics, start Node, or fall back to a replay when a result is missing. Python retains session ownership, configured prices, reward calculation and atomic persistence. The browser's gameplay physics is unchanged.

## Production contract

Status and start return `result_mode: "client"`. Public progress includes `save_scope`, an opaque hash of the authenticated account ID; this scopes the browser's pending-save queue to the account. The local adapter uses scope `local` and never imports its wallet into an authenticated balance.

Submit `POST /games/pixel-drive/sessions/{session_id}/finish` with:

```json
{"ticks": 120, "abandon": false, "outcome": {"status": "failed", "reason": "fuel", "distance": 30, "gears": [0, 1], "checkpoints": [], "fuelSeconds": 0, "analysis": []}}
```

A success returns `{result_mode, outcome, receipt, progress}`. The receipt remains authoritative for the currency actually credited. The outcome is normalized before storage:

- An abandoned run becomes failed/abandoned. A reported completion becomes completed/finish and its distance becomes the route length. Other distances are finite, clamped to 0–route length and floored; invalid numeric values become zero.
- Pickup and checkpoint IDs are filtered against the configured route, deduplicated and sorted. Currency totals and medals are derived again on the server; supplied `coinValue`, `fuel` and `medals` do not set the reward.
- Fuel seconds are finite and clamped to the saved vehicle capacity. Fuel percentage is derived from that capacity.
- Stage metadata comes from the stored session, with a configuration fallback for old records. Ticks come from the request. Informational analysis is limited to three messages, 40 Unicode codepoints for the type and 400 for the message; ASCII control characters are removed.
- Outcome JSON is limited to 32 KiB. Tick count remains a strict integer from 1–43,200 and must fit the route's own limit and the elapsed session time (with the existing 0.5-second tolerance).

These are lightweight format, range and session checks. They do not establish whether a player really reached the reported distance, collected an item or finished a route. Consequently, a modified browser can fabricate game progress and associated Pixel campaign credits. This is the deliberate tradeoff of disabling gameplay verification.

Old input-log-only submissions receive HTTP 409 with `detail.code = "result_contract_changed"` and a message to refresh the page. No hidden replay is performed. A superseded attempt receives HTTP 409 with `detail.code = "run_superseded"`. Wrong ownership, expired sessions and stale game versions remain rejected.

## Economy and migration

`pixel_drive_progression.py` performs production migration, awards and purchases without subprocesses. `progression.js` provides the same rules for local play. Tests compare both implementations for legacy migrations, all seven routes, repeated rewards and all 40 configured purchase prices.

The campaign has tutorial ID 1 and six main routes 2–7. Development course 0 cannot receive API rewards. The `wanderer` vehicle has four upgrades from 0 to 10; `vehicles.wanderer.upgrades` and the legacy top-level `upgrades` alias update together. Each part uses its configured ten-price array.

Ordinary coins pay once per run and can pay again next run. Checkpoints and the first finish pay once per stage. Failed runs retain their reported collected coins and checkpoints. Medals and best distance remain records. The receipt exposes total currency as `parts`, plus `coin_parts`, `checkpoint_parts`, `finish_parts`, `new_record` and `previous_best`.

Existing v1/v2 profiles migrate once through a revision compare-and-swap: preserve balance, map old ranks 1–5 to 0–4, archive previous records and purchases under `legacy`, grant the tutorial finish reward as a welcome credit and open route 2. The tutorial reward is marked claimed but no finish medal is fabricated. Old main-stage finishes do not unlock the new main routes.

## Durable received results and retry recovery

The server stores the received normalized outcome and the finish-payload hash before applying currency. A profile compare-and-swap applies its wallet and records together with one `pending_award` receipt. That outbox entry is copied into its matching session before another award replaces it. Purchases preserve the marker and use the same revision check. The session-attempt nonce prevents an expired receipt from being attached to a reused request ID.

Primary reads and a second receipt read after the profile read prevent a late concurrent finisher from awarding the same run again. The wallet contains at most one pending award, seven bounded track records and 40 new purchase receipts; it does not accumulate a reward receipt per repeated run.

`GET /games/pixel-drive/status` now settles an existing profile outbox and processes at most 20 received session rows per request. Unpaid finished outcomes take priority, followed by receipts whose durable Pixel campaign event has not been recorded. This recovery does not need the original browser payload. Old v3 outcomes previously accepted by replay can also recover this way. `recovery_pending` indicates that another bounded recovery batch or a temporarily unavailable story write remains.

A story-event write failure after the wallet receipt is committed does not turn a successful wallet save into an error. A later status request retries that event; its existing unique key prevents duplicate campaign credit. The campaign continues to consume completed runs and historic finish records under the same rules.

Only one attempt is active per account and game version, enforced by a partial unique MongoDB index. A new start supersedes the old active run, while retrying the same start ID is idempotent. Received finished results remain recoverable and are not superseded. Active attempts last one hour; session receipts retain the seven-day TTL.

The frontend stores pending submissions before sending them and retries the same session/payload after a transient error or reload. That browser queue is an additional safeguard: server recovery is responsible once an outcome has already reached the database.

## Deploying production saves

Include these modules with the normal Python backend:

- `pixel_drive_feature.py`, `pixel_drive_game.py`
- `pixel_drive_progression.py`, `pixel_drive_result.py`
- `pixel_drive_config.json`

Node and the compiled replay bundle are **not required by production start, status, finish or upgrade requests**. Deploy the new frontend and backend contract together and restart the Python service after copying configuration. Old browser tabs must refresh. Do not mix old replay-only and new client-result backend writers during rollout.

## Optional developer replay tools

The exact browser Planck 1.5.0 engine and its standalone Node bundle remain available for physics regression tests and developer investigation only. Build/check from the repository root:

```sh
node backend/scripts/build_pixel_drive_runtime.cjs
node backend/scripts/build_pixel_drive_runtime.cjs --check
```

The build copies matching configuration, license and source hashes. Developer replay requires Node 24+ (tested 24.18.0), available on PATH or through the absolute `PIXEL_DRIVE_NODE` executable path. The wrapper removes inherited `NODE_OPTIONS` and `NODE_PATH`, uses no shell, limits input/output, bounds workers to two per process and gives each developer replay a 30-second timeout and 128 MB V8 old-space limit. None of these developer worker checks runs on a production save.
