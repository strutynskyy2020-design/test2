import asyncio
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch
from zoneinfo import ZoneInfo

import pytest
from fastapi import APIRouter, HTTPException
from pydantic import ValidationError

from pet_feature import (
    DEFAULT_EQUIPPED,
    PET_DAILY_EVENTS,
    PET_GAMES,
    PET_ITEMS,
    PET_RULES_VERSION,
    PET_STORY_SCENES,
    PetCareBody,
    PetEquipBody,
    PetEventChoiceBody,
    PetMinigameEvent,
    PetMinigameFinishBody,
    PetRoomLayoutBody,
    PetRoomPlacement,
    PetStoryChoiceBody,
    _advance_profile,
    _apply_narrative_effects,
    _build_minigame_challenge,
    _daily_event,
    _decode_journal_cursor,
    _encode_journal_cursor,
    _command_marker,
    _mark_command_applied,
    _load_profile,
    _new_profile,
    _fresh_daily,
    _ensure_daily_event_offer,
    _parse_iso,
    _public_session,
    _reward_deck,
    _reward_from_card,
    _snapshot,
    _story_status,
    _score_minigame,
    _survival_decay_hours,
    _update_survival_condition,
    _workday_decay_hours,
    register_pet_routes,
)


def test_each_user_gets_an_independent_compact_profile():
    first = _new_profile({"id": "employee-a"})
    second = _new_profile({"id": "employee-b"})

    assert first["user_id"] == "employee-a"
    assert second["user_id"] == "employee-b"
    assert first["id"] != second["id"]
    first["stats"]["mood"] = 1
    assert second["stats"]["mood"] == 78
    assert first["reward_budget"]["points"] == 0
    assert len(first["reward_deck"]["cards"]) == 10
    assert first["stats"]["health"] == 100
    assert first["stats"]["cleanliness"] == 90
    assert first["survival"]["status"] == "alive"
    assert first["survival"]["condition"] == "healthy"
    assert first["rules_version"] == PET_RULES_VERSION


def test_personal_reward_deck_is_deterministic_and_bounded():
    deck = _reward_deck("employee-a", 0)
    rewards = [_reward_from_card(card) for card in deck]

    assert deck == _reward_deck("employee-a", 0)
    assert sorted(deck) != sorted(_reward_deck("employee-a", 1)) or deck != _reward_deck("employee-a", 1)
    assert len(deck) == len(set(deck)) == 10
    assert sum(reward.get("amount", 0) for reward in rewards if reward["type"] == "points") == 25
    assert {reward["type"] for reward in rewards} == {"points", "item", "material"}


def test_snapshot_never_exposes_private_roll_or_binary_artwork():
    profile = _new_profile({"id": "employee-a"})
    profile["expedition"] = {
        "id": "exp-1",
        "status": "active",
        "ends_at": "2099-01-01T00:00:00+00:00",
        "outcome": {"material": "fabric", "amount": 2},
    }

    result = _snapshot(profile)

    assert "outcome" not in result["pet"]["expedition"]
    assert "reward_deck" not in result["pet"]
    assert "reward_budget" not in result["pet"]
    assert "applied_commands" not in result["pet"]
    assert "applied_minigame_reward_keys" not in result["pet"]
    assert "needs_exact" not in result["pet"]["survival"]
    assert "adoption_command_id" not in result["pet"]["survival"]
    assert result["storage"] == {"artwork": "static-pwa-assets", "mongo_blobs": False}
    assert result["catalog"]["room"]["background_asset"].endswith(".webp")
    assert all("effect" not in choice and "effects" not in choice and "requires_materials" not in choice for choice in result["daily_event"]["choices"])
    assert "path_scores" not in result["pet"]["story"]
    assert "flags" not in result["pet"]["story"]
    assert all("effects" not in choice and "requires_materials" not in choice for choice in result["story"]["current_scene"]["choices"])


def test_room_catalog_has_lightweight_bounded_layer_metadata():
    for item in PET_ITEMS:
        room = item.get("room")
        assert room and room["asset"].startswith("/pet/room/v2/") and room["asset"].endswith(".webp")
        assert isinstance(room.get("z_index"), int)
        if room.get("attach_to") == "cat":
            assert item["slot"] == "collar"
            continue
        assert 0 <= room["x"] <= 100
        assert 0 <= room["y"] <= 100
        assert 1 <= room["width"] <= 100
        assert room["anchor"] in {"center", "bottom"}


def test_mongo_profile_stores_only_item_ids_not_room_assets():
    profile = _new_profile({"id": "employee-a"})
    serialized = repr(profile)

    assert ".webp" not in serialized
    assert "room" not in profile["inventory"]
    assert profile["inventory"]["equipped"] == DEFAULT_EQUIPPED


def test_old_profile_equipped_slots_are_backfilled_without_replacing_choice():
    original = _new_profile({"id": "employee-a"})
    original["inventory"]["equipped"] = {"bed": "pillow-starlight", "floor": "rug-cyan", "wall": None}
    original["daily"].pop("last_action_at")

    advanced, changed = _advance_profile(original)

    assert changed is True
    assert advanced["inventory"]["equipped"]["bed"] == "pillow-starlight"
    assert advanced["inventory"]["equipped"]["floor"] == "rug-cyan"
    assert advanced["inventory"]["equipped"]["wall"] is None
    assert set(advanced["inventory"]["equipped"]) == set(DEFAULT_EQUIPPED)
    assert advanced["daily"]["last_action_at"] is None


def test_old_profile_room_layout_is_sanitized_without_dropping_owned_unequipped_items():
    original = _new_profile({"id": "employee-a"})
    original["inventory"]["items"].extend(["camera-retro", "collar-violet"])
    original["room_layout"] = {
        "camera-retro": {"x": 24.0, "y": 31.0},
        "bed-basic": {"x": 50.0, "y": 77.0},
        "missing-item": {"x": 30.0, "y": 30.0},
        "rug-cyan": {"x": 50.0, "y": 72.0},
        "collar-violet": {"x": 50.0, "y": 50.0},
        "toy-wand": {"x": "not-a-number", "y": 60.0},
        "bowl-amber": {"x": 101.0, "y": 50.0},
    }

    advanced, changed = _advance_profile(original)

    assert changed is True
    assert advanced["room_layout"] == {
        "camera-retro": {"x": 24.0, "y": 31.0},
    }


def test_fresh_daily_has_timestamp_for_short_lived_pose_reactions():
    assert _fresh_daily()["last_action_at"] is None
    assert _fresh_daily()["rejected_actions"] == []


def test_mongo_naive_datetime_is_normalized_to_utc():
    parsed = _parse_iso(datetime(2026, 9, 4, 12, 30))

    assert parsed == datetime(2026, 9, 4, 12, 30, tzinfo=timezone.utc)


def test_weekend_hours_do_not_decay_care_stats():
    kyiv = ZoneInfo("Europe/Kyiv")
    friday_evening = datetime(2026, 9, 4, 20, tzinfo=kyiv)
    monday_morning = datetime(2026, 9, 7, 10, tzinfo=kyiv)

    assert _workday_decay_hours(friday_evening, monday_morning) == pytest.approx(6.0)


def test_strict_survival_clock_runs_weekday_nights_but_protects_weekends():
    kyiv = ZoneInfo("Europe/Kyiv")
    friday_evening = datetime(2026, 9, 4, 20, tzinfo=kyiv)
    monday_morning = datetime(2026, 9, 7, 10, tzinfo=kyiv)
    saturday = datetime(2026, 9, 5, 0, tzinfo=kyiv)
    monday = datetime(2026, 9, 7, 0, tzinfo=kyiv)

    assert _survival_decay_hours(friday_evening, monday_morning) == pytest.approx(14.0)
    assert _survival_decay_hours(saturday, monday) == 0


def test_legacy_profile_migration_never_applies_retroactive_terminal_decay():
    profile = _new_profile({"id": "employee-a"})
    original_stats = {"satiety": 41, "mood": 38, "energy": 52}
    profile["stats"] = deepcopy(original_stats)
    profile.pop("survival")
    profile["rules_version"] = "pet-v1"
    profile["last_decay_at"] = "2025-01-01T00:00:00+00:00"
    now = datetime(2026, 9, 7, 9, tzinfo=timezone.utc)

    with patch("pet_feature._now", return_value=now):
        advanced, changed = _advance_profile(profile)

    assert changed is True
    assert {key: advanced["stats"][key] for key in original_stats} == original_stats
    assert advanced["stats"]["health"] == 100
    assert advanced["stats"]["cleanliness"] == 90
    assert advanced["survival"]["status"] == "alive"
    assert _parse_iso(advanced["survival"]["grace_until"]) == now + timedelta(hours=12)
    assert _parse_iso(advanced["last_decay_at"]) == now


def test_versioned_survival_migration_preserves_terminal_state_and_generation():
    profile = _new_profile({"id": "employee-a"})
    profile["survival"].update({
        "version": 0,
        "generation": "3",
        "status": "dead",
        "condition": "critical",
        "illness": "weakness",
        "ended_at": "2026-09-01T10:00:00+00:00",
        "end_reason": "health_depleted",
    })
    now = datetime(2026, 9, 7, 9, tzinfo=timezone.utc)

    with patch("pet_feature._now", return_value=now):
        advanced, _ = _advance_profile(profile)

    assert advanced["survival"]["version"] == 1
    assert advanced["survival"]["generation"] == 3
    assert advanced["survival"]["status"] == "dead"
    assert advanced["survival"]["illness"] == "weakness"
    assert advanced["survival"]["ended_at"] == "2026-09-01T10:00:00+00:00"


@pytest.mark.parametrize("broken", [None, [], "legacy-corruption"])
def test_migration_normalizes_non_mapping_stats_daily_and_inventory(broken):
    profile = _new_profile({"id": "employee-a"})
    profile["stats"] = deepcopy(broken)
    profile["daily"] = deepcopy(broken)
    profile["inventory"] = deepcopy(broken)

    advanced, changed = _advance_profile(profile)

    assert changed is True
    assert advanced["stats"] == {
        "satiety": 72,
        "mood": 78,
        "energy": 76,
        "health": 100,
        "cleanliness": 90,
    }
    assert isinstance(advanced["daily"], dict)
    assert advanced["daily"]["care_actions"] == []
    assert advanced["daily"]["rejected_actions"] == []
    assert set(advanced["inventory"]["equipped"]) == set(DEFAULT_EQUIPPED)
    assert set(DEFAULT_EQUIPPED.values()) - {None} <= set(advanced["inventory"]["items"])
    assert set(advanced["inventory"]["materials"]) == {"cardboard", "string", "fabric", "feather", "leaf", "photo"}


def _neglected_profile(start: datetime) -> dict:
    profile = _new_profile({"id": "employee-a"})
    profile["last_decay_at"] = start.isoformat()
    profile["survival"]["grace_until"] = start.isoformat()
    profile["daily"]["date"] = "2026-09-07"
    return profile


def test_prolonged_emotional_neglect_can_make_the_cat_run_away():
    kyiv = ZoneInfo("Europe/Kyiv")
    start = datetime(2026, 9, 7, 0, tzinfo=kyiv).astimezone(timezone.utc)
    profile = _neglected_profile(start)
    now = start + timedelta(hours=82)

    with patch("pet_feature._now", return_value=now), patch("pet_feature._date_key", return_value="2026-09-10"):
        advanced, changed = _advance_profile(profile)

    assert changed is True
    assert advanced["trust"] == 0
    assert advanced["stats"]["health"] > 0
    assert advanced["survival"]["runaway_hours"] >= 12
    assert advanced["survival"]["status"] == "runaway"
    assert advanced["survival"]["end_reason"] == "trust_depleted"


def test_prolonged_starvation_reaches_irreversible_death_before_other_outcome():
    kyiv = ZoneInfo("Europe/Kyiv")
    start = datetime(2026, 9, 7, 0, tzinfo=kyiv).astimezone(timezone.utc)
    profile = _neglected_profile(start)
    profile["trust"] = 20
    now = start + timedelta(hours=106)

    with patch("pet_feature._now", return_value=now), patch("pet_feature._date_key", return_value="2026-09-11"):
        advanced, _ = _advance_profile(profile)

    assert advanced["stats"]["satiety"] == 0
    assert advanced["stats"]["health"] == 0
    assert advanced["survival"]["status"] == "dead"
    assert advanced["survival"]["condition"] == "critical"
    assert advanced["survival"]["end_reason"] == "health_depleted"


def test_health_zero_is_terminal_immediately_even_outside_a_decay_tick():
    profile = _new_profile({"id": "employee-a"})
    profile["stats"]["health"] = 0

    _update_survival_condition(profile)

    assert profile["survival"]["status"] == "dead"
    assert profile["survival"]["end_reason"] == "health_depleted"


def test_survival_outcome_is_identical_for_one_large_tick_and_hourly_polling():
    kyiv = ZoneInfo("Europe/Kyiv")
    start = datetime(2026, 9, 7, 0, tzinfo=kyiv).astimezone(timezone.utc)
    end = start + timedelta(hours=82)
    one_shot = _neglected_profile(start)
    hourly = deepcopy(one_shot)
    irregular = deepcopy(one_shot)

    with patch("pet_feature._now", return_value=end), patch("pet_feature._date_key", return_value="2026-09-10"):
        one_shot, _ = _advance_profile(one_shot)

    for elapsed in range(1, 83):
        tick = start + timedelta(hours=elapsed)
        with patch("pet_feature._now", return_value=tick), patch("pet_feature._date_key", return_value="2026-09-10"):
            hourly, _ = _advance_profile(hourly)

    tick = start
    intervals = (65, 90)
    index = 0
    while tick < end:
        tick = min(end, tick + timedelta(minutes=intervals[index % len(intervals)]))
        index += 1
        with patch("pet_feature._now", return_value=tick), patch("pet_feature._date_key", return_value="2026-09-10"):
            irregular, _ = _advance_profile(irregular)

    assert hourly["stats"] == one_shot["stats"]
    assert irregular["stats"] == one_shot["stats"]
    assert hourly["trust"] == one_shot["trust"]
    assert irregular["trust"] == one_shot["trust"]
    for key in ("status", "condition", "illness", "runaway_hours", "critical_since", "ended_at", "end_reason"):
        assert hourly["survival"][key] == one_shot["survival"][key]
        assert irregular["survival"][key] == one_shot["survival"][key]


def test_journal_cursor_round_trip_is_opaque_and_stable():
    item = {"occurred_at": "2026-09-04T12:30:00.123456+00:00", "id": "event-42"}

    cursor = _encode_journal_cursor(item)

    assert "2026-09-04" not in cursor
    assert _decode_journal_cursor(cursor) == (item["occurred_at"], item["id"])
    with pytest.raises(ValueError):
        _decode_journal_cursor("not-a-valid-cursor")


def test_command_marker_keeps_immutable_gift_date_across_daily_rollover():
    profile = _new_profile({"id": "employee-a"})
    command = {"id": "command-1"}
    decided = {"reward": {"type": "points", "amount": 5}, "reward_date": "2026-09-04"}

    _mark_command_applied(profile, command, "gift", decided)
    decided["reward_date"] = "2099-01-01"
    profile["daily"]["date"] = "2026-09-05"

    marker = _command_marker(profile, command["id"])
    assert marker["result"]["reward_date"] == "2026-09-04"


def test_new_day_keeps_expedition_receipt_for_idempotent_claim_replay():
    original = _new_profile({"id": "employee-a"})
    original["daily"]["date"] = "2026-09-03"
    original["expedition"] = {"id": "done", "status": "claimed"}

    with patch("pet_feature._date_key", return_value="2026-09-04"), patch(
        "pet_feature._week_key", return_value=original["weekly_project"]["week"]
    ):
        advanced, changed = _advance_profile(original)

    assert changed is True
    assert advanced["expedition"]["id"] == "done"

    active = deepcopy(original)
    active["expedition"] = {"id": "active", "status": "active", "ends_at": "2099-01-01T00:00:00+00:00"}
    with patch("pet_feature._date_key", return_value="2026-09-04"), patch(
        "pet_feature._week_key", return_value=active["weekly_project"]["week"]
    ):
        advanced_active, _ = _advance_profile(active)
    assert advanced_active["expedition"]["id"] == "active"


def test_daily_event_returns_only_public_choice_data():
    profile = _new_profile({"id": "employee-a"})
    event = _daily_event(profile)
    assert event
    assert all(set(choice) == {"id", "label", "hint", "impact", "locked_reason"} for choice in event["choices"])
    assert all(choice["hint"] and isinstance(choice["impact"], list) for choice in event["choices"])


def test_old_profile_gets_story_state_and_a_stable_daily_event_offer():
    profile = _new_profile({"id": "employee-a"})
    profile.pop("story")
    for key in ("event_offered", "event_id", "event_result", "story_resolved", "story_result"):
        profile["daily"].pop(key, None)

    advanced, changed = _advance_profile(profile)
    offered_id = advanced["daily"]["event_id"]

    assert changed is True
    assert advanced["story"]["arc_id"] == "night-mail-v1"
    assert advanced["daily"]["event_offered"] is True
    assert offered_id in {event["id"] for event in PET_DAILY_EVENTS}
    assert _ensure_daily_event_offer(advanced) is False
    assert advanced["daily"]["event_id"] == offered_id


def test_story_without_generation_is_reset_for_the_current_cat():
    profile = _new_profile({"id": "employee-a"})
    profile["story"]["completed_scenes"] = [PET_STORY_SCENES[0]["id"]]
    profile["story"]["decisions"] = {PET_STORY_SCENES[0]["id"]: "study-clue"}
    profile["story"].pop("generation")

    advanced, changed = _advance_profile(profile)

    assert changed is True
    assert advanced["story"]["generation"] == advanced["survival"]["generation"]
    assert advanced["story"]["completed_scenes"] == []
    assert advanced["story"]["decisions"] == {}


def test_narrative_effects_change_needs_trust_traits_preferences_and_path():
    profile = _new_profile({"id": "employee-a"})
    before_energy = profile["stats"]["energy"]
    before_trust = profile["trust"]
    before_intelligence = profile["traits"]["intelligence"]

    impact = _apply_narrative_effects(profile, {
        "stats": {"energy": -8, "mood": 6},
        "trust": 2,
        "traits": {"intelligence": 3},
        "path": {"thinker": 2},
        "preference": {"toy": "puzzle"},
        "flags_add": ["tested_choice"],
        "xp": 4,
    })

    assert profile["stats"]["energy"] == before_energy - 8
    assert profile["trust"] == before_trust + 2
    assert profile["traits"]["intelligence"] == before_intelligence + 3
    assert profile["story"]["path_scores"]["thinker"] == 2
    assert profile["preferences"]["toy"] == "puzzle"
    assert "tested_choice" in profile["story"]["flags"]
    assert any(item["tone"] == "cost" for item in impact)


def test_narrative_survival_effects_create_real_temporary_states_and_clear_picky_food():
    profile = _new_profile({"id": "employee-a"})
    profile["survival"].update({
        "recent_foods": ["balanced", "balanced", "balanced"],
        "reaction": "picky",
        "reaction_until": (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat(),
    })

    cleared = _apply_narrative_effects(profile, {"survival": {"clear_recent_foods": True}})
    assert profile["survival"]["recent_foods"] == []
    assert profile["survival"]["reaction"] is None
    assert any(item["label"] == "Вередливість минула" for item in cleared)

    started = datetime.now(timezone.utc)
    applied = _apply_narrative_effects(profile, {"survival": {
        "reaction": "do_not_touch", "reaction_hours": 4, "touch_cooldown_hours": 4,
    }})
    assert profile["survival"]["mood_state"] == "do_not_touch"
    assert _parse_iso(profile["survival"]["reaction_until"]) > started + timedelta(hours=3, minutes=59)
    assert _parse_iso(profile["survival"]["touch_cooldown_until"]) > started + timedelta(hours=3, minutes=59)
    assert any(item["kind"] == "condition" and item["tone"] == "risk" for item in applied)


def test_five_consecutive_choices_can_change_post_story_temperament():
    profile = _new_profile({"id": "employee-a"})
    profile["story"]["ending"] = "explorer"

    final_impact = []
    for _ in range(5):
        final_impact = _apply_narrative_effects(profile, {"path": {"thinker": 1}})

    assert profile["story"]["temperament"] == "thinker"
    assert profile["story"]["recent_path_choices"] == []
    assert any(item["kind"] == "temperament" for item in final_impact)


def test_minigame_move_limit_is_enforced():
    PetMinigameFinishBody(moves=list(range(32)))
    with pytest.raises(ValidationError):
        PetMinigameFinishBody(moves=list(range(33)))


def test_minigame_catalog_exposes_three_distinct_server_games():
    assert [game["id"] for game in PET_GAMES] == ["memory", "laser", "sorting"]
    assert {game["mode"] for game in PET_GAMES} == {"sequence", "reaction", "sorting"}
    assert {game["input"] for game in PET_GAMES} == {"moves", "events"}
    assert all(game["description"] and game["duration_seconds"] > 0 for game in PET_GAMES)


def test_server_builds_deterministic_distinct_challenges_without_sorting_answers():
    built = {
        game_id: _build_minigame_challenge("session-1", "employee-a", game_id)
        for game_id in ("memory", "laser", "sorting")
    }

    assert built == {
        game_id: _build_minigame_challenge("session-1", "employee-a", game_id)
        for game_id in ("memory", "laser", "sorting")
    }
    memory_private, memory_public = built["memory"]
    laser_private, laser_public = built["laser"]
    sorting_private, sorting_public = built["sorting"]
    assert memory_private["kind"] == memory_public["kind"] == "sequence"
    assert len(memory_private["solution"]) == len(memory_public["cues"]) == 6
    assert "solution" not in memory_public
    assert laser_private["kind"] == laser_public["kind"] == "timed-targets"
    assert len(laser_private["targets"]) == len(laser_public["targets"]) == 10
    assert all({"id", "lane", "at_ms", "window_ms"} == set(target) for target in laser_public["targets"])
    assert sorting_private["kind"] == sorting_public["kind"] == "sorting"
    assert len(sorting_private["cards"]) == len(sorting_public["cards"]) == 9
    assert all("correct_lane" in card for card in sorting_private["cards"])
    assert all("correct_lane" not in card for card in sorting_public["cards"])


def test_active_session_projection_never_exposes_private_answer_keys():
    challenge, public_challenge = _build_minigame_challenge("session-1", "employee-a", "sorting")
    public_challenge["answer_key"] = [2, 1, 0]
    public_challenge["cards"][0]["correct_lane"] = 2
    session = {
        "id": "session-1",
        "game_id": "sorting",
        "status": "active",
        "challenge": challenge,
        "public_challenge": public_challenge,
        "purge_at": datetime(2026, 9, 10, tzinfo=timezone.utc),
    }

    active = _public_session(session)

    assert "challenge" not in active
    assert "purge_at" not in active
    assert "correct_lane" not in repr(active)
    assert "review" not in active

    completed = _public_session({**session, "status": "completed"})
    assert "challenge" not in completed
    assert completed["review"]["kind"] == "sorting"
    assert len(completed["review"]["correct_lanes"]) == 9


def test_server_scores_each_challenge_shape_from_raw_actions():
    started = datetime(2026, 9, 4, 9, 0, tzinfo=timezone.utc)
    finished = started + timedelta(seconds=30)

    memory, _ = _build_minigame_challenge("memory-session", "employee-a", "memory")
    memory_score, memory_detail = _score_minigame(
        {"started_at": started.isoformat(), "challenge": memory},
        PetMinigameFinishBody(moves=memory["solution"], client_duration_ms=4_000),
        finished,
    )
    assert memory_score == 100
    assert memory_detail == {"kind": "sequence", "correct": 6, "total": 6, "invalid": 0}

    laser, _ = _build_minigame_challenge("laser-session", "employee-a", "laser")
    laser_score, laser_detail = _score_minigame(
        {"started_at": started.isoformat(), "challenge": laser},
        PetMinigameFinishBody(
            events=[
                PetMinigameEvent(target_id=target["id"], lane=target["lane"], at_ms=target["at_ms"] + 20)
                for target in laser["targets"]
            ],
            client_duration_ms=laser["duration_ms"],
        ),
        finished,
    )
    assert laser_score == 100
    assert laser_detail["correct"] == laser_detail["total"] == 10

    sorting, _ = _build_minigame_challenge("sorting-session", "employee-a", "sorting")
    sorting_score, sorting_detail = _score_minigame(
        {"started_at": started.isoformat(), "challenge": sorting},
        PetMinigameFinishBody(
            events=[
                PetMinigameEvent(target_id=card["id"], lane=card["correct_lane"], at_ms=200 + index * 400)
                for index, card in enumerate(sorting["cards"])
            ],
            client_duration_ms=4_000,
        ),
        finished,
    )
    assert sorting_score == 100
    assert sorting_detail["correct"] == sorting_detail["total"] == 9


def test_forged_minigame_totals_early_taps_duplicates_and_clock_claims_do_not_score_high():
    started = datetime(2026, 9, 4, 9, 0, tzinfo=timezone.utc)
    laser, _ = _build_minigame_challenge("laser-session", "employee-a", "laser")
    session = {"started_at": started.isoformat(), "challenge": laser}

    # Unknown client fields, including a claimed score, are never used by the scorer.
    claimed_score = PetMinigameFinishBody.model_validate({"score": 100, "events": []})
    score, _ = _score_minigame(session, claimed_score, started + timedelta(seconds=30))
    assert score == 0

    early_events = [
        PetMinigameEvent(
            target_id=target["id"],
            lane=target["lane"],
            at_ms=max(0, target["at_ms"] - target["window_ms"]),
        )
        for target in laser["targets"]
    ]
    early_score, early_detail = _score_minigame(
        session,
        PetMinigameFinishBody(events=early_events, client_duration_ms=laser["duration_ms"]),
        started + timedelta(seconds=30),
    )
    assert early_score == 0
    assert early_detail["correct"] == 0

    missing_lane_events = [
        PetMinigameEvent(target_id=target["id"], at_ms=target["at_ms"] + 20)
        for target in laser["targets"]
    ]
    missing_lane_score, missing_lane_detail = _score_minigame(
        session,
        PetMinigameFinishBody(events=missing_lane_events, client_duration_ms=laser["duration_ms"]),
        started + timedelta(seconds=30),
    )
    assert missing_lane_score == 0
    assert missing_lane_detail["correct"] == 0
    assert missing_lane_detail["invalid"] == len(laser["targets"])

    first = laser["targets"][0]
    duplicate_score, duplicate_detail = _score_minigame(
        session,
        PetMinigameFinishBody(
            events=[
                PetMinigameEvent(target_id=first["id"], lane=first["lane"], at_ms=first["at_ms"])
                for _ in range(64)
            ],
            client_duration_ms=laser["duration_ms"],
        ),
        started + timedelta(seconds=30),
    )
    assert duplicate_score < 50
    assert duplicate_detail["invalid"] >= 63

    clock_score, clock_detail = _score_minigame(
        session,
        PetMinigameFinishBody(events=[], client_duration_ms=120_000),
        started + timedelta(seconds=30),
    )
    assert clock_score == 0
    assert clock_detail["reason"] == "invalid_client_clock"


def test_minigame_rejects_too_early_finish_and_limits_event_payload():
    started = datetime(2026, 9, 4, 9, 0, tzinfo=timezone.utc)
    memory, _ = _build_minigame_challenge("memory-session", "employee-a", "memory")

    score, detail = _score_minigame(
        {"started_at": started.isoformat(), "challenge": memory},
        PetMinigameFinishBody(moves=memory["solution"]),
        started + timedelta(seconds=1),
    )

    assert score == 0
    assert detail["reason"] == "too_early"
    PetMinigameFinishBody(events=[PetMinigameEvent(target_id=0, at_ms=0)] * 64)
    with pytest.raises(ValidationError):
        PetMinigameFinishBody(events=[PetMinigameEvent(target_id=0, at_ms=0)] * 65)
    with pytest.raises(ValidationError):
        PetMinigameEvent(target_id=0, at_ms=0, lane=4)


@pytest.mark.parametrize(
    ("axis", "value"),
    [
        ("x", -0.01),
        ("x", 100.01),
        ("y", -0.01),
        ("y", 100.01),
        ("x", float("nan")),
        ("y", float("inf")),
    ],
)
def test_room_placement_rejects_non_finite_and_out_of_bounds_coordinates(axis, value):
    payload = {"item_id": "bed-basic", "x": 50, "y": 50, axis: value}

    with pytest.raises(ValidationError):
        PetRoomPlacement(**payload)


def test_room_placement_accepts_canvas_edges():
    placement = PetRoomPlacement(item_id="bed-basic", x=0, y=100)

    assert placement.x == 0
    assert placement.y == 100


def test_pet_route_contract_is_registered():
    router = APIRouter()

    async def current_user():
        return {"id": "employee-a"}

    async def notify(*_args):
        return None

    register_pet_routes(router, object(), current_user, notify)
    paths = {(method, route.path) for route in router.routes for method in route.methods}

    expected = {
        ("GET", "/pet"),
        ("PATCH", "/pet"),
        ("POST", "/pet/adopt"),
        ("POST", "/pet/care"),
        ("POST", "/pet/intent"),
        ("POST", "/pet/photo"),
        ("POST", "/pet/events/choose"),
        ("POST", "/pet/story/choose"),
        ("POST", "/pet/expeditions"),
        ("POST", "/pet/expeditions/{expedition_id}/claim"),
        ("POST", "/pet/tricks/{trick_id}/practice"),
        ("POST", "/pet/project/contribute"),
        ("POST", "/pet/minigames/{game_id}/start"),
        ("POST", "/pet/minigames/sessions/{session_id}/finish"),
        ("POST", "/pet/collection/equip"),
        ("POST", "/pet/collection/unequip"),
        ("PATCH", "/pet/room/layout"),
        ("POST", "/pet/gift/claim"),
        ("GET", "/pet/journal"),
    }
    assert expected <= paths


class _FakeCommandCollection:
    def __init__(self):
        self.docs = {}

    async def insert_one(self, doc):
        self.docs[doc["id"]] = deepcopy(doc)
        return object()

    async def find_one(self, query, _projection=None):
        return deepcopy(self.docs.get(query.get("id")))

    async def update_one(self, query, update, **_kwargs):
        doc_id = query.get("id")
        created = doc_id not in self.docs
        doc = self.docs.setdefault(doc_id, {"id": doc_id})
        if created:
            doc.update(deepcopy(update.get("$setOnInsert", {})))
        doc.update(deepcopy(update.get("$set", {})))
        return object()


class _FakeNoopCollection:
    def __init__(self, rows=None):
        self.rows = {row["id"]: deepcopy(row) for row in (rows or [])}
        self.update_many_calls = []

    async def update_many(self, *_args, **_kwargs):
        self.update_many_calls.append((_args, _kwargs))
        return object()

    async def find_one(self, query, _projection=None):
        if "id" in query:
            return deepcopy(self.rows.get(query["id"]))
        return None

    async def update_one(self, query, update, **_kwargs):
        row = self.rows.get(query.get("id"))
        if row is not None:
            row.update(deepcopy(update.get("$set", {})))
        return object()


class _FakePetDb:
    def __init__(self, minigame_rows=None):
        self.pet_commands = _FakeCommandCollection()
        self.pet_minigame_sessions = _FakeNoopCollection(minigame_rows)
        self.pet_reward_claims = _FakeCommandCollection()


def _pet_endpoint(path: str, db=None):
    router = APIRouter()

    async def current_user():
        return {"id": "employee-a"}

    async def notify(*_args):
        return None

    register_pet_routes(router, db or _FakePetDb(), current_user, notify)
    return next(route.endpoint for route in router.routes if route.path == path)


def _run_profile_endpoint(endpoint, profile, *args, **kwargs):
    async def run():
        with patch("pet_feature._load_profile", AsyncMock(return_value=profile)), patch(
            "pet_feature._save_profile", AsyncMock(return_value=True)
        ), patch("pet_feature._record_event", AsyncMock(return_value={})), patch(
            "pet_feature._recent_events", AsyncMock(return_value=[])
        ):
            return await endpoint(*args, user={"id": "employee-a"}, **kwargs)

    return asyncio.run(run())


def test_story_choice_progresses_arc_and_same_choice_replays_idempotently():
    profile = _new_profile({"id": "employee-a"})
    endpoint = _pet_endpoint("/pet/story/choose")
    scene = PET_STORY_SCENES[0]
    body = PetStoryChoiceBody(
        scene_id=scene["id"], choice_id="study-clue",
        date_key=profile["daily"]["date"], generation=profile["survival"]["generation"],
    )

    result = _run_profile_endpoint(endpoint, profile, body)

    assert result["idempotent"] is False
    assert result["outcome"]["choice_id"] == "study-clue"
    assert scene["id"] in profile["story"]["completed_scenes"]
    assert profile["story"]["decisions"][scene["id"]] == "study-clue"
    assert profile["story"]["path_scores"]["thinker"] == 2
    assert profile["daily"]["narrative_pose"] == result["outcome"]["pose"]
    assert _story_status(profile)["status"] == "waiting"

    replay = _run_profile_endpoint(endpoint, profile, body)
    assert replay["idempotent"] is True
    assert replay["outcome"] == result["outcome"]


def test_story_choice_rejects_a_different_second_decision_same_day():
    profile = _new_profile({"id": "employee-a"})
    endpoint = _pet_endpoint("/pet/story/choose")
    scene = PET_STORY_SCENES[0]
    _run_profile_endpoint(endpoint, profile, PetStoryChoiceBody(
        scene_id=scene["id"], choice_id="follow-now",
        date_key=profile["daily"]["date"], generation=profile["survival"]["generation"],
    ))

    with pytest.raises(HTTPException) as caught:
        _run_profile_endpoint(endpoint, profile, PetStoryChoiceBody(
            scene_id=scene["id"], choice_id="stay-together",
            date_key=profile["daily"]["date"], generation=profile["survival"]["generation"],
        ))

    assert caught.value.status_code == 409
    assert profile["story"]["decisions"][scene["id"]] == "follow-now"


def test_narrative_routes_reject_stale_day_and_generation_without_mutation():
    story_profile = _new_profile({"id": "employee-a"})
    story_before = deepcopy(story_profile["story"])
    story_endpoint = _pet_endpoint("/pet/story/choose")
    with pytest.raises(HTTPException) as stale_story:
        _run_profile_endpoint(story_endpoint, story_profile, PetStoryChoiceBody(
            scene_id=PET_STORY_SCENES[0]["id"], choice_id="study-clue",
            date_key="2000-01-01", generation=story_profile["survival"]["generation"],
        ))
    assert stale_story.value.status_code == 409
    assert story_profile["story"] == story_before

    event_profile = _new_profile({"id": "employee-a"})
    event_profile["daily"].update({"event_offered": True, "event_id": "night-zoomies", "event_resolved": False})
    event_before = deepcopy(event_profile)
    event_endpoint = _pet_endpoint("/pet/events/choose")
    with pytest.raises(HTTPException) as stale_event:
        _run_profile_endpoint(event_endpoint, event_profile, PetEventChoiceBody(
            event_id="night-zoomies", choice_id="wand",
            date_key=event_profile["daily"]["date"], generation=event_profile["survival"]["generation"] + 1,
        ))
    assert stale_event.value.status_code == 409
    assert event_profile == event_before


def test_random_event_choice_applies_real_tradeoff_and_persists_outcome():
    profile = _new_profile({"id": "employee-a"})
    profile["daily"].update({"event_offered": True, "event_id": "night-zoomies", "event_resolved": False})
    endpoint = _pet_endpoint("/pet/events/choose")
    before_energy = profile["stats"]["energy"]
    body = PetEventChoiceBody(
        event_id="night-zoomies", choice_id="wand",
        date_key=profile["daily"]["date"], generation=profile["survival"]["generation"],
    )

    result = _run_profile_endpoint(endpoint, profile, body)

    assert result["idempotent"] is False
    assert profile["stats"]["energy"] == before_energy - 14
    assert profile["preferences"]["toy"] == "wand"
    assert profile["daily"]["event_result"]["choice_id"] == "wand"
    assert "night-zoomies" in profile["story"]["recent_event_ids"]
    assert any(item["tone"] == "cost" for item in result["outcome"]["impact"])

    replay = _run_profile_endpoint(endpoint, profile, body)
    assert replay["idempotent"] is True
    assert profile["stats"]["energy"] == before_energy - 14


def test_load_reconciles_a_previously_saved_terminal_milestone():
    profile = _new_profile({"id": "employee-a"})
    profile["survival"].update({
        "status": "dead",
        "condition": "critical",
        "end_reason": "health_depleted",
        "generation": 4,
    })

    class _Profiles:
        async def find_one(self, *_args, **_kwargs):
            return deepcopy(profile)

    class _Db:
        pet_profiles = _Profiles()

    record_event = AsyncMock(return_value={})

    async def run():
        with patch("pet_feature._advance_profile", return_value=(deepcopy(profile), False)), patch(
            "pet_feature._record_event", record_event
        ):
            await _load_profile(_Db(), {"id": "employee-a"})
            await _load_profile(_Db(), {"id": "employee-a"})

    asyncio.run(run())

    assert record_event.await_count == 2
    for call in record_event.await_args_list:
        assert call.kwargs["source_key"] == "pet-terminal:employee-a:4"
        assert call.kwargs["important"] is True


def test_clean_and_heal_are_real_care_actions_and_heal_clears_illness():
    clean_profile = _new_profile({"id": "employee-a"})
    clean_profile["stats"]["cleanliness"] = 20
    clean_endpoint = _pet_endpoint("/pet/care")

    clean_result = _run_profile_endpoint(
        clean_endpoint,
        clean_profile,
        PetCareBody(action="clean"),
        idempotency_key="care-clean-0001",
    )

    assert clean_result["effects"]["cleanliness"] == 55
    assert clean_profile["stats"]["cleanliness"] == 75
    assert "clean" in clean_profile["daily"]["care_actions"]

    heal_profile = _new_profile({"id": "employee-a"})
    heal_profile["stats"]["health"] = 40
    heal_profile["stats"]["cleanliness"] = 25
    heal_profile["survival"]["illness"] = "infection"
    heal_endpoint = _pet_endpoint("/pet/care")

    heal_result = _run_profile_endpoint(
        heal_endpoint,
        heal_profile,
        PetCareBody(action="heal"),
        idempotency_key="care-heal-0001",
    )

    assert heal_result["effects"]["health"] == 40
    assert heal_profile["stats"]["health"] == 80
    assert heal_profile["survival"]["illness"] is None
    assert "heal" in heal_profile["daily"]["care_actions"]


def test_low_mood_cat_rejects_forced_petting_and_loses_trust():
    profile = _new_profile({"id": "employee-a"})
    profile["stats"]["mood"] = 20
    profile["survival"]["mood_state"] = "do_not_touch"
    endpoint = _pet_endpoint("/pet/care")

    result = _run_profile_endpoint(
        endpoint,
        profile,
        PetCareBody(action="pet"),
        idempotency_key="care-pet-reject-0001",
    )

    assert result["rejected"] is True
    assert result["reaction"] == "do_not_touch"
    assert profile["stats"]["mood"] == 13
    assert profile["trust"] == 4
    assert "pet" not in profile["daily"]["care_actions"]
    assert profile["daily"]["rejected_actions"] == ["pet"]


def test_repetitive_food_and_exhausted_play_have_negative_consequences():
    food_profile = _new_profile({"id": "employee-a"})
    food_profile["stats"]["satiety"] = 20
    food_profile["survival"]["recent_foods"] = ["balanced", "balanced"]
    food_profile["preferences"]["food"] = "fish"
    food_endpoint = _pet_endpoint("/pet/care")

    food_result = _run_profile_endpoint(
        food_endpoint,
        food_profile,
        PetCareBody(action="feed", option="balanced"),
        idempotency_key="care-food-repeat-0001",
    )

    assert food_result["reaction"] == "picky"
    assert food_result["trust_gained"] == 0
    assert food_profile["stats"]["satiety"] == 26
    assert food_profile["stats"]["mood"] == 72

    play_profile = _new_profile({"id": "employee-a"})
    play_profile["stats"]["energy"] = 20
    play_endpoint = _pet_endpoint("/pet/care")

    play_result = _run_profile_endpoint(
        play_endpoint,
        play_profile,
        PetCareBody(action="play", option="wand"),
        idempotency_key="care-play-tired-0001",
    )

    assert play_result["reaction"] == "exhausted"
    assert play_profile["stats"]["health"] == 94
    assert play_profile["stats"]["energy"] == 6
    assert play_result["trust_gained"] == 0


def test_terminal_pet_blocks_active_care_interaction():
    profile = _new_profile({"id": "employee-a"})
    profile["survival"]["status"] = "runaway"
    endpoint = _pet_endpoint("/pet/care")

    with pytest.raises(HTTPException) as error:
        _run_profile_endpoint(
            endpoint,
            profile,
            PetCareBody(action="feed"),
            idempotency_key="care-after-runaway-0001",
        )

    assert error.value.status_code == 409


def test_adoption_preserves_room_collection_but_resets_the_relationship():
    profile = _new_profile({"id": "employee-a"})
    profile["inventory"]["items"].extend(["rug-cyan", "plant-moon"])
    profile["inventory"]["equipped"]["floor"] = "rug-cyan"
    profile["inventory"]["equipped"]["decor"] = "plant-moon"
    profile["room_layout"] = {"plant-moon": {"x": 22, "y": 63}}
    profile["friendship_xp"] = 720
    profile["friendship_level"] = 10
    profile["trust"] = 0
    profile["survival"]["status"] = "dead"
    profile["survival"]["condition"] = "critical"
    profile["survival"]["generation"] = 1
    inventory_before = deepcopy(profile["inventory"])
    layout_before = deepcopy(profile["room_layout"])
    db = _FakePetDb()
    endpoint = _pet_endpoint("/pet/adopt", db)

    result = _run_profile_endpoint(endpoint, profile, idempotency_key="adopt-generation-0001")

    assert profile["inventory"] == inventory_before
    assert profile["room_layout"] == layout_before
    assert profile["friendship_level"] == 1
    assert profile["friendship_xp"] == 0
    assert profile["trust"] == 6
    assert profile["survival"]["generation"] == 2
    assert profile["survival"]["status"] == "alive"
    assert result["pet"]["stats"]["health"] == 100
    assert profile["daily"]["adoption_day"] is True
    assert profile["daily"]["gift_claimed"] is True
    assert profile["daily"]["focus_used"] is True
    assert len(db.pet_minigame_sessions.update_many_calls) == 1

    replay = _run_profile_endpoint(endpoint, profile, idempotency_key="adopt-generation-0001")
    assert replay["idempotent"] is True
    assert replay["pet"]["survival"]["generation"] == 2
    assert len(db.pet_minigame_sessions.update_many_calls) == 2


def test_minigame_from_an_old_pet_generation_cannot_reward_the_new_cat():
    profile = _new_profile({"id": "employee-a"})
    profile["survival"]["generation"] = 2
    session = {
        "id": "old-session",
        "user_id": "employee-a",
        "game_id": "memory",
        "pet_generation": 1,
        "status": "active",
        "sequence": [0, 1, 2, 3],
        "expires_at": "2099-01-01T00:00:00+00:00",
    }
    db = _FakePetDb([session])
    endpoint = _pet_endpoint("/pet/minigames/sessions/{session_id}/finish", db)

    with pytest.raises(HTTPException) as error:
        _run_profile_endpoint(
            endpoint,
            profile,
            "old-session",
            PetMinigameFinishBody(moves=[0, 1, 2, 3]),
        )

    assert error.value.status_code == 409
    assert "попередньому" in error.value.detail


def test_completed_same_generation_minigame_repairs_reward_after_terminal_state():
    profile = _new_profile({"id": "employee-a"})
    profile["survival"].update({"status": "dead", "condition": "critical", "generation": 1})
    profile["stats"]["health"] = 0
    session = {
        "id": "completed-session",
        "user_id": "employee-a",
        "game_id": "memory",
        "pet_generation": 1,
        "status": "completed",
        "sequence": [0, 1, 2, 3],
        "score": 100,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "expires_at": "2099-01-01T00:00:00+00:00",
        "rewarded": False,
    }
    db = _FakePetDb([session])
    endpoint = _pet_endpoint("/pet/minigames/sessions/{session_id}/finish", db)

    first = _run_profile_endpoint(
        endpoint,
        profile,
        "completed-session",
        PetMinigameFinishBody(moves=[]),
    )
    feather_after_first = profile["inventory"]["materials"]["feather"]
    trust_after_first = profile["trust"]
    second = _run_profile_endpoint(
        endpoint,
        profile,
        "completed-session",
        PetMinigameFinishBody(moves=[]),
    )

    assert first["idempotent"] is True
    assert first["rewarded"] is True
    assert second["rewarded"] is True
    assert feather_after_first == 1
    assert profile["inventory"]["materials"]["feather"] == feather_after_first
    assert profile["trust"] == trust_after_first
    assert db.pet_minigame_sessions.rows["completed-session"]["reward_status"] == "applied"


def test_terminal_pet_cannot_finish_an_active_same_generation_minigame():
    profile = _new_profile({"id": "employee-a"})
    profile["survival"].update({"status": "runaway", "condition": "critical", "generation": 1})
    session = {
        "id": "active-terminal-session",
        "user_id": "employee-a",
        "game_id": "memory",
        "pet_generation": 1,
        "status": "active",
        "sequence": [0, 1, 2, 3],
        "expires_at": "2099-01-01T00:00:00+00:00",
    }
    db = _FakePetDb([session])
    endpoint = _pet_endpoint("/pet/minigames/sessions/{session_id}/finish", db)

    with pytest.raises(HTTPException) as error:
        _run_profile_endpoint(
            endpoint,
            profile,
            "active-terminal-session",
            PetMinigameFinishBody(moves=[0, 1, 2, 3]),
        )

    assert error.value.status_code == 409
    assert db.pet_minigame_sessions.rows["active-terminal-session"]["status"] == "active"


@pytest.mark.parametrize("reason", ["invalid_client_clock", "unsupported_challenge"])
def test_invalid_minigame_submission_does_not_consume_active_session(reason):
    profile = _new_profile({"id": "employee-a"})
    session = {
        "id": f"invalid-{reason}",
        "user_id": "employee-a",
        "game_id": "laser",
        "pet_generation": 1,
        "status": "active",
        "challenge": {"kind": "timed-targets", "min_duration_ms": 0},
        "started_at": datetime.now(timezone.utc).isoformat(),
        "expires_at": "2099-01-01T00:00:00+00:00",
    }
    db = _FakePetDb([session])
    endpoint = _pet_endpoint("/pet/minigames/sessions/{session_id}/finish", db)

    with patch("pet_feature._score_minigame", return_value=(0, {"kind": "timed-targets", "reason": reason})):
        with pytest.raises(HTTPException) as error:
            _run_profile_endpoint(
                endpoint,
                profile,
                session["id"],
                PetMinigameFinishBody(events=[], client_duration_ms=1_000),
            )

    assert error.value.status_code == 409
    assert db.pet_minigame_sessions.rows[session["id"]]["status"] == "active"


def test_claiming_a_gift_no_longer_spends_survival_trust():
    profile = _new_profile({"id": "employee-a"})
    profile["trust"] = 10
    profile["daily"]["ritual_complete"] = True
    profile["reward_deck"] = {"cycle": 0, "cursor": 0, "cards": ["material-cardboard"]}
    endpoint = _pet_endpoint("/pet/gift/claim")

    result = _run_profile_endpoint(
        endpoint,
        profile,
        idempotency_key="gift-does-not-spend-trust-0001",
    )

    assert result["gift"]["claimed"] is True
    assert profile["trust"] == 10
    assert profile["survival"]["status"] == "alive"
    assert profile["survival"]["runaway_hours"] == 0


def test_unequip_clears_only_the_expected_room_slot():
    router = APIRouter()

    async def current_user():
        return {"id": "employee-a"}

    async def notify(*_args):
        return None

    register_pet_routes(router, object(), current_user, notify)
    endpoint = next(route.endpoint for route in router.routes if route.path == "/pet/collection/unequip")
    profile = _new_profile({"id": "employee-a"})

    async def run():
        with patch("pet_feature._load_profile", AsyncMock(return_value=profile)), patch(
            "pet_feature._save_profile", AsyncMock(return_value=True)
        ), patch("pet_feature._record_event", AsyncMock(return_value={})), patch(
            "pet_feature._recent_events", AsyncMock(return_value=[])
        ):
            return await endpoint(PetEquipBody(item_id="bed-basic"), user={"id": "employee-a"})

    result = asyncio.run(run())

    assert profile["inventory"]["equipped"]["bed"] is None
    assert result["message"] == "Предмет забрано з кімнати"


def test_stale_unequip_request_does_not_remove_a_replacement():
    router = APIRouter()

    async def current_user():
        return {"id": "employee-a"}

    async def notify(*_args):
        return None

    register_pet_routes(router, object(), current_user, notify)
    endpoint = next(route.endpoint for route in router.routes if route.path == "/pet/collection/unequip")
    profile = _new_profile({"id": "employee-a"})
    profile["inventory"]["items"].append("pillow-starlight")
    profile["inventory"]["equipped"]["bed"] = "pillow-starlight"

    async def run():
        with patch("pet_feature._load_profile", AsyncMock(return_value=profile)), patch(
            "pet_feature._recent_events", AsyncMock(return_value=[])
        ):
            return await endpoint(PetEquipBody(item_id="bed-basic"), user={"id": "employee-a"})

    result = asyncio.run(run())

    assert profile["inventory"]["equipped"]["bed"] == "pillow-starlight"
    assert result["idempotent"] is True


def _room_layout_endpoint():
    router = APIRouter()

    async def current_user():
        return {"id": "employee-a"}

    async def notify(*_args):
        return None

    register_pet_routes(router, object(), current_user, notify)
    return next(route.endpoint for route in router.routes if route.path == "/pet/room/layout")


def test_room_layout_saves_an_atomic_batch_and_supports_camera_shelf_slot():
    endpoint = _room_layout_endpoint()
    profile = _new_profile({"id": "employee-a"})
    profile["inventory"]["items"].append("camera-retro")
    profile["inventory"]["equipped"]["shelf"] = "camera-retro"
    save_profile = AsyncMock(return_value=True)
    body = PetRoomLayoutBody(
        placements=[
            PetRoomPlacement(item_id="bed-basic", x=61.25, y=72.5),
            PetRoomPlacement(item_id="camera-retro", x=24, y=31),
        ]
    )

    async def run():
        with patch("pet_feature._load_profile", AsyncMock(return_value=profile)), patch(
            "pet_feature._save_profile", save_profile
        ), patch("pet_feature._record_event", AsyncMock(return_value={})), patch(
            "pet_feature._recent_events", AsyncMock(return_value=[])
        ):
            return await endpoint(body, user={"id": "employee-a"})

    result = asyncio.run(run())

    assert profile["room_layout"] == {
        "bed-basic": {"x": 61.25, "y": 72.5},
        "camera-retro": {"x": 24.0, "y": 31.0},
    }
    assert result["pet"]["room_layout"] == profile["room_layout"]
    save_profile.assert_awaited_once()


def test_room_layout_catalog_defaults_remove_a_saved_override():
    endpoint = _room_layout_endpoint()
    profile = _new_profile({"id": "employee-a"})
    profile["room_layout"] = {"bed-basic": {"x": 42.0, "y": 68.0}}
    save_profile = AsyncMock(return_value=True)
    body = PetRoomLayoutBody(
        placements=[PetRoomPlacement(item_id="bed-basic", x=50, y=77)]
    )

    async def run():
        with patch("pet_feature._load_profile", AsyncMock(return_value=profile)), patch(
            "pet_feature._save_profile", save_profile
        ), patch("pet_feature._record_event", AsyncMock(return_value={})), patch(
            "pet_feature._recent_events", AsyncMock(return_value=[])
        ):
            return await endpoint(body, user={"id": "employee-a"})

    result = asyncio.run(run())

    assert "bed-basic" not in profile["room_layout"]
    assert "bed-basic" not in result["pet"]["room_layout"]
    save_profile.assert_awaited_once()


def test_room_layout_default_without_an_override_is_idempotent():
    endpoint = _room_layout_endpoint()
    profile = _new_profile({"id": "employee-a"})
    save_profile = AsyncMock(return_value=True)
    body = PetRoomLayoutBody(
        placements=[PetRoomPlacement(item_id="bed-basic", x=50, y=77)]
    )

    async def run():
        with patch("pet_feature._load_profile", AsyncMock(return_value=profile)), patch(
            "pet_feature._save_profile", save_profile
        ), patch("pet_feature._recent_events", AsyncMock(return_value=[])):
            return await endpoint(body, user={"id": "employee-a"})

    result = asyncio.run(run())

    assert profile["room_layout"] == {}
    assert result["idempotent"] is True
    save_profile.assert_not_awaited()


@pytest.mark.parametrize(
    ("item_id", "expected_status"),
    [
        ("missing-item", 404),
        ("rug-cyan", 403),
    ],
)
def test_room_layout_rejects_unknown_and_unowned_item_ids(item_id, expected_status):
    endpoint = _room_layout_endpoint()
    profile = _new_profile({"id": "employee-a"})
    if item_id == "rug-cyan":
        # A forged equipped value must not bypass the ownership check.
        profile["inventory"]["equipped"]["floor"] = item_id
    save_profile = AsyncMock(return_value=True)
    body = PetRoomLayoutBody(
        placements=[PetRoomPlacement(item_id=item_id, x=40, y=40)]
    )

    async def run():
        with patch("pet_feature._load_profile", AsyncMock(return_value=profile)), patch(
            "pet_feature._save_profile", save_profile
        ):
            return await endpoint(body, user={"id": "employee-a"})

    with pytest.raises(HTTPException) as error:
        asyncio.run(run())

    assert error.value.status_code == expected_status
    assert profile["room_layout"] == {}
    save_profile.assert_not_awaited()


def test_room_layout_rejects_an_owned_but_unequipped_item():
    endpoint = _room_layout_endpoint()
    profile = _new_profile({"id": "employee-a"})
    profile["inventory"]["items"].append("rug-cyan")
    save_profile = AsyncMock(return_value=True)
    body = PetRoomLayoutBody(
        placements=[PetRoomPlacement(item_id="rug-cyan", x=44, y=73)]
    )

    async def run():
        with patch("pet_feature._load_profile", AsyncMock(return_value=profile)), patch(
            "pet_feature._save_profile", save_profile
        ):
            return await endpoint(body, user={"id": "employee-a"})

    with pytest.raises(HTTPException) as error:
        asyncio.run(run())

    assert error.value.status_code == 409
    assert profile["room_layout"] == {}
    save_profile.assert_not_awaited()


def test_room_layout_rejects_the_pose_attached_collar():
    endpoint = _room_layout_endpoint()
    profile = _new_profile({"id": "employee-a"})
    profile["inventory"]["items"].append("collar-violet")
    profile["inventory"]["equipped"]["collar"] = "collar-violet"
    save_profile = AsyncMock(return_value=True)
    body = PetRoomLayoutBody(
        placements=[PetRoomPlacement(item_id="collar-violet", x=50, y=50)]
    )

    async def run():
        with patch("pet_feature._load_profile", AsyncMock(return_value=profile)), patch(
            "pet_feature._save_profile", save_profile
        ):
            return await endpoint(body, user={"id": "employee-a"})

    with pytest.raises(HTTPException) as error:
        asyncio.run(run())

    assert error.value.status_code == 400
    assert profile["room_layout"] == {}
    save_profile.assert_not_awaited()


def test_room_layout_rejects_coordinates_outside_the_items_move_bounds():
    endpoint = _room_layout_endpoint()
    profile = _new_profile({"id": "employee-a"})
    save_profile = AsyncMock(return_value=True)
    # The value is globally valid (0..100), but the bed must remain in its
    # authored floor zone (x=34..66, y=70..84).
    body = PetRoomLayoutBody(
        placements=[PetRoomPlacement(item_id="bed-basic", x=20, y=77)]
    )

    async def run():
        with patch("pet_feature._load_profile", AsyncMock(return_value=profile)), patch(
            "pet_feature._save_profile", save_profile
        ):
            return await endpoint(body, user={"id": "employee-a"})

    with pytest.raises(HTTPException) as error:
        asyncio.run(run())

    assert error.value.status_code == 400
    assert profile["room_layout"] == {}
    save_profile.assert_not_awaited()


def test_room_layout_rejects_the_whole_batch_before_changing_any_item():
    endpoint = _room_layout_endpoint()
    profile = _new_profile({"id": "employee-a"})
    profile["inventory"]["items"].append("rug-cyan")
    save_profile = AsyncMock(return_value=True)
    body = PetRoomLayoutBody(
        placements=[
            PetRoomPlacement(item_id="bed-basic", x=63, y=71),
            PetRoomPlacement(item_id="rug-cyan", x=50, y=70),
        ]
    )

    async def run():
        with patch("pet_feature._load_profile", AsyncMock(return_value=profile)), patch(
            "pet_feature._save_profile", save_profile
        ):
            return await endpoint(body, user={"id": "employee-a"})

    with pytest.raises(HTTPException) as error:
        asyncio.run(run())

    assert error.value.status_code == 409
    assert profile["room_layout"] == {}
    save_profile.assert_not_awaited()


def test_room_layout_occ_retry_revalidates_that_the_item_is_still_equipped():
    endpoint = _room_layout_endpoint()
    first = _new_profile({"id": "employee-a"})
    replacement = _new_profile({"id": "employee-a"})
    replacement["revision"] = first["revision"] + 1
    replacement["inventory"]["items"].append("pillow-starlight")
    replacement["inventory"]["equipped"]["bed"] = "pillow-starlight"
    load_profile = AsyncMock(side_effect=[first, replacement])
    save_profile = AsyncMock(return_value=False)
    body = PetRoomLayoutBody(
        placements=[PetRoomPlacement(item_id="bed-basic", x=64, y=70)]
    )

    async def run():
        with patch("pet_feature._load_profile", load_profile), patch(
            "pet_feature._save_profile", save_profile
        ):
            return await endpoint(body, user={"id": "employee-a"})

    with pytest.raises(HTTPException) as error:
        asyncio.run(run())

    assert error.value.status_code == 409
    assert replacement["room_layout"] == {}
    assert "pillow-starlight" not in replacement["room_layout"]
    save_profile.assert_awaited_once()
