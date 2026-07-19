# TM6 Bonus v33 — Avatar Store

## Added

- 20 purchasable illustrated avatars: 5 male and 15 female.
- Five rarity levels with editable prices in Admin → Prizes.
- Avatar perks:
  - Basic: no daily perk.
  - Improved: +5 Point every day.
  - Rare: +10 Point every day.
  - Epic: +15 Point every day and +1 extra task replacement.
  - Legendary: +25 Point every day and +2 extra task replacements.
- Purchased avatars are permanent and can be re-equipped for free.
- Avatar purchase equips it immediately and updates profile/leaderboard images.
- Custom avatar upload is disabled in registration, profile UI, and backend endpoint.
- Avatar catalog is upserted on backend startup with stable IDs; admin-edited prices are preserved.

## Avatar assets

Located in `frontend/public/avatars/` as optimized WebP files.
