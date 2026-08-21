// src/auth/rbac.ts
// Role-based access control for mp-platform admin
// 角色层级: guest < member < admin < owner
// 每个 page 标一个 requiredRole, 路由层 (App.tsx) 做硬拦截
// UI 元素级: 通过 useCan() hook 做条件渲染

import type { SessionUser } from '@/api/client';

export type Role = 'owner' | 'admin' | 'member' | 'guest';

const ROLE_RANK: Record<Role, number> = {
  guest: 0, member: 1, admin: 2, owner: 3,
};

export function hasRole(user: SessionUser | null, required: Role): boolean {
  if (!user) return false;
  return ROLE_RANK[user.role] >= ROLE_RANK[required];
}

export function canAccessAdminPanel(user: SessionUser | null): boolean {
  return hasRole(user, 'admin');
}

export function canMutateTenants(user: SessionUser | null): boolean {
  return hasRole(user, 'owner');
}

export function canViewAudit(user: SessionUser | null): boolean {
  return hasRole(user, 'admin');
}

export function canViewCron(user: SessionUser | null): boolean {
  return hasRole(user, 'admin');
}

export interface PageAccessRule {
  path: string;
  requiredRole: Role;
  label: string;
}

export const PAGE_ACCESS: PageAccessRule[] = [
  { path: '/dashboard',  requiredRole: 'admin',  label: 'Dashboard' },
  { path: '/tenants',    requiredRole: 'admin',  label: 'Tenants' },
  { path: '/audit',      requiredRole: 'admin',  label: 'Audit' },
  { path: '/presets',    requiredRole: 'member', label: 'Presets/Installs' },
  { path: '/cron',       requiredRole: 'admin',  label: 'Cron Jobs' },
];

export function pageAllowedFor(user: SessionUser | null, path: string): boolean {
  const rule = PAGE_ACCESS.find((p) => p.path === path);
  if (!rule) return true;
  return hasRole(user, rule.requiredRole);
}
