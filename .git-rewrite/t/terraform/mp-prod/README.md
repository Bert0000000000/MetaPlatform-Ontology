# terraform/mp-prod/README.md
# PRD: docs/active/prd/foundation-k8s-clusters.md §4
# Terraform module 接口说明 (3 套 cluster 通用)

## 用法

```bash
cd terraform/mp-prod
tofu init
tofu plan -out tfplan
tofu apply tfplan
```

## 变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `cluster_name` | `mp-prod` | K8s cluster 名 |
| `cluster_version` | `1.31` | K8s 版本 (matches CLAUDE.md §11) |
| `node_pools` | system/data/runtime | 3 个节点池 |

## Module 依赖

- `modules/cluster-base/` — 实际 cluster 创建 (按云厂商选择不同实现)
- Helm release `mp_umbrella` — 应用 mp-umbrella chart

## 待用户在宿主机补充

实际生产部署需要：
1. 选云厂商（AWS EKS / 阿里云 ACK / 自建 kind / K3s）
2. 实现 `modules/cluster-base/` 的真实 IaC（参考云厂商 Terraform module）
3. 配置 backend（tfstate 存储）
4. 配置 kubeconfig 导出到 `~/.kube/config`

沙箱里没有 Terraform provider / 没有云账号，无法 apply。本配置仅作为模板参考。