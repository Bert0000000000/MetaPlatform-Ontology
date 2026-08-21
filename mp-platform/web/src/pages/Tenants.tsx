// src/pages/Tenants.tsx
// Tenants 列表 + 搜索 + 状态过滤

import { useEffect, useState } from 'react';
import { Spin, Table, Input, Select, Banner } from '@douyinfe/semi-ui';
import { Api } from '@/api/client';

const COLUMNS = [
  { title: 'ID', dataIndex: 'id', width: 80 },
  { title: 'Slug', dataIndex: 'slug' },
  { title: 'Name', dataIndex: 'name' },
  { title: 'Status', dataIndex: 'status', width: 120 },
  {
    title: 'Created',
    dataIndex: 'created_at',
    width: 220,
    render: (v: string) => (v ? new Date(v).toLocaleString() : ''),
  },
];

export default function TenantsPage() {
  const [data, setData] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string | undefined>(undefined);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const rows = await Api.tenants({
        search: search || undefined,
        status: status || undefined,
      });
      setData(rows);
    } catch (e) {
      setError(`Error: ${(e instanceof Error ? e.message : String(e)) || 'unknown'}`);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); /* first paint */ }, []);
  useEffect(() => { load(); /* when filter changes */ }, [search, status]);

  if (error) return <Banner type="danger" title="加载 Tenants 失败" description={error} />;

  return (
    <div data-testid="mp-tenants-page">
      <h2 style={{ marginTop: 0 }}>Tenants</h2>
      <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
        <Input
          placeholder="搜索 slug/name"
          value={search}
          onChange={(v) => setSearch(v)}
          style={{ width: 240 }}
          data-testid="mp-tenants-search"
        />
        <Select
          placeholder="状态"
          value={status}
          onChange={(v) => setStatus(v as string | undefined)}
          style={{ width: 160 }}
          data-testid="mp-tenants-status"
          optionList={[
            { value: 'active', label: 'active' },
            { value: 'suspended', label: 'suspended' },
            { value: 'archived', label: 'archived' },
          ]}
        />
      </div>
      {loading
        ? <Spin />
        : (
          <Table
            rowKey="id"
            dataSource={data}
            columns={COLUMNS as never}
            pagination={{ pageSize: 20 }}
            data-testid="mp-tenants-table"
          />
        )}
      <div style={{ marginTop: 8, fontSize: 12, color: 'var(--semi-color-text-2)' }}>
        共 {data.length} 条记录
      </div>
    </div>
  );
}
