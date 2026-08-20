# K8s Cluster Topology（3 套 + 10 namespace）

> K8s 集群拓扑 + namespace 划分

```mermaid
graph TB
    subgraph Dev["dev 集群"]
        DevNS1["mp-infra"]
        DevNS2["mp-platform"]
        DevNS3["mp-data"]
        DevNS4["mp-runtime"]
        DevNS5["mp-monitoring"]
    end

    subgraph Staging["staging 集群"]
        StgNS1["mp-infra"]
        StgNS2["mp-platform"]
        StgNS3["mp-data"]
        StgNS4["mp-runtime"]
        StgNS5["mp-orchestration"]
        StgNS6["mp-monitoring"]
        StgNS7["mp-ai"]
        StgNS8["mp-frontend"]
        StgNS9["mp-business"]
        StgNS10["mp-integration"]
    end

    subgraph Prod["prod 集群"]
        ProdNS1["mp-infra"]
        ProdNS2["mp-platform"]
        ProdNS3["mp-data"]
        ProdNS4["mp-runtime"]
        ProdNS5["mp-orchestration"]
        ProdNS6["mp-monitoring"]
        ProdNS7["mp-ai"]
        ProdNS8["mp-frontend"]
        ProdNS9["mp-business"]
        ProdNS10["mp-integration"]
    end

    Dev -.副本|less replicas. Staging
    Staging -.副本|same config, more resources. Prod

    classDef env fill:#e7f3ff,stroke:#0066cc,stroke-width:3px
    class DefStaging,Prod,Dev env
```

## 命名空间清单（10 个）

| Namespace | 用途 | 资源配额 |
|---|---|---|
| | 平台总 | | 8 CPU / 16Gi |
| | 后续前端 | | 4 CPU / 8Gi |
| | 后续 dsh runtime | | 8 CPU / 16Gi |
| | 后续 Edge Functions | | 4 CPU / 8Gi |
| | 后续 AI | | 16 CPU / 32Gi |
| | 后续 Temporal | | 8 CPU / 16Gi |
| | 后续集成 | | 4 CPU / 8Gi |
| | Supabase | | 16 CPU / 32Gi |
| | OTel + Grafana | | 4 CPU / 8Gi |
| | cert-manager / argocd | | 2 CPU / 4Gi |