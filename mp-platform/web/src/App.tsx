// src/App.tsx
// 顶层布局: Sidebar (Nav) + Header (用户/退出) + 主区域 (Route)
// 路由层级: 登录 → 受保护页面 (RBAC)

import { Layout, Nav, Avatar, Dropdown, Spin } from '@douyinfe/semi-ui';
import { IconHome, IconUser, IconSafe, IconApps, IconClock } from '@douyinfe/semi-icons';
import { Routes, Route, Link, useLocation, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { pageAllowedFor, PAGE_ACCESS } from '@/auth/rbac';
import LoginPage from '@/pages/Login';
import DashboardPage from '@/pages/Dashboard';
import TenantsPage from '@/pages/Tenants';
import AuditPage from '@/pages/Audit';
import InstPresetsPage from '@/pages/InstPresets';
import CronJobsPage from '@/pages/CronJobs';
import type { ReactNode } from 'react';

const { Header, Sider, Content } = Layout;

function Protected({ children, required }: { children: ReactNode; required?: string }) {
  const { user, isReady } = useAuth();
  const navigate = useNavigate();
  if (!isReady) return <div style={{ padding: 32 }}><Spin /></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (required && !pageAllowedFor(user, required)) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

export function App() {
  const { user, logout, isReady } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  if (!isReady) {
    return <div style={{ padding: 32 }}><Spin size="large" /></div>;
  }

  if (location.pathname === '/login' || !user) {
    if (location.pathname !== '/login') {
      return <Navigate to="/login" replace />;
    }
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  const navItems = PAGE_ACCESS.filter((p) => pageAllowedFor(user, p.path));

  return (
    <Layout style={{ height: '100vh' }}>
      <Sider style={{ background: 'var(--semi-color-bg-1)' }} data-testid="mp-sidebar">
        <div style={{
          padding: '20px 16px', fontWeight: 600, fontSize: 16, color: 'var(--semi-color-text-0)',
          borderBottom: '1px solid var(--semi-color-border)',
        }}>
          mp-platform
        </div>
        <Nav
          selectedKeys={[location.pathname]}
          onSelect={(d) => navigate(d.itemKey as string)}
          style={{ paddingTop: 8 }}
          items={navItems.map((p) => ({
            itemKey: p.path,
            text: p.label,
            icon: iconFor(p.path),
          }))}
        />
      </Sider>
      <Layout>
        <Header style={{
          background: 'var(--semi-color-bg-1)', display: 'flex',
          alignItems: 'center', justifyContent: 'space-between', padding: '0 24px',
          borderBottom: '1px solid var(--semi-color-border)',
        }}>
          <div style={{ fontSize: 18, fontWeight: 500 }} data-testid="mp-page-title">
            mp-platform 管理后台
          </div>
          <Dropdown
            trigger="click"
            menu={[
              { node: 'item', name: 'profile', children: <span data-testid="mp-user-email">{user.email}</span> as unknown as string },
              { node: 'divider' },
              {
                node: 'item',
                name: 'logout',
                children: <span onClick={() => { logout(); navigate('/login'); }} data-testid="mp-logout">退出登录</span> as unknown as string,
              },
            ]}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <Avatar size="small" style={{ background: 'var(--semi-color-primary)' }}>
                {user.email?.[0]?.toUpperCase()}
              </Avatar>
              <span style={{ fontSize: 14 }}>{user.email}</span>
            </div>
          </Dropdown>
        </Header>
        <Content style={{ padding: 24, background: 'var(--semi-color-bg-0)', overflow: 'auto' }}>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/dashboard" element={<Protected><DashboardPage /></Protected>} />
            <Route path="/tenants"  element={<Protected required="/tenants"><TenantsPage /></Protected>} />
            <Route path="/audit"    element={<Protected required="/audit"><AuditPage /></Protected>} />
            <Route path="/presets"  element={<Protected required="/presets"><InstPresetsPage /></Protected>} />
            <Route path="/cron"     element={<Protected required="/cron"><CronJobsPage /></Protected>} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </Content>
      </Layout>
    </Layout>
  );
}

function iconFor(path: string) {
  switch (path) {
    case '/dashboard': return <IconHome />;
    case '/tenants':   return <IconUser />;
    case '/audit':     return <IconSafe />;
    case '/presets':   return <IconApps />;
    case '/cron':      return <IconClock />;
    default:           return undefined;
  }
}
