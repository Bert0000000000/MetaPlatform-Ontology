// src/pages/OntologyLlm.tsx — LLM 生成 (调 generate-ontology-proposal EF)
// 输入自然语言 → 调 EF → 显示 preview 列表 → 接受/拒绝/编辑
import React, { useState } from 'react';
import { Card, Input, TextArea, Button, Tag, Row, Col, Typography, Empty, Tabs, Toast, Spin, Space, Modal } from '@douyinfe/semi-ui';
import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';
import { authedFetch } from '../lib/api';

const { Title, Text } = Typography;

interface Proposal {
  object_types: Array<{ rid: string; slug: string; name: string; description: string; properties: Record<string, unknown>; status: string }>;
  relation_types: Array<{ rid: string; name: string; from_type: string; to_type: string; cardinality: string; status: string }>;
  action_types: Array<{ rid: string; name: string; target_type: string; permission: string; workflow_name?: string; hitl_type?: string; status: string }>;
}

interface GenerateResponse {
  ok: boolean;
  description_preview: string;
  proposal: Proposal;
  counts: { object_types: number; relation_types: number; action_types: number };
  note?: string;
}

const EXAMPLE = `我需要一个客户管理系统: 客户下多个订单, 订单包含产品, 订单可以审批, 合同关联客户, 发票属于订单.
管理员可以创建客户, owner 可以审批订单, owner 可以签署合同, admin 可以开票.`;

export default function OntologyLlm() {
  const [desc, setDesc] = useState('');
  const [loading, setLoading] = useState(false);
  const [resp, setResp] = useState<GenerateResponse | null>(null);
  const [editModal, setEditModal] = useState<{ kind: string; idx: number; value: string } | null>(null);

  const generate = async () => {
    if (!desc.trim()) {
      Toast.warning('请输入自然语言描述');
      return;
    }
    setLoading(true);
    try {
      const r = await authedFetch('/functions/v1/generate-ontology-proposal', {
        method: 'POST',
        body: JSON.stringify({ description: desc }),
      }) as GenerateResponse;
      setResp(r);
      Toast.success(`生成 ${r.counts.object_types + r.counts.relation_types + r.counts.action_types} 个 proposals`);
    } catch (e) {
      Toast.error(`生成失败: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleAccept = () => {
    Toast.info('生产实现: POST /functions/v1/create-ontology-type 批量落库 (PoC 暂留 mock)');
  };

  const handleReject = () => {
    setResp(null);
    Toast.info('已拒绝 proposal');
  };

  const handleEdit = (kind: string, idx: number, currentName: string) => {
    setEditModal({ kind, idx, value: currentName });
  };

  const saveEdit = () => {
    if (!editModal || !resp) return;
    const next = { ...resp };
    const arr = (next.proposal as unknown as Record<string, Array<Record<string, unknown>>>)[editModal.kind];
    if (arr && arr[editModal.idx]) {
      arr[editModal.idx].name = editModal.value;
    }
    setResp(next);
    setEditModal(null);
    Toast.success('已更新 (本地预览, 需重新 generate 才能发到后端)');
  };

  return (
    <div>
      <PageHeader
        title="LLM 本体生成"
        description="M18 + MetaPlatform-LLM-01 · 输入自然语言 → mock LLM → preview ObjectType/RelationType/ActionType"
        extra={
          <Button onClick={() => setDesc(EXAMPLE)} type="secondary">填充示例</Button>
        }
      />

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col span={6}><StatCard title="ObjectType" value={resp?.counts.object_types ?? 0} color="primary" /></Col>
        <Col span={6}><StatCard title="RelationType" value={resp?.counts.relation_types ?? 0} color="success" /></Col>
        <Col span={6}><StatCard title="ActionType" value={resp?.counts.action_types ?? 0} color="warning" /></Col>
        <Col span={6}><StatCard title="合计" value={(resp?.counts.object_types ?? 0) + (resp?.counts.relation_types ?? 0) + (resp?.counts.action_types ?? 0)} /></Col>
      </Row>

      <Card title="描述输入" style={{ marginBottom: 16 }}>
        <TextArea
          value={desc}
          onChange={setDesc}
          placeholder="例如: 客户下订单, 订单包含产品, 订单审批..."
          autosize={{ minRows: 4, maxRows: 8 }}
          maxLength={4000}
          showClear
        />
        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <Button theme="solid" type="primary" onClick={generate} loading={loading}>
            调用 generate-ontology-proposal EF
          </Button>
          {resp && (
            <Space>
              <Button type="danger" onClick={handleReject}>拒绝</Button>
              <Button type="primary" onClick={handleAccept}>接受 (落库)</Button>
            </Space>
          )}
        </div>
        <Text type="tertiary" style={{ fontSize: 11, display: 'block', marginTop: 8 }}>
          POST /functions/v1/generate-ontology-proposal · body: {`{ description: string }`} · admin/owner role
        </Text>
      </Card>

      {loading && <Spin tip="生成中..." />}

      {!loading && !resp && (
        <Card>
          <Empty description="输入描述后点击生成按钮" />
        </Card>
      )}

      {!loading && resp && (
        <Card title={`Preview · ${resp.description_preview.slice(0, 60)}${resp.description_preview.length > 60 ? '…' : ''}`}>
          <Tabs type="line">
            <Tabs.TabPane tab={`ObjectType (${resp.proposal.object_types.length})`} itemKey="object">
              {resp.proposal.object_types.length === 0 ? (
                <Empty description="无 ObjectType 提案" />
              ) : (
                <Row gutter={[16, 16]}>
                  {resp.proposal.object_types.map((o, i) => (
                    <Col span={8} key={o.rid}>
                      <Card shadows="hover" style={{ minHeight: 160 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <strong>{o.rid}</strong>
                          <Tag color="orange">draft</Tag>
                        </div>
                        <Text type="tertiary" style={{ display: 'block', fontSize: 12, margin: '4px 0' }}>
                          {o.name}
                        </Text>
                        <Text style={{ fontSize: 12 }}>{o.description}</Text>
                        <div style={{ marginTop: 8 }}>
                          {Object.entries(o.properties).map(([k, v]) => (
                            <Tag key={k} color="blue" style={{ marginRight: 4, marginBottom: 4 }}>
                              {k}:{(v as { type?: string }).type ?? '?'}
                            </Tag>
                          ))}
                        </div>
                        <div style={{ marginTop: 8 }}>
                          <Button size="small" theme="borderless" type="primary" onClick={() => handleEdit('object_types', i, o.name)}>
                            编辑
                          </Button>
                        </div>
                      </Card>
                    </Col>
                  ))}
                </Row>
              )}
            </Tabs.TabPane>
            <Tabs.TabPane tab={`RelationType (${resp.proposal.relation_types.length})`} itemKey="relation">
              {resp.proposal.relation_types.length === 0 ? (
                <Empty description="无 RelationType 提案" />
              ) : (
                <Row gutter={[16, 16]}>
                  {resp.proposal.relation_types.map((r, i) => (
                    <Col span={12} key={r.rid}>
                      <Card shadows="hover">
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <strong>{r.rid}</strong>
                          <Tag color="cyan">draft</Tag>
                        </div>
                        <Text style={{ fontSize: 12, display: 'block', margin: '4px 0' }}>
                          {r.from_type} → {r.to_type}
                        </Text>
                        <Space>
                          <Tag color="blue">{r.cardinality}</Tag>
                          <Button size="small" theme="borderless" type="primary" onClick={() => handleEdit('relation_types', i, r.name)}>
                            编辑
                          </Button>
                        </Space>
                      </Card>
                    </Col>
                  ))}
                </Row>
              )}
            </Tabs.TabPane>
            <Tabs.TabPane tab={`ActionType (${resp.proposal.action_types.length})`} itemKey="action">
              {resp.proposal.action_types.length === 0 ? (
                <Empty description="无 ActionType 提案" />
              ) : (
                <Row gutter={[16, 16]}>
                  {resp.proposal.action_types.map((a, i) => (
                    <Col span={12} key={a.rid}>
                      <Card shadows="hover">
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <strong>{a.rid}</strong>
                          <Tag color="purple">draft</Tag>
                        </div>
                        <Text style={{ fontSize: 12, display: 'block', margin: '4px 0' }}>
                          target: {a.target_type} · perm: <Tag color="red">{a.permission}</Tag>
                        </Text>
                        <Space wrap>
                          {a.workflow_name && <Tag color="green">{a.workflow_name}</Tag>}
                          {a.hitl_type && <Tag color="orange">{a.hitl_type}</Tag>}
                          <Button size="small" theme="borderless" type="primary" onClick={() => handleEdit('action_types', i, a.name)}>
                            编辑
                          </Button>
                        </Space>
                      </Card>
                    </Col>
                  ))}
                </Row>
              )}
            </Tabs.TabPane>
          </Tabs>
          {resp.note && (
            <Text type="tertiary" style={{ fontSize: 11, display: 'block', marginTop: 12 }}>{resp.note}</Text>
          )}
        </Card>
      )}

      <Modal
        title="编辑名称"
        visible={!!editModal}
        onCancel={() => setEditModal(null)}
        onOk={saveEdit}
        okText="保存"
        cancelText="取消"
      >
        <Input value={editModal?.value ?? ''} onChange={(v) => setEditModal((prev) => prev ? { ...prev, value: v } : null)} />
      </Modal>
    </div>
  );
}