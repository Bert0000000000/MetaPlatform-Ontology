#!/usr/bin/env bash
# mp-platform/web/scripts/dev.sh
# 启动 admin-api 后端 (port 8081, pg 直连) 和 Vite dev server (port 5173)
# 用法: bash scripts/dev.sh
# 停止: Ctrl-C (会同时 kill 两个进程)

set -euo pipefail

export PATH="$HOME/.npm-global/bin:$HOME/bin:${PATH:-}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Postgres 直连 (Supabase 本地默认)
export PGHOST="${PGHOST:-localhost}"
export PGPORT="${PGPORT:-54322}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
export PGDATABASE="${PGDATABASE:-postgres}"

# 启动 admin-api 后端
echo "▶ 启动 admin-api on http://127.0.0.1:8081"
node "$ROOT_DIR/scripts/admin-api.mjs" &
API_PID=$!

cleanup() {
  echo "▶ 关闭 admin-api (PID $API_PID)"
  kill "$API_PID" 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM

# 给 API 一点启动时间
sleep 1

# 启动 Vite (前台运行)
echo "▶ 启动 Vite on http://127.0.0.1:5173"
cd "$ROOT_DIR"
exec pnpm exec vite --host 127.0.0.1 --port 5173
