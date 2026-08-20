# MetaPlatform-Ontology

> **v6.0** — 以 **DeepSeek Harness (dsh)** 为核心的企业级 AI 平台
> 基于 **Supabase**（后端）+ **Temporal.io**（业务流程）+ **OTel 可观测栈** 构建，v3.0 完全重启。
>
> 📄 给 AI 协作者读的入口：[`CLAUDE.md`](./CLAUDE.md)
> 🚀 从这里开始执行：[`START.md`](./START.md)
> 📐 架构 spec：[`docs/active/specs/2026-08-19-mp-v6-architecture.md`](./docs/active/specs/2026-08-19-mp-v6-architecture.md)
> 🏛️ 关键决策：[`docs/active/decisions/ADR-0060-discard-v3-data-migration.md`](./docs/active/decisions/ADR-0060-discard-v3-data-migration.md)

---

## 1. 项目目标（Why）

构建一个**可长期演进、可大规模应用、稳定可观测**的企业级 AI 平台，作为承载 19 个内部应用（mp-frontend / mp-runtime / mp-platform / mp-ai / mp-ontology / mp-workflow / mp-data-* / mp-monitoring 等）的统一底座，最终交付给业务团队一个能"开箱即用 + 二次开发"的 AI 中台。

### 三个判断决定了 v6.0 必须重启

| 现状 | 决策 |
|---|---|
| v3.0（Python FastAPI + Kafka + Redis + MinIO + Keycloak + Flowable）治理债高、维护成本失控 | **完全抛弃**（见 [ADR-0060](./docs/active/decisions/ADR-0060-discard-v3-data-migration.md)） |
| 上一代 AI 编排（自研 SuperAI + LangChain）扩展性差、插件机制薄弱 | 切换到 **DeepSeek Harness (dsh)** — Cordis 插件框架、60+ 包统一管理 |
| 上一代工作流引擎（Flowable BPMN）能力上限明显 | 升级到 **Temporal.io**，复用 Supabase Postgres |

> **唯一从 v3.0 沿用**：基础数据 ETL（4 类：用户 / 租户 / 核心业务数据 / 审计日志）。

---

## 2. 项目背景（Context）

### 业务背景

公司需要在 6–9 个月内：
- 替换掉超过 8 个分散的 AI 应用平台
- 统一 AI 编排、数据底座、权限、可观测
- 支持"数字员工"产品线（mp-agent-team + mp-hitl-hub + mp-skill-marketplace）
- 给业务方提供低代码 AI 编排 + 知识库 + 工作流能力

### 技术背景

- 团队对 TypeScript / Node.js 生态熟悉度高
- 已积累 PostgreSQL 运维经验
- K8s 是公司基础设施的标配
- DeepSeek 模型作为主推理供应商（成本/性能平衡）

### 治理背景

v3.0 失败的根本原因之一是"13 条硬规则"过度收紧又没自动化，导致团队绕开规则做事。v6.0 的治理思路反过来：**用 8 项 CI gate + branch protection + evidence 文档**让规则**自动执行**，而不是写下来靠人自觉。

---

## 3. v6.0 技术栈（4 大支柱）

| 支柱 | 技术 | 取代 |
|---|---|---|
| **后端全栈** | **Supabase**（PG + Auth + Realtime + Storage + Edge Functions + PostgREST + Studio + Vector） | FastAPI + Keycloak + Kafka + Redis + MinIO |
| **AI 编排** | **DeepSeek Harness (dsh)** — Cordis 插件框架，60+ 包统一管理 | 自研 SuperAI + LangChain |
| **业务流程** | **Temporal.io**（gRPC `:7233`，复用 Supabase PG） | Flowable BPMN |
| **可观测** | **OTel Collector + Tempo + Prometheus + Loki + Grafana** | 自研监控 |

前端：**Semi Design**（直接用，不造 design system）。
应用语言：**TypeScript**（v6.0 不再写 Python 业务代码）。

---

## 4. v6.0 关键决策

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

## 5. Sprint 0 — 4 个 P0 Batch

| Batch | 状态 | 周 | 关键能力 |
|---|---|---|---|
| MP-V6-FOUNDATION-01 | **Pending** | 4 | K8s 3 套 + Supabase 8 能力 + RLS + NetworkPolicy |
| MP-V6-TEMPORAL-01 | **Pending** | 3 | Temporal Cluster + Worker |
| MP-V6-OBSERVABILITY-01 | **Pending** | 2 | OTel + Grafana |
| MP-V6-DSH-DOCKER-01 | **Pending** | 2 | dsh 镜像 |

预计 **10 周串行**（依赖关系）/ **5 周并行**（FOUNDATION 是关键路径）。
执行方式见 [`START.md`](./START.md)，自动化靠 [`.claude/loop-prompt.md`](./.claude/loop-prompt.md) + `claude-loop.yml`。

---

## 6. 19 个应用 / 6 类 / 9 namespace

| 类别 | 应用 |
|---|---|
| **1. 平台核心** | mp-frontend（壳）/ mp-runtime（业务运行时）/ mp-platform（业务平台） |
| **2. AI 能力** | mp-ai（模型网关）/ mp-ontology（本体引擎）/ mp-knowledge（GraphRAG）/ mp-sandbox（Firecracker + K8s Job） |
| **3. 数字员工** | mp-agent-team（dsh 编排）/ mp-hitl-hub（HITL 4 类）/ mp-skill-marketplace |
| **4. 工作流** | mp-workflow（Temporal）/ mp-approval（BPMN 兜底） |
| **5. 数据产品** | mp-data-platform / mp-data-product / mp-data-quality / mp-data-catalog |
| **6. 可观测** | mp-monitoring / mp-audit / mp-frontend-obs |

namespace：mp-platform / mp-frontend / mp-runtime / mp-business / mp-ai / mp-orchestration / mp-integration / mp-data / mp-monitoring。

---

## 7. 目录结构

```
MetaPlatform-Ontology/
├── README.md                       # 本文件（项目门面）
├── CLAUDE.md                       # AI 协作者入口（上下文 + 强约束）
├── START.md                        # 启动指令（7 步执行流程）
├── docs/active/
│   ├── specs/                      # 3 份架构 spec
│   ├── batch/                      # Sprint 0 5 个 Batch + 1 个 MIGRATION
│   ├── decisions/                  # ADR（架构决策记录）
│   ├── runbooks/                   # 运维手册
│   └── workflows/                  # 4 个 GitHub Actions yml（模板）
├── scripts/
│   ├── loop/                       # new-batch.sh / next-batch.sh（loop 自动化）
│   └── setup/                      # 一次性环境/仓库配置脚本
├── .claude/loop-prompt.md          # Claude Code loop 提示词
└── evidence/                       # 每个 Batch 完成后写 ACCEPTANCE.md
```

---

## 8. 文档阅读顺序

新加入项目的人（或 AI 协作者）按这个顺序读：

1. **本文档**（README.md）— 5 分钟了解"是什么 / 为什么"
2. **[CLAUDE.md](./CLAUDE.md)** — 5 分钟了解"约束 / 决策 / 当前 Sprint"
3. **[START.md](./START.md)** — 知道"如何启动 / 如何跑 Batch"
4. **[架构 spec](./docs/active/specs/2026-08-19-mp-v6-architecture.md)** — 1 小时通读技术栈与组件关系
5. **[Batch 文档](./docs/active/batch/)** — 按当前 Sprint 进度读对应 Batch
6. **[ADR-0060](./docs/active/decisions/ADR-0060-discard-v3-data-migration.md)** — 理解 v3.0 → v6.0 的决策依据

---

## 9. 状态（2026-08-20）

| 项 | 状态 |
|---|---|
| 文档骨架 | ✅ 完成 |
| GitHub 仓库 | ✅ https://github.com/Bert0000000000/MetaPlatform-Ontology |
| 代码 | ❌ Sprint 0 第一个 Batch（FOUNDATION-01）启动后才产出 |
| CI 工作流模板 | ✅ 4 份 yml 已就位在 `docs/active/workflows/`（待拷贝到 `.github/workflows/`） |
| 强约束 | 全部写入 CLAUDE.md §8 |

---

*README v6.0*