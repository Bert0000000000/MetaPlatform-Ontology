# MetaPlatform-EVENTS-01 — Database Webhook + pg_cron worker

> **Batch 状态**：Pending Acceptance
> **优先级**：🟡 P2
> **工作量**：2 周
> **团队**：SRE
> **前置依赖**：MetaPlatform-FOUNDATION-01 ✅

---

## 1. 目标

实现 Database Webhook 接收 + pg_cron 定时任务 worker，作为 Supabase trigger + pg_notify 的补充，处理 v3.0 Kafka 的事件可靠传递需求。

## 2. 配套文档

- 架构 spec：`docs/active/specs/2026-08-19-mp-v6-architecture.md` §7.1

## 3. 核心交付

| 项 | 验证 |
|---|---|
| Database Webhook 配置 (≥ 5 个 trigger) | Supabase Dashboard |
| pg_cron 定时任务 worker | `SELECT * FROM cron.job;` |
| dsp-webhook Edge Function (已有) | E2E 测试 |
| 长任务 5 大机制 (HITL-HUB-01 已部分实现) | 集成测试 |

## 4. 详细任务清单

### Week 1：Database Webhook
- [ ] 配置 5 个核心 trigger (orders/contracts/hitl_requests/tickets/invoices)
- [ ] dsp-webhook Edge Function 完整路由
- [ ] Supabase Dashboard 配置 webhook

### Week 2：pg_cron worker
- [ ] pg_cron 调度清单 (备份/清理/超时升级等)
- [ ] worker 日志收集
- [ ] 失败重试策略
- [ ] evidence/MetaPlatform-EVENTS-01-ACCEPTANCE.md

## 5. 验收标准（AC）

- [ ] Database Webhook 配置就绪
- [ ] pg_cron worker 就绪
- [ ] dsp-webhook E2E 测试
- [ ] evidence 完成

---

*MetaPlatform-EVENTS-01 — Sprint 2 事件层就绪*