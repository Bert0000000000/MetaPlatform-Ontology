# OTel Collector 数据流

> 应用 → OTel Collector → 存储后端 → Grafana

```mermaid
flowchart LR
    subgraph Apps["应用 Pod（多 namespace）"]
        App1[mp-runtime]
        App2[mp-agent-team]
        App3[mp-workflow]
        App4[其他应用]
    end

    subgraph Sidecar["OTel SDK<br/>(每个 Pod sidecar 或 env)"]
        Traces1["OTLP traces"]
        Metrics1["OTLP metrics"]
        Logs1["OTLP logs"]
    end

    subgraph Collector["OTel Collector<br/>(mp-monitoring)"]
        Recv[OTLP Receiver<br/>:4317/:4318]
        Proc["Processors:<br/>k8sattributes<br/>batch<br/>tail_sampling<br/>memory_limiter"]
        Exp1[Exporter: Tempo]
        Exp2[Exporter: Prometheus]
        Exp3[Exporter: Loki]
    end

    subgraph Storage["存储后端"]
        Tempo["Tempo<br/>(trace)"]
        Prom["Prometheus<br/>(metric)"]
        Loki["Loki<br/>(log)"]
    end

    subgraph Viz["可视化"]
        Grafana["Grafana"]
        Alerts["Alertmanager<br/>→ Slack / PagerDuty"]
    end

    Apps --> Sidecar
    Sidecar --> Recv
    Recv --> Proc
    Proc --> Exp1
    Proc --> Exp2
    Proc --> Exp3
    Exp1 --> Tempo
    Exp2 --> Prom
    Exp3 --> Loki
    Tempo --> Grafana
    Prom --> Grafana
    Loki --> Grafana
    Prom --> Alerts

    classDef storage fill:#ffe9cc,stroke:#cc6600
    classDef collector fill:#cce5ff,stroke:#0066cc
    class Tempo,Prom,Loki storage
    class Recv,Proc,Exp1,Exp2,Exp3 collector
```

## 关键点

1. **OTel SDK 自动注入**（通过 env 或 sidecar）
2. **OTel Collector 集中处理**：k8s attributes 注入 / 批量发送 / 采样
3. **三路输出**：trace → Tempo / metric → Prometheus / log → Loki
4. **Grafana 统一面板**（查询 3 个数据源）
5. **告警走 Alertmanager** → Slack / 钉钉 / PagerDuty

## 采样策略（生产）

| Trace 类型 | 采样率 |
|---|---|
| 错误 | 100% |
| P99 延迟 > 3s | 100% |
| 正常请求 | 10% |