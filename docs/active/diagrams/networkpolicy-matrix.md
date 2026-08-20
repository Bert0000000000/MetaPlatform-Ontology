# NetworkPolicy Namespace 矩阵

> 跨 namespace 通信白名单

```mermaid
graph LR
    subgraph NS["10 个 Namespace"]
        N1[mp-platform]
        N2[mp-runtime]
        N3[mp-ai]
        N4[mp-orchestration]
        N5[mp-data]
        N6[mp-monitoring]
        N7[mp-business]
        N8[mp-frontend]
        N9[mp-integration]
        N10[mp-infra]
    end

    N8 -->|3000| N1
    N2 -->|5432,6543| N5
    N2 -->|3000| N5
    N2 -->|4000| N5
    N2 -->|54321| N5
    N4 -->|5432| N5
    N3 -->|5432| N5
    N3 -->|8000| N5
    N6 -->|9090,4317,4318| N1
    N6 -->|9090,4317,4318| N2
    N6 -->|9090,4317,4318| N3
    N6 -->|9090,4317,4318| N4
    N6 -->|9090,4317,4318| N5
    N6 -->|9090,4317,4318| N7
    N6 -->|9090,4317,4318| N8
    N6 -->|9090,4317,4318| N9
    N10 -->|8200| N1
    N10 -->|8200| N2
    N10 -->|8200| N3
    N10 -->|8200| N4
    N10 -->|8200| N5
    N10 -->|8200| N6
    N10 -->|8200| N7
    N10 -->|8200| N8
    N10 -->|8200| N9
    N7 -->|443| Internet[(公网白名单)]

    classDef ns fill:#e7f3ff,stroke:#0066cc
    class N1,N2,N3,N4,N5,N6,N7,N8,N9,N10 ns
```

## Default-Deny

每个 namespace 默认：
- **Ingress**：拒绝所有（除显式 allow）
- **Egress**：拒绝所有（除显式 allow）

所有图中的边 = 显式 allow policy。

## 关键路径

| 路径 | 用途 |
|---|---|
| mp-frontend → mp-platform | 前端 API 调用 |
| mp-runtime → mp-data | 业务应用访问 Supabase |
| mp-orchestration → mp-data | Temporal 持久化 |
| mp-ai → mp-data | embedding / RAG 写入 |
| mp-monitoring → * | 抓取所有 namespace 的 metrics |
| mp-infra → * | Vault agent 同步 |