# Runbook：dsh 数字员工故障排查

> **适用**：dsh session 起不来 / 数字员工无响应 / tool call 失败
> **严重度**：P0（业务核心功能）
> **负责人**：AI 团队 + SRE
> **最后更新**：2026-08-20

---

## 1. 适用场景

| 场景 | 触发 | 行动 |
|---|---|---|
| **Session 起不来** | 用户报障 + dsh-web 5xx | §3.1 |
| **数字员工卡住** | 长时间无响应 | §3.2 |
| **Tool call 失败率高** | 业务监控告警 | §3.3 |
| **Subagent 协作失败** | preset 调用异常 | §3.4 |

---

## 2. 前置检查

```bash
# 1. dsh-web pod 状态
kubectl get pods -n mp-runtime -l app=dsh-web

# 2. dsh-web 日志
kubectl logs -n mp-runtime -l app=dsh-web --tail=200

# 3. Postgres backend 可达
kubectl exec -n mp-runtime -l app=dsh-web -- nc -zv postgres.mp-data 5432

# 4. session 数据库
psql -c "
SELECT count(*), status
FROM mp_agent_team.sessions
WHERE created_at > now() - interval '1 day'
GROUP BY status;
"

# 5. LLM provider 可达
kubectl exec -n mp-runtime -l app=dsh-web -- \
  curl -I https://api.deepseek.com
```

---

## 3. 故障 SOP

### 3.1 Session 起不来

```bash
# 1. 看 dsh-web 启动日志
kubectl logs -n mp-runtime -l app=dsh-web --tail=200 | grep -iE 'error|panic|fail'

# 2. 常见原因：
# a) Postgres backend 不可达
kubectl logs -n mp-runtime -l app=dsh-web | grep -i postgres

# b) DSH_PG_URL 凭证失效（Vault 中）
# 检查 Vault:
kubectl exec -n mp-runtime -l app=dsh-web -- bash -c '
  vault token lookup 2>/dev/null || echo "vault not reachable"
'
# 重新同步 ExternalSecret
kubectl annotate externalsecret dsh-pg-credentials -n mp-runtime force-sync=$(date +%s)

# c) DSH_CONFIG 加载失败
kubectl exec -n mp-runtime -l app=dsh-web -- ls -la /app/config/
# 如果 ConfigMap 没 mount 看：
kubectl get cm -n mp-runtime dsh-config -o yaml

# 3. 重启 dsh-web
kubectl rollout restart deployment/dsh-web -n mp-runtime

# 4. 验证
sleep 30
curl -I https://api.mp-platform.local/agent/v1/health
```

### 3.2 数字员工卡住

```bash
# 1. 看 session 当前状态
psql -c "
SELECT id, status, updated_at, metadata
FROM mp_agent_team.sessions
WHERE status = 'active'
  AND updated_at < now() - interval '10 minutes'
ORDER BY updated_at
LIMIT 20;
"

# 2. 看消息历史（最近 5 条）
psql -c "
SELECT role, content, tool_calls, created_at
FROM mp_agent_team.messages
WHERE session_id = '<session_id>'
ORDER BY created_at DESC
LIMIT 5;
"

# 3. 常见原因：
# a) LLM provider 超时
# b) Tool call 阻塞（如外部 API）
# c) Subagent 死循环

# 4. 强制终止 session
psql -c "
UPDATE mp_agent_team.sessions
SET status = 'archived', archived_at = now()
WHERE id = '<session_id>';
"

# 5. 通知用户重新发起
```

### 3.3 Tool call 失败率高

```bash
# 1. 看失败明细
psql -c "
SELECT
  tool_calls->>'name' AS tool_name,
  count(*) AS total,
  count(*) FILTER (WHERE tool_results->>'error' IS NOT NULL) AS failed
FROM mp_agent_team.messages
WHERE created_at > now() - interval '1 hour'
  AND tool_calls IS NOT NULL
GROUP BY 1
ORDER BY failed DESC;
"

# 2. 常见原因：
# a) 外部 API 限流（Anthropic / DeepSeek）
# 解决：调整 rate limit + 增加 retry
# b) Supabase RLS 拦截
# 解决：检查 tool 用的 service_role 是否合适
# c) dsh sandbox 失败
# 见 [mp-sandbox](../prd/mp-sandbox.md)

# 3. 临时缓解：调整 dsh config 增加 retry
kubectl edit cm -n mp-runtime dsh-config
# 改 retry.maxAttempts: 5 → 10

# 4. 永久修复：tool 代码 review + 加 metric 告警
```

### 3.4 Subagent 协作失败

```bash
# 1. 看 preset chain
psql -c "
SELECT metadata->>'preset_chain' AS chain
FROM mp_agent_team.sessions
WHERE id = '<session_id>';
"

# 2. 看每个 preset 的健康度
psql -c "
SELECT preset, count(*) AS sessions, count(*) FILTER (WHERE status='active') AS active
FROM mp_agent_team.sessions
WHERE created_at > now() - interval '1 day'
GROUP BY preset;
"

# 3. 临时禁用故障 preset
psql -c "
UPDATE mp_skill_marketplace.installations
SET config = config || '{\"enabled\": false}'::jsonb
WHERE preset_id = '<preset_id>';
"

# 4. 通知 preset Owner
```

---

## 4. 回滚步骤

dsh 升级后故障：

```bash
# 1. Helm rollback
helm history dsh-web -n mp-runtime
helm rollback dsh-web <PREVIOUS_REVISION> -n mp-runtime

# 2. Session 数据保留（PG 持久化），自动在新版本继续
```

---

## 5. 升级检查表

dsh 版本升级前：

- [ ] staging 跑 24h 全 preset 测试
- [ ] 检查 breaking changes（dsh changelog）
- [ ] 备份 Postgres backend（wal-g）
- [ ] 通知所有 preset Owner
- [ ] 准备回滚方案

---

## 6. 联系人

| 严重度 | 联系人 | 通知 |
|---|---|---|
| P0（数字员工全平台不可用）| AI 团队 Lead + SRE | Slack #incident-prod + PagerDuty |
| P1（单个 preset 故障）| AI 团队 | Slack #ops-prod |

---

*Runbook v1.0 — 配套 [PRD: mp-agent-team](../prd/mp-agent-team.md) / [PRD: mp-sandbox](../prd/mp-sandbox.md)*