// src/pages/OntologyObjects.tsx — ObjectType 全表 + 搜索 + 类别 filter (重命名自 Ontology.tsx)
import React, { useEffect, useMemo, useState } from 'react';
import { Spin, Table, Card, Tag, Input, Select, Row, Col } from '@douyinfe/semi-ui';
import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';
import { authedFetch } from '../lib/api';

interface ObjectType {
  rid: string;
  name: string;
  status: string;
  link_types: string[];
  action_types: string[];
  created_at: string;
}

export default function OntologyObjects() {
  const [objs, setObjs] = useState<ObjectType[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const o = await authedFetch('/rest/v1/ontology_object_types?select=rid,name,status,link_types,action_types,created_at&order=created_at.desc&limit=200') as ObjectType[];
      setObjs(o);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    let f = objs;
    if (search) {
      const q = search.toLowerCase();
      f = f.filter((o) => o.rid.toLowerCase().includes(q) || (o.name ?? '').toLowerCase().includes(q));
    }
    if (statusFilter) f = f.filter((o) => o.status === statusFilter);
    return f;
  }, [objs, search, statusFilter]);

  if (loading) return <Spin />;

  const columns = [
    { title: 'rid', dataIndex: 'rid', render: (v: string) => <code>{v}</code> },
    { title: 'name', dataIndex: 'name' },
    { title: 'status', dataIndex: 'status', render: (v: string) => <Tag color={v === 'active' ? 'green' : 'grey'}>{v}</Tag> },
    { title: 'link_types', dataIndex: 'link_types', render: (v: string[]) => (v ?? []).join(', ') },
    { title: 'action_types', dataIndex: 'action_types', render: (v: string[]) => (v ?? []).join(', ') },
    { title: 'created_at', dataIndex: 'created_at' },
  ];

  return (
    <div>
      <PageHeader title="ObjectType" description="Ontology 本体: 所有 ObjectType 定义 (M11 Kernel)" onRefresh={load} />
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col span={6}><StatCard title="总数" value={objs.length} color="primary" /></Col>
        <Col span={6}><StatCard title="Active" value={objs.filter((o) => o.status === 'active').length} color="success" /></Col>
        <Col span={6}><StatCard title="Draft" value={objs.filter((o) => o.status === 'draft').length} color="warning" /></Col>
        <Col span={6}><StatCard title="Distinct rids" value={new Set(objs.map((o) => o.rid)).size} /></Col>
      </Row>
      <Card style={{ marginBottom: 16 }}>
        <Row gutter={16}>
          <Col span={12}>
            <Input placeholder="搜索 rid / name" value={search} onChange={setSearch} showClear />
          </Col>
          <Col span={6}>
            <Select
              value={statusFilter}
              onChange={(v) => setStatusFilter(typeof v === 'string' ? v : '')}
              optionList={[
                { value: '', label: '全部 status' },
                { value: 'active', label: 'active' },
                { value: 'draft', label: 'draft' },
                { value: 'archived', label: 'archived' },
              ]}
            />
          </Col>
        </Row>
      </Card>
      <Card>
        <Table
          columns={columns}
          dataSource={filtered}
          rowKey={(r: ObjectType) => `${r.rid}@${r.created_at}` as unknown as number}
          pagination={{ pageSize: 20 }}
          empty={<div style={{ padding: 40, textAlign: 'center', color: 'var(--semi-color-text-2)' }}>无 ObjectType 数据</div>}
        />
      </Card>
    </div>
  );
}