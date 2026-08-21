# MetaPlatform-DEPLOY-01 — Helm chart + ArgoCD 收口

> **Batch 状态**：Pending Acceptance
> **优先级**：🔴 P3（收口）
> **工作量**：2 周
> **团队**：SRE
> **前置依赖**：所有 Batch 完成

---

## 1. 目标

把所有 Batch 产出的 Helm chart 打包成 umbrella chart（已部分完成在 FOUNDATION），通过 ArgoCD GitOps 部署到 3 套集群（dev/staging/prod）。

## 2. 配套文档

- 架构 spec：`docs/active/specs/2026-08-19-mp-v6-architecture.md` §11.3

## 3. 核心交付

| 项 | 验证 |
|---|---|
| `helm/mp-umbrella/Chart.yaml` (FOUNDATION 已创建) | `helm template` 渲染成功 |
| ArgoCD ApplicationSet 覆盖 3 集群 | `kubectl get applicationsets -n argocd` |
| ArgoCD Application per service | `kubectl get applications -n argocd` |
| Helm values-{dev,staging,prod}.yaml | 完整 |
| GitOps 自动同步 (prune + selfHeal) | ApplicationSet 配置 |
| ArgoCD Image Updater 自动滚动 | 配置就绪 |

## 4. 详细任务清单

### Week 1：Helm chart 完善
- [ ] mp-umbrella chart 汇总所有子 chart (FOUNDATION 准备)
- [ ] 补齐所有依赖 chart values
- [ ] 写完整的 values-{dev,staging,prod}.yaml
- [ ] helm template 验证 (kubeconform)
- [ ] umbrella chart 包打包测试 (helm package)

### Week 2：ArgoCD 收口
- [ ] ArgoCD ApplicationSet 模板
- [ ] 3 集群同步配置
- [ ] Image Updater 自动滚动
- [ ] 端到端: push code → CI build → ArgoCD 自动 deploy
- [ ] evidence/MetaPlatform-DEPLOY-01-ACCEPTANCE.md

## 5. 验收标准（AC）

- [ ] umbrella chart 完整
- [ ] 3 集群 ArgoCD 部署
- [ ] GitOps 自动同步
- [ ] Image Updater 工作
- [ ] 端到端 deploy 跑通
- [ ] evidence 完成

## 6. 风险与缓解

| 风险 | 缓解 |
|---|---|
| chart 升级 breaking | semver + ArgoCD sync wave |
| 多集群 drift | selfHeal + prunePropagationPolicy=foreground |
| Image tag 漂移 | pin SHA + Image Updater 自动化 |

---

*MetaPlatform-DEPLOY-01 — Sprint 3 部署收口*