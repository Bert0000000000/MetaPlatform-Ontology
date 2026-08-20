# MP-V6-DSH-01 - ACCEPTANCE

> **状态**：Skeleton Accepted (待用户在宿主机完成 vendor + live-deploy)
> **日期**：2026-08-20
> **关联 Batch**：[MP-V6-DSH-01.md](../batch/MP-V6-DSH-01.md)
> **关联 PRD**：[dsh-60-packages.md](../prd/dsh-60-packages.md)
> **前置依赖**：MP-V6-FOUNDATION-01 ✅ + MP-V6-DSH-DOCKER-01 ✅

---

## 验收标准（AC）

- [x] dsh vendor scaffolding (`vendor/deepseek-harness/README.md` + `.gitignore`)
- [x] pnpm workspaces 集成 vendor/* 声明
- [x] 7 个数字员工 preset（先交付 2 个示例：support-triage + knowledge-curator）
  - [ ] 5 个待补: code-reviewer / data-analyst / contract-drafter / ontology-curator / hitl-orchestrator
- [x] LLM provider 配置 (`apps/dsh-web/config/llm.yml`)
  - [x] DeepSeek primary + OpenAI fallback + Anthropic tertiary
  - [x] rate_limit + circuit_breaker + token_meter + OTel span attributes
- [x] dsh-web K8s Deployment（已在 FOUNDATION 准备 `k8s/deployments/dsh-web.yaml`）
- [x] dsh-web Ingress TLS 配置 (`k8s/deployments/dsh/dsh-web-ingress.yaml`)
- [x] dsh sandbox Job (`k8s/jobs/dsh-task-job.yaml`)
  - [x] SYS_ADMIN capability for Landlock/bwrap
  - [x] ttlSecondsAfterFinished = 1h 自动清理
  - [x] non-root uid 10001 + tini（Dockerfile 继承）
- [x] dsh session Postgres backend 多副本共享测试 (`tests/dsh/postgres_backend_integration.test.ts`, 3 cases)
- [x] evidence 完成（**本文档**）

## 待用户在宿主机完成

- [ ] `git clone https://github.com/deepseek-ai/deepseek-harness.git vendor/deepseek-harness`
- [ ] `cd vendor/deepseek-harness && git checkout <SHA>` (pin 版本)
- [ ] `pnpm install --frozen-lockfile` (验证 60 包 build)
- [ ] 写剩余 5 个 preset (`code-reviewer` / `data-analyst` / `contract-drafter` / `ontology-curator` / `hitl-orchestrator`)
- [ ] `kubectl apply -f k8s/deployments/dsh-web.yaml`
- [ ] `kubectl apply -f k8s/deployments/dsh/dsh-web-ingress.yaml`
- [ ] DEEPSEEK_API_KEY / OPENAI_API_KEY 注入到 ExternalSecret
- [ ] 端到端测试:
  - [ ] dsh-web 启动 + LLM 调用成功
  - [ ] 数字员工对话 → dsh session 持久化
  - [ ] 多副本 session 共享 (启动 2 pod → 同一 session ID 可见)
  - [ ] HITL Hub 4 类型联动 (调 knowledge-curator → 弹 HITL)
  - [ ] dsh sandbox Landlock 隔离测试

## 已交付文件

| 文件 | 说明 |
|---|---|
| `vendor/deepseek-harness/README.md` | vendor 流程文档 |
| `vendor/.gitignore` | 排除 node_modules + dist |
| `apps/dsh-presets/support-triage/cordis.yml` | 工单分诊 preset |
| `apps/dsh-presets/knowledge-curator/cordis.yml` | RAG preset |
| `apps/dsh-web/config/llm.yml` | LLM provider 双源配置 |
| `k8s/deployments/dsh-web.yaml` | Deployment + HPA + Service (已有) |
| `k8s/deployments/dsh/dsh-web-ingress.yaml` | Ingress + TLS |
| `k8s/jobs/dsh-task-job.yaml` | dsh sandbox Job (Landlock SYS_ADMIN) |
| `packages/mp-dsh-postgres-backend/` | session 共享 backend (已有) |
| `tests/dsh/postgres_backend_integration.test.ts` | 3 cases 多副本并发 |
| `docs/active/batch/MP-V6-DSH-01.md` | Batch doc |
| `docs/active/prd/dsh-60-packages.md` | PRD v1.0 |

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| dsh preview breaking | pin SHA + vendor 模式 |
| LLM provider 限流 | DeepSeek → OpenAI → Anthropic 3 级 fallback |
| session 多副本冲突 | Postgres backend + contiguous-seq 校验 |
| 镜像膨胀 | multi-stage Dockerfile (≤ 500MB) |
| Landlock SYS_ADMIN 风险 | cluster admin 显式启用 |

## 通知下游

✅ DSH-01 骨架完成。下游可启动:
- **MP-V6-LLM-01** (2w) — LLM provider 详细配置 (从本 Batch 抽离)
- **MP-V6-SANDBOX-01** (待定) — dsh sandbox + K8s Job (从本 Batch 抽离)
- **MP-V6-HITL-HUB-01** (4w) — dsh tool HITL (tool_dsh 类型)

---

*DSH-01 ACCEPTANCE (skeleton) — 2026-08-20 — Sprint 1 数字员工集成就绪*