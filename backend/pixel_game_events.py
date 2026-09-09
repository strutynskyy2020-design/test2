"""Compact, durable proof of server-validated wins (game sessions expire)."""
from datetime import timezone
from hashlib import sha256

from pymongo.errors import DuplicateKeyError


async def record_campaign_win(db, game, session, level):
    if session["outcome"]["status"] != "completed":
        return
    # Older finished sessions have no completion timestamp. Their start is a
    # conservative fallback: replaying an old receipt must not advance a new quest.
    at = session.get("completed_at", session["created_at"])
    if not isinstance(at, str):
        at = at.replace(tzinfo=at.tzinfo or timezone.utc).isoformat()
    session_id = session["_id"]
    row = {"_id": sha256(f"{game}:{session_id}".encode()).hexdigest(),
           "id": session_id, "user_id": session["user_id"], "game": game,
           "level": int(level), "completed_at": at}
    try:
        await db.pixel_campaign_runs.insert_one(row)
    except DuplicateKeyError:
        pass
