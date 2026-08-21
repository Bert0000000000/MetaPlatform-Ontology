// supabase/functions/generate-ontology-proposal/index.ts
// PRD:  docs/active/prd/mp-ontology.md (M18 本体生成 + 预览)
// ADR:   docs/active/decisions/ADR-0056-ontology-generation.md
// Batch: MetaPlatform-ONTOLOGY-GEN-01 (Loop 3/3) + MetaPlatform-LLM-01 (M18)
//
// POST /functions/v1/generate-ontology-proposal
//   body: { description: string }
//   admin/owner 调用: 输入自然语言描述, mock LLM 输出 ObjectType / RelationType / ActionType proposals
//   返回 preview payload (不直接落库), 用户确认后用 create-ontology-type EF 批量落库
//
// PoC LLM (per 模块规划 §M18): 不调真实 dsh + DeepSeek API, 用 keyword 匹配推断.
//   关键词识别: 客户/customer, 订单/order, 产品/product, 合同/contract, 发票/invoice,
//               审批/approve, 创建/create, 关联/has_many, 属于/belongs_to, ...
//
// 生产: replace mock with DeepSeek API call (dsh llm-deepseek provider) +
//       HITL action_confirm 弹窗让用户确认 (Loop 3/3).

// @ts-nocheck — Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { verifyAuth, AuthError, authErrorResponse } from "../_template-auth/index.ts";

interface Proposal {
  object_types: Array<{
    rid: string;
    slug: string;
    name: string;
    description: string;
    properties: Record<string, { type: string; required?: boolean; enum?: string[] }>;
    status: 'draft' | 'active';
  }>;
  relation_types: Array<{
    rid: string;
    name: string;
    from_type: string;
    to_type: string;
    cardinality: 'one_to_one' | 'one_to_many' | 'many_to_one' | 'many_to_many';
    status: 'draft' | 'active';
  }>;
  action_types: Array<{
    rid: string;
    name: string;
    target_type: string;
    parameters: Record<string, string>;
    permission: 'admin' | 'owner' | 'member' | 'guest';
    workflow_name?: string;
    hitl_type?: 'workflow_saas' | 'workflow_dsh' | 'tool_dsh' | 'action_confirm';
    status: 'draft' | 'active';
  }>;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// 内置本体识别规则 (mock LLM)
const ENTITY_PATTERNS: Array<{
  kw: RegExp;
  rid: string;
  name: string;
  properties: Record<string, { type: string; required?: boolean; enum?: string[] }>;
}> = [
  {
    kw: /(客户|customer|客户档案)/i,
    rid: 'customer',
    name: '客户',
    properties: { email: { type: 'string', required: true }, name: { type: 'string', required: true }, phone: { type: 'string' } },
  },
  {
    kw: /(订单|order|订单详情)/i,
    rid: 'order',
    name: '订单',
    properties: { amount: { type: 'number', required: true }, status: { type: 'string', enum: ['draft', 'pending_approval', 'approved', 'rejected', 'fulfilled'] } },
  },
  {
    kw: /(产品|product|商品)/i,
    rid: 'product',
    name: '产品',
    properties: { sku: { type: 'string', required: true }, name: { type: 'string', required: true }, price: { type: 'number' } },
  },
  {
    kw: /(合同|contract|合约)/i,
    rid: 'contract',
    name: '合同',
    properties: { title: { type: 'string', required: true }, amount: { type: 'number' }, status: { type: 'string', enum: ['draft', 'active', 'archived'] } },
  },
  {
    kw: /(发票|invoice)/i,
    rid: 'invoice',
    name: '发票',
    properties: { amount: { type: 'number', required: true }, status: { type: 'string', enum: ['draft', 'issued', 'paid'] } },
  },
];

const RELATION_RULES: Array<{
  pattern: RegExp;
  rid: string;
  name: string;
  from: string;
  to: string;
  card: 'one_to_many' | 'many_to_many';
}> = [
  { pattern: /(客户.*订单|order.*customer|客户.*拥有)/i, rid: 'customer_has_orders', name: '客户拥有订单', from: 'customer', to: 'order', card: 'one_to_many' },
  { pattern: /(订单.*产品|order.*product|订单.*包含)/i, rid: 'order_contains_products', name: '订单包含产品', from: 'order', to: 'product', card: 'many_to_many' },
  { pattern: /(发票.*订单|invoice.*order)/i, rid: 'invoice_belongs_to_order', name: '发票属于订单', from: 'invoice', to: 'order', card: 'many_to_one' },
  { pattern: /(合同.*客户|contract.*customer)/i, rid: 'contract_with_customer', name: '合同关联客户', from: 'contract', to: 'customer', card: 'many_to_one' },
];

const ACTION_RULES: Array<{
  pattern: RegExp;
  rid: string;
  name: string;
  target: string;
  perm: 'admin' | 'owner' | 'member';
  wf?: string;
  hitl?: 'workflow_saas' | 'workflow_dsh' | 'tool_dsh' | 'action_confirm';
}> = [
  { pattern: /(创建.*客户|create.*customer)/i, rid: 'customer.create', name: '创建客户', target: 'customer', perm: 'admin', wf: 'CustomerCreateWorkflow', hitl: 'workflow_saas' },
  { pattern: /(审批.*订单|approve.*order|订单审批)/i, rid: 'order.approve', name: '审批订单', target: 'order', perm: 'owner', wf: 'OrderApprovalWorkflow', hitl: 'workflow_saas' },
  { pattern: /(签署.*合同|sign.*contract)/i, rid: 'contract.sign', name: '签署合同', target: 'contract', perm: 'owner', wf: 'ContractSignWorkflow', hitl: 'action_confirm' },
  { pattern: /(开.*发票|issue.*invoice)/i, rid: 'invoice.issue', name: '开具发票', target: 'invoice', perm: 'admin', wf: 'InvoiceIssueWorkflow', hitl: 'workflow_saas' },
];

function generateProposal(description: string): Proposal {
  const objects = new Map<string, Proposal['object_types'][number]>();
  for (const ent of ENTITY_PATTERNS) {
    if (ent.kw.test(description)) {
      if (!objects.has(ent.rid)) {
        objects.set(ent.rid, {
          rid: ent.rid,
          slug: ent.rid,
          name: ent.name,
          description: `${ent.name} 实体 (LLM mock 生成)`,
          properties: ent.properties,
          status: 'draft',
        });
      }
    }
  }

  const relations: Proposal['relation_types'] = [];
  for (const r of RELATION_RULES) {
    if (r.pattern.test(description) && objects.has(r.from) && objects.has(r.to)) {
      relations.push({
        rid: r.rid, name: r.name, from_type: r.from, to_type: r.to,
        cardinality: r.card, status: 'draft',
      });
    }
  }

  const actions: Proposal['action_types'] = [];
  for (const a of ACTION_RULES) {
    if (a.pattern.test(description) && objects.has(a.target)) {
      actions.push({
        rid: a.rid, name: a.name, target_type: a.target, parameters: {},
        permission: a.perm, workflow_name: a.wf, hitl_type: a.hitl, status: 'draft',
      });
    }
  }

  return {
    object_types: Array.from(objects.values()),
    relation_types: relations,
    action_types: actions,
  };
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed', message: 'POST only' }, 405);
  }
  try {
    const auth = await verifyAuth(req);
    if (auth.role !== 'admin' && auth.role !== 'owner') {
      return jsonResponse({ error: 'forbidden', message: 'only admin/owner can generate ontology proposals' }, 403);
    }

    let body: { description?: string };
    try {
      body = await req.json() as typeof body;
    } catch {
      return jsonResponse({ error: 'invalid_json', message: 'request body must be JSON' }, 400);
    }

    if (!body.description || typeof body.description !== 'string' || body.description.trim().length === 0) {
      return jsonResponse({ error: 'invalid_description', message: 'description (non-empty string) required' }, 400);
    }
    if (body.description.length > 4000) {
      return jsonResponse({ error: 'description_too_long', message: 'max 4000 chars' }, 400);
    }

    const proposal = generateProposal(body.description);

    return jsonResponse({
      ok: true,
      description_preview: body.description.slice(0, 200),
      proposal,
      counts: {
        object_types: proposal.object_types.length,
        relation_types: proposal.relation_types.length,
        action_types: proposal.action_types.length,
      },
      note: 'PoC: keyword-based mock LLM. 生产用 dsh llm-deepseek provider. 确认后用 create-ontology-type EF 落库.',
    }, 200);
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: 'internal', message }, 500);
  }
});