"""Living-room/shop endpoints. Profile changes use the existing revision CAS.

Social actions never mutate another employee's pet or award Point. Sharing is
opt-in; requests and reaction cards expire, and only allowlisted room data leaves
the owner's account.
"""
from __future__ import annotations

import copy
from datetime import timedelta
from typing import Literal, Optional

from fastapi import Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from pymongo.errors import DuplicateKeyError

from pet_life import (SHOP_PRICES, SKILLS, add_material, apply_need, buy_item,
                      day, ensure_life, gain_skill, remember, stamp)


class LifeContext(BaseModel):
    model_config = ConfigDict(extra="forbid")
    date_key: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    generation: int = Field(ge=1, le=1000000)


class ShopPurchase(LifeContext):
    item_id: str = Field(min_length=1, max_length=40)


class RoomSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    theme: Optional[Literal["cyber", "home", "nature", "space"]] = None
    sound: Optional[Literal["off", "ambient"]] = None
    public_room: Optional[bool] = None
    exhibition: Optional[bool] = None


class RoomPreset(BaseModel):
    model_config = ConfigDict(extra="forbid")
    slot: int = Field(ge=1, le=3)
    action: Literal["save", "load", "delete"]
    name: str = Field(default="Моя кімната", min_length=1, max_length=30)


class LifeActivity(LifeContext):
    kind: Literal["search", "train", "special", "repair"]
    target: str = Field(min_length=1, max_length=40)


class SocialAction(LifeContext):
    target_id: str = Field(min_length=1, max_length=100)
    kind: Literal["heart", "treat", "postcard", "invite"]


class SocialAccept(LifeContext):
    invitation_id: str = Field(min_length=1, max_length=100)


def public_room(profile):
    """No email, staff name, wallet, survival, history, or private preferences."""
    return {"id": profile["user_id"], "name": profile["name"],
            "generation": profile["survival"]["generation"],
            "appearance_id": profile["appearance_id"],
            "equipped": copy.deepcopy(profile["inventory"]["equipped"]),
            "items": [key for key in profile["inventory"]["items"] if key in SHOP_PRICES],
            "room_layout": copy.deepcopy(profile.get("room_layout", {})),
            "theme": profile["life"]["theme"], "exhibition": profile["life"]["exhibition"]}


def register_life_routes(api, db, get_current_user, feature):
    f = feature

    def context(profile, body):
        if body.date_key != day(f._now()) or body.generation != profile["survival"]["generation"]:
            raise HTTPException(409, "Ця дія застаріла. Оновіть кімнату")

    async def mutate(user, operation, body=None, alive=True):
        for _ in range(4):
            profile = await f._load_profile(db, user)
            ensure_life(profile, f._now())
            if alive:
                f._require_alive(profile)
            if isinstance(body, LifeContext):
                context(profile, body)
            expected = profile["revision"]
            message = operation(profile)
            f._update_survival_condition(profile)
            if await f._save_profile(db, profile, expected):
                return {**f._snapshot(profile), "message": message}
        raise HTTPException(409, "Кімната вже оновлюється. Спробуйте ще раз")

    @api.post("/pet/shop/purchase")
    async def purchase_pet_item(body: ShopPurchase, user: dict = Depends(get_current_user)):
        def operation(profile):
            bought = buy_item(profile, body.item_id)
            item = next(row for row in f.PET_ITEMS if row["id"] == body.item_id)
            return f"Придбано: {item['name']}. Можна встановити в кімнаті." if bought else "Цей предмет уже ваш — матеріали повторно не списано"
        return await mutate(user, operation, body, alive=False)

    @api.patch("/pet/room/settings")
    async def update_pet_room_settings(body: RoomSettings, user: dict = Depends(get_current_user)):
        def operation(profile):
            changes = body.model_dump(exclude_none=True)
            profile["life"].update(changes)
            if not profile["life"]["public_room"]:
                profile["life"]["exhibition"] = False
            return "Налаштування кімнати збережено"
        return await mutate(user, operation, alive=False)

    @api.post("/pet/room/presets")
    async def manage_pet_room_preset(body: RoomPreset, user: dict = Depends(get_current_user)):
        def operation(profile):
            presets = profile["life"]["presets"]
            key = str(body.slot)
            existing = next((p for p in presets if p["id"] == key), None)
            if body.action == "load":
                if not existing:
                    raise HTTPException(404, "У цьому слоті немає збереженої кімнати")
                profile["inventory"]["equipped"] = {
                    slot: item if item in profile["inventory"]["items"] else None
                    for slot, item in existing["equipped"].items() if slot in f.DEFAULT_EQUIPPED}
                profile["room_layout"] = copy.deepcopy(existing["layout"])
                profile["room_layout"] = f._sanitized_room_layout(profile)
                profile["life"]["theme"] = existing["theme"]
            else:
                profile["life"]["presets"] = [p for p in presets if p["id"] != key]
                if body.action == "save":
                    name = body.name.strip()
                    if not name:
                        raise HTTPException(422, "Дайте назву кімнаті")
                    profile["life"]["presets"].append({"id": key, "name": name,
                        "equipped": copy.deepcopy(profile["inventory"]["equipped"]),
                        "layout": f._sanitized_room_layout(profile), "theme": profile["life"]["theme"]})
            return {"save": "Кімнату збережено", "load": "Обстановку відновлено", "delete": "Збереження видалено"}[body.action]
        return await mutate(user, operation, alive=False)

    @api.post("/pet/life/activity")
    async def pet_life_activity(body: LifeActivity, user: dict = Depends(get_current_user)):
        def operation(profile):
            life, now = profile["life"], f._now()
            daily = life["daily"]
            if (profile.get("expedition") or {}).get("status") == "active":
                raise HTTPException(409, "Котик спершу має повернутися з експедиції")
            if body.kind != "repair" and f.sleeping(profile, now):
                raise HTTPException(409, "Котик спить. Спершу розбудіть його лампою")
            if body.kind == "repair":
                item = body.target
                if item not in profile["inventory"]["items"] or item not in SHOP_PRICES:
                    raise HTTPException(404, "Цього предмета немає у вашій кімнаті")
                if life["condition"].get(item, 100) >= 100:
                    return "Цей предмет уже відновлений"
                if item in daily.get("repairs", []):
                    return "Сьогодні цей предмет уже відновлено"
                if profile["inventory"]["materials"].get("cardboard", 0) < 1 or profile["inventory"]["materials"].get("string", 0) < 1:
                    raise HTTPException(409, "Для ремонту потрібні 1 картон і 1 мотузка")
                profile["inventory"]["materials"]["cardboard"] -= 1
                profile["inventory"]["materials"]["string"] -= 1
                life["condition"][item] = 100
                daily.setdefault("repairs", []).append(item)
                return "Предмет відновлено до 100%"
            flag = "search_used" if body.kind == "search" else "skill_used"
            receipt = daily.get(f"{flag}_receipt")
            if daily.get(flag):
                if receipt and receipt["kind"] == body.kind and receipt["target"] == body.target:
                    return receipt["message"]
                raise HTTPException(409, "Сьогодні цей запас активності вже використано")
            if profile["stats"].get("energy", 0) < 25 or profile["stats"].get("health", 0) < 35 or profile["survival"].get("illness"):
                raise HTTPException(409, "Спершу відпочинок і відновлення: потрібно 25 енергії та 35 здоров’я, без хвороби")
            if body.kind == "search":
                loot_table = {"shelf": {"cardboard": 3, "string": 2}, "window": {"leaf": 2, "feather": 1}, "bed": {"fabric": 2, "leaf": 1}}
                loot = loot_table.get(body.target)
                if not loot:
                    raise HTTPException(422, "Оберіть полицю, вікно або лежанку")
                for key, amount in loot.items():
                    add_material(profile, key, amount)
                apply_need(profile, "energy", -10)
                apply_need(profile, "cleanliness", -3)
                gain_skill(profile, "explorer", 5)
                message = "Знайдено: " + ", ".join(f"{f.MATERIAL_NAMES[key]} ×{amount}" for key, amount in loot.items())
                pose = "play"
            else:
                if body.target not in SKILLS:
                    raise HTTPException(422, "Невідома навичка")
                special = body.kind == "special"
                if special and life["skills"][body.target] < 25:
                    raise HTTPException(409, "Особливе заняття відкривається після 25 досвіду цієї навички")
                gain_skill(profile, body.target, 8 if special else 6)
                apply_need(profile, "energy", -12 if special else -8)
                apply_need(profile, "mood", 8 if special else 3)
                if special and body.target == "companion":
                    profile["trust"] = min(20, profile["trust"] + 1)
                activities = {"hunter": "Стрибок за пір’їнкою", "explorer": "Маршрут таємних слідів", "actor": "Вистава для господаря", "thinker": "Загадка під полицею", "companion": "Наш тихий ритуал"}
                message = (activities[body.target] if special else f"Тренування: {SKILLS[body.target]['name']}") + (" · досвід +8, настрій +8" if special else " · досвід +6, настрій +3")
                pose = "sleep" if body.target == "companion" else "play" if body.target == "hunter" else "sit"
            daily[flag] = True
            daily[f"{flag}_receipt"] = {"kind": body.kind, "target": body.target, "message": message}
            life["activity_at"] = now.isoformat()
            life["activity_pose"] = pose
            life["activity_zone"] = body.target if body.kind == "search" else "toy" if body.target == "hunter" else "bed"
            remember(profile, f"activity:{day(now)}:{flag}", "Нове заняття", message, now, "activity", "positive")
            return message
        return await mutate(user, operation, body)

    async def shared_profile(user_id):
        raw = await db.pet_profiles.find_one({"user_id": user_id}, {"_id": 0})
        if not raw or not raw.get("life", {}).get("public_room"):
            raise HTTPException(404, "Кімната приватна або недоступна")
        profile, _ = f._advance_profile(raw)
        if profile["survival"]["status"] != "alive":
            raise HTTPException(404, "Кімната зараз недоступна")
        return profile

    @api.get("/pet/social/rooms")
    async def get_shared_pet_rooms(after: str = "", exhibition: bool = False, user: dict = Depends(get_current_user)):
        if len(after) > 100:
            raise HTTPException(422, "Некоректний курсор")
        query = {"life.public_room": True, "survival.status": "alive", "user_id": {"$gt": after, "$ne": user["id"]}}
        if exhibition:
            query["life.exhibition"] = True
        rows = await db.pet_profiles.find(query, {"_id": 0}).sort("user_id", 1).to_list(13)
        items = []
        for row in rows[:12]:
            advanced, _ = f._advance_profile(row)
            if advanced["survival"]["status"] == "alive":
                items.append(public_room(advanced))
        return {"items": items, "next_cursor": rows[11]["user_id"] if len(rows) > 12 else None}

    @api.get("/pet/social/inbox")
    async def get_pet_social_inbox(user: dict = Depends(get_current_user)):
        profile = await f._load_profile(db, user)
        rows = await db.pet_social.find({"$or": [{"sender": user["id"]}, {"target": user["id"]}], "purge_at": {"$gt": f._now()}}, {"_id": 0, "purge_at": 0}).sort("created_at", -1).to_list(30)
        valid = []
        for row in rows:
            try:
                other = await shared_profile(row["target"] if row["sender"] == user["id"] else row["sender"])
                if not profile["life"]["public_room"]:
                    continue
                own_generation = row["sender_generation"] if row["sender"] == user["id"] else row["target_generation"]
                other_generation = row["target_generation"] if row["sender"] == user["id"] else row["sender_generation"]
                if own_generation != profile["survival"]["generation"] or other_generation != other["survival"]["generation"]:
                    continue
                valid.append({**row, "other": public_room(other), "outgoing": row["sender"] == user["id"]})
            except HTTPException:
                continue
        return {"items": valid, "today_used": bool(await db.pet_social.find_one({"id": f"{user['id']}:{day(f._now())}"}))}

    @api.post("/pet/social/react")
    async def react_to_pet_room(body: SocialAction, user: dict = Depends(get_current_user)):
        if body.target_id == user["id"]:
            raise HTTPException(422, "Оберіть іншого котика")
        profile = await f._load_profile(db, user)
        context(profile, body)
        f._require_alive(profile)
        if not profile["life"]["public_room"]:
            raise HTTPException(409, "Спочатку дозвольте гостям бачити вашу кімнату")
        target = await shared_profile(body.target_id)
        now = f._now()
        key = f"{user['id']}:{day(now)}"
        titles = {"heart": "Лапка симпатії", "treat": "Віртуальні ласощі", "postcard": "Затишку вашому дому!", "invite": "Запрошення на спільну прогулянку"}
        row = {"_id": key, "id": key, "sender": user["id"], "target": body.target_id,
               "sender_generation": profile["survival"]["generation"], "target_generation": target["survival"]["generation"],
               "kind": body.kind, "title": titles[body.kind], "created_at": now.isoformat(),
               "purge_at": now + timedelta(days=30), "status": "pending" if body.kind == "invite" else "sent"}
        try:
            await db.pet_social.insert_one(row)
        except DuplicateKeyError:
            existing = await db.pet_social.find_one({"id": key})
            if not existing or existing["target"] != body.target_id or existing["kind"] != body.kind:
                raise HTTPException(409, "Сьогодні ви вже залишили знак уваги. Новий — завтра")
        return {"message": titles[body.kind] + ". Це знак уваги, без зміни ситості чи нагород."}

    @api.post("/pet/social/accept")
    async def accept_pet_outing(body: SocialAccept, user: dict = Depends(get_current_user)):
        profile = await f._load_profile(db, user)
        context(profile, body)
        f._require_alive(profile)
        if not profile["life"]["public_room"]:
            raise HTTPException(409, "Спільні прогулянки доступні лише відкритим кімнатам")
        invitation = await db.pet_social.find_one({"id": body.invitation_id, "target": user["id"], "kind": "invite", "purge_at": {"$gt": f._now()}})
        if not invitation:
            raise HTTPException(404, "Запрошення вже недоступне")
        sender = await shared_profile(invitation["sender"])
        if invitation["target_generation"] != profile["survival"]["generation"] or invitation["sender_generation"] != sender["survival"]["generation"]:
            raise HTTPException(409, "Запрошення належить попередній історії котика")
        if invitation.get("status") == "accepted":
            return {"message": "Це запрошення вже прийняте — час прогулянки не змінено"}
        # One accepted outing per recipient/day, atomically on the personal profile.
        def operation(current):
            used = current["life"]["daily"].get("outing")
            if used and used != body.invitation_id:
                raise HTTPException(409, "Сьогодні вже обрано спільну прогулянку")
            current["life"]["daily"]["outing"] = body.invitation_id
            return "Запрошення прийнято. Спільна прогулянка триватиме 2 години"
        await mutate(user, operation, body)
        await db.pet_social.update_one({"id": body.invitation_id, "status": "pending"}, {"$set": {
            "status": "accepted", "ends_at": (f._now() + timedelta(hours=2)).isoformat()}})
        return {"message": "Спільний маршрут триває 2 години; основний догляд залишається доступним"}

    @api.post("/pet/social/photo")
    async def save_pet_outing_photo(body: SocialAccept, user: dict = Depends(get_current_user)):
        raise HTTPException(410, "Функцію фото прибрано. Попередні спогади збережено.")
