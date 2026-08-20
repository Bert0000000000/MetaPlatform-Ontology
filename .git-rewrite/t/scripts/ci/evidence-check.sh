#!/usr/bin/env bash
# scripts/ci/evidence-check.sh
# CI gate: for any Batch branch (feat/mp-v6-<batch>), require evidence/<BATCH>-ACCEPTANCE.md
# with the three required sections.
#
# Per PRD: docs/active/prd/README.md + .claude/loop-prompt.md §4
#
# Required sections (Chinese + English accepted):
#   - "验收标准" or "Acceptance Criteria"
#   - "测试结果" or "Test Results"
#   - "部署验证" or "Deployment Verification"
#
# Exit codes:
#   0 = pass (or not a Batch branch)
#   1 = missing evidence file
#   2 = missing required section

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# Determine current branch
BRANCH="${BRANCH:-${GITHUB_HEAD_REF:-${GITHUB_REF_NAME:-}}}"
if [ -z "$BRANCH" ] || ! git -C "$REPO_ROOT" rev-parse --verify "$BRANCH" >/dev/null 2>&1; then
  BRANCH="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")"
fi

# Skip if not a Batch branch
if [[ ! "$BRANCH" =~ ^feat/mp-v6-(.+)$ ]]; then
  echo "⏭️  evidence-check skipped (branch '$BRANCH' is not a Batch branch)"
  exit 0
fi

BATCH_ID="${BASH_REMATCH[1]^^}"  # uppercase
EVIDENCE_FILE="$REPO_ROOT/evidence/MP-V6-${BATCH_ID}-ACCEPTANCE.md"

echo "📄 Evidence Check — branch: $BRANCH → $EVIDENCE_FILE"

if [ ! -f "$EVIDENCE_FILE" ]; then
  echo "::error::evidence file not found: $EVIDENCE_FILE"
  echo "::error::each Batch PR must include evidence/<BATCH>-ACCEPTANCE.md"
  exit 1
fi

# Check required sections (Chinese keywords first, English fallback)
MISSING=0
for section_pattern in '验收标准|Acceptance Criteria' '测试结果|Test Results' '部署验证|Deployment Verification'; do
  if ! grep -qE "$section_pattern" "$EVIDENCE_FILE"; then
    echo "::warning::$EVIDENCE_FILE 缺少 '${section_pattern}' 章节"
    MISSING=$((MISSING + 1))
  fi
done

if [ "$MISSING" -gt 0 ]; then
  echo "::error::evidence-check: $MISSING required section(s) missing in $EVIDENCE_FILE"
  exit 2
fi

# Check that AC items are at least marked (best-effort: look for at least one `[x]` or `[X]`)
if ! grep -qE '\[(x|X|✔)\]' "$EVIDENCE_FILE"; then
  echo "::warning::$EVIDENCE_FILE 没有勾选的 AC 项（请检查是否真的全部通过）"
fi

echo "✅ evidence-check passed: $EVIDENCE_FILE"
exit 0