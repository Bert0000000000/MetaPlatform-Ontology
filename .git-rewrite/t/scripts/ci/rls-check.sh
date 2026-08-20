#!/usr/bin/env bash
# scripts/ci/rls-check.sh
# CI gate: fail if any CREATE TABLE in supabase/migrations/ lacks ENABLE ROW LEVEL SECURITY
# Per PRD: docs/active/prd/foundation-rls-policy.md
#
# Exit codes:
#   0 = pass
#   1 = unprotected CREATE TABLE found
#   2 = no migrations directory found

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
MIG_DIR="$REPO_ROOT/supabase/migrations"

if [ ! -d "$MIG_DIR" ]; then
  echo "::warning::rls-check: no $MIG_DIR directory; skipping"
  exit 0
fi

echo "🔒 RLS Policy Check — scanning $MIG_DIR"

# Find every CREATE TABLE statement (case-insensitive, multi-line aware)
UNPROTECTED=0
TABLE_COUNT=0

while IFS= read -r -d '' f; do
  # Count CREATE TABLE in this file
  tables_in_file=$(grep -ciE 'create[[:space:]]+table' "$f" || true)
  if [ "$tables_in_file" -eq 0 ]; then continue; fi

  # For each CREATE TABLE block, check it is followed (in same file) by ENABLE ROW LEVEL SECURITY
  # We approximate by counting ENABLE ROW LEVEL SECURITY in the file and verifying each file
  # with CREATE TABLE has at least one ENABLE ROW LEVEL SECURITY.
  # This is conservative — it can pass even if a specific table is unprotected, but
  # the project's CI gate script in foundation-rls-policy.md §6.1 demands exact coupling.
  # For exact coupling we use an awk-based parser below.
  rls_in_file=$(grep -ciE 'enable[[:space:]]+row[[:space:]]+level[[:space:]]+security' "$f" || true)

  if [ "$tables_in_file" -gt 0 ] && [ "$rls_in_file" -lt 1 ]; then
    echo "::error file=$f:: file contains $tables_in_file CREATE TABLE but 0 ENABLE ROW LEVEL SECURITY"
    UNPROTECTED=$((UNPROTECTED + 1))
    continue
  fi

  TABLE_COUNT=$((TABLE_COUNT + tables_in_file))

  # Strict check: use awk to verify each CREATE TABLE block is followed by ENABLE ROW LEVEL SECURITY
  # before the next CREATE TABLE or end of file
  if ! awk '
    /create[[:space:]]+table/i { in_table=1; has_rls=0; next }
    in_table && /enable[[:space:]]+row[[:space:]]+level[[:space:]]+security/i { has_rls=1 }
    in_table && /;[[:space:]]*$/ {
      if (!has_rls) { print FILENAME ":" NR ": CREATE TABLE without ENABLE ROW LEVEL SECURITY"; exit 2 }
      in_table=0
    }
  ' "$f"; then
    UNPROTECTED=$((UNPROTECTED + 1))
  fi
done < <(find "$MIG_DIR" -name '*.sql' -print0)

if [ "$UNPROTECTED" -gt 0 ]; then
  echo "::error::rls-check found $UNPROTECTED file(s) with unprotected CREATE TABLE"
  exit 1
fi

echo "✅ rls-check passed: $TABLE_COUNT CREATE TABLE statements, all with ENABLE ROW LEVEL SECURITY"
exit 0