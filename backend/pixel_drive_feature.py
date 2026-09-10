"""Fast browser-result saves with a crash-recoverable atomic award outbox."""
import hashlib
import json
import logging
import uuid
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictBool, model_validator
from pymongo import ReturnDocument, ReadPreference
from pymongo.errors import DuplicateKeyError, PyMongoError

try:
    from backend.pixel_game_events import record_campaign_win
except ModuleNotFoundError as exc:
    if exc.name != "backend":
        raise
    from pixel_game_events import record_campaign_win
try:
    from .pixel_drive_game import (CONFIG, fresh_upgrades, level_config,
                                  migrate_progress, award_progress, purchase_progress)
    from .pixel_drive_result import normalize_outcome
    from .pixel_drive_progression import (fresh_progress, public_progress, unlocked_levels, unlocked_worlds,
                                         vehicle_config, upgrade_price, purchase_vehicle, select_vehicle)
except ImportError:
    from pixel_drive_game import (CONFIG, fresh_upgrades, level_config,
                                 migrate_progress, award_progress, purchase_progress)
    from pixel_drive_result import normalize_outcome
    from pixel_drive_progression import (fresh_progress, public_progress, unlocked_levels, unlocked_worlds,
                                        vehicle_config, upgrade_price, purchase_vehicle, select_vehicle)

logger = logging.getLogger(__name__)
SCHEMA = 4
VEHICLE = "wanderer"
RESULT_MODE = "client"
RECOVERY_BATCH = 20


def unavailable(exc):
    logger.warning("Pixel Drive save unavailable: %s", exc)
    return HTTPException(503, "Збереження тимчасово недоступне. Спробуйте ще раз", headers={"Retry-After":"2"})


def superseded():
    return HTTPException(409, {"code":"run_superseded", "message":"Заїзд замінено новою спробою в цій або іншій вкладці. Поверніться до гаража."})


def now():
    return datetime.now(timezone.utc)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def new_profile(user_id):
    return dict(_id=user_id, revision=0, **fresh_progress())


def public_profile(profile):
    return dict(public_progress(profile), result_mode=RESULT_MODE,
                save_scope=digest(["pixel-drive-save", profile["_id"]]))


def award_run(profile, session_id, level_id, outcome, attempt_id=None, metadata=None):
    """Only one pending receipt is ever embedded. The completed session owns the durable receipt."""
    pending = profile.get("pending_award")
    if pending:
        if pending["session_id"] == session_id and pending["attempt_id"] == attempt_id:
            return deepcopy(profile), pending["receipt"]
        raise RuntimeError("Settle the previous pending award before applying another")
    result, receipt = award_progress(profile, level_id, outcome, metadata)
    result["pending_award"] = dict(session_id=session_id, attempt_id=attempt_id, receipt=receipt)
    return result, receipt


class StartBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    level: StrictInt = Field(default=1, ge=1, le=16)
    vehicle_id: str = VEHICLE
    mode: Literal['campaign','endless'] = 'campaign'
    world_id: Literal['earth','moon','mars','basalt'] | None = None
    request_id: str = Field(min_length=8, max_length=80, pattern=r"^[A-Za-z0-9_-]+$")

    @model_validator(mode='after')
    def known_vehicle(self):
        if not vehicle_config(self.vehicle_id): raise ValueError('Невідома машина')
        return self


class FinishBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ticks: StrictInt = Field(ge=1, le=2**53-1)
    outcome: dict | None = None
    # Recognize the old contract only to return an explicit upgrade message.
    # It is never replayed or used as a fallback.
    events: list | None = Field(default=None, max_length=43200)
    abandon: StrictBool = False

    @model_validator(mode="after")
    def bounded_outcome(self):
        if self.outcome is not None and len(json.dumps(self.outcome, ensure_ascii=False).encode("utf-8")) > 32768:
            raise ValueError("Результат заїзду завеликий")
        return self


class UpgradeBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    part: Literal["engine", "suspension", "tires", "tank"]
    vehicle_id: str = VEHICLE
    level: StrictInt = Field(ge=0, le=9)
    request_id: str = Field(min_length=8, max_length=80, pattern=r"^[A-Za-z0-9_-]+$")

class VehicleBody(BaseModel):
    model_config = ConfigDict(extra='forbid')
    vehicle_id: str = Field(min_length=1,max_length=40)
    request_id: str = Field(min_length=8,max_length=80,pattern=r'^[A-Za-z0-9_-]+$')


async def seed_pixel_drive(db):
    await db.pixel_drive_sessions.create_index("purge_at", expireAfterSeconds=0)
    await db.pixel_drive_sessions.create_index([("user_id", 1), ("created_at", -1)])
    await db.pixel_drive_sessions.create_index([("user_id",1), ("version",1), ("status",1),
                                               ("campaign_recorded",1), ("created_at",1)])
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
                    migrated = migrate_progress(found)
                except ValueError as exc:
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
            {"_id":pending["session_id"], "user_id":before["_id"], "attempt_id":pending["attempt_id"]},
            {"$set":{"receipt":pending["receipt"]}})
        after = deepcopy(before)
        del after["pending_award"]
        return await compare_and_swap(before, after)

    async def record_event(session):
        if session.get("campaign_recorded"):
            return
        try:
            if session.get('mode','campaign') == 'campaign':
                await record_campaign_win(db, "pixel_drive", session, session["level_id"])
            await sessions.update_one({"_id":session["_id"], "attempt_id":session["attempt_id"]},
                                      {"$set":{"campaign_recorded":True}})
            session["campaign_recorded"] = True
        except PyMongoError as exc:
            # The wallet receipt is already durable. A secondary story write
            # must not turn that successful save into a lost-result screen.
            logger.warning("Pixel Drive story event will be recovered: %s", exc)

    async def complete_award(session, user_id):
        query = {"_id":session["_id"], "user_id":user_id, "attempt_id":session["attempt_id"]}
        for _ in range(48):
            current = await sessions.find_one(query)
            if not current:
                raise HTTPException(404, "Заїзд не знайдено")
            session = current
            if "receipt" in session:
                await record_event(session)
                return session
            if session["status"] != "finished" or session["version"] not in (3,CONFIG["version"]):
                raise HTTPException(409, "Цей заїзд не можна зберегти. Почніть нову спробу")
            before = await profile(user_id)
            if before.get("pending_award"):
                await settle_pending(before)
                continue
            # Recheck AFTER reading the profile: a concurrent request may have
            # copied its receipt and cleared its outbox since the first read.
            latest = await sessions.find_one(query)
            if not latest:
                raise HTTPException(404, "Заїзд не знайдено")
            if "receipt" in latest:
                session = latest
                await record_event(session)
                return session
            try:
                after, _ = award_run(before, session["_id"], session["level_id"], session["outcome"], session["attempt_id"], session)
            except ValueError as exc:
                raise unavailable(exc) from exc
            saved = await compare_and_swap(before, after)
            if saved:
                await settle_pending(saved)
        raise unavailable("Progress is still being updated")

    async def recover_received(user_id):
        # Finish submissions are durable before currency is applied. Recover
        # them without needing the original browser payload or a Node process.
        saved = await profile(user_id)
        if saved.get("pending_award"):
            await settle_pending(saved)
        base = {"user_id":user_id, "version":{"$in":[3,CONFIG["version"]]}, "status":"finished",
                "outcome":{"$exists":True}, "attempt_id":{"$exists":True}}
        pending = await sessions.find({**base, "receipt":{"$exists":False}}).sort("created_at",1).limit(RECOVERY_BATCH).to_list(RECOVERY_BATCH)
        for session in pending:
            await complete_award(session, user_id)
        remaining = RECOVERY_BATCH - len(pending)
        if remaining:
            events = await sessions.find({**base, "receipt":{"$exists":True}, "campaign_recorded":{"$ne":True}}).sort("created_at",1).limit(remaining).to_list(remaining)
            for session in events:
                await record_event(session)
        return bool(await sessions.find_one({**base, "$or":[{"receipt":{"$exists":False}}, {"campaign_recorded":{"$ne":True}}]}, {"_id":1}))

    def session_response(session):
        return dict(result_mode=RESULT_MODE, **{k:session[k] for k in ("session_id", "level_id", "vehicle_id", "version", "upgrades", "expires_at", "stageId", "seed", "generatorVersion", "mode", "world_id") if k in session})

    @api.get("/games/pixel-drive/status")
    async def get_status(user:dict=Depends(get_current_user)):
        try:
            recovery_pending = await recover_received(user["id"])
            return dict(public_profile(await profile(user["id"])), recovery_pending=recovery_pending)
        except PyMongoError as exc:
            raise unavailable(exc) from exc

    @api.post("/games/pixel-drive/start")
    async def start(body:StartBody, user:dict=Depends(get_current_user)):
        session_id = digest(["pixel-drive", user["id"], body.request_id])
        saved = await profile(user["id"])
        if body.vehicle_id not in saved['vehicles']:
            raise HTTPException(403, 'Спочатку придбайте цю машину')
        level = level_config(body.level)
        world_id = body.world_id or level.get('worldId','earth')
        if body.mode == 'campaign' and (body.level not in unlocked_levels(saved) or world_id != level.get('worldId','earth')):
            raise HTTPException(403, "Спочатку пройдіть попередню трасу")
        if body.mode == 'endless' and world_id not in unlocked_worlds(saved):
            raise HTTPException(403, 'Спочатку відкрийте цей світ у кампанії')
        for _ in range(24):
            existing = await sessions.find_one({"_id":session_id, "user_id":user["id"]})
            if existing:
                if existing["status"] == "superseded":
                    raise superseded()
                if existing["version"] != CONFIG["version"]:
                    raise HTTPException(409, "Гра оновилась. Почніть новий заїзд")
                if (existing["level_id"] != body.level or existing.get('vehicle_id') != body.vehicle_id or
                    existing.get('mode','campaign') != body.mode or existing.get('world_id','earth') != world_id or
                    existing["status"] != "active" or existing["expires_at"].replace(tzinfo=timezone.utc) <= now()):
                    raise HTTPException(409, "Цю спробу вже використано")
                return session_response(existing)
            # Excluding the same request ID keeps simultaneous retrying starts idempotent.
            await sessions.update_many({"user_id":user["id"], "version":{"$in":[3,CONFIG["version"]]},
                "status":"active", "_id":{"$ne":session_id}}, {"$set":{"status":"superseded", "superseded_at":now()}})
            created = now()
            expires = created+timedelta(days=7) if body.mode=='endless' else created+timedelta(hours=1)
            stage = ({'stageId':f'endless-{world_id}', 'seed':int(digest(['endless',session_id,world_id])[:8],16),
                      'generatorVersion':CONFIG.get('generatorVersion',4)} if body.mode=='endless' else
                     {k:level[k] for k in ('stageId','seed','generatorVersion')})
            session = dict(_id=session_id, session_id=session_id, attempt_id=uuid.uuid4().hex,
                           user_id=user["id"], level_id=body.level, vehicle_id=body.vehicle_id,mode=body.mode,world_id=world_id,
                           version=CONFIG["version"], upgrades=deepcopy(saved['vehicles'][body.vehicle_id]['upgrades']), status="active",
                           result_mode=RESULT_MODE,
                           created_at=created, expires_at=expires, purge_at=expires+timedelta(days=7),**stage)
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
        if body.outcome is None:
            raise HTTPException(409, {"code":"result_contract_changed", "message":"Оновіть сторінку гри: збереження результатів оновлено."})
        body_digest = digest(body.model_dump())
        if session["status"] == "active":
            clock = now()
            if session["version"] not in (3,CONFIG["version"]):
                raise HTTPException(409, "Гра оновилась. Почніть новий заїзд")
            if session["expires_at"].replace(tzinfo=timezone.utc) <= clock:
                raise HTTPException(409, "Час заїзду минув. Почніть нову спробу")
            if body.ticks/60 > (clock-session["created_at"].replace(tzinfo=timezone.utc)).total_seconds()+0.5:
                raise HTTPException(422, "Тривалість заїзду не відповідає сесії")
            level = level_config(session["level_id"],session)
            if body.ticks > level["max_ticks"]:
                raise HTTPException(422, "Некоректна тривалість заїзду")
            outcome = normalize_outcome(level, session["upgrades"], body.outcome, body.ticks, body.abandon, session)
            changed = await sessions.find_one_and_update(
                {**query, "status":"active"},
                {"$set":{"status":"finished", "outcome":outcome, "digest":body_digest, "completed_at":clock,
                         "result_mode":RESULT_MODE, "campaign_recorded":False}},
                return_document=ReturnDocument.AFTER)
            session = changed or await sessions.find_one(query)
        if not session:
            raise HTTPException(404, "Заїзд не знайдено")
        if session["status"] == "superseded":
            raise superseded()
        if session.get("digest") != body_digest:
            raise HTTPException(409, "Для цього заїзду вже надіслано інший результат")
        if session["version"] not in (3,CONFIG["version"]) and "receipt" not in session:
            raise HTTPException(409, "Цей заїзд належить попередній кампанії")
        try:
            session = await complete_award(session, user["id"])
            return dict(result_mode=RESULT_MODE, outcome=session["outcome"], receipt=session["receipt"],
                        progress=public_profile(await profile(user["id"])))
        except PyMongoError as exc:
            raise unavailable(exc) from exc

    @api.post("/games/pixel-drive/upgrade")
    async def upgrade(body:UpgradeBody, user:dict=Depends(get_current_user)):
        request_key = digest(body.request_id)
        for _ in range(24):
            before = await profile(user["id"])
            existing = before["purchases"].get(request_key)
            if existing:
                if existing.get("part") != body.part or existing.get("from") != body.level or existing.get('vehicle_id',VEHICLE) != body.vehicle_id:
                    raise HTTPException(409, "Цей запит уже використано для іншого покращення")
                return dict(progress=public_profile(before), purchase=existing)
            if body.vehicle_id not in before['vehicles']:
                raise HTTPException(403,'Спочатку придбайте цю машину')
            if before['vehicles'][body.vehicle_id]['upgrades'][body.part] != body.level:
                raise HTTPException(409, "Рівень покращення змінився. Оновіть гараж")
            price = upgrade_price(body.part,body.level,body.vehicle_id)
            if before["balance"] < price:
                raise HTTPException(400, "Недостатньо монет")
            try:
                after, receipt = purchase_progress(before, body.part, body.level,body.vehicle_id)
            except ValueError as exc:
                raise unavailable(exc) from exc
            after["purchases"][request_key] = receipt
            saved = await compare_and_swap(before, after)
            if saved:
                return dict(progress=public_profile(saved), purchase=receipt)
        raise HTTPException(409, "Гараж оновлюється. Спробуйте ще раз")

    async def garage_vehicle(body,user,select=False):
        request_key=digest(body.request_id);kind='select' if select else 'vehicle'
        if not vehicle_config(body.vehicle_id): raise HTTPException(400,'Невідома машина')
        for _ in range(24):
            before=await profile(user['id']);bucket='selections' if select else 'purchases'
            existing=before.get(bucket,{}).get(request_key)
            if existing:
                if existing.get('kind')!=kind or existing.get('vehicle_id')!=body.vehicle_id:
                    raise HTTPException(409,'Цей запит уже використано для іншої машини')
                return dict(progress=public_profile(before),purchase=existing)
            try:
                after,receipt=(select_vehicle if select else purchase_vehicle)(before,body.vehicle_id)
            except ValueError as exc:
                raise HTTPException(400,str(exc)) from exc
            saved_requests=after.setdefault(bucket,{})
            saved_requests[request_key]=receipt
            if select and len(saved_requests)>64:
                del saved_requests[next(iter(saved_requests))]
            saved=await compare_and_swap(before,after)
            if saved: return dict(progress=public_profile(saved),purchase=receipt)
        raise HTTPException(409,'Гараж оновлюється. Спробуйте ще раз')

    @api.post('/games/pixel-drive/vehicle/purchase')
    async def buy_vehicle(body:VehicleBody,user:dict=Depends(get_current_user)):
        return await garage_vehicle(body,user)

    @api.post('/games/pixel-drive/vehicle/select')
    async def choose_vehicle(body:VehicleBody,user:dict=Depends(get_current_user)):
        return await garage_vehicle(body,user,select=True)
