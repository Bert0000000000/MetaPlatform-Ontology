# MP-V6.1-APP-CENTER-01 — v6.1 App Center MVP

> **Batch 状态**：🟡 In Progress
> **优先级**：🟡 v6.1 partial (preset 共享价值大)
> **工作量**：4w (MVP)
> **团队**：AI 团队 + SRE
> **前置依赖**：MP-V6-DSH-01 ✅

---

## 1. 目标

让开发者发布数字员工 preset（mp-v6 等 9 个），业务用户一键安装到自己的数字员工（mp-runtime / mp-agent-team / mp-skill-marketplace）。

## 2. 配套文档

- **ADR-0062**：[v6.1 App Center 决策](../decisions/ADR-0062-v6.1-app-center.md)
- **PRD**：[mp-skill-marketplace PRD](../prd/mp-skill-marketplace.md)
- **v6.1 路线图**：[v6.1-roadmap.md §4 MP-V6.1-APP-CENTER-01](../v6.1-roadmap.md)

## 3. 核心交付 (MVP 4w)

| 项 | 验证 |
|---|---|
| `mp_preset_registry.presets` 表 | DDL + RLS |
| `mp_preset_registry.versions` 表 | DDL + RLS + semver |
| `mp_preset_registry.installs` 表 (per-tenant) | DDL + RLS |
| Edge Function `list-presets` (公开目录) | E2E |
| Edge Function `publish-preset` (开发者发布) | E2E |
| Edge Function `install-preset` (业务用户) | E2E |
| Edge Function `uninstall-preset` (卸载) | E2E |
| 8/8 Playwright E2E | E2E |
| evidence + 0 bug + 1 commit per loop | GitHub |

## 4. 详细任务清单

### Loop 1: DB schema
- [ ] `mp_preset_registry` schema + 表
- [ ] RLS policies
- [ ] pg_cron cleanup (旧版本)

### Loop 2: Edge Function list-presets
- [ ] GET /v1/marketplace/presets
- [ ] RLS: 公开 preset (不需 tenant), 私有需 tenant
- [ ] E2E test

### Loop 3: Edge Function publish-preset
- [ ] POST /v1/marketplace/presets (admin/owner only)
- [ ] validation (name, manifest, files)
- [ ] E2E test

### Loop 4: Edge Function install-preset
- [ ] POST /v1/marketplace/presets/:id/install (per-tenant)
- [ ] 写 installs 表 (含 config override)
- [ ] E2E test

### Loop 5: Edge Function uninstall-preset
- [ ] POST /v1/marketplace/presets/:id/uninstall
- [ ] 软删 (is_active=false)
- [ ] E2E test

### Loop 6: 集成 + E2E + commit
- [ ] Playwright E2E (8/8)
- [ ] evidence/MP-V6.1-APP-CENTER-01-ACCEPTANCE.md
- [ ] 更新 v6.1-roadmap 状态
- [ ] GitHub issues (loop 进度追踪)

## 5. 验收标准 (AC)

- [ ] 5 个 Edge Function 全部部署 + 通过 E2E
- [ ] 3 张表 + RLS + pg_cron cleanup
- [ ] GitHub issues 反映 loop 进度 (5/5 closed)
- [ ] Playwright 8/8 PASS
- [ ] 0 bug
- [ ] evidence 完成

## 6. 风险

| 风险 | 缓解 |
|---|---|
| 多租户 preset 隔离 | RLS 强制 + per-tenant install row |
| 版本冲突 | semver + install row track version |
| 公共 preset 滥用 | admin/owner only + audit_log |
| 0 bug 难保证 | 每个 loop 一个 Playwright E2E 必跑 |

## 7. Workflow (loop-prompt.md §15)

每 1 commit = 1 loop:
- 1 个 loop = (1 E2E 必跑 + 1 commit + 1 issue close)
- Issues 标签: `loop:N/4`, `bug`, `enhancement`
- 每个 loop end → 更新 v6.1-roadmap.md §4 状态

---

*MP-V6.1-APP-CENTER-01 — v6.1 App Center MVP — this iteration (4w, 5 loops)*