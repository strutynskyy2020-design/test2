"""Campaign progress with a bounded, crash-recoverable atomic award outbox."""
import hashlib
import json
import logging
import uuid
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictBool
from pymongo import ReturnDocument, ReadPreference
from pymongo.errors import DuplicateKeyError
from starlette.concurrency import run_in_threadpool

try:
    from backend.pixel_game_events import record_campaign_win
except ModuleNotFoundError as exc:
    if exc.name != "backend":
        raise
    from pixel_game_events import record_campaign_win
try:
    from .pixel_drive_game import (CONFIG, ReplayUnavailable, ensure_runtime, fresh_upgrades,
                                  level_config, replay, migrate_progress, award_progress, purchase_progress)
except ImportError:
    from pixel_drive_game import (CONFIG, ReplayUnavailable, ensure_runtime, fresh_upgrades,
                                 level_config, replay, migrate_progress, award_progress, purchase_progress)

logger = logging.getLogger(__name__)
SCHEMA = 3
VEHICLE = "wanderer"


def unavailable(exc):
    logger.warning("Pixel Drive replay unavailable: %s", exc)
    return HTTPException(503, "Перевірка гри тимчасово недоступна. Спробуйте ще раз", headers={"Retry-After":"2"})


def superseded():
    return HTTPException(409, {"code":"run_superseded", "message":"Заїзд замінено новою спробою в цій або іншій вкладці. Поверніться до гаража."})


def now():
    return datetime.now(timezone.utc)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def new_profile(user_id):
    upgrades = fresh_upgrades()
    return dict(_id=user_id, revision=0, profile_schema=SCHEMA, vehicle_id=VEHICLE,
                balance=0, upgrades=upgrades, vehicles={VEHICLE:{"upgrades":deepcopy(upgrades)}},
                tracks={}, tutorial_granted=False, migration=None, purchases={})


def public_profile(profile):
    tracks = profile["tracks"]
    unlocked = 2 if profile.get("tutorial_granted") else 1
    while unlocked < len(CONFIG["levels"]) and "finish" in tracks.get(str(unlocked), {}).get("medals", []):
        unlocked += 1
    return dict(version=CONFIG["version"], profile_schema=SCHEMA, vehicle_id=VEHICLE,
                balance=profile["balance"], upgrades=profile["upgrades"], vehicles=profile["vehicles"],
                tracks=tracks, tutorial_granted=profile.get("tutorial_granted", False), migration=profile.get("migration"),
                unlocked_level=unlocked, levels=[{k:l[k] for k in ("id", "name", "meters", "hint", "recommended", "stageId", "seed", "generatorVersion") if k in l} for l in CONFIG["levels"]])


def award_run(profile, session_id, level_id, outcome, attempt_id=None):
    """Only one pending receipt is ever embedded. The completed session owns the durable receipt."""
    pending = profile.get("pending_award")
    if pending:
        if pending["session_id"] == session_id and pending["attempt_id"] == attempt_id:
            return deepcopy(profile), pending["receipt"]
        raise RuntimeError("Settle the previous pending award before applying another")
    result, receipt = award_progress(profile, level_id, outcome)
    result["pending_award"] = dict(session_id=session_id, attempt_id=attempt_id, receipt=receipt)
    return result, receipt


class StartBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    level: StrictInt = Field(ge=1, le=7)
    vehicle_id: Literal["wanderer"] = VEHICLE
    request_id: str = Field(min_length=8, max_length=80, pattern=r"^[A-Za-z0-9_-]+$")


class FinishBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ticks: StrictInt = Field(ge=1, le=43200)
    events: list[tuple[StrictInt, StrictInt]] = Field(default_factory=list, max_length=43200)
    abandon: StrictBool = False


class UpgradeBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    part: Literal["engine", "suspension", "tires", "tank"]
    vehicle_id: Literal["wanderer"] = VEHICLE
    level: StrictInt = Field(ge=0, le=9)
    request_id: str = Field(min_length=8, max_length=80, pattern=r"^[A-Za-z0-9_-]+$")


async def seed_pixel_drive(db):
    await db.pixel_drive_sessions.create_index("purge_at", expireAfterSeconds=0)
    await db.pixel_drive_sessions.create_index([("user_id", 1), ("created_at", -1)])
    # A rollout may encounter multiple active development-v3 attempts. Keep the latest;
    # only unfinished attempts are superseded, never an earned balance or receipt.
    duplicates = db.pixel_drive_sessions.aggregate([
        {"$match":{"status":"active", "version":{"$gte":3}}},
        {"$sort":{"created_at":-1, "_id":-1}},
        {"$group":{"_id":{"user":"$user_id", "version":"$version"}, "ids":{"$push":"$_id"}}}])
    async for group in duplicates:
        if len(group["ids"]) > 1:
            await db.pixel_drive_sessions.update_many({"_id":{"$in":group["ids"][1:]}, "status":"active"},
                {"$set":{"status":"superseded", "superseded_at":now()}})
    await db.pixel_drive_sessions.create_index([("user_id",1), ("version",1)], unique=True,
        partialFilterExpression={"status":"active", "version":{"$gte":3}}, name="pixel_drive_one_active_v3")


def register_pixel_drive_routes(api, db, get_current_user):
    # The outbox barrier relies on reads from the primary, including if the host
    # connection otherwise prefers replicas for unrelated reporting workloads.
    profiles = db.get_collection("pixel_drive_profiles", read_preference=ReadPreference.PRIMARY)
    sessions = db.get_collection("pixel_drive_sessions", read_preference=ReadPreference.PRIMARY)
    async def compare_and_swap(before, after):
        after["revision"] = before["revision"] + 1
        update = {"$set":{k:v for k,v in after.items() if k != "_id"}}
        removed = {k:"" for k in before if k not in after and k != "_id"}
        if removed:
            update["$unset"] = removed
        return await profiles.find_one_and_update(
            {"_id":before["_id"], "revision":before["revision"]}, update, return_document=ReturnDocument.AFTER)

    async def profile(user_id):
        for _ in range(24):
            found = await profiles.find_one({"_id":user_id})
            if found:
                if found.get("profile_schema") == SCHEMA:
                    return found
                try:
                    migrated = await run_in_threadpool(migrate_progress, found)
                except ReplayUnavailable as exc:
                    raise unavailable(exc) from exc
                result = await compare_and_swap(found, migrated)
                if result:
                    return result
                continue
            created = new_profile(user_id)
            try:
                await profiles.insert_one(created)
                return created
            except DuplicateKeyError:
                continue
        raise unavailable("Profile migration is still being updated")

    async def settle_pending(before):
        pending = before.get("pending_award")
        if not pending:
            return before
        # The nonce prevents a very old outbox entry from touching a reused request ID after TTL expiry.
        await sessions.update_one(
            {"_id":pending["session_id"], "attempt_id":pending["attempt_id"]},
            {"$set":{"receipt":pending["receipt"]}})
        after = deepcopy(before)
        del after["pending_award"]
        return await compare_and_swap(before, after)

    async def ready():
        try:
            await run_in_threadpool(ensure_runtime)
        except ReplayUnavailable as exc:
            raise unavailable(exc) from exc

    def session_response(session):
        return {k:session[k] for k in ("session_id", "level_id", "vehicle_id", "version", "upgrades", "expires_at", "stageId", "seed", "generatorVersion") if k in session}

    @api.get("/games/pixel-drive/status")
    async def get_status(user:dict=Depends(get_current_user)):
        return public_profile(await profile(user["id"]))

    @api.post("/games/pixel-drive/start")
    async def start(body:StartBody, user:dict=Depends(get_current_user)):
        session_id = digest(["pixel-drive", user["id"], body.request_id])
        saved = await profile(user["id"])
        if body.level > public_profile(saved)["unlocked_level"]:
            raise HTTPException(403, "Спочатку пройдіть попередню трасу")
        await ready()
        for _ in range(24):
            existing = await sessions.find_one({"_id":session_id, "user_id":user["id"]})
            if existing:
                if existing["status"] == "superseded":
                    raise superseded()
                if existing["version"] != CONFIG["version"]:
                    raise HTTPException(409, "Гра оновилась. Почніть новий заїзд")
                if existing["level_id"] != body.level or existing["status"] != "active" or existing["expires_at"].replace(tzinfo=timezone.utc) <= now():
                    raise HTTPException(409, "Цю спробу вже використано")
                return session_response(existing)
            # Excluding the same request ID keeps simultaneous retrying starts idempotent.
            await sessions.update_many({"user_id":user["id"], "version":CONFIG["version"],
                "status":"active", "_id":{"$ne":session_id}}, {"$set":{"status":"superseded", "superseded_at":now()}})
            level, created = level_config(body.level), now()
            session = dict(_id=session_id, session_id=session_id, attempt_id=uuid.uuid4().hex,
                           user_id=user["id"], level_id=body.level, vehicle_id=VEHICLE,
                           version=CONFIG["version"], upgrades=deepcopy(saved["upgrades"]), status="active",
                           created_at=created, expires_at=created+timedelta(hours=1), purge_at=created+timedelta(days=7),
                           **{k:level[k] for k in ("stageId", "seed", "generatorVersion")})
            try:
                await sessions.insert_one(session)
            except DuplicateKeyError:
                continue
            return session_response(session)
        raise unavailable("Concurrent starts did not settle")

    @api.post("/games/pixel-drive/sessions/{session_id}/finish")
    async def finish(session_id:str, body:FinishBody, user:dict=Depends(get_current_user)):
        query = {"_id":session_id, "user_id":user["id"]}
        session = await sessions.find_one(query)
        if not session:
            raise HTTPException(404, "Заїзд не знайдено")
        if session["status"] == "superseded":
            raise superseded()
        body_digest = digest(body.model_dump())
        if session["status"] == "active":
            clock = now()
            if session["version"] != CONFIG["version"]:
                raise HTTPException(409, "Гра оновилась. Почніть новий заїзд")
            if session["expires_at"].replace(tzinfo=timezone.utc) <= clock:
                raise HTTPException(409, "Час заїзду минув. Почніть нову спробу")
            if body.ticks/60 > (clock-session["created_at"].replace(tzinfo=timezone.utc)).total_seconds()+0.5:
                raise HTTPException(422, "Тривалість заїзду не відповідає сесії")
            try:
                outcome = await run_in_threadpool(replay, level_config(session["level_id"]), session["upgrades"], body.events, body.ticks, body.abandon)
            except ValueError as exc:
                raise HTTPException(422, str(exc)) from exc
            except ReplayUnavailable as exc:
                raise unavailable(exc) from exc
            changed = await sessions.find_one_and_update(
                {**query, "status":"active"},
                {"$set":{"status":"finished", "outcome":outcome, "digest":body_digest, "completed_at":clock}},
                return_document=ReturnDocument.AFTER)
            session = changed or await sessions.find_one(query)
        if session["status"] == "superseded":
            raise superseded()
        if session.get("digest") != body_digest:
            raise HTTPException(409, "Для цього заїзду вже надіслано інший результат")
        if session["version"] != CONFIG["version"] and "receipt" not in session:
            raise HTTPException(409, "Цей заїзд належить попередній кампанії")
        if "receipt" not in session:
            for _ in range(48):
                session = await sessions.find_one(query)
                if "receipt" in session:
                    break
                before = await profile(user["id"])
                if before.get("pending_award"):
                    await settle_pending(before)
                    continue
                # This read MUST follow the profile read: another finisher may have
                # copied its receipt and cleared the outbox between our first session
                # read and this profile revision. An older revision instead fails CAS.
                latest = await sessions.find_one(query)
                if "receipt" in latest:
                    session = latest
                    break
                try:
                    after, receipt = await run_in_threadpool(award_run, before, session_id, session["level_id"], session["outcome"], session["attempt_id"])
                except ReplayUnavailable as exc:
                    raise unavailable(exc) from exc
                saved = await compare_and_swap(before, after)
                if saved:
                    await settle_pending(saved)
            else:
                raise unavailable("Progress is still being updated")
        await record_campaign_win(db, "pixel_drive", session, session["level_id"])
        return dict(outcome=session["outcome"], receipt=session["receipt"], progress=public_profile(await profile(user["id"])))

    @api.post("/games/pixel-drive/upgrade")
    async def upgrade(body:UpgradeBody, user:dict=Depends(get_current_user)):
        request_key = digest(body.request_id)
        for _ in range(24):
            before = await profile(user["id"])
            existing = before["purchases"].get(request_key)
            if existing:
                if existing["part"] != body.part or existing["from"] != body.level:
                    raise HTTPException(409, "Цей запит уже використано для іншого покращення")
                return dict(progress=public_profile(before), purchase=existing)
            if before["upgrades"][body.part] != body.level:
                raise HTTPException(409, "Рівень покращення змінився. Оновіть гараж")
            price = CONFIG["upgradePrices"][body.part][body.level]
            if before["balance"] < price:
                raise HTTPException(400, "Недостатньо монет")
            try:
                after, receipt = await run_in_threadpool(purchase_progress, before, body.part, body.level)
            except ReplayUnavailable as exc:
                raise unavailable(exc) from exc
            after["purchases"][request_key] = receipt
            saved = await compare_and_swap(before, after)
            if saved:
                return dict(progress=public_profile(saved), purchase=receipt)
        raise HTTPException(409, "Гараж оновлюється. Спробуйте ще раз")
