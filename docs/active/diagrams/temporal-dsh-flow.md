# Temporal + dsh + Supabase 数据流

> 数字员工 dsh 启动 + 通过 Temporal 执行工作流 + 访问 Supabase

```mermaid
sequenceDiagram
    autonumber
    actor User as 用户
    participant Frontend as mp-frontend
    participant AgentTeam as mp-agent-team<br/>(dsh-web)
    participant Sandbox as mp-sandbox
    participant AI as mp-ai<br/>(LLM Gateway)
    participant Temporal as Temporal Cluster
    participant Worker as Temporal Worker<br/>(mp-runtime)
    participant HITL as mp-hitl-hub
    participant Supabase as Supabase PG

    User->>Frontend: 输入问题
    Frontend->>AgentTeam: WebSocket 连接<br/>启动 session
    AgentTeam->>Supabase: 读 session 历史
    AgentTeam->>AI: 调 LLM（DeepSeek）
    AI-->>AgentTeam: 思考响应

    alt 需要 tool call
        AgentTeam->>Sandbox: 执行 code / shell
        Sandbox-->>AgentTeam: 返回结果
    else 需要 long-running workflow
        AgentTeam->>Temporal: workflow.start(myWorkflow)
        Temporal->>Worker: 分发 task
        Worker->>Supabase: 读 / 写业务数据
        Supabase-->>Worker: 结果
        Worker->>Temporal: 回报 activity result
        Temporal-->>AgentTeam: workflow 进度更新
    else 需要人工审批
        AgentTeam->>HITL: hitl.request(workflow_saas)
        HITL->>User: 推送审批通知<br/>(Slack / 钉钉)
        User->>HITL: 审批决策
        HITL->>Temporal: workflow.signal(decision)
        Temporal->>Worker: 继续执行
    end

    AgentTeam->>User: 流式返回响应（WebSocket）
    AgentTeam->>Supabase: 写消息历史 + audit_log
```

## 关键路径

| 路径 | 用途 | 涉及模块 |
|---|---|---|
| **1. 短对话** | 简单问答 | AgentTeam → AI → 返回 |
| **2. Tool call** | 数字员工执行代码 | AgentTeam → Sandbox |
| **3. 长 workflow** | 1 周+ 异步任务 | AgentTeam → Temporal → Worker → Supabase |
| **4. HITL 审批** | 关键决策需人工 | AgentTeam → HITL → 外部 SaaS / dsh 通知 |

## 数据持久化

- **session 历史**：mp_agent_team.messages（PG）
- **workflow 状态**：Temporal 自带持久化（专用 PG schema）
- **业务数据**：Supabase PG 业务 schema（RLS 隔离）