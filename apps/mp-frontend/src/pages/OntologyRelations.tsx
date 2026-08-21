// src/pages/OntologyRelations.tsx — RelationType 全表 + 搜索
import React, { useEffect, useMemo, useState } from 'react';
import { Spin, Table, Card, Tag, Input, Row, Col } from '@douyinfe/semi-ui';
import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';
import { authedFetch } from '../lib/api';

interface RelationType {
  rid: string;
  name: string;
  from_type: string;
  to_type: string;
  cardinality: string;
  status: string;
  created_at: string;
}

export default function OntologyRelations() {
  const [rels, setRels] = useState<RelationType[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const r = await authedFetch('/rest/v1/ontology_relation_types?select=rid,name,from_type,to_type,cardinality,status,created_at&order=created_at.desc&limit=200') as RelationType[];
      setRels(r);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    if (!search) return rels;
    const q = search.toLowerCase();
    return rels.filter((r) =>
      r.rid.toLowerCase().includes(q) ||
      (r.name ?? '').toLowerCase().includes(q) ||
      (r.from_type ?? '').toLowerCase().includes(q) ||
      (r.to_type ?? '').toLowerCase().includes(q),
    );
  }, [rels, search]);

  if (loading) return <Spin />;

  const columns = [
    { title: 'rid', dataIndex: 'rid', render: (v: string) => <code>{v}</code> },
    { title: 'name', dataIndex: 'name' },
    { title: 'from → to', dataIndex: 'from_type', render: (_: string, r: RelationType) => (
      <span><code>{r.from_type}</code> → <code>{r.to_type}</code></span>
    ) },
    { title: 'cardinality', dataIndex: 'cardinality', render: (v: string) => <Tag color="blue">{v}</Tag> },
    { title: 'status', dataIndex: 'status', render: (v: string) => <Tag color={v === 'active' ? 'green' : 'grey'}>{v}</Tag> },
  ];

  return (
    <div>
      <PageHeader title="RelationType" description="Ontology 本体: 关系定义 (M11 Kernel)" onRefresh={load} />
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col span={6}><StatCard title="总数" value={rels.length} color="primary" /></Col>
        <Col span={6}><StatCard title="Active" value={rels.filter((r) => r.status === 'active').length} color="success" /></Col>
        <Col span={6}><StatCard title="one_to_many" value={rels.filter((r) => r.cardinality === 'one_to_many').length} color="warning" /></Col>
        <Col span={6}><StatCard title="Distinct rids" value={new Set(rels.map((r) => r.rid)).size} /></Col>
      </Row>
      <Card style={{ marginBottom: 16 }}>
        <Input placeholder="搜索 rid / name / from_type / to_type" value={search} onChange={setSearch} showClear />
      </Card>
      <Card>
        <Table
          columns={columns}
          dataSource={filtered}
          rowKey={(r: RelationType) => `${r.rid}@${r.created_at}` as unknown as number}
          pagination={{ pageSize: 20 }}
          empty={<div style={{ padding: 40, textAlign: 'center', color: 'var(--semi-color-text-2)' }}>无 RelationType 数据</div>}
        />
      </Card>
    </div>
  );
}