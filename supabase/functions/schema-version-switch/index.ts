# supabase/functions/schema-version-switch/index.ts
// PRD: docs/active/prd/ontology-gen.md §4.4
// Batch: MetaPlatform.1-SCHEMA-VERSION-01
// Edge Function: 切换 ontology 活跃版本

// @ts-nocheck — Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { verifyAuth, AuthError, authErrorResponse } from "../_template-auth/index.ts";

interface SwitchRequest {
  object_type_id: string;
  new_version: string;
  affected_rows_estimate?: number;
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  try {
    const auth = await verifyAuth(req);
    if (auth.role !== "admin" && auth.role !== "owner") {
      throw new AuthError("INSUFFICIENT_ROLE", "Only admin/owner can switch schema version", 403);
    }

    const body = await req.json() as SwitchRequest;
    if (!body.object_type_id || !body.new_version) {
      throw new Error("Missing object_type_id or new_version");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. 创建迁移审计行
    const { data: mig, error: migErr } = await supabase
      .from("schema_migrations")
      .insert({
        tenant_id: auth.tenantId,
        object_type_id: body.object_type_id,
        from_version: "current",  // 简化: 实际应从 active_version 读
        to_version: body.new_version,
        affected_rows: body.affected_rows_estimate ?? 0,
        status: "running",
      })
      .select()
      .single();

    if (migErr) throw new Error(`migration log: ${migErr.message}`);

    // 2. 切换版本
    const { error: rpcErr } = await supabase.rpc("activate_object_type_version", {
      p_tenant_id: auth.tenantId,
      p_object_type_id: body.object_type_id,
      p_new_version: body.new_version,
    });
    if (rpcErr) {
      // 标记失败
      await supabase.from("schema_migrations")
        .update({ status: "failed", error: rpcErr.message, completed_at: new Date().toISOString() })
        .eq("id", mig.id);
      throw new Error(`RPC failed: ${rpcErr.message}`);
    }

    // 3. 标记完成
    await supabase.from("schema_migrations")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", mig.id);

    return new Response(JSON.stringify({
      object_type_id: body.object_type_id,
      new_active_version: body.new_version,
      migration_id: mig.id,
      status: "completed",
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
});