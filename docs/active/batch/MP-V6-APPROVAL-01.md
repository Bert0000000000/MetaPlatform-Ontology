# MP-V6-APPROVAL-01 — 第三方审批 SaaS + 多级超时升级

> **Batch 状态**：Pending Acceptance
> **优先级**：🔴 P2
> **工作量**：6 周
> **团队**：SRE + 后端
> **前置依赖**：MP-V6-HITL-HUB-01 ✅

---

## 1. 目标

实现 3 家第三方审批 SaaS 适配层（钉钉/飞书/企微），多级超时升级链，1 周+ 长审批场景完整支持。

## 2. 配套文档

- 架构 spec：`docs/active/specs/2026-08-19-mp-v6-architecture.md` §7.9 / §6.5
- 已有 PRD：`docs/active/prd/hitl-hub.md` §4.2 (5 大机制)

## 3. 核心交付

| 项 | 验证 |
|---|---|
| 钉钉适配层 (approval-saas-dingtalk) | E2E 测试 |
| 飞书适配层 (approval-saas-feishu) | E2E 测试 |
| 企微适配层 (approval-saas-wecom) | E2E 测试 |
| 多级超时升级链 (24h→B / 48h→C / 72h→D) | 集成测试 |
| 1 周+ 长审批 E2E 测试 | 实际测试 7 天 |

## 4. 详细任务清单

### Week 1-2：钉钉适配层
- [ ] 钉钉 app 申请 + 凭证注入
- [ ] OAuth 2.0 + 审批 API 封装
- [ ] webhook receiver
- [ ] E2E 测试

### Week 3-4：飞书 + 企微适配层
- [ ] 飞书 app 申请 + OAuth + 审批 API
- [ ] 企微 app 申请 + OAuth + 审批 API
- [ ] 通用 adapter 接口（统一 3 家差异）

### Week 5：多级超时升级链
- [ ] escalation_level 配置 (24h→B / 48h→C / 72h→D)
- [ ] 自动升级 cron (HITL-HUB-01 已部分实现)
- [ ] 升级通知（Realtime + Email + SaaS）

### Week 6：1 周+ 长审批 E2E
- [ ] 端到端测试 7 天
- [ ] 跨升级链验证
- [ ] 24h 监控 + 应急预案
- [ ] evidence/MP-V6-APPROVAL-01-ACCEPTANCE.md

## 5. 验收标准（AC）

- [ ] 3 家 SaaS 适配层
- [ ] 多级超时升级链
- [ ] 1 周+ 长审批 E2E
- [ ] 24h 监控就绪
- [ ] evidence 完成

## 6. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 钉钉/飞书/企微 API 限流 | 3 家互备 + retry + backoff |
| 7 天测试资源消耗 | staging 演练 + 复用 1 次 7 天测试 |
| 升级链过深 | escalation_level 上限 3 |
| webhook 丢失 | hitl-poll-reconcile cron 兜底 |

---

*MP-V6-APPROVAL-01 — Sprint 2 第三方审批就绪*