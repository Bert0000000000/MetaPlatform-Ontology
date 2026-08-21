# ADR-0069：mp-sandbox PoC (Issue #16)

> **状态**：Accepted (PoC scope)
> **日期**：2026-08-20
> **作者**：AI 团队
> **关联 PRD**：[docs/active/prd/mp-sandbox.md](../prd/mp-sandbox.md)
> **关联 Issue**：#16 (mp-sandbox production tracker)
> **关联引用**：ADR-0062 (App Center), ADR-0065 (Multimodal RAG)

---

## 1. 背景

`mp-sandbox` (PRD [mp-sandbox.md](../prd/mp-sandbox.md)) 是数字员工 / Agent 执行用户代码 / 工具调用的隔离层。设计目标是进程级隔离 (bwrap / Landlock / Seatbelt) + K8s Job (重型任务)。

但完整生产路径涉及：
- bwrap / Landlock sidecar (mp-runtime Deployment)
- K8s Job 模板动态生成 (mp-ai namespace)
- dsh sandbox 4 包的可执行清单
- 资源限制 (CPU / 内存 / 时长)
- 网络隔离 (NetworkPolicy + 白名单)
- 文件系统隔离 (chroot)

完整生产路径需要 2-3 周，与 Sprint 0 4 个 P0 Batch 平行做不动。

## 2. 决策

**采用 1 day PoC：Supabase Edge Function + mock 沙箱，给 mp-agent-team / mp-ontology 留对接面。**

PoC 范围：
- 走通 HTTP contract (POST /functions/v1/mp-sandbox/execute)
- 走通危险命令黑名单 (`rm -rf /`, `dd`, `mkfs`, fork bomb, 等)
- 走通 audit_log 写入 (SECURITY DEFINER RPC 隔离)
- 走通 timeout / 权限 / 401 / 403 / 408 错误码
- mock 执行器 (不真起子进程)

PoC 不做：
- 真实代码执行 (生产必须 bwrap / Landlock)
- 网络隔离 (PoC 默认 isolated, 不真切)
- 文件系统隔离
- K8s Job 异步路径

## 3. 生产路径 (Issue #16 后续)

Issue #16 跟踪完整生产实现：

### 3.1 sync 路径 (< 30s)
- mp-runtime Deployment 加 sidecar 容器 (bwrap / Landlock)
- sidecar 启动时加载 sandbox policy (可执行清单 + 写保护路径)
- EF / Agent 通过 localhost HTTP 调 sidecar `POST /execute`
- sidecar 用 `unshare --user --map-root-user --pid --mount-proc --fork bwrap --bind / --tmpfs /tmp ...` 起隔离子进程

### 3.2 async 路径 (K8s Job)
- mp-ai namespace 创建 JobTemplate `mp-sandbox-job-template`
- 每次执行 → K8s Job with `restartPolicy: Never`, `activeDeadlineSeconds: 3600`
- Job pod 用 sandbox policy + RBAC
- 状态轮询: K8s Job → Temporal activity → mp-sandbox 表更新

### 3.3 PoC → 生产 切换
- 删 public.record_execution wrapper
- 创建 mp_sandbox.executions 表 + tg_audit 触发器
- EF 改读 mp_sandbox.executions 表
- sidecar ready 后 EF 切到 sidecar HTTP

## 4. 设计要点

### 4.1 PoC 架构

```
┌──────────────┐    POST /functions/v1/mp-sandbox
│ mp-agent-team│    { code, language, timeout_ms }
│ mp-ontology  │ ─────────────────────────────►┌──────────────────┐
└──────────────┘                                │ Edge Function    │
                                               │ mp-sandbox EF    │
                                               │  ├─ denyReason() │
                                               │  ├─ mockExecute()│
                                               │  └─ RPC → audit  │
                                               └──────┬───────────┘
                                                      │ SECURITY DEFINER
                                                      ▼
                                              public.record_execution()
                                                       │
                                                       ▼
                                              public.audit_log
```

### 4.2 危险命令黑名单 (PoC)

| 模式 | 拒答原因 |
|---|---|
| `rm -rf /` / `rm -fr /*` | recursive forced remove on root |
| `mkfs`, `mkfs.ext4` | filesystem format |
| `dd if=/...`, `dd of=/dev/sd*` | raw block write |
| `:(){:\|:&};:` | bash fork bomb |
| `curl ... \| bash`, `wget ... \| sh` | remote script piped to shell |
| `shutdown`, `reboot`, `poweroff`, `halt` | system power control |
| `iptables`, `firewall`, `nft` | firewall manipulation |
| `chmod 777` / `chmod 666` | world-writable chmod |
| `chown -R` on `/`, `/etc` | recursive chown on system path |
| `> /dev/sd*` | raw write to disk device |

### 4.3 audit_log 写入 (SECURITY DEFINER)

- PoC 阶段 direct INSERT audit_log 被 service_role 拒 (audit_log 没显式 GRANT)
- 走 `public.record_execution(uuid, uuid, text, text, text, int, int, text, int, int, int, int, jsonb)` 
- 函数内部 `SECURITY DEFINER`, 直接 INSERT public.audit_log
- public schema 暴露给 PostgREST, EF 通过 `/rest/v1/rpc/record_execution` 调用

### 4.4 mockExecute 行为

| timeout_ms | 行为 |
|---|---|
| `>= 1000` | 等 ~50ms 模拟 IO, 返回 200 |
| `< 1000` | 等满 timeoutMs + 10ms, 触发 abort, 返回 408 |

测试可控地拿到 timeout 路径。

## 5. 风险

| 风险 | 缓解 |
|---|---|
| PoC EF 被误用做生产 | Response 强制带 `warning: "PoC stub..."` 字段 + `mode: "poc_mock"`; 文档 ADR + Issue #16 标明禁用 |
| 黑名单绕过 (Unicode / base64 / shell escape) | PoC 不做 AST 解析, 仅字面 token 匹配; 生产用 Landlock 强制隔离, 黑名单仅做 quick-filter |
| 5s timeout 太短 | 仅 PoC; 生产 default 30s, max 1h (PRD §5) |

## 6. 工作量评估

| 阶段 | 估时 |
| |---|
| PoC (本次) | 1 day |
| Issue #16 完整生产 (bwrap/Landlock sidecar + K8s Job) | 2-3 weeks |
| Issue #16 后续 (Firecracker microVM 可选) | 8+ weeks (v6.2+) |

## 7. 替代方案

| 方案 | 取舍 |
|---|---|
| A. 直接跳生产路径 (sidecar + K8s Job) | 拒绝 — 2-3 周超出 PoC 预算 |
| B. 用 Docker-in-Docker 做隔离 | 拒绝 — root-in-root, 不比裸进程安全 |
| C. 用 Firecracker microVM | 推迟 v6.2 — 8+ 周太大 (PRD §8 决策) |
| D. 复用现有 K8s Pod sandbox (kind/nesting) | 推迟 — 需 cgroup v2 + nested virt |

## 8. 不做 (PoC 阶段)

- ❌ 真实代码执行 (生产必须)
- ❌ 网络隔离 (生产 must)
- ❌ 文件系统隔离 (生产 must)
- ❌ 资源限制 (CPU / 内存, 生产 must)
- ❌ K8s Job 异步路径 (生产 must)
- ❌ mp_sandbox.executions 表 (生产 must; PoC 仅 audit_log)
- ❌ dashboard / Realtime / OTel trace (生产 nice-to-have)

---

*ADR-0069 — mp-sandbox 1 day PoC. 完整生产路径走 Issue #16.*