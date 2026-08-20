# 启动 MetaPlatform v6.0 开发

> **给 Claude Code 的指令**：按顺序执行本文档的每一步。每一步完成后告诉我「Step X 完成」，再继续。

---

## 任务概述

启动 MetaPlatform v6.0 开发 Sprint 0 的4 个 P0 Batch：

1. `MetaPlatform-FOUNDATION-01`（4 周）— 基础设施
2. `MetaPlatform-TEMPORAL-01`（3 周）— Temporal 集群
3. `MetaPlatform-OBSERVABILITY-01`（2 周）— 可观测层
4. `MetaPlatform-DSH-DOCKER-01`（2 周）— dsh 镜像

预计 **10 周串行**（依赖关系）/ **5 周并行**（FOUNDATION 是关键路径）。

---

## 前置：检查环境

**第一步先检查环境**：

```bash
# 检查工具是否齐全
command -v gh      && echo "gh ✅" || echo "gh ❌ 需要安装"
command -v node    && node --version   # 需 22.19+
command -v pnpm     && pnpm --version   # 需 10+
command -v kubectl && kubectl version --client
command -v helm     && helm version
command -v docker   && docker --version
command -v claude   && claude --version  # Claude Code

# 检查 GitHub 登录
gh auth status

# 检查 K8s 集群
kubectl cluster-info

# 检查 Harbor（如果已部署）
curl -I https://harbor.mp-platform.local 2>/dev/null | head -1
```

**如果有任何 ❌，先解决再继续。**

---

## Step 1：Archive v3.0 仓库（30 分钟）

**目标**：v3.0 仓库标记为 archived，关闭自动 CI。

```bash
# 1. 找出 v3.0 仓库（替换为实际仓库名）
V3_REPO="your-org/mp-platform-v3"  # ← 改这里
gh repo view "$V3_REPO"

# 2. 关闭 v3.0 自动 CI（保留 manual）
gh api repos/$V3_REPO/contents/.github/workflows -H "Accept: application/vnd.github+json" 2>/dev/null
# 如果有 workflow，逐一编辑删除自动触发器

# 3. Archive v3.0（GitHub UI 操作）
echo "请打开 GitHub UI: https://github.com/$V3_REPO/settings"
echo "  → 底部 Danger Zone"
echo "  → Archive this repository"
echo "  → 输入仓库名确认"
echo "完成后告诉我"
```

**验证**：

```bash
gh repo view "$V3_REPO" --json isArchived -q .isArchived
# 应输出 true
```

---

## Step 2：新建 MetaPlatform-Ontology 仓库（1 小时）

**目标**：创建 v6.0 仓库，把工作目录的文件全部 push 上去。

```bash
# 1. 创建仓库（替换为实际 org）
ORG="your-org"  # ← 改这里
gh repo create "$ORG/MetaPlatform-Ontology" \
  --private \
  --description "MetaPlatform v6.0 - Ontology-driven enterprise AI platform" \
  --clone

cd MetaPlatform-Ontology

# 2. 复制工作目录的文件到新仓库
# （当前 working directory 已经有 docs/ / scripts/ / .claude/ 等）
# 用 rsync 或 cp 复制
WORK_DIR="/path/to/your/working/directory"  # ← 改这里
rsync -av --exclude='.git' "$WORK_DIR/" ./

# 3. 首次提交git add .
git commit -m "feat: initial v6.0 documentation + CI/CD + workflow templates"
git push origin main

# 4. 设置默认分支
gh api repos/$ORG/MetaPlatform-Ontology -X PATCH \
  --field default_branch=main
```

**验证**：

```bash
gh repo view "$ORG/MetaPlatform-Ontology" --json name,defaultBranchRef
# 应输出 MetaPlatform-Ontology / main
ls docs/active/specs/
# 应看到 3 个 spec 文件
ls docs/active/workflows/
# 应看到 4 个 yml 文件
ls scripts/loop/
# 应看到 2 个 sh 脚本
```

---

## Step 3：配置 GitHub Secrets + 分支保护（15 分钟）

```bash
ORG="your-org"

# 1. Secrets（如果还没有，问我）
gh secret set ANTHROPIC_API_KEY      # Claude Code API key（问我）
gh secret set HARBOR_USERNAME       # 问我
gh secret set HARBOR_PASSWORD       # 问我
gh secret set ARGOCD_SERVER          # 问我
gh secret set ARGOCD_USERNAME        # 问我
gh secret set ARGOCD_PASSWORD        # 问我
gh secret set SLACK_WEBHOOK_PROD     # 问我

# 2. main 分支保护（8 项 required checks）
gh api repos/$ORG/MetaPlatform-Ontology/branches/main/protection \
  --input - <<'EOF'
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "Lint", "Typecheck", "Test", "Build",
      "Evidence Document Check", "Secret Scan",
      "Helm + NetworkPolicy Validate", "RLS Policy Check"
    ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true
  },
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false
}
EOF

# 3. 启用 squash merge only
gh api repos/$ORG/MetaPlatform-Ontology -X PATCH \
  --input '{"allow_squash_merge": true, "allow_merge_commit": false, "allow_rebase_merge": false, "delete_branch_on_merge": true}'
```

**验证**：

```bash
gh api repos/$ORG/MetaPlatform-Ontology/branches/main/protection | head -50
# 应看到 required_status_checks 和 required_pull_request_reviews 都已配置
```

---

## Step 4：复制 4 个 GitHub Actions workflow（10 分钟）

```bash
ORG="your-org"

# 1. 复制 4 个 workflow 文件到新仓库（如果 rsync 没复制）
mkdir -p .github/workflows
cp docs/active/workflows/ci.yml .github/workflows/
cp docs/active/workflows/release.yml .github/workflows/
cp docs/active/workflows/deploy-prod.yml .github/workflows/
cp docs/active/workflows/claude-loop.yml .github/workflows/

# 2. 提交并 push
git add .github/workflows/
git commit -m "ci: add v6.0 CI/CD workflows (4 files)"
git push origin main

# 3. 验证 Actions 已加载
gh api repos/$ORG/MetaPlatform-Ontology/actions/workflows | jq '.workflows[].name'
# 应输出 4 个 workflow name
```

**注意**：第一次 push 后，CI 会自动跑（lint / typecheck / test / build）。**这次可能失败**，因为还没有代码。我们只是把 workflow 框架先就位。失败没关系，等 Step 5 第一个 Batch 执行时会再 push。

---

## Step 5：启动第一个 Batch（MetaPlatform-FOUNDATION-01）

**目标**：用 Claude Code loop 启动第一个 Batch。

```bash
# 1. 创建 .claude 目录
mkdir -p .claude

# 2. 复制 loop prompt（如果还没有）
ls .claude/loop-prompt.md
# 如果没有，告诉我，让我提供

# 3. 初始化 Batch
chmod +x scripts/loop/*.sh
./scripts/loop/new-batch.sh MetaPlatform-FOUNDATION-01
```

**输出**：
```
✅ Batch 初始化完成
分支：feat/mp-v6-foundation-01
下一步：claude --loop .claude/loop-prompt.md --batch MetaPlatform-FOUNDATION-01
```

```bash
# 4. 启动 Claude Code loop
claude --loop .claude/loop-prompt.md --batch MetaPlatform-FOUNDATION-01
```

**Claude Code 会自动**：
- git checkout 到新分支
- 按 MetaPlatform-FOUNDATION-01 任务清单执行 4 周任务
- 写 evidence/MetaPlatform-FOUNDATION-01-ACCEPTANCE.md
- commit + push + 创建 PR
- 等 CI 8 项 gate + 合并
- **自动进入下一 Batch**（MetaPlatform-TEMPORAL-01）

---

## Step 6：监控进度

**Claude Code 跑起来后，定期检查**：

```bash
# 看当前在跑哪个 Batch
gh pr list --state open --label "batch"

# 看 CI 状态
gh run list --workflow=ci.yml --limit 5

# 看 evidence 文档
cat evidence/MetaPlatform-*-ACCEPTANCE.md | head -50

# 看所有 Batch 进度
./scripts/loop/next-batch.sh
# 输出下一个未完成 Batch
```

---

## Step 7：自动接力

**Claude Code loop 会自动**：
- 完成一个 Batch → 写 evidence → 推 PR → 合并
- 自动找下一个未完成 Batch
- 重复直到所有 Sprint 0 Batch 完成

**你只需要**：
- 回答 Claude Code 的问题
- 评审 PR
- 监督进度

---

## 紧急停止 / 继续

```bash
# 暂停 Claude Code loop
# 直接 Ctrl+C 或关闭 terminal# 恢复
cd MetaPlatform-Ontology
git checkout main && git pull
claude --loop .claude/loop-prompt.md --batch MetaPlatform-FOUNDATION-01
# 它会从断点继续（git 已 commit 过的不会丢）

# 跳过当前 Batch
claude --loop .claude/loop-prompt.md --next
# 自动找下一个未完成 Batch

# 完全停止
# Ctrl+C 即可
```

---

## 验证清单（每一步执行后跑）

| Step | 验证命令 | 期望输出 |
|---|---|---|
| 前置 | `gh auth status` | 登录 OK |
| Step 1 | `gh repo view $V3_REPO --json isArchived` | `true` |
| Step 2 | `ls docs/active/workflows/` | 4 个 yml 文件 |
| Step 3 | `gh api repos/$ORG/.../protection` | 8 个 required checks |
| Step 4 | `gh api .../actions/workflows \| jq '.workflows\|length'` | `4` |
| Step 5 | `gh pr list --state open` | 1 个 PR（FOUNDATION）|
| Sprint 0 末 | `ls evidence/MetaPlatform-*-ACCEPTANCE.md` | 4 个 ACCEPTANCE 文件 |

---

## 完成判据

当看到以下输出时，Sprint 0 完成：

```bash
ls evidence/MetaPlatform-*-ACCEPTANCE.md
# MetaPlatform-FOUNDATION-01-ACCEPTANCE.md
# MetaPlatform-TEMPORAL-01-ACCEPTANCE.md
# MetaPlatform-OBSERVABILITY-01-ACCEPTANCE.md
# MetaPlatform-DSH-DOCKER-01-ACCEPTANCE.md
```

**Sprint 0 完成 = 4 个 Batch 全部合并到 main + 4 份 evidence 文档**。

---

## 给 Claude Code 的补充指令

**如果遇到任何问题**：
1. **先看 spec**：`docs/active/specs/*.md` 通常有答案
2. **看 Batch 文档**：`docs/active/batch/MetaPlatform-*.md` 有详细任务清单
3. **看 evidence 检查**：`cat evidence/MetaPlatform-*.md` 看历史错误
4. **问用户**（在 Step 里问的）— 如果 secrets 没配置、K8s 集群没准备等

**严格规则**：
- ❌ 不简化任务清单
- ❌ 不跳过 AC
- ❌ 不写 Python（v6.0 用 TypeScript）
- ❌ 不 push Secret 到 git
- ✅ 完整执行 4 周任务
- ✅ 写完整 evidence
- ✅ 跑通 8 项 CI gate 才能 merge
- ✅ 用 Conventional Commits

---

*启动完毕。开始执行吧。*