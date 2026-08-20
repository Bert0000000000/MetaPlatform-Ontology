/**
 * packages/mp-approval-saas/src/adapters/feishu.ts
 * PRD: docs/active/prd/approval-saas-adapters.md §4 (飞书适配)
 */

import type {
  ApprovalAdapter,
  ApprovalProviderName,
  ApprovalRecord,
  CreateApprovalOptions,
  CreateApprovalResult,
  WebhookPayload,
} from '../types.js';

interface FeishuConfig {
  readonly appId: string;
  readonly appSecret: string;
}

export class FeishuAdapter implements ApprovalAdapter {
  readonly name: ApprovalProviderName = 'feishu';
  private readonly config: FeishuConfig;
  private readonly baseUrl = 'https://open.feishu.cn/open-apis';

  constructor(config: FeishuConfig) {
    this.config = config;
  }

  private async getTenantAccessToken(): Promise<string> {
    const resp = await fetch(`${this.baseUrl}/auth/v3/tenant_access_token/internal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_id: this.config.appId,
        app_secret: this.config.appSecret,
      }),
    });
    const data = await resp.json() as { tenant_access_token?: string; code?: number };
    if (!data.tenant_access_token) throw new Error(`Feishu getToken failed: ${data.code}`);
    return data.tenant_access_token;
  }

  async createApproval(opts: CreateApprovalOptions): Promise<CreateApprovalResult> {
    const token = await this.getTenantAccessToken();

    // 飞书审批 v1 API
    const resp = await fetch(
      `${this.baseUrl}/approval/v4/instances`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          user_id: opts.approverUserIds[0],  // 主审批人
          department_id: opts.formData['department_id'] ?? '',
          approval_code: opts.formData['approval_code'] ?? 'PROC-DEFAULT',
          form: JSON.stringify(opts.formData),
          title: opts.title,
          node_form_conditions: opts.approverUserIds.slice(1).map((uid) => ({
            user_id: uid,
          })),
        }),
      },
    );
    const data = await resp.json() as { instance_id?: string; code?: number };
    if (!data.instance_id) throw new Error(`Feishu createApproval failed: ${data.code}`);

    return {
      externalId: data.instance_id,
      approvalUrl: `https://www.feishu.cn/approval/instance/${data.instance_id}`,
    };
  }

  async getApproval(externalId: string): Promise<ApprovalRecord> {
    const token = await this.getTenantAccessToken();
    const resp = await fetch(
      `${this.baseUrl}/approval/v4/instances/${externalId}`,
      { headers: { 'Authorization': `Bearer ${token}` } },
    );
    const data = await resp.json() as {
      instance?: {
        status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELED';
        end_time?: string;
        user_id?: string;
      };
    };

    const inst = data.instance;
    if (!inst) return { externalId, status: 'pending' };

    switch (inst.status) {
      case 'APPROVED':
        return { externalId, status: 'approved', decidedAt: inst.end_time, decidedBy: inst.user_id };
      case 'REJECTED':
        return { externalId, status: 'rejected', decidedAt: inst.end_time, decidedBy: inst.user_id };
      case 'CANCELED':
        return { externalId, status: 'expired' };
      default:
        return { externalId, status: 'pending' };
    }
  }

  async verifyWebhook(req: Request, body: string): Promise<boolean> {
    // 飞书 webhook 用 encrypt_key + verification_token
    const token = req.headers.get('token');
    const expected = req.headers.get('verification_token');
    return token === expected;
  }

  async parseWebhook(body: string): Promise<WebhookPayload> {
    const data = JSON.parse(body) as {
      instance_id: string;
      status: 'APPROVED' | 'REJECTED';
      end_time?: string;
      user_id?: string;
      comment?: string;
    };

    return {
      externalId: data.instance_id,
      decision: data.status === 'APPROVED' ? 'approved' : 'rejected',
      decidedBy: data.user_id ?? 'unknown',
      comment: data.comment,
    };
  }
}

export default FeishuAdapter;