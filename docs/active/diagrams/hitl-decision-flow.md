# HITL Hub 4 类决策流

> Human-in-the-Loop 4 种类型联动

```mermaid
flowchart TD
    Start([业务触发 HITL<br/>来自 dsh / Temporal / 应用])
    Decision{HITL 类型}
    Type1[workflow_saas<br/>走第三方 SaaS]
    Type2[workflow_dsh<br/>走 dsh 对话]
    Type3[tool_dsh<br/>走 dsh tool 反馈]
    Type4[action_confirm<br/>应用内置 confirm]

    Type1 --> SaaS[钉钉 / 飞书 / 企微<br/>审批 API]
    Type2 --> DshChat[dsh 数字员工对话<br/>触发 confirm skill]
    Type3 --> DshTool[dsh tool 返回<br/>decision 字段]
    Type4 --> Modal[前端弹窗<br/>approve / reject]

    SaaS --> Wait{等待决策}
    DshChat --> Wait
    DshTool --> Wait
    Modal --> Wait

    Wait -->|decision = approved| Approve[HTTP webhook<br/>→ 业务 workflow]
    Wait -->|decision = rejected| Reject[HTTP webhook<br/>→ 业务 workflow 终止]
    Wait -->|timeout > 7d| Timeout[自动 reject<br/>写 audit_log]

    Approve --> Audit[audit_log<br/>+ HITL 表]
    Reject --> Audit
    Timeout --> Audit

    classDef type fill:#cce5ff,stroke:#0066cc
    classDef saas fill:#ffe9cc,stroke:#cc6600
    classDef result fill:#ccffcc,stroke:#009900
    class Type1,Type2,Type3,Type4 type
    class SaaS,DshChat,DshTool,Modal saas
    class Approve,Reject,Timeout,Audit result
```

## 4 类 HITL 对比

| 类型 | 适用场景 | 触发方 | 决策方 |
|---|---|---|---|
| **workflow_saas** | 财务审批 / 合同审批 | Temporal signal | 钉钉 / 飞书 / 企微审批人 |
| **workflow_dsh** | AI 决策后人工确认 | dsh workflow | 数字员工对话中 |
| **tool_dsh** | 工具调用需确认（如删除）| dsh tool | dsh 用户 |
| **action_confirm** | 普通业务确认 | 前端按钮 | 应用用户 |

## 共同特征

- **超时默认 7 天**，自动 reject
- **所有决策进 audit_log**
- **状态机**：pending → approved / rejected / timeout
- **webhook 回调**业务 workflow（毫秒级）