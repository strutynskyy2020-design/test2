"""VPDK Bonus — FastAPI backend
JWT auth (email + bcrypt), employee/admin roles, quests, prizes, orders,
transactions, admin CRUD, bot API endpoints for Telegram sync.
"""
from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import json
import uuid
import logging
import asyncio
import shutil
import re
import math
import hashlib
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
from typing import List, Optional, Literal
from urllib.parse import parse_qs

import bcrypt
import jwt
from fastapi import FastAPI, APIRouter, Depends, HTTPException, Header, status, UploadFile, File, Form
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.staticfiles import StaticFiles
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import UpdateOne, ReturnDocument
from pymongo.errors import DuplicateKeyError
from pydantic import BaseModel, Field, EmailStr, ConfigDict

try:
    from backend.hidden_object_game import (
        hidden_object_apply_miss,
        hidden_object_contains,
        hidden_object_mistake_limit,
        hidden_object_public_level,
        hidden_object_stars,
        hidden_object_targets,
        load_hidden_object_catalog,
    )
except ModuleNotFoundError:  # ``uvicorn server:app`` when cwd is backend/
    from hidden_object_game import (
        hidden_object_apply_miss,
        hidden_object_contains,
        hidden_object_mistake_limit,
        hidden_object_public_level,
        hidden_object_stars,
        hidden_object_targets,
        load_hidden_object_catalog,
    )
try:
    from backend.pet_feature import register_pet_routes, seed_pet_v1
except ModuleNotFoundError as exc:  # ``uvicorn server:app`` when cwd is backend/
    if exc.name != "backend":
        raise
    from pet_feature import register_pet_routes, seed_pet_v1

try:
    from backend.flappy_feature import register_flappy_routes, seed_flappy
except ModuleNotFoundError as exc:
    if exc.name != "backend":
        raise
    from flappy_feature import register_flappy_routes, seed_flappy

try:
    from backend.pixel_drive_feature import register_pixel_drive_routes, seed_pixel_drive
except ModuleNotFoundError as exc:
    if exc.name != "backend":
        raise
    from pixel_drive_feature import register_pixel_drive_routes, seed_pixel_drive

try:
    from pywebpush import webpush, WebPushException
except Exception:  # Push remains optional until VAPID is configured.
    webpush = None
    WebPushException = Exception

# ────────────────────────────────────────────────────────────────────────
# Config
# ────────────────────────────────────────────────────────────────────────
JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALG = "HS256"
JWT_TTL_HOURS = int(os.environ.get("JWT_ACCESS_TTL_HOURS", "24"))
ADMIN_EMAIL = os.environ["ADMIN_EMAIL"].lower()
ADMIN_PASSWORD = os.environ["ADMIN_PASSWORD"]
BOT_API_TOKEN = os.environ["BOT_API_TOKEN"]
VAPID_PUBLIC_KEY = os.environ.get("VAPID_PUBLIC_KEY", "").strip()
VAPID_PRIVATE_KEY = os.environ.get("VAPID_PRIVATE_KEY", "").strip()
VAPID_SUBJECT = os.environ.get("VAPID_SUBJECT", f"mailto:{ADMIN_EMAIL}").strip()
PUSH_SCHEDULER_TOKEN = os.environ.get("PUSH_SCHEDULER_TOKEN", "").strip()
REPORTS_WEBHOOK_TOKEN = os.environ.get("REPORTS_WEBHOOK_TOKEN", "").strip()
SEED_DEMO_USERS_ENABLED = os.environ.get("SEED_DEMO_USERS", "false").strip().lower() in {"1", "true", "yes", "on"}
RESET_LOCAL_ADMIN_PASSWORD_ON_STARTUP = os.environ.get(
    "RESET_LOCAL_ADMIN_PASSWORD_ON_STARTUP", "false"
).strip().lower() in {"1", "true", "yes", "on"}
PLAYER_ROLES = ["employee", "editor"]

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

# File uploads (local disk)
UPLOADS_DIR = ROOT_DIR / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
(UPLOADS_DIR / "avatars").mkdir(exist_ok=True)
(UPLOADS_DIR / "tasks").mkdir(exist_ok=True)
(UPLOADS_DIR / "misc").mkdir(exist_ok=True)

MAX_UPLOAD_MB = int(os.environ.get("MAX_UPLOAD_MB", "25"))
ALLOWED_UPLOAD_TYPES = {
    "image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif",
    "video/mp4", "video/quicktime", "video/webm",
    "application/pdf",
}

logger = logging.getLogger("vpdk-bonus")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

# ────────────────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────────────────
def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


KYIV_TZ = ZoneInfo("Europe/Kyiv")

def kyiv_today_key() -> str:
    return datetime.now(KYIV_TZ).strftime("%Y-%m-%d")

def kyiv_tomorrow_iso() -> str:
    now = datetime.now(KYIV_TZ)
    tomorrow = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return tomorrow.isoformat()


def kyiv_day_bounds_utc(date_key: str) -> tuple[str, str]:
    day = datetime.strptime(date_key, "%Y-%m-%d").replace(tzinfo=KYIV_TZ)
    start = day.astimezone(timezone.utc)
    end = (day + timedelta(days=1)).astimezone(timezone.utc)
    return start.isoformat(), end.isoformat()


DIAMOND_AVATAR_DURATION_DAYS = 3
DIAMOND_AVATAR_DAILY_BONUS = 100
DIAMOND_AVATAR_TASK_REPLACEMENTS = 5
DIAMOND_AVATARS = {
    "male-diamond-1": {
        "title": "Алмазний лицар",
        "image": "/avatars/male-diamond-1.webp",
        "frame_variant": "male",
    },
    "female-diamond-1": {
        "title": "Алмазна королева",
        "image": "/avatars/female-diamond-1.webp",
        "frame_variant": "female",
    },
    "female-diamond-2": {
        "title": "Алмазна володарка",
        "image": "/avatars/female-diamond-2.webp",
        "frame_variant": "female",
    },
    "female-diamond-3": {
        "title": "Алмазна імператриця",
        "image": "/avatars/female-diamond-3.webp",
        "frame_variant": "female",
    },
}


def _parse_iso_datetime(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except (TypeError, ValueError):
        return None


def _diamond_avatar_is_active(user: dict) -> bool:
    if not user.get("diamond_avatar_code"):
        return False
    expires_at = _parse_iso_datetime(user.get("diamond_avatar_expires_at"))
    return bool(expires_at and expires_at > datetime.now(timezone.utc))


async def _restore_avatar_after_diamond(user: dict, reason: str = "expired") -> dict:
    restore = user.get("diamond_avatar_restore") or {}
    updates = {
        "avatar_url": restore.get("avatar_url"),
        "active_avatar_prize_id": restore.get("active_avatar_prize_id"),
        "avatar_rarity": restore.get("avatar_rarity") or "basic",
        "avatar_daily_bonus": max(0, int(restore.get("avatar_daily_bonus") or 0)),
        "avatar_task_replacements": max(0, int(restore.get("avatar_task_replacements") or 0)),
        "diamond_avatar_code": None,
        "diamond_avatar_expires_at": None,
        "diamond_avatar_granted_at": None,
        "diamond_avatar_granted_by": None,
        "diamond_avatar_granted_by_name": None,
        "diamond_avatar_revoked_reason": reason,
        "diamond_avatar_revoked_at": now_iso(),
    }
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": updates, "$unset": {"diamond_avatar_restore": ""}},
    )
    fresh = await db.users.find_one({"id": user["id"]}, {"_id": 0})
    return fresh or {**user, **updates}


async def _expire_diamond_avatar_if_needed(user: dict) -> dict:
    if not user.get("diamond_avatar_code"):
        return user
    if _diamond_avatar_is_active(user):
        return user
    return await _restore_avatar_after_diamond(user, reason="expired")


async def _backfill_active_diamond_feed_events_v136() -> int:
    """Publish one showcase event for diamond avatars granted before v136.

    The source key keeps startup idempotent. Expired grants cannot be restored
    because their temporary avatar metadata is intentionally cleared.
    """
    created = 0
    cursor = db.users.find(
        {
            "diamond_avatar_code": {"$nin": [None, ""]},
            "diamond_avatar_granted_at": {"$nin": [None, ""]},
        },
        {"_id": 0},
    )
    async for target in cursor:
        if not _diamond_avatar_is_active(target):
            continue
        avatar_code = target.get("diamond_avatar_code")
        avatar = DIAMOND_AVATARS.get(avatar_code)
        if not avatar:
            continue
        granted_at = target.get("diamond_avatar_granted_at")
        source_key = f"diamond-avatar-grant:{target['id']}:{granted_at}"
        exists = await db.feed_events.find_one({"source_key": source_key}, {"_id": 0, "id": 1})
        if exists:
            continue
        await db.feed_events.insert_one({
            "id": f"diamond-avatar-{uuid.uuid4()}",
            "source_key": source_key,
            "kind": "diamond_avatar",
            "user_id": target["id"],
            "user_name": target.get("name", "Користувач"),
            "avatar_initials": target.get("avatar_initials", "?"),
            "avatar_color": target.get("avatar_color", "#7DD3FC"),
            "avatar_url": avatar["image"],
            "avatar_rarity": "diamond",
            "department": target.get("department", ""),
            "title": "отримав алмазний аватар 💎",
            "subtitle": f"{avatar['title']} на {DIAMOND_AVATAR_DURATION_DAYS} дні",
            "duration_days": DIAMOND_AVATAR_DURATION_DAYS,
            "daily_bonus": DIAMOND_AVATAR_DAILY_BONUS,
            "task_replacements": DIAMOND_AVATAR_TASK_REPLACEMENTS,
            "expires_at": target.get("diamond_avatar_expires_at"),
            "avatar_code": avatar_code,
            "granted_by": target.get("diamond_avatar_granted_by"),
            "granted_by_name": target.get("diamond_avatar_granted_by_name", "Адміністратор"),
            "created_at": granted_at,
        })
        created += 1
    return created


_diamond_avatar_cleanup_task: Optional[asyncio.Task] = None


async def _cleanup_expired_diamond_avatars_once() -> int:
    expired_count = 0
    cursor = db.users.find(
        {"diamond_avatar_code": {"$nin": [None, ""]}},
        {"_id": 0},
    )
    async for user in cursor:
        if not _diamond_avatar_is_active(user):
            await _restore_avatar_after_diamond(user, reason="expired")
            expired_count += 1
    return expired_count


async def _diamond_avatar_cleanup_loop() -> None:
    while True:
        try:
            await _cleanup_expired_diamond_avatars_once()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("Diamond avatar cleanup failed: %s", exc)
        await asyncio.sleep(300)


async def _touch_daily_streak(user: dict) -> dict:
    """Update a user's consecutive-day streak once per Kyiv calendar day."""
    today = kyiv_today_key()
    last = user.get("last_active_date")
    if last == today:
        return user

    current = int(user.get("streak", 0) or 0)
    if not last:
        new_streak = current if current > 0 else 1
    else:
        try:
            last_date = datetime.strptime(last, "%Y-%m-%d").date()
            today_date = datetime.strptime(today, "%Y-%m-%d").date()
            delta = (today_date - last_date).days
            if delta == 1:
                new_streak = current + 1
            elif delta <= 0:
                new_streak = current
            else:
                new_streak = 1
        except ValueError:
            new_streak = 1

    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"streak": new_streak, "last_active_date": today}},
    )
    if new_streak >= 7:
        await _award_xp(
            user["id"], 75, "streak", "streak:7-days",
            "Активність 7 днів поспіль", {"streak": new_streak},
        )
    fresh = await db.users.find_one({"id": user["id"]}, {"_id": 0})
    return fresh or {**user, "streak": new_streak, "last_active_date": today}


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:
        return False


def create_token(user_id: str, email: str, role: str, auth_version: int = 0) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "role": role,
        "ver": int(auth_version or 0),
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_TTL_HOURS),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


MAX_PROFILE_LEVEL = 50


def xp_to_next(level: int) -> int:
    """XP needed for the next permanent profile level."""
    normalized = max(1, int(level or 1))
    return 0 if normalized >= MAX_PROFILE_LEVEL else 100 + normalized * 25


def profile_level_title(level: int) -> str:
    normalized = max(1, min(MAX_PROFILE_LEVEL, int(level or 1)))
    if normalized <= 5:
        return "Новачок"
    if normalized <= 10:
        return "Гравець"
    if normalized <= 20:
        return "Досвідчений"
    if normalized <= 30:
        return "Профі"
    if normalized <= 40:
        return "Майстер"
    if normalized <= 49:
        return "Легенда"
    return "VPDK Champion"


def level_from_total_xp(total_xp: int) -> tuple[int, int, int]:
    """Return (level, xp_in_level, xp_needed_for_next)."""
    level = 1
    remaining = max(0, int(total_xp or 0))
    need = xp_to_next(level)
    while level < MAX_PROFILE_LEVEL and need > 0 and remaining >= need:
        remaining -= need
        level += 1
        need = xp_to_next(level)
    return level, remaining, need


LEVEL_REWARDS = [
    {"level": 5, "kind": "title", "title": "Титул «Впевнений старт»", "description": "Новий титул для особистого профілю.", "inventory_key": "title-confident-start"},
    {"level": 10, "kind": "avatar", "title": "Ексклюзивний аватар", "description": "Колекційний аватар десятого рівня.", "inventory_key": "avatar-level-10"},
    {"level": 15, "kind": "cube_spin", "title": "+1 кидок Щедрого куба", "description": "Один безкоштовний бонусний кидок.", "inventory_key": "cube-spin-level-15"},
    {"level": 20, "kind": "frame", "title": "Рамка профілю «Профі»", "description": "Особлива рамка навколо аватара.", "inventory_key": "frame-level-20"},
    {"level": 25, "kind": "discount", "title": "Знижка 5%", "description": "Разова знижка 5% на наступну покупку в магазині.", "inventory_key": "discount-level-25"},
    {"level": 30, "kind": "avatar", "title": "Рідкісний аватар", "description": "Рідкісний аватар за стабільний розвиток.", "inventory_key": "avatar-level-30"},
    {"level": 35, "kind": "animated_frame", "title": "Анімована рамка", "description": "Анімована рамка профілю майстра.", "inventory_key": "frame-level-35"},
    {"level": 40, "kind": "name_color", "title": "Особливий колір імені", "description": "Золотий колір імені у персональному кабінеті.", "inventory_key": "name-color-level-40"},
    {"level": 45, "kind": "cosmetic", "title": "Легендарна косметика", "description": "Легендарний предмет колекції профілю.", "inventory_key": "cosmetic-level-45"},
    {"level": 50, "kind": "champion", "title": "VPDK Champion", "description": "Унікальний титул і чемпіонська рамка.", "inventory_key": "champion-level-50"},
]


SYSTEM_ACHIEVEMENTS = [
    {"id": "first_quest", "title": "Перший крок", "description": "Виконай перший підтверджений квест.", "category": "Активність", "icon": "flag", "color": "#39FF14", "rarity": "bronze", "stat": "quests_completed", "target": 1, "unit": "квест", "xp_reward": 25},
    {"id": "perfect_day", "title": "Ідеальний день", "description": "Виконай усі 3 щоденні квести за один день.", "category": "Активність", "icon": "calendar-check", "color": "#00F0FF", "rarity": "silver", "stat": "perfect_days", "target": 1, "unit": "день", "xp_reward": 40},
    {"id": "streak_7", "title": "Залізний ритм", "description": "Підтримуй активну серію 7 днів поспіль.", "category": "Активність", "icon": "flame", "color": "#FF5C00", "rarity": "silver", "stat": "streak", "target": 7, "unit": "днів", "xp_reward": 50},
    {"id": "streak_30", "title": "Без вихідних", "description": "Підтримуй активну серію 30 днів поспіль.", "category": "Активність", "icon": "flame", "color": "#FFB800", "rarity": "gold", "stat": "streak", "target": 30, "unit": "днів", "xp_reward": 100},
    {"id": "quests_100", "title": "Сотня", "description": "Виконай 100 підтверджених квестів.", "category": "Активність", "icon": "trophy", "color": "#FFB800", "rarity": "gold", "stat": "quests_completed", "target": 100, "unit": "квестів", "xp_reward": 150},
    {"id": "projection_100", "title": "План виконано", "description": "Отримай місячний проекційний результат 100% або більше.", "category": "Проекційні", "icon": "target", "color": "#B78CFF", "rarity": "silver", "stat": "projection_100_days", "target": 1, "unit": "день", "xp_reward": 50},
    {"id": "projection_triple", "title": "Потрійний удар", "description": "Одночасно виконай усі три напрямки на 100%+.", "category": "Проекційні", "icon": "zap", "color": "#FFB800", "rarity": "gold", "stat": "projection_triple_days", "target": 1, "unit": "день", "xp_reward": 100},
    {"id": "projection_stable", "title": "Стабільність", "description": "Утримуй результат 100%+ протягом 5 робочих днів.", "category": "Проекційні", "icon": "trending-up", "color": "#39FF14", "rarity": "gold", "stat": "projection_streak", "target": 5, "unit": "днів", "xp_reward": 125},
    {"id": "projection_leader", "title": "Лідер дня", "description": "Посідай перше місце у своєму проекційному рейтингу.", "category": "Проекційні", "icon": "crown", "color": "#FFB800", "rarity": "gold", "stat": "projection_first_places", "target": 1, "unit": "перше місце", "xp_reward": 125},
    {"id": "projection_comeback", "title": "Камбэк", "description": "Підніми результат із зони уваги до 100%+.", "category": "Проекційні", "icon": "trending-up", "color": "#00F0FF", "rarity": "gold", "stat": "projection_comebacks", "target": 1, "unit": "камбэк", "xp_reward": 100},
    {"id": "projection_record", "title": "Рекордсмен", "description": "Перевищ свій попередній проекційний рекорд.", "category": "Проекційні", "icon": "medal", "color": "#B78CFF", "rarity": "silver", "stat": "projection_records", "target": 1, "unit": "рекорд", "xp_reward": 75},
    {"id": "team_first_contribution", "title": "Командний гравець", "description": "Зроби перший внесок у банку команди.", "category": "Командні", "icon": "users", "color": "#00F0FF", "rarity": "bronze", "stat": "bank_contributions", "target": 1, "unit": "внесок", "xp_reward": 25},
    {"id": "team_patron", "title": "Меценат", "description": "Внеси сумарно 1 000 Point у командні банки.", "category": "Командні", "icon": "piggy-bank", "color": "#FFB800", "rarity": "gold", "stat": "bank_points", "target": 1000, "unit": "Point", "xp_reward": 125},
    {"id": "team_goal", "title": "Спільна перемога", "description": "Візьми участь у закритті командної банки.", "category": "Командні", "icon": "handshake", "color": "#39FF14", "rarity": "silver", "stat": "team_goals", "target": 1, "unit": "ціль", "xp_reward": 75},
    {"id": "first_purchase", "title": "Перша покупка", "description": "Отримай свій перший приз у магазині.", "category": "Колекція", "icon": "shopping-bag", "color": "#FF5C00", "rarity": "bronze", "stat": "orders", "target": 1, "unit": "покупка", "xp_reward": 25},
    {"id": "avatar_collector", "title": "Колекціонер", "description": "Збери 5 аватарок у власній колекції.", "category": "Колекція", "icon": "gem", "color": "#B78CFF", "rarity": "gold", "stat": "owned_avatars", "target": 5, "unit": "аватарів", "xp_reward": 100},
    {"id": "cube_first", "title": "Перший кидок", "description": "Уперше кинь Щедрий куб.", "category": "Ігри", "icon": "dice-5", "color": "#FFB800", "rarity": "bronze", "stat": "cube_spins", "target": 1, "unit": "кидок", "xp_reward": 25},
    {"id": "cube_six", "title": "Щаслива шістка", "description": "Отримай максимальну грань Щедрого куба.", "category": "Ігри", "icon": "dice-6", "color": "#39FF14", "rarity": "gold", "stat": "cube_sixes", "target": 1, "unit": "шістка", "xp_reward": 100},
    {"id": "cube_fortune", "title": "Улюбленець фортуни", "description": "Тричі отримай рідкісну нагороду Куба.", "category": "Ігри", "icon": "sparkles", "color": "#B78CFF", "rarity": "diamond", "stat": "cube_rare", "target": 3, "unit": "нагороди", "xp_reward": 175},
    {"id": "detective_first", "title": "Детектив", "description": "Уперше пройди рівень VPDK Detective.", "category": "Ігри", "icon": "search", "color": "#00F0FF", "rarity": "silver", "stat": "detective_levels", "target": 1, "unit": "рівень", "xp_reward": 50},
    {"id": "detective_sharp_eye", "title": "Гостре око", "description": "Пройди рівень Detective без жодної помилки.", "category": "Ігри", "icon": "eye", "color": "#39FF14", "rarity": "gold", "stat": "detective_perfect", "target": 1, "unit": "рівень", "xp_reward": 100},
    {"id": "bonus_master", "title": "Bonus Master", "description": "Вперше пройди 10 різних рівнів Bonus Match.", "category": "Ігри", "icon": "gamepad-2", "color": "#B78CFF", "rarity": "gold", "stat": "bonus_match_levels", "target": 10, "unit": "рівнів", "xp_reward": 125},
    {"id": "secret_triple_cube", "title": "Тричі пощастило", "description": "Отримай однакову грань Куба тричі поспіль.", "category": "Секретні", "icon": "help-circle", "color": "#FF3B8A", "rarity": "diamond", "stat": "cube_same_three", "target": 1, "unit": "секрет", "xp_reward": 200, "secret": True},
    {"id": "secret_last_prize", "title": "Останній екземпляр", "description": "Придбай останній доступний екземпляр призу.", "category": "Секретні", "icon": "help-circle", "color": "#FF3B8A", "rarity": "diamond", "stat": "last_prize_buys", "target": 1, "unit": "секрет", "xp_reward": 200, "secret": True},
]


def _monthly_rank_tier(overall: float) -> dict:
    value = max(0.0, float(overall or 0))
    if value >= 120:
        return {"tier": "S", "code": "S", "title": "Еліта", "color": "#FFB800"}
    if value >= 100:
        return {"tier": "A", "code": "A", "title": "План виконано", "color": "#39FF14"}
    if value >= 85:
        return {"tier": "B", "code": "B", "title": "Сильний темп", "color": "#00F0FF"}
    if value >= 70:
        return {"tier": "C", "code": "C", "title": "Зона росту", "color": "#B78CFF"}
    return {"tier": "D", "code": "D", "title": "Зона уваги", "color": "#FF5B63"}


# ────────────────────────────────────────────────────────────────────────
# Models
# ────────────────────────────────────────────────────────────────────────
class UserPublic(BaseModel):
    id: str
    email: str
    name: str
    first_name: str = ""
    last_name: str = ""
    role: Literal["employee", "editor", "admin"]
    department: str = ""
    position: str = ""
    avatar_initials: str = ""
    avatar_color: str = "#FFB800"
    avatar_url: Optional[str] = None
    balance: int = 0
    total_earned: int = 0
    total_xp: int = 0
    streak: int = 0
    phone: Optional[str] = None
    telegram: Optional[str] = None
    telegram_id: Optional[str] = None
    goals_login: Optional[str] = None
    report_profile: Literal["sales", "activation"] = "sales"
    team_id: Optional[str] = None
    team_name: Optional[str] = None
    is_team_leader: bool = False
    approved: bool = True
    owned_avatar_ids: List[str] = Field(default_factory=list)
    active_avatar_prize_id: Optional[str] = None
    avatar_rarity: str = "basic"
    avatar_daily_bonus: int = 0
    avatar_task_replacements: int = 0
    avatar_bonus_last_date: Optional[str] = None
    diamond_avatar_code: Optional[str] = None
    diamond_avatar_expires_at: Optional[str] = None
    diamond_avatar_granted_at: Optional[str] = None
    diamond_avatar_active: bool = False
    active_profile_title: Optional[str] = None
    active_profile_frame: Optional[str] = None
    active_name_color: Optional[str] = None
    bonus_cube_spins: int = 0
    store_discount_tokens: int = 0
    reward_inventory: List[str] = Field(default_factory=list)
    pinned_achievement_ids: List[str] = Field(default_factory=list)
    created_at: str


class UserWithProgress(UserPublic):
    level: int
    level_title: str
    xp: int
    xp_to_next: int




class AITrainingResultBody(BaseModel):
    scenario_id: str
    scenario_title: str
    category: str = "general"
    difficulty: str = "easy"
    average_score: float = 0
    consultation_quality: float = 0
    sale_probability: int = 0
    won: bool = False
    points: int = 0
    xp_earned: int = 0
    best_streak: int = 0
    techniques: dict = Field(default_factory=dict)
    conversation: List[dict] = Field(default_factory=list)
    outcome_text: str = ""
    client_mood: str = ""


# AI Trainer awards Point equal to the rounded verified score from 5 to 10.
# The difficulty still affects the scenario itself, but not the Point reward.
AI_TRAINER_REWARD_TABLE = {
    "easy": ((10.0, 10), (9.0, 9), (8.0, 8), (7.0, 7), (6.0, 6), (5.0, 5)),
    "medium": ((10.0, 10), (9.0, 9), (8.0, 8), (7.0, 7), (6.0, 6), (5.0, 5)),
    "hard": ((10.0, 10), (9.0, 9), (8.0, 8), (7.0, 7), (6.0, 6), (5.0, 5)),
}

AI_SCENARIO_DIFFICULTY = {
    **{f"cc-{index:02d}": "easy" for index in range(1, 4)},
    **{f"cc-{index:02d}": "medium" for index in range(4, 8)},
    **{f"cc-{index:02d}": "hard" for index in range(8, 11)},
    **{f"dep-{index:02d}": "easy" for index in range(1, 3)},
    **{f"dep-{index:02d}": "medium" for index in range(3, 5)},
    "dep-05": "hard",
    **{f"dc-{index:02d}": "easy" for index in range(1, 3)},
    **{f"dc-{index:02d}": "medium" for index in range(3, 5)},
    "dc-05": "hard",
    **{f"ins-{index:02d}": "easy" for index in range(1, 3)},
    **{f"ins-{index:02d}": "medium" for index in range(3, 5)},
    "ins-05": "hard",
    **{f"gen-{index:02d}": "easy" for index in range(1, 3)},
    **{f"gen-{index:02d}": "medium" for index in range(3, 5)},
    "gen-05": "hard",
}


def ai_trainer_points_for_score(difficulty: str, average_score: float) -> int:
    # Keep the difficulty argument for API compatibility. Rewards now mirror
    # the verified score: 5 → 5 Point, 6 → 6 Point, ... 10 → 10 Point.
    score = max(0.0, min(10.0, float(average_score or 0)))
    if score < 5.0:
        return 0
    return max(5, min(10, int(score + 0.5)))

class LoginBody(BaseModel):
    email: EmailStr
    password: str


class RegisterBody(BaseModel):
    """Admin creating a user (legacy). All fields optional-ish."""
    email: EmailStr
    password: str
    name: str
    first_name: str = ""
    last_name: str = ""
    department: str = ""
    position: str = "Оператор"
    avatar_initials: str = ""
    avatar_color: str = "#FFB800"
    phone: Optional[str] = None
    telegram: Optional[str] = None
    goals_login: Optional[str] = None
    report_profile: Literal["sales", "activation"] = "sales"
    team_id: Optional[str] = None


class SelfRegisterBody(BaseModel):
    """Public self-registration."""
    email: EmailStr
    password: str
    first_name: str
    last_name: str
    phone: str = ""
    telegram: str = ""
    position: str = "Оператор"
    avatar_url: Optional[str] = None
    avatar_color: str = "#FFB800"
    team_id: Optional[str] = None


class AdminPasswordResetBody(BaseModel):
    new_password: str = Field(min_length=6, max_length=128)


class GoalsSettingsUpdateBody(BaseModel):
    allow_cross_team_reports: bool = False


class ScheduleSettingsUpdateBody(BaseModel):
    year: int = Field(ge=2020, le=2100)
    month: int = Field(ge=1, le=12)


class CubeRewardRangeBody(BaseModel):
    face: int = Field(ge=1, le=6)
    min_reward: int = Field(ge=0, le=100000)
    max_reward: int = Field(ge=0, le=100000)


class CubeFaceProbabilityBody(BaseModel):
    face: int = Field(ge=1, le=6)
    probability_percent: float = Field(ge=0, le=100)


class CubeSettingsUpdateBody(BaseModel):
    paid_spin_cost: int = Field(ge=0, le=100000)
    rewards: List[CubeRewardRangeBody] = Field(min_length=6, max_length=6)
    # Optional keeps rolling backend/frontend deployments compatible with v145.
    probabilities: Optional[List[CubeFaceProbabilityBody]] = Field(default=None, min_length=6, max_length=6)
    generosity_day_chance_percent: Optional[float] = Field(default=None, ge=0, le=100)


class TeamGoalMessageBody(BaseModel):
    message: str = Field(default="", max_length=1200)


class AchievementCreateBody(BaseModel):
    title: str = Field(min_length=2, max_length=80)
    description: str = Field(default="", max_length=300)
    icon: str = Field(default="trophy", max_length=40)
    color: str = Field(default="#FFB800", max_length=20)
    category: str = Field(default="Особливе", max_length=40)
    rarity: Literal["bronze", "silver", "gold", "diamond"] = "silver"
    xp_reward: int = Field(default=50, ge=25, le=250)
    active: bool = True


class AchievementUpdateBody(BaseModel):
    title: Optional[str] = Field(default=None, min_length=2, max_length=80)
    description: Optional[str] = Field(default=None, max_length=300)
    icon: Optional[str] = Field(default=None, max_length=40)
    color: Optional[str] = Field(default=None, max_length=20)
    category: Optional[str] = Field(default=None, max_length=40)
    rarity: Optional[Literal["bronze", "silver", "gold", "diamond"]] = None
    xp_reward: Optional[int] = Field(default=None, ge=25, le=250)
    active: Optional[bool] = None


class ProgressionReportSyncBody(BaseModel):
    snapshot_version: str = Field(min_length=1, max_length=200)
    snapshot_updated_at: str = Field(default="", max_length=100)
    overall: float = Field(ge=0, le=10000)
    metrics: dict = Field(default_factory=dict)
    rank: Optional[int] = Field(default=None, ge=1, le=100000)
    total_participants: Optional[int] = Field(default=None, ge=1, le=100000)


class AchievementPinsBody(BaseModel):
    achievement_ids: List[str] = Field(default_factory=list, max_length=3)


class XPAdjustBody(BaseModel):
    amount: int = Field(ge=1, le=100000)
    description: str = Field(default="Ручне нарахування XP", min_length=2, max_length=240)


class PageViewBody(BaseModel):
    path: str = Field(min_length=1, max_length=240)
    label: str = Field(default="", max_length=120)
    session_id: Optional[str] = Field(default=None, max_length=80)


class ReportProfileUpdateBody(BaseModel):
    report_profile: Literal["sales", "activation"]


class UserAdminUpdateBody(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    phone: Optional[str] = None
    telegram: Optional[str] = None
    goals_login: Optional[str] = None
    report_profile: Optional[Literal["sales", "activation"]] = None
    department: Optional[str] = None
    position: Optional[str] = None
    avatar_color: Optional[str] = None
    avatar_url: Optional[str] = None
    team_id: Optional[str] = None
    is_team_leader: Optional[bool] = None
    approved: Optional[bool] = None
    role: Optional[Literal["employee", "editor", "admin"]] = None


class AvatarUpdateBody(BaseModel):
    avatar_url: str


class DiamondAvatarGrantBody(BaseModel):
    avatar_code: Literal[
        "male-diamond-1",
        "female-diamond-1",
        "female-diamond-2",
        "female-diamond-3",
    ]


class GoalMetricBody(BaseModel):
    current: float = 0
    target: float = 100
    mode: Literal["reach", "maintain"] = "reach"


class UserGoalsUpdateBody(BaseModel):
    credit: GoalMetricBody = Field(default_factory=GoalMetricBody)
    debit: GoalMetricBody = Field(default_factory=GoalMetricBody)
    deposit: GoalMetricBody = Field(default_factory=GoalMetricBody)
    monthly_bonus_current: float = 0
    monthly_bonus_target: float = 0
    note: str = ""


class TokenResponse(BaseModel):
    token: str
    user: UserWithProgress


class TeamModel(BaseModel):
    id: str
    name: str
    description: str = ""
    color: str = "#FFB800"
    department: str = ""
    leader_id: Optional[str] = None
    member_count: int = 0
    total_earned: int = 0
    created_at: str


class TeamCreateBody(BaseModel):
    name: str
    description: str = ""
    color: str = "#FFB800"
    department: str = ""
    leader_id: Optional[str] = None


class TeamUpdateBody(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None
    department: Optional[str] = None
    leader_id: Optional[str] = None


class UploadResponse(BaseModel):
    url: str
    filename: str
    size: int
    mime: str


class QuestModel(BaseModel):
    id: str
    title: str
    description: str
    difficulty: Literal["easy", "medium", "hard"]
    reward: int
    goal: int
    icon: str = "target"
    active: bool = True
    created_at: str


class QuestWithProgress(QuestModel):
    progress: int = 0
    claimed: bool = False


class QuestCreateBody(BaseModel):
    title: str
    description: str = ""
    difficulty: Literal["easy", "medium", "hard"] = "easy"
    reward: int = 50
    goal: int = 1
    icon: str = "target"
    active: bool = True


class QuestUpdateBody(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    difficulty: Optional[Literal["easy", "medium", "hard"]] = None
    reward: Optional[int] = None
    goal: Optional[int] = None
    icon: Optional[str] = None
    active: Optional[bool] = None


class PrizeModel(BaseModel):
    id: str
    title: str
    description: str = ""
    price: int
    effective_price: int = 0
    category: Literal["merch", "privilege", "certificate", "avatar"] = "merch"
    image: Optional[str] = None
    icon: str = "gift"
    stock: int = 0
    active: bool = True
    team_id: Optional[str] = None
    team_name: Optional[str] = None
    avatar_code: Optional[str] = None
    avatar_rarity: Optional[str] = None
    daily_bonus: int = 0
    task_replacements: int = 0
    promotion_id: Optional[str] = None
    promotion_discount: int = 0
    promotion_quantity_total: int = 0
    promotion_quantity_remaining: int = 0
    promotion_active: bool = False
    level_discount_points: int = 0
    level_discount_active: bool = False
    created_at: str


class PrizeCreateBody(BaseModel):
    title: str
    description: str = ""
    price: int
    category: Literal["merch", "privilege", "certificate", "avatar"] = "merch"
    image: Optional[str] = None
    icon: str = "gift"
    stock: int = 0
    active: bool = True
    team_id: Optional[str] = None
    avatar_code: Optional[str] = None
    avatar_rarity: Optional[str] = None
    daily_bonus: int = 0
    task_replacements: int = 0


class PrizeUpdateBody(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    price: Optional[int] = None
    category: Optional[Literal["merch", "privilege", "certificate", "avatar"]] = None
    image: Optional[str] = None
    icon: Optional[str] = None
    stock: Optional[int] = None
    active: Optional[bool] = None
    team_id: Optional[str] = None
    avatar_code: Optional[str] = None
    avatar_rarity: Optional[str] = None
    daily_bonus: Optional[int] = None
    task_replacements: Optional[int] = None


class PrizePromotionCreateBody(BaseModel):
    discount_points: int = Field(ge=1, le=1_000_000)
    quantity: int = Field(ge=1, le=100_000)


class PrizePromotionModel(BaseModel):
    id: str
    prize_id: str
    prize_title: str
    base_price: int
    discount_points: int
    effective_price: int
    quantity_total: int
    quantity_remaining: int
    used_count: int = 0
    active: bool = True
    team_id: Optional[str] = None
    team_name: Optional[str] = None
    created_by: str
    created_by_name: str
    created_at: str
    ended_at: Optional[str] = None


class AnnouncementCreateBody(BaseModel):
    title: str = Field(min_length=2, max_length=120)
    message: str = Field(min_length=2, max_length=4000)
    team_id: Optional[str] = None


class AnnouncementUpdateBody(BaseModel):
    title: Optional[str] = Field(default=None, min_length=2, max_length=120)
    message: Optional[str] = Field(default=None, min_length=2, max_length=4000)
    active: Optional[bool] = None


class AnnouncementModel(BaseModel):
    id: str
    title: str
    message: str
    active: bool = True
    team_id: Optional[str] = None
    team_name: Optional[str] = None
    created_by: str
    created_by_name: str
    created_at: str
    updated_at: Optional[str] = None
    dismissed_count: int = 0


class TeamBankContributorModel(BaseModel):
    user_id: str
    user_name: str
    avatar_initials: str = ""
    avatar_color: str = "#FFB800"
    avatar_url: Optional[str] = None
    avatar_rarity: str = "basic"
    total_amount: int = 0
    contribution_count: int = 0
    last_contributed_at: Optional[str] = None


class TeamBankModel(BaseModel):
    id: str
    team_id: str
    team_name: str
    title: str = "Банка Команди"
    active: bool = True
    cycle_number: int = 1
    goal_points: int = 15000
    current_points: int = 0
    reward_title: str = "Групова зустріч на 30 хв"
    description: str = "Разом збираємо на групову зустріч"
    progress_percent: int = 0
    remaining_points: int = 0
    unlocked: bool = False
    unlocked_at: Optional[str] = None
    my_total: int = 0
    contributors: List[TeamBankContributorModel] = Field(default_factory=list)
    updated_at: str
    created_at: str


class TeamBankContributionBody(BaseModel):
    amount: int = Field(default=100, ge=1, le=5000)


class TeamBankCreateBody(BaseModel):
    team_id: str = Field(min_length=1, max_length=120)
    title: str = Field(min_length=2, max_length=120)
    goal_points: int = Field(ge=1, le=10_000_000)
    description: str = Field(min_length=2, max_length=2000)
    reward_title: str = Field(min_length=2, max_length=240)
    active: bool = True


class TeamBankUpdateBody(BaseModel):
    title: Optional[str] = Field(default=None, min_length=2, max_length=120)
    goal_points: Optional[int] = Field(default=None, ge=1, le=10_000_000)
    description: Optional[str] = Field(default=None, min_length=2, max_length=2000)
    reward_title: Optional[str] = Field(default=None, min_length=2, max_length=240)
    active: Optional[bool] = None


class OrderModel(BaseModel):
    id: str
    user_id: str
    user_name: str
    prize_id: str
    prize_title: str
    price: int
    base_price: Optional[int] = None
    discount_points: int = 0
    level_discount_points: int = 0
    promotion_id: Optional[str] = None
    status: Literal["processing", "ready", "delivered", "cancelled"]
    team_id: Optional[str] = None
    team_name: Optional[str] = None
    created_at: str


class OrderStatusBody(BaseModel):
    status: Literal["processing", "ready", "delivered", "cancelled"]


class TransactionModel(BaseModel):
    id: str
    user_id: str
    kind: str
    amount: int  # positive = credit, negative = debit
    description: str = ""
    created_at: str


class PointsAdjustBody(BaseModel):
    amount: int
    mode: Literal["delta", "set"] = "delta"
    description: str = "Ручне коригування адміном"


# ────────────────────────────────────────────────────────────────────────
# App + auth deps
# ────────────────────────────────────────────────────────────────────────
app = FastAPI(title="VPDK Bonus API")
api = APIRouter(prefix="/api")
bearer = HTTPBearer(auto_error=False)


def _sanitize_user(doc: dict) -> UserPublic:
    doc = {**doc}
    doc.pop("password_hash", None)
    doc.pop("_id", None)
    doc.setdefault("telegram_id", None)
    doc.setdefault("telegram", None)
    doc.setdefault("goals_login", None)
    if doc.get("report_profile") not in {"sales", "activation"}:
        doc["report_profile"] = "sales"
    doc.setdefault("phone", None)
    doc.setdefault("first_name", "")
    doc.setdefault("last_name", "")
    doc.setdefault("avatar_url", None)
    doc.setdefault("team_id", None)
    doc.setdefault("team_name", None)
    doc.setdefault("is_team_leader", False)
    doc.setdefault("approved", True)
    doc.setdefault("owned_avatar_ids", [])
    doc.setdefault("active_avatar_prize_id", None)
    doc.setdefault("avatar_rarity", "basic")
    doc.setdefault("avatar_daily_bonus", 0)
    doc.setdefault("avatar_task_replacements", 0)
    doc.setdefault("avatar_bonus_last_date", None)
    doc.setdefault("diamond_avatar_code", None)
    doc.setdefault("diamond_avatar_expires_at", None)
    doc.setdefault("diamond_avatar_granted_at", None)
    doc.setdefault("active_profile_title", None)
    doc.setdefault("active_profile_frame", None)
    doc.setdefault("active_name_color", None)
    doc.setdefault("bonus_cube_spins", 0)
    doc.setdefault("store_discount_tokens", 0)
    doc.setdefault("reward_inventory", [])
    doc.setdefault("pinned_achievement_ids", [])
    doc["diamond_avatar_active"] = _diamond_avatar_is_active(doc)
    return UserPublic(**doc)


def _user_with_progress(doc: dict) -> UserWithProgress:
    base = _sanitize_user(doc).model_dump()
    lvl, xp, need = level_from_total_xp(base["total_xp"])
    base["level"] = lvl
    base["level_title"] = profile_level_title(lvl)
    base["xp"] = xp
    base["xp_to_next"] = need
    return UserWithProgress(**base)


async def _award_xp(
    user_id: str,
    amount: int,
    source: str,
    event_key: str,
    description: str,
    meta: Optional[dict] = None,
    awarded_by: Optional[str] = None,
) -> dict:
    """Award XP exactly once for a stable event key and record the level change."""
    amount = max(0, int(amount or 0))
    if not amount:
        return {"awarded": False, "amount": 0}
    event_id = f"{user_id}:{event_key}"
    created_at = now_iso()
    ledger = {
        "id": event_id,
        "user_id": user_id,
        "source": str(source or "activity")[:80],
        "event_key": str(event_key)[:240],
        "amount": amount,
        "description": str(description or "Нарахування XP")[:300],
        "meta": meta or {},
        "awarded_by": awarded_by,
        "created_at": created_at,
    }
    try:
        await db.xp_ledger.insert_one(ledger)
    except DuplicateKeyError:
        existing = await db.xp_ledger.find_one({"id": event_id}, {"_id": 0}) or ledger
        return {"awarded": False, "amount": 0, "event": existing}

    before = await db.users.find_one_and_update(
        {"id": user_id},
        {"$inc": {"total_xp": amount}},
        return_document=ReturnDocument.BEFORE,
        projection={"_id": 0},
    )
    if not before:
        await db.xp_ledger.delete_one({"id": event_id})
        return {"awarded": False, "amount": 0}

    before_level, _, _ = level_from_total_xp(before.get("total_xp", 0))
    after_total = int(before.get("total_xp", 0) or 0) + amount
    after_level, _, _ = level_from_total_xp(after_total)
    await db.xp_ledger.update_one(
        {"id": event_id},
        {"$set": {
            "user_name": before.get("name") or before.get("email") or "Користувач",
            "team_id": before.get("team_id"),
            "level_before": before_level,
            "level_after": after_level,
            "total_xp_after": after_total,
        }},
    )

    if after_level > before_level:
        for unlocked_level in range(before_level + 1, after_level + 1):
            level_event_id = f"{user_id}:level:{unlocked_level}"
            try:
                await db.level_up_events.insert_one({
                    "id": level_event_id,
                    "user_id": user_id,
                    "level": unlocked_level,
                    "level_title": profile_level_title(unlocked_level),
                    "source_event_id": event_id,
                    "seen_at": None,
                    "created_at": created_at,
                })
                await _notify(
                    user_id,
                    "level_up",
                    f"Новий рівень: {unlocked_level}!",
                    f"Твій статус — {profile_level_title(unlocked_level)}. Нагорода вже чекає в особистому кабінеті.",
                    "/profile",
                    "sparkles",
                    "achievements",
                    {"level": unlocked_level},
                )
            except DuplicateKeyError:
                pass

    return {
        "awarded": True,
        "amount": amount,
        "level_before": before_level,
        "level_after": after_level,
        "event": {**ledger, "level_before": before_level, "level_after": after_level},
    }


def _has_three_equal_cube_faces(spins: List[dict]) -> bool:
    faces = [int(item.get("face") or 0) for item in spins if int(item.get("face") or 0) in range(1, 7)]
    return any(faces[index] == faces[index - 1] == faces[index - 2] for index in range(2, len(faces)))


async def _progression_stats(user: dict) -> dict:
    user_id = user["id"]
    approved_daily, approved_applications, perfect_rows, contribution_rows, order_count, cube_days, hidden_rows, bonus_count, report_progress = await asyncio.gather(
        db.daily_task_reviews.count_documents({"user_id": user_id, "status": "approved"}),
        db.applications.count_documents({"user_id": user_id, "status": "approved"}),
        db.daily_task_reviews.aggregate([
            {"$match": {"user_id": user_id, "status": "approved"}},
            {"$group": {"_id": "$date", "count": {"$sum": 1}}},
            {"$match": {"count": {"$gte": 3}}},
        ]).to_list(1000),
        db.team_bank_contributions.find({"user_id": user_id}, {"_id": 0, "bank_id": 1, "cycle_number": 1, "amount": 1}).to_list(5000),
        db.orders.count_documents({"user_id": user_id}),
        db.daily_games.find({"user_id": user_id}, {"_id": 0, "date": 1, "cube_spins": 1, "cube_face": 1, "cube_tier": 1}).sort("date", 1).to_list(2000),
        db.hidden_object_completions.find({"user_id": user_id}, {"_id": 0, "best_mistakes": 1}).to_list(1000),
        db.bonus_match_completions.count_documents({"user_id": user_id}),
        db.progression_reports.find_one({"user_id": user_id}, {"_id": 0}),
    )

    contribution_rows = list(contribution_rows or [])
    contributed_bank_ids = list({row.get("bank_id") for row in contribution_rows if row.get("bank_id")})
    unlocked_banks = set()
    if contributed_bank_ids:
        unlocked_banks = set(await db.team_banks.distinct("id", {
            "id": {"$in": contributed_bank_ids},
            "unlocked_at": {"$ne": None},
        }))

    spins = []
    for day in cube_days or []:
        day_spins = day.get("cube_spins") or []
        if day_spins:
            spins.extend(day_spins)
        elif day.get("cube_face"):
            spins.append({"face": day.get("cube_face"), "tier": day.get("cube_tier"), "spun_at": day.get("date")})
    spins.sort(key=lambda item: str(item.get("spun_at") or ""))

    report_progress = report_progress or {}
    return {
        "quests_completed": int(approved_daily) + int(approved_applications),
        "perfect_days": len(perfect_rows or []),
        "streak": int(user.get("streak", 0) or 0),
        "projection_100_days": len(report_progress.get("qualified_dates") or []),
        "projection_triple_days": len(report_progress.get("triple_dates") or []),
        "projection_streak": int(report_progress.get("best_qualified_streak", 0) or 0),
        "projection_first_places": 1 if int(((report_progress.get("monthly_rank") or {}).get("rank")) or 0) == 1 else 0,
        "projection_comebacks": int(report_progress.get("comeback_count", 0) or 0),
        "projection_records": int(report_progress.get("record_count", 0) or 0),
        "bank_contributions": len(contribution_rows),
        "bank_points": sum(max(0, int(row.get("amount") or 0)) for row in contribution_rows),
        "team_goals": len(unlocked_banks),
        "orders": int(order_count),
        "owned_avatars": len(set(user.get("owned_avatar_ids") or [])),
        "cube_spins": len(spins),
        "cube_sixes": sum(1 for item in spins if int(item.get("face") or 0) == 6),
        "cube_rare": sum(1 for item in spins if item.get("tier") in {"five", "six", "rare", "legendary"}),
        "cube_same_three": 1 if _has_three_equal_cube_faces(spins) else 0,
        "detective_levels": len(hidden_rows or []),
        "detective_perfect": sum(1 for item in (hidden_rows or []) if int(item.get("best_mistakes", 1) or 0) == 0),
        "bonus_match_levels": int(bonus_count),
        "last_prize_buys": int(user.get("last_prize_buys", 0) or 0),
    }


def _achievement_public(definition: dict, progress_value: int, grant: Optional[dict] = None) -> dict:
    target = max(1, int(definition.get("target") or 1))
    unlocked = bool(grant)
    secret = bool(definition.get("secret"))
    return {
        **definition,
        "title": "Секретне досягнення" if secret and not unlocked else definition["title"],
        "description": "Виконай приховану умову, щоб відкрити нагороду." if secret and not unlocked else definition["description"],
        "icon": "lock" if secret and not unlocked else definition.get("icon", "award"),
        "unlocked": unlocked,
        "progress_value": target if unlocked else min(target, max(0, int(progress_value or 0))),
        "progress_target": target,
        "progress": None if secret and not unlocked else f"{target if unlocked else min(target, max(0, int(progress_value or 0)))} / {target} {definition.get('unit', '')}".strip(),
        "granted_at": grant.get("granted_at") if grant else None,
        "seen": bool(grant and grant.get("seen_at")),
        "system": True,
    }


async def _sync_system_achievements(user: dict) -> tuple[List[dict], List[dict], dict]:
    stats = await _progression_stats(user)
    grants = await db.user_achievements.find(
        {"user_id": user["id"], "achievement_id": {"$in": [item["id"] for item in SYSTEM_ACHIEVEMENTS]}},
        {"_id": 0},
    ).to_list(len(SYSTEM_ACHIEVEMENTS))
    by_id = {item["achievement_id"]: item for item in grants}
    newly_unlocked = []

    for definition in SYSTEM_ACHIEVEMENTS:
        achievement_id = definition["id"]
        value = int(stats.get(definition["stat"], 0) or 0)
        if achievement_id in by_id or value < int(definition["target"]):
            continue
        granted_at = now_iso()
        grant = {
            "id": f"{user['id']}:{achievement_id}",
            "user_id": user["id"],
            "achievement_id": achievement_id,
            "system": True,
            "granted_by": "system",
            "granted_by_name": "VPDK Bonus",
            "granted_at": granted_at,
            "seen_at": None,
        }
        try:
            await db.user_achievements.insert_one(grant)
        except DuplicateKeyError:
            continue
        grant.pop("_id", None)
        by_id[achievement_id] = grant
        xp_reward = int(definition.get("xp_reward") or 0)
        if xp_reward:
            await _award_xp(
                user["id"], xp_reward, "achievement", f"achievement:{achievement_id}",
                f"Досягнення: {definition['title']}", {"achievement_id": achievement_id},
            )
        public = _achievement_public(definition, value, grant)
        newly_unlocked.append(public)
        await _notify(
            user["id"], "achievement", "Нове досягнення!", definition["title"],
            "/profile", definition.get("icon", "award"), "achievements",
            {"achievement_id": achievement_id, "xp_reward": xp_reward},
        )

    views = [
        _achievement_public(definition, stats.get(definition["stat"], 0), by_id.get(definition["id"]))
        for definition in SYSTEM_ACHIEVEMENTS
    ]
    return views, newly_unlocked, stats


async def _custom_achievement_views(user_id: str) -> List[dict]:
    grants = await db.user_achievements.find(
        {"user_id": user_id, "achievement_id": {"$nin": [item["id"] for item in SYSTEM_ACHIEVEMENTS]}},
        {"_id": 0},
    ).sort("granted_at", -1).to_list(500)
    if not grants:
        return []
    definitions = await db.achievements.find(
        {"id": {"$in": [grant["achievement_id"] for grant in grants]}, "active": {"$ne": False}},
        {"_id": 0},
    ).to_list(500)
    by_id = {item["id"]: item for item in definitions}
    result = []
    for grant in grants:
        definition = by_id.get(grant["achievement_id"])
        if not definition:
            continue
        result.append({
            **definition,
            "category": definition.get("category") or "Особливе",
            "rarity": definition.get("rarity") or "silver",
            "xp_reward": int(definition.get("xp_reward") or 50),
            "unlocked": True,
            "progress_value": 1,
            "progress_target": 1,
            "progress": "1 / 1",
            "granted_at": grant.get("granted_at"),
            "seen": bool(grant.get("seen_at")),
            "custom": True,
        })
    return result


def _projection_workday_streak(values: List[str]) -> int:
    dates = sorted({datetime.strptime(value, "%Y-%m-%d").date() for value in values if re.match(r"^\d{4}-\d{2}-\d{2}$", str(value or ""))})
    if not dates:
        return 0
    best = current = 1
    for previous, today in zip(dates, dates[1:]):
        expected = previous + timedelta(days=1)
        while expected.weekday() >= 5:
            expected += timedelta(days=1)
        current = current + 1 if today == expected else 1
        best = max(best, current)
    return best


async def _progression_payload(user: dict) -> dict:
    current = await db.users.find_one({"id": user["id"]}, {"_id": 0}) or user
    system_achievements, newly_unlocked, stats = await _sync_system_achievements(current)
    custom_achievements = await _custom_achievement_views(user["id"])
    fresh = await db.users.find_one({"id": user["id"]}, {"_id": 0}) or current
    public_user = _user_with_progress(fresh).model_dump()
    pinned = list(dict.fromkeys(fresh.get("pinned_achievement_ids") or []))[:3]
    achievements = system_achievements + custom_achievements
    achievements.sort(key=lambda item: (0 if item.get("id") in pinned else 1, 0 if item.get("unlocked") else 1, item.get("category", ""), item.get("title", "")))
    claims = await db.user_level_rewards.find({"user_id": user["id"]}, {"_id": 0}).to_list(len(LEVEL_REWARDS))
    claimed_by_level = {int(item.get("level") or 0): item for item in claims}
    level_rewards = [{
        **reward,
        "unlocked": int(public_user["level"]) >= int(reward["level"]),
        "claimed": int(reward["level"]) in claimed_by_level,
        "claimed_at": (claimed_by_level.get(int(reward["level"])) or {}).get("claimed_at"),
    } for reward in LEVEL_REWARDS]
    next_reward = next((item for item in level_rewards if not item["claimed"]), None)
    latest_level_up = await db.level_up_events.find_one(
        {"user_id": user["id"], "seen_at": None}, {"_id": 0}, sort=[("level", -1)]
    )
    xp_history = await db.xp_ledger.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(20)
    monthly_rank = await db.progression_reports.find_one({"user_id": user["id"]}, {"_id": 0}) or {}
    return {
        "user": public_user,
        "level": {
            "current": public_user["level"],
            "title": public_user["level_title"],
            "xp": public_user["xp"],
            "xp_to_next": public_user["xp_to_next"],
            "total_xp": public_user["total_xp"],
            "max_level": MAX_PROFILE_LEVEL,
        },
        "monthly_rank": monthly_rank.get("monthly_rank") or {**_monthly_rank_tier(0), "overall": 0, "rank": None, "total_participants": None},
        "achievements": achievements,
        "newly_unlocked": [item for item in achievements if item.get("unlocked") and not item.get("seen")],
        "pinned_achievement_ids": pinned,
        "level_rewards": level_rewards,
        "next_level_reward": next_reward,
        "latest_level_up": latest_level_up,
        "xp_history": xp_history,
        "stats": stats,
    }


async def get_current_user(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer),
) -> dict:
    if not creds:
        raise HTTPException(status_code=401, detail="Не авторизовано")
    try:
        payload = jwt.decode(creds.credentials, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Токен прострочено")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Невірний токен")
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="Користувача не знайдено")
    token_version = int(payload.get("ver", 0) or 0)
    current_version = int(user.get("auth_version", 0) or 0)
    if token_version != current_version:
        raise HTTPException(status_code=401, detail="Сесію завершено. Увійдіть знову")
    user = await _expire_diamond_avatar_if_needed(user)
    return user


async def get_current_admin(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Тільки для адміністраторів")
    return user


async def get_current_admin_or_editor(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") not in {"admin", "editor"}:
        raise HTTPException(status_code=403, detail="Доступ лише для адміністратора або редактора")
    return user


async def get_bot_caller(x_bot_token: str = Header(default="", alias="X-Bot-Token")) -> bool:
    if x_bot_token != BOT_API_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid bot token")
    return True


async def _apply_avatar_daily_bonus(user: dict) -> dict:
    """Credit the equipped avatar's daily Point bonus once per Kyiv calendar day."""
    bonus = max(0, int(user.get("avatar_daily_bonus") or 0))
    if bonus <= 0:
        return user
    date_key = kyiv_today_key()
    result = await db.users.update_one(
        {"id": user["id"], "avatar_bonus_last_date": {"$ne": date_key}},
        {"$inc": {"balance": bonus, "total_earned": bonus}, "$set": {"avatar_bonus_last_date": date_key}},
    )
    if result.modified_count:
        await db.transactions.insert_one({
            "id": str(uuid.uuid4()), "user_id": user["id"], "kind": "avatar_daily_bonus",
            "amount": bonus, "description": f"Щоденний бонус аватара: +{bonus} Point",
            "created_at": now_iso(), "meta": {"date": date_key, "avatar_prize_id": user.get("active_avatar_prize_id")},
        })
        await _notify_points_awarded(user["id"], bonus, "Щоденний бонус активного аватара")
        return await db.users.find_one({"id": user["id"]}, {"_id": 0})
    return user

# ────────────────────────────────────────────────────────────────────────
# Auth endpoints
# ────────────────────────────────────────────────────────────────────────
@api.get("/health")
async def health():
    return {"status": "ok", "time": now_iso()}


async def _resolve_team_name(team_id: Optional[str]) -> Optional[str]:
    if not team_id:
        return None
    t = await db.teams.find_one({"id": team_id}, {"_id": 0, "name": 1})
    return t["name"] if t else None


async def _hydrate_user_team(doc: dict) -> dict:
    """Ensure team_name is set from team_id."""
    doc = {**doc}
    if doc.get("team_id") and not doc.get("team_name"):
        doc["team_name"] = await _resolve_team_name(doc.get("team_id"))
    return doc


TEAM_BANK_GOAL_POINTS = 15000
TEAM_BANK_REWARD_TITLE = "Групова зустріч на 30 хв"
TEAM_BANK_DESCRIPTION = "Разом збираємо на групову зустріч"
TEAM_BANK_TITLE = "Банка Команди"


async def _ensure_team_bank(team_id: Optional[str]) -> dict:
    if not team_id:
        raise HTTPException(status_code=400, detail="Користувач не прив’язаний до команди")
    team = await db.teams.find_one({"id": team_id}, {"_id": 0, "id": 1, "name": 1})
    if not team:
        raise HTTPException(status_code=404, detail="Команду не знайдено")
    current_time = now_iso()
    defaults = {
        "id": f"team-bank-{team_id}",
        "team_id": team_id,
        "team_name": team.get("name") or "Команда",
        "title": TEAM_BANK_TITLE,
        "active": True,
        "goal_points": TEAM_BANK_GOAL_POINTS,
        "current_points": 0,
        "reward_title": TEAM_BANK_REWARD_TITLE,
        "description": TEAM_BANK_DESCRIPTION,
        "cycle_number": 1,
        "unlocked_at": None,
        "last_reset_at": None,
        "last_reset_by": None,
        "created_at": current_time,
        "updated_at": current_time,
    }
    default_bank_id = defaults["id"]
    insert_defaults = {**defaults}
    insert_defaults.pop("team_name", None)
    await db.team_banks.update_one(
        {"id": default_bank_id},
        {
            "$setOnInsert": insert_defaults,
            "$set": {"team_name": defaults["team_name"]},
        },
        upsert=True,
    )
    doc = await db.team_banks.find_one({"id": default_bank_id}, {"_id": 0}) or defaults
    doc.setdefault("created_at", current_time)
    doc.setdefault("updated_at", current_time)
    doc.setdefault("title", TEAM_BANK_TITLE)
    doc.setdefault("active", True)
    doc.setdefault("goal_points", TEAM_BANK_GOAL_POINTS)
    doc.setdefault("current_points", 0)
    doc.setdefault("reward_title", TEAM_BANK_REWARD_TITLE)
    doc.setdefault("description", TEAM_BANK_DESCRIPTION)
    doc.setdefault("cycle_number", 1)
    doc.setdefault("last_reset_at", None)
    doc.setdefault("last_reset_by", None)
    return doc


async def _team_bank_model(bank: dict, current_user_id: Optional[str] = None) -> TeamBankModel:
    team_id = str(bank.get("team_id") or "")
    bank_id = str(bank.get("id") or f"team-bank-{team_id}")
    cycle_number = max(1, int(bank.get("cycle_number") or 1))
    cycle_match = {"cycle_number": cycle_number}
    if cycle_number == 1:
        cycle_match = {"$or": [{"cycle_number": 1}, {"cycle_number": {"$exists": False}}]}
    contribution_match = {"bank_id": bank_id, **cycle_match}
    # Contributions made before multi-bank support did not have bank_id.
    if bank_id == f"team-bank-{team_id}":
        contribution_match = {
            "$and": [
                {"team_id": team_id},
                cycle_match,
                {"$or": [{"bank_id": bank_id}, {"bank_id": {"$exists": False}}]},
            ],
        }
    rows = await db.team_bank_contributions.aggregate([
        {"$match": contribution_match},
        {"$group": {
            "_id": "$user_id",
            "total_amount": {"$sum": "$amount"},
            "contribution_count": {"$sum": 1},
            "last_contributed_at": {"$max": "$created_at"},
        }},
        {"$sort": {"total_amount": -1, "last_contributed_at": 1, "_id": 1}},
    ]).to_list(5000)
    user_ids = [str(row.get("_id")) for row in rows if row.get("_id")]
    user_map = {}
    if user_ids:
        users = await db.users.find(
            {"id": {"$in": user_ids}},
            {"_id": 0, "id": 1, "name": 1, "avatar_initials": 1, "avatar_color": 1, "avatar_url": 1, "avatar_rarity": 1},
        ).to_list(len(user_ids) + 5)
        user_map = {str(doc["id"]): doc for doc in users}
    contributors = []
    my_total = 0
    for row in rows:
        user_id = str(row.get("_id") or "")
        profile = user_map.get(user_id, {})
        total_amount = int(row.get("total_amount") or 0)
        if current_user_id and user_id == current_user_id:
            my_total = total_amount
        contributors.append(TeamBankContributorModel(
            user_id=user_id,
            user_name=profile.get("name") or "Користувач",
            avatar_initials=profile.get("avatar_initials", "?"),
            avatar_color=profile.get("avatar_color", "#FFB800"),
            avatar_url=profile.get("avatar_url"),
            avatar_rarity=profile.get("avatar_rarity", "basic"),
            total_amount=total_amount,
            contribution_count=int(row.get("contribution_count") or 0),
            last_contributed_at=row.get("last_contributed_at"),
        ))
    goal_points = max(1, int(bank.get("goal_points") or TEAM_BANK_GOAL_POINTS))
    current_points = max(0, int(bank.get("current_points") or 0))
    progress_percent = min(100, int(round((current_points / goal_points) * 100)))
    remaining_points = max(0, goal_points - current_points)
    unlocked_at = bank.get("unlocked_at")
    return TeamBankModel(
        id=bank_id,
        team_id=team_id,
        team_name=bank.get("team_name") or "Команда",
        title=bank.get("title") or TEAM_BANK_TITLE,
        active=bool(bank.get("active", True)),
        cycle_number=cycle_number,
        goal_points=goal_points,
        current_points=current_points,
        reward_title=bank.get("reward_title") or TEAM_BANK_REWARD_TITLE,
        description=bank.get("description") or TEAM_BANK_DESCRIPTION,
        progress_percent=progress_percent,
        remaining_points=remaining_points,
        unlocked=bool(unlocked_at or current_points >= goal_points),
        unlocked_at=unlocked_at,
        my_total=my_total,
        contributors=contributors,
        updated_at=bank.get("updated_at") or now_iso(),
        created_at=bank.get("created_at") or bank.get("updated_at") or now_iso(),
    )


async def _team_bank_response(team_id: str, current_user_id: Optional[str] = None) -> TeamBankModel:
    """Backward-compatible response for the original default bank endpoint."""
    return await _team_bank_model(await _ensure_team_bank(team_id), current_user_id)


async def _team_banks_response(
    team_id: str,
    current_user_id: Optional[str] = None,
    *,
    include_inactive: bool = False,
) -> List[TeamBankModel]:
    await _ensure_team_bank(team_id)
    query = {"team_id": team_id}
    if not include_inactive:
        query["active"] = {"$ne": False}
    docs = await db.team_banks.find(query, {"_id": 0}).sort([("created_at", 1), ("title", 1)]).to_list(500)
    return [await _team_bank_model(doc, current_user_id) for doc in docs]


async def _goals_settings() -> dict:
    doc = await db.app_settings.find_one({"id": "goals_visibility"}, {"_id": 0}) or {}
    return {
        "allow_cross_team_reports": bool(doc.get("allow_cross_team_reports", False)),
        "updated_at": doc.get("updated_at"),
        "updated_by": doc.get("updated_by"),
    }


async def _schedule_settings() -> dict:
    """Return the global month that should be shown in the work calendar."""
    local_now = datetime.now(KYIV_TZ)
    doc = await db.app_settings.find_one({"id": "work_schedule_calendar"}, {"_id": 0}) or {}
    try:
        year = int(doc.get("year") or local_now.year)
        month = int(doc.get("month") or local_now.month)
    except (TypeError, ValueError):
        year, month = local_now.year, local_now.month
    if year < 2020 or year > 2100:
        year = local_now.year
    if month < 1 or month > 12:
        month = local_now.month
    return {
        "id": "work_schedule_calendar",
        "year": year,
        "month": month,
        "month_key": f"{year:04d}-{month:02d}",
        "updated_at": doc.get("updated_at"),
        "updated_by": doc.get("updated_by"),
        "updated_by_name": doc.get("updated_by_name"),
    }


def _normalize_team_report_key(value: Optional[str]) -> str:
    source = str(value or "").strip().lower()
    compact = re.sub(r"[^a-zа-яіїєґ0-9]+", "", source)
    match = re.search(r"(?:tm|тм)(\d+)", compact)
    if match:
        return f"tm{match.group(1)}"
    return compact


def _goals_access_signature(
    current_team: Optional[dict],
    allow_cross_team: bool,
    allowed_logins: List[str],
    participants: Optional[List[dict]] = None,
) -> str:
    import hashlib
    participant_teams = []
    for participant in participants or []:
        login = str(participant.get("goals_login") or "").strip().lower()
        if not login:
            continue
        participant_teams.append({
            "login": login,
            "team_id": str(participant.get("team_id") or ""),
            "team_key": _normalize_team_report_key(participant.get("team_name")),
            "report_profile": str(participant.get("report_profile") or "sales"),
        })
    participant_teams.sort(key=lambda item: (item["login"], item["team_id"], item["team_key"]))
    payload = {
        "team_id": (current_team or {}).get("id"),
        "team_name": (current_team or {}).get("name"),
        "allow_cross_team_reports": bool(allow_cross_team),
        "allowed_goals_logins": sorted(set(str(value or "").strip().lower() for value in allowed_logins if value)),
        "participant_teams": participant_teams,
    }
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]


async def _active_prize_promotion(prize_id: str) -> Optional[dict]:
    return await db.prize_promotions.find_one(
        {
            "prize_id": prize_id,
            "active": True,
            "quantity_remaining": {"$gt": 0},
        },
        {"_id": 0},
        sort=[("created_at", -1)],
    )


async def _prize_with_team(doc: dict) -> dict:
    item = {**doc}
    item.pop("_id", None)
    team_id = item.get("team_id")
    item["team_name"] = await _resolve_team_name(team_id) if team_id else None
    base_price = max(0, int(item.get("price") or 0))
    promotion = await _active_prize_promotion(str(item.get("id") or ""))
    if promotion:
        discount = max(0, min(base_price, int(promotion.get("discount_points") or 0)))
        item.update({
            "effective_price": max(0, base_price - discount),
            "promotion_id": promotion.get("id"),
            "promotion_discount": discount,
            "promotion_quantity_total": max(0, int(promotion.get("quantity_total") or 0)),
            "promotion_quantity_remaining": max(0, int(promotion.get("quantity_remaining") or 0)),
            "promotion_active": True,
        })
    else:
        item.update({
            "effective_price": base_price,
            "promotion_id": None,
            "promotion_discount": 0,
            "promotion_quantity_total": 0,
            "promotion_quantity_remaining": 0,
            "promotion_active": False,
        })
    return item


@api.post("/auth/login", response_model=TokenResponse)
async def auth_login(body: LoginBody):
    email = body.email.lower().strip()
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Невірний email або пароль")
    if user.get("approved") is False:
        raise HTTPException(status_code=403, detail="Обліковий запис ще не підтверджено адміністратором")
    token = create_token(user["id"], user["email"], user["role"], user.get("auth_version", 0))
    user = await _touch_daily_streak(user)
    user = await _apply_avatar_daily_bonus(user)
    user = await _hydrate_user_team(user)
    return TokenResponse(token=token, user=_user_with_progress(user))


@api.post("/auth/register", response_model=UserPublic, status_code=201)
async def auth_register(body: RegisterBody, admin: dict = Depends(get_current_admin)):
    email = body.email.lower().strip()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="Email вже існує")
    initials = body.avatar_initials or "".join([p[0] for p in body.name.split()[:2]]).upper()
    doc = {
        "id": str(uuid.uuid4()),
        "email": email,
        "password_hash": hash_password(body.password),
        "auth_version": 0,
        "name": body.name,
        "first_name": body.first_name or body.name.split(" ")[0],
        "last_name": body.last_name or " ".join(body.name.split(" ")[1:]),
        "role": "employee",
        "department": body.department,
        "position": body.position,
        "avatar_initials": initials or "??",
        "avatar_color": body.avatar_color,
        "avatar_url": None,
        "balance": 0,
        "total_earned": 0,
        "total_xp": 0,
        "streak": 0,
        "last_active_date": None,
        "phone": body.phone,
        "telegram": body.telegram,
        "telegram_id": None,
        "goals_login": (body.goals_login or "").strip().lower() or None,
        "report_profile": body.report_profile,
        "team_id": body.team_id,
        "is_team_leader": False,
        "approved": True,
        "created_at": now_iso(),
    }
    await db.users.insert_one(doc)
    doc = await _hydrate_user_team(doc)
    return _sanitize_user(doc)


class SelfRegisterResponse(BaseModel):
    ok: bool = True
    pending: bool = True
    message: str


@api.post("/auth/register/self", response_model=SelfRegisterResponse, status_code=201)
async def auth_register_self(body: SelfRegisterBody):
    """Public self-registration. Requires admin approval before login."""
    email = body.email.lower().strip()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="Email вже існує")
    if len(body.password) < 6:
        raise HTTPException(status_code=400, detail="Пароль повинен бути щонайменше 6 символів")
    first = body.first_name.strip()
    last = body.last_name.strip()
    if not first or not last:
        raise HTTPException(status_code=400, detail="Ім'я та прізвище обов'язкові")
    if body.team_id:
        exists = await db.teams.find_one({"id": body.team_id}, {"_id": 0, "id": 1})
        if not exists:
            raise HTTPException(status_code=400, detail="Команду не знайдено")
    initials = (first[0] + last[0]).upper() if first and last else "??"
    doc = {
        "id": str(uuid.uuid4()),
        "email": email,
        "password_hash": hash_password(body.password),
        "auth_version": 0,
        "name": f"{first} {last}",
        "first_name": first,
        "last_name": last,
        "role": "employee",
        "department": "",
        "position": body.position or "Оператор",
        "avatar_initials": initials,
        "avatar_color": body.avatar_color,
        "avatar_url": body.avatar_url,
        "balance": 0,
        "total_earned": 0,
        "total_xp": 0,
        "streak": 0,
        "last_active_date": None,
        "phone": body.phone or None,
        "telegram": body.telegram or None,
        "telegram_id": None,
        "goals_login": None,
        "report_profile": "sales",
        "team_id": body.team_id,
        "is_team_leader": False,
        "approved": False,
        "created_at": now_iso(),
    }
    await db.users.insert_one(doc)
    await _notify_admins(
        "user_pending", "Новий користувач очікує підтвердження",
        f"{doc['name']} • {doc['position']}", "/admin", "user-plus",
    )
    return SelfRegisterResponse(
        ok=True, pending=True,
        message="Реєстрацію надіслано! Акаунт активується після підтвердження адміністратором.",
    )


@api.get("/auth/me", response_model=UserWithProgress)
async def auth_me(user: dict = Depends(get_current_user)):
    user = await _touch_daily_streak(user)
    user = await _apply_avatar_daily_bonus(user)
    user = await _hydrate_user_team(user)
    return _user_with_progress(user)


@api.post("/analytics/page-view", status_code=201)
async def track_page_view(body: PageViewBody, user: dict = Depends(get_current_user)):
    """Record an authenticated employee/editor page visit for admin usage analytics."""
    if user.get("role") not in PLAYER_ROLES:
        return {"ok": True, "tracked": False}
    path = str(body.path or "").strip()
    if not path.startswith("/") or path.startswith("/admin"):
        return {"ok": True, "tracked": False}
    created_at = now_iso()
    await db.page_views.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "user_name": user.get("name", "Працівник"),
        "role": user.get("role", "employee"),
        "path": path,
        "label": str(body.label or path).strip() or path,
        "session_id": str(body.session_id or "").strip() or None,
        "date": kyiv_today_key(),
        "created_at": created_at,
    })
    return {"ok": True, "tracked": True}


@api.get("/achievements/me")
async def my_awarded_achievements(user: dict = Depends(get_current_user)):
    return (await _progression_payload(user))["achievements"]


@api.get("/progression/me")
async def my_progression(user: dict = Depends(get_current_user)):
    return await _progression_payload(user)


@api.post("/progression/report-sync")
async def sync_my_progression_report(
    body: ProgressionReportSyncBody,
    user: dict = Depends(get_current_user),
):
    date_key = kyiv_today_key()
    month_key = date_key[:7]
    metrics = {}
    for key, raw_value in (body.metrics or {}).items():
        try:
            value = float(raw_value)
        except (TypeError, ValueError):
            continue
        if math.isnan(value) or math.isinf(value) or value < 0 or value > 10000:
            continue
        metrics[str(key)[:80]] = round(value, 4)
    overall = round(float(body.overall), 4)
    all_directions_complete = len(metrics) >= 3 and all(value >= 100 for value in metrics.values())
    previous = await db.progression_reports.find_one({"user_id": user["id"]}, {"_id": 0}) or {}
    same_month = str(((previous.get("monthly_rank") or {}).get("month")) or "") == month_key
    qualified_dates = set(previous.get("qualified_dates") or []) if same_month else set()
    triple_dates = set(previous.get("triple_dates") or []) if same_month else set()
    if overall >= 100:
        qualified_dates.add(date_key)
    if all_directions_complete:
        triple_dates.add(date_key)
    best_streak = max(
        int(previous.get("best_qualified_streak", 0) or 0) if same_month else 0,
        _projection_workday_streak(list(qualified_dates)),
    )
    previous_overall = float(((previous.get("monthly_rank") or {}).get("overall")) or 0) if same_month else 0
    previous_best = float(previous.get("best_overall", 0) or 0) if same_month else 0
    comeback_count = int(previous.get("comeback_count", 0) or 0) if same_month else 0
    record_count = int(previous.get("record_count", 0) or 0) if same_month else 0
    monthly_rank = {
        **_monthly_rank_tier(overall),
        "overall": overall,
        "rank": body.rank,
        "total_participants": body.total_participants,
        "month": month_key,
        "metrics": metrics,
        "snapshot_version": body.snapshot_version,
        "snapshot_updated_at": body.snapshot_updated_at,
    }
    if same_month and previous_overall < 70 and overall >= 100:
        comeback_count += 1
    if same_month and previous_best > 0 and overall > previous_best:
        record_count += 1
    update = {
        "$set": {
            "user_id": user["id"],
            "goals_login": user.get("goals_login"),
            "team_id": user.get("team_id"),
            "qualified_dates": sorted(qualified_dates),
            "triple_dates": sorted(triple_dates),
            "best_qualified_streak": best_streak,
            "best_overall": max(previous_best, overall),
            "comeback_count": comeback_count,
            "record_count": record_count,
            "monthly_rank": monthly_rank,
            "updated_at": now_iso(),
        },
        "$setOnInsert": {"created_at": now_iso()},
    }
    await db.progression_reports.update_one({"user_id": user["id"]}, update, upsert=True)
    if overall >= 100:
        await _award_xp(
            user["id"], 25, "projection", f"projection-100:{date_key}",
            "Проекційний результат 100%+", {"overall": overall, "snapshot_version": body.snapshot_version},
        )
    if all_directions_complete:
        await _award_xp(
            user["id"], 50, "projection", f"projection-triple:{date_key}",
            "Усі три напрямки виконано на 100%+", {"metrics": metrics, "snapshot_version": body.snapshot_version},
        )
    return await _progression_payload(user)


@api.put("/progression/achievements/pins")
async def update_achievement_pins(body: AchievementPinsBody, user: dict = Depends(get_current_user)):
    ids = list(dict.fromkeys(str(value) for value in body.achievement_ids if value))[:3]
    grants = await db.user_achievements.find(
        {"user_id": user["id"], "achievement_id": {"$in": ids}}, {"_id": 0, "achievement_id": 1}
    ).to_list(3)
    granted_ids = {item["achievement_id"] for item in grants}
    if any(value not in granted_ids for value in ids):
        raise HTTPException(status_code=400, detail="Закріпити можна лише отримані досягнення")
    await db.users.update_one({"id": user["id"]}, {"$set": {"pinned_achievement_ids": ids}})
    return {"achievement_ids": ids}


@api.post("/progression/achievements/{achievement_id}/seen")
async def mark_achievement_seen(achievement_id: str, user: dict = Depends(get_current_user)):
    await db.user_achievements.update_one(
        {"user_id": user["id"], "achievement_id": achievement_id},
        {"$set": {"seen_at": now_iso()}},
    )
    return {"ok": True}


@api.post("/progression/achievements/{achievement_id}/share")
async def share_achievement(achievement_id: str, user: dict = Depends(get_current_user)):
    payload = await _progression_payload(user)
    achievement = next((item for item in payload["achievements"] if item.get("id") == achievement_id and item.get("unlocked")), None)
    if not achievement:
        raise HTTPException(status_code=404, detail="Отримане досягнення не знайдено")
    event_id = f"achievement-share:{user['id']}:{achievement_id}:{kyiv_today_key()}"
    event = {
        "id": event_id,
        "kind": "goal",
        "user_id": user["id"],
        "user_name": user.get("name") or "Користувач",
        "avatar_initials": user.get("avatar_initials") or "?",
        "avatar_color": user.get("avatar_color") or "#FFB800",
        "avatar_url": user.get("avatar_url"),
        "avatar_rarity": user.get("avatar_rarity") or "basic",
        "department": user.get("department") or "",
        "title": "поділився досягненням",
        "subtitle": f"{achievement['title']} · +{achievement.get('xp_reward', 0)} XP",
        "created_at": now_iso(),
    }
    result = await db.feed_events.update_one({"id": event_id}, {"$setOnInsert": event}, upsert=True)
    return {"ok": True, "shared": result.upserted_id is not None}


@api.post("/progression/level-up/{level}/seen")
async def mark_level_up_seen(level: int, user: dict = Depends(get_current_user)):
    await db.level_up_events.update_one(
        {"user_id": user["id"], "level": int(level)}, {"$set": {"seen_at": now_iso()}}
    )
    return {"ok": True}


@api.post("/progression/level-rewards/{level}/claim")
async def claim_level_reward(level: int, user: dict = Depends(get_current_user)):
    reward = next((item for item in LEVEL_REWARDS if int(item["level"]) == int(level)), None)
    if not reward:
        raise HTTPException(status_code=404, detail="Нагороду рівня не знайдено")
    fresh = await db.users.find_one({"id": user["id"]}, {"_id": 0}) or user
    current_level, _, _ = level_from_total_xp(fresh.get("total_xp", 0))
    if current_level < int(level):
        raise HTTPException(status_code=400, detail="Цей рівень ще не відкрито")
    claim = {
        "id": f"{user['id']}:{level}",
        "user_id": user["id"],
        "level": int(level),
        "reward": reward,
        "claimed_at": now_iso(),
    }
    try:
        await db.user_level_rewards.insert_one(claim)
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="Цю нагороду вже отримано")

    update: dict = {"$addToSet": {"reward_inventory": reward["inventory_key"]}}
    kind = reward["kind"]
    if kind == "title":
        update["$set"] = {"active_profile_title": "Впевнений старт"}
    elif kind == "avatar":
        avatar_ids = ["avatar-male-improved-1", "avatar-female-improved-1"] if int(level) == 10 else ["avatar-male-rare-1", "avatar-female-rare-1"]
        update["$addToSet"]["owned_avatar_ids"] = {"$each": avatar_ids}
    elif kind == "cube_spin":
        update["$inc"] = {"bonus_cube_spins": 1}
    elif kind == "discount":
        update["$inc"] = {"store_discount_tokens": 1}
    elif kind in {"frame", "animated_frame"}:
        update["$set"] = {"active_profile_frame": reward["inventory_key"]}
    elif kind == "name_color":
        update["$set"] = {"active_name_color": "#FFB800"}
    elif kind == "cosmetic":
        update["$set"] = {"active_profile_frame": reward["inventory_key"]}
    elif kind == "champion":
        update["$set"] = {"active_profile_title": "VPDK Champion", "active_profile_frame": reward["inventory_key"]}
    await db.users.update_one({"id": user["id"]}, update)
    await _notify(user["id"], "achievement", "Нагороду рівня отримано", reward["title"], "/profile", "gift", "achievements")
    return await _progression_payload(user)


@api.patch("/auth/me/avatar", response_model=UserWithProgress)
async def update_my_avatar(body: AvatarUpdateBody, user: dict = Depends(get_current_user)):
    raise HTTPException(status_code=403, detail="Власні аватари вимкнено. Оберіть аватар у магазині")


# ────────────────────────────────────────────────────────────────────────
# File uploads
# ────────────────────────────────────────────────────────────────────────
@api.post("/uploads", response_model=UploadResponse)
async def upload_file(
    file: UploadFile = File(...),
    category: str = Form("misc"),
    user: dict = Depends(get_current_user),
):
    """Upload an image/video/pdf. Returns absolute URL under /uploads/*."""
    if category not in ("avatars", "tasks", "misc"):
        category = "misc"
    if file.content_type not in ALLOWED_UPLOAD_TYPES:
        raise HTTPException(status_code=415, detail=f"Тип файлу не підтримується: {file.content_type}")
    # Guess extension
    ext_map = {
        "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif",
        "image/heic": ".heic", "image/heif": ".heif",
        "video/mp4": ".mp4", "video/quicktime": ".mov", "video/webm": ".webm",
        "application/pdf": ".pdf",
    }
    ext = ext_map.get(file.content_type, "")
    fname = f"{uuid.uuid4().hex}{ext}"
    target = UPLOADS_DIR / category / fname

    max_bytes = MAX_UPLOAD_MB * 1024 * 1024
    size = 0
    with open(target, "wb") as out:
        while True:
            chunk = await file.read(1024 * 512)
            if not chunk:
                break
            size += len(chunk)
            if size > max_bytes:
                out.close()
                try:
                    target.unlink()
                except Exception:
                    pass
                raise HTTPException(status_code=413, detail=f"Файл перевищує ліміт {MAX_UPLOAD_MB} МБ")
            out.write(chunk)
    return UploadResponse(
        url=f"/api/uploads/{category}/{fname}",
        filename=fname,
        size=size,
        mime=file.content_type,
    )


# ────────────────────────────────────────────────────────────────────────
# AI trainer results and admin dashboard
# ────────────────────────────────────────────────────────────────────────
@api.post("/ai-training/results", status_code=201)
async def save_ai_training_result(
    body: AITrainingResultBody,
    user: dict = Depends(get_current_user),
):
    raise HTTPException(
        status_code=410,
        detail="AI-тренажер замінено персональним котом. Відкрийте розділ «Кіт».",
    )
    ts = now_iso()
    verified_difficulty = AI_SCENARIO_DIFFICULTY.get(
        body.scenario_id,
        str(body.difficulty or "easy").strip().lower(),
    )
    verified_score = max(0.0, min(10.0, float(body.average_score or 0)))
    candidate_points = ai_trainer_points_for_score(verified_difficulty, verified_score) if body.won else 0
    first_completion = False
    if body.won:
        try:
            previous_completion = await db.ai_training_completions.find_one_and_update(
                {"user_id": user["id"], "scenario_id": body.scenario_id},
                {
                    "$setOnInsert": {
                        "id": str(uuid.uuid4()),
                        "user_id": user["id"],
                        "scenario_id": body.scenario_id,
                        "scenario_title": body.scenario_title,
                        "score": verified_score,
                        "points_awarded": candidate_points,
                        "completed_at": ts,
                    }
                },
                upsert=True,
                return_document=ReturnDocument.BEFORE,
            )
            first_completion = previous_completion is None
        except DuplicateKeyError:
            # A parallel completion already claimed the one-time reward.
            first_completion = False
    points_reward = candidate_points if first_completion else 0
    xp_reward = max(0, int(body.xp_earned or 0))

    result_payload = body.model_dump()
    result_payload.update({
        "difficulty": verified_difficulty,
        "average_score": verified_score,
        "consultation_quality": verified_score,
        "points": points_reward,
        "first_completion": first_completion,
    })
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "user_name": user.get("name") or user.get("email", "Користувач"),
        "avatar_initials": user.get("avatar_initials", ""),
        "avatar_color": user.get("avatar_color", "#FFB800"),
        **result_payload,
        "created_at": ts,
    }
    # The server calculates the reward from the verified score and awards it only
    # for the first successful completion. Client-provided points are ignored.

    await db.ai_training_results.insert_one(doc)

    increments = {}
    if points_reward:
        increments["balance"] = points_reward
        increments["total_earned"] = points_reward
    if xp_reward:
        increments["total_xp"] = xp_reward
    if increments:
        await db.users.update_one({"id": user["id"]}, {"$inc": increments})

    if points_reward:
        await db.transactions.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": user["id"],
            "kind": "ai_training",
            "amount": points_reward,
            "description": f"AI-тренажер: {body.scenario_title} • {verified_score:.1f}/10",
            "created_at": ts,
        })
        await _notify_points_awarded(user["id"], points_reward, f"AI-тренажер: {body.scenario_title}")

    doc.pop("_id", None)
    doc["reward_applied"] = points_reward
    doc["first_completion"] = first_completion
    return doc


@api.get("/admin/ai-training-dashboard")
async def admin_ai_training_dashboard(
    team_id: Optional[str] = None,
    admin: dict = Depends(get_current_admin),
):
    user_query = {"role": {"$in": PLAYER_ROLES}, "approved": {"$ne": False}}
    if team_id:
        user_query["team_id"] = team_id
    users = await db.users.find(
        user_query,
        {"_id": 0, "id": 1, "name": 1, "avatar_initials": 1, "avatar_color": 1, "team_id": 1},
    ).to_list(1000)
    user_ids = [user["id"] for user in users]
    results_query = {"user_id": {"$in": user_ids}} if user_ids else {"user_id": "__none__"}
    results = await db.ai_training_results.find(results_query, {"_id": 0}).sort("created_at", -1).to_list(2000)
    team_name = await _resolve_team_name(team_id) if team_id else None
    if team_name:
        for user in users:
            user["team_name"] = team_name

    by_user = {}
    for result in results:
        by_user.setdefault(result.get("user_id"), []).append(result)

    operators = []
    all_skill_values = {}
    now = datetime.now(timezone.utc)
    for user in users:
        rows = by_user.get(user["id"], [])
        scores = [float(r.get("average_score", 0) or 0) for r in rows]
        wins = sum(1 for r in rows if r.get("won"))
        skill_values = {}
        for row in rows:
            for name, value in (row.get("techniques") or {}).items():
                uses = int((value or {}).get("uses", 0) or 0)
                total = float((value or {}).get("total", 0) or 0)
                if uses:
                    skill_values.setdefault(name, []).append(total / uses)
                    all_skill_values.setdefault(name, []).append(total / uses)
        weakest = sorted(
            ((name, round(sum(vals) / len(vals))) for name, vals in skill_values.items()),
            key=lambda item: item[1],
        )[:3]
        last_at = rows[0].get("created_at") if rows else None
        days_inactive = 999
        if last_at:
            try:
                parsed = datetime.fromisoformat(last_at.replace("Z", "+00:00"))
                days_inactive = max(0, (now - parsed).days)
            except Exception:
                pass
        operators.append({
            **user,
            "attempts": len(rows),
            "average_score": round(sum(scores) / len(scores), 1) if scores else 0,
            "win_rate": round((wins / len(rows)) * 100) if rows else 0,
            "last_training_at": last_at,
            "days_inactive": days_inactive,
            "weakest_skills": weakest,
            "progress": [
                {"score": r.get("average_score", 0), "date": r.get("created_at")}
                for r in reversed(rows[:10])
            ],
        })

    trained = [u for u in operators if u["attempts"]]
    ranking = sorted(trained, key=lambda u: (u["average_score"], u["attempts"]), reverse=True)
    inactive = [u for u in operators if not u["attempts"] or u["days_inactive"] >= 7]
    weak_skills = sorted(
        ({"name": name, "score": round(sum(vals) / len(vals))} for name, vals in all_skill_values.items()),
        key=lambda item: item["score"],
    )[:6]
    all_scores = [float(r.get("average_score", 0) or 0) for r in results]

    sessions = [{
        "id": row.get("id"),
        "user_id": row.get("user_id"),
        "user_name": row.get("user_name", "Користувач"),
        "avatar_initials": row.get("avatar_initials", ""),
        "avatar_color": row.get("avatar_color", "#FFB800"),
        "scenario_title": row.get("scenario_title", "AI тренування"),
        "difficulty": row.get("difficulty", ""),
        "average_score": row.get("average_score", 0),
        "won": bool(row.get("won")),
        "outcome_text": row.get("outcome_text", ""),
        "created_at": row.get("created_at"),
        "conversation": row.get("conversation") or [],
    } for row in results[:100]]

    return {
        "team_average": round(sum(all_scores) / len(all_scores), 1) if all_scores else 0,
        "total_trainings": len(results),
        "trained_count": len(trained),
        "total_operators": len(operators),
        "ranking": ranking,
        "inactive": inactive,
        "weak_skills": weak_skills,
        "operators": operators,
        "sessions": sessions,
    }


# ────────────────────────────────────────────────────────────────────────
# Teams
# ────────────────────────────────────────────────────────────────────────
async def _team_with_stats(t: dict) -> dict:
    """Attach member_count and total_earned to a team doc."""
    t = {**t}
    t.pop("_id", None)
    member_count = await db.users.count_documents({"team_id": t["id"], "role": {"$in": PLAYER_ROLES}})
    pipeline = [
        {"$match": {"team_id": t["id"], "role": {"$in": PLAYER_ROLES}}},
        {"$group": {"_id": None, "sum": {"$sum": "$total_earned"}}},
    ]
    agg = await db.users.aggregate(pipeline).to_list(1)
    t["member_count"] = member_count
    t["total_earned"] = int(agg[0]["sum"]) if agg else 0
    return t


@api.get("/teams", response_model=List[TeamModel])
async def list_teams():
    """Public: list of teams for registration & selection."""
    docs = await db.teams.find({}, {"_id": 0}).sort("name", 1).to_list(500)
    result = []
    for t in docs:
        result.append(TeamModel(**(await _team_with_stats(t))))
    return result


@api.get("/admin/teams", response_model=List[TeamModel])
async def admin_list_teams(admin: dict = Depends(get_current_admin)):
    docs = await db.teams.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return [TeamModel(**(await _team_with_stats(t))) for t in docs]


@api.post("/admin/teams", response_model=TeamModel, status_code=201)
async def admin_create_team(body: TeamCreateBody, admin: dict = Depends(get_current_admin)):
    if not body.name.strip():
        raise HTTPException(status_code=400, detail="Назва обов'язкова")
    if await db.teams.find_one({"name": body.name.strip()}):
        raise HTTPException(status_code=409, detail="Команда з такою назвою вже існує")
    doc = {
        "id": str(uuid.uuid4()),
        "name": body.name.strip(),
        "description": body.description,
        "color": body.color,
        "department": body.department,
        "leader_id": body.leader_id,
        "created_at": now_iso(),
    }
    await db.teams.insert_one(doc)
    return TeamModel(**(await _team_with_stats(doc)))


@api.patch("/admin/teams/{team_id}", response_model=TeamModel)
async def admin_update_team(team_id: str, body: TeamUpdateBody, admin: dict = Depends(get_current_admin)):
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="Немає полів для оновлення")
    r = await db.teams.update_one({"id": team_id}, {"$set": updates})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Команду не знайдено")
    # if leader_id changed, unset previous leaders in team, mark new one
    if "leader_id" in updates and updates["leader_id"]:
        await db.users.update_many({"team_id": team_id, "is_team_leader": True}, {"$set": {"is_team_leader": False}})
        await db.users.update_one({"id": updates["leader_id"]}, {"$set": {"team_id": team_id, "is_team_leader": True}})
    doc = await db.teams.find_one({"id": team_id}, {"_id": 0})
    return TeamModel(**(await _team_with_stats(doc)))


@api.delete("/admin/teams/{team_id}", status_code=204)
async def admin_delete_team(team_id: str, admin: dict = Depends(get_current_admin)):
    r = await db.teams.delete_one({"id": team_id})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Команду не знайдено")
    # Unassign team from members
    await db.users.update_many({"team_id": team_id}, {"$set": {"team_id": None, "is_team_leader": False}})
    return None


@api.patch("/admin/users/{user_id}", response_model=UserWithProgress)
async def admin_update_user(user_id: str, body: UserAdminUpdateBody, admin: dict = Depends(get_current_admin)):
    target = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Користувача не знайдено")
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if "report_profile" in updates:
        updates["report_profile"] = "activation" if updates["report_profile"] == "activation" else "sales"
    if "goals_login" in updates:
        normalized_goals_login = str(updates["goals_login"] or "").strip().lower()
        updates["goals_login"] = normalized_goals_login or None
        if normalized_goals_login:
            duplicate = await db.users.find_one(
                {"goals_login": normalized_goals_login, "id": {"$ne": user_id}},
                {"_id": 0, "id": 1},
            )
            if duplicate:
                raise HTTPException(status_code=409, detail="Цей ключ Google цілей уже використовується іншим користувачем")
    if not updates:
        raise HTTPException(status_code=400, detail="Немає полів для оновлення")
    if "team_id" in updates:
        if updates["team_id"]:
            exists = await db.teams.find_one({"id": updates["team_id"]}, {"_id": 0, "id": 1})
            if not exists:
                raise HTTPException(status_code=400, detail="Команду не знайдено")
    # Rebuild name if first/last changed
    if "first_name" in updates or "last_name" in updates:
        fn = updates.get("first_name", target.get("first_name", ""))
        ln = updates.get("last_name", target.get("last_name", ""))
        if fn or ln:
            updates["name"] = f"{fn} {ln}".strip()
            initials = ((fn[:1] or "") + (ln[:1] or "")).upper()
            if initials:
                updates["avatar_initials"] = initials
    # is_team_leader single-leader-per-team invariant
    if updates.get("is_team_leader") is True and (updates.get("team_id") or target.get("team_id")):
        team_id = updates.get("team_id") or target.get("team_id")
        await db.users.update_many(
            {"team_id": team_id, "is_team_leader": True, "id": {"$ne": user_id}},
            {"$set": {"is_team_leader": False}},
        )
    result = await db.users.update_one({"id": user_id}, {"$set": updates})
    if result.matched_count != 1:
        raise HTTPException(status_code=404, detail="Користувача не знайдено")
    fresh = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not fresh:
        raise HTTPException(status_code=404, detail="Користувача не знайдено")
    if "report_profile" in updates and fresh.get("report_profile") != updates["report_profile"]:
        raise HTTPException(status_code=500, detail="Тип звітів не збережено. Оновіть backend до v126")
    fresh = await _hydrate_user_team(fresh)
    return _user_with_progress(fresh)


@api.patch("/admin/users/{user_id}/report-profile", response_model=UserWithProgress)
async def admin_update_user_report_profile(
    user_id: str,
    body: ReportProfileUpdateBody,
    admin: dict = Depends(get_current_admin),
):
    """Persist the report type through a dedicated, verifiable endpoint.

    The separate route prevents older backends from silently ignoring the new
    field while the admin UI still reports a successful generic profile save.
    """
    target = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1})
    if not target:
        raise HTTPException(status_code=404, detail="Користувача не знайдено")

    requested = "activation" if body.report_profile == "activation" else "sales"
    result = await db.users.update_one(
        {"id": user_id},
        {"$set": {"report_profile": requested, "report_profile_updated_at": now_iso()}},
    )
    if result.matched_count != 1:
        raise HTTPException(status_code=404, detail="Користувача не знайдено")

    fresh = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not fresh or fresh.get("report_profile") != requested:
        raise HTTPException(status_code=500, detail="Тип звітів не вдалося зберегти")
    fresh = await _hydrate_user_team(fresh)
    return _user_with_progress(fresh)


@api.post("/admin/users/{user_id}/diamond-avatar", response_model=UserWithProgress)
async def admin_grant_diamond_avatar(
    user_id: str,
    body: DiamondAvatarGrantBody,
    admin: dict = Depends(get_current_admin),
):
    target = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Користувача не знайдено")
    target = await _expire_diamond_avatar_if_needed(target)
    avatar = DIAMOND_AVATARS.get(body.avatar_code)
    if not avatar:
        raise HTTPException(status_code=400, detail="Невідомий алмазний аватар")

    if _diamond_avatar_is_active(target) and target.get("diamond_avatar_restore"):
        restore = target.get("diamond_avatar_restore")
    else:
        restore = {
            "avatar_url": target.get("avatar_url"),
            "active_avatar_prize_id": target.get("active_avatar_prize_id"),
            "avatar_rarity": target.get("avatar_rarity") or "basic",
            "avatar_daily_bonus": max(0, int(target.get("avatar_daily_bonus") or 0)),
            "avatar_task_replacements": max(0, int(target.get("avatar_task_replacements") or 0)),
        }

    granted_at = datetime.now(timezone.utc)
    expires_at = granted_at + timedelta(days=DIAMOND_AVATAR_DURATION_DAYS)
    updates = {
        "avatar_url": avatar["image"],
        "active_avatar_prize_id": f"diamond-avatar-{body.avatar_code}",
        "avatar_rarity": "diamond",
        "avatar_daily_bonus": DIAMOND_AVATAR_DAILY_BONUS,
        "avatar_task_replacements": DIAMOND_AVATAR_TASK_REPLACEMENTS,
        "avatar_bonus_last_date": None,
        "diamond_avatar_code": body.avatar_code,
        "diamond_avatar_expires_at": expires_at.isoformat(),
        "diamond_avatar_granted_at": granted_at.isoformat(),
        "diamond_avatar_granted_by": admin.get("id"),
        "diamond_avatar_granted_by_name": admin.get("name", "Адміністратор"),
        "diamond_avatar_restore": restore,
        "diamond_avatar_revoked_reason": None,
        "diamond_avatar_revoked_at": None,
    }
    await db.users.update_one({"id": user_id}, {"$set": updates})
    await db.admin_audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "admin_id": admin["id"],
        "admin_name": admin.get("name", "Адміністратор"),
        "action": "diamond_avatar_grant",
        "target_user_id": user_id,
        "target_user_name": target.get("name", "Користувач"),
        "meta": {
            "avatar_code": body.avatar_code,
            "duration_days": DIAMOND_AVATAR_DURATION_DAYS,
            "daily_bonus": DIAMOND_AVATAR_DAILY_BONUS,
            "task_replacements": DIAMOND_AVATAR_TASK_REPLACEMENTS,
            "expires_at": expires_at.isoformat(),
        },
        "created_at": now_iso(),
    })
    await db.feed_events.insert_one({
        "id": f"diamond-avatar-{uuid.uuid4()}",
        "source_key": f"diamond-avatar-grant:{user_id}:{granted_at.isoformat()}",
        "kind": "diamond_avatar",
        "user_id": user_id,
        "user_name": target.get("name", "Користувач"),
        "avatar_initials": target.get("avatar_initials", "?"),
        "avatar_color": target.get("avatar_color", "#7DD3FC"),
        "avatar_url": avatar["image"],
        "avatar_rarity": "diamond",
        "department": target.get("department", ""),
        "title": "отримав алмазний аватар 💎",
        "subtitle": f"{avatar['title']} на {DIAMOND_AVATAR_DURATION_DAYS} дні",
        "duration_days": DIAMOND_AVATAR_DURATION_DAYS,
        "daily_bonus": DIAMOND_AVATAR_DAILY_BONUS,
        "task_replacements": DIAMOND_AVATAR_TASK_REPLACEMENTS,
        "expires_at": expires_at.isoformat(),
        "avatar_code": body.avatar_code,
        "granted_by": admin.get("id"),
        "granted_by_name": admin.get("name", "Адміністратор"),
        "created_at": granted_at.isoformat(),
    })
    await _notify(
        user_id,
        "diamond_avatar",
        "Алмазний аватар активовано 💎",
        f"На {DIAMOND_AVATAR_DURATION_DAYS} дні: +{DIAMOND_AVATAR_DAILY_BONUS} Point щодня та +{DIAMOND_AVATAR_TASK_REPLACEMENTS} замін завдань.",
        "/tasks",
        "gem",
    )
    fresh = await db.users.find_one({"id": user_id}, {"_id": 0})
    fresh = await _hydrate_user_team(fresh)
    return _user_with_progress(fresh)


@api.delete("/admin/users/{user_id}/diamond-avatar", response_model=UserWithProgress)
async def admin_revoke_diamond_avatar(
    user_id: str,
    admin: dict = Depends(get_current_admin),
):
    target = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Користувача не знайдено")
    if not target.get("diamond_avatar_code"):
        target = await _hydrate_user_team(target)
        return _user_with_progress(target)

    fresh = await _restore_avatar_after_diamond(target, reason="admin_revoked")
    await db.admin_audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "admin_id": admin["id"],
        "admin_name": admin.get("name", "Адміністратор"),
        "action": "diamond_avatar_revoke",
        "target_user_id": user_id,
        "target_user_name": target.get("name", "Користувач"),
        "created_at": now_iso(),
    })
    await _notify(
        user_id,
        "diamond_avatar_expired",
        "Алмазний аватар вимкнено",
        "Повернено попередній аватар та його бонуси.",
        "/tasks",
        "gem",
    )
    fresh = await _hydrate_user_team(fresh)
    return _user_with_progress(fresh)


@api.patch("/admin/users/{user_id}/password")
async def admin_reset_user_password(
    user_id: str,
    body: AdminPasswordResetBody,
    admin: dict = Depends(get_current_admin),
):
    target = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1, "name": 1, "email": 1})
    if not target:
        raise HTTPException(status_code=404, detail="Користувача не знайдено")
    new_password = body.new_password.strip()
    if len(new_password) < 6:
        raise HTTPException(status_code=400, detail="Пароль повинен містити щонайменше 6 символів")
    changed_at = now_iso()
    await db.users.update_one(
        {"id": user_id},
        {
            "$set": {
                "password_hash": hash_password(new_password),
                "password_changed_at": changed_at,
            },
            "$inc": {"auth_version": 1},
        },
    )
    await db.admin_audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "admin_id": admin["id"],
        "admin_name": admin.get("name", "Адміністратор"),
        "action": "password_reset",
        "target_user_id": user_id,
        "target_user_name": target.get("name", target.get("email", "Користувач")),
        "created_at": changed_at,
    })
    return {
        "ok": True,
        "message": "Пароль змінено. Усі активні сесії користувача завершено.",
        "sessions_revoked": True,
    }


# ────────────────────────────────────────────────────────────────────────
# Achievements admin
# ────────────────────────────────────────────────────────────────────────
@api.get("/admin/achievements-dashboard")
async def admin_achievements_dashboard(
    team_id: Optional[str] = None,
    admin: dict = Depends(get_current_admin),
):
    achievements = await db.achievements.find({}, {"_id": 0}).sort("created_at", 1).to_list(500)
    user_query = {"role": {"$in": PLAYER_ROLES}}
    if team_id:
        user_query["team_id"] = team_id
    users = await db.users.find(
        user_query,
        {"_id": 0, "id": 1, "name": 1, "email": 1, "avatar_initials": 1, "avatar_color": 1, "role": 1, "team_id": 1},
    ).sort("name", 1).to_list(1000)
    user_ids = [item["id"] for item in users]
    grants_query = {"user_id": {"$in": user_ids}} if team_id else {}
    grants = await db.user_achievements.find(grants_query, {"_id": 0}).to_list(5000)
    grant_count = {}
    grants_by_user = {}
    for grant in grants:
        achievement_id = grant.get("achievement_id")
        user_id = grant.get("user_id")
        if achievement_id:
            grant_count[achievement_id] = grant_count.get(achievement_id, 0) + 1
        if user_id and achievement_id:
            grants_by_user.setdefault(user_id, []).append(achievement_id)
    team_name = await _resolve_team_name(team_id) if team_id else None
    if team_name:
        for item in users:
            item["team_name"] = team_name
    return {
        "achievements": [{**item, "granted_count": grant_count.get(item["id"], 0)} for item in achievements],
        "system_achievements": [{**item, "granted_count": grant_count.get(item["id"], 0)} for item in SYSTEM_ACHIEVEMENTS],
        "users": [{**item, "achievement_ids": grants_by_user.get(item["id"], [])} for item in users],
    }


@api.post("/admin/achievements", status_code=201)
async def admin_create_achievement(body: AchievementCreateBody, admin: dict = Depends(get_current_admin)):
    title = body.title.strip()
    duplicate = await db.achievements.find_one({"title": {"$regex": f"^{re.escape(title)}$", "$options": "i"}}, {"_id": 0, "id": 1})
    if duplicate:
        raise HTTPException(status_code=409, detail="Досягнення з такою назвою вже існує")
    doc = {
        "id": str(uuid.uuid4()),
        "title": title,
        "description": body.description.strip(),
        "icon": body.icon.strip() or "trophy",
        "color": body.color.strip() or "#FFB800",
        "category": body.category.strip() or "Особливе",
        "rarity": body.rarity,
        "xp_reward": int(body.xp_reward),
        "active": body.active,
        "created_by": admin["id"],
        "created_at": now_iso(),
    }
    await db.achievements.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


@api.patch("/admin/achievements/{achievement_id}")
async def admin_update_achievement(
    achievement_id: str,
    body: AchievementUpdateBody,
    admin: dict = Depends(get_current_admin),
):
    current = await db.achievements.find_one({"id": achievement_id}, {"_id": 0})
    if not current:
        raise HTTPException(status_code=404, detail="Досягнення не знайдено")
    updates = {key: value for key, value in body.model_dump().items() if value is not None}
    for field in ("title", "description", "icon", "color", "category"):
        if field in updates:
            updates[field] = str(updates[field]).strip()
    if "title" in updates:
        duplicate = await db.achievements.find_one(
            {"title": {"$regex": f"^{re.escape(updates['title'])}$", "$options": "i"}, "id": {"$ne": achievement_id}},
            {"_id": 0, "id": 1},
        )
        if duplicate:
            raise HTTPException(status_code=409, detail="Досягнення з такою назвою вже існує")
    updates["updated_at"] = now_iso()
    updates["updated_by"] = admin["id"]
    await db.achievements.update_one({"id": achievement_id}, {"$set": updates})
    return await db.achievements.find_one({"id": achievement_id}, {"_id": 0})


@api.post("/admin/users/{user_id}/achievements/{achievement_id}", status_code=201)
async def admin_grant_achievement(
    user_id: str,
    achievement_id: str,
    admin: dict = Depends(get_current_admin),
):
    target = await db.users.find_one({"id": user_id, "role": {"$in": PLAYER_ROLES}}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Працівника не знайдено")
    achievement = await db.achievements.find_one({"id": achievement_id}, {"_id": 0})
    if not achievement:
        raise HTTPException(status_code=404, detail="Досягнення не знайдено")
    existing = await db.user_achievements.find_one({"user_id": user_id, "achievement_id": achievement_id}, {"_id": 0, "id": 1})
    if existing:
        raise HTTPException(status_code=409, detail="Це досягнення вже видано працівнику")
    granted_at = now_iso()
    grant = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "achievement_id": achievement_id,
        "granted_by": admin["id"],
        "granted_by_name": admin.get("name", "Адміністратор"),
        "granted_at": granted_at,
        "seen_at": None,
    }
    await db.user_achievements.insert_one(grant)
    await _award_xp(
        user_id,
        int(achievement.get("xp_reward") or 50),
        "achievement",
        f"achievement:{achievement_id}",
        f"Досягнення: {achievement.get('title', 'Особливе досягнення')}",
        {"achievement_id": achievement_id, "manual": True},
        admin["id"],
    )
    await db.admin_audit_logs.insert_one({
        "id": str(uuid.uuid4()), "admin_id": admin["id"], "admin_name": admin.get("name", "Адміністратор"),
        "action": "achievement_granted", "target_user_id": user_id, "target_user_name": target.get("name", "Працівник"),
        "achievement_id": achievement_id, "achievement_title": achievement.get("title"), "created_at": granted_at,
    })
    await _notify(user_id, "achievement", "Нове досягнення!", achievement.get("title", "Досягнення"), "/", "award")
    return {"ok": True, "grant": {k: v for k, v in grant.items() if k != "_id"}}


@api.delete("/admin/users/{user_id}/achievements/{achievement_id}", status_code=204)
async def admin_revoke_achievement(
    user_id: str,
    achievement_id: str,
    admin: dict = Depends(get_current_admin),
):
    result = await db.user_achievements.delete_one({"user_id": user_id, "achievement_id": achievement_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Видане досягнення не знайдено")
    await db.admin_audit_logs.insert_one({
        "id": str(uuid.uuid4()), "admin_id": admin["id"], "admin_name": admin.get("name", "Адміністратор"),
        "action": "achievement_revoked", "target_user_id": user_id, "achievement_id": achievement_id,
        "created_at": now_iso(),
    })
    return None


# ────────────────────────────────────────────────────────────────────────
# Quests
# ────────────────────────────────────────────────────────────────────────
def _today_key() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


async def _get_or_create_daily_progress(user_id: str) -> dict:
    key = _today_key()
    doc = await db.daily_progress.find_one({"user_id": user_id, "date": key}, {"_id": 0})
    if doc:
        return doc
    # Simulate realistic progress for the day (random-ish based on user_id hash)
    quests = await db.quests.find({"active": True}, {"_id": 0}).to_list(500)
    progress = {}
    import hashlib
    seed = int(hashlib.md5(f"{user_id}{key}".encode()).hexdigest(), 16)
    for q in quests:
        # deterministic pseudo-progress between 0..goal
        pct = ((seed >> (int(q["goal"]) % 16)) % 130) / 100.0  # 0..1.3
        p = min(int(q["goal"] * pct), q["goal"])
        progress[q["id"]] = p
        seed = seed // 7 + 13
    doc = {
        "user_id": user_id,
        "date": key,
        "progress": progress,
        "claimed": [],
    }
    await db.daily_progress.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.get("/quests", response_model=List[QuestWithProgress])
async def list_quests(user: dict = Depends(get_current_user)):
    quests = await db.quests.find({"active": True}, {"_id": 0}).sort("created_at", 1).to_list(500)
    dp = await _get_or_create_daily_progress(user["id"])
    result: List[QuestWithProgress] = []
    for q in quests:
        result.append(
            QuestWithProgress(
                **q,
                progress=dp["progress"].get(q["id"], 0),
                claimed=q["id"] in dp["claimed"],
            )
        )
    return result


@api.post("/quests/{quest_id}/claim", response_model=UserWithProgress)
async def claim_quest(quest_id: str, user: dict = Depends(get_current_user)):
    quest = await db.quests.find_one({"id": quest_id, "active": True}, {"_id": 0})
    if not quest:
        raise HTTPException(status_code=404, detail="Квест не знайдено")
    dp = await _get_or_create_daily_progress(user["id"])
    if quest_id in dp["claimed"]:
        raise HTTPException(status_code=400, detail="Нагороду вже отримано")
    if dp["progress"].get(quest_id, 0) < quest["goal"]:
        raise HTTPException(status_code=400, detail="Квест ще не виконано")

    reward = int(quest["reward"])
    xp_gain = 20
    await db.users.update_one(
        {"id": user["id"]},
        {"$inc": {"balance": reward, "total_earned": reward}},
    )
    await _award_xp(
        user["id"],
        xp_gain,
        "quest",
        f"legacy-quest:{_today_key()}:{quest_id}",
        f"Квест виконано: {quest['title']}",
        {"quest_id": quest_id, "date": _today_key()},
    )
    fresh_for_achievements = await db.users.find_one({"id": user["id"]}, {"_id": 0}) or user
    await _sync_system_achievements(fresh_for_achievements)
    await db.daily_progress.update_one(
        {"user_id": user["id"], "date": _today_key()},
        {"$addToSet": {"claimed": quest_id}},
    )
    await db.transactions.insert_one(
        {
            "id": str(uuid.uuid4()),
            "user_id": user["id"],
            "kind": "quest",
            "amount": reward,
            "description": f"Квест: {quest['title']}",
            "created_at": now_iso(),
        }
    )
    await _notify_points_awarded(user["id"], reward, f"Квест виконано: {quest['title']}")
    fresh = await db.users.find_one({"id": user["id"]}, {"_id": 0})
    return _user_with_progress(fresh)


# ────────────────────────────────────────────────────────────────────────
# Daily tasks — sales: 7 business categories; activation: easy/medium/hard
# ────────────────────────────────────────────────────────────────────────
SALES_DAILY_TASK_CATEGORIES = [{'key': 'credits', 'label': 'Кредити', 'reward': 20, 'difficulty': 'medium'},
 {'key': 'credits_2', 'label': 'Кредити 2.0', 'reward': 30, 'difficulty': 'hard'},
 {'key': 'search', 'label': 'Пошук', 'reward': 10, 'difficulty': 'easy'},
 {'key': 'debit_cards', 'label': 'Дебетки', 'reward': 10, 'difficulty': 'easy'},
 {'key': 'deposits', 'label': 'Депозити', 'reward': 20, 'difficulty': 'medium'},
 {'key': 'card_activation', 'label': 'Активація карти', 'reward': 20, 'difficulty': 'medium'},
 {'key': 'activation_6', 'label': 'Активація 6.0', 'reward': 20, 'difficulty': 'medium'}]

SALES_DAILY_TASK_CATALOG = [{'id': 101,
  'source_id': '1.01',
  'category': 'credits',
  'category_label': 'Кредити',
  'title': 'Фініш уже близько',
  'text': 'До кінця зміни лишилося дві години? Саме час закрити хоча б одну видачу кредитного продукту.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 102,
  'source_id': '1.02',
  'category': 'credits',
  'category_label': 'Кредити',
  'title': 'Кредитний дубль',
  'text': 'Зберіть дві видачі кредитних продуктів за один робочий день і підтвердьте обидві одним повідомленням.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 103,
  'source_id': '1.03',
  'category': 'credits',
  'category_label': 'Кредити',
  'title': 'Кредитна сієста',
  'text': 'Зловіть кредитну видачу в проміжку з 13:00 до 15:00.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 104,
  'source_id': '1.04',
  'category': 'credits',
  'category_label': 'Кредити',
  'title': 'Кредитка? Беремо!',
  'text': 'Оформіть клієнту кредитний продукт і підтвердьте, що видача успішно відбулася.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 105,
  'source_id': '1.05',
  'category': 'credits',
  'category_label': 'Кредити',
  'title': 'Ретро-клієнт',
  'text': 'Знайдіть клієнта, який народився у 1960-х роках або раніше, та оформіть йому кредитний продукт.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 106,
  'source_id': '1.06',
  'category': 'credits',
  'category_label': 'Кредити',
  'title': 'Еспресо-видача',
  'text': 'Встигніть оформити кредитну видачу між 13:00 та 14:00.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 107,
  'source_id': '1.07',
  'category': 'credits',
  'category_label': 'Кредити',
  'title': 'Ракета зі старту',
  'text': 'Першу кредитну видачу дня зробіть протягом першої години після виходу на лінію.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 108,
  'source_id': '1.08',
  'category': 'credits',
  'category_label': 'Кредити',
  'title': 'Фінішний ривок',
  'text': 'Зробіть кредитну видачу за годину до завершення робочої зміни.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 109,
  'source_id': '1.09',
  'category': 'credits',
  'category_label': 'Кредити',
  'title': 'Олександрович у справі',
  'text': 'Знайдіть клієнта з по батькові «Олександрович» або «Миколайович» і закрийте з ним успішну видачу кредитного продукту.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 110,
  'source_id': '1.10',
  'category': 'credits',
  'category_label': 'Кредити',
  'title': 'До 11:00 і в дамки',
  'text': 'Зробіть одну кредитну видачу до 11:00.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 111,
  'source_id': '1.11',
  'category': 'credits',
  'category_label': 'Кредити',
  'title': 'Післяобідній камбек',
  'text': 'Зловіть одну кредитну видачу в проміжку з 15:00 до 17:00.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 112,
  'source_id': '1.12',
  'category': 'credits',
  'category_label': 'Кредити',
  'title': 'Офер у яблучко',
  'text': 'Влучно визначте потребу клієнта, запропонуйте відповідний кредитний продукт і завершіть розмову видачею.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 113,
  'source_id': '1.13',
  'category': 'credits',
  'category_label': 'Кредити',
  'title': 'Один дзвінок — одна справа',
  'text': 'Оформіть кредитний продукт за один контакт, без домовленості на повторний дзвінок.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 114,
  'source_id': '1.14',
  'category': 'credits',
  'category_label': 'Кредити',
  'title': 'Платіж без паніки',
  'text': 'Клієнт питає про щомісячний платіж? Поясніть умови й доведіть розмову до видачі кредитного продукту.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 115,
  'source_id': '1.15',
  'category': 'credits',
  'category_label': 'Кредити',
  'title': "Прем'єра продукту",
  'text': 'Оформіть кредитний продукт клієнту, який раніше саме ним не користувався.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 116,
  'source_id': '1.16',
  'category': 'credits',
  'category_label': 'Кредити',
  'title': 'Другий шанс',
  'text': 'Після попереднього невдалого контакту поверніться в гру й зробіть клієнту успішну кредитну видачу.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 117,
  'source_id': '1.17',
  'category': 'credits',
  'category_label': 'Кредити',
  'title': 'Ціль бачу!',
  'text': 'Клієнт назвав конкретну мету фінансування? Підберіть під неї релевантний кредитний продукт і оформіть його.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 118,
  'source_id': '1.18',
  'category': 'credits',
  'category_label': 'Кредити',
  'title': 'Битва варіантів',
  'text': 'Покажіть клієнту різницю між двома доступними кредитними варіантами й оформіть той, який він обере.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 119,
  'source_id': '1.19',
  'category': 'credits',
  'category_label': 'Кредити',
  'title': 'Рівний хід',
  'text': 'Тримайте темп: щонайменше одна кредитна видача в першій половині зміни й ще одна в другій.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 120,
  'source_id': '1.20',
  'category': 'credits',
  'category_label': 'Кредити',
  'title': 'Один аргумент — один гол',
  'text': 'Після одного стандартного заперечення дайте релевантний аргумент і доведіть розмову до кредитної видачі.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 121,
  'source_id': '2.01',
  'category': 'credits_2',
  'category_label': 'Кредити 2.0',
  'title': 'Дубль на одного',
  'text': 'Зробіть дві видачі кредитних продуктів одному й тому самому клієнту.',
  'difficulty': 'hard',
  'reward': 30},
 {'id': 122,
  'source_id': '2.02',
  'category': 'credits_2',
  'category_label': 'Кредити 2.0',
  'title': 'Три клієнти — три попадання',
  'text': 'Закрийте три видачі кредитних продуктів трьом різним клієнтам і підтвердьте результат.',
  'difficulty': 'hard',
  'reward': 30},
 {'id': 123,
  'source_id': '2.03',
  'category': 'credits_2',
  'category_label': 'Кредити 2.0',
  'title': '«Подумаю»? Уже ні',
  'text': 'Знайдіть клієнта, у коментарях якого було «подумаю», і зробіть йому видачу кредитного продукту.',
  'difficulty': 'hard',
  'reward': 30},
 {'id': 124,
  'source_id': '2.04',
  'category': 'credits_2',
  'category_label': 'Кредити 2.0',
  'title': 'Подвійний постріл',
  'text': 'Оформіть одному клієнту дві видачі кредитних продуктів і підтвердьте обидві.',
  'difficulty': 'hard',
  'reward': 30},
 {'id': 125,
  'source_id': '2.05',
  'category': 'credits_2',
  'category_label': 'Кредити 2.0',
  'title': 'Вчорашній MVP',
  'text': 'Якщо за підсумками вчора у вас було найбільше кредитних видач у команді, підтвердьте свій результат.',
  'difficulty': 'hard',
  'reward': 30},
 {'id': 126,
  'source_id': '2.06',
  'category': 'credits_2',
  'category_label': 'Кредити 2.0',
  'title': 'Дзен проти заперечення',
  'text': 'Спіймайте складне заперечення, якісно його опрацюйте й закрийте угоду кредитним продуктом. Коротко поділіться, що саме спрацювало.',
  'difficulty': 'hard',
  'reward': 30},
 {'id': 127,
  'source_id': '2.07',
  'category': 'credits_2',
  'category_label': 'Кредити 2.0',
  'title': "П'ять хвилин слави",
  'text': "Вкладіться у п'ять хвилин розмови, оформіть кредитну видачу й підтвердьте результат.",
  'difficulty': 'hard',
  'reward': 30},
 {'id': 128,
  'source_id': '2.08',
  'category': 'credits_2',
  'category_label': 'Кредити 2.0',
  'title': 'Кредитний хет-трик',
  'text': 'Зробіть одному клієнту три видачі кредитних продуктів і підтвердьте всі три.',
  'difficulty': 'hard',
  'reward': 30},
 {'id': 129,
  'source_id': '2.09',
  'category': 'credits_2',
  'category_label': 'Кредити 2.0',
  'title': 'Подвійний шот',
  'text': 'Зробіть дві кредитні видачі в проміжку між 13:00 та 14:00.',
  'difficulty': 'hard',
  'reward': 30},
 {'id': 130,
  'source_id': '2.10',
  'category': 'credits_2',
  'category_label': 'Кредити 2.0',
  'title': 'Чотири в кошик',
  'text': 'Зберіть чотири видачі кредитних продуктів за один день і підтвердьте їх одним повідомленням.',
  'difficulty': 'hard',
  'reward': 30},
 {'id': 131,
  'source_id': '2.11',
  'category': 'credits_2',
  'category_label': 'Кредити 2.0',
  'title': 'Без жодного «але»',
  'text': 'Проведіть розмову так влучно, щоб якісне виявлення потреб привело до кредитної видачі без заперечень.',
  'difficulty': 'hard',
  'reward': 30},
 {'id': 132,
  'source_id': '2.12',
  'category': 'credits_2',
  'category_label': 'Кредити 2.0',
  'title': 'Бос видач',
  'text': 'Зробіть найбільшу кількість кредитних видач у команді за день.',
  'difficulty': 'hard',
  'reward': 30},
 {'id': 133,
  'source_id': '2.13',
  'category': 'credits_2',
  'category_label': 'Кредити 2.0',
  'title': 'Шерлок з офером',
  'text': 'Проведіть результативну кредитну розмову з незвичними аргументами та перевагами, а потім поділіться цим кейсом із колегами.',
  'difficulty': 'hard',
  'reward': 30},
 {'id': 134,
  'source_id': '2.14',
  'category': 'credits_2',
  'category_label': 'Кредити 2.0',
  'title': '«Не хочу»? Побачимо',
  'text': 'Отримайте згоду на кредитний продукт від клієнта, який на старті розмови сказав: «Я взагалі не хочу з вами говорити».',
  'difficulty': 'hard',
  'reward': 30},
 {'id': 135,
  'source_id': '2.15',
  'category': 'credits_2',
  'category_label': 'Кредити 2.0',
  'title': 'Хвилина на все',
  'text': 'Клієнт каже: «У вас хвилина, тільки швидко»? Проведіть повноцінну кредитну консультацію й завершіть її успішною видачею.',
  'difficulty': 'hard',
  'reward': 30},
 {'id': 136,
  'source_id': '3.01',
  'category': 'search',
  'category_label': 'Пошук',
  'title': 'Галина, виходьте з тіні',
  'text': "Знайдіть клієнтку на ім'я Галина й підтвердьте виконання за внутрішнім процесом.",
  'difficulty': 'easy',
  'reward': 10},
 {'id': 137,
  'source_id': '3.02',
  'category': 'search',
  'category_label': 'Пошук',
  'title': 'Олег, ми вас знайшли',
  'text': "Відшукайте клієнта на ім'я Олег і підтвердьте виконання за внутрішнім процесом.",
  'difficulty': 'easy',
  'reward': 10},
 {'id': 138,
  'source_id': '3.03',
  'category': 'search',
  'category_label': 'Пошук',
  'title': 'Три сімки — бінго!',
  'text': 'Полюємо на 777: знайдіть у номері телефону клієнта або ІПН три однакові цифри поспіль.',
  'difficulty': 'easy',
  'reward': 10},
 {'id': 139,
  'source_id': '3.04',
  'category': 'search',
  'category_label': 'Пошук',
  'title': 'Наймолодший у грі',
  'text': 'Знайдіть наймолодшого клієнта за день із датою народження 2008 року або пізніше.',
  'difficulty': 'easy',
  'reward': 10},
 {'id': 140,
  'source_id': '3.05',
  'category': 'search',
  'category_label': 'Пошук',
  'title': 'Двійка шукає двійку',
  'text': 'Якщо сьогодні 02 число, знайдіть клієнта з днем народження 02.xx.xxxx.',
  'difficulty': 'easy',
  'reward': 10},
 {'id': 141,
  'source_id': '3.06',
  'category': 'search',
  'category_label': 'Пошук',
  'title': 'Машина часу',
  'text': 'Знайдіть клієнта з «круглим» роком народження, наприклад 1970, 1980, 1990 або 2000.',
  'difficulty': 'easy',
  'reward': 10},
 {'id': 142,
  'source_id': '3.07',
  'category': 'search',
  'category_label': 'Пошук',
  'title': 'Одного року врожаю',
  'text': 'Знайдіть клієнта, який народився в один рік із вами.',
  'difficulty': 'easy',
  'reward': 10},
 {'id': 143,
  'source_id': '3.08',
  'category': 'search',
  'category_label': 'Пошук',
  'title': 'Нулі на фініші',
  'text': 'Знайдіть картку клієнта, де ІПН або номер телефону красиво фінішує двома нулями.',
  'difficulty': 'easy',
  'reward': 10},
 {'id': 144,
  'source_id': '3.09',
  'category': 'search',
  'category_label': 'Пошук',
  'title': 'Піймай 55',
  'text': "Знайдіть у номері телефону або ІПН дві п'ятірки поспіль, тобто 55.",
  'difficulty': 'easy',
  'reward': 10},
 {'id': 145,
  'source_id': '3.10',
  'category': 'search',
  'category_label': 'Пошук',
  'title': "Ім'я з родзинкою",
  'text': "Знайдіть клієнта з незвичним або іноземним ім'ям.",
  'difficulty': 'easy',
  'reward': 10},
 {'id': 146,
  'source_id': '3.11',
  'category': 'search',
  'category_label': 'Пошук',
  'title': 'Привіт із 1955-го',
  'text': 'Знайдіть клієнта, який народився у 1955 році або раніше.',
  'difficulty': 'easy',
  'reward': 10},
 {'id': 147,
  'source_id': '3.12',
  'category': 'search',
  'category_label': 'Пошук',
  'title': 'Іван Іванович mode',
  'text': "Знайдіть клієнта, в якого ім'я збігається з основою по батькові, наприклад Іван Іванович.",
  'difficulty': 'easy',
  'reward': 10},
 {'id': 148,
  'source_id': '3.13',
  'category': 'search',
  'category_label': 'Пошук',
  'title': 'Чотири в ряд',
  'text': 'Знайдіть у номері телефону або ІПН чотири однакові цифри поспіль.',
  'difficulty': 'easy',
  'reward': 10},
 {'id': 149,
  'source_id': '3.14',
  'category': 'search',
  'category_label': 'Пошук',
  'title': 'Іменинник місяця',
  'text': 'Знайдіть клієнта, у якого день народження припадає на цей місяць.',
  'difficulty': 'easy',
  'reward': 10},
 {'id': 150,
  'source_id': '3.15',
  'category': 'search',
  'category_label': 'Пошук',
  'title': 'Колега, це ти?',
  'text': 'Знайдіть клієнта, прізвище якого збігається з прізвищем вашого колеги.',
  'difficulty': 'easy',
  'reward': 10},
 {'id': 151,
  'source_id': '3.16',
  'category': 'search',
  'category_label': 'Пошук',
  'title': 'Одна літера на двох',
  'text': "Знайдіть клієнта, у якого ім'я та прізвище починаються з однієї й тієї самої літери.",
  'difficulty': 'easy',
  'reward': 10},
 {'id': 152,
  'source_id': '3.17',
  'category': 'search',
  'category_label': 'Пошук',
  'title': 'Дата зациклилась',
  'text': 'Знайдіть клієнта, у якого день і місяць народження повторюються: наприклад 01.01, 02.02 або 12.12.',
  'difficulty': 'easy',
  'reward': 10},
 {'id': 153,
  'source_id': '4.01',
  'category': 'debit_cards',
  'category_label': 'Дебетки',
  'title': 'Дебетка до комплекту',
  'text': 'Додайте до результату ще одну видачу дебетової картки в компанії Веб_Апс.',
  'difficulty': 'easy',
  'reward': 10},
 {'id': 154,
  'source_id': '4.02',
  'category': 'debit_cards',
  'category_label': 'Дебетки',
  'title': 'Лояльність плюс картка',
  'text': 'Зробіть додаткову видачу валютної або дебетової картки в компанії Крос.',
  'difficulty': 'easy',
  'reward': 10},
 {'id': 155,
  'source_id': '4.03',
  'category': 'debit_cards',
  'category_label': 'Дебетки',
  'title': 'Розбуди дебетку',
  'text': 'Відкрийте рахунок дебеток за день: оформіть першу дебетову картку.',
  'difficulty': 'easy',
  'reward': 10},
 {'id': 156,
  'source_id': '4.04',
  'category': 'debit_cards',
  'category_label': 'Дебетки',
  'title': 'До 12:00 і готово',
  'text': 'Встигніть оформити дебетову картку до 12:00.',
  'difficulty': 'easy',
  'reward': 10},
 {'id': 157,
  'source_id': '4.05',
  'category': 'debit_cards',
  'category_label': 'Дебетки',
  'title': 'Після трьох — час дебетки',
  'text': 'Оформіть дебетову картку після 15:00.',
  'difficulty': 'easy',
  'reward': 10},
 {'id': 158,
  'source_id': '4.06',
  'category': 'debit_cards',
  'category_label': 'Дебетки',
  'title': 'Валюта в кишені',
  'text': 'Оформіть клієнту валютну дебетову картку.',
  'difficulty': 'easy',
  'reward': 10},
 {'id': 159,
  'source_id': '4.07',
  'category': 'debit_cards',
  'category_label': 'Дебетки',
  'title': 'Перша дебетка клієнта',
  'text': 'Оформіть дебетову картку клієнту, який раніше не мав дебетової картки банку.',
  'difficulty': 'easy',
  'reward': 10},
 {'id': 160,
  'source_id': '4.08',
  'category': 'debit_cards',
  'category_label': 'Дебетки',
  'title': 'Ще одна в гаманець',
  'text': 'Оформіть додаткову дебетову картку чинному клієнту.',
  'difficulty': 'easy',
  'reward': 10},
 {'id': 161,
  'source_id': '4.09',
  'category': 'debit_cards',
  'category_label': 'Дебетки',
  'title': 'Дебетний дубль',
  'text': 'Зробіть дві видачі дебетових карток за один робочий день.',
  'difficulty': 'easy',
  'reward': 10},
 {'id': 162,
  'source_id': '4.10',
  'category': 'debit_cards',
  'category_label': 'Дебетки',
  'title': 'Кредит закрили — дебетку додали',
  'text': 'Після успішної кредитної видачі запропонуйте клієнту дебетову картку й оформіть її.',
  'difficulty': 'easy',
  'reward': 10},
 {'id': 163,
  'source_id': '4.11',
  'category': 'debit_cards',
  'category_label': 'Дебетки',
  'title': 'Один контакт — готово',
  'text': 'Оформіть дебетову картку за один контакт, без повторного дзвінка.',
  'difficulty': 'easy',
  'reward': 10},
 {'id': 164,
  'source_id': '4.12',
  'category': 'debit_cards',
  'category_label': 'Дебетки',
  'title': 'Три козирі дебетки',
  'text': 'Назвіть клієнту щонайменше три релевантні переваги дебетової картки й оформіть її.',
  'difficulty': 'easy',
  'reward': 10},
 {'id': 165,
  'source_id': '4.13',
  'category': 'debit_cards',
  'category_label': 'Дебетки',
  'title': 'Картка на щодень',
  'text': 'Виявіть потребу клієнта у щоденних розрахунках і під неї оформіть відповідну дебетову картку.',
  'difficulty': 'easy',
  'reward': 10},
 {'id': 166,
  'source_id': '4.14',
  'category': 'debit_cards',
  'category_label': 'Дебетки',
  'title': 'Запитав — отримав',
  'text': 'Клієнт уточнив умови дебетової картки? Дайте відповідь і доведіть оформлення до фінішу.',
  'difficulty': 'easy',
  'reward': 10},
 {'id': 167,
  'source_id': '4.15',
  'category': 'debit_cards',
  'category_label': 'Дебетки',
  'title': 'Дебетка на десерт',
  'text': 'Оформіть дебетову картку протягом останніх двох годин робочої зміни.',
  'difficulty': 'easy',
  'reward': 10},
 {'id': 168,
  'source_id': '5.01',
  'category': 'deposits',
  'category_label': 'Депозити',
  'title': 'Багаті теж відкладають',
  'text': 'Зробіть видачу депозиту в компанії Веб_Апс і підтвердьте результат.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 169,
  'source_id': '5.02',
  'category': 'deposits',
  'category_label': 'Депозити',
  'title': 'Перший вклад пішов',
  'text': 'Відкрийте депозитний рахунок дня: оформіть перший депозит.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 170,
  'source_id': '5.03',
  'category': 'deposits',
  'category_label': 'Депозити',
  'title': 'Депозит до ланчу',
  'text': 'Встигніть оформити депозит до 12:00.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 171,
  'source_id': '5.04',
  'category': 'deposits',
  'category_label': 'Депозити',
  'title': 'Після 15:00 — час примножувати',
  'text': 'Оформіть депозит після 15:00.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 172,
  'source_id': '5.05',
  'category': 'deposits',
  'category_label': 'Депозити',
  'title': 'Депозитний дубль',
  'text': 'Зберіть два оформлені депозити за один робочий день.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 173,
  'source_id': '5.06',
  'category': 'deposits',
  'category_label': 'Депозити',
  'title': 'Перший раз у вклад',
  'text': 'Оформіть депозит клієнту, який раніше не користувався депозитним продуктом банку.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 174,
  'source_id': '5.07',
  'category': 'deposits',
  'category_label': 'Депозити',
  'title': 'Ще один у скарбничку',
  'text': 'Оформіть новий депозит клієнту, який уже користується депозитним продуктом.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 175,
  'source_id': '5.08',
  'category': 'deposits',
  'category_label': 'Депозити',
  'title': 'А скільки зароблю?',
  'text': 'Клієнт питає про дохідність? Поясніть умови й завершіть оформлення депозиту.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 176,
  'source_id': '5.09',
  'category': 'deposits',
  'category_label': 'Депозити',
  'title': 'Строк має значення',
  'text': 'Розкладіть клієнту доступні строки розміщення й оформіть той депозит, який він обере.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 177,
  'source_id': '5.10',
  'category': 'deposits',
  'category_label': 'Депозити',
  'title': 'А якщо забрати раніше?',
  'text': 'Після питання про дострокове зняття поясніть правила й завершіть оформлення депозиту.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 178,
  'source_id': '5.11',
  'category': 'deposits',
  'category_label': 'Депозити',
  'title': 'Два строки — один вибір',
  'text': 'Порівняйте для клієнта два доступні строки депозиту та оформіть обраний варіант.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 179,
  'source_id': '5.12',
  'category': 'deposits',
  'category_label': 'Депозити',
  'title': 'Поповнюй і росте',
  'text': 'Якщо такий варіант доступний, оформіть депозит із можливістю поповнення.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 180,
  'source_id': '5.13',
  'category': 'deposits',
  'category_label': 'Депозити',
  'title': 'Продовжуємо автоматом',
  'text': 'Якщо функція доступна, поясніть клієнту умову автопролонгації й оформіть депозит із його згодою.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 181,
  'source_id': '5.14',
  'category': 'deposits',
  'category_label': 'Депозити',
  'title': '«Я подумаю» на депозит',
  'text': 'Почули «я подумаю»? Опрацюйте заперечення й завершіть оформлення депозиту.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 182,
  'source_id': '5.15',
  'category': 'deposits',
  'category_label': 'Депозити',
  'title': 'Один контакт — один вклад',
  'text': 'Оформіть депозит за один контакт, без повторного дзвінка.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 183,
  'source_id': '6.01',
  'category': 'card_activation',
  'category_label': 'Активація карти',
  'title': 'Картка, прокидайся!',
  'text': 'Активуйте одну картку клієнта за день, дотримуючись внутрішнього процесу.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 184,
  'source_id': '6.02',
  'category': 'card_activation',
  'category_label': 'Активація карти',
  'title': 'Сьогодні видали — сьогодні ожила',
  'text': 'Зробіть так, щоб картка була активована в той самий день, коли клієнт її отримав або оформив.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 185,
  'source_id': '6.03',
  'category': 'card_activation',
  'category_label': 'Активація карти',
  'title': 'Активація до обіду',
  'text': 'Закрийте одну активацію картки до 12:00.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 186,
  'source_id': '6.04',
  'category': 'card_activation',
  'category_label': 'Активація карти',
  'title': 'Дві картки — два старти',
  'text': 'Завершіть дві активації карток за один робочий день.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 187,
  'source_id': '6.05',
  'category': 'card_activation',
  'category_label': 'Активація карти',
  'title': 'Не завтра, а зараз',
  'text': 'Клієнт хоче відкласти активацію? Поясніть кроки й доведіть процес до успішної активації.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 188,
  'source_id': '6.06',
  'category': 'card_activation',
  'category_label': 'Активація карти',
  'title': 'Друга картка теж хоче жити',
  'text': 'Активуйте додаткову картку чинного клієнта.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 189,
  'source_id': '6.07',
  'category': 'card_activation',
  'category_label': 'Активація карти',
  'title': 'Новачок у грі',
  'text': 'Активуйте картку клієнта, який щойно став користувачем карткового продукту.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 190,
  'source_id': '6.08',
  'category': 'card_activation',
  'category_label': 'Активація карти',
  'title': 'Три кроки до життя',
  'text': 'Поясніть процес активації максимум у трьох кроках і доведіть його до завершення.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 191,
  'source_id': '6.09',
  'category': 'card_activation',
  'category_label': 'Активація карти',
  'title': 'Активували з першого контакту',
  'text': 'Завершіть активацію картки за один контакт, без повторного дзвінка.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 192,
  'source_id': '6.10',
  'category': 'card_activation',
  'category_label': 'Активація карти',
  'title': 'Фінішна іскра',
  'text': 'Завершіть активацію картки протягом останніх двох годин робочої зміни.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 193,
  'source_id': '7.01',
  'category': 'activation_6',
  'category_label': 'Активація 6.0',
  'title': 'IBAN без квестів',
  'text': 'Отримайте згоду клієнта оплатити послуги або зробити платіж за IBAN на юридичну особу та створити шаблон у мобільному застосунку.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 194,
  'source_id': '7.02',
  'category': 'activation_6',
  'category_label': 'Активація 6.0',
  'title': 'Перші 200 пішли',
  'text': 'Отримайте згоду клієнта зробити першу покупку саме від 200 грн.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 195,
  'source_id': '7.03',
  'category': 'activation_6',
  'category_label': 'Активація 6.0',
  'title': 'Сотня на мобільний',
  'text': 'Отримайте згоду клієнта поповнити мобільний телефон від 100 грн у застосунку.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 196,
  'source_id': '7.04',
  'category': 'activation_6',
  'category_label': 'Активація 6.0',
  'title': 'Челендж? Прийнято!',
  'text': 'Отримайте згоду клієнта скористатися челенджем у застосунку.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 197,
  'source_id': '7.05',
  'category': 'activation_6',
  'category_label': 'Активація 6.0',
  'title': '6.0 з першої фрази',
  'text': 'Почніть розмову одразу з пропозиції оферу Активації 6.0.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 198,
  'source_id': '7.06',
  'category': 'activation_6',
  'category_label': 'Активація 6.0',
  'title': 'Pay-підключення',
  'text': 'Отримайте згоду клієнта на офер Google Pay або Apple Pay.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 199,
  'source_id': '7.07',
  'category': 'activation_6',
  'category_label': 'Активація 6.0',
  'title': 'Зайшли й поїхали',
  'text': 'Під час розмови клієнт має відкрити мобільний застосунок і успішно в нього увійти.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 200,
  'source_id': '7.08',
  'category': 'activation_6',
  'category_label': 'Активація 6.0',
  'title': 'Пуші на старт',
  'text': 'Отримайте згоду клієнта увімкнути push-сповіщення в мобільному застосунку, якщо ця функція доступна.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 201,
  'source_id': '7.09',
  'category': 'activation_6',
  'category_label': 'Активація 6.0',
  'title': 'Комуналка в смартфоні',
  'text': 'Отримайте згоду клієнта оплатити комунальні послуги в мобільному застосунку.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 202,
  'source_id': '7.10',
  'category': 'activation_6',
  'category_label': 'Активація 6.0',
  'title': 'Сам собі переказав',
  'text': 'Отримайте згоду клієнта зробити переказ між власними рахунками в мобільному застосунку.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 203,
  'source_id': '7.11',
  'category': 'activation_6',
  'category_label': 'Активація 6.0',
  'title': 'Картка-картка, полетіли',
  'text': 'Отримайте згоду клієнта зробити переказ на іншу картку через мобільний застосунок.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 204,
  'source_id': '7.12',
  'category': 'activation_6',
  'category_label': 'Активація 6.0',
  'title': 'Гроші зайшли з іншого банку',
  'text': 'Отримайте згоду клієнта поповнити картку з картки іншого банку через застосунок, якщо така функція доступна.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 205,
  'source_id': '7.13',
  'category': 'activation_6',
  'category_label': 'Активація 6.0',
  'title': 'Де були гроші?',
  'text': 'Покажіть клієнту, де в застосунку дивитися історію операцій або виписку, і отримайте згоду скористатися цією функцією.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 206,
  'source_id': '7.14',
  'category': 'activation_6',
  'category_label': 'Активація 6.0',
  'title': 'Кешбек, виходь!',
  'text': 'Покажіть клієнту розділ кешбеку або бонусів і отримайте згоду активувати доступну пропозицію, якщо така функція є.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 207,
  'source_id': '7.15',
  'category': 'activation_6',
  'category_label': 'Активація 6.0',
  'title': 'Картка живе в телефоні',
  'text': 'Покажіть клієнту, де в застосунку переглянути інформацію про власну картку, не передаючи реквізити третім особам.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 208,
  'source_id': '7.16',
  'category': 'activation_6',
  'category_label': 'Активація 6.0',
  'title': 'Підтримка в кишені',
  'text': 'Покажіть клієнту, де в мобільному застосунку знайти підтримку або чат.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 209,
  'source_id': '7.17',
  'category': 'activation_6',
  'category_label': 'Активація 6.0',
  'title': 'Ліміти під рукою',
  'text': 'Покажіть клієнту розділ керування лімітами картки й отримайте згоду перевірити доступні налаштування.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 210,
  'source_id': '7.18',
  'category': 'activation_6',
  'category_label': 'Активація 6.0',
  'title': 'Шаблон, щоб не повторюватись',
  'text': 'Отримайте згоду клієнта створити шаблон для регулярної операції в мобільному застосунку.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 211,
  'source_id': '7.19',
  'category': 'activation_6',
  'category_label': 'Активація 6.0',
  'title': 'Платіж без каси',
  'text': 'Отримайте згоду клієнта зробити будь-який доступний платіж у мобільному застосунку під час або після консультації.',
  'difficulty': 'medium',
  'reward': 20},
 {'id': 212,
  'source_id': '7.20',
  'category': 'activation_6',
  'category_label': 'Активація 6.0',
  'title': 'Два фокуси за один контакт',
  'text': 'За один контакт отримайте згоду клієнта скористатися двома різними функціями мобільного застосунку.',
  'difficulty': 'medium',
  'reward': 20}]


# V128: activators have a separate daily-task universe. IDs intentionally live
# in a different range so reviews and historical task sets can never collide
# with sales tasks.
ACTIVATION_DAILY_TASK_CATALOG = [
    {"id": 1001, "title": "Агент 777", "text": "Знайдіть у номері телефону клієнта або ІПН три однакові цифри поспіль, наприклад 777. Скиньте скриншот картки в Teams. Приз: 10 Point.", "difficulty": "easy", "reward": 10},
    {"id": 1002, "title": "Ровесник", "text": "Знайдіть клієнта, який народився в один рік із вами. Скиньте карту дзвінка. Приз: 10 Point.", "difficulty": "easy", "reward": 10},
    {"id": 1003, "title": "Молода кров", "text": "Скиньте карту дзвінка з наймолодшим клієнтом за день, дата народження — 2008 рік або пізніше. Приз: 10 Point.", "difficulty": "easy", "reward": 10},
    {"id": 1004, "title": "Назад у майбутнє", "text": "Скиньте карту дзвінка з клієнтом, який народився у круглому році, наприклад 1970, 1980, 1990 або 2000. Приз: 10 Point.", "difficulty": "easy", "reward": 10},
    {"id": 1005, "title": "Тезка", "text": "Знайдіть клієнта зі своїм ім'ям. Приз: 10 Point.", "difficulty": "easy", "reward": 10},
    {"id": 1006, "title": "Алфавіт", "text": "Знайдіть клієнта, у якого ім'я та прізвище починаються на одну літеру. Приз: 10 Point.", "difficulty": "easy", "reward": 10},
    {"id": 1007, "title": "Ну ти і фартовий", "text": "Напишіть у Teams: «Я фартовий/фартова». Приз: 10 Point.", "difficulty": "easy", "reward": 10},
    {"id": 1008, "title": "Олег, ти що плачеш?", "text": "Знайдіть клієнта на ім'я Олег і скиньте скриншот карти дзвінка в Teams. Приз: 10 Point.", "difficulty": "easy", "reward": 10},
    {"id": 1009, "title": "Вкинув мем — врятував колег", "text": "Надішліть у командний чат смішний мем про роботу, клієнтів або кол-центр. Приз: 10 Point.", "difficulty": "easy", "reward": 10},
    {"id": 1010, "title": "Місія нездійсненна: одна хвилина", "text": "Клієнт сказав: «У вас хвилина, тільки швидко». Проведіть з ним повноцінну розмову. Приз: 10 Point.", "difficulty": "easy", "reward": 10},

    {"id": 1011, "title": "Не чує баба", "text": "Скиньте фото карти дзвінка з клієнтом, який народився у 1955 році або раніше. Приз: 20 Point.", "difficulty": "medium", "reward": 20},
    {"id": 1012, "title": "Турбо-старт", "text": "Зробіть перші 10 розмов без жодної відмови від клієнта. Приз: 20 Point.", "difficulty": "medium", "reward": 20},
    {"id": 1013, "title": "Чий ти будеш, козаче?", "text": "Скиньте в Teams фото карти дзвінка з іноземним ім'ям. Приз: 20 Point.", "difficulty": "medium", "reward": 20},
    {"id": 1014, "title": "Сарафанне радіо", "text": "Після активації кредитної картки клієнт погодився ще й на реферальну програму. Приз: 20 Point.", "difficulty": "medium", "reward": 20},
    {"id": 1015, "title": "Іронія долі", "text": "Знайдіть клієнта, який народився того ж дня і місяця, що й ви. Приз: 20 Point.", "difficulty": "medium", "reward": 20},
    {"id": 1016, "title": "День бабака", "text": "Знайдіть дату народження з повторенням дня й місяця, наприклад 01.01, 02.02 або 12.12. Приз: 20 Point.", "difficulty": "medium", "reward": 20},
    {"id": 1017, "title": "Золотий вік", "text": "Отримайте згоду від клієнта на активацію 6.0, який народився у 1960-х роках. Скиньте карту дзвінка. Приз: 20 Point.", "difficulty": "medium", "reward": 20},
    {"id": 1018, "title": "Погашення після згоди", "text": "Після згоди клієнта скористатися кредитною карткою отримайте його згоду на офер 6.0 «Погашення» — поповнити картку після здійснення розрахунку. Приз: 20 Point.", "difficulty": "medium", "reward": 20},
    {"id": 1019, "title": "А наша Галя балувана", "text": "Проведіть повноцінну розмову з клієнткою на ім'я Галина і скиньте скриншот карти дзвінка. Приз: 20 Point.", "difficulty": "medium", "reward": 20},
    {"id": 1020, "title": "Вип'ємо еспресо", "text": "У період з 13:00 до 14:00 отримайте три згоди від клієнтів на оновлення застосунку ПУМБ. Приз: 20 Point.", "difficulty": "medium", "reward": 20},

    {"id": 1021, "title": "Бери бика за рога", "text": "Виконайте будь-який офер на лінії з клієнтом по активації 6.0. Приз: 30 Point.", "difficulty": "hard", "reward": 30},
    {"id": 1022, "title": "Зарплата прийшла!", "text": "Отримайте згоду від клієнта на офер «Отримання ЗП». Приз: 30 Point.", "difficulty": "hard", "reward": 30},
    {"id": 1023, "title": "Подвійний удар", "text": "Запропонуйте одразу два офери активації 6.0 та отримайте згоду клієнта по кожному, окрім розрахунку та першої покупки від 200 грн. Приз: 40 Point.", "difficulty": "hard", "reward": 40},
    {"id": 1024, "title": "Колишніх не буває", "text": "Опрацюйте заперечення клієнта «Я хочу закрити цю картку» та переконайте його активувати картку, здійснивши будь-який розрахунок. Приз: 40 Point.", "difficulty": "hard", "reward": 40},
    {"id": 1025, "title": "Місія нездійсненна: три заперечення", "text": "Опрацюйте три заперечення клієнта, який відмовився користуватися карткою. Приз: 30 Point.", "difficulty": "hard", "reward": 30},
    {"id": 1026, "title": "В яблучко", "text": "Пропрацюйте день так, щоб мати не менше 80% згод від клієнтів скористатися кредитною карткою. Приз: 30 Point.", "difficulty": "hard", "reward": 30},
    {"id": 1027, "title": "Контрольний постріл", "text": "Виконайте на лінії встановлення або вхід у застосунок з клієнтом, у якого є офер 6.0 «Встановлення мобільного застосунку та вхід». Приз: 50 Point.", "difficulty": "hard", "reward": 50},
    {"id": 1028, "title": "Багатий тато", "text": "Знайдіть клієнта з по батькові «Богданович» або «Русланович» і отримайте успішну згоду скористатися офером 6.0. Приз: 30 Point.", "difficulty": "hard", "reward": 30},
    {"id": 1029, "title": "Тарас Бульба", "text": "Отримайте успішну згоду скористатися карткою від клієнта на ім'я Тарас. Приз: 30 Point.", "difficulty": "hard", "reward": 30},
    {"id": 1030, "title": "Дідусівська версія", "text": "Зробіть на лінії з клієнтом оновлення застосунку. Приз: 50 Point.", "difficulty": "hard", "reward": 50},

    # V151: additional activator missions supplied by the product owner.
    {"id": 1031, "title": "З першого слова", "text": "Клієнт відразу погодився після цілі бази 12+. Приз: 10 Point.", "difficulty": "easy", "reward": 10},
    {"id": 1032, "title": "Кешбек на десерт", "text": "Підключіть кешбек від банку чи партнерів разом із клієнтом на лінії. Приз: 10 Point.", "difficulty": "easy", "reward": 10},
    {"id": 1033, "title": "Помічники вже тут", "text": "Підключіть на лінії з клієнтом кумедні помічники. Приз: 20 Point.", "difficulty": "medium", "reward": 20},
    {"id": 1034, "title": "🪄 Раз — і картка є!", "text": "Відкрийте віртуальну карту до рахунку на лінії разом із клієнтом. Приз: 30 Point.", "difficulty": "hard", "reward": 30},
    {"id": 1035, "title": "Карта на пенсію", "text": "Отримайте згоду від клієнта на перевипуск карти. Приз: 20 Point.", "difficulty": "medium", "reward": 20},
    {"id": 1036, "title": "Кругляш", "text": "Скиньте скрін карти дзвінка клієнта, який має круглий ліміт, наприклад 50 000 або 1 000 грн. Приз: 10 Point.", "difficulty": "easy", "reward": 10},
    {"id": 1037, "title": "ОЧень пощастило", "text": "Скиньте скрін карти дзвінка клієнта з використаним лімітом на ОЧ. Приз: 10 Point.", "difficulty": "easy", "reward": 10},
    {"id": 1038, "title": "Ліміт під замком", "text": "Скиньте скрін карти дзвінка клієнта із заблокованим лімітом. Приз: 20 Point.", "difficulty": "medium", "reward": 20},
    {"id": 1039, "title": "Десять тисяч — і не кінець", "text": "Скиньте скрін карти дзвінка клієнта з використаним лімітом більше ніж 10 000 грн. Приз: 20 Point.", "difficulty": "medium", "reward": 20},
    {"id": 1040, "title": "Грошики з собою", "text": "У першу годину роботи скиньте скрін карти дзвінка клієнта з власними коштами на карті. Приз: 10 Point.", "difficulty": "easy", "reward": 10},
    {"id": 1041, "title": "Обмінник на дроті", "text": "Отримайте згоду від клієнта на офер «Обмін валют». Приз: 20 Point.", "difficulty": "medium", "reward": 20},
    {"id": 1042, "title": "ЄКЛ? ЄКЛ!", "text": "Отримайте згоду від клієнта на офер «Оформлення ЄКЛ» або «Зміна ЄКЛ». Приз: 30 Point.", "difficulty": "hard", "reward": 30},
    {"id": 1043, "title": "Прізвище — вогонь!", "text": "Скиньте скрін карти дзвінка клієнта зі смішним прізвищем. Приз: 20 Point.", "difficulty": "medium", "reward": 20},
    {"id": 1044, "title": "Три з трьох", "text": "Отримайте три згоди підряд від бази 12+ / 5–6 міс. неактивності. Приз: 30 Point.", "difficulty": "hard", "reward": 30},
    {"id": 1045, "title": "Подвійна порція", "text": "Скиньте скрін карти дзвінка клієнта з подвійним прізвищем. Приз: 20 Point.", "difficulty": "medium", "reward": 20},
    {"id": 1046, "title": "Шерлок продажів", "text": "Проведіть розмову з незвичними аргументами та перевагами й поділіться нею з колегами для обміну досвідом. Приз: 30 Point.", "difficulty": "hard", "reward": 30},
    {"id": 1047, "title": "Челендж прийнято", "text": "У цілі дзвінка по активації кредитної карти запропонуйте клієнту челендж за офером 6.0. Приз: 30 Point.", "difficulty": "hard", "reward": 30},
    {"id": 1048, "title": "Анекдот на лінії", "text": "Скиньте в робочий час анекдот колегам у чат WhatsApp. Приз: 10 Point.", "difficulty": "easy", "reward": 10},
    {"id": 1049, "title": "Раритет на зв'язку", "text": "Скиньте скрін карти дзвінка клієнта зі старою кредитною картою. Приз: 20 Point.", "difficulty": "medium", "reward": 20},
    {"id": 1050, "title": "Все можу, але не все", "text": "Скиньте скрін карти дзвінка клієнта з картою «ВСЕ можу», яка випущена до 2020 року. Приз: 10 Point.", "difficulty": "easy", "reward": 10},
    {"id": 1051, "title": "О, знайомі люди! 😄", "text": "Знайдіть клієнта, прізвище якого збігається з прізвищем вашого колеги. Приз: 20 Point.", "difficulty": "medium", "reward": 20},
    {"id": 1052, "title": "Карта, ти куди?! 🗺️", "text": "Отримайте згоду клієнта на активацію, який сказав, що не знає, де його карта. Приз: 30 Point.", "difficulty": "hard", "reward": 30},
    {"id": 1053, "title": "А слабо?", "text": "Отримайте згоду клієнта, який на початку розмови сказав: «Я взагалі не хочу з вами говорити». Приз: 30 Point.", "difficulty": "hard", "reward": 30},
]

# Backwards-compatible name used by old migrations/tests.
DAILY_TASK_CATALOG = SALES_DAILY_TASK_CATALOG


# ────────────────────────────────────────────────────────────────────────
# Personal weekly and monthly goals
# ────────────────────────────────────────────────────────────────────────
def _iso_week_key() -> str:
    local = datetime.now(ZoneInfo("Europe/Kyiv"))
    year, week, _ = local.isocalendar()
    return f"{year}-W{week:02d}"


def _month_key() -> str:
    return datetime.now(ZoneInfo("Europe/Kyiv")).strftime("%Y-%m")


def _metric_complete(metric: dict) -> bool:
    try:
        current = float(metric.get("current", 0))
        target = float(metric.get("target", 0))
    except (TypeError, ValueError):
        return False
    return target > 0 and current >= target


def _goals_public(doc: Optional[dict]) -> dict:
    empty_metric = {"current": 0, "target": 0, "mode": "reach", "complete": False}
    if not doc:
        return {
            "week_key": _iso_week_key(), "month_key": _month_key(),
            "credit": dict(empty_metric), "debit": dict(empty_metric), "deposit": dict(empty_metric),
            "monthly_bonus_current": 0, "monthly_bonus_target": 0,
            "weekly_complete": False, "monthly_complete": False,
            "weekly_reward_awarded": False, "monthly_reward_awarded": False,
            "note": "", "updated_at": None,
        }
    result = {k: v for k, v in doc.items() if k != "_id"}
    for key in ("credit", "debit", "deposit"):
        metric = dict(result.get(key) or empty_metric)
        metric["complete"] = _metric_complete(metric)
        result[key] = metric
    result["weekly_complete"] = all(result[k]["complete"] for k in ("credit", "debit", "deposit"))
    target = float(result.get("monthly_bonus_target") or 0)
    current = float(result.get("monthly_bonus_current") or 0)
    result["monthly_complete"] = target > 0 and current >= target
    return result


async def _award_goal_reward(user_id: str, kind: str, amount: int, period_key: str):
    tx_key = f"goal:{kind}:{user_id}:{period_key}"
    existing = await db.transactions.find_one({"meta.goal_reward_key": tx_key})
    if existing:
        return False
    description = "Виконано всі тижневі цілі" if kind == "weekly" else "Виконано місячну ціль по бонусу"
    xp_reward = 100 if kind == "weekly" else 300
    now = now_iso()
    await db.users.update_one(
        {"id": user_id},
        {"$inc": {"balance": amount, "total_earned": amount}},
    )
    await db.transactions.insert_one({
        "id": str(uuid.uuid4()), "user_id": user_id, "kind": "goal_reward", "amount": amount,
        "description": f"{description} • +{xp_reward} XP", "created_at": now,
        "meta": {
            "goal_reward_key": tx_key,
            "goal_kind": kind,
            "period_key": period_key,
            "xp_reward": xp_reward,
        },
    })
    await _award_xp(
        user_id,
        xp_reward,
        "projection_goal",
        tx_key,
        description,
        {"goal_kind": kind, "period_key": period_key},
    )
    await _notify_points_awarded(user_id, amount, description)
    return True


@api.get("/goals/me")
async def get_my_goals(user: dict = Depends(get_current_user)):
    doc = await db.user_goals.find_one({"user_id": user["id"]}, {"_id": 0})
    result = _goals_public(doc)
    result["history"] = await db.goal_history.find(
        {"user_id": user["id"]}, {"_id": 0}
    ).sort("archived_at", -1).limit(8).to_list(8)
    return result


@api.get("/goals/participants")
async def get_goal_participants(user: dict = Depends(get_current_user)):
    """Profiles used in Google rankings, restricted to the permitted teams."""
    settings = await _goals_settings()
    query = {
        "role": {"$in": PLAYER_ROLES},
        "approved": {"$ne": False},
        "goals_login": {"$nin": [None, ""]},
    }
    privileged = user.get("role") in {"admin", "editor"}
    if not privileged and not settings["allow_cross_team_reports"]:
        if user.get("team_id"):
            query["team_id"] = user.get("team_id")
        else:
            query["id"] = user.get("id")
    docs = await db.users.find(
        query,
        {
            "_id": 0,
            "id": 1,
            "name": 1,
            "goals_login": 1,
            "team_id": 1,
            "avatar_initials": 1,
            "avatar_color": 1,
            "avatar_url": 1,
            "avatar_rarity": 1,
            "report_profile": 1,
        },
    ).sort("name", 1).to_list(2000)
    team_ids = list({doc.get("team_id") for doc in docs if doc.get("team_id")})
    team_names = {}
    if team_ids:
        async for team in db.teams.find({"id": {"$in": team_ids}}, {"_id": 0, "id": 1, "name": 1}):
            team_names[team["id"]] = team.get("name", "")
    for doc in docs:
        doc["team_name"] = team_names.get(doc.get("team_id"))
        doc["team_key"] = _normalize_team_report_key(doc.get("team_name"))
        doc["report_profile"] = doc.get("report_profile") if doc.get("report_profile") in {"sales", "activation"} else "sales"
    return docs


@api.get("/goals/report-access")
async def goals_report_access(user: dict = Depends(get_current_user)):
    """Access contract consumed by the PWA and the Netlify Google gateway."""
    settings = await _goals_settings()
    privileged = user.get("role") in {"admin", "editor"}
    allow_cross_team = privileged or settings["allow_cross_team_reports"]
    member_query = {
        "role": {"$in": PLAYER_ROLES},
        "approved": {"$ne": False},
        "goals_login": {"$nin": [None, ""]},
    }
    if not allow_cross_team:
        if user.get("team_id"):
            member_query["team_id"] = user.get("team_id")
        else:
            member_query["id"] = user.get("id")
    members = await db.users.find(
        member_query,
        {
            "_id": 0,
            "id": 1,
            "name": 1,
            "goals_login": 1,
            "team_id": 1,
            "avatar_initials": 1,
            "avatar_color": 1,
            "avatar_url": 1,
            "avatar_rarity": 1,
            "report_profile": 1,
        },
    ).sort("name", 1).to_list(3000)
    teams = await db.teams.find({}, {"_id": 0, "id": 1, "name": 1, "color": 1}).sort("name", 1).to_list(500)
    team_map = {team["id"]: team for team in teams}
    visible_team_ids = list(dict.fromkeys(member.get("team_id") for member in members if member.get("team_id")))
    visible_teams = [team_map[team_id] for team_id in visible_team_ids if team_id in team_map]
    current_team = team_map.get(user.get("team_id"))
    participants = []
    for member in members:
        participant = dict(member)
        participant["team_name"] = (team_map.get(member.get("team_id")) or {}).get("name", "")
        participant["team_key"] = _normalize_team_report_key(participant.get("team_name"))
        participant["report_profile"] = participant.get("report_profile") if participant.get("report_profile") in {"sales", "activation"} else "sales"
        participants.append(participant)
    allowed_logins = [str(member.get("goals_login") or "").strip().lower() for member in members]
    allowed_logins = [value for value in dict.fromkeys(allowed_logins) if value]
    team_message = None
    if user.get("team_id"):
        team_message = await db.team_goal_messages.find_one({"team_id": user.get("team_id")}, {"_id": 0})
    return {
        "allow_cross_team_reports": bool(allow_cross_team),
        "admin_allows_cross_team_reports": bool(settings["allow_cross_team_reports"]),
        "current_team": current_team,
        "teams": visible_teams if allow_cross_team else ([current_team] if current_team else []),
        "allowed_goals_logins": allowed_logins,
        "participants": participants,
        "access_signature": _goals_access_signature(current_team, allow_cross_team, allowed_logins, participants),
        "team_message": team_message,
        "is_team_leader": bool(user.get("is_team_leader")),
    }


@api.get("/goals/team-message")
async def get_team_goal_message(user: dict = Depends(get_current_user)):
    if not user.get("team_id"):
        return {"team_id": None, "message": "", "updated_at": None, "updated_by_name": None}
    doc = await db.team_goal_messages.find_one({"team_id": user.get("team_id")}, {"_id": 0}) or {}
    return {
        "team_id": user.get("team_id"),
        "message": doc.get("message", ""),
        "updated_at": doc.get("updated_at"),
        "updated_by_name": doc.get("updated_by_name"),
    }


@api.put("/leader/goals/team-message")
async def update_team_goal_message(body: TeamGoalMessageBody, user: dict = Depends(get_current_user)):
    if not user.get("team_id"):
        raise HTTPException(status_code=400, detail="Керівника не прив'язано до команди")
    if not user.get("is_team_leader") and user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Повідомлення команди може змінювати лише керівник")
    payload = {
        "team_id": user.get("team_id"),
        "message": body.message.strip()[:1200],
        "updated_at": now_iso(),
        "updated_by": user.get("id"),
        "updated_by_name": user.get("name", "Керівник"),
    }
    await db.team_goal_messages.update_one({"team_id": user.get("team_id")}, {"$set": payload}, upsert=True)
    if payload["message"]:
        await _notify_team(
            user.get("team_id"),
            "manager_message",
            "Нове повідомлення керівника",
            payload["message"],
            "/goals",
            "message-square",
            "manager_messages",
            {"updated_by_name": payload["updated_by_name"]},
        )
    return payload


@api.get("/leader/goals/views-today")
async def leader_goal_views_today(user: dict = Depends(get_current_user)):
    if not user.get("team_id"):
        raise HTTPException(status_code=400, detail="Керівника не прив'язано до команди")
    if not user.get("is_team_leader") and user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Перегляд доступний лише керівнику команди")
    members = await db.users.find(
        {
            "team_id": user.get("team_id"),
            "role": {"$in": PLAYER_ROLES},
            "approved": {"$ne": False},
        },
        {"_id": 0, "id": 1, "name": 1, "avatar_initials": 1, "avatar_color": 1, "avatar_url": 1, "avatar_rarity": 1, "goals_login": 1},
    ).sort("name", 1).to_list(1000)
    member_ids = [member["id"] for member in members]
    views = await db.page_views.find(
        {"user_id": {"$in": member_ids}, "date": kyiv_today_key(), "path": {"$regex": r"^/goals(?:$|/)"}},
        {"_id": 0, "user_id": 1, "path": 1, "created_at": 1},
    ).sort("created_at", 1).to_list(10000)
    by_user = {}
    for view in views:
        state = by_user.setdefault(view["user_id"], {"report_viewed": False, "metrics_viewed": False, "report_viewed_at": None, "metrics_viewed_at": None})
        state["report_viewed"] = True
        state["report_viewed_at"] = state["report_viewed_at"] or view.get("created_at")
        path = str(view.get("path") or "").split("?", 1)[0]
        if path in {"/goals/credit/me", "/goals/debit/me", "/goals/deposit/me"}:
            state["metrics_viewed"] = True
            state["metrics_viewed_at"] = state["metrics_viewed_at"] or view.get("created_at")
    rows = []
    for member in members:
        state = by_user.get(member["id"], {"report_viewed": False, "metrics_viewed": False, "report_viewed_at": None, "metrics_viewed_at": None})
        rows.append({**member, **state})
    return {
        "date": kyiv_today_key(),
        "team_id": user.get("team_id"),
        "team_name": await _resolve_team_name(user.get("team_id")),
        "members": rows,
        "report_viewed_count": sum(1 for row in rows if row["report_viewed"]),
        "metrics_viewed_count": sum(1 for row in rows if row["metrics_viewed"]),
        "total": len(rows),
    }


@api.get("/admin/goals-settings")
async def admin_get_goals_settings(admin: dict = Depends(get_current_admin)):
    return await _goals_settings()


@api.patch("/admin/goals-settings")
async def admin_update_goals_settings(body: GoalsSettingsUpdateBody, admin: dict = Depends(get_current_admin)):
    payload = {
        "id": "goals_visibility",
        "allow_cross_team_reports": bool(body.allow_cross_team_reports),
        "updated_at": now_iso(),
        "updated_by": admin.get("id"),
        "updated_by_name": admin.get("name", "Адміністратор"),
    }
    await db.app_settings.update_one({"id": "goals_visibility"}, {"$set": payload}, upsert=True)
    return payload


@api.get("/schedule-settings")
async def get_schedule_settings(user: dict = Depends(get_current_user)):
    return await _schedule_settings()


@api.get("/admin/schedule-settings")
async def admin_get_schedule_settings(admin: dict = Depends(get_current_admin)):
    return await _schedule_settings()


@api.patch("/admin/schedule-settings")
async def admin_update_schedule_settings(
    body: ScheduleSettingsUpdateBody,
    admin: dict = Depends(get_current_admin),
):
    payload = {
        "id": "work_schedule_calendar",
        "year": int(body.year),
        "month": int(body.month),
        "month_key": f"{int(body.year):04d}-{int(body.month):02d}",
        "updated_at": now_iso(),
        "updated_by": admin.get("id"),
        "updated_by_name": admin.get("name", "Адміністратор"),
    }
    await db.app_settings.update_one(
        {"id": "work_schedule_calendar"},
        {"$set": payload},
        upsert=True,
    )
    return payload


@api.get("/admin/goals-dashboard")
async def admin_goals_dashboard(
    team_id: Optional[str] = None,
    admin: dict = Depends(get_current_admin),
):
    user_query = {"role": {"$in": PLAYER_ROLES}, "approved": {"$ne": False}}
    if team_id:
        user_query["team_id"] = team_id
    users = await db.users.find(
        user_query,
        {"_id": 0, "id": 1, "name": 1, "avatar_initials": 1, "avatar_color": 1, "avatar_url": 1, "avatar_rarity": 1,
         "position": 1, "department": 1, "goals_login": 1, "team_id": 1, "report_profile": 1},
    ).sort("name", 1).to_list(1000)
    team_name = await _resolve_team_name(team_id) if team_id else None
    if team_name:
        for item in users:
            item["team_name"] = team_name
    docs = await db.user_goals.find({"user_id": {"$in": [u["id"] for u in users]}}, {"_id": 0}).to_list(1000)
    by_user = {d["user_id"]: d for d in docs}
    return [{**u, "goals": _goals_public(by_user.get(u["id"]))} for u in users]


@api.put("/admin/goals/{user_id}")
async def update_user_goals(user_id: str, body: UserGoalsUpdateBody, admin: dict = Depends(get_current_admin)):
    target = await db.users.find_one({"id": user_id, "role": {"$in": PLAYER_ROLES}}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Оператора не знайдено")
    old = await db.user_goals.find_one({"user_id": user_id}, {"_id": 0}) or {}
    week_key, month_key = _iso_week_key(), _month_key()
    if old and (old.get("week_key") != week_key or old.get("month_key") != month_key):
        archived = {**old, "id": str(uuid.uuid4()), "archived_at": now_iso()}
        archived.pop("_id", None)
        await db.goal_history.insert_one(archived)
    # New period resets only the related reward lock.
    weekly_awarded = bool(old.get("weekly_reward_awarded")) if old.get("week_key") == week_key else False
    monthly_awarded = bool(old.get("monthly_reward_awarded")) if old.get("month_key") == month_key else False
    payload = {
        "user_id": user_id, "week_key": week_key, "month_key": month_key,
        "credit": body.credit.model_dump(), "debit": body.debit.model_dump(), "deposit": body.deposit.model_dump(),
        "monthly_bonus_current": max(0, body.monthly_bonus_current),
        "monthly_bonus_target": max(0, body.monthly_bonus_target),
        "note": body.note.strip()[:500],
        "weekly_reward_awarded": weekly_awarded,
        "monthly_reward_awarded": monthly_awarded,
        "updated_by": admin["id"], "updated_by_name": admin.get("name", "Адміністратор"),
        "updated_at": now_iso(),
    }
    public = _goals_public(payload)
    weekly_new = False
    monthly_new = False
    if public["weekly_complete"] and not weekly_awarded:
        weekly_new = await _award_goal_reward(user_id, "weekly", 200, week_key)
        if weekly_new: payload["weekly_reward_awarded"] = True
    if public["monthly_complete"] and not monthly_awarded:
        monthly_new = await _award_goal_reward(user_id, "monthly", 1000, month_key)
        if monthly_new: payload["monthly_reward_awarded"] = True
    await db.user_goals.update_one({"user_id": user_id}, {"$set": payload}, upsert=True)
    fresh = _goals_public(payload)
    fresh["weekly_reward_just_awarded"] = weekly_new
    fresh["monthly_reward_just_awarded"] = monthly_new
    return fresh


DAILY_TASK_XP = {"easy": 10, "medium": 20, "hard": 30}
DAILY_TASK_CATALOG_VERSION = {"sales": "sales-v2-categories", "activation": "activation-v1"}


def _daily_task_profile(value: Optional[str]) -> str:
    return "activation" if value == "activation" else "sales"


def _daily_task_catalog(profile: Optional[str]) -> List[dict]:
    return ACTIVATION_DAILY_TASK_CATALOG if _daily_task_profile(profile) == "activation" else SALES_DAILY_TASK_CATALOG


def _daily_task_by_id(task_id: int, profile: Optional[str] = None) -> Optional[dict]:
    catalogs = [_daily_task_catalog(profile)] if profile else [SALES_DAILY_TASK_CATALOG, ACTIVATION_DAILY_TASK_CATALOG]
    task = next((task for catalog in catalogs for task in catalog if task["id"] == task_id), None)
    if not task:
        return None
    task_profile = "activation" if int(task.get("id", 0)) >= 1000 else "sales"
    return {**task, "xp": DAILY_TASK_XP.get(task.get("difficulty"), 10), "report_profile": task_profile}

async def _get_or_create_daily_task_set(user_or_id) -> dict:
    import hashlib
    import random
    if isinstance(user_or_id, dict):
        user = user_or_id
    else:
        user = await db.users.find_one({"id": str(user_or_id)}, {"_id": 0, "id": 1, "report_profile": 1}) or {"id": str(user_or_id)}
    user_id = str(user.get("id") or "")
    profile = _daily_task_profile(user.get("report_profile"))
    catalog = _daily_task_catalog(profile)
    catalog_version = DAILY_TASK_CATALOG_VERSION[profile]
    date_key = kyiv_today_key()
    doc = await db.daily_task_sets.find_one({"user_id": user_id, "date": date_key}, {"_id": 0})
    if doc and doc.get("catalog_profile") == profile and doc.get("catalog_version") == catalog_version:
        return doc
    seed = int(hashlib.sha256(f"{user_id}:{date_key}:{profile}:v128".encode()).hexdigest(), 16)
    rng = random.Random(seed)
    # Smart random: avoid missions the operator has seen during the last 14 days.
    recent_sets = await db.daily_task_sets.find(
        {"user_id": user_id, "date": {"$lt": date_key}, "catalog_profile": profile}, {"_id": 0, "task_ids": 1, "date": 1}
    ).sort("date", -1).limit(14).to_list(14)
    recent_ids = {int(task_id) for item in recent_sets for task_id in item.get("task_ids", [])}
    chosen = []
    if profile == "sales":
        # V152: sales operators receive one task from each of the seven business categories.
        # Difficulty is retained only for XP compatibility; the visible grouping is category-based.
        for category in SALES_DAILY_TASK_CATEGORIES:
            full_pool = [task for task in catalog if task.get("category") == category["key"]]
            fresh_pool = [task for task in full_pool if task["id"] not in recent_ids]
            pool = fresh_pool or full_pool
            if pool:
                chosen.append(rng.choice(pool)["id"])
    else:
        for difficulty in ("easy", "medium", "hard"):
            full_pool = [task for task in catalog if task["difficulty"] == difficulty]
            fresh_pool = [task for task in full_pool if task["id"] not in recent_ids]
            pool = fresh_pool or full_pool
            chosen.append(rng.choice(pool)["id"])
    replacement_limit_state = {
        "replacement_used": False,
        "replacements_used": 0,
    }
    doc = {
        "user_id": user_id,
        "date": date_key,
        "task_ids": chosen,
        **replacement_limit_state,
        "catalog_profile": profile,
        "catalog_version": catalog_version,
        "created_at": now_iso(),
    }
    # If an operator changes profile during the day, replace only the task set.
    # Existing review/transaction history remains immutable and cannot collide
    # because activation task IDs use a separate range.
    await db.daily_task_sets.update_one(
        {"user_id": user_id, "date": date_key},
        {"$set": doc},
        upsert=True,
    )
    doc.pop("_id", None)
    return doc

# ────────────────────────────────────────────────────────────────────────
# Daily battles
# ────────────────────────────────────────────────────────────────────────
async def _points_for_day(user_id: str, date_key: str) -> int:
    start, end = kyiv_day_bounds_utc(date_key)
    pipeline = [
        {"$match": {
            "user_id": user_id,
            "created_at": {"$gte": start, "$lt": end},
            "amount": {"$gt": 0},
            "kind": {"$nin": ["battle_win_bonus", "battle_tie_bonus"]},
            "$nor": [
                {"meta.source": "pet"},
                {"kind": "pet_gift"},
            ],
        }},
        {"$group": {"_id": None, "score": {"$sum": "$amount"}}},
    ]
    rows = await db.transactions.aggregate(pipeline).to_list(1)
    return int(rows[0]["score"]) if rows else 0


async def _ensure_daily_battles(date_key: str) -> None:
    # V151: use MongoDB's unique _id as a concurrency-safe day lock.
    # The old update_one(..., upsert=True) on a non-unique date field could race
    # under simultaneous requests and generate two battle pairings for one day.
    if await db.daily_battle_days.find_one({"date": date_key}, {"_id": 1}):
        return
    try:
        await db.daily_battle_days.insert_one({
            "_id": f"daily-battle-day:{date_key}",
            "date": date_key,
            "created_at": now_iso(),
        })
    except DuplicateKeyError:
        return
    import hashlib
    import random
    users = await db.users.find(
        {"role": {"$in": PLAYER_ROLES}, "approved": {"$ne": False}},
        {"_id": 0, "id": 1, "name": 1, "avatar_initials": 1, "avatar_color": 1, "avatar_url": 1, "avatar_rarity": 1, "department": 1},
    ).to_list(2000)
    if not users:
        return
    seed = int(hashlib.sha256(f"tm6-battle:{date_key}".encode()).hexdigest()[:16], 16)
    random.Random(seed).shuffle(users)
    docs = []
    for index in range(0, len(users), 2):
        left = users[index]
        right = users[index + 1] if index + 1 < len(users) else {
            "id": "__tm6_bot__", "name": "VPDK Bot", "avatar_initials": "AI",
            "avatar_color": "#00F0FF", "avatar_url": None, "department": "Віртуальний суперник",
        }
        pair_id = str(uuid.uuid4())
        base = {
            "pair_id": pair_id, "date": date_key, "status": "active", "winner_id": None,
            "reward": 50, "settled_at": None, "created_at": now_iso(),
        }
        docs.append({
            **base,
            "_id": f"daily-battle:{date_key}:{left['id']}",
            "user_id": left["id"],
            "opponent_id": right["id"],
            "opponent": right,
        })
        if right["id"] != "__tm6_bot__":
            docs.append({
                **base,
                "_id": f"daily-battle:{date_key}:{right['id']}",
                "user_id": right["id"],
                "opponent_id": left["id"],
                "opponent": left,
            })
    if docs:
        try:
            await db.daily_battles.insert_many(docs, ordered=False)
        except Exception:
            pass


async def _claim_daily_battle_reward(user_id: str, date_key: str, amount: int, kind: str, description: str, pair_id: str) -> bool:
    """Atomically grant at most one battle reward to a user for a Kyiv calendar day.

    V151 intentionally keys idempotency by user + battle date rather than pair_id.
    This also protects users from a historical edge case where concurrent day
    creation could have produced two different pair_ids for the same user/day.
    """
    reward_key = f"daily_battle:{date_key}"

    # Preserve compatibility with rewards created before V151. If the ledger
    # already contains a reward for this battle date, only backfill the marker.
    existing = await db.transactions.find_one({
        "user_id": user_id,
        "kind": {"$in": ["battle_win_bonus", "battle_tie_bonus"]},
        "meta.battle_date": date_key,
    }, {"_id": 1})
    if existing:
        await db.users.update_one(
            {"id": user_id},
            {"$addToSet": {"battle_reward_keys": reward_key}},
        )
        return False

    # One MongoDB document update performs the guard + balance increment. Even
    # if two settlement requests arrive at the same time, only one can match.
    awarded = await db.users.update_one(
        {"id": user_id, "battle_reward_keys": {"$ne": reward_key}},
        {
            "$inc": {"balance": amount, "total_earned": amount},
            "$push": {"battle_reward_keys": {"$each": [reward_key], "$slice": -730}},
        },
    )
    if awarded.modified_count != 1:
        return False

    transaction_id = f"battle-reward:{date_key}:{user_id}"
    try:
        await db.transactions.insert_one({
            "_id": transaction_id,
            "id": transaction_id,
            "user_id": user_id,
            "kind": kind,
            "amount": amount,
            "description": description,
            "created_at": now_iso(),
            "meta": {
                "pair_id": pair_id,
                "battle_date": date_key,
                "idempotency_key": reward_key,
            },
        })
    except DuplicateKeyError:
        # Balance is already guarded by battle_reward_keys, so this only means
        # the matching ledger row already exists.
        pass

    await _notify_points_awarded(user_id, amount, description)
    return True


async def _settle_finished_battles() -> None:
    today = kyiv_today_key()
    pairs = await db.daily_battles.find(
        {"date": {"$lt": today}, "status": "active"},
        {"_id": 0, "pair_id": 1, "date": 1, "user_id": 1, "opponent_id": 1},
    ).to_list(10000)
    by_pair = {}
    for row in pairs:
        by_pair.setdefault(row["pair_id"], row)
    for pair_id, row in by_pair.items():
        user_id, opponent_id, date_key = row["user_id"], row["opponent_id"], row["date"]
        user_score = await _points_for_day(user_id, date_key)
        opponent_score = 0 if opponent_id == "__tm6_bot__" else await _points_for_day(opponent_id, date_key)
        winner_id = user_id if user_score > opponent_score else opponent_id if opponent_score > user_score else None
        is_tie = user_score == opponent_score
        settled_at = now_iso()
        result_scores = {user_id: user_score, opponent_id: opponent_score}
        await db.daily_battles.update_many(
            {"pair_id": pair_id},
            {"$set": {
                "status": "finished",
                "winner_id": winner_id,
                "is_tie": is_tie,
                "scores": result_scores,
                "settled_at": settled_at,
            }},
        )
        if is_tie:
            tie_user_ids = [uid for uid in (user_id, opponent_id) if uid != "__tm6_bot__"]
            for tie_user_id in tie_user_ids:
                await _claim_daily_battle_reward(
                    tie_user_id,
                    date_key,
                    25,
                    "battle_tie_bonus",
                    "Нічия у щоденному батлі",
                    pair_id,
                )
        elif winner_id and winner_id != "__tm6_bot__":
            await _claim_daily_battle_reward(
                winner_id,
                date_key,
                50,
                "battle_win_bonus",
                "Перемога у щоденному батлі",
                pair_id,
            )


@api.get("/admin/daily-battles/duplicate-audit")
async def admin_daily_battle_duplicate_audit(admin: dict = Depends(get_current_admin_or_editor)):
    """Read-only audit for historical duplicate daily-battle rewards.

    A duplicate means that the same user has more than one battle reward ledger
    entry for the same Kyiv battle date. V151 prevents new duplicates, but this
    endpoint makes any historical rows visible without mutating balances.
    """
    pipeline = [
        {"$match": {"kind": {"$in": ["battle_win_bonus", "battle_tie_bonus"]}, "meta.battle_date": {"$exists": True}}},
        {"$sort": {"created_at": 1}},
        {"$group": {
            "_id": {"user_id": "$user_id", "battle_date": "$meta.battle_date"},
            "count": {"$sum": 1},
            "entries": {"$push": {
                "id": "$id",
                "kind": "$kind",
                "amount": "$amount",
                "created_at": "$created_at",
                "pair_id": "$meta.pair_id",
            }},
        }},
        {"$match": {"count": {"$gt": 1}}},
        {"$sort": {"_id.battle_date": -1}},
        {"$limit": 500},
    ]
    rows = await db.transactions.aggregate(pipeline).to_list(500)
    duplicates = []
    total_excess_amount = 0
    for row in rows:
        entries = row.get("entries") or []
        extras = entries[1:]
        excess_amount = sum(int(item.get("amount") or 0) for item in extras)
        total_excess_amount += excess_amount
        duplicates.append({
            "user_id": row.get("_id", {}).get("user_id"),
            "battle_date": row.get("_id", {}).get("battle_date"),
            "count": int(row.get("count") or 0),
            "excess_count": max(0, int(row.get("count") or 0) - 1),
            "excess_amount": excess_amount,
            "entries": entries,
        })
    return {
        "ok": True,
        "duplicate_days": len(duplicates),
        "total_excess_amount": total_excess_amount,
        "duplicates": duplicates,
    }


@api.get("/daily-battle")
async def daily_battle(user: dict = Depends(get_current_user)):
    await _settle_finished_battles()
    today = kyiv_today_key()
    await _ensure_daily_battles(today)
    battle = await db.daily_battles.find_one({"date": today, "user_id": user["id"]}, {"_id": 0})
    if not battle:
        return {"date": today, "status": "waiting", "reward": 50, "tie_reward": 25, "refresh_at": kyiv_tomorrow_iso()}
    my_score = await _points_for_day(user["id"], today)
    opponent_id = battle.get("opponent_id")
    opponent_score = 0 if opponent_id == "__tm6_bot__" else await _points_for_day(opponent_id, today)
    return {
        **battle, "my_score": my_score, "opponent_score": opponent_score,
        "is_leading": my_score > opponent_score, "is_tied": my_score == opponent_score,
        "tie_reward": 25, "refresh_at": kyiv_tomorrow_iso(),
    }


@api.get("/daily-tasks")
async def get_daily_tasks(user: dict = Depends(get_current_user)):
    task_set = await _get_or_create_daily_task_set(user)
    reviews = await db.daily_task_reviews.find(
        {"user_id": user["id"], "date": task_set["date"]}, {"_id": 0}
    ).to_list(20)
    review_map = {int(r["task_id"]): r for r in reviews}
    tasks = []
    for task_id in task_set["task_ids"]:
        task = _daily_task_by_id(task_id, task_set.get("catalog_profile"))
        if not task:
            continue
        review = review_map.get(int(task_id))
        tasks.append({
            **task,
            "status": review.get("status") if review else "pending",
            "reviewed_at": review.get("reviewed_at") if review else None,
            "reviewed_by_name": review.get("reviewed_by_name") if review else None,
        })
    return {
        "date": task_set["date"],
        "tasks": tasks,
        "report_profile": task_set.get("catalog_profile", _daily_task_profile(user.get("report_profile"))),
        "catalog_version": task_set.get("catalog_version"),
        "replacement_used": bool(task_set.get("replacement_used")),
        "replacements_used": int(task_set.get("replacements_used", 1 if task_set.get("replacement_used") else 0)),
        "replacement_limit": 1 + max(0, int(user.get("avatar_task_replacements") or 0)),
        "replacements_remaining": max(0, 1 + max(0, int(user.get("avatar_task_replacements") or 0)) - int(task_set.get("replacements_used", 1 if task_set.get("replacement_used") else 0))),
        "refresh_at": kyiv_tomorrow_iso(),
        "timezone": "Europe/Kyiv",
    }



@api.get("/admin/daily-tasks-dashboard")
async def admin_daily_tasks_dashboard(
    team_id: Optional[str] = None,
    admin: dict = Depends(get_current_admin_or_editor),
):
    date_key = kyiv_today_key()
    user_query = {"role": {"$in": PLAYER_ROLES}, "approved": {"$ne": False}}
    if team_id:
        user_query["team_id"] = team_id
    users = await db.users.find(
        user_query,
        {"_id": 0, "id": 1, "name": 1, "avatar_initials": 1, "avatar_color": 1, "avatar_url": 1, "avatar_rarity": 1, "position": 1, "department": 1, "total_xp": 1, "team_id": 1, "report_profile": 1},
    ).sort("name", 1).to_list(1000)

    team_ids = list({employee.get("team_id") for employee in users if employee.get("team_id")})
    team_names = {}
    if team_ids:
        async for team in db.teams.find({"id": {"$in": team_ids}}, {"_id": 0, "id": 1, "name": 1}):
            team_names[team["id"]] = team.get("name", "")
    for employee in users:
        employee["team_name"] = team_names.get(employee.get("team_id"))
        employee["report_profile"] = _daily_task_profile(employee.get("report_profile"))

    for employee in users:
        await _get_or_create_daily_task_set(employee)

    task_sets = await db.daily_task_sets.find({"date": date_key}, {"_id": 0}).to_list(2000)
    task_set_map = {row["user_id"]: row for row in task_sets}
    reviews = await db.daily_task_reviews.find({"date": date_key}, {"_id": 0}).to_list(5000)
    review_map = {(row["user_id"], int(row["task_id"])): row for row in reviews}

    operators = []
    awarded_points = 0
    awarded_xp = 0
    decided_count = 0
    for employee in users:
        task_set = task_set_map.get(employee["id"])
        if not task_set or task_set.get("catalog_profile") != employee.get("report_profile"):
            task_set = await _get_or_create_daily_task_set(employee)
        task_items = []
        for task_id in task_set.get("task_ids", []):
            task = _daily_task_by_id(int(task_id), task_set.get("catalog_profile"))
            if not task:
                continue
            review = review_map.get((employee["id"], int(task_id)))
            status = review.get("status") if review else "pending"
            if status == "approved":
                awarded_points += int(task["reward"])
                awarded_xp += int(task.get("xp", 0))
            if status in ("approved", "rejected"):
                decided_count += 1
            task_items.append({
                **task,
                "status": status,
                "reviewed_at": review.get("reviewed_at") if review else None,
                "reviewed_by_name": review.get("reviewed_by_name") if review else None,
            })
        operators.append({
            **employee,
            "tasks": task_items,
            "approved_count": sum(1 for item in task_items if item["status"] == "approved"),
            "decided_count": sum(1 for item in task_items if item["status"] in ("approved", "rejected")),
        })

    return {
        "date": date_key,
        "operators": operators,
        "operator_count": len(operators),
        "awarded_points": awarded_points,
        "awarded_xp": awarded_xp,
        "decided_count": decided_count,
        "total_tasks": sum(len(item.get("tasks", [])) for item in operators),
        "refresh_at": kyiv_tomorrow_iso(),
        "timezone": "Europe/Kyiv",
    }


@api.post("/admin/daily-tasks/{user_id}/{task_id}/{decision}")
async def admin_review_daily_task(
    user_id: str,
    task_id: int,
    decision: str,
    admin: dict = Depends(get_current_admin_or_editor),
):
    if decision not in ("approve", "reject"):
        raise HTTPException(status_code=400, detail="Невідоме рішення")
    target = await db.users.find_one({"id": user_id, "role": {"$in": PLAYER_ROLES}}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Оператора не знайдено")
    task_set = await _get_or_create_daily_task_set(target)
    if task_id not in task_set.get("task_ids", []):
        raise HTTPException(status_code=404, detail="Це завдання не призначене оператору сьогодні")
    task = _daily_task_by_id(task_id, task_set.get("catalog_profile"))
    if not task:
        raise HTTPException(status_code=404, detail="Завдання не знайдено")
    existing = await db.daily_task_reviews.find_one(
        {"user_id": user_id, "date": task_set["date"], "task_id": task_id}, {"_id": 0}
    )
    if existing:
        raise HTTPException(status_code=409, detail="Рішення щодо цього завдання вже зафіксовано")

    status = "approved" if decision == "approve" else "rejected"
    reviewed_at = now_iso()
    xp_reward = 20 if status == "approved" else 0
    review = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "date": task_set["date"],
        "task_id": task_id,
        "status": status,
        "reward": int(task["reward"]) if status == "approved" else 0,
        "xp": xp_reward,
        "reviewed_by": admin["id"],
        "reviewed_by_name": admin.get("name", "Адміністратор"),
        "reviewed_at": reviewed_at,
    }
    await db.daily_task_reviews.insert_one(review)

    if status == "approved":
        reward = int(task["reward"])
        await db.users.update_one(
            {"id": user_id},
            {"$inc": {"balance": reward, "total_earned": reward}},
        )
        await _award_xp(
            user_id,
            xp_reward,
            "daily_quest",
            f"daily-quest:{task_set['date']}:{task_id}",
            f"Щоденний квест: {task['title']}",
            {"task_id": task_id, "date": task_set["date"]},
            admin["id"],
        )
        approved_today = await db.daily_task_reviews.count_documents({
            "user_id": user_id,
            "date": task_set["date"],
            "status": "approved",
        })
        if approved_today >= 3:
            await _award_xp(
                user_id,
                30,
                "daily_quest_bonus",
                f"daily-perfect:{task_set['date']}",
                "Виконано 3 щоденні квести",
                {"date": task_set["date"], "approved_count": approved_today},
                admin["id"],
            )
        await db.transactions.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "kind": "daily_task_award",
            "amount": reward,
            "description": f"Завдання дня: {task['title']} • +{xp_reward} XP",
            "created_at": reviewed_at,
            "meta": {
                "task_id": task_id,
                "date": task_set["date"],
                "reviewed_by": admin["id"],
                "xp_reward": xp_reward,
            },
        })
        await _notify_points_awarded(user_id, reward, f"Завдання дня підтверджено: {task['title']}")
        progression_user = await db.users.find_one({"id": user_id}, {"_id": 0})
        if progression_user:
            await _sync_system_achievements(progression_user)

    return {
        "user_id": user_id,
        "task_id": task_id,
        "status": status,
        "reward": int(task["reward"]) if status == "approved" else 0,
        "xp": xp_reward,
        "reviewed_at": reviewed_at,
        "reviewed_by_name": admin.get("name", "Адміністратор"),
    }


@api.post("/daily-tasks/{task_id}/replace")
async def replace_daily_task(task_id: int, user: dict = Depends(get_current_user)):
    import hashlib
    import random
    task_set = await _get_or_create_daily_task_set(user)
    replacement_limit = 1 + max(0, int(user.get("avatar_task_replacements") or 0))
    replacements_used = int(task_set.get("replacements_used", 1 if task_set.get("replacement_used") else 0))
    if replacements_used >= replacement_limit:
        raise HTTPException(status_code=400, detail="Ліміт замін завдань на сьогодні вичерпано")
    if task_id not in task_set["task_ids"]:
        raise HTTPException(status_code=404, detail="Завдання не входить до сьогоднішнього набору")
    decided = await db.daily_task_reviews.find_one({"user_id": user["id"], "date": task_set["date"], "task_id": task_id})
    if decided:
        raise HTTPException(status_code=400, detail="Перевірене завдання вже не можна замінити")
    current = _daily_task_by_id(task_id, task_set.get("catalog_profile"))
    if not current:
        raise HTTPException(status_code=404, detail="Завдання не знайдено")
    recent_sets = await db.daily_task_sets.find(
        {"user_id": user["id"], "date": {"$lt": task_set["date"]}}, {"_id": 0, "task_ids": 1}
    ).sort("date", -1).limit(14).to_list(14)
    recent_ids = {int(value) for item in recent_sets for value in item.get("task_ids", [])}
    profile = _daily_task_profile(task_set.get("catalog_profile"))
    if profile == "sales":
        full_pool = [
            task for task in _daily_task_catalog(profile)
            if task.get("category") == current.get("category") and task["id"] not in task_set["task_ids"]
        ]
    else:
        full_pool = [
            task for task in _daily_task_catalog(profile)
            if task["difficulty"] == current["difficulty"] and task["id"] not in task_set["task_ids"]
        ]
    pool = [task for task in full_pool if task["id"] not in recent_ids] or full_pool
    if not pool:
        raise HTTPException(status_code=400, detail="Немає доступного завдання для заміни")
    seed = int(hashlib.sha256(f"{user['id']}:{task_set['date']}:{task_id}:replace".encode()).hexdigest(), 16)
    replacement = random.Random(seed).choice(pool)
    new_ids = [replacement["id"] if value == task_id else value for value in task_set["task_ids"]]
    await db.daily_task_sets.update_one(
        {"user_id": user["id"], "date": task_set["date"]},
        {"$set": {"task_ids": new_ids, "replacement_used": True, "replaced_at": now_iso()}, "$inc": {"replacements_used": 1}},
    )
    return {
        "date": task_set["date"],
        "tasks": [_daily_task_by_id(value, task_set.get("catalog_profile")) for value in new_ids],
        "replacement_used": True,
        "replacements_used": replacements_used + 1,
        "replacement_limit": replacement_limit,
        "replacements_remaining": max(0, replacement_limit - replacements_used - 1),
        "refresh_at": kyiv_tomorrow_iso(),
        "timezone": "Europe/Kyiv",
    }


# ────────────────────────────────────────────────────────────────────────
# Prizes & orders
# ────────────────────────────────────────────────────────────────────────
@api.get("/prizes", response_model=List[PrizeModel])
async def list_prizes(user: dict = Depends(get_current_user)):
    scope = [
        {"team_id": None},
        {"team_id": {"$exists": False}},
    ]
    if user.get("team_id"):
        scope.append({"team_id": user.get("team_id")})
    prizes = await db.prizes.find({"active": True, "$or": scope}, {"_id": 0}).sort("price", 1).to_list(500)
    result = []
    discount_available = int(user.get("store_discount_tokens", 0) or 0) > 0
    for prize in prizes:
        item = await _prize_with_team(prize)
        current_price = max(0, int(item.get("effective_price", item.get("price", 0)) or 0))
        level_discount = max(1, math.ceil(current_price * 0.05)) if discount_available and current_price > 0 else 0
        item["level_discount_points"] = min(current_price, level_discount)
        item["level_discount_active"] = level_discount > 0
        item["effective_price"] = max(0, current_price - level_discount)
        result.append(PrizeModel(**item))
    return result


@api.post("/prizes/{prize_id}/buy")
async def buy_prize(
    prize_id: str,
    expected_price: Optional[int] = None,
    user: dict = Depends(get_current_user),
):
    prize = await db.prizes.find_one({"id": prize_id, "active": True}, {"_id": 0})
    if not prize:
        raise HTTPException(status_code=404, detail="Приз не знайдено")
    prize_team_id = prize.get("team_id")
    if prize_team_id and prize_team_id != user.get("team_id"):
        raise HTTPException(status_code=403, detail="Цей приз доступний лише іншій команді")

    is_avatar = prize.get("category") == "avatar"
    if is_avatar and _diamond_avatar_is_active(user):
        expires_label = user.get("diamond_avatar_expires_at") or "завершення бонусного періоду"
        raise HTTPException(
            status_code=400,
            detail=f"Алмазний аватар активний до {expires_label}. Звичайний аватар можна змінити після його завершення.",
        )

    owned = prize_id in (user.get("owned_avatar_ids") or [])
    if not is_avatar and int(prize.get("stock", 0) or 0) <= 0:
        raise HTTPException(status_code=400, detail="Немає в наявності")

    base_price = 0 if (is_avatar and owned) else max(0, int(prize.get("price", 0) or 0))
    promotion = await _active_prize_promotion(prize_id) if base_price > 0 else None
    promotion_discount = 0
    promotion_id = None
    price = base_price
    if promotion:
        promotion_discount = max(0, min(base_price, int(promotion.get("discount_points") or 0)))
        promotion_id = promotion.get("id")
        price = max(0, base_price - promotion_discount)

    level_discount = 0
    use_level_discount = int(user.get("store_discount_tokens", 0) or 0) > 0 and price > 0
    if use_level_discount:
        level_discount = min(price, max(1, math.ceil(price * 0.05)))
        price = max(0, price - level_discount)

    if expected_price is not None and int(expected_price) != price:
        raise HTTPException(
            status_code=409,
            detail="Ціна змінилася. Оновіть магазин і підтвердьте покупку ще раз.",
        )
    if int(user.get("balance", 0) or 0) < price:
        raise HTTPException(status_code=400, detail="Недостатньо балів")

    reserved_promotion = None
    stock_reserved = False
    if promotion_id:
        reserved_promotion = await db.prize_promotions.find_one_and_update(
            {"id": promotion_id, "active": True, "quantity_remaining": {"$gt": 0}},
            {
                "$inc": {"quantity_remaining": -1, "used_count": 1},
                "$set": {"updated_at": now_iso(), "last_used_at": now_iso()},
            },
            return_document=ReturnDocument.AFTER,
            projection={"_id": 0},
        )
        if not reserved_promotion:
            # Another employee used the final discounted unit between catalog load and checkout.
            promotion_id = None
            promotion_discount = 0
            price = base_price
            level_discount = 0
            use_level_discount = int(user.get("store_discount_tokens", 0) or 0) > 0 and price > 0
            if use_level_discount:
                level_discount = min(price, max(1, math.ceil(price * 0.05)))
                price = max(0, price - level_discount)
            if expected_price is not None and int(expected_price) != price:
                raise HTTPException(
                    status_code=409,
                    detail="Акційні одиниці щойно закінчилися. Оновіть магазин і підтвердьте звичайну ціну.",
                )
        elif int(reserved_promotion.get("quantity_remaining") or 0) <= 0:
            await db.prize_promotions.update_one(
                {"id": promotion_id, "quantity_remaining": {"$lte": 0}},
                {"$set": {"active": False, "ended_at": now_iso(), "updated_at": now_iso()}},
            )

    async def rollback_promotion() -> None:
        if not promotion_id or not reserved_promotion:
            return
        await db.prize_promotions.update_one(
            {"id": promotion_id},
            {
                "$inc": {"quantity_remaining": 1, "used_count": -1},
                "$set": {"active": True, "updated_at": now_iso()},
                "$unset": {"ended_at": ""},
            },
        )

    if not is_avatar:
        reserved_prize = await db.prizes.find_one_and_update(
            {"id": prize_id, "active": True, "stock": {"$gt": 0}},
            {"$inc": {"stock": -1}},
            return_document=ReturnDocument.AFTER,
            projection={"_id": 0},
        )
        if not reserved_prize:
            await rollback_promotion()
            raise HTTPException(status_code=400, detail="Немає в наявності")
        stock_reserved = True

    current_time = now_iso()
    if is_avatar:
        operation = {
            "$set": {
                "avatar_url": prize.get("image"),
                "active_avatar_prize_id": prize_id,
                "avatar_rarity": prize.get("avatar_rarity") or "basic",
                "avatar_daily_bonus": int(prize.get("daily_bonus") or 0),
                "avatar_task_replacements": int(prize.get("task_replacements") or 0),
            },
            "$addToSet": {"owned_avatar_ids": prize_id},
        }
        if price:
            operation["$inc"] = {"balance": -price}
    else:
        operation = {"$inc": {"balance": -price}} if price else {"$set": {"updated_at": current_time}}
    if use_level_discount:
        operation.setdefault("$inc", {})["store_discount_tokens"] = -1

    user_query = {"id": user["id"]}
    if price:
        user_query["balance"] = {"$gte": price}
    if use_level_discount:
        user_query["store_discount_tokens"] = {"$gte": 1}
    fresh = await db.users.find_one_and_update(
        user_query,
        operation,
        return_document=ReturnDocument.AFTER,
        projection={"_id": 0},
    )
    if not fresh:
        if stock_reserved:
            await db.prizes.update_one({"id": prize_id}, {"$inc": {"stock": 1}})
        await rollback_promotion()
        raise HTTPException(status_code=400, detail="Недостатньо балів")

    order = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "user_name": user["name"],
        "prize_id": prize_id,
        "prize_title": prize["title"],
        "price": price,
        "base_price": base_price,
        "discount_points": promotion_discount,
        "level_discount_points": level_discount,
        "promotion_id": promotion_id,
        "team_id": user.get("team_id"),
        "team_name": await _resolve_team_name(user.get("team_id")),
        "status": "delivered" if is_avatar else "processing",
        "created_at": current_time,
    }
    await db.orders.insert_one(order)
    if price:
        promo_label = f" · акція −{promotion_discount} Point" if promotion_discount else ""
        await db.transactions.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": user["id"],
            "kind": "purchase",
            "amount": -price,
            "description": f"Купівля: {prize['title']}{promo_label}",
            "created_at": current_time,
            "meta": {
                "source": "store",
                "prize_id": prize_id,
                "order_id": order["id"],
                "base_price": base_price,
                "discount_points": promotion_discount,
                "level_discount_points": level_discount,
                "promotion_id": promotion_id,
            },
        })
    order.pop("_id", None)
    if stock_reserved and int((reserved_prize or {}).get("stock", 0) or 0) <= 0:
        await db.users.update_one({"id": user["id"]}, {"$inc": {"last_prize_buys": 1}})
    progression_user = await db.users.find_one({"id": user["id"]}, {"_id": 0}) or fresh
    await _sync_system_achievements(progression_user)
    fresh = await db.users.find_one({"id": user["id"]}, {"_id": 0}) or fresh
    current_prize = await db.prizes.find_one({"id": prize_id}, {"_id": 0}) or prize
    current_prize = await _prize_with_team(current_prize)
    current_price = max(0, int(current_prize.get("effective_price", current_prize.get("price", 0)) or 0))
    next_discount = max(1, math.ceil(current_price * 0.05)) if int(fresh.get("store_discount_tokens", 0) or 0) > 0 and current_price > 0 else 0
    current_prize["level_discount_points"] = min(current_price, next_discount)
    current_prize["level_discount_active"] = next_discount > 0
    current_prize["effective_price"] = max(0, current_price - next_discount)
    return {
        "order": OrderModel(**order),
        "user": _user_with_progress(fresh),
        "equipped": is_avatar,
        "already_owned": owned,
        "prize": PrizeModel(**current_prize),
    }


@api.get("/team-bank", response_model=TeamBankModel)
async def get_team_bank(user: dict = Depends(get_current_user)):
    if not user.get("team_id"):
        raise HTTPException(status_code=400, detail="Для цієї функції потрібно бути в команді")
    return await _team_bank_response(user["team_id"], user["id"])


@api.get("/team-banks", response_model=List[TeamBankModel])
async def get_team_banks(user: dict = Depends(get_current_user)):
    if not user.get("team_id"):
        raise HTTPException(status_code=400, detail="Для цієї функції потрібно бути в команді")
    return await _team_banks_response(user["team_id"], user["id"])


async def _contribute_to_team_bank(bank_id: str, body: TeamBankContributionBody, user: dict):
    team_id = user.get("team_id")
    if not team_id:
        raise HTTPException(status_code=400, detail="Для внеску потрібно бути в команді")
    amount = int(body.amount or 0)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Сума внеску має бути більшою за нуль")

    bank_before = await db.team_banks.find_one({"id": bank_id}, {"_id": 0})
    if not bank_before:
        raise HTTPException(status_code=404, detail="Банку не знайдено")
    if str(bank_before.get("team_id") or "") != str(team_id):
        raise HTTPException(status_code=403, detail="Ця банка належить іншій команді")
    if bank_before.get("active", True) is False:
        raise HTTPException(status_code=400, detail="Ця банка зараз неактивна")

    team_name = bank_before.get("team_name") or (await _resolve_team_name(team_id)) or "Команда"
    bank_title = bank_before.get("title") or TEAM_BANK_TITLE
    reward_title = bank_before.get("reward_title") or TEAM_BANK_REWARD_TITLE
    fresh_user = await db.users.find_one_and_update(
        {"id": user["id"], "balance": {"$gte": amount}},
        {"$inc": {"balance": -amount}},
        return_document=ReturnDocument.AFTER,
        projection={"_id": 0},
    )
    if not fresh_user:
        raise HTTPException(status_code=400, detail="Недостатньо балів")

    current_time = now_iso()
    previous_points = int(bank_before.get("current_points") or 0)
    goal_points = max(1, int(bank_before.get("goal_points") or TEAM_BANK_GOAL_POINTS))
    updated_current_points = previous_points + amount
    bank_updates = {
        "$inc": {"current_points": amount},
        "$set": {"team_name": team_name, "updated_at": current_time},
    }
    reached_goal_now = previous_points < goal_points <= updated_current_points and not bank_before.get("unlocked_at")
    if reached_goal_now:
        bank_updates.setdefault("$set", {})["unlocked_at"] = current_time
    await db.team_banks.update_one({"id": bank_id}, bank_updates)

    contribution_id = str(uuid.uuid4())
    cycle_number = max(1, int(bank_before.get("cycle_number") or 1))
    await db.team_bank_contributions.insert_one({
        "id": contribution_id,
        "bank_id": bank_id,
        "bank_title": bank_title,
        "team_id": team_id,
        "cycle_number": cycle_number,
        "team_name": team_name,
        "user_id": user["id"],
        "user_name": user.get("name") or "Користувач",
        "amount": amount,
        "created_at": current_time,
    })
    contribution_xp = min(20, max(5, math.ceil(amount / 50)))
    await _award_xp(
        user["id"],
        contribution_xp,
        "team_bank",
        f"team-bank:{contribution_id}",
        f"Внесок у банку «{bank_title}»",
        {"bank_id": bank_id, "cycle_number": cycle_number, "amount": amount},
    )
    await db.transactions.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "kind": "team_bank_contribution",
        "amount": -amount,
        "description": f"Внесок у банку «{bank_title}»: {team_name}",
        "created_at": current_time,
        "meta": {"source": "team_bank", "bank_id": bank_id, "team_id": team_id, "cycle_number": cycle_number, "contribution_id": contribution_id},
    })

    await _notify_team(
        team_id,
        "team_bank",
        f"{user.get('name') or 'Учасник'} поповнив банку «{bank_title}»",
        f"+{amount} Point до спільної цілі. Нагорода: «{reward_title}».",
        "/store",
        "gift",
        "prizes",
        {"bank_id": bank_id, "team_id": team_id, "amount": amount},
        False,
    )
    if reached_goal_now:
        contributor_ids = await db.team_bank_contributions.distinct("user_id", {
            "bank_id": bank_id,
            "cycle_number": cycle_number,
        })
        for contributor_id in contributor_ids:
            await _award_xp(
                str(contributor_id),
                20,
                "team_goal",
                f"team-goal:{bank_id}:{cycle_number}",
                f"Командна ціль «{bank_title}» виконана",
                {"bank_id": bank_id, "cycle_number": cycle_number, "goal_points": goal_points},
            )
        await _notify_team(
            team_id,
            "team_bank_goal",
            f"Банка «{bank_title}» зібрана!",
            f"Команда зібрала {goal_points} Point і отримує нагороду: {reward_title}.",
            "/store",
            "gift",
            "prizes",
            {"bank_id": bank_id, "team_id": team_id, "goal_points": goal_points},
            True,
        )

    refreshed_bank = await db.team_banks.find_one({"id": bank_id}, {"_id": 0}) or bank_before
    bank = await _team_bank_model(refreshed_bank, user["id"])
    fresh_user = await db.users.find_one({"id": user["id"]}, {"_id": 0}) or fresh_user
    await _sync_system_achievements(fresh_user)
    fresh_user = await db.users.find_one({"id": user["id"]}, {"_id": 0}) or fresh_user
    return {"bank": bank, "user": _user_with_progress(fresh_user)}


@api.post("/team-banks/{bank_id}/contribute")
async def contribute_selected_team_bank(bank_id: str, body: TeamBankContributionBody, user: dict = Depends(get_current_user)):
    return await _contribute_to_team_bank(bank_id, body, user)


@api.post("/team-bank/contribute")
async def contribute_team_bank(body: TeamBankContributionBody, user: dict = Depends(get_current_user)):
    """Backward-compatible contribution to the original default bank."""
    bank = await _ensure_team_bank(user.get("team_id"))
    return await _contribute_to_team_bank(str(bank["id"]), body, user)


@api.get("/admin/team-banks", response_model=List[TeamBankModel])
async def admin_list_team_banks(admin: dict = Depends(get_current_admin)):
    teams = await db.teams.find({}, {"_id": 0, "id": 1, "name": 1}).sort("name", 1).to_list(500)
    result = []
    for team in teams:
        result.extend(await _team_banks_response(team["id"], include_inactive=True))
    return result


@api.post("/admin/team-banks", response_model=TeamBankModel)
async def admin_create_team_bank(body: TeamBankCreateBody, admin: dict = Depends(get_current_admin)):
    team_id = body.team_id.strip()
    team = await db.teams.find_one({"id": team_id}, {"_id": 0, "id": 1, "name": 1})
    if not team:
        raise HTTPException(status_code=404, detail="Команду не знайдено")
    title = body.title.strip()
    description = body.description.strip()
    reward_title = body.reward_title.strip()
    if min(len(title), len(description), len(reward_title)) < 2:
        raise HTTPException(status_code=422, detail="Заповніть назву, опис і винагороду")
    current_time = now_iso()
    doc = {
        "id": f"team-bank-{uuid.uuid4()}",
        "team_id": team_id,
        "team_name": team.get("name") or "Команда",
        "title": title,
        "active": bool(body.active),
        "goal_points": int(body.goal_points),
        "current_points": 0,
        "reward_title": reward_title,
        "description": description,
        "cycle_number": 1,
        "unlocked_at": None,
        "last_reset_at": None,
        "last_reset_by": None,
        "created_by": admin.get("id"),
        "created_at": current_time,
        "updated_at": current_time,
    }
    await db.team_banks.insert_one(doc)
    doc.pop("_id", None)
    return await _team_bank_model(doc)


@api.patch("/admin/team-banks/{bank_id}", response_model=TeamBankModel)
async def admin_update_team_bank(bank_id: str, body: TeamBankUpdateBody, admin: dict = Depends(get_current_admin)):
    bank = await db.team_banks.find_one({"id": bank_id}, {"_id": 0})
    if not bank:
        raise HTTPException(status_code=404, detail="Банку не знайдено")
    if any(getattr(body, field) is None for field in body.model_fields_set):
        raise HTTPException(status_code=422, detail="Поля банки не можуть бути null")
    updates = body.model_dump(exclude_unset=True)
    for field in ("title", "description", "reward_title"):
        if field in updates and updates[field] is not None:
            updates[field] = updates[field].strip()
            if len(updates[field]) < 2:
                raise HTTPException(status_code=422, detail="Назва, опис і винагорода мають містити щонайменше 2 символи")
    if not updates:
        return await _team_bank_model(bank)
    updates["updated_at"] = now_iso()
    updates["updated_by"] = admin.get("id")
    await db.team_banks.update_one({"id": bank_id}, {"$set": updates})
    updated = await db.team_banks.find_one({"id": bank_id}, {"_id": 0}) or {**bank, **updates}
    return await _team_bank_model(updated)


@api.post("/admin/team-banks/{bank_id}/reset", response_model=TeamBankModel)
async def admin_reset_team_bank(bank_id: str, admin: dict = Depends(get_current_admin)):
    bank = await db.team_banks.find_one({"id": bank_id}, {"_id": 0})
    if not bank:
        # Compatibility with the old endpoint, where this path segment was team_id.
        team = await db.teams.find_one({"id": bank_id}, {"_id": 0, "id": 1})
        if not team:
            raise HTTPException(status_code=404, detail="Банку не знайдено")
        bank = await _ensure_team_bank(bank_id)
    resolved_bank_id = str(bank.get("id"))
    team_id = str(bank.get("team_id"))
    previous_cycle = max(1, int(bank.get("cycle_number") or 1))
    current_time = now_iso()
    await db.team_bank_cycles.insert_one({
        "id": str(uuid.uuid4()),
        "bank_id": resolved_bank_id,
        "bank_title": bank.get("title") or TEAM_BANK_TITLE,
        "team_id": team_id,
        "team_name": bank.get("team_name") or "Команда",
        "cycle_number": previous_cycle,
        "goal_points": int(bank.get("goal_points") or TEAM_BANK_GOAL_POINTS),
        "final_points": int(bank.get("current_points") or 0),
        "reward_title": bank.get("reward_title") or TEAM_BANK_REWARD_TITLE,
        "unlocked_at": bank.get("unlocked_at"),
        "started_at": bank.get("created_at"),
        "closed_at": current_time,
        "closed_by": admin.get("id"),
        "closed_by_name": admin.get("name") or admin.get("email") or "Адміністратор",
    })
    await db.team_banks.update_one(
        {"id": resolved_bank_id},
        {
            "$set": {
                "current_points": 0,
                "unlocked_at": None,
                "updated_at": current_time,
                "last_reset_at": current_time,
                "last_reset_by": admin.get("id"),
            },
            "$inc": {"cycle_number": 1},
        },
    )
    await _notify_team(
        team_id,
        "team_bank_reset",
        f"Банку «{bank.get('title') or TEAM_BANK_TITLE}» скинуто",
        f"Розпочато новий збір: {int(bank.get('goal_points') or TEAM_BANK_GOAL_POINTS)} Point на нагороду «{bank.get('reward_title') or TEAM_BANK_REWARD_TITLE}».",
        "/store",
        "gift",
        "prizes",
        {"bank_id": resolved_bank_id, "team_id": team_id, "cycle_number": previous_cycle + 1},
        True,
    )
    refreshed = await db.team_banks.find_one({"id": resolved_bank_id}, {"_id": 0}) or bank
    return await _team_bank_model(refreshed)


@api.get("/orders", response_model=List[OrderModel])
async def my_orders(user: dict = Depends(get_current_user)):
    docs = await db.orders.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return [OrderModel(**d) for d in docs]


@api.get("/transactions", response_model=List[TransactionModel])
async def my_transactions(user: dict = Depends(get_current_user)):
    docs = await db.transactions.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return [TransactionModel(**d) for d in docs]


# ────────────────────────────────────────────────────────────────────────
# Leaderboard
# ────────────────────────────────────────────────────────────────────────
class LeaderboardEntry(BaseModel):
    rank: int
    user_id: str
    name: str
    avatar_initials: str
    avatar_color: str
    avatar_url: Optional[str] = None
    avatar_rarity: str = "basic"
    department: str
    score: int
    is_me: bool = False


class LeaderboardResponse(BaseModel):
    period: str
    top: List[LeaderboardEntry]
    my_entry: Optional[LeaderboardEntry] = None


def _leaderboard_period_match(period: Literal["day", "week", "month"]) -> dict:
    """Return the transaction date filter used by both personal and team ratings.

    The rating is net Point movement for the selected period, except purchases
    made in the prize store. Store spending changes the wallet balance but does
    not lower a player's competitive rating. Paid cube spins, Bonus Match
    lives/boosters and administrative deductions still reduce the rating.
    """
    if period == "day":
        start, end = kyiv_day_bounds_utc(kyiv_today_key())
        return {"created_at": {"$gte": start, "$lt": end}}
    days = 7 if period == "week" else 30
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    return {"created_at": {"$gte": since}}


def _store_purchase_exclusion() -> dict:
    """Match transactions that are not prize-store purchases.

    `meta.source=store` is used by v112+ records. Team Bank contributions are
    also treated as non-competitive spending, so collective goals do not lower
    a player's rating.
    """
    return {
        "$nor": [
            {"meta.source": "store"},
            {"meta.source": "team_bank"},
            {"meta.source": "pet"},
            {"kind": "purchase", "description": {"$regex": r"^Купівля:"}},
            {"kind": "team_bank_contribution"},
            {"kind": "pet_gift"},
        ]
    }


def _pet_reward_exclusion() -> dict:
    """Match transactions that are not personal-pet economic rewards."""
    return {
        "$nor": [
            {"meta.source": "pet"},
            {"kind": "pet_gift"},
        ]
    }


async def _transaction_scores(period: Literal["day", "week", "month"]) -> dict[str, int]:
    pipeline = [
        {"$match": {"$and": [_leaderboard_period_match(period), _store_purchase_exclusion()]}},
        {"$group": {"_id": "$user_id", "score": {"$sum": "$amount"}}},
    ]
    rows = await db.transactions.aggregate(pipeline).to_list(5000)
    return {str(row["_id"]): int(row.get("score", 0) or 0) for row in rows}


async def _store_spending_by_user() -> dict[str, int]:
    """Return absolute all-time non-competitive spending per user.

    This includes prize-store purchases and Team Bank contributions because both
    reduce wallet balance but should not lower the all-time competitive rating.
    """
    pipeline = [
        {
            "$match": {
                "$or": [
                    {"meta.source": "store"},
                    {"meta.source": "team_bank"},
                    {"kind": "purchase", "description": {"$regex": r"^Купівля:"}},
                    {"kind": "team_bank_contribution"},
                ],
                "amount": {"$lt": 0},
            }
        },
        {"$group": {"_id": "$user_id", "spent": {"$sum": {"$abs": "$amount"}}}},
    ]
    rows = await db.transactions.aggregate(pipeline).to_list(5000)
    return {str(row["_id"]): int(row.get("spent", 0) or 0) for row in rows}


async def _pet_rewards_by_user() -> dict[str, int]:
    """Return all-time positive pet rewards excluded from competition.

    Pet gifts remain spendable wallet Point, but they must not change battle or
    leaderboard positions. Older rows are matched by both the structured source
    and the legacy transaction kind.
    """
    pipeline = [
        {
            "$match": {
                "$or": [
                    {"meta.source": "pet"},
                    {"kind": "pet_gift"},
                ],
                "amount": {"$gt": 0},
            }
        },
        {"$group": {"_id": "$user_id", "awarded": {"$sum": "$amount"}}},
    ]
    rows = await db.transactions.aggregate(pipeline).to_list(5000)
    return {str(row["_id"]): int(row.get("awarded", 0) or 0) for row in rows}


async def _leaderboard_for_period(
    period: Literal["day", "week", "month", "all"],
    current_id: str,
    limit: int = 20,
    team_id: Optional[str] = None,
) -> LeaderboardResponse:
    user_filter: dict = {"role": {"$in": PLAYER_ROLES}}
    if team_id:
        user_filter["team_id"] = team_id

    users = await db.users.find(
        user_filter,
        {
            "_id": 0,
            "id": 1,
            "name": 1,
            "avatar_initials": 1,
            "avatar_color": 1,
            "avatar_url": 1,
            "avatar_rarity": 1,
            "department": 1,
            "balance": 1,
            "pet_reward_points_total": 1,
        },
    ).to_list(5000)

    if period == "all":
        store_spending, pet_rewards = await asyncio.gather(
            _store_spending_by_user(),
            _pet_rewards_by_user(),
        )
        scores = {
            str(item["id"]): (
                int(item.get("balance", 0) or 0)
                + store_spending.get(str(item["id"]), 0)
                - max(
                    pet_rewards.get(str(item["id"]), 0),
                    int(item.get("pet_reward_points_total", 0) or 0),
                )
            )
            for item in users
        }
    else:
        scores = await _transaction_scores(period)

    users.sort(
        key=lambda item: (
            -scores.get(str(item["id"]), 0),
            str(item.get("name") or "").casefold(),
            str(item["id"]),
        )
    )

    top: List[LeaderboardEntry] = []
    my_entry: Optional[LeaderboardEntry] = None
    for index, item in enumerate(users, start=1):
        entry = LeaderboardEntry(
            rank=index,
            user_id=item["id"],
            name=item.get("name") or "Користувач",
            avatar_initials=item.get("avatar_initials", "?"),
            avatar_color=item.get("avatar_color", "#FFB800"),
            avatar_url=item.get("avatar_url"),
            avatar_rarity=item.get("avatar_rarity", "basic"),
            department=item.get("department", ""),
            score=scores.get(str(item["id"]), 0),
            is_me=item["id"] == current_id,
        )
        if index <= limit:
            top.append(entry)
        if item["id"] == current_id:
            my_entry = entry

    return LeaderboardResponse(
        period=period,
        top=top,
        my_entry=my_entry if (my_entry and my_entry.rank > limit) else None,
    )


@api.get("/leaderboard", response_model=LeaderboardResponse)
async def leaderboard(
    period: Literal["day", "week", "month", "all"] = "week",
    team_id: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    result = await _leaderboard_for_period(period, user["id"], team_id=team_id)
    own = next((entry for entry in result.top if entry.user_id == user["id"]), None) or result.my_entry
    # Rank notifications stay tied to the global leaderboard. Switching the
    # visible team filter must not generate false "position changed" alerts.
    if own and not team_id:
        await _maybe_notify_rank_change(user["id"], period, own.rank, own.score)
    return result


class TeamLeaderboardEntry(BaseModel):
    rank: int
    team_id: str
    name: str
    color: str
    department: str
    member_count: int
    # Kept for backward compatibility with older clients. Since v112 these
    # values are net competitive Point, with prize-store purchases excluded.
    total_earned: int
    avg_earned: int
    score: int
    avg_score: int
    period: Literal["day", "week", "month", "all"]


@api.get("/leaderboard/teams", response_model=List[TeamLeaderboardEntry])
async def team_leaderboard(
    period: Literal["day", "week", "month", "all"] = "all",
    user: dict = Depends(get_current_user),
):
    teams = await db.teams.find({}, {"_id": 0}).to_list(500)
    players = await db.users.find(
        {"role": {"$in": PLAYER_ROLES}},
        {"_id": 0, "id": 1, "team_id": 1, "balance": 1, "pet_reward_points_total": 1},
    ).to_list(5000)

    if period == "all":
        store_spending, pet_rewards = await asyncio.gather(
            _store_spending_by_user(),
            _pet_rewards_by_user(),
        )
        user_scores = {
            str(item["id"]): (
                int(item.get("balance", 0) or 0)
                + store_spending.get(str(item["id"]), 0)
                - max(
                    pet_rewards.get(str(item["id"]), 0),
                    int(item.get("pet_reward_points_total", 0) or 0),
                )
            )
            for item in players
        }
    else:
        user_scores = await _transaction_scores(period)

    members_by_team: dict[str, list[dict]] = {}
    for player in players:
        team_id = player.get("team_id")
        if team_id:
            members_by_team.setdefault(str(team_id), []).append(player)

    scored = []
    for team in teams:
        members = members_by_team.get(str(team["id"]), [])
        total = sum(user_scores.get(str(member["id"]), 0) for member in members)
        member_count = len(members)
        average = int(round(total / member_count)) if member_count else 0
        scored.append({
            "team_id": team["id"],
            "name": team["name"],
            "color": team.get("color", "#FFB800"),
            "department": team.get("department", ""),
            "member_count": member_count,
            "total_earned": total,
            "avg_earned": average,
            "score": total,
            "avg_score": average,
            "period": period,
        })

    scored.sort(key=lambda item: (-item["score"], str(item["name"]).casefold(), str(item["team_id"])))
    return [TeamLeaderboardEntry(rank=index, **item) for index, item in enumerate(scored, start=1)]


# ────────────────────────────────────────────────────────────────────────
# Games: daily cube (Щедрий Куб) + Prediction of the day
# ────────────────────────────────────────────────────────────────────────
PREDICTIONS_UK = [
    "Сьогодні твій дзвінок стане чиїмось найкращим досвідом за день.",
    "Клієнт, з яким найважче — стане твоїм улюбленим. Довірся процесу.",
    "Одна усмішка в голосі — і ти чуєш її у відповідь.",
    "Терпіння сьогодні = бали завтра. Не поспішай.",
    "Твій темп зростає. Помічай маленькі перемоги.",
    "Найкраща зміна — та, після якої хочеться повернутись.",
    "Слухай уважно перші 20 секунд — вони вирішують все.",
    "Порада: паузу можна робити частіше. Ти цього вартий.",
    "Сьогодні ти закриєш кейс, який усі відкладали.",
    "Той дзвінок, якого ти боявся — виявиться найлегшим.",
    "Хтось із команди сьогодні тобі щиро подякує.",
    "Не порівнюй себе з іншими — порівнюй з собою вчорашнім.",
    "Найкращі оператори мають одну звичку: пити багато води.",
    "Твій голос сьогодні звучить упевненіше, ніж будь-коли.",
    "Спитай у клієнта, як його день. Він відкриється.",
    "Складна година пройде — і ти вийдеш сильнішим.",
    "Твоя послідовність важливіша за твою швидкість.",
    "Сьогодні маленький хід приведе до великого результату.",
    "Порахуй свої 'так' цього дня — їх буде більше, ніж думаєш.",
    "Один щирий комплімент клієнту — і день для нього змінюється.",
    "Ти вже ближче до наступного рівня, ніж здається.",
    "Твоя команда виграє тоді, коли ти виграєш. І навпаки.",
    "Не всі бали видно одразу. Гарна карма повертається.",
    "Найкраще натхнення — це виконаний квест.",
    "Сьогодні у Щедрому Кубі може чекати джекпот. Спробуй.",
]

# Administrators can edit the reward range and probability of every face,
# plus the price of each repeat spin. The first spin of each Kyiv day always
# remains free. Default probabilities preserve the original 37/28/20/10/4/1
# economy and add up to exactly 100%.
DEFAULT_CUBE_SPIN_COST = 20
DEFAULT_CUBE_GENEROSITY_DAY_CHANCE_PERCENT = 35.0
CUBE_GENEROSITY_QUEST_TARGET = 3
CUBE_FACE_META = [
    (1, 37, "one"),
    (2, 28, "two"),
    (3, 20, "three"),
    (4, 10, "four"),
    (5, 4, "five"),
    (6, 1, "six"),
]
DEFAULT_CUBE_FACE_PROBABILITIES = [
    {"face": 1, "probability_percent": 37.0},
    {"face": 2, "probability_percent": 28.0},
    {"face": 3, "probability_percent": 20.0},
    {"face": 4, "probability_percent": 10.0},
    {"face": 5, "probability_percent": 4.0},
    {"face": 6, "probability_percent": 1.0},
]
DEFAULT_CUBE_REWARD_RANGES = [
    {"face": 1, "min_reward": 1, "max_reward": 10},
    {"face": 2, "min_reward": 11, "max_reward": 20},
    {"face": 3, "min_reward": 21, "max_reward": 30},
    {"face": 4, "min_reward": 31, "max_reward": 50},
    {"face": 5, "min_reward": 51, "max_reward": 100},
    {"face": 6, "min_reward": 101, "max_reward": 500},
]
# Legacy constants remain for compatibility with older validators and tests.
# Runtime spins use the editable settings returned by _cube_settings().
CUBE_SPIN_COST = 20
CUBE_TABLE = [
    (1, 37, 1, 10, "one"),
    (2, 28, 11, 20, "two"),
    (3, 20, 21, 30, "three"),
    (4, 10, 31, 50, "four"),
    (5, 4, 51, 100, "five"),
    (6, 1, 101, 500, "six"),
]


def _normalize_cube_reward_ranges(raw_ranges) -> List[dict]:
    defaults = {item["face"]: dict(item) for item in DEFAULT_CUBE_REWARD_RANGES}
    supplied = {}
    for item in raw_ranges or []:
        try:
            face = int(item.get("face"))
            minimum = int(item.get("min_reward"))
            maximum = int(item.get("max_reward"))
        except (TypeError, ValueError, AttributeError):
            continue
        if face not in defaults or minimum < 0 or maximum < minimum:
            continue
        supplied[face] = {"face": face, "min_reward": minimum, "max_reward": maximum}
    return [supplied.get(face, defaults[face]) for face in range(1, 7)]


def _normalize_cube_probabilities(raw_probabilities) -> List[dict]:
    defaults = {item["face"]: dict(item) for item in DEFAULT_CUBE_FACE_PROBABILITIES}
    supplied = {}
    for item in raw_probabilities or []:
        try:
            face = int(item.get("face"))
            probability = round(float(item.get("probability_percent")), 2)
        except (TypeError, ValueError, AttributeError):
            continue
        if face not in defaults or not math.isfinite(probability) or probability < 0 or probability > 100:
            continue
        supplied[face] = {"face": face, "probability_percent": probability}

    if raw_probabilities and set(supplied) != set(range(1, 7)):
        return [dict(item) for item in DEFAULT_CUBE_FACE_PROBABILITIES]
    normalized = [supplied.get(face, defaults[face]) for face in range(1, 7)]
    total = round(sum(float(item["probability_percent"]) for item in normalized), 2)
    # Corrupt or partially edited database values must never create an invalid
    # random table. Fall back as a complete set instead of silently mixing odds.
    if total != 100.0:
        return [dict(item) for item in DEFAULT_CUBE_FACE_PROBABILITIES]
    return normalized


async def _cube_settings() -> dict:
    doc = await db.app_settings.find_one({"id": "generous_cube"}, {"_id": 0}) or {}
    try:
        paid_spin_cost = int(doc.get("paid_spin_cost", DEFAULT_CUBE_SPIN_COST))
    except (TypeError, ValueError):
        paid_spin_cost = DEFAULT_CUBE_SPIN_COST
    paid_spin_cost = max(0, min(100000, paid_spin_cost))
    try:
        generosity_day_chance = float(doc.get("generosity_day_chance_percent", DEFAULT_CUBE_GENEROSITY_DAY_CHANCE_PERCENT))
    except (TypeError, ValueError):
        generosity_day_chance = DEFAULT_CUBE_GENEROSITY_DAY_CHANCE_PERCENT
    generosity_day_chance = max(0.0, min(100.0, round(generosity_day_chance, 2)))
    return {
        "id": "generous_cube",
        "paid_spin_cost": paid_spin_cost,
        "generosity_day_chance_percent": generosity_day_chance,
        "rewards": _normalize_cube_reward_ranges(doc.get("rewards")),
        "probabilities": _normalize_cube_probabilities(doc.get("probabilities")),
        "updated_at": doc.get("updated_at"),
        "updated_by": doc.get("updated_by"),
        "updated_by_name": doc.get("updated_by_name"),
    }


def _cube_roll_table(settings: dict) -> List[tuple]:
    rewards = {item["face"]: item for item in settings.get("rewards") or DEFAULT_CUBE_REWARD_RANGES}
    probabilities = {
        item["face"]: float(item["probability_percent"])
        for item in settings.get("probabilities") or DEFAULT_CUBE_FACE_PROBABILITIES
    }
    table = []
    for face, default_weight, tier in CUBE_FACE_META:
        reward = rewards.get(face) or DEFAULT_CUBE_REWARD_RANGES[face - 1]
        weight = probabilities.get(face, float(default_weight))
        table.append((face, weight, int(reward["min_reward"]), int(reward["max_reward"]), tier))
    return table


def _cube_generosity_selected(user_id: str, date_key: str, chance_percent: float) -> bool:
    """Stable random choice for one player/day, unaffected by page reloads."""
    chance = max(0.0, min(100.0, float(chance_percent or 0)))
    digest = hashlib.sha256(f"cube-generosity::{user_id}::{date_key}".encode()).hexdigest()
    bucket = (int(digest[:8], 16) % 10_000) / 100
    return bucket < chance


async def _completed_daily_quest_count(user_id: str, date_key: str) -> int:
    """Approved daily tasks are the employee-facing quests used by /tasks."""
    return await db.daily_task_reviews.count_documents({
        "user_id": user_id,
        "date": date_key,
        "status": "approved",
    })


async def _cube_day_context(user_id: str, doc: dict, settings: dict) -> dict:
    date_key = str(doc.get("date") or kyiv_today_key())
    generosity_event = doc.get("cube_generosity_event")
    if not isinstance(generosity_event, bool):
        chance = float(settings.get("generosity_day_chance_percent", DEFAULT_CUBE_GENEROSITY_DAY_CHANCE_PERCENT))
        generosity_event = _cube_generosity_selected(user_id, date_key, chance)
        await db.daily_games.update_one(
            {"user_id": user_id, "date": date_key},
            {"$set": {
                "cube_generosity_event": generosity_event,
                "cube_generosity_chance_percent": chance,
                "cube_generosity_selected_at": now_iso(),
            }},
        )
        doc["cube_generosity_event"] = generosity_event

    completed_quests = await _completed_daily_quest_count(user_id, date_key)
    bonus_unlocked = completed_quests >= CUBE_GENEROSITY_QUEST_TARGET
    spin_count = int(doc.get("cube_spin_count") or (1 if doc.get("cube_spun") else 0))
    free_spins_total = 1 + (1 if generosity_event and bonus_unlocked else 0)
    free_spins_remaining = max(0, free_spins_total - spin_count) if generosity_event else max(0, 1 - spin_count)
    return {
        "cube_generosity_event": generosity_event,
        "cube_generosity_bonus_unlocked": bonus_unlocked,
        "completed_quests_today": completed_quests,
        "cube_generosity_quest_target": CUBE_GENEROSITY_QUEST_TARGET,
        "cube_free_spins_total": free_spins_total,
        "cube_free_spins_remaining": free_spins_remaining,
        "cube_can_spin": free_spins_remaining > 0 if generosity_event else True,
    }


class CubeSpinResult(BaseModel):
    reward: int
    face: int
    tier: Literal["one", "two", "three", "four", "five", "six"]
    cost: int
    spin_count: int
    next_spin_cost: int
    new_balance: int
    total_xp: int
    cube_generosity_event: bool = False
    cube_generosity_bonus_unlocked: bool = False
    completed_quests_today: int = 0
    cube_generosity_quest_target: int = CUBE_GENEROSITY_QUEST_TARGET
    cube_free_spins_total: int = 1
    cube_free_spins_remaining: int = 0
    cube_can_spin: bool = True
    bonus_cube_spins: int = 0


class GamesStatus(BaseModel):
    date: str
    cube_spun: bool
    cube_spin_count: int = 0
    cube_reward: Optional[int] = None
    cube_face: Optional[int] = None
    cube_tier: Optional[str] = None
    next_spin_cost: int = 0
    paid_spin_cost: int = DEFAULT_CUBE_SPIN_COST
    cube_reward_ranges: List[CubeRewardRangeBody] = Field(default_factory=list)
    cube_generosity_event: bool = False
    cube_generosity_bonus_unlocked: bool = False
    completed_quests_today: int = 0
    cube_generosity_quest_target: int = CUBE_GENEROSITY_QUEST_TARGET
    cube_free_spins_total: int = 1
    cube_free_spins_remaining: int = 1
    cube_can_spin: bool = True
    bonus_cube_spins: int = 0
    prediction_revealed: bool
    prediction_text: Optional[str] = None


class PredictionResult(BaseModel):
    text: str
    date: str


async def _get_or_create_games_doc(user_id: str) -> dict:
    key = kyiv_today_key()
    doc = await db.daily_games.find_one({"user_id": user_id, "date": key}, {"_id": 0})
    if doc:
        return doc
    doc = {"user_id": user_id, "date": key, "cube_spun": False, "cube_spin_count": 0, "prediction_revealed": False}
    await db.daily_games.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.get("/admin/cube-settings")
async def admin_get_cube_settings(admin: dict = Depends(get_current_admin)):
    return await _cube_settings()


@api.patch("/admin/cube-settings")
async def admin_update_cube_settings(body: CubeSettingsUpdateBody, admin: dict = Depends(get_current_admin)):
    rewards = [item.model_dump() for item in body.rewards]
    faces = [item["face"] for item in rewards]
    if sorted(faces) != [1, 2, 3, 4, 5, 6]:
        raise HTTPException(status_code=400, detail="Потрібно вказати по одному діапазону для кожної грані від 1 до 6")
    for item in rewards:
        if item["min_reward"] > item["max_reward"]:
            raise HTTPException(status_code=400, detail=f"Для грані {item['face']} мінімальний виграш не може бути більшим за максимальний")

    current = await _cube_settings()
    generosity_day_chance = (
        current["generosity_day_chance_percent"]
        if body.generosity_day_chance_percent is None
        else round(float(body.generosity_day_chance_percent), 2)
    )
    if body.probabilities is None:
        probabilities = current["probabilities"]
    else:
        probabilities = [item.model_dump() for item in body.probabilities]
        probability_faces = [item["face"] for item in probabilities]
        if sorted(probability_faces) != [1, 2, 3, 4, 5, 6]:
            raise HTTPException(status_code=400, detail="Потрібно вказати ймовірність для кожної грані від 1 до 6")
        probabilities = [
            {"face": int(item["face"]), "probability_percent": round(float(item["probability_percent"]), 2)}
            for item in probabilities
        ]
        probability_total = round(sum(item["probability_percent"] for item in probabilities), 2)
        if probability_total != 100.0:
            raise HTTPException(
                status_code=400,
                detail=f"Сума ймовірностей усіх граней має дорівнювати 100%. Зараз: {probability_total:g}%",
            )

    payload = {
        "id": "generous_cube",
        "paid_spin_cost": int(body.paid_spin_cost),
        "generosity_day_chance_percent": generosity_day_chance,
        "rewards": sorted(rewards, key=lambda item: item["face"]),
        "probabilities": sorted(probabilities, key=lambda item: item["face"]),
        "updated_at": now_iso(),
        "updated_by": admin.get("id"),
        "updated_by_name": admin.get("name", "Адміністратор"),
    }
    await db.app_settings.update_one({"id": "generous_cube"}, {"$set": payload}, upsert=True)
    return payload


@api.get("/games/status", response_model=GamesStatus)
async def games_status(user: dict = Depends(get_current_user)):
    doc = await _get_or_create_games_doc(user["id"])
    settings = await _cube_settings()
    spin_count = int(doc.get("cube_spin_count") or (1 if doc.get("cube_spun") else 0))
    day_context = await _cube_day_context(user["id"], doc, settings)
    return GamesStatus(
        date=doc["date"],
        cube_spun=spin_count > 0,
        cube_spin_count=spin_count,
        cube_reward=doc.get("cube_reward"),
        cube_face=doc.get("cube_face"),
        cube_tier=doc.get("cube_tier"),
        next_spin_cost=0 if day_context["cube_generosity_event"] or spin_count == 0 or int(user.get("bonus_cube_spins", 0) or 0) > 0 else settings["paid_spin_cost"],
        paid_spin_cost=settings["paid_spin_cost"],
        cube_reward_ranges=settings["rewards"],
        **day_context,
        bonus_cube_spins=int(user.get("bonus_cube_spins", 0) or 0),
        prediction_revealed=doc.get("prediction_revealed", False),
        prediction_text=doc.get("prediction_text"),
    )


@api.post("/games/cube/spin", response_model=CubeSpinResult)
async def cube_spin(user: dict = Depends(get_current_user)):
    import random as _rand

    doc = await _get_or_create_games_doc(user["id"])
    settings = await _cube_settings()
    cube_table = _cube_roll_table(settings)
    spin_count = int(doc.get("cube_spin_count") or (1 if doc.get("cube_spun") else 0))
    day_context = await _cube_day_context(user["id"], doc, settings)
    generosity_event = day_context["cube_generosity_event"]
    use_level_bonus_spin = spin_count > 0 and int(user.get("bonus_cube_spins", 0) or 0) > 0
    if generosity_event and not day_context["cube_can_spin"] and not use_level_bonus_spin:
        raise HTTPException(
            status_code=400,
            detail="Безкоштовні кидки Куба Щедрості на сьогодні використано",
        )
    cost = 0 if generosity_event or spin_count == 0 or use_level_bonus_spin else settings["paid_spin_cost"]
    next_count = spin_count + 1

    # A special-day free slot is reserved atomically so parallel requests
    # cannot use the same limited throw twice.
    if generosity_event:
        reservation = await db.daily_games.update_one(
            {
                "user_id": user["id"],
                "date": kyiv_today_key(),
                "$expr": {"$eq": [{"$ifNull": ["$cube_spin_count", 0]}, spin_count]},
            },
            {"$set": {"cube_spin_count": next_count}},
        )
        if reservation.modified_count != 1:
            raise HTTPException(status_code=409, detail="Куб уже кинуто в іншій вкладці. Оновіть сторінку")

    # Weighted face selection uses the current administrator-defined odds.
    # The settings endpoint enforces a 100% total, while the dynamic total below
    # keeps the spin safe even during legacy data migration.
    total_weight = sum(max(0.0, float(item[1])) for item in cube_table)
    if total_weight <= 0:
        raise HTTPException(status_code=503, detail="Ймовірності Щедрого куба налаштовані некоректно")
    roll = _rand.random() * total_weight
    acc = 0.0
    picked = cube_table[-1]
    for item in cube_table:
        acc += max(0.0, float(item[1]))
        if roll < acc:
            picked = item
            break

    face, _weight, reward_min, reward_max, tier = picked
    reward = _rand.randint(reward_min, reward_max)
    xp_reward = 5

    # One atomic balance update prevents parallel paid spins from overspending.
    user_filter = {"id": user["id"]}
    if cost:
        user_filter["balance"] = {"$gte": cost}
    if use_level_bonus_spin:
        user_filter["bonus_cube_spins"] = {"$gte": 1}
    user_increments = {
        "balance": reward - cost,
        "total_earned": reward,
    }
    if use_level_bonus_spin:
        user_increments["bonus_cube_spins"] = -1
    update_result = await db.users.update_one(
        user_filter,
        {"$inc": user_increments},
    )
    if update_result.modified_count != 1:
        raise HTTPException(status_code=400, detail=f"Недостатньо Point для кидка. Потрібно {cost} Point")

    spin_record = {
        "face": face,
        "reward": reward,
        "reward_min": reward_min,
        "reward_max": reward_max,
        "probability_percent": round(float(_weight), 2),
        "cost": cost,
        "tier": tier,
        "spun_at": now_iso(),
    }
    await db.daily_games.update_one(
        {"user_id": user["id"], "date": kyiv_today_key()},
        {
            "$set": {
                "cube_spun": True,
                "cube_spin_count": next_count,
                "cube_reward": reward,
                "cube_face": face,
                "cube_tier": tier,
                "cube_spun_at": spin_record["spun_at"],
            },
            "$push": {"cube_spins": spin_record},
        },
    )

    if cost:
        await db.transactions.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": user["id"],
            "kind": "purchase",
            "amount": -cost,
            "description": "Платний кидок Щедрого Куба",
            "created_at": now_iso(),
        })
    await db.transactions.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "kind": "quest",
        "amount": reward,
        "description": f"Щедрий Куб: грань {face} ({tier})",
        "created_at": now_iso(),
    })
    await _notify_points_awarded(user["id"], reward, f"Щедрий Куб: випала грань {face}")

    await _award_xp(
        user["id"],
        xp_reward,
        "cube",
        f"cube-daily:{kyiv_today_key()}",
        "Участь у Щедрому кубі (денний ліміт)",
        {"date": kyiv_today_key(), "face": face},
    )
    progression_user = await db.users.find_one({"id": user["id"]}, {"_id": 0}) or user
    await _sync_system_achievements(progression_user)
    fresh = await db.users.find_one({"id": user["id"]}, {"_id": 0}) or progression_user
    free_spins_remaining = max(0, int(day_context["cube_free_spins_total"]) - next_count)
    result_day_context = {
        **day_context,
        "cube_free_spins_remaining": free_spins_remaining,
        "cube_can_spin": free_spins_remaining > 0 if generosity_event else True,
    }
    return CubeSpinResult(
        reward=reward,
        face=face,
        tier=tier,
        cost=cost,
        spin_count=next_count,
        next_spin_cost=0 if generosity_event or int(fresh.get("bonus_cube_spins", 0) or 0) > 0 else settings["paid_spin_cost"],
        new_balance=fresh["balance"],
        total_xp=fresh["total_xp"],
        bonus_cube_spins=int(fresh.get("bonus_cube_spins", 0) or 0),
        **result_day_context,
    )


@api.post("/games/prediction/reveal", response_model=PredictionResult)
async def prediction_reveal(user: dict = Depends(get_current_user)):
    doc = await _get_or_create_games_doc(user["id"])
    if doc.get("prediction_revealed") and doc.get("prediction_text"):
        return PredictionResult(text=doc["prediction_text"], date=doc["date"])
    key = kyiv_today_key()
    seed = int(hashlib.sha256(f"{user['id']}::{key}".encode()).hexdigest(), 16)
    text = PREDICTIONS_UK[seed % len(PREDICTIONS_UK)]
    await db.daily_games.update_one(
        {"user_id": user["id"], "date": key},
        {"$set": {"prediction_revealed": True, "prediction_text": text, "prediction_revealed_at": now_iso()}},
    )
    return PredictionResult(text=text, date=key)

# ────────────────────────────────────────────────────────────────────────
# Bonus Match — server-authoritative match-3 mini game
# ────────────────────────────────────────────────────────────────────────
BONUS_MATCH_CAMPAIGN = "pixel-room-2026-09"
BONUS_MATCH_ROWS = 8
BONUS_MATCH_COLS = 8
BONUS_MATCH_BOARD_SHAPES = {
    "full": [
        "11111111",
        "11111111",
        "11111111",
        "11111111",
        "11111111",
        "11111111",
        "11111111",
        "11111111"
    ],
    "rounded": [
        "01111110",
        "11111111",
        "11111111",
        "11111111",
        "11111111",
        "11111111",
        "11111111",
        "01111110"
    ],
    "diamond": [
        "00111100",
        "01111110",
        "11111111",
        "11111111",
        "11111111",
        "11111111",
        "01111110",
        "00111100"
    ],
    "cross": [
        "00111100",
        "00111100",
        "11111111",
        "11111111",
        "11111111",
        "11111111",
        "00111100",
        "00111100"
    ],
    "staircase": [
        "11111000",
        "11111100",
        "11111110",
        "11111111",
        "11111111",
        "01111111",
        "00111111",
        "00011111"
    ]
}
BONUS_MATCH_BOARD_SHAPE_ORDER = ["full", "rounded", "diamond", "cross", "staircase"]
BONUS_MATCH_DEFAULT_LEVEL_COUNT = 150
BONUS_MATCH_LEVEL_LIMIT = 200
BONUS_MATCH_MAX_LEVEL = BONUS_MATCH_LEVEL_LIMIT
BONUS_MATCH_MAX_LIVES = 5
BONUS_MATCH_LIFE_REGEN_MINUTES = 30
BONUS_MATCH_LIFE_PRICE = 10
BONUS_MATCH_DAILY_POINT_CAP = None  # No daily Point cap for Bonus Match
BONUS_MATCH_SYMBOLS = ["coin", "star", "gift", "cube", "zap", "trophy"]
BONUS_MATCH_SPECIALS = {"rocket_row", "rocket_col", "bomb", "color_bomb"}
BONUS_MATCH_FIRST_CLEAR_POINTS = 2
BONUS_MATCH_FIRST_CLEAR_XP = 15
BONUS_MATCH_REPLAY_XP = 5
BONUS_MATCH_BOSS_LEVELS = {25: 2, 40: 2, 50: 3, 60: 2, 70: 2, 80: 2, 90: 2, 100: 3, 110: 3, 120: 3, 130: 3, 140: 3, 150: 4}
BONUS_MATCH_OBSTACLE_ORDER = [
    "ice", "chain", "crate", "stone", "crystal",
    "web", "shield", "slime", "metal", "core",
]
BONUS_MATCH_OBSTACLE_HITS = {
    "ice": 2, "chain": 2, "crate": 2, "stone": 3, "crystal": 2,
    "web": 1, "shield": 3, "slime": 2, "metal": 3, "core": 4,
}
# Chain and web are overlays: they hold a real symbol in place, so the symbol
# can participate in a match even though the cell itself cannot be swapped or
# moved by gravity. The other obstacle types occupy the whole cell.
BONUS_MATCH_OVERLAY_OBSTACLES = {"chain", "web"}
BONUS_MATCH_BLOCKING_OBSTACLES = set(BONUS_MATCH_OBSTACLE_HITS) - BONUS_MATCH_OVERLAY_OBSTACLES
BONUS_MATCH_OBSTACLE_SCORE = {
    "ice": {"hit": 70, "destroy": 180},
    "chain": {"hit": 80, "destroy": 220},
    "crate": {"hit": 70, "destroy": 260},
    "stone": {"hit": 80, "destroy": 260},
    "crystal": {"hit": 100, "destroy": 520},
    "web": {"hit": 0, "destroy": 190},
    "shield": {"hit": 100, "destroy": 360},
    "slime": {"hit": 90, "destroy": 280},
    "metal": {"hit": 130, "destroy": 460},
    "core": {"hit": 180, "destroy": 1400},
}
BONUS_MATCH_SPECIAL_SCORE = {
    "rocket_row": 450, "rocket_col": 450, "bomb": 700, "color_bomb": 1100,
}
BONUS_MATCH_BOOSTERS = {
    "hammer": {"label": "Молоток", "score": 250, "price": 10},
    "rocket": {"label": "Ракета", "score": 850, "price": 20},
    "color_bomb": {"label": "Веселковий джокер", "score": 1200, "price": 50},
    "shuffle": {"label": "Перемішати", "score": 0, "price": 30},
}

BONUS_MATCH_AUTHORED_LEVELS_PATH = ROOT_DIR / "bonus_match_levels.json"
try:
    BONUS_MATCH_AUTHORED_LEVELS = {
        int(item["level"]): item
        for item in json.loads(BONUS_MATCH_AUTHORED_LEVELS_PATH.read_text(encoding="utf-8"))
        if 1 <= int(item.get("level", 0)) <= BONUS_MATCH_DEFAULT_LEVEL_COUNT
    }
except (OSError, ValueError, TypeError, KeyError) as exc:
    logger.warning("Could not load authored Bonus Match levels: %s", exc)
    BONUS_MATCH_AUTHORED_LEVELS = {}



def _bonus_match_default_board_shape(level: int) -> str:
    """Rotate safe connected board silhouettes as levels progress."""
    level = max(1, min(BONUS_MATCH_LEVEL_LIMIT, int(level or 1)))
    if level <= 4:
        return "full"
    cycle = ["rounded", "full", "diamond", "rounded", "staircase", "full", "cross", "rounded"]
    return cycle[((level - 5) // 2) % len(cycle)]


def _bonus_match_normalize_board_shape(value, level: int = 1) -> str:
    shape = str(value or "").strip().lower()
    return shape if shape in BONUS_MATCH_BOARD_SHAPES else _bonus_match_default_board_shape(level)


def _bonus_match_board_mask(shape: str) -> list[list[bool]]:
    rows = BONUS_MATCH_BOARD_SHAPES[_bonus_match_normalize_board_shape(shape)]
    return [[char == "1" for char in row] for row in rows]


def _bonus_match_cell_void(cell: Optional[dict]) -> bool:
    return bool(cell and cell.get("void"))


def _bonus_match_infer_board_shape(board) -> str:
    """Infer a persisted silhouette so pre-v75 active sessions stay visually unchanged."""
    rows = list(board or [])
    for shape, pattern in BONUS_MATCH_BOARD_SHAPES.items():
        matches = True
        for row in range(BONUS_MATCH_ROWS):
            for col in range(BONUS_MATCH_COLS):
                cell = rows[row][col] if row < len(rows) and col < len(rows[row] or []) else None
                should_be_void = pattern[row][col] == "0"
                if _bonus_match_cell_void(cell) != should_be_void:
                    matches = False
                    break
            if not matches:
                break
        if matches:
            return shape
    return "full"


def _bonus_match_config_with_board_shape(config, level: int, board=None) -> dict:
    provided = dict(config or {})
    resolved = {**_bonus_match_level_config(level), **provided}
    raw_shape = str(provided.get("board_shape") or "").strip().lower()
    if raw_shape in BONUS_MATCH_BOARD_SHAPES:
        shape = raw_shape
    elif board is not None:
        shape = _bonus_match_infer_board_shape(board)
    else:
        shape = _bonus_match_default_board_shape(level)
    resolved["board_shape"] = shape
    resolved["board_mask"] = _bonus_match_board_mask(shape)
    return resolved


class BonusMatchStartBody(BaseModel):
    level: int = 1


class BonusMatchMoveBody(BaseModel):
    session_id: str
    from_row: int
    from_col: int
    to_row: int
    to_col: int


class BonusMatchBoosterPurchaseBody(BaseModel):
    booster: Literal["hammer", "rocket", "color_bomb", "shuffle"]


class BonusMatchSurrenderBody(BaseModel):
    session_id: str


class BonusMatchBoosterUseBody(BaseModel):
    session_id: str
    booster: Literal["hammer", "rocket", "color_bomb", "shuffle"]
    row: Optional[int] = None
    col: Optional[int] = None


class BonusMatchObjective(BaseModel):
    kind: Literal["clear_obstacles"] = "clear_obstacles"
    obstacle: Literal["ice", "chain", "crate", "stone", "crystal", "web", "shield", "slime", "metal", "core"]
    count: int = Field(default=1, ge=1, le=35)


class BonusMatchLevelAdminBody(BaseModel):
    objective: Optional[BonusMatchObjective] = None
    level: Optional[int] = None
    title: str = ""
    board_shape: str = "full"
    moves: int = Field(default=20, ge=5, le=80)
    target_score: int = Field(default=2500, ge=100, le=10_000_000)
    target_coins: int = Field(default=10, ge=0, le=5000)
    star_thresholds: List[int] = Field(default_factory=list)
    is_milestone: bool = False
    is_boss: bool = False
    reward_multiplier: int = Field(default=1, ge=1, le=10)
    obstacles: List[str] = Field(default_factory=list)
    new_obstacle: Optional[str] = None
    obstacle_count: int = Field(default=0, ge=0, le=35)
    obstacle_layout: List[dict] = Field(default_factory=list)
    active: bool = True


def _bonus_match_new_cell(
    symbol: Optional[str] = None,
    special: Optional[str] = None,
    obstacle: Optional[str] = None,
    obstacle_hits: Optional[int] = None,
    obstacle_age: int = 0,
    cell_id: Optional[str] = None,
    void: bool = False,
) -> dict:
    if void:
        return {
            "id": str(cell_id or f"void-{uuid.uuid4().hex[:12]}"),
            "symbol": None,
            "special": None,
            "obstacle": None,
            "obstacle_hits": 0,
            "obstacle_age": 0,
            "void": True,
        }
    obstacle = obstacle if obstacle in BONUS_MATCH_OBSTACLE_HITS else None
    if obstacle in BONUS_MATCH_BLOCKING_OBSTACLES:
        symbol = None
        special = None
    elif obstacle in BONUS_MATCH_OVERLAY_OBSTACLES:
        special = None
    return {
        "id": str(cell_id or uuid.uuid4().hex[:14]),
        "symbol": symbol if symbol in BONUS_MATCH_SYMBOLS else None,
        "special": special if special in BONUS_MATCH_SPECIALS else None,
        "obstacle": obstacle,
        "obstacle_hits": int(
            obstacle_hits if obstacle_hits is not None
            else BONUS_MATCH_OBSTACLE_HITS.get(obstacle, 0)
        ),
        "obstacle_age": max(0, int(obstacle_age or 0)),
        "void": False,
    }


def _bonus_match_normalize_cell(value) -> Optional[dict]:
    if value is None:
        return None
    if isinstance(value, str):
        return _bonus_match_new_cell(symbol=value)
    if not isinstance(value, dict):
        return None
    if value.get("void"):
        return _bonus_match_new_cell(void=True, cell_id=str(value.get("id") or uuid.uuid4().hex[:14]))
    symbol = value.get("symbol")
    special = value.get("special")
    obstacle = value.get("obstacle")
    obstacle = obstacle if obstacle in BONUS_MATCH_OBSTACLE_HITS else None
    cell_id = str(value.get("id") or uuid.uuid4().hex[:14])
    if obstacle in BONUS_MATCH_OVERLAY_OBSTACLES and symbol not in BONUS_MATCH_SYMBOLS:
        # Old sessions stored every obstacle as a symbol-less block. Give old
        # chain/web cells a deterministic held piece so saved games remain valid.
        symbol = BONUS_MATCH_SYMBOLS[sum(ord(char) for char in cell_id) % len(BONUS_MATCH_SYMBOLS)]
    cell = _bonus_match_new_cell(
        symbol=symbol,
        special=special,
        obstacle=obstacle,
        obstacle_hits=max(
            0,
            int(value.get(
                "obstacle_hits",
                BONUS_MATCH_OBSTACLE_HITS.get(obstacle, 0),
            ) or 0),
        ),
        obstacle_age=max(0, int(value.get("obstacle_age", 0) or 0)),
        cell_id=cell_id,
    )
    if cell["obstacle"] and cell["obstacle_hits"] <= 0:
        cell["obstacle_hits"] = BONUS_MATCH_OBSTACLE_HITS[cell["obstacle"]]
    return cell


def _bonus_match_normalize_board(board) -> list[list[Optional[dict]]]:
    rows = list(board or [])[:BONUS_MATCH_ROWS]
    normalized: list[list[Optional[dict]]] = []
    for row in rows:
        values = list(row or [])[:BONUS_MATCH_COLS]
        normalized.append([_bonus_match_normalize_cell(value) for value in values])
        while len(normalized[-1]) < BONUS_MATCH_COLS:
            normalized[-1].append(_bonus_match_new_cell(
                symbol=BONUS_MATCH_SYMBOLS[
                    (len(normalized) + len(normalized[-1])) % len(BONUS_MATCH_SYMBOLS)
                ]
            ))
    while len(normalized) < BONUS_MATCH_ROWS:
        normalized.append([
            _bonus_match_new_cell(
                symbol=BONUS_MATCH_SYMBOLS[
                    (len(normalized) * 2 + col * 3) % len(BONUS_MATCH_SYMBOLS)
                ]
            )
            for col in range(BONUS_MATCH_COLS)
        ])
    return normalized


def _bonus_match_clone_board(board) -> list[list[Optional[dict]]]:
    return [
        [dict(cell) if cell else None for cell in row]
        for row in _bonus_match_normalize_board(board)
    ]


def _bonus_match_cell_symbol(cell: Optional[dict]) -> Optional[str]:
    if not cell or _bonus_match_cell_void(cell) or cell.get("special") == "color_bomb":
        return None
    obstacle = cell.get("obstacle")
    if obstacle and obstacle not in BONUS_MATCH_OVERLAY_OBSTACLES:
        return None
    symbol = cell.get("symbol")
    return symbol if symbol in BONUS_MATCH_SYMBOLS else None


def _bonus_match_apply_obstacle(
    board: list[list[Optional[dict]]],
    row: int,
    col: int,
    obstacle: str,
    hits: Optional[int] = None,
) -> dict:
    """Place a blocking obstacle or wrap the existing symbol in an overlay."""
    if _bonus_match_cell_void(board[row][col]):
        return board[row][col]
    if obstacle in BONUS_MATCH_OVERLAY_OBSTACLES:
        current = _bonus_match_normalize_cell(board[row][col])
        if not current or not _bonus_match_cell_symbol(current):
            current = _bonus_match_new_cell(symbol=BONUS_MATCH_SYMBOLS[(row * 3 + col * 5) % len(BONUS_MATCH_SYMBOLS)])
        current["special"] = None
        current["obstacle"] = obstacle
        current["obstacle_hits"] = max(1, int(hits or BONUS_MATCH_OBSTACLE_HITS[obstacle]))
        current["obstacle_age"] = 0
        board[row][col] = current
        return current
    cell = _bonus_match_new_cell(
        obstacle=obstacle,
        obstacle_hits=hits,
        obstacle_age=0,
    )
    board[row][col] = cell
    return cell


def _bonus_match_cell_swappable(cell: Optional[dict]) -> bool:
    return bool(
        cell
        and not _bonus_match_cell_void(cell)
        and not cell.get("obstacle")
        and (cell.get("symbol") or cell.get("special"))
    )


def _bonus_match_level_config(level: int) -> dict:
    """Return an authored, beatable level config for the first 150 levels.

    Every built-in level has a deliberate obstacle pattern. Levels above 150
    retain the procedural curve so the admin can extend the catalog safely.
    """
    level = max(1, min(BONUS_MATCH_LEVEL_LIMIT, int(level or 1)))
    authored = BONUS_MATCH_AUTHORED_LEVELS.get(level)
    if authored:
        board_shape = _bonus_match_normalize_board_shape(authored.get("board_shape"), level)
        target_score = max(100, int(authored.get("target_score", 1000)))
        thresholds = [max(target_score, int(value)) for value in authored.get("star_thresholds", [])[:3]]
        while len(thresholds) < 3:
            thresholds.append([target_score, int(target_score * 1.28), int(target_score * 1.58)][len(thresholds)])
        layout = _bonus_match_normalize_obstacle_layout(authored.get("obstacle_layout"))
        obstacles = list(dict.fromkeys(
            item["obstacle"] for item in layout if item.get("obstacle") in BONUS_MATCH_OBSTACLE_HITS
        ))
        return {
            "level": level,
            "title": str(authored.get("title") or f"Рівень {level}"),
            "campaign": BONUS_MATCH_CAMPAIGN,
            "chapter_title": authored.get("chapter_title", "Кімната Пікселя"),
            "objective": authored.get("objective"),
            "board_shape": board_shape,
            "board_mask": _bonus_match_board_mask(board_shape),
            "moves": max(5, min(80, int(authored.get("moves", 28)))),
            "target_score": target_score,
            "target_coins": max(0, min(5000, int(authored.get("target_coins", 10)))),
            "star_thresholds": sorted(thresholds),
            "is_milestone": bool(authored.get("is_milestone", level % 5 == 0)),
            "is_boss": bool(authored.get("is_boss", level in BONUS_MATCH_BOSS_LEVELS)),
            "reward_multiplier": max(1, min(10, int(authored.get("reward_multiplier", BONUS_MATCH_BOSS_LEVELS.get(level, 1))))),
            "challenge_title": "РІВЕНЬ-ВИКЛИК!" if authored.get("is_milestone", level % 5 == 0) else None,
            "boss_title": "БОС-РІВЕНЬ" if authored.get("is_boss", level in BONUS_MATCH_BOSS_LEVELS) else None,
            "obstacles": obstacles,
            "new_obstacle": authored.get("new_obstacle") if authored.get("new_obstacle") in BONUS_MATCH_OBSTACLE_HITS else None,
            "obstacle_count": len(layout),
            "obstacle_layout": layout,
            "active": bool(authored.get("active", True)),
            "custom": False,
            "design_note": str(authored.get("design_note") or authored.get("title") or ""),
        }

    # Safe procedural fallback for optional levels 151-200.
    milestone = level % 5 == 0
    stage = min(len(BONUS_MATCH_OBSTACLE_ORDER), level // 5)
    boss_multiplier = BONUS_MATCH_BOSS_LEVELS.get(level, 1)
    target_score = int((900 + level * 260) * (1 + ((level - 1) // 5) * 0.10))
    moves = max(18, 30 - ((level - 1) // 10))
    target_coins = 8 + ((level + 1) // 3)
    unlocked_obstacles = BONUS_MATCH_OBSTACLE_ORDER[:stage]
    return {
        "level": level, "title": f"Рівень {level}",
        "board_shape": _bonus_match_default_board_shape(level),
        "board_mask": _bonus_match_board_mask(_bonus_match_default_board_shape(level)),
        "moves": moves, "target_score": target_score, "target_coins": target_coins,
        "star_thresholds": [target_score, int(target_score * 1.35), int(target_score * 1.72)],
        "is_milestone": milestone, "is_boss": boss_multiplier > 1,
        "reward_multiplier": boss_multiplier,
        "challenge_title": "РІВЕНЬ-ВИКЛИК!" if milestone else None,
        "boss_title": "БОС-РІВЕНЬ" if boss_multiplier > 1 else None,
        "obstacles": unlocked_obstacles,
        "new_obstacle": unlocked_obstacles[-1] if milestone and unlocked_obstacles else None,
        "obstacle_count": min(10, 2 + stage), "obstacle_layout": [],
        "active": True, "custom": False,
    }


def _bonus_match_objective_met(board, config, score: int, coins: int) -> bool:
    """Pixel levels clear a named obstacle; score only determines their stars."""
    objective = config.get("objective") or {}
    if objective.get("kind") == "clear_obstacles":
        return not any(cell and cell.get("obstacle") == objective.get("obstacle")
                       for row in board for cell in row)
    return score >= int(config["target_score"]) and coins >= int(config["target_coins"])


def _bonus_match_normalize_obstacle_layout(layout) -> list[dict]:
    normalized: list[dict] = []
    used: set[tuple[int, int]] = set()
    for item in list(layout or []):
        if not isinstance(item, dict):
            continue
        try:
            row = int(item.get("row"))
            col = int(item.get("col"))
        except (TypeError, ValueError):
            continue
        obstacle = str(item.get("obstacle") or item.get("type") or "").strip()
        if (
            obstacle not in BONUS_MATCH_OBSTACLE_HITS
            or not (0 <= row < BONUS_MATCH_ROWS)
            or not (0 <= col < BONUS_MATCH_COLS)
            or (row, col) in used
        ):
            continue
        used.add((row, col))
        normalized.append({
            "row": row,
            "col": col,
            "obstacle": obstacle,
            "hits": max(1, min(9, int(item.get("hits") or BONUS_MATCH_OBSTACLE_HITS[obstacle]))),
        })
    return normalized[:35]


def _bonus_match_merge_level_doc(level: int, doc: Optional[dict]) -> dict:
    base = _bonus_match_level_config(level)
    if not doc:
        return base
    thresholds = [
        max(1, int(value))
        for value in list(doc.get("star_thresholds") or [])[:3]
        if str(value).strip()
    ]
    target_score = max(100, int(doc.get("target_score", base["target_score"])))
    while len(thresholds) < 3:
        fallback = [target_score, int(target_score * 1.35), int(target_score * 1.72)]
        thresholds.append(fallback[len(thresholds)])
    thresholds = sorted([max(target_score, value) for value in thresholds])
    obstacles = [
        value for value in list(doc.get("obstacles") or [])
        if value in BONUS_MATCH_OBSTACLE_HITS
    ]
    new_obstacle = doc.get("new_obstacle")
    if new_obstacle not in BONUS_MATCH_OBSTACLE_HITS:
        new_obstacle = None
    is_boss = bool(doc.get("is_boss", base["is_boss"]))
    is_milestone = bool(doc.get("is_milestone", base["is_milestone"]))
    reward_multiplier = max(1, min(10, int(doc.get("reward_multiplier", base["reward_multiplier"]))))
    board_shape = _bonus_match_normalize_board_shape(doc.get("board_shape"), level)
    return {
        **base,
        "title": str(doc.get("title") or base["title"]).strip()[:80],
        "objective": doc.get("objective", base.get("objective")),
        "board_shape": board_shape,
        "board_mask": _bonus_match_board_mask(board_shape),
        "moves": max(5, min(80, int(doc.get("moves", base["moves"])))),
        "target_score": target_score,
        "target_coins": max(0, min(5000, int(doc.get("target_coins", base["target_coins"])))),
        "star_thresholds": thresholds,
        "is_milestone": is_milestone,
        "is_boss": is_boss,
        "reward_multiplier": reward_multiplier,
        "challenge_title": "РІВЕНЬ-ВИКЛИК!" if is_milestone else None,
        "boss_title": "БОС-РІВЕНЬ" if is_boss else None,
        "obstacles": list(dict.fromkeys(obstacles)),
        "new_obstacle": new_obstacle,
        "obstacle_count": max(0, min(35, int(doc.get("obstacle_count", base["obstacle_count"])))),
        "obstacle_layout": _bonus_match_normalize_obstacle_layout(doc.get("obstacle_layout")),
        "active": bool(doc.get("active", True)),
        "custom": True,
    }


async def _bonus_match_level_catalog(include_inactive: bool = False) -> list[dict]:
    docs = await db.bonus_match_levels.find({}, {"_id": 0}).sort("level", 1).to_list(BONUS_MATCH_LEVEL_LIMIT)
    docs_by_level = {int(doc.get("level", 0)): doc for doc in docs if 1 <= int(doc.get("level", 0)) <= BONUS_MATCH_LEVEL_LIMIT}
    levels = set(range(1, BONUS_MATCH_DEFAULT_LEVEL_COUNT + 1)) | set(docs_by_level)
    result: list[dict] = []
    for level in sorted(levels):
        config = _bonus_match_merge_level_doc(level, docs_by_level.get(level))
        if include_inactive or config.get("active", True):
            result.append(config)
    return result


async def _bonus_match_get_level_config(level: int, include_inactive: bool = False) -> Optional[dict]:
    level = max(1, min(BONUS_MATCH_LEVEL_LIMIT, int(level or 1)))
    doc = await db.bonus_match_levels.find_one({"level": level}, {"_id": 0})
    if level > BONUS_MATCH_DEFAULT_LEVEL_COUNT and not doc:
        return None
    config = _bonus_match_merge_level_doc(level, doc)
    if not include_inactive and not config.get("active", True):
        return None
    return config


async def _bonus_match_max_active_level() -> int:
    levels = await _bonus_match_level_catalog()
    return max((int(item["level"]) for item in levels), default=1)


async def _bonus_match_reconcile_unlocked_level(
    user_id: str,
    profile: dict,
    levels: list[dict],
    completed_levels: Optional[set[int]] = None,
) -> int:
    active_numbers = sorted({int(item["level"]) for item in levels})
    if not active_numbers:
        return 1
    stored = max(1, int(profile.get("current_level", 1)))
    if stored in active_numbers:
        unlocked = stored
    else:
        next_active = [number for number in active_numbers if number >= stored]
        unlocked = min(next_active) if next_active else max(active_numbers)

    if completed_levels is None:
        rows = await db.bonus_match_completions.find(
            {"user_id": user_id}, {"_id": 0, "level": 1}
        ).to_list(BONUS_MATCH_LEVEL_LIMIT)
        completed_levels = {int(item.get("level", 0)) for item in rows}

    while unlocked in completed_levels:
        next_levels = [number for number in active_numbers if number > unlocked]
        if not next_levels:
            break
        unlocked = min(next_levels)

    if unlocked > stored:
        await db.bonus_match_profiles.update_one(
            {"user_id": user_id},
            {"$max": {"current_level": unlocked}, "$set": {"updated_at": now_iso()}},
        )
        profile["current_level"] = unlocked
    return unlocked


def _bonus_match_find_runs(board: list[list[Optional[dict]]]) -> list[dict]:
    runs: list[dict] = []
    rows = len(board)
    cols = len(board[0]) if rows else 0

    for row in range(rows):
        start = 0
        while start < cols:
            symbol = _bonus_match_cell_symbol(board[row][start])
            end = start + 1
            while (
                end < cols
                and symbol is not None
                and _bonus_match_cell_symbol(board[row][end]) == symbol
            ):
                end += 1
            if symbol is not None and end - start >= 3:
                runs.append({
                    "symbol": symbol,
                    "orientation": "row",
                    "cells": {(row, col) for col in range(start, end)},
                })
            start = end

    for col in range(cols):
        start = 0
        while start < rows:
            symbol = _bonus_match_cell_symbol(board[start][col])
            end = start + 1
            while (
                end < rows
                and symbol is not None
                and _bonus_match_cell_symbol(board[end][col]) == symbol
            ):
                end += 1
            if symbol is not None and end - start >= 3:
                runs.append({
                    "symbol": symbol,
                    "orientation": "col",
                    "cells": {(row, col) for row in range(start, end)},
                })
            start = end
    return runs


def _bonus_match_find_match_groups(
    board: list[list[Optional[dict]]],
) -> list[dict]:
    runs = _bonus_match_find_runs(board)
    groups: list[dict] = []
    for run in runs:
        touching = [
            index
            for index, group in enumerate(groups)
            if group["symbol"] == run["symbol"]
            and group["cells"] & run["cells"]
        ]
        if not touching:
            groups.append({
                "symbol": run["symbol"],
                "cells": set(run["cells"]),
                "runs": [run],
            })
            continue
        first = touching[0]
        groups[first]["cells"].update(run["cells"])
        groups[first]["runs"].append(run)
        for index in reversed(touching[1:]):
            groups[first]["cells"].update(groups[index]["cells"])
            groups[first]["runs"].extend(groups[index]["runs"])
            groups.pop(index)
    return groups


def _bonus_match_find_matches(
    board: list[list[Optional[dict]]],
) -> set[tuple[int, int]]:
    matched: set[tuple[int, int]] = set()
    for group in _bonus_match_find_match_groups(board):
        matched.update(group["cells"])
    return matched


def _bonus_match_group_special(group: dict) -> Optional[str]:
    max_row = max(
        (len(run["cells"]) for run in group["runs"] if run["orientation"] == "row"),
        default=0,
    )
    max_col = max(
        (len(run["cells"]) for run in group["runs"] if run["orientation"] == "col"),
        default=0,
    )
    if max(max_row, max_col) >= 5:
        return "color_bomb"
    if max_row >= 3 and max_col >= 3:
        return "bomb"
    if max_row >= 4:
        return "rocket_row"
    if max_col >= 4:
        return "rocket_col"
    return None


def _bonus_match_pick_special_anchor(
    board,
    group: dict,
    preferred: list[tuple[int, int]],
) -> Optional[tuple[int, int]]:
    candidates = [
        coord
        for coord in group["cells"]
        if _bonus_match_cell_swappable(board[coord[0]][coord[1]])
        and not board[coord[0]][coord[1]].get("special")
    ]
    if not candidates:
        candidates = [
            coord
            for coord in group["cells"]
            if _bonus_match_cell_swappable(board[coord[0]][coord[1]])
        ]
    if not candidates:
        return None

    special = _bonus_match_group_special(group)
    if special == "bomb":
        row_cells = set().union(*(
            run["cells"]
            for run in group["runs"]
            if run["orientation"] == "row"
        ))
        col_cells = set().union(*(
            run["cells"]
            for run in group["runs"]
            if run["orientation"] == "col"
        ))
        intersections = list(row_cells & col_cells)
        for coord in preferred:
            if coord in intersections:
                return coord
        if intersections:
            return intersections[0]

    for coord in preferred:
        if coord in candidates:
            return coord
    return sorted(candidates)[len(candidates) // 2]


def _bonus_match_has_move(board: list[list[Optional[dict]]]) -> bool:
    board = _bonus_match_clone_board(board)
    rows = len(board)
    cols = len(board[0]) if rows else 0
    for row in range(rows):
        for col in range(cols):
            for dr, dc in ((0, 1), (1, 0)):
                next_row, next_col = row + dr, col + dc
                if next_row >= rows or next_col >= cols:
                    continue
                first, second = board[row][col], board[next_row][next_col]
                if (
                    not _bonus_match_cell_swappable(first)
                    or not _bonus_match_cell_swappable(second)
                ):
                    continue
                if first.get("special") or second.get("special"):
                    return True
                board[row][col], board[next_row][next_col] = second, first
                valid = bool(_bonus_match_find_match_groups(board))
                board[row][col], board[next_row][next_col] = first, second
                if valid:
                    return True
    return False


def _bonus_match_make_plain_board(board_shape: str = "full") -> list[list[Optional[dict]]]:
    import random as _random

    mask = _bonus_match_board_mask(board_shape)
    board: list[list[Optional[dict]]] = []
    for row in range(BONUS_MATCH_ROWS):
        board.append([])
        for col in range(BONUS_MATCH_COLS):
            if not mask[row][col]:
                board[row].append(_bonus_match_new_cell(void=True, cell_id=f"void-{row}-{col}"))
                continue
            blocked: set[str] = set()
            if col >= 2:
                left = _bonus_match_cell_symbol(board[row][col - 1])
                if left and left == _bonus_match_cell_symbol(board[row][col - 2]):
                    blocked.add(left)
            if row >= 2:
                above = _bonus_match_cell_symbol(board[row - 1][col])
                if above and above == _bonus_match_cell_symbol(board[row - 2][col]):
                    blocked.add(above)
            choices = [symbol for symbol in BONUS_MATCH_SYMBOLS if symbol not in blocked]
            board[row].append(_bonus_match_new_cell(symbol=_random.choice(choices)))
    return board


def _bonus_match_make_board(
    level: int = 1,
    config: Optional[dict] = None,
) -> list[list[Optional[dict]]]:
    import random as _random

    config = config or _bonus_match_level_config(level)
    board_shape = _bonus_match_normalize_board_shape(config.get("board_shape"), level)
    manual_layout = _bonus_match_normalize_obstacle_layout(
        config.get("obstacle_layout")
    )
    last_board = None
    for _ in range(180):
        board = _bonus_match_make_plain_board(board_shape)
        last_board = board
        if manual_layout:
            for item in manual_layout:
                _bonus_match_apply_obstacle(
                    board,
                    item["row"],
                    item["col"],
                    item["obstacle"],
                    item["hits"],
                )
        else:
            obstacle_types = [
                item for item in list(config.get("obstacles") or [])
                if item in BONUS_MATCH_OBSTACLE_HITS
            ]
            obstacle_count = max(0, min(35, int(config.get("obstacle_count", 0))))
            if obstacle_types and obstacle_count:
                positions = [
                    (row, col)
                    for row in range(BONUS_MATCH_ROWS)
                    for col in range(BONUS_MATCH_COLS)
                    if not _bonus_match_cell_void(board[row][col])
                ]
                _random.shuffle(positions)
                newest = config.get("new_obstacle")
                for index, (row, col) in enumerate(positions[:obstacle_count]):
                    if newest in BONUS_MATCH_OBSTACLE_HITS and index < max(2, obstacle_count // 3):
                        obstacle = newest
                    else:
                        obstacle = _random.choice(obstacle_types)
                    _bonus_match_apply_obstacle(board, row, col, obstacle)
        if not _bonus_match_find_matches(board) and _bonus_match_has_move(board):
            return board
    return last_board if manual_layout and last_board else _bonus_match_make_plain_board(board_shape)


def _bonus_match_shuffle_board(
    board: list[list[Optional[dict]]],
) -> list[list[Optional[dict]]]:
    import random as _random

    source = _bonus_match_clone_board(board)
    positions = [
        (row, col)
        for row in range(BONUS_MATCH_ROWS)
        for col in range(BONUS_MATCH_COLS)
        if _bonus_match_cell_swappable(source[row][col])
    ]
    pieces = [source[row][col] for row, col in positions]
    for _ in range(160):
        shuffled = pieces[:]
        _random.shuffle(shuffled)
        candidate = _bonus_match_clone_board(source)
        for (row, col), cell in zip(positions, shuffled):
            candidate[row][col] = cell
        if not _bonus_match_find_matches(candidate) and _bonus_match_has_move(candidate):
            return candidate
    return source


def _bonus_match_ensure_playable_board(
    board: list[list[Optional[dict]]],
    level: int,
    config: Optional[dict] = None,
) -> tuple[list[list[Optional[dict]]], bool, str]:
    """Return a board with at least one legal move.

    First we reshuffle the existing movable pieces so their stable ids,
    specials and the obstacle layout are preserved. Only if no playable
    arrangement can be found do we regenerate the board as a safe fallback.
    """
    source = _bonus_match_clone_board(board)
    if _bonus_match_has_move(source):
        return source, False, "none"

    shuffled = _bonus_match_shuffle_board(source)
    if (
        _bonus_match_has_move(shuffled)
        and not _bonus_match_find_matches(shuffled)
    ):
        return shuffled, True, "shuffle"

    remaining_config = {**(config or _bonus_match_level_config(level)), "obstacle_layout": [
        {"row": r, "col": c, "obstacle": cell["obstacle"], "hits": cell["obstacle_hits"]}
        for r, row in enumerate(source) for c, cell in enumerate(row)
        if cell and cell.get("obstacle")
    ]}
    remaining_config["obstacle_count"] = len(remaining_config["obstacle_layout"])
    regenerated = _bonus_match_make_board(level, remaining_config)
    return regenerated, True, "regenerate"


def _bonus_match_collapse(
    board: list[list[Optional[dict]]],
) -> tuple[list[list[Optional[dict]]], list[dict]]:
    import random as _random

    board = _bonus_match_clone_board(board)
    rows = len(board)
    cols = len(board[0]) if rows else 0
    spawned: list[dict] = []

    for col in range(cols):
        fixed_rows = [
            row
            for row in range(rows)
            if board[row][col]
            and (board[row][col].get("obstacle") or _bonus_match_cell_void(board[row][col]))
        ]
        boundaries = [-1] + fixed_rows + [rows]
        for boundary_index in range(len(boundaries) - 1):
            start = boundaries[boundary_index] + 1
            end = boundaries[boundary_index + 1] - 1
            if start > end:
                continue
            values = [
                board[row][col]
                for row in range(start, end + 1)
                if board[row][col] is not None and not _bonus_match_cell_void(board[row][col])
            ]
            write_row = end
            for cell in reversed(values):
                board[write_row][col] = cell
                write_row -= 1
            while write_row >= start:
                fresh = _bonus_match_new_cell(
                    symbol=_random.choice(BONUS_MATCH_SYMBOLS)
                )
                board[write_row][col] = fresh
                spawned.append({
                    "row": write_row,
                    "col": col,
                    "id": fresh["id"],
                })
                write_row -= 1
    return board, spawned



def _bonus_match_animation_frames(
    swapped_board: list[list[Optional[dict]]],
    steps: list[dict],
    final_board: list[list[Optional[dict]]],
    reshuffled: bool = False,
    obstacle_events: Optional[list[dict]] = None,
    obstacle_board: Optional[list[list[Optional[dict]]]] = None,
) -> list[dict]:
    """Build semantic animation events from the authoritative server state.

    The frontend never recomputes cascades. It receives stable piece ids and
    replays swap -> match/clear metadata -> collapse on its own local timeline.
    Server responses intentionally do not prescribe visual durations.
    """
    frames: list[dict] = [{
        "phase": "swap",
        "board": _bonus_match_clone_board(swapped_board),
    }]

    for step in steps:
        before = _bonus_match_clone_board(step.get("board_before_clear") or [])
        cleared_ids: list[str] = []
        for item in step.get("cleared_cells", []):
            row = int(item.get("row", -1))
            col = int(item.get("col", -1))
            if 0 <= row < BONUS_MATCH_ROWS and 0 <= col < BONUS_MATCH_COLS:
                cell = before[row][col]
                if cell and cell.get("id"):
                    cleared_ids.append(str(cell["id"]))

        frames.append({
            "phase": "match",
            "combo": int(step.get("combo", 1)),
            "score_gain": int(step.get("score_gain", 0)),
            "coins_gain": int(step.get("coins_gain", 0)),
            "board": before,
            "matched_cells": step.get("matched_cells", []),
            "cleared_cells": step.get("cleared_cells", []),
            "cleared_ids": cleared_ids,
            "created_specials": step.get("created_specials", []),
            "activated_specials": step.get("activated_specials", []),
            "obstacle_changes": step.get("obstacle_changes", []),
            "obstacle_events": step.get("obstacle_events", []),
        })
        frames.append({
            "phase": "collapse",
            "combo": int(step.get("combo", 1)),
            "board": _bonus_match_clone_board(
                step.get("board_after_collapse") or []
            ),
            "spawned": step.get("spawned", []),
            "spawned_ids": [
                str(item.get("id"))
                for item in step.get("spawned", [])
                if item.get("id")
            ],
        })

    if obstacle_events:
        frames.append({
            "phase": "obstacle",
            "board": _bonus_match_clone_board(obstacle_board or final_board),
            "events": obstacle_events,
        })

    if reshuffled:
        frames.append({
            "phase": "reshuffle",
            "board": _bonus_match_clone_board(final_board),
        })

    return frames

def _bonus_match_special_targets(
    board,
    row: int,
    col: int,
    special: str,
    color_symbol: Optional[str] = None,
) -> set[tuple[int, int]]:
    rows = len(board)
    cols = len(board[0]) if rows else 0
    if special == "rocket_row":
        return {(row, current_col) for current_col in range(cols) if not _bonus_match_cell_void(board[row][current_col])}
    if special == "rocket_col":
        return {(current_row, col) for current_row in range(rows) if not _bonus_match_cell_void(board[current_row][col])}
    if special == "bomb":
        return {
            (current_row, current_col)
            for current_row in range(
                max(0, row - 1),
                min(rows, row + 2),
            )
            for current_col in range(
                max(0, col - 1),
                min(cols, col + 2),
            )
            if not _bonus_match_cell_void(board[current_row][current_col])
        }
    if special == "color_bomb":
        target = color_symbol
        if not target:
            counts = {symbol: 0 for symbol in BONUS_MATCH_SYMBOLS}
            for board_row in board:
                for cell in board_row:
                    symbol = _bonus_match_cell_symbol(cell)
                    if symbol:
                        counts[symbol] += 1
            target = max(counts, key=counts.get)
        return {
            (current_row, current_col)
            for current_row, board_row in enumerate(board)
            for current_col, cell in enumerate(board_row)
            if _bonus_match_cell_symbol(cell) == target
        } | {(row, col)}
    return {(row, col)}


def _bonus_match_expand_specials(
    board,
    clear_cells: set[tuple[int, int]],
    initial_triggers: set[tuple[int, int]],
    protected: set[tuple[int, int]],
    color_symbol: Optional[str] = None,
    already_seen: Optional[set[tuple[int, int]]] = None,
) -> tuple[set[tuple[int, int]], list[dict]]:
    rows = len(board)
    cols = len(board[0]) if rows else 0
    queue: list[tuple[int, int]] = list(initial_triggers)

    for row, col in list(clear_cells):
        for current_row, current_col in (
            (row, col),
            (row - 1, col),
            (row + 1, col),
            (row, col - 1),
            (row, col + 1),
        ):
            if (
                0 <= current_row < rows
                and 0 <= current_col < cols
                and (current_row, current_col) not in protected
            ):
                cell = board[current_row][current_col]
                if cell and cell.get("special"):
                    queue.append((current_row, current_col))

    activated: list[dict] = []
    seen: set[tuple[int, int]] = set(already_seen or set())
    while queue:
        row, col = queue.pop(0)
        if (row, col) in seen or (row, col) in protected:
            continue
        cell = board[row][col]
        special = cell.get("special") if cell else None
        if special not in BONUS_MATCH_SPECIALS:
            continue
        seen.add((row, col))
        targets = _bonus_match_special_targets(
            board,
            row,
            col,
            special,
            color_symbol,
        )
        activated.append({
            "row": row,
            "col": col,
            "special": special,
            "targets": [
                {"row": target_row, "col": target_col}
                for target_row, target_col in sorted(targets)
            ],
        })
        for target in targets:
            if target not in protected:
                clear_cells.add(target)
            target_cell = board[target[0]][target[1]]
            if (
                target_cell
                and target_cell.get("special")
                and target not in seen
                and target not in protected
            ):
                queue.append(target)
    return clear_cells, activated


def _bonus_match_nearby_cells(
    row: int,
    col: int,
    include_self: bool = True,
) -> set[tuple[int, int]]:
    cells = {
        (row - 1, col),
        (row + 1, col),
        (row, col - 1),
        (row, col + 1),
    }
    if include_self:
        cells.add((row, col))
    return {
        (current_row, current_col)
        for current_row, current_col in cells
        if 0 <= current_row < BONUS_MATCH_ROWS
        and 0 <= current_col < BONUS_MATCH_COLS
    }


def _bonus_match_special_impact_cells(activated_specials: list[dict]) -> set[tuple[int, int]]:
    targets: set[tuple[int, int]] = set()
    for item in activated_specials or []:
        for target in item.get("targets", []) or []:
            try:
                row = int(target.get("row"))
                col = int(target.get("col"))
            except (TypeError, ValueError, AttributeError):
                continue
            if 0 <= row < BONUS_MATCH_ROWS and 0 <= col < BONUS_MATCH_COLS:
                targets.add((row, col))
    return targets


def _bonus_match_strong_match_cells(groups: list[dict]) -> set[tuple[int, int]]:
    strong: set[tuple[int, int]] = set()
    for group in groups or []:
        for run in group.get("runs", []) or []:
            if len(run.get("cells", set())) >= 4:
                strong.update(run["cells"])
    return strong


def _bonus_match_resolve_obstacles(
    board: list[list[Optional[dict]]],
    clear_cells: set[tuple[int, int]],
    matched_cells: Optional[set[tuple[int, int]]] = None,
    special_targets: Optional[set[tuple[int, int]]] = None,
    strong_match_cells: Optional[set[tuple[int, int]]] = None,
    booster: Optional[str] = None,
    already_damaged: Optional[set[tuple[int, int]]] = None,
) -> dict:
    """Apply the distinct mechanics of all ten Bonus Match obstacles.

    The helper mutates ``board`` and extends ``clear_cells`` with crystal/core
    blast targets. One obstacle can lose health only once per cascade step,
    even when several effects overlap it.
    """
    import random as _random

    clear_cells = set(clear_cells or set())
    matched_cells = set(matched_cells or set())
    special_targets = set(special_targets or set())
    strong_match_cells = set(strong_match_cells or set())
    damaged = already_damaged if already_damaged is not None else set()
    protected_clear: set[tuple[int, int]] = set()
    changes: list[dict] = []
    events: list[dict] = []
    created_cells: list[dict] = []
    score_gain = 0

    for _ in range(6):
        blast_targets: set[tuple[int, int]] = set()
        did_damage = False
        for row in range(BONUS_MATCH_ROWS):
            for col in range(BONUS_MATCH_COLS):
                coord = (row, col)
                cell = board[row][col]
                obstacle = cell.get("obstacle") if cell else None
                if obstacle not in BONUS_MATCH_OBSTACLE_HITS or coord in damaged:
                    continue

                nearby = _bonus_match_nearby_cells(row, col, include_self=False)
                direct_clear = coord in clear_cells
                adjacent_clear = bool(nearby & clear_cells)
                direct_match = coord in matched_cells
                direct_special = coord in special_targets
                special_hit = direct_special or bool(nearby & special_targets)
                strong_hit = coord in strong_match_cells or bool(nearby & strong_match_cells)
                if booster == "hammer":
                    booster_hit = direct_clear
                else:
                    booster_hit = bool(booster) and (direct_clear or adjacent_clear)

                damage = 0
                if obstacle == "ice":
                    damage = 1 if direct_clear or adjacent_clear else 0
                elif obstacle in {"chain", "web"}:
                    damage = 1 if direct_match or direct_special or (booster == "hammer" and direct_clear) else 0
                elif obstacle in {"crate", "stone", "crystal", "slime"}:
                    damage = 1 if direct_clear or adjacent_clear else 0
                elif obstacle == "shield":
                    if direct_clear or adjacent_clear:
                        damage = 2 if special_hit or booster_hit else 1
                elif obstacle == "metal":
                    damage = 1 if special_hit or booster_hit else 0
                elif obstacle == "core":
                    damage = 1 if special_hit or booster_hit or strong_hit else 0

                # An overlay can be part of a match, but its held piece remains
                # until the chain/web layer has actually been removed.
                if obstacle in BONUS_MATCH_OVERLAY_OBSTACLES and direct_clear and not damage:
                    protected_clear.add(coord)
                if damage <= 0:
                    continue

                did_damage = True
                damaged.add(coord)
                previous = max(1, int(cell.get("obstacle_hits", 1) or 1))
                if booster == "hammer" and direct_clear:
                    damage = previous
                remaining = max(0, previous - damage)
                destroyed = remaining <= 0
                cell["obstacle_age"] = 0

                change = {
                    "row": row,
                    "col": col,
                    "obstacle": obstacle,
                    "before": previous,
                    "after": remaining,
                    "damage": min(previous, damage),
                    "destroyed": destroyed,
                    "effect": None,
                    "score_gain": 0,
                }

                reward = BONUS_MATCH_OBSTACLE_SCORE.get(obstacle, {"hit": 70, "destroy": 180})
                obstacle_score = int(reward["destroy"] if destroyed else reward["hit"])

                if destroyed:
                    if obstacle in BONUS_MATCH_OVERLAY_OBSTACLES:
                        cell["obstacle"] = None
                        cell["obstacle_hits"] = 0
                        cell["obstacle_age"] = 0
                        if booster == "hammer":
                            protected_clear.add(coord)
                    elif obstacle == "crate":
                        replacement_symbol = "coin" if _random.random() < 0.55 else _random.choice(BONUS_MATCH_SYMBOLS)
                        replacement = _bonus_match_new_cell(symbol=replacement_symbol)
                        board[row][col] = replacement
                        protected_clear.add(coord)
                        change["replacement_symbol"] = replacement_symbol
                        change["replacement_id"] = replacement["id"]
                        change["effect"] = "crate_reward"
                        created_cells.append({"row": row, "col": col, "id": replacement["id"]})
                    else:
                        board[row][col] = None

                    if obstacle == "crystal":
                        targets = _bonus_match_nearby_cells(row, col, include_self=False)
                        blast_targets.update(targets)
                        change["effect"] = "crystal_burst"
                        change["targets"] = [
                            {"row": target_row, "col": target_col}
                            for target_row, target_col in sorted(targets)
                        ]
                        events.append({
                            "effect": "crystal_burst",
                            "row": row,
                            "col": col,
                            "targets": change["targets"],
                        })
                    elif obstacle == "core":
                        targets = {
                            (target_row, target_col)
                            for target_row in range(max(0, row - 1), min(BONUS_MATCH_ROWS, row + 2))
                            for target_col in range(max(0, col - 1), min(BONUS_MATCH_COLS, col + 2))
                            if (target_row, target_col) != coord
                        }
                        blast_targets.update(targets)
                        change["effect"] = "core_blast"
                        change["targets"] = [
                            {"row": target_row, "col": target_col}
                            for target_row, target_col in sorted(targets)
                        ]
                        events.append({
                            "effect": "core_blast",
                            "row": row,
                            "col": col,
                            "targets": change["targets"],
                        })
                else:
                    cell["obstacle_hits"] = remaining
                    if obstacle in BONUS_MATCH_OVERLAY_OBSTACLES:
                        protected_clear.add(coord)
                    if obstacle == "core":
                        change["effect"] = "core_pulse"
                        events.append({
                            "effect": "core_pulse",
                            "row": row,
                            "col": col,
                            "targets": [
                                {"row": target_row, "col": target_col}
                                for target_row, target_col in sorted(_bonus_match_nearby_cells(row, col))
                            ],
                        })

                change["score_gain"] = obstacle_score
                score_gain += obstacle_score
                changes.append(change)

        if blast_targets:
            new_targets = blast_targets - clear_cells
            clear_cells.update(blast_targets)
            special_targets.update(blast_targets)
            if new_targets:
                continue
        if not did_damage:
            break
        # No new blast means this damage pass is complete.
        break

    return {
        "clear_cells": clear_cells,
        "protected_clear": protected_clear,
        "changes": changes,
        "events": events,
        "created_cells": created_cells,
        "score_gain": score_gain,
        "damaged_coords": damaged,
    }


def _bonus_match_damage_obstacles(
    board,
    impact_cells: set[tuple[int, int]],
) -> list[dict]:
    """Backward-compatible generic obstacle damage used by older tests."""
    result = _bonus_match_resolve_obstacles(
        board,
        set(impact_cells),
        matched_cells=set(impact_cells),
    )
    return result["changes"]


def _bonus_match_advance_obstacles(
    board: list[list[Optional[dict]]],
    damage_changes: list[dict],
) -> tuple[list[list[Optional[dict]]], list[dict]]:
    """Advance web/slime behaviour after one consumed player move."""
    import random as _random

    board = _bonus_match_clone_board(board)
    damaged_coords = {
        (int(item.get("row", -1)), int(item.get("col", -1)))
        for item in damage_changes or []
    }
    damaged_types = {str(item.get("obstacle")) for item in damage_changes or []}
    events: list[dict] = []

    # Webs remember quiet turns independently. If at least one web was
    # destroyed during this player move, web growth is skipped for the entire
    # turn. This makes clearing a web a reliable way to stop propagation.
    web_destroyed = any(
        str(item.get("obstacle")) == "web" and bool(item.get("destroyed"))
        for item in damage_changes or []
    )
    if not web_destroyed:
        ready_webs: list[tuple[int, int]] = []
        for row in range(BONUS_MATCH_ROWS):
            for col in range(BONUS_MATCH_COLS):
                cell = board[row][col]
                if not cell or cell.get("obstacle") != "web":
                    continue
                if (row, col) in damaged_coords:
                    cell["obstacle_age"] = 0
                else:
                    cell["obstacle_age"] = int(cell.get("obstacle_age", 0) or 0) + 1
                if cell["obstacle_age"] >= 2:
                    ready_webs.append((row, col))

        _random.shuffle(ready_webs)
        for row, col in ready_webs:
            candidates = []
            for target_row, target_col in _bonus_match_nearby_cells(row, col, include_self=False):
                target = board[target_row][target_col]
                if target and not target.get("obstacle") and not target.get("special") and _bonus_match_cell_symbol(target):
                    candidates.append((target_row, target_col))
            if not candidates:
                continue
            target_row, target_col = _random.choice(candidates)
            target = _bonus_match_apply_obstacle(board, target_row, target_col, "web")
            board[row][col]["obstacle_age"] = 0
            events.append({
                "effect": "web_spread",
                "row": row,
                "col": col,
                "to_row": target_row,
                "to_col": target_col,
                "id": target.get("id"),
            })
            break

    # Slime grows once per untouched move. It consumes a neighbouring ordinary
    # piece and becomes a new two-hit blocking cell.
    if "slime" not in damaged_types:
        slime_sources = [
            (row, col)
            for row in range(BONUS_MATCH_ROWS)
            for col in range(BONUS_MATCH_COLS)
            if board[row][col] and board[row][col].get("obstacle") == "slime"
        ]
        _random.shuffle(slime_sources)
        for row, col in slime_sources:
            candidates = []
            for target_row, target_col in _bonus_match_nearby_cells(row, col, include_self=False):
                target = board[target_row][target_col]
                if target and not target.get("obstacle") and not target.get("special") and _bonus_match_cell_symbol(target):
                    candidates.append((target_row, target_col, target.get("id")))
            if not candidates:
                continue
            target_row, target_col, removed_id = _random.choice(candidates)
            slime = _bonus_match_apply_obstacle(board, target_row, target_col, "slime")
            events.append({
                "effect": "slime_spread",
                "row": row,
                "col": col,
                "to_row": target_row,
                "to_col": target_col,
                "removed_id": removed_id,
                "id": slime.get("id"),
            })
            break

    return board, events


def _bonus_match_parse_iso(value: Optional[str]) -> datetime:
    if not value:
        return datetime.now(timezone.utc)
    try:
        parsed = datetime.fromisoformat(
            str(value).replace("Z", "+00:00")
        )
        return (
            parsed
            if parsed.tzinfo
            else parsed.replace(tzinfo=timezone.utc)
        )
    except (ValueError, TypeError):
        return datetime.now(timezone.utc)


async def _bonus_match_profile(user_id: str) -> dict:
    now = datetime.now(timezone.utc)
    profile = await db.bonus_match_profiles.find_one(
        {"user_id": user_id},
        {"_id": 0},
    )
    if not profile:
        profile = {
            "user_id": user_id,
            "current_level": 1,
            "total_stars": 0,
            "lives": BONUS_MATCH_MAX_LIVES,
            "boosters": {key: 0 for key in BONUS_MATCH_BOOSTERS},
            "campaign": BONUS_MATCH_CAMPAIGN,
            "lives_updated_at": now.isoformat(),
            "created_at": now.isoformat(),
            "updated_at": now.isoformat(),
        }
        try:
            await db.bonus_match_profiles.insert_one(profile.copy())
        except Exception:
            profile = await db.bonus_match_profiles.find_one(
                {"user_id": user_id},
                {"_id": 0},
            ) or profile

    lives = max(
        0,
        min(
            BONUS_MATCH_MAX_LIVES,
            int(profile.get("lives", BONUS_MATCH_MAX_LIVES)),
        ),
    )
    anchor = _bonus_match_parse_iso(profile.get("lives_updated_at"))
    if lives < BONUS_MATCH_MAX_LIVES:
        elapsed_seconds = max(
            0,
            (now - anchor).total_seconds(),
        )
        gained = int(
            elapsed_seconds
            // (BONUS_MATCH_LIFE_REGEN_MINUTES * 60)
        )
        if gained > 0:
            lives = min(BONUS_MATCH_MAX_LIVES, lives + gained)
            if lives >= BONUS_MATCH_MAX_LIVES:
                anchor = now
            else:
                anchor = anchor + timedelta(
                    minutes=(
                        BONUS_MATCH_LIFE_REGEN_MINUTES * gained
                    )
                )
            await db.bonus_match_profiles.update_one(
                {"user_id": user_id},
                {"$set": {
                    "lives": lives,
                    "lives_updated_at": anchor.isoformat(),
                    "updated_at": now.isoformat(),
                }},
            )
            profile["lives"] = lives
            profile["lives_updated_at"] = anchor.isoformat()

    profile.setdefault("current_level", 1)
    profile.setdefault("total_stars", 0)
    stored_boosters = profile.get("boosters") if isinstance(profile.get("boosters"), dict) else {}
    profile["boosters"] = {
        key: max(0, int(stored_boosters.get(key, 0) or 0))
        for key in BONUS_MATCH_BOOSTERS
    }
    profile["lives"] = lives
    profile["next_life_at"] = (
        None
        if lives >= BONUS_MATCH_MAX_LIVES
        else (
            anchor
            + timedelta(minutes=BONUS_MATCH_LIFE_REGEN_MINUTES)
        ).isoformat()
    )
    return profile


def _bonus_match_session_payload(session: dict) -> dict:
    board = _bonus_match_normalize_board(session["board"])
    level = int(session["level"])
    config = _bonus_match_config_with_board_shape(session.get("config"), level, board)
    return {
        "id": session["id"],
        "level": level,
        "board": board,
        "moves_left": int(session["moves_left"]),
        "score": int(session.get("score", 0)),
        "coins_collected": int(session.get("coins_collected", 0)),
        "status": session.get("status", "active"),
        "config": config,
        "cascades": int(session.get("cascades", 0)),
        "created_at": session.get("created_at"),
        "completed_at": session.get("completed_at"),
    }


async def _bonus_match_top_today(
    limit: int = 5,
) -> list[dict]:
    start_iso, end_iso = kyiv_day_bounds_utc(
        kyiv_today_key()
    )
    rows = await db.bonus_match_sessions.aggregate([
        {"$match": {
            "status": "won",
            "completed_at": {
                "$gte": start_iso,
                "$lt": end_iso,
            },
        }},
        {"$group": {
            "_id": "$user_id",
            "score": {"$max": "$score"},
            "level": {"$max": "$level"},
        }},
        {"$sort": {"score": -1, "level": -1}},
        {"$limit": limit},
    ]).to_list(limit)
    if not rows:
        return []

    users = await db.users.find(
        {"id": {"$in": [row["_id"] for row in rows]}},
        {
            "_id": 0,
            "id": 1,
            "name": 1,
            "avatar_initials": 1,
            "avatar_color": 1,
            "avatar_url": 1,
            "avatar_rarity": 1,
        },
    ).to_list(limit)
    user_map = {item["id"]: item for item in users}

    result = []
    for index, row in enumerate(rows, start=1):
        player = user_map.get(row["_id"], {})
        result.append({
            "rank": index,
            "user_id": row["_id"],
            "name": player.get("name", "Працівник"),
            "avatar_initials": player.get(
                "avatar_initials",
                "TM",
            ),
            "avatar_color": player.get(
                "avatar_color",
                "#7C3AED",
            ),
            "avatar_url": player.get("avatar_url"),
            "avatar_rarity": player.get(
                "avatar_rarity",
                "basic",
            ),
            "score": int(row.get("score", 0)),
            "level": int(row.get("level", 1)),
        })
    return result


async def _bonus_match_reward_win(
    user: dict,
    session: dict,
    stars: int,
) -> dict:
    """Award deterministic Bonus Match rewards.

    First clear of a level: +2 Point and +15 XP.
    Replays: +0 Point and at most +5 XP once per day.
    """
    level = int(session["level"])
    now = now_iso()
    existing = await db.bonus_match_completions.find_one(
        {"user_id": user["id"], "level": level},
        {"_id": 0},
    )
    previous_stars = int(existing.get("stars", 0)) if existing else 0
    first_completion = existing is None
    best_stars = max(previous_stars, stars)
    star_delta = max(0, best_stars - previous_stars)

    await db.bonus_match_completions.update_one(
        {"user_id": user["id"], "level": level},
        {
            "$set": {
                "stars": best_stars,
                "campaign": BONUS_MATCH_CAMPAIGN,
                "best_score": max(
                    int(existing.get("best_score", 0)) if existing else 0,
                    int(session.get("score", 0)),
                ),
                "updated_at": now,
            },
            "$setOnInsert": {
                "id": str(uuid.uuid4()),
                "user_id": user["id"],
                "level": level,
                "created_at": now,
            },
        },
        upsert=True,
    )

    profile = await _bonus_match_profile(user["id"])
    catalog = await _bonus_match_level_catalog()
    active_numbers = [int(item["level"]) for item in catalog]
    next_levels = [number for number in active_numbers if number > level]
    unlocked_level = min(next_levels) if next_levels else level
    refunded_lives = min(BONUS_MATCH_MAX_LIVES, int(profile.get("lives", 0)) + 1)
    profile_updates: dict = {
        "$max": {"current_level": unlocked_level},
        "$set": {"lives": refunded_lives, "updated_at": now},
    }
    if refunded_lives >= BONUS_MATCH_MAX_LIVES:
        profile_updates["$set"]["lives_updated_at"] = now
    if star_delta:
        profile_updates["$inc"] = {"total_stars": star_delta}
    await db.bonus_match_profiles.update_one({"user_id": user["id"]}, profile_updates)

    points_awarded = BONUS_MATCH_FIRST_CLEAR_POINTS if first_completion else 0
    date_key = kyiv_today_key()
    xp_event_key = f"bonus-match:{BONUS_MATCH_CAMPAIGN}:first:{level}" if first_completion else f"bonus-match:replay:{date_key}"
    xp_result = await _award_xp(
        user["id"],
        BONUS_MATCH_FIRST_CLEAR_XP if first_completion else BONUS_MATCH_REPLAY_XP,
        "bonus_match",
        xp_event_key,
        f"Bonus Match: {'перше проходження рівня ' + str(level) if first_completion else 'денна активність'}",
        {"level": level, "stars": stars, "first_completion": first_completion, "date": date_key},
    )
    xp_awarded = int(xp_result.get("amount", 0) or 0)

    # Daily rows remain useful for analytics, but they do not limit rewards.
    await db.bonus_match_daily.update_one(
        {"user_id": user["id"], "date": date_key},
        {
            "$inc": {
                "wins": 1,
                "points_awarded": points_awarded,
                "xp_awarded": xp_awarded,
            },
            "$set": {"updated_at": now},
            "$setOnInsert": {"created_at": now},
        },
        upsert=True,
    )

    await db.users.update_one(
        {"id": user["id"]},
        {"$inc": {
            "balance": points_awarded,
            "total_earned": points_awarded,
        }},
    )
    await db.transactions.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "kind": "bonus_match",
        "amount": points_awarded,
        "description": (
            f"Bonus Match: рівень {level}, {stars} зірки, "
            f"+{points_awarded} Point, +{xp_awarded} XP"
        ),
        "created_at": now,
        "meta": {
            "level": level,
            "stars": stars,
            "xp": xp_awarded,
            "first_completion": first_completion,
            "reward_policy": "v164_first_2_points_15_xp_replay_5_xp_daily_cap",
        },
    })
    if points_awarded:
        await _notify_points_awarded(user["id"], points_awarded, f"Bonus Match: перше проходження рівня {level}")
    if first_completion and unlocked_level > level:
        await _notify(user["id"], "game_level", "Відкрито новий рівень Bonus Match", f"Рівень {unlocked_level} уже доступний.", "/games/bonus-match", "gamepad-2", "games", {"game": "bonus_match", "level": unlocked_level})

    progression_user = await db.users.find_one({"id": user["id"]}, {"_id": 0}) or user
    await _sync_system_achievements(progression_user)
    fresh_user = await db.users.find_one({"id": user["id"]}, {"_id": 0}) or progression_user
    fresh_profile = await _bonus_match_profile(user["id"])
    return {
        "first_completion": first_completion,
        "stars": stars,
        "points_awarded": points_awarded,
        "xp_awarded": xp_awarded,
        "first_win_bonus": 0,
        "reward_multiplier": 1,
        "new_balance": int(fresh_user.get("balance", 0)) if fresh_user else int(user.get("balance", 0)),
        "total_xp": int(fresh_user.get("total_xp", 0)) if fresh_user else int(user.get("total_xp", 0)),
        "current_level": int(fresh_profile.get("current_level", level + 1)),
        "total_stars": int(fresh_profile.get("total_stars", 0)),
        "lives": int(fresh_profile.get("lives", BONUS_MATCH_MAX_LIVES)),
    }



def _bonus_match_admin_level_doc(level: int, body: BonusMatchLevelAdminBody) -> dict:
    payload = body.model_dump()
    target_score = max(100, int(payload.get("target_score") or 100))
    thresholds = [
        max(target_score, int(value))
        for value in list(payload.get("star_thresholds") or [])[:3]
        if str(value).strip()
    ]
    defaults = [target_score, int(target_score * 1.35), int(target_score * 1.72)]
    while len(thresholds) < 3:
        thresholds.append(defaults[len(thresholds)])
    thresholds = sorted(thresholds)
    obstacles = [
        value for value in list(payload.get("obstacles") or [])
        if value in BONUS_MATCH_OBSTACLE_HITS
    ]
    new_obstacle = payload.get("new_obstacle")
    if new_obstacle not in BONUS_MATCH_OBSTACLE_HITS:
        new_obstacle = None
    now = now_iso()
    return {
        "level": level,
        "title": str(payload.get("title") or f"Рівень {level}").strip()[:80],
        "campaign": BONUS_MATCH_CAMPAIGN,
        "objective": payload.get("objective"),
        "board_shape": _bonus_match_normalize_board_shape(payload.get("board_shape"), level),
        "moves": max(5, min(80, int(payload.get("moves") or 20))),
        "target_score": target_score,
        "target_coins": max(0, min(5000, int(payload.get("target_coins") or 0))),
        "star_thresholds": thresholds,
        "is_milestone": bool(payload.get("is_milestone")),
        "is_boss": bool(payload.get("is_boss")),
        "reward_multiplier": max(1, min(10, int(payload.get("reward_multiplier") or 1))),
        "obstacles": list(dict.fromkeys(obstacles)),
        "new_obstacle": new_obstacle,
        "obstacle_count": max(0, min(35, int(payload.get("obstacle_count") or 0))),
        "obstacle_layout": _bonus_match_normalize_obstacle_layout(payload.get("obstacle_layout")),
        "active": bool(payload.get("active", True)),
        "updated_at": now,
    }


@api.get("/admin/bonus-match/levels")
async def admin_bonus_match_levels(admin: dict = Depends(get_current_admin)):
    levels = await _bonus_match_level_catalog(include_inactive=True)
    return {
        "levels": levels,
        "default_level_count": BONUS_MATCH_DEFAULT_LEVEL_COUNT,
        "level_limit": BONUS_MATCH_LEVEL_LIMIT,
        "rows": BONUS_MATCH_ROWS,
        "cols": BONUS_MATCH_COLS,
        "board_shapes": [
            {"id": key, "mask": _bonus_match_board_mask(key), "label": {
                "full": "Повне 8×8",
                "rounded": "Зрізані кути",
                "diamond": "Діамант",
                "cross": "Хрест",
                "staircase": "Сходинки",
            }.get(key, key)}
            for key in BONUS_MATCH_BOARD_SHAPE_ORDER
        ],
        "obstacles": [
            {
                "id": key,
                "hits": hits,
                "label": {
                    "ice": "Крига", "chain": "Ланцюг", "crate": "Ящик",
                    "stone": "Камінь", "crystal": "Кристал", "web": "Павутина",
                    "shield": "Щит", "slime": "Слиз", "metal": "Метал", "core": "Ядро",
                }.get(key, key),
                "description": {
                    "ice": "2 удари збігами поруч або спецфішкою",
                    "chain": "Утримує фішку; фішка входить у збіги, але не рухається",
                    "crate": "2 удари; після руйнування відкриває нову фішку або монету",
                    "stone": "Нерухомий блок на 3 удари",
                    "crystal": "Після руйнування очищує чотири сусідні клітинки",
                    "web": "Знімається збігом із фішкою; через 2 тихі ходи поширюється",
                    "shield": "3 шари; спецфішка або бустер знімає одразу 2",
                    "slime": "Поширюється на сусідню клітинку, якщо за хід не отримав шкоди",
                    "metal": "Пошкоджується лише спецфішками та бустерами",
                    "core": "4 удари спецфішками або комбінаціями 4+; вибух 3×3",
                }.get(key, ""),
            }
            for key, hits in BONUS_MATCH_OBSTACLE_HITS.items()
        ],
    }


@api.post("/admin/bonus-match/levels", status_code=201)
async def admin_create_bonus_match_level(
    body: BonusMatchLevelAdminBody,
    admin: dict = Depends(get_current_admin),
):
    existing_levels = await _bonus_match_level_catalog(include_inactive=True)
    requested = int(body.level or 0)
    level = requested or (max((int(item["level"]) for item in existing_levels), default=0) + 1)
    if not (1 <= level <= BONUS_MATCH_LEVEL_LIMIT):
        raise HTTPException(status_code=400, detail=f"Номер рівня має бути від 1 до {BONUS_MATCH_LEVEL_LIMIT}")
    existing = await db.bonus_match_levels.find_one({"level": level}, {"_id": 0})
    if existing or level <= BONUS_MATCH_DEFAULT_LEVEL_COUNT:
        raise HTTPException(status_code=409, detail="Такий рівень уже існує. Відредагуйте його замість створення")
    doc = _bonus_match_admin_level_doc(level, body)
    doc.update({"created_at": now_iso(), "created_by": admin["id"]})
    await db.bonus_match_levels.insert_one(doc.copy())
    return _bonus_match_merge_level_doc(level, doc)


@api.patch("/admin/bonus-match/levels/{level}")
async def admin_update_bonus_match_level(
    level: int,
    body: BonusMatchLevelAdminBody,
    admin: dict = Depends(get_current_admin),
):
    if not (1 <= level <= BONUS_MATCH_LEVEL_LIMIT):
        raise HTTPException(status_code=400, detail="Некоректний номер рівня")
    if level > BONUS_MATCH_DEFAULT_LEVEL_COUNT:
        existing = await db.bonus_match_levels.find_one({"level": level}, {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="Рівень не знайдено")
    doc = _bonus_match_admin_level_doc(level, body)
    doc["updated_by"] = admin["id"]
    await db.bonus_match_levels.update_one(
        {"level": level},
        {
            "$set": doc,
            "$setOnInsert": {"created_at": now_iso(), "created_by": admin["id"]},
        },
        upsert=True,
    )
    return _bonus_match_merge_level_doc(level, doc)


@api.delete("/admin/bonus-match/levels/{level}", status_code=204)
async def admin_delete_bonus_match_level(
    level: int,
    admin: dict = Depends(get_current_admin),
):
    if level <= BONUS_MATCH_DEFAULT_LEVEL_COUNT:
        await db.bonus_match_levels.delete_one({"level": level})
        return None
    deleted = await db.bonus_match_levels.delete_one({"level": level})
    if not deleted.deleted_count:
        raise HTTPException(status_code=404, detail="Рівень не знайдено")
    return None


def _bonus_match_followup_cascades(
    board: list[list[Optional[dict]]],
    combo_start: int = 2,
) -> tuple[list[list[Optional[dict]]], list[dict], int, int, int]:
    groups = _bonus_match_find_match_groups(board)
    score_gain = 0
    coins_gain = 0
    cascade_count = 0
    steps: list[dict] = []
    combo = combo_start
    while groups and cascade_count < 11:
        cascade_count += 1
        matched_cells: set[tuple[int, int]] = set()
        protected: set[tuple[int, int]] = set()
        created_specials: list[dict] = []
        for group in groups:
            matched_cells.update(group["cells"])
            special = _bonus_match_group_special(group)
            if not special:
                continue
            anchor = _bonus_match_pick_special_anchor(board, group, [])
            if anchor:
                cell = board[anchor[0]][anchor[1]]
                if cell:
                    cell["special"] = special
                    protected.add(anchor)
                    created_specials.append({
                        "row": anchor[0], "col": anchor[1], "special": special,
                        "symbol": cell.get("symbol"), "id": cell.get("id"),
                    })

        board_before_clear = _bonus_match_clone_board(board)
        clear_cells = set(matched_cells) - protected
        clear_cells, activated_specials = _bonus_match_expand_specials(
            board, clear_cells, set(), protected, None,
        )
        seen_specials = {
            (int(item.get("row", -1)), int(item.get("col", -1)))
            for item in activated_specials
        }
        damaged_coords: set[tuple[int, int]] = set()
        obstacle_changes: list[dict] = []
        obstacle_events: list[dict] = []
        obstacle_score = 0
        created_obstacle_cells: list[dict] = []

        for _ in range(5):
            special_targets = _bonus_match_special_impact_cells(activated_specials)
            obstacle_result = _bonus_match_resolve_obstacles(
                board,
                clear_cells,
                matched_cells=matched_cells,
                special_targets=special_targets,
                strong_match_cells=_bonus_match_strong_match_cells(groups),
                already_damaged=damaged_coords,
            )
            clear_cells = set(obstacle_result["clear_cells"])
            clear_cells.difference_update(obstacle_result["protected_clear"])
            obstacle_changes.extend(obstacle_result["changes"])
            obstacle_events.extend(obstacle_result["events"])
            created_obstacle_cells.extend(obstacle_result["created_cells"])
            obstacle_score += int(obstacle_result["score_gain"])

            before_count = len(activated_specials)
            clear_cells, newly_activated = _bonus_match_expand_specials(
                board,
                clear_cells,
                set(),
                protected,
                None,
                already_seen=seen_specials,
            )
            activated_specials.extend(newly_activated)
            seen_specials.update(
                (int(item.get("row", -1)), int(item.get("col", -1)))
                for item in newly_activated
            )
            if len(activated_specials) == before_count:
                break

        if not clear_cells and not created_specials:
            break

        coins_this_step = 0
        symbol_cells_cleared = 0
        for row, col in clear_cells:
            cell = board[row][col]
            if cell and not _bonus_match_cell_void(cell) and not cell.get("obstacle"):
                if cell.get("symbol") == "coin":
                    coins_this_step += 1
                if cell.get("symbol") or cell.get("special"):
                    symbol_cells_cleared += 1

        for row, col in clear_cells:
            if (row, col) in protected:
                continue
            cell = board[row][col]
            if cell and not _bonus_match_cell_void(cell) and not cell.get("obstacle"):
                board[row][col] = None

        special_bonus = sum(BONUS_MATCH_SPECIAL_SCORE.get(item["special"], 0) for item in activated_specials)
        long_match_bonus = sum(
            max(0, len(run["cells"]) - 3) * 120
            for group in groups for run in group["runs"]
        )
        base_score = symbol_cells_cleared * 100 + special_bonus + long_match_bonus + obstacle_score
        step_score = int(base_score * (1 + (combo - 1) * 0.25))
        score_gain += step_score
        coins_gain += coins_this_step
        board_after_clear = _bonus_match_clone_board(board)
        board, spawned = _bonus_match_collapse(board)

        # Crates can reveal a new piece. Mark it as spawned at its final position
        # so the frontend gives it the same entrance animation as refill pieces.
        created_ids = {item.get("id") for item in created_obstacle_cells if item.get("id")}
        if created_ids:
            for row in range(BONUS_MATCH_ROWS):
                for col in range(BONUS_MATCH_COLS):
                    cell = board[row][col]
                    if cell and cell.get("id") in created_ids:
                        spawned.append({"row": row, "col": col, "id": cell["id"]})

        steps.append({
            "combo": combo,
            "score_gain": step_score,
            "coins_gain": coins_this_step,
            "matched_cells": [{"row": row, "col": col} for row, col in sorted(matched_cells)],
            "cleared_cells": [{"row": row, "col": col} for row, col in sorted(clear_cells)],
            "created_specials": created_specials,
            "activated_specials": activated_specials,
            "obstacle_changes": obstacle_changes,
            "obstacle_events": obstacle_events,
            "board_before_clear": board_before_clear,
            "board_after_clear": board_after_clear,
            "board_after_collapse": _bonus_match_clone_board(board),
            "spawned": spawned,
        })
        groups = _bonus_match_find_match_groups(board)
        combo += 1
    return board, steps, score_gain, coins_gain, cascade_count


@api.post("/games/bonus-match/lives/purchase")
async def bonus_match_purchase_life(
    user: dict = Depends(get_current_user),
):
    profile = await _bonus_match_profile(user["id"])
    current_lives = int(profile.get("lives", BONUS_MATCH_MAX_LIVES))
    if current_lives >= BONUS_MATCH_MAX_LIVES:
        raise HTTPException(status_code=400, detail="У тебе вже максимальна кількість життів")

    charged = await db.users.update_one(
        {"id": user["id"], "balance": {"$gte": BONUS_MATCH_LIFE_PRICE}},
        {"$inc": {"balance": -BONUS_MATCH_LIFE_PRICE}},
    )
    if not charged.modified_count:
        raise HTTPException(status_code=400, detail="Недостатньо Point для покупки життя")

    now = now_iso()
    next_lives = min(BONUS_MATCH_MAX_LIVES, current_lives + 1)
    profile_update = {
        "$inc": {"lives": 1},
        "$set": {"updated_at": now},
    }
    if next_lives >= BONUS_MATCH_MAX_LIVES:
        profile_update["$set"]["lives_updated_at"] = now

    updated = await db.bonus_match_profiles.update_one(
        {"user_id": user["id"], "lives": {"$lt": BONUS_MATCH_MAX_LIVES}},
        profile_update,
    )
    if not updated.modified_count:
        await db.users.update_one({"id": user["id"]}, {"$inc": {"balance": BONUS_MATCH_LIFE_PRICE}})
        raise HTTPException(status_code=409, detail="Життя вже відновилося. Онови сторінку")

    try:
        await db.transactions.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": user["id"],
            "kind": "bonus_match_life",
            "amount": -BONUS_MATCH_LIFE_PRICE,
            "description": "Bonus Match: додаткове життя",
            "created_at": now,
            "meta": {"life": 1},
        })
    except Exception:
        await db.bonus_match_profiles.update_one(
            {"user_id": user["id"], "lives": {"$gt": 0}},
            {"$inc": {"lives": -1}, "$set": {"updated_at": now}},
        )
        await db.users.update_one({"id": user["id"]}, {"$inc": {"balance": BONUS_MATCH_LIFE_PRICE}})
        raise

    fresh_profile = await _bonus_match_profile(user["id"])
    fresh_user = await db.users.find_one({"id": user["id"]}, {"_id": 0, "balance": 1}) or user
    return {
        "price": BONUS_MATCH_LIFE_PRICE,
        "lives": int(fresh_profile.get("lives", next_lives)),
        "max_lives": BONUS_MATCH_MAX_LIVES,
        "next_life_at": fresh_profile.get("next_life_at"),
        "balance": int(fresh_user.get("balance", 0)),
    }


@api.post("/games/bonus-match/boosters/purchase")
async def bonus_match_purchase_booster(
    body: BonusMatchBoosterPurchaseBody,
    user: dict = Depends(get_current_user),
):
    booster = body.booster
    price = int(BONUS_MATCH_BOOSTERS[booster]["price"])
    await _bonus_match_profile(user["id"])
    charged = await db.users.update_one(
        {"id": user["id"], "balance": {"$gte": price}},
        {"$inc": {"balance": -price}},
    )
    if not charged.modified_count:
        raise HTTPException(status_code=400, detail="Недостатньо Point для покупки")
    try:
        await db.bonus_match_profiles.update_one(
            {"user_id": user["id"]},
            {
                "$inc": {f"boosters.{booster}": 1},
                "$set": {"updated_at": now_iso()},
            },
        )
        await db.transactions.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": user["id"],
            "kind": "bonus_match_booster",
            "amount": -price,
            "description": f"Bonus Match: {BONUS_MATCH_BOOSTERS[booster]['label']}",
            "created_at": now_iso(),
            "meta": {"booster": booster},
        })
    except Exception:
        await db.users.update_one({"id": user["id"]}, {"$inc": {"balance": price}})
        raise
    profile = await _bonus_match_profile(user["id"])
    fresh_user = await db.users.find_one({"id": user["id"]}, {"_id": 0, "balance": 1}) or user
    return {
        "booster": booster,
        "price": price,
        "boosters": profile["boosters"],
        "balance": int(fresh_user.get("balance", 0)),
    }


@api.post("/games/bonus-match/boosters/use")
async def bonus_match_use_booster(
    body: BonusMatchBoosterUseBody,
    user: dict = Depends(get_current_user),
):
    booster = body.booster
    session = await db.bonus_match_sessions.find_one(
        {"id": body.session_id, "user_id": user["id"]}, {"_id": 0},
    )
    if not session:
        raise HTTPException(status_code=404, detail="Ігрову сесію не знайдено")
    if session.get("status") != "active":
        raise HTTPException(status_code=400, detail="Рівень уже завершено")
    profile = await _bonus_match_profile(user["id"])
    if int(profile.get("boosters", {}).get(booster, 0)) <= 0:
        raise HTTPException(status_code=400, detail="Спочатку придбай цей бонус")

    board = _bonus_match_clone_board(session.get("board"))
    original_board = _bonus_match_clone_board(board)
    config = _bonus_match_config_with_board_shape(session.get("config"), int(session["level"]), board)
    score_gain = 0
    coins_gain = 0
    cascade_count = 0
    steps: list[dict] = []
    reshuffled = False
    reshuffle_method = "none"

    if booster == "shuffle":
        board = _bonus_match_shuffle_board(board)
        board, _, fallback_method = _bonus_match_ensure_playable_board(
            board, int(session["level"]), config
        )
        reshuffled = True
        reshuffle_method = "shuffle" if fallback_method == "none" else fallback_method
    else:
        if body.row is None or body.col is None:
            raise HTTPException(status_code=400, detail="Оберіть клітинку для бонусу")
        row = int(body.row)
        col = int(body.col)
        if not (0 <= row < BONUS_MATCH_ROWS and 0 <= col < BONUS_MATCH_COLS):
            raise HTTPException(status_code=400, detail="Некоректна клітинка")
        target_cell = board[row][col]
        if not target_cell or _bonus_match_cell_void(target_cell):
            raise HTTPException(status_code=400, detail="Ця клітинка не входить до форми дошки")

        if booster == "hammer":
            clear_cells: set[tuple[int, int]] = {(row, col)}
        elif booster == "rocket":
            clear_cells = {
                (row, current_col)
                for current_col in range(BONUS_MATCH_COLS)
                if not _bonus_match_cell_void(board[row][current_col])
            } | {
                (current_row, col)
                for current_row in range(BONUS_MATCH_ROWS)
                if not _bonus_match_cell_void(board[current_row][col])
            }
        else:
            symbol = _bonus_match_cell_symbol(target_cell)
            if not symbol:
                raise HTTPException(status_code=400, detail="Джокер потрібно застосувати до звичайної фішки")
            clear_cells = {
                (current_row, current_col)
                for current_row, board_row in enumerate(board)
                for current_col, cell in enumerate(board_row)
                if _bonus_match_cell_symbol(cell) == symbol
            }

        effect_name = f"booster_{booster}"
        clear_cells, chained = _bonus_match_expand_specials(
            board, clear_cells, set(), set(), None,
        )
        activated_specials: list[dict] = list(chained)
        seen_specials = {
            (int(item.get("row", -1)), int(item.get("col", -1)))
            for item in activated_specials
        }
        damaged_coords: set[tuple[int, int]] = set()
        obstacle_changes: list[dict] = []
        obstacle_events: list[dict] = []
        obstacle_score = 0
        created_obstacle_cells: list[dict] = []

        for _ in range(5):
            obstacle_result = _bonus_match_resolve_obstacles(
                board,
                clear_cells,
                matched_cells=set(),
                special_targets=_bonus_match_special_impact_cells(activated_specials),
                strong_match_cells=set(),
                booster=booster,
                already_damaged=damaged_coords,
            )
            clear_cells = set(obstacle_result["clear_cells"])
            clear_cells.difference_update(obstacle_result["protected_clear"])
            obstacle_changes.extend(obstacle_result["changes"])
            obstacle_events.extend(obstacle_result["events"])
            created_obstacle_cells.extend(obstacle_result["created_cells"])
            obstacle_score += int(obstacle_result["score_gain"])

            before_count = len(activated_specials)
            clear_cells, newly_activated = _bonus_match_expand_specials(
                board,
                clear_cells,
                set(),
                set(),
                None,
                already_seen=seen_specials,
            )
            activated_specials.extend(newly_activated)
            seen_specials.update(
                (int(item.get("row", -1)), int(item.get("col", -1)))
                for item in newly_activated
            )
            if len(activated_specials) == before_count:
                break

        activated_specials.insert(0, {
            "row": row,
            "col": col,
            "special": effect_name,
            "targets": [
                {"row": target_row, "col": target_col}
                for target_row, target_col in sorted(clear_cells)
            ],
        })

        board_before_clear = _bonus_match_clone_board(original_board)
        coins_this_step = 0
        symbols_cleared = 0
        for target_row, target_col in clear_cells:
            cell = board[target_row][target_col]
            if cell and not _bonus_match_cell_void(cell) and not cell.get("obstacle"):
                if cell.get("symbol") == "coin":
                    coins_this_step += 1
                if cell.get("symbol") or cell.get("special"):
                    symbols_cleared += 1
                board[target_row][target_col] = None

        visual_clear_cells = {
            (current_row, current_col)
            for current_row in range(BONUS_MATCH_ROWS)
            for current_col in range(BONUS_MATCH_COLS)
            if board_before_clear[current_row][current_col] is not None
            and board[current_row][current_col] is None
        }
        base_score = BONUS_MATCH_BOOSTERS[booster]["score"] + symbols_cleared * 100
        base_score += obstacle_score
        base_score += sum(BONUS_MATCH_SPECIAL_SCORE.get(item.get("special"), 0) for item in activated_specials)
        score_gain += base_score
        coins_gain += coins_this_step
        board_after_clear = _bonus_match_clone_board(board)
        board, spawned = _bonus_match_collapse(board)

        created_ids = {item.get("id") for item in created_obstacle_cells if item.get("id")}
        if created_ids:
            for current_row in range(BONUS_MATCH_ROWS):
                for current_col in range(BONUS_MATCH_COLS):
                    cell = board[current_row][current_col]
                    if cell and cell.get("id") in created_ids:
                        spawned.append({"row": current_row, "col": current_col, "id": cell["id"]})

        steps.append({
            "combo": 1,
            "score_gain": base_score,
            "coins_gain": coins_this_step,
            "matched_cells": [],
            "cleared_cells": [
                {"row": target_row, "col": target_col}
                for target_row, target_col in sorted(visual_clear_cells)
            ],
            "created_specials": [],
            "activated_specials": activated_specials,
            "obstacle_changes": obstacle_changes,
            "obstacle_events": obstacle_events,
            "board_before_clear": board_before_clear,
            "board_after_clear": board_after_clear,
            "board_after_collapse": _bonus_match_clone_board(board),
            "spawned": spawned,
        })
        board, cascade_steps, cascade_score, cascade_coins, extra_cascades = _bonus_match_followup_cascades(board, 2)
        steps.extend(cascade_steps)
        score_gain += cascade_score
        coins_gain += cascade_coins
        cascade_count = 1 + extra_cascades
        board, auto_reshuffled, auto_method = _bonus_match_ensure_playable_board(
            board, int(session["level"]), config
        )
        if auto_reshuffled:
            reshuffled = True
            reshuffle_method = auto_method

    consumed = await db.bonus_match_profiles.update_one(
        {"user_id": user["id"], f"boosters.{booster}": {"$gte": 1}},
        {"$inc": {f"boosters.{booster}": -1}, "$set": {"updated_at": now_iso()}},
    )
    if not consumed.modified_count:
        raise HTTPException(status_code=409, detail="Бонус уже використано на іншому пристрої")

    score = int(session.get("score", 0)) + score_gain
    coins_collected = int(session.get("coins_collected", 0)) + coins_gain
    won = _bonus_match_objective_met(board, config, score, coins_collected)
    status_value = "won" if won else "active"
    updates = {
        "board": board,
        "score": score,
        "coins_collected": coins_collected,
        "cascades": int(session.get("cascades", 0)) + cascade_count,
        "status": status_value,
        "updated_at": now_iso(),
    }
    if won:
        updates["completed_at"] = now_iso()
    await db.bonus_match_sessions.update_one({"id": session["id"]}, {"$set": updates})
    session = {**session, **updates}

    result = None
    if won:
        thresholds = config["star_thresholds"]
        stars = 3 if score >= thresholds[2] else 2 if score >= thresholds[1] else 1
        result = await _bonus_match_reward_win(user, session, stars)

    fresh_profile = await _bonus_match_profile(user["id"])
    frames = []
    if booster == "shuffle":
        frames = [{"phase": "reshuffle", "board": _bonus_match_clone_board(board)}]
    else:
        frames = _bonus_match_animation_frames(original_board, steps, board, reshuffled)[1:]
    return {
        "valid": True,
        "message": f"{BONUS_MATCH_BOOSTERS[booster]['label']} використано",
        "booster": booster,
        "score_gain": score_gain,
        "coins_gain": coins_gain,
        "cascade_count": cascade_count,
        "session": _bonus_match_session_payload(session),
        "result": result,
        "profile": {"boosters": fresh_profile["boosters"]},
        "animation": {
            "steps": steps,
            "frames": frames,
            "reshuffled": reshuffled,
            "reason": "manual" if booster == "shuffle" else ("no_moves" if reshuffled else None),
            "method": reshuffle_method,
        },
    }


@api.get("/games/bonus-match/status")
async def bonus_match_status(
    user: dict = Depends(get_current_user),
):
    profile = await _bonus_match_profile(user["id"])
    levels = await _bonus_match_level_catalog()
    max_level = max((int(item["level"]) for item in levels), default=1)
    date_key = kyiv_today_key()
    daily = await db.bonus_match_daily.find_one(
        {
            "user_id": user["id"],
            "date": date_key,
        },
        {"_id": 0},
    ) or {}
    completions = await db.bonus_match_completions.find(
        {"user_id": user["id"]},
        {
            "_id": 0,
            "level": 1,
            "stars": 1,
            "best_score": 1,
        },
    ).sort(
        "level",
        1,
    ).to_list(BONUS_MATCH_LEVEL_LIMIT)
    unlocked_level = await _bonus_match_reconcile_unlocked_level(
        user["id"],
        profile,
        levels,
        {int(item.get("level", 0)) for item in completions},
    )
    active = await db.bonus_match_sessions.find_one(
        {
            "user_id": user["id"],
            "status": "active",
        },
        {"_id": 0},
        sort=[("created_at", -1)],
    )
    active_session_animation = None
    if active:
        original_active_board = _bonus_match_clone_board(active.get("board"))
        active_config = active.get("config") or _bonus_match_level_config(active.get("level", 1))
        playable_board, auto_reshuffled, reshuffle_method = _bonus_match_ensure_playable_board(
            original_active_board,
            int(active.get("level", 1)),
            active_config,
        )
        if auto_reshuffled:
            reshuffled_at = now_iso()
            await db.bonus_match_sessions.update_one(
                {"id": active["id"], "user_id": user["id"], "status": "active"},
                {"$set": {"board": playable_board, "updated_at": reshuffled_at}},
            )
            active = {**active, "board": playable_board, "updated_at": reshuffled_at}
            active_session_animation = {
                "reshuffled": True,
                "reason": "no_moves",
                "method": reshuffle_method,
                "from_board": original_active_board,
                "frames": [{
                    "phase": "reshuffle",
                    "board": _bonus_match_clone_board(playable_board),
                }],
            }
    fresh_user = await db.users.find_one({"id": user["id"]}, {"_id": 0, "balance": 1}) or user
    return {
        "profile": {
            "current_level": unlocked_level,
            "max_level": max_level,
            "total_stars": int(profile.get("total_stars", 0)),
            "lives": int(profile.get("lives", BONUS_MATCH_MAX_LIVES)),
            "max_lives": BONUS_MATCH_MAX_LIVES,
            "next_life_at": profile.get("next_life_at"),
            "daily_points": int(daily.get("points_awarded", 0)),
            "daily_point_cap": BONUS_MATCH_DAILY_POINT_CAP,
            "boosters": profile.get("boosters", {key: 0 for key in BONUS_MATCH_BOOSTERS}),
            "booster_prices": {key: int(value["price"]) for key, value in BONUS_MATCH_BOOSTERS.items()},
            "life_price": BONUS_MATCH_LIFE_PRICE,
            "balance": int(fresh_user.get("balance", 0)),
        },
        "levels": levels,
        "booster_catalog": [
            {"id": key, "label": value["label"], "price": int(value["price"])}
            for key, value in BONUS_MATCH_BOOSTERS.items()
        ],
        "completions": completions,
        "active_session": _bonus_match_session_payload(active) if active else None,
        "active_session_animation": active_session_animation,
        "top_today": await _bonus_match_top_today(),
    }


@api.post("/games/bonus-match/start")
async def bonus_match_start(
    body: BonusMatchStartBody,
    user: dict = Depends(get_current_user),
):
    profile = await _bonus_match_profile(user["id"])
    levels = await _bonus_match_level_catalog()
    unlocked_level = await _bonus_match_reconcile_unlocked_level(user["id"], profile, levels)
    requested_level = max(1, min(BONUS_MATCH_LEVEL_LIMIT, int(body.level or 1)))
    config = next((item for item in levels if int(item["level"]) == requested_level), None)
    if not config:
        raise HTTPException(status_code=404, detail="Рівень не знайдено або вимкнено")
    if requested_level > unlocked_level:
        raise HTTPException(status_code=400, detail="Цей рівень ще не відкрито")

    existing = await db.bonus_match_sessions.find_one(
        {
            "user_id": user["id"],
            "status": "active",
        },
        {"_id": 0},
        sort=[("created_at", -1)],
    )
    if existing:
        original_existing_board = _bonus_match_clone_board(existing.get("board"))
        existing_config = existing.get("config") or _bonus_match_level_config(existing.get("level", 1))
        playable_board, auto_reshuffled, reshuffle_method = _bonus_match_ensure_playable_board(
            original_existing_board,
            int(existing.get("level", 1)),
            existing_config,
        )
        resume_animation = None
        if auto_reshuffled:
            reshuffled_at = now_iso()
            await db.bonus_match_sessions.update_one(
                {"id": existing["id"], "user_id": user["id"], "status": "active"},
                {"$set": {"board": playable_board, "updated_at": reshuffled_at}},
            )
            existing = {**existing, "board": playable_board, "updated_at": reshuffled_at}
            resume_animation = {
                "reshuffled": True,
                "reason": "no_moves",
                "method": reshuffle_method,
                "from_board": original_existing_board,
                "frames": [{
                    "phase": "reshuffle",
                    "board": _bonus_match_clone_board(playable_board),
                }],
            }
        return {
            "session": _bonus_match_session_payload(
                existing
            ),
            "animation": resume_animation,
            "profile": {
                "lives": int(
                    profile.get(
                        "lives",
                        BONUS_MATCH_MAX_LIVES,
                    )
                ),
                "max_lives": BONUS_MATCH_MAX_LIVES,
                "next_life_at": profile.get("next_life_at"),
                "boosters": profile.get("boosters", {key: 0 for key in BONUS_MATCH_BOOSTERS}),
            },
            "resumed": True,
        }

    lives = int(profile.get("lives", 0))
    if lives <= 0:
        raise HTTPException(
            status_code=400,
            detail=(
                "Життя закінчилися. "
                "Наступне відновиться через 30 хвилин"
            ),
        )

    now = now_iso()
    lives_anchor = profile.get("lives_updated_at")
    if lives >= BONUS_MATCH_MAX_LIVES:
        lives_anchor = now
    await db.bonus_match_profiles.update_one(
        {"user_id": user["id"]},
        {"$set": {
            "lives": lives - 1,
            "lives_updated_at": lives_anchor or now,
            "updated_at": now,
        }},
    )

    session = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "level": requested_level,
        "campaign": BONUS_MATCH_CAMPAIGN,
        "board": _bonus_match_make_board(requested_level, config),
        "moves_left": config["moves"],
        "score": 0,
        "coins_collected": 0,
        "cascades": 0,
        "status": "active",
        "config": config,
        "created_at": now,
        "updated_at": now,
    }
    await db.bonus_match_sessions.insert_one(
        session.copy()
    )
    refreshed = await _bonus_match_profile(user["id"])
    return {
        "session": _bonus_match_session_payload(session),
        "profile": {
            "lives": int(
                refreshed.get("lives", lives - 1)
            ),
            "max_lives": BONUS_MATCH_MAX_LIVES,
            "next_life_at": refreshed.get("next_life_at"),
            "boosters": refreshed.get("boosters", {key: 0 for key in BONUS_MATCH_BOOSTERS}),
        },
        "resumed": False,
    }


@api.post("/games/bonus-match/surrender")
async def bonus_match_surrender(
    body: BonusMatchSurrenderBody,
    user: dict = Depends(get_current_user),
):
    session = await db.bonus_match_sessions.find_one(
        {"id": body.session_id, "user_id": user["id"]},
        {"_id": 0},
    )
    if not session:
        raise HTTPException(status_code=404, detail="Ігрову сесію не знайдено")
    if session.get("status") != "active":
        return {"ok": True, "session": _bonus_match_session_payload(session)}

    now = now_iso()
    await db.bonus_match_sessions.update_one(
        {"id": body.session_id, "user_id": user["id"], "status": "active"},
        {"$set": {"status": "surrendered", "completed_at": now, "updated_at": now}},
    )
    session = {**session, "status": "surrendered", "completed_at": now, "updated_at": now}
    return {"ok": True, "session": _bonus_match_session_payload(session)}


@api.post("/games/bonus-match/move")
async def bonus_match_move(
    body: BonusMatchMoveBody,
    user: dict = Depends(get_current_user),
):
    session = await db.bonus_match_sessions.find_one(
        {
            "id": body.session_id,
            "user_id": user["id"],
        },
        {"_id": 0},
    )
    if not session:
        raise HTTPException(
            status_code=404,
            detail="Ігрову сесію не знайдено",
        )
    if session.get("status") != "active":
        return {
            "valid": False,
            "message": "Цей рівень уже завершено",
            "session": _bonus_match_session_payload(
                session
            ),
        }

    original_session_board = _bonus_match_clone_board(session.get("board"))
    session_config = _bonus_match_config_with_board_shape(
        session.get("config"),
        int(session.get("level", 1)),
        original_session_board,
    )
    playable_board, auto_reshuffled, reshuffle_method = _bonus_match_ensure_playable_board(
        original_session_board,
        int(session.get("level", 1)),
        session_config,
    )
    if auto_reshuffled:
        reshuffled_at = now_iso()
        await db.bonus_match_sessions.update_one(
            {"id": session["id"], "user_id": user["id"], "status": "active"},
            {"$set": {"board": playable_board, "updated_at": reshuffled_at}},
        )
        session = {**session, "board": playable_board, "updated_at": reshuffled_at}
        return {
            "valid": True,
            "move_consumed": False,
            "auto_reshuffled": True,
            "message": "На полі не залишилося ходів. Фішки автоматично перемішано",
            "score_gain": 0,
            "coins_gain": 0,
            "cascade_count": 0,
            "session": _bonus_match_session_payload(session),
            "result": None,
            "animation": {
                "reshuffled": True,
                "reason": "no_moves",
                "method": reshuffle_method,
                "from_board": original_session_board,
                "frames": [{
                    "phase": "reshuffle",
                    "board": _bonus_match_clone_board(playable_board),
                }],
            },
        }

    coordinates = [
        body.from_row,
        body.from_col,
        body.to_row,
        body.to_col,
    ]
    if any(value < 0 for value in coordinates):
        raise HTTPException(
            status_code=400,
            detail="Некоректні координати ходу",
        )
    if (
        body.from_row >= BONUS_MATCH_ROWS
        or body.to_row >= BONUS_MATCH_ROWS
        or body.from_col >= BONUS_MATCH_COLS
        or body.to_col >= BONUS_MATCH_COLS
    ):
        raise HTTPException(
            status_code=400,
            detail="Некоректні координати ходу",
        )
    if (
        abs(body.from_row - body.to_row)
        + abs(body.from_col - body.to_col)
        != 1
    ):
        return {
            "valid": False,
            "message": "Обери сусідню фішку",
            "session": _bonus_match_session_payload(
                session
            ),
        }

    original_board = _bonus_match_clone_board(
        session["board"]
    )
    board = _bonus_match_clone_board(
        session["board"]
    )
    first_coord = (
        body.from_row,
        body.from_col,
    )
    second_coord = (
        body.to_row,
        body.to_col,
    )
    first_cell = board[first_coord[0]][first_coord[1]]
    second_cell = board[second_coord[0]][second_coord[1]]

    if (
        not _bonus_match_cell_swappable(first_cell)
        or not _bonus_match_cell_swappable(second_cell)
    ):
        return {
            "valid": False,
            "message": "Ця клітинка заблокована",
            "session": _bonus_match_session_payload(
                session
            ),
            "animation": {
                "swap": {
                    "from": {
                        "row": first_coord[0],
                        "col": first_coord[1],
                    },
                    "to": {
                        "row": second_coord[0],
                        "col": second_coord[1],
                    },
                },
                "swapped_board": original_board,
                "reverted_board": original_board,
                "steps": [],
                "frames": [
                    {
                        "phase": "swap",
                        "board": original_board,
                    },
                    {
                        "phase": "invalid",
                        "board": original_board,
                        "shake_ids": [
                            str(first_cell.get("id")) if first_cell else "",
                            str(second_cell.get("id")) if second_cell else "",
                        ],
                    },
                ],
            },
        }

    board[first_coord[0]][first_coord[1]], board[
        second_coord[0]
    ][second_coord[1]] = (
        second_cell,
        first_cell,
    )
    swapped_board = _bonus_match_clone_board(board)

    direct_triggers: set[tuple[int, int]] = set()
    color_symbol: Optional[str] = None
    for coord, other_coord in (
        (first_coord, second_coord),
        (second_coord, first_coord),
    ):
        cell = board[coord[0]][coord[1]]
        other = board[other_coord[0]][other_coord[1]]
        if cell and cell.get("special"):
            direct_triggers.add(coord)
            if (
                cell.get("special") == "color_bomb"
                and other
            ):
                color_symbol = (
                    _bonus_match_cell_symbol(other)
                    or other.get("symbol")
                )

    groups = _bonus_match_find_match_groups(board)
    if not groups and not direct_triggers:
        return {
            "valid": False,
            "message": (
                "Цей хід не створює комбінацію"
            ),
            "session": _bonus_match_session_payload(
                session
            ),
            "animation": {
                "swap": {
                    "from": {
                        "row": first_coord[0],
                        "col": first_coord[1],
                    },
                    "to": {
                        "row": second_coord[0],
                        "col": second_coord[1],
                    },
                },
                "swapped_board": swapped_board,
                "reverted_board": original_board,
                "steps": [],
                "frames": [
                    {
                        "phase": "swap",
                        "board": swapped_board,
                    },
                    {
                        "phase": "invalid",
                        "board": original_board,
                        "shake_ids": [
                            str(first_cell.get("id")) if first_cell else "",
                            str(second_cell.get("id")) if second_cell else "",
                        ],
                    },
                ],
            },
        }

    score_gain = 0
    coins_gain = 0
    cascade_count = 0
    animation_steps: list[dict] = []
    preferred = [second_coord, first_coord]

    turn_obstacle_changes: list[dict] = []
    while (
        groups or direct_triggers
    ) and cascade_count < 12:
        cascade_count += 1
        matched_cells: set[tuple[int, int]] = set()
        protected: set[tuple[int, int]] = set()
        created_specials: list[dict] = []

        for group in groups:
            matched_cells.update(group["cells"])
            special = _bonus_match_group_special(group)
            if not special:
                continue
            anchor = _bonus_match_pick_special_anchor(
                board,
                group,
                preferred if cascade_count == 1 else [],
            )
            if anchor:
                cell = board[anchor[0]][anchor[1]]
                if cell:
                    cell["special"] = special
                    protected.add(anchor)
                    created_specials.append({
                        "row": anchor[0],
                        "col": anchor[1],
                        "special": special,
                        "symbol": cell.get("symbol"),
                        "id": cell.get("id"),
                    })

        board_before_clear = _bonus_match_clone_board(board)
        clear_cells = set(matched_cells) - protected
        clear_cells, activated_specials = _bonus_match_expand_specials(
            board,
            clear_cells,
            direct_triggers if cascade_count == 1 else set(),
            protected,
            color_symbol if cascade_count == 1 else None,
        )
        direct_triggers = set()
        seen_specials = {
            (int(item.get("row", -1)), int(item.get("col", -1)))
            for item in activated_specials
        }
        damaged_coords: set[tuple[int, int]] = set()
        obstacle_changes: list[dict] = []
        obstacle_events: list[dict] = []
        obstacle_score = 0
        created_obstacle_cells: list[dict] = []

        for _ in range(5):
            obstacle_result = _bonus_match_resolve_obstacles(
                board,
                clear_cells,
                matched_cells=matched_cells,
                special_targets=_bonus_match_special_impact_cells(activated_specials),
                strong_match_cells=_bonus_match_strong_match_cells(groups),
                already_damaged=damaged_coords,
            )
            clear_cells = set(obstacle_result["clear_cells"])
            clear_cells.difference_update(obstacle_result["protected_clear"])
            obstacle_changes.extend(obstacle_result["changes"])
            obstacle_events.extend(obstacle_result["events"])
            created_obstacle_cells.extend(obstacle_result["created_cells"])
            obstacle_score += int(obstacle_result["score_gain"])

            before_count = len(activated_specials)
            clear_cells, newly_activated = _bonus_match_expand_specials(
                board,
                clear_cells,
                set(),
                protected,
                None,
                already_seen=seen_specials,
            )
            activated_specials.extend(newly_activated)
            seen_specials.update(
                (int(item.get("row", -1)), int(item.get("col", -1)))
                for item in newly_activated
            )
            if len(activated_specials) == before_count:
                break

        if not clear_cells and not created_specials:
            break

        coins_this_step = 0
        symbol_cells_cleared = 0
        for row, col in clear_cells:
            cell = board[row][col]
            if cell and not _bonus_match_cell_void(cell) and not cell.get("obstacle"):
                if cell.get("symbol") == "coin":
                    coins_this_step += 1
                if cell.get("symbol") or cell.get("special"):
                    symbol_cells_cleared += 1

        for row, col in clear_cells:
            if (row, col) in protected:
                continue
            cell = board[row][col]
            if cell and not _bonus_match_cell_void(cell) and not cell.get("obstacle"):
                board[row][col] = None

        special_bonus = sum(
            BONUS_MATCH_SPECIAL_SCORE.get(item["special"], 0)
            for item in activated_specials
        )
        long_match_bonus = sum(
            max(0, len(run["cells"]) - 3) * 120
            for group in groups
            for run in group["runs"]
        )
        base_step_score = symbol_cells_cleared * 100 + special_bonus + long_match_bonus + obstacle_score
        combo_multiplier = 1 + (cascade_count - 1) * 0.25
        step_score = int(base_step_score * combo_multiplier)
        score_gain += step_score
        coins_gain += coins_this_step
        turn_obstacle_changes.extend(obstacle_changes)

        board_after_clear = _bonus_match_clone_board(board)
        board, spawned = _bonus_match_collapse(board)
        created_ids = {item.get("id") for item in created_obstacle_cells if item.get("id")}
        if created_ids:
            for row in range(BONUS_MATCH_ROWS):
                for col in range(BONUS_MATCH_COLS):
                    cell = board[row][col]
                    if cell and cell.get("id") in created_ids:
                        spawned.append({"row": row, "col": col, "id": cell["id"]})
        board_after_collapse = _bonus_match_clone_board(board)
        animation_steps.append({
            "combo": cascade_count,
            "score_gain": step_score,
            "coins_gain": coins_this_step,
            "matched_cells": [
                {"row": row, "col": col}
                for row, col in sorted(matched_cells)
            ],
            "cleared_cells": [
                {"row": row, "col": col}
                for row, col in sorted(clear_cells)
                if not _bonus_match_cell_void(board_before_clear[row][col])
            ],
            "created_specials": created_specials,
            "activated_specials": activated_specials,
            "obstacle_changes": obstacle_changes,
            "obstacle_events": obstacle_events,
            "board_before_clear": board_before_clear,
            "board_after_clear": board_after_clear,
            "board_after_collapse": board_after_collapse,
            "spawned": spawned,
        })
        groups = _bonus_match_find_match_groups(board)
        preferred = []

    reshuffled = False
    reshuffle_method = "none"

    moves_left = max(
        0,
        int(session.get("moves_left", 0)) - 1,
    )
    score = (
        int(session.get("score", 0))
        + score_gain
    )
    coins_collected = (
        int(session.get("coins_collected", 0))
        + coins_gain
    )
    config = (
        session.get("config")
        or _bonus_match_level_config(
            session["level"]
        )
    )
    won = _bonus_match_objective_met(board, config, score, coins_collected)
    status_value = (
        "won"
        if won
        else (
            "lost"
            if moves_left <= 0
            else "active"
        )
    )
    obstacle_turn_events: list[dict] = []
    obstacle_turn_board: Optional[list[list[Optional[dict]]]] = None
    if status_value == "active":
        board, obstacle_turn_events = _bonus_match_advance_obstacles(
            board,
            turn_obstacle_changes,
        )
        obstacle_turn_board = _bonus_match_clone_board(board)
        board, reshuffled, reshuffle_method = _bonus_match_ensure_playable_board(
            board,
            int(session["level"]),
            config,
        )
    now = now_iso()

    updates = {
        "board": board,
        "moves_left": moves_left,
        "score": score,
        "coins_collected": coins_collected,
        "cascades": (
            int(session.get("cascades", 0))
            + cascade_count
        ),
        "status": status_value,
        "updated_at": now,
    }
    if status_value != "active":
        updates["completed_at"] = now
    await db.bonus_match_sessions.update_one(
        {"id": session["id"]},
        {"$set": updates},
    )
    session = {**session, **updates}

    result = None
    if won:
        thresholds = config["star_thresholds"]
        stars = (
            3
            if score >= thresholds[2]
            else (
                2
                if score >= thresholds[1]
                else 1
            )
        )
        result = await _bonus_match_reward_win(
            user,
            session,
            stars,
        )
    elif status_value == "lost":
        profile = await _bonus_match_profile(user["id"])
        result = {
            "stars": 0,
            "points_awarded": 0,
            "xp_awarded": 0,
            "lives": int(
                profile.get("lives", 0)
            ),
            "current_level": int(
                profile.get("current_level", 1)
            ),
            "total_stars": int(
                profile.get("total_stars", 0)
            ),
        }

    return {
        "valid": True,
        "message": (
            f"+{score_gain} очок"
            if score_gain
            else "Хід зараховано"
        ),
        "score_gain": score_gain,
        "coins_gain": coins_gain,
        "cascade_count": cascade_count,
        "session": _bonus_match_session_payload(
            session
        ),
        "result": result,
        "animation": {
            "swap": {
                "from": {
                    "row": first_coord[0],
                    "col": first_coord[1],
                },
                "to": {
                    "row": second_coord[0],
                    "col": second_coord[1],
                },
            },
            "swapped_board": swapped_board,
            "steps": animation_steps,
            "frames": _bonus_match_animation_frames(
                swapped_board,
                animation_steps,
                board,
                reshuffled,
                obstacle_events=obstacle_turn_events,
                obstacle_board=obstacle_turn_board,
            ),
            "obstacle_events": obstacle_turn_events,
            "reshuffled": reshuffled,
            "reason": "no_moves" if reshuffled else None,
            "method": reshuffle_method,
        },
    }


# ────────────────────────────────────────────────────────────────────────
# Motivational feed (activity stream)
# ────────────────────────────────────────────────────────────────────────
class FeedEvent(BaseModel):
    id: str
    kind: Literal["quest", "purchase", "level_up", "cube", "prize_delivered", "goal", "diamond_avatar"]
    user_id: str
    user_name: str
    avatar_initials: str
    avatar_color: str
    avatar_url: Optional[str] = None
    avatar_rarity: str = "basic"
    department: str = ""
    title: str
    subtitle: str = ""
    amount: Optional[int] = None
    level: Optional[int] = None
    created_at: str
    reactions: dict = {}
    my_reaction: Optional[str] = None
    comment_count: int = 0
    duration_days: Optional[int] = None
    daily_bonus: Optional[int] = None
    task_replacements: Optional[int] = None
    expires_at: Optional[str] = None
    avatar_code: Optional[str] = None


class FeedResponse(BaseModel):
    events: List[FeedEvent]


def _classify_transaction(tx: dict, level_at_time: Optional[int] = None):
    """Return (kind, title, subtitle) tuple for a transaction event."""
    desc = tx.get("description", "")
    kind = tx.get("kind", "quest")
    amount = tx.get("amount", 0)
    if kind == "quest" and desc.startswith("Щедрий Куб"):
        return "cube", "кинув Щедрий Куб", desc.replace("Щедрий Куб ", "").strip("()")
    if kind == "quest":
        return "quest", "виконав квест", desc.replace("Квест: ", "")
    if kind == "purchase":
        return "purchase", "придбав приз", desc.replace("Купівля: ", "")
    if kind == "admin_adjust":
        if amount > 0:
            return "quest", "отримав бонус", desc
        return "purchase", "витратив бали", desc
    if kind == "signup_bonus":
        return "quest", "приєднався до команди", "стартовий бонус"
    if kind == "goal_reward":
        return "goal", "виконав ціль", desc
    if kind == "bonus_match":
        return "quest", "пройшов рівень Bonus Match", desc.replace("Bonus Match: ", "")
    return "quest", desc or "активність", ""


@api.get("/feed", response_model=FeedResponse)
async def get_feed(limit: int = 40, user: dict = Depends(get_current_user)):
    """Aggregated activity feed: quest completions, purchases, cube spins, level-ups, delivered orders.
    Sorted by created_at desc. Level-ups derived from cumulative XP crossings.
    """
    # 1) Load recent transactions and explicit showcase events across all employees.
    # Personal pet rewards stay private in the owner's journal. They do not
    # turn an individual companion into a team competition.
    txs = await db.transactions.find(
        {"kind": {"$ne": "pet_gift"}, "meta.source": {"$ne": "pet"}},
        {"_id": 0},
    ).sort("created_at", -1).to_list(limit * 3)
    showcase_events = await db.feed_events.find({}, {"_id": 0}).sort("created_at", -1).to_list(limit * 2)
    level_docs = await db.level_up_events.find({}, {"_id": 0}).sort("created_at", -1).to_list(limit * 2)

    # Fetch user info for participants. Explicit showcase events carry a frozen
    # avatar snapshot, but their owners are included for department/name fallback.
    user_ids = list(
        {t["user_id"] for t in txs}
        | {e["user_id"] for e in showcase_events if e.get("user_id")}
        | {e["user_id"] for e in level_docs if e.get("user_id")}
    )
    users_map = {}
    async for u in db.users.find(
        {"id": {"$in": user_ids}, "role": {"$in": PLAYER_ROLES}},
        {"_id": 0, "id": 1, "name": 1, "avatar_initials": 1, "avatar_color": 1, "avatar_url": 1, "avatar_rarity": 1, "department": 1},
    ):
        users_map[u["id"]] = u

    events: List[FeedEvent] = []

    # 2) Level-ups come from the exact XP ledger crossing, not from a Point-based estimate.
    level_up_events: List[FeedEvent] = []
    for item in level_docs:
        uid = item.get("user_id")
        u = users_map.get(uid)
        if not u:
            continue
        lvl = int(item.get("level") or 1)
        level_up_events.append(FeedEvent(
            id=item.get("id") or f"lvlup-{uid}-{lvl}",
            kind="level_up",
            user_id=uid,
            user_name=u["name"],
            avatar_initials=u.get("avatar_initials", "?"),
            avatar_color=u.get("avatar_color", "#FFB800"),
            avatar_url=u.get("avatar_url"),
            avatar_rarity=u.get("avatar_rarity", "basic"),
            department=u.get("department", ""),
            title="досягнув нового рівня",
            subtitle=f"Рівень {lvl} · {item.get('level_title') or profile_level_title(lvl)}",
            level=lvl,
            created_at=item.get("created_at") or now_iso(),
        ))

    # 3) Transaction events
    for t in txs:
        u = users_map.get(t["user_id"])
        if not u:
            continue
        kind, title, subtitle = _classify_transaction(t)
        events.append(FeedEvent(
            id=t["id"],
            kind=kind,
            user_id=t["user_id"],
            user_name=u["name"],
            avatar_initials=u.get("avatar_initials", "?"),
            avatar_color=u.get("avatar_color", "#FFB800"),
            avatar_url=u.get("avatar_url"),
            avatar_rarity=u.get("avatar_rarity", "basic"),
            department=u.get("department", ""),
            title=title,
            subtitle=subtitle,
            amount=t.get("amount"),
            created_at=t["created_at"],
        ))

    # 4) Explicit showcase events. These use a frozen avatar snapshot so the
    # diamond frame remains visible in the historical feed after the 3-day perk expires.
    for item in showcase_events:
        owner = users_map.get(item.get("user_id"), {})
        events.append(FeedEvent(
            id=item["id"],
            kind=item.get("kind", "diamond_avatar"),
            user_id=item["user_id"],
            user_name=item.get("user_name") or owner.get("name", "Користувач"),
            avatar_initials=item.get("avatar_initials") or owner.get("avatar_initials", "?"),
            avatar_color=item.get("avatar_color") or owner.get("avatar_color", "#7DD3FC"),
            avatar_url=item.get("avatar_url") or owner.get("avatar_url"),
            avatar_rarity=item.get("avatar_rarity") or owner.get("avatar_rarity", "diamond"),
            department=item.get("department") or owner.get("department", ""),
            title=item.get("title", "отримав алмазний аватар 💎"),
            subtitle=item.get("subtitle", "Особлива нагорода адміністратора"),
            created_at=item["created_at"],
            duration_days=item.get("duration_days"),
            daily_bonus=item.get("daily_bonus"),
            task_replacements=item.get("task_replacements"),
            expires_at=item.get("expires_at"),
            avatar_code=item.get("avatar_code"),
        ))

    # 5) Delivered orders
    delivered = await db.orders.find({"status": "delivered"}, {"_id": 0}).sort("created_at", -1).to_list(limit)
    for o in delivered:
        u = users_map.get(o["user_id"])
        if not u:
            # try to fetch on demand
            u = await db.users.find_one({"id": o["user_id"]}, {"_id": 0}) or {}
            if not u:
                continue
            users_map[o["user_id"]] = u
        events.append(FeedEvent(
            id=f"delivered-{o['id']}",
            kind="prize_delivered",
            user_id=o["user_id"],
            user_name=u.get("name", o.get("user_name", "?")),
            avatar_initials=u.get("avatar_initials", "?"),
            avatar_color=u.get("avatar_color", "#FFB800"),
            avatar_url=u.get("avatar_url"),
            avatar_rarity=u.get("avatar_rarity", "basic"),
            department=u.get("department", ""),
            title="отримав приз",
            subtitle=o["prize_title"],
            created_at=o["created_at"],
        ))

    # Merge + sort + limit
    events.extend(level_up_events)
    events.sort(key=lambda e: e.created_at, reverse=True)
    events = events[:limit]
    await _attach_social(events, user["id"])
    return FeedResponse(events=events)


# ════════════════════════════════════════════════════════════════════════
# PHASE 3 — Reactions + Comments on feed activities
# ════════════════════════════════════════════════════════════════════════
REACTION_TYPES = ["like", "fire", "clap", "rocket", "heart", "laugh", "star"]


class ReactBody(BaseModel):
    emoji: Literal["like", "fire", "clap", "rocket", "heart", "laugh", "star"]


class CommentBody(BaseModel):
    text: str


class CommentModel(BaseModel):
    id: str
    target_id: str
    user_id: str
    user_name: str
    avatar_initials: str = ""
    avatar_color: str = "#FFB800"
    text: str
    created_at: str


async def _attach_social(events: list, current_id: str):
    """Attach reactions summary, my_reaction and comment_count to feed events."""
    if not events:
        return
    ids = [e.id for e in events]
    # Reactions
    rx_map: dict = {}
    my_map: dict = {}
    async for r in db.reactions.find({"target_id": {"$in": ids}}, {"_id": 0}):
        tid = r["target_id"]
        rx_map.setdefault(tid, {})
        rx_map[tid][r["emoji"]] = rx_map[tid].get(r["emoji"], 0) + 1
        if r["user_id"] == current_id:
            my_map[tid] = r["emoji"]
    # Comment counts
    cc_map: dict = {}
    pipeline = [
        {"$match": {"target_id": {"$in": ids}}},
        {"$group": {"_id": "$target_id", "n": {"$sum": 1}}},
    ]
    async for c in db.comments.aggregate(pipeline):
        cc_map[c["_id"]] = c["n"]
    for e in events:
        e.reactions = rx_map.get(e.id, {})
        e.my_reaction = my_map.get(e.id)
        e.comment_count = cc_map.get(e.id, 0)


async def _feed_event_owner(event_id: str) -> Optional[str]:
    """Resolve the owner user_id of a feed event by its derived id."""
    if event_id.startswith("lvlup-"):
        parts = event_id.split("-")
        return parts[1] if len(parts) > 1 else None
    if event_id.startswith("delivered-"):
        oid = event_id[len("delivered-"):]
        o = await db.orders.find_one({"id": oid}, {"_id": 0, "user_id": 1})
        return o["user_id"] if o else None
    explicit = await db.feed_events.find_one({"id": event_id}, {"_id": 0, "user_id": 1})
    if explicit:
        return explicit.get("user_id")
    tx = await db.transactions.find_one({"id": event_id}, {"_id": 0, "user_id": 1})
    return tx["user_id"] if tx else None


@api.post("/feed/{event_id}/react")
async def react_to_event(event_id: str, body: ReactBody, user: dict = Depends(get_current_user)):
    existing = await db.reactions.find_one({"target_id": event_id, "user_id": user["id"]}, {"_id": 0})
    if existing and existing["emoji"] == body.emoji:
        # toggle off
        await db.reactions.delete_one({"target_id": event_id, "user_id": user["id"]})
        action = "removed"
    else:
        await db.reactions.update_one(
            {"target_id": event_id, "user_id": user["id"]},
            {"$set": {"emoji": body.emoji, "created_at": now_iso()}},
            upsert=True,
        )
        action = "set"
        owner = await _feed_event_owner(event_id)
        if owner and owner != user["id"]:
            await _notify(owner, "reaction", "Нова реакція на твою активність",
                          f"{user['name']} відреагував", "/feed", "heart")
    # summary
    summary: dict = {}
    async for r in db.reactions.find({"target_id": event_id}, {"_id": 0, "emoji": 1}):
        summary[r["emoji"]] = summary.get(r["emoji"], 0) + 1
    return {"action": action, "reactions": summary, "my_reaction": None if action == "removed" else body.emoji}


@api.get("/feed/{event_id}/comments", response_model=List[CommentModel])
async def list_comments(event_id: str, user: dict = Depends(get_current_user)):
    docs = await db.comments.find({"target_id": event_id}, {"_id": 0}).sort("created_at", 1).to_list(200)
    return [CommentModel(**d) for d in docs]


@api.post("/feed/{event_id}/comments", response_model=CommentModel, status_code=201)
async def add_comment(event_id: str, body: CommentBody, user: dict = Depends(get_current_user)):
    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Коментар не може бути порожнім")
    if len(text) > 500:
        raise HTTPException(status_code=400, detail="Максимум 500 символів")
    doc = {
        "id": str(uuid.uuid4()),
        "target_id": event_id,
        "user_id": user["id"],
        "user_name": user["name"],
        "avatar_initials": user.get("avatar_initials", ""),
        "avatar_color": user.get("avatar_color", "#FFB800"),
        "team_id": user.get("team_id"),
        "team_name": await _resolve_team_name(user.get("team_id")),
        "text": text,
        "created_at": now_iso(),
    }
    await db.comments.insert_one(doc)
    owner = await _feed_event_owner(event_id)
    if owner and owner != user["id"]:
        await _notify(owner, "comment", "Новий коментар до твоєї активності",
                      f"{user['name']}: {text[:60]}", "/feed", "message-circle")
    doc.pop("_id", None)
    return CommentModel(**doc)


@api.delete("/comments/{comment_id}", status_code=204)
async def delete_comment(comment_id: str, user: dict = Depends(get_current_user)):
    c = await db.comments.find_one({"id": comment_id}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Коментар не знайдено")
    if c["user_id"] != user["id"] and user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Немає доступу")
    await db.comments.delete_one({"id": comment_id})
    return None



# ────────────────────────────────────────────────────────────────────────
# Admin endpoints
# ────────────────────────────────────────────────────────────────────────
@api.get("/admin/users", response_model=List[UserWithProgress])
async def admin_list_users(admin: dict = Depends(get_current_admin_or_editor)):
    docs = await db.users.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    # Batch hydrate team names
    team_ids = list({d.get("team_id") for d in docs if d.get("team_id")})
    teams_map = {}
    if team_ids:
        async for t in db.teams.find({"id": {"$in": team_ids}}, {"_id": 0, "id": 1, "name": 1}):
            teams_map[t["id"]] = t["name"]
    normalized_docs = []
    for d in docs:
        d = await _expire_diamond_avatar_if_needed(d)
        if d.get("team_id"):
            d["team_name"] = teams_map.get(d["team_id"])
        normalized_docs.append(d)
    return [_user_with_progress(d) for d in normalized_docs]


@api.patch("/admin/users/{user_id}/points", response_model=UserWithProgress)
async def admin_adjust_points(user_id: str, body: PointsAdjustBody, admin: dict = Depends(get_current_admin_or_editor)):
    target = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Користувача не знайдено")

    current_balance = int(target.get("balance", 0) or 0)
    if body.mode == "set":
        new_balance = int(body.amount)
        delta = new_balance - current_balance
    else:
        delta = int(body.amount)
        new_balance = current_balance + delta

    if new_balance < 0:
        raise HTTPException(status_code=400, detail="Баланс не може бути від'ємним")

    if delta:
        inc = {"balance": delta}
        # Point and XP are independent currencies. XP is adjusted through the
        # dedicated XP endpoint so balance corrections never distort levels.
        if body.mode == "delta" and delta > 0:
            inc["total_earned"] = delta
        await db.users.update_one({"id": user_id}, {"$inc": inc})

        await db.transactions.insert_one(
            {
                "id": str(uuid.uuid4()),
                "user_id": user_id,
                "kind": "admin_adjust",
                "amount": delta,
                "description": body.description,
                "adjustment_mode": body.mode,
                "balance_before": current_balance,
                "balance_after": new_balance,
                "created_at": now_iso(),
            }
        )
        if delta > 0:
            await _notify_points_awarded(user_id, delta, body.description or "Нарахування адміністратора")

    fresh = await db.users.find_one({"id": user_id}, {"_id": 0})
    return _user_with_progress(fresh)


@api.get("/admin/xp-ledger")
async def admin_xp_ledger(
    team_id: Optional[str] = None,
    source: Optional[str] = None,
    limit: int = 100,
    admin: dict = Depends(get_current_admin),
):
    query: dict = {}
    if team_id:
        query["team_id"] = team_id
    if source:
        query["source"] = source
    safe_limit = max(1, min(500, int(limit)))
    items = await db.xp_ledger.find(query, {"_id": 0}).sort("created_at", -1).limit(safe_limit).to_list(safe_limit)
    totals = await db.xp_ledger.aggregate([
        {"$match": query},
        {"$group": {"_id": "$source", "amount": {"$sum": "$amount"}, "events": {"$sum": 1}}},
        {"$sort": {"amount": -1}},
    ]).to_list(100)
    return {
        "items": items,
        "summary": {
            "amount": sum(int(item.get("amount", 0) or 0) for item in totals),
            "events": sum(int(item.get("events", 0) or 0) for item in totals),
            "sources": [
                {"source": item.get("_id") or "activity", "amount": item.get("amount", 0), "events": item.get("events", 0)}
                for item in totals
            ],
        },
    }


@api.post("/admin/users/{user_id}/xp", response_model=UserWithProgress)
async def admin_award_xp(user_id: str, body: XPAdjustBody, admin: dict = Depends(get_current_admin)):
    target = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Користувача не знайдено")
    manual_id = str(uuid.uuid4())
    await _award_xp(
        user_id,
        body.amount,
        "admin_manual",
        f"admin:{manual_id}",
        body.description,
        {"manual_id": manual_id, "admin_name": admin.get("name")},
        admin.get("id"),
    )
    fresh = await db.users.find_one({"id": user_id}, {"_id": 0}) or target
    await _sync_system_achievements(fresh)
    fresh = await db.users.find_one({"id": user_id}, {"_id": 0}) or fresh
    return _user_with_progress(fresh)


@api.delete("/admin/users/{user_id}", status_code=204)
async def admin_delete_user(user_id: str, admin: dict = Depends(get_current_admin)):
    target = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Користувача не знайдено")
    if target.get("role") == "admin":
        raise HTTPException(status_code=400, detail="Не можна видалити адміністратора")

    deleted_at = now_iso()
    email = str(target.get("email") or "").strip().lower()

    # Remember explicitly deleted accounts. This prevents the three historical
    # demo profiles from being recreated during a later service restart even
    # when SEED_DEMO_USERS was accidentally left enabled in the environment.
    if email:
        await db.deleted_accounts.update_one(
            {"email": email},
            {"$set": {
                "email": email,
                "user_id": user_id,
                "name": target.get("name", ""),
                "deleted_at": deleted_at,
                "deleted_by": admin.get("id"),
            }},
            upsert=True,
        )

    # Remove pointers and user-owned data so the deleted account cannot remain
    # in teams, rankings, daily tasks, notifications, orders or activity feeds.
    await db.teams.update_many({"leader_id": user_id}, {"$set": {"leader_id": None}})
    user_collections = (
        db.ai_training_results,
        db.applications,
        db.comments,
        db.daily_battles,
        db.daily_games,
        db.daily_progress,
        db.daily_task_reviews,
        db.daily_task_sets,
        db.goal_history,
        db.notifications,
        db.orders,
        db.reactions,
        db.transactions,
        db.user_goals,
        db.user_achievements,
        db.page_views,
        db.bonus_match_profiles,
        db.bonus_match_sessions,
        db.bonus_match_completions,
        db.bonus_match_daily,
        db.announcement_reads,
        db.pet_profiles,
        db.pet_events,
        db.pet_minigame_sessions,
        db.pet_reward_claims,
        db.pet_commands,
        db.flappy_profiles,
        db.flappy_sessions,
    )
    for collection in user_collections:
        await collection.delete_many({"user_id": user_id})

    result = await db.users.delete_one({"id": user_id})
    if result.deleted_count != 1:
        raise HTTPException(status_code=409, detail="Не вдалося видалити користувача")
    return None


@api.get("/admin/quests", response_model=List[QuestModel])
async def admin_list_quests(admin: dict = Depends(get_current_admin)):
    docs = await db.quests.find({}, {"_id": 0}).sort("created_at", 1).to_list(500)
    return [QuestModel(**d) for d in docs]


@api.post("/admin/quests", response_model=QuestModel, status_code=201)
async def admin_create_quest(body: QuestCreateBody, admin: dict = Depends(get_current_admin)):
    doc = {"id": str(uuid.uuid4()), **body.model_dump(), "created_at": now_iso()}
    await db.quests.insert_one(doc)
    doc.pop("_id", None)
    return QuestModel(**doc)


@api.patch("/admin/quests/{quest_id}", response_model=QuestModel)
async def admin_update_quest(quest_id: str, body: QuestUpdateBody, admin: dict = Depends(get_current_admin)):
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="Немає полів для оновлення")
    r = await db.quests.update_one({"id": quest_id}, {"$set": updates})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Квест не знайдено")
    doc = await db.quests.find_one({"id": quest_id}, {"_id": 0})
    return QuestModel(**doc)


@api.delete("/admin/quests/{quest_id}", status_code=204)
async def admin_delete_quest(quest_id: str, admin: dict = Depends(get_current_admin)):
    r = await db.quests.delete_one({"id": quest_id})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Квест не знайдено")
    return None


@api.get("/admin/prizes", response_model=List[PrizeModel])
async def admin_list_prizes(admin: dict = Depends(get_current_admin)):
    docs = await db.prizes.find({}, {"_id": 0}).sort("created_at", 1).to_list(500)
    return [PrizeModel(**(await _prize_with_team(doc))) for doc in docs]


@api.post("/admin/prizes", response_model=PrizeModel, status_code=201)
async def admin_create_prize(body: PrizeCreateBody, admin: dict = Depends(get_current_admin)):
    payload = body.model_dump()
    team_id = str(payload.get("team_id") or "").strip() or None
    payload["team_id"] = team_id
    if team_id and not await db.teams.find_one({"id": team_id}, {"_id": 0, "id": 1}):
        raise HTTPException(status_code=400, detail="Команду для призу не знайдено")
    doc = {"id": str(uuid.uuid4()), **payload, "created_at": now_iso()}
    await db.prizes.insert_one(doc)
    if doc.get("active", True) and doc.get("category") not in {"merch", "certificate"}:
        notify_title = "Новий приз у магазині"
        notify_body = f"{doc.get('title', 'Новий приз')} · {int(doc.get('price', 0))} Point"
        if doc.get("team_id"):
            await _notify_team(doc.get("team_id"), "new_prize", notify_title, notify_body, "/store", "gift", "prizes", {"prize_id": doc["id"]})
        else:
            await _notify_all_employees("new_prize", notify_title, notify_body, "/store", "gift", "prizes", {"prize_id": doc["id"]})
    return PrizeModel(**(await _prize_with_team(doc)))


@api.patch("/admin/prizes/{prize_id}", response_model=PrizeModel)
async def admin_update_prize(prize_id: str, body: PrizeUpdateBody, admin: dict = Depends(get_current_admin)):
    supplied = body.model_fields_set
    updates = {k: v for k, v in body.model_dump().items() if k in supplied}
    if not updates:
        raise HTTPException(status_code=400, detail="Немає полів для оновлення")
    if "team_id" in updates:
        updates["team_id"] = str(updates.get("team_id") or "").strip() or None
    if updates.get("team_id"):
        if not await db.teams.find_one({"id": updates["team_id"]}, {"_id": 0, "id": 1}):
            raise HTTPException(status_code=400, detail="Команду для призу не знайдено")
    r = await db.prizes.update_one({"id": prize_id}, {"$set": updates})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Приз не знайдено")
    doc = await db.prizes.find_one({"id": prize_id}, {"_id": 0})
    return PrizeModel(**(await _prize_with_team(doc)))


@api.get("/admin/prize-promotions", response_model=List[PrizePromotionModel])
async def admin_list_prize_promotions(admin: dict = Depends(get_current_admin)):
    docs = await db.prize_promotions.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    result = []
    for doc in docs:
        if not doc.get("team_name") and doc.get("team_id"):
            doc["team_name"] = await _resolve_team_name(doc.get("team_id"))
        result.append(PrizePromotionModel(**doc))
    return result


@api.post("/admin/prizes/{prize_id}/promotion", response_model=PrizePromotionModel, status_code=201)
async def admin_create_prize_promotion(
    prize_id: str,
    body: PrizePromotionCreateBody,
    admin: dict = Depends(get_current_admin),
):
    prize = await db.prizes.find_one({"id": prize_id}, {"_id": 0})
    if not prize:
        raise HTTPException(status_code=404, detail="Приз не знайдено")
    base_price = max(0, int(prize.get("price") or 0))
    discount = int(body.discount_points)
    quantity = int(body.quantity)
    if base_price <= 0:
        raise HTTPException(status_code=400, detail="Для безкоштовного призу акція не потрібна")
    if discount > base_price:
        raise HTTPException(status_code=400, detail="Знижка не може перевищувати базову ціну призу")
    if prize.get("category") != "avatar" and int(prize.get("stock") or 0) < quantity:
        raise HTTPException(status_code=400, detail="Кількість акційних одиниць перевищує залишок призу")

    current_time = now_iso()
    await db.prize_promotions.update_many(
        {"prize_id": prize_id, "active": True},
        {"$set": {"active": False, "ended_at": current_time, "updated_at": current_time, "end_reason": "replaced"}},
    )
    team_id = prize.get("team_id")
    doc = {
        "id": str(uuid.uuid4()),
        "prize_id": prize_id,
        "prize_title": prize.get("title") or "Приз",
        "base_price": base_price,
        "discount_points": discount,
        "effective_price": max(0, base_price - discount),
        "quantity_total": quantity,
        "quantity_remaining": quantity,
        "used_count": 0,
        "active": True,
        "team_id": team_id,
        "team_name": await _resolve_team_name(team_id) if team_id else None,
        "created_by": admin["id"],
        "created_by_name": admin.get("name", "Адміністратор"),
        "created_at": current_time,
        "updated_at": current_time,
        "ended_at": None,
    }
    await db.prize_promotions.insert_one(doc)

    notify_title = "Акція в магазині"
    notify_body = f"{doc['prize_title']}: −{discount} Point на наступні {quantity} шт."
    if team_id:
        await _notify_team(team_id, "prize_promotion", notify_title, notify_body, "/store", "gift", "prizes", {"prize_id": prize_id, "promotion_id": doc["id"]})
    else:
        await _notify_all_employees("prize_promotion", notify_title, notify_body, "/store", "gift", "prizes", {"prize_id": prize_id, "promotion_id": doc["id"]})

    doc.pop("_id", None)
    return PrizePromotionModel(**doc)


@api.delete("/admin/prizes/{prize_id}/promotion")
async def admin_cancel_prize_promotion(prize_id: str, admin: dict = Depends(get_current_admin)):
    current_time = now_iso()
    result = await db.prize_promotions.update_many(
        {"prize_id": prize_id, "active": True},
        {"$set": {"active": False, "ended_at": current_time, "updated_at": current_time, "end_reason": "cancelled"}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Активну акцію для цього призу не знайдено")
    return {"ok": True, "prize_id": prize_id}


@api.delete("/admin/prizes/{prize_id}", status_code=204)
async def admin_delete_prize(prize_id: str, admin: dict = Depends(get_current_admin)):
    r = await db.prizes.delete_one({"id": prize_id})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Приз не знайдено")
    await db.prize_promotions.delete_many({"prize_id": prize_id})
    return None


@api.get("/admin/orders", response_model=List[OrderModel])
async def admin_list_orders(
    team_id: Optional[str] = None,
    admin: dict = Depends(get_current_admin),
):
    query = {}
    docs = await db.orders.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)
    # Backfill team metadata for historical orders created before V128.
    missing_user_ids = list({doc.get("user_id") for doc in docs if doc.get("user_id") and not doc.get("team_id")})
    user_map = {}
    if missing_user_ids:
        async for item in db.users.find({"id": {"$in": missing_user_ids}}, {"_id": 0, "id": 1, "team_id": 1}):
            user_map[item["id"]] = item.get("team_id")
    team_ids = list({doc.get("team_id") or user_map.get(doc.get("user_id")) for doc in docs if doc.get("team_id") or user_map.get(doc.get("user_id"))})
    team_names = {}
    if team_ids:
        async for team in db.teams.find({"id": {"$in": team_ids}}, {"_id": 0, "id": 1, "name": 1}):
            team_names[team["id"]] = team.get("name", "")
    result = []
    for doc in docs:
        resolved_team_id = doc.get("team_id") or user_map.get(doc.get("user_id"))
        if team_id and resolved_team_id != team_id:
            continue
        result.append(OrderModel(**{
            **doc,
            "team_id": resolved_team_id,
            "team_name": doc.get("team_name") or team_names.get(resolved_team_id),
        }))
    return result


@api.patch("/admin/orders/{order_id}", response_model=OrderModel)
async def admin_update_order(order_id: str, body: OrderStatusBody, admin: dict = Depends(get_current_admin)):
    current = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not current:
        raise HTTPException(status_code=404, detail="Замовлення не знайдено")
    await db.orders.update_one({"id": order_id}, {"$set": {"status": body.status, "updated_at": now_iso()}})
    doc = await db.orders.find_one({"id": order_id}, {"_id": 0})
    status_copy = {
        "processing": ("Замовлення в обробці", "Ми взяли замовлення в роботу.", "clock-3"),
        "ready": ("Замовлення підтверджено", "Приз готовий до отримання.", "check-circle-2"),
        "delivered": ("Приз видано", "Замовлення завершено. Приємного користування!", "party-popper"),
        "cancelled": ("Замовлення відхилено", "Замовлення скасовано. Деталі можна уточнити у керівника.", "x-circle"),
    }
    if current.get("status") != body.status and doc.get("user_id"):
        title, message, icon = status_copy.get(body.status, ("Статус замовлення змінено", body.status, "inbox"))
        await _notify(
            doc["user_id"], f"order_{body.status}", title,
            f"{doc.get('prize_title', 'Приз')}. {message}",
            "/store", icon, "orders", {"order_id": order_id, "status": body.status},
        )
    if not doc.get("team_id") and doc.get("user_id"):
        owner = await db.users.find_one({"id": doc["user_id"]}, {"_id": 0, "team_id": 1}) or {}
        doc["team_id"] = owner.get("team_id")
    if doc.get("team_id") and not doc.get("team_name"):
        doc["team_name"] = await _resolve_team_name(doc.get("team_id"))
    return OrderModel(**doc)


@api.get("/admin/analytics")
async def admin_analytics(
    team_id: Optional[str] = None,
    admin: dict = Depends(get_current_admin),
):
    user_query = {"role": {"$in": PLAYER_ROLES}}
    if team_id:
        user_query["team_id"] = team_id
    scoped_users = await db.users.find(
        user_query,
        {"_id": 0, "id": 1, "name": 1, "total_earned": 1, "pet_reward_points_total": 1, "avatar_color": 1, "avatar_initials": 1, "team_id": 1},
    ).sort("total_earned", -1).to_list(5000)
    pet_rewards = await _pet_rewards_by_user()
    for scoped_user in scoped_users:
        scoped_user["total_earned"] = max(
            0,
            int(scoped_user.get("total_earned", 0) or 0) - max(
                pet_rewards.get(str(scoped_user["id"]), 0),
                int(scoped_user.get("pet_reward_points_total", 0) or 0),
            ),
        )
    scoped_users.sort(key=lambda item: (-int(item.get("total_earned", 0) or 0), str(item.get("name") or "").casefold()))
    scoped_user_ids = [row["id"] for row in scoped_users]
    user_match = {"user_id": {"$in": scoped_user_ids}} if team_id else {}

    total_users = len(scoped_users)
    total_quests = await db.quests.count_documents({"active": True})
    prize_query = {"active": True}
    if team_id:
        prize_query["$or"] = [{"team_id": team_id}, {"team_id": None}, {"team_id": {"$exists": False}}]
    total_prizes = await db.prizes.count_documents(prize_query)
    order_query = {"status": "processing", **user_match}
    orders_processing = await db.orders.count_documents(order_query)

    earned_match = {"amount": {"$gt": 0}, **user_match, **_pet_reward_exclusion()}
    spent_match = {"amount": {"$lt": 0}, **user_match}
    earned = await db.transactions.aggregate([
        {"$match": earned_match},
        {"$group": {"_id": None, "sum": {"$sum": "$amount"}}},
    ]).to_list(1)
    spent = await db.transactions.aggregate([
        {"$match": spent_match},
        {"$group": {"_id": None, "sum": {"$sum": "$amount"}}},
    ]).to_list(1)
    top_earners = scoped_users[:5]

    pop_match = {"user_id": {"$in": scoped_user_ids}} if team_id else {}
    pop_pipeline = []
    if pop_match:
        pop_pipeline.append({"$match": pop_match})
    pop_pipeline.extend([
        {"$unwind": "$claimed"},
        {"$group": {"_id": "$claimed", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 5},
    ])
    pop = await db.daily_progress.aggregate(pop_pipeline).to_list(5)
    quest_titles = {}
    for q in await db.quests.find({}, {"_id": 0, "id": 1, "title": 1}).to_list(500):
        quest_titles[q["id"]] = q["title"]
    popular_quests = [{"title": quest_titles.get(p["_id"], "—"), "claims": p["count"]} for p in pop]

    usage_cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    usage_match = {"created_at": {"$gte": usage_cutoff}, "role": {"$in": PLAYER_ROLES}}
    if team_id:
        usage_match["user_id"] = {"$in": scoped_user_ids}
    usage_pipeline = [
        {"$match": usage_match},
        {"$group": {
            "_id": {"path": "$path", "label": "$label"},
            "views": {"$sum": 1},
            "users": {"$addToSet": "$user_id"},
            "last_seen": {"$max": "$created_at"},
        }},
        {"$project": {
            "_id": 0,
            "path": "$_id.path",
            "label": "$_id.label",
            "views": 1,
            "unique_users": {"$size": "$users"},
            "last_seen": 1,
        }},
        {"$sort": {"views": -1, "unique_users": -1}},
        {"$limit": 15},
    ]
    popular_pages = await db.page_views.aggregate(usage_pipeline).to_list(15)
    total_page_views = await db.page_views.count_documents(usage_match)
    unique_page_users = await db.page_views.distinct("user_id", usage_match)

    return {
        "team_id": team_id,
        "team_name": await _resolve_team_name(team_id) if team_id else None,
        "total_users": total_users,
        "total_quests": total_quests,
        "total_prizes": total_prizes,
        "orders_processing": orders_processing,
        "total_points_earned": (earned[0]["sum"] if earned else 0),
        "total_points_spent": abs(spent[0]["sum"]) if spent else 0,
        "top_earners": top_earners,
        "popular_quests": popular_quests,
        "page_usage_period_days": 30,
        "total_page_views": total_page_views,
        "unique_page_users": len(unique_page_users),
        "popular_pages": popular_pages,
    }


# ────────────────────────────────────────────────────────────────────────
# Bot API endpoints (Telegram bot integration)
# All endpoints require X-Bot-Token header equal to BOT_API_TOKEN.
# ────────────────────────────────────────────────────────────────────────
bot_router = APIRouter(prefix="/api/bot", dependencies=[Depends(get_bot_caller)])


class BotLinkBody(BaseModel):
    email: EmailStr
    telegram_id: str


class BotAdjustBody(BaseModel):
    telegram_id: str
    amount: int
    description: str = "Синхронізація з ботом"


@bot_router.get("/health")
async def bot_health():
    return {"status": "ok", "service": "VPDK Bonus Bot API"}


async def _find_user_by_telegram(telegram_id: str):
    return await db.users.find_one({"telegram_id": telegram_id}, {"_id": 0})


@bot_router.get("/user/{telegram_id}", response_model=UserWithProgress)
async def bot_get_user(telegram_id: str):
    user = await _find_user_by_telegram(telegram_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not linked. Ask user to link via /api/bot/link")
    return _user_with_progress(user)


@bot_router.post("/link", response_model=UserWithProgress)
async def bot_link(body: BotLinkBody):
    email = body.email.lower().strip()
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User with this email not found")
    existing = await db.users.find_one({"telegram_id": body.telegram_id, "id": {"$ne": user["id"]}})
    if existing:
        raise HTTPException(status_code=409, detail="This Telegram ID is linked to another account")
    await db.users.update_one({"id": user["id"]}, {"$set": {"telegram_id": body.telegram_id}})
    fresh = await db.users.find_one({"id": user["id"]}, {"_id": 0})
    return _user_with_progress(fresh)


@bot_router.get("/user/{telegram_id}/quests", response_model=List[QuestWithProgress])
async def bot_user_quests(telegram_id: str):
    user = await _find_user_by_telegram(telegram_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not linked")
    quests = await db.quests.find({"active": True}, {"_id": 0}).sort("created_at", 1).to_list(500)
    dp = await _get_or_create_daily_progress(user["id"])
    return [
        QuestWithProgress(**q, progress=dp["progress"].get(q["id"], 0), claimed=q["id"] in dp["claimed"])
        for q in quests
    ]


@bot_router.get("/leaderboard")
async def bot_leaderboard(limit: int = 20):
    docs = await db.users.find(
        {"role": {"$in": PLAYER_ROLES}}, {"_id": 0, "id": 1, "name": 1, "total_earned": 1, "pet_reward_points_total": 1, "avatar_initials": 1}
    ).to_list(5000)
    pet_rewards = await _pet_rewards_by_user()
    for doc in docs:
        doc["total_earned"] = max(
            0,
            int(doc.get("total_earned", 0) or 0) - max(
                pet_rewards.get(str(doc["id"]), 0),
                int(doc.get("pet_reward_points_total", 0) or 0),
            ),
        )
    docs.sort(key=lambda item: (-int(item.get("total_earned", 0) or 0), str(item.get("name") or "").casefold()))
    docs = docs[:max(1, min(100, int(limit)))]
    return [{"rank": i + 1, **d} for i, d in enumerate(docs)]


@bot_router.post("/adjust", response_model=UserWithProgress)
async def bot_adjust(body: BotAdjustBody):
    user = await _find_user_by_telegram(body.telegram_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not linked")
    new_balance = user["balance"] + body.amount
    if new_balance < 0:
        raise HTTPException(status_code=400, detail="Balance cannot be negative")
    inc = {"balance": body.amount}
    if body.amount > 0:
        inc["total_earned"] = body.amount
    await db.users.update_one({"id": user["id"]}, {"$inc": inc})
    await db.transactions.insert_one(
        {
            "id": str(uuid.uuid4()),
            "user_id": user["id"],
            "kind": "admin_adjust",
            "amount": body.amount,
            "description": f"[Bot] {body.description}",
            "created_at": now_iso(),
        }
    )
    fresh = await db.users.find_one({"id": user["id"]}, {"_id": 0})
    return _user_with_progress(fresh)


# ────────────────────────────────────────────────────────────────────────
# Admin announcements — one-time modal messages for employees
# ────────────────────────────────────────────────────────────────────────
async def _announcement_with_stats(doc: dict) -> dict:
    item = {**doc}
    item.pop("_id", None)
    team_id = str(item.get("team_id") or "").strip() or None
    item["team_id"] = team_id
    item["team_name"] = item.get("team_name") or (await _resolve_team_name(team_id) if team_id else None)
    item["dismissed_count"] = await db.announcement_reads.count_documents({"announcement_id": item["id"]})
    return item


@api.get("/announcements/pending", response_model=Optional[AnnouncementModel])
async def pending_announcement(user: dict = Depends(get_current_user)):
    if user.get("role") == "admin":
        return None
    seen_ids = await db.announcement_reads.distinct("announcement_id", {"user_id": user["id"]})
    user_team_id = str(user.get("team_id") or "").strip() or None
    audience = [{"team_id": None}, {"team_id": {"$exists": False}}]
    if user_team_id:
        audience.append({"team_id": user_team_id})
    query = {"active": True, "$or": audience}
    if seen_ids:
        query["id"] = {"$nin": seen_ids}
    doc = await db.announcements.find_one(query, {"_id": 0}, sort=[("created_at", 1)])
    if not doc:
        return None
    doc["dismissed_count"] = 0
    return AnnouncementModel(**doc)


@api.post("/announcements/{announcement_id}/dismiss")
async def dismiss_announcement(announcement_id: str, user: dict = Depends(get_current_user)):
    exists = await db.announcements.find_one({"id": announcement_id}, {"_id": 0, "id": 1, "team_id": 1})
    if not exists:
        raise HTTPException(status_code=404, detail="Повідомлення не знайдено")
    target_team_id = str(exists.get("team_id") or "").strip() or None
    user_team_id = str(user.get("team_id") or "").strip() or None
    if target_team_id and target_team_id != user_team_id:
        raise HTTPException(status_code=404, detail="Повідомлення не знайдено")
    await db.announcement_reads.update_one(
        {"announcement_id": announcement_id, "user_id": user["id"]},
        {
            "$setOnInsert": {
                "id": str(uuid.uuid4()),
                "announcement_id": announcement_id,
                "user_id": user["id"],
                "user_name": user.get("name", "Працівник"),
                "dismissed_at": now_iso(),
            }
        },
        upsert=True,
    )
    return {"ok": True, "announcement_id": announcement_id}


@api.get("/admin/announcements", response_model=List[AnnouncementModel])
async def admin_list_announcements(
    team_id: Optional[str] = None,
    admin: dict = Depends(get_current_admin),
):
    selected_team_id = str(team_id or "").strip() or None
    query = {}
    if selected_team_id:
        query["$or"] = [
            {"team_id": None},
            {"team_id": {"$exists": False}},
            {"team_id": selected_team_id},
        ]
    docs = await db.announcements.find(query, {"_id": 0}).sort("created_at", -1).to_list(200)
    return [AnnouncementModel(**(await _announcement_with_stats(doc))) for doc in docs]


@api.post("/admin/announcements", response_model=AnnouncementModel, status_code=201)
async def admin_create_announcement(body: AnnouncementCreateBody, admin: dict = Depends(get_current_admin)):
    current_time = now_iso()
    title = body.title.strip()
    message = body.message.strip()
    if len(title) < 2:
        raise HTTPException(status_code=422, detail="Заголовок має містити щонайменше 2 символи")
    if len(message) < 2:
        raise HTTPException(status_code=422, detail="Повідомлення має містити щонайменше 2 символи")
    team_id = str(body.team_id or "").strip() or None
    team_name = None
    if team_id:
        team = await db.teams.find_one({"id": team_id}, {"_id": 0, "id": 1, "name": 1})
        if not team:
            raise HTTPException(status_code=404, detail="Команду не знайдено")
        team_name = team.get("name")
    doc = {
        "id": str(uuid.uuid4()),
        "title": title,
        "message": message,
        "active": True,
        "team_id": team_id,
        "team_name": team_name,
        "created_by": admin["id"],
        "created_by_name": admin.get("name", "Адміністратор"),
        "created_at": current_time,
        "updated_at": current_time,
        "dismissed_count": 0,
    }
    await db.announcements.insert_one(doc)
    doc.pop("_id", None)
    return AnnouncementModel(**doc)


@api.patch("/admin/announcements/{announcement_id}", response_model=AnnouncementModel)
async def admin_update_announcement(
    announcement_id: str,
    body: AnnouncementUpdateBody,
    admin: dict = Depends(get_current_admin),
):
    supplied = body.model_fields_set
    if any(getattr(body, field) is None for field in supplied):
        raise HTTPException(status_code=422, detail="Поля повідомлення не можуть бути null")
    updates = {key: value for key, value in body.model_dump().items() if key in supplied}
    if "title" in updates:
        updates["title"] = updates["title"].strip()
        if len(updates["title"]) < 2:
            raise HTTPException(status_code=422, detail="Заголовок має містити щонайменше 2 символи")
    if "message" in updates:
        updates["message"] = updates["message"].strip()
        if len(updates["message"]) < 2:
            raise HTTPException(status_code=422, detail="Повідомлення має містити щонайменше 2 символи")
    if not updates:
        raise HTTPException(status_code=400, detail="Немає полів для оновлення")
    updates["updated_at"] = now_iso()
    result = await db.announcements.update_one({"id": announcement_id}, {"$set": updates})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Повідомлення не знайдено")
    doc = await db.announcements.find_one({"id": announcement_id}, {"_id": 0})
    return AnnouncementModel(**(await _announcement_with_stats(doc)))


@api.delete("/admin/announcements/{announcement_id}", status_code=204)
async def admin_delete_announcement(announcement_id: str, admin: dict = Depends(get_current_admin)):
    result = await db.announcements.delete_one({"id": announcement_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Повідомлення не знайдено")
    await db.announcement_reads.delete_many({"announcement_id": announcement_id})
    return None


# ────────────────────────────────────────────────────────────────────────
# Startup: seed admin, demo users, quests, prizes
# ────────────────────────────────────────────────────────────────────────
SEED_QUESTS = [
    {"title": "Прийняти 20 дзвінків", "description": "Без пропусків до кінця зміни", "difficulty": "easy", "reward": 50, "goal": 20, "icon": "phone-call"},
    {"title": "Оцінка 5 від клієнта", "description": "Отримай мінімум одну відмінну оцінку", "difficulty": "medium", "reward": 120, "goal": 1, "icon": "star"},
    {"title": "0 запізнень цього тижня", "description": "Тримай темп до п'ятниці", "difficulty": "medium", "reward": 150, "goal": 5, "icon": "clock"},
    {"title": "Допомогти новачку", "description": "Проведи 15 хв менторства", "difficulty": "hard", "reward": 250, "goal": 15, "icon": "graduation-cap"},
    {"title": "Закрити 3 складні кейси", "description": "Ескалації або довгі клієнти", "difficulty": "hard", "reward": 300, "goal": 3, "icon": "target"},
    {"title": "Оновити CRM без помилок", "description": "Всі картки клієнтів заповнені", "difficulty": "easy", "reward": 40, "goal": 8, "icon": "check-circle-2"},
]

AVATAR_PRIZES = [{"title": "Базовий аватар • Чоловічий", "description": "Базовий візуал. Щодня +0 Point", "price": 250, "category": "avatar", "image": "/avatars/male-basic-1.webp", "icon": "user-round", "stock": 999999, "avatar_code": "male-basic-1", "avatar_rarity": "basic", "daily_bonus": 0, "task_replacements": 0}, {"title": "Базовий аватар • Жіночий 1", "description": "Базовий візуал. Щодня +0 Point", "price": 250, "category": "avatar", "image": "/avatars/female-basic-1.webp", "icon": "user-round", "stock": 999999, "avatar_code": "female-basic-1", "avatar_rarity": "basic", "daily_bonus": 0, "task_replacements": 0}, {"title": "Базовий аватар • Жіночий 2", "description": "Базовий візуал. Щодня +0 Point", "price": 250, "category": "avatar", "image": "/avatars/female-basic-2.webp", "icon": "user-round", "stock": 999999, "avatar_code": "female-basic-2", "avatar_rarity": "basic", "daily_bonus": 0, "task_replacements": 0}, {"title": "Базовий аватар • Жіночий 3", "description": "Базовий візуал. Щодня +0 Point", "price": 250, "category": "avatar", "image": "/avatars/female-basic-3.webp", "icon": "user-round", "stock": 999999, "avatar_code": "female-basic-3", "avatar_rarity": "basic", "daily_bonus": 0, "task_replacements": 0}, {"title": "Покращений аватар • Чоловічий", "description": "Покращений візуал. Щодня +5 Point", "price": 500, "category": "avatar", "image": "/avatars/male-improved-1.webp", "icon": "user-round", "stock": 999999, "avatar_code": "male-improved-1", "avatar_rarity": "improved", "daily_bonus": 5, "task_replacements": 0}, {"title": "Покращений аватар • Жіночий 1", "description": "Покращений візуал. Щодня +5 Point", "price": 500, "category": "avatar", "image": "/avatars/female-improved-1.webp", "icon": "user-round", "stock": 999999, "avatar_code": "female-improved-1", "avatar_rarity": "improved", "daily_bonus": 5, "task_replacements": 0}, {"title": "Покращений аватар • Жіночий 2", "description": "Покращений візуал. Щодня +5 Point", "price": 500, "category": "avatar", "image": "/avatars/female-improved-2.webp", "icon": "user-round", "stock": 999999, "avatar_code": "female-improved-2", "avatar_rarity": "improved", "daily_bonus": 5, "task_replacements": 0}, {"title": "Покращений аватар • Жіночий 3", "description": "Покращений візуал. Щодня +5 Point", "price": 500, "category": "avatar", "image": "/avatars/female-improved-3.webp", "icon": "user-round", "stock": 999999, "avatar_code": "female-improved-3", "avatar_rarity": "improved", "daily_bonus": 5, "task_replacements": 0}, {"title": "Рідкісний аватар • Чоловічий", "description": "Рідкісний візуал. Щодня +10 Point", "price": 750, "category": "avatar", "image": "/avatars/male-rare-1.webp", "icon": "user-round", "stock": 999999, "avatar_code": "male-rare-1", "avatar_rarity": "rare", "daily_bonus": 10, "task_replacements": 0}, {"title": "Рідкісний аватар • Жіночий 1", "description": "Рідкісний візуал. Щодня +10 Point", "price": 750, "category": "avatar", "image": "/avatars/female-rare-1.webp", "icon": "user-round", "stock": 999999, "avatar_code": "female-rare-1", "avatar_rarity": "rare", "daily_bonus": 10, "task_replacements": 0}, {"title": "Рідкісний аватар • Жіночий 2", "description": "Рідкісний візуал. Щодня +10 Point", "price": 750, "category": "avatar", "image": "/avatars/female-rare-2.webp", "icon": "user-round", "stock": 999999, "avatar_code": "female-rare-2", "avatar_rarity": "rare", "daily_bonus": 10, "task_replacements": 0}, {"title": "Рідкісний аватар • Жіночий 3", "description": "Рідкісний візуал. Щодня +10 Point", "price": 750, "category": "avatar", "image": "/avatars/female-rare-3.webp", "icon": "user-round", "stock": 999999, "avatar_code": "female-rare-3", "avatar_rarity": "rare", "daily_bonus": 10, "task_replacements": 0}, {"title": "Епічний аватар • Чоловічий", "description": "Епічний візуал. Щодня +15 Point та +1 заміна завдань", "price": 1000, "category": "avatar", "image": "/avatars/male-epic-1.webp", "icon": "user-round", "stock": 999999, "avatar_code": "male-epic-1", "avatar_rarity": "epic", "daily_bonus": 15, "task_replacements": 1}, {"title": "Епічний аватар • Жіночий 1", "description": "Епічний візуал. Щодня +15 Point та +1 заміна завдань", "price": 1000, "category": "avatar", "image": "/avatars/female-epic-1.webp", "icon": "user-round", "stock": 999999, "avatar_code": "female-epic-1", "avatar_rarity": "epic", "daily_bonus": 15, "task_replacements": 1}, {"title": "Епічний аватар • Жіночий 2", "description": "Епічний візуал. Щодня +15 Point та +1 заміна завдань", "price": 1000, "category": "avatar", "image": "/avatars/female-epic-2.webp", "icon": "user-round", "stock": 999999, "avatar_code": "female-epic-2", "avatar_rarity": "epic", "daily_bonus": 15, "task_replacements": 1}, {"title": "Епічний аватар • Жіночий 3", "description": "Епічний візуал. Щодня +15 Point та +1 заміна завдань", "price": 1000, "category": "avatar", "image": "/avatars/female-epic-3.webp", "icon": "user-round", "stock": 999999, "avatar_code": "female-epic-3", "avatar_rarity": "epic", "daily_bonus": 15, "task_replacements": 1}, {"title": "Легендарний аватар • Чоловічий", "description": "Легендарний візуал. Щодня +25 Point та +2 заміна завдань", "price": 2000, "category": "avatar", "image": "/avatars/male-legendary-1.webp", "icon": "user-round", "stock": 999999, "avatar_code": "male-legendary-1", "avatar_rarity": "legendary", "daily_bonus": 25, "task_replacements": 2}, {"title": "Легендарний аватар • Жіночий 1", "description": "Легендарний візуал. Щодня +25 Point та +2 заміна завдань", "price": 2000, "category": "avatar", "image": "/avatars/female-legendary-1.webp", "icon": "user-round", "stock": 999999, "avatar_code": "female-legendary-1", "avatar_rarity": "legendary", "daily_bonus": 25, "task_replacements": 2}, {"title": "Легендарний аватар • Жіночий 2", "description": "Легендарний візуал. Щодня +25 Point та +2 заміна завдань", "price": 2000, "category": "avatar", "image": "/avatars/female-legendary-2.webp", "icon": "user-round", "stock": 999999, "avatar_code": "female-legendary-2", "avatar_rarity": "legendary", "daily_bonus": 25, "task_replacements": 2}, {"title": "Легендарний аватар • Жіночий 3", "description": "Легендарний візуал. Щодня +25 Point та +2 заміна завдань", "price": 2000, "category": "avatar", "image": "/avatars/female-legendary-3.webp", "icon": "user-round", "stock": 999999, "avatar_code": "female-legendary-3", "avatar_rarity": "legendary", "daily_bonus": 25, "task_replacements": 2}]

AVATAR_PRIZES.extend([
    {"title": "Базовий аватар • Жіночий 4", "description": "Базовий візуал. Щодня +0 Point", "price": 250, "category": "avatar", "image": "/avatars/female-basic-4.png", "icon": "user-round", "stock": 999999, "avatar_code": "female-basic-4", "avatar_rarity": "basic", "daily_bonus": 0, "task_replacements": 0},
    {"title": "Базовий аватар • Жіночий 5", "description": "Базовий візуал. Щодня +0 Point", "price": 250, "category": "avatar", "image": "/avatars/female-basic-5.png", "icon": "user-round", "stock": 999999, "avatar_code": "female-basic-5", "avatar_rarity": "basic", "daily_bonus": 0, "task_replacements": 0},
    {"title": "Покращений аватар • Жіночий 4", "description": "Покращений візуал. Щодня +5 Point", "price": 500, "category": "avatar", "image": "/avatars/female-improved-4.png", "icon": "user-round", "stock": 999999, "avatar_code": "female-improved-4", "avatar_rarity": "improved", "daily_bonus": 5, "task_replacements": 0},
    {"title": "Покращений аватар • Жіночий 5", "description": "Покращений візуал. Щодня +5 Point", "price": 500, "category": "avatar", "image": "/avatars/female-improved-5.png", "icon": "user-round", "stock": 999999, "avatar_code": "female-improved-5", "avatar_rarity": "improved", "daily_bonus": 5, "task_replacements": 0},
    {"title": "Рідкісний аватар • Жіночий 4", "description": "Рідкісний візуал. Щодня +10 Point", "price": 750, "category": "avatar", "image": "/avatars/female-rare-4.png", "icon": "user-round", "stock": 999999, "avatar_code": "female-rare-4", "avatar_rarity": "rare", "daily_bonus": 10, "task_replacements": 0},
    {"title": "Рідкісний аватар • Жіночий 5", "description": "Рідкісний візуал. Щодня +10 Point", "price": 750, "category": "avatar", "image": "/avatars/female-rare-5.png", "icon": "user-round", "stock": 999999, "avatar_code": "female-rare-5", "avatar_rarity": "rare", "daily_bonus": 10, "task_replacements": 0},
    {"title": "Епічний аватар • Жіночий 4", "description": "Епічний візуал. Щодня +15 Point та +1 заміна завдань", "price": 1000, "category": "avatar", "image": "/avatars/female-epic-4.png", "icon": "user-round", "stock": 999999, "avatar_code": "female-epic-4", "avatar_rarity": "epic", "daily_bonus": 15, "task_replacements": 1},
    {"title": "Епічний аватар • Жіночий 5", "description": "Епічний візуал. Щодня +15 Point та +1 заміна завдань", "price": 1000, "category": "avatar", "image": "/avatars/female-epic-5.png", "icon": "user-round", "stock": 999999, "avatar_code": "female-epic-5", "avatar_rarity": "epic", "daily_bonus": 15, "task_replacements": 1},
    {"title": "Легендарний аватар • Жіночий 4", "description": "Легендарний візуал. Щодня +25 Point та +2 заміни завдань", "price": 2000, "category": "avatar", "image": "/avatars/female-legendary-4.png", "icon": "user-round", "stock": 999999, "avatar_code": "female-legendary-4", "avatar_rarity": "legendary", "daily_bonus": 25, "task_replacements": 2},
    {"title": "Легендарний аватар • Жіночий 5", "description": "Легендарний візуал. Щодня +25 Point та +2 заміни завдань", "price": 2000, "category": "avatar", "image": "/avatars/female-legendary-5.png", "icon": "user-round", "stock": 999999, "avatar_code": "female-legendary-5", "avatar_rarity": "legendary", "daily_bonus": 25, "task_replacements": 2},
])

SEED_PRIZES = [
    {"title": "Худі VPDK Bonus", "description": "Фірмовий чорний худі з логотипом", "price": 2500, "category": "merch", "image": "https://images.pexels.com/photos/28701952/pexels-photo-28701952.jpeg", "icon": "gift", "stock": 12},
    {"title": "Додатковий вихідний", "description": "1 оплачуваний вихідний день", "price": 5000, "category": "privilege", "image": None, "icon": "calendar-off", "stock": 5},
    {"title": "Сертифікат Rozetka 500 ₴", "description": "На будь-які покупки", "price": 3000, "category": "certificate", "image": None, "icon": "gift", "stock": 20},
    {"title": "Вибір своєї зміни", "description": "На один тиждень обирай сам", "price": 2200, "category": "privilege", "image": None, "icon": "clock-4", "stock": 8},
    {"title": "Mystery Box", "description": "Випадковий приз з каталогу", "price": 1500, "category": "merch", "image": "https://images.unsplash.com/photo-1767522248089-468ec2d4efd7", "icon": "gift", "stock": 15},
    {"title": "Довга перерва +30 хв", "description": "Одноразово, на будь-який день", "price": 900, "category": "privilege", "image": None, "icon": "coffee", "stock": 30},
    {"title": "Сертифікат Rozetka 1000 ₴", "description": "На будь-які покупки", "price": 5800, "category": "certificate", "image": None, "icon": "gift", "stock": 10},
    {"title": "Кружка VPDK Bonus", "description": "Керамічна з неоновим принтом", "price": 800, "category": "merch", "image": "https://images.pexels.com/photos/33629664/pexels-photo-33629664.jpeg", "icon": "gift", "stock": 25},
]

SEED_DEMO_USERS = []

SEED_TEAMS = []


LEGACY_DEMO_TEAMS_MIGRATION_ID = "remove_legacy_demo_teams_v105"
LEGACY_DEMO_TEAM_NAMES = ["Продажі А", "Продажі A", "Продажі B", "Підтримка B", "Утримання"]


async def migrate_remove_legacy_demo_teams_v105() -> None:
    """Remove the four old seeded demo teams and detach their stale references once."""
    if await db.system_migrations.find_one({"id": LEGACY_DEMO_TEAMS_MIGRATION_ID}):
        return
    teams = await db.teams.find({"name": {"$in": LEGACY_DEMO_TEAM_NAMES}}, {"_id": 0, "id": 1, "name": 1}).to_list(20)
    team_ids = [team["id"] for team in teams]
    users_unassigned = 0
    prizes_globalized = 0
    if team_ids:
        users_result = await db.users.update_many(
            {"team_id": {"$in": team_ids}},
            {"$set": {"team_id": None, "is_team_leader": False}, "$unset": {"team_name": ""}},
        )
        users_unassigned = users_result.modified_count
        prizes_result = await db.prizes.update_many(
            {"team_id": {"$in": team_ids}},
            {"$set": {"team_id": None}, "$unset": {"team_name": ""}},
        )
        prizes_globalized = prizes_result.modified_count
        await db.team_goal_messages.delete_many({"team_id": {"$in": team_ids}})
        await db.teams.delete_many({"id": {"$in": team_ids}})
    await db.system_migrations.insert_one({
        "id": LEGACY_DEMO_TEAMS_MIGRATION_ID,
        "applied_at": now_iso(),
        "details": {
            "removed_teams": [team.get("name") for team in teams],
            "users_unassigned": users_unassigned,
            "prizes_globalized": prizes_globalized,
        },
    })
    logger.warning("Removed legacy demo teams: %s", ", ".join(team.get("name", "") for team in teams) or "none")



BONUS_MATCH_RESET_MIGRATION_ID = "bonus_match_v93_reset_all_to_level_1"


async def migrate_bonus_match_v93_reset() -> None:
    """One-time production migration that restarts every player at level 1.

    Completion history is removed so each level can grant its new first-clear
    reward exactly once. Wallet and XP balances earned elsewhere are preserved.
    """
    already_done = await db.system_migrations.find_one({"id": BONUS_MATCH_RESET_MIGRATION_ID})
    if already_done:
        return

    now = now_iso()
    completion_result = await db.bonus_match_completions.delete_many({})
    session_result = await db.bonus_match_sessions.delete_many({})
    daily_result = await db.bonus_match_daily.delete_many({})
    profile_result = await db.bonus_match_profiles.update_many(
        {},
        {
            "$set": {
                "current_level": 1,
                "total_stars": 0,
                "lives": BONUS_MATCH_MAX_LIVES,
                "lives_updated_at": now,
                "next_life_at": None,
                "updated_at": now,
            }
        },
    )
    await db.system_migrations.insert_one({
        "id": BONUS_MATCH_RESET_MIGRATION_ID,
        "applied_at": now,
        "details": {
            "profiles_reset": profile_result.modified_count,
            "completions_deleted": completion_result.deleted_count,
            "sessions_deleted": session_result.deleted_count,
            "daily_rows_deleted": daily_result.deleted_count,
        },
    })
    logger.warning(
        "Applied %s: profiles=%s completions=%s sessions=%s daily=%s",
        BONUS_MATCH_RESET_MIGRATION_ID,
        profile_result.modified_count,
        completion_result.deleted_count,
        session_result.deleted_count,
        daily_result.deleted_count,
    )


async def migrate_bonus_match_pixel_campaign() -> None:
    """Retire the previous catalog once. Version filters make retries non-destructive.

    Only Bonus Match progress is restarted; earned currency, XP, purchased
    boosters and Pixel's story/room are retained.
    """
    migration_id = "bonus_match_pixel_room_2026_09"
    if await db.system_migrations.find_one({"id": migration_id}):
        return
    old = {"campaign": {"$ne": BONUS_MATCH_CAMPAIGN}}
    await db.bonus_match_levels.delete_many(old)
    await db.bonus_match_completions.delete_many(old)
    await db.bonus_match_sessions.delete_many(old)
    await db.bonus_match_profiles.update_many(old, {"$set": {
        "campaign": BONUS_MATCH_CAMPAIGN, "current_level": 1, "total_stars": 0,
        "lives": BONUS_MATCH_MAX_LIVES, "lives_updated_at": now_iso(),
        "next_life_at": None, "updated_at": now_iso(),
    }})
    await db.system_migrations.update_one({"id": migration_id}, {"$setOnInsert": {
        "id": migration_id, "applied_at": now_iso(), "campaign": BONUS_MATCH_CAMPAIGN,
    }}, upsert=True)


async def seed_all():
    # Indexes
    await db.users.create_index("email", unique=True)
    await db.users.create_index("telegram_id", sparse=True)
    await db.users.create_index("team_id", sparse=True)
    await db.deleted_accounts.create_index("email", unique=True)
    await db.quests.create_index("created_at")
    await db.prizes.create_index("created_at")
    await db.orders.create_index("user_id")
    await db.orders.create_index("created_at")
    await db.transactions.create_index([("user_id", 1), ("created_at", -1)])
    await db.transactions.create_index("created_at")
    await db.daily_progress.create_index([("user_id", 1), ("date", 1)], unique=True)
    await db.daily_games.create_index([("user_id", 1), ("date", 1)], unique=True)
    await db.bonus_match_profiles.create_index("user_id", unique=True)
    await db.bonus_match_sessions.create_index([("user_id", 1), ("status", 1), ("created_at", -1)])
    await db.bonus_match_sessions.create_index([("status", 1), ("completed_at", -1)])
    await db.bonus_match_completions.create_index([("user_id", 1), ("level", 1)], unique=True)
    await db.bonus_match_daily.create_index([("user_id", 1), ("date", 1)], unique=True)
    await db.bonus_match_levels.create_index("level", unique=True)
    await db.daily_task_sets.create_index([("user_id", 1), ("date", 1)], unique=True)
    await db.daily_task_reviews.create_index([("user_id", 1), ("date", 1), ("task_id", 1)], unique=True)
    await db.teams.create_index("name", unique=True)
    await db.achievements.create_index("title", unique=True)
    await db.user_achievements.create_index([("user_id", 1), ("achievement_id", 1)], unique=True)
    await db.user_achievements.create_index("achievement_id")
    await db.xp_ledger.create_index("id", unique=True)
    await db.xp_ledger.create_index([("user_id", 1), ("created_at", -1)])
    await db.xp_ledger.create_index([("team_id", 1), ("created_at", -1)])
    await db.level_up_events.create_index("id", unique=True)
    await db.user_level_rewards.create_index("id", unique=True)
    await db.progression_reports.create_index("user_id", unique=True)
    await db.page_views.create_index([("created_at", -1), ("path", 1)])
    await db.page_views.create_index([("user_id", 1), ("created_at", -1)])
    await db.page_views.create_index([("date", 1), ("user_id", 1), ("path", 1)])
    await db.app_settings.create_index("id", unique=True)
    await db.team_goal_messages.create_index("team_id", unique=True)
    # v158: one team can own several independently configured banks.
    bank_indexes = await db.team_banks.index_information()
    legacy_team_bank_index = bank_indexes.get("team_id_1")
    if legacy_team_bank_index and legacy_team_bank_index.get("unique"):
        await db.team_banks.drop_index("team_id_1")
    cycle_indexes = await db.team_bank_cycles.index_information()
    legacy_cycle_index = cycle_indexes.get("team_id_1_cycle_number_-1")
    if legacy_cycle_index:
        await db.team_bank_cycles.drop_index("team_id_1_cycle_number_-1")
    await db.team_banks.create_index("id", unique=True)
    await db.team_banks.create_index([("team_id", 1), ("active", 1), ("created_at", 1)])
    await db.team_bank_contributions.create_index([("team_id", 1), ("created_at", -1)])
    await db.team_bank_contributions.create_index([("user_id", 1), ("team_id", 1)])
    await db.team_bank_contributions.create_index([("bank_id", 1), ("cycle_number", 1), ("created_at", -1)])
    await db.team_bank_contributions.create_index([("team_id", 1), ("cycle_number", 1), ("created_at", -1)])
    await db.team_bank_cycles.create_index(
        [("bank_id", 1), ("cycle_number", -1)],
        unique=True,
        partialFilterExpression={"bank_id": {"$type": "string"}},
    )
    await db.prizes.create_index("team_id", sparse=True)
    await db.prize_promotions.create_index([("prize_id", 1), ("active", 1), ("created_at", -1)])
    await db.prize_promotions.create_index("created_at")
    await db.announcements.create_index("id", unique=True)
    await db.announcements.create_index([("active", 1), ("team_id", 1), ("created_at", 1)])
    await db.announcement_reads.create_index([("announcement_id", 1), ("user_id", 1)], unique=True)
    await db.announcement_reads.create_index([("user_id", 1), ("dismissed_at", -1)])

    # Teams — only administrator-created teams are used in production.
    team_key_to_id = {}
    for t in SEED_TEAMS:
        existing = await db.teams.find_one({"name": t["name"]}, {"_id": 0, "id": 1})
        if existing:
            team_key_to_id[t["key"]] = existing["id"]
            continue
        doc = {
            "id": str(uuid.uuid4()),
            "name": t["name"],
            "description": t["description"],
            "color": t["color"],
            "department": t["department"],
            "leader_id": None,
            "created_at": now_iso(),
        }
        await db.teams.insert_one(doc)
        team_key_to_id[t["key"]] = doc["id"]
        logger.info("Seeded team: %s", t["name"])

    # Admin
    admin_doc = await db.users.find_one({"email": ADMIN_EMAIL})
    if not admin_doc:
        await db.users.insert_one({
            "id": str(uuid.uuid4()),
            "email": ADMIN_EMAIL,
            "password_hash": hash_password(ADMIN_PASSWORD),
            "auth_version": 0,
            "name": "Адміністратор",
            "first_name": "Головний",
            "last_name": "Адмін",
            "role": "admin",
            "department": "HR",
            "position": "Тімлід",
            "avatar_initials": "АД",
            "avatar_color": "#FF5C00",
            "avatar_url": None,
            "balance": 0, "total_earned": 0, "total_xp": 0, "streak": 0, "last_active_date": None,
            "phone": None, "telegram": None, "telegram_id": None,
            "team_id": None, "is_team_leader": False, "approved": True,
            "created_at": now_iso(),
        })
        logger.info("Seeded admin user: %s", ADMIN_EMAIL)
    else:
        if RESET_LOCAL_ADMIN_PASSWORD_ON_STARTUP:
            # Explicit opt-in for disposable local environments. Production keeps
            # the stored password because this flag is false by default.
            await db.users.update_one(
                {"email": ADMIN_EMAIL},
                {"$set": {
                    "password_hash": hash_password(ADMIN_PASSWORD),
                    "approved": True,
                }},
            )
            logger.warning("Reset local admin password from backend environment: %s", ADMIN_EMAIL)
        else:
            # ADMIN_PASSWORD is a bootstrap secret only. Never overwrite a password
            # changed from the admin panel during a deploy or process restart.
            logger.info("Admin user already exists; preserved the stored password")

    # Demo users are disabled by default in production.
    # Set SEED_DEMO_USERS=true only for a disposable demo environment.
    if SEED_DEMO_USERS_ENABLED:
        for u in SEED_DEMO_USERS:
            demo_email = str(u["email"]).strip().lower()
            if await db.deleted_accounts.find_one({"email": demo_email}, {"_id": 0, "email": 1}):
                logger.info("Skipped explicitly deleted demo user: %s", demo_email)
                continue
            existing = await db.users.find_one({"email": demo_email})
            team_id = team_key_to_id.get(u.get("team_key"))
            if existing:
                patch = {}
                if not existing.get("team_id") and team_id:
                    patch["team_id"] = team_id
                if not existing.get("first_name"):
                    patch["first_name"] = u.get("first_name", "")
                    patch["last_name"] = u.get("last_name", "")
                if u.get("is_team_leader") and not existing.get("is_team_leader"):
                    patch["is_team_leader"] = True
                if patch:
                    await db.users.update_one({"id": existing["id"]}, {"$set": patch})
                continue
            await db.users.insert_one({
                "id": str(uuid.uuid4()),
                "email": u["email"],
                "password_hash": hash_password(u["password"]),
                "auth_version": 0,
                "name": u["name"],
                "first_name": u.get("first_name", ""),
                "last_name": u.get("last_name", ""),
                "role": "employee",
                "department": u["department"],
                "position": u["position"],
                "avatar_initials": u["avatar_initials"],
                "avatar_color": u["avatar_color"],
                "avatar_url": None,
                "balance": u["balance"],
                "total_earned": u["total_earned"],
                "total_xp": u["total_xp"],
                "streak": u["streak"],
                "last_active_date": None,
                "phone": None, "telegram": None, "telegram_id": None,
                "team_id": team_id,
                "is_team_leader": u.get("is_team_leader", False),
                "approved": True,
                "created_at": now_iso(),
            })
            logger.info("Seeded demo user: %s", u["email"])

        # Set team leaders only when demo seeding is explicitly enabled.
        for u in SEED_DEMO_USERS:
            if u.get("is_team_leader"):
                demo_email = str(u["email"]).strip().lower()
                if await db.deleted_accounts.find_one({"email": demo_email}, {"_id": 0, "email": 1}):
                    continue
                team_id = team_key_to_id.get(u.get("team_key"))
                if team_id:
                    emp = await db.users.find_one({"email": demo_email}, {"_id": 0, "id": 1})
                    if emp:
                        await db.teams.update_one({"id": team_id}, {"$set": {"leader_id": emp["id"]}})

    # Quests
    if await db.quests.count_documents({}) == 0:
        for q in SEED_QUESTS:
            await db.quests.insert_one({"id": str(uuid.uuid4()), **q, "active": True, "created_at": now_iso()})
        logger.info("Seeded %d quests", len(SEED_QUESTS))

    # Prizes
    if await db.prizes.count_documents({}) == 0:
        for p in SEED_PRIZES:
            await db.prizes.insert_one({"id": str(uuid.uuid4()), **p, "active": True, "created_at": now_iso()})
        logger.info("Seeded %d prizes", len(SEED_PRIZES))

    # Avatar catalog is synchronized on every startup. Admin-edited prices remain untouched.
    for avatar in AVATAR_PRIZES:
        stable_id = f"avatar-{avatar['avatar_code']}"
        existing = await db.prizes.find_one({"id": stable_id}, {"_id": 0, "price": 1})
        update_fields = {**avatar, "active": True}
        update_fields.pop("price", None)
        await db.prizes.update_one(
            {"id": stable_id},
            {"$set": update_fields, "$setOnInsert": {"id": stable_id, "price": avatar["price"], "created_at": now_iso()}},
            upsert=True,
        )


# ════════════════════════════════════════════════════════════════════════
# PHASE 2 — Task Constructor + Applications (Заявки) + In-app Notifications
# ════════════════════════════════════════════════════════════════════════

FIELD_TYPES = [
    "text", "textarea", "number", "date", "phone", "email",
    "select", "checkbox", "file", "photo", "photos", "video",
]

TASK_CATEGORIES = ["sales", "support", "quality", "training", "discipline", "general"]

APPLICATION_STATUSES = ["draft", "submitted", "pending_review", "approved", "rejected"]


class TaskField(BaseModel):
    key: str
    label: str
    type: Literal["text", "textarea", "number", "date", "phone", "email",
                  "select", "checkbox", "file", "photo", "photos", "video"] = "text"
    required: bool = False
    placeholder: str = ""
    help_text: str = ""
    options: List[str] = []


class TaskModel(BaseModel):
    id: str
    title: str
    description: str = ""
    category: str = "general"
    icon: str = "clipboard-list"
    reward: int = 100
    xp: int = 50
    fields: List[TaskField] = []
    active: bool = True
    created_at: str


class TaskCreateBody(BaseModel):
    title: str
    description: str = ""
    category: str = "general"
    icon: str = "clipboard-list"
    reward: int = 100
    xp: int = 50
    fields: List[TaskField] = []
    active: bool = True


class TaskUpdateBody(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    icon: Optional[str] = None
    reward: Optional[int] = None
    xp: Optional[int] = None
    fields: Optional[List[TaskField]] = None
    active: Optional[bool] = None


class ApplicationModel(BaseModel):
    id: str
    task_id: str
    task_title: str
    task_category: str = "general"
    user_id: str
    user_name: str
    avatar_initials: str = ""
    avatar_color: str = "#FFB800"
    team_id: Optional[str] = None
    team_name: Optional[str] = None
    values: dict = {}
    status: Literal["draft", "submitted", "pending_review", "approved", "rejected"]
    reward: int = 0
    xp: int = 0
    reviewer_id: Optional[str] = None
    review_reason: str = ""
    created_at: str
    updated_at: str
    submitted_at: Optional[str] = None
    reviewed_at: Optional[str] = None


class ApplicationCreateBody(BaseModel):
    task_id: str
    values: dict = {}
    submit: bool = True


class ApplicationUpdateBody(BaseModel):
    values: Optional[dict] = None
    submit: Optional[bool] = None


class ReviewBody(BaseModel):
    action: Literal["approve", "reject"]
    reason: str = ""


class NotificationModel(BaseModel):
    id: str
    user_id: str
    kind: str
    category: str = "general"
    title: str
    body: str = ""
    link: str = ""
    icon: str = "bell"
    read: bool = False
    data: dict = Field(default_factory=dict)
    created_at: str


class PushSubscriptionBody(BaseModel):
    endpoint: str = Field(min_length=20, max_length=4096)
    expirationTime: Optional[float] = None
    keys: dict
    user_agent: str = Field(default="", max_length=500)


class PushPreferencesBody(BaseModel):
    push_enabled: bool = True
    points: bool = True
    achievements: bool = True
    prizes: bool = True
    orders: bool = True
    manager_messages: bool = True
    reports: bool = True
    games: bool = True
    ranking: bool = True
    scheduled_reminders: bool = True


class ReportPublishedWebhookBody(BaseModel):
    snapshot_version: str = Field(min_length=3, max_length=200)
    snapshot_updated_at: str = Field(default="", max_length=100)
    snapshot_day: str = Field(default="", max_length=20)
    updated_profiles: int = Field(default=0, ge=0, le=100000)
    credit_group_summaries: dict = Field(default_factory=dict)
    debit_group_summaries: dict = Field(default_factory=dict)
    deposit_group_summaries: dict = Field(default_factory=dict)
    deposit_projection_group_summaries: dict = Field(default_factory=dict)
    activation_pumb_group_summaries: dict = Field(default_factory=dict)
    activation_cards_group_summaries: dict = Field(default_factory=dict)
    activation_cards_transformation_group_summaries: dict = Field(default_factory=dict)


class ReportMetricSnapshotBody(BaseModel):
    snapshot_version: str = Field(min_length=3, max_length=200)
    snapshot_updated_at: str = Field(default="", max_length=100)
    credit_group_summaries: dict = Field(default_factory=dict)
    debit_group_summaries: dict = Field(default_factory=dict)
    deposit_group_summaries: dict = Field(default_factory=dict)
    deposit_projection_group_summaries: dict = Field(default_factory=dict)
    activation_pumb_group_summaries: dict = Field(default_factory=dict)
    activation_cards_group_summaries: dict = Field(default_factory=dict)
    activation_cards_transformation_group_summaries: dict = Field(default_factory=dict)


class OperatorReportMetricBody(BaseModel):
    key: str = Field(min_length=2, max_length=100)
    label: str = Field(min_length=2, max_length=160)
    value: Optional[float] = None
    unit: str = Field(default="number", max_length=20)


class OperatorReportSnapshotBody(BaseModel):
    snapshot_version: str = Field(min_length=1, max_length=200)
    snapshot_updated_at: str = Field(default="", max_length=100)
    report_type: str = Field(min_length=2, max_length=60)
    period: str = Field(default="month", max_length=40)
    segment: str = Field(default="overall", max_length=80)
    segment_label: str = Field(default="", max_length=120)
    metrics: List[OperatorReportMetricBody] = Field(default_factory=list)


# ─── Notification + Web Push helpers ───
PUSH_DEFAULTS = {
    "push_enabled": True,
    "points": True,
    "achievements": True,
    "prizes": True,
    "orders": True,
    "manager_messages": True,
    "reports": True,
    "games": True,
    "ranking": True,
    "scheduled_reminders": True,
}

KIND_TO_CATEGORY = {
    "points": "points",
    "achievement": "achievements",
    "new_prize": "prizes",
    "order_ready": "orders",
    "order_delivered": "orders",
    "order_cancelled": "orders",
    "order_processing": "orders",
    "manager_message": "manager_messages",
    "reports_updated": "reports",
    "game_level": "games",
    "ranking_change": "ranking",
    "team_bank": "prizes",
    "team_bank_goal": "prizes",
    "team_bank_reset": "prizes",
    "workday_start": "scheduled_reminders",
    "issuance_reminder": "scheduled_reminders",
}


def _notification_category(kind: str, category: Optional[str] = None) -> str:
    return category or KIND_TO_CATEGORY.get(kind, "general")


async def _push_preferences(user_id: str) -> dict:
    doc = await db.notification_preferences.find_one({"user_id": user_id}, {"_id": 0}) or {}
    return {**PUSH_DEFAULTS, **{key: bool(doc.get(key)) for key in PUSH_DEFAULTS if key in doc}}


def _send_webpush_sync(subscription: dict, payload: dict):
    if not webpush or not VAPID_PRIVATE_KEY or not VAPID_PUBLIC_KEY:
        return {"ok": False, "reason": "push_not_configured"}
    return webpush(
        subscription_info={
            "endpoint": subscription.get("endpoint"),
            "keys": subscription.get("keys") or {},
        },
        data=json.dumps(payload, ensure_ascii=False),
        vapid_private_key=VAPID_PRIVATE_KEY,
        vapid_claims={"sub": VAPID_SUBJECT},
        ttl=86400,
    )


async def _send_push_to_subscription(subscription: dict, payload: dict) -> bool:
    endpoint = subscription.get("endpoint")
    if not endpoint:
        return False
    try:
        await asyncio.to_thread(_send_webpush_sync, subscription, payload)
        await db.push_subscriptions.update_one(
            {"endpoint": endpoint},
            {"$set": {"last_success_at": now_iso(), "last_error": None}},
        )
        return True
    except Exception as exc:
        status_code = getattr(getattr(exc, "response", None), "status_code", None)
        if status_code in {404, 410}:
            await db.push_subscriptions.delete_one({"endpoint": endpoint})
        else:
            await db.push_subscriptions.update_one(
                {"endpoint": endpoint},
                {"$set": {"last_error": str(exc)[:500], "last_error_at": now_iso()}},
            )
        logger.warning("Web Push failed for endpoint %s: %s", endpoint[:80], exc)
        return False


async def _push_user(
    user_id: str,
    kind: str,
    title: str,
    body: str = "",
    link: str = "",
    icon: str = "bell",
    category: Optional[str] = None,
    data: Optional[dict] = None,
) -> int:
    if not webpush or not VAPID_PRIVATE_KEY or not VAPID_PUBLIC_KEY:
        return 0
    resolved_category = _notification_category(kind, category)
    preferences = await _push_preferences(user_id)
    if not preferences.get("push_enabled", True):
        return 0
    if resolved_category in PUSH_DEFAULTS and not preferences.get(resolved_category, True):
        return 0
    subscriptions = await db.push_subscriptions.find(
        {"user_id": user_id, "active": {"$ne": False}}, {"_id": 0}
    ).to_list(20)
    if not subscriptions:
        return 0
    payload = {
        "kind": kind,
        "category": resolved_category,
        "title": title,
        "body": body,
        "link": link or "/",
        "icon": "/icon-192.png",
        "badge": "/favicon-64.png",
        "tag": f"vpdk-{kind}",
        "data": data or {},
    }
    results = await asyncio.gather(
        *[_send_push_to_subscription(subscription, payload) for subscription in subscriptions],
        return_exceptions=True,
    )
    return sum(1 for result in results if result is True)


def _schedule_push(*args, **kwargs):
    try:
        task = asyncio.create_task(_push_user(*args, **kwargs))
        task.add_done_callback(lambda done: done.exception() if not done.cancelled() else None)
    except RuntimeError:
        pass


async def _notify(
    user_id: str,
    kind: str,
    title: str,
    body: str = "",
    link: str = "",
    icon: str = "bell",
    category: Optional[str] = None,
    data: Optional[dict] = None,
    push: bool = True,
):
    resolved_category = _notification_category(kind, category)
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "kind": kind,
        "category": resolved_category,
        "title": title,
        "body": body,
        "link": link,
        "icon": icon,
        "read": False,
        "data": data or {},
        "created_at": now_iso(),
    }
    await db.notifications.insert_one(doc)
    if push:
        _schedule_push(user_id, kind, title, body, link, icon, resolved_category, data or {})
    return doc


async def _notify_many(
    user_ids: List[str],
    kind: str,
    title: str,
    body: str = "",
    link: str = "",
    icon: str = "bell",
    category: Optional[str] = None,
    data: Optional[dict] = None,
    push: bool = True,
):
    user_ids = list(dict.fromkeys(str(value) for value in user_ids if value))
    if not user_ids:
        return 0
    resolved_category = _notification_category(kind, category)
    created_at = now_iso()
    docs = [{
        "id": str(uuid.uuid4()), "user_id": user_id, "kind": kind,
        "category": resolved_category, "title": title, "body": body,
        "link": link, "icon": icon, "read": False, "data": data or {},
        "created_at": created_at,
    } for user_id in user_ids]
    await db.notifications.insert_many(docs)
    if push:
        for user_id in user_ids:
            _schedule_push(user_id, kind, title, body, link, icon, resolved_category, data or {})
    return len(docs)


async def _notify_all_employees(kind: str, title: str, body: str = "", link: str = "", icon: str = "bell", category: Optional[str] = None, data: Optional[dict] = None, push: bool = True):
    user_ids = await db.users.distinct("id", {"role": {"$in": PLAYER_ROLES}, "approved": True})
    return await _notify_many(user_ids, kind, title, body, link, icon, category, data, push)


async def _notify_team(team_id: Optional[str], kind: str, title: str, body: str = "", link: str = "", icon: str = "bell", category: Optional[str] = None, data: Optional[dict] = None, push: bool = True):
    if not team_id:
        return 0
    user_ids = await db.users.distinct("id", {
        "team_id": team_id,
        "role": {"$in": PLAYER_ROLES},
        "approved": True,
    })
    return await _notify_many(user_ids, kind, title, body, link, icon, category, data, push)


async def _notify_admins(kind: str, title: str, body: str = "", link: str = "", icon: str = "bell"):
    user_ids = await db.users.distinct("id", {"role": "admin"})
    return await _notify_many(user_ids, kind, title, body, link, icon, push=True)


async def _notify_points_awarded(user_id: str, amount: int, description: str = ""):
    amount = int(amount or 0)
    if amount <= 0:
        return
    await _notify(
        user_id,
        "points",
        f"+{amount} Point на баланс",
        description or "Нараховано нові бали",
        "/history",
        "coins",
        "points",
        {"amount": amount},
    )


async def _maybe_notify_rank_change(user_id: str, period: str, rank: Optional[int], score: int = 0):
    if not rank:
        return
    key = f"{user_id}:{period}"
    previous = await db.leaderboard_positions.find_one({"id": key}, {"_id": 0})
    await db.leaderboard_positions.update_one(
        {"id": key},
        {"$set": {"id": key, "user_id": user_id, "period": period, "rank": int(rank), "score": int(score), "updated_at": now_iso()}},
        upsert=True,
    )
    old_rank = int(previous.get("rank", 0)) if previous else 0
    if not old_rank or old_rank == int(rank):
        return
    direction = "піднялися" if int(rank) < old_rank else "змістилися"
    period_label = {"day": "День", "week": "Тиждень", "month": "Місяць", "all": "Весь час"}.get(period, period)
    await _notify(
        user_id,
        "ranking_change",
        "Зміна позиції в рейтингу",
        f"Ви {direction} з #{old_rank} на #{int(rank)} · {period_label}.",
        f"/leaderboard?period={period}",
        "trending-up" if int(rank) < old_rank else "trending-down",
        "ranking",
        {"previous_rank": old_rank, "rank": int(rank), "period": period, "score": int(score)},
    )


async def _refresh_rank_change_notifications() -> int:
    users = await db.users.find(
        {"role": {"$in": PLAYER_ROLES}, "approved": {"$ne": False}},
        {"_id": 0, "id": 1, "name": 1, "balance": 1, "pet_reward_points_total": 1},
    ).to_list(5000)
    if not users:
        return 0

    user_ids = [str(item["id"]) for item in users]
    previous_rows = await db.leaderboard_positions.find(
        {"user_id": {"$in": user_ids}}, {"_id": 0}
    ).to_list(25000)
    previous_by_key = {str(row.get("id")): row for row in previous_rows}
    position_updates = []
    notifications = []
    store_spending = None
    pet_rewards = None
    timestamp = now_iso()

    for period in ("day", "week", "month", "all"):
        if period == "all":
            if store_spending is None or pet_rewards is None:
                store_spending, pet_rewards = await asyncio.gather(
                    _store_spending_by_user(),
                    _pet_rewards_by_user(),
                )
            scores = {
                str(item["id"]): (
                    int(item.get("balance", 0) or 0)
                    + store_spending.get(str(item["id"]), 0)
                    - max(
                        pet_rewards.get(str(item["id"]), 0),
                        int(item.get("pet_reward_points_total", 0) or 0),
                    )
                )
                for item in users
            }
        else:
            scores = await _transaction_scores(period)
        ordered = sorted(
            users,
            key=lambda item: (
                -scores.get(str(item["id"]), 0),
                str(item.get("name") or "").casefold(),
                str(item["id"]),
            ),
        )
        period_label = {"day": "День", "week": "Тиждень", "month": "Місяць", "all": "Весь час"}[period]
        for rank, item in enumerate(ordered, start=1):
            user_id = str(item["id"])
            key = f"{user_id}:{period}"
            score = int(scores.get(user_id, 0))
            previous = previous_by_key.get(key)
            old_rank = int(previous.get("rank", 0)) if previous else 0
            position_updates.append(UpdateOne(
                {"id": key},
                {"$set": {"id": key, "user_id": user_id, "period": period, "rank": rank, "score": score, "updated_at": timestamp}},
                upsert=True,
            ))
            if not old_rank or old_rank == rank:
                continue
            direction = "піднялися" if rank < old_rank else "змістилися"
            notification = {
                "id": str(uuid.uuid4()),
                "user_id": user_id,
                "kind": "ranking_change",
                "category": "ranking",
                "title": "Зміна позиції в рейтингу",
                "body": f"Ви {direction} з #{old_rank} на #{rank} · {period_label}.",
                "link": f"/leaderboard?period={period}",
                "icon": "trending-up" if rank < old_rank else "trending-down",
                "read": False,
                "data": {"previous_rank": old_rank, "rank": rank, "period": period, "score": score},
                "created_at": timestamp,
            }
            notifications.append(notification)

    if position_updates:
        await db.leaderboard_positions.bulk_write(position_updates, ordered=False)
    if notifications:
        await db.notifications.insert_many(notifications)
        for notification in notifications:
            _schedule_push(
                notification["user_id"], notification["kind"], notification["title"],
                notification["body"], notification["link"], notification["icon"],
                notification["category"], notification["data"],
            )
    return len(notifications)


def _clean_task(doc: dict) -> TaskModel:
    doc = {**doc}
    doc.pop("_id", None)
    return TaskModel(**doc)


def _clean_app(doc: dict) -> ApplicationModel:
    doc = {**doc}
    doc.pop("_id", None)
    doc.setdefault("task_category", "general")
    doc.setdefault("avatar_initials", "")
    doc.setdefault("avatar_color", "#FFB800")
    return ApplicationModel(**doc)


# ─── Employee: Tasks ───
@api.get("/tasks", response_model=List[TaskModel])
async def list_tasks(user: dict = Depends(get_current_user)):
    docs = await db.tasks.find({"active": True}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return [_clean_task(d) for d in docs]


@api.get("/tasks/{task_id}", response_model=TaskModel)
async def get_task(task_id: str, user: dict = Depends(get_current_user)):
    doc = await db.tasks.find_one({"id": task_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Завдання не знайдено")
    return _clean_task(doc)


# ─── Employee: Applications (заявки) ───
async def _build_application_doc(task: dict, user: dict, values: dict, status: str) -> dict:
    ts = now_iso()
    return {
        "id": str(uuid.uuid4()),
        "task_id": task["id"],
        "task_title": task["title"],
        "task_category": task.get("category", "general"),
        "user_id": user["id"],
        "user_name": user["name"],
        "avatar_initials": user.get("avatar_initials", ""),
        "avatar_color": user.get("avatar_color", "#FFB800"),
        "team_id": user.get("team_id"),
        "team_name": await _resolve_team_name(user.get("team_id")),
        "values": values,
        "status": status,
        "reward": int(task.get("reward", 0)),
        "xp": int(task.get("xp", 0)),
        "reviewer_id": None,
        "review_reason": "",
        "created_at": ts,
        "updated_at": ts,
        "submitted_at": ts if status == "submitted" else None,
        "reviewed_at": None,
    }


@api.get("/applications", response_model=List[ApplicationModel])
async def my_applications(user: dict = Depends(get_current_user)):
    docs = await db.applications.find({"user_id": user["id"]}, {"_id": 0}).sort("updated_at", -1).to_list(500)
    return [_clean_app(d) for d in docs]


@api.post("/applications", response_model=ApplicationModel, status_code=201)
async def create_application(body: ApplicationCreateBody, user: dict = Depends(get_current_user)):
    task = await db.tasks.find_one({"id": body.task_id, "active": True}, {"_id": 0})
    if not task:
        raise HTTPException(status_code=404, detail="Завдання не знайдено або неактивне")
    status_val = "submitted" if body.submit else "draft"
    doc = await _build_application_doc(task, user, body.values, status_val)
    await db.applications.insert_one(doc)
    if body.submit:
        await _notify_admins(
            "application_submitted", "Нова заявка на перевірку",
            f"{user['name']} → {task['title']}", "/admin", "inbox",
        )
    return _clean_app(doc)


@api.patch("/applications/{app_id}", response_model=ApplicationModel)
async def update_application(app_id: str, body: ApplicationUpdateBody, user: dict = Depends(get_current_user)):
    app_doc = await db.applications.find_one({"id": app_id, "user_id": user["id"]}, {"_id": 0})
    if not app_doc:
        raise HTTPException(status_code=404, detail="Заявку не знайдено")
    if app_doc["status"] not in ("draft", "rejected"):
        raise HTTPException(status_code=400, detail="Цю заявку вже не можна редагувати")
    updates = {"updated_at": now_iso()}
    if body.values is not None:
        updates["values"] = body.values
    if body.submit:
        updates["status"] = "submitted"
        updates["submitted_at"] = now_iso()
        updates["review_reason"] = ""
    await db.applications.update_one({"id": app_id}, {"$set": updates})
    if body.submit:
        await _notify_admins(
            "application_submitted", "Заявку повторно надіслано",
            f"{user['name']} → {app_doc['task_title']}", "/admin", "inbox",
        )
    fresh = await db.applications.find_one({"id": app_id}, {"_id": 0})
    return _clean_app(fresh)


@api.delete("/applications/{app_id}", status_code=204)
async def delete_application(app_id: str, user: dict = Depends(get_current_user)):
    app_doc = await db.applications.find_one({"id": app_id, "user_id": user["id"]}, {"_id": 0})
    if not app_doc:
        raise HTTPException(status_code=404, detail="Заявку не знайдено")
    if app_doc["status"] not in ("draft", "rejected"):
        raise HTTPException(status_code=400, detail="Можна видаляти лише чернетки або відхилені заявки")
    await db.applications.delete_one({"id": app_id})
    return None


# ─── Notifications ───
@api.get("/notifications", response_model=List[NotificationModel])
async def list_notifications(limit: int = 50, user: dict = Depends(get_current_user)):
    docs = await db.notifications.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return [NotificationModel(**{k: v for k, v in d.items() if k != "_id"}) for d in docs]


@api.get("/notifications/unread_count")
async def unread_count(user: dict = Depends(get_current_user)):
    n = await db.notifications.count_documents({"user_id": user["id"], "read": False})
    return {"count": n}


@api.post("/notifications/read-all")
async def mark_all_read(user: dict = Depends(get_current_user)):
    await db.notifications.update_many({"user_id": user["id"], "read": False}, {"$set": {"read": True}})
    return {"ok": True}


@api.patch("/notifications/{notif_id}/read")
async def mark_read(notif_id: str, user: dict = Depends(get_current_user)):
    await db.notifications.update_one({"id": notif_id, "user_id": user["id"]}, {"$set": {"read": True}})
    return {"ok": True}


# ─── Push subscriptions, preferences and notification center ───
@api.get("/push/config")
async def push_config(user: dict = Depends(get_current_user)):
    return {
        "supported": bool(webpush and VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY),
        "public_key": VAPID_PUBLIC_KEY,
    }


@api.get("/push/preferences")
async def get_push_preferences(user: dict = Depends(get_current_user)):
    preferences = await _push_preferences(user["id"])
    subscription_count = await db.push_subscriptions.count_documents({
        "user_id": user["id"], "active": {"$ne": False}
    })
    return {**preferences, "subscription_count": subscription_count}


@api.put("/push/preferences")
async def update_push_preferences(body: PushPreferencesBody, user: dict = Depends(get_current_user)):
    payload = body.model_dump()
    payload.update({"user_id": user["id"], "updated_at": now_iso()})
    await db.notification_preferences.update_one(
        {"user_id": user["id"]}, {"$set": payload}, upsert=True
    )
    return payload


@api.post("/push/subscribe", status_code=201)
async def subscribe_push(body: PushSubscriptionBody, user: dict = Depends(get_current_user)):
    if not webpush or not VAPID_PUBLIC_KEY or not VAPID_PRIVATE_KEY:
        raise HTTPException(status_code=503, detail="Web Push ще не налаштовано на сервері")
    keys = body.keys or {}
    if not keys.get("p256dh") or not keys.get("auth"):
        raise HTTPException(status_code=422, detail="Некоректна Push-підписка")
    now = now_iso()
    await db.push_subscriptions.update_one(
        {"endpoint": body.endpoint},
        {"$set": {
            "id": str(uuid.uuid4()),
            "user_id": user["id"],
            "endpoint": body.endpoint,
            "expiration_time": body.expirationTime,
            "keys": {"p256dh": keys.get("p256dh"), "auth": keys.get("auth")},
            "user_agent": body.user_agent,
            "active": True,
            "updated_at": now,
        }, "$setOnInsert": {"created_at": now}},
        upsert=True,
    )
    await db.notification_preferences.update_one(
        {"user_id": user["id"]},
        {"$setOnInsert": {"user_id": user["id"], **PUSH_DEFAULTS, "created_at": now}},
        upsert=True,
    )
    return {"ok": True}


@api.delete("/push/unsubscribe")
async def unsubscribe_push(endpoint: Optional[str] = None, user: dict = Depends(get_current_user)):
    query = {"user_id": user["id"]}
    if endpoint:
        query["endpoint"] = endpoint
    result = await db.push_subscriptions.delete_many(query)
    return {"ok": True, "removed": result.deleted_count}


@api.post("/push/test")
async def test_push(user: dict = Depends(get_current_user)):
    sent = await _push_user(
        user["id"], "test", "VPDK Bonus готовий до сповіщень",
        "Тест успішний. Важливі події та нагадування тепер можуть з’являтися навіть із закритою PWA.",
        "/", "bell", "general", {"test": True},
    )
    if not sent:
        raise HTTPException(status_code=400, detail="Немає активної Push-підписки або сповіщення вимкнені")
    return {"ok": True, "sent": sent}


@api.post("/internal/push-schedule")
async def run_push_schedule(x_scheduler_token: str = Header(default="", alias="X-Scheduler-Token")):
    if not PUSH_SCHEDULER_TOKEN or x_scheduler_token != PUSH_SCHEDULER_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid scheduler token")
    now = datetime.now(KYIV_TZ)
    hour = now.hour
    ranking_notifications = await _refresh_rank_change_notifications()
    schedule = {
        9: {
            "kind": "workday_start",
            "title": "Доброго ранку! Час увімкнути робочий ритм ☀️",
            "body": "Перевір графік і цілі, визнач пріоритет на день та починай із найважливішого.",
            "link": "/",
            "icon": "sunrise",
        },
        12: {
            "kind": "issuance_reminder",
            "title": "Проміжна точка: онови табличку видач",
            "body": "Занеси актуальні видачі, щоб командний звіт залишався точним.",
            "link": "/goals/debit/me",
            "icon": "clipboard-list",
        },
        15: {
            "kind": "issuance_reminder",
            "title": "Час звірити видачі",
            "body": "Онови табличку видач перед фінальним відрізком робочого дня.",
            "link": "/goals/debit/me",
            "icon": "clipboard-list",
        },
        17: {
            "kind": "issuance_reminder",
            "title": "Фінальне оновлення таблички видач",
            "body": "Перевір, чи всі сьогоднішні видачі внесені. Нехай підсумок дня буде без білих плям.",
            "link": "/goals/debit/me",
            "icon": "check-circle-2",
        },
    }
    item = schedule.get(hour)
    if not item:
        return {"ok": True, "sent": 0, "ranking_notifications": ranking_notifications, "skipped": "not_target_hour", "kyiv_time": now.isoformat()}
    run_key = f"{now.strftime('%Y-%m-%d')}:{hour:02d}"
    claimed = await db.scheduled_push_runs.update_one(
        {"id": run_key},
        {"$setOnInsert": {"id": run_key, "created_at": now_iso(), "kyiv_time": now.isoformat()}},
        upsert=True,
    )
    if claimed.upserted_id is None:
        return {"ok": True, "sent": 0, "ranking_notifications": ranking_notifications, "skipped": "already_sent", "run_key": run_key}
    count = await _notify_all_employees(
        item["kind"], item["title"], item["body"], item["link"], item["icon"],
        "scheduled_reminders", {"scheduled_hour": hour, "run_key": run_key}, True,
    )
    return {"ok": True, "sent": count, "ranking_notifications": ranking_notifications, "run_key": run_key, "kyiv_time": now.isoformat()}


def _report_metric_number(value):
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip().replace("\u00a0", "").replace(" ", "").replace("%", "").replace(",", ".")
    try:
        return float(text)
    except (TypeError, ValueError):
        return None


def _summary_team_value(source: dict, raw_key: str, team_key: str) -> dict:
    if not isinstance(source, dict):
        return {}
    return source.get(raw_key) or source.get(team_key) or {}


def _period_summary_team_value(source: dict, period: str, raw_key: str, team_key: str) -> dict:
    period_map = source.get(period) if isinstance(source, dict) else {}
    return _summary_team_value(period_map or {}, raw_key, team_key)


def _summary_keys(source: dict) -> set:
    return set(source.keys()) if isinstance(source, dict) else set()


def _period_summary_keys(source: dict) -> set:
    result = set()
    if not isinstance(source, dict):
        return result
    for period_map in source.values():
        if isinstance(period_map, dict):
            result.update(period_map.keys())
    return result


async def _store_report_metric_snapshots(body: ReportPublishedWebhookBody | ReportMetricSnapshotBody):
    snapshot_version = body.snapshot_version
    snapshot_updated_at = body.snapshot_updated_at or now_iso()
    teams = await db.teams.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(500)
    team_by_key = {_normalize_team_report_key(team.get("name")): team for team in teams}
    credit = body.credit_group_summaries or {}
    debit = body.debit_group_summaries or {}
    deposit = body.deposit_group_summaries or {}
    deposit_projection = body.deposit_projection_group_summaries or {}
    activation_pumb = body.activation_pumb_group_summaries or {}
    activation_cards = body.activation_cards_group_summaries or {}
    activation_cards_transformation = body.activation_cards_transformation_group_summaries or {}
    all_keys = (
        _summary_keys(credit)
        | _summary_keys(debit)
        | _summary_keys(deposit)
        | _summary_keys(deposit_projection)
        | _summary_keys(activation_cards)
        | _period_summary_keys(activation_pumb)
        | _period_summary_keys(activation_cards_transformation)
    )
    for raw_key in all_keys:
        team_key = _normalize_team_report_key(raw_key)
        team = team_by_key.get(team_key) or {}
        c = _summary_team_value(credit, raw_key, team_key)
        d = _summary_team_value(debit, raw_key, team_key)
        dep = _summary_team_value(deposit, raw_key, team_key)
        dep_projection = _summary_team_value(deposit_projection, raw_key, team_key)
        pumb_month = _period_summary_team_value(activation_pumb, "month", raw_key, team_key)
        pumb_yesterday = _period_summary_team_value(activation_pumb, "yesterday", raw_key, team_key)
        cards_projection = _summary_team_value(activation_cards, raw_key, team_key)
        cards_month = _period_summary_team_value(activation_cards_transformation, "month", raw_key, team_key)
        cards_yesterday = _period_summary_team_value(activation_cards_transformation, "yesterday", raw_key, team_key)
        timestamp = now_iso()
        await db.report_metric_snapshots.update_one(
            {"snapshot_version": snapshot_version, "team_key": team_key},
            {
                "$set": {
                    "snapshot_version": snapshot_version,
                    "snapshot_updated_at": snapshot_updated_at,
                    "team_key": team_key,
                    "team_id": team.get("id"),
                    "team_name": team.get("name") or raw_key,
                    "credit_overall": _report_metric_number(c.get("overall")),
                    "debit_overall": _report_metric_number(d.get("overall")),
                    "deposit_overall": _report_metric_number(dep.get("overall")),
                    "deposit_projection_overall": _report_metric_number(dep_projection.get("projective_rate") or dep_projection.get("overall")),
                    "credit": c,
                    "debit": d,
                    "deposit": dep,
                    "deposit_projection": dep_projection,
                    "activation_pumb": {"month": pumb_month, "yesterday": pumb_yesterday},
                    "activation_cards": cards_projection,
                    "activation_cards_transformation": {"month": cards_month, "yesterday": cards_yesterday},
                    "updated_at": timestamp,
                },
                "$setOnInsert": {"created_at": timestamp},
            },
            upsert=True,
        )


@api.post("/internal/reports-published")
async def reports_published(
    body: ReportPublishedWebhookBody,
    x_reports_token: str = Header(default="", alias="X-Reports-Token"),
):
    if not REPORTS_WEBHOOK_TOKEN or x_reports_token != REPORTS_WEBHOOK_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid reports webhook token")
    inserted = await db.report_publications.update_one(
        {"snapshot_version": body.snapshot_version},
        {"$setOnInsert": {**body.model_dump(), "created_at": now_iso()}},
        upsert=True,
    )
    await _store_report_metric_snapshots(body)
    if inserted.upserted_id is None:
        return {"ok": True, "duplicate": True}
    await _notify_all_employees(
        "reports_updated",
        "Звіти оновлено",
        f"Опубліковано новий знімок показників{(' · ' + body.snapshot_updated_at) if body.snapshot_updated_at else ''}.",
        "/goals",
        "bar-chart-3",
        "reports",
        {"snapshot_version": body.snapshot_version},
        True,
    )
    return {"ok": True, "duplicate": False}


@api.post("/analytics/report-snapshot")
async def save_report_metric_snapshot(body: ReportMetricSnapshotBody, user: dict = Depends(get_current_user)):
    if user.get("role") != "admin" and not user.get("is_team_leader"):
        raise HTTPException(status_code=403, detail="Зберігати аналітичний знімок може лише керівник або адміністратор")
    await _store_report_metric_snapshots(body)
    return {"ok": True}


def _operator_metric_value(value) -> Optional[float]:
    if value is None:
        return None
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(numeric) or math.isinf(numeric):
        return None
    return round(numeric, 4)


def _safe_operator_report_key(value: str, fallback: str) -> str:
    source = re.sub(r"[^a-zA-Z0-9_-]+", "_", str(value or "").strip()).strip("_")
    return source[:80] or fallback


@api.post("/analytics/operator-report-snapshot")
async def save_operator_report_snapshot(body: OperatorReportSnapshotBody, user: dict = Depends(get_current_user)):
    if user.get("role") not in PLAYER_ROLES and user.get("role") not in {"admin", "editor"}:
        raise HTTPException(status_code=403, detail="Знімок звіту доступний лише працівнику")

    metrics = []
    for metric in body.metrics or []:
        value = _operator_metric_value(metric.value)
        if value is None:
            continue
        metrics.append({
            "key": metric.key,
            "label": metric.label,
            "value": value,
            "unit": metric.unit or "number",
        })
    if not metrics:
        return {"ok": True, "skipped": True}

    # v150: one MongoDB document per employee per Kyiv calendar day.
    # If reports are refreshed 2–3 times during the same day, only the latest
    # value for each direction/period/segment is kept. The chart therefore has
    # exactly one point per day instead of separate points for different hours.
    date_key = kyiv_today_key()
    report_key = _safe_operator_report_key(body.report_type, "report")
    period_key = _safe_operator_report_key(body.period, "month")
    segment_key = _safe_operator_report_key(body.segment, "overall")
    report_path = f"reports.{report_key}.{period_key}.{segment_key}"
    timestamp = now_iso()
    payload = {
        "snapshot_version": body.snapshot_version,
        "snapshot_updated_at": body.snapshot_updated_at or timestamp,
        "report_type": body.report_type,
        "period": body.period,
        "segment": body.segment,
        "segment_label": body.segment_label or body.segment,
        "metrics": metrics,
        "updated_at": timestamp,
    }
    await db.operator_report_daily.update_one(
        {"user_id": user.get("id"), "date_key": date_key},
        {
            "$set": {
                "user_id": user.get("id"),
                "user_name": user.get("name"),
                "team_id": user.get("team_id"),
                "team_name": user.get("team_name"),
                "goals_login": user.get("goals_login"),
                "date_key": date_key,
                report_path: payload,
                "updated_at": timestamp,
            },
            "$setOnInsert": {"created_at": timestamp},
        },
        upsert=True,
    )
    return {"ok": True, "saved": len(metrics), "date_key": date_key, "daily_document": True}


def _daily_report_payload(document: dict, report_type: str, period: str, segment: str) -> Optional[dict]:
    report_key = _safe_operator_report_key(report_type, "report")
    period_key = _safe_operator_report_key(period, "month")
    segment_key = _safe_operator_report_key(segment, "overall")
    return (((document.get("reports") or {}).get(report_key) or {}).get(period_key) or {}).get(segment_key)


@api.get("/analytics/operator-report-trends")
async def operator_report_trends(
    report_type: str,
    period: str = "month",
    segment: str = "overall",
    limit: int = 30,
    user: dict = Depends(get_current_user),
):
    safe_limit = max(1, min(int(limit or 30), 90))
    # Fetch a few extra daily documents because a worker may not have opened
    # every direction on every day. We still return at most `safe_limit` points.
    scan_limit = min(365, max(safe_limit * 4, safe_limit))
    docs = await db.operator_report_daily.find(
        {"user_id": user.get("id")},
        {"_id": 0},
    ).sort("date_key", -1).limit(scan_limit).to_list(scan_limit)

    records = []
    for document in docs:
        payload = _daily_report_payload(document, report_type, period, segment)
        if not payload:
            continue
        records.append({
            "date_key": document.get("date_key"),
            "snapshot_version": payload.get("snapshot_version"),
            # Use date_key as the chart date, so multiple refresh hours never
            # create duplicate x-axis labels for the same calendar day.
            "snapshot_updated_at": document.get("date_key"),
            "last_refresh_at": payload.get("snapshot_updated_at"),
            "report_type": payload.get("report_type", report_type),
            "period": payload.get("period", period),
            "segment": payload.get("segment", segment),
            "segment_label": payload.get("segment_label", segment),
            "metrics": payload.get("metrics") or [],
            "updated_at": payload.get("updated_at") or document.get("updated_at"),
        })
        if len(records) >= safe_limit:
            break
    records.reverse()
    return {
        "report_type": report_type,
        "period": period,
        "segment": segment,
        "records": records,
        "storage_mode": "one_daily_document_per_employee",
    }


def _snapshot_date_key(snapshot_updated_at: str, created_at: str = "") -> str:
    candidates = [str(snapshot_updated_at or "").strip(), str(created_at or "").strip()]
    for value in candidates:
        if not value:
            continue
        iso_match = re.match(r"^(\d{4})-(\d{2})-(\d{2})", value)
        if iso_match:
            return f"{iso_match.group(1)}-{iso_match.group(2)}-{iso_match.group(3)}"
        ua_match = re.match(r"^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})", value)
        if ua_match:
            return f"{ua_match.group(3)}-{int(ua_match.group(2)):02d}-{int(ua_match.group(1)):02d}"
    return ""


def _team_projection_value(document: dict, report_type: str, period: str) -> Optional[float]:
    if report_type == "credit":
        return _report_metric_number((document.get("credit") or {}).get("overall") or document.get("credit_overall"))
    if report_type == "debit":
        return _report_metric_number((document.get("debit") or {}).get("overall") or document.get("debit_overall"))
    if report_type == "deposit":
        projection = document.get("deposit_projection") or {}
        return _report_metric_number(projection.get("projective_rate") or projection.get("overall") or document.get("deposit_projection_overall"))
    if report_type == "activation_pumb":
        summary = ((document.get("activation_pumb") or {}).get(period) or {})
        return _report_metric_number(summary.get("projective_rate") or summary.get("overall"))
    if report_type == "activation_cards":
        if period == "month":
            projection = document.get("activation_cards") or {}
            value = _report_metric_number(projection.get("projective_rate") or projection.get("overall"))
            if value is not None:
                return value
        summary = ((document.get("activation_cards_transformation") or {}).get(period) or {})
        return _report_metric_number(summary.get("projective_rate") or summary.get("overall"))
    return None


@api.get("/analytics/team-report-trends")
async def team_report_trends(
    report_type: Literal["credit", "debit", "deposit", "activation_pumb", "activation_cards"],
    period: Literal["month", "yesterday"] = "month",
    team_id: Optional[str] = None,
    limit: int = 30,
    user: dict = Depends(get_current_user),
):
    settings = await _goals_settings()
    privileged = user.get("role") in {"admin", "editor"}
    allow_cross_team = privileged or bool(settings.get("allow_cross_team_reports"))
    selected_team_id = team_id if team_id and allow_cross_team else user.get("team_id")
    if not selected_team_id:
        return {"report_type": report_type, "period": period, "team_id": None, "records": []}

    team = await db.teams.find_one({"id": selected_team_id}, {"_id": 0, "id": 1, "name": 1})
    if not team:
        return {"report_type": report_type, "period": period, "team_id": selected_team_id, "records": []}
    team_key = _normalize_team_report_key(team.get("name"))
    safe_limit = max(1, min(int(limit or 30), 90))
    docs = await db.report_metric_snapshots.find(
        {"$or": [{"team_id": selected_team_id}, {"team_key": team_key}]},
        {"_id": 0},
    ).sort("created_at", -1).limit(min(500, safe_limit * 8)).to_list(min(500, safe_limit * 8))

    # Keep one point per Kyiv calendar day. If reports are published several times
    # during a day, the newest snapshot wins instead of creating hour-based labels.
    by_day = {}
    for document in reversed(docs):
        value = _team_projection_value(document, report_type, period)
        if value is None:
            continue
        date_key = _snapshot_date_key(document.get("snapshot_updated_at"), document.get("created_at"))
        if not date_key:
            continue
        by_day[date_key] = {
            "date_key": date_key,
            "snapshot_version": document.get("snapshot_version"),
            "snapshot_updated_at": date_key,
            "last_refresh_at": document.get("snapshot_updated_at"),
            "report_type": report_type,
            "period": period,
            "segment": "team",
            "segment_label": team.get("name") or "Команда",
            "metrics": [{
                "key": "projective_rate",
                "label": "Проекційний підсумок групи",
                "value": value,
                "unit": "percent",
            }],
            "updated_at": document.get("updated_at") or document.get("created_at"),
        }
    records = [by_day[key] for key in sorted(by_day.keys())][-safe_limit:]
    return {
        "report_type": report_type,
        "period": period,
        "team_id": selected_team_id,
        "team_name": team.get("name"),
        "records": records,
        "storage_mode": "one_team_point_per_day",
    }


REPORT_VIEW_KEYS = {
    "overview",
    "credit_leaderboard",
    "credit_xsell_month", "credit_xsell_yesterday",
    "credit_web_apps_month", "credit_web_apps_yesterday",
    "credit_inb_month", "credit_inb_yesterday",
    "debit_leaderboard", "debit_issuances_month", "debit_issuances_yesterday",
    "deposit_projection", "deposit_metrics_month", "deposit_metrics_yesterday",
    "deposit_giving_month", "deposit_giving_yesterday",
    "activation_pumb_month", "activation_pumb_yesterday",
    "activation_cards_month", "activation_cards_yesterday",
}


def _report_view_key(path_value: str) -> str:
    raw = str(path_value or "")
    pathname, _, query = raw.partition("?")
    params = parse_qs(query)
    period = (params.get("period") or ["month"])[0]
    period = "yesterday" if period == "yesterday" else "month"
    if pathname == "/goals":
        return "overview"
    if pathname == "/goals/credit":
        return "credit_leaderboard"
    if pathname == "/goals/credit/me":
        raw_channel = (params.get("channel") or ["xsell"])[0].lower().replace("-", "_")
        channel = {"x_sell": "xsell", "xsell": "xsell", "web": "web_apps", "web_apps": "web_apps", "inb": "inb"}.get(raw_channel, "xsell")
        return f"credit_{channel}_{period}"
    if pathname == "/goals/debit":
        return "debit_leaderboard"
    if pathname == "/goals/debit/me":
        return f"debit_issuances_{period}"
    if pathname == "/goals/deposit":
        return "deposit_projection"
    if pathname == "/goals/deposit/me":
        return f"deposit_metrics_{period}"
    if pathname == "/goals/deposit/issuances":
        return f"deposit_giving_{period}"
    if pathname == "/goals/activation/pumb":
        return f"activation_pumb_{period}"
    if pathname == "/goals/activation/cards":
        return f"activation_cards_{period}"
    return ""


# ─── Manager analytics ───
def _manager_period_bounds(period: str) -> tuple[str, str]:
    now = datetime.now(timezone.utc)
    if period == "day":
        return kyiv_day_bounds_utc(kyiv_today_key())
    days = 7 if period == "week" else 30
    return (now - timedelta(days=days)).isoformat(), now.isoformat()


async def _get_manager_scope(user: dict, requested_team_id: Optional[str]) -> tuple[Optional[str], List[dict], List[dict]]:
    privileged = user.get("role") == "admin"
    if not privileged and not user.get("is_team_leader"):
        raise HTTPException(status_code=403, detail="Аналітика доступна керівнику команди або адміністратору")
    teams = await db.teams.find({}, {"_id": 0}).sort("name", 1).to_list(500)
    team_id = requested_team_id if privileged and requested_team_id else user.get("team_id")
    if not team_id and not privileged:
        raise HTTPException(status_code=400, detail="Керівника не прив’язано до команди")
    member_query = {"role": {"$in": PLAYER_ROLES}, "approved": {"$ne": False}}
    if team_id:
        member_query["team_id"] = team_id
    members = await db.users.find(member_query, {
        "_id": 0, "id": 1, "name": 1, "team_id": 1, "last_active_date": 1,
        "avatar_initials": 1, "avatar_color": 1, "goals_login": 1,
    }).sort("name", 1).to_list(5000)
    return team_id, members, teams


@api.get("/manager-analytics")
async def manager_analytics(
    period: Literal["day", "week", "month"] = "week",
    team_id: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    selected_team_id, members, teams = await _get_manager_scope(user, team_id)
    start, end = _manager_period_bounds(period)
    member_ids = [member["id"] for member in members]
    team_map = {team["id"]: team for team in teams}

    views = await db.page_views.find(
        {"user_id": {"$in": member_ids}, "created_at": {"$gte": start, "$lt": end}},
        {"_id": 0, "user_id": 1, "path": 1, "created_at": 1},
    ).sort("created_at", 1).to_list(100000)
    active_ids = set(view.get("user_id") for view in views)
    report_ids = set(view.get("user_id") for view in views if str(view.get("path") or "").startswith("/goals"))
    report_views_by_user = {}
    for view in views:
        report_key = _report_view_key(view.get("path"))
        if not report_key or report_key not in REPORT_VIEW_KEYS:
            continue
        user_views = report_views_by_user.setdefault(view.get("user_id"), {})
        created_at = view.get("created_at")
        previous = user_views.get(report_key)
        if not previous or str(created_at or "") >= str(previous or ""):
            user_views[report_key] = created_at
    last_view_pipeline = [
        {"$match": {"user_id": {"$in": member_ids}}},
        {"$group": {"_id": "$user_id", "last_seen": {"$max": "$created_at"}}},
    ]
    last_seen_rows = await db.page_views.aggregate(last_view_pipeline).to_list(5000)
    last_seen = {row["_id"]: row.get("last_seen") for row in last_seen_rows}

    tx_pipeline = [
        {"$match": {"user_id": {"$in": member_ids}, "created_at": {"$gte": start, "$lt": end}, **_pet_reward_exclusion()}},
        {"$group": {"_id": "$user_id", "earned": {"$sum": {"$cond": [{"$gt": ["$amount", 0]}, "$amount", 0]}}, "spent": {"$sum": {"$cond": [{"$lt": ["$amount", 0]}, {"$abs": "$amount"}, 0]}}}},
    ]
    tx_rows = await db.transactions.aggregate(tx_pipeline).to_list(5000)
    tx_by_user = {row["_id"]: row for row in tx_rows}
    total_earned = sum(int(row.get("earned", 0)) for row in tx_rows)
    total_spent = sum(int(row.get("spent", 0)) for row in tx_rows)

    prize_pipeline = [
        {"$match": {"user_id": {"$in": member_ids}, "created_at": {"$gte": start, "$lt": end}}},
        {"$group": {"_id": {"id": "$prize_id", "title": "$prize_title"}, "orders": {"$sum": 1}, "points": {"$sum": "$price"}}},
        {"$sort": {"orders": -1, "points": -1}},
        {"$limit": 8},
    ]
    popular_prizes = await db.orders.aggregate(prize_pipeline).to_list(8)

    bonus_runs = await db.bonus_match_completions.count_documents({"user_id": {"$in": member_ids}, "updated_at": {"$gte": start, "$lt": end}})
    hidden_object_runs = await db.hidden_object_completions.count_documents({"user_id": {"$in": member_ids}, "updated_at": {"$gte": start, "$lt": end}})
    bonus_profiles = await db.bonus_match_profiles.find({"user_id": {"$in": member_ids}}, {"_id": 0, "current_level": 1}).to_list(5000)
    hidden_object_profiles = await db.hidden_object_profiles.find({"user_id": {"$in": member_ids}}, {"_id": 0, "current_level": 1}).to_list(5000)
    average_bonus_level = round(sum(int(item.get("current_level", 1)) for item in bonus_profiles) / len(bonus_profiles), 1) if bonus_profiles else 0
    average_hidden_object_level = round(sum(int(item.get("current_level", 1)) for item in hidden_object_profiles) / len(hidden_object_profiles), 1) if hidden_object_profiles else 0

    operators = []
    now_utc = datetime.now(timezone.utc)
    for member in members:
        seen = last_seen.get(member["id"])
        days_inactive = 999
        if seen:
            try:
                days_inactive = max(0, (now_utc - datetime.fromisoformat(str(seen).replace("Z", "+00:00"))).days)
            except Exception:
                pass
        tx = tx_by_user.get(member["id"], {})
        detailed_views = report_views_by_user.get(member["id"], {})
        operators.append({
            **member,
            "active": member["id"] in active_ids,
            "viewed_reports": member["id"] in report_ids,
            "report_views": detailed_views,
            "report_view_count": len(detailed_views),
            "report_view_total": len(REPORT_VIEW_KEYS),
            "last_seen": seen,
            "days_inactive": days_inactive,
            "earned": int(tx.get("earned", 0)),
            "spent": int(tx.get("spent", 0)),
        })
    operators.sort(key=lambda item: (-int(item["active"]), item["days_inactive"], item["name"].casefold()))

    # Daily activity/Point trend for the selected range.
    days = 1 if period == "day" else (7 if period == "week" else 30)
    trend = []
    for offset in range(days - 1, -1, -1):
        day = (datetime.now(KYIV_TZ) - timedelta(days=offset)).strftime("%Y-%m-%d")
        day_start, day_end = kyiv_day_bounds_utc(day)
        day_views = sum(1 for view in views if day_start <= str(view.get("created_at", "")) < day_end)
        day_active = len({view.get("user_id") for view in views if day_start <= str(view.get("created_at", "")) < day_end})
        day_tx = await db.transactions.aggregate([
            {"$match": {"user_id": {"$in": member_ids}, "created_at": {"$gte": day_start, "$lt": day_end}, **_pet_reward_exclusion()}},
            {"$group": {"_id": None, "earned": {"$sum": {"$cond": [{"$gt": ["$amount", 0]}, "$amount", 0]}}, "spent": {"$sum": {"$cond": [{"$lt": ["$amount", 0]}, {"$abs": "$amount"}, 0]}}}},
        ]).to_list(1)
        trend.append({"date": day, "views": day_views, "active_users": day_active, "earned": int(day_tx[0].get("earned", 0)) if day_tx else 0, "spent": int(day_tx[0].get("spent", 0)) if day_tx else 0})

    # Comparison across teams uses the same period and is available to leaders as context.
    all_players = await db.users.find({"role": {"$in": PLAYER_ROLES}, "approved": {"$ne": False}}, {"_id": 0, "id": 1, "team_id": 1}).to_list(5000)
    ids_by_team = {}
    for player in all_players:
        if player.get("team_id"):
            ids_by_team.setdefault(player["team_id"], []).append(player["id"])
    comparison = []
    for team in teams:
        ids = ids_by_team.get(team["id"], [])
        if not ids:
            continue
        tx = await db.transactions.aggregate([
            {"$match": {"user_id": {"$in": ids}, "created_at": {"$gte": start, "$lt": end}, **_pet_reward_exclusion()}},
            {"$group": {"_id": None, "earned": {"$sum": {"$cond": [{"$gt": ["$amount", 0]}, "$amount", 0]}}, "spent": {"$sum": {"$cond": [{"$lt": ["$amount", 0]}, {"$abs": "$amount"}, 0]}}}},
        ]).to_list(1)
        active = await db.page_views.distinct("user_id", {"user_id": {"$in": ids}, "created_at": {"$gte": start, "$lt": end}})
        comparison.append({
            "team_id": team["id"], "name": team.get("name"), "color": team.get("color", "#FFB800"),
            "members": len(ids), "active_users": len(active),
            "earned": int(tx[0].get("earned", 0)) if tx else 0,
            "spent": int(tx[0].get("spent", 0)) if tx else 0,
        })
    comparison.sort(key=lambda item: (-(item["earned"] - item["spent"]), item["name"].casefold()))

    if selected_team_id:
        report_trends = await db.report_metric_snapshots.find(
            {"team_id": selected_team_id}, {"_id": 0}
        ).sort("created_at", -1).limit(30).to_list(30)
        report_trends.reverse()
    else:
        metric_rows = await db.report_metric_snapshots.find({}, {"_id": 0}).sort("created_at", -1).limit(500).to_list(500)
        grouped_metrics = {}
        for metric in metric_rows:
            group = grouped_metrics.setdefault(metric.get("snapshot_version"), {
                "snapshot_version": metric.get("snapshot_version"),
                "snapshot_updated_at": metric.get("snapshot_updated_at"),
                "created_at": metric.get("created_at"),
                "credit_values": [],
                "debit_values": [],
                "deposit_values": [],
            })
            if metric.get("credit_overall") is not None:
                group["credit_values"].append(float(metric["credit_overall"]))
            if metric.get("debit_overall") is not None:
                group["debit_values"].append(float(metric["debit_overall"]))
            if metric.get("deposit_overall") is not None:
                group["deposit_values"].append(float(metric["deposit_overall"]))
        report_trends = []
        for group in list(grouped_metrics.values())[:30]:
            report_trends.append({
                "snapshot_version": group["snapshot_version"],
                "snapshot_updated_at": group["snapshot_updated_at"],
                "created_at": group["created_at"],
                "credit_overall": round(sum(group["credit_values"]) / len(group["credit_values"]), 2) if group["credit_values"] else None,
                "debit_overall": round(sum(group["debit_values"]) / len(group["debit_values"]), 2) if group["debit_values"] else None,
                "deposit_overall": round(sum(group["deposit_values"]) / len(group["deposit_values"]), 2) if group["deposit_values"] else None,
            })
        report_trends.reverse()

    selected_team = team_map.get(selected_team_id) if selected_team_id else None
    return {
        "period": period,
        "team": selected_team,
        "teams": teams if user.get("role") == "admin" else ([selected_team] if selected_team else []),
        "summary": {
            "operators": len(members),
            "active_operators": len(active_ids),
            "report_viewers": len(report_ids),
            "inactive_7d": sum(1 for item in operators if item["days_inactive"] >= 7),
            "points_earned": total_earned,
            "points_spent": total_spent,
            "bonus_match_activity": bonus_runs,
            "hidden_object_activity": hidden_object_runs,
            "average_bonus_level": average_bonus_level,
            "average_hidden_object_level": average_hidden_object_level,
        },
        "operators": operators,
        "popular_prizes": [{"prize_id": row["_id"].get("id"), "title": row["_id"].get("title"), "orders": row.get("orders", 0), "points": row.get("points", 0)} for row in popular_prizes],
        "trend": trend,
        "team_comparison": comparison,
        "report_trends": report_trends,
    }


# ─── Admin: Tasks CRUD ───
@api.get("/admin/tasks", response_model=List[TaskModel])
async def admin_list_tasks(admin: dict = Depends(get_current_admin)):
    docs = await db.tasks.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return [_clean_task(d) for d in docs]


@api.post("/admin/tasks", response_model=TaskModel, status_code=201)
async def admin_create_task(body: TaskCreateBody, admin: dict = Depends(get_current_admin)):
    if not body.title.strip():
        raise HTTPException(status_code=400, detail="Назва обов'язкова")
    doc = {"id": str(uuid.uuid4()), **body.model_dump(), "created_at": now_iso()}
    await db.tasks.insert_one(doc)
    if body.active:
        await _notify_all_employees(
            "new_task", "Нове завдання доступне!",
            body.title, "/tasks", "clipboard-list",
        )
    doc.pop("_id", None)
    return _clean_task(doc)


@api.patch("/admin/tasks/{task_id}", response_model=TaskModel)
async def admin_update_task(task_id: str, body: TaskUpdateBody, admin: dict = Depends(get_current_admin)):
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="Немає полів для оновлення")
    r = await db.tasks.update_one({"id": task_id}, {"$set": updates})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Завдання не знайдено")
    doc = await db.tasks.find_one({"id": task_id}, {"_id": 0})
    return _clean_task(doc)


@api.delete("/admin/tasks/{task_id}", status_code=204)
async def admin_delete_task(task_id: str, admin: dict = Depends(get_current_admin)):
    r = await db.tasks.delete_one({"id": task_id})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Завдання не знайдено")
    return None


# ─── Admin: Applications moderation ───
@api.get("/admin/applications", response_model=List[ApplicationModel])
async def admin_list_applications(
    status: Optional[str] = None,
    team_id: Optional[str] = None,
    admin: dict = Depends(get_current_admin),
):
    query: dict = {}
    if status and status in APPLICATION_STATUSES:
        query["status"] = status
    else:
        query["status"] = {"$ne": "draft"}
    docs = await db.applications.find(query, {"_id": 0}).sort("submitted_at", -1).to_list(500)
    # Backfill historical records that predate team metadata.
    missing_user_ids = list({doc.get("user_id") for doc in docs if doc.get("user_id") and not doc.get("team_id")})
    user_map = {}
    if missing_user_ids:
        async for item in db.users.find({"id": {"$in": missing_user_ids}}, {"_id": 0, "id": 1, "team_id": 1}):
            user_map[item["id"]] = item.get("team_id")
    team_ids = list({doc.get("team_id") or user_map.get(doc.get("user_id")) for doc in docs if doc.get("team_id") or user_map.get(doc.get("user_id"))})
    team_names = {}
    if team_ids:
        async for team in db.teams.find({"id": {"$in": team_ids}}, {"_id": 0, "id": 1, "name": 1}):
            team_names[team["id"]] = team.get("name", "")
    result = []
    for doc in docs:
        resolved_team_id = doc.get("team_id") or user_map.get(doc.get("user_id"))
        if team_id and resolved_team_id != team_id:
            continue
        result.append(_clean_app({
            **doc,
            "team_id": resolved_team_id,
            "team_name": doc.get("team_name") or team_names.get(resolved_team_id),
        }))
    return result


@api.patch("/admin/applications/{app_id}/start", response_model=ApplicationModel)
async def admin_start_review(app_id: str, admin: dict = Depends(get_current_admin)):
    app_doc = await db.applications.find_one({"id": app_id}, {"_id": 0})
    if not app_doc:
        raise HTTPException(status_code=404, detail="Заявку не знайдено")
    if app_doc["status"] == "submitted":
        await db.applications.update_one(
            {"id": app_id},
            {"$set": {"status": "pending_review", "reviewer_id": admin["id"], "updated_at": now_iso()}},
        )
    fresh = await db.applications.find_one({"id": app_id}, {"_id": 0})
    return _clean_app(fresh)


@api.post("/admin/applications/{app_id}/review", response_model=ApplicationModel)
async def admin_review_application(app_id: str, body: ReviewBody, admin: dict = Depends(get_current_admin)):
    app_doc = await db.applications.find_one({"id": app_id}, {"_id": 0})
    if not app_doc:
        raise HTTPException(status_code=404, detail="Заявку не знайдено")
    if app_doc["status"] in ("approved", "rejected"):
        raise HTTPException(status_code=400, detail="Заявку вже опрацьовано")

    ts = now_iso()
    if body.action == "approve":
        reward = int(app_doc.get("reward", 0))
        xp = int(app_doc.get("xp", 0))
        await db.users.update_one(
            {"id": app_doc["user_id"]},
            {"$inc": {"balance": reward, "total_earned": reward}},
        )
        await _award_xp(
            app_doc["user_id"], xp, "task", f"application:{app_id}",
            f"Завдання підтверджено: {app_doc['task_title']}",
            {"application_id": app_id, "task_id": app_doc.get("task_id")}, admin.get("id"),
        )
        await db.transactions.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": app_doc["user_id"],
            "kind": "quest",
            "amount": reward,
            "description": f"Завдання: {app_doc['task_title']}",
            "created_at": ts,
        })
        await db.applications.update_one(
            {"id": app_id},
            {"$set": {"status": "approved", "reviewer_id": admin["id"],
                      "review_reason": body.reason, "reviewed_at": ts, "updated_at": ts}},
        )
        await _notify(
            app_doc["user_id"], "application_approved",
            "Заявку підтверджено! 🎉",
            f"{app_doc['task_title']} • +{reward} балів, +{xp} XP", "/tasks", "check-circle-2",
        )
        await _notify_points_awarded(app_doc["user_id"], reward, f"Завдання підтверджено: {app_doc['task_title']}")
        progression_user = await db.users.find_one({"id": app_doc["user_id"]}, {"_id": 0})
        if progression_user:
            await _sync_system_achievements(progression_user)
    else:
        if not body.reason.strip():
            raise HTTPException(status_code=400, detail="Вкажи причину відхилення")
        await db.applications.update_one(
            {"id": app_id},
            {"$set": {"status": "rejected", "reviewer_id": admin["id"],
                      "review_reason": body.reason, "reviewed_at": ts, "updated_at": ts}},
        )
        await _notify(
            app_doc["user_id"], "application_rejected",
            "Заявку відхилено",
            f"{app_doc['task_title']} • {body.reason}", "/tasks", "x-circle",
        )
    fresh = await db.applications.find_one({"id": app_id}, {"_id": 0})
    return _clean_app(fresh)


# ─── Admin: User moderation (approve / reject pending registrations) ───
@api.get("/admin/users/pending", response_model=List[UserWithProgress])
async def admin_pending_users(admin: dict = Depends(get_current_admin)):
    docs = await db.users.find({"approved": False}, {"_id": 0}).sort("created_at", -1).to_list(500)
    team_ids = list({d.get("team_id") for d in docs if d.get("team_id")})
    teams_map = {}
    if team_ids:
        async for t in db.teams.find({"id": {"$in": team_ids}}, {"_id": 0, "id": 1, "name": 1}):
            teams_map[t["id"]] = t["name"]
    normalized_docs = []
    for d in docs:
        d = await _expire_diamond_avatar_if_needed(d)
        if d.get("team_id"):
            d["team_name"] = teams_map.get(d["team_id"])
        normalized_docs.append(d)
    return [_user_with_progress(d) for d in normalized_docs]


@api.post("/admin/users/{user_id}/approve", response_model=UserWithProgress)
async def admin_approve_user(user_id: str, admin: dict = Depends(get_current_admin)):
    target = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Користувача не знайдено")
    if target.get("approved"):
        raise HTTPException(status_code=400, detail="Користувача вже підтверджено")
    await db.users.update_one({"id": user_id}, {"$set": {"approved": True}})
    # Signup bonus on approval
    already = await db.transactions.find_one({"user_id": user_id, "kind": "signup_bonus"})
    if not already:
        await db.transactions.insert_one({
            "id": str(uuid.uuid4()), "user_id": user_id, "kind": "signup_bonus",
            "amount": 100, "description": "Стартовий бонус за реєстрацію", "created_at": now_iso(),
        })
        await db.users.update_one({"id": user_id}, {"$inc": {"balance": 100, "total_earned": 100}})
        await _award_xp(
            user_id, 50, "signup", f"signup:{user_id}",
            "Стартовий XP-бонус за підтвердження акаунта", {"approved_by": admin.get("id")}, admin.get("id"),
        )
    await _notify(user_id, "account_approved", "Акаунт підтверджено! 🎉",
                  "Ласкаво просимо у VPDK Bonus. +100 стартових балів", "/", "party-popper")
    if not already:
        await _notify_points_awarded(user_id, 100, "Стартовий бонус за реєстрацію")
    fresh = await db.users.find_one({"id": user_id}, {"_id": 0})
    fresh = await _hydrate_user_team(fresh)
    return _user_with_progress(fresh)



# ────────────────────────────────────────────────────────────────────────
# VPDK Detective — Hidden Objects campaign
# ────────────────────────────────────────────────────────────────────────
HIDDEN_OBJECT_LEVELS_PATH = ROOT_DIR / "hidden_object_levels.json"
HIDDEN_OBJECT_FIRST_CLEAR_POINTS = 2
HIDDEN_OBJECT_FIRST_CLEAR_XP = 15
HIDDEN_OBJECT_REPLAY_XP = 5
HIDDEN_OBJECT_REPLAY_REWARDS_PER_DAY = 1
HIDDEN_OBJECT_V5_LEGACY_LEVEL_MAP = {4: 7, 5: 8, 6: 9}

try:
    (
        HIDDEN_OBJECT_CATALOG,
        HIDDEN_OBJECT_SCENES_BY_ID,
        HIDDEN_OBJECT_LEVELS_BY_ID,
    ) = load_hidden_object_catalog(HIDDEN_OBJECT_LEVELS_PATH)
    HIDDEN_OBJECT_MAX_LEVEL = len(HIDDEN_OBJECT_LEVELS_BY_ID)
except (OSError, ValueError, TypeError, KeyError) as exc:
    logger.error("Could not load Hidden Objects levels: %s", exc)
    HIDDEN_OBJECT_CATALOG = {"version": "unavailable", "scenes": [], "levels": []}
    HIDDEN_OBJECT_SCENES_BY_ID = {}
    HIDDEN_OBJECT_LEVELS_BY_ID = {}
    HIDDEN_OBJECT_MAX_LEVEL = 0


class HiddenObjectStartBody(BaseModel):
    level: int = Field(ge=1, le=1000)
    restart: bool = False


class HiddenObjectActionBody(BaseModel):
    session_id: str = Field(min_length=1, max_length=120)
    sequence: int = Field(ge=1, le=1000000)
    kind: Literal["find", "hint", "pause", "resume"]
    x: Optional[float] = Field(default=None, ge=0, le=1)
    y: Optional[float] = Field(default=None, ge=0, le=1)


class HiddenObjectCompleteBody(BaseModel):
    session_id: str = Field(min_length=1, max_length=120)


def _hidden_object_elapsed(session: dict, moment: Optional[datetime] = None) -> int:
    elapsed = max(0, int(session.get("elapsed", 0)))
    if session.get("paused"):
        return min(86400, elapsed)
    active_started_at = _parse_iso_datetime(session.get("active_started_at"))
    if not active_started_at:
        return min(86400, elapsed)
    moment = moment or datetime.now(timezone.utc)
    return min(86400, elapsed + max(0, int((moment - active_started_at).total_seconds())))


def _hidden_object_level_parts(level_id: int) -> tuple[dict, dict]:
    level = HIDDEN_OBJECT_LEVELS_BY_ID.get(int(level_id))
    if not level:
        raise HTTPException(status_code=404, detail="Рівень VPDK Детектива не знайдено")
    scene = HIDDEN_OBJECT_SCENES_BY_ID.get(str(level.get("scene_id")))
    if not scene:
        raise HTTPException(status_code=503, detail="Сцена рівня тимчасово недоступна")
    return level, scene


def _hidden_object_catalog_version() -> str:
    return str(HIDDEN_OBJECT_CATALOG.get("version") or "v1")


async def _hidden_object_retire_stale_active_sessions(user_id: str) -> None:
    """Retire sessions whose target set belongs to an older content manifest."""

    await db.hidden_object_sessions.update_many(
        {
            "user_id": user_id,
            "status": "active",
            "content_version": {"$ne": _hidden_object_catalog_version()},
        },
        {
            "$set": {"status": "replaced", "updated_at": now_iso()},
            "$unset": {"slot_key": ""},
        },
    )


def _hidden_object_marker(scene: dict, object_id: str) -> Optional[dict]:
    item = scene.get("objects_by_id", {}).get(str(object_id))
    if not item:
        return None
    return {"object_id": str(object_id), "x": float(item["x"]), "y": float(item["y"])}


def _hidden_object_session_payload(session: Optional[dict]) -> Optional[dict]:
    if not session:
        return None
    level, scene = _hidden_object_level_parts(int(session.get("level", 1)))
    target_ids = [str(value) for value in session.get("target_ids") or level.get("target_ids") or []]
    found_set = {str(value) for value in session.get("found_ids") or []}
    found_ids = [value for value in target_ids if value in found_set]
    markers = [marker for marker in (_hidden_object_marker(scene, value) for value in found_ids) if marker]
    mistakes = max(0, int(session.get("mistakes", 0)))
    mistake_limit = hidden_object_mistake_limit(level)
    return {
        "id": session.get("id"),
        "status": session.get("status", "active"),
        "level_id": int(level["id"]),
        "content_version": session.get("content_version") or HIDDEN_OBJECT_CATALOG.get("version", "v1"),
        "title": level.get("title"),
        "difficulty": level.get("difficulty", "medium"),
        "image": scene.get("image"),
        "image_width": int(scene.get("width", 1122)),
        "image_height": int(scene.get("height", 1402)),
        "targets": hidden_object_targets(level, scene, str(session.get("id") or "")),
        "found_ids": found_ids,
        "found_markers": markers,
        "mistakes": mistakes,
        "mistake_limit": mistake_limit,
        "mistakes_remaining": max(0, mistake_limit - mistakes),
        "hints_used": max(0, int(session.get("hints_used", 0))),
        "hints_total": int(level.get("hints", 0)),
        "elapsed": _hidden_object_elapsed(session),
        "paused": bool(session.get("paused", False)),
        "last_sequence": max(0, int(session.get("last_sequence", 0))),
        "started_at": session.get("started_at"),
        "failed_at": session.get("failed_at"),
        "failure_reason": session.get("failure_reason"),
        "updated_at": session.get("updated_at"),
    }


async def _hidden_object_profile(user_id: str) -> dict:
    profile = await db.hidden_object_profiles.find_one({"user_id": user_id}, {"_id": 0})
    if profile:
        return profile
    now = now_iso()
    profile = {
        "user_id": user_id,
        "current_level": 1,
        "total_stars": 0,
        "content_version": _hidden_object_catalog_version(),
        "created_at": now,
        "updated_at": now,
    }
    await db.hidden_object_profiles.update_one(
        {"user_id": user_id},
        {"$setOnInsert": profile},
        upsert=True,
    )
    return await db.hidden_object_profiles.find_one({"user_id": user_id}, {"_id": 0}) or profile


async def _hidden_object_migrate_campaign_progress(user_id: str, profile: dict) -> dict:
    """Move legacy hard clears behind the new medium chapter exactly once.

    Catalogs through v4 placed the three hard panoramas at levels 4–6.  In v5
    those same cases live at levels 7–9, while 4–6 are new medium cases.  The
    dedicated migration marker makes this copy/delete migration idempotent.
    ``content_version`` cannot be that marker because profile creation and normal
    completions also advance it to the current catalog version.
    """

    catalog_version = _hidden_object_catalog_version()
    profile_version = str(profile.get("content_version") or "")
    if profile.get("v5_progress_migrated") is True and profile_version == catalog_version:
        return profile

    if profile.get("v5_progress_migrated") is not True:
        legacy_levels = sorted(HIDDEN_OBJECT_V5_LEGACY_LEVEL_MAP)
        legacy_filter = {
            "user_id": user_id,
            "level": {"$in": legacy_levels},
            # A current-version completion at 4–6 is one of the new medium
            # cases.  Never move or delete it, even if a stale profile causes
            # this migration to be retried.
            "content_version": {"$in": [None, "", "v1", "v2", "v3", "v4"]},
        }
        completions = await db.hidden_object_completions.find(
            legacy_filter,
            {"_id": 0},
        ).to_list(len(legacy_levels))
        for completion in completions:
            source_level = int(completion.get("level", 0))
            target_level = HIDDEN_OBJECT_V5_LEGACY_LEVEL_MAP.get(source_level)
            if not target_level:
                continue
            migrated = dict(completion)
            migrated.update({
                "id": str(uuid.uuid4()),
                "user_id": user_id,
                "level": target_level,
                "content_version": catalog_version,
                "migrated_from_level": source_level,
                "migrated_from_content_version": str(
                    completion.get("content_version") or profile_version or "legacy"
                ),
            })
            await db.hidden_object_completions.update_one(
                {"user_id": user_id, "level": target_level},
                {"$setOnInsert": migrated},
                upsert=True,
            )
        if completions:
            # Delete only the legacy rows copied above.  The version predicate
            # protects a concurrently-created v5 medium completion.
            await db.hidden_object_completions.delete_many(legacy_filter)

    now = now_iso()
    profile_fields = {"content_version": catalog_version, "updated_at": now}
    if profile.get("v5_progress_migrated") is not True:
        profile_fields.update({"v5_progress_migrated": True, "v5_progress_migrated_at": now})
    await db.hidden_object_profiles.update_one(
        {"user_id": user_id},
        {"$set": profile_fields},
    )
    return {**profile, **profile_fields}


async def _hidden_object_reconcile_level(user_id: str, profile: dict) -> int:
    completed = await db.hidden_object_completions.find(
        {"user_id": user_id}, {"_id": 0, "level": 1}
    ).sort("level", 1).to_list(max(1, HIDDEN_OBJECT_MAX_LEVEL))
    completed_levels = {int(item.get("level", 0)) for item in completed}
    unlocked = 1
    while unlocked in completed_levels and unlocked < HIDDEN_OBJECT_MAX_LEVEL:
        unlocked += 1
    unlocked = max(1, min(max(1, HIDDEN_OBJECT_MAX_LEVEL), unlocked))
    if int(profile.get("current_level", 1)) != unlocked:
        await db.hidden_object_profiles.update_one(
            {"user_id": user_id},
            {"$set": {"current_level": unlocked, "updated_at": now_iso()}},
        )
    return unlocked


async def _hidden_object_status_payload(user_id: str) -> dict:
    await _hidden_object_retire_stale_active_sessions(user_id)
    profile = await _hidden_object_profile(user_id)
    profile = await _hidden_object_migrate_campaign_progress(user_id, profile)
    unlocked = await _hidden_object_reconcile_level(user_id, profile)
    completions = await db.hidden_object_completions.find(
        {"user_id": user_id}, {"_id": 0}
    ).sort("level", 1).to_list(max(1, HIDDEN_OBJECT_MAX_LEVEL))
    active = await db.hidden_object_sessions.find_one(
        {
            "user_id": user_id,
            "status": "active",
            "content_version": _hidden_object_catalog_version(),
        },
        {"_id": 0},
        sort=[("updated_at", -1)],
    )
    public_levels = []
    for level_id in sorted(HIDDEN_OBJECT_LEVELS_BY_ID):
        level, scene = _hidden_object_level_parts(level_id)
        public_levels.append(hidden_object_public_level(level, scene))
    return {
        "unlocked_level": unlocked,
        "max_level": HIDDEN_OBJECT_MAX_LEVEL,
        "total_stars": sum(int(item.get("stars", 0)) for item in completions),
        "content_version": HIDDEN_OBJECT_CATALOG.get("version", "v1"),
        "completions": completions,
        "active_session": _hidden_object_session_payload(active),
        "levels": public_levels,
        "reward_policy": {
            "first_clear_points": HIDDEN_OBJECT_FIRST_CLEAR_POINTS,
            "first_clear_xp": HIDDEN_OBJECT_FIRST_CLEAR_XP,
            "replay_xp": HIDDEN_OBJECT_REPLAY_XP,
            "rewarded_replays_per_level_per_day": HIDDEN_OBJECT_REPLAY_REWARDS_PER_DAY,
        },
    }


@api.get("/games/hidden-objects/status")
async def hidden_object_status(user: dict = Depends(get_current_user)):
    return await _hidden_object_status_payload(user["id"])


@api.post("/games/hidden-objects/start")
async def hidden_object_start(body: HiddenObjectStartBody, user: dict = Depends(get_current_user)):
    if HIDDEN_OBJECT_MAX_LEVEL <= 0:
        raise HTTPException(status_code=503, detail="Каталог VPDK Детектива недоступний")
    level, _scene = _hidden_object_level_parts(body.level)
    profile = await _hidden_object_profile(user["id"])
    profile = await _hidden_object_migrate_campaign_progress(user["id"], profile)
    unlocked = await _hidden_object_reconcile_level(user["id"], profile)
    if int(body.level) > unlocked:
        raise HTTPException(status_code=400, detail="Цей рівень VPDK Детектива ще не відкрито")

    await _hidden_object_retire_stale_active_sessions(user["id"])
    existing = await db.hidden_object_sessions.find_one(
        {
            "user_id": user["id"],
            "status": "active",
            "level": int(body.level),
            "content_version": _hidden_object_catalog_version(),
        },
        {"_id": 0},
        sort=[("updated_at", -1)],
    )
    if existing and not body.restart:
        return {"session": _hidden_object_session_payload(existing), "resumed": True}

    now = now_iso()
    await db.hidden_object_sessions.update_many(
        {"user_id": user["id"], "status": "active"},
        {"$set": {"status": "replaced", "updated_at": now}, "$unset": {"slot_key": ""}},
    )
    session = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "slot_key": user["id"],
        "level": int(level["id"]),
        "content_version": HIDDEN_OBJECT_CATALOG.get("version", "v1"),
        "target_ids": [str(value) for value in level.get("target_ids") or []],
        "found_ids": [],
        "hinted_ids": [],
        "mistakes": 0,
        "mistake_limit": hidden_object_mistake_limit(level),
        "hints_used": 0,
        "elapsed": 0,
        "paused": False,
        "last_sequence": 0,
        "status": "active",
        "started_at": now,
        "active_started_at": now,
        "updated_at": now,
    }
    try:
        await db.hidden_object_sessions.insert_one(session.copy())
    except DuplicateKeyError:
        active = await db.hidden_object_sessions.find_one(
            {"user_id": user["id"], "status": "active"}, {"_id": 0}
        )
        if active and int(active.get("level", 0)) == int(level["id"]):
            return {"session": _hidden_object_session_payload(active), "resumed": True}
        raise HTTPException(status_code=409, detail="Інша справа вже запускається. Спробуйте ще раз")
    return {"session": _hidden_object_session_payload(session), "resumed": False}


@api.post("/games/hidden-objects/action")
async def hidden_object_action(body: HiddenObjectActionBody, user: dict = Depends(get_current_user)):
    for _attempt in range(3):
        session = await db.hidden_object_sessions.find_one(
            {
                "id": body.session_id,
                "user_id": user["id"],
                "content_version": _hidden_object_catalog_version(),
            },
            {"_id": 0},
        )
        if not session:
            raise HTTPException(status_code=404, detail="Активну сесію не знайдено")

        last_sequence = int(session.get("last_sequence", 0))
        if int(body.sequence) <= last_sequence:
            return {"session": _hidden_object_session_payload(session), "duplicate": True, "event": None}
        if session.get("status") != "active":
            raise HTTPException(status_code=409, detail="Цю сесію вже завершено")

        level, scene = _hidden_object_level_parts(int(session.get("level", 1)))
        now_dt = datetime.now(timezone.utc)
        now = now_dt.isoformat()
        elapsed = _hidden_object_elapsed(session, now_dt)
        update = {
            "elapsed": elapsed,
            "last_sequence": int(body.sequence),
            "updated_at": now,
        }
        event = {"kind": body.kind}

        if body.kind == "pause":
            update.update({"paused": True, "active_started_at": None})
            if session.get("paused"):
                event.update({"paused": True, "unchanged": True})
            else:
                event["paused"] = True
        elif body.kind == "resume":
            update.update({"paused": False, "active_started_at": now})
            if not session.get("paused"):
                event.update({"paused": False, "unchanged": True})
            else:
                event["paused"] = False
        else:
            if session.get("paused"):
                raise HTTPException(status_code=409, detail="Спочатку продовжіть гру")
            update["active_started_at"] = now
            target_ids = [str(value) for value in session.get("target_ids") or level.get("target_ids") or []]
            found_ids = [str(value) for value in session.get("found_ids") or []]
            found_set = set(found_ids)
            remaining_ids = [value for value in target_ids if value not in found_set]

            if body.kind == "hint":
                hints_used = int(session.get("hints_used", 0))
                if hints_used >= int(level.get("hints", 0)):
                    raise HTTPException(status_code=400, detail="Підказки цього рівня закінчилися")
                if not remaining_ids:
                    raise HTTPException(status_code=400, detail="Усі предмети вже знайдено")
                hinted_ids = [str(value) for value in session.get("hinted_ids") or []]
                hint_id = next((value for value in remaining_ids if value not in hinted_ids), remaining_ids[0])
                if hint_id not in hinted_ids:
                    hinted_ids.append(hint_id)
                update.update({"hints_used": hints_used + 1, "hinted_ids": hinted_ids})
                event.update({"object_id": hint_id, "marker": _hidden_object_marker(scene, hint_id)})
            else:
                if body.x is None or body.y is None:
                    raise HTTPException(status_code=422, detail="Для пошуку потрібні координати натискання")
                objects = scene.get("objects_by_id", {})
                hits = [
                    objects[object_id]
                    for object_id in remaining_ids
                    if object_id in objects and hidden_object_contains(objects[object_id], body.x, body.y)
                ]
                hit = min(hits, key=lambda item: float(item["rx"]) * float(item["ry"])) if hits else None
                duplicate_hit = next(
                    (
                        object_id for object_id in found_ids
                        if object_id in objects and hidden_object_contains(objects[object_id], body.x, body.y)
                    ),
                    None,
                )
                if hit:
                    hit_id = str(hit["id"])
                    found_ids.append(hit_id)
                    update["found_ids"] = found_ids
                    event.update({
                        "hit": True,
                        "object": {"id": hit_id, "label": hit["label"], "icon": hit.get("icon", "search")},
                        "marker": _hidden_object_marker(scene, hit_id),
                        "remaining": max(0, len(target_ids) - len(found_ids)),
                    })
                elif duplicate_hit:
                    event.update({"hit": True, "duplicate": True, "object_id": duplicate_hit})
                else:
                    mistakes, mistakes_remaining, failed = hidden_object_apply_miss(
                        level, session.get("mistakes", 0)
                    )
                    update["mistakes"] = mistakes
                    event.update({
                        "hit": False,
                        "penalty_seconds": 5,
                        "mistake_limit": hidden_object_mistake_limit(level),
                        "mistakes_remaining": mistakes_remaining,
                        "failed": failed,
                    })
                    if failed:
                        update.update({
                            "status": "failed",
                            "failed_at": now,
                            "failure_reason": "mistake_limit",
                            "paused": False,
                            "active_started_at": None,
                        })

        session_update = {"$set": update}
        if update.get("status") == "failed":
            session_update["$unset"] = {"slot_key": ""}
        updated_session = await db.hidden_object_sessions.find_one_and_update(
            {
                "id": body.session_id,
                "user_id": user["id"],
                "status": "active",
                "last_sequence": last_sequence,
            },
            session_update,
            projection={"_id": 0},
            return_document=ReturnDocument.AFTER,
        )
        if updated_session:
            return {
                "session": _hidden_object_session_payload(updated_session),
                "duplicate": False,
                "event": event,
            }

    latest = await db.hidden_object_sessions.find_one(
        {
            "id": body.session_id,
            "user_id": user["id"],
            "content_version": _hidden_object_catalog_version(),
        },
        {"_id": 0},
    )
    if latest and int(body.sequence) <= int(latest.get("last_sequence", 0)):
        return {"session": _hidden_object_session_payload(latest), "duplicate": True, "event": None}
    raise HTTPException(status_code=409, detail="Стан гри змінився. Повторіть дію")

@api.post("/games/hidden-objects/complete")
async def hidden_object_complete(body: HiddenObjectCompleteBody, user: dict = Depends(get_current_user)):
    prior_run = await db.hidden_object_runs.find_one(
        {"id": body.session_id, "user_id": user["id"]}, {"_id": 0}
    )
    if prior_run:
        recovered_at = now_iso()
        await db.hidden_object_sessions.update_one(
            {"id": body.session_id, "user_id": user["id"], "status": "completing"},
            {
                "$set": {"status": "completed", "completed_at": recovered_at, "updated_at": recovered_at},
                "$unset": {"slot_key": ""},
            },
        )
        return {
            "reward": prior_run.get("reward", {}),
            "status": await _hidden_object_status_payload(user["id"]),
            "idempotent": True,
        }

    session = await db.hidden_object_sessions.find_one(
        {
            "id": body.session_id,
            "user_id": user["id"],
            "status": "active",
            "content_version": _hidden_object_catalog_version(),
        },
        {"_id": 0},
    )
    if not session:
        raise HTTPException(status_code=404, detail="Активну сесію не знайдено")
    level, _scene = _hidden_object_level_parts(int(session.get("level", 1)))
    mistake_limit = hidden_object_mistake_limit(level)
    if max(0, int(session.get("mistakes", 0))) >= mistake_limit:
        failure_dt = datetime.now(timezone.utc)
        failed_at = failure_dt.isoformat()
        failed_elapsed = _hidden_object_elapsed(session, failure_dt)
        await db.hidden_object_sessions.update_one(
            {"id": body.session_id, "user_id": user["id"], "status": "active"},
            {
                "$set": {
                    "status": "failed",
                    "failed_at": failed_at,
                    "failure_reason": "mistake_limit",
                    "elapsed": failed_elapsed,
                    "paused": False,
                    "active_started_at": None,
                    "updated_at": failed_at,
                },
                "$unset": {"slot_key": ""},
            },
        )
        raise HTTPException(status_code=409, detail="Ліміт неправильних натискань вичерпано")
    target_ids = {str(value) for value in session.get("target_ids") or level.get("target_ids") or []}
    found_ids = {str(value) for value in session.get("found_ids") or []}
    if not target_ids or not target_ids.issubset(found_ids):
        raise HTTPException(status_code=400, detail="Спочатку знайдіть усі предмети")

    profile = await _hidden_object_profile(user["id"])
    profile = await _hidden_object_migrate_campaign_progress(user["id"], profile)
    unlocked = await _hidden_object_reconcile_level(user["id"], profile)
    level_id = int(level["id"])
    if level_id > unlocked:
        raise HTTPException(status_code=400, detail="Рівень не був відкритий для цього користувача")

    claim_dt = datetime.now(timezone.utc)
    now = claim_dt.isoformat()
    elapsed = _hidden_object_elapsed(session, claim_dt)
    claimed_session = await db.hidden_object_sessions.find_one_and_update(
        {
            "id": body.session_id,
            "user_id": user["id"],
            "status": "active",
            "last_sequence": int(session.get("last_sequence", 0)),
        },
        {
            "$set": {
                "status": "completing",
                "elapsed": elapsed,
                "active_started_at": None,
                "updated_at": now,
            }
        },
        projection={"_id": 0},
        return_document=ReturnDocument.BEFORE,
    )
    if not claimed_session:
        prior_run = await db.hidden_object_runs.find_one(
            {"id": body.session_id, "user_id": user["id"]}, {"_id": 0}
        )
        if prior_run:
            return {
                "reward": prior_run.get("reward", {}),
                "status": await _hidden_object_status_payload(user["id"]),
                "idempotent": True,
            }
        raise HTTPException(status_code=409, detail="Завершення цієї справи вже обробляється")
    session = claimed_session

    try:
        reward_claim = session.get("completion_claim")
        if isinstance(reward_claim, dict):
            elapsed = max(0, int(reward_claim.get("elapsed", elapsed)))
            mistakes = max(0, int(reward_claim.get("mistakes", session.get("mistakes", 0))))
            hints_used = max(0, int(reward_claim.get("hints_used", session.get("hints_used", 0))))
            stars = max(1, min(3, int(reward_claim.get("stars", 1))))
            effective_time = max(0, int(reward_claim.get("effective_time", elapsed)))
            first_completion = bool(reward_claim.get("first_completion", False))
            reward_day = str(reward_claim.get("reward_day") or kyiv_today_key())
            reward_key = str(reward_claim["reward_key"])
            points_awarded = max(0, int(reward_claim.get("points_awarded", 0)))
            xp_awarded = max(0, int(reward_claim.get("xp_awarded", 0)))
        else:
            mistakes = max(0, int(session.get("mistakes", 0)))
            hints_used = max(0, int(session.get("hints_used", 0)))
            stars, effective_time = hidden_object_stars(level, elapsed, mistakes, hints_used)
            existing_completion = await db.hidden_object_completions.find_one(
                {"user_id": user["id"], "level": level_id}, {"_id": 0, "id": 1}
            )
            first_completion = existing_completion is None
            reward_day = kyiv_today_key()
            reward_key = (
                f"hidden_object:{body.session_id}"
                if first_completion
                else f"hidden_object_replay:{user['id']}:{reward_day}"
            )
            reward_already_claimed = await db.users.find_one(
                {"id": user["id"], "game_reward_keys": reward_key}, {"_id": 0, "id": 1}
            )
            points_awarded = HIDDEN_OBJECT_FIRST_CLEAR_POINTS if first_completion else 0
            xp_awarded = HIDDEN_OBJECT_FIRST_CLEAR_XP if first_completion else HIDDEN_OBJECT_REPLAY_XP
            if reward_already_claimed:
                points_awarded = 0
                xp_awarded = 0
            reward_claim = {
                "first_completion": first_completion,
                "reward_day": reward_day,
                "reward_key": reward_key,
                "points_awarded": points_awarded,
                "xp_awarded": xp_awarded,
                "elapsed": elapsed,
                "mistakes": mistakes,
                "hints_used": hints_used,
                "stars": stars,
                "effective_time": effective_time,
            }
            claim_result = await db.hidden_object_sessions.update_one(
                {"id": body.session_id, "user_id": user["id"], "status": "completing"},
                {"$set": {"completion_claim": reward_claim, "updated_at": now}},
            )
            if not claim_result.modified_count:
                raise RuntimeError("Could not persist the Hidden Objects completion claim")

        await db.hidden_object_completions.update_one(
            {"user_id": user["id"], "level": level_id},
            {
                "$set": {
                    "content_version": _hidden_object_catalog_version(),
                    "updated_at": now,
                },
                "$max": {"stars": stars},
                "$min": {"best_time": elapsed, "best_mistakes": mistakes},
                "$setOnInsert": {
                    "id": str(uuid.uuid4()),
                    "user_id": user["id"],
                    "level": level_id,
                    "created_at": now,
                },
            },
            upsert=True,
        )
        next_level = min(max(1, HIDDEN_OBJECT_MAX_LEVEL), level_id + 1)
        completion_stars = await db.hidden_object_completions.find(
            {"user_id": user["id"]}, {"_id": 0, "stars": 1}
        ).to_list(max(1, HIDDEN_OBJECT_MAX_LEVEL))
        profile_update = {
            "$max": {
                "current_level": next_level,
                "total_stars": sum(int(item.get("stars", 0)) for item in completion_stars),
            },
            "$set": {"content_version": _hidden_object_catalog_version(), "updated_at": now},
        }
        await db.hidden_object_profiles.update_one({"user_id": user["id"]}, profile_update)
    
        user_result = await db.users.update_one(
            {"id": user["id"], "game_reward_keys": {"$ne": reward_key}},
            {
                "$inc": {"balance": points_awarded, "total_earned": points_awarded},
                "$addToSet": {"game_reward_keys": reward_key},
            },
        )
        reward_applied_now = bool(user_result.modified_count)
        if not reward_applied_now and (points_awarded or xp_awarded):
            rewarded_user = await db.users.find_one(
                {"id": user["id"], "game_reward_keys": reward_key}, {"_id": 0, "id": 1}
            )
            if not rewarded_user:
                raise RuntimeError("Could not apply the Hidden Objects reward")
        intended_xp = xp_awarded if reward_applied_now else 0
        xp_result = await _award_xp(
            user["id"],
            intended_xp,
            "hidden_object",
            reward_key,
            f"VPDK Детектив: {'перше проходження' if first_completion else 'денна активність'} рівня {level_id}",
            {"level": level_id, "stars": stars, "first_completion": first_completion, "date": reward_day},
        )
        xp_awarded = int(xp_result.get("amount", 0) or 0)
    
        transaction = {
            "id": str(uuid.uuid4()),
            "source_key": reward_key,
            "user_id": user["id"],
            "kind": "hidden_object",
            "amount": points_awarded,
            "description": f"VPDK Детектив: рівень {level_id}, {stars} зірки, +{points_awarded} Point, +{xp_awarded} XP",
            "created_at": now,
            "meta": {
                "level": level_id,
                "stars": stars,
                "elapsed": elapsed,
                "effective_time": effective_time,
                "mistakes": mistakes,
                "hints_used": hints_used,
                "first_completion": first_completion,
                "reward_day": reward_day,
                "xp": xp_awarded,
                "reward_policy": "v164_first_2_points_15_xp_one_replay_5_xp_per_day",
            },
        }
        await db.transactions.update_one(
            {"source_key": reward_key}, {"$setOnInsert": transaction}, upsert=True
        )
    
        reward = {
            "first_completion": first_completion,
            "points_awarded": points_awarded,
            "xp_awarded": xp_awarded,
            "stars": stars,
            "new_level": next_level,
        }
        try:
            await db.hidden_object_runs.insert_one({
                "id": body.session_id,
                "user_id": user["id"],
                "level": level_id,
                "reward": reward,
                "created_at": now,
            })
        except DuplicateKeyError:
            prior_run = await db.hidden_object_runs.find_one(
                {"id": body.session_id, "user_id": user["id"]}, {"_id": 0}
            )
            if prior_run:
                reward = prior_run.get("reward", reward)
        await db.hidden_object_sessions.update_one(
            {"id": body.session_id, "user_id": user["id"]},
            {
                "$set": {"status": "completed", "elapsed": elapsed, "completed_at": now, "updated_at": now},
                "$unset": {"slot_key": ""},
            },
        )
        try:
            if reward_applied_now and points_awarded:
                await _notify_points_awarded(user["id"], points_awarded, f"VPDK Детектив: рівень {level_id}")
            if reward_applied_now and first_completion and next_level > level_id:
                await _notify(
                    user["id"], "game_level", "Відкрито нову справу VPDK Детектива",
                    f"Рівень {next_level} уже доступний.", "/games/hidden-objects", "search", "games",
                    {"game": "hidden_objects", "level": next_level},
                )
        except Exception:
            logger.exception("Could not send Hidden Objects reward notification")
        progression_user = await db.users.find_one({"id": user["id"]}, {"_id": 0}) or user
        await _sync_system_achievements(progression_user)
        return {"reward": reward, "status": await _hidden_object_status_payload(user["id"]), "idempotent": False}
    
    
    except Exception:
        recovery_now = now_iso()
        await db.hidden_object_sessions.update_one(
            {"id": body.session_id, "user_id": user["id"], "status": "completing"},
            {
                "$set": {
                    "status": "active",
                    "paused": False,
                    "active_started_at": recovery_now,
                    "updated_at": recovery_now,
                }
            },
        )
        raise

async def seed_hidden_objects_v157():
    await db.hidden_object_profiles.create_index("user_id", unique=True)
    await db.hidden_object_completions.create_index([("user_id", 1), ("level", 1)], unique=True)
    await db.hidden_object_sessions.create_index([("user_id", 1), ("status", 1), ("updated_at", -1)])
    await db.hidden_object_sessions.create_index(
        [("user_id", 1)],
        unique=True,
        partialFilterExpression={"status": "active"},
        name="hidden_object_one_active_session_per_user",
    )
    await db.hidden_object_sessions.create_index("slot_key", unique=True, sparse=True)
    await db.hidden_object_runs.create_index([("id", 1), ("user_id", 1)], unique=True)
    await db.transactions.create_index("source_key", unique=True, sparse=True)


# ─── Seed sample tasks (Phase 2) ───
SEED_TASKS = [
    {
        "title": "Фото робочого місця",
        "description": "Сфотографуй своє прибране робоче місце на початку зміни.",
        "category": "discipline", "icon": "camera", "reward": 60, "xp": 30,
        "fields": [
            {"key": "photo", "label": "Фото робочого місця", "type": "photo", "required": True},
            {"key": "note", "label": "Коментар", "type": "textarea", "required": False, "placeholder": "Необов'язково"},
        ],
    },
    {
        "title": "Звіт про закритий кейс",
        "description": "Заповни звіт по складному кейсу, який ти закрив.",
        "category": "support", "icon": "clipboard-check", "reward": 150, "xp": 80,
        "fields": [
            {"key": "client", "label": "Ім'я клієнта", "type": "text", "required": True, "placeholder": "Іван"},
            {"key": "phone", "label": "Телефон клієнта", "type": "phone", "required": False, "placeholder": "+380..."},
            {"key": "duration", "label": "Тривалість (хв)", "type": "number", "required": True},
            {"key": "date", "label": "Дата кейсу", "type": "date", "required": True},
            {"key": "result", "label": "Результат", "type": "select", "required": True,
             "options": ["Вирішено", "Ескальовано", "Відкладено"]},
            {"key": "summary", "label": "Опис", "type": "textarea", "required": True},
        ],
    },
    {
        "title": "Відео-привітання для клієнта",
        "description": "Запиши коротке відео-привітання (до 30 сек).",
        "category": "quality", "icon": "video", "reward": 200, "xp": 100,
        "fields": [
            {"key": "video", "label": "Відео", "type": "video", "required": True},
            {"key": "agree", "label": "Погоджуюсь на публікацію у стрічці", "type": "checkbox", "required": True},
        ],
    },
]


async def backfill_ai_training_completions_v139() -> int:
    """Mark historical successful AI cases as completed without re-awarding Point."""
    created = 0
    cursor = db.ai_training_results.find(
        {"won": True, "scenario_id": {"$nin": [None, ""]}},
        {
            "_id": 0,
            "user_id": 1,
            "scenario_id": 1,
            "scenario_title": 1,
            "average_score": 1,
            "points": 1,
            "created_at": 1,
        },
    ).sort("created_at", 1)
    async for item in cursor:
        user_id = str(item.get("user_id") or "").strip()
        scenario_id = str(item.get("scenario_id") or "").strip()
        if not user_id or not scenario_id:
            continue
        result = await db.ai_training_completions.update_one(
            {"user_id": user_id, "scenario_id": scenario_id},
            {
                "$setOnInsert": {
                    "id": str(uuid.uuid4()),
                    "user_id": user_id,
                    "scenario_id": scenario_id,
                    "scenario_title": item.get("scenario_title") or scenario_id,
                    "score": float(item.get("average_score") or 0),
                    "points_awarded": int(item.get("points") or 0),
                    "completed_at": item.get("created_at") or now_iso(),
                    "backfilled_v139": True,
                }
            },
            upsert=True,
        )
        if result.upserted_id is not None:
            created += 1
    return created


async def seed_phase2():
    await db.tasks.create_index("created_at")
    await db.applications.create_index([("user_id", 1), ("updated_at", -1)])
    await db.applications.create_index([("status", 1), ("submitted_at", -1)])
    await db.notifications.create_index([("user_id", 1), ("created_at", -1)])
    await db.push_subscriptions.create_index("endpoint", unique=True)
    await db.push_subscriptions.create_index([("user_id", 1), ("updated_at", -1)])
    await db.notification_preferences.create_index("user_id", unique=True)
    await db.scheduled_push_runs.create_index("id", unique=True)
    await db.report_publications.create_index("snapshot_version", unique=True)
    await db.ai_training_completions.create_index([("user_id", 1), ("scenario_id", 1)], unique=True)
    ai_backfilled = await backfill_ai_training_completions_v139()
    if ai_backfilled:
        logger.info("Backfilled %d AI Trainer completions for v139", ai_backfilled)
    await db.report_metric_snapshots.create_index([("snapshot_version", 1), ("team_key", 1)], unique=True)
    await db.report_metric_snapshots.create_index([("team_id", 1), ("created_at", 1)])
    await db.operator_report_daily.create_index([("user_id", 1), ("date_key", 1)], unique=True)
    await db.operator_report_daily.create_index([("date_key", -1), ("user_id", 1)])
    await db.leaderboard_positions.create_index("id", unique=True)
    await db.reactions.create_index([("target_id", 1), ("user_id", 1)], unique=True)
    await db.comments.create_index([("target_id", 1), ("created_at", 1)])
    await db.feed_events.create_index("id", unique=True)
    await db.feed_events.create_index("source_key", unique=True, sparse=True)
    await db.feed_events.create_index("created_at")
    if await db.tasks.count_documents({}) == 0:
        for t in SEED_TASKS:
            await db.tasks.insert_one({"id": str(uuid.uuid4()), **t, "active": True, "created_at": now_iso()})
        logger.info("Seeded %d tasks", len(SEED_TASKS))


try:
    from backend.pixel_campaign import register_pixel_campaign_routes
except ModuleNotFoundError as exc:
    if exc.name != "backend":
        raise
    from pixel_campaign import register_pixel_campaign_routes

register_pixel_campaign_routes(api, db, get_current_user)
register_pet_routes(api, db, get_current_user, _notify_points_awarded)
register_flappy_routes(api, db, get_current_user)
register_pixel_drive_routes(api, db, get_current_user)



@app.on_event("startup")
async def on_startup():
    global _diamond_avatar_cleanup_task
    await seed_all()
    await migrate_remove_legacy_demo_teams_v105()
    await migrate_bonus_match_v93_reset()
    await migrate_bonus_match_pixel_campaign()
    await seed_phase2()
    await seed_pet_v1(db)
    await db.pixel_campaign_runs.create_index([("user_id", 1), ("game", 1), ("completed_at", 1)])
    await seed_flappy(db)
    await seed_pixel_drive(db)
    await seed_hidden_objects_v157()
    await _cleanup_expired_diamond_avatars_once()
    backfilled = await _backfill_active_diamond_feed_events_v136()
    if backfilled:
        logger.info("Backfilled %d active diamond-avatar feed events", backfilled)
    _diamond_avatar_cleanup_task = asyncio.create_task(_diamond_avatar_cleanup_loop())


@app.on_event("shutdown")
async def on_shutdown():
    global _diamond_avatar_cleanup_task
    if _diamond_avatar_cleanup_task:
        _diamond_avatar_cleanup_task.cancel()
        try:
            await _diamond_avatar_cleanup_task
        except asyncio.CancelledError:
            pass
        _diamond_avatar_cleanup_task = None
    client.close()


# Include routers + CORS
app.include_router(api)
app.include_router(bot_router)

# Serve uploaded files (under /api/* so Kubernetes ingress routes to backend)
app.mount("/api/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)
