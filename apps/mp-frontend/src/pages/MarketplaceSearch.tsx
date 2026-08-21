// src/pages/MarketplaceSearch.tsx — 全文搜索 (跨字段)
import React, { useEffect, useMemo, useState } from 'react';
import { Spin, Table, Card, Tag, Input, Select, Row, Col, Empty } from '@douyinfe/semi-ui';
import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';
import { authedFetch } from '../lib/api';

interface Preset {
  id: string;
  slug: string;
  name: string;
  category: string;
  visibility: string;
  current_version: string;
  downloads_count: number;
  maintainer_id: string;
  description: string | null;
  created_at: string;
}

const CATEGORY_OPTIONS = [
  { value: '', label: '全部分类' },
  { value: 'support', label: 'Support' },
  { value: 'data', label: 'Data' },
  { value: 'contract', label: 'Contract' },
  { value: 'custom', label: 'Custom' },
  { value: 'dashboard', label: 'Dashboard' },
  { value: 'knowledge', label: 'Knowledge' },
];

const FIELDS = [
  { value: 'all', label: '全部字段' },
  { value: 'slug', label: 'slug' },
  { value: 'name', label: 'name' },
  { value: 'description', label: 'description' },
  { value: 'maintainer', label: 'maintainer' },
];

export default function MarketplaceSearch() {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [field, setField] = useState('all');
  const [visibility, setVisibility] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const r = await authedFetch('/rest/v1/presets?select=id,slug,name,category,visibility,current_version,downloads_count,maintainer_id,description,created_at&order=downloads_count.desc&limit=300') as Preset[];
      setPresets(r);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    let f = presets;
    if (search) {
      const q = search.toLowerCase();
      f = f.filter((p) => {
        switch (field) {
          case 'slug': return p.slug.toLowerCase().includes(q);
          case 'name': return p.name.toLowerCase().includes(q);
          case 'description': return (p.description ?? '').toLowerCase().includes(q);
          case 'maintainer': return p.maintainer_id.toLowerCase().includes(q);
          default:
            return p.slug.toLowerCase().includes(q)
              || p.name.toLowerCase().includes(q)
              || (p.description ?? '').toLowerCase().includes(q)
              || p.maintainer_id.toLowerCase().includes(q);
        }
      });
    }
    if (category) f = f.filter((p) => p.category === category);
    if (visibility) f = f.filter((p) => p.visibility === visibility);
    return f;
  }, [presets, search, category, field, visibility]);

  if (loading) return <Spin />;

  const columns = [
    { title: 'slug', dataIndex: 'slug', render: (v: string) => <code>{v}</code> },
    { title: 'name', dataIndex: 'name' },
    { title: 'category', dataIndex: 'category', render: (v: string) => <Tag color="blue">{v}</Tag> },
    { title: 'visibility', dataIndex: 'visibility', render: (v: string) => <Tag color={v === 'public' ? 'green' : v === 'private' ? 'orange' : 'blue'}>{v}</Tag> },
    { title: 'version', dataIndex: 'current_version' },
    { title: 'downloads', dataIndex: 'downloads_count' },
    { title: 'maintainer', dataIndex: 'maintainer_id', render: (v: string) => v.slice(0, 8) + '…' },
    { title: 'description', dataIndex: 'description', render: (v: string | null) => v ? <span style={{ fontSize: 12 }}>{v.slice(0, 60)}{v.length > 60 ? '…' : ''}</span> : '—' },
  ];

  // 高亮搜索关键词
  const highlight = (text: string) => {
    if (!search) return text;
    const idx = text.toLowerCase().indexOf(search.toLowerCase());
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <mark style={{ background: '#fde68a', padding: '0 2px' }}>{text.slice(idx, idx + search.length)}</mark>
        {text.slice(idx + search.length)}
      </>
    );
  };

  const enrichedColumns = columns.map((c) =>
    c.dataIndex === 'slug' || c.dataIndex === 'name' || c.dataIndex === 'description'
      ? { ...c, render: (v: string | null) => highlight(v ?? '') }
      : c,
  );

  return (
    <div>
      <PageHeader title="全文搜索" description="跨字段 preset 搜索 · slug / name / description / maintainer" onRefresh={load} />

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col span={6}><StatCard title="Preset 总数" value={presets.length} color="primary" /></Col>
        <Col span={6}><StatCard title="匹配" value={filtered.length} color="success" /></Col>
        <Col span={6}><StatCard title="分类" value={new Set(presets.map((p) => p.category)).size} /></Col>
        <Col span={6}><StatCard title="Maintainer" value={new Set(presets.map((p) => p.maintainer_id)).size} /></Col>
      </Row>

      <Card style={{ marginBottom: 16 }}>
        <Row gutter={16}>
          <Col span={10}>
            <Input placeholder="搜索关键词" value={search} onChange={setSearch} showClear />
          </Col>
          <Col span={6}>
            <Select value={field} onChange={(v) => setField(typeof v === 'string' ? v : 'all')} optionList={FIELDS} />
          </Col>
          <Col span={4}>
            <Select value={category} onChange={(v) => setCategory(typeof v === 'string' ? v : '')} optionList={CATEGORY_OPTIONS} />
          </Col>
          <Col span={4}>
            <Select
              value={visibility}
              onChange={(v) => setVisibility(typeof v === 'string' ? v : '')}
              optionList={[
                { value: '', label: '全部可见性' },
                { value: 'public', label: 'public' },
                { value: 'internal', label: 'internal' },
                { value: 'private', label: 'private' },
              ]}
            />
          </Col>
        </Row>
      </Card>

      <Card title={`结果 (${filtered.length})`}>
        {filtered.length === 0 ? (
          <Empty description={search ? `无 "${search}" 匹配` : '无 preset 数据'} />
        ) : (
          <Table columns={enrichedColumns} dataSource={filtered} rowKey="id" pagination={{ pageSize: 20 }} />
        )}
      </Card>
    </div>
  );
}