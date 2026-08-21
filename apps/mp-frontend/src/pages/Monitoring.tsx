// src/pages/Monitoring.tsx — M10 mp-monitoring 5 subsystem
import React, { useEffect, useState } from 'react';
import { Spin, Card, Tag, Row, Col, Descriptions } from '@douyinfe/semi-ui';
import PageHeader from '../components/PageHeader';
import { authedFetch } from '../lib/api';

interface Subsystem {
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  latency_ms: number;
  details: Record<string, unknown>;
}

interface Health {
  overall: Subsystem['status'];
  total_latency_ms: number;
  subsystems: Subsystem[];
  summary: { healthy: number; degraded: number; unhealthy: number; unknown: number; total: number };
}

const STATUS_COLORS: Record<string, string> = {
  healthy: 'green',
  degraded: 'orange',
  unhealthy: 'red',
  unknown: 'grey',
};

export default function Monitoring() {
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const h = await authedFetch('/functions/v1/mp-monitoring-health') as Health;
      setHealth(h);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  if (loading || !health) return <Spin />;

  return (
    <div>
      <PageHeader title="M10 mp-monitoring" description="5 subsystem 健康" onRefresh={load} />
      <Card style={{ marginBottom: 16 }}>
        <Row gutter={16}>
          <Col span={6}><Descriptions title="Overall" items={[{ key: 'overall', value: <Tag color={STATUS_COLORS[health.overall]}>{health.overall}</Tag> }]} /></Col>
          <Col span={6}><Descriptions title="Total Latency" items={[{ key: 'l', value: health.total_latency_ms + ' ms' }]} /></Col>
          <Col span={6}><Descriptions title="Healthy" items={[{ key: 'h', value: health.summary.healthy + ' / ' + health.summary.total }]} /></Col>
          <Col span={6}><Descriptions title="Degraded" items={[{ key: 'd', value: health.summary.degraded + ' / ' + health.summary.total }]} /></Col>
        </Row>
      </Card>
      <Row gutter={[16, 16]}>
        {health.subsystems.map((s) => (
          <Col span={12} key={s.name}>
            <Card title={s.name + ' · ' + s.latency_ms + ' ms'} headerExtraContent={<Tag color={STATUS_COLORS[s.status]}>{s.status}</Tag>}>
              <Descriptions
                size="small"
                column={2}
                items={Object.entries(s.details).map(([k, v], i) => ({
                  key: String(i),
                  label: k,
                  value: typeof v === 'object' ? JSON.stringify(v) : String(v),
                }))}
              />
            </Card>
          </Col>
        ))}
      </Row>
    </div>
  );
}