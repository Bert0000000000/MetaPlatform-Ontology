// supabase/functions/bulk-import/index.ts
// PRD: docs/active/prd/edge-fn-17-domains.md §4.2
// Batch: MetaPlatform-EDGE-FN-01
// 批量导入: 用 audit.disable=on 跳过 audit_log (大量写时不写审计)
// 注: 仅 ETL / 迁移场景使用, 业务批量写仍走 audit

// @ts-nocheck — Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { verifyAuth, AuthError, authErrorResponse } from "../_template-auth/index.ts";

interface BulkImportRequest {
  table: string;                        // 'customers' | 'orders' | 'products' 等
  rows: Array<Record<string, unknown>>;
  batch_size?: number;                  // 默认 500
  upsert?: boolean;                     // 默认 false (insert)
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const auth = await verifyAuth(req);
    if (auth.role !== 'admin' && auth.role !== 'owner') {
      throw new AuthError('INSUFFICIENT_ROLE', 'Bulk import requires admin/owner role', 403);
    }

    const body = await req.json() as BulkImportRequest;
    if (!body.table || !Array.isArray(body.rows) || body.rows.length === 0) {
      throw new Error("Missing table or rows");
    }

    // 校验表名 (防 SQL injection)
    const ALLOWED_TABLES = ['customers', 'orders', 'products', 'contracts', 'invoices', 'tickets', 'employees'];
    if (!ALLOWED_TABLES.includes(body.table)) {
      throw new Error(`table not allowed: ${body.table}`);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const batchSize = body.batch_size ?? 500;
    const total = body.rows.length;
    let imported = 0;
    let errors: Array<{ index: number; error: string }> = [];

    // 分批插入
    for (let i = 0; i < total; i += batchSize) {
      const batch = body.rows.slice(i, i + batchSize);

      const { error } = await supabase
        .from(body.table)
        // 注: audit 触发器仍在, 但因为是 batch 内大量写, 性能可接受
        .insert(batch);

      if (error) {
        errors.push({ index: i, error: error.message });
      } else {
        imported += batch.length;
      }
    }

    return new Response(JSON.stringify({
      imported,
      errors,
      total,
    }), {
      status: 200,
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