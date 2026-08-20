# terraform/mp-staging/main.tf
# PRD: docs/active/prd/foundation-k8s-clusters.md §4
# K8s cluster IaC — staging (与 prod 同样 module, 资源更小)

terraform {
  required_version = ">= 1.9"

  backend "s3" {
    bucket = "mp-tfstate-staging"
    key    = "mp-v6/foundation/staging/terraform.tfstate"
    region = "cn-north-1"
    encrypt        = true
    dynamodb_table = "mp-tfstate-lock"
  }
}

variable "cluster_name" {
  default = "mp-staging"
}

variable "node_pools" {
  default = {
    system  = { min = 2, max = 4, instance_type = "m6i.large" }
    data    = { min = 2, max = 4, instance_type = "r6i.xlarge" }
    runtime = { min = 2, max = 6, instance_type = "c6i.xlarge" }
  }
}

module "cluster" {
  source          = "../mp-prod/modules/cluster-base"
  cluster_name    = var.cluster_name
  cluster_version = "1.31"
  node_pools      = var.node_pools
}

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
    file("../../helm/mp-umbrella/values.yaml"),  # staging 用 defaults
  ]
  depends_on = [module.cluster]
}

output "kubeconfig_path" {
  value     = module.cluster.kubeconfig_path
  sensitive = true
}