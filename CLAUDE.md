# CLAUDE.md

> **给 Claude Code / Claude 协作者读取的项目上下文**
>
> **项目名**：MetaPlatform-Ontology（v6.0 重启）
> **本地路径**：`D:\Hermes\Workspace\10_Projects\MetaPlatform-Ontology`
> **GitHub**：https://github.com/Bert0000000000/MetaPlatform-Ontology
> **状态**：Sprint 0 启动期（4 个 P0 Batch 待执行）
> **最近更新**：2026-08-20

---

## 0. 项目目标与背景（Why & Context）

### 0.1 项目目标（What）

构建一个**可长期演进、可大规模应用、稳定可观测**的企业级 AI 平台，作为承载 19 个内部应用（mp-frontend / mp-runtime / mp-platform / mp-ai / mp-ontology / mp-workflow / mp-data-* / mp-monitoring 等）的统一底座。

最终交付：
- 一个能"开箱即用"AI 编排 + 知识库 + 工作流能力的 AI 中台
- 一套统一的工程规范（CI gate / RLS / evidence / Conventional Commits）
- 一套可以接力给团队 / 后续 AI 协作者的开发方法（loop 自动化）

### 0.2 项目背景（Why v6.0 must restart）

#### 业务背景

- 公司需要在 6–9 个月内替换掉超过 8 个分散的 AI 应用平台
- 数字员工产品线（mp-agent-team + mp-hitl-hub + mp-skill-marketplace）急需统一编排底座
- 业务方希望"低代码 AI 编排 + 知识库 + 工作流"开箱即用

#### 技术背景

- 团队对 TypeScript / Node.js 生态熟悉度高
- 已积累 PostgreSQL 运维经验
- K8s 是公司基础设施的标配
- DeepSeek 模型作为主推理供应商（成本/性能平衡）

#### 治理背景（v3.0 失败的根本原因）

| v3.0 痛点 | v6.0 应对 |
|---|---|
| 13 条硬规则写得"过死"，团队绕开做事 | 规则**自动化**而不是靠人自觉 |
| Python FastAPI / Kafka / Redis / MinIO / Keycloak / Flowable 治理债高 | 切到 4 大支柱（Supabase + dsh + Temporal + OTel） |
| 上一代 AI 编排（自研 SuperAI + LangChain）扩展性差 | 切到 **DeepSeek Harness (dsh)** — Cordis 插件框架 |
| 上一代工作流（Flowable BPMN）能力上限明显 | 切到 **Temporal.io**，复用 Supabase PG |
| 文档与代码脱节、决策没人看 | **ADR + 8 项 CI Gate + evidence 强制** |

> v3.0 已 archive（见 [`docs/active/runbooks/archive-v3-repository.md`](docs/active/runbooks/archive-v3-repository.md) 与 [ADR-0060](docs/active/decisions/ADR-0060-discard-v3-data-migration.md)），**唯一沿用**：基础数据 ETL（4 类：用户 / 租户 / 核心业务数据 / 审计日志）。

---

## 1. 核心定位

**MetaPlatform-Ontology** 是一个以 **DeepSeek Harness (dsh) 为核心** 的企业级 AI 平台。它不是 v3.0 的延续，而是**完全重启**：

- v3.0 的 13 硬规则（V3 治理体系）已**全部抛弃**
- v3.0 的 Python FastAPI / Kafka / Redis / MinIO / Keycloak / Flowable 全部**不沿用**
- 唯一保留：**基础数据 ETL**（4 类：用户 / 租户 / 核心业务数据 / 审计日志）

---

## 2. v6.0 技术栈（4 大支柱）

| 支柱 | 技术 | 取代 |
|---|---|---|
| **后端** | **Supabase 全栈**（PG + Auth + Realtime + Storage + Edge Functions + PostgREST + Studio + Vector） | FastAPI + Keycloak + Kafka + Redis + MinIO |
| **AI 编排** | **DeepSeek Harness (dsh)** — Cordis 插件框架，60+ 包统一管理 | 自研 SuperAI + LangChain |
| **业务流程** | **Temporal.io**（gRPC `:7233`，复用 Supabase PG） | Flowable BPMN |
| **可观测** | **OTel Collector + Tempo + Prometheus + Loki + Grafana** | OTel collector + 自研监控 |

前端：**Semi Design**（直接用，不造 design system）。

---

## 3. v6.0 关键决策

| 决策 | 内容 |
|---|---|
| **ADR-0060** | 完全抛弃 v3.0，只导基础数据 |
| **HITL Hub 4 类** | workflow_saas / workflow_dsh / tool_dsh / action_confirm |
| **dsh 持久化** | 自建 Postgres backend（K8s 多副本 session 共享），不存 JSONL |
| **dsh Docker** | 多阶段 build（deps / build / runtime），基础镜像 `node:22.19-alpine`，非 root + tini，≤ 500MB |
| **RLS 强制** | 所有 CREATE TABLE 必须 `ENABLE ROW LEVEL SECURITY`，CI gate `rls-check` |
| **8 项 CI Gate** | lint / typecheck / test / build / evidence-check / secret-scan / helm-validate / rls-check |
| **分支策略** | Trunk-Based：单 `main` + `feat/mp-v6-<batch>`，squash merge |
| **Claude Code loop** | `.claude/loop-prompt.md` + `claude-loop.yml` workflow |

---

## 4. Sprint 0 Batch 接力（refactor/v6.0-monorepo 视角）

| Batch | 状态 | 周 | 关键能力 |
|---|---|---|---|
| MP-V6-FOUNDATION-01 | **Pending** | 4 | K8s 3 套 + Supabase 8 能力 + RLS + NetworkPolicy |
| MP-V6-TEMPORAL-01 | **Pending** | 3 | Temporal Cluster + Worker |
| MP-V6-OBSERVABILITY-01 | **Pending** | 2 | OTel + Grafana |
| MP-V6-DSH-DOCKER-01 | **Pending** | 2 | dsh 镜像 |
| MP-V6-MIGRATION-01 | **Pending** | 8 | 19 个应用迁移（按 6 类分批） |

---

## 5. 19 个应用 / 6 类 / 9 namespace

| 类别 | 应用 |
|---|---|
| **1. 平台核心** | mp-frontend（壳） / mp-runtime（业务运行时） / mp-platform（业务平台） |
| **2. AI 能力** | mp-ai（模型网关） / mp-ontology（本体引擎） / mp-knowledge（GraphRAG） / mp-sandbox（Firecracker + K8s Job） |
| **3. 数字员工** | mp-agent-team（dsh 编排） / mp-hitl-hub（HITL 4 类） / mp-skill-marketplace |
| **4. 工作流** | mp-workflow（Temporal） / mp-approval（BPMN 兜底） |
| **5. 数据产品** | mp-data-platform / mp-data-product / mp-data-quality / mp-data-catalog |
| **6. 可观测** | mp-monitoring / mp-audit / mp-frontend-obs |

namespace：mp-platform / mp-frontend / mp-runtime / mp-business / mp-ai / mp-orchestration / mp-integration / mp-data / mp-monitoring。

---

## 6. 提交规范（Conventional Commits）

```
feat(scope): 新功能
fix(scope): bug 修复
chore(scope): 工具/构建/依赖
docs(scope): 文档
refactor(scope): 重构
test(scope): 测试
ci(scope): CI 改动
perf(scope): 性能优化
```

PR 标题必须包含 Batch ID：`feat(foundation): MP-V6-FOUNDATION-01 #N description`。

---

## 7. 文件分类规约

| 类型 | 路径 | 谁负责 |
|---|---|---|
| 技术 spec | `docs/active/specs/2026-08-19-mp-v6-*.md` | 架构组 |
| Batch 任务文档 | `docs/active/batch/MP-V6-*.md` | 各 Batch Owner |
| ADR | `docs/active/decisions/ADR-NNNN-*.md` | 架构组 |
| CI/CD workflow | `docs/active/workflows/*.yml` | SRE |
| Runbook | `docs/active/runbooks/*.md` | SRE |
| Loop 脚本 | `scripts/loop/*.sh` | SRE |
| Claude 配置 | `.claude/loop-prompt.md` | Claude Code |
| 验收证据 | `evidence/<batch>-ACCEPTANCE.md` | 每个 Batch Owner |

---

## 8. 强约束（每步都要遵守）

### 必做 ✅

- 每个 Batch 完整执行任务清单，**不简化、不跳过**
- 所有 AC 验收标准全部勾选
- 所有 Secret 走 ExternalSecret / Vault，**永远不进 git**
- Conventional Commits 格式
- evidence 文档写完（CI gate `evidence-check` 会校验）
- 8 项 CI gate 全部通过
- 遇到问题先查 spec，**不要凭直觉决策**

### 必不做 ❌

- 不写 Python 业务代码（v6.0 用 TypeScript）
- 不直 push 到 main（走 PR + squash merge）
- 不 merge 自己的 PR
- 不把 Secret push 到 git
- 不修改 v3.0 仓库（已 archived）
- 在没有 evidence 的情况下不合 PR

---

## 9. 接力指引（新 Codex / AI 会话）

1. 切到对应 Batch 的 worktree（`.worktrees/<batch>-01`），或基于 `main` 新建分支
2. 整段复制粘贴 `.claude/loop-prompt.md` 到对话开头
3. 跑既有 evidence 套件确认基线
4. 提交风格遵循 Conventional Commits
5. PR 必须包含 Batch ID 引用 + evidence 文档链接
6. Sprint 0 完成后，按 `MP-V6-MIGRATION-01.md` 进入 Sprint 3（19 应用迁移）

---

## 10. 相关 ADR / Spec

- **ADR-0060**：[`docs/active/decisions/ADR-0060-discard-v3-data-migration.md`](docs/active/decisions/ADR-0060-discard-v3-data-migration.md)
- **技术架构 spec**：[`docs/active/specs/2026-08-19-mp-v6-architecture.md`](docs/active/specs/2026-08-19-mp-v6-architecture.md)
- **应用架构 spec**：[`docs/active/specs/2026-08-19-mp-v6-application-architecture.md`](docs/active/specs/2026-08-19-mp-v6-application-architecture.md)
- **模块规划 spec**：[`docs/active/specs/2026-08-19-mp-v6-module-planning.md`](docs/active/specs/2026-08-19-mp-v6-module-planning.md)

---

## 11. 环境与工具

| 项 | 状态 |
|---|---|
| gh CLI | ✅ 已认证（用户 `Bert0000000000`，HTTPS 协议）|
| git | ✅ |
| node 22.23.2 | ✅（要求 ≥22.19）|
| pnpm 11.22.0 | ✅（沙箱内 `$HOME/.npm-global/bin/`）|
| kubectl v1.31.0 | ✅（沙箱内 `$HOME/bin/`，无 kubeconfig）|
| helm v3.21.4 | ✅（沙箱内 `$HOME/bin/`）|
| docker 27.4.0 | ⚠️ CLI 可用，daemon 在沙箱里跑不起来（需宿主机执行）|
| 沙箱限制 | sudo 不可用，PATH 跨调用不保留，no_new_privs |

沙箱内 PATH 引导：
```bash
export PATH="$HOME/bin:$HOME/.npm-global/bin:$PATH"
```

---

*CLAUDE.md v6.1 — 加入 §0 项目目标/背景、§11 环境与工具*