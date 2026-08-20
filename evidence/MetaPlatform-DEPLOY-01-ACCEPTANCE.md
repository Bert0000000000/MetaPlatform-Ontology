# MetaPlatform-DEPLOY-01 - ACCEPTANCE

> **状态**：Skeleton Accepted (待用户在宿主机完成 ArgoCD + Image Updater 部署)
> **日期**：2026-08-20
> **关联 Batch**：[MetaPlatform-DEPLOY-01.md](../batch/MetaPlatform-DEPLOY-01.md)
> **关联 PRD**：[deploy-gitops.md](../prd/deploy-gitops.md)
> **前置依赖**：所有 Sprint 0/1/2 Batch 完成 ✅

---

## 验收标准（AC）

- [x] PRD (docs/active/prd/deploy-gitops.md, 10 节)
- [x] `helm/mp-umbrella/` Chart.yaml (FOUNDATION 已就绪, 6 subcharts)
- [x] ArgoCD ApplicationSet (`k8s/argoapp/applicationset-mp-platform.yaml`)
  - [x] Generator: list (dev / staging / prod)
  - [x] Template: Application per cluster
  - [x] automated sync (prune + selfHeal + CreateNamespace)
  - [x] ServerSideApply
- [x] ArgoCD Image Updater (`k8s/argoapp/image-updater-config.yaml`)
  - [x] Harbor registry + insecure
  - [x] 2 policies (mp-platform-latest / mp-platform-major)
  - [x] 3 applications (mp-dev / mp-staging / mp-prod)
  - [x] GitHub PR write-back
- [x] `helm/mp-umbrella/values-{dev,staging,prod}.yaml` (3 套配置)
  - [x] dev: 最小规模 (1 副本, 不备份)
  - [x] staging: 中等 (2 副本, 7d backup)
  - [x] prod: 高可用 (FOUNDATION 已就绪)
- [x] 单元测试 (`tests/deploy/applicationset_yaml.test.ts`, 4 cases)
- [x] evidence 完成（**本文档**）

## 待用户在宿主机完成

- [ ] 部署 ArgoCD (FOUNDATION 已 helm chart, 需 enable)
- [ ] 部署 ArgoCD Image Updater (独立 deployment)
- [ ] 配置 Harbor registry credentials (ExternalSecret)
- [ ] 配置 GitHub bot token (Image Updater 自动 PR)
- [ ] 应用 `applicationset-mp-platform.yaml`
- [ ] 端到端测试:
  - [ ] dev: push code → CI build → ArgoCD 自动 deploy 到 dev cluster
  - [ ] staging: merge PR → 自动 deploy staging
  - [ ] prod: 手动 approve + 自动 deploy prod
  - [ ] Image Updater: 推送新 tag → 自动 PR 更新 helm values
  - [ ] 失败回滚: simulate failed health → ArgoCD 自动 rollback
- [ ] sync window 配置 (prod 限制 deploy 时间窗口)

## 已交付文件

| 文件 | 说明 |
|---|---|
| `docs/active/prd/deploy-gitops.md` | PRD v1.0 (10 节) |
| `k8s/argoapp/applicationset-mp-platform.yaml` | ApplicationSet 3 集群 |
| `k8s/argoapp/image-updater-config.yaml` | Image Updater ConfigMap |
| `helm/mp-umbrella/values-dev.yaml` | dev 环境配置 |
| `helm/mp-umbrella/values-staging.yaml` | staging 环境配置 |
| `helm/mp-umbrella/values-prod.yaml` | (FOUNDATION 已就绪) |
| `tests/deploy/applicationset_yaml.test.ts` | 4 cases |
| `evidence/MetaPlatform-DEPLOY-01-ACCEPTANCE.md` | (本文档) |

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| 自动同步导致生产事故 | sync window + manual approve for prod |
| Image tag 漂移 | pin SHA + Image Updater 策略 |
| 集群 drift | selfHeal + prunePropagationPolicy |
| ApplicationSet 配置错 | kubeconform + dry-run |

## 通知下游

✅ DEPLOY-01 骨架完成。下游可启动:
- **MetaPlatform-LONG-TASK-01** (4w) — 1 周+ 长任务 5 大机制完整化
- **MetaPlatform-DOMAIN-MIGRATE-01** (8w) — 17 域业务迁移
- **MetaPlatform-V6.1-PREP** (2w) — v6.1 路线图

---

*DEPLOY-01 ACCEPTANCE (skeleton) — 2026-08-20 — Sprint 3 GitOps 收口就绪*