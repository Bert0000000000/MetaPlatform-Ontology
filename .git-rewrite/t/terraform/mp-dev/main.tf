# terraform/mp-dev/main.tf
# K8s cluster IaC — dev (kind 或 最小云集群)

terraform {
  required_version = ">= 1.9"

  backend "s3" {
    bucket = "mp-tfstate-dev"
    key    = "mp-v6/foundation/dev/terraform.tfstate"
    region = "cn-north-1"
    encrypt        = true
    dynamodb_table = "mp-tfstate-lock"
  }
}

variable "cluster_name" {
  default = "mp-dev"
}

variable "node_pools" {
  default = {
    # dev 推荐用 kind (本地), 所以 min = 0
    system  = { min = 0, max = 2, instance_type = "kind-local" }
    data    = { min = 0, max = 2, instance_type = "kind-local" }
    runtime = { min = 0, max = 4, instance_type = "kind-local" }
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

resource "helm_release" "mp_umbrella_dev" {
  name             = "mp"
  chart            = "../../helm/mp-umbrella"
  namespace        = "mp-infra"
  create_namespace = true
  values = [
    file("../../helm/mp-umbrella/values.yaml"),
  ]
  depends_on = [module.cluster]
}