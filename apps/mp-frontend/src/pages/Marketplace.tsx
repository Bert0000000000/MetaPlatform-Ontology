// src/pages/Marketplace.tsx — M05 mp-skill-marketplace Loop 2/3 (UI 增强)
import React, { useEffect, useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Table, Card, Tag, Input, Select, Row, Col } from '@douyinfe/semi-ui';
import Stat from '../components/Stat';
import PageHeader from '../components/PageHeader';
import { authedFetch } from '../lib/api';
import MarketplaceUpgrade from './MarketplaceUpgrade';

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

const VISIBILITY_COLORS: Record<string, string> = {
  public: 'green',
  private: 'orange',
  internal: 'blue',
};

export default function Marketplace() {
  const [searchParams, setSearchParams] = useSearchParams();
  const upgrading = searchParams.get('upgrading') === 'true';

  const [presets, setPresets] = useState<Preset[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [sortBy, setSortBy] = useState<'popular' | 'recent' | 'name'>('popular');

  const load = async () => {
    setLoading(true);
    try {
      const r = await authedFetch('/rest/v1/presets?select=id,slug,name,category,visibility,current_version,downloads_count,maintainer_id,description,created_at&order=downloads_count.desc&limit=100') as Preset[];
      setPresets(r);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    let f = presets;
    if (search) {
      const q = search.toLowerCase();
      f = f.filter((p) => p.slug.toLowerCase().includes(q) || p.name.toLowerCase().includes(q));
    }
    if (category) f = f.filter((p) => p.category === category);
    if (sortBy === 'recent') f = [...f].sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (sortBy === 'name') f = [...f].sort((a, b) => a.name.localeCompare(b.name));
    return f;
  }, [presets, search, category, sortBy]);

  // 1. URL ?upgrading=true → 全屏升级视图 (覆盖 loading/empty/data)
  if (upgrading) {
    return (
      <MarketplaceUpgrade
        mode="upgrading"
        startedAt={new Date(Date.now() - 12 * 60 * 1000).toISOString()}
        estimatedSeconds={1800}
        onRetry={() => {
          const next = new URLSearchParams(searchParams);
          next.delete('upgrading');
          setSearchParams(next, { replace: true });
        }}
      />
    );
  }

  // 2. Loading (复用同一组件)
  if (loading) return <MarketplaceUpgrade mode="loading" />;

  // 3. Empty (复用同一组件)
  if (presets.length === 0) return <MarketplaceUpgrade mode="empty" />;

  const columns = [
    { title: 'slug', dataIndex: 'slug', render: (v: string) => <code>{v}</code> },
    { title: 'name', dataIndex: 'name' },
    { title: 'category', dataIndex: 'category', render: (v: string) => <Tag color="blue">{v}</Tag> },
    { title: 'visibility', dataIndex: 'visibility', render: (v: string) => <Tag color={VISIBILITY_COLORS[v] ?? 'grey'}>{v}</Tag> },
    { title: 'version', dataIndex: 'current_version' },
    { title: 'downloads', dataIndex: 'downloads_count', sorter: (a: number, b: number) => a - b, defaultSortOrder: 'descend' as const },
    { title: 'maintainer', dataIndex: 'maintainer_id', render: (v: string) => v.slice(0, 8) + '…' },
    { title: 'created_at', dataIndex: 'created_at' },
  ];

  return (
    <div>
      <PageHeader
        title="M05 mp-skill-marketplace"
        description="数字员工 (dsh preset) 市场 · Loop 2/3 UI"
        onRefresh={load}
      />
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card><Stat
            title="总 preset"
            value={presets.length}
            valueStyle={{ color: 'green' }}
          /></Card>
        </Col>
        <Col span={6}>
          <Card><Stat
            title="总下载"
            value={presets.reduce((s, p) => s + p.downloads_count, 0)}
            valueStyle={{ color: 'primary' }}
          /></Card>
        </Col>
        <Col span={6}>
          <Card><Stat
            title="分类"
            value={new Set(presets.map((p) => p.category)).size}
            valueStyle={{ color: 'orange' }}
          /></Card>
        </Col>
        <Col span={6}>
          <Card><Stat
            title="公开"
            value={presets.filter((p) => p.visibility === 'public').length}
            valueStyle={{ color: 'green' }}
          /></Card>
        </Col>
      </Row>
      <Card style={{ marginBottom: 16 }}>
        <Row gutter={16}>
          <Col span={8}>
            <Input
              placeholder="搜索 slug / name"
              value={search}
              onChange={setSearch}
              showClear
            />
          </Col>
          <Col span={6}>
            <Select value={category} onChange={setCategory} optionList={CATEGORY_OPTIONS} placeholder="分类" />
          </Col>
          <Col span={6}>
            <Select
              value={sortBy}
              onChange={(v) => setSortBy(v as 'popular' | 'recent' | 'name')}
              optionList={[
                { value: 'popular', label: '热门 (下载量)' },
                { value: 'recent', label: '最近' },
                { value: 'name', label: '名称' },
              ]}
            />
          </Col>
        </Row>
      </Card>
      <Card>
        <Table
          columns={columns}
          dataSource={filtered}
          rowKey="id"
          pagination={false}
          empty={<div style={{ padding: 40, textAlign: 'center', color: 'var(--semi-color-text-2)' }}>无 preset 数据</div>}
        />
      </Card>
    </div>
  );
}