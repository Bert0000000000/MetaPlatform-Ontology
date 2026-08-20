# PRD：mp-frontend（前端壳）

> **应用**：mp-frontend — Web 前端入口壳
> **类别**：1. 平台核心
> **对应 namespace**：mp-frontend
> **状态**：Draft v1.0
> **日期**：2026-08-20

## 1. 概述

`mp-frontend` 是 v6.0 唯一的 Web 入口壳。基于 **Semi Design** + React 18 + TypeScript + Vite，作为所有业务应用（mp-platform、mp-monitoring 等）的容器，通过模块联邦（Module Federation）按需加载子应用，避免大单体。

## 2. 核心功能

- 用户登录 / 注册 / 找回密码（Supabase Auth）
- 多租户切换（顶部 tenant selector）
- 模块联邦加载子应用（动态 import）
- 通用布局：顶部 nav / 侧边栏 / 内容区 / 状态栏
- 主题切换（亮 / 暗）
- 国际化（zh-CN / en-US）
- OTel SDK 自动接入

## 3. 关键接口

```typescript
// 子应用注册
interface MicroApp {
  name: string;
  entry: string;             // https://xxx.mp-platform.local/...
  activeWhen: (pathname: string) => boolean;
  props?: Record<string, unknown>;
}

// 用户菜单
interface NavItem {
  key: string;
  label: string;
  icon?: string;
  path?: string;
  children?: NavItem[];
}
```

## 4. 数据模型

```typescript
// 用户 session（Supabase JWT）
interface UserSession {
  user_id: string;
  email: string;
  tenant_id: string;
  role: 'owner' | 'admin' | 'member' | 'guest';
  exp: number;
}

// 菜单（从 mp-platform 拉取）
interface MenuResponse {
  items: NavItem[];
}
```

## 5. 部署

- 镜像：`harbor.mp-platform.local/mp/frontend:v6.0.0-<sha>`
- 资源：CPU 200m / Memory 256Mi（极轻量）
- 副本：prod 3 / staging 2 / dev 1
- ingress：`*.mp-platform.local` 通配证书
- CDN：静态资源走 CDN（vite build 产物）

## 6. 验收标准（AC）

| # | 标准 |
|---|---|
| AC1 | 登录 / 登出 / 找回密码流程跑通 |
| AC2 | 多租户切换生效（URL 参数 `?tenant=` + UI 选择器）|
| AC3 | 模块联邦：mp-platform 子应用按需加载（首屏 < 3s）|
| AC4 | 暗色 / 亮色主题切换无闪烁 |
| AC5 | 中英文切换无错位 |
| AC6 | OTel trace 上报到 OBSERVABILITY-01 |
| AC7 | Lighthouse Performance ≥ 90 |

## 7. 依赖

| 依赖 | 来源 |
|---|---|
| Supabase Auth | MetaPlatform-FOUNDATION-01 |
| Semi Design | v6.0 决策（直接用）|
| 模块联邦 runtime | 自研 |

## 8. 不做

- ❌ 自研 design system（直接用 Semi）
- ❌ 服务端渲染（v6.0 仅 CSR）
- ❌ 移动端原生 App（v6.0 仅响应式 Web）
- ❌ 微前端沙箱隔离（用浏览器原生 iframe）

---

*PRD v1.0 — 配套 [foundation-networkpolicy](foundation-networkpolicy.md) / [otel-collector-config](otel-collector-config.md)*