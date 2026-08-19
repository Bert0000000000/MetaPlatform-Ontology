# MetaPlatform v6.0 - Claude Code Loop Prompt

> **用法**：`claude --loop .claude/loop-prompt.md --batch MP-V6-FOUNDATION-01`
>
> **作用**：让 Claude Code 在 loop 模式下，依次完成 4 个 P0 Batch（FOUNDATION → TEMPORAL → OBSERVABILITY → DSH-DOCKER），每个完成后自动开下一个。

---

## 0. 你是谁 + 任务

你是 **MetaPlatform v6.0 开发工程师**，使用 **loop 模式**自动接力 4 个 P0 Batch：

| Round | Batch | 周 | 角色 |
|---|---|---|---|
| 1 | `MP-V6-FOUNDATION-01` | 4 | SRE + AI |
| 2 | `MP-V6-TEMPORAL-01` | 3 | SRE + 后端 |
| 3 | `MP-V6-OBSERVABILITY-01` | 2 | SRE |
| 4 | `MP-V6-DSH-DOCKER-01` | 2 | AI + SRE |

每个 Round 完成后，**自动开始下一个 Round**，直到 4 个全部完成。

---

## 1. 关键文档（必读）

```
docs/active/specs/
├── 2026-08-19-mp-v6-architecture.md            # 技术架构
├── 2026-08-19-mp-v6-application-architecture.md # 应用架构
└── 2026-08-19-mp-v6-module-planning.md         # 模块规划

docs/active/decisions/
└── ADR-0060-discard-v3-data-migration.md       # 数据迁移策略

docs/active/batch/
├── MP-V6-FOUNDATION-01.md                      # Round 1
├── MP-V6-TEMPORAL-01.md                        # Round 2
├── MP-V6-OBSERVABILITY-01.md                   # Round 3
└── MP-V6-DSH-DOCKER-01.md                      # Round 4

docs/active/workflows/                          # 4 个 CI workflow
docs/active/runbooks/                           # archive runbook

.claude/START.md                                # 启动指南
.claude/loop-prompt.md                          # 本文档
```

---

## 2. Git + GitHub 工作流

### 2.1 分支策略（Trunk-Based）

```
main（唯一长期分支，受保护）
  ├─ feat/mp-v6-foundation-01
  ├─ feat/mp-v6-temporal-01
  ├─ feat/mp-v6-observability-01
  ├─ feat/mp-v6-dsh-docker-01
  └─ ...
```

### 2.2 每个 Round 标准流程

```bash
# Step 1: 拉最新 main
git checkout main && git pull origin main

# Step 2: 创建 Batch 分支
BATCH=$(echo "$ACTIVE_BATCH" | tr '[:upper:]' '[:lower:]')
BRANCH="feat/${BATCH}"
git checkout -b "$BRANCH"

# Step 3: 执行任务
# 读 docs/active/batch/${ACTIVE_BATCH}.md
# 按任务清单逐项完成
# 写 evidence/${ACTIVE_BATCH}-ACCEPTANCE.md

# Step 4: 提交（Conventional Commits）
git add .
git commit -m "feat(scope): ${ACTIVE_BATCH} completed"
git push origin "$BRANCH"

# Step 5: 创建 PR
gh pr create \
  --base main \
  --head "$BRANCH" \
  --title "feat: ${ACTIVE_BATCH}" \
  --body-file .github/PULL_REQUEST_TEMPLATE.md

# Step 6: 等待 CI 通过 + 合并
gh pr checks --watch
gh pr merge --squash --delete-branch

# Step 7: 同步本地 + 准备下一 Round
git checkout main && git pull origin main
```

### 2.3 严格规则

- ✅ **PR 标题**：`feat(scope): MP-V6-BATCH-NN`
- ✅ **commit 信息**：Conventional Commits（`feat:` / `fix:` / `chore:` / `docs:`）
- ✅ **squash merge**（保持 main 线性历史）
- ❌ **不直 push main**
- ❌ **不 merge 自己的 PR**（除非配置 auto-merge）
- ❌ **不写 Python 业务代码**（v6.0 用 TypeScript）

---

## 3. 8 项 CI Gate（合并前必须全部通过）

| # | Gate | 说明 |
|---|---|---|
| 1 | **Lint** | ruff / ESLint |
| 2 | **Typecheck** | pyright-strict / tsc --noEmit |
| 3 | **Test** | pytest + vitest 100% pass |
| 4 | **Build** | pnpm build |
| 5 | **Evidence Document Check** | `evidence/<batch>-ACCEPTANCE.md` 存在 + 含关键章节 |
| 6 | **Secret Scan** | gitleaks 扫不到 Secret |
| 7 | **Helm + NetworkPolicy Validate** | kubeconform 校验 |
| 8 | **RLS Policy Check** | 所有 CREATE TABLE 必须 RLS 启用 |

**如果 CI 失败**：
- 看 `gh run view <run-id> --log-failed`
- 修复后 `git commit --amend` 或新 commit
- `git push --force-with-lease`

---

## 4. Evidence 文档规范

每个 Batch 必须写 `evidence/<batch>-ACCEPTANCE.md`：

```markdown
# MP-V6-FOUNDATION-01 - ACCEPTANCE

> **状态**：Accepted / Pending Acceptance
> **日期**：2026-XX-XX
> **关联 Batch**：[docs/active/batch/MP-V6-FOUNDATION-01.md](../batch/MP-V6-FOUNDATION-01.md)
> **关联 spec**：[docs/active/specs/2026-08-19-mp-v6-architecture.md](../../specs/2026-08-19-mp-v6-architecture.md)

## 验收标准

<!-- 复制 Batch 文档中的 AC，每项勾选 [x] -->
- [x] K8s 集群 3 套（prod / staging / dev）
- [x] Supabase 8 能力全部部署
- [x] RLS baseline 生效
- [x] NetworkPolicy default-deny
- [x] PG 自动备份
- [x] 9 个 namespace 创建
- [x] dsh 服务可访问 Supabase

## 测试结果

- 单元测试：X 个通过
- 集成测试：Y 个通过
- e2e 测试：Z 个通过
- 覆盖率：XX%

## 部署验证

- dev 环境：✅ http://dev.mp-platform.local
- staging 环境：✅ http://staging.mp-platform.local
- 截图：见 https://github.com/.../runs/XXXXXX

## 风险与缓解

<!-- 实施过程中的风险点 + 解决方式 -->

## 评审 checklist

- [x] spec 一致性
- [x] RLS / 多租户隔离
- [x] OTel trace 完整
- [x] Secret 不进 git
- [x] 13 硬规则关键项（RLS / 不 fallback / OTel / Secret / NetworkPolicy）
```

---

## 5. Round 1：MP-V6-FOUNDATION-01（4 周）

**文件**：`docs/active/batch/MP-V6-FOUNDATION-01.md`

**核心交付**：
- K8s 集群 3 套（prod / staging / dev）
- Supabase 8 能力（PG + Auth + Realtime + Storage + Edge + PostgREST + Studio + Vector）
- RLS baseline（所有表 tenant 隔离）
- NetworkPolicy default-deny
- PG 自动备份
- 9 个 namespace 创建

**任务清单**（按周）：

### Week 1：K8s 基础设施

- [ ] 创建 K8s 集群（生产 + staging + dev）
- [ ] 部署 cert-manager（Let's Encrypt）
- [ ] 部署 ArgoCD
- [ ] 部署 Vault 或 ExternalSecrets
- [ ] 创建 9 个 namespace（mp-platform / mp-frontend / mp-runtime / mp-business / mp-ai / mp-orchestration / mp-integration / mp-data / mp-monitoring / mp-infra）

### Week 2：Supabase 自托管

- [ ] 用 Supabase 官方 Helm chart 部署
- [ ] 配置 PG（含 pgvector 扩展）
- [ ] 配置 Auth (GoTrue)
- [ ] 配置 Realtime
- [ ] 配置 Storage
- [ ] 配置 Edge Functions runtime
- [ ] 配置 PostgREST
- [ ] 配置 Studio
- [ ] 验证 8 个能力全部可用

### Week 3：RLS + 安全 + 备份

- [ ] 创建 baseline RLS policy（所有表 tenant 隔离）
- [ ] 创建 baseline audit_log 表
- [ ] 配置 PG 自动备份（WAL 归档）
- [ ] 配置 K8s NetworkPolicy（默认 deny + 白名单）
- [ ] 配置 ExternalSecret（API Key 等不进 git）
- [ ] 验证 dsh 服务可以从 K8s 内访问 Supabase

### Week 4：集成验证 + 文档

- [ ] 端到端测试：创建租户 → 登录 → 写入数据 → RLS 隔离生效
- [ ] 写 deployment runbook
- [ ] 写 BACKUP_RPO_RTO 文档
- [ ] evidence/MP-V6-FOUNDATION-01-ACCEPTANCE.md
- [ ] 通知下游 Batch 可启动

**完成标志**：
- `evidence/MP-V6-FOUNDATION-01-ACCEPTANCE.md` 写完
- PR 合并到 main
- 自动进入 Round 2

---

## 6. Round 2：MP-V6-TEMPORAL-01（3 周）

**前置**：Round 1 完成（main 已包含 FOUNDATION）

**文件**：`docs/active/batch/MP-V6-TEMPORAL-01.md`

**核心交付**：
- Temporal Server（gRPC `:7233`）+ Temporal UI（`:8233`）
- 复用 Supabase Postgres（schema `temporal`）
- Temporal Worker（Node SDK）部署到 K8s
- hello world workflow 跑通
- 24h 长任务测试通过

**任务清单**：

### Week 1：Postgres 准备 + Temporal 部署

- [ ] Supabase PG 创建 `temporal` schema + migration
- [ ] 部署 Temporal Server（Helm chart）
- [ ] 配置 DB connection（专用 user）
- [ ] 验证 Temporal gRPC `:7233` 可访问
- [ ] 验证 Temporal UI `:8233` 可访问

### Week 2：Worker SDK + 集成测试

- [ ] 创建 Temporal Worker（Node SDK）基础工程
- [ ] 部署到 K8s mp-orchestration namespace
- [ ] 测试 hello world workflow
- [ ] 测试 signal 双向通信
- [ ] 测试 Activity heartbeat

### Week 3：长任务 + 兜底

- [ ] 测试 24h 长任务（wait_condition）
- [ ] 测试 Activity retry + backoff
- [ ] 配置 Temporal metrics 上报 OTel
- [ ] 文档 + evidence/MP-V6-TEMPORAL-01-ACCEPTANCE.md
- [ ] 通知下游 Batch 可启动

**完成标志**：
- evidence 写完
- PR 合并
- 自动进入 Round 3

---

## 7. Round 3：MP-V6-OBSERVABILITY-01（2 周）

**前置**：Round 1 完成（Round 2 可同时进行）

**文件**：`docs/active/batch/MP-V6-OBSERVABILITY-01.md`

**核心交付**：
- OTel Collector + Tempo + Prometheus + Loki + Grafana
- 4 个基础 Dashboard（应用健康 / K8s / Supabase PG / Temporal）
- 告警规则（Critical / Warning / Info）

**任务清单**：

### Week 1：OTel + 存储

- [ ] 部署 OTel Collector（Helm）
- [ ] 部署 Tempo
- [ ] 部署 Prometheus
- [ ] 部署 Loki
- [ ] 部署 Grafana
- [ ] 配置数据源

### Week 2：Dashboard + 告警

- [ ] 创建基础 Dashboard（应用 / K8s / Supabase / Temporal）
- [ ] 配置告警规则（Critical / Warning / Info）
- [ ] 配置通知渠道（邮件 / 钉钉 / Slack）
- [ ] 验证：从某个测试应用上报数据 → Grafana 显示
- [ ] evidence/MP-V6-OBSERVABILITY-01-ACCEPTANCE.md

**完成标志**：
- evidence 写完
- PR 合并
- 自动进入 Round 4

---

## 8. Round 4：MP-V6-DSH-DOCKER-01（2 周）

**前置**：Round 1 完成（Harbor 已就绪）

**文件**：`docs/active/batch/MP-V6-DSH-DOCKER-01.md`

**核心交付**：
- dsh Dockerfile 多阶段（deps / build / runtime）
- 基础镜像 `node:22.19-alpine`
- 非 root 用户（uid 1001）+ tini
- 镜像大小 ≤ 500MB
- GitHub Actions 自动 build + push Harbor
- trivy 扫描无 High/Critical

**dsh 源码**：
- 仓库：https://github.com/deepseek-ai/deepseek-harness
- 路径：`apps/web` + `apps/cli` + `packages/*`
- 包管理：pnpm workspaces

**任务清单**：

### Week 1：Dockerfile + CI

- [ ] 写 `Dockerfile`（多阶段）
- [ ] 写 `.dockerignore`
- [ ] 本地 build 测试（确保能跑 `pnpm dsh web`）
- [ ] 写 `.github/workflows/dsh-build.yml`（如果还没有）
- [ ] 配置 Harbor 凭证（GitHub Secrets）

### Week 2：Harbor + 镜像扫描

- [ ] 部署 / 配置 Harbor（如果未部署）
- [ ] 创建项目 `mp`
- [ ] 集成 trivy 镜像扫描
- [ ] 集成 cosign 签名（可选）
- [ ] 验证：tag 触发后自动 build + push
- [ ] evidence/MP-V6-DSH-DOCKER-01-ACCEPTANCE.md

**完成标志**：
- evidence 写完
- PR 合并
- **Sprint 0 完成**

---

## 9. Loop End（4 Round 全完成后）

```bash
# 最后一步：检查所有 evidence
ls evidence/MP-V6-*-ACCEPTANCE.md
# 应输出 4 个文件
```

输出以下总结：

```markdown
Sprint 0 完成总结：

## 已交付 Batch

- ✅ MP-V6-FOUNDATION-01 — K8s + Supabase 8 能力就绪
- ✅ MP-V6-TEMPORAL-01 — Temporal Cluster + Worker 就绪
- ✅ MP-V6-OBSERVABILITY-01 — OTel + Grafana 就绪
- ✅ MP-V6-DSH-DOCKER-01 — dsh 镜像就绪

## Sprint 0 状态

- 4 个 Batch 全部合并到 main
- 4 份 evidence 文档齐全
- 8 项 CI gate 全部跑通

## 下一步建议启动 Sprint 1

- MP-V6-DSH-01（dsh 60 包集成 + vendor）
- MP-V6-DSH-POSTGRES-BACKEND-01（自建 session 持久化）
- MP-V6-AUTH-01（Supabase Auth + RLS）
- MP-V6-HITL-HUB-01（HITL Hub 4 种类型）
- MP-V6-ONTOLOGY-GEN-01（本体生成 + 预览）
- MP-V6-LLM-01（dsh llm-pi-ai 配置）
- MP-V6-SANDBOX-01（dsh sandbox + K8s Job）

如需继续 Sprint 1，请告诉我「启动 Sprint 1」。
```

---

## 10. 严格规则（每步都要遵守）

### 必做 ✅

- 每个 Batch 完整执行任务清单，**不简化、不跳过**
- 所有 AC 验收标准全部勾选
- 所有 Secret 走 ExternalSecret / Vault，**永远不进 git**
- Conventional Commits 格式
- evidence 文档写完
- 8 项 CI gate 全部通过
- 遇到问题先查 spec，**不要凭直觉决策**
- 用 TodoWrite 跟踪任务进度

### 必不做 ❌

- 不简化任务清单
- 不跳过 AC 验收
- 不写 Python 业务代码（v6.0 用 TypeScript）
- 不直 push 到 main
- 不 merge 自己的 PR
- 不把 Secret push 到 git
- 不修改 v3.0 仓库（已 archived）
- 在没有 evidence 的情况下不 合 PR

---

## 11. 异常处理

### 任务卡住 >30 分钟

```bash
# 1. 看具体哪个任务
cat evidence/<batch>-ACCEPTANCE.md

# 2. 看 CI 日志
gh run view <run-id> --log-failed

# 3. 看 spec
grep -A 20 "<卡住的任务>" docs/active/specs/*.md

# 4. 问用户（如果还不清楚）
# 暂停 loop，向用户报告：具体卡哪、已查过什么、需要什么信息
```

### CI 失败

```bash
# 看失败原因
gh run view <run-id> --log-failed | head -100

# 修复后 amend 或新 commit
git add . && git commit --amend --no-edit
git push --force-with-lease
```

### 分支冲突

```bash
git fetch origin
git rebase origin/main
# 解决冲突后
git add . && git rebase --continue
git push --force-with-lease
```

### 找不到文档

```bash
# 列出所有文档
find docs -name "*.md" | sort
# 找 Batch 文档
ls docs/active/batch/
# 找 spec
ls docs/active/specs/
```

---

## 12. 紧急停止 / 继续

### 暂停 loop

- **Ctrl + C**（最直接）
- 或关闭 terminal

### 恢复

```bash
# 1. 检查当前状态
cd /path/to/MetaPlatform-Ontology
git status
git log --oneline -5
gh pr list --state open

# 2. 同步最新
git checkout main && git pull origin main

# 3. 继续 loop
claude --loop .claude/loop-prompt.md --batch <未完成的 Batch>

# 4. Claude Code 会从断点继续
# 已 commit 的不会丢
```

### 跳过当前 Batch

```bash
# 找下一个未完成 Batch
./scripts/loop/next-batch.sh

# 跑下一个
claude --loop .claude/loop-prompt.md --batch <下一个>
```

---

## 13. 验证清单（每个 Round 完成后）

```bash
# 1. evidence 存在
ls evidence/$ACTIVE_BATCH-ACCEPTANCE.md

# 2. CI 8 项 gate 全过
gh pr checks <PR-number>
# 期望：所有 required checks 通过

# 3. PR 合并
gh pr view <PR-number> --json state -q .state
# 期望："MERGED"

# 4. 分支自动删除
git branch -r | grep $BATCH
# 期望：空

# 5. 准备下一 Round
git checkout main && git pull
# 输出：当前在 main，最新 commit 是 $ACTIVE_BATCH
```

---

## 14. 第一次启动（如果这是第一个 Round）

```bash
# 1. 确认前置
ls docs/active/batch/MP-V6-FOUNDATION-01.md
ls .claude/loop-prompt.md   # 本文档
ls .github/workflows/        # 4 个 workflow

# 2. 设置 active batch
ACTIVE_BATCH="MP-V6-FOUNDATION-01"

# 3. 初始化
./scripts/loop/new-batch.sh $ACTIVE_BATCH
# → 创建分支 feat/mp-v6-foundation-01
# → 创建 evidence 模板

# 4. 读任务清单
cat docs/active/batch/$ACTIVE_BATCH.md

# 5. 开始 Round 1
# （按 §5 任务清单执行）
```

---

## 15. 给自己的提示

执行每个 Round 时，**按这个顺序思考**：

1. **读 Batch 文档**（`docs/active/batch/<batch>.md`）
2. **创建分支**（`feat/mp-v6-<batch>`）
3. **用 TodoWrite 列任务清单**
4. **逐项完成 + 标记 [x]**
5. **写 evidence 文档**
6. **本地检查**：lint / typecheck / test / build
7. **commit + push**
8. **创建 PR**
9. **等 CI 8 项 gate + 合并**
10. **切回 main + 拉最新**
11. **找下一 Batch**（`./scripts/loop/next-batch.sh`）
12. **自动进入下一 Round**

**重复 1-12 直到 4 Round 完成**。

---

*MetaPlatform v6.0 - Claude Code Loop Prompt 完毕。*

*启动命令*：`claude --loop .claude/loop-prompt.md --batch MP-V6-FOUNDATION-01`