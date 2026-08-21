# MetaPlatform-DSH-POSTGRES-BACKEND-01 — M15 dsh session Postgres backend (Loop 1/3) ACCEPTED

> **状态**:✅ Loop 1/3 Accepted
> **日期**:2026-08-21
> **关联 Batch**:[MetaPlatform-DSH-POSTGRES-BACKEND-01.md](../active/batch/MetaPlatform-DSH-POSTGRES-BACKEND-01.md)
> **关联 ADR**:[ADR-0055-dsh-postgres-backend.md](../active/decisions/ADR-0055-dsh-postgres-backend.md)
> **Module**:M15 dsh session Postgres backend (K8s 多副本 session 共享)
> **Commit**:(本 session)

---

## 验收标准 (Loop 1/3 — schema + create + append + load EF)

| # | 标准 | 状态 |
|---|---|---|
| AC1.1 | `public.dsh_session_headers` 表 (id, tenant_id, user_id, version, agent_preset, status, ...) | ✅ |
| AC1.2 | `public.dsh_session_events` 表 (session_id, seq, type, time, data, source_event_seqs, surface_op) | ✅ |
| AC1.3 | 4 RLS policies + tg_inject_tenant + tg_audit + tg_set_updated_at | ✅ |
| AC1.4 | `dsh_session_summary` view (per-tenant 统计) | ✅ |
| AC1.5 | pg_cron `dsh-session-cleanup` (0 2 * * *) 清理 completed/failed/cancelled 超 30 天 | ✅ |
| AC1.6 | `dsh-session-create` EF (POST) | ✅ |
| AC1.7 | `dsh-session-append-events` EF (POST, seq contiguous 校验, batch INSERT) | ✅ |
| AC1.8 | `dsh-session-load` EF (POST, header + events 按 seq 顺序) | ✅ |
| AC1.9 | 8/8 E2E PASS | ✅ |

## E2E 结果

```
Running 8 tests using 1 worker
[1/8] 1. dsh-session-create → 返回 session_id + version=0                            (pass)
[2/8] 2. dsh-session-append-events (3 events) → appended=3, next_seq=3, version=1      (pass)
[3/8] 3. dsh-session-append-events 非 contiguous seq → 409 seq_not_contiguous            (pass)
[4/8] 4. dsh-session-load → header + events 按 seq 顺序                                (pass)
[5/8] 5. cross-tenant → 403                                                            (pass)
[6/8] 6. anon POST → 401                                                                (pass)
[7/8] 7. dsh_session_summary view → active_count 反映新 session                         (pass)
[8/8] 8. pg_cron job 'dsh-session-cleanup' 已 schedule                                   (pass)

  8 passed (3.6s)
```

## 已交付文件

| 路径 | 行数 | 说明 |
|---|---|---|
| `supabase/migrations/20260820650000_dsh_session_postgres_backend.sql` | 130 | 2 表 + 4 RLS + 3 triggers + view + pg_cron cleanup |
| `supabase/functions/dsh-session-create/index.ts` | 60 | POST 创建 session header |
| `supabase/functions/dsh-session-append-events/index.ts` | 105 | POST batch append + seq contiguous 校验 |
| `supabase/functions/dsh-session-load/index.ts` | 85 | POST 加载 header + events |
| `e2e/dsh-session.spec.ts` | 290 | 8 个 E2E |

---

# MetaPlatform-PLATFORM-UI-01 — admin-server 加 3 页 (Loop K) ACCEPTED

> **状态**:✅ Loop K Accepted
> **日期**:2026-08-21
> **模块**:mp-platform UI 升级 (admin-server 加 ontology/hitl/sessions 页)
> **Commit**:(本 session)

---

## 验收标准

| # | 标准 | 状态 |
|---|---|---|
| ACK.1 | `/admin/ontology` 显示 M11 kernel 3 类型统计 + 最近 10 | ✅ |
| ACK.2 | `/admin/hitl` 显示 HITL Hub pending + 最近 20 + workflow_signals 队列状态 | ✅ |
| ACK.3 | `/admin/sessions` 显示 dsh session 统计 + per-tenant active + 最近 20 | ✅ |
| ACK.4 | `/admin` nav 链接全部可见 (sandbox/ontology/hitl/sessions) | ✅ |
| ACK.5 | 4 个新 admin-server E2E PASS | ✅ |

## 已交付文件

| 路径 | 行数 | 说明 |
|---|---|---|
| `scripts/dev/admin-server.mjs` | +150 行 | 3 个新路由 (/admin/ontology, /admin/hitl, /admin/sessions) |
| `e2e/admin-server.spec.ts` | +50 行 | 4 个新 E2E |

---

## 综合本 session 进度

| Loop | 模块 | +E2E |
|---|---|---|
| A | mp-sandbox Loop 2/3 | 0 |
| B | admin-server /admin/sandbox | +5 |
| C | HITL Hub Loop 1/3 | +7 |
| D | M11 Ontology Loop 1/3 | +7 |
| E | M11 Ontology Loop 2/3 | +11 |
| F | HITL Hub Loop 2/3 | +11 |
| G | M22 多级审批 | +8 |
| H | M11 Loop 3/3 + M18 | +9 |
| I | M12 ActionType.apply | +7 |
| **J** | **M15 dsh session Postgres backend** | **+8** |
| **K** | **mp-platform UI (admin-server 3 新页)** | **+4** |

E2E 推进: 57 → 134 (+77 tests in this session)

## 下一步候选

- **Issue #15 Loop 3/3**: mp-sandbox sidecar HTTP (PoC: mock bwrap)
- **M40 Workflow Path C**: Temporal worker 消费 workflow_signals
- **mp-monitoring**: OTel + Grafana dashboard (可观测层 P0)
- **mp-audit**: 审计 UI (已有 hitl_requests/hitl-sandbox/dsh_session 全数据)

dsh-web (5173) 目前可见:
- ✅ 顶栏 4 菜单 (Ontology Copilot / 云市场 / 应用中心 / Ontology 本体平台)
- ✅ 点击菜单 → iframe 加载 admin-server 8080 (现在显示 ontology/hitl/sessions 全状态)
- ❌ chat Copilot 还没接 DeepSeek + 本体生成

Scheduled task metaplatform-loop-10m 仍每 10min 自动 tick.