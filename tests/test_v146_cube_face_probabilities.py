from __future__ import annotations

import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "backend" / "server.py"
ADMIN = ROOT / "frontend" / "src" / "pages" / "Admin.jsx"
SW = ROOT / "frontend" / "public" / "service-worker.js"


def assignment(name: str):
    tree = ast.parse(SERVER.read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == name:
                    return ast.literal_eval(node.value)
    raise AssertionError(name)


def test_default_face_probabilities_preserve_original_economy() -> None:
    probabilities = assignment("DEFAULT_CUBE_FACE_PROBABILITIES")
    assert probabilities == [
        {"face": 1, "probability_percent": 37.0},
        {"face": 2, "probability_percent": 28.0},
        {"face": 3, "probability_percent": 20.0},
        {"face": 4, "probability_percent": 10.0},
        {"face": 5, "probability_percent": 4.0},
        {"face": 6, "probability_percent": 1.0},
    ]
    assert sum(item["probability_percent"] for item in probabilities) == 100.0


def test_backend_persists_and_uses_editable_probabilities() -> None:
    source = SERVER.read_text(encoding="utf-8")
    assert "class CubeFaceProbabilityBody" in source
    assert "probabilities: Optional[List[CubeFaceProbabilityBody]]" in source
    assert '"probabilities": _normalize_cube_probabilities(doc.get("probabilities"))' in source
    assert '"probabilities": sorted(probabilities, key=lambda item: item["face"])' in source
    assert "Сума ймовірностей усіх граней має дорівнювати 100%" in source
    assert "total_weight = sum(max(0.0, float(item[1])) for item in cube_table)" in source
    assert "roll = _rand.random() * total_weight" in source
    assert '"probability_percent": round(float(_weight), 2)' in source


def test_admin_editor_has_probability_fields_and_total_guard() -> None:
    source = ADMIN.read_text(encoding="utf-8")
    assert "probabilities:" in source
    assert "updateProbability" in source
    assert "resetProbabilities" in source
    assert 'data-testid="cube-probability-total"' in source
    assert "Сума ймовірностей має дорівнювати 100%" in source
    assert 'step="0.01"' in source
    assert "cube-face-probability-${item.face}" in source
    assert "Стандартні відсотки" in source
    assert "probabilities," in source


def test_service_worker_is_bumped() -> None:
    assert 'const VERSION = "vpdk-v146";' in SW.read_text(encoding="utf-8")
