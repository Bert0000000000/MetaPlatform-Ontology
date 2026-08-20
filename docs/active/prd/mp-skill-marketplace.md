# PRD：mp-skill-marketplace（数字员工市场）

> **应用**：mp-skill-marketplace — 数字员工 / Skill / Tool 市场
> **类别**：3. 数字员工
> **对应 namespace**：mp-runtime
> **状态**：Draft v1.0
> **日期**：2026-08-20

## 1. 概述

`mp-skill-marketplace` 是 v6.0 数字员工生态的**应用市场**：让开发者发布可复用的数字员工 preset / Skill / Tool，业务用户一键安装到自己的数字员工。

## 2. 核心功能

- 数字员工 preset 发布 / 安装 / 升级
- Skill 发布 / 安装（dsh `skill` 包）
- Tool 发布 / 安装（dsh `tools`）
- 版本管理（semver）
- 评分 / 评论
- 私有 / 公开（企业市场）
- 数字员工试用（沙箱执行）

## 3. 关键接口

```typescript
// 列出可安装的数字员工
GET /v1/marketplace/presets?category=customer-service&sort=popular

// 安装数字员工
POST /v1/marketplace/presets/:id/install
{ "tenant_id": "...", "config": {...} }

// 升级
POST /v1/marketplace/presets/:id/upgrade

// 发布（开发者）
POST /v1/marketplace/presets
{
  "name": "my-preset",
  "version": "1.0.0",
  "category": "customer-service",
  "manifest": {...},            // preset 定义
  "files": [...]                // 附件 / 图标
}
```

## 4. 数据模型

```sql
CREATE TABLE mp_skill_marketplace.presets (
    id           uuid PRIMARY KEY,
    tenant_id    uuid,                              -- NULL = 公开市场
    author_id    uuid NOT NULL,
    name         text NOT NULL,
    version      text NOT NULL,
    category     text NOT NULL,
    manifest     jsonb NOT NULL,                    -- preset 配置
    visibility   text NOT NULL DEFAULT 'private',  -- private / public
    downloads    int NOT NULL DEFAULT 0,
    rating_avg   numeric(3,2),
    created_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (name, version)
);

CREATE TABLE mp_skill_marketplace.installations (
    id           uuid PRIMARY KEY,
    preset_id    uuid NOT NULL REFERENCES mp_skill_marketplace.presets(id),
    tenant_id    uuid NOT NULL,
    installed_at timestamptz NOT NULL DEFAULT now(),
    config       jsonb NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE (preset_id, tenant_id)
);

CREATE TABLE mp_skill_marketplace.reviews (
    id           uuid PRIMARY KEY,
    preset_id    uuid NOT NULL,
    user_id      uuid NOT NULL,
    rating       int NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment      text,
    created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE mp_skill_marketplace.* ENABLE ROW LEVEL SECURITY;
```

## 5. 部署

- 镜像：`harbor.mp-platform.local/mp/skill-marketplace:v6.0.0-<sha>`
- 副本：HPA 2-10
- 资源：CPU 500m / Memory 512Mi
- 入口：`api.mp-platform.local/marketplace/v1`

## 6. 验收标准（AC）

| # | 标准 |
|---|---|
| AC1 | 浏览公开 preset 列表 + 详情 |
| AC2 | 一键安装到指定租户 |
| AC3 | 升级 preset |
| AC4 | 评分 + 评论 |
| AC5 | 私有 / 公开市场隔离 |
| AC6 | 数字员工试用（沙箱跑一遍）|

## 7. 依赖

| 依赖 | 来源 |
|---|---|
| [mp-agent-team](mp-agent-team.md) | 自家 |
| Supabase Storage（图标 / 附件）| MP-V6-FOUNDATION-01 |

## 8. 不做

- ❌ 付费交易 / 计费（v6.1 引入）
- ❌ 第三方支付集成（v6.0 不做）
- ❌ Skill 自动审核（v6.0 人工 review）
- ❌ 移动端（v6.0 仅 Web）

---

*PRD v1.0 — 配套 [mp-agent-team](mp-agent-team.md) / [mp-sandbox](mp-sandbox.md)*