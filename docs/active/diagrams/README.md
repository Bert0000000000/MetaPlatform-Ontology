# docs/active/diagrams/

> Mermaid 架构图目录。所有图都是 `.md` 格式，可在 GitHub 直接渲染。

## 索引

| 图 | 描述 | 配套 PRD |
|---|---|---|
| [overall-platform.md](./overall-platform.md) | v6.0 平台整体架构 | 全局 |
| [k8s-cluster-topology.md](./k8s-cluster-topology.md) | 3 套 K8s 集群 + 10 namespace 拓扑 | [foundation-k8s-clusters](../prd/foundation-k8s-clusters.md) |
| [supabase-rls-dataflow.md](./supabase-rls-dataflow.md) | Supabase + RLS 多租户数据流 | [foundation-rls-policy](../prd/foundation-rls-policy.md) |
| [temporal-dsh-flow.md](./temporal-dsh-flow.md) | Temporal + dsh + Supabase 数据流 | [temporal-cluster](../prd/temporal-cluster.md) |
| [otel-collector-dataflow.md](./otel-collector-dataflow.md) | OTel 数据采集 → 存储 → Grafana | [otel-collector-config](../prd/otel-collector-config.md) |
| [networkpolicy-matrix.md](./networkpolicy-matrix.md) | Namespace 间 NetworkPolicy 矩阵 | [foundation-networkpolicy](../prd/foundation-networkpolicy.md) |
| [etl-migration-sequence.md](./etl-migration-sequence.md) | v3 → v6 ETL + 切流量 | [etl-export-v3](../prd/etl-export-v3.md) |
| [hitl-decision-flow.md](./hitl-decision-flow.md) | HITL Hub 4 类决策流 | [mp-hitl-hub](../prd/mp-hitl-hub.md) |

## 渲染

GitHub / GitLab / Obsidian 都支持 Mermaid。VS Code 装 "Markdown Preview Mermaid Support" 扩展即可预览。

## 与其他文档的关系

- PRD / Runbook 中嵌入的 Mermaid 图保持小颗粒度（单组件内部）
- 本目录的图是**跨组件**的全局视图
- 更新原则：架构变更时同步更新