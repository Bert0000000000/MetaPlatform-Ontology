// supabase/functions/_template-auth/index.ts
// PRD: docs/active/prd/auth-jwt-rls.md §6.2
// Batch: MetaPlatform-AUTH-01
// Edge Function JWT 验证模板 — 业务 Batch 复用

// @ts-nocheck — Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";

export interface AuthContext {
  readonly userId: string;
  readonly tenantId: string;
  readonly role: 'owner' | 'admin' | 'member' | 'guest';
  readonly email: string;
}

export async function verifyAuth(req: Request): Promise<AuthContext> {
  const authHeader = req.headers.get('authorization');
  if (!authHeader) {
    throw new AuthError('MISSING_AUTH', 'Missing Authorization header', 401);
  }

  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) {
    throw new AuthError('MISSING_TOKEN', 'Missing Bearer token', 401);
  }

  // 用 anon key 解析 (不会消耗 RLS, 仅验签)
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
  );

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    throw new AuthError('INVALID_TOKEN', `JWT validation failed: ${error?.message ?? 'no user'}`, 401);
  }

  // 从 app_metadata 拿 claims (由 custom_access_token_hook 注入)
  const meta = user.app_metadata as { tenant_id?: string; role?: string };

  if (!meta.tenant_id) {
    throw new AuthError('MISSING_TENANT', 'JWT missing tenant_id claim', 403);
  }

  return {
    userId: user.id,
    tenantId: meta.tenant_id,
    role: (meta.role ?? 'member') as AuthContext['role'],
    email: user.email ?? '',
  };
}

export class AuthError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

// 标准 401/403 响应
export function authErrorResponse(err: AuthError): Response {
  return new Response(
    JSON.stringify({ error: err.code, message: err.message }),
    { status: err.status, headers: { 'Content-Type': 'application/json' } },
  );
}

// 用法示例 (业务 Edge Function 引用此模板):
//
// serve(async (req) => {
//   try {
//     const auth = await verifyAuth(req);
//     // ... 业务逻辑 ...
//     return new Response(JSON.stringify({ tenant_id: auth.tenantId }));
//   } catch (err) {
//     if (err instanceof AuthError) return authErrorResponse(err);
//     return new Response(JSON.stringify({ error: 'internal' }), { status: 500 });
//   }
// });