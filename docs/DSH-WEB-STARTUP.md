# MP-V6 dsh-web Startup Guide

> **目标**：本机启动 dsh-web（数字员工运行时 UI），连接 v6.0 Supabase local

## 0. 前置

```bash
# 本机已装 (per user)
node >= 22.19
pnpm >= 10
dsh (DeepSeek Harness) -- 自带 / 全局安装
```

## 1. 启动本机 v6.0 服务

```bash
cd D:/Hermes/Workspace/10_Projects/MetaPlatform-Ontology

# 1. 启动 Supabase (28 migrations + RLS)
supabase start --ignore-health-check

# 2. 启动 Temporal + Prometheus + Grafana + OTel
docker compose -f docker-compose.local.yml up -d temporal prometheus grafana otel-collector
```

## 2. 配置 dsh dev 环境

```bash
# 1. 复制 dev env 模板
cp dsh-dev.env vendor/deepseek-harness/.env

# 2. 编辑 .env, 填入 DEEPSEEK_API_KEY + Supabase keys (从 supabase status 复制)
code vendor/deepseek-harness/.env
# 或:
# DSH_SUPABASE_KEY=sb_secret_xxx (from supabase status output)
# DSH_SUPABASE_ANON_KEY=sb_publishable_xxx
# DSH_DEEPSEEK_API_KEY=sk-xxx
```

## 3. 启动 dsh-web

```bash
cd vendor/deepseek-harness

# 1. 装 deps (首次 ~5min, ~3GB)
pnpm install

# 2. 启动 dsh web UI (Deno runtime, 端口 5173)
DSH_PORT=5173 pnpm dsh web
```

输出:
```
🌐 dsh web listening on http://localhost:5173
🟢 Supabase connected: localhost:54321
🟢 Temporal connected: localhost:7233
🟢 3 presets loaded: support-triage, knowledge-curator, ontology-curator
🟢 LLM provider: deepseek-primary
```

## 4. 打开浏览器

```
http://localhost:5173
```

应看到 dsh-web 主界面，左侧导航 3 个数字员工 preset 卡片。

## 5. 跑 E2E 测试

新开 terminal：

```bash
cd D:/Hermes/Workspace/10_Projects/MetaPlatform-Ontology
pnpm exec playwright test --project=dsh-web-ui
```

5 个 dsh-web UI 测试：
1. homepage 加载 200 + title
2. /health 端点 200
3. `window.__DSH_BOOT__` 包含 LLM + sandbox + presets
4. presets 包含 3 个数字员工
5. Realtime WebSocket 连接到 Supabase

## 6. 测试数字员工

浏览器 → 点击 "knowledge-curator" → 输入问题：
- "MetaPlatform-Ontology 的 4 大支柱是什么？"
- 期望 RAG 检索到 4 支柱：Supabase / dsh / Temporal / OTel

## 7. 验证 v6.0 集成

测试后端事件链路：
```bash
# 浏览器 dsh-web → 发起一次对话 → 后端:
# 1. dsh → Supabase Realtime 写 audit_log
# 2. dsh → Temporal 启动 workflow (如果用 workflow preset)
# 3. dsh → LLM (DeepSeek API)
# 4. dsh → OTel 推 trace (Grafana Tempo 可查)
# 5. token_usage 写 dsh_token_usage 表
```

验证：
```bash
# 1. 查 audit_log
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  -c "SELECT action, table_name FROM audit_log ORDER BY occurred_at DESC LIMIT 5"

# 2. 查 token_usage
psql ... -c "SELECT provider, model, input_tokens, output_tokens FROM dsh_token_usage ORDER BY occurred_at DESC LIMIT 5"

# 3. Grafana Tempo
open http://localhost:3001 (admin/admin) → Explore → tempo
```

## 8. 故障排查

| 问题 | 解决 |
|---|---|
| `pnpm install` 超时 | `pnpm install --prefer-offline` 或 `--registry https://registry.npmmirror.com` |
| `pnpm dsh web` 报 "DSH_BOOT missing" | 设置 `DSH_PORT=5173` env 或用 `pnpm --filter @deepseek-ai/dsh-web-frontend dev` |
| Supabase 连接失败 | 检查 `.env` 里的 `DSH_SUPABASE_URL=http://localhost:54321` (Kong 不是 54322) |
| Realtime WS 连不上 | 浏览器 dev tools 看 `ws://localhost:4000/...` 状态 |
| LLM 调用失败 | 检查 `DSH_DEEPSEEK_API_KEY` 和网络 |
| 端口冲突 | 改 `DSH_PORT` (本机) / K8s 改 `service.port` |

## 9. 性能基准（参考）

参考 v6.0 架构 spec（specs/2026-08-19-mp-v6-architecture.md §7）:
- dsh-web LLM 流式延迟 < 200ms p50
- Supabase REST < 200ms p95
- Temporal workflow 启动 < 100ms p99
- Realtime 广播延迟 < 500ms p95

测试 100 次 dsh 对话，记录平均响应时间。

---

*dsh-web 启动指南 — 让 v6.0 平台真正跑起来*