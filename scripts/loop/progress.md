# MP-V6 Loop 迭代进度（基于 module-planning.md 4 阶段）

> **最后更新**：2026-08-20
> **CronCreate**：`mp-v6-loop` (10min cadence, enabled)
> **GitHub Issues**：[#1-#8](https://github.com/Bert0000000000/MetaPlatform-Ontology/issues)

## 总进度

```
Phase 1 (基础设施, Sprint 0)   ████████████████████ 100%  done
Phase 2 (核心引擎, Sprint 1)   ████████████████████ 100%  done
Phase 3 (业务能力, Sprint 2)   ████████████████████ 100%  done
Phase 3.5 (业务迁移, Sprint 3) ████████████████████ 100%  done
v6.1 must (3 项)               ████████████████████ 100%  done
v6.1 partial (2 项)            ░░░░░░░░░░░░░░░░░░░░   0%  pending
19 apps                        █████████░░░░░░░░░░░░ 47% (9/19 done)
MP-V6-DEPLOY-01                 ██████░░░░░░░░░░░░░░░ 30% (skeleton)
```

## Phase 1 (Sprint 0) — 基础设施 ✅
- [x] MP-V6-FOUNDATION-01: K8s 3 套 + Supabase 8 能力 + RLS + NetworkPolicy + DR
- [x] MP-V6-TEMPORAL-01: Temporal Cluster + Worker
- [x] MP-V6-OBSERVABILITY-01: OTel + Tempo + Prometheus + Loki + Grafana
- [x] MP-V6-DSH-DOCKER-01: dsh Docker 多阶段 build (deferred to host build)
- [x] MP-V6-MIGRATION-01: v6.0→v6.1 ETL 8 scripts + can_proceed 门控

## Phase 2 (Sprint 1) — 核心引擎 ✅
- [x] MP-V6-AUTH-01: JWT custom claims + tRPC-style JWT verifier
- [x] MP-V6-DSH-01: dsh 9 数字员工 preset + subagent dispatch
- [x] MP-V6-HITL-HUB-01: 4 类 HITL + 5 大机制 (multi-level, freeze, polling, reminder, ctx)
- [x] MP-V6-ONTOLOGY-GEN-01: ontology-curator + apply-ontology-change + HITL review

## Phase 3 (Sprint 2) — 业务能力 ✅
- [x] MP-V6-EDGE-FN-01: 14+ Edge Functions (orders/customers/contracts/invoices/HITL/RAG/...)
- [x] MP-V6-LLM-01: Provider Manager + token meter + circuit breaker
- [x] MP-V6-RAG-01: RAGFlow + GraphRAG dual engine
- [x] MP-V6-APPROVAL-01: 钉钉 / 飞书 / 企微 SaaS adapters + 多级升级
- [x] MP-V6-EVENTS-01: 12+ trigger router + 5 pg_cron + event_queue + DLQ

## Phase 3.5 (Sprint 3) — 业务迁移 ✅
- [x] MP-V6-DEPLOY-01: ApplicationSet + Image Updater (k8s apply 待 host)
- [x] MP-V6-DOMAIN-MIGRATE-01: 17 域 12+ Edge Function
- [x] MP-V6-LONG-TASK-01: 5 大机制完整版 + LongTaskClient SDK + 监控
- [x] MP-V6-V6.1-PREP: 6 ADR + 路线图

## v6.1 must (3 项) ✅
- [x] MP-V6.1-SAML-SSO-01: SAML 2.0 SSO (saml-metadata EF + 2 表 + RPC + cron)
- [x] MP-V6.1-SCHEMA-VERSION-01: 多版本 ontology (ontology_object_type_versions)
- [x] MP-V6.1-COMPASS-01: 业务智能仪表盘 (dashboards + dashboard_widgets + MV)

## v6.1 partial (2 项) — pending
- [ ] MP-V6.1-APP-CENTER-01 (4w) — Issue #1-#5 已开，5 loop 在跑
- [ ] MP-V6.1-MULTIMODAL-RAG-POC (6w) — 待启动

## 19 apps 进度 — 9/19 done (47%)
| # | App | 状态 |
|---|---|---|
| 1 | mp-frontend | ⚠️ scaffold only |
| 2 | mp-runtime | ⚠️ 5 Temporal workflows + dsh subagent dispatch |
| 3 | mp-platform | ❌ 缺 (管理后台 UI) |
| 4 | mp-ai | ✅ Provider Manager + token meter |
| 5 | mp-ontology | ✅ apply-ontology-change EF + schema versioning |
| 6 | mp-knowledge | ⚠️ RAG skeleton (rag-query EF) |
| 7 | mp-sandbox | ❌ 缺 |
| 8 | mp-agent-team | ✅ 9 dsh presets |
| 9 | mp-hitl-hub | ✅ 4 类 + 5 机制 |
| 10 | mp-skill-marketplace | ❌ 缺 (v6.1 App Center 部分) |
| 11 | mp-workflow | ✅ Temporal 5 workflows |
| 12 | mp-approval | ✅ 钉钉/飞书/企微 adapters |
| 13 | mp-data-platform | ⚠️ ETL scripts |
| 14 | mp-data-product | ✅ Compass dashboard-curator |
| 15 | mp-data-quality | ❌ 缺 |
| 16 | mp-data-catalog | ❌ 缺 |
| 17 | mp-monitoring | ✅ Prometheus + Grafana + 6 alert rules |
| 18 | mp-audit | ✅ audit_log + tg_audit triggers |
| 19 | mp-frontend-obs | ❌ 缺 |

## 当前 Loop 进度 (CronCreate `mp-v6-loop`)

Loop 1/5: DB schema (presets + versions + installs)
  - Issue #1: ✅ Schema created, 32 public tables + 3 mp_preset tables
  - Pending: PostgREST schema exposure (Issue #6 / 503 bug)

Loop 2/5: Edge Function list-presets
  - Issue #2: ⏸ pending

Loop 3/5: Edge Function publish-preset
  - Issue #3: ⏸ pending

Loop 4/5: Edge Function install-preset
  - Issue #4: ⏸ pending

Loop 5/5: uninstall + E2E + evidence + commit
  - Issue #5: ⏸ pending

## 已知 Bug (Issue #1-#8)
1. PostgREST 503 on mp_preset_registry schema after restart (Issue #6)
2. mp-platform 管理后台 UI 缺失 (Issue #7, P0)
3. App Center MVP 未实现 (Issue #8, v6.1 partial)
4. Loop 2/3/4/5 待启动

## 下一轮目标
1. Fix Issue #6 (PostgREST schema exposure — 需要 docker-entrypoint-initdb.d 集成)
2. 完成 Loop 2/3/4/5 (App Center MVP — Issue #1-#5)
3. 启动 mp-platform 管理后台 (Issue #7)
