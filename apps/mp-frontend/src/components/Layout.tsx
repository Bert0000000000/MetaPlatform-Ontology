// src/components/Layout.tsx — Semi Design 240px Sider + 4 一级模块 SubNav + Header + Content + Footer
import React, { useState, useMemo } from 'react';
import { Layout as SemiLayout, Nav } from '@douyinfe/semi-ui';
import {
  IconHome, IconBranch, IconHandle, IconAppCenter, IconShield,
  IconPulse, IconFile, IconServer, IconUser, IconGridRectangle, IconLayers,
} from '@douyinfe/semi-icons';
import { Link, useLocation } from 'react-router-dom';

const { Sider, Header, Content, Footer } = SemiLayout;

// 4 一级模块 + 子菜单 (按字母序: Ontology 本体 / 云市场 / 应用中心 / 运营管理)
const navItems = [
  {
    itemKey: 'ontology',
    text: 'Ontology 本体平台',
    icon: <IconBranch />,
    items: [
      { itemKey: '/admin/ontology/dashboard', text: 'Dashboard' },
      { itemKey: '/admin/ontology/objects', text: 'ObjectType' },
      { itemKey: '/admin/ontology/relations', text: 'RelationType' },
      { itemKey: '/admin/ontology/actions', text: 'ActionType' },
      { itemKey: '/admin/ontology/graph', text: '本体图谱' },
      { itemKey: '/admin/ontology/kb', text: '知识库' },
      { itemKey: '/admin/ontology/llm', text: 'LLM 生成' },
    ],
  },
  {
    itemKey: 'marketplace',
    text: '云市场',
    icon: <IconAppCenter />,
    items: [
      { itemKey: '/admin/marketplace', text: 'Browse' },
      { itemKey: '/admin/marketplace/installs', text: 'My Installs' },
      { itemKey: '/admin/marketplace/publish', text: 'Publish (admin)' },
      { itemKey: '/admin/marketplace/search', text: 'Search' },
    ],
  },
  {
    itemKey: 'apps',
    text: '应用中心',
    icon: <IconLayers />,
    items: [
      { itemKey: '/admin/frontend-obs', text: 'frontend-obs' },
      { itemKey: '/admin/sandbox', text: 'Sandbox' },
    ],
  },
  {
    itemKey: 'ops',
    text: '运营管理',
    icon: <IconServer />,
    items: [
      { itemKey: '/admin/dashboard', text: 'Dashboard' },
      { itemKey: '/admin/runtime', text: 'Runtime' },
      { itemKey: '/admin/monitoring', text: 'Monitoring' },
      { itemKey: '/admin/audit', text: 'Audit' },
      { itemKey: '/admin/tenants', text: 'Tenants' },
    ],
  },
];

// 兼容旧路由: /admin/ontology → /admin/ontology/objects, /admin/hitl → /admin/hitl (在 ops 里没有 hitl, 归到 ontology 的子菜单?)
// 把旧路由映射到一级模块 key
const LEGACY_TO_MODULE: Record<string, string> = {
  '/': 'ops',
  '/admin/ontology': 'ontology',
  '/admin/hitl': 'ops',
  '/admin/sessions': 'ops',
  '/admin/sandbox': 'apps',
  '/admin/monitoring': 'ops',
  '/admin/audit': 'ops',
  '/admin/frontend-obs': 'apps',
  '/admin/runtime': 'ops',
  '/admin/tenants': 'ops',
  '/admin/marketplace': 'marketplace',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [openMap, setOpenMap] = useState<Record<string, boolean>>(() => {
    // 默认展开当前路由所属的一级模块
    const m: Record<string, boolean> = {};
    for (const [path, mod] of Object.entries(LEGACY_TO_MODULE)) {
      if (location.pathname.startsWith(path)) {
        m[mod] = true;
      }
    }
    // 新路由: 按前缀匹配
    if (location.pathname.startsWith('/admin/ontology')) m['ontology'] = true;
    if (location.pathname.startsWith('/admin/marketplace')) m['marketplace'] = true;
    if (location.pathname.startsWith('/admin/ops')) m['ops'] = true;
    if (location.pathname.startsWith('/admin/apps')) m['apps'] = true;
    return m;
  });
  const [selectedKey, setSelectedKey] = useState(location.pathname);
  const [collapsed, setCollapsed] = useState(false);

  React.useEffect(() => {
    setSelectedKey(location.pathname);
    // 自动展开
    for (const [path, mod] of Object.entries(LEGACY_TO_MODULE)) {
      if (location.pathname.startsWith(path)) {
        setOpenMap((prev) => ({ ...prev, [mod]: true }));
      }
    }
    if (location.pathname.startsWith('/admin/ontology')) setOpenMap((p) => ({ ...p, ontology: true }));
    if (location.pathname.startsWith('/admin/marketplace')) setOpenMap((p) => ({ ...p, marketplace: true }));
    if (location.pathname.startsWith('/admin/apps')) setOpenMap((p) => ({ ...p, apps: true }));
    if (location.pathname.startsWith('/admin/dashboard') || location.pathname.startsWith('/admin/runtime') || location.pathname.startsWith('/admin/monitoring') || location.pathname.startsWith('/admin/audit') || location.pathname.startsWith('/admin/tenants')) {
      setOpenMap((p) => ({ ...p, ops: true }));
    }
  }, [location.pathname]);

  const openKeys = useMemo(
    () => Object.entries(openMap).filter(([_, v]) => v).map(([k]) => k),
    [openMap],
  );

  return (
    <SemiLayout style={{ minHeight: '100vh' }}>
      <Sider
        style={{
          backgroundColor: 'rgba(248, 250, 252, 0.85)',
          backdropFilter: 'blur(6px)',
          borderRight: '1px solid var(--semi-color-border)',
          width: collapsed ? 64 : 240,
          transition: 'width 0.2s',
        }}
      >
        <Nav
          selectedKeys={[selectedKey]}
          openKeys={openKeys}
          style={{ width: '100%', height: '100%' }}
          items={navItems}
          isCollapsed={collapsed}
          onSelect={(item) => {
            setSelectedKey(item.itemKey as string);
          }}
          onOpenChange={(data) => {
            const next: Record<string, boolean> = {};
            for (const k of data.openKeys as string[]) {
              next[k] = true;
            }
            setOpenMap(next);
          }}
          renderWrapper={({ itemElement, isSubNav, isInSubNav, props }) => {
            // SubNav 标题本身不跳转, 子项才跳转
            if (isSubNav || (props as { itemKey?: string }).itemKey === undefined) {
              return itemElement;
            }
            return (
              <Link to={(props as { itemKey: string }).itemKey} style={{ color: 'inherit', textDecoration: 'none' }}>
                {itemElement}
              </Link>
            );
          }}
          footer={{
            collapseButton: true,
            onClick: () => setCollapsed((c) => !c),
          }}
        />
      </Sider>
      <SemiLayout>
        <Header style={{ backgroundColor: 'var(--semi-color-bg-1)', borderBottom: '1px solid var(--semi-color-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px' }}>
            <div style={{ fontSize: 16, fontWeight: 600 }}>MetaPlatform Admin</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 13, color: 'var(--semi-color-text-2)' }}>
              <span>v6.0 · Ontology 本体 + AgentOS</span>
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