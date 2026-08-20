/**
 * packages/mp-temporal-worker-template/src/activities/index.ts
 * PRD: docs/active/prd/temporal-worker-sdk.md §4.3
 * Activity 实现 — 这里只放模板, 业务 Batch 自行扩展
 */

import { Context } from '@temporalio/activity';
import { requireContext } from '../context.js';

export async function sayHello(input: { name: string; tenantId: string }): Promise<string> {
  // tenantId 由 workflow 通过 input 传入; 在实际场景, 可通过 Context info 拿到
  const ctx = requireContext();
  console.info(`[activity:sayHello] tenant=${ctx.tenantId} name=${input.name}`);

  // 心跳 (短 activity 可选)
  Context.current().heartbeat({ progress: 'greeting' });

  return `Hello, ${input.name}! (tenant=${ctx.tenantId})`;
}

export async function heartbeatStep(input: { step: number; total: number }): Promise<number> {
  const ctx = requireContext();
  console.info(`[activity:heartbeatStep] tenant=${ctx.tenantId} step=${input.step + 1}/${input.total}`);

  // 上报心跳 (workflow 据此知道 activity 还活着)
  Context.current().heartbeat({ progress: ((input.step + 1) / input.total) * 100 });

  await new Promise((r) => setTimeout(r, 100));
  return input.step + 1;
}

export async function dbRead(input: { query: string }): Promise<unknown[]> {
  const ctx = requireContext();
  console.info(`[activity:dbRead] tenant=${ctx.tenantId} query=${input.query.slice(0, 50)}...`);
  // TODO: 用 Supabase client + RLS 自动按 tenant_id 过滤
  // const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
  // const { data } = await supabase.rpc('exec_query', { q: input.query });
  return [];
}

export async function dbWrite(input: { table: string; payload: Record<string, unknown> }): Promise<string> {
  const ctx = requireContext();
  console.info(`[activity:dbWrite] tenant=${ctx.tenantId} table=${input.table}`);
  // TODO: 类似 dbRead, 走 service_role 自动填 tenant_id
  return 'write-ok';
}

export async function approvalRequest(input: { approvalId: string; tenantId: string }): Promise<'granted' | 'denied'> {
  // TODO: 调 HITL Hub 4 种类型 (workflow_saas / workflow_dsh / tool_dsh / action_confirm)
  // return await hitlHub.requestHitl(input.approvalId, 'workflow_saas');
  return 'granted';
}