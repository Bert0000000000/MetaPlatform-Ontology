// supabase/functions/oauth-dingtalk-callback/index.ts
// PRD: docs/active/prd/auth-jwt-rls.md §4.3
// Batch: MP-V6-AUTH-01
// 钉钉 OAuth 2.0 callback → 创建/绑定 supabase auth user

// @ts-nocheck — Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";

interface DingTalkTokenResponse {
  accessToken: string;
  refreshToken: string;
  expireIn: number;
  corpId: string;
  unionId: string;
}

interface DingTalkUserInfo {
  nick: string;
  unionId: string;
  avatarUrl?: string;
  mobile?: string;
  email?: string;
}

async function fetchDingTalkToken(code: string): Promise<DingTalkTokenResponse> {
  const appKey = Deno.env.get('DINGTALK_APP_KEY')!;
  const appSecret = Deno.env.get('DINGTALK_APP_SECRET')!;

  const resp = await fetch(
    `https://api.dingtalk.com/v1.0/oauth2/userAccessToken?appKey=${appKey}&appSecret=${appSecret}&code=${code}`,
    { method: 'POST' },
  );
  if (!resp.ok) throw new Error(`DingTalk token failed: ${resp.status}`);
  return resp.json();
}

async function fetchDingTalkUser(accessToken: string, unionId: string): Promise<DingTalkUserInfo> {
  const resp = await fetch(
    `https://api.dingtalk.com/v1.0/contact/users/me?unionId=${unionId}`,
    { headers: { 'x-acs-dingtalk-access-token': accessToken } },
  );
  if (!resp.ok) throw new Error(`DingTalk userinfo failed: ${resp.status}`);
  return resp.json();
}

serve(async (req) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');  // 携带 tenant_slug 等上下文
    if (!code) {
      return new Response(JSON.stringify({ error: 'Missing code' }), { status: 400 });
    }

    // 1. 钉钉 OAuth: code → accessToken + unionId
    const token = await fetchDingTalkToken(code);

    // 2. 拿用户信息
    const userInfo = await fetchDingTalkUser(token.accessToken, token.unionId);

    if (!userInfo.email && !userInfo.mobile) {
      return new Response(JSON.stringify({ error: 'DingTalk user has no email/mobile' }), { status: 400 });
    }

    // 3. 创建/查找 supabase auth user
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const identifier = userInfo.email ?? `${userInfo.mobile}@dingtalk.local`;
    const { data: existing } = await supabase.auth.admin.listUsers({ email: identifier });
    let userId: string;

    if (existing.users.length > 0) {
      userId = existing.users[0]!.id;
    } else {
      // 创建新用户 (OIDC 走 supabase; 密码随机)
      const { data: created, error: createErr } = await supabase.auth.admin.createUser({
        email: identifier,
        email_confirm: true,
        user_metadata: {
          provider: 'dingtalk',
          union_id: userInfo.unionId,
          nick: userInfo.nick,
          avatar_url: userInfo.avatarUrl ?? null,
        },
      });
      if (createErr || !created.user) throw new Error(`Auth user create failed: ${createErr?.message}`);
      userId = created.user.id;
    }

    // 4. 触发 magic link 登录 (前端用此链接完成最终登录)
    const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email: identifier,
    });
    if (linkErr || !linkData) throw new Error(`Magic link generation failed: ${linkErr?.message}`);

    // 5. 重定向到前端 (前端拿 token 完成登录)
    const redirectUrl = `${Deno.env.get('FRONTEND_URL')}/oauth/callback?token_hash=${encodeURIComponent(linkData.properties?.action_link ?? '')}`;
    return Response.redirect(redirectUrl, 302);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
});