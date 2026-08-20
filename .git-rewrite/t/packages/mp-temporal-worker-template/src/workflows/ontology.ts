/**
 * packages/mp-temporal-worker-template/src/workflows/ontology.ts
 * PRD: docs/active/prd/ontology-gen.md §4.3
 * Batch: MP-V6-ONTOLOGY-GEN-01
 *
 * previewOntologyChangeWorkflow + applyOntologyChangeWorkflow
 */

import { proxyActivities, condition } from '@temporalio/workflow';
import type { TenantContext } from '../context.js';

const defaultActivityOptions = {
  startToCloseTimeout: '30s',
  retry: { maximumAttempts: 3, backoffCoefficient: 2.0 },
};

const activities = proxyActivities({
  defaultOptions: defaultActivityOptions,
});

export interface PreviewInput {
  changeId: string;
  tenantId: string;
  actorId: string;
}

export interface PreviewOutput {
  hitlRequestId: string;
  diff: Record<string, unknown>;
}

export async function previewOntologyChangeWorkflow(input: PreviewInput): Promise<PreviewOutput> {
  // 1. 读 pending_object_changes
  const change = await activities.readPendingChange({ change_id: input.changeId });

  // 2. 生成 unified diff (JSON 形式)
  const diff = await activities.computeOntologyDiff({
    change_id: input.changeId,
    payload: change.payload,
    change_type: change.change_type,
  });

  // 3. 写 hitl_requests (action_confirm)
  const hitlRequest = await activities.createHitlRequest({
    tenant_id: input.tenantId,
    type: 'action_confirm',
    title: `预览本体变更: ${change.title ?? change.object_type_rid}`,
    context: {
      change_id: input.changeId,
      diff,
      change_type: change.change_type,
    },
    approver_user_ids: change.approver_user_ids ?? [input.actorId],
    timeout_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  });

  // 4. Realtime broadcast (Diff viewer 立即显示)
  await activities.broadcastOntologyPreview({
    tenant_id: input.tenantId,
    change_id: input.changeId,
    diff,
    hitl_request_id: hitlRequest.id,
  });

  return { hitlRequestId: hitlRequest.id, diff };
}

export async function applyOntologyChangeWorkflow(input: PreviewInput): Promise<{ applied: boolean; error?: string }> {
  // 1. 校验 HITL 已批准
  const approved = await activities.checkHitlApproved({
    change_id: input.changeId,
  });

  if (!approved) {
    return { applied: false, error: 'HITL not approved' };
  }

  // 2. 事务性应用本体变更 (PG advisory lock 防并发)
  try {
    await activities.applyOntologyChangeTxn({
      change_id: input.changeId,
      actor_id: input.actorId,
    });

    // 3. 更新 pending_object_changes.status='applied'
    await activities.markChangeApplied({ change_id: input.changeId });

    // 4. Realtime broadcast
    await activities.broadcastOntologyApplied({
      tenant_id: input.tenantId,
      change_id: input.changeId,
    });

    return { applied: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { applied: false, error: message };
  }
}