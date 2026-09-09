"""Local-only integration smoke: real game actions, no injected wins or wallets.

Set PIXEL_QA_EMAIL and PIXEL_QA_PASSWORD for a dedicated existing local QA user.
Use --until letter/place/door/end to leave a reviewable scene in the browser.
"""
import argparse
import json
import os
from pathlib import Path
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8001/api"
TOKEN = None


def call(path, body=None):
    request = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body is not None else None,
                                     headers={"Content-Type": "application/json", **({"Authorization": "Bearer " + TOKEN} if TOKEN else {})})
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"{path}: {error.code}: {error.read().decode()}") from error


def symbol(cell):
    if not cell or cell.get("void") or cell.get("special") == "color_bomb" or cell.get("obstacle") not in (None, "chain", "web"):
        return None
    return cell.get("symbol")


def matches(board):
    cells = set()
    rows, cols = len(board), len(board[0])
    for r in range(rows):
        for c in range(cols):
            value = symbol(board[r][c])
            if not value:
                continue
            for dr, dc in ((0, 1), (1, 0)):
                run = [(r, c)]
                for n in range(1, max(rows, cols)):
                    rr, cc = r + dr * n, c + dc * n
                    if rr >= rows or cc >= cols or symbol(board[rr][cc]) != value:
                        break
                    run.append((rr, cc))
                if len(run) >= 3:
                    cells.update(run)
    return cells


def best_move(board):
    options = []
    rows, cols = len(board), len(board[0])
    def swappable(cell):
        return cell and not cell.get("void") and not cell.get("obstacle") and (cell.get("symbol") or cell.get("special"))
    for r in range(rows):
        for c in range(cols):
            for rr, cc in ((r + 1, c), (r, c + 1)):
                if rr >= rows or cc >= cols or not swappable(board[r][c]) or not swappable(board[rr][cc]):
                    continue
                board[r][c], board[rr][cc] = board[rr][cc], board[r][c]
                hit = matches(board)
                a, b = board[r][c].get("special"), board[rr][cc].get("special")
                special = a == "color_bomb" or b == "color_bomb" or bool(a and b)
                obstacles = {(y, x) for row, col in hit for y, x in ((row-1,col),(row+1,col),(row,col-1),(row,col+1))
                             if 0 <= y < rows and 0 <= x < cols and (board[y][x] or {}).get("obstacle")}
                value = len(hit) + 20 * len(obstacles) + (12 if special else 0)
                board[r][c], board[rr][cc] = board[rr][cc], board[r][c]
                if hit or special:
                    options.append((value, (r, c, rr, cc)))
    if not options:
        raise RuntimeError("No valid moves")
    return max(options)[1]


def attempt_match(level_id):
    session = call("/games/bonus-match/start", {"level": level_id})["session"]
    for _ in range(35):
        if session["status"] != "active":
            break
        r, c, rr, cc = best_move(session["board"])
        result = call("/games/bonus-match/move", {"session_id": session["id"], "from_row": r, "from_col": c, "to_row": rr, "to_col": cc})
        session = result["session"]
    if session["status"] != "won":
        raise RuntimeError("QA solver lost; story progress was not advanced")
    return session["id"]


def play_match(level_id):
    for _ in range(8):
        try:
            return attempt_match(level_id)
        except RuntimeError as exc:
            if not str(exc).startswith("QA solver lost"):
                raise
    raise RuntimeError("QA solver lost eight boards; no synthetic win was recorded")


def play_detective(level_id):
    session = call("/games/hidden-objects/start", {"level": level_id, "restart": True})["session"]
    catalog = json.loads((Path(__file__).resolve().parents[1] / "hidden_object_levels.json").read_text(encoding="utf-8"))
    level = next(x for x in catalog["levels"] if x["id"] == level_id)
    scene = next(x for x in catalog["scenes"] if x["id"] == level["scene_id"])
    objects = {x["id"]: x for x in scene["objects"]}
    sequence = session["last_sequence"]
    for target in level["target_ids"]:
        if target in session.get("found_ids", []):
            continue
        sequence += 1
        obj = objects[target]
        session = call("/games/hidden-objects/action", {"session_id": session["id"], "sequence": sequence, "kind": "find", "x": obj["x"], "y": obj["y"]})["session"]
    assert len(session["found_ids"]) == len(level["target_ids"])
    call("/games/hidden-objects/complete", {"session_id": session["id"]})
    return session["id"]


def main():
    global TOKEN
    parser = argparse.ArgumentParser()
    parser.add_argument("--until", default="end", help="Stable scene ID or end")
    parser.add_argument("--path", choices=["close", "partners", "negative"], default="close")
    args = parser.parse_args()
    email = os.environ["PIXEL_QA_EMAIL"]
    if ".qa." not in email:
        raise RuntimeError("Use a dedicated .qa. account; never a player's account.")
    TOKEN = call("/auth/login", {"email": email, "password": os.environ["PIXEL_QA_PASSWORD"]})["token"]
    picks = {"letter": "together", "place": "window", "promise": "promise", "door": "invite"}
    for _ in range(850):
        state = call("/pet/campaign")
        step = state["step"]
        print(step["id"], state["wallet"], flush=True)
        if step["id"] == args.until:
            print("PASS: ready for visual review", args.until, flush=True)
            return
        def action(kind, **extra):
            return call("/pet/campaign/action", {"kind": kind, "step_id": step["id"], "revision": state["revision"], **extra})
        if step["kind"] == "dialogue":
            if state["outcome"]:
                action("advance")
            elif state["line"] < len(step["lines"]) - 1:
                action("advance")
            elif step.get("choices"):
                action("choose", choice_id=picks.get(step["id"], step["choices"][-1 if args.path == "negative" else 1 if args.path == "partners" else 0]["id"]))
            else:
                action("advance")
        elif step["kind"] == "decorate":
            action("buy", item_id=step["item"])
        elif step["kind"] == "game":
            game = step["game"]
            endpoint = {"bonus_match":"bonus-match", "hidden_objects":"hidden-objects", "flappy":"flappy", "pixel_drive":"pixel-drive"}[game]
            status = call(f"/games/{endpoint}/status")
            if game in ("bonus_match", "hidden_objects"):
                completed = {item["level"] for item in status["completions"]}
            elif game == "flappy":
                completed = set(status["completed"])
            else:
                completed = {int(key) for key, value in status["tracks"].items() if "finish" in value.get("medals", [])}
            available = [item.get("level", item.get("id")) for item in status["levels"]]
            level_id = next((level for level in sorted(available) if level not in completed), None)
            if level_id is None:
                raise RuntimeError(f"No new {game} level remains; inspect saved credits instead of replaying")
            if game == "bonus_match":
                session_id = play_match(level_id)
            elif game == "hidden_objects":
                session_id = play_detective(level_id)
            else:
                from pixel_arcade_smoke import http, play_arcade
                http.TOKEN = TOKEN
                session_id = play_arcade(game, level_id)
            first = call("/pet/campaign/claim", {"game": game, "session_id": session_id})
            again = call("/pet/campaign/claim", {"game": game, "session_id": session_id})
            assert first["campaign"]["wallet"] == again["campaign"]["wallet"] and again["reward"]["duplicate"]
            print("verified", game, first["reward"], flush=True)
        else:
            raise RuntimeError("Requested stop was already passed")
    raise RuntimeError("Campaign did not finish in bounded steps")


if __name__ == "__main__":
    main()

