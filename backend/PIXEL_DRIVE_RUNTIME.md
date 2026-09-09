# Pixel Drive v3 runtime and progression

The authoritative replay runs the exact browser JavaScript engine and vendored Planck 1.5.0. The same bundle also contains `progression.js`, the pure economy calculator used by local storage. Python handles authentication, sessions and atomic MongoDB updates; it does not approximate the physics or maintain a second reward formula. Clients submit only a level ID and input transitions. The server supplies the saved upgrade snapshot; client scores, currency, body coordinates and custom terrain are rejected.

## Build the release

From the repository root, with the frontend build dependencies installed:

```sh
node backend/scripts/build_pixel_drive_runtime.cjs
node backend/scripts/build_pixel_drive_runtime.cjs --check
```

Webpack is already supplied by the frontend build toolchain. The script bundles the vendored physics library, engine and tracks into one CommonJS file. It also copies the matching configuration and license and writes source/bundle hashes. No npm install or frontend directory is needed on the Python server at runtime.

Include these files with the other backend Python modules in the release:

- `pixel_drive_game.py` and `pixel_drive_feature.py`
- `pixel_drive_runtime.cjs`
- `pixel_drive_runtime.manifest.json`
- `pixel_drive_runtime.LICENSE.txt`
- `pixel_drive_config.json`

Install Node.js 24 or newer on the backend host, matching Planck 1.5.0's declared engine requirement, alongside the existing Python dependencies. This implementation was tested with Node 24.18.0. Expose `node` on the service PATH, or set `PIXEL_DRIVE_NODE` to the absolute executable path, for example `/usr/bin/node` or `C:\Program Files\nodejs\node.exe`. Do not set this to a command string or include arguments. The executable is launched without a shell and inherited `NODE_OPTIONS`/`NODE_PATH` are removed. The health check rejects unsupported Node major versions. After deployment, restart the Python service to load the matching config.

Check the actual backend environment before serving new runs:

```sh
cd backend
python -c "from pixel_drive_game import ensure_runtime; ensure_runtime(); print('Pixel Drive replay ready')"
```

The frontend and backend must be released together whenever physics or reward configuration changes. Increment `CONFIG.version` for every subsequently released change. An old active session is rejected with HTTP 409. Completed old sessions that already have a receipt continue to return it; they do not receive rewards from the new campaign.

Upgrade and restart all Python workers before enabling v3 profile migrations. Mixed v2/v3 backend writers are not a supported rollout: an old binary does not know the new upgrade prices or profile fields. The concurrency guarantees below apply to workers running this v3 protocol.

## Economy and migration

The campaign has seven stage IDs: tutorial 1, then six main routes 2–7. Development course 0 cannot be started or rewarded through this API. The vehicle is `wanderer`; its four upgrades range from 0 to 10. `vehicles.wanderer.upgrades` stores the vehicle's profile and the top-level `upgrades` field remains a compatible alias. Purchases update both in the same atomic write. Each part uses its configured ten-price array.

Ordinary coin indices may pay once in each run and return on the next start. Their values come from `coinValues`; the server never trusts the submitted or displayed coin total. Checkpoints and the first finish pay once per stage. Losing a run keeps collected coins and reached checkpoints. Medals, best distance and attempts remain records; medals do not add a second implicit currency reward. API `receipt.parts` remains the total currency award and includes separate `coin_parts`, `checkpoint_parts`, `finish_parts`, `new_record` and `previous_best` fields.

An existing v1/v2 profile is migrated once using a revision compare-and-swap:

- Preserve its balance without exchange or rounding.
- Map each previously paid 1–5 upgrade rank to 0–4. No paid part is removed.
- Archive old tracks, upgrades, balance and purchase receipts under `legacy`. Unknown original versions are labelled `pre-3`, not assigned an invented version number.
- Grant the current tutorial finish reward once as a welcome credit and set `tutorial_granted`. This opens stage 2; the tutorial remains playable.
- Mark only the tutorial finish reward as claimed. Its finish medal stays empty until an actual new tutorial completion. Old main-stage finishes never unlock new main stages.

The local storage adapter uses this same migration and calculator. Local currency is separate from authenticated currency and is never imported into server balances. Browser Web Locks serialize updates across tabs where supported; a promise queue serializes multiple adapters in the same context. At most 100 local session receipts are retained, and unavailable storage is explicitly reported as memory mode.

Only one run is active per player and game version. A new start supersedes the previous active attempt; repeating the same start request remains idempotent. This lets a reloaded page start immediately and prevents many overlapping sessions from earning coins after only one shared wait. A partial unique MongoDB index enforces the rule under simultaneous starts. Previously earned balances and finished receipts are unaffected. Finishing a superseded attempt returns HTTP 409 with `detail.code = "run_superseded"`; the UI returns to the garage instead of repeatedly retrying. Local storage follows the same behavior.

## Exactly-once server awards without a growing profile ledger

The validated outcome and finish-payload hash are stored in the session first. A profile compare-and-swap then applies its currency and records together with one `pending_award` receipt. That outbox entry must be copied into its session before the next award may replace it. A crash before the receipt copy is recovered from the pending entry; a lost HTTP response is recovered from the durable session receipt. Purchases may update the balance concurrently because they preserve the pending entry and use the same revision check.

Profile and session reads explicitly use the MongoDB primary. A finisher rechecks the session receipt **after** reading a profile with no pending entry. This ordering is essential: another finisher could have copied the receipt and cleared the outbox between the initial session read and the profile read. An earlier profile revision instead fails compare-and-swap. A deterministic concurrency test pauses a request at exactly that boundary to verify that it cannot award twice.

The pending entry includes the unique session-attempt nonce. If a session expires and its request ID is eventually reused, an old pending receipt cannot be written into the new attempt. The profile contains at most one pending award, seven bounded track records and at most 40 new purchase receipts for the current vehicle. It never accumulates one embedded receipt per repeated coin run. Sessions retain their existing seven-day TTL; replay after a receipt has expired returns 404. Active sessions allow one hour for a run and pauses.

## Resource limits and failures

- Fixed physics tick: 60 Hz; an API submission is bounded by 43,200 ticks and 43,200 input transitions (12 minutes). Each route's configured limit may be lower and is checked again by replay.
- Two replay subprocesses at a time per Python process; additional callers receive HTTP 503 with a short retry interval.
- Each subprocess has a 30-second timeout and 128 MB V8 old-space limit. The timeout terminates and reaps the child.
- Requests are capped at 1 MiB and runtime replies at 256 KiB. The runtime parses structured JSON; it never evaluates user code or accepts a user-selected executable, module or filename.
- Missing Node, stale/corrupt bundle, timeout and worker errors return HTTP 503. They cannot produce an accepted client score or an award. A start health check prevents issuing a new session when the worker is unavailable.
- The existing session/profile receipts and revision compare-and-swap remain responsible for idempotency. Retry the same finish payload after a temporary worker failure.

The generated bundle is intentionally committed as a backend artifact. Run `--check` in release checks to catch any engine, config, vendor or entrypoint edit that has not been rebuilt.

On the local Node 24.18.0 host, a synthetic 43,200-step run of the final-stage world took 3.476 seconds with a peak process RSS of 111,368 KiB under the 128 MB V8 old-space setting. This benchmark kept physics stepping after terminal conditions and replenished fuel only inside its test loop; it is a capacity check, not a valid campaign run or a proof of the worst possible execution time. The 30-second worker deadline remains enforced independently. Raw measurement: `artifacts/pixel-drive-v3-runtime-benchmark.json`.
