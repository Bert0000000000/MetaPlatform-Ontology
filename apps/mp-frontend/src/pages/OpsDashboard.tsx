// src/pages/OpsDashboard.tsx — 运营管理 Dashboard (4 stat + 系统健康)
import React, { useEffect, useState } from 'react';
import { Spin, Row, Col, Card, Tag, Descriptions, Typography, Empty } from '@douyinfe/semi-ui';
import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';
import { authedFetch } from '../lib/api';

const { Title, Text } = Typography;

interface SubsystemHealth {
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  latency_ms: number;
  details: Record<string, unknown>;
}

interface Health {
  overall: SubsystemHealth['status'];
  total_latency_ms: number;
  subsystems: SubsystemHealth[];
  summary: { healthy: number; degraded: number; unhealthy: number; unknown: number; total: number };
}

interface Stats {
  tenants?: number;
  dsh_sessions?: number;
  hitl_pending?: number;
  workflow_signals_pending?: number;
  mp_sandbox_24h?: number;
  workflow_signals_failed?: number;
}

const STATUS_COLORS: Record<string, string> = {
  healthy: 'green',
  degraded: 'orange',
  unhealthy: 'red',
  unknown: 'grey',
};

export default function OpsDashboard() {
  const [health, setHealth] = useState<Health | null>(null);
  const [stats, setStats] = useState<Stats>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const h = await authedFetch('/functions/v1/mp-monitoring-health') as Health & { rows?: Stats };
      setHealth(h);
      // rows 是 mp-monitoring-health 返回的 stats (Tenants / dsh_sessions / etc.)
      setStats((h as unknown as { rows?: Stats }).rows ?? {});
    } catch (e) {
      setError((e as Error).message ?? 'Failed to load health');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (loading) return <Spin />;

  return (
    <div>
      <PageHeader
        title="运营管理 Dashboard"
        description="MetaPlatform v6.0 系统总览 · 4 stat + 5 subsystem 健康"
        onRefresh={load}
      />

      {error && (
        <Card style={{ marginBottom: 16, background: '#fef2f2', borderColor: '#fca5a5' }}>
          <Text type="danger">健康检查失败: {error}</Text>
        </Card>
      )}

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <StatCard title="Tenants" value={stats.tenants ?? 0} color="primary" description="租户总数" />
        </Col>
        <Col span={6}>
          <StatCard title="dsh Sessions" value={stats.dsh_sessions ?? 0} color="primary" description="M15 Postgres backend" />
        </Col>
        <Col span={6}>
          <StatCard title="HITL Pending" value={stats.hitl_pending ?? 0} color={stats.hitl_pending && stats.hitl_pending > 0 ? 'warning' : 'success'} description="M13 4-type 中枢" />
        </Col>
        <Col span={6}>
          <StatCard title="Workflow Signals" value={stats.workflow_signals_pending ?? 0} color="warning" description="M13 → Temporal" />
        </Col>
      </Row>

      {health && (
        <Card title={`System Health · ${health.subsystems.length} subsystems`}>
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col span={6}>
              <Card>
                <Text type="tertiary" style={{ fontSize: 12, display: 'block' }}>Overall</Text>
                <Tag color={STATUS_COLORS[health.overall] as 'green' | 'orange' | 'red' | 'grey'} size="large" style={{ marginTop: 4 }}>{health.overall}</Tag>
              </Card>
            </Col>
            <Col span={6}>
              <Card>
                <Text type="tertiary" style={{ fontSize: 12, display: 'block' }}>Total Latency</Text>
                <strong style={{ fontSize: 24 }}>{health.total_latency_ms} ms</strong>
              </Card>
            </Col>
            <Col span={6}>
              <Card>
                <Text type="tertiary" style={{ fontSize: 12, display: 'block' }}>Healthy / Total</Text>
                <strong style={{ fontSize: 24, color: 'var(--semi-color-success)' }}>{health.summary.healthy}</strong>
                <span style={{ color: 'var(--semi-color-text-2)' }}> / {health.summary.total}</span>
              </Card>
            </Col>
            <Col span={6}>
              <Card>
                <Text type="tertiary" style={{ fontSize: 12, display: 'block' }}>Degraded</Text>
                <strong style={{ fontSize: 24, color: health.summary.degraded > 0 ? 'var(--semi-color-warning)' : 'var(--semi-color-text-2)' }}>{health.summary.degraded}</strong>
              </Card>
            </Col>
          </Row>

          {health.subsystems.length === 0 ? (
            <Empty description="无 subsystem 数据" />
          ) : (
            <Row gutter={[16, 16]}>
              {health.subsystems.map((s) => (
                <Col span={12} key={s.name}>
                  <Card
                    title={s.name}
                    headerExtraContent={<Tag color={STATUS_COLORS[s.status] as 'green' | 'orange' | 'red' | 'grey'}>{s.status} · {s.latency_ms}ms</Tag>}
                    shadows="hover"
                  >
                    <Descriptions
                      size="small"
                      items={Object.entries(s.details ?? {}).map(([k, v], i) => ({
                        key: String(i),
                        label: k,
                        value: typeof v === 'object' ? <code>{JSON.stringify(v)}</code> : String(v),
                      })) as unknown as { key: string; value: React.ReactNode }[]}
                    />
                  </Card>
                </Col>
              ))}
            </Row>
          )}
        </Card>
      )}
    </div>
  );
}