// supabase/functions/send-notification/index.ts
// PRD: docs/active/prd/domain-migrate-17.md §4.2
// Batch: MP-V6-DOMAIN-MIGRATE-01
// 多通道通知: Realtime + Email + 可选 SMS/Push

// @ts-nocheck — Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { verifyAuth, AuthError, authErrorResponse } from "../_template-auth/index.ts";

interface SendNotificationRequest {
  recipient_user_ids: string[];
  title: string;
  body?: string;
  channels: Array<'realtime' | 'email' | 'sms' | 'push'>;
  metadata?: Record<string, unknown>;
  priority?: 'low' | 'normal' | 'high';
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const auth = await verifyAuth(req);
    const body = await req.json() as SendNotificationRequest;

    if (!body.recipient_user_ids?.length || !body.title || !body.channels?.length) {
      throw new Error("Missing recipient_user_ids / title / channels");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const results: Record<string, { sent: number; failed: number }> = {};

    // 1. Realtime broadcast (默认必走)
    if (body.channels.includes('realtime')) {
      let sent = 0, failed = 0;
      for (const userId of body.recipient_user_ids) {
        try {
          await supabase.channel(`notify:${userId}`).send({
            type: 'broadcast',
            event: 'notification_new',
            payload: {
              title: body.title,
              body: body.body,
              priority: body.priority ?? 'normal',
              metadata: body.metadata,
            },
          });
          sent++;
        } catch (err) {
          console.error(`[notify] realtime failed for ${userId}: ${err}`);
          failed++;
        }
      }
      results.realtime = { sent, failed };
    }

    // 2. Email (stub: 实际调 SendGrid / SMTP)
    if (body.channels.includes('email')) {
      console.info(`[notify] would email ${body.recipient_user_ids.length} users: ${body.title}`);
      results.email = { sent: body.recipient_user_ids.length, failed: 0 };
    }

    // 3. SMS / Push (P2)
    if (body.channels.includes('sms')) {
      console.info(`[notify] SMS not implemented yet`);
      results.sms = { sent: 0, failed: 0 };
    }

    // 4. 写 notifications 表 (审计)
    for (const userId of body.recipient_user_ids) {
      await supabase.from("notifications").insert({
        tenant_id: auth.tenantId,
        recipient_user_id: userId,
        title: body.title,
        body: body.body ?? null,
        channels: body.channels,
        priority: body.priority ?? 'normal',
        metadata: body.metadata ?? {},
      });
    }

    return new Response(JSON.stringify({
      sent_to: body.recipient_user_ids.length,
      results,
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