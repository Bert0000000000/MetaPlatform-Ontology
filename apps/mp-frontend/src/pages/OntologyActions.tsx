// src/pages/OntologyActions.tsx — ActionType 全表 + 搜索
import React, { useEffect, useMemo, useState } from 'react';
import { Spin, Table, Card, Tag, Input, Row, Col } from '@douyinfe/semi-ui';
import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';
import { authedFetch } from '../lib/api';

interface ActionType {
  rid: string;
  name: string;
  target_type: string;
  permission: string;
  workflow_name: string;
  hitl_type: string;
  status: string;
  created_at: string;
}

export default function OntologyActions() {
  const [acts, setActs] = useState<ActionType[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const a = await authedFetch('/rest/v1/ontology_action_types?select=rid,name,target_type,permission,workflow_name,hitl_type,status,created_at&order=created_at.desc&limit=200') as ActionType[];
      setActs(a);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    if (!search) return acts;
    const q = search.toLowerCase();
    return acts.filter((a) =>
      a.rid.toLowerCase().includes(q) ||
      (a.name ?? '').toLowerCase().includes(q) ||
      (a.target_type ?? '').toLowerCase().includes(q) ||
      (a.workflow_name ?? '').toLowerCase().includes(q),
    );
  }, [acts, search]);

  if (loading) return <Spin />;

  const columns = [
    { title: 'rid', dataIndex: 'rid', render: (v: string) => <code>{v}</code> },
    { title: 'name', dataIndex: 'name' },
    { title: 'target', dataIndex: 'target_type', render: (v: string) => <code>{v}</code> },
    { title: 'permission', dataIndex: 'permission', render: (v: string) => <Tag color={v === 'admin' ? 'red' : v === 'owner' ? 'orange' : 'blue'}>{v}</Tag> },
    { title: 'workflow', dataIndex: 'workflow_name' },
    { title: 'hitl_type', dataIndex: 'hitl_type', render: (v: string) => v ? <Tag color="purple">{v}</Tag> : '—' },
    { title: 'status', dataIndex: 'status', render: (v: string) => <Tag color={v === 'active' ? 'green' : 'grey'}>{v}</Tag> },
  ];

  return (
    <div>
      <PageHeader title="ActionType" description="Ontology 本体: 动作定义 (M11 Kernel + M13 HITL)" onRefresh={load} />
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col span={6}><StatCard title="总数" value={acts.length} color="primary" /></Col>
        <Col span={6}><StatCard title="Active" value={acts.filter((a) => a.status === 'active').length} color="success" /></Col>
        <Col span={6}><StatCard title="HITL" value={acts.filter((a) => a.hitl_type).length} color="warning" /></Col>
        <Col span={6}><StatCard title="Distinct rids" value={new Set(acts.map((a) => a.rid)).size} /></Col>
      </Row>
      <Card style={{ marginBottom: 16 }}>
        <Input placeholder="搜索 rid / name / target / workflow" value={search} onChange={setSearch} showClear />
      </Card>
      <Card>
        <Table
          columns={columns}
          dataSource={filtered}
          rowKey={(a: ActionType) => `${a.rid}@${a.created_at}` as unknown as number}
          pagination={{ pageSize: 20 }}
          empty={<div style={{ padding: 40, textAlign: 'center', color: 'var(--semi-color-text-2)' }}>无 ActionType 数据</div>}
        />
      </Card>
    </div>
  );
}