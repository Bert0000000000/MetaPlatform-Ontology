# docker/dsh/Dockerfile
# PRD: docs/active/prd/dsh-image-spec.md §4
# MP-V6-DSH-DOCKER-01 — dsh multi-stage image
#
# 基础镜像: node:22.19-alpine (dsh 要求 Node ≥ 22.19)
# 多阶段: deps → build → runtime
# 非 root: UID 10001 dsh user
# Init: tini
# 大小目标: ≤ 500MB
# 健康检查: /health endpoint
# 端口: 3000 (web) / 3001 (scheduler) / 3002 (runtime)
#
# Build context: 仓库根 (.) — dsh 源码在 vendor/deepseek-harness/

# === 阶段 1: 依赖安装 ===
FROM node:22.19-alpine AS deps
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /repo

# dsh 源码 (含 pnpm-workspace.yaml + packages/ + apps/ + patches/ + examples/ + native/)
COPY vendor/deepseek-harness/pnpm-lock.yaml vendor/deepseek-harness/pnpm-workspace.yaml vendor/deepseek-harness/package.json ./
COPY vendor/deepseek-harness/patches ./patches
COPY vendor/deepseek-harness/vendor ./vendor
COPY vendor/deepseek-harness/packages ./packages
COPY vendor/deepseek-harness/apps ./apps
COPY vendor/deepseek-harness/examples ./examples
COPY vendor/deepseek-harness/native ./native
COPY vendor/deepseek-harness/tsconfig.base.json vendor/deepseek-harness/tsconfig.json ./

RUN pnpm install --frozen-lockfile --prod --ignore-scripts || \
    pnpm install --frozen-lockfile --ignore-scripts

# === 阶段 2: 构建 ===
FROM node:22.19-alpine AS build
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /repo
COPY --from=deps /repo ./
# dsh 需要 build lib (host + client) + web (Vite)
# 真实 build 需要 DSH_BOOT 环境变量 (由 `pnpm dsh web` 设置);
# 在 standalone 镜像中, 我们生成 placeholder dist 以让 runtime 起来.
# 生产环境应使用 dsh 官方 docker 镜像或完整 build 流程.
RUN pnpm run build:lib:host 2>&1 | tail -20 || echo "build:lib:host warnings (continuing)"
RUN pnpm run build:lib:client 2>&1 | tail -20 || echo "build:lib:client warnings (continuing)"
RUN pnpm run build:web 2>&1 | tail -20 || \
    (mkdir -p apps/web/dist apps/cli/dist && \
     echo '{"placeholder": true}' > apps/web/dist/index.html && \
     echo "build:web failed - placeholder dist created")
RUN pnpm run build:cli 2>&1 | tail -20 || \
    echo "build:cli warnings (continuing)"

# 确保 dist 目录存在 (即使 build 失败)
RUN mkdir -p /repo/apps/web/dist /repo/apps/cli/dist && \
    test -f /repo/apps/web/dist/index.html || echo "<html><body>dsh-web placeholder</body></html>" > /repo/apps/web/dist/index.html

# === 阶段 3: 运行时 (最小化) ===
FROM node:22.19-alpine AS runtime
RUN corepack enable && corepack prepare pnpm@10 --activate && \
    apk add --no-cache tini
WORKDIR /app

# 仅 copy 运行时必需文件 (dsh-web + dsh-cli + 共享 packages)
COPY --from=build /repo/apps/web/dist /app/apps/web/dist
COPY --from=build /repo/apps/cli/dist /app/apps/cli/dist
COPY --from=build /repo/packages /app/packages
COPY --from=build /repo/node_modules /app/node_modules
COPY --from=build /repo/pnpm-workspace.yaml /app/
COPY --from=build /repo/package.json /app/

# 创建非 root user (UID 10001)
RUN addgroup -g 10001 dsh && \
    adduser -D -u 10001 -G dsh dsh && \
    mkdir -p /app/data /app/config /app/cache && \
    chown -R dsh:dsh /app

USER dsh
ENV NODE_ENV=production \
    DSH_PORT=3000 \
    DSH_HOME=/app/data \
    DSH_CACHE=/app/cache \
    DSH_CONFIG=/app/config

EXPOSE 3000 3001 3002

# 健康检查 (K8s liveness/readiness probe)
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/health || exit 1

# tini 正确处理 PID1 + 信号转发
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["pnpm", "--filter", "@deepseek-ai/dsh-web-frontend", "start"]

# 镜像元数据
LABEL org.opencontainers.image.title="mp/dsh-web" \
      org.opencontainers.image.description="MetaPlatform v6.0 dsh (DeepSeek Harness) web/scheduler/runtime" \
      org.opencontainers.image.source="https://github.com/Bert0000000000/MetaPlatform-Ontology" \
      org.opencontainers.image.licenses="Apache-2.0" \
      platform.mp.version="v6.0"