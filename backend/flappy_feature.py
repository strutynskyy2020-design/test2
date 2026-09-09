"""Authenticated, user-owned Flappy campaign progress. No currency or pet writes."""
import hashlib
import json
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, StrictInt
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

try:
    from backend.pixel_game_events import record_campaign_win
except ModuleNotFoundError as exc:
    if exc.name != "backend":
        raise
    from pixel_game_events import record_campaign_win

try:
    from .flappy_game import VERSION, NAMES, level_config, replay
except ImportError:
    from flappy_game import VERSION, NAMES, level_config, replay


def now():
    return datetime.now(timezone.utc)


class StartBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    level: StrictInt = Field(ge=1, le=len(NAMES))
    request_id: str = Field(min_length=8, max_length=80, pattern=r"^[A-Za-z0-9_-]+$")


class FinishBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ticks: StrictInt = Field(ge=1, le=6000)
    flaps: list[StrictInt] = Field(default_factory=list, max_length=600)


async def seed_flappy(db):
    await db.flappy_profiles.create_index("user_id", unique=True)
    await db.flappy_sessions.create_index("purge_at", expireAfterSeconds=0)
    await db.flappy_sessions.create_index([("user_id", 1), ("created_at", -1)])


def register_flappy_routes(api, db, get_current_user):
    async def profile(user_id):
        return await db.flappy_profiles.find_one({"user_id": user_id}, {"_id": 0}) or {}

    async def status(user_id):
        saved = await profile(user_id)
        completed = sorted(int(key) for key, value in saved.get("completed", {}).items() if value)
        unlocked = 1
        while unlocked in completed and unlocked < len(NAMES):
            unlocked += 1
        return {"version": VERSION, "unlocked_level": unlocked, "completed": completed,
                "best": saved.get("best", {}), "levels": [level_config(i) for i in range(1, len(NAMES) + 1)]}

    @api.get("/games/flappy/status")
    async def get_status(user: dict = Depends(get_current_user)):
        return await status(user["id"])

    @api.post("/games/flappy/start")
    async def start(body: StartBody, user: dict = Depends(get_current_user)):
        # Stable ID makes a lost start response retryable without creating another run.
        session_id = hashlib.sha256(f"flappy:{user['id']}:{body.request_id}".encode()).hexdigest()
        existing = await db.flappy_sessions.find_one({"_id": session_id})
        if existing:
            if existing["level"]["id"] != body.level:
                raise HTTPException(409, "Цей запит уже використано для іншого рівня")
            if existing["status"] != "active" or existing["expires_at"].replace(tzinfo=timezone.utc) <= now():
                raise HTTPException(409, "Сесію завершено. Почніть новий політ")
            return {"session_id": session_id, "level": existing["level"], "expires_at": existing["expires_at"].replace(tzinfo=timezone.utc).isoformat()}
        progress = await status(user["id"])
        if body.level > progress["unlocked_level"]:
            raise HTTPException(403, "Спочатку пройдіть попередній рівень")
        created = now()
        session = {"_id": session_id, "user_id": user["id"], "level": level_config(body.level),
                   "status": "active", "created_at": created, "expires_at": created + timedelta(minutes=30),
                   "purge_at": created + timedelta(days=7)}
        try:
            await db.flappy_sessions.insert_one(session)
        except DuplicateKeyError:
            return await start(body, user)
        return {"session_id": session_id, "level": session["level"], "expires_at": session["expires_at"].isoformat()}

    @api.post("/games/flappy/sessions/{session_id}/finish")
    async def finish(session_id: str, body: FinishBody, user: dict = Depends(get_current_user)):
        session = await db.flappy_sessions.find_one({"_id": session_id, "user_id": user["id"]})
        if not session:
            raise HTTPException(404, "Політ не знайдено")
        digest = hashlib.sha256(json.dumps(body.model_dump(), sort_keys=True).encode()).hexdigest()
        if session["status"] == "active":
            clock = now()
            if session["expires_at"].replace(tzinfo=timezone.utc) <= clock:
                raise HTTPException(409, "Час сесії минув. Почніть новий політ")
            elapsed = (clock - session["created_at"].replace(tzinfo=timezone.utc)).total_seconds()
            if body.ticks / 60 > elapsed + 0.5:
                raise HTTPException(422, "Час польоту не відповідає сесії")
            try:
                outcome = replay(session["level"], body.flaps, body.ticks)
            except ValueError as exc:
                raise HTTPException(422, str(exc)) from exc
            changed = await db.flappy_sessions.find_one_and_update(
                {"_id": session_id, "user_id": user["id"], "status": "active"},
                {"$set": {"status": "finished", "outcome": outcome, "digest": digest, "completed_at": clock}},
                return_document=ReturnDocument.AFTER)
            session = changed or await db.flappy_sessions.find_one({"_id": session_id, "user_id": user["id"]})
        if session.get("digest") != digest:
            raise HTTPException(409, "Для цього польоту вже збережено інший результат")
        outcome = session["outcome"]
        key = str(session["level"]["id"])
        update = {"$setOnInsert": {"user_id": user["id"]}, "$max": {f"best.{key}": outcome["passed"]}}
        if outcome["status"] == "completed":
            update["$set"] = {f"completed.{key}": True}
        # These updates commute across tabs and are safe to repeat if the response is lost.
        try:
            await db.flappy_profiles.update_one({"user_id": user["id"]}, update, upsert=True)
        except DuplicateKeyError:
            await db.flappy_profiles.update_one({"user_id": user["id"]}, update)
        await record_campaign_win(db, "flappy", session, session["level"]["id"])
        return {"outcome": outcome, "progress": await status(user["id"])}
