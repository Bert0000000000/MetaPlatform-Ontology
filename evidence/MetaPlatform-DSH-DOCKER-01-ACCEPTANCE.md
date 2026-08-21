# MetaPlatform-DSH-DOCKER-01 - ACCEPTANCE (Skeleton Phase)

> **状态**：Skeleton Accepted
> **日期**：2026-08-20
> **关联 Batch**：[MetaPlatform-DSH-DOCKER-01.md](../batch/MetaPlatform-DSH-DOCKER-01.md)
> **关联 PRD**：dsh-image-spec.md

---

## 验收标准

- [x] 多阶段 Dockerfile (`docker/dsh/Dockerfile`):
  - [x] 基础镜像 `node:22.19-alpine`
  - [x] 阶段 1: deps (pnpm install --frozen-lockfile --prod)
  - [x] 阶段 2: build (pnpm run build)
  - [x] 阶段 3: runtime (tini + non-root uid 10001)
  - [x] `EXPOSE 3000 3001 3002` (web / scheduler / runtime)
  - [x] `HEALTHCHECK /health` endpoint
  - [x] `CMD ["pnpm", "dsh", "web", "--host", "0.0.0.0", "--port", "3000"]`
- [x] `.dockerignore` (排除 docs/ evidence/ k8s/ helm/ terraform/ 等)
- [x] GitHub Actions workflow (`.github/workflows/dsh-build.yml`):
  - [x] 触发条件: tag v* + main + workflow_dispatch
  - [x] Build + push 到 Harbor `mp` 项目
  - [x] trivy 扫描 (HIGH/CRITICAL 阻断)
  - [x] cosign 签名
  - [x] 镜像大小 ≤ 500MB 检查
- [x] 镜像标签策略: `mp/dsh-web:v6.0.0-<sha>` + latest

## 待用户在宿主机完成

- [ ] `docker build -t mp/dsh-web:v6.0.0-test -f docker/dsh/Dockerfile .`
- [ ] 镜像大小验证 (≤ 500MB)
- [ ] trivy 本地扫描 (`trivy image mp/dsh-web:v6.0.0-test`)
- [ ] Harbor 推送 (`docker push harbor.mp-platform.local/mp/dsh-web:v6.0.0-test`)
- [ ] K8s Deployment 部署 (引用本 Batch 产出的镜像)

## 已交付文件

- `docker/dsh/Dockerfile` (79 lines, 多阶段)
- `docker/dsh/.dockerignore`
- `.github/workflows/dsh-build.yml` (94 lines, 5 步骤)

## 下游依赖

- MetaPlatform-DSH-K8S-01 (Deployment + HPA + Service + Ingress)
- MetaPlatform-DSH-POSTGRES-BACKEND-01 (本仓库已含 skeleton 在 `packages/mp-dsh-postgres-backend/`)

---

*DSH-DOCKER-01 ACCEPTANCE (skeleton) — 2026-08-20*