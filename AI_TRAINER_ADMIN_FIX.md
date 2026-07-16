# AI trainer fixes

- Voice recognition now clears the previous draft before every new microphone recording.
- Completed AI training results are saved to MongoDB with the authenticated user's name and full operator/client/coach conversation.
- Added `POST /api/ai-training/results`.
- Added `GET /api/admin/ai-training-dashboard`.
- Admin > AI команда now displays team statistics, employee names, progress, and expandable saved conversations.

Note: conversations completed before this update were not stored and cannot be reconstructed automatically. New completed sessions will appear after deployment.
