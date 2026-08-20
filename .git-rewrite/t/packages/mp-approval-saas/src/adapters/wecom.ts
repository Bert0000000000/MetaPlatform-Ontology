/**
 * packages/mp-approval-saas/src/adapters/wecom.ts
 * PRD: docs/active/prd/approval-saas-adapters.md §4 (企微适配)
 */

import type {
  ApprovalAdapter,
  ApprovalProviderName,
  ApprovalRecord,
  CreateApprovalOptions,
  CreateApprovalResult,
  WebhookPayload,
} from '../types.js';

interface WecomConfig {
  readonly corpId: string;
  readonly corpSecret: string;
  readonly agentId: string;
}

export class WecomAdapter implements ApprovalAdapter {
  readonly name: ApprovalProviderName = 'wecom';
  private readonly config: WecomConfig;
  private readonly baseUrl = 'https://qyapi.weixin.qq.com/cgi-bin';

  private async getAccessToken(): Promise<string> {
    const resp = await fetch(
      `${this.baseUrl}/gettoken?corpid=${this.config.corpId}&corpsecret=${this.config.corpSecret}`,
    );
    const data = await resp.json() as { access_token?: string; errcode?: number };
    if (!data.access_token) throw new Error(`Wecom getToken failed: ${data.errcode}`);
    return data.access_token;
  }

  async createApproval(opts: CreateApprovalOptions): Promise<CreateApprovalResult> {
    const accessToken = await this.getAccessToken();

    // 企微审批 API (v2 smartwork)
    const resp = await fetch(
      `${this.baseUrl}/oa/smartwork/approval/create?access_token=${accessToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentid: this.config.agentId,
          apply_data: {
            title: opts.title,
            form_data: JSON.stringify(opts.formData),
          },
          approver_userids: opts.approverUserIds,
          notifyer_userids: opts.approverUserIds,
        }),
      },
    );
    const data = await resp.json() as { sp_no?: string; errcode?: number };
    if (!data.sp_no) throw new Error(`Wecom createApproval failed: ${data.errcode}`);

    return {
      externalId: data.sp_no,
      approvalUrl: `https://work.weixin.qq.com/wework_admin/approval/detail/${data.sp_no}`,
    };
  }

  async getApproval(externalId: string): Promise<ApprovalRecord> {
    const accessToken = await this.getAccessToken();
    const resp = await fetch(
      `${this.baseUrl}/oa/smartwork/approval/getdetail?access_token=${accessToken}&sp_no=${externalId}`,
    );
    const data = await resp.json() as {
      info?: {
        sp_status: 1 | 2 | 3 | 4;  // 1=审批中 2=已通过 3=已驳回 4=已撤销
        finish_time?: string;
        apply_user?: { userid: string };
      };
    };

    const info = data.info;
    if (!info) return { externalId, status: 'pending' };

    switch (info.sp_status) {
      case 2:
        return { externalId, status: 'approved', decidedAt: info.finish_time };
      case 3:
        return { externalId, status: 'rejected', decidedAt: info.finish_time };
      case 4:
        return { externalId, status: 'expired' };
      default:
        return { externalId, status: 'pending' };
    }
  }

  async verifyWebhook(req: Request, _body: string): Promise<boolean> {
    // 企微用 msg_signature 验证
    const signature = req.headers.get('msg_signature');
    const timestamp = req.headers.get('timestamp');
    const nonce = req.headers.get('nonce');
    if (!signature || !timestamp || !nonce) return false;

    const crypto = await import('node:crypto');
    const stringToSign = `${timestamp}${nonce}${this.config.corpSecret}`;
    const computed = crypto.createHash('sha1').update(stringToSign).digest('hex');
    return computed === signature;
  }

  async parseWebhook(body: string): Promise<WebhookPayload> {
    // 企微 webhook body 是 XML 加密的 (简化: 假设已解密为 JSON)
    const data = JSON.parse(body) as {
      SpNo: string;
      SpStatus: 2 | 3;
      ApproveName?: string;
      Comment?: string;
    };

    return {
      externalId: data.SpNo,
      decision: data.SpStatus === 2 ? 'approved' : 'rejected',
      decidedBy: data.ApproveName ?? 'unknown',
      comment: data.Comment,
    };
  }
}

export default WecomAdapter;