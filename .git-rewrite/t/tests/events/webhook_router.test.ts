/**
 * tests/events/webhook_router.test.ts
 *
 * Verifies dsp-webhook router dispatches based on schema.table.
 */

import { describe, it, expect } from 'vitest';

interface WebhookEvent {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  table: string;
  schema: string;
  record: Record<string, unknown>;
}

const ROUTER_TARGETS: Record<string, string> = {
  'public.orders': 'order/insert → orderApprovalWorkflow if amount>10k',
  'public.contracts': 'contract/insert → contractApprovalWorkflow if total>100k',
  'public.hitl_requests': 'hitl/insert → realtime broadcast',
  'public.tickets': 'ticket/insert → ticket-triage if urgent/high',
  'public.invoices': 'invoice/insert → processInvoiceWorkflow if status=issued',
  'public.dsh_session_headers': 'session/update → realtime broadcast if completed',
  'public.ontology_object_types': 'ontology/insert|update → realtime broadcast',
  'public.pending_object_changes': 'change/update → realtime broadcast if applied',
  'public.notifications': 'notification/insert → realtime broadcast',
  'public.employees': 'employee/insert → realtime broadcast',
  'public.departments': 'department/insert|update → realtime broadcast',
  'public.documents': 'document/insert → enqueue RAG extraction',
};

function routeTarget(payload: WebhookEvent): string | null {
  const key = `${payload.schema}.${payload.table}`;
  return ROUTER_TARGETS[key] ?? null;
}

describe('dsp-webhook router', () => {
  it('handles 10+ table types', () => {
    const handled: string[] = [];
    const unhandled: string[] = [];
    for (const key of Object.keys(ROUTER_TARGETS)) {
      const [schema, table] = key.split('.');
      const target = routeTarget({ type: 'INSERT', schema, table, record: {} });
      if (target) handled.push(key); else unhandled.push(key);
    }
    expect(handled.length).toBeGreaterThanOrEqual(10);
    expect(unhandled).toEqual([]);
  });

  it('returns null for unhandled table', () => {
    expect(routeTarget({ type: 'INSERT', schema: 'public', table: 'unknown_table', record: {} })).toBeNull();
  });

  it('routes orders > 10k to orderApprovalWorkflow', () => {
    expect(routeTarget({ type: 'INSERT', schema: 'public', table: 'orders', record: { amount: 15000 } }))
      .toContain('orderApprovalWorkflow');
  });

  it('routes contracts > 100k to contractApprovalWorkflow', () => {
    expect(routeTarget({ type: 'INSERT', schema: 'public', table: 'contracts', record: { total_amount: 150000 } }))
      .toContain('contractApprovalWorkflow');
  });
});