# Runbook：Temporal Cluster 故障排查

> **适用**：Temporal Cluster 不可用 / Workflow stuck / Activity 失败率高
> **严重度**：P0（业务 Workflow 中断）
> **负责人**：SRE + 后端
> **最后更新**：2026-08-20

---

## 1. 适用场景

| 场景 | 触发 | 行动 |
|---|---|---|
| **gRPC :7233 不可达** | Temporal CLI 连接超时 | §3.1 |
| **Workflow stuck** | workflow 长时间不推进 | §3.2 |
| **Activity 失败率高** | 失败率 > 5% 持续 5 分钟 | §3.3 |
| **History Shard Lag** | shard lag > 1000 | §3.4 |
| **Postgres schema migration 失败** | Temporal 启动失败 | §3.5 |

---

## 2. 前置检查

```bash
# 1. 看 Pod 状态
kubectl get pods -n mp-orchestration -l app.kubernetes.io/name=temporal

# 2. 看 gRPC 是否可达
temporal operator namespace list --address temporal.mp-platform.local:7233

# 3. 看 Temporal metrics
kubectl port-forward -n mp-orchestration svc/temporal-frontend 9090:9090 &
curl http://localhost:9090/metrics | grep -E '^temporal_' | head -20

# 4. 看 Postgres 连接
kubectl exec -n mp-data $PG_POD -- psql -d postgres -U temporal_user -c "
SELECT count(*) FROM temporal.namespace WHERE retention_days IS NOT NULL;
"

# 5. 看 Temporal UI
curl -I https://temporal.mp-platform.local:8233/
```

---

## 3. 故障 SOP

### 3.1 gRPC :7233 不可达

```bash
# 1. 确认 Service / Endpoints
kubectl get svc -n mp-orchestration temporal-frontend
kubectl get endpoints -n mp-orchestration temporal-frontend

# 2. 看 Frontend pod 日志
kubectl logs -n mp-orchestration -l app.kubernetes.io/name=temporal,role=frontend --tail=100

# 3. 常见原因：
# a) Frontend OOM
kubectl top pods -n mp-orchestration -l app.kubernetes.io/name=temporal,role=frontend

# b) Postgres 连接失败
kubectl logs -n mp-orchestration -l app.kubernetes.io/name=temporal,role=frontend | grep -i postgres

# c) NetworkPolicy 拦截
kubectl get networkpolicy -n mp-orchestration

# 4. 重启 Frontend
kubectl rollout restart deployment/temporal-frontend -n mp-orchestration

# 5. 验证
sleep 30
temporal operator namespace list --address temporal.mp-platform.local:7233
```

### 3.2 Workflow stuck（workflow 长时间不推进）

```bash
# 1. 用 CLI 看 workflow 详情
temporal workflow describe \
  --workflow-id <workflow_id> \
  --address temporal.mp-platform.local:7233

# 2. 看历史事件
temporal workflow show \
  --workflow-id <workflow_id> \
  --address temporal.mp-platform.local:7233 \
  --output json | jq '.events | .[-5:]'

# 3. 常见原因：
# a) Activity timeout / retry
#    → 检查 Activity 是否 OOM/exception
# b) Worker 队列堆积
#    → 检查 Worker HPA / 任务量
# c) Postgres 连接池耗尽
#    → 见 §3.4

# 4. 终止并重启 workflow
temporal workflow terminate \
  --workflow-id <workflow_id> \
  --reason "stuck - restarted" \
  --address temporal.mp-platform.local:7233

# 5. 业务侧重新触发
```

### 3.3 Activity 失败率高

```bash
# 1. 看失败原因
kubectl logs -n mp-orchestration -l app.kubernetes.io/name=temporal-worker --tail=500 | grep -i 'activity.*fail'

# 2. 看 Temporal metrics
kubectl port-forward -n mp-orchestration svc/temporal-frontend 9090:9090 &
curl -s http://localhost:9090/metrics | grep -E 'temporal_activity.*failed'

# 3. 排查：
# a) Activity 代码 bug → 看 stack trace
# b) 下游服务（Supabase / dsh / 外部 API）不可用
# c) ResourceLimitExceeded（OOM）

# 4. 临时缓解：增大 Activity 重试次数
# 在 worker 代码 defaultActivityOptions.retry.maximumAttempts 调到 10

# 5. 永久修复：根因定位 + 代码修复 + 重启 worker
kubectl rollout restart deployment/<worker-name> -n mp-orchestration
```

### 3.4 History Shard Lag

```bash
# 1. 看 lag
kubectl port-forward -n mp-orchestration svc/temporal-history 9090:9090 &
curl -s http://localhost:9090/metrics | grep -E 'temporal_history_shard_lag'

# 2. 临时扩容 History shard
kubectl scale deployment/temporal-history -n mp-orchestration --replicas=8
# （需要 helm values 中 history.persistence.namespace.divisor 配合调整）

# 3. 长期方案：
# - 评估是否需要 continue-as-new
# - 业务 workflow 拆分（子 workflow）
# - 增加 PG IOPS
```

### 3.5 Schema migration 失败

```bash
# 1. 看 Temporal pod 日志
kubectl logs -n mp-orchestration -l app.kubernetes.io/name=temporal --previous | grep -i migration

# 2. 手动重试（idempotent）
kubectl exec -n mp-data $PG_POD -- bash -c "
PGPASSWORD=\$TEMPORAL_PASSWORD temporal sql \
  --db-type postgres \
  --db-host \$DB_HOST \
  --db-port 5432 \
  --db-name postgres \
  --db-user temporal_user \
  --schema temporal \
  --setup-schema
"

# 3. 验证
kubectl exec -n mp-data $PG_POD -- psql -d postgres -U temporal_user -c "
SELECT count(*) FROM information_schema.tables WHERE table_schema = 'temporal';
"
```

---

## 4. 回滚步骤

如果 Temporal 升级后**workflow 历史不兼容**：

```bash
# 1. 回滚 Helm
helm history temporal -n mp-orchestration
helm rollback temporal <REVISION> -n mp-orchestration

# 2. 回滚后所有 workflow 自动恢复（Persistent 状态在 PG）
```

---

## 5. 升级检查表

升级 Temporal 版本前：

- [ ] 在 staging 跑 24h 回归测试
- [ ] 检查 breaking changes（Temporal changelog）
- [ ] 备份 PG（wal-g backup-push）
- [ ] 通知所有业务 Owner（48h 前）
- [ ] 准备回滚方案

---

## 6. 联系人 / 升级路径

| 严重度 | 联系人 | 通知 |
|---|---|---|
| P0（业务 Workflow 中断 > 30 分钟）| SRE Lead + 后端 Lead | Slack #incident-prod + PagerDuty |
| P1（失败率 > 5%）| SRE + 后端 | Slack #ops-prod |
| P2（shard lag）| SRE | Slack #ops-prod |

---

*Runbook v1.0 — 配套 [PRD: temporal-cluster](../prd/temporal-cluster.md) / [PRD: temporal-worker-sdk](../prd/temporal-worker-sdk.md)*