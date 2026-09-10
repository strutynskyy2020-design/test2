"""Read-only, team-scoped Pixel story and minigame statistics.

Lifetime progress comes from durable saves. Attempt rates use a seven-day start
cohort, within both arcade session TTLs. Reading analytics never migrates saves.
"""
import asyncio
import json
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import Depends, HTTPException, Query

try:
    from backend.pixel_campaign_content import CHAPTERS, STEPS
    from backend.pixel_campaign_season import ENDINGS, GAMES
    from backend.flappy_game import NAMES
except ModuleNotFoundError as exc:
    if exc.name != "backend":
        raise
    from pixel_campaign_content import CHAPTERS, STEPS
    from pixel_campaign_season import ENDINGS, GAMES
    from flappy_game import NAMES


def percent(part, total):
    return round(100 * part / total, 1) if total else None


def game_catalogs(bonus_levels):
    base = Path(__file__).resolve().parent
    hidden = json.loads((base / "hidden_object_levels.json").read_text(encoding="utf-8"))
    drive = json.loads((base / "pixel_drive_config.json").read_text(encoding="utf-8"))
    return {
        "bonus_match": {"levels": [{"id": row["level"], "title": row.get("name") or row.get("title") or f"Рівень {row['level']}"} for row in bonus_levels],
                        "version": next((row.get("campaign") for row in bonus_levels if row.get("campaign")), None)},
        "hidden_objects": {"levels": [{"id": row["id"], "title": row.get("title") or row.get("name") or f"Справа {row['id']}"} for row in hidden["levels"]], "version": hidden.get("version")},
        "flappy": {"levels": [{"id": i, "title": name} for i, name in enumerate(NAMES, 1)]},
        "pixel_drive": {"levels": [{"id": row["id"], "title": row["name"]} for row in drive["levels"]], "version": drive["version"]},
    }


def story_statistics(states, eligible_players):
    chapters = {c["id"]: {**c, "started": 0, "current": 0, "completed": 0, "choices": [],
                            "required_levels": sum(s.get("count", 0) for s in STEPS if s["chapter"] == c["id"])} for c in CHAPTERS}
    decisions = {s["id"]: {"id": s["id"], "title": s["title"], "chapter": s["chapter"],
                           "total": 0, "options": [{"id": c["id"], "label": c["label"], "count": 0} for c in s["choices"]]}
                 for s in STEPS if s.get("choices")}
    endings = Counter()
    completed = contact_started = contact_completed = unknown_ending = 0
    chapter_sum = 0
    for state in states:
        saved_chapters = set(state.get("completed", [])) & chapters.keys()
        chapter_sum += len(saved_chapters)
        index = max(0, int(state.get("step", 0)))
        finished = 24 in saved_chapters or index >= len(STEPS)
        current = STEPS[index]["chapter"] if index < len(STEPS) else None
        reached = max([current or 0, *saved_chapters], default=0)
        for chapter in chapters.values():
            chapter["started"] += int(chapter["id"] <= reached)
            chapter["completed"] += int(chapter["id"] in saved_chapters)
            chapter["current"] += int(not finished and chapter["id"] == current)
        if finished:
            completed += 1
            key = (state.get("ending") or {}).get("id")
            if key in ENDINGS:
                endings[key] += 1
            else:
                unknown_ending += 1
        contact = state.get("contact")
        if contact:
            contact_started += 1
            contact_completed += int(contact.get("step", 0) >= 3)
        for scene, chosen in state.get("decisions", {}).items():
            if scene in decisions:
                option = next((c for c in decisions[scene]["options"] if c["id"] == chosen), None)
                if option:
                    option["count"] += 1
                    decisions[scene]["total"] += 1
    for decision in decisions.values():
        for option in decision["options"]:
            option["share"] = percent(option["count"], decision["total"])
        chapters[decision["chapter"]]["choices"].append(decision)
    for chapter in chapters.values():
        chapter["completion_rate"] = percent(chapter["completed"], chapter["started"])
    return {"title": "Світлиця", "eligible_players": eligible_players, "started": len(states),
            "not_started": max(0, eligible_players - len(states)), "completed": completed,
            "in_progress": len(states) - completed, "completion_rate": percent(completed, len(states)),
            "average_chapters": round(chapter_sum / len(states), 1) if states else 0,
            "chapters_total": len(CHAPTERS), "required_levels": sum(s.get("count", 0) for s in STEPS),
            "chapters": list(chapters.values()), "unknown_ending": unknown_ending,
            "endings": [{"id": key, "title": ending["title"], "players": endings[key],
                         "share": percent(endings[key], completed)} for key, ending in ENDINGS.items()],
            "contact": {"started": contact_started, "completed": contact_completed}}


def game_statistics(game, catalog, profiles, completions, sessions):
    levels = {int(row["id"]): {**row, "players_completed": 0, "attempts": 0, "wins": 0, "losses": 0} for row in catalog["levels"]}
    players = set()
    cleared = defaultdict(set)
    for profile in profiles:
        uid = profile.get("user_id") or profile.get("_id")
        players.add(uid)
        if game == "flappy":
            cleared[uid].update(int(key) for key, value in profile.get("completed", {}).items() if value and int(key) in levels)
        elif game == "pixel_drive":
            cleared[uid].update(int(key) for key, track in profile.get("tracks", {}).items() if "finish" in track.get("medals", []) and int(key) in levels)
    for row in completions:
        uid, level = row["user_id"], int(row["level"])
        if level in levels:
            players.add(uid)
            cleared[uid].add(level)
    active = set()
    seen_sessions = set()
    for session in sessions:
        uid = session["user_id"]
        level = session.get("level_id", session.get("level"))
        level = level.get("id") if isinstance(level, dict) else level
        if level not in levels:
            continue
        key = str(session.get("id") or session.get("_id"))
        if key in seen_sessions:
            continue
        seen_sessions.add(key)
        players.add(uid)
        active.add(uid)
        row = levels[level]
        row["attempts"] += 1
        status = (session.get("outcome") or {}).get("status", session.get("status"))
        if status in ("won", "completed"):
            row["wins"] += 1
            cleared[uid].add(level)
        elif status in ("lost", "failed", "abandoned"):
            row["losses"] += 1
    for completed_levels in cleared.values():
        for level in completed_levels:
            levels[level]["players_completed"] += 1
    for row in levels.values():
        row["success_rate"] = percent(row["wins"], row["wins"] + row["losses"])
    total = {key: sum(row[key] for row in levels.values()) for key in ("attempts", "wins", "losses")}
    total["unfinished"] = total["attempts"] - total["wins"] - total["losses"]
    total["success_rate"] = percent(total["wins"], total["wins"] + total["losses"])
    unique = sum(len(rows) for rows in cleared.values())
    return {"id": game, "title": GAMES[game], "levels_total": len(levels), "players": len(players),
            "active_players": len(active), "unique_clears": unique,
            "completed_players": sum(len(rows) == len(levels) for rows in cleared.values()) if levels else 0,
            "average_levels": round(unique / len(players), 1) if players else 0,
            "required_story_levels": sum(s.get("count", 0) for s in STEPS if s.get("game") == game),
            "recent": total, "levels": list(levels.values())}


async def collect(cursor):
    return [row async for row in cursor]


async def build_pixel_analytics(db, catalogs, player_roles, team_id=None, now=None):
    clock = now or datetime.now(timezone.utc)
    cutoff = clock - timedelta(days=7)
    query = {"role": {"$in": list(player_roles)}}
    if team_id:
        query["team_id"] = team_id
    users = await collect(db.users.find(query, {"_id": 0, "id": 1}))
    ids = [row["id"] for row in users]
    match = {"user_id": {"$in": ids}}
    # Mongo uses type bracketing: support both legacy ISO strings and BSON dates.
    story_fields = {"step": 1, "completed": 1, "ending.id": 1, "decisions": 1, "contact.step": 1}
    states = await collect(db.pixel_campaigns.find({"_id": {"$in": ids}}, story_fields))

    async def game_rows(game):
        prefix = {"bonus_match": "bonus_match", "hidden_objects": "hidden_object", "flappy": "flappy", "pixel_drive": "pixel_drive"}[game]
        version = catalogs[game].get("version")
        version_field = {"bonus_match": "campaign", "hidden_objects": "content_version", "pixel_drive": "version"}.get(game)
        content_filter = {version_field: version} if version is not None and version_field else {}
        start_field = "started_at" if game == "hidden_objects" else "created_at"
        recent = {"$or": [{start_field: {"$gte": cutoff.isoformat(), "$lte": clock.isoformat()}},
                          {start_field: {"$gte": cutoff, "$lte": clock}}]}
        profile_match = {"_id": {"$in": ids}} if game == "pixel_drive" else match
        if game in ("bonus_match", "hidden_objects"):
            profile_match = {**profile_match, **content_filter}
        profiles, completions, sessions = await asyncio.gather(
            collect(db[f"{prefix}_profiles"].find(profile_match, {"user_id": 1, "completed": 1, "tracks": 1})),
            collect(db[f"{prefix}_completions"].find({**match, **content_filter}, {"user_id": 1, "level": 1})) if game in ("bonus_match", "hidden_objects") else asyncio.sleep(0, result=[]),
            collect(db[f"{prefix}_sessions"].find({**match, **recent, **content_filter}, {"id": 1, "user_id": 1, "level": 1, "level_id": 1, "status": 1, "outcome.status": 1})),
        )
        return game_statistics(game, catalogs[game], profiles, completions, sessions)

    games = await asyncio.gather(*(game_rows(game) for game in GAMES))
    return {"generated_at": clock.isoformat(), "team_id": team_id, "attempt_period_days": 7,
            "attempt_period_start": cutoff.isoformat(), "story": story_statistics(states, len(ids)), "games": games}


def register_pixel_analytics_routes(router, db, get_current_admin, bonus_catalog, player_roles):
    @router.get("/admin/pixel-analytics")
    async def pixel_analytics(team_id: str | None = Query(default=None, max_length=120),
                              admin=Depends(get_current_admin)):
        # Keep the boundary explicit as well as the shared admin dependency.
        if admin.get("role") != "admin":
            raise HTTPException(403, "Тільки для адміністраторів")
        return await build_pixel_analytics(db, game_catalogs(await bonus_catalog()), player_roles, team_id)
