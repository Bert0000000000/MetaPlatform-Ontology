// src/pages/Tenants.tsx — Tenants 表
import React, { useEffect, useState } from 'react';
import { Spin, Table, Card, Tag } from '@douyinfe/semi-ui';
import PageHeader from '../components/PageHeader';
import { authedFetch } from '../lib/api';

interface TenantRow {
  id: string;
  slug: string;
  name: string;
  status: string;
  created_at: string;
}

export default function Tenants() {
  const [rows, setRows] = useState<TenantRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const r = await authedFetch('/rest/v1/tenants?select=id,slug,name,status,created_at&order=created_at.desc&limit=50') as TenantRow[];
      setRows(r);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  if (loading) return <Spin />;

  const columns = [
    { title: 'slug', dataIndex: 'slug' },
    { title: 'name', dataIndex: 'name' },
    { title: 'status', dataIndex: 'status', render: (v: string) => <Tag color={v === 'active' ? 'green' : 'grey'}>{v}</Tag> },
    { title: 'created_at', dataIndex: 'created_at' },
  ];

  return (
    <div>
      <PageHeader title="Tenants" description="所有租户 (PostgREST RLS)" onRefresh={load} />
      <Card>
        <Table columns={columns} dataSource={rows} rowKey="id" pagination={false} />
      </Card>
    </div>
  );
}