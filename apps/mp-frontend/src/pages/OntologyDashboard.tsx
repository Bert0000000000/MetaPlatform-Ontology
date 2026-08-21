// src/pages/OntologyDashboard.tsx — Ontology 模块 Dashboard (4 stat + 最近 activity)
import React, { useEffect, useState } from 'react';
import { Spin, Row, Col, Card, Table, Tag, Typography } from '@douyinfe/semi-ui';
import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';
import { authedFetch } from '../lib/api';

const { Title, Text } = Typography;

interface ObjectType { rid: string; name: string; status: string; created_at: string; }
interface RelationType { rid: string; name: string; from_type: string; to_type: string; status: string; created_at: string; }
interface ActionType { rid: string; name: string; target_type: string; status: string; created_at: string; }

interface ActivityRow {
  kind: 'ObjectType' | 'RelationType' | 'ActionType';
  rid: string;
  name: string;
  status: string;
  created_at: string;
}

export default function OntologyDashboard() {
  const [objs, setObjs] = useState<ObjectType[]>([]);
  const [rels, setRels] = useState<RelationType[]>([]);
  const [acts, setActs] = useState<ActionType[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [o, r, a] = await Promise.all([
        authedFetch('/rest/v1/ontology_object_types?select=rid,name,status,created_at&order=created_at.desc&limit=100') as Promise<ObjectType[]>,
        authedFetch('/rest/v1/ontology_relation_types?select=rid,name,from_type,to_type,status,created_at&order=created_at.desc&limit=100') as Promise<RelationType[]>,
        authedFetch('/rest/v1/ontology_action_types?select=rid,name,target_type,status,created_at&order=created_at.desc&limit=100') as Promise<ActionType[]>,
      ]);
      setObjs(o); setRels(r); setActs(a);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  if (loading) return <Spin />;

  // 最近 activity: 3 个表按 created_at desc, 取前 10 行
  const activity: ActivityRow[] = [
    ...objs.map<ActivityRow>((o) => ({ kind: 'ObjectType', rid: o.rid, name: o.name ?? o.rid, status: o.status, created_at: o.created_at })),
    ...rels.map<ActivityRow>((r) => ({ kind: 'RelationType', rid: r.rid, name: `${r.from_type} → ${r.to_type}`, status: r.status, created_at: r.created_at })),
    ...acts.map<ActivityRow>((a) => ({ kind: 'ActionType', rid: a.rid, name: a.name ?? a.rid, status: a.status, created_at: a.created_at })),
  ]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 10);

  const distinctRids = new Set([...objs.map((o) => o.rid), ...rels.map((r) => r.rid), ...acts.map((a) => a.rid)]).size;

  const columns = [
    { title: 'kind', dataIndex: 'kind', render: (v: string) => <Tag color={v === 'ObjectType' ? 'blue' : v === 'RelationType' ? 'cyan' : 'purple'}>{v}</Tag> },
    { title: 'rid', dataIndex: 'rid', render: (v: string) => <code>{v}</code> },
    { title: 'name', dataIndex: 'name' },
    { title: 'status', dataIndex: 'status', render: (v: string) => <Tag color={v === 'active' ? 'green' : 'grey'}>{v}</Tag> },
    { title: 'created_at', dataIndex: 'created_at' },
  ];

  return (
    <div>
      <PageHeader title="Ontology Dashboard" description="M11 本体 Kernel 总览: 3 表统计 + 最近变更" onRefresh={load} />
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <StatCard title="ObjectType" value={objs.length} color="primary" description="实体定义" />
        </Col>
        <Col span={6}>
          <StatCard title="RelationType" value={rels.length} color="success" description="关系定义" />
        </Col>
        <Col span={6}>
          <StatCard title="ActionType" value={acts.length} color="warning" description="动作定义 (含 HITL)" />
        </Col>
        <Col span={6}>
          <StatCard title="Generate" value={distinctRids} color="primary" description="Distinct rids (M18 LLM)" />
        </Col>
      </Row>
      <Card>
        <Title heading={5} style={{ marginTop: 0 }}>最近 Activity (10 行)</Title>
        <Text type="tertiary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
          跨 3 表按 created_at 合并排序
        </Text>
        <Table
          columns={columns}
          dataSource={activity}
          rowKey={(r: ActivityRow) => `${r.kind}-${r.rid}-${r.created_at}` as unknown as number}
          pagination={false}
          empty={<div style={{ padding: 40, textAlign: 'center', color: 'var(--semi-color-text-2)' }}>无 activity 数据</div>}
        />
      </Card>
    </div>
  );
}