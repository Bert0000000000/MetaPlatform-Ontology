/**
 * packages/mp-long-task/src/index.ts
 * PRD: docs/active/prd/long-task-5-mechanisms.md §4.3
 * Batch: MP-V6-LONG-TASK-01
 *
 * 长任务 SDK: 5 大机制完整版入口
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

export type HitlType = 'workflow_saas' | 'workflow_dsh' | 'tool_dsh' | 'action_conf';

export interface EscalationLevel {
  readonly level: number;
  readonly approverUserIds: ReadonlyArray<string>;
  readonly timeoutHours: number;
}

export interface EscalationChain {
  readonly levels: ReadonlyArray<EscalationLevel>;
  readonly finalAction: 'expire' | 'auto_approve' | 'auto_reject';
}

export interface LongTaskOptions {
  readonly supabaseUrl: string;
  readonly supabaseKey: string;
}

export interface CreateLongTaskInput {
  readonly tenantId: string;
  readonly type: HitlType;
  readonly title: string;
  readonly context: Record<string, unknown>;
  readonly initialApprovers: ReadonlyArray<string>;
  readonly totalTimeoutMs: number;
  readonly escalation: EscalationChain;
}

export interface LongTaskRecord {
  readonly hitlRequestId: string;
  readonly status: 'pending' | 'approved' | 'rejected' | 'expired';
  readonly currentLevel: number;
  readonly timeoutAt: string;
}

export class LongTaskClient {
  private readonly supabase: SupabaseClient;

  constructor(opts: LongTaskOptions) {
    this.supabase = createClient(opts.supabaseUrl, opts.supabaseKey);
  }

  async create(input: CreateLongTaskInput): Promise<LongTaskRecord> {
    // 1. 校验 escalation chain 时长加起来 <= totalTimeoutMs
    const totalHours = input.escalation.levels.reduce((sum, l) => sum + l.timeoutHours, 0);
    const totalMs = totalHours * 60 * 60 * 1000;
    if (totalMs > input.totalTimeoutMs) {
      throw new Error('escalation total hours exceeds totalTimeoutMs');
    }

    // 2. 写 hitl_requests (level 0 + initial approvers)
    const firstLevel = input.escalation.levels[0];
    if (!firstLevel) throw new Error('escalation chain empty');

    const { data, error } = await this.supabase.from('hitl_requests').insert({
      tenant_id: input.tenantId,
      type: input.type,
      status: 'pending',
      title: input.title,
      context: input.context,
      approver_user_ids: firstLevel.approverUserIds,
      escalation_level: 0,
      timeout_at: new Date(Date.now() + input.totalTimeoutMs).toISOString(),
    }).select().single();

    if (error || !data) throw new Error(`hitl_requests insert failed: ${error?.message}`);

    // 3. 写 tenant_escalation_chain 配置 (per-tenant)
    for (const level of input.escalation.levels) {
      await this.supabase.from('tenant_escalation_chain').upsert({
        tenant_id: input.tenantId,
        escalation_level: level.level,
        approver_user_ids: level.approverUserIds,
        timeout_hours: level.timeoutHours,
      });
    }

    return {
      hitlRequestId: data.id,
      status: 'pending',
      currentLevel: 0,
      timeoutAt: data.timeout_at,
    };
  }

  /**
   * 查询长任务状态
   */
  async getStatus(hitlRequestId: string): Promise<LongTaskRecord> {
    const { data, error } = await this.supabase
      .from('hitl_requests')
      .select('*')
      .eq('id', hitlRequestId)
      .single();

    if (error || !data) throw new Error(`hitl_request not found: ${hitlRequestId}`);

    return {
      hitlRequestId: data.id,
      status: data.status,
      currentLevel: data.escalation_level,
      timeoutAt: data.timeout_at,
    };
  }
}

export function createLongTaskClient(opts: LongTaskOptions): LongTaskClient {
  return new LongTaskClient(opts);
}

export default LongTaskClient;