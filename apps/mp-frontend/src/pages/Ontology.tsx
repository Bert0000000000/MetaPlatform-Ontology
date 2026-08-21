// src/pages/Ontology.tsx — M11 Ontology Kernel
import React, { useEffect, useState } from 'react';
import { Spin, Table, Tabs, Card, Tag } from '@douyinfe/semi-ui';
import PageHeader from '../components/PageHeader';
import { authedFetch } from '../lib/api';

interface ObjectType {
  rid: string;
  name: string;
  status: string;
  link_types: string[];
  action_types: string[];
  created_at: string;
}

interface RelationType {
  rid: string;
  name: string;
  from_type: string;
  to_type: string;
  cardinality: string;
  status: string;
  created_at: string;
}

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

export default function Ontology() {
  const [objs, setObjs] = useState<ObjectType[]>([]);
  const [rels, setRels] = useState<RelationType[]>([]);
  const [acts, setActs] = useState<ActionType[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [o, r, a] = await Promise.all([
        authedFetch('/rest/v1/ontology_object_types?select=rid,name,status,link_types,action_types,created_at&order=created_at.desc&limit=20') as Promise<ObjectType[]>,
        authedFetch('/rest/v1/ontology_relation_types?select=rid,name,from_type,to_type,cardinality,status,created_at&order=created_at.desc&limit=20') as Promise<RelationType[]>,
        authedFetch('/rest/v1/ontology_action_types?select=rid,name,target_type,permission,workflow_name,hitl_type,status,created_at&order=created_at.desc&limit=20') as Promise<ActionType[]>,
      ]);
      setObjs(o); setRels(r); setActs(a);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (loading) return <Spin />;

  const objColumns = [
    { title: 'rid', dataIndex: 'rid' },
    { title: 'name', dataIndex: 'name' },
    { title: 'status', dataIndex: 'status', render: (v: string) => <Tag color={v === 'active' ? 'green' : 'grey'}>{v}</Tag> },
    { title: 'link_types', dataIndex: 'link_types', render: (v: string[]) => (v ?? []).join(', ') },
    { title: 'action_types', dataIndex: 'action_types', render: (v: string[]) => (v ?? []).join(', ') },
    { title: 'created_at', dataIndex: 'created_at' },
  ];
  const relColumns = [
    { title: 'rid', dataIndex: 'rid' },
    { title: 'name', dataIndex: 'name' },
    { title: 'from → to', dataIndex: 'from_type', render: (_: string, r: RelationType) => `${r.from_type} → ${r.to_type}` },
    { title: 'cardinality', dataIndex: 'cardinality' },
    { title: 'status', dataIndex: 'status', render: (v: string) => <Tag color={v === 'active' ? 'green' : 'grey'}>{v}</Tag> },
  ];
  const actColumns = [
    { title: 'rid', dataIndex: 'rid' },
    { title: 'name', dataIndex: 'name' },
    { title: 'target', dataIndex: 'target_type' },
    { title: 'permission', dataIndex: 'permission', render: (v: string) => <Tag color={v === 'admin' ? 'red' : v === 'owner' ? 'orange' : 'blue'}>{v}</Tag> },
    { title: 'workflow', dataIndex: 'workflow_name' },
    { title: 'hitl_type', dataIndex: 'hitl_type', render: (v: string) => v ? <Tag color="purple">{v}</Tag> : '—' },
    { title: 'status', dataIndex: 'status', render: (v: string) => <Tag color={v === 'active' ? 'green' : 'grey'}>{v}</Tag> },
  ];

  // 后端多次 seed 会导致 rid 重复, rowKey 用 rid+created_at 保证唯一
  const objRowKey = (r: ObjectType) => `${r.rid}@${r.created_at}`;
  const relRowKey = (r: RelationType) => `${r.rid}@${r.created_at}`;
  const actRowKey = (r: ActionType) => `${r.rid}@${r.created_at}`;

  return (
    <div>
      <PageHeader title="M11 Ontology Kernel" description="3 表核心: ObjectType / RelationType / ActionType" onRefresh={load} />
      <Card>
        <Tabs type="line">
          <Tabs.TabPane tab={`ObjectType (${objs.length})`} itemKey="object">
            <Table columns={objColumns} dataSource={objs} rowKey={objRowKey} pagination={false} />
          </Tabs.TabPane>
          <Tabs.TabPane tab={`RelationType (${rels.length})`} itemKey="relation">
            <Table columns={relColumns} dataSource={rels} rowKey={relRowKey} pagination={false} />
          </Tabs.TabPane>
          <Tabs.TabPane tab={`ActionType (${acts.length})`} itemKey="action">
            <Table columns={actColumns} dataSource={acts} rowKey={actRowKey} pagination={false} />
          </Tabs.TabPane>
        </Tabs>
      </Card>
    </div>
  );
}