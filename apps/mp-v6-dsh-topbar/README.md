# MetaPlatform dsh Topbar Plugin

dsh-web (port 5173) 顶栏注入 4 个菜单:

| 菜单 | 跳转 |
|---|---|
| 云市场 | `http://localhost:8080/marketplace` (SPA-internal nav, 同 tab) |
| 应用中心 | `http://localhost:8080/marketplace` (SPA-internal nav, 同 tab) |
| Ontology 本体平台 | `http://localhost:8080/admin` (SPA-internal nav, 同 tab) |
| Ontology Copilot | 触发 `dsh:open-chat` CustomEvent + best-effort 点击 dsh chat 按钮 |

## 集成方式

**Patch-only** — 不修改 vendor 源码, 不修改 dsh 主代码, 只:
1. 在 `vendor/deepseek-harness/.dsh-data/profiles/web/cordis.patch.yml` 增加 1 行 `insert`
2. 相对路径指向本目录的 `host.mjs`
3. `host.mjs` 注册静态路由 + tap index.html, 注入 `<script defer src="/__mp_v6_topbar__/topbar.js">`
4. `topbar.js` 用 vanilla DOM prepend 一个 44px 高的 `<nav>`, 含 4 个 `<a>` (3 个 SPA-internal nav + 1 个 dsh:open-chat CustomEvent)

## 文件

| 文件 | 角色 |
|---|---|
| `host.mjs` | Cordis 主机端 plugin: 注册 `/__mp_v6_topbar__/topbar.js` 路由 + `webServer.tapIndex` 注入 `<script>` 标签 |
| `topbar.js` | 浏览器端 vanilla JS: DOM 注入顶栏, 0 React 依赖 |

## 路径

| 引用方 | 路径 |
|---|---|
| cordis.patch.yml (insert) | `../../../../../apps/mp-v6-dsh-topbar/host.mjs` (从 profile dir 反推回 repo root) |
| Browser | `/__mp_v6_topbar__/topbar.js` (被 host.mjs 注册) |

## 端到端验证

```sh
# 1. 启动 dsh-web (会自动装 patch)
DSH_DEEPSEEK_API_KEY=sk-xxx ./scripts/dev/dsh-web.sh

# 2. 浏览器打开 http://127.0.0.1:5173, 顶部出现:
#    [MetaPlatform]  云市场   应用中心   Ontology 本体平台   Ontology Copilot

# 3. Playwright (4-menu 版本)
DSH_BASE_URL=http://127.0.0.1:5173 npx playwright test --project=dsh-web-ui -g "internal"
```

## 重启

dsh-web 重启后会自动重新 tap index, 无需额外操作。Patch 文件是 HMR-watched
(`watchUserPatches`), 改完即生效。

## 设计取舍

| 选项 | 取舍 |
|---|---|
| A. shell.overlay slot | 需要完整的 dsh.client + package.json + node_modules 安装链路 |
| B. mp-marketplace native UI | mp-marketplace 还没全实现 (PRD v1.0) |
| **C. tapIndex + vanilla DOM (chosen)** | 4 行 patch, 0 编译, 0 依赖, 立刻跑 |

## 不做的事

- 不修改 `vendor/deepseek-harness/packages/*` (vendor source)
- 不修改 `vendor/deepseek-harness/apps/cli/*` (dsh CLI)
- 不引入 React 依赖
- 不动 dsh 默认 session / persona / model

## 未来

mp-marketplace UI 落地后, 把 `topbar.js` 里的 `href` 改成 `mp-marketplace` 自己的 SPA 路由,
不再跳 admin-server。详见 `docs/active/prd/mp-skill-marketplace.md`。