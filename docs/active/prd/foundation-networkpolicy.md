# PRD：foundation-networkpolicy

> **模块**：MetaPlatform v6.0 基础设施层 — NetworkPolicy 网络隔离
> **对应 Batch**：[MetaPlatform-FOUNDATION-01](../batch/MetaPlatform-FOUNDATION-01.md)
> **状态**：Draft v1.0（待架构组评审）
> **负责人**：SRE + 安全
> **日期**：2026-08-20

---

## 1. 概述（What）

为 10 个 namespace 定义 **default-deny + 白名单** 的 NetworkPolicy 标准，确保：

- namespace 之间默认不通
- 必需的跨 namespace 通信通过显式 `allow` policy 放行
- ingress / egress 都受控
- 外部依赖（Vault / Harbor / Anthropic 等）通过 egress 白名单限定

**本 PRD 不写**：具体业务的 NetworkPolicy（那是各应用 Batch 的事）。**本 PRD 落地**：所有 namespace 必须套用的 baseline policy 模板。

## 2. 背景与目标（Why & Goals）

### 2.1 背景

- v3.0 时期"扁平网络"导致任何 Pod 可访问任何 Pod → 攻击面巨大
- 2024 年 v3.0 一次供应链攻击从 mp-data 横向移动到 mp-monitoring
- v6.0 强制 default-deny + 显式 allow

### 2.2 目标

| # | 目标 |
|---|---|
| G1 | 所有 namespace 强制 default-deny（egress + ingress）|
| G2 | 跨 namespace 通信**100% 通过显式 NetworkPolicy 放行**（审计可查）|
| G3 | Egress 出公网**100% 受限**（仅白名单域名 / IP 段）|
| G4 | NetworkPolicy 变更**100% 走 GitOps**（ArgoCD / Git）|
| G5 | 故障排查不依赖 `kubectl exec tcpdump`（靠 OTel + 日志）|

## 3. 用户与场景

| Persona | 场景 |
|---|---|
| **应用 Owner** | 创建新 namespace 时套用 baseline policy；跨 namespace 通信新增显式 allow |
| **SRE** | 故障定位"为什么服务 A 连不上服务 B"——靠 policy diff + flow log |
| **安全** | 定期 audit NetworkPolicy 列表；发现异常放行立即整改 |
| **合规审计** | 提供 NetworkPolicy 报告证明"default-deny 已落地" |

## 4. 功能需求（Functional Requirements）

### 4.1 Default-Deny 基线（每个 namespace）

#### 4.1.1 Egress default-deny

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-egress
  namespace: <target-namespace>
spec:
  podSelector: {}
  policyTypes:
  - Egress
  egress: []  # 空 = 全部拒绝
```

#### 4.1.2 Ingress default-deny

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-ingress
  namespace: <target-namespace>
spec:
  podSelector: {}
  policyTypes:
  - Ingress
  ingress: []
```

**强制规则**：
- 每个业务 namespace 都必须 apply 这两个 baseline policy
- 任何 namespace 不允许删 default-deny 政策（即使是 SRE 也不允许手动 `kubectl delete`）

### 4.2 跨 Namespace 白名单矩阵

下表是 v6.0 必须 allow 的跨 namespace 通信。**任何矩阵外的通信 → 默认 deny**：

| from namespace | to namespace | 端口 | 协议 | 用途 |
|---|---|---|---|---|
| `mp-frontend` | `mp-platform` | 3000 | TCP | API 调用 |
| `mp-runtime` | `mp-data` | 5432, 6543 | TCP | Supabase PG + Pooler |
| `mp-runtime` | `mp-data` | 3000 | TCP | PostgREST |
| `mp-runtime` | `mp-data` | 4000 | TCP | Storage S3 API |
| `mp-runtime` | `mp-data` | 54321 | TCP | Supabase Kong 网关 |
| `mp-orchestration` | `mp-data` | 5432 | TCP | Temporal 持久化 |
| `mp-ai` | `mp-data` | 5432 | TCP | embedding 写入 |
| `mp-ai` | `mp-data` | 8000 | TCP | RAGFlow 检索（外部） |
| `mp-monitoring` | `*` | 9090, 4317, 4318 | TCP | OTel/Prometheus 拉取 |
| `mp-infra` | `*` | 8200 | TCP | Vault Agent 同步 |
| `*` | `mp-data` | 8443 | TCP | ingress-nginx → Supabase Studio |
| `mp-business` | `mp-data` | 5432, 3000 | TCP | Edge Functions 访问 DB |
| `mp-business` | `*` | 443 | TCP | 出公网（外部 API）|

#### 4.2.1 Egress 显式 allow 模板

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-egress-to-supabase
  namespace: mp-runtime
spec:
  podSelector: {}
  policyTypes:
  - Egress
  egress:
  - to:
    - namespaceSelector:
        matchLabels:
          kubernetes.io/metadata.name: mp-data
    ports:
    - protocol: TCP
      port: 5432
    - protocol: TCP
      port: 3000
    - protocol: TCP
      port: 4000
```

### 4.3 Egress 出公网白名单

业务 namespace 出公网**必须**走 egress proxy / 域名白名单：

```yaml
# mp-business 出公网白名单（外部 SaaS）
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-egress-public-saas
  namespace: mp-business
spec:
  podSelector: {}
  policyTypes:
  - Egress
  egress:
  # Anthropic API
  - to:
    - ipBlock:
        cidr: 0.0.0.0/0
        except:
          - 10.0.0.0/8
          - 172.16.0.0/12
          - 192.168.0.0/16
    ports:
    - protocol: TCP
      port: 443
  # DNS 必须放行
  - to:
    - namespaceSelector:
        matchLabels:
          kubernetes.io/metadata.name: kube-system
    ports:
    - protocol: UDP
      port: 53
    - protocol: TCP
      port: 53
```

**CI 检测规则**：
- 任何 `egress` policy 不允许 `0.0.0.0/0` 不带 `except` 段
- 必须显式列出端口

### 4.4 Ingress 入口规则

只有以下入口源允许进入业务 namespace：

| 源 | 目标 | 端口 |
|---|---|---|
| ingress-nginx（`kube-system` 标签） | 所有 namespace | 80 / 443 |
| mp-monitoring（抓 metrics） | 所有 namespace | 9090 / 4317 / 4318 |
| 同 namespace 内 Pod | 同 namespace | 业务自定义 |
| `hostNetwork: true` Pod | — | **禁止**（v6.0 全网络隔离）|

### 4.5 Pod-to-Pod 同 namespace 规则

同 namespace 内 Pod 互通**默认允许**（业务用 Service 通信），无需 NetworkPolicy 显式 allow。如果某个 Pod 要 deny 同 namespace 内的特定邻居，需要写额外 policy。

### 4.6 与 mp-infra / mp-monitoring 的特殊规则

- `mp-infra`（cert-manager / argocd / vault-agent）默认**只接受同 namespace + kube-system**通信
- `mp-monitoring`（OTel / Grafana）**可以拉取所有 namespace 的 metrics**，但**不接收任何 ingress**
- 任何 namespace → `mp-monitoring` 的 ingress **默认拒绝**（避免被 Grafana 反向探测）

### 4.7 CI 检测脚本

**`scripts/ci/networkpolicy-check.sh`** 在 PR 时跑：

| 检测项 | 规则 | 失败动作 |
|---|---|---|
| 所有 namespace 必须有 `default-deny-egress` | 遍历 namespace + kubectl 查 policy | exit 1 |
| 所有 namespace 必须有 `default-deny-ingress` | 同上 | exit 1 |
| Egress 不允许裸 `0.0.0.0/0` | grep ipBlock | exit 1 |
| Egress 必须含 DNS 端口（53）| 检查 kube-system | exit 1 |
| 跨 namespace 通信必须在白名单矩阵 | 比对 policy 与 PRD §4.2 表 | warning（不阻断）|

详见 [ci.yml helm-validate job](../workflows/ci.yml) 第 7 项。

## 5. 非功能需求

| 维度 | 要求 |
|---|---|
| **安全性** | default-deny 100% 落地；egress 出公网受控 |
| **可观测** | NetworkPolicy 命中统计（cilium monitor） |
| **性能** | NetworkPolicy overhead < 1ms p99（cilium eBPF 实现）|
| **可维护** | 新增跨 namespace 通信只需 1 份 YAML |
| **审计** | 每周 NetworkPolicy diff 报告 |
| **回滚** | ArgoCD 自动 sync + git revert 即可回滚 |

## 6. 接口契约

### 6.1 Namespace 标准 label

所有 namespace 必须打以下 labels（NetworkPolicy 通过 label selector 工作）：

```yaml
labels:
  kubernetes.io/metadata.name: <namespace>   # K8s 默认
  platform.mp/version: v6.0
  platform.mp/tier: <frontend|runtime|data|orchestration|monitoring|integration|business|ai|platform|infra>
```

### 6.2 Helm values 注入

```yaml
# helm/mp-umbrella/values-<env>.yaml
networkPolicy:
  enabled: true
  defaultDeny: true
  whitelist:
    mp-runtime:
      - namespace: mp-data
        ports: [5432, 3000, 4000, 54321]
      - namespace: kube-system
        ports: [53]
  # ...
```

### 6.3 ArgoCD App of Apps

NetworkPolicy baseline 由 `app-of-apps/netpol-baseline.yaml` 统一管理；具体应用的 NetworkPolicy 由各应用 chart 自己管理。

## 7. 验收标准（AC）

| # | 标准 | 验证方式 |
|---|---|---|
| AC1 | 10 个 namespace 全部有 default-deny-egress | `kubectl get netpol -A` |
| AC2 | 10 个 namespace 全部有 default-deny-ingress | 同上 |
| AC3 | CI gate `helm-validate`（含 netpol 检查）全绿 | GitHub Actions |
| AC4 | 跨 namespace 通信测试：mp-runtime → mp-data 通；mp-platform → mp-monitoring 通；mp-frontend → mp-data 默认 deny | 端到端测试脚本 `tests/network/cross_ns_test.sh` |
| AC5 | 业务 egress 测试：mp-business → 任意公网 443 通；→ 22 默认 deny | 同上 |
| AC6 | NetworkPolicy 文档化（每条 policy 一个 PR）| git log |

## 8. 依赖

| 依赖 | 来源 | 时序 |
|---|---|---|
| K8s 集群 + Cilium CNI | foundation-k8s-clusters | 必须先 |
| Namespace 全部创建 | foundation-k8s-clusters | 必须先 |
| 业务服务部署前 | 各应用 Batch | policy 必须**先**于服务 deploy |

## 9. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| default-deny 误伤合法通信 | 服务起不来 | 单元测试 + 端到端测试 + ArgoCD 自动 sync 失败告警 |
| 跨 namespace allow 列表遗漏 | 功能失效 | 端到端测试 + 文档化 allow 矩阵 |
| NetworkPolicy 调试困难（"为什么连不上"）| 故障定位慢 | cilium hubble UI + flow log + ArgoCD Application diff |
| Egress 出公网被 DNS 拦截 | 业务 API 调用失败 | DNS 端口必须放行（kube-system）|

## 10. 不做（Out of Scope）

- ❌ **Service Mesh（Istio mTLS）**：v6.0 不用
- ❌ **L7 流量管控**：v6.0 仅 L3/L4
- ❌ **多集群联邦 NetworkPolicy**：单集群
- ❌ **WAF / DDoS 防护**：ingress-nginx + 云厂商 WAF（外部）
- ❌ **网络抓包 / 调试接口**：调试靠 Hubble UI

---

*PRD v1.0 — 配套 [foundation-k8s-clusters](foundation-k8s-clusters.md) / [foundation-supabase-schema](foundation-supabase-schema.md) / [foundation-rls-policy](foundation-rls-policy.md) / [foundation-dr-backup](foundation-dr-backup.md)*