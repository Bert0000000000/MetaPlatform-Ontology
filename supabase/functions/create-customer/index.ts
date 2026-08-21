// supabase/functions/create-customer/index.ts
// PRD: docs/active/prd/domain-migrate-17.md §4.2
// Batch: MetaPlatform-DOMAIN-MIGRATE-01
// 创建客户: dedup by (tenant_id, email), 触发 dsp-webhook

// @ts-nocheck — Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { verifyAuth, AuthError, authErrorResponse } from "../_template-auth/index.ts";

interface CreateCustomerRequest {
  name: string;
  contact_email?: string;
  contact_phone?: string;
  tier?: 'standard' | 'silver' | 'gold' | 'platinum';
  external_id?: string;          // v3.0 客户 ID (migration 阶段)
  metadata?: Record<string, unknown>;
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const auth = await verifyAuth(req);
    const body = await req.json() as CreateCustomerRequest;
    if (!body.name) throw new Error("Missing name");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. dedup 检查 (tenant_id + email)
    if (body.contact_email) {
      const { data: existing } = await supabase
        .from("customers")
        .select("id")
        .eq("tenant_id", auth.tenantId)
        .eq("contact_email", body.contact_email)
        .maybeSingle();

      if (existing) {
        return new Response(JSON.stringify({
          customer_id: existing.id,
          deduped: true,
          message: "customer already exists (matched by email)",
        }), { status: 200 });
      }
    }

    // 2. 创建 (tg_inject_tenant 自动注入 tenant_id)
    const { data: customer, error: createErr } = await supabase
      .from("customers")
      .insert({ tenant_id: auth.tenantId,
        name: body.name,
        contact_email: body.contact_email ?? null,
        contact_phone: body.contact_phone ?? null,
        tier: body.tier ?? 'standard',
        external_id: body.external_id ?? null,
        metadata: body.metadata ?? {},
        created_by: auth.userId,
      })
      .select()
      .single();

    if (createErr || !customer) throw new Error(`create failed: ${createErr?.message}`);

    return new Response(JSON.stringify({
      customer_id: customer.id,
      deduped: false,
      customer,
    }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});