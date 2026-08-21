# MetaPlatform-EDGE-FN-01 — mp-frontend-obs (19 apps) ACCEPTED

> **状态**:✅ Loop 1/3 Accepted
> **日期**:2026-08-21
> **关联 Batch**:[MetaPlatform-EDGE-FN-01.md](../active/batch/MetaPlatform-EDGE-FN-01.md)
> **关联 ADR**:[ADR-0059-mp-observability.md](../active/decisions/ADR-0059-mp-observability.md) (frontend extension)
> **Module**:M10 mp-frontend-obs (19 apps 之一, 前端可观测性)
> **Commit**:(本 session)

---

## 验收标准 (Loop 1/3 — frontend 埋点采集)

| # | 标准 | 状态 |
|---|---|---|
| AC1.1 | `public.frontend_events` 表 (id, tenant_id, user_id, session_id, event_type, page, data, user_agent) | ✅ |
| AC1.2 | 4 RLS policies + tg_audit | ✅ |
| AC1.3 | supabase_realtime publication add | ✅ |
| AC1.4 | `frontend_events_summary` view (per-tenant hourly + event_type) | ✅ |
| AC1.5 | 'global' tenant (匿名事件默认入这里) | ✅ |
| AC1.6 | `mp-frontend-obs-events` EF (POST, anon 可写) | ✅ |
| AC1.7 | 4 种 event_type (page_view / click / error / performance) | ✅ |
| AC1.8 | authenticated POST → tenant_id + user_id 正确 | ✅ |
| AC1.9 | invalid event_type / JSON → 400 | ✅ |
| AC1.10 | RLS 跨 tenant 隔离 (全局 tenant 事件 tenantA 看不到) | ✅ |
| AC1.11 | 10/10 E2E PASS | ✅ |

## E2E 结果

```
Running 10 tests using 1 worker
[1/10] 1. anon POST page_view → 201 + frontend_events 写入                   (pass)
[2/10] 2. anon POST error → 201 + data 含 error stack                          (pass)
[3/10] 3. anon POST click → 201 + data 含 selector                            (pass)
[4/10] 4. anon POST performance → 201 + data 含 timing                          (pass)
[5/10] 5. authenticated POST → tenant_id + user_id 正确                      (pass)
[6/10] 6. invalid event_type → 400                                            (pass)
[7/10] 7. invalid JSON → 400                                                  (pass)
[8/10] 8. frontend_events_summary view 反映新事件                            (pass)
[9/10] 9. frontend_events 表有数据 (从 anon global tenant 查)               (pass)
[10/10] 10. RLS: 跨 tenant 看不到 (anon global tenant 事件 vs tenantA auth)  (pass)

  10 passed (4.9s)
```

## 已交付文件

| 路径 | 行数 | 说明 |
|---|---|---|
| `supabase/migrations/20260820630002_create_mp_frontend_obs.sql` | 80 | frontend_events 表 + 4 RLS + tg_audit + Realtime + summary view + 'global' tenant |
| `supabase/functions/mp-frontend-obs-events/index.ts` | 130 | POST 接收 4 种 event_type + auth + global fallback |
| `e2e/mp-frontend-obs.spec.ts` | 215 | 10 个 E2E |

## 19 apps 完成度 (本次新增 mp-frontend-obs)

| App | 状态 |
|---|---|
| mp-runtime | ✅ |
| mp-platform | ✅ |
| mp-sandbox | ✅ |
| mp-knowledge | ✅ |
| mp-ontology | ✅ |
| mp-ai | ✅ |
| mp-monitoring | ✅ |
| mp-workflow | ✅ |
| mp-skill-marketplace | ✅ |
| **mp-frontend-obs** | ✅ **Loop 1/3** (本 session) |
| mp-audit | ✅ |
| mp-data-* (4 apps) | ⏳ (PoC 阶段) |
| mp-skill-marketplace | ✅ |
| mp-runtime 等 | ✅ |

## 架构 (PoC → 生产)

```
PoC (本 Loop 1/3):
  frontend 埋点 (浏览器 SDK) → mp-frontend-obs-events EF → frontend_events 表
  Realtime 订阅 → mp-monitoring dashboard (前端 events 可视化)

生产 (Loop 2/3 + 3/3):
  + mp-frontend-obs SDK (浏览器, 性能 / 错误 / 行为埋点) component
  + 前端 dashboard (heatmap / funnel / error tracker)
  + OTel SDK 集成 (Loop 3/3)
```

## 下一步 (Loop 2/3)

- mp-frontend-obs 浏览器 SDK (TS package, npm 发布)
- mp-frontend-obs dashboard page (admin-server 加 /admin/frontend-events)
- 端到端: 真实前端 (dsh-web) 埋点 + dashboard 显示

## 与其他模块的关系

| 模块 | 复用关系 |
|---|---|
| M10 mp-monitoring | dashboard 数据源 (frontend_events_summary view) |
| 19 apps (前端) | 浏览器 SDK (Loop 2/3) |
| Realtime | supabase_realtime publication add (前端 dashboard 实时) |
| audit_log | tg_audit 自动记录 frontend_events 增删改 |

---

*mp-frontend-obs Loop 1/3 — 2026-08-21 — 10/10 E2E PASS, 0 bug*