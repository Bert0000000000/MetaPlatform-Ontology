# Supabase + RLS 多租户数据流

> 多租户隔离：JWT → RLS policy → SQL 过滤

```mermaid
sequenceDiagram
    autonumber
    actor User as 用户（tenant A）
    participant App as 应用<br/>(mp-runtime)
    participant Auth as Supabase Auth
    participant PG as Supabase PG<br/>(RLS enabled)

    User->>App: 登录请求
    App->>Auth: signIn(email, password)
    Auth-->>App: JWT<br/>{tenant_id: 'A', role: 'member'}
    App->>App: 注入 JWT 到请求头

    Note over App,PG: --- 业务查询 ---

    User->>App: 查询 orders 列表
    App->>PG: SELECT * FROM orders<br/>SET LOCAL role=authenticated<br/>SET LOCAL request.jwt.claims=<JWT>
    PG->>PG: 应用 RLS policy:<br/>USING (tenant_id = auth.jwt()->>'tenant_id')
    PG-->>App: 只返回 tenant A 的 orders

    Note over App,PG: --- 跨租户尝试（被拒）---

    User->>App: 尝试访问 tenant B 的数据<br/>(修改 URL 参数)
    App->>PG: SELECT * FROM orders WHERE tenant_id = 'B'
    PG->>PG: RLS policy 拒绝<br/>(tenant A 的 JWT 不匹配)
    PG-->>App: 返回空集合 []

    Note over User,PG: --- service_role 例外 ---

    App->>App: 服务端 ETL（admin 操作）
    App->>PG: SELECT * FROM orders<br/>SET LOCAL role=service_role
    PG-->>App: 返回全平台所有数据<br/>(service_role 绕过 RLS)
```

## 关键点

1. **JWT claim `tenant_id`** 是隔离的核心
2. **RLS policy** 在 SQL 层强制 tenant_id 过滤
3. **service_role** 仅服务端使用，业务代码禁用
4. 跨租户访问被 RLS 静默拒（返回空集合），不是错误