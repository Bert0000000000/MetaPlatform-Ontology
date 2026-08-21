// src/pages/Runtime.tsx — mp-runtime 业务运行时
import React, { useEffect, useState } from 'react';
import { Spin, Table, Card, Tag, Row, Col, Badge } from '@douyinfe/semi-ui';
import Stat from '../components/Stat';
import PageHeader from '../components/PageHeader';
import { authedFetch } from '../lib/api';
import { subscribeTable } from '../lib/realtime';

interface SessionByStatus {
  status: string;
  n: number;
  last: string;
}

export default function Runtime() {
  const [byStatus, setByStatus] = useState<SessionByStatus[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const r = await authedFetch("/rest/v1/dsh_session_headers?select=status,count:count(*)&group=status&order=status.asc") as Array<{ status: string; count: number }>;
      // r is array of { status, count }
      const last = await authedFetch('/rest/v1/dsh_session_headers?select=updated_at&order=updated_at.desc&limit=1') as Array<{ updated_at: string }>;
      setByStatus(r.map((s) => ({ status: s.status, n: s.count, last: last[0]?.updated_at ?? '' })));
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  // M40 Loop 3/3: Realtime 订阅 dsh_session_headers → 自动刷新
  useEffect(() => {
    const sub = subscribeTable('dsh_session_headers', () => {
      load();
    });
    return () => sub.unsubscribe();
  }, []);

  if (loading) return <Spin />;

  const total = byStatus.reduce((s, r) => s + r.n, 0);
  const active = byStatus.filter((r) => ['running', 'waiting_tool', 'waiting_hitl', 'waiting_external'].includes(r.status)).reduce((s, r) => s + r.n, 0);
  const failed = byStatus.find((r) => r.status === 'failed')?.n ?? 0;

  const STATUS_COLORS: Record<string, string> = {
    running: 'green',
    waiting_tool: 'blue',
    waiting_hitl: 'cyan',
    waiting_external: 'orange',
    completed: 'grey',
    failed: 'red',
    cancelled: 'grey',
  };

  const columns = [
    { title: 'status', dataIndex: 'status', render: (v: string) => <Tag color={STATUS_COLORS[v] ?? 'grey'}>{v}</Tag> },
    { title: 'count', dataIndex: 'n' },
    { title: 'last_updated', dataIndex: 'last' },
  ];

  return (
    <div>
      <PageHeader title="mp-runtime" description="dsh Session 状态分布 · M15 Postgres backend" onRefresh={load} />
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col span={8}><Card>
          <Stat
            title={<>Total <Badge count={total} overflowCount={9999} /></>}
            value={total}
          />
        </Card></Col>
        <Col span={8}><Card><Stat title="Active" value={active} valueStyle={{ color: 'green' }} /></Card></Col>
        <Col span={8}><Card><Stat title="Failed" value={failed} valueStyle={{ color: failed > 0 ? 'red' : 'green' }} /></Card></Col>
      </Row>
      <Card>
        <Table columns={columns} dataSource={byStatus} rowKey="status" pagination={false} />
      </Card>
    </div>
  );
}