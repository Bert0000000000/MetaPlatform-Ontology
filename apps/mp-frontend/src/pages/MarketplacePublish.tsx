// src/pages/MarketplacePublish.tsx — 发布 (admin) form
import React, { useState } from 'react';
import { Card, Input, TextArea, Select, Button, Toast, Row, Col, Tag, Typography, Empty } from '@douyinfe/semi-ui';
import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';
import { authedFetch } from '../lib/api';

const { Text } = Typography;

const CATEGORIES = [
  { value: 'support', label: 'Support' },
  { value: 'data', label: 'Data' },
  { value: 'contract', label: 'Contract' },
  { value: 'custom', label: 'Custom' },
  { value: 'dashboard', label: 'Dashboard' },
  { value: 'knowledge', label: 'Knowledge' },
];

const VISIBILITY = [
  { value: 'public', label: 'public - 公开' },
  { value: 'internal', label: 'internal - 内部' },
  { value: 'private', label: 'private - 私有' },
];

interface DraftPreset {
  slug: string;
  name: string;
  category: string;
  visibility: string;
  current_version: string;
  description: string;
}

const EMPTY_DRAFT: DraftPreset = {
  slug: '',
  name: '',
  category: 'custom',
  visibility: 'internal',
  current_version: '0.1.0',
  description: '',
};

const labelStyle: React.CSSProperties = { fontSize: 12, color: 'var(--semi-color-text-2)', display: 'block', marginBottom: 4 };
const requiredMark: React.CSSProperties = { color: 'var(--semi-color-danger)', marginLeft: 2 };

export default function MarketplacePublish() {
  const [drafts, setDrafts] = useState<DraftPreset[]>([{ ...EMPTY_DRAFT }]);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<{ slug: string; status: string; submittedAt: string }[]>([]);

  const update = (idx: number, patch: Partial<DraftPreset>) => {
    setDrafts((d) => d.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  };

  const addDraft = () => {
    setDrafts((d) => [...d, { ...EMPTY_DRAFT }]);
  };

  const removeDraft = (idx: number) => {
    setDrafts((d) => d.filter((_, i) => i !== idx));
  };

  const validate = (): string | null => {
    for (const d of drafts) {
      if (!d.slug.trim()) return '所有 draft 必须填写 slug';
      if (!d.name.trim()) return `draft "${d.slug}" 缺少 name`;
      if (!d.current_version.trim()) return `draft "${d.slug}" 缺少 version`;
    }
    return null;
  };

  const submit = async () => {
    const err = validate();
    if (err) {
      Toast.error(err);
      return;
    }
    setSubmitting(true);
    try {
      const results: { slug: string; status: string; submittedAt: string }[] = [];
      for (const d of drafts) {
        try {
          await authedFetch('/rest/v1/presets', {
            method: 'POST',
            headers: { 'Prefer': 'return=minimal' },
            body: JSON.stringify({
              slug: d.slug,
              name: d.name,
              category: d.category,
              visibility: d.visibility,
              current_version: d.current_version,
              description: d.description || null,
              downloads_count: 0,
            }),
          });
          results.push({ slug: d.slug, status: 'submitted', submittedAt: new Date().toISOString() });
        } catch (e) {
          results.push({ slug: d.slug, status: `failed: ${(e as Error).message}`, submittedAt: new Date().toISOString() });
        }
      }
      setSubmitted(results);
      Toast.success(`${results.filter((r) => r.status === 'submitted').length} 个 draft 已提交`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <PageHeader title="发布 (admin)" description="批量提交 preset drafts 到 mp_preset_registry · admin/owner role" />

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col span={6}><StatCard title="Drafts" value={drafts.length} color="primary" /></Col>
        <Col span={6}><StatCard title="已提交" value={submitted.length} color="success" /></Col>
        <Col span={6}><StatCard title="成功" value={submitted.filter((s) => s.status === 'submitted').length} color="success" /></Col>
        <Col span={6}><StatCard title="失败" value={submitted.filter((s) => s.status.startsWith('failed')).length} color="warning" /></Col>
      </Row>

      <Card title="Drafts" style={{ marginBottom: 16 }} headerExtraContent={<Button onClick={addDraft}>+ 新增 draft</Button>}>
        {drafts.map((d, idx) => (
          <Card
            key={idx}
            shadows="hover"
            style={{ marginBottom: 12 }}
            title={`#${idx + 1} ${d.slug || '(未命名)'}`}
            headerExtraContent={drafts.length > 1 ? <Button type="danger" theme="borderless" onClick={() => removeDraft(idx)}>删除</Button> : null}
          >
            <Row gutter={16}>
              <Col span={8}>
                <label style={labelStyle}>slug<span style={requiredMark}>*</span></label>
                <Input value={d.slug} onChange={(v) => update(idx, { slug: v })} placeholder="my-preset-slug" />
              </Col>
              <Col span={8}>
                <label style={labelStyle}>name<span style={requiredMark}>*</span></label>
                <Input value={d.name} onChange={(v) => update(idx, { name: v })} placeholder="我的 Preset" />
              </Col>
              <Col span={8}>
                <label style={labelStyle}>current_version<span style={requiredMark}>*</span></label>
                <Input value={d.current_version} onChange={(v) => update(idx, { current_version: v })} placeholder="0.1.0" />
              </Col>
              <Col span={8} style={{ marginTop: 12 }}>
                <label style={labelStyle}>category</label>
                <Select value={d.category} onChange={(v) => update(idx, { category: typeof v === 'string' ? v : 'custom' })} optionList={CATEGORIES} style={{ width: '100%' }} />
              </Col>
              <Col span={8} style={{ marginTop: 12 }}>
                <label style={labelStyle}>visibility</label>
                <Select value={d.visibility} onChange={(v) => update(idx, { visibility: typeof v === 'string' ? v : 'internal' })} optionList={VISIBILITY} style={{ width: '100%' }} />
              </Col>
              <Col span={24} style={{ marginTop: 12 }}>
                <label style={labelStyle}>description</label>
                <TextArea value={d.description} onChange={(v) => update(idx, { description: v })} placeholder="preset 描述" autosize={{ minRows: 2, maxRows: 4 }} />
              </Col>
            </Row>
          </Card>
        ))}
      </Card>

      <Card style={{ marginBottom: 16 }}>
        <Button theme="solid" type="primary" loading={submitting} onClick={submit} size="large">
          提交 {drafts.length} 个 draft
        </Button>
        <Text type="tertiary" style={{ fontSize: 11, display: 'block', marginTop: 8 }}>
          POST /rest/v1/presets · 服务端 RLS: admin/owner role
        </Text>
      </Card>

      {submitted.length > 0 && (
        <Card title="提交结果">
          {submitted.length === 0 ? (
            <Empty description="尚无结果" />
          ) : (
            submitted.map((s, i) => (
              <div key={i} style={{ padding: 8, borderBottom: '1px solid var(--semi-color-border)', display: 'flex', justifyContent: 'space-between' }}>
                <strong>{s.slug}</strong>
                <div>
                  <Tag color={s.status === 'submitted' ? 'green' : 'red'}>{s.status}</Tag>
                  <Text type="tertiary" style={{ fontSize: 11 }}>{s.submittedAt}</Text>
                </div>
              </div>
            ))
          )}
        </Card>
      )}
    </div>
  );
}