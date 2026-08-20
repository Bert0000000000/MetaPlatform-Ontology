# Overall Platform Architecture（v6.0）

> MetaPlatform v6.0 整体架构图

```mermaid
graph TB
    subgraph Users["用户层"]
        Browser["浏览器<br/>(mp-frontend)"]
        Mobile["移动端"]
        CLI["CLI"]
    end

    subgraph Edge["边缘层"]
        Ingress["ingress-nginx<br/>*.mp-platform.local"]
    end

    subgraph Frontend["前端（mp-frontend namespace）"]
        Frontend["mp-frontend<br/>React + Semi Design"]
    end

    subgraph Core["平台核心（mp-platform / mp-runtime namespace）"]
        Platform["mp-platform<br/>租户/用户/菜单"]
        Runtime["mp-runtime<br/>Edge Functions"]
    end

    subgraph AI["AI 能力（mp-ai namespace）"]
        AIGateway["mp-ai<br/>LLM Gateway"]
        Ontology["mp-ontology<br/>12 Kernel 元模型"]
        Knowledge["mp-knowledge<br/>RAGFlow + GraphRAG"]
        Sandbox["mp-sandbox<br/>进程级沙箱"]
    end

    subgraph Agent["数字员工（mp-runtime namespace）"]
        AgentTeam["mp-agent-team<br/>dsh 编排"]
        HITLHub["mp-hitl-hub<br/>4 类 HITL"]
        Marketplace["mp-skill-marketplace"]
    end

    subgraph Workflow["业务流程（mp-orchestration namespace）"]
        Workflow["mp-workflow<br/>Temporal"]
        Approval["mp-approval<br/>BPMN 兜底"]
    end

    subgraph Data["数据层（mp-data namespace）"]
        Supabase["Supabase 全栈<br/>PG + Auth + Storage<br/>Realtime + Edge + Vector"]
    end

    subgraph Obs["可观测（mp-monitoring namespace）"]
        OTel["OTel Collector"]
        Grafana["Grafana<br/>Tempo + Prom + Loki"]
    end

    Users --> Ingress
    Ingress --> Frontend
    Frontend --> Platform
    Frontend --> AgentTeam
    Frontend --> Workflow

    Platform --> Supabase
    Runtime --> Supabase
    AIGateway --> Supabase
    Ontology --> Supabase
    Knowledge --> Supabase
    AgentTeam --> Supabase
    AgentTeam --> AIGateway
    AgentTeam --> Sandbox
    HITLHub --> Workflow
    HITLHub --> AgentTeam
    Workflow --> Supabase
    Workflow --> AIGateway

    AIGateway --> DeepSeek["DeepSeek / OpenAI<br/>(外部)"]
    Knowledge --> RAGFlow["RAGFlow / GraphRAG<br/>(外部)"]

    Approval -.->|BPMN 兜底| Workflow
    Marketplace --> AgentTeam

    Supabase -.->|OTel SDK| OTel
    Runtime -.->|OTel SDK| OTel
    AgentTeam -.->|OTel SDK| OTel
    Workflow -.->|OTel SDK| OTel
    OTel --> Grafana

    classDef external fill:#f9f,stroke:#333
    classDef user fill:#bbf,stroke:#333
    class DefPlatform fill:#bfb,stroke:#333
    class DeepSeek,RAGFlow external
    class Browser,Mobile,CLI user
```

## 关键点

- 用户 → ingress-nginx → mp-frontend（统一入口）
- mp-frontend 用模块联邦按需加载子应用
- 所有应用通过 Supabase PG + Auth + Storage 共享基础数据
- dsh（数字员工）+ Temporal（业务流程）+ Supabase 是 3 大支柱
- OTel SDK 全栈接入 → Collector → Grafana 统一可观测
- 外部依赖：DeepSeek（LLM）、RAGFlow（文档解析）