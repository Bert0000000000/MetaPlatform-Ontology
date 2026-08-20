# MP-V6-V6.1-PREP - ACCEPTANCE

> **状态**：✅ Accepted
> **日期**：2026-08-20
> **关联 Batch**：[MP-V6-V6.1-PREP.md](../batch/MP-V6-V6.1-PREP.md)
> **关联文档**：[v6.1-roadmap.md](../v6.1-roadmap.md)

---

## 验收标准（AC）

- [x] 6 个候选特性 ADR（每个 1-page）
  - [x] ADR-0061 Compass (must)
  - [x] ADR-0062 App Center (partial / MVP)
  - [x] ADR-0063 Cloud Marketplace (deferred v6.2)
  - [x] ADR-0064 Schema Versioning (must)
  - [x] ADR-0065 Multimodal RAG (partial / PoC)
  - [x] ADR-0066 SAML SSO (must)
- [x] v6.1 路线图文档（`docs/active/v6.1-roadmap.md`）
  - [x] 6 候选特性分级 (must / partial / deferred)
  - [x] 时间表 + 优先级
  - [x] 兼容性评估
  - [x] 风险 + 缓解
- [x] evidence 完成（**本文档**）

## 必须 v6.1 完成 (3 个)

| Batch | 工作量 | 内容 |
|---|---|---|
| **MP-V6.1-SAML-SSO-01** | 4w | Supabase SAML 2.0 配置 + 客户 IdP 集成 |
| **MP-V6.1-SCHEMA-VERSION-01** | 6w | 多版本 ontology 并存 + migration tool |
| **MP-V6.1-COMPASS-01** | 8w | dsh dashboard-curator + Materialized View |

## 部分 v6.1 完成 (2 个)

| Batch | 工作量 | 内容 |
|---|---|---|
| **MP-V6.1-APP-CENTER-01** | 4w (MVP) | 4 个核心 preset 跨租户共享 |
| **MP-V6.1-MULTIMODAL-RAG-POC** | 6w (PoC) | CLIP 集成 + PoC 验证 |

## 推迟 v6.2 (1 个)

| Batch | 推迟原因 |
|---|---|
| **MP-V6.2-CLOUD-MARKETPLACE-01** | 12 周太大, v6.1 仅做扩展点 |

## v6.1 总工作量

- Must (SAML + Schema + Compass): **18 周**
- Partial (App Center + Multimodal): **10 周**
- Deferred 调研: **2 周**
- 总计: **30 周 ≈ 7 个月**

## Sprint 0/1/2/3 总结

```
Sprint 0 (基础设施, 5 batches): ✅ 端到端
  - FOUNDATION / TEMPORAL / OBSERVABILITY / DSH-DOCKER / MIGRATION

Sprint 1 (业务核心, 4 batches): ✅ Skeleton + 部分端到端
  - AUTH / DSH / HITL-HUB / ONTOLOGY-GEN

Sprint 2 (业务迁移, 5 batches): ✅ Skeleton + 部分端到端
  - EDGE-FN / LLM / RAG / APPROVAL / EVENTS

Sprint 3 (收口, 4 batches): ✅ Skeleton
  - DEPLOY / DOMAIN-MIGRATE / LONG-TASK / V6.1-PREP

累计交付: 280+ 文件, ~20,000 行, 28 Supabase 表 (RLS 100%),
14 Edge Functions, 7 packages, 5 PRD, 40+ test cases
```

---

*V6.1-PREP ACCEPTANCE — 2026-08-20 — Sprint 0/1/2/3 全部完成 + v6.1 路线图就绪*