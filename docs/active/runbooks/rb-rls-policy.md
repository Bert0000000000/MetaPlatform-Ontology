# Runbook：RLS 误配置导致数据泄露 / 无法访问

> **适用**：RLS policy 写错导致跨租户数据泄露 / 业务看不到自己的数据
> **严重度**：P0（数据泄露）/ P1（功能故障）
> **负责人**：架构组 + SRE
> **最后更新**：2026-08-20

---

## 1. 适用场景

| 场景 | 触发 | 行动 |
|---|---|---|
| **跨租户泄露** | tenant A 看到 tenant B 数据 | §3.1（紧急） |
| **业务看不到自己数据** | RLS policy 太严 | §3.2 |
| **Migration 跑不通** | CREATE TABLE 缺 ENABLE RLS | §3.3 |
| **CI rls-check 失败** | PR 红 | §3.4 |

---

## 2. 前置检查

```bash
# 1. 看所有表的 RLS 状态
psql -c "
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
ORDER BY rowsecurity ASC, schemaname, tablename;
"

# 2. 看豁免清单
cat evidence/MetaPlatform-FOUNDATION-01-RLS-EXEMPTIONS.md

# 3. 测试跨租户访问（用 2 个测试账号）
psql -c "
SET LOCAL role authenticated;
SET LOCAL request.jwt.claim.tenant_id TO '<tenant_a_uuid>';
SELECT count(*) FROM public.orders;
-- 应该只看到 tenant_a 的数据
"

# 4. 看具体 policy
psql -c "
SELECT schemaname, tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
"
```

---

## 3. 故障 SOP

### 3.1 紧急：跨租户泄露（**P0**）

**立即行动**：

```bash
# 1. 立即停写入（保留读以便排查）
kubectl exec -n mp-data $PG_POD -- psql -c "
ALTER SYSTEM SET default_transaction_read_only = on;
SELECT pg_reload_conf();
"

# 2. 通知安全团队 + DBA + CEO
# Slack: #incident-prod + #security
# PagerDuty: P0

# 3. 找到泄露的 policy
psql -c "
SELECT schemaname, tablename, policyname, cmd, qual
FROM pg_policies
WHERE qual NOT LIKE '%auth.jwt()%'
  AND schemaname = 'public'
ORDER BY tablename;
"
# 不带 auth.jwt() 过滤的 policy 都可能泄露

# 4. 临时禁用可疑 policy
psql -c "ALTER POLICY <policy_name> ON public.<table> NOT VALID;"

# 5. 修复 policy
# 见 PRD foundation-rls-policy §4.2 模板
# 确保 USING 子句含 tenant_id 过滤

# 6. 重新启用写入
psql -c "ALTER SYSTEM RESET default_transaction_read_only;"
psql -c "SELECT pg_reload_conf();"

# 7. 重新验证跨租户隔离
psql -c "
SET LOCAL role authenticated;
SET LOCAL request.jwt.claim.tenant_id TO '<tenant_a_uuid>';
SELECT count(*) FROM public.orders WHERE tenant_id = '<tenant_b_uuid>';
-- 必须返回 0
"

# 8. 写事故报告 evidence/security-incidents/<YYYY-MM-DD>-rls-leak.md
```

### 3.2 业务看不到自己数据

```bash
# 1. 看具体表的 policy
psql -c "
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = '<table_name>';
"

# 2. 常见原因：
# a) USING 子句写错了（拼错列名 / 类型转换）
#    → 检查 auth.jwt() ->> 'tenant_id')::uuid
# b) tenant_id 字段没有 populate（应用代码忘了写）
psql -c "SELECT id, tenant_id FROM public.orders LIMIT 5;"
# 如果 tenant_id 是 NULL → 应用代码问题

# c) Policy 顺序问题（多个 policy 叠加 deny）
# 用 pg_policies 检查

# 3. 修复后跑端到端测试
pnpm test:rls --table=<table_name>
```

### 3.3 Migration 跑不通

```bash
# 1. 看 migration 错误
psql -c "
SELECT version, description, success
FROM supabase_migrations.schema_migrations
ORDER BY version DESC LIMIT 5;
"

# 2. 找缺 ENABLE RLS 的表
grep -L 'ENABLE ROW LEVEL SECURITY' supabase/migrations/*.sql
# CI rls-check 会拦，但本地跑可能漏

# 3. 补 ENABLE
# 编辑 migration 文件，加：
# ALTER TABLE <schema>.<table> ENABLE ROW LEVEL SECURITY;

# 4. 重跑 migration
supabase db reset   # 本地
# 或 staging 重新 push
```

### 3.4 CI rls-check 失败

```bash
# 1. 看 CI 输出
gh run list --workflow=ci.yml --limit 5
gh run view <run-id> --log-failed | grep rls-check

# 2. 跑本地检查
bash scripts/ci/rls-check.sh

# 3. 常见失败原因：
# a) 新表没 ENABLE RLS → 加 ALTER TABLE ... ENABLE ROW LEVEL SECURITY;
# b) 缺 tenant_id → 加到表结构
# c) DISABLE RLS 缺 COMMENT → 加 COMMENT ON TABLE

# 4. 修复后 push 触发 CI 重跑
```

---

## 4. 回滚步骤

如果新 policy 导致功能故障：

```bash
# 1. 立即 DROP 新 policy
psql -c "DROP POLICY <policy_name> ON public.<table>;"

# 2. git revert + push
git revert <commit>
git push
# ArgoCD 自动回滚

# 3. 验证功能恢复
```

---

## 5. 升级检查表

改 RLS policy 前：

- [ ] **必须** 在 staging 24h 跑端到端测试（多租户 + 跨租户）
- [ ] 写单元测试覆盖每个新 policy
- [ ] DBA + 安全 双签
- [ ] 通知所有应用 Owner
- [ ] 准备 `DROP POLICY` 命令

---

## 6. 联系人

| 严重度 | 联系人 | 通知 |
|---|---|---|
| P0（跨租户泄露）| SRE Lead + 安全 Lead + DBA + CEO | Slack #incident-prod + PagerDuty |
| P1（功能故障）| SRE + DBA | Slack #ops-prod |
| P2（CI 失败）| 应用 Owner | Slack #dev-prod |

---

*Runbook v1.0 — 配套 [PRD: foundation-rls-policy](../prd/foundation-rls-policy.md)*