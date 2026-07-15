# TM6 Bonus update

## Branding and mobile
- `GAME HUB` / `CallHub` replaced with `TM6 Bonus` in the interface, login, PWA manifest and browser metadata.
- Removed the small `CALL HUB` label from the top header.
- Added the approved TM6 Bonus PWA icon for Android and iPhone, maskable icon, favicon and branded splash screens.
- The top header now respects `safe-area-inset-top` on iPhone and has larger 48px touch targets.
- Notification panel also opens below the iPhone status area.

## Manager dashboard
A new **AI команда** tab is available in the admin panel. It shows:
- operator ranking;
- team average score;
- weak sales skills across the team;
- employees who have not trained for 7+ days or have never trained;
- recent score progress for every employee.

Completed AI cases are now saved to the backend in `ai_training_results`. Historical local-only cases completed before this update cannot be reconstructed automatically; the dashboard begins accumulating shared team data after deployment.

## Deployment
Both frontend and backend must be redeployed because the update adds new FastAPI endpoints and a MongoDB collection.
