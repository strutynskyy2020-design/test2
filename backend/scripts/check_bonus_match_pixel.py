"""Check the new catalog, real engine and retry-safe reset in an isolated local DB."""
import asyncio
import copy
import json
import os
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
os.environ.update(MONGO_URL="mongodb://127.0.0.1:27017", DB_NAME="bonus_match_pixel_qa_20260909")
import server as game


def check_catalog():
    levels = json.loads((ROOT / "backend/bonus_match_levels.json").read_text(encoding="utf-8"))
    assert levels == json.loads((ROOT / "frontend/src/data/bonusMatchLevels.json").read_text(encoding="utf-8"))
    assert [row["level"] for row in levels] == list(range(1,151))
    assert len({json.dumps(row["obstacle_layout"], sort_keys=True) for row in levels}) == 150
    for level in levels:
        coords = {(cell["row"],cell["col"]) for cell in level["obstacle_layout"]}
        assert len(coords) == len(level["obstacle_layout"])
        assert all(0 <= r < 8 and 0 <= c < 8 for r,c in coords)
        assert sum(c["obstacle"] == level["objective"]["obstacle"] for c in level["obstacle_layout"]) == level["objective"]["count"]
        config = game._bonus_match_level_config(level["level"])
        for seed in range(3):
            random.seed(level["level"]*100+seed)
            board = game._bonus_match_make_board(level["level"], config)
            assert len(board) == 8 and all(len(row)==8 for row in board)
            assert not game._bonus_match_find_matches(board)
            assert game._bonus_match_has_move(board)
            assert sum(bool(c.get("obstacle")) for row in board for c in row) == len(coords)
            assert not game._bonus_match_objective_met(board,config,1000000,1000)
            cleared = [[{**c,"obstacle": None} if c.get("obstacle") == level["objective"]["obstacle"] else c for c in row] for row in board]
            assert game._bonus_match_objective_met(cleared,config,0,0)
    assert levels[0]["moves"] == 18 and levels[0]["objective"]["count"] == 8
    print("PASS: 150 unique catalogs, 450 playable starts, real obstacle goals.")


async def integration():
    # All mutations in this file are limited to the dedicated QA database.
    assert game.db.name == "bonus_match_pixel_qa_20260909"
    await game.client.drop_database(game.db.name)
    user={"id":"bonus-pixel-qa", "name":"Перевірка Пікселя", "email":"bonus-pixel-qa@example.test", "role":"employee", "balance":500, "xp":0, "avatar_initials":"П", "avatar_color":"#e8b15d"}
    await game.db.users.insert_one(user.copy())
    await game.db.bonus_match_profiles.insert_one({"user_id":user["id"],"current_level":150,"total_stars":450,"boosters":{"hammer":3,"shuffle":3,"color_bomb":3,"rocket":3},"lives":1})
    for collection in (game.db.bonus_match_levels,game.db.bonus_match_completions,game.db.bonus_match_sessions):
        await collection.insert_one({"level":1,"user_id":user["id"],"id":"retired"})
    await game.migrate_bonus_match_pixel_campaign()
    profile=await game._bonus_match_profile(user["id"])
    assert profile["current_level"]==1 and profile["boosters"]["hammer"]==3
    assert (await game.db.users.find_one({"id":user["id"]}))["balance"]==500
    assert not await game.db.bonus_match_levels.count_documents({})
    assert not await game.db.bonus_match_completions.count_documents({})
    assert not await game.db.bonus_match_sessions.count_documents({})
    random.seed(18)
    started=await game.bonus_match_start(game.BonusMatchStartBody(level=1),user)
    session=started["session"]
    assert len(session["board"])==8 and session["moves_left"]==18
    await game.migrate_bonus_match_pixel_campaign()
    assert await game.db.bonus_match_sessions.count_documents({"id":session["id"]})==1
    # Simulate a retry after the reset marker was lost: new-version rows survive.
    await game.db.system_migrations.delete_one({"id":"bonus_match_pixel_room_2026_09"})
    await game.migrate_bonus_match_pixel_campaign()
    assert await game.db.bonus_match_sessions.count_documents({"id":session["id"]})==1
    status=await game.bonus_match_status(user)
    artifacts=ROOT/'artifacts/bonus-match-pixel';artifacts.mkdir(exist_ok=True)
    (artifacts/'status.json').write_text(json.dumps(status,ensure_ascii=False),encoding='utf-8')
    # Real swaps, including edge cells, are sent to the production move resolver.
    first_fixture=None
    for turn in range(50):
        if session['status']!='active': break
        board=session['board']; options=[]
        for r in range(8):
            for c in range(8):
                for rr,cc in ((r+1,c),(r,c+1)):
                    if rr>=8 or cc>=8 or not game._bonus_match_cell_swappable(board[r][c]) or not game._bonus_match_cell_swappable(board[rr][cc]): continue
                    candidate=copy.deepcopy(board);candidate[r][c],candidate[rr][cc]=candidate[rr][cc],candidate[r][c]
                    hits=game._bonus_match_find_matches(candidate)
                    special=board[r][c].get('special') or board[rr][cc].get('special')
                    if hits or special:
                        near=sum(bool(board[y][x].get('obstacle')) for y,x in set().union(*(game._bonus_match_nearby_cells(y,x) for y,x in hits))) if hits else 0
                        options.append((near*10+len(hits)+(8 if special else 0),(r,c,rr,cc)))
        assert options, 'No move on active board'
        r,c,rr,cc=max(options)[1]
        body=game.BonusMatchMoveBody(session_id=session['id'],from_row=r,from_col=c,to_row=rr,to_col=cc)
        response=await game.bonus_match_move(body,user)
        assert response['valid'];session=response['session']
        if first_fixture is None:
            first_fixture={'move':body.model_dump(),'response':response}
    (artifacts/'move.json').write_text(json.dumps(first_fixture,ensure_ascii=False),encoding='utf-8')
    print(f"PASS: migration preservation/retries and real swaps; sample level ended {session['status']}.")
    # Exercise booster victory using a reachable final single-crate position.
    final=game._bonus_match_make_plain_board('full')
    game._bonus_match_apply_obstacle(final,7,7,'crate',1)
    await game.db.bonus_match_sessions.update_one({'id':session['id']},{'$set':{'board':final,'status':'active','moves_left':2,'score':1000}})
    response=await game.bonus_match_use_booster(game.BonusMatchBoosterUseBody(session_id=session['id'],booster='hammer',row=7,col=7),user)
    assert response['session']['status']=='won'
    assert response['result']['points_awarded']==2 or response['result']['points_awarded']==0
    print('PASS: booster destroys row 8 / column 8 objective and completes the level.')
    (artifacts/'booster-win.json').write_text(json.dumps(response,ensure_ascii=False),encoding='utf-8')
    # Leave only the isolated QA record for the review server; no production data is used.
    return user


if __name__=='__main__':
    check_catalog()
    asyncio.run(integration())
