# PRD：auth-jwt-rls

> **模块**：Auth 层（Supabase Auth + JWT claims + RLS baseline + OAuth）
> **对应 Batch**：[MP-V6-AUTH-01](../batch/MP-V6-AUTH-01.md)
> **状态**：Draft v1.0
> **负责人**：SRE + 后端
> **日期**：2026-08-20

---

## 1. 概述（What）

部署 Supabase Auth（GoTrue），配置 JWT custom claims（tenant_id + role），启用所有业务表 RLS policy，集成 1 个 OAuth provider（钉钉/飞书/企微三选一）。

## 2. 背景与目标

### 2.1 背景

- v3.0 用 Keycloak（OAuth2 + SAML + RBAC），治理债高
- v6.0 切到 Supabase Auth（决策 #11，spec §1.1）
- 多租户隔离用 RLS 单一层（决策 #6，spec §1.1）

### 2.2 目标

| # | 目标 |
|---|---|
| G1 | Supabase Auth 高可用（≥ 2 副本） |
| G2 | JWT 含 `tenant_id` + `role` claims（自动注入） |
| G3 | 100% 业务表 RLS 启用 + policy 模板 |
| G4 | 1 个 OAuth provider 集成（钉钉优先） |
| G5 | Edge Function JWT 验证模板（供业务 Batch 复用） |

## 3. 用户与场景

| Persona | 场景 |
|---|---|
| 业务用户 | 邮箱密码 / OAuth 登录 → JWT → 访问自己 tenant 数据 |
| DBA | 用 Supabase Studio 审核 RLS policy |
| SRE | 监控 Auth pod 健康 + JWT 解析失败告警 |

## 4. 功能需求

### 4.1 JWT Custom Claims

```sql
-- auth.users 表新增 metadata.tenant_id + role
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb AS $$
DECLARE
    claims jsonb;
    tenant_id uuid;
    role text;
BEGIN
    SELECT p.tenant_id, p.role
    INTO tenant_id, role
    FROM public.profiles p
    WHERE p.id = (event->>'user_id')::uuid;

    claims := event->'claims';
    claims := jsonb_set(claims, '{tenant_id}', to_jsonb(tenant_id));
    claims := jsonb_set(claims, '{role}', to_jsonb(role));
    RETURN jsonb_set(event, '{claims}', claims);
END;
$$ LANGUAGE plpgsql STABLE;

-- Supabase 配置: enable custom_access_token_hook
```

### 4.2 RLS Policy 模板

详见 [`supabase/policies/templates.sql`](../../policies/templates.sql)（已在 FOUNDATION-01 完成）

业务表新增时调用 4 个 `_policy_tenant_*` 函数即可。

### 4.3 OAuth 集成（钉钉示例）

```typescript
// supabase/functions/oauth-dingtalk-callback/index.ts
// OAuth 2.0 flow: 钉钉授权 → 回调 → 调 supabase.auth.admin.createUser
// (具体实现见 PRD 详细设计)
```

## 5. 非功能需求

| 维度 | 要求 |
|---|---|
| 可用性 | Auth ≥ 2 副本 + HPA |
| 性能 | JWT 解析 < 10ms p99 |
| 安全 | RLS 强制 + Secret 不进 git |
| 兼容 | 支持邮箱密码 + OAuth + Magic Link |

## 6. 接口契约

### 6.1 JWT 解析

```typescript
interface JwtPayload {
  sub: string;           // user_id (UUID)
  tenant_id: string;     // UUID
  role: 'owner' | 'admin' | 'member' | 'guest';
  email: string;
  exp: number;
  iat: number;
}
```

### 6.2 Edge Function 验证模板

```typescript
// supabase/functions/_template-auth/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export async function verifyAuth(req: Request) {
  const auth = req.headers.get('authorization');
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!);
  const { data: { user }, error } = await supabase.auth.getUser(auth!.replace(/^Bearer\s+/, ''));
  if (error || !user) throw new Error('Unauthorized');
  return {
    userId: user.id,
    tenantId: user.app_metadata.tenant_id,
    role: user.app_metadata.role,
  };
}
```

## 7. 验收标准

| # | 标准 | 验证 |
|---|---|---|
| AC1 | Supabase Auth ≥ 2 副本 | `kubectl get pods -n mp-data -l app=supabase-auth` |
| AC2 | JWT 含 tenant_id + role | 单元测试 + e2e |
| AC3 | 100% 业务表 RLS 启用 | `rls-check.sh` |
| AC4 | OAuth 集成 e2e 通过 | Playwright |
| AC5 | Edge Function JWT 验证模板就绪 | unit test |
| AC6 | evidence 完成 | 文件存在 |

## 8. 依赖

| 依赖 | 来源 |
|---|---|
| Supabase PG | MP-V6-FOUNDATION-01 |
| Edge Functions runtime | MP-V6-FOUNDATION-01 |
| OAuth app 凭证 | SRE 申请（钉钉 / 飞书 / 企微） |

## 9. 风险

| 风险 | 缓解 |
|---|---|
| RLS 写错 | rls-check CI 强制 |
| OAuth provider 限流 | 三家互备 |
| JWT 泄露 | httpOnly + 短期 + refresh 轮转 |

## 10. 不做

- ❌ SAML（v6.0 不引入，OAuth 足够）
- ❌ 自建 RBAC（用 Supabase Auth 默认 role）
- ❌ 跨域 SSO（v6.1 评估）

---

*PRD v1.0 — 配套 [MP-V6-AUTH-01 Batch](../batch/MP-V6-AUTH-01.md)*