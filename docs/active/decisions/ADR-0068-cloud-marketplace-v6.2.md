# ADR-0068：Cloud Marketplace 推迟到 v6.2

> **状态**：Accepted
> **日期**：2026-08-20
> **作者**：AI 团队 + Claude (MiniMax-M3)
> **关联 ADR**：[ADR-0063](ADR-0063-v6.1-cloud-marketplace.md)（v6.1 候选）/ [ADR-0067](ADR-0067-v6.0-ga-and-retrospective.md)（v6.0 GA）
> **关联 Batch**：(待定 v6.2 Batch ID)
> **关联路线图**：[`docs/active/v6.1-roadmap.md`](../v6.1-roadmap.md) §3 候选 #3

---

## 1. 背景

[ADR-0063](ADR-0063-v6.1-cloud-marketplace.md) 将 Cloud Marketplace 列为 v6.1 **deferred** 候选（12w 工作量），仅在 v6.1 做可行性调研。在 v6.0 GA 收尾时点（[ADR-0067](ADR-0067-v6.0-ga-and-retrospective.md)），需要明确：

- **v6.1 是否启动 Cloud Marketplace 实施？** 还是继续 deferred 到 v6.2？
- **v6.0 GA 包是否提供 Marketplace 扩展点？** 还是完全无？
- **哪些前置依赖必须先就位？**

---

## 2. 决策

**Cloud Marketplace 整体推迟到 v6.2**，v6.0 / v6.1 阶段：

| 阶段 | 内容 |
|---|---|
| **v6.0 GA（已 ship）** | 仅支持 preset 本地安装（`mp_preset_registry` schema + 5 Edge Functions） |
| **v6.1（推荐）** | 仅做 Cloud Marketplace **可行性调研** + **扩展点预留**（schema hooks + Edge Function contract） |
| **v6.2** | 实施完整 Cloud Marketplace（12w） |

### 决策要点

1. **不延后 GA**：v6.0 GA 时点不变，Cloud Marketplace 不阻塞
2. **预留扩展点**：v6.1 必须定义 `preset_hub_registry` 扩展 schema（即使不实施）
3. **不引入 vendor lock-in**：Cloud Marketplace 必须自建，禁 SaaS marketplace（保留与 ADR-0063 一致）
4. **公开承诺时点**：v6.2 = 2027-Q2

---

## 3. 理由

### 3.1 为什么推迟

| 理由 | 说明 |
|---|---|
| **GA 时点不破坏** | 12w 工作量会破坏 v6.0 → v6.1 → v6.2 节奏 |
| **业务尚未证明** | App Center MVP 跑通前，Cloud Marketplace 价值难以衡量 |
| **合规风险** | 跨组织 preset 共享触发数据合规审查（GDPR / 等保），需法务介入 |
| **复杂度高** | preset 签名 + 版本控制 + 多租户隔离 + 计费 + 审计 5 个子模块同时落地 |
| **ADR-0063 已 deferred** | 仅 2w 可行性调研排在 v6.1 时间表尾部 |

### 3.2 为什么 v6.1 仍需扩展点

| 原因 | 说明 |
|---|---|
| **向后兼容** | v6.1 写 schema 时不锁死 v6.2 实施空间 |
| **开发节奏** | 12w 不能压到 4w，提前规划可平滑过渡 |
| **生态共建** | 提前暴露 hook 让第三方 dsh preset 可参与 |

### 3.3 为什么 v6.2 而不是 v6.1

| 原因 | 说明 |
|---|---|
| **v6.1 时间窗已满** | must (18w) + partial (10w) + 可行性调研 (2w) = 30w 满载 |
| **v6.1 优先级** | App Center MVP + Multimodal RAG PoC 完成度高，Cloud Marketplace 价值低于二者 |
| **风险递延** | v6.1 App Center MVP 跑 6 个月，验证 preset 共享模式后再实施完整市场 |

---

## 4. v6.2 候选内容（Cloud Marketplace 完整版）

### 4.1 6 个核心模块

| # | 模块 | 工作量 | 说明 |
|---|---|---|---|
| 1 | **公共 preset 仓库** (`preset-hub`) | 3w | 中央化托管 + 跨租户共享 + CDN |
| 2 | **版本管理** | 2w | semver + dsh session schema 兼容性校验 + 自动升级 |
| 3 | **签名 + 完整性** | 1w | 数字签名 + checksum + 防篡改 |
| 4 | **多租户隔离 + config override** | 2w | preset per-tenant 配置覆盖 + RLS 强化 |
| 5 | **dsh runtime 集成** | 2w | dsh 启动时自动从 hub 拉取 + 校验 + 应用 |
| 6 | **计费 + 审计** | 2w | 按 preset 安装量计费 + 完整审计日志 |
| **总计** | | **12w** | |

### 4.2 与 App Center MVP 的差异

| 维度 | App Center MVP (v6.0) | Cloud Marketplace (v6.2) |
|---|---|---|
| **范围** | 单租户内 preset 共享 | 跨租户 / 跨组织 preset 共享 |
| **存储** | 本地 `mp_preset_registry` schema | 中央 hub + CDN |
| **签名** | 无 | 数字签名 + checksum |
| **计费** | 无 | 按下载量计费 |
| **审计** | 基础 audit_log | 完整审计 + 跨境传输日志 |
| **版本** | 单版本 | semver + 自动升级 |
| **配置覆盖** | 无 | per-tenant config override |

### 4.3 v6.1 扩展点（必须落地）

即使不实施完整 Cloud Marketplace，v6.1 必须预留：

```sql
-- v6.1 必加 schema（不实施逻辑，仅占位）
CREATE SCHEMA IF NOT EXISTS mp_preset_hub;

-- 扩展 metadata 列（v6.0 已 ship, 兼容 v6.2）
ALTER TABLE mp_preset_registry.presets
  ADD COLUMN IF NOT EXISTS hub_origin TEXT,         -- 'local' | 'hub:<org_id>'
  ADD COLUMN IF NOT EXISTS signature TEXT,          -- 数字签名 (v6.2 启用)
  ADD COLUMN IF NOT EXISTS checksum TEXT;           -- sha256 (v6.2 启用)
```

```typescript
// Edge Function contract 扩展点（v6.1 占位 stub）
// supabase/functions/list-presets/index.ts
// 已有 filter: tenant_id + is_public
// v6.1 扩展: filter: hub_origin in ('local', 'hub:*')  // stub
// v6.2 启用: hub_origin = 'hub:<org_id>'
```

### 4.4 v6.2 时间线（候选）

```
2027-Q2 (Apr-Jun):
  W1-W2:   preset-hub 中央仓库 + CDN 搭建
  W3-W4:   版本管理 + semver 校验
  W5:      签名 + 完整性
  W6-W7:   多租户隔离 + config override
  W8-W9:   dsh runtime 集成
  W10-W11: 计费 + 审计
  W12:     E2E + evidence + GA-ready
```

**触发条件**（v6.2 启动前）：
- v6.1 App Center MVP 跑满 6 个月（用户反馈）
- v6.0 GA 后无重大架构变更
- 法务完成跨境数据合规审查
- 至少 1 个外部组织确认参与 pilot

---

## 5. 影响

### 5.1 v6.0 GA 影响

- ✅ 无阻塞（v6.0 GA 不包含 Marketplace）
- ✅ App Center MVP 已 ship 本地 preset 共享能力
- ⚠️ 用户跨组织 preset 共享需求 → 留 v6.2 解答

### 5.2 v6.1 影响

| 加项 | 工作量 |
|---|---|
| `mp_preset_hub` schema stub | 0.5w |
| `hub_origin` / `signature` / `checksum` columns | 0.5w |
| Edge Function contract 扩展（filter） | 1w |
| 可行性调研（preset-hub 选型 / CDN / 签名算法） | 2w（按 ADR-0063） |
| **总计** | **4w** |

### 5.3 v6.2 影响

- 12w 主工作量（按 §4.1）
- 必须前置：v6.1 stub + 6 个月 MVP 验证 + 法务审查

---

## 6. 风险

| 风险 | 等级 | 缓解 |
|---|---|---|
| **用户等不及 v6.2** | 🟡 中 | App Center MVP + 私有 hub（git repo）短期顶替 |
| **跨境数据合规** | 🟠 中 | v6.2 启动前完成法务审查 + preset 数据脱敏 |
| **CDN 选型不当** | 🟡 低 | v6.1 可行性调研覆盖 CDN 选型 |
| **签名算法陈旧** | 🟢 低 | 选 Ed25519 + sigstore 标准 |
| **dsh session schema 兼容性** | 🟡 中 | v6.2 启动前冻结 dsh session schema v1 |

---

## 7. 不做（明确反对）

| 不做 | 原因 |
|---|---|
| ❌ v6.0 强行塞 Marketplace | 12w 破坏 GA 时点 |
| ❌ v6.1 实施完整 Marketplace | 时间窗已满 + 业务未证明 |
| ❌ 用 SaaS marketplace 替代 | vendor lock-in，与 ADR-0063 一致 |
| ❌ 跳过 v6.1 扩展点 | 锁死 v6.2 实施空间 |
| ❌ 在合规审查通过前启动 v6.2 | 法律风险 |

---

## 8. 替代方案（已否决）

### 方案 A：v6.1 实施完整 Marketplace（12w）

- ❌ 时间窗冲突（v6.1 已满 30w）
- ❌ 业务未证明
- ❌ 风险递延不足

### 方案 B：用 SaaS marketplace 顶替

- ❌ vendor lock-in
- ❌ 数据出境合规风险
- ❌ 与 ADR-0063 决策冲突

### 方案 C：完全砍掉 Marketplace

- ❌ preset 跨组织共享需求客观存在
- ❌ 长期影响 dsh 生态扩展

### 方案 D（已选）：推迟 v6.2 + v6.1 扩展点

- ✅ v6.0 GA 时点不破坏
- ✅ v6.1 4w 占位 + 调研
- ✅ v6.2 12w 完整实施
- ✅ 业务验证窗口 6 个月

---

## 9. 关联文档

- **ADR-0063（v6.1 候选）**：[`docs/active/decisions/ADR-0063-v6.1-cloud-marketplace.md`](ADR-0063-v6.1-cloud-marketplace.md)
- **ADR-0067（v6.0 GA）**：[`docs/active/decisions/ADR-0067-v6.0-ga-and-retrospective.md`](ADR-0067-v6.0-ga-and-retrospective.md)
- **v6.1 路线图**：[`docs/active/v6.1-roadmap.md`](../v6.1-roadmap.md)
- **App Center MVP**：[`evidence/MP-V6.1-APP-CENTER-01-ACCEPTANCE.md`](../../../evidence/MP-V6.1-APP-CENTER-01-ACCEPTANCE.md)

---

## 10. 评审签字

| 角色 | 姓名 | 签字 | 日期 |
|---|---|---|---|
| 架构师 | | | |
| 后端 Lead | | | |
| SRE Lead | | | |
| PM | | | |
| 法务 | | | (v6.2 启动前必签) |

---

*ADR-0068：Cloud Marketplace 推迟 v6.2 (2027-Q2)。v6.1 仅做 4w 扩展点 + 可行性调研；v6.0 GA 不阻塞。保留自建 + 不引入 SaaS marketplace，与 ADR-0063 决策一致。*