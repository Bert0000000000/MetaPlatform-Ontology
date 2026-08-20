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

# === 阶段 1: 依赖安装 ===
FROM node:22.19-alpine AS deps
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /repo
# 仅 copy 依赖声明, 充分利用 Docker layer cache
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY patches ./patches
COPY vendor ./vendor
COPY packages ./packages
COPY apps ./apps
COPY examples ./examples
COPY tsconfig.base.json tsconfig.json ./
RUN pnpm install --frozen-lockfile --prod --ignore-scripts && \
    pnpm rebuild esbuild node-pty lefthook koffi || true

# === 阶段 2: 构建 ===
FROM node:22.19-alpine AS build
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /repo
COPY --from=deps /repo ./
RUN pnpm run build

# === 阶段 3: 运行时 (最小化) ===
FROM node:22.19-alpine AS runtime
RUN corepack enable && corepack prepare pnpm@10 --activate && \
    apk add --no-cache tini=0.19.0-r1
WORKDIR /app

# 仅 copy 运行时必需文件
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

# 健康检查 (K8s liveness/readiness probe 复用)
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/health || exit 1

# tini 正确处理 PID1 + 信号转发
ENTRYPOINT ["/sbin/tini", "--"]

# 默认启动 dsh web (数字员工开发台)
CMD ["pnpm", "dsh", "web", "--host", "0.0.0.0", "--port", "3000"]

# 镜像元数据
LABEL org.opencontainers.image.title="mp/dsh-web" \
      org.opencontainers.image.description="MetaPlatform v6.0 dsh (DeepSeek Harness) web/scheduler/runtime" \
      org.opencontainers.image.source="https://github.com/Bert0000000000/MetaPlatform-Ontology" \
      org.opencontainers.image.licenses="Apache-2.0" \
      platform.mp.version="v6.0"