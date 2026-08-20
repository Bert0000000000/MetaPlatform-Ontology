// supabase/functions/onboard-employee/index.ts
// PRD: docs/active/prd/domain-migrate-17.md §4.2
// Batch: MP-V6-DOMAIN-MIGRATE-01
// 员工 on/off-boarding: 创建 profile + 默认 role + 通知

// @ts-nocheck — Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { verifyAuth, AuthError, authErrorResponse } from "../_template-auth/index.ts";

interface OnboardEmployeeRequest {
  email: string;
  full_name: string;
  department_id?: string;
  title?: string;
  hire_date?: string;
  role?: 'owner' | 'admin' | 'member' | 'guest';
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const auth = await verifyAuth(req);
    if (auth.role !== 'owner' && auth.role !== 'admin') {
      throw new AuthError('INSUFFICIENT_ROLE', 'Only owner/admin can onboard employees', 403);
    }

    const body = await req.json() as OnboardEmployeeRequest;
    if (!body.email || !body.full_name) {
      throw new Error("Missing email or full_name");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. 创建 Supabase Auth user (邀请链接模式)
    const { data: created, error: createErr } = await supabase.auth.admin.inviteUserByEmail(
      body.email,
      { redirectTo: `${Deno.env.get('FRONTEND_URL')}/onboarding` },
    );

    if (createErr || !created.user) {
      throw new Error(`Auth user invite failed: ${createErr?.message}`);
    }
    const userId = created.user.id;

    // 2. 创建 profiles 记录 (1:1 with auth.users)
    await supabase.from("profiles").upsert({
      id: userId,
      tenant_id: auth.tenantId,
      email: body.email,
      display_name: body.full_name,
      role: body.role ?? 'member',
    });

    // 3. 创建 employees 记录 (HR 系统)
    const employeeNumber = `EMP-${Date.now().toString(36).toUpperCase()}`;

    const { data: employee, error: empErr } = await supabase
      .from("employees")
      .insert({
        tenant_id: auth.tenantId,
        user_id: userId,
        employee_number: employeeNumber,
        full_name: body.full_name,
        department_id: body.department_id ?? null,
        title: body.title ?? null,
        hire_date: body.hire_date ?? new Date().toISOString().split('T')[0],
        status: 'active',
        contact_email: body.email,
      })
      .select()
      .single();

    if (empErr || !employee) throw new Error(`employees insert failed: ${empErr?.message}`);

    // 4. Realtime broadcast
    await supabase.channel(`realtime:${auth.tenantId}`).send({
      type: 'broadcast',
      event: 'employee_onboarded',
      payload: { employee_id: employee.id, name: body.full_name },
    });

    return new Response(JSON.stringify({
      employee_id: employee.id,
      user_id: userId,
      onboarding_url: `${Deno.env.get('FRONTEND_URL')}/onboarding`,
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