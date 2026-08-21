// src/pages/Dashboard.tsx — 统计概览
import React, { useEffect, useState } from 'react';
import { Spin, Row, Col, Card } from '@douyinfe/semi-ui';
import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';
import { authedFetch } from '../lib/api';

export default function Dashboard() {
  const [data, setData] = useState<{ rows: Array<{ n: number }> } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const json = await authedFetch('/functions/v1/mp-monitoring-health');
      const c = (json.subsystems ?? []).find((s: { name: string }) => s.name === 'postgres')?.details;
      setData(c ?? null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (loading) return <Spin />;

  const d = data?.rows?.[0] ?? { n: 0 };
  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="MetaPlatform v6.0 系统总览"
        onRefresh={load}
      />
      <Row gutter={[16, 16]}>
        <Col span={6}>
          <StatCard title="Tenants" value={d.tenants ?? 0} color="primary" description="租户总数" />
        </Col>
        <Col span={6}>
          <StatCard title="dsh Sessions" value={d.dsh_sessions ?? 0} color="primary" description="M15 backend" />
        </Col>
        <Col span={6}>
          <StatCard title="HITL Pending" value={d.hitl_pending ?? 0} color={d.hitl_pending > 0 ? 'warning' : 'success'} description="M13 4-type 中枢" />
        </Col>
        <Col span={6}>
          <StatCard title="Workflow Signals" value={d.workflow_signals_pending ?? 0} color="warning" description="M13 → Temporal" />
        </Col>
        <Col span={6}>
          <StatCard title="mp-sandbox (24h)" value={d.mp_sandbox_24h ?? 0} color="success" description="Issue #15" />
        </Col>
        <Col span={6}>
          <StatCard title="Signals Failed" value={d.workflow_signals_failed ?? 0} color={d.workflow_signals_failed > 0 ? 'danger' : 'success'} description="需人工介入" />
        </Col>
      </Row>
    </div>
  );
}