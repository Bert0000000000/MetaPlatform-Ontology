// supabase/functions/generate-invoice/index.ts
// PRD: docs/active/prd/domain-migrate-17.md §4.2
// Batch: MP-V6-DOMAIN-MIGRATE-01
// 生成发票 PDF + 邮件 + 状态更新 (替代 v3.0 FastAPI InvoiceService)

// @ts-nocheck — Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { verifyAuth, AuthError, authErrorResponse } from "../_template-auth/index.ts";

interface GenerateInvoiceRequest {
  invoice_id: string;
  recipient_email?: string;       // 默认从 customers.contact_email
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const auth = await verifyAuth(req);
    const body = await req.json() as GenerateInvoiceRequest;
    if (!body.invoice_id) throw new Error("Missing invoice_id");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. 读 invoice + customer
    const { data: invoice, error: invErr } = await supabase
      .from("invoices")
      .select("*, customers(name, contact_email)")
      .eq("id", body.invoice_id)
      .eq("tenant_id", auth.tenantId)
      .single();

    if (invErr || !invoice) throw new Error(`invoice not found: ${body.invoice_id}`);

    if (invoice.status === 'paid') {
      throw new Error(`invoice already paid`);
    }

    const customer = Array.isArray(invoice.customers) ? invoice.customers[0] : invoice.customers;
    const recipient = body.recipient_email ?? customer?.contact_email;
    if (!recipient) throw new Error("No recipient email");

    // 2. 生成 PDF (upload 到 Supabase Storage)
    const invoiceNumber = invoice.invoice_number;
    const pdfContent = await generateInvoicePdf(invoice, customer);
    const pdfPath = `${auth.tenantId}/${invoiceNumber}.pdf`;

    const { error: uploadErr } = await supabase.storage
      .from('invoices')
      .upload(pdfPath, pdfContent, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadErr) throw new Error(`PDF upload failed: ${uploadErr.message}`);

    const { data: publicUrl } = supabase.storage.from('invoices').getPublicUrl(pdfPath);

    // 3. 更新 invoice status = 'issued' + document_url
    await supabase.from("invoices").update({
      status: 'issued',
      document_url: publicUrl.publicUrl,
    }).eq("id", body.invoice_id);

    // 4. (stub) 发送邮件 - 实际调 SendGrid / SMTP
    console.info(`[invoice] would email PDF to ${recipient}: ${publicUrl.publicUrl}`);

    // 5. Realtime broadcast
    await supabase.channel(`realtime:${auth.tenantId}`).send({
      type: 'broadcast',
      event: 'invoice_issued',
      payload: { invoice_id: body.invoice_id, pdf_url: publicUrl.publicUrl },
    });

    return new Response(JSON.stringify({
      invoice_id: body.invoice_id,
      pdf_url: publicUrl.publicUrl,
      recipient,
      status: 'issued',
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

async function generateInvoicePdf(invoice: Record<string, unknown>, customer: unknown): Promise<Uint8Array> {
  // 简化: 实际可用 PDFKit / jsPDF
  // 这里返回 mock PDF (实际生产用 Supabase Storage + PDFKit)
  const text = `INVOICE ${invoice['invoice_number']}\nCustomer: ${(customer as { name?: string })?.name}\nAmount: ${invoice['total_amount']} ${invoice['currency']}`;
  return new TextEncoder().encode(text);
}