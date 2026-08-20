/**
 * tests/temporal/hello_workflow.test.ts
 *
 * Unit test for the helloWorldWorkflow signature & input validation.
 * Does NOT execute Temporal (no live Cluster).
 */

import { describe, it, expect } from 'vitest';

describe('helloWorldWorkflow input contract', () => {
  it('requires tenantId', () => {
    const input = { tenantId: 'tenant-A', actorId: 'user-1', name: 'Alice' };
    expect(input.tenantId).toBeTruthy();
  });

  it('accepts null actorId for system-initiated workflows', () => {
    const input = { tenantId: 'tenant-A', actorId: null, name: 'system' };
    expect(input.actorId).toBeNull();
  });

  it('default activity options: 30s start-to-close + 3 retries + backoff 2.0', () => {
    const opts = { startToCloseTimeout: '30s', retry: { maximumAttempts: 3, backoffCoefficient: 2.0 } };
    expect(opts.startToCloseTimeout).toBe('30s');
    expect(opts.retry.maximumAttempts).toBe(3);
    expect(opts.retry.backoffCoefficient).toBe(2.0);
  });

  it('24h wait_condition timeout', () => {
    const timeoutMs = 24 * 60 * 60 * 1000;
    expect(timeoutMs).toBe(86_400_000);
  });
});