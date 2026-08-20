"""Write preset.yml for all 9 MP-v6 presets (name + description + order)."""
from pathlib import Path

PRESETS = {
    "mp-v6": {
        "name": "MP-v6 数字员工 (master)",
        "description": "MP-v6 平台主入口. 路由到 8 个 sub-role: 工单分诊/知识库/本体/代码审查/数据分析/合同起草/HITL 编排/数据仪表盘.",
        "order": 0,
    },
    "support-triage": {
        "name": "工单分诊",
        "description": "分类客户工单, 推荐优先级, 高优触发 HITL. 用 psql 查 tickets 表 + curl hitl-webhook.",
        "order": 1,
    },
    "knowledge-curator": {
        "name": "知识库",
        "description": "答 MP-v6 架构问题: 4 支柱 (Supabase + dsh + Temporal + OTel), 9 K8s namespace, 19 app, 8 CI gate.",
        "order": 2,
    },
    "ontology-curator": {
        "name": "本体生成",
        "description": "设计 12 Ontology Kernel (ObjectType/ActionType/LinkType). 用 apply-ontology-change Edge Function (preview + HITL + confirmed).",
        "order": 3,
    },
    "code-reviewer": {
        "name": "代码审查",
        "description": "审 PR vs MP-v6 规范: 无 Python 业务代码, RLS 全开, evidence 文件, 8 CI gate 全过. 跑 scripts/ci/rls-check.sh + gh pr review.",
        "order": 4,
    },
    "data-analyst": {
        "name": "数据分析 (Compass)",
        "description": "NL 转 SQL (带 RLS 隔离), 出图表, 存 dashboard. 用 v6.1 的 dashboards + dashboard_widgets + mv_order_kpi_daily MV.",
        "order": 5,
    },
    "contract-drafter": {
        "name": "合同起草",
        "description": "用法务模板起草 NDA/服务协议/销售合同. 触发 48h HITL 法务审批. 365 天 retention (合规) + audit_log 跟踪.",
        "order": 6,
    },
    "hitl-orchestrator": {
        "name": "HITL 编排",
        "description": "多级审批工作流. 4 类 HITL: workflow_saas/workflow_dsh/tool_dsh/action_confirm. 24h to 96h 多级升级.",
        "order": 7,
    },
    "dashboard-curator": {
        "name": "数据仪表盘 (Compass)",
        "description": "业务问题转 dashboard + 洞察. 路由到 data-analyst (SQL) + knowledge-curator (RAG) + code-reviewer (校验).",
        "order": 8,
    },
}

for name, meta in PRESETS.items():
    pdir = Path(rf"C:\Users\houuu\.dsh\.agent-presets\{name}")
    pdir.mkdir(parents=True, exist_ok=True)
    pfile = pdir / "preset.yml"
    lines = [
        f"name: {meta['name']}",
        f"description: {meta['description']}",
        f"order: {meta['order']}",
    ]
    pfile.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"wrote {pfile}")

print(f"\n{len(PRESETS)} preset.yml files written")
