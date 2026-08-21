// src/components/Layout.tsx — Semi Design Sider + Header + Content + Footer
import React, { useState } from 'react';
import { Layout as SemiLayout, Nav, Avatar, Badge } from '@douyinfe/semi-ui';
import { IconHome, IconBranch, IconHandle, IconAppCenter, IconShield, IconPulse, IconFile, IconServer, IconUser, IconGridRectangle, IconLayers } from '@douyinfe/semi-icons';
import { Link, useLocation } from 'react-router-dom';

const { Sider, Header, Content, Footer } = SemiLayout;

const navItems = [
  { key: '/', label: 'Dashboard', icon: <IconHome /> },
  { key: '/admin/ontology', label: 'Ontology', icon: <IconBranch /> },
  { key: '/admin/hitl', label: 'HITL Hub', icon: <IconHandle /> },
  { key: '/admin/sessions', label: 'dsh Sessions', icon: <IconAppCenter /> },
  { key: '/admin/sandbox', label: 'mp-sandbox', icon: <IconShield /> },
  { key: '/admin/monitoring', label: '系统监控', icon: <IconPulse /> },
  { key: '/admin/audit', label: 'mp-audit', icon: <IconFile /> },
  { key: '/admin/frontend-obs', label: 'frontend-obs', icon: <IconLayers /> },
  { key: '/admin/marketplace', label: 'Marketplace', icon: <IconAppCenter /> },
  { key: '/admin/runtime', label: 'mp-runtime', icon: <IconServer /> },
  { key: '/admin/tenants', label: 'Tenants', icon: <IconUser /> },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [selectedKey, setSelectedKey] = useState(location.pathname);

  // 当路由变化时同步 selectedKey
  React.useEffect(() => {
    setSelectedKey(location.pathname);
  }, [location.pathname]);

  return (
    <SemiLayout style={{ minHeight: '100vh' }}>
      <Sider style={{ backgroundColor: 'var(--semi-color-bg-1)' }}>
        <Nav
          selectedKeys={[selectedKey]}
          style={{ maxWidth: 220, height: '100%' }}
          items={navItems}
          onSelect={(item) => {
            setSelectedKey(item.itemKey as string);
          }}
          renderWrapper={(item) => {
            return (
              <Link to={item.key} style={{ color: 'inherit', textDecoration: 'none' }}>
                {item.label}
              </Link>
            );
          }}
          footer={{
            collapseButton: true,
          }}
        />
      </Sider>
      <SemiLayout>
        <Header style={{ backgroundColor: 'var(--semi-color-bg-1)', borderBottom: '1px solid var(--semi-color-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px' }}>
            <div style={{ fontSize: 16, fontWeight: 600 }}>MetaPlatform Admin</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <Badge count={5} type="warning">
                <span style={{ color: 'var(--semi-color-text-2)' }}>Notifications</span>
              </Badge>
              <Avatar color="orange" size="small">MP</Avatar>
            </div>
          </div>
        </Header>
        <Content style={{ padding: 24, backgroundColor: 'var(--semi-color-bg-0)' }}>
          {children}
        </Content>
        <Footer style={{ textAlign: 'center', color: 'var(--semi-color-text-2)', fontSize: 12, backgroundColor: 'var(--semi-color-bg-1)' }}>
          MetaPlatform v6.0 · © 2026
        </Footer>
      </SemiLayout>
    </SemiLayout>
  );
}