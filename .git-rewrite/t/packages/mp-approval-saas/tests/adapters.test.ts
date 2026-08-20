/**
 * packages/mp-approval-saas/tests/adapters.test.ts
 *
 * Verifies common ApprovalAdapter interface + ProviderRegistry fallback.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ProviderRegistry, type ApprovalAdapter, type CreateApprovalOptions } from '../src/types.js';

class MockAdapter implements ApprovalAdapter {
  readonly name: 'dingtalk' | 'feishu' | 'wecom';
  public callCount = 0;
  public shouldFail = false;

  constructor(name: 'dingtalk' | 'feishu' | 'wecom') {
    this.name = name;
  }

  async createApproval(_opts: CreateApprovalOptions) {
    this.callCount++;
    if (this.shouldFail) throw new Error(`${this.name} API error`);
    return {
      externalId: `${this.name}-ext-${this.callCount}`,
      approvalUrl: `https://example.com/${this.name}`,
    };
  }
  async getApproval(_externalId: string) {
    return { externalId: _externalId, status: 'pending' as const };
  }
  async verifyWebhook(_req: Request, _body: string) {
    return true;
  }
  async parseWebhook(_body: string) {
    return { externalId: 'mock', decision: 'approved' as const, decidedBy: 'user-1' };
  }
}

describe('ApprovalAdapter interface + ProviderRegistry', () => {
  let registry: ProviderRegistry;
  let dingtalk: MockAdapter;
  let feishu: MockAdapter;
  let wecom: MockAdapter;

  beforeEach(() => {
    registry = new ProviderRegistry();
    dingtalk = new MockAdapter('dingtalk');
    feishu = new MockAdapter('feishu');
    wecom = new MockAdapter('wecom');
    registry.register(dingtalk);
    registry.register(feishu);
    registry.register(wecom);
  });

  it('uses primary provider on success', async () => {
    const opts: CreateApprovalOptions = {
      tenantId: 'tenant-A',
      approverUserIds: ['user-1'],
      title: '审批合同',
      formData: {},
      timeoutMs: 24 * 60 * 60 * 1000,
    };
    const result = await registry.createWithFallback(opts, 'dingtalk', 'feishu');
    expect(result.externalId).toBe('dingtalk-ext-1');
    expect(dingtalk.callCount).toBe(1);
    expect(feishu.callCount).toBe(0);
  });

  it('falls back when primary fails', async () => {
    dingtalk.shouldFail = true;
    const opts: CreateApprovalOptions = {
      tenantId: 'tenant-A',
      approverUserIds: ['user-1'],
      title: '审批',
      formData: {},
      timeoutMs: 24 * 60 * 60 * 1000,
    };
    const result = await registry.createWithFallback(opts, 'dingtalk', 'feishu');
    expect(result.externalId).toBe('feishu-ext-1');
    expect(dingtalk.callCount).toBe(1);
    expect(feishu.callCount).toBe(1);
  });

  it('throws if both primary and fallback fail', async () => {
    dingtalk.shouldFail = true;
    feishu.shouldFail = true;
    const opts: CreateApprovalOptions = {
      tenantId: 'tenant-A',
      approverUserIds: ['user-1'],
      title: '审批',
      formData: {},
      timeoutMs: 24 * 60 * 60 * 1000,
    };
    await expect(registry.createWithFallback(opts, 'dingtalk', 'feishu')).rejects.toThrow(/feishu/);
  });

  it('throws if primary provider not registered', async () => {
    const opts: CreateApprovalOptions = {
      tenantId: 'tenant-A',
      approverUserIds: ['user-1'],
      title: '审批',
      formData: {},
      timeoutMs: 24 * 60 * 60 * 1000,
    };
    // 实际上注册了 3 家, 但 wacom 不在注册列表
    await expect(registry.createWithFallback(opts, 'wecom' as 'feishu')).rejects.toThrow(/not registered/);
  });
});