# PRD：dsh-60-packages

> **模块**：dsh (DeepSeek Harness) 60 包集成 + 7 个数字员工 preset
> **对应 Batch**：[MetaPlatform-DSH-01](../batch/MetaPlatform-DSH-01.md)
> **状态**：Draft v1.0
> **负责人**：AI 团队 + SRE
> **日期**：2026-08-20

---

## 1. 概述（What）

vendor dsh (DeepSeek Harness) 60 个 Cordis 包到 v6.0 monorepo，配置 7 个内置数字员工 preset，部署到 K8s mp-runtime namespace。

## 2. 背景与目标

### 2.1 背景

- v3.0 用自研 SuperAI + LangChain，扩展性差
- v6.0 切到 dsh (Cordis 插件框架，60 个包，per architecture spec §3.2)
- 数字员工核心调度能力由 dsh 提供

### 2.2 目标

| # | 目标 |
|---|---|
| G1 | dsh 60 个 Cordis 包 vendor 到 `vendor/deepseek-harness/<sha>/` |
| G2 | 7 个数字员工 preset 配置就绪 |
| G3 | LLM provider 配置 (DeepSeek primary, OpenAI fallback) |
| G4 | dsh-web K8s 部署 (3 副本 + HPA + Ingress) |
| G5 | dsh session Postgres backend 多副本共享 |
| G6 | dsh sandbox 部署 (Landlock/bwrap) |

## 3. 用户与场景

| Persona | 场景 |
|---|---|
| 业务用户 | 在 dsh Web 与数字员工对话 (Knowledge Curator / Support Triage) |
| AI 开发者 | 配置 preset / 调试 agent loop / 查看 session |
| SRE | 监控 dsh-web pod + LLM token 用量 + 长任务 |

## 4. 功能需求

### 4.1 Vendor 模式（dsh 60 包）

```bash
# 1. clone dsh 到 vendor/
git clone https://github.com/deepseek-ai/deepseek-harness.git vendor/deepseek-harness
cd vendor/deepseek-harness
git checkout <sha>  # pin 版本
pnpm install --frozen-lockfile

# 2. workspace 配置
# pnpm-workspace.yaml:
packages:
  - "vendor/deepseek-harness/apps/*"
  - "vendor/deepseek-harness/packages/*"
  - "apps/*"
  - "packages/*"
```

### 4.2 7 个数字员工 preset

| Preset | 用途 |
|---|---|
| `support-triage` | 客服工单分诊 |
| `knowledge-curator` | RAG 检索 + 回答 |
| `code-reviewer` | 代码审查 |
| `data-analyst` | 数据分析 |
| `contract-drafter` | 合同起草 |
| `ontology-curator` | 本体生成 (HITL 联动) |
| `hitl-orchestrator` | 人在回路协调 |

详见 `apps/dsh-presets/<name>/cordis.yml`

### 4.3 LLM Provider 配置

```yaml
# apps/dsh-web/config/llm.yml
providers:
  - name: deepseek-primary
    type: deepseek
    api_key_env: DEEPSEEK_API_KEY
    base_url: https://api.deepseek.com/v1
    default_model: deepseek-chat
    fallback: openai-secondary

  - name: openai-secondary
    type: openai
    api_key_env: OPENAI_API_KEY
    base_url: https://api.openai.com/v1
    default_model: gpt-4o-mini

routing:
  default: deepseek-primary
  fallback_chain: [deepseek-primary, openai-secondary]
  retry: { max_attempts: 3, backoff: exponential }
```

### 4.4 Session Postgres Backend

```typescript
// packages/mp-dsh-postgres-backend/src/index.ts
// 已在 FOUNDATION + DSCHEDULER 骨架完成, 见 packages/mp-dsh-postgres-backend/
```

## 5. 非功能需求

| 维度 | 要求 |
|---|---|
| 可用性 | dsh-web ≥ 3 副本 + HPA |
| 性能 | LLM 调用流式延迟 < 200ms p50 |
| 多  | session 在 Supabase PG 跨副本共享 |
| 安全 | dsh container non-root (uid 10001) + tini |
| 隔离 | dsh sandbox Landlock/bwrap capability |

## 6. 接口契约

### 6.1 dsh Web API

```
GET  /api/sessions                  # 列出当前用户 session
POST /api/sessions                  # 创建新 session
GET  /api/sessions/{id}             # 加载 session + events
POST /api/sessions/{id}/messages    # 发送消息 (流式响应 SSE)
POST /api/sessions/{id}/abort       # 中断 session
```

### 6.2 dsh tool 调用约定

```typescript
// dsh tool 必须实现 dsh Service Definition 接口
export interface DshTool<Input, Output> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodSchema<Input>;
  execute(input: Input, ctx: ToolContext): Promise<Output>;
}
```

### 6.3 K8s HPA 配置

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata: { name: dsh-web-hpa, namespace: mp-runtime }
spec:
  scaleTargetRef: { kind: Deployment, name: dsh-web }
  minReplicas: 3
  maxReplicas: 20
  metrics:
    - type: Resource
      resource: { name: cpu, target: { type: Utilization, averageUtilization: 70 } }
```

## 7. 验收标准

| # | 标准 | 验证 |
|---|---|---|
| AC1 | 60 个 dsh 包 vendor + build 通过 | `pnpm list --depth=0` |
| AC2 | 7 个 preset 配置就绪 | `ls apps/dsh-presets/` |
| AC3 | LLM provider 双源配置 | config 校验 |
| AC4 | dsh-web K8s 部署 + HPA | `kubectl get hpa` |
| AC5 | session Postgres backend 多副本共享 | 集成测试 |
| AC6 | dsh sandbox Landlock capability | 沙箱测试 |
| AC7 | DEEPSEEK_API_KEY 走 ExternalSecret | `rls-check.sh` |
| AC8 | evidence 完成 | 文件存在 |

## 8. 依赖

| 依赖 | 来源 |
|---|---|
| Supabase PG | MetaPlatform-FOUNDATION-01 ✅ |
| DeepSeek API key | SRE 申请 + Vault |
| dsh 源码 (vendor) | https://github.com/deepseek-ai/deepseek-harness |
| Harbor 镜像仓库 | MetaPlatform-DSH-DOCKER-01 ✅ |

## 9. 风险

| 风险 | 缓解 |
|---|---|
| dsh preview breaking | pin SHA + 不跟随 main |
| LLM provider 限流 | 多 provider fallback |
| session 多副本冲突 | Postgres backend + contigous-seq check |
| 镜像膨胀 | multi-stage + prod only deps |

## 10. 不做

- ❌ 自研 agent harness (用 dsh)
- ❌ LangChain 集成 (被 dsh 替代)
- ❌ 多区域部署 (单 region 写)

---

*PRD v1.0 — 配套 [MetaPlatform-DSH-01 Batch](../batch/MetaPlatform-DSH-01.md)*