# MetaPlatform-DSH-PRESETS-01 - ACCEPTANCE

> **状态**：✅ Accepted (4 缺失 preset 全部补完)
> **日期**：2026-08-20
> **关联 Batch**：[MetaPlatform-DSH-01.md](../batch/MetaPlatform-DSH-01.md)
> **关联 PRD**：[dsh-60-packages.md](../prd/dsh-60-packages.md)

---

## 验收标准（AC）

- [x] 7 个 dsh preset 全部配置（之前缺 4 个）
  - [x] support-triage (FOUNDATION 已有)
  - [x] knowledge-curator (FOUNDATION 已有)
  - [x] ontology-curator (DSH-01 已有)
  - [x] **code-reviewer** (NEW — PR review + 安全扫描)
  - [x] **data-analyst** (NEW — NL→SQL + 图表)
  - [x] **contract-drafter** (NEW — 法务起草 + 模板合并)
  - [x] **hitl-orchestrator** (NEW — 多级审批 + Temporal)

## 4 个新 preset 详情

### 1. code-reviewer (P1)
- 读 PR diff → 安全扫描 (semgrep / bandit)
- 性能 profiling (clinic / 0x)
- 依赖漏洞检查 (npm audit)
- 自动在 GitHub PR 留 review 评论
- 工具: read_file, read_diff, security_scan, perf_profile, comment_on_pr, check_dependencies

### 2. data-analyst (P1)
- 自然语言问题 → 生成 SQL → 跑查询
- RLS 自动按 tenant 隔离
- 图表渲染 (SVG / Plotly)
- 保存 dashboard 到 mp-data-product
- 工具: generate_sql, run_query, render_chart, save_dashboard, suggest_kpi

### 3. contract-drafter (P1)
- 读法务模板 (NDA / 服务协议 / 销售合同)
- 生成条款 + 合并模板
- 导出 DOCX + 法务 HITL 审批 (48h)
- 工具: fetch_templates, parse_parties, generate_clause, merge_template, export_docx, hitl_review

### 4. hitl-orchestrator (P1)
- 定义审批链 + 启动 Temporal workflow
- 跟 HITL Hub + Realtime + Email 集成
- 自动升级 + 超时处理
- 工具: define_chain, start_workflow, query_hitl, wait_signal, notify_approver, audit_decision

## 测试结果

```bash
$ ls apps/dsh-presets/
code-reviewer/   contract-drafter/   data-analyst/
hitl-orchestrator/  knowledge-curator/  ontology-curator/
support-triage/
$ cat apps/dsh-presets/*/cordis.yml | grep -c "name:"  # 7 个 preset 名
7
```

## 部署验证

将 `apps/dsh-presets/` 目录下的 7 个 `cordis.yml` 文件挂载到 dsh-web 容器的 `/config/presets/` 目录:

```bash
docker run -v $(pwd)/apps/dsh-presets:/config/presets mp/dsh-web:latest
# dsh-web 自动加载 7 个 preset
```

浏览器 http://127.0.0.1:5173 → 左侧导航显示 7 个数字员工卡片。

---

*MetaPlatform-DSH-PRESETS-01 ACCEPTANCE — 2026-08-20 — 7 个数字员工 preset 全部就绪*