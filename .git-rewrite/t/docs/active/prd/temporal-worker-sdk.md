# PRD：temporal-worker-sdk

> **模块**：业务 Workflow Worker — Node SDK 基础工程 + 部署模式
> **对应 Batch**：[MP-V6-TEMPORAL-01](../batch/MP-V6-TEMPORAL-01.md)
> **状态**：Draft v1.0（待架构组评审）
> **负责人**：后端
> **日期**：2026-08-20

---

## 1. 概述（What）

提供 Temporal Worker 的**标准模板**（Node SDK + TypeScript），让 19 个应用中需要 Workflow 编排的部分能快速接入：复制模板 → 写业务 workflow → 部署到 `mp-orchestration` namespace。

**本 PRD 不包含**：具体业务 workflow 定义（业务 Owner 各自实现）。

## 2. 背景与目标（Why & Goals）

### 2.1 背景

- 19 个应用中部分需要长任务 / 跨服务编排（如 mp-workflow、mp-approval、mp-data-*）
- 没有统一 Worker 模板会导致每个应用重复实现：连接管理 / 重试 / 心跳 / OTel / HPA
- v6.0 决策：**TypeScript 全栈**，Worker 用 Node SDK（不用 Java/Python SDK）

### 2.2 目标

| # | 目标 |
|---|---|
| G1 | 标准 Worker 工程模板（pnpm + TS + Temporal SDK + OTel） |
| G2 | 部署到 `mp-orchestration` namespace + HPA（基于 task queue depth） |
| G3 | Activity 心跳 / 重试 / backoff 默认开启 |
| G4 | OTel traces 上报到 OBSERVABILITY-01 |
| G5 | Worker SDK 版本固定 + 升级走 staging 验证 |

## 3. 用户与场景

| Persona | 场景 |
|---|---|
| **业务 Workflow Owner** | 复制模板 → 写 `workflows/<name>.ts` → 部署 |
| **SRE** | 监控 Worker 健康 / task queue 长度 / 失败率 |
| **平台团队** | 维护 Worker SDK 模板，跟随 Temporal 版本升级 |

## 4. 功能需求（Functional Requirements）

### 4.1 标准 Worker 工程结构

```
mp-temporal-worker-template/
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── Dockerfile
├── helm/
│   ├── Chart.yaml
│   ├── values.yaml
│   └── templates/
│       ├── deployment.yaml
│       ├── serviceaccount.yaml
│       └── hpa.yaml
├── src/
│   ├── worker.ts                # Worker 入口
│   ├── workflows/               # 业务 workflow（各业务 Owner 添加）
│   │   └── index.ts
│   ├── activities/              # 业务 activity
│   │   └── index.ts
│   ├── shared/
│   │   ├── telemetry.ts         # OTel SDK 初始化
│   │   ├── logger.ts            # pino + OTel correlation
│   │   └── tenant-context.ts    # 多租户 context 注入
│   └── config.ts                # 环境变量
├── .dockerignore
└── README.md
```

### 4.2 Worker 入口（`src/worker.ts`）

```typescript
import { Worker, NativeConnection } from '@temporalio/worker';
import { trace } from '@opentelemetry/api';
import { config } from './config';
import * as activities from './activities';

async function main() {
  const connection = await NativeConnection.connect({
    address: config.TEMPORAL_ADDRESS, // temporal.mp-platform.local:7233
  });

  const worker = await Worker.create({
    connection,
    namespace: config.TEMPORAL_NAMESPACE, // mp-platform | mp-platform-staging | mp-platform-dev
    taskQueue: config.TASK_QUEUE,
    workflowsPath: require.resolve('./workflows'),
    activities,
    maxConcurrentActivityTaskExecutions: 100,
    maxConcurrentWorkflowTaskExecutions: 200,
    // Activity 默认配置
    defaultActivityOptions: {
      startToCloseTimeout: '30s',
      retry: {
        maximumAttempts: 3,
        backoffCoefficient: 2.0,
        initialInterval: '1s',
      },
      heartbeatTimeout: '10s',
    },
  });

  // OTel trace context 注入 worker
  trace.getActiveSpan()?.setAttribute('worker.task_queue', config.TASK_QUEUE);
  trace.getActiveSpan()?.setAttribute('worker.namespace', config.TEMPORAL_NAMESPACE);

  await worker.run();
  console.log('Worker started', { taskQueue: config.TASK_QUEUE });
}

main().catch((err) => {
  console.error('Worker failed', err);
  process.exit(1);
});
```

### 4.3 Activity 心跳模板

```typescript
// src/activities/example.ts
import { Context } from '@temporalio/activity';
import { trace } from '@opentelemetry/api';

export async function longRunningActivity(input: { tenantId: string; taskId: string }) {
  const tracer = trace.getTracer('mp-temporal-worker');
  return tracer.startActiveSpan('long-running-activity', async (span) => {
    try {
      span.setAttribute('tenant.id', input.tenantId);
      span.setAttribute('task.id', input.taskId);

      // 模拟长任务，每 5 秒心跳一次
      for (let i = 0; i < 60; i++) {
        await sleep(5000);
        Context.current().heartbeat({ progress: i * 100 / 60 });
        span.addEvent(`progress-${i}`);
      }

      span.setStatus({ code: 1 }); // OK
      return { success: true };
    } catch (err) {
      span.recordException(err as Error);
      throw err;
    } finally {
      span.end();
    }
  });
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

### 4.4 多租户 Context 注入

```typescript
// src/shared/tenant-context.ts
import { Context } from '@temporalio/activity';
import { AsyncLocalStorage } from 'async_hooks';

interface TenantContext {
  tenantId: string;
  actorId?: string;
  correlationId: string;
}

export const tenantStorage = new AsyncLocalStorage<TenantContext>();

// Activity 入口包裹
export async function withTenantContext<T>(
  ctx: TenantContext,
  fn: () => Promise<T>
): Promise<T> {
  return tenantStorage.run(ctx, fn);
}

export function getTenantContext(): TenantContext {
  const ctx = tenantStorage.getStore();
  if (!ctx) throw new Error('Tenant context not set');
  return ctx;
}

// 在 Activity 内部使用
export async function businessLogicActivity(input: any) {
  const tenant = getTenantContext();
  // 任何 DB 查询都自动带 tenant_id，RLS 生效
  const { data } = await supabase
    .from('orders')
    .select('*')
    .eq('tenant_id', tenant.tenantId);
  return data;
}
```

### 4.5 部署模板（Helm）

```yaml
# helm/templates/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "worker.fullname" . }}
  namespace: mp-orchestration
spec:
  replicas: {{ .Values.replicaCount | default 2 }}
  selector:
    matchLabels:
      app: {{ include "worker.name" . }}
  template:
    metadata:
      labels:
        app: {{ include "worker.name" . }}
        platform.mp/version: v6.0
    spec:
      serviceAccountName: {{ include "worker.serviceAccountName" . }}
      containers:
      - name: worker
        image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
        env:
        - name: TEMPORAL_ADDRESS
          value: "{{ .Values.temporal.address }}"
        - name: TEMPORAL_NAMESPACE
          value: "{{ .Values.temporal.namespace }}"
        - name: TASK_QUEUE
          value: "{{ .Values.temporal.taskQueue }}"
        - name: OTEL_EXPORTER_OTLP_ENDPOINT
          value: "http://otel-collector.mp-monitoring:4318"
        resources:
          requests:
            cpu: 500m
            memory: 512Mi
          limits:
            cpu: 1
            memory: 1Gi
        livenessProbe:
          httpGet:
            path: /health
            port: 8080
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /ready
            port: 8080
          initialDelaySeconds: 5
          periodSeconds: 5
```

### 4.6 HPA 配置（基于 task queue depth）

**v6.0 简化版**：先用 CPU / Memory HPA。

```yaml
# helm/templates/hpa.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: {{ include "worker.fullname" . }}
  namespace: mp-orchestration
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: {{ include "worker.fullname" . }}
  minReplicas: {{ .Values.autoscaling.minReplicas | default 2 }}
  maxReplicas: {{ .Values.autoscaling.maxReplicas | default 20 }}
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300
    scaleUp:
      stabilizationWindowSeconds: 30
```

**v6.1 升级**：基于 Temporal `temporal_task_queue_depth` 自定义指标 HPA（需要从 Temporal Prometheus → 自定义 metric adapter）。

### 4.7 OTel 集成

每个 Activity / Workflow span 都包含：

```
span.attributes:
  temporal.namespace
  temporal.task_queue
  temporal.workflow_id
  temporal.run_id
  temporal.activity_id
  tenant.id
  actor.id
```

通过 OTel Collector 导出到 **Tempo**（trace）+ **Loki**（log）。

## 5. 非功能需求

| 维度 | 要求 |
|---|---|
| **可观测** | 每个 Workflow / Activity 一个 trace span；含 tenant.id |
| **弹性** | Worker 故障自动重启（K8s Deployment）；Activity retry 3 次默认 |
| **幂等性** | Activity 必须幂等；workflow 用 `idempotency_key` 去重 |
| **多租户** | 所有 Activity 通过 `tenant-context` 注入 tenant_id；RLS 强制生效 |
| **性能** | Worker 启动延迟 < 30s（冷启动）；Activity 处理 p99 < 1s |
| **版本** | Temporal SDK 版本固定（`@temporalio/worker@1.10.x`）；升级走 staging |

## 6. 接口契约

### 6.1 与 Cluster 通信

```typescript
// 业务代码引用 SDK
import { Client } from '@temporalio/client';

const client = new Client({
  address: process.env.TEMPORAL_ADDRESS!,
  namespace: process.env.TEMPORAL_NAMESPACE!,
});

// 启动 workflow
const handle = await client.workflow.start('MyWorkflow', {
  taskQueue: 'my-task-queue',
  args: [{ tenantId: 'xxx', payload: {...} }],
  workflowId: `my-workflow-${uuid()}`,  // 唯一
});
```

### 6.2 与 Supabase 集成

```typescript
// src/shared/supabase.ts
import { createClient } from '@supabase/supabase-js';
import { getTenantContext } from './tenant-context';

// 每个 Activity 入口处取一次 ctx
export function getTenantScopedClient() {
  const ctx = getTenantContext();
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    {
      global: {
        headers: {
          'x-tenant-id': ctx.tenantId,
          'x-actor-id': ctx.actorId ?? '',
        },
      },
    }
  );
}
```

### 6.3 与 HITL Hub 联动

```typescript
// 在 workflow 中发 HITL signal
import { defineSignal, setHandler, condition } from '@temporalio/workflow';

export const hitlDecisionSignal = defineSignal<[{
  decision: 'approve' | 'reject';
  actor: string;
  comment?: string;
}]>('hitl-decision');

export async function businessWorkflow(input: any) {
  let decision: any;
  setHandler(hitlDecisionSignal, (d) => { decision = d; });
  // ... 业务逻辑 ...
  await condition(() => decision !== undefined, '7d'); // 7 天等待
  if (decision.decision !== 'approve') throw new Error('Rejected');
}
```

## 7. 验收标准（AC）

| # | 标准 | 验证方式 |
|---|---|---|
| AC1 | Worker SDK 模板仓库 `mp-temporal-worker-template` 可用 | 复制 → `pnpm install` → `pnpm build` → `pnpm start` 成功 |
| AC2 | hello world workflow 跑通（Node SDK → Cluster → 完成） | 端到端测试 |
| AC3 | signal + query 双向通信测试通过 | 测试用例 |
| AC4 | Activity heartbeat 测试通过 | 端到端测试 |
| AC5 | 24h 长任务测试通过（`wait_condition`） | 端到端测试 |
| AC6 | Worker 部署到 `mp-orchestration`，HPA 工作 | `kubectl get hpa` |
| AC7 | OTel trace 上报到 Tempo | Grafana Tempo 数据源有 span |
| AC8 | 多租户 RLS 在 Worker 内生效 | 跨租户访问被拒 |
| AC9 | evidence/MP-V6-TEMPORAL-01-ACCEPTANCE.md 完成 | 文件存在 |

## 8. 依赖

| 依赖 | 来源 | 时序 |
|---|---|---|
| Temporal Cluster | [temporal-cluster](temporal-cluster.md) | 必须先 |
| Supabase PG | MP-V6-FOUNDATION-01 | 必须先 |
| OTel Collector | MP-V6-OBSERVABILITY-01 | 弱依赖（metrics 上报可后置）|
| pnpm 10+ / Node 22.19+ | 基础工具 | 必须 |

## 9. 风险

| 风险 | 影响 | 缓解 |
|---|---|
| Worker SDK 版本升级破坏 | 业务 workflow 崩溃 | pin 版本 + staging 验证 + ArgoCD 自动回滚 |
| Worker OOM | 任务丢失 | ResourceQuota + HPA + Activity 重试 |
| Task queue 深度失控 | 任务延迟 | v6.1 引入自定义 metric HPA |
| 多租户 RLS 绕过（service_role 滥用）| 数据泄露 | 禁止 service_role 在 Worker 中使用；只允许 anon key + tenant header |

## 10. 不做（Out of Scope）

- ❌ **Java / Python SDK**：v6.0 全 TypeScript，Worker 不用其他 SDK
- ❌ **Worker SDK 自动生成工具**：v6.0 模板手动复制，v6.1 引入 scaffolding tool
- ❌ **业务 workflow 定义**：业务 Owner 各自实现
- ❌ **Temporal Nexus**：v6.0 不引入，v6.1 评估
- ❌ **跨 cluster workflow**：v6.0 单 cluster

---

*PRD v1.0 — 配套 [temporal-cluster](temporal-cluster.md) / [otel-collector-config](otel-collector-config.md) / [foundation-supabase-schema](foundation-supabase-schema.md)*