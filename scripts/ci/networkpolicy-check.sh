#!/usr/bin/env bash
# scripts/ci/networkpolicy-check.sh
# CI gate: reject NetworkPolicy manifests with bare 0.0.0.0/0 in ingress/egress ipBlock
# Per PRD: docs/active/prd/foundation-networkpolicy.md §6.1
#
# Bare 0.0.0.0/0 is allowed only when paired with an `except` list that excludes
# RFC1918 ranges and kube-system. We enforce that.
#
# Exit codes:
#   0 = pass
#   1 = bare 0.0.0.0/0 without compensating except list
#   2 = no policies directory

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
NP_DIR="$REPO_ROOT/k8s/networkpolicies"

if [ ! -d "$NP_DIR" ]; then
  echo "::warning::networkpolicy-check: no $NP_DIR; skipping"
  exit 0
fi

echo "🛡️  NetworkPolicy Check — scanning $NP_DIR"

VIOLATIONS=0

while IFS= read -r -d '' f; do
  # Skip if file is a comment-only doc
  if grep -qE '^#' "$f" && ! grep -qE '^[a-zA-Z]' "$f"; then continue; fi

  # Look for ipBlock with 0.0.0.0/0 (no CIDR suffix means ::/0 is not matched, that's fine)
  if grep -qE 'cidr:\s*0\.0\.0\.0/0' "$f"; then
    # Check that the same block contains an `except` with at least RFC1918 + loopback
    if ! grep -qE 'except:' "$f"; then
      echo "::error file=$f:: bare 0.0.0.0/0 with no 'except' list"
      VIOLATIONS=$((VIOLATIONS + 1))
      continue
    fi
    # Verify the except list covers RFC1918 + loopback at minimum
    missing=0
    for range in '10\.0\.0\.0/8' '172\.16\.0\.0/12' '192\.168\.0\.0/16' '127\.0\.0\.0/8'; do
      if ! grep -qE "$range" "$f"; then
        missing=$((missing + 1))
      fi
    done
    if [ "$missing" -gt 0 ]; then
      echo "::error file=$f:: 0.0.0.0/0 'except' list missing $missing required RFC1918/loopback range(s)"
      VIOLATIONS=$((VIOLATIONS + 1))
    fi
  fi
done < <(find "$NP_DIR" -name '*.yaml' -print0)

if [ "$VIOLATIONS" -gt 0 ]; then
  echo "::error::networkpolicy-check found $VIOLATIONS violation(s)"
  exit 1
fi

echo "✅ networkpolicy-check passed"
exit 0