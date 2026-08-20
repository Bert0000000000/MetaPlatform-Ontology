# MP-V6-DSH-01 — dsh 数字员工集成

> **Batch 状态**：Pending Acceptance
> **优先级**：🔴 P1（数字员工核心）
> **工作量**：4 周
> **团队**：AI 团队 + SRE
> **前置依赖**：MP-V6-FOUNDATION-01 ✅

---

## 1. 目标

把 dsh (DeepSeek Harness, 基于 Cordis) 60 个包集成进 v6.0，配置 7 个内置数字员工 preset，部署到 K8s mp-runtime namespace。

## 2. 配套文档

- 技术架构 spec：[`docs/active/specs/2026-08-19-mp-v6-architecture.md`](../../specs/2026-08-19-mp-v6-architecture.md) §3.2 / §7.13
- dsh-image-spec PRD：[`docs/active/prd/dsh-image-spec.md`](../../prd/dsh-image-spec.md)

## 3. 核心交付

| 项 | 验证 |
|---|---|
| dsh 源码 vendor 到 `vendor/deepseek-harness/` | 仓库目录存在 + 版本 pin |
| 60 个 dsh 包通过 pnpm workspaces 集成 | `pnpm list --depth=0` |
| 7 个数字员工 preset 配置 | `apps/dsh-presets/` |
| dsh-web Deployment 在 K8s mp-runtime | `kubectl get pods -n mp-runtime -l app=dsh-web` |
| LLM provider 配置（DeepSeek + 备选） | `dsh llm` 命令 |
| dsh session Postgres backend 集成 | `packages/mp-dsh-postgres-backend/` |

## 4. 详细任务清单

### 第 1 周：vendor + pnpm 集成
- [ ] vendor dsh 源码到 `vendor/deepseek-harness/<sha>/`
- [ ] pnpm workspaces 配置 `vendor/*` + `packages/*` + `apps/*`
- [ ] 60 个包 build 通过
- [ ] 解决依赖冲突（如有）

### 第 2 周：preset + LLM provider
- [ ] 7 个数字员工 preset 配置文件
- [ ] LLM provider 配置 (DeepSeek primary, OpenAI fallback)
- [ ] DEEPSEEK_API_KEY 通过 ExternalSecret 注入
- [ ] 端到端: dsh web 启动 → LLM 调用成功

### 第 3 周：session backend 集成
- [ ] dsh Postgres backend (`packages/mp-dsh-postgres-backend/`) 替换 JSONL
- [ ] 多副本 session 共享测试 (启动 2 个 dsh-web pod → 同一 session 可访问)
- [ ] crash recovery 测试

### 第 4 周：K8s 部署 + e2e
- [ ] `k8s/deployments/dsh-web.yaml` apply（已在 FOUNDATION 准备）
- [ ] HPA / Service / Ingress 完整
- [ ] dsh sandbox Landlock/bwrap 权限配置
- [ ] 端到端 e2e: 用户登录 → 数字员工对话 → dsh session 持久化
- [ ] evidence/MP-V6-DSH-01-ACCEPTANCE.md

## 5. 验收标准（AC）

- [ ] 60 个 dsh 包集成 + build 通过
- [ ] 7 个 preset 配置就绪
- [ ] dsh-web K8s 部署 + HPA
- [ ] dsh session Postgres backend 多副本共享
- [ ] DEEPSEEK_API_KEY 走 ExternalSecret
- [ ] e2e: 数字员工完整流程跑通
- [ ] evidence 完成

## 6. 风险与缓解

| 风险 | 缓解 |
|---|---|
| dsh preview breaking | pin SHA + vendor 模式 |
| DEEPSEEK_API_KEY 泄露 | ExternalSecret + Vault |
| 60 个包冲突 | pnpm overrides + 强制 resolve |
| session 持久化失败 | Postgres backend + 多副本 + WAL replay |

## 7. 下游依赖

- MP-V6-LLM-01（LLM provider 详细配置）
- MP-V6-SANDBOX-01（dsh sandbox + K8s Job）
- MP-V6-HITL-HUB-01（dsh tool HITL）

---

*MP-V6-DSH-01 — Sprint 1 数字员工集成就绪*