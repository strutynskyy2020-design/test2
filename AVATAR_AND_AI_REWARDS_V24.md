# TM6 Bonus v24

## Avatar
- Avatar is resized in the browser to maximum 512 px and saved as a compact JPEG data URL in the user record.
- The photo no longer depends on temporary backend local storage, so it survives redeploys.
- Broken images fall back to user initials instead of showing the browser's broken-image icon.
- The picker accepts JPG, PNG and WEBP, which browsers reliably display.

## AI Trainer rewards
- Successful AI cases now credit scenario Point to the user's real `balance` and `total_earned`.
- Earned XP is credited to `total_xp` for both successful and unsuccessful completed cases.
- A transaction with kind `ai_training` is written to the common history.
- The frontend refreshes `/auth/me` after saving a result so the home balance is updated immediately.
