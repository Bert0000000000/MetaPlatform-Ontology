// src/pages/MarketplaceInstalls.tsx — 我的安装 (mp_preset_registry.installs)
import React, { useEffect, useMemo, useState } from 'react';
import { Spin, Table, Tag, Card, Input, Row, Col, Select, Empty } from '@douyinfe/semi-ui';
import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';
import { authedFetch } from '../lib/api';

interface InstallRow {
  id: string;
  preset_id: string;
  workspace_id: string;
  status: string;
  installed_at: string;
  config_override: Record<string, unknown> | null;
  presets: { slug: string; name: string; current_version: string } | null;
}

export default function MarketplaceInstalls() {
  const [rows, setRows] = useState<InstallRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await authedFetch(
        '/rest/v1/installs?select=id,preset_id,workspace_id,status,installed_at,config_override,presets(slug,name,current_version)&order=installed_at.desc&limit=200',
      ) as InstallRow[];
      setRows(r);
    } catch (e) {
      // mp_preset_registry 可能没启, schema 不可访问
      setError((e as Error).message ?? 'Failed to load installs');
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    let f = rows;
    if (search) {
      const q = search.toLowerCase();
      f = f.filter((r) => (r.presets?.slug ?? '').toLowerCase().includes(q) || (r.presets?.name ?? '').toLowerCase().includes(q) || r.workspace_id.toLowerCase().includes(q));
    }
    if (statusFilter) f = f.filter((r) => r.status === statusFilter);
    return f;
  }, [rows, search, statusFilter]);

  if (loading) return <Spin />;

  const columns = [
    { title: 'preset', dataIndex: 'presets', render: (v: InstallRow['presets']) => v ? <code>{v.slug}</code> : '—' },
    { title: 'name', dataIndex: 'presets', render: (v: InstallRow['presets']) => v?.name ?? '—' },
    { title: 'version', dataIndex: 'presets', render: (v: InstallRow['presets']) => v ? <Tag color="blue">{v.current_version}</Tag> : '—' },
    { title: 'workspace', dataIndex: 'workspace_id', render: (v: string) => v.slice(0, 8) + '…' },
    { title: 'status', dataIndex: 'status', render: (v: string) => <Tag color={v === 'active' ? 'green' : v === 'pending' ? 'orange' : 'grey'}>{v}</Tag> },
    { title: 'installed_at', dataIndex: 'installed_at' },
    { title: 'config', dataIndex: 'config_override', render: (v: Record<string, unknown> | null) => v ? <code>{JSON.stringify(v).slice(0, 40)}…</code> : '—' },
  ];

  return (
    <div>
      <PageHeader title="我的安装" description="mp_preset_registry.installs · 当前 tenant 所有 workspace 安装记录" onRefresh={load} />

      {error && (
        <Card style={{ marginBottom: 16, background: '#fff7ed', borderColor: '#fb923c' }}>
          <strong style={{ color: '#9a3412' }}>加载失败</strong>: {error}
          <div style={{ fontSize: 12, color: '#9a3412', marginTop: 4 }}>可能 mp_preset_registry schema 未启用</div>
        </Card>
      )}

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col span={6}><StatCard title="总数" value={rows.length} color="primary" /></Col>
        <Col span={6}><StatCard title="Active" value={rows.filter((r) => r.status === 'active').length} color="success" /></Col>
        <Col span={6}><StatCard title="Pending" value={rows.filter((r) => r.status === 'pending').length} color="warning" /></Col>
        <Col span={6}><StatCard title="Workspaces" value={new Set(rows.map((r) => r.workspace_id)).size} /></Col>
      </Row>

      <Card style={{ marginBottom: 16 }}>
        <Row gutter={16}>
          <Col span={14}>
            <Input placeholder="搜索 slug / name / workspace" value={search} onChange={setSearch} showClear />
          </Col>
          <Col span={8}>
            <Select
              value={statusFilter}
              onChange={(v) => setStatusFilter(typeof v === 'string' ? v : '')}
              optionList={[
                { value: '', label: '全部 status' },
                { value: 'active', label: 'active' },
                { value: 'pending', label: 'pending' },
                { value: 'uninstalled', label: 'uninstalled' },
              ]}
              style={{ width: '100%' }}
            />
          </Col>
        </Row>
      </Card>

      <Card>
        {filtered.length === 0 && !error ? (
          <Empty description="暂无安装记录" />
        ) : (
          <Table
            columns={columns}
            dataSource={filtered}
            rowKey="id"
            pagination={{ pageSize: 20 }}
          />
        )}
      </Card>
    </div>
  );
}