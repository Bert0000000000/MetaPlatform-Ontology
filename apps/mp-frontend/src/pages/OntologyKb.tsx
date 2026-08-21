// src/pages/OntologyKb.tsx — 知识库 (ontology_kb 表)
// 列出 ontology_kb 表 + 搜索 + Tag 过滤 + Markdown 预览
import React, { useEffect, useMemo, useState } from 'react';
import { Spin, Card, Tag, Input, Select, Row, Col, Modal, Typography, Button, Empty } from '@douyinfe/semi-ui';
import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';
import { authedFetch } from '../lib/api';

const { Text } = Typography;

interface KbDoc {
  id: string;
  title: string;
  content: string;
  tags: string[];
  rid?: string | null;
  status: string;
  created_at: string;
}

export default function OntologyKb() {
  const [docs, setDocs] = useState<KbDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [tableMissing, setTableMissing] = useState(false);
  const [search, setSearch] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [preview, setPreview] = useState<KbDoc | null>(null);

  const load = async () => {
    setLoading(true);
    setTableMissing(false);
    try {
      const r = await authedFetch('/rest/v1/ontology_kb?select=id,title,content,tags,rid,status,created_at&order=created_at.desc&limit=100') as KbDoc[];
      setDocs(r);
    } catch (e) {
      // 表不存在时 → 显示空状态 (不会 crash)
      const msg = (e as Error).message ?? '';
      if (msg.includes('relation') || msg.includes('does not exist') || msg.includes('404') || msg.includes('PGRST')) {
        setTableMissing(true);
        setDocs([]);
      } else {
        throw e;
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    docs.forEach((d) => (d.tags ?? []).forEach((t) => set.add(t)));
    return Array.from(set).sort();
  }, [docs]);

  const filtered = useMemo(() => {
    let f = docs;
    if (search) {
      const q = search.toLowerCase();
      f = f.filter((d) => d.title.toLowerCase().includes(q) || (d.content ?? '').toLowerCase().includes(q));
    }
    if (tagFilter) f = f.filter((d) => (d.tags ?? []).includes(tagFilter));
    return f;
  }, [docs, search, tagFilter]);

  if (loading) return <Spin />;

  return (
    <div>
      <PageHeader title="知识库 (ontology_kb)" description="本体的 Markdown 知识文档 · Tag 过滤 + 全文搜索" onRefresh={load} />

      {tableMissing && (
        <Card style={{ marginBottom: 16, background: '#fff7ed', borderColor: '#fb923c' }}>
          <Text type="warning">
            ontology_kb 表尚未创建. 请运行 migration <code>20260820220000_create_ontology_kb.sql</code> 后刷新.
          </Text>
        </Card>
      )}

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col span={6}><StatCard title="文档总数" value={docs.length} color="primary" /></Col>
        <Col span={6}><StatCard title="Active" value={docs.filter((d) => d.status === 'active').length} color="success" /></Col>
        <Col span={6}><StatCard title="Tags" value={allTags.length} color="warning" /></Col>
        <Col span={6}><StatCard title="关联 rid" value={new Set(docs.filter((d) => d.rid).map((d) => d.rid)).size} /></Col>
      </Row>

      <Card style={{ marginBottom: 16 }}>
        <Row gutter={16}>
          <Col span={14}>
            <Input placeholder="搜索 title / content" value={search} onChange={setSearch} showClear />
          </Col>
          <Col span={8}>
            <Select
              value={tagFilter}
              onChange={(v) => setTagFilter(typeof v === 'string' ? v : '')}
              optionList={[{ value: '', label: '全部 Tag' }, ...allTags.map((t) => ({ value: t, label: t }))]}
              placeholder="Tag 过滤"
              style={{ width: '100%' }}
            />
          </Col>
        </Row>
      </Card>

      <Card title={`文档列表 (${filtered.length})`}>
        {filtered.length === 0 ? (
          <Empty description={tableMissing ? 'ontology_kb 表不存在 (请创建 migration)' : '暂无文档'} />
        ) : (
          <Row gutter={[16, 16]}>
            {filtered.map((d) => (
              <Col span={12} key={d.id}>
                <Card
                  shadows="hover"
                  title={<span style={{ fontSize: 14 }}>{d.title}</span>}
                  headerExtraContent={<Tag color={d.status === 'active' ? 'green' : 'grey'}>{d.status}</Tag>}
                  style={{ minHeight: 180 }}
                >
                  <Text type="tertiary" ellipsis={{ rows: 3 }} style={{ display: 'block', marginBottom: 12 }}>
                    {d.content}
                  </Text>
                  <div style={{ marginBottom: 8 }}>
                    {(d.tags ?? []).map((t) => (
                      <Tag key={t} color="blue" style={{ marginRight: 4 }}>{t}</Tag>
                    ))}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text type="tertiary" style={{ fontSize: 11 }}>{d.created_at}{d.rid ? ` · 关联 ${d.rid}` : ''}</Text>
                    <Button size="small" theme="borderless" type="primary" onClick={() => setPreview(d)}>预览</Button>
                  </div>
                </Card>
              </Col>
            ))}
          </Row>
        )}
      </Card>

      <Modal
        title={preview?.title}
        visible={!!preview}
        onCancel={() => setPreview(null)}
        onOk={() => setPreview(null)}
        okText="关闭"
        cancelButtonProps={{ style: { display: 'none' } }}
        width={720}
      >
        {preview && (
          <div>
            <div style={{ marginBottom: 12 }}>
              {(preview.tags ?? []).map((t) => <Tag key={t} color="blue" style={{ marginRight: 4 }}>{t}</Tag>)}
              {preview.rid && <Tag color="cyan">rid: {preview.rid}</Tag>}
            </div>
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit', fontSize: 13, lineHeight: 1.6 }}>
              {preview.content}
            </pre>
            <Text type="tertiary" style={{ fontSize: 11, display: 'block', marginTop: 12 }}>{preview.created_at}</Text>
          </div>
        )}
      </Modal>
    </div>
  );
}