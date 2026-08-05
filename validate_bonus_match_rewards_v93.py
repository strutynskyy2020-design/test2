from pathlib import Path

server = Path('backend/server.py').read_text()
frontend = Path('frontend/src/pages/BonusMatch.jsx').read_text()

assert 'BONUS_MATCH_FIRST_CLEAR_POINTS = 2' in server
assert 'BONUS_MATCH_FIRST_CLEAR_XP = 10' in server
assert 'BONUS_MATCH_REPLAY_XP = 5' in server
assert 'BONUS_MATCH_DAILY_POINT_CAP = None' in server
assert 'points_awarded = BONUS_MATCH_FIRST_CLEAR_POINTS if first_completion else 0' in server
assert 'xp_awarded = BONUS_MATCH_FIRST_CLEAR_XP if first_completion else BONUS_MATCH_REPLAY_XP' in server
assert 'bonus_match_v93_reset_all_to_level_1' in server
assert 'await migrate_bonus_match_v93_reset()' in server
assert '"current_level": 1' in server
assert 'completions: []' in frontend
assert 'Без ліміту' in frontend
assert 'v139_first_2_points_10_xp_replay_5_xp' in server
print('Validated Bonus Match v139 reward policy and the existing one-time level reset')
