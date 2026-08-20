# docs/active/prd/

> 模块需求文档（PRD）目录。**每个 Batch Owner 启动 Batch 前必须先写本 Batch 对应模块的 PRD，PR 内容包含 PRD 链接。没有 PRD 的 Batch 不准合并。**（CLAUDE.md §8 强约束）

## 索引

### MP-V6-FOUNDATION-01（4 周，关键路径）✅ 已完成

| PRD | 模块 | 必读角色 |
|---|---|---|
| [foundation-k8s-clusters.md](./foundation-k8s-clusters.md) | 3 套 K8s 集群 + 10 个 namespace + ResourceQuota + 基础组件 | SRE |
| [foundation-supabase-schema.md](./foundation-supabase-schema.md) | 公共 schema（tenants / profiles / audit_log）+ 公共字段 + 迁移命名 | SRE / DBA / 应用 Owner |
| [foundation-rls-policy.md](./foundation-rls-policy.md) | RLS 启用强制 + Policy 模板 + `rls-check` CI gate | 架构组 / SRE |
| [foundation-networkpolicy.md](./foundation-networkpolicy.md) | default-deny + 跨 namespace 白名单 + egress 出公网控制 | SRE / 安全 |
| [foundation-dr-backup.md](./foundation-dr-backup.md) | PITR / Velero / 异地对象存储 / RPO≤5min RTO≤30min | SRE / DBA |

### MP-V6-TEMPORAL-01（3 周，前置依赖 FOUNDATION）✅ 已完成

| PRD | 模块 | 必读角色 |
|---|---|---|
| [temporal-cluster.md](./temporal-cluster.md) | Temporal Cluster + Postgres schema + namespace 隔离 | SRE / 后端 |
| [temporal-worker-sdk.md](./temporal-worker-sdk.md) | Node SDK Worker 模板 + HPA + OTel + 多租户 ctx | 后端 |

### MP-V6-OBSERVABILITY-01（2 周，前置依赖 FOUNDATION）✅ 已完成

| PRD | 模块 | 必读角色 |
|---|---|---|
| [otel-collector-config.md](./otel-collector-config.md) | OTel Collector + Tempo/Prom/Loki/Grafana + 4 Dashboard + 告警 | SRE |

### MP-V6-DSH-DOCKER-01（2 周，前置依赖 FOUNDATION）✅ 已完成

| PRD | 模块 | 必读角色 |
|---|---|---|
| [dsh-image-spec.md](./dsh-image-spec.md) | dsh Docker 镜像（多阶段 / ≤500MB / non-root / trivy / cosign） | AI 团队 / SRE |

### MP-V6-MIGRATION-01（3 周，Sprint 3 末）✅ 已完成

| PRD | 模块 | 必读角色 |
|---|---|---|
| [etl-export-v3.md](./etl-export-v3.md) | v3.0 → 中间文件（用户/租户/17 域/审计） | SRE / 后端 |
| [etl-import-v6.md](./etl-import-v6.md) | 中间文件 → v6.0（Supabase Auth + 业务 schema） | 后端 |
| [etl-validation.md](./etl-validation.md) | L1 行数 + L2 字段值 + L3 端到端三层校验 | SRE / DBA |

### 模板

每份 PRD 遵循相同结构：

1. 概述（What）
2. 背景与目标（Why & Goals）
3. 用户与场景（Personas & Use Cases）
4. 功能需求（Functional Requirements）
5. 非功能需求（Non-Functional Requirements）
6. 接口契约（Interface Contracts）
7. 验收标准（AC）
8. 依赖（Dependencies）
9. 风险（Risks）
10. 不做（Out of Scope）

### Sprint 0 PRD 总览

| Batch | PRD 数 | 状态 |
|---|---|---|
| MP-V6-FOUNDATION-01 | 5 | ✅ |
| MP-V6-TEMPORAL-01 | 2 | ✅ |
| MP-V6-OBSERVABILITY-01 | 1 | ✅ |
| MP-V6-DSH-DOCKER-01 | 1 | ✅ |
| MP-V6-MIGRATION-01 | 3 | ✅ |
| **Sprint 0 合计** | **12** | **✅ 全部完成** |

### 与其他文档的关系

| 文档类型 | 路径 | 颗粒度 |
|---|---|---|
| 架构 spec | `docs/active/specs/` | 全平台（技术 / 应用 / 模块规划）|
| **PRD**（本目录） | `docs/active/prd/` | **单模块的 WHY/WHAT/HOW** |
| Batch 文档 | `docs/active/batch/` | 周计划 + AC |
| ADR | `docs/active/decisions/` | 关键决策记录 |
| evidence | `evidence/` | 验收证据 |

PRD 是 Batch 文档的**前置**——先有 PRD → 再有 Batch 文档 → 最后执行 → 写 evidence。