// src/api/client.ts
// JWT-aware fetch wrapper for mp-platform admin API
// - Vite dev server proxies /api/* → admin-api.mjs (127.0.0.1:8081)
// - JWT stored in localStorage after login

const TOKEN_KEY = 'mp.admin.jwt';
const USER_KEY = 'mp.admin.user';

export interface SessionUser {
  id: string;
  email: string;
  role: 'owner' | 'admin' | 'member' | 'guest';
  tenantId: string;
  displayName?: string;
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function getUser(): SessionUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as SessionUser; } catch { return null; }
}

export function setUser(user: SessionUser | null) {
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
  else localStorage.removeItem(USER_KEY);
}

export interface ApiError extends Error {
  status?: number;
}

export async function api<T = unknown>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    const err: ApiError = new Error(`${res.status} ${res.statusText}`) as ApiError;
    err.status = res.status;
    try { err.message = JSON.stringify(await res.json()); } catch { /* noop */ }
    throw err;
  }
  return res.json() as Promise<T>;
}

export const Api = {
  health: () => api<{ ok: boolean; version: string }>('/api/health'),
  stats: () => api<{
    tenants: number; users: number; audits24h: number;
    installs: number; presets: number; cron: number;
  }>('/api/stats'),
  tenants: (params: { search?: string; status?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.search) q.set('search', params.search);
    if (params.status) q.set('status', params.status);
    return api<Array<Record<string, unknown>>>(`/api/tenants?${q}`);
  },
  audit: (params: { from?: string; to?: string; actor?: string; action?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.from) q.set('from', params.from);
    if (params.to) q.set('to', params.to);
    if (params.actor) q.set('actor', params.actor);
    if (params.action) q.set('action', params.action);
    return api<Array<Record<string, unknown>>>(`/api/audit?${q}`);
  },
  presets: () => api<Array<Record<string, unknown>>>('/api/presets'),
  installs: () => api<Array<Record<string, unknown>>>('/api/installs'),
  cron: () => api<Array<Record<string, unknown>>>('/api/cron'),
};

export function clearSession() {
  setToken(null);
  setUser(null);
}
