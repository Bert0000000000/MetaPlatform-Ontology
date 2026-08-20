// src/pages/Audit.tsx
// Audit log: 过滤 by date range / actor / action

import { useEffect, useState } from 'react';
import { Spin, Table, Input, Button, Banner, DatePicker } from '@douyinfe/semi-ui';
import { Api } from '@/api/client';

const COLUMNS = [
  { title: 'ID', dataIndex: 'id', width: 80 },
  { title: 'Tenant', dataIndex: 'tenant_id', width: 100 },
  { title: 'Actor', dataIndex: 'actor_id', width: 100 },
  { title: 'Action', dataIndex: 'action', width: 140 },
  { title: 'Schema', dataIndex: 'schema_name', width: 100 },
  { title: 'Table', dataIndex: 'table_name', width: 140 },
  {
    title: 'Occurred',
    dataIndex: 'occurred_at',
    width: 200,
    render: (v: string) => (v ? new Date(v).toLocaleString() : ''),
  },
];

export default function AuditPage() {
  const [data, setData] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<[string, string] | undefined>(undefined);
  const [actor, setActor] = useState('');
  const [action, setAction] = useState('');

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const params: { from?: string; to?: string; actor?: string; action?: string } = {};
      if (dateRange) {
        params.from = dateRange[0];
        params.to = dateRange[1];
      }
      if (actor) params.actor = actor;
      if (action) params.action = action;
      const rows = await Api.audit(params);
      setData(rows);
    } catch (e) {
      setError(`Error: ${(e instanceof Error ? e.message : String(e)) || 'unknown'}`);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); /* first paint */ }, []);

  if (error) return <Banner type="danger" title="加载 Audit 失败" description={error} />;

  return (
    <div data-testid="mp-audit-page">
      <h2 style={{ marginTop: 0 }}>Audit Log</h2>
      <div style={{ display: 'flex', gap: 12, marginBottom: 12, alignItems: 'center' }}>
        <DatePicker
          type="dateRange"
          placeholder={['From', 'To']}
          onChange={(d) => setDateRange(Array.isArray(d) ? (d as string[]) as [string, string] : undefined)}
          style={{ width: 280 }}
          data-testid="mp-audit-date-range"
        />
        <Input
          placeholder="actor (uuid)"
          value={actor}
          onChange={(v) => setActor(v)}
          style={{ width: 220 }}
          data-testid="mp-audit-actor"
        />
        <Input
          placeholder="action (eg INSERT/UPDATE)"
          value={action}
          onChange={(v) => setAction(v)}
          style={{ width: 200 }}
          data-testid="mp-audit-action"
        />
        <Button
          theme="solid" type="primary"
          onClick={() => load()}
          data-testid="mp-audit-apply"
        >
          应用
        </Button>
        <Button onClick={() => { setDateRange(undefined); setActor(''); setAction(''); load(); }}>
          清空
        </Button>
      </div>
      {loading
        ? <Spin />
        : (
          <Table
            rowKey="id"
            dataSource={data}
            columns={COLUMNS as never}
            pagination={{ pageSize: 25 }}
            data-testid="mp-audit-table"
          />
        )}
      <div style={{ marginTop: 8, fontSize: 12, color: 'var(--semi-color-text-2)' }}>
        共 {data.length} 条记录
      </div>
    </div>
  );
}
