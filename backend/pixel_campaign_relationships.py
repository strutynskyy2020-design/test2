"""Persistent consequences and ordered repair; gifts never call these rules."""
from copy import deepcopy

try:
    from backend.pixel_campaign_season import ENDINGS
except ModuleNotFoundError as exc:
    if exc.name != "backend":
        raise
    from pixel_campaign_season import ENDINGS


def ensure_fields(state):
    state["version"] = 2
    for key, default in (("flags", {}), ("conflicts", {}), ("repair", {}),
                         ("ending", None), ("contact", None)):
        state.setdefault(key, deepcopy(default))
    # v1 saves keep all indices, receipts, balances, decisions and journal entries.
    if state.get("promise") == "broken" and "door" not in state["conflicts"]:
        state["conflicts"]["door"] = {"status": "open", "step": 13,
                                        "reason": "Порушена обіцянка відчинити майстерню разом."}

    for scene, decision, key, index, reason in (
        ("letter", "dismiss", "humiliation", 5, "Ти знецінив особисту знахідку Пікселя."),
        ("place", "control", "space", 9, "Ти розпорядився місцем Пікселя без його згоди."),
    ):
        if state.get("decisions", {}).get(scene) == decision and key not in state["conflicts"]:
            state["conflicts"][key] = {"status": "open", "step": index, "reason": reason}


def apply_effects(state, selected, step):
    ensure_fields(state)
    state["flags"].update(selected.get("flags", {}))
    conflict = selected.get("conflict")
    if conflict:
        state["conflicts"][conflict] = {"status": "open", "step": state["step"],
                                          "reason": selected["memory"]}
    repair = selected.get("repair")
    if repair == "acknowledge":
        state["repair"]["acknowledged"] = {key: value["step"] for key, value in state["conflicts"].items() if value["status"] != "resolved"}
    elif repair == "restore":
        for key, item in state["conflicts"].items():
            if state["repair"].get("acknowledged", {}).get(key) == item["step"]:
                item["status"] = "restored"
        state["repair"]["restored"] = step["id"]
        if state["placement"] != "window":
            state["placement"] = "window"
    elif repair == "prove":
        for item in state["conflicts"].values():
            if item["status"] == "restored":
                item["status"] = "resolved"
        state["repair"]["proven"] = step["id"]


def ending_for(state):
    ensure_fields(state)
    values = state["relationship"]
    unresolved = any(c["status"] != "resolved" for c in state["conflicts"].values())
    if unresolved or values["trust"] < 15 or values["respect"] < 20:
        key = "separate_doors"
    elif state["conflicts"]:
        key = "second_chance"
    elif values["closeness"] >= 65 and values["trust"] >= 55 and values["respect"] >= 55:
        key = "our_home"
    else:
        key = "equal_partners"
    result = deepcopy(ENDINGS[key])
    layout = state["flags"].get("layout", "shared")
    result.update(id=key, layout=layout,
                  world=("Світлиця працює як тиха майстерня зі зустрічами за запрошенням." if layout == "quiet" else
                         "Світлиця відкрита для майстерень за розкладом." if layout == "shared" else
                         "Світлиця працює як загальний простір без погодженої приватної зони."),
                  public_record=("Мешканці отримали чесне пояснення й повний відкритий звіт." if state["flags"].get("public_truth") == "honest" else
                                 "Ніна оприлюднила документи. Неправдива промова підірвала довіру мешканців до організатора."))
    return result
