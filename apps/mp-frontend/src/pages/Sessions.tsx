// src/pages/Sessions.tsx — M15 dsh Sessions
import React, { useEffect, useState } from 'react';
import { Spin, Table, Card, Tag, Statistic, Row, Col } from '@douyinfe/semi-ui';
import PageHeader from '../components/PageHeader';
import { authedFetch } from '../lib/api';

interface SessionRow {
  id: string;
  tenant_id: string;
  agent_preset: string;
  status: string;
  version: number;
  updated_at: string;
  completed_at: string;
}

const STATUS_COLORS: Record<string, string> = {
  running: 'green',
  waiting_tool: 'blue',
  waiting_hitl: 'cyan',
  waiting_external: 'orange',
  completed: 'grey',
  failed: 'red',
  cancelled: 'grey',
};

export default function Sessions() {
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const r = await authedFetch('/rest/v1/dsh_session_headers?select=id,tenant_id,agent_preset,status,version,updated_at,completed_at&order=updated_at.desc&limit=30') as SessionRow[];
      setRows(r);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  if (loading) return <Spin />;

  const active = rows.filter((r) => ['running', 'waiting_tool', 'waiting_hitl', 'waiting_external'].includes(r.status)).length;
  const completed = rows.filter((r) => r.status === 'completed').length;
  const failed = rows.filter((r) => r.status === 'failed').length;

  const columns = [
    { title: 'id', dataIndex: 'id', render: (v: string) => v.slice(0, 8) + '…' },
    { title: 'tenant', dataIndex: 'tenant_id', render: (v: string) => v.slice(0, 8) + '…' },
    { title: 'agent_preset', dataIndex: 'agent_preset' },
    { title: 'status', dataIndex: 'status', render: (v: string) => <Tag color={STATUS_COLORS[v] ?? 'grey'}>{v}</Tag> },
    { title: 'version', dataIndex: 'version' },
    { title: 'updated_at', dataIndex: 'updated_at' },
    { title: 'completed_at', dataIndex: 'completed_at', render: (v: string) => v || '—' },
  ];

  return (
    <div>
      <PageHeader title="M15 dsh Sessions" description="Postgres backend · K8s 多副本共享" onRefresh={load} />
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col span={8}><Card><Statistic title="Active" value={active} valueStyle={{ color: 'green' }} /></Card></Col>
        <Col span={8}><Card><Statistic title="Completed" value={completed} valueStyle={{ color: 'grey' }} /></Card></Col>
        <Col span={8}><Card><Statistic title="Failed" value={failed} valueStyle={{ color: failed > 0 ? 'red' : 'green' }} /></Card></Col>
      </Row>
      <Card>
        <Table columns={columns} dataSource={rows} rowKey="id" pagination={false} />
      </Card>
    </div>
  );
}