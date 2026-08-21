// src/pages/FrontendObs.tsx — mp-frontend-obs (Loop 1/3)
import React, { useEffect, useState } from 'react';
import { Spin, Table, Card, Tag, Row, Col } from '@douyinfe/semi-ui';
import Stat from '../components/Stat';
import PageHeader from '../components/PageHeader';
import { authedFetch } from '../lib/api';

interface EventRow {
  id: string;
  tenant_id: string;
  event_type: string;
  page: string;
  session_id: string;
  data: Record<string, unknown>;
  created_at: string;
}

const TYPE_COLORS: Record<string, string> = {
  page_view: 'green',
  click: 'blue',
  error: 'red',
  performance: 'orange',
};

export default function FrontendObs() {
  const [rows, setRows] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const r = await authedFetch('/rest/v1/frontend_events?select=id,tenant_id,event_type,page,session_id,data,created_at&order=created_at.desc&limit=30') as EventRow[];
      setRows(r);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  if (loading) return <Spin />;

  const pv = rows.filter((r) => r.event_type === 'page_view').length;
  const err = rows.filter((r) => r.event_type === 'error').length;
  const sessions = new Set(rows.map((r) => r.session_id)).size;

  const columns = [
    { title: 'created_at', dataIndex: 'created_at' },
    { title: 'event_type', dataIndex: 'event_type', render: (v: string) => <Tag color={TYPE_COLORS[v] ?? 'grey'}>{v}</Tag> },
    { title: 'page', dataIndex: 'page' },
    { title: 'tenant', dataIndex: 'tenant_id', render: (v: string) => v.slice(0, 8) + '…' },
    { title: 'session', dataIndex: 'session_id', render: (v: string) => v.slice(0, 12) + '…' },
  ];

  return (
    <div>
      <PageHeader title="mp-frontend-obs" description="前端埋点 (page_view / click / error / performance)" onRefresh={load} />
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col span={8}><Card><Stat title="Page Views" value={pv} valueStyle={{ color: 'green' }} /></Card></Col>
        <Col span={8}><Card><Stat title="Errors" value={err} valueStyle={{ color: err > 0 ? 'red' : 'green' }} /></Card></Col>
        <Col span={8}><Card><Stat title="Sessions" value={sessions} /></Card></Col>
      </Row>
      <Card>
        <Table columns={columns} dataSource={rows} rowKey="id" pagination={false} />
      </Card>
    </div>
  );
}