// src/pages/Login.tsx
// Admin 登录页: 通过 Supabase Auth /auth/v1/token 拿 JWT, 解码得到 role/tenant_id
//
// 流程:
//   1. 用户输入 email + password
//   2. POST /auth/v1/token?grant_type=password → access_token
//   3. 解码 JWT payload, 取 role + tenant_id + sub
//   4. 写入 AuthContext, 跳 /dashboard
//
// 配置: Supabase URL/ANON_KEY 从 import.meta.env 或默认本地 (见 CLAUDE.md §11)

import { useState } from 'react';
import { Input, Button, Toast, Banner } from '@douyinfe/semi-ui';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import type { SessionUser } from '@/api/client';

const SUPABASE_URL =
  (import.meta as unknown as { env: Record<string, string | undefined> }).env.VITE_SUPABASE_URL
  ?? 'http://localhost:54321';
const ANON_KEY =
  (import.meta as unknown as { env: Record<string, string | undefined> }).env.VITE_SUPABASE_ANON_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

function decodeJwt(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length < 2) return {};
  try { return JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return {}; }
}

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('admin@mp.local');
  const [password, setPassword] = useState('Admin123!');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!email || !password) { Toast.warning('请输入 email 和 password'); return; }
    setLoading(true);
    try {
      const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const body = await r.json();
      if (!r.ok) {
        Toast.error(`登录失败: ${body?.msg ?? body?.error_description ?? r.status}`);
        setLoading(false);
        return;
      }
      const payload = decodeJwt(body.access_token);
      const appMeta = (payload.app_metadata as Record<string, unknown> | undefined) ?? {};
      const userMeta = (payload.user_metadata as Record<string, unknown> | undefined) ?? {};
      const role = (appMeta.role ?? userMeta.role ?? payload.role ?? 'admin') as SessionUser['role'];
      const user: SessionUser = {
        id: String(payload.sub ?? ''),
        email: String(payload.email ?? email),
        role,
        tenantId: String(appMeta.tenant_id ?? ''),
        displayName: String(payload.email ?? email).split('@')[0],
      };
      login(body.access_token, user);
      Toast.success('登录成功');
      navigate('/dashboard', { replace: true });
    } catch (e) {
      Toast.error(`网络错误: ${String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div data-testid="mp-login-page" style={{
      height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--semi-color-bg-0)',
    }}>
      <div style={{
        width: 380, padding: 32, background: 'var(--semi-color-bg-1)',
        borderRadius: 8, boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
      }}>
        <h2 style={{ marginTop: 0 }}>Ontology 本体平台</h2>
        <Banner
          type="info"
          description="PoC 登录. 默认本地 Supabase. PoC 默认账号: admin@mp.local / Admin123! 由 E2E 测试创建."
          style={{ marginBottom: 16 }}
        />
        <div style={{ marginBottom: 12 }} data-testid="mp-login-email">
          <label style={{ display: 'block', fontSize: 14, marginBottom: 4 }}>Email</label>
          <Input
            value={email}
            onChange={(v) => setEmail(v)}
            style={{ width: '100%' }}
          />
        </div>
        <div style={{ marginBottom: 16 }} data-testid="mp-login-password">
          <label style={{ display: 'block', fontSize: 14, marginBottom: 4 }}>Password</label>
          <Input
            mode="password"
            value={password}
            onChange={(v) => setPassword(v)}
            style={{ width: '100%' }}
          />
        </div>
        <Button
          theme="solid" type="primary" loading={loading} block
          onClick={submit}
          data-testid="mp-login-submit"
        >
          登录
        </Button>
      </div>
    </div>
  );
}
