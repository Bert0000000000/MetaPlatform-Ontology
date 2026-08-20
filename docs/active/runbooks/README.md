# docs/active/runbooks/

> Runbook（运维手册）目录。**每个关键模块必须有对应 Runbook**，覆盖常见故障 + 排查 SOP + 回滚步骤 + 升级检查表 + 联系人。

## 索引

| Runbook | 配套 PRD | 严重度 | 触发场景 |
|---|---|---|---|
| [rb-supabase-pg-backup-restore.md](./rb-supabase-pg-backup-restore.md) | [foundation-dr-backup](../prd/foundation-dr-backup.md) | P0 | PITR / 备份失败 / 全损恢复 / 月度演练 |
| [rb-temporal-cluster.md](./rb-temporal-cluster.md) | [temporal-cluster](../prd/temporal-cluster.md) | P0 | gRPC 不可达 / Workflow stuck / Activity 失败 |
| [rb-otel-collector.md](./rb-otel-collector.md) | [otel-collector-config](../prd/otel-collector-config.md) | P0/P1 | trace 收不到 / 数据缺口 / 告警风暴 / OOM |
| [rb-harbor-image.md](./rb-harbor-image.md) | [dsh-image-spec](../prd/dsh-image-spec.md) | P1 | push 失败 / 拉取失败 / trivy 误报 / Harbor 不可达 |
| [rb-networkpolicy.md](./rb-networkpolicy.md) | [foundation-networkpolicy](../prd/foundation-networkpolicy.md) | P0 | 业务连不上 Supabase / 无法出公网 |
| [rb-rls-policy.md](./rb-rls-policy.md) | [foundation-rls-policy](../prd/foundation-rls-policy.md) | P0/P1 | 跨租户泄露 / 看不到自己数据 / CI 失败 |
| [rb-dsh-digital-employee.md](./rb-dsh-digital-employee.md) | [mp-agent-team](../prd/mp-agent-team.md) | P0 | Session 起不来 / 数字员工卡住 / Tool 失败 |

## 模板

每份 Runbook 遵循相同结构：

1. **适用场景**（表格列出 3-5 个触发条件 + 对应行动）
2. **前置检查**（5 个 bash 块验证环境）
3. **故障 SOP**（按场景分小节，每个含步骤 + 常见原因 + 验证）
4. **回滚步骤**（具体到命令）
5. **升级检查表**（5-7 项 checklist）
6. **联系人 / 升级路径**（按严重度）

## 何时写 Runbook

- 新模块上线前必须有对应 Runbook
- 每次重大事故后，更新对应 Runbook（增加根因 + 修复步骤）
- 季度 review 所有 Runbook（确保命令仍然有效）

## 与其他文档的关系

| 文档类型 | 路径 | 用途 |
|---|---|---|
| PRD | `docs/active/prd/` | 是什么 / / 为什么 |
| Runbook | `docs/active/runbooks/`（本目录） | **怎么修** |
| Batch 文档 | `docs/active/batch/` | 怎么做 |
| evidence | `evidence/` | 验收证据 + 事故报告 |