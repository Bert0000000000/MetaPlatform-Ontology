/**
 * packages/mp-temporal-worker-template/src/workflows/business.ts
 * PRD: docs/active/prd/edge-fn-17-domains.md §4.3
 * Batch: MetaPlatform-EDGE-FN-01
 *
 * orderApprovalWorkflow + contractApprovalWorkflow + processInvoiceWorkflow
 */

import { proxyActivities, condition, signal } from '@temporalio/workflow';
import type { TenantContext } from '../context.js';

const defaultActivityOptions = {
  startToCloseTimeout: '30s',
  retry: { maximumAttempts: 3, backoffCoefficient: 2.0 },
};

const activities = proxyActivities({
  defaultOptions: defaultActivityOptions,
});

// ============================================================
// orderApprovalWorkflow — 大额订单 (>10k) 自动触发
// ============================================================

export interface OrderApprovalInput {
  readonly orderId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly amount: number;
}

export async function orderApprovalWorkflow(input: OrderApprovalInput): Promise<{ status: 'approved' | 'rejected' | 'timeout'; finalOrderStatus: string }> {
  // 1. 写 hitl_requests (workflow_saas)
  const hitl = await activities.createHitlRequest({
    tenant_id: input.tenantId,
    type: 'workflow_saas',
    title: `审批订单: ${input.orderId} (¥${input.amount.toLocaleString()})`,
    context: { order_id: input.orderId, amount: input.amount },
    approver_user_ids: await activities.getOrderApprovers({ tenant_id: input.tenantId }),
    timeout_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),  // 24h 默认
    workflow_id: `order-approval-${input.orderId}`,
  });

  // 2. 等 SaaS 决策 (signal approvalDecision) 或 24h timeout
  let decision: 'approved' | 'rejected' | null = null;

  await activities.waitForHitlDecision({
    hitl_request_id: hitl.id,
    timeout_seconds: 24 * 60 * 60,
    on_decision: (d) => { decision = d; },
  });

  // 3. 应用决策: 更新 order.status
  if (decision === 'approved') {
    await activities.updateOrderStatus({
      order_id: input.orderId,
      status: 'approved',
    });
    return { status: 'approved', finalOrderStatus: 'approved' };
  } else if (decision === 'rejected') {
    await activities.updateOrderStatus({
      order_id: input.orderId,
      status: 'rejected',
    });
    return { status: 'rejected', finalOrderStatus: 'rejected' };
  } else {
    await activities.updateOrderStatus({
      order_id: input.orderId,
      status: 'cancelled',
    });
    return { status: 'timeout', finalOrderStatus: 'cancelled' };
  }
}

// ============================================================
// contractApprovalWorkflow — 合同审批
// ============================================================

export interface ContractApprovalInput {
  readonly contractId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly totalAmount: number;
}

export async function contractApprovalWorkflow(input: ContractApprovalInput): Promise<{ status: 'approved' | 'rejected' | 'timeout'; contractContract:Contract: string }> {
  // 1. 合同金额 > 100k 走 workflow_saas (1 周+ 审批), 否则 workflow_dsh (24h 内)
  const isHighValue = input.totalAmount > 100000;
  const type = isHighValue ? 'workflow_saas' : 'workflow_dsh';
  const timeoutHours = isHighValue ? 7 * 24 : 24;

  const hitl = await activities.createHitlRequest({
    tenant_id: input.tenantId,
    type,
    title: `审批合同: ${input.contractId} (¥${input.totalAmount.toLocaleString()})`,
    context: { contract_id: input.contractId, total_amount: input.totalAmount },
    approver_user_ids: await activities.getContractApprovers({ tenant_id: input.tenantId, amount: input.totalAmount }),
    timeout_at: new Date(Date.now() + timeoutHours * 60 * 60 * 1000).toISOString(),
    workflow_id: `contract-approval-${input.contractId}`,
  });

  let decision: 'approved' | 'rejected' | null = null;
  await activities.waitForHitlDecision({
    hitl_request_id: hitl.id,
    timeout_seconds: timeoutHours * 60 * 60,
    on_decision: (d) => { decision = d; },
  });

  if (decision === 'approved') {
    await activities.updateContractStatus({
      contract_id: input.contractId,
      status: 'active',
    });
    return { status: 'approved', contractContract:Contract: 'active' };
  } else if (decision === 'rejected') {
    await activities.updateContractStatus({
      contract_id: input.contractId,
      status: 'terminated',
    });
    return { status: 'rejected', contractContract:Contract: 'terminated' };
  } else {
    return { status: 'timeout', contractContract:Contract: 'draft' };
  }
}

// ============================================================
// processInvoiceWorkflow — 发票处理 (生成 + webhook)
// ============================================================

export interface ProcessInvoiceInput {
  readonly invoiceId: string;
  readonly tenantId: string;
}

export async function processInvoiceWorkflow(input: ProcessInvoiceInput): Promise<{ sent: boolean; error?: string }> {
  // 1. 读发票
  const invoice = await activities.readInvoice({ invoice_id: input.invoiceId });

  // 2. 生成 PDF
  const pdfUrl = = await activities.generateInvoicePdf({ invoice_id: input.invoiceId });

  // 3. 发送邮件
  await activities.sendInvoiceEmail({
    to: invoice.customer_email,
    invoice_id: input.invoiceId,
    pdf_url: pdfUrl,
  });

  // 4. 更新发票状态
  await activities.updateInvoiceStatus({
    invoice_id: input.invoiceId,
    status: 'issued',
  });

  return { sent: true };
}