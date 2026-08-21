// src/pages/Sandbox.tsx — Issue #15 mp-sandbox
import React, { useEffect, useState } from 'react';
import { Spin, Table, Card, Tag } from '@douyinfe/semi-ui';
import PageHeader from '../components/PageHeader';
import { authedFetch } from '../lib/api';

interface SandboxRow {
  id: string;
  tenant_id: string;
  action: string;
  language: string;
  code_bytes: number;
  network: string;
  mode: string;
  duration_ms: number;
  exit_code: number;
  created_at: string;
}

const ACTION_COLORS: Record<string, string> = {
  SANDBOX_EXECUTE: 'green',
  SANDBOX_DENIED: 'red',
  SANDBOX_TIMEOUT: 'orange',
};

export default function Sandbox() {
  const [rows, setRows] = useState<SandboxRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const r = await authedFetch('/rest/v1/mp_sandbox.executions?select=id,tenant_id,action,language,code_bytes,network,mode,duration_ms,exit_code,created_at&order=created_at.desc&limit=30') as SandboxRow[];
      setRows(r);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  if (loading) return <Spin />;

  const columns = [
    { title: 'created_at', dataIndex: 'created_at' },
    { title: 'action', dataIndex: 'action', render: (v: string) => <Tag color={ACTION_COLORS[v] ?? 'grey'}>{v}</Tag> },
    { title: 'language', dataIndex: 'language' },
    { title: 'mode', dataIndex: 'mode' },
    { title: 'code_bytes', dataIndex: 'code_bytes' },
    { title: 'network', dataIndex: 'network' },
    { title: 'duration_ms', dataIndex: 'duration_ms' },
    { title: 'exit_code', dataIndex: 'exit_code' },
  ];

  return (
    <div>
      <PageHeader title="Issue #15 mp-sandbox" description="sidecar HTTP 真执行 · 3/3 完成" onRefresh={load} />
      <Card>
        <Table columns={columns} dataSource={rows} rowKey="id" pagination={false} />
      </Card>
    </div>
  );
}