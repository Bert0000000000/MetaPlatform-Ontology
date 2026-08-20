"""Add description to each MP-v6 preset (8 sub-roles + 1 master)."""
from pathlib import Path

DESCRIPTIONS = {
    "support-triage": "Classify customer support tickets, recommend priority, and trigger HITL for high-urgency issues.",
    "knowledge-curator": "Answer questions about MP-V6 architecture (4 pillars, 9 K8s namespaces, 19 apps, 8 CI gates).",
    "ontology-curator": "Design and evolve the 12 Ontology Kernel (ObjectType/ActionType/LinkType) using the apply-ontology-change Edge Function.",
    "code-reviewer": "Review PRs against MP-V6 conventions: no Python business code, RLS enabled, evidence file present, 8 CI gates pass.",
    "data-analyst": "Compass: NL to SQL with RLS isolation, generate charts, save dashboards. Uses the v6.1 dashboards + dashboard_widgets + mv_order_kpi_daily MV.",
    "contract-drafter": "Draft NDAs / service agreements / sales contracts using local templates. Triggers HITL legal review (48h timeout).",
    "hitl-orchestrator": "Manage multi-step approval workflows. 4 HITL types: workflow_saas, workflow_dsh, tool_dsh, action_confirm. Multi-level escalation: 24h to 96h.",
    "dashboard-curator": "Turn business questions into dashboards + insights. Routes to data-analyst for SQL, knowledge-curator for context, code-reviewer for validation.",
}


def get_persona_text(path):
    text = path.read_text(encoding="utf-8")
    if "text: >-" not in text:
        return "MP-V6 agent"
    after = text.split("text: >-", 1)[1]
    lines = after.splitlines()
    out = []
    for ln in lines:
        if ln.lstrip().startswith("- id:"):
            break
        out.append(ln)
    return "\n".join(out).strip()


for name, desc in DESCRIPTIONS.items():
    target = Path(rf"C:\Users\houuu\.dsh\.agent-presets\{name}\agent.cordis.yml")
    persona = get_persona_text(target)
    content = f"""# {name} - MP-v6 digital employee preset
# Authored in ~/.dsh/.agent-presets/{name}/

- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    text: >-
      {persona}

- id: agent-instructions
  name: '@deepseek-ai/dsh-agent-instructions'
  config:
    maxBytes: 65536

- id: dsh-mp-v6-desc
  name: '@deepseek-ai/dsh-persona-extension'
  config:
    text: >-
      {desc}

- id: dsh-mp-v6-tools
  name: '@deepseek-ai/dsh-persona-extension'
  config:
    text: >-
      Tools: SQL via `supabase db query`, Edge Functions via curl, supabase CLI for DB, dsh CLI for dsh, Read/Edit tools.
"""
    target.write_text(content, encoding="utf-8")
    print(f"wrote {target} ({len(content)} bytes)")

# Master preset
master_target = Path(r"C:\Users\houuu\.dsh\.agent-presets\mp-v6\agent.cordis.yml")
master_persona = get_persona_text(master_target)
master_content = f"""# mp-v6 - MP-v6 master agent preset (8 sub-roles)
# Authored in ~/.dsh/.agent-presets/mp-v6/

- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    text: >-
      {master_persona}

- id: agent-instructions
  name: '@deepseek-ai/dsh-agent-instructions'
  config:
    maxBytes: 65536

- id: dsh-mp-v6-desc
  name: '@deepseek-ai/dsh-persona-extension'
  config:
    text: >-
      Master router to 8 MP-v6 digital employee sub-roles: support-triage, knowledge-curator, ontology-curator, code-reviewer, data-analyst, contract-drafter, hitl-orchestrator, dashboard-curator. Use this single preset for MP-v6 platform tenants.

- id: dsh-mp-v6-context
  name: '@deepseek-ai/dsh-persona-extension'
  config:
    text: >-
      Local services: Supabase :54321, Studio :54323, DB :54322, Temporal :7233/:8233, Prometheus :9090, Grafana :3001, OTel :4317/:4318, dsh-web :5180, Realtime WS :4000. Edge Functions: create-customer, create-order, approve-contract, generate-invoice, onboard-employee, send-notification, ticket-triage, hitl-webhook, dsp-webhook, rag-query, apply-ontology-change, schema-version-switch, saml-metadata.
"""
master_target.write_text(master_content, encoding="utf-8")
print(f"wrote {master_target} ({len(master_content)} bytes)")

# Validate
import yaml
print("\n=== Validation ===")
ok = 0
for p in ["mp-v6"] + list(DESCRIPTIONS.keys()):
    f = Path(f"C:/Users/houuu/.dsh/.agent-presets/{p}/agent.cordis.yml")
    try:
        data = yaml.safe_load(f.read_text(encoding="utf-8"))
        n = len(data) if isinstance(data, list) else 1
        print(f"  {p}: OK ({n} entries)")
        ok += 1
    except Exception as e:
        print(f"  {p}: FAIL - {e}")
print(f"\n{ok}/9 valid")
