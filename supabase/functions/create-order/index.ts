// supabase/functions/create-order/index.ts
// PRD: docs/active/specs/2026-08-19-mp-v6-architecture.md §7.15
// Supabase Edge Function (Deno + TypeScript) — 替代 v3.0 FastAPI 后端
//
// 用法:
//   supabase functions deploy create-order
//   curl -X POST https://<project>.supabase.co/functions/v1/create-order \
//     -H "Authorization: Bearer <jwt>" \
//     -H "Content-Type: application/json" \
//     -d '{"customer_id": "...", "amount": 100.00}'

// @ts-nocheck — Edge Functions runtime 用 Deno + esm.sh imports
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { Client as TemporalClient } from "https://esm.sh/@temporalio/client@1.11.0";

interface OrderRequest {
  customer_id: string;
  amount: number;
  currency?: string;
  metadata?: Record<string, unknown>;
}

interface AuthContext {
  tenant_id: string;
  user_id: string | null;
  roles: ReadonlyArray<string>;
}

async function verifyJwt(req: Request, supabase: ReturnType<typeof createClient>): Promise<AuthContext> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) throw new Error("Missing Authorization header");

  const token = authHeader.replace(/^Bearer\s+/i, "");
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) throw new Error(`Invalid JWT: ${error?.message ?? "no user"}`);

  const claims = user.app_metadata ?? {};
  return {
    tenant_id: (claims as { tenant_id?: string }).tenant_id ?? "",
    user_id: user.id,
    roles: ((claims as { role?: string }).role ?? "member").split(","),
  };
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,  // service_role 走 RLS bypass
    );

    const auth = await verifyJwt(req, supabase);
    if (!auth.tenant_id) {
      return new Response(JSON.stringify({ error: "JWT missing tenant_id" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const body = await req.json() as OrderRequest;

    // 1. 创建订单 (PostgREST 等价, 走 service_role)
    const orderNumber = `ORD-${new Date().getFullYear()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const idempotencyKey = req.headers.get("Idempotency-Key") ?? crypto.randomUUID();

    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .insert({ tenant_id: auth.tenantId,
        order_number: orderNumber,
        customer_id: body.customer_id,
        amount: body.amount,
        currency: body.currency ?? "CNY",
        status: body.amount > 10000 ? "pending_approval" : "draft",
        metadata: body.metadata ?? {},
        idempotency_key: idempotencyKey,
        created_by: auth.user_id,
      })
      .select()
      .single();

    if (orderErr || !order) {
      return new Response(JSON.stringify({ error: orderErr?.message ?? "create failed" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 2. 如果需要审批, 启动 Temporal workflow
    if (order.status === "pending_approval") {
      const temporal = new TemporalClient({
        address: Deno.env.get("TEMPORAL_ADDRESS") ?? "temporal.mp-orchestration.svc:7233",
      });

      await temporal.workflow.start("orderApprovalWorkflow", {
        args: [{ order_id: order.id, tenant_id: auth.tenant_id }],
        taskQueue: "order-approval",
        workflowId: `order-approval-${order.id}`,
      });
    }

    return new Response(JSON.stringify({ order }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});