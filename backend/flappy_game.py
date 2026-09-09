"""Finite Flappy Pixel campaign. Integer physics shared with the browser engine."""
from copy import deepcopy

VERSION = 1
PHYSICS = {"scale": 1000, "hz": 60, "width": 360000, "height": 480000,
           "floor": 466000, "player_x": 101000, "radius": 18000,
           "gravity": 250, "impulse": -4800, "start_y": 224000,
           "start_velocity": -1800, "min_flap_ticks": 6}
NAMES = ["Перший змах", "М’які хмаринки", "Хмарна стежка", "Над садом",
         "Вечірні дахи", "Теплий вітер", "Між антенами", "За горизонт",
         "Перші зорі", "Місячний маршрут", "Сузір’я лапок", "Небесний мандрівник"]
COUNTS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 18]
CENTERS = [224, 224, 224, 192, 230, 268, 224, 182, 216, 254, 282, 242, 198, 220, 264, 228, 190, 220]


def level_config(level_id):
    if type(level_id) is not int or not 1 <= level_id <= len(NAMES):
        raise ValueError("Невідомий рівень")
    index = level_id - 1
    gap = 190000 - index * 4000
    speed = 1500 + index * 50
    centers = [224 if level_id == 1 else CENTERS[i] if level_id <= 4
               else CENTERS[(i + index) % len(CENTERS)] for i in range(COUNTS[index])]
    gates = [{"x": 350000 + i * 215000, "center": center * 1000, "gap": gap} for i, center in enumerate(centers)]
    return {"version": VERSION, "id": level_id, "name": NAMES[index],
            "world": index // 4 + 1, "world_name": ["Хмарний сад", "Вечірні дахи", "Зоряне небо"][index // 4],
            "theme": ["garden", "sunset", "stars"][index // 4], "gates": gates,
            "gate_count": len(gates), "speed": speed, "physics": deepcopy(PHYSICS),
            "max_ticks": (gates[-1]["x"] + 52000 - (PHYSICS["player_x"] - PHYSICS["radius"])) // speed + 3}


def new_state(level):
    p = level["physics"]
    return {"tick": 0, "y": p["start_y"], "velocity": p["start_velocity"],
            "passed": 0, "status": "playing", "last_flap": -p["min_flap_ticks"]}


def step(level, state, flap=False):
    if state["status"] != "playing":
        return state
    p = level["physics"]
    if flap and state["tick"] - state["last_flap"] >= p["min_flap_ticks"]:
        state["velocity"] = p["impulse"]
        state["last_flap"] = state["tick"]
    state["velocity"] += p["gravity"]
    state["y"] += state["velocity"]
    state["tick"] += 1
    y, radius, x = state["y"], p["radius"], p["player_x"]
    if y - radius <= 0 or y + radius >= p["floor"]:
        state["status"] = "failed"
        return state
    passed = 0
    for gate in level["gates"]:
        gx = gate["x"] - level["speed"] * state["tick"]
        if gx + 52000 < x - radius:
            passed += 1
        if x + radius > gx - 9000 and x - radius < gx + 52000:
            if y - radius < gate["center"] - gate["gap"] // 2 + 6000 or y + radius > gate["center"] + gate["gap"] // 2:
                state["status"] = "failed"
                return state
    state["passed"] = passed
    if passed == level["gate_count"]:
        state["status"] = "completed"
    elif state["tick"] >= level["max_ticks"]:
        state["status"] = "failed"
    return state


def replay(level, flaps, ticks):
    if type(ticks) is not int or not 1 <= ticks <= level["max_ticks"]:
        raise ValueError("Некоректна тривалість польоту")
    if len(flaps) > 600 or any(type(t) is not int or not 0 <= t < ticks for t in flaps):
        raise ValueError("Некоректні натискання")
    if any(b - a < PHYSICS["min_flap_ticks"] for a, b in zip(flaps, flaps[1:])):
        raise ValueError("Натискання мають бути послідовними")
    state, events = new_state(level), set(flaps)
    for tick in range(ticks):
        step(level, state, tick in events)
        if state["status"] != "playing":
            if state["tick"] != ticks:
                raise ValueError("Політ завершився раніше")
            break
    if state["status"] == "playing":
        raise ValueError("Політ ще не завершено")
    return state
