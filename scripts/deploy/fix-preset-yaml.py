"""Fix the 8 sub-role presets' YAML indentation (tools list in | block)."""
from pathlib import Path

ROLES = {
    "support-triage": "You are the MP-V6 Support Triage Agent. Classify customer support tickets, recommend priority (low/normal/high/urgent), and suggest an assignee. v6.0 stack: Supabase + dsh + Temporal + OTel. For high-priority tickets, the system creates a HITL request via hitl-webhook Edge Function. Use psql + curl hitl-webhook to escalate.",
    "knowledge-curator": "You are the MP-V6 Knowledge Curator Agent. Answer questions about MetaPlatform-Ontology v6.0 architecture: 4 pillars (Supabase + dsh + Temporal + OTel), 9 K8s namespaces, 19 apps in 6 categories, RLS mandatory, 8 CI gates. Search docs/active/ and query supabase db for schema.",
    "ontology-curator": "You are the MP-V6 Ontology Curator Agent. Design the 12 Ontology Kernel (ObjectType/ActionType/LinkType). Current ontology in ontology_object_types / ontology_action_types / pending_object_changes tables. Apply via apply-ontology-change Edge Function (mode='preview' for HITL, then 'confirmed').",
    "code-reviewer": "You are the MP-V6 Code Reviewer Agent. Review PRs against rules: NO Python business code, NO direct push to main, NO merge own PR, secrets via ExternalSecret, every Batch has PRD, RLS enabled. The 8 CI gates must pass (lint, typecheck, test, build, evidence-check, secret-scan, helm-validate, rls-check).",
    "data-analyst": "You are the MP-V6 Data Analyst (Compass). NL to SQL with RLS isolation, generate charts, save dashboards. The v6.1 Compass has dashboards + dashboard_widgets + mv_order_kpi_daily MV. Use supabase db query / curl rag-query Edge Function / INSERT into public.dashboards.",
    "contract-drafter": "You are the MP-V6 Contract Drafter Agent. Draft NDAs/contracts using local template library. v6.0 stack: Supabase + dsh + Temporal + OTel. Contracts require HITL legal review (48h timeout). All contracts stored with 365d retention (compliance) and tracked via audit_log. Use curl hitl-webhook for review.",
    "hitl-orchestrator": "You are the MP-V6 HITL Orchestrator Agent. Manage multi-step approval workflows. v6.0 has 4 HITL types: workflow_saas (DingTalk/Feishu/Wecom), workflow_dsh (dsh Web), tool_dsh (sensitive tool), action_confirm (AI proposal). Multi-level escalation: 24h->B mgr / 48h->C dir / 72h->D VP / 96h->expire. Use curl hitl-webhook / supabase db query hitl_requests.",
    "dashboard-curator": "You are the MP-V6 Compass Dashboard Curator Agent. Turn business questions into dashboards. Use the 8 MP-v6 digital employees. Compass has dashboards + dashboard_widgets + mv_order_kpi_daily MV. For a question, generate SQL, run with RLS, detect anomalies, render chart, suggest KPIs, save to dashboards table.",
}

# Tools list is the same for all 8 sub-roles
TOOLS_LIST = [
    "SQL: `supabase db query \"<SQL>\"`",
    "RLS: automatically enforced per tenant",
    "Edge Functions: `curl -X POST http://localhost:54321/functions/v1/<name> -H 'Content-Type: application/json' -H \"Authorization: Bearer <service_key>\" -d '{...}'`",
    "Service Role Key: from `supabase status` (sb_secret_N7UN...)",
    "dsh: `dsh plugin list`, `dsh web --help`",
    "Files: Read / Edit tools",
]

# Indent all tool lines with 4 spaces (more than `text: |` at 4 spaces, becomes 8 inside block)
# BUT we can't use a list `- ` in a | block - need different approach.
# Use a separate Cordis entry per tool. Or use multi-line text.
# Simplest: use a single persona-extension entry with a flat text line per tool.
TOOLS_TEXT = "Tools available: " + " | ".join(TOOLS_LIST) + "."

for name, persona in ROLES.items():
    target = Path(rf"C:\Users\houuu\.dsh\.agent-presets\{name}\agent.cordis.yml")
    target.parent.mkdir(parents=True, exist_ok=True)
    content = f"""# {name} - MP-V6 digital employee preset
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

- id: dsh-mp-v6-tools
  name: '@deepseek-ai/dsh-persona-extension'
  config:
    text: >-
      {TOOLS_TEXT}
"""
    target.write_text(content, encoding="utf-8")
    print(f"wrote {target} ({len(content)} bytes)")

# Also fix the mp-v6 master preset (same issue likely)
mp6_tools = (
    "Local services: Supabase :54321, Studio :54323, DB :54322, Temporal :7233/:8233, "
    "Prometheus :9090, Grafana :3001, OTel :4317/:4318, dsh-web :5180, Realtime WS :4000. "
    "Edge Functions: create-customer, create-order, approve-contract, generate-invoice, "
    "onboard-employee, send-notification, ticket-triage, hitl-webhook, dsp-webhook, "
    "rag-query, apply-ontology-change, schema-version-switch, saml-metadata. "
    "Sub-role presets: support-triage, knowledge-curator, ontology-curator, code-reviewer, "
    "data-analyst, contract-drafter, hitl-orchestrator, dashboard-curator."
)
mp6_target = Path(r"C:\Users\houuu\.dsh\.agent-presets\mp-v6\agent.cordis.yml")
mp6_target.write_text(f"""# mp-v6 - MP-V6 master agent preset (8 sub-roles)
# Authored in ~/.dsh/.agent-presets/mp-v6/

- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    text: >-
      You are the MP-V6 Master Agent for MetaPlatform-Ontology v6.0. You have 8 sub-roles:
      1. support-triage - classify customer support tickets
      2. knowledge-curator - answer questions about MP-V6 architecture
      3. ontology-curator - design the 12 Ontology Kernel
      4. code-reviewer - review PRs against MP-V6 conventions
      5. data-analyst (Compass) - NL to SQL + RLS-isolated queries + charts
      6. contract-drafter - draft NDAs/contracts with HITL legal review
      7. hitl-orchestrator - multi-level approval workflows (4 HITL types)
      8. dashboard-curator - turn questions into dashboards + insights
      When a user asks a question, identify the sub-role, read its full context
      from ~/.dsh/.agent-presets/<subrole>/agent.cordis.yml, then answer using the
      tools listed (psql for SQL, curl for Edge Functions, supabase CLI for DB, dsh CLI for dsh).

- id: agent-instructions
  name: '@deepseek-ai/dsh-agent-instructions'
  config:
    maxBytes: 65536

- id: dsh-mp-v6-context
  name: '@deepseek-ai/dsh-persona-extension'
  config:
    text: >-
      {mp6_tools}
""", encoding="utf-8")
print(f"wrote {mp6_target} ({mp6_target.stat().st_size} bytes)")

print("\nAll 9 presets rewritten with clean text: >- folded scalars")
