# Runbook：NetworkPolicy 误配置导致服务不可达

> **适用**：NetworkPolicy 导致 namespace 间通信被拒 / egress 出公网失败
> **严重度**：P0（业务中断）
> **负责人**：SRE + 安全
> **最后更新**：2026-08-20

---

## 1. 适用场景

| 场景 | 触发 | 行动 |
|---|---|---|
| **业务连不上 Supabase** | 应用 5xx / timeout | §3.1 |
| **业务无法出公网** | 外部 API 调用失败 | §3.2 |
| **dsh 连不上 PG** | dsh session 起不来 | §3.3 |
| **mp-monitoring 拉不到 metric** | Prometheus scrape 失败 | §3.4 |

---

## 2. 前置检查

```bash
# 1. 看 NetworkPolicy 全图
kubectl get networkpolicy -A

# 2. 看目标 namespace 的 policy
kubectl get networkpolicy -n <target-ns>

# 3. 看源 pod 标签
kubectl get pod <pod> -n <source-ns> -o jsonpath='{.metadata.labels}' | jq

# 4. 测连通性（同 namespace / 跨 namespace）
kubectl exec -n <source-ns> <pod> -- nc -zv <target-host> <port>

# 5. Hubble（如果装了 Cilium）
hubble observe --namespace <source-ns> --follow
```

---

## 3. 故障 SOP

### 3.1 业务连不上 Supabase

```bash
# 1. 确认 baseline policy 存在
kubectl get networkpolicy -n mp-data
# 必须有：default-deny-ingress / default-deny-egress

# 2. 看白名单 policy
kubectl get networkpolicy -n mp-data -o yaml | grep -A 20 'allow-egress'

# 3. 测从 mp-runtime 到 mp-data
kubectl exec -n mp-runtime <pod> -- nc -zv supabase-postgres.mp-data 5432
# 默认应该被拒（无 allow policy）

# 4. 确认 allow-egress-to-supabase 存在
kubectl get networkpolicy -n mp-runtime -o yaml | grep -B 2 -A 10 'mp-data'

# 5. 缺失则添加（见 PRD foundation-networkpolicy §4.2.1 模板）

# 6. 验证
sleep 10
kubectl exec -n mp-runtime <pod> -- nc -zv supabase-postgres.mp-data 5432
```

### 3.2 业务无法出公网

```bash
# 1. 测出公网（curl）
kubectl exec -n <source-ns> <pod> -- curl -I https://api.anthropic.com
# 默认被拒

# 2. 确认 egress allow policy
kubectl get networkpolicy -n <source-ns> -o yaml | grep -A 20 egress

# 3. 常见缺失：
# a) 0.0.0.0/0 with except（公网白名单）
# b) port 53 (DNS) — 如果业务域名解析失败
kubectl exec -n <source-ns> <pod> -- nslookup api.anthropic.com
# 解析失败说明缺 DNS 端口 allow

# 4. 补 policy（见 PRD foundation-networkpolicy §4.3）
```

### 3.3 dsh 连不上 PG

```bash
# 1. dsh pod 起状态
kubectl get pods -n mp-runtime -l app=dsh-web

# 2. dsh 日志（PG 连接错误）
kubectl logs -n mp-runtime -l app=dsh-web --tail=50 | grep -i postgres

# 3. 常见原因：
# a) DNS 解析失败 → 加 kube-system DNS 端口 allow
# b) TCP 5432 被阻 → 加 mp-data egress allow
# c) DSH_PG_URL 错误 → 检查 Vault 凭证

# 4. 验证
kubectl exec -n mp-runtime -l app=dsh-web -- nc -zv postgres.mp-data 5432
```

### 3.4 Prometheus 拉不到 metric

```bash
# 1. Prometheus 抓取目标
kubectl port-forward -n mp-monitoring svc/prometheus 9090:9090 &
curl http://localhost:9090/api/v1/targets | jq '.data.activeTargets[] | select(.health!="up")'

# 2. mp-monitoring namespace 应该有 allow ingress from anywhere on ports 9090/4317/4318
kubectl get networkpolicy -n mp-monitoring -o yaml | grep -A 20 ingress

# 3. 如果没有，加 ingress allow：
cat <<EOF | kubectl apply -f -
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-ingress-monitoring
  namespace: mp-monitoring
spec:
  podSelector: {}
  policyTypes:
  - Ingress
  ingress:
  - from:
    - namespaceSelector:
        matchLabels:
          kubernetes.io/metadata.name: mp-monitoring
    ports:
    - protocol: TCP
      port: 9090
    - protocol: TCP
      port: 4317
    - protocol: TCP
      port: 4318
EOF
```

---

## 4. 回滚步骤

误改了 NetworkPolicy：

```bash
# 1. ArgoCD 自动回滚（git revert + sync）
git revert <commit>
git push
# ArgoCD 自动检测并回滚

# 2. 或手动 rollback
kubectl rollout history deployment/<policy-controller> -n mp-infra
kubectl rollout undo deployment/<policy-controller> -n mp-infra
```

---

## 5. 升级检查表

改 NetworkPolicy 前：

- [ ] 在 staging 跑 24h 端到端测试
- [ ] 用 `kubectl diff` 看实际变更
- [ ] 备份当前 NetworkPolicy YAML
- [ ] 通知所有应用 Owner
- [ ] ArgoCD 自动 sync 关闭（手动确认）

---

## 6. 联系人

| 严重度 | 联系人 | 通知 |
|---|---|---|
| P0（业务完全中断）| SRE Lead + 安全 Lead | Slack #incident-prod + PagerDuty |
| P1（部分功能受影响）| SRE | Slack #ops-prod |

---

*Runbook v1.0 — 配套 [PRD: foundation-networkpolicy](../prd/foundation-networkpolicy.md)*