# PRD：approval-saas-adapters

> **模块**：第三方审批 SaaS 适配层（钉钉 / 飞书 / 企微）
> **对应 Batch**：[MP-V6-APPROVAL-01](../batch/MP-V6-APPROVAL-01.md)
> **状态**：Draft v1.0
> **负责人**：SRE + 后端
> **日期**：2026-08-20

---

## 1. 概述（What）

实现 3 家第三方审批 SaaS 的统一适配层（钉钉 / 飞书 / 企微），通过 Common ApprovalAdapter 接口暴露给 HITL Hub，1 周+ 长审批场景完整支持。

## 2. 背景与目标

### 2.1 背景

- v3.0 用 Flowable BPMN（Java），能力上限明显
- v6.0 切到 HITL Hub + 第三方 SaaS（决策 #7，spec §1.1）
- 钉钉 /飞书 /企微三家互备，避免单家限流

### 2.2 目标

| # | 目标 |
|---|---|
| G1 | 3 家 SaaS 适配层（钉钉/飞书/企微） |
| G2 | 统一 ApprovalAdapter 接口 |
| G3 | 多级超时升级链（24h→B / 48h→C / 72h→D） |
| G4 | 1 周+ 长审批 E2E |
| G5 | webhook + polling 双对账 |

## 3. 用户与场景

| Persona | 场景 |
|---|---|
| 业务用户 | 在钉钉/飞书/企微收到审批通知 → 点同意/拒绝 → workflow 自动恢复 |
| 架构师 | 切换 SaaS provider 不需要改业务代码（adapter 抽象） |
| SRE | 监控 SaaS webhook 失败率 + token meter |

## 4. 功能需求

### 4.1 Common Adapter 接口

```typescript
// packages/mp-approval-saas/src/types.ts
export interface ApprovalAdapter {
  readonly name: 'dingtalk' | 'feishu' | 'wecom';
  
  // 创建审批实例
  createApproval(opts: {
    tenantId: string;
    approverUserIds: string[];
    title: string;
    description?: string;
    formData: Record<string, unknown>;
    timeoutMs: number;
  }): Promise<{ externalId: string; approvalUrl: string }>;
  
  // 查询审批结果 (polling 用)
  getApproval(externalId: string): Promise<{
    status: 'pending' | 'approved' | 'rejected';
    decidedBy?: string;
    decidedAt?: string;
    comment?: string;
  }>;
  
  // 验证 webhook 签名
  verifyWebhook(req: Request, body: string): Promise<boolean>;
  
  // 解析 webhook payload
  parseWebhook(body: string): Promise<{
    externalId: string;
    decision: 'approved' | 'rejected';
    decidedBy: string;
    comment?: string;
  }>;
}
```

### 4.2 多级超时升级链

| escalation | 触发条件 | 下一审批人 |
|---|---|---|
| 0 → 1 | timeout_at < now() + 24h | B 经理 |
| 1 → 2 | timeout_at < now() + 48h | C 总监 |
| 2 → 3 | timeout_at < now() + 72h | D 副总 |
| 3 → expired | timeout_at < now() + 96h | 自动 expire + workflow 终止 |

### 4.3 HITL Hub 集成

```typescript
// HITL Hub requestHitl(type='workflow_saas', ...) 时:
// 1. 查 tenant 配置的 provider (钉钉/飞书/企微/auto-fallback)
// 2. 调 adapter.createApproval()
// 3. 存 externalId 到 hitl_requests.metadata
// 4. webhook 回调时 → adapter.parseWebhook() → hitl_hub.decideHitl()
```

## 5. 非功能需求

| 维度 | 要求 |
|---|---|
| 可用性 | 3 家互备（一家限流自动 fallback） |
| 安全 | HMAC SHA256 webhook 签名验证 |
| 多租户 | appKey/secret 通过 ExternalSecret per-tenant 注入 |
| 可观测 | OTel metrics 上报 (create / get / webhook 失败率) |

## 6. 接口契约

### 6.1 tenant 配置

```sql
CREATE TABLE public.tenant_approval_config (
    tenant_id           uuid PRIMARY KEY REFERENCES public.tenants(id),
    primary_provider    text NOT NULL CHECK IN ('dingtalk', 'feishu', 'wecom'),
    fallback_provider   text CHECK IN ('dingtalk', 'feishu', 'wecom'),
    app_key_env         text,  -- e.g. 'DINGTALK_APP_KEY_TENANT_A'
    app_secret_secret_env text,
    enabled             boolean DEFAULT true
);
```

## 7. 验收标准

| # | 标准 | 验证 |
|---|---|---|
| AC1 | 3 家 SaaS 适配层 | unit test (mock API) |
| AC2 | 多级超时升级链 | pg_cron + integration test |
| AC3 | 1 周+ 长审批 E2E | staging 演练 |
| AC4 | webhook + polling 双对账 | 集成测试 |
| AC5 | 3 家互备 fallback | 单元测试 |
| AC6 | evidence 完成 | 文件存在 |

## 8. 依赖

| 依赖 | 来源 |
|---|---|
| HITL Hub | MP-V6-HITL-HUB-01 ✅ |
| Temporal Worker | MP-V6-TEMPORAL-01 ✅ |
| 钉钉/飞书/企微 app 凭证 | SRE 申请 |

## 9. 风险

| 风险 | 缓解 |
|---|---|
| SaaS API 限流 | 3 家互备 + retry + backoff |
| webhook 丢失 | polling cron 兜底 |
| 多级升级不及时 | pg_cron 每小时检查 |

## 10. 不做

- ❌ 自建审批引擎（用 SaaS）
- ❌ 邮件审批（v6.0 用 SaaS）
- ❌ 微信/QQ 等其他平台

---

*PRD v1.0 — 配套 [MP-V6-APPROVAL-01 Batch](../batch/MP-V6-APPROVAL-01.md)*