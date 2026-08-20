/**
 * packages/mp-temporal-worker-template/src/context.ts
 * PRD: docs/active/prd/temporal-worker-sdk.md §4.4
 * AsyncLocalStorage 持有 tenant / actor 上下文, 跨 activity 边界传递
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantContext {
  readonly tenantId: string;
  readonly actorId: string | null;
  readonly roles: ReadonlyArray<string>;
}

const storage = new AsyncLocalStorage<TenantContext>();

export function runWithContext<T>(ctx: TenantContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function currentContext(): TenantContext | undefined {
  return storage.getStore();
}

export function requireContext(): TenantContext {
  const ctx = storage.getStore();
  if (!ctx) {
    throw new Error('No TenantContext in current async scope');
  }
  return ctx;
}