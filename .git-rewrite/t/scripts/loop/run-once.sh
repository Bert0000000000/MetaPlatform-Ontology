#!/usr/bin/env bash
# scripts/loop/run-once.sh
# 单次 loop iteration: 探测下一个未完成 batch → 创建分支 → 输出任务清单
#
# 用法 (CronCreate 30min cadence):
#   bash scripts/loop/run-once.sh
#
# 实际执行 task 的部分留给 AI 协作者 (人 / Claude Code) — 本脚本只做"探测 + 报告".
# AI 协作者再根据 next-batch 输出, 按 docs/active/batch/<batch>.md 任务清单执行.

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

echo "🔄 Loop iteration @ $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# 1. 探测 next batch
NEXT=$(bash scripts/loop/next-batch.sh 2>/dev/null | tail -1 || echo "")

if [ -z "$NEXT" ]; then
  echo "🎉 所有 Batch 已完成 (4 evidence 文件齐全)"
  exit 0
fi

echo "🎯 Next batch: $NEXT"

# 2. 输出本 batch 任务清单 (供 AI 协作者消费)
cat <<EOF

================================================================================
NEXT BATCH: $NEXT
================================================================================

📋 Task list: docs/active/batch/$NEXT.md
📑 PRDs (per-module): docs/active/prd/$NEXT-*.md

Recommended sequence (per Branch strategy in CONTRIBUTING.md):

  1. Read the Batch doc + all related PRDs
  2. Check evidence/$NEXT-ACCEPTANCE.md — initialize if absent
  3. Create branch:
     BRANCH="feat/$(echo $NEXT | tr '[:upper:]' '[:lower:]')"
     git checkout main && git pull
     git checkout -b "\$BRANCH"

  4. For each PRD module:
     - Write code per PRD §4 (Functional Requirements)
     - Run static checks: pnpm run validate:all
     - Commit with Conventional Commits:
       git add <files>
       git commit -m "feat(<scope>): $NEXT <module-name>"

  5. Update evidence/$NEXT-ACCEPTANCE.md — check off each AC
  6. Push + open PR:
     git push -u origin "\$BRANCH"
     gh pr create --base main --head "\$BRANCH" \\
       --title "feat(<scope>): $NEXT <short-desc>" \\
       --body-file .github/pull_request_template.md

  7. Wait for 8 CI gates → squash merge

================================================================================
EOF