/**
 * packages/mp-approval-saas/src/adapters/dingtalk.ts
 * PRD: docs/active/prd/approval-saas-adapters.md §4 (钉钉适配)
 */

import type {
  ApprovalAdapter,
  ApprovalProviderName,
  ApprovalRecord,
  CreateApprovalOptions,
  CreateApprovalResult,
  WebhookPayload,
} from '../types.js';

interface DingTalkConfig {
  readonly appKey: string;
  readonly appSecret: string;
  readonly agentId: string;
}

export class DingTalkAdapter implements ApprovalAdapter {
  readonly name: ApprovalProviderName = 'dingtalk';
  private readonly config: DingTalkConfig;
  private readonly baseUrl = 'https://api.dingtalk.com/v1.0';

  constructor(config: DingTalkConfig) {
    this.config = config;
  }

  async createApproval(opts: CreateApprovalOptions): Promise<CreateApprovalResult> {
    // 1. 获取 access_token
    const tokenResp = await fetch(`${this.baseUrl}/gettoken`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appkey: this.config.appKey,
        appsecret: this.config.appSecret,
      }),
    });
    const tokenData = await tokenResp.json() as { accessToken?: string; errcode?: number };
    if (!tokenData.accessToken) throw new Error(`DingTalk gettoken failed: ${tokenData.errcode}`);
    const accessToken = tokenData.accessToken;

    // 2. 创建审批实例 (钉钉智能人事 - 假接口, 实际调 dingtalk.smartwork.bpms.processinstance.create)
    const createResp = await fetch(
      `${this.baseUrl}/topapi/processinstance/create`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-acs-dingtalk-access-token': accessToken,
        },
        body: JSON.stringify({
          agent_id: this.config.agentId,
          process_code: opts.formData['process_code'] ?? 'PROC-DEFAULT',
          approvers: opts.approverUserIds.join(','),
          form_component_values: Object.entries(opts.formData).map(([k, v]) => ({
            name: k,
            value: String(v),
          })),
          title: opts.title,
          cc: '',
          cc_position: 'START',
        }),
      },
    );
    const createData = await createResp.json() as { process_instance_id?: string; errcode?: number };
    if (!createData.process_instance_id) throw new Error(`DingTalk createApproval failed: ${createData.errcode}`);

    return {
      externalId: createData.process_instance_id,
      approvalUrl: `https://aflow.dingtalk.com/dingtalk/pc/index.html#/approval/detail/${createData.process_instance_id}`,
    };
  }

  async getApproval(externalId: string): Promise<ApprovalRecord> {
    const tokenResp = await fetch(`${this.baseUrl}/gettoken`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appkey: this.config.appKey,
        appsecret: this.config.appSecret,
      }),
    });
    const tokenData = await tokenResp.json() as { accessToken?: string };
    const accessToken = tokenData.accessToken!;

    const resp = await fetch(
      `${this.baseUrl}/topapi/processinstance/get`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-acs-dingtalk-access-token': accessToken,
        },
        body: JSON.stringify({ process_instance_id: externalId }),
      },
    );
    const data = await resp.json() as { process_instance?: {
      status: 'NEW' | 'RUNNING' | 'COMPLETED' | 'CANCELED';
      result: 'agree' | 'refuse' | null;
      finish_time?: string;
    } };

    const inst = data.process_instance;
    if (!inst) return { externalId, status: 'pending' };

    if (inst.status === 'COMPLETED') {
      const decision = inst.result === 'agree' ? 'approved' : 'rejected';
      return {
        externalId,
        status: decision,
        decidedAt: inst.finish_time,
      };
    }
    if (inst.status === 'CANCELED') {
      return { externalId, status: 'expired' };
    }
    return { externalId, status: 'pending' };
  }

  async verifyWebhook(req: Request, body: string): Promise<boolean> {
    // 钉钉 webhook 用 sign 验证 (HMAC-SHA256 + timestamp + secret)
    const timestamp = req.headers.get('timestamp');
    const sign = req.headers.get('sign');
    if (!timestamp || !sign) return false;

    const crypto = await import('node:crypto');
    const stringToSign = `${timestamp}\n${body}`;
    const hmac = crypto.createHmac('sha256', this.config.appSecret).update(stringToSign).digest('base64');
    return hmac === sign;
  }

  async parseWebhook(body: string): Promise<WebhookPayload> {
    const data = JSON.parse(body) as {
      processInstanceId: string;
      result: 'agree' | 'refuse';
      finishTime?: string;
      userid?: string;
      remark?: string;
    };

    return {
      externalId: data.processInstanceId,
      decision: data.result === 'agree' ? 'approved' : 'rejected',
      decidedBy: data.userid ?? 'unknown',
      comment: data.remark,
    };
  }
}

export default DingTalkAdapter;