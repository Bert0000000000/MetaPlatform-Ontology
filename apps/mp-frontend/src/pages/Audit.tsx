// src/pages/Audit.tsx — mp-audit 完整 UI
import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Spin, Table, Card, Tag, Input, Button, Space } from '@douyinfe/semi-ui';
import PageHeader from '../components/PageHeader';
import { authedFetch } from '../lib/api';

interface AuditRow {
  id: string;
  tenant_id: string;
  actor_id: string;
  action: string;
  schema_name: string;
  table_name: string;
  occurred_at: string;
}

const ACTION_COLORS: Record<string, string> = {
  INSERT: 'green',
  UPDATE: 'orange',
  DELETE: 'red',
};

export default function Audit() {
  const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterAction, setFilterAction] = useState(params.get('action') ?? '');

  const load = async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (filterAction) qs.set('action', `eq.${filterAction}`);
      qs.set('select', 'id,tenant_id,actor_id,action,schema_name,table_name,occurred_at');
      qs.set('order', 'occurred_at.desc');
      qs.set('limit', '50');
      const r = await authedFetch(`/rest/v1/audit_log?${qs.toString()}`) as AuditRow[];
      setRows(r);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [filterAction]);

  if (loading) return <Spin />;

  const columns = [
    { title: 'occurred_at', dataIndex: 'occurred_at' },
    { title: 'action', dataIndex: 'action', render: (v: string) => <Tag color={ACTION_COLORS[v] ?? 'grey'}>{v}</Tag> },
    { title: 'schema', dataIndex: 'schema_name' },
    { title: 'table', dataIndex: 'table_name' },
    { title: 'tenant', dataIndex: 'tenant_id', render: (v: string) => v.slice(0, 8) + '…' },
    { title: 'actor', dataIndex: 'actor_id', render: (v: string) => v.slice(0, 8) + '…' },
  ];

  return (
    <div>
      <PageHeader title="mp-audit" description="全表 INSERT/UPDATE/DELETE 审计 (含 RLS)" onRefresh={load} />
      <Card style={{ marginBottom: 16 }}>
        <Space>
          <Input placeholder="action (INSERT/UPDATE/DELETE)" value={filterAction} onChange={setFilterAction} style={{ width: 240 }} />
          <Button type="primary" onClick={load}>过滤</Button>
          <Button onClick={() => { setFilterAction(''); setParams({}); }}>清除</Button>
        </Space>
      </Card>
      <Card>
        <Table columns={columns} dataSource={rows} rowKey="id" pagination={false} />
      </Card>
    </div>
  );
}