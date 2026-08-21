# PRD：foundation-k8s-clusters

> **模块**：MetaPlatform v6.0 基础设施层 — K8s 集群
> **对应 Batch**：[MetaPlatform-FOUNDATION-01](../batch/MetaPlatform-FOUNDATION-01.md)
> **状态**：Draft v1.0（待架构组评审）
> **负责人**：SRE
> **日期**：2026-08-20

---

## 1. 概述（What）

为 MetaPlatform v6.0 部署 **3 套 K8s 集群**（dev / staging / prod），作为承载 19 个应用、9 个 namespace、所有 Supabase 能力与 dsh / Temporal / OTel 工作负载的统一底座。

**3 套集群的目的**：环境隔离 + 渐进式交付。dev 给研发自助、staging 给集成测试与预发验证、prod 给生产流量。三套集群**配置严格一致**（版本 / CNI / CRD / 命名空间），仅资源配额与外部依赖差异。

## 2. 背景与目标（Why & Goals）

### 2.1 背景

- v3.0 时期只有 1 套 staging + 1 套 prod，dev 直接在 prod namespace 改 → 故障频发
- v6.0 必须一开始就强制分层（dev → staging → prod → 上线）
- 9 个 namespace（mp-platform / mp-frontend / mp-runtime / mp-business / mp-ai / mp-orchestration / mp-integration / mp-data / mp-monitoring）必须**在 3 套集群上保持一致**

### 2.2 目标（Goals）

| # | 目标 | 度量 |
|---|---|---|
| G1 | 3 套集群可独立部署、互不影响 | dev 故障不波及 staging/prod |
| G2 | 任意集群能在 30 分钟内重建（基础设施即代码） | terraform apply + helm install 完成 |
| G3 | 所有 Secret 不进 git | ExternalSecret 100% 覆盖，gitleaks 0 命中 |
| G4 | 所有 namespace 默认拒绝出入站 | NetworkPolicy default-deny 100% 覆盖 |
| G5 | 9 个 namespace 与 10 个 infra namespace 在 3 套集群上保持命名一致 | `kubectl get ns` 输出 diff = 0 |

## 3. 用户与场景（Personas & Use Cases）

| Persona | 场景 |
|---|---|
| **应用 Owner**（mp-* 团队） | 在 dev 集群自助部署 / 测试自己的服务；staging 验证集成；prod 申请变更 |
| **SRE** | 3 套集群的容量规划 / 升级 / 故障响应 / 灾备演练 |
| **架构组** | 评审 Helm chart / CRD / NetworkPolicy 的变更 |
| **外部依赖方** | 通过 ExternalSecret 从 Vault 拉取 Harbor / ArgoCD / Anthropic 等凭证 |

## 4. 功能需求（Functional Requirements）

### 4.1 集群拓扑

| 项 | dev | staging | prod |
|---|---|---|---|
| K8s 版本 | v1.31 | v1.31 | v1.31 |
| 节点数（最小） | 3 control-plane + 3 worker | 3 control-plane + 6 worker | 3 control-plane + 12 worker |
| CNI | Cilium | Cilium | Cilium |
| 入口控制器 | ingress-nginx | ingress-nginx | ingress-nginx |
| 证书 | cert-manager + Let's Encrypt staging | cert-manager + Let's Encrypt staging | cert-manager + Let's Encrypt prod |
| 资源配额 | 低（4 CPU / 8Gi / node） | 中（8 CPU / 16Gi / node） | 高（16 CPU / 32Gi / node） |
| 外部域名 | `*.mp-dev.local` | `*.mp-staging.local` | `*.mp-platform.local` |

### 4.2 必须安装的组件（每套集群）

| 组件 | 版本 | 用途 |
|---|---|---|
| cert-manager | v1.15+ | TLS 证书自动签发 |
| ArgoCD | v2.11+ | GitOps 部署 |
| ingress-nginx | v1.10+ | L7 入口 |
| ExternalSecrets Operator | v0.10+ | 从 Vault 同步 Secret |
| Velero | v1.14+ | 集群资源备份 |
| metrics-server | v0.7+ | HPA 必需 |

### 4.3 Namespace 清单（10 个，全部 3 套集群一致）

| Namespace | 用途 | 部署物举例 |
|---|---|---|
| `mp-infra` | cert-manager / argocd / external-secrets / vault-agent | 基础设施 |
| `mp-platform` | 平台核心（mp-frontend / mp-runtime / mp-platform） | 19 应用 |
| `mp-frontend` | 后续前端应用 | 后续 |
| `mp-runtime` | 后续 dsh runtime | 后续 |
| `mp-business` | 后续 Edge Functions | 后续 |
| `mp-ai` | 后续 AI 服务 | 后续 |
| `mp-orchestration` | 后续 Temporal | 后续 |
| `mp-integration` | 后续集成 | 后续 |
| `mp-data` | Supabase 全套 | Supabase Helm |
| `mp-monitoring` | OTel + Grafana | OTel Collector |

**约定**：
- 所有 namespace 必须打 label `app.kubernetes.io/managed-by=argocd` 与 `platform.mp/version=v6.0`
- namespace 名**永远不变**（即使里面没有 workload，命名空间保留）
- dev / staging 集群可允许 namespace 数量**少于** prod，但不能多

### 4.4 ResourceQuota 基线（每 namespace）

| Namespace | CPU request | Memory request | CPU limit | Memory limit | Pods |
|---|---|---|---|---|---|
| `mp-infra` | 2 | 4Gi | 4 | 8Gi | 30 |
| `mp-platform` | 8 | 16Gi | 16 | 32Gi | 100 |
| `mp-frontend` | 4 | 8Gi | 8 | 16Gi | 80 |
| `mp-runtime` | 8 | 16Gi | 16 | 32Gi | 100 |
| `mp-business` | 4 | 8Gi | 8 | 16Gi | 60 |
| `mp-ai` | 16 | 32Gi | 32 | 64Gi | 80 |
| `mp-orchestration` | 8 | 16Gi | 16 | 32Gi | 60 |
| `mp-integration` | 4 | 8Gi | 8 | 16Gi | 40 |
| `mp-data` | 16 | 32Gi | 32 | 64Gi | 60 |
| `mp-monitoring` | 4 | 8Gi | 8 | 16Gi | 40 |

### 4.5 Secret 管理

- **所有 Secret 必须走 ExternalSecret Operator + Vault**（k8s 内部不留任何明文）
- 7 个核心 Secret（per START.md Step 3）：`ANTHROPIC_API_KEY` / `HARBOR_USERNAME` / `HARBOR_PASSWORD` / `ARGOCD_SERVER` / `ARGOCD_USERNAME` / `ARGOCD_PASSWORD` / `SLACK_WEBHOOK_PROD`
- CI gate `secret-scan`（gitleaks）必须 0 命中

## 5. 非功能需求（Non-Functional Requirements）

| 维度 | 要求 |
|---|---|
| **可用性** | prod 集群 control-plane 99.95%（多 master + 负载均衡）|
| **可恢复性** | 单集群可在 30 分钟内从 IaC 完整重建 |
| **可观测** | 所有集群接入 OTel Collector（OBSERVABILITY-01 落地）；本 Batch 阶段仅需保证 metrics-server 可用 |
| **安全** | NetworkPolicy default-deny（详见 [PRD: foundation-networkpolicy](foundation-networkpolicy.md)）；RBAC 最小权限；Pod Security Standards = `restricted` |
| **变更审计** | 所有写操作（kubectl apply / helm install）必须走 ArgoCD / GitOps；本地直 apply 仅限 dev 集群 + 限 7×24 小时回滚窗口 |
| **成本** | dev 集群可非高峰时段自动缩容到 1 worker（夜间 / 周末） |

## 6. 接口契约（Interface Contracts）

### 6.1 Cluster API（IaC 入口）

```hcl
# terraform/cluster/<env>/main.tf 必须遵循的输入变量
variable "cluster_name"  { type = string }   # dev / staging / prod
variable "region"        { type = string }
variable "node_count"    { type = number }
variable "domain_suffix" { type = string }   # mp-dev.local / mp-staging.local / mp-platform.local
variable "vault_addr"    { type = string }   # https://vault.mp-platform.local
```

### 6.2 Helm umbrella chart

- 仓库：`helm/mp-umbrella`
- 子 chart：`cert-manager`、`argocd`、`external-secrets`、`ingress-nginx`、`metrics-server`、`velero`
- values 文件：`helm/mp-umbrella/values-<env>.yaml`

### 6.3 Cluster bootstrap 输出

- `terraform output kubeconfig_<env>` → 写入 `~/.kube/config-<env>`
- ArgoCD root app：`https://argocd.<env>.mp-platform.local/applications`

## 7. 验收标准（AC）

| # | 标准 | 验证方式 |
|---|---|---|
| AC1 | 3 套集群（dev / staging / prod）均 `kubectl get nodes` 成功 | 脚本 + 文档 |
| AC2 | 10 个 namespace 在 3 套集群上名称一致 | `kubectl get ns -l platform.mp/version=v6.0` 跨集群 diff = 0 |
| AC3 | 必装组件（cert-manager / ArgoCD / ingress / ESO / Velero / metrics-server）全部 Ready | `kubectl get pods -A` 全部 Running |
| AC4 | 7 个核心 Secret 走 ExternalSecret（k8s 内无明文）| `kubectl get secret` 显示 `type=external-secrets.io/...` |
| AC5 | `secret-scan` CI gate 0 命中 | GitHub Actions run 历史 |
| AC6 | NetworkPolicy default-deny 全部 namespace 生效（详见 [foundation-networkpolicy](foundation-networkpolicy.md)）| `kubectl get networkpolicy -A` |
| AC7 | ResourceQuota 在每个 namespace 已应用 | `kubectl get resourcequota -A` |
| AC8 | dev 集群可在 30 分钟内从 IaC 重建 | 演练 + 计时 |
| AC9 | evidence/MetaPlatform-FOUNDATION-01-ACCEPTANCE.md 落地且勾选完所有 AC | 文件存在 + AC checkbox |

## 8. 依赖（Dependencies）

| 依赖 | 来源 | 时序 |
|---|---|---|
| 域名 / DNS | 用户 | 启动前 |
| 至少 9 个 worker 节点的物理资源 | SRE | 启动前 |
| Vault 实例 | SRE | 启动前 |
| Harbor 实例 | 后续 Batch（DSH-DOCKER-01）| 本 Batch 不强制 |
| ArgoCD 自己 → ArgoCD 部署其他 App | 自依赖 | 第一周只装 ArgoCD，第二周开始 bootstrap 其他 |

## 9. 风险（Risks）

| 风险 | 影响 | 缓解 |
|---|---|---|
| cert-manager webhook 在 cilium 下启动慢 | 集群 init 失败 | helm install 失败重试 + 文档化 workaround |
| Velero 备份集群本身（避免循环备份）| 备份失效 | Velero 安装到独立 namespace，且只备份业务 namespace |
| dev 集群成本失控 | 费用超支 | 自动化定时缩容（cron HPA）+ 告警 |
| 9 个 namespace 命名约定被破坏 | 后续 ArgoCD App of Apps 失效 | admission webhook 强制 label |

## 10. 不做（Out of Scope）

- ❌ **集群联邦 / 多集群调度**（v6.0 各集群独立）
- ❌ **Service Mesh**（Istio / Linkerd）：v6.0 不引入，Cilium 满足需求
- ❌ **GPU 节点**（在 MetaPlatform-MIGRATION-01 后由 mp-sandbox Batch 处理）
- ❌ **Windows 节点**（v6.0 全 Linux 容器）
- ❌ **多 Region**：本 Batch 单 region；多 region 在 v7.0 讨论

---

*PRD v1.0 — 配套 [foundation-supabase-schema](foundation-supabase-schema.md) / [foundation-rls-policy](foundation-rls-policy.md) / [foundation-networkpolicy](foundation-networkpolicy.md) / [foundation-dr-backup](foundation-dr-backup.md)*