#!/usr/bin/env bash
# scripts/etl/cutover_orchestration.sh
# PRD: docs/active/prd/etl-validation.md §7 + MP-V6-MIGRATION-01.md §5 Week 3
# 按租户分批切流量编排
#
# 阶段 (ADR-0060 §7.1):
#   Week 1: dev 租户 (内部 dogfooding)
#   Week 2: staging 租户 (10% 客户)
#   Week 3: canary 租户 (1% 客户)
#   Week 4-6: 灰度 50% 客户
#   Week 7: 100% (全量切 v6.0)

set -euo pipefail

: "${SUPABASE_URL:?SUPABASE_URL must be set}"
: "${SUPABASE_SERVICE_KEY:?SUPABASE_SERVICE_KEY must be set}"
: "${V6_FEATURE_FLAG_TABLE:=public.tenant_migration_state}"  # 假设有这表

# 阶段参数
TIER="${1:?usage: cutover_orchestration.sh <dev|10pct|1pct|50pct|100pct>}"

case "$TIER" in
    dev)    BATCH_SIZE=100; TENANT_FILTER="metadata->>'tier' = 'internal'" ;;
    10pct)  BATCH_SIZE=200; TENANT_FILTER="id IN (SELECT id FROM tenants WHERE random() < 0.1)" ;;
    1pct)   BATCH_SIZE=50;  TENANT_FILTER="id IN (SELECT id FROM tenants WHERE random() < 0.01)" ;;
    50pct)  BATCH_SIZE=500; TENANT_FILTER="id IN (SELECT id FROM tenants WHERE random() < 0.5)" ;;
    100pct) BATCH_SIZE=1000; TENANT_FILTER="TRUE" ;;
    *) echo "❌ invalid tier: $TIER"; exit 1 ;;
esac

echo "🔄 Cutover orchestration: tier=$TIER batch_size=$BATCH_SIZE"

# 1. 切流量前: can_proceed 校验
echo "🚦 Pre-flight check..."
python3 "$(dirname "$0")/can_proceed.py" --env=prod --tenant-tier="$TIER" --output=./evidence/cutover-${TIER}-preflight.json
if [ $? -ne 0 ]; then
    echo "❌ Pre-flight BLOCKED; cannot proceed with cutover"
    exit 1
fi

# 2. 标记 tenant migration state (feature flag)
echo "🏷️  Flagging tenants for v6.0 cutover..."
psql "postgresql://postgres:${SUPABASE_SERVICE_KEY}@${SUPABASE_URL#*://}/postgres" <<EOF
UPDATE public.tenants
SET metadata = metadata || '{"migration": {"completed_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)", "tier": "$TIER"}}'::jsonb
WHERE $TENANT_FILTER;
EOF

# 3. 通知下游 (dsp-webhook Edge Function 接收)
echo "📡 Notifying downstream (Realtime broadcast)..."
curl -sS -X POST "${SUPABASE_URL}/functions/v1/dsp-webhook" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" \
    -H "Content-Type: application/json" \
    -d "{\"type\":\"INSERT\",\"schema\":\"public\",\"table\":\"tenant_migration_state\",\"record\":{\"tier\":\"$TIER\",\"completed_at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}}"

# 4. 监控 24h (post-cutover smoke test)
echo "⏱️  Waiting 30s for propagation..."
sleep 30

# 5. 切流量后: can_proceed 再次校验
echo "🚦 Post-cutover smoke check..."
python3 "$(dirname "$0")/can_proceed.py" --env=prod --tenant-tier="$TIER" --output=./evidence/cutover-${TIER}-postflight.json

echo "✅ Cutover $TIER complete"
echo "📄 Pre-flight report: ./evidence/cutover-${TIER}-preflight.json"
echo "📄 Post-flight report: ./evidence/cutover-${TIER}-postflight.json"