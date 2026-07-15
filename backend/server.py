"""CallHub Game Hub — FastAPI backend
JWT auth (email + bcrypt), employee/admin roles, quests, prizes, orders,
transactions, admin CRUD, bot API endpoints for Telegram sync.
"""
from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import uuid
import logging
import shutil
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
from typing import List, Optional, Literal

import bcrypt
import jwt
from fastapi import FastAPI, APIRouter, Depends, HTTPException, Header, status, UploadFile, File, Form
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.staticfiles import StaticFiles
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr, ConfigDict

# ────────────────────────────────────────────────────────────────────────
# Config
# ────────────────────────────────────────────────────────────────────────
JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALG = "HS256"
JWT_TTL_HOURS = int(os.environ.get("JWT_ACCESS_TTL_HOURS", "24"))
ADMIN_EMAIL = os.environ["ADMIN_EMAIL"].lower()
ADMIN_PASSWORD = os.environ["ADMIN_PASSWORD"]
BOT_API_TOKEN = os.environ["BOT_API_TOKEN"]

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

logger = logging.getLogger("callhub")
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
    return {**user, "streak": new_streak, "last_active_date": today}


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:
        return False


def create_token(user_id: str, email: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_TTL_HOURS),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def xp_to_next(level: int) -> int:
    """Progressive XP curve: L1→L2 needs 1000, L2→L3 needs 1500, etc."""
    return 500 + level * 500


def level_from_total_xp(total_xp: int) -> tuple[int, int, int]:
    """Return (level, xp_in_level, xp_needed_for_next)."""
    level = 1
    remaining = total_xp
    need = xp_to_next(level)
    while remaining >= need:
        remaining -= need
        level += 1
        need = xp_to_next(level)
    return level, remaining, need


# ────────────────────────────────────────────────────────────────────────
# Models
# ────────────────────────────────────────────────────────────────────────
class UserPublic(BaseModel):
    id: str
    email: str
    name: str
    first_name: str = ""
    last_name: str = ""
    role: Literal["employee", "admin"]
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
    team_id: Optional[str] = None
    team_name: Optional[str] = None
    is_team_leader: bool = False
    approved: bool = True
    created_at: str


class UserWithProgress(UserPublic):
    level: int
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


class UserAdminUpdateBody(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    phone: Optional[str] = None
    telegram: Optional[str] = None
    department: Optional[str] = None
    position: Optional[str] = None
    avatar_color: Optional[str] = None
    avatar_url: Optional[str] = None
    team_id: Optional[str] = None
    is_team_leader: Optional[bool] = None
    approved: Optional[bool] = None


class AvatarUpdateBody(BaseModel):
    avatar_url: str


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
    category: Literal["merch", "privilege", "certificate"] = "merch"
    image: Optional[str] = None
    icon: str = "gift"
    stock: int = 0
    active: bool = True
    created_at: str


class PrizeCreateBody(BaseModel):
    title: str
    description: str = ""
    price: int
    category: Literal["merch", "privilege", "certificate"] = "merch"
    image: Optional[str] = None
    icon: str = "gift"
    stock: int = 0
    active: bool = True


class PrizeUpdateBody(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    price: Optional[int] = None
    category: Optional[Literal["merch", "privilege", "certificate"]] = None
    image: Optional[str] = None
    icon: Optional[str] = None
    stock: Optional[int] = None
    active: Optional[bool] = None


class OrderModel(BaseModel):
    id: str
    user_id: str
    user_name: str
    prize_id: str
    prize_title: str
    price: int
    status: Literal["processing", "ready", "delivered", "cancelled"]
    created_at: str


class OrderStatusBody(BaseModel):
    status: Literal["processing", "ready", "delivered", "cancelled"]


class TransactionModel(BaseModel):
    id: str
    user_id: str
    kind: Literal["quest", "purchase", "admin_adjust", "signup_bonus"]
    amount: int  # positive = credit, negative = debit
    description: str = ""
    created_at: str


class PointsAdjustBody(BaseModel):
    amount: int  # positive or negative
    description: str = "Ручне коригування адміном"


# ────────────────────────────────────────────────────────────────────────
# App + auth deps
# ────────────────────────────────────────────────────────────────────────
app = FastAPI(title="CallHub Game Hub API")
api = APIRouter(prefix="/api")
bearer = HTTPBearer(auto_error=False)


def _sanitize_user(doc: dict) -> UserPublic:
    doc = {**doc}
    doc.pop("password_hash", None)
    doc.pop("_id", None)
    doc.setdefault("telegram_id", None)
    doc.setdefault("telegram", None)
    doc.setdefault("phone", None)
    doc.setdefault("first_name", "")
    doc.setdefault("last_name", "")
    doc.setdefault("avatar_url", None)
    doc.setdefault("team_id", None)
    doc.setdefault("team_name", None)
    doc.setdefault("is_team_leader", False)
    doc.setdefault("approved", True)
    return UserPublic(**doc)


def _user_with_progress(doc: dict) -> UserWithProgress:
    base = _sanitize_user(doc).model_dump()
    lvl, xp, need = level_from_total_xp(base["total_xp"])
    base["level"] = lvl
    base["xp"] = xp
    base["xp_to_next"] = need
    return UserWithProgress(**base)


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
    return user


async def get_current_admin(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Тільки для адміністраторів")
    return user


async def get_bot_caller(x_bot_token: str = Header(default="", alias="X-Bot-Token")) -> bool:
    if x_bot_token != BOT_API_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid bot token")
    return True


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


@api.post("/auth/login", response_model=TokenResponse)
async def auth_login(body: LoginBody):
    email = body.email.lower().strip()
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Невірний email або пароль")
    if user.get("approved") is False:
        raise HTTPException(status_code=403, detail="Обліковий запис ще не підтверджено адміністратором")
    token = create_token(user["id"], user["email"], user["role"])
    user = await _touch_daily_streak(user)
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
    user = await _hydrate_user_team(user)
    return _user_with_progress(user)


@api.patch("/auth/me/avatar", response_model=UserWithProgress)
async def update_my_avatar(body: AvatarUpdateBody, user: dict = Depends(get_current_user)):
    """Update the current user avatar after a successful /uploads request."""
    avatar_url = (body.avatar_url or "").strip()
    if not avatar_url.startswith("/api/uploads/avatars/"):
        raise HTTPException(status_code=400, detail="Некоректне посилання на фото")
    await db.users.update_one({"id": user["id"]}, {"$set": {"avatar_url": avatar_url}})
    fresh = await db.users.find_one({"id": user["id"]}, {"_id": 0})
    fresh = await _hydrate_user_team(fresh)
    return _user_with_progress(fresh)


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
# Teams
# ────────────────────────────────────────────────────────────────────────
async def _team_with_stats(t: dict) -> dict:
    """Attach member_count and total_earned to a team doc."""
    t = {**t}
    t.pop("_id", None)
    member_count = await db.users.count_documents({"team_id": t["id"], "role": "employee"})
    pipeline = [
        {"$match": {"team_id": t["id"], "role": "employee"}},
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
    await db.users.update_one({"id": user_id}, {"$set": updates})
    fresh = await db.users.find_one({"id": user_id}, {"_id": 0})
    fresh = await _hydrate_user_team(fresh)
    return _user_with_progress(fresh)


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
    xp_gain = reward // 2
    await db.users.update_one(
        {"id": user["id"]},
        {"$inc": {"balance": reward, "total_earned": reward, "total_xp": xp_gain}},
    )
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
    fresh = await db.users.find_one({"id": user["id"]}, {"_id": 0})
    return _user_with_progress(fresh)


# ────────────────────────────────────────────────────────────────────────
# Daily tasks — 3 per Kyiv day, one replacement allowed
# ────────────────────────────────────────────────────────────────────────
DAILY_TASK_CATALOG = [
    {"id": 1, "title": "А наша Галя дуже балована", "text": "Скиньте в Teams фото карти дзвінка з клієнткою на ім'я Галина. Приз: 10 Point.", "difficulty": "easy", "reward": 10},
    {"id": 2, "title": "Чий ти будеш, козаче?", "text": "Скиньте в Teams фото карти дзвінка з іноземним ім'ям. Приз: 20 Point.", "difficulty": "medium", "reward": 20},
    {"id": 3, "title": "Оптом дешевше", "text": "Зробіть дві видачі кредитних продуктів одному й тому самому клієнту. Приз: 50 Point.", "difficulty": "hard", "reward": 50},
    {"id": 4, "title": "Олег, ти що плачеш?", "text": "Знайдіть клієнта на ім'я Олег і скиньте скриншот карти дзвінка в Teams. Приз: 10 Point.", "difficulty": "easy", "reward": 10},
    {"id": 5, "title": "Відкрийте кредитку — і буде вам щастя", "text": "Зробіть видачу клієнту та скиньте карту дзвінка в Teams. Приз: 20 Point.", "difficulty": "medium", "reward": 20},
    {"id": 6, "title": "Вам ця карта треба, мене не…", "text": "Зробіть три видачі кредитних продуктів трьом клієнтам і надішліть підтвердження в Teams. Приз: 30 Point.", "difficulty": "hard", "reward": 30},
    {"id": 7, "title": "Агент 777", "text": "Знайдіть у номері телефону клієнта або ІПН три однакові цифри поспіль, наприклад 777. Скиньте скриншот картки в Teams. Приз: 10 Point.", "difficulty": "easy", "reward": 10},
    {"id": 8, "title": "Я не з такої сім'ї, я з багатої", "text": "Зробіть видачу депозиту в компанії Веб_Апс. Підтвердження — карта дзвінка. Приз: 20 Point.", "difficulty": "medium", "reward": 20},
    {"id": 9, "title": "Я тебе передумаю", "text": "Зробіть видачу клієнту, в коментарях якого було зазначено «подумаю». Приз: 30 Point.", "difficulty": "hard", "reward": 30},
    {"id": 10, "title": "Молода кров", "text": "Скиньте карту дзвінка з наймолодшим клієнтом за день, дата народження — 2008 рік або пізніше. Приз: 10 Point.", "difficulty": "easy", "reward": 10},
    {"id": 11, "title": "Не чує баба", "text": "Скиньте фото карти дзвінка з клієнтом, який народився у 1955 році або раніше. Приз: 20 Point.", "difficulty": "medium", "reward": 20},
    {"id": 12, "title": "Подвійний удар", "text": "Зробіть дві видачі будь-яких продуктів одному клієнту та скиньте скриншоти карт. Приз: 30 Point.", "difficulty": "hard", "reward": 30},
    {"id": 13, "title": "Ну ти і фартовий…", "text": "Напишіть у Teams: «Я фартовий/фартова». Приз: 10 Point.", "difficulty": "easy", "reward": 10},
    {"id": 14, "title": "Перший хлопець на селі", "text": "Знайдіть клієнта, в якого ім'я збігається з основою по батькові, наприклад Іван Іванович. Скиньте скриншот карти. Приз: 20 Point.", "difficulty": "medium", "reward": 20},
    {"id": 15, "title": "Герой вчорашнього дня", "text": "Якщо станом на вчора у вас найбільше видач у команді, отримайте приз. Приз: 50 Point.", "difficulty": "hard", "reward": 50},
    {"id": 16, "title": "Сьогодні ж п'ятниця?", "text": "Якщо сьогодні 02 число, знайдіть клієнта з днем народження 02.xx.xxxx. Скиньте скриншот. Приз: 10 Point.", "difficulty": "easy", "reward": 10},
    {"id": 17, "title": "І дебетку беріть", "text": "Зробіть додаткову видачу дебетової картки в компанії Веб_Апс. Приз: 20 Point.", "difficulty": "medium", "reward": 20},
    {"id": 18, "title": "Майстер дзену", "text": "Отримайте складне заперечення, опрацюйте його і закрийте угоду. Коротко опишіть у Teams, як це було. Приз: 30 Point.", "difficulty": "hard", "reward": 30},
    {"id": 19, "title": "Післяробочий вайб", "text": "Зробіть хоча б одну видачу за дві години до завершення робочого дня. Приз: 10 Point.", "difficulty": "easy", "reward": 10},
    {"id": 20, "title": "Джекпот 7777", "text": "Знайдіть у номері телефону або ІПН чотири однакові цифри поспіль. Скиньте скриншот карти в Teams. Приз: 20 Point.", "difficulty": "medium", "reward": 20},
    {"id": 21, "title": "Швидкі гроші", "text": "Оформіть видачу кредитного продукту за п'ять хвилин розмови. Скиньте скриншот карти в Teams. Приз: 30 Point.", "difficulty": "hard", "reward": 30},
    {"id": 22, "title": "Назад у майбутнє", "text": "Скиньте карту дзвінка з клієнтом, який народився у круглому році, наприклад 1970, 1980, 1990 або 2000. Приз: 10 Point.", "difficulty": "easy", "reward": 10},
    {"id": 23, "title": "Ну ви ж лояльний клієнт", "text": "Зробіть додаткову видачу валютної або дебетової картки в компанії Крос. Приз: 20 Point.", "difficulty": "medium", "reward": 20},
    {"id": 24, "title": "Хет-трик", "text": "Зробіть три видачі продуктів одному клієнту та скиньте карти в Teams. Приз: 50 Point.", "difficulty": "hard", "reward": 50},
    {"id": 25, "title": "Ровесник", "text": "Знайдіть клієнта, який народився в один рік із вами. Скиньте карту дзвінка. Приз: 10 Point.", "difficulty": "easy", "reward": 10},
    {"id": 26, "title": "День народження", "text": "Знайдіть клієнта, в якого день народження цього місяця. Приз: 20 Point.", "difficulty": "medium", "reward": 20},
    {"id": 27, "title": "Багатий тато", "text": "Знайдіть клієнта з по батькові «Олександрович» або «Миколайович» і зробіть успішну видачу. Приз: 20 Point.", "difficulty": "hard", "reward": 20},
    {"id": 28, "title": "Два в ряд", "text": "Оформіть дві видачі кредитних продуктів за один робочий день. Надішліть підтвердження одним повідомленням у Teams. Приз: 10 Point.", "difficulty": "easy", "reward": 10},
    {"id": 29, "title": "Золотий вік", "text": "Оформіть продукт клієнту, який народився у 1960-х роках або раніше. Скиньте карту дзвінка. Приз: 20 Point.", "difficulty": "medium", "reward": 20},
    {"id": 30, "title": "Подвійний еспресо", "text": "Зробіть дві видачі між 13:00 та 14:00. Надішліть підтвердження в Teams. Приз: 30 Point.", "difficulty": "hard", "reward": 30},
    {"id": 31, "title": "Красивий фініш", "text": "Знайдіть карту, де ІПН або номер телефону клієнта закінчується на два нулі. Приз: 10 Point.", "difficulty": "easy", "reward": 10},
    {"id": 32, "title": "Вип'ємо еспресо", "text": "Зробіть видачу між 13:00 та 14:00. Приз: 20 Point.", "difficulty": "medium", "reward": 20},
    {"id": 33, "title": "Конвеєр", "text": "Зробіть чотири видачі за один день і надішліть підтвердження одним повідомленням у Teams. Приз: 50 Point.", "difficulty": "hard", "reward": 50},
    {"id": 34, "title": "Двадцять п'ять", "text": "Знайдіть у номері або ІПН клієнта дві п'ятірки поспіль — 55. Приз: 10 Point.", "difficulty": "easy", "reward": 10},
    {"id": 35, "title": "Турбо-старт", "text": "Оформіть першу видачу кредитного продукту протягом першої години після виходу на лінію. Приз: 20 Point.", "difficulty": "medium", "reward": 20},
    {"id": 36, "title": "Ювелірна робота", "text": "Проведіть розмову, що завершилася видачею без заперечень завдяки якісному виявленню потреб із перших хвилин. Приз: 30 Point.", "difficulty": "hard", "reward": 30},
    {"id": 37, "title": "Сієста", "text": "Оформіть видачу в проміжку з 13:00 до 15:00. Приз: 10 Point.", "difficulty": "easy", "reward": 10},
    {"id": 38, "title": "Ефектний фінал", "text": "Оформіть видачу за годину до завершення робочої зміни. Приз: 20 Point.", "difficulty": "medium", "reward": 20},
    {"id": 39, "title": "Акула продажів", "text": "Зробіть найбільшу кількість видач у команді за день. Приз: 50 Point.", "difficulty": "hard", "reward": 50},
]


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
    now = now_iso()
    await db.users.update_one({"id": user_id}, {"$inc": {"balance": amount, "total_earned": amount}})
    await db.transactions.insert_one({
        "id": str(uuid.uuid4()), "user_id": user_id, "kind": "goal_reward", "amount": amount,
        "description": description, "created_at": now,
        "meta": {"goal_reward_key": tx_key, "goal_kind": kind, "period_key": period_key},
    })
    return True


@api.get("/goals/me")
async def get_my_goals(user: dict = Depends(get_current_user)):
    doc = await db.user_goals.find_one({"user_id": user["id"]}, {"_id": 0})
    result = _goals_public(doc)
    result["history"] = await db.goal_history.find(
        {"user_id": user["id"]}, {"_id": 0}
    ).sort("archived_at", -1).limit(8).to_list(8)
    return result


@api.get("/admin/goals-dashboard")
async def admin_goals_dashboard(admin: dict = Depends(get_current_admin)):
    users = await db.users.find(
        {"role": "employee", "approved": {"$ne": False}},
        {"_id": 0, "id": 1, "name": 1, "avatar_initials": 1, "avatar_color": 1, "avatar_url": 1,
         "position": 1, "department": 1},
    ).sort("name", 1).to_list(1000)
    docs = await db.user_goals.find({"user_id": {"$in": [u["id"] for u in users]}}, {"_id": 0}).to_list(1000)
    by_user = {d["user_id"]: d for d in docs}
    return [{**u, "goals": _goals_public(by_user.get(u["id"]))} for u in users]


@api.put("/admin/goals/{user_id}")
async def update_user_goals(user_id: str, body: UserGoalsUpdateBody, admin: dict = Depends(get_current_admin)):
    target = await db.users.find_one({"id": user_id, "role": "employee"}, {"_id": 0})
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


def _daily_task_by_id(task_id: int) -> Optional[dict]:
    return next((task for task in DAILY_TASK_CATALOG if task["id"] == task_id), None)

async def _get_or_create_daily_task_set(user_id: str) -> dict:
    import hashlib
    import random
    date_key = kyiv_today_key()
    doc = await db.daily_task_sets.find_one({"user_id": user_id, "date": date_key}, {"_id": 0})
    if doc:
        return doc
    seed = int(hashlib.sha256(f"{user_id}:{date_key}:tm6".encode()).hexdigest(), 16)
    rng = random.Random(seed)
    # Smart random: avoid missions the operator has seen during the last 14 days.
    recent_sets = await db.daily_task_sets.find(
        {"user_id": user_id, "date": {"$lt": date_key}}, {"_id": 0, "task_ids": 1, "date": 1}
    ).sort("date", -1).limit(14).to_list(14)
    recent_ids = {int(task_id) for item in recent_sets for task_id in item.get("task_ids", [])}
    chosen = []
    for difficulty in ("easy", "medium", "hard"):
        full_pool = [task for task in DAILY_TASK_CATALOG if task["difficulty"] == difficulty]
        fresh_pool = [task for task in full_pool if task["id"] not in recent_ids]
        pool = fresh_pool or full_pool
        chosen.append(rng.choice(pool)["id"])
    doc = {
        "user_id": user_id,
        "date": date_key,
        "task_ids": chosen,
        "replacement_used": False,
        "created_at": now_iso(),
    }
    await db.daily_task_sets.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api.get("/daily-tasks")
async def get_daily_tasks(user: dict = Depends(get_current_user)):
    task_set = await _get_or_create_daily_task_set(user["id"])
    reviews = await db.daily_task_reviews.find(
        {"user_id": user["id"], "date": task_set["date"]}, {"_id": 0}
    ).to_list(20)
    review_map = {int(r["task_id"]): r for r in reviews}
    tasks = []
    for task_id in task_set["task_ids"]:
        task = _daily_task_by_id(task_id)
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
        "replacement_used": bool(task_set.get("replacement_used")),
        "refresh_at": kyiv_tomorrow_iso(),
        "timezone": "Europe/Kyiv",
    }



@api.get("/admin/daily-tasks-dashboard")
async def admin_daily_tasks_dashboard(admin: dict = Depends(get_current_admin)):
    date_key = kyiv_today_key()
    users = await db.users.find(
        {"role": "employee", "approved": {"$ne": False}},
        {"_id": 0, "id": 1, "name": 1, "avatar_initials": 1, "avatar_color": 1, "avatar_url": 1, "position": 1, "department": 1, "total_xp": 1},
    ).sort("name", 1).to_list(1000)

    for employee in users:
        await _get_or_create_daily_task_set(employee["id"])

    task_sets = await db.daily_task_sets.find({"date": date_key}, {"_id": 0}).to_list(2000)
    task_set_map = {row["user_id"]: row for row in task_sets}
    reviews = await db.daily_task_reviews.find({"date": date_key}, {"_id": 0}).to_list(5000)
    review_map = {(row["user_id"], int(row["task_id"])): row for row in reviews}

    operators = []
    awarded_points = 0
    decided_count = 0
    for employee in users:
        task_set = task_set_map.get(employee["id"]) or await _get_or_create_daily_task_set(employee["id"])
        task_items = []
        for task_id in task_set.get("task_ids", []):
            task = _daily_task_by_id(int(task_id))
            if not task:
                continue
            review = review_map.get((employee["id"], int(task_id)))
            status = review.get("status") if review else "pending"
            if status == "approved":
                awarded_points += int(task["reward"])
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
        "decided_count": decided_count,
        "total_tasks": len(operators) * 3,
        "refresh_at": kyiv_tomorrow_iso(),
        "timezone": "Europe/Kyiv",
    }


@api.post("/admin/daily-tasks/{user_id}/{task_id}/{decision}")
async def admin_review_daily_task(
    user_id: str,
    task_id: int,
    decision: str,
    admin: dict = Depends(get_current_admin),
):
    if decision not in ("approve", "reject"):
        raise HTTPException(status_code=400, detail="Невідоме рішення")
    target = await db.users.find_one({"id": user_id, "role": "employee"}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Оператора не знайдено")
    task_set = await _get_or_create_daily_task_set(user_id)
    if task_id not in task_set.get("task_ids", []):
        raise HTTPException(status_code=404, detail="Це завдання не призначене оператору сьогодні")
    task = _daily_task_by_id(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Завдання не знайдено")
    existing = await db.daily_task_reviews.find_one(
        {"user_id": user_id, "date": task_set["date"], "task_id": task_id}, {"_id": 0}
    )
    if existing:
        raise HTTPException(status_code=409, detail="Рішення щодо цього завдання вже зафіксовано")

    status = "approved" if decision == "approve" else "rejected"
    reviewed_at = now_iso()
    review = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "date": task_set["date"],
        "task_id": task_id,
        "status": status,
        "reward": int(task["reward"]) if status == "approved" else 0,
        "reviewed_by": admin["id"],
        "reviewed_by_name": admin.get("name", "Адміністратор"),
        "reviewed_at": reviewed_at,
    }
    await db.daily_task_reviews.insert_one(review)

    if status == "approved":
        reward = int(task["reward"])
        await db.users.update_one(
            {"id": user_id}, {"$inc": {"balance": reward, "total_earned": reward}}
        )
        await db.transactions.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "kind": "daily_task_award",
            "amount": reward,
            "description": f"Завдання дня: {task['title']}",
            "created_at": reviewed_at,
            "meta": {"task_id": task_id, "date": task_set["date"], "reviewed_by": admin["id"]},
        })

    return {
        "user_id": user_id,
        "task_id": task_id,
        "status": status,
        "reward": int(task["reward"]) if status == "approved" else 0,
        "reviewed_at": reviewed_at,
        "reviewed_by_name": admin.get("name", "Адміністратор"),
    }


@api.post("/daily-tasks/{task_id}/replace")
async def replace_daily_task(task_id: int, user: dict = Depends(get_current_user)):
    import hashlib
    import random
    task_set = await _get_or_create_daily_task_set(user["id"])
    if task_set.get("replacement_used"):
        raise HTTPException(status_code=400, detail="Сьогодні одне завдання вже було замінено")
    if task_id not in task_set["task_ids"]:
        raise HTTPException(status_code=404, detail="Завдання не входить до сьогоднішнього набору")
    decided = await db.daily_task_reviews.find_one({"user_id": user["id"], "date": task_set["date"], "task_id": task_id})
    if decided:
        raise HTTPException(status_code=400, detail="Перевірене завдання вже не можна замінити")
    current = _daily_task_by_id(task_id)
    if not current:
        raise HTTPException(status_code=404, detail="Завдання не знайдено")
    recent_sets = await db.daily_task_sets.find(
        {"user_id": user["id"], "date": {"$lt": task_set["date"]}}, {"_id": 0, "task_ids": 1}
    ).sort("date", -1).limit(14).to_list(14)
    recent_ids = {int(value) for item in recent_sets for value in item.get("task_ids", [])}
    full_pool = [
        task for task in DAILY_TASK_CATALOG
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
        {"$set": {"task_ids": new_ids, "replacement_used": True, "replaced_at": now_iso()}},
    )
    return {
        "date": task_set["date"],
        "tasks": [_daily_task_by_id(value) for value in new_ids],
        "replacement_used": True,
        "refresh_at": kyiv_tomorrow_iso(),
        "timezone": "Europe/Kyiv",
    }


# ────────────────────────────────────────────────────────────────────────
# Prizes & orders
# ────────────────────────────────────────────────────────────────────────
@api.get("/prizes", response_model=List[PrizeModel])
async def list_prizes(user: dict = Depends(get_current_user)):
    prizes = await db.prizes.find({"active": True}, {"_id": 0}).sort("price", 1).to_list(500)
    return [PrizeModel(**p) for p in prizes]


@api.post("/prizes/{prize_id}/buy")
async def buy_prize(prize_id: str, user: dict = Depends(get_current_user)):
    prize = await db.prizes.find_one({"id": prize_id, "active": True}, {"_id": 0})
    if not prize:
        raise HTTPException(status_code=404, detail="Приз не знайдено")
    if prize["stock"] <= 0:
        raise HTTPException(status_code=400, detail="Немає в наявності")
    if user["balance"] < prize["price"]:
        raise HTTPException(status_code=400, detail="Недостатньо балів")

    await db.users.update_one({"id": user["id"]}, {"$inc": {"balance": -prize["price"]}})
    await db.prizes.update_one({"id": prize_id}, {"$inc": {"stock": -1}})

    order = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "user_name": user["name"],
        "prize_id": prize_id,
        "prize_title": prize["title"],
        "price": prize["price"],
        "status": "processing",
        "created_at": now_iso(),
    }
    await db.orders.insert_one(order)
    await db.transactions.insert_one(
        {
            "id": str(uuid.uuid4()),
            "user_id": user["id"],
            "kind": "purchase",
            "amount": -prize["price"],
            "description": f"Купівля: {prize['title']}",
            "created_at": now_iso(),
        }
    )
    order.pop("_id", None)
    fresh = await db.users.find_one({"id": user["id"]}, {"_id": 0})
    return {"order": OrderModel(**order), "user": _user_with_progress(fresh)}


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
    department: str
    score: int
    is_me: bool = False


class LeaderboardResponse(BaseModel):
    period: str
    top: List[LeaderboardEntry]
    my_entry: Optional[LeaderboardEntry] = None


async def _leaderboard_all(current_id: str, limit: int = 10) -> LeaderboardResponse:
    users = await db.users.find(
        {"role": "employee"},
        {"_id": 0, "id": 1, "name": 1, "avatar_initials": 1, "avatar_color": 1, "avatar_url": 1, "department": 1, "total_earned": 1},
    ).sort("total_earned", -1).to_list(1000)
    top: List[LeaderboardEntry] = []
    my_entry = None
    for i, u in enumerate(users):
        e = LeaderboardEntry(
            rank=i + 1,
            user_id=u["id"],
            name=u["name"],
            avatar_initials=u.get("avatar_initials", "?"),
            avatar_color=u.get("avatar_color", "#FFB800"),
            avatar_url=u.get("avatar_url"),
            department=u.get("department", ""),
            score=int(u.get("total_earned", 0)),
            is_me=(u["id"] == current_id),
        )
        if i < limit:
            top.append(e)
        if u["id"] == current_id:
            my_entry = e
    return LeaderboardResponse(period="all", top=top, my_entry=my_entry if (my_entry and my_entry.rank > limit) else None)


async def _leaderboard_period(days: int, period_name: str, current_id: str, limit: int = 10) -> LeaderboardResponse:
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    pipeline = [
        {"$match": {"created_at": {"$gte": since}, "amount": {"$gt": 0}}},
        {"$group": {"_id": "$user_id", "score": {"$sum": "$amount"}}},
        {"$sort": {"score": -1}},
    ]
    grouped = await db.transactions.aggregate(pipeline).to_list(1000)
    if not grouped:
        return LeaderboardResponse(period=period_name, top=[], my_entry=None)
    ids = [g["_id"] for g in grouped]
    users_map = {}
    async for u in db.users.find(
        {"id": {"$in": ids}, "role": "employee"},
        {"_id": 0, "id": 1, "name": 1, "avatar_initials": 1, "avatar_color": 1, "avatar_url": 1, "department": 1},
    ):
        users_map[u["id"]] = u

    top: List[LeaderboardEntry] = []
    my_entry = None
    rank = 0
    for g in grouped:
        u = users_map.get(g["_id"])
        if not u:
            continue
        rank += 1
        e = LeaderboardEntry(
            rank=rank,
            user_id=u["id"],
            name=u["name"],
            avatar_initials=u.get("avatar_initials", "?"),
            avatar_color=u.get("avatar_color", "#FFB800"),
            avatar_url=u.get("avatar_url"),
            department=u.get("department", ""),
            score=int(g["score"]),
            is_me=(u["id"] == current_id),
        )
        if rank <= limit:
            top.append(e)
        if u["id"] == current_id:
            my_entry = e
    return LeaderboardResponse(period=period_name, top=top, my_entry=my_entry if (my_entry and my_entry.rank > limit) else None)


@api.get("/leaderboard", response_model=LeaderboardResponse)
async def leaderboard(period: Literal["week", "month", "all"] = "week", user: dict = Depends(get_current_user)):
    if period == "all":
        return await _leaderboard_all(user["id"])
    if period == "week":
        return await _leaderboard_period(7, "week", user["id"])
    return await _leaderboard_period(30, "month", user["id"])


class TeamLeaderboardEntry(BaseModel):
    rank: int
    team_id: str
    name: str
    color: str
    department: str
    member_count: int
    total_earned: int
    avg_earned: int


@api.get("/leaderboard/teams", response_model=List[TeamLeaderboardEntry])
async def team_leaderboard(user: dict = Depends(get_current_user)):
    teams = await db.teams.find({}, {"_id": 0}).to_list(500)
    scored = []
    for t in teams:
        pipeline = [
            {"$match": {"team_id": t["id"], "role": "employee"}},
            {"$group": {"_id": None, "sum": {"$sum": "$total_earned"}, "n": {"$sum": 1}}},
        ]
        agg = await db.users.aggregate(pipeline).to_list(1)
        total = int(agg[0]["sum"]) if agg else 0
        n = int(agg[0]["n"]) if agg else 0
        avg = total // n if n else 0
        scored.append({
            "team_id": t["id"],
            "name": t["name"],
            "color": t.get("color", "#FFB800"),
            "department": t.get("department", ""),
            "member_count": n,
            "total_earned": total,
            "avg_earned": avg,
        })
    scored.sort(key=lambda x: x["total_earned"], reverse=True)
    return [TeamLeaderboardEntry(rank=i + 1, **s) for i, s in enumerate(scored)]


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
    "Сьогодні є 1% шанс на джекпот у Щедрому Кубі. Спробуй.",
]

# Cube rewards: (weight, min, max)
CUBE_TABLE = [
    (55, 10, 30),     # small
    (30, 40, 80),     # medium
    (12, 90, 150),    # large
    (3, 200, 350),    # jackpot
]


class CubeSpinResult(BaseModel):
    reward: int
    tier: Literal["small", "medium", "large", "jackpot"]
    new_balance: int
    total_xp: int


class GamesStatus(BaseModel):
    date: str
    cube_spun: bool
    cube_reward: Optional[int] = None
    cube_tier: Optional[str] = None
    prediction_revealed: bool
    prediction_text: Optional[str] = None


class PredictionResult(BaseModel):
    text: str
    date: str


async def _get_or_create_games_doc(user_id: str) -> dict:
    key = _today_key()
    doc = await db.daily_games.find_one({"user_id": user_id, "date": key}, {"_id": 0})
    if doc:
        return doc
    doc = {"user_id": user_id, "date": key, "cube_spun": False, "prediction_revealed": False}
    await db.daily_games.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.get("/games/status", response_model=GamesStatus)
async def games_status(user: dict = Depends(get_current_user)):
    doc = await _get_or_create_games_doc(user["id"])
    return GamesStatus(
        date=doc["date"],
        cube_spun=doc.get("cube_spun", False),
        cube_reward=doc.get("cube_reward"),
        cube_tier=doc.get("cube_tier"),
        prediction_revealed=doc.get("prediction_revealed", False),
        prediction_text=doc.get("prediction_text"),
    )


@api.post("/games/cube/spin", response_model=CubeSpinResult)
async def cube_spin(user: dict = Depends(get_current_user)):
    import random as _rand
    doc = await _get_or_create_games_doc(user["id"])
    if doc.get("cube_spun"):
        raise HTTPException(status_code=400, detail="Куб уже кинуто сьогодні. Заходь завтра!")

    # Weighted pick
    total_weight = sum(w for w, _, _ in CUBE_TABLE)
    roll = _rand.uniform(0, total_weight)
    acc = 0.0
    picked = CUBE_TABLE[0]
    tier_names = ["small", "medium", "large", "jackpot"]
    tier = "small"
    for i, item in enumerate(CUBE_TABLE):
        acc += item[0]
        if roll <= acc:
            picked = item
            tier = tier_names[i]
            break
    reward = _rand.randint(picked[1], picked[2])

    await db.users.update_one(
        {"id": user["id"]},
        {"$inc": {"balance": reward, "total_earned": reward, "total_xp": reward // 3}},
    )
    await db.daily_games.update_one(
        {"user_id": user["id"], "date": _today_key()},
        {"$set": {"cube_spun": True, "cube_reward": reward, "cube_tier": tier, "cube_spun_at": now_iso()}},
    )
    await db.transactions.insert_one(
        {
            "id": str(uuid.uuid4()),
            "user_id": user["id"],
            "kind": "quest",
            "amount": reward,
            "description": f"Щедрий Куб ({tier})",
            "created_at": now_iso(),
        }
    )
    fresh = await db.users.find_one({"id": user["id"]}, {"_id": 0})
    return CubeSpinResult(reward=reward, tier=tier, new_balance=fresh["balance"], total_xp=fresh["total_xp"])


@api.post("/games/prediction/reveal", response_model=PredictionResult)
async def prediction_reveal(user: dict = Depends(get_current_user)):
    import hashlib
    doc = await _get_or_create_games_doc(user["id"])
    if doc.get("prediction_revealed") and doc.get("prediction_text"):
        return PredictionResult(text=doc["prediction_text"], date=doc["date"])
    key = _today_key()
    seed = int(hashlib.sha256(f"{user['id']}::{key}".encode()).hexdigest(), 16)
    text = PREDICTIONS_UK[seed % len(PREDICTIONS_UK)]
    await db.daily_games.update_one(
        {"user_id": user["id"], "date": key},
        {"$set": {"prediction_revealed": True, "prediction_text": text, "prediction_revealed_at": now_iso()}},
    )
    return PredictionResult(text=text, date=key)


# ────────────────────────────────────────────────────────────────────────
# Motivational feed (activity stream)
# ────────────────────────────────────────────────────────────────────────
class FeedEvent(BaseModel):
    id: str
    kind: Literal["quest", "purchase", "level_up", "cube", "prize_delivered", "goal"]
    user_id: str
    user_name: str
    avatar_initials: str
    avatar_color: str
    avatar_url: Optional[str] = None
    department: str = ""
    title: str
    subtitle: str = ""
    amount: Optional[int] = None
    level: Optional[int] = None
    created_at: str
    reactions: dict = {}
    my_reaction: Optional[str] = None
    comment_count: int = 0


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
    return "quest", desc or "активність", ""


@api.get("/feed", response_model=FeedResponse)
async def get_feed(limit: int = 40, user: dict = Depends(get_current_user)):
    """Aggregated activity feed: quest completions, purchases, cube spins, level-ups, delivered orders.
    Sorted by created_at desc. Level-ups derived from cumulative XP crossings.
    """
    # 1) Load recent transactions across all employees
    txs = await db.transactions.find({}, {"_id": 0}).sort("created_at", -1).to_list(limit * 3)

    # Fetch user info for participants
    user_ids = list({t["user_id"] for t in txs})
    users_map = {}
    async for u in db.users.find(
        {"id": {"$in": user_ids}, "role": "employee"},
        {"_id": 0, "id": 1, "name": 1, "avatar_initials": 1, "avatar_color": 1, "avatar_url": 1, "department": 1},
    ):
        users_map[u["id"]] = u

    events: List[FeedEvent] = []

    # 2) Detect level-ups by replaying XP per user in chronological order
    # Get positive-XP transactions per user (quests + admin_adjust positive + cube — all award XP)
    per_user_txs = {}
    for t in txs:
        if t["user_id"] not in users_map:
            continue
        per_user_txs.setdefault(t["user_id"], []).append(t)

    level_up_events: List[FeedEvent] = []
    for uid, u in users_map.items():
        user_txs = sorted(per_user_txs.get(uid, []), key=lambda t: t["created_at"])
        # Approx: use amount // 2 as xp gain (matches claim_quest logic)
        cumulative_xp = 0
        current_level = 1
        for t in user_txs:
            gain = 0
            if t.get("amount", 0) > 0 and t.get("kind") in ("quest", "admin_adjust", "signup_bonus"):
                gain = t["amount"] // 2 if t.get("kind") != "quest" or not t.get("description", "").startswith("Щедрий Куб") else t["amount"] // 3
            if gain <= 0:
                continue
            prev_level = current_level
            cumulative_xp += gain
            # Recompute level from cumulative
            lvl, _, _ = level_from_total_xp(cumulative_xp)
            if lvl > prev_level:
                current_level = lvl
                level_up_events.append(FeedEvent(
                    id=f"lvlup-{uid}-{lvl}-{t['created_at']}",
                    kind="level_up",
                    user_id=uid,
                    user_name=u["name"],
                    avatar_initials=u.get("avatar_initials", "?"),
                    avatar_color=u.get("avatar_color", "#FFB800"),
                    avatar_url=u.get("avatar_url"),
                    department=u.get("department", ""),
                    title="досягнув нового рівня",
                    subtitle=f"Рівень {lvl}",
                    level=lvl,
                    created_at=t["created_at"],
                ))
            else:
                current_level = lvl

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
            department=u.get("department", ""),
            title=title,
            subtitle=subtitle,
            amount=t.get("amount"),
            created_at=t["created_at"],
        ))

    # 4) Delivered orders
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
async def admin_list_users(admin: dict = Depends(get_current_admin)):
    docs = await db.users.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    # Batch hydrate team names
    team_ids = list({d.get("team_id") for d in docs if d.get("team_id")})
    teams_map = {}
    if team_ids:
        async for t in db.teams.find({"id": {"$in": team_ids}}, {"_id": 0, "id": 1, "name": 1}):
            teams_map[t["id"]] = t["name"]
    for d in docs:
        if d.get("team_id"):
            d["team_name"] = teams_map.get(d["team_id"])
    return [_user_with_progress(d) for d in docs]


@api.patch("/admin/users/{user_id}/points", response_model=UserWithProgress)
async def admin_adjust_points(user_id: str, body: PointsAdjustBody, admin: dict = Depends(get_current_admin)):
    target = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Користувача не знайдено")
    new_balance = target["balance"] + body.amount
    if new_balance < 0:
        raise HTTPException(status_code=400, detail="Баланс не може бути від'ємним")
    inc = {"balance": body.amount}
    if body.amount > 0:
        inc["total_earned"] = body.amount
        inc["total_xp"] = body.amount // 2
    await db.users.update_one({"id": user_id}, {"$inc": inc})
    await db.transactions.insert_one(
        {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "kind": "admin_adjust",
            "amount": body.amount,
            "description": body.description,
            "created_at": now_iso(),
        }
    )
    fresh = await db.users.find_one({"id": user_id}, {"_id": 0})
    return _user_with_progress(fresh)


@api.delete("/admin/users/{user_id}", status_code=204)
async def admin_delete_user(user_id: str, admin: dict = Depends(get_current_admin)):
    target = await db.users.find_one({"id": user_id})
    if not target:
        raise HTTPException(status_code=404, detail="Користувача не знайдено")
    if target.get("role") == "admin":
        raise HTTPException(status_code=400, detail="Не можна видалити адміністратора")
    await db.users.delete_one({"id": user_id})
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
    return [PrizeModel(**d) for d in docs]


@api.post("/admin/prizes", response_model=PrizeModel, status_code=201)
async def admin_create_prize(body: PrizeCreateBody, admin: dict = Depends(get_current_admin)):
    doc = {"id": str(uuid.uuid4()), **body.model_dump(), "created_at": now_iso()}
    await db.prizes.insert_one(doc)
    doc.pop("_id", None)
    return PrizeModel(**doc)


@api.patch("/admin/prizes/{prize_id}", response_model=PrizeModel)
async def admin_update_prize(prize_id: str, body: PrizeUpdateBody, admin: dict = Depends(get_current_admin)):
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="Немає полів для оновлення")
    r = await db.prizes.update_one({"id": prize_id}, {"$set": updates})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Приз не знайдено")
    doc = await db.prizes.find_one({"id": prize_id}, {"_id": 0})
    return PrizeModel(**doc)


@api.delete("/admin/prizes/{prize_id}", status_code=204)
async def admin_delete_prize(prize_id: str, admin: dict = Depends(get_current_admin)):
    r = await db.prizes.delete_one({"id": prize_id})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Приз не знайдено")
    return None


@api.get("/admin/orders", response_model=List[OrderModel])
async def admin_list_orders(admin: dict = Depends(get_current_admin)):
    docs = await db.orders.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return [OrderModel(**d) for d in docs]


@api.patch("/admin/orders/{order_id}", response_model=OrderModel)
async def admin_update_order(order_id: str, body: OrderStatusBody, admin: dict = Depends(get_current_admin)):
    r = await db.orders.update_one({"id": order_id}, {"$set": {"status": body.status}})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Замовлення не знайдено")
    doc = await db.orders.find_one({"id": order_id}, {"_id": 0})
    return OrderModel(**doc)


@api.get("/admin/analytics")
async def admin_analytics(admin: dict = Depends(get_current_admin)):
    total_users = await db.users.count_documents({"role": "employee"})
    total_quests = await db.quests.count_documents({"active": True})
    total_prizes = await db.prizes.count_documents({"active": True})
    orders_processing = await db.orders.count_documents({"status": "processing"})
    total_points_earned_pipeline = [
        {"$match": {"amount": {"$gt": 0}}},
        {"$group": {"_id": None, "sum": {"$sum": "$amount"}}},
    ]
    total_points_spent_pipeline = [
        {"$match": {"amount": {"$lt": 0}}},
        {"$group": {"_id": None, "sum": {"$sum": "$amount"}}},
    ]
    earned = await db.transactions.aggregate(total_points_earned_pipeline).to_list(1)
    spent = await db.transactions.aggregate(total_points_spent_pipeline).to_list(1)
    top_earners = await db.users.find(
        {"role": "employee"}, {"_id": 0, "id": 1, "name": 1, "total_earned": 1, "avatar_color": 1, "avatar_initials": 1}
    ).sort("total_earned", -1).limit(5).to_list(5)

    # popular quests by claim count in daily_progress
    pop_pipeline = [
        {"$unwind": "$claimed"},
        {"$group": {"_id": "$claimed", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 5},
    ]
    pop = await db.daily_progress.aggregate(pop_pipeline).to_list(5)
    quest_titles = {}
    for q in await db.quests.find({}, {"_id": 0, "id": 1, "title": 1}).to_list(500):
        quest_titles[q["id"]] = q["title"]
    popular_quests = [{"title": quest_titles.get(p["_id"], "—"), "claims": p["count"]} for p in pop]

    return {
        "total_users": total_users,
        "total_quests": total_quests,
        "total_prizes": total_prizes,
        "orders_processing": orders_processing,
        "total_points_earned": (earned[0]["sum"] if earned else 0),
        "total_points_spent": abs(spent[0]["sum"]) if spent else 0,
        "top_earners": top_earners,
        "popular_quests": popular_quests,
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
    return {"status": "ok", "service": "CallHub Game Hub Bot API"}


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
async def bot_leaderboard(limit: int = 10):
    docs = await db.users.find(
        {"role": "employee"}, {"_id": 0, "id": 1, "name": 1, "total_earned": 1, "avatar_initials": 1}
    ).sort("total_earned", -1).limit(limit).to_list(limit)
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
        inc["total_xp"] = body.amount // 2
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

SEED_PRIZES = [
    {"title": "Худі CallHub", "description": "Фірмовий чорний худі з логотипом", "price": 2500, "category": "merch", "image": "https://images.pexels.com/photos/28701952/pexels-photo-28701952.jpeg", "icon": "gift", "stock": 12},
    {"title": "Додатковий вихідний", "description": "1 оплачуваний вихідний день", "price": 5000, "category": "privilege", "image": None, "icon": "calendar-off", "stock": 5},
    {"title": "Сертифікат Rozetka 500 ₴", "description": "На будь-які покупки", "price": 3000, "category": "certificate", "image": None, "icon": "gift", "stock": 20},
    {"title": "Вибір своєї зміни", "description": "На один тиждень обирай сам", "price": 2200, "category": "privilege", "image": None, "icon": "clock-4", "stock": 8},
    {"title": "Mystery Box", "description": "Випадковий приз з каталогу", "price": 1500, "category": "merch", "image": "https://images.unsplash.com/photo-1767522248089-468ec2d4efd7", "icon": "gift", "stock": 15},
    {"title": "Довга перерва +30 хв", "description": "Одноразово, на будь-який день", "price": 900, "category": "privilege", "image": None, "icon": "coffee", "stock": 30},
    {"title": "Сертифікат Rozetka 1000 ₴", "description": "На будь-які покупки", "price": 5800, "category": "certificate", "image": None, "icon": "gift", "stock": 10},
    {"title": "Кружка CallHub", "description": "Керамічна з неоновим принтом", "price": 800, "category": "merch", "image": "https://images.pexels.com/photos/33629664/pexels-photo-33629664.jpeg", "icon": "gift", "stock": 25},
]

SEED_DEMO_USERS = [
    {"email": "anna@callhub.ua", "password": "demo123", "name": "Анна Коваль", "first_name": "Анна", "last_name": "Коваль", "position": "Оператор", "department": "Продажі • Зміна А", "avatar_initials": "АК", "avatar_color": "#FFB800", "balance": 3450, "total_earned": 12980, "total_xp": 6800, "streak": 5, "team_key": "sales_a"},
    {"email": "maks@callhub.ua", "password": "demo123", "name": "Максим Дубенко", "first_name": "Максим", "last_name": "Дубенко", "position": "Senior оператор", "department": "Підтримка • Зміна B", "avatar_initials": "МД", "avatar_color": "#00F0FF", "balance": 6120, "total_earned": 24500, "total_xp": 18000, "streak": 12, "team_key": "support_b", "is_team_leader": True},
    {"email": "olena@callhub.ua", "password": "demo123", "name": "Олена Ткач", "first_name": "Олена", "last_name": "Ткач", "position": "Оператор", "department": "Продажі • Зміна B", "avatar_initials": "ОТ", "avatar_color": "#39FF14", "balance": 2100, "total_earned": 8700, "total_xp": 4200, "streak": 3, "team_key": "sales_b"},
]

SEED_TEAMS = [
    {"key": "sales_a", "name": "Продажі А", "description": "Ранкова зміна відділу продажів", "color": "#FFB800", "department": "Продажі"},
    {"key": "sales_b", "name": "Продажі B", "description": "Вечірня зміна відділу продажів", "color": "#FF5C00", "department": "Продажі"},
    {"key": "support_b", "name": "Підтримка B", "description": "Технічна підтримка клієнтів", "color": "#00F0FF", "department": "Підтримка"},
    {"key": "retention", "name": "Утримання", "description": "Команда роботи з відтоком", "color": "#39FF14", "department": "Утримання"},
]


async def seed_all():
    # Indexes
    await db.users.create_index("email", unique=True)
    await db.users.create_index("telegram_id", sparse=True)
    await db.users.create_index("team_id", sparse=True)
    await db.quests.create_index("created_at")
    await db.prizes.create_index("created_at")
    await db.orders.create_index("user_id")
    await db.orders.create_index("created_at")
    await db.transactions.create_index([("user_id", 1), ("created_at", -1)])
    await db.transactions.create_index("created_at")
    await db.daily_progress.create_index([("user_id", 1), ("date", 1)], unique=True)
    await db.daily_games.create_index([("user_id", 1), ("date", 1)], unique=True)
    await db.daily_task_sets.create_index([("user_id", 1), ("date", 1)], unique=True)
    await db.daily_task_reviews.create_index([("user_id", 1), ("date", 1), ("task_id", 1)], unique=True)
    await db.teams.create_index("name", unique=True)

    # Teams — seed first so we can attach users
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
    elif not verify_password(ADMIN_PASSWORD, admin_doc["password_hash"]):
        await db.users.update_one({"email": ADMIN_EMAIL}, {"$set": {"password_hash": hash_password(ADMIN_PASSWORD)}})
        logger.info("Updated admin password")

    # Demo users
    for u in SEED_DEMO_USERS:
        existing = await db.users.find_one({"email": u["email"]})
        team_id = team_key_to_id.get(u.get("team_key"))
        if existing:
            # ensure legacy demo users have team_id + names set
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

    # Set team leaders from demo users
    for u in SEED_DEMO_USERS:
        if u.get("is_team_leader"):
            team_id = team_key_to_id.get(u.get("team_key"))
            if team_id:
                emp = await db.users.find_one({"email": u["email"]}, {"_id": 0, "id": 1})
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
    title: str
    body: str = ""
    link: str = ""
    icon: str = "bell"
    read: bool = False
    created_at: str


# ─── Notification helpers ───
async def _notify(user_id: str, kind: str, title: str, body: str = "", link: str = "", icon: str = "bell"):
    await db.notifications.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "kind": kind,
        "title": title,
        "body": body,
        "link": link,
        "icon": icon,
        "read": False,
        "created_at": now_iso(),
    })


async def _notify_all_employees(kind: str, title: str, body: str = "", link: str = "", icon: str = "bell"):
    docs = []
    async for u in db.users.find({"role": "employee", "approved": True}, {"_id": 0, "id": 1}):
        docs.append({
            "id": str(uuid.uuid4()), "user_id": u["id"], "kind": kind,
            "title": title, "body": body, "link": link, "icon": icon,
            "read": False, "created_at": now_iso(),
        })
    if docs:
        await db.notifications.insert_many(docs)


async def _notify_admins(kind: str, title: str, body: str = "", link: str = "", icon: str = "bell"):
    async for u in db.users.find({"role": "admin"}, {"_id": 0, "id": 1}):
        await _notify(u["id"], kind, title, body, link, icon)


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
    status: Optional[str] = None, admin: dict = Depends(get_current_admin)
):
    query: dict = {}
    if status and status in APPLICATION_STATUSES:
        query["status"] = status
    else:
        query["status"] = {"$ne": "draft"}
    docs = await db.applications.find(query, {"_id": 0}).sort("submitted_at", -1).to_list(500)
    return [_clean_app(d) for d in docs]


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
            {"$inc": {"balance": reward, "total_earned": reward, "total_xp": xp}},
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
    for d in docs:
        if d.get("team_id"):
            d["team_name"] = teams_map.get(d["team_id"])
    return [_user_with_progress(d) for d in docs]


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
        await db.users.update_one({"id": user_id}, {"$inc": {"balance": 100, "total_earned": 100, "total_xp": 50}})
    await _notify(user_id, "account_approved", "Акаунт підтверджено! 🎉",
                  "Ласкаво просимо в CallHub. +100 стартових балів", "/", "party-popper")
    fresh = await db.users.find_one({"id": user_id}, {"_id": 0})
    fresh = await _hydrate_user_team(fresh)
    return _user_with_progress(fresh)


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


async def seed_phase2():
    await db.tasks.create_index("created_at")
    await db.applications.create_index([("user_id", 1), ("updated_at", -1)])
    await db.applications.create_index([("status", 1), ("submitted_at", -1)])
    await db.notifications.create_index([("user_id", 1), ("created_at", -1)])
    await db.reactions.create_index([("target_id", 1), ("user_id", 1)], unique=True)
    await db.comments.create_index([("target_id", 1), ("created_at", 1)])
    if await db.tasks.count_documents({}) == 0:
        for t in SEED_TASKS:
            await db.tasks.insert_one({"id": str(uuid.uuid4()), **t, "active": True, "created_at": now_iso()})
        logger.info("Seeded %d tasks", len(SEED_TASKS))



@app.on_event("startup")
async def on_startup():
    await seed_all()
    await seed_phase2()


@app.on_event("shutdown")
async def on_shutdown():
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
