# MetaPlatform-HITL-HUB-01 — HITL Hub (Loop 1/3) ACCEPTED

> **状态**：✅ Loop 1/3 Accepted
> **日期**：2026-08-20
> **关联 Batch**：[MetaPlatform-HITL-HUB-01.md](../active/batch/MetaPlatform-HITL-HUB-01.md)
> **关联 ADR**：[ADR-0053-hitl-hub.md](../active/decisions/ADR-0053-hitl-hub.md)
> **关联 PRD**：[hitl-hub.md](../active/prd/hitl-hub.md)
> **Commit**：cbcb6af

---

## 验收标准 (Loop 1/3)

| # | 标准 | 状态 |
|---|---|---|
| AC1.1 | `public.hitl_requests` 表 (4 类型 + status + payload + workflow_id + escalation) | ✅ |
| AC1.2 | 4 RLS policies (tenant 隔离 via `_policy_tenant_*` helpers) | ✅ |
| AC1.3 | tg_inject_tenant + tg_audit + tg_set_updated_at 触发器 | ✅ |
| AC1.4 | supabase_realtime publication add (WS 推送) | ✅ |
| AC1.5 | `public.hitl_pending_by_tenant` view (mp-audit dashboard) | ✅ |
| AC1.6 | `request-hitl` EF (POST 创建, 4 类型 + 验证) | ✅ |
| AC1.7 | `decide-hitl` EF (POST 批准/拒绝, approver 校验 + 409 already_decided) | ✅ |
| AC1.8 | `list-pending-hitl` EF (GET 待审批, uuid[] contains operator) | ✅ |
| AC1.9 | 7/7 E2E PASS (4 type / list / approved / 409 / 403 / anon / invalid) | ✅ |

## E2E 结果

```
Running 7 tests using 1 worker
[1/7] 1. request-hitl workflow_saas create → 201 + hitl_request_id     (pass)
[2/7] 2. list-pending-hitl → requester 创建, approver 看得到          (pass)
[3/7] 3. decide-hitl approved → status 变更 + audit_log                (pass)
[4/7] 4. decide-hitl 二次决 → 409 already_decided                     (pass)
[5/7] 5. decide-hitl 非 approver → 403                                 (pass)
[6/7] 6. anon POST → 401                                              (pass)
[7/7] 7. invalid type → 400                                           (pass)

  7 passed (3.8s)
```

## 已交付文件

| 路径 | 行数 | 说明 |
|---|---|---|
| `supabase/migrations/20260820610000_create_hitl_hub.sql` | 130 | hitl_requests 表 + 4 RLS + 3 triggers + publication + view |
| `supabase/functions/request-hitl/index.ts` | 100 | POST 4 类型 HITL 创建 |
| `supabase/functions/decide-hitl/index.ts` | 110 | POST 批准/拒绝 (approver 校验) |
| `supabase/functions/list-pending-hitl/index.ts` | 70 | GET 当前用户待审批 |
| `supabase/functions/ticket-triage/index.ts` | +5 | 适配新 schema (context→payload 等) |
| `e2e/hitl-hub.spec.ts` | 270 | 7 个 E2E |
| `e2e/edge-functions.spec.ts` | +2 | 适配新 schema |

## 4 HITL 类型 (per ADR-0053 §7.9)

| type | 谁审批 | 在哪审批 | payload 例子 |
|---|---|---|---|
| `workflow_saas` | 业务用户 | 钉钉 / 飞书 / 企微 | `{ order_id, amount }` |
| `workflow_dsh` | 业务用户 | dsh Web | `{ contract_id }` |
| `tool_dsh` | 数字员工用户 | dsh Web 弹窗 | `{ tool_call: { name, args } }` |
| `action_confirm` | 数字员工用户 | dsh Web 预览 | `{ preview: { action, params } }` |

## 下一步 (Loop 2/3 + 3/3)

- Loop 2/3: Temporal signal 消费者 (mp-workflow worker 监听 hitl_requests UPDATE, 发 Temporal signal)
- Loop 3/3: 钉钉 / 飞书 / 企微 webhook → 自动决 / 多级超时升级 (M22)

## 与其他模块的关系

| 模块 | 复用关系 |
|---|---|
| ticket-triage (edge-fn) | 高优工单 → `tool_dsh` HITL |
| mp-workflow (M40) | `workflow_saas` 触发 Temporal workflow |
| mp-skill-marketplace (App Center) | 安装 preset 前 `action_confirm` 确认 |
| mp-monitoring (M10) | Realtime WS → Grafana dashboard |

---

*MetaPlatform-HITL-HUB-01 Loop 1/3 — 2026-08-20 — 7/7 E2E PASS, 0 bug*