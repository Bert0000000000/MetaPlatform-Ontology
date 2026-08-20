import { describe, it, expect } from 'vitest';
import { runWithContext, currentContext, requireContext } from '../src/context.js';

describe('mp-temporal-worker-template: TenantContext propagation', () => {
  it('stores context inside runWithContext', () => {
    const ctx = { tenantId: 'tenant-A', actorId: 'user-1', roles: ['owner'] };
    let observed: unknown = null;
    runWithContext(ctx, () => {
      observed = currentContext();
    });
    expect(observed).toEqual(ctx);
  });

  it('context is empty outside runWithContext', () => {
    expect(currentContext()).toBeUndefined();
  });

  it('requireContext throws when no context', () => {
    expect(() => requireContext()).toThrow(/No TenantContext/);
  });

  it('context propagates across async boundaries', async () => {
    const ctx = { tenantId: 'tenant-B', actorId: null, roles: ['member'] };
    await new Promise<void>((resolve) => {
      runWithContext(ctx, async () => {
        await new Promise((r) => setTimeout(r, 10));
        expect(currentContext()?.tenantId).toBe('tenant-B');
        resolve();
      });
    });
  });

  it('contexts in parallel async scopes are isolated', async () => {
    const results: string[] = [];
    await Promise.all([
      new Promise<void>((r) =>
        runWithContext({ tenantId: 'X', actorId: null, roles: [] }, async () => {
          await new Promise((rr) => setTimeout(rr, 20));
          results.push(requireContext().tenantId);
          r();
        }),
      ),
      new Promise<void>((r) =>
        runWithContext({ tenantId: 'Y', actorId: null, roles: [] }, async () => {
          await new Promise((rr) => setTimeout(rr, 10));
          results.push(requireContext().tenantId);
          r();
        }),
      ),
    ]);
    // X finishes after Y (X slept 20ms, Y slept 10ms)
    expect(results).toEqual(['Y', 'X']);
  });
});