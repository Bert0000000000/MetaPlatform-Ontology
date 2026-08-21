# PRD：mp-sandbox（沙箱）

> **应用**：mp-sandbox — dsh 代码 / 工具执行沙箱
> **类别**：2. AI 能力
> **对应 namespace**：mp-ai
> **状态**：Draft v1.0
> **日期**：2026-08-20

## 1. 概述

`mp-sandbox` 是 v6.0 的**进程级代码执行沙箱**。基于 **dsh sandbox（4 包）+ K8s Job**（决策 #20 + 21），让数字员工 / Agent 在隔离环境中执行用户提供的代码 / 工具调用，避免主机被攻破。

> **v6.0 不引入 Firecracker**（决策 §3.1，弃用 v3.0 MP-SANDBOX-01）。

## 2. 核心功能

- 进程级隔离（bwrap / Landlock / Seatbelt）
- K8s Job 模式（重型任务）
- 代码执行（TypeScript / Python）
- 工具调用（白名单 / 黑名单）
- 网络隔离（出公网白名单）
- 文件系统隔离（chroot）
- 资源限制（CPU / 内存 / 时长）
- 审计日志（每次执行）

## 3. 关键接口

```typescript
// 同步执行（小任务，< 30s）
POST /v1/sandbox/exec
{
  "language": "typescript",
  "code": "console.log('hello')",
  "timeout_ms": 30000,
  "network": "isolated"     // isolated | internet
}
// Response: { stdout, stderr, exit_code, duration_ms }

// 异步执行（重型任务，K8s Job）
POST /v1/sandbox/jobs
{ ... }
// Response: { job_id, status: 'queued' }
// 轮询: GET /v1/sandbox/jobs/:id
```

## 4. 数据模型

```sql
CREATE TABLE mp_sandbox.executions (
    id           uuid PRIMARY KEY,
    tenant_id    uuid NOT NULL,
    actor_id     uuid,
    language     text NOT NULL,
    code_hash    text NOT NULL,                    -- 代码 SHA-256（不入库原文）
    mode         text NOT NULL,                    -- sync / job
    timeout_ms   int NOT NULL,
    network_mode text NOT NULL,
    status       text NOT NULL,                    -- queued / running / done / failed / timeout
    exit_code    int,
    duration_ms  int,
    job_id       text,                              -- K8s Job name（async mode）
    started_at   timestamptz NOT NULL,
    finished_at  timestamptz
);
CREATE INDEX executions_tenant_time_idx ON mp_sandbox.executions (tenant_id, started_at DESC);
ALTER TABLE mp_sandbox.executions ENABLE ROW LEVEL SECURITY;
```

## 5. 部署

- **同步模式**：sidecar（部署在 mp-runtime Deployment 内，共享 lifecycle）
- **异步模式**：K8s Job（提交到 mp-ai namespace，Job template 动态生成）
- 资源限制：CPU 500m / Memory 512Mi（默认）/ 最大 2 CPU / 4Gi
- 超时：默认 30s，最大 1h

## 6. 验收标准（AC）

| # | 标准 |
|---|---|
| AC1 | 同步执行 TypeScript hello world 跑通 |
| AC2 | 进程级隔离：沙箱内写入 /tmp 不影响主机 |
| AC3 | 网络隔离：默认无网络；`network: internet` 模式可访问公网白名单 |
| AC4 | 超时：30s 不返回自动 kill |
| AC5 | 资源超限 OOM 自动失败（exit code ≠ 0）|
| AC6 | K8s Job 异步执行跑通 |
| AC7 | 每次执行进 `audit_log` + `mp_sandbox.executions` |
| AC8 | 黑白名单：禁止 `child_process.exec('rm -rf /')` |

## 7. 依赖

| 依赖 | 来源 |
|---|---|
| dsh sandbox 包 | dsh 官方 |
| K8s RBAC（Job 创建权限）| MetaPlatform-FOUNDATION-01 |

## 8. 不做

- ❌ Firecracker microVM（决策 §3.1 弃用）
- ❌ GPU 沙箱（v6.1）
- ❌ 容器内套容器（v6.0 用进程级隔离）
- ❌ 长期保留沙箱（每次执行完销毁）

---

*PRD v1.0 — 配套 [foundation-networkpolicy](foundation-networkpolicy.md) / [mp-agent-team](mp-agent-team.md) / [otel-collector-config](otel-collector-config.md)*