#!/usr/bin/env bash
# scripts/dev/dsh-web.sh — 启动 vendor/deepseek-harness 的 web profile，绑 5173
#
# 为什么有这个脚本:
#   dsh 的 loader 在 app-boot/src/index.ts 把 'DSH_' 列为 BOOTSTRAP_PREFIX,
#   所以任何 .env 里的 DSH_* 都被拒绝. 所有 DSH_* 必须从 shell export.
#   这个脚本是 "export 一切需要的 DSH_* → exec pnpm dsh web" 的合集.
#
# 用法:
#   必填: DSH_DEEPSEEK_API_KEY (命令行 inline 或 shell 里 export 一下)
#
#   DSH_DEEPSEEK_API_KEY=sk-xxx ./scripts/dev/dsh-web.sh
#
# 覆盖任何默认:
#   DSH_LLM_PROVIDER=openai DSH_DEEPSEEK_API_KEY=sk-xxx ./scripts/dev/dsh-web.sh
#
# 注意: DSH_PORT 由 'dsh web --port N' 决定,env 的 DSH_PORT 不会被读. 此脚本
#   跟 3080→5173 的兜底修改保持一致 (vendor/.../cordis.patch.yml:126).

set -euo pipefail

# 让脚本在不被 PATH 配过的 shell 里也能直接跑 (Git Bash 上 pnpm 在 .npm-global/bin)
export PATH="$HOME/.npm-global/bin:$HOME/bin:${PATH:-}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DSH_DIR="$ROOT_DIR/vendor/deepseek-harness"

if [[ ! -d "$DSH_DIR" ]]; then
  echo "❌ vendor/deepseek-harness 不存在: $DSH_DIR" >&2
  exit 1
fi

cd "$DSH_DIR"

# MP-V6 dsh-web topbar overlay: prepends 2 menu items (市场 + 后台管理) into
# the served dsh-web page. Path is relative to vendor/deepseek-harness (cwd
# after `cd "$DSH_DIR"` above). See apps/mp-v6-dsh-topbar/ for the plugin.
MP_V6_TOPBAR_PATCH="$DSH_DIR/../../apps/mp-v6-dsh-topbar/cordis.patch.yml"
MP_V6_TOPBAR_ARGS=()
if [[ -f "$MP_V6_TOPBAR_PATCH" ]]; then
  MP_V6_TOPBAR_ARGS=(--patch "$MP_V6_TOPBAR_PATCH")
else
  echo "⚠️  mp-v6-topbar patch 不存在: $MP_V6_TOPBAR_PATCH (顶栏不加载, 但 dsh 照常起)" >&2
fi

# -------- 必填项 --------
: "${DSH_DEEPSEEK_API_KEY:?Need DSH_DEEPSEEK_API_KEY in env. Get one at https://platform.deepseek.com → API Keys}"

# -------- 默认 export (任何调用前 export 的值都会覆盖这里的默认) --------

# dsh runtime
export DSH_HOME="${DSH_HOME:-$DSH_DIR/.dsh-data}"
export DSH_CACHE="${DSH_CACHE:-$DSH_DIR/.dsh-cache}"
export DSH_CONFIG="${DSH_CONFIG:-$DSH_DIR/.dsh-config}"

# Supabase local (来自 supabase status 的 dev keys, 都是公开 dev defaults, 不是 secrets)
export DSH_SUPABASE_URL="${DSH_SUPABASE_URL:-http://localhost:54321}"
export DSH_SUPABASE_KEY="${DSH_SUPABASE_KEY:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU}"
export DSH_SUPABASE_ANON_KEY="${DSH_SUPABASE_ANON_KEY:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0}"

# Postgres direct (Supabase 自带, 端口 54322)
export DSH_PG_HOST="${DSH_PG_HOST:-localhost}"
export DSH_PG_PORT="${DSH_PG_PORT:-54322}"
export DSH_PG_USER="${DSH_PG_USER:-postgres}"
export DSH_PG_PASSWORD="${DSH_PG_PASSWORD:-postgres}"
export DSH_PG_DATABASE="${DSH_PG_DATABASE:-postgres}"
export DSH_PG_SCHEMA="${DSH_PG_SCHEMA:-public}"

# LLM provider
export DSH_LLM_PROVIDER="${DSH_LLM_PROVIDER:-deepseek-primary}"
export DSH_DEEPSEEK_BASE_URL="${DSH_DEEPSEEK_BASE_URL:-https://api.deepseek.com/v1}"
export DSH_DEEPSEEK_MODEL="${DSH_DEEPSEEK_MODEL:-deepseek-chat}"

# Sandbox (Git Bash 上没 bwrap, 关掉)
export DSH_SANDBOX_TYPE="${DSH_SANDBOX_TYPE:-}"

# Digital employee presets
export DSH_PRESET_DEFAULT="${DSH_PRESET_DEFAULT:-knowledge-curator}"
export DSH_PRESETS_PATH="${DSH_PRESETS_PATH:-$ROOT_DIR/apps/dsh-presets}"

# Observability (本机 collector 没起, endpoint 注掉; 启 OTel 时 export DSH_OTEL_ENDPOINT 即可)
# export DSH_OTEL_ENDPOINT="http://localhost:4318"
export DSH_OTEL_SERVICE_NAME="${DSH_OTEL_SERVICE_NAME:-mp-dsh-web}"
export DSH_OTEL_SAMPLING="${DSH_OTEL_SAMPLING:-parentbased_traceidratio}"
export DSH_OTEL_SAMPLING_RATIO="${DSH_OTEL_SAMPLING_RATIO:-1.0}"

# Temporal (本机 cluster 没起, 注释掉; 需要时 export DSH_TEMPORAL_ADDRESS / DSH_TEMPORAL_NAMESPACE)
# export DSH_TEMPORAL_ADDRESS="localhost:7233"
# export DSH_TEMPORAL_NAMESPACE="mp-platform"

# Logging
export DSH_LOG_LEVEL="${DSH_LOG_LEVEL:-info}"
export DSH_LOG_FORMAT="${DSH_LOG_FORMAT:-json}"
export NODE_ENV="${NODE_ENV:-development}"

# Vendor 必须先 build:lib:host,apps/cli/lib/bin.js 才会存在 (pnpm dsh 才会指到 vendor 本体而非全局).
DSH_BIN="$DSH_DIR/apps/cli/lib/bin.js"
if [[ ! -f "$DSH_BIN" ]]; then
  echo "⚠️  vendor not built (missing $DSH_BIN). Running pnpm build:lib:host (1-3 min)..."
  (cd "$DSH_DIR" && pnpm build:lib:host) || {
    echo "❌ pnpm build:lib:host failed" >&2
    exit 1
  }
fi
if [[ ! -f "$DSH_BIN" ]]; then
  echo "❌ still missing $DSH_BIN after build" >&2
  exit 1
fi

echo "▶  vendor dsh (RC8) on port 5173"
echo "   cwd:  $DSH_DIR"
echo "   bin:  $DSH_BIN"
echo "   home: $DSH_HOME"
echo "   supabase: $DSH_SUPABASE_URL"
echo "   llm:    $DSH_LLM_PROVIDER ($DSH_DEEPSEEK_MODEL)"
echo
exec node "$DSH_BIN" web "${MP_V6_TOPBAR_ARGS[@]}" --port 5173 "$@"
