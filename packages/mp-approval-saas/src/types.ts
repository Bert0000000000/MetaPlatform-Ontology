/**
 * packages/mp-approval-saas/src/types.ts
 * PRD: docs/active/prd/approval-saas-adapters.md §4.1
 * Batch: MP-V6-APPROVAL-01
 * Common ApprovalAdapter 接口
 */

export type ApprovalProviderName = 'dingtalk' | 'feishu' | 'wecom';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface CreateApprovalOptions {
  readonly tenantId: string;
  readonly approverUserIds: ReadonlyArray<string>;
  readonly title: string;
  readonly description?: string;
  readonly formData: Record<string, unknown>;
  readonly timeoutMs: number;
}

export interface CreateApprovalResult {
  readonly externalId: string;
  readonly approvalUrl: string;
}

export interface ApprovalRecord {
  readonly externalId: string;
  readonly status: ApprovalStatus;
  readonly decidedBy?: string;
  readonly decidedAt?: string;
  readonly comment?: string;
}

export interface WebhookPayload {
  readonly externalId: string;
  readonly decision: 'approved' | 'rejected';
  readonly decidedBy: string;
  readonly comment?: string;
}

export interface ApprovalAdapter {
  readonly name: ApprovalProviderName;

  createApproval(opts: CreateApprovalOptions): Promise<CreateApprovalResult>;
  getApproval(externalId: string): Promise<ApprovalRecord>;
  verifyWebhook(req: Request, body: string): Promise<boolean>;
  parseWebhook(body: string): Promise<WebhookPayload>;
}

/**
 * Provider registry: 按 tenant 配置选 primary, 失败 fallback
 */
export class ProviderRegistry {
  private adapters: Map<ApprovalProviderName, ApprovalAdapter> = new Map();

  register(adapter: ApprovalAdapter): void {
    this.adapters.set(adapter.name, adapter);
  }

  async createWithFallback(
    opts: CreateApprovalOptions,
    primary: ApprovalProviderName,
    fallback?: ApprovalProviderName,
  ): Promise<CreateApprovalResult> {
    const primaryAdapter = this.adapters.get(primary);
    if (!primaryAdapter) throw new Error(`provider ${primary} not registered`);

    try {
      return await primaryAdapter.createApproval(opts);
    } catch (err) {
      if (fallback) {
        const fallbackAdapter = this.adapters.get(fallback);
        if (fallbackAdapter) {
          console.warn(`[approval-saas] primary ${primary} failed, falling back to ${fallback}`);
          return await fallbackAdapter.createApproval(opts);
        }
      }
      throw err;
    }
  }
}