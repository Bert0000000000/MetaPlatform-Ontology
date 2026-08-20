# terraform/mp-prod/main.tf
# PRD: docs/active/prd/foundation-k8s-clusters.md §4
# K8s cluster IaC — 生产环境 (示例)
#
# 此处仅给一个 module 骨架示例, 真实部署需要根据云厂商 (AWS / 阿里云 / 自建 kind) 选择 provider.
# 推荐: 用 OpenTofu / Terraform + Helm provider, 3 套 cluster 各一份配置.
#
# 部署步骤 (宿主机):
#   cd terraform/mp-prod
#   tofu init
#   tofu plan -out tfplan
#   tofu apply tfplan

terraform {
  required_version = ">= 1.9"

  required_providers {
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.30"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.13"
    }
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.50"  # 仅当用 AWS EKS
    }
  }

  backend "s3" {
    # 实际 bucket 由 CI / 运维注入
    bucket         = "mp-tfstate-prod"
    key            = "mp-v6/foundation/prod/terraform.tfstate"
    region         = "cn-north-1"
    encrypt        = true
    dynamodb_table = "mp-tfstate-lock"
  }
}

variable "cluster_name" {
  default     = "mp-prod"
  description = "K8s cluster name"
}

variable "cluster_version" {
  default     = "1.31"
  description = "K8s version (matches CLAUDE.md §11)"
}

variable "node_pools" {
  default = {
    system = { min = 3, max = 6, instance_type = "m6i.large" }
    data   = { min = 3, max = 10, instance_type = "r6i.2xlarge" }  # PG / Supabase
    runtime = { min = 5, max = 20, instance_type = "c6i.2xlarge" } # dsh runtime
  }
  description = "Per-pool node groups"
}

# 注: 真实 cluster 创建走云厂商 provider (aws / alicloud / kind).
# 这里只演示 module 接口 — 实际填入 EKS / ACK / kind 配置.

module "cluster" {
  source = "./modules/cluster-base"

  cluster_name    = var.cluster_name
  cluster_version = var.cluster_version
  node_pools      = var.node_pools
}

# Helm: mp-umbrella
provider "helm" {
  kubernetes {
    config_path = module.cluster.kubeconfig_path
  }
}

resource "helm_release" "mp_umbrella" {
  name             = "mp"
  chart            = "../../helm/mp-umbrella"
  namespace        = "mp-infra"
  create_namespace = true
  values = [
    file("../../helm/mp-umbrella/values-prod.yaml"),
  ]

  depends_on = [module.cluster]
}

# Output kubeconfig (供 CI / kubectl 使用)
output "kubeconfig_path" {
  value = module.cluster.kubeconfig_path
  sensitive = true
}