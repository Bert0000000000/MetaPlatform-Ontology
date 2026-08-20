# PRD：deploy-gitops

> **模块**：ArgoCD GitOps 收口 + Image Updater
> **对应 Batch**：[MP-V6-DEPLOY-01](../batch/MP-V6-DEPLOY-01.md)
> **状态**：Draft v1.0
> **负责人**：SRE
> **日期**：2026-08-20

---

## 1. 概述（What）

把所有 Batch 产出的 Helm chart 通过 ArgoCD GitOps 自动部署到 3 套集群（dev/staging/prod），Image Updater 自动滚动镜像。

## 2. 背景与目标

### 2.1 背景

- v3.0 手工 helm install + kubectl apply，治理债高
- v6.0 切到 ArgoCD GitOps（决策 #21，spec §1.1）
- Image Updater 自动化版本滚动

### 2.2 目标

| # | 目标 |
|---|---|
| G1 | ArgoCD ApplicationSet 覆盖 3 集群 |
| G2 | mp-umbrella chart GitOps 自动同步 |
| G3 | Image Updater 自动滚动 |
| G4 | 端到端: push code → CI build → ArgoCD deploy |

## 3. 用户与场景

| Persona | 场景 |
|---|---|
| 开发者 | merge PR → CI build → 自动部署 dev |
| SRE | 监控 ArgoCD sync status + 健康 |
| PM | 看 staging 部署进度 |

## 4. 功能需求

### 4.1 ArgoCD ApplicationSet

```yaml
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: mp-platform
spec:
  goTemplate: true
  generators:
    - list:
        elements:
          - cluster: dev
              url: https://kubernetes.default.svc
              namespace: mp-platform
          - cluster: staging
              url: https://kubernetes.default.svc
              namespace: mp-platform
          - cluster: prod
              url: https://kubernetes.default.svc
              namespace: mp-platform
  template:
    metadata: { name: 'mp-{{.cluster}}' }
    spec:
      project: mp-platform
      source:
        repoURL: https://github.com/Bert0000000000/MetaPlatform-Ontology
        targetRevision: main
        path: helm/mp-umbrella
        helm:
          valueFiles: ['values-{{.cluster}}.yaml']
      destination: { server: '{{.url}}', namespace: '{{.namespace}}' }
      syncPolicy:
        automated: { prune: true, selfHeal: true }
```

### 4.2 App-of-Apps

```yaml
# App-of-Apps 模式: 一个父 Application 部署多个子 Application
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata: { name: mp-platform-apps }
spec:
  source:
    repoURL: ...
    path: argocd/apps/  # 子 Application 定义目录
```

### 4.3 Image Updater

```yaml
# argocd-image-updater config
registries:
  - name: harbor
    apiURL: https://harbor.mp-platform.local
    insecure: true
    credentials: secret:argocd-image-updater/harbor-creds

policies:
  - name: mp-platform
    imagepatterns:
      - harbor.mp-platform.local/mp/*:v6.0.0-*
    update: latest

applications:
  - name: mp-platform-{cluster}
    namespace: argocd
    label: mp.update-policy=mp-platform
```

## 5. 非功能需求

| 维度 | 要求 |
|---|---|
| 自动同步 | < 5min (push → deployed) |
| 健康检查 | ArgoCD health probe 完整 |
| 失败回滚 | ArgoCD 自动 rollback on health failed |

## 6. 接口契约

### 6.1 ArgoCD Webhook 接收

CI build 完成 → 触发 ArgoCD refresh (webhook + Annotation)

## 7. 验收标准

| # | 标准 | 验证 |
|---|---|---|
| AC1 | 3 集群 ApplicationSet | `kubectl get applicationsets` |
| AC2 | umbrella chart 自动同步 | `kubectl get applications` |
| AC3 | Image Updater 滚动 | 测试镜像 tag 更新 |
| AC4 | 端到端 deploy | staging 演练 |
| AC5 | evidence 完成 | 文件存在 |

## 8. 依赖

| 依赖 | 来源 |
|---|---|
| umbrella chart | MP-V6-FOUNDATION-01 ✅ |
| ArgoCD | MP-V6-FOUNDATION-01 ✅ |
| Harbor | MP-V6-FOUNDATION-01 ✅ |

## 9. 风险

| 风险 | 缓解 |
|---|---|
| 自动同步导致生产事故 | sync window + manual approve for prod |
| Image tag 漂移 | pin SHA + Image Updater 策略 |
| 集群 drift | selfHeal + prunePropagationPolicy |

## 10. 不做

- ❌ FluxCD（用 ArgoCD）
- ❌ 多 Argo 实例（v6.0 单 Argo 中心）
- ❌ GitOps for 数据库 migration（仍走 supabase db push）

---

*PRD v1.0 — 配套 [MP-V6-DEPLOY-01 Batch](../batch/MP-V6-DEPLOY-01.md)*