/**
 * packages/mp-hitl-hub/src/index.ts
 * PRD: docs/active/prd/hitl-hub.md §4.3
 * Batch: MetaPlatform-HITL-HUB-01
 *
 * HITL Hub Service SDK — 业务 Batch 调用入口
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

export type HitlType = 'workflow_saas' | 'workflow_dsh' | 'tool_dsh' | 'action_conf';
export type HitlStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled';

export interface HitlRequest {
  readonly tenantId: string;
  readonly type: HitlType;
  readonly title: string;
  readonly description?: string;
  readonly context: Record<string, unknown>;
  readonly approverUserIds: ReadonlyArray<string>;
  readonly timeoutAt: Date;          // ISO 8601, max 7 days
  readonly workflowId?: string;
  readonly escalationLevel?: number;
}

export interface HitlRecord extends HitlRequest {
  readonly id: string;
  readonly status: HitlStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateHitlHubOptions {
  readonly supabaseUrl: string;
  readonly supabaseKey: string;
}

export class HitlHub {
  private readonly supabase: SupabaseClient;

  constructor(opts: CreateHitlHubOptions) {
    this.supabase = createClient(opts.supabaseUrl, opts.supabaseKey);
  }

  /**
   * 创建 HITL 请求
   * - 写 hitl_requests 表 (RLS 自动按 tenant 隔离)
   * - Realtime broadcast hitl_request_created
   * - workflow_saas 类型: 调 SaaS adapter 创建外部审批
   */
  async requestHitl(req: HitlRequest): Promise<HitlRecord> {
    // 校验 timeout ≤ 7 天
    const maxTimeout = Date.now() + 7 * 24 * 60 * 60 * 1000;
    if (req.timeoutAt.getTime() > maxTimeout) {
      throw new Error('timeoutAt exceeds 7-day limit');
    }

    // 1. 写 hitl_requests
    const { data, error } = await this.supabase.from('hitl_requests').insert({
      tenant_id: req.tenantId,
      type: req.type,
      status: 'pending',
      title: req.title,
      description: req.description ?? null,
      context: req.context,
      approver_user_ids: req.approverUserIds,
      timeout_at: req.timeoutAt.toISOString(),
      workflow_id: req.workflowId ?? null,
      escalation_level: req.escalationLevel ?? 0,
    }).select().single();

    if (error || !data) throw new Error(`hitl_requests insert failed: ${error?.message}`);

    // 2. Realtime broadcast (前端 HITL 面板)
    await this.supabase.channel(`hitl:${req.tenantId}`).send({
      type: 'broadcast',
      event: 'hitl_request_created',
      payload: { id: data.id, type: req.type, title: req.title, timeout_at: req.timeoutAt },
    });

    // 3. workflow_saas 类型: 触发外部 SaaS 审批 (钉钉/飞书/企微)
    if (req.type === 'workflow_saas') {
      await this.dispatchToSaas(data.id, req);
    }

    return data as HitlRecord;
  }

  /**
   * 决策 HITL 请求
   * - 更新 status
   * - Temporal signal 唤醒 workflow (如有 workflow_id)
   * - Realtime broadcast hitl_decision_made
   */
  async decideHitl(opts: {
    hitlRequestId: string;
    decision: 'approved' | 'rejected';
    decidedBy: string;
    comment?: string;
  }): Promise<HitlRecord> {
    // 1. 查现有
    const { data: existing, error: fetchErr } = await this.supabase
      .from('hitl_requests')
      .select('*')
      .eq('id', opts.hitlRequestId)
      .single();

    if (fetchErr || !existing) throw new Error(`hitl_request not found: ${opts.hitlRequestId}`);
    if (existing.status !== 'pending') {
      throw new Error(`hitl_request already decided: ${existing.status}`);
    }

    // 2. 更新
    const { data, error } = await this.supabase.from('hitl_requests').update({
      status: opts.decision === 'approved' ? 'approved' : 'rejected',
      decided_at: new Date().toISOString(),
      decided_by: opts.decidedBy,
      decision_payload: { comment: opts.comment ?? null },
    }).eq('id', opts.hitlRequestId).select().single();

    if (error || !data) throw new Error(`hitl_requests update failed: ${error?.message}`);

    // 3. Temporal signal (如关联 workflow)
    if (existing.workflow_id) {
      await this.signalTemporal(existing.workflow_id, {
        decision: opts.decision,
        comment: opts.comment,
        decided_by: opts.decidedBy,
      });
    }

    // 4. Realtime broadcast
    await this.supabase.channel(`hitl:${existing.tenant_id}`).send({
      type: 'broadcast',
      event: 'hitl_decision_made',
      payload: { id: opts.hitlRequestId, decision: opts.decision },
    });

    return data as HitlRecord;
  }

  private async dispatchToSaas(hitlId: string, req: HitlRequest): Promise<void> {
    // 调对应 SaaS adapter (approval-saas-dingtalk / feishu / wecom)
    // 通过 RPC 或 service endpoint, 由 Edge Function 处理
    // 这里 stub: TODO
    console.info(`[hitl-hub] dispatch ${req.type} ${hitlId} to SaaS (stub)`);
  }

  private async signalTemporal(workflowId: string, payload: Record<string, unknown>): Promise<void> {
    // 调 Temporal client signal
    // const temporal = new TemporalClient({ address: ... });
    // await temporal.workflow.getHandle(workflowId).signal('approvalDecision', payload);
    console.info(`[hitl-hub] signal ${workflowId} with ${JSON.stringify(payload)} (stub)`);
  }
}

export function createHitlHub(opts: CreateHitlHubOptions): HitlHub {
  return new HitlHub(opts);
}

export default HitlHub;