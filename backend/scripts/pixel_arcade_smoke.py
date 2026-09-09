"""Real loopback Flappy/Drive sessions with replayed controls and real elapsed time.

Uses the deterministic controller fixtures from the game tests. Does not inject
scores, alter clocks or write to the database. Only a dedicated .qa. user is allowed.
"""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import json
import subprocess
import os
import sys
import time
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tests"))
import pixel_campaign_smoke as http
from test_flappy import winning_flight, level_config



def drive_controls(session):
    script = """const fs=require('node:fs'), e=require('./frontend/src/games/pixel-drive/engine');
const s=JSON.parse(fs.readFileSync(0,'utf8')), l=e.getLevel(s.level_id);
const run=require('./frontend/src/games/pixel-drive/physicsTestHelpers.cjs').controlledRun(l,s.upgrades);
process.stdout.write(JSON.stringify({ticks:run.state.tick,events:run.events,outcome:e.summarize(l,run.state)}));"""
    result = subprocess.run(["node", "-e", script], input=json.dumps(session),
                            cwd=Path(__file__).resolve().parents[2], capture_output=True,
                            text=True, encoding="utf-8", check=True, timeout=30)
    run = json.loads(result.stdout)
    return {"ticks": run["ticks"], "events": run["events"], "abandon": False}, run["outcome"]


def play_arcade(game, level_id=1):
    endpoint = "flappy" if game == "flappy" else "pixel-drive"
    session = http.call(f"/games/{endpoint}/start", {"level": level_id, "request_id": "campaign-qa-" + uuid.uuid4().hex})
    started = time.monotonic()
    if game == "flappy":
        payload, outcome = winning_flight(session["level"])
    else:
        payload, outcome = drive_controls(session)
    assert outcome["status"] == "completed"
    duration = payload["ticks"] / 60 + .1
    print(game, "validated controller duration", round(duration, 2), flush=True)
    while time.monotonic() - started < duration:
        time.sleep(min(1, duration - (time.monotonic() - started)))
    result = http.call(f"/games/{endpoint}/sessions/{session['session_id']}/finish", payload)
    assert result["outcome"]["status"] == "completed"
    repeated = http.call(f"/games/{endpoint}/sessions/{session['session_id']}/finish", payload)
    assert repeated["outcome"] == result["outcome"]
    return session["session_id"]


def run(game):
    session_id = play_arcade(game)
    reward = http.call("/pet/campaign/claim", {"game": game, "session_id": session_id})
    retry = http.call("/pet/campaign/claim", {"game": game, "session_id": session_id})
    assert retry["reward"]["duplicate"]
    print(game, "PASS: real finish, campaign receipt, duplicate claim and finish retry", reward["reward"], flush=True)


def main():
    email = os.environ["PIXEL_QA_EMAIL"]
    if ".qa." not in email:
        raise RuntimeError("Dedicated .qa. account required")
    http.TOKEN = http.call("/auth/login", {"email": email, "password": os.environ["PIXEL_QA_PASSWORD"]})["token"]
    http.call("/pet/campaign")
    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(run, ("flappy", "pixel_drive")))


if __name__ == "__main__":
    main()
