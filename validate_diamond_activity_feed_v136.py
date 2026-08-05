from pathlib import Path

ROOT = Path(__file__).resolve().parent
backend = (ROOT / 'backend/server.py').read_text()
feed_item = (ROOT / 'frontend/src/components/FeedItem.jsx').read_text()
feed_page = (ROOT / 'frontend/src/pages/Feed.jsx').read_text()
css = (ROOT / 'frontend/src/index.css').read_text()
sw = (ROOT / 'frontend/public/service-worker.js').read_text()
pwa = (ROOT / 'frontend/src/lib/pwa.js').read_text()

assert '"diamond_avatar"]' in backend
assert 'await db.feed_events.insert_one({' in backend
assert '_backfill_active_diamond_feed_events_v136' in backend
assert 'await db.feed_events.create_index("source_key", unique=True, sparse=True)' in backend
assert '"kind": "diamond_avatar"' in backend
assert '"avatar_rarity": "diamond"' in backend
assert '"daily_bonus": DIAMOND_AVATAR_DAILY_BONUS' in backend
assert '"task_replacements": DIAMOND_AVATAR_TASK_REPLACEMENTS' in backend
assert 'showcase_events = await db.feed_events.find' in backend
assert 'explicit = await db.feed_events.find_one' in backend
assert 'kind="diamond_avatar"' not in backend  # collection data drives the kind

assert 'diamond_avatar:' in feed_item
assert 'Особлива нагорода адміністратора' in feed_item
assert '+{ev.daily_bonus} Point щодня' in feed_item
assert '+{ev.task_replacements} замін' in feed_item
assert 'diamond-feed-card' in feed_item
assert '<AvatarFrame' in feed_item
assert 'rarity={ev.avatar_rarity}' in feed_item
assert '{ key: "diamond_avatar", label: "Алмазні"' in feed_page

assert '.diamond-feed-card' in css
assert '@keyframes diamond-feed-shine' in css
assert '@media (prefers-reduced-motion: reduce)' in css
assert 'const VERSION = "vpdk-v136";' in sw
assert '/service-worker.js?v=136' in pwa

print('v136 diamond activity feed validation passed')
