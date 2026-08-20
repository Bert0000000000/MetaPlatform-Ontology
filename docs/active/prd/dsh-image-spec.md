# PRD：dsh-image-spec

> **模块**：dsh Docker 镜像 — 多阶段构建 + Harbor 推送
> **对应 Batch**：[MetaPlatform-DSH-DOCKER-01](../batch/MetaPlatform-DSH-DOCKER-01.md)
> **状态**：Draft v1.0（待架构组评审）
> **负责人**：AI 团队 + SRE
> **日期**：2026-08-20

---

## 1. 概述（What）

为 v6.0 数字员工平台 dsh 构建 **生产级 Docker 镜像**（多阶段构建），推送内部 Harbor，作为所有 dsh K8s 部署的统一基础镜像。覆盖：

- dsh-web（数字员工 Web UI）
- dsh-scheduler（dsh 后台调度）
- 后续 dsh-runtime / dsh-bundle 等

**本 PRD 不包含**：业务 dsh preset 配置（那是 mp-agent-team Batch 的事）。

## 2. 背景与目标（Why & Goals）

### 2.1 背景

- dsh 是 v6.0 AI 编排核心（决策 #2，见 [architecture spec §1](../specs/2026-08-19-mp-v6-architecture.md)）
- 必须从一开始就是**生产级**镜像：多阶段、非 root、tini、≤ 500MB
- v3.0 时期镜像体积 1.2GB、root 用户运行 → 安全漏洞频发
- v6.0 决策 #8（CLAUDE.md §3）：基础镜像 `node:22.19-alpine`，非 root + tini，≤ 500MB

### 2.2 目标

| # | 目标 | 度量 |
|---|---|---|
| G1 | 多阶段 Dockerfile（deps / build / runtime）| 3 阶段分明 |
| G2 | 镜像体积 ≤ 500MB | `docker images` 输出 |
| G3 | 非 root 运行 | `USER` 指令 + UID 1000+ |
| G4 | 包含 tini（PID 1 信号处理）| 进程列表 `tini` 在 PID 1 |
| G5 | trivy 扫描 0 High / Critical 漏洞 | CI 输出 |
| G6 | Harbor 推送 + cosign 签名（可选）| `cosign verify` 成功 |

## 3. 用户与场景

| Persona | 场景 |
|---|---|
| **AI 团队** | 本地 build → 验证 → push 到 Harbor → 在 K8s 部署 |
| **SRE** | 监控 Harbor 镜像扫描告警；镜像版本回滚 |
| **应用 Owner**（mp-agent-team 等）| 引用 dsh 镜像作为 base image |

## 4. 功能需求（Functional Requirements）

### 4.1 Dockerfile 多阶段

```dockerfile
# syntax=docker/dockerfile:1.7
# ============================================================
# Stage 1: deps — 安装所有依赖（含 devDeps）
# ============================================================
FROM node:22.19-alpine AS deps

# pnpm 10（与 ci.yml 一致）
RUN corepack enable && corepack prepare pnpm@10.0.0 --activate

WORKDIR /app

# 先复制 lockfile，单独一层缓存
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/*/package.json ./packages/

RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# ============================================================
# Stage 2: build — 编译 TS / 打包
# ============================================================
FROM node:22.19-alpine AS build

RUN corepack enable && corepack prepare pnpm@10.0.0 --activate

WORKDIR /app

COPY --from=deps /app/ ./
COPY . .

RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm run build

# 清理 dev 依赖
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

# ============================================================
# Stage 3: runtime — 运行时（最小化）
# ============================================================
FROM node:22.19-alpine AS runtime

# tini（PID 1 信号处理）
RUN apk add --no-cache tini=0.19.0-r1

# 非 root 用户（UID 10001）
RUN addgroup -g 10001 -S dsh && \
    adduser -u 10001 -S -G dsh -h /app -s /sbin/nologin dsh

WORKDIR /app

# 只复制运行时需要的产物
COPY --from=build --chown=dsh:dsh /app/package.json ./
COPY --from=build --chown=dsh:dsh /app/pnpm-lock.yaml ./
COPY --from=build --chown=dsh:dsh /app/node_modules ./node_modules
COPY --from=build --chown=dsh:dsh /app/packages ./packages
COPY --from=build --chown=dsh:dsh /app/dist ./dist

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://localhost:3000/health || exit 1

# 切到非 root
USER dsh

# 暴露端口
EXPOSE 3000

# tini 作为 PID 1
ENTRYPOINT ["/sbin/tini", "--"]

# 默认命令（可被覆盖）
CMD ["node", "dist/packages/web/server.js"]
```

### 4.2 `.dockerignore`

```
.git
.gitignore
.github
node_modules
dist
coverage
.vscode
.idea
*.log
.DS_Store
docs/active
evidence
README.md
CLAUDE.md
START.md
scripts/setup
.worktrees
**/*.test.ts
**/*.spec.ts
**/__snapshots__
**/.env
**/.env.*
```

### 4.3 镜像 tag 规范

| Tag 格式 | 用途 |
|---|---|
| `mp/dsh-web:v6.0.0-<git-sha>` | 不可变（推荐生产用）|
| `mp/dsh-web:v6.0.0` | 主版本（可被覆盖）|
| `mp/dsh-web:v6.0` | 次版本 |
| `mp/dsh-web:latest` | 最新构建（仅 dev 用）|

**生产必须用 SHA tag**（不可变 + 可回滚）。

### 4.4 GitHub Actions CI/CD

```yaml
# .github/workflows/dsh-build.yml
name: dsh-build

on:
  pull_request:
    paths:
      - 'packages/**'
      - 'Dockerfile'
      - '.dockerignore'
  push:
    tags:
      - 'v*'

env:
  HARBOR_REGISTRY: harbor.mp-platform.local
  HARBOR_PROJECT: mp
  IMAGE_NAME: dsh-web

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
    - uses: actions/checkout@v4

    - name: Set up QEMU
      uses: docker/setup-qemu-action@v3

    - name: Set up Docker Buildx
      uses: docker/setup-buildx-action@v3

    - name: Login to Harbor
      if: github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')
      uses: docker/login-action@v3
      with:
        registry: ${{ env.HARBOR_REGISTRY }}
        username: ${{ secrets.HARBOR_USERNAME }}
        password: ${{ secrets.HARBOR_PASSWORD }}

    - name: Extract version
      id: version
      run: |
        VERSION=${GITHUB_REF#refs/tags/v}
        SHA=${GITHUB_SHA::8}
        echo "VERSION=${VERSION}" >> $GITHUB_OUTPUT
        echo "SHA=${SHA}" >> $GITHUB_OUTPUT

    - name: Build (PR + tag)
      uses: docker/build-push-action@v5
      with:
        context: .
        file: ./Dockerfile
        push: ${{ github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v') }}
        tags: |
          mp/dsh-web:${{ steps.version.outputs.VERSION }}-${{ steps.version.outputs.SHA }}
          mp/dsh-web:${{ steps.version.outputs.VERSION }}
          mp/dsh-web:latest
        cache-from: type=gha
        cache-to: type=gha,mode=max
        provenance: true
        sbom: true

    - name: Trivy scan (PR)
      if: github.event_name == 'pull_request'
      uses: aquasecurity/trivy-action@master
      with:
        image-ref: mp/dsh-web:${{ steps.version.outputs.VERSION }}-${{ steps.version.outputs.SHA }}
        severity: 'HIGH,CRITICAL'
        exit-code: '1'
        ignore-unfixed: true

    - name: Trivy scan (tag, push)
      if: github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')
      uses: aquasecurity/trivy-action@master
      with:
        image-ref: mp/dsh-web:${{ steps.version.outputs.VERSION }}-${{ steps.version.outputs.SHA }}
        format: 'sarif'
        output: 'trivy-results.sarif'
        severity: 'HIGH,CRITICAL'

    - name: Upload Trivy scan results
      if: github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')
      uses: github/codeql-action/upload-sarif@v3
      with:
        sarif_file: 'trivy-results.sarif'

    - name: Cosign sign (tag)
      if: github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')
      uses: sigstore/cosign-installer@v3

    - run: |
        cosign sign --yes \
          ${{ env.HARBOR_REGISTRY }}/${{ env.HARBOR_PROJECT }}/${{ env.IMAGE_NAME }}:${{ steps.version.outputs.VERSION }}-${{ steps.version.outputs.SHA }} \
          --key env:COSIGN_PRIVATE_KEY \
          --rekor-url https://rekor.mp-platform.local
      env:
        COSIGN_PRIVATE_KEY: ${{ secrets.COSIGN_PRIVATE_KEY }}
        COSIGN_PASSWORD: ${{ secrets.COSIGN_PASSWORD }}
```

### 4.5 Harbor 项目配置

```yaml
# Harbor API 创建项目
project_name: mp
public: false
storage_quota: 500Gi
content_trust_enabled: true       # 强制镜像签名
vulnerability_scanning: true
severity: high                    # High / Critical 漏洞阻断 push
prevent_vulnerable_images_from_running: true
automatically_scan_images_on_push: true
```

### 4.6 `.dockerignore` 与 `Dockerfile` 协同

- `.dockerignore` 必须排除 `node_modules`、`dist`、`coverage`、`.git`、所有 `.md` 文档
- 减小 build context 体积（< 5MB）
- 必须排除 `.env*`（避免 secret 进镜像）

### 4.7 健康检查

每个镜像必须暴露 `/health` 端点：

```typescript
// packages/web/src/health.ts
import express from 'express';
const router = express.Router();
router.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});
router.get('/ready', async (_req, res) => {
  // 检查 DB / 外部依赖
  try {
    await checkDependencies();
    res.json({ ready: true });
  } catch (err) {
    res.status(503).json({ ready: false, error: (err as Error).message });
  }
});
export default router;
```

## 5. 非功能需求

| 维度 | 要求 |
|---|---|
| **体积** | ≤ 500MB |
| **安全** | 非 root + tini + 0 High/Critical 漏洞 |
| **可复现** | 同 SHA tag 多次 build 结果一致（provenance） |
| **可回滚** | SHA tag 不可变；Helm values 可指定历史版本 |
| **可观测** | 镜像版本自动上报 Prometheus（kubelet cadvisor）|
| **签名** | cosign 签名（v6.0 可选，v6.1 强制）|
| **SBOM** | 自动生成 CycloneDX SBOM |

## 6. 接口契约

### 6.1 镜像命名

```
<HARBOR_REGISTRY>/<HARBOR_PROJECT>/<IMAGE_NAME>:<TAG>
```

例：`harbor.mp-platform.local/mp/dsh-web:v6.0.0-a1b2c3d4`

### 6.2 端口约定

| 镜像 | 默认端口 |
|---|---|
| dsh-web | 3000 |
| dsh-scheduler | 3001 |
| dsh-runtime | 3002 |

### 6.3 环境变量

```
PORT=<port>
NODE_ENV=production
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector.mp-monitoring:4318
SUPABASE_URL=<from-vault>
SUPABASE_ANON_KEY=<from-vault>
DSH_SESSION_BACKEND=postgres
DSH_PG_URL=<from-vault>
DSH_CONFIG_PATH=/app/config
```

## 7. 验收标准（AC）

| # | 标准 | 验证方式 |
|---|---|---|
| AC1 | `Dockerfile` 多阶段构建成功（3 阶段） | `docker build --target runtime` |
| AC2 | 镜像体积 ≤ 500MB | `docker images` 输出 |
| AC3 | 非 root + tini PID 1 | `docker run --rm <image> ps aux` |
| AC4 | trivy 扫描 0 High / Critical | CI 输出 |
| AC5 | PR 触发 build + scan 通过 | GitHub Actions run |
| AC6 | tag 触发 build + push + sign | GitHub Actions run |
| AC7 | 镜像推送到 Harbor 项目 `mp` | `harbor.mp-platform.local/mp/dsh-web` 可见 |
| AC8 | 镜像能在 K8s 跑（`pnpm dsh web`）| kubectl apply + 服务可达 |
| AC9 | evidence/MetaPlatform-DSH-DOCKER-01-ACCEPTANCE.md 完成 | 文件存在 |

## 8. 依赖

| 依赖 | 来源 | 时序 |
|---|---|---|
| Harbor | MetaPlatform-FOUNDATION-01（外部依赖）| 必须先 |
| GitHub Secrets：HARBOR_USERNAME / HARBOR_PASSWORD / COSIGN_PRIVATE_KEY | START.md Step 3 | 必须先 |
| dsh 源码 | `deepseek-ai/deepseek-harness` | 必须 |
| Node 22.19+ | 基础工具 | 必须 |
| OTel Collector | [otel-collector-config](otel-collector-config.md) | 弱依赖 |

## 9. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 镜像体积超 500MB | K8s 拉取慢 | 多阶段 + alpine + 生产 deps only |
| 漏洞扫描失败（High / Critical） | push 阻断 → release 卡住 | 锁版本 + 定期 rebuild + Dependabot |
| Harbor 不可用 | push 失败 | 备选 Docker Hub / GHCR（仅应急）|
| 非 root 用户写入权限 | 应用起不来 | K8s 中用 emptyDir / PVC，避免写主机 |
| base image 漏洞 | 整个镜像链继承 | 月度 rebuild + trivy 自动告警 |

## 10. 不做（Out of Scope）

- ❌ **distroless 镜像**：v6.0 用 alpine，distroless v6.1 评估
- ❌ **多架构（arm64 / amd64）**：v6.0 仅 amd64，arm64 v6.1 评估
- ❌ **镜像签名强制（v6.0）**：v6.0 cosign 可选，v6.1 强制
- ❌ **业务 preset 镜像**：mp-agent-team Batch 自管
- ❌ **多 registry 同步**：v6.0 仅 Harbor

---

*PRD v1.0 — 配套 [foundation-k8s-clusters](foundation-k8s-clusters.md) / [otel-collector-config](otel-collector-config.md) / [foundation-networkpolicy](foundation-networkpolicy.md)*