// src/pages/HITL.tsx — M13 HITL Hub
import React, { useEffect, useState } from 'react';
import { Spin, Table, Card, Tag, Statistic, Row, Col } from '@douyinfe/semi-ui';
import PageHeader from '../components/PageHeader';
import { authedFetch } from '../lib/api';

interface HITLRow {
  id: string;
  type: string;
  status: string;
  title: string;
  escalation_level: number;
  deadline_at: string;
  decided_at: string;
  created_at: string;
}

const TYPE_COLORS: Record<string, string> = {
  workflow_saas: 'blue',
  workflow_dsh: 'cyan',
  tool_dsh: 'orange',
  action_confirm: 'purple',
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'orange',
  approved: 'green',
  rejected: 'red',
  expired: 'grey',
  cancelled: 'grey',
};

export default function HITL() {
  const [rows, setRows] = useState<HITLRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const r = await authedFetch('/rest/v1/hitl_requests?select=id,type,status,title,escalation_level,deadline_at,decided_at,created_at&order=created_at.desc&limit=30') as HITLRow[];
      setRows(r);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (loading) return <Spin />;

  const pending = rows.filter((r) => r.status === 'pending').length;
  const approved = rows.filter((r) => r.status === 'approved').length;
  const rejected = rows.filter((r) => r.status === 'rejected').length;
  const avg = rows.filter((r) => r.decided_at).reduce((s, r) => s + (new Date(r.decided_at).getTime() - new Date(r.created_at).getTime()), 0);
  const avgMs = rows.filter((r) => r.decided_at).length ? Math.round(avg / rows.filter((r) => r.decided_at).length / 1000) : 0;

  const columns = [
    { title: 'type', dataIndex: 'type', render: (v: string) => <Tag color={TYPE_COLORS[v] ?? 'grey'}>{v}</Tag> },
    { title: 'status', dataIndex: 'status', render: (v: string) => <Tag color={STATUS_COLORS[v] ?? 'grey'}>{v}</Tag> },
    { title: 'title', dataIndex: 'title' },
    { title: 'escalation', dataIndex: 'escalation_level', render: (v: number) => <Tag color={v >= 2 ? 'red' : v === 1 ? 'orange' : 'grey'}>L{v}</Tag> },
    { title: 'deadline', dataIndex: 'deadline_at' },
    { title: 'decided_at', dataIndex: 'decided_at' },
    { title: 'created_at', dataIndex: 'created_at' },
  ];

  return (
    <div>
      <PageHeader title="M13 HITL Hub" description="4 类型联动中枢 + 多级升级" onRefresh={load} />
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col span={6}><Card><Statistic title="Pending" value={pending} valueStyle={{ color: pending > 0 ? 'orange' : 'green' }} /></Card></Col>
        <Col span={6}><Card><Statistic title="Approved" value={approved} valueStyle={{ color: 'green' }} /></Card></Col>
        <Col span={6}><Card><Statistic title="Rejected" value={rejected} valueStyle={{ color: 'red' }} /></Card></Col>
        <Col span={6}><Card><Statistic title="Avg Decision (s)" value={avgMs} /></Card></Col>
      </Row>
      <Card>
        <Table columns={columns} dataSource={rows} rowKey="id" pagination={false} />
      </Card>
    </div>
  );
}