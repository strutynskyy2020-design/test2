from pathlib import Path
import ast

source_path = Path(__file__).resolve().parent / "backend" / "server.py"
source = source_path.read_text(encoding="utf-8")
tree = ast.parse(source)

classes = {node.name: node for node in tree.body if isinstance(node, ast.ClassDef)}
functions = {node.name: node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))}

assert "ReportProfileUpdateBody" in classes
assert "admin_update_user_report_profile" in functions
assert '"report_profile": requested' in source
assert 'fresh.get("report_profile") != requested' in source
assert 'fresh.get("report_profile") != updates["report_profile"]' in source

print("v126 backend report-profile source checks passed")
