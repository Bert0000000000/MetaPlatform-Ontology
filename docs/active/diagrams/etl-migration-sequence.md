# ETL Migration Sequence（v3.0 → v6.0）

> 一次性 ETL + 按租户分批切流量

```mermaid
sequenceDiagram
    autonumber
    actor SRE as SRE
    participant V3 as v3.0 DB<br/>(只读)
    participant S3 as S3 冷存储
    participant V6 as v6.0 Supabase
    participant FF as Feature Flag<br/>(mp-platform)
    actor Tenant as 租户用户

    Note over SRE,V3: Week 1: 导出 + Schema 映射
    SRE->>V3: export_v3_users.sql
    V3-->>SRE: users.csv
    SRE->>V3: export_v3_tenants.sql
    V3-->>SRE: tenants.csv
    SRE->>V3: export_v3_business.py<br/>(17 域)
    V3-->>SRE: business/*.jsonl
    SRE->>V3: export_v3_audit_logs.py
    V3-->>S3: audit_logs.jsonl.gz → Glacier

    Note over SRE,V3: Week 2: 导入 + 验证
    SRE->>V6: import_v6_users.py<br/>(Supabase Auth + profiles)
    V6-->>SRE: id_mapping/users.csv
    SRE->>V6: import_v6_tenants.py
    V6-->>SRE: id_mapping/tenants.csv
    SRE->>V6: import_v6_business.py<br/>(17 域 + RLS)
    V6-->>SRE: 业务数据导入完成
    SRE->>V6: verify_etl.sql<br/>(L1 行数)
    V6-->>SRE: ✅ 17/17 匹配

    Note over SRE,V6: Week 3+: 按租户切流量
    SRE->>FF: migrateTenant(dev, true)
    FF-->>SRE: dev 租户已切 v6.0

    SRE->>V6: L2 字段值抽样 1%
    V6-->>SRE: ✅ 0 不匹配
    SRE->>V6: L3 端到端测试
    V6-->>SRE: ✅ 4/4 通过

    Note over Tenant,V6: 监控 24h
    Tenant->>V6: 业务请求
    V6->>V6: tenant.migration.completed = true
    V6-->>Tenant: v6.0 服务响应

    Note over SRE,V6: 后续周：staging 租户 / 1% canary / 50% / 100%

    Note over SRE,V3: Week 7+1: v3.0 标记 deprecated
    SRE->>V3: 标记 read-only + 6 个月观察期
```

## 关键点

1. **完全抛弃 v3.0 代码**，仅 ETL 数据
2. **3 层校验**：L1 行数 + L2 字段值 + L3 端到端
3. **按租户分批**：dev → staging → 1% canary → 50% → 100%
4. **每次切流量前 24h 内重跑校验**
5. **feature flag 即时切换**（毫秒级）
6. **失败可回滚**（feature flag 关闭 + 切回 v3.0）