"""Mount MP-v6 digital employee presets via dsh patch layer."""
from pathlib import Path

PRESETS = [
    "support-triage",
    "knowledge-curator",
    "ontology-curator",
    "code-reviewer",
    "data-analyst",
    "contract-drafter",
    "hitl-orchestrator",
    "dashboard-curator",
]

# Cordis preset file paths (dsh 0.1.0-rc.7 reads $DSH_HOME for ~)
imports_lines = []
for p in PRESETS:
    imports_lines.append(f'  - {p}: file://${{DSH_HOME}}/.agent-presets/{p}/agent.cordis.yml')

content = (
    "# Auto-mounted MP-v6 digital employee presets (dsh 0.1.0-rc.7)\n"
    "# Each preset has its own persona + tools (see ~/.dsh/.agent-presets/<name>/agent.cordis.yml)\n"
    "imports:\n"
    + "\n".join(imports_lines) + "\n"
)

patch = Path(r"C:\Users\houuu\.dsh\profiles\web\cordis.patch.yml")
existing = patch.read_text() if patch.exists() else ""
patch.write_text(content + existing, encoding="utf-8")
print(f"wrote {patch} ({len(content)} bytes)")
print("---")
print(content)
