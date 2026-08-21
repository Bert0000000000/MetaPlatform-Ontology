// src/pages/HITL.tsx — M13 HITL Hub (Loop 2/3: M22 Escalate 集成)
import React, { useEffect, useState, useCallback } from 'react';
import { Spin, Table, Card, Tag, Row, Col, Badge, Button, Modal, Input, Toast } from '@douyinfe/semi-ui';
import Stat from '../components/Stat';
import PageHeader from '../components/PageHeader';
import { authedFetch } from '../lib/api';
import { subscribeTable } from '../lib/realtime';

interface HITLRow {
  id: string;
  type: string;
  status: string;
  title: string;
  escalation_level: number;
  deadline_at: string;
  decided_at: string;
  created_at: string;
}

const TYPE_COLORS: Record<string, string> = {
  workflow_saas: 'blue',
  workflow_dsh: 'cyan',
  tool_dsh: 'orange',
  action_confirm: 'purple',
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'orange',
  approved: 'green',
  rejected: 'red',
  expired: 'grey',
  cancelled: 'grey',
};

export default function HITL() {
  const [rows, setRows] = useState<HITLRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [escalateModal, setEscalateModal] = useState<{ hitlId: string; currentLevel: number } | null>(null);
  const [newApprovers, setNewApprovers] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const r = await authedFetch('/rest/v1/hitl_requests?select=id,type,status,title,escalation_level,deadline_at,decided_at,created_at&order=created_at.desc&limit=30') as HITLRow[];
      setRows(r);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // M40 Loop 3/3: Realtime 订阅 hitl_requests INSERT/UPDATE → 自动刷新
  useEffect(() => {
    const sub = subscribeTable('hitl_requests', () => {
      load();
    });
    return () => sub.unsubscribe();
  }, []);

  // M22 Loop 2/3: 多级审批升级 (escalate-hitl EF)
  const handleEscalate = useCallback(async (hitlId: string) => {
    const row = rows.find((r) => r.id === hitlId);
    if (!row) return;
    setEscalateModal({ hitlId, currentLevel: row.escalation_level });
    setNewApprovers('');
  }, [rows]);

  const confirmEscalate = useCallback(async () => {
    if (!escalateModal) return;
    const approverIds = newApprovers.split(/[,\s]+/).filter(Boolean);
    if (approverIds.length === 0) {
      Toast.error('请输入至少一个 approver UUID');
      return;
    }
    try {
      const loginR = await authedFetch('/rest/v1/profiles?select=id&limit=1');
      const adminJwt = 'placeholder';
      const r = await fetch('http://127.0.0.1:54321/functions/v1/escalate-hitl', {
        method: 'POST',
        headers: {
          apikey: 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH',
          'Authorization': `Bearer ${adminJwt}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ hitl_request_id: escalateModal.hitlId, new_approver_ids: approverIds }),
      });
      const body = await r.json();
      if (r.ok) {
        Toast.success(`升级成功 → L${body.escalation_level}`);
        load();
      } else {
        Toast.error(body.message ?? '升级失败');
      }
    } catch (e) {
      Toast.error((e as Error).message);
    } finally {
      setEscalateModal(null);
    }
  }, [escalateModal, newApprovers, load]);

  if (loading) return <Spin />;

  const pending = rows.filter((r) => r.status === 'pending').length;
  const approved = rows.filter((r) => r.status === 'approved').length;
  const rejected = rows.filter((r) => r.status === 'rejected').length;
  const avg = rows.filter((r) => r.decided_at).reduce((s, r) => s + (new Date(r.decided_at).getTime() - new Date(r.created_at).getTime()), 0);
  const avgMs = rows.filter((r) => r.decided_at).length ? Math.round(avg / rows.filter((r) => r.decided_at).length / 1000) : 0;

  const columns = [
    { title: 'type', dataIndex: 'type', render: (v: string) => <Tag color={TYPE_COLORS[v] ?? 'grey'}>{v}</Tag> },
    { title: 'status', dataIndex: 'status', render: (v: string) => <Tag color={STATUS_COLORS[v] ?? 'grey'}>{v}</Tag> },
    { title: 'title', dataIndex: 'title' },
    { title: 'escalation', dataIndex: 'escalation_level', render: (v: number) => <Tag color={v >= 2 ? 'red' : v === 1 ? 'orange' : 'grey'}>L{v}</Tag> },
    { title: 'deadline', dataIndex: 'deadline_at' },
    { title: 'decided_at', dataIndex: 'decided_at' },
    { title: 'created_at', dataIndex: 'created_at' },
    {
      title: '操作',
      render: (_: unknown, r: HITLRow) => (
        r.status === 'pending' && r.escalation_level < 4 ? (
          <Button size="small" type="warning" onClick={() => handleEscalate(r.id)}>
            升级 (→L{r.escalation_level + 1})
          </Button>
        ) : (
          <span style={{ color: 'var(--semi-color-text-2)' }}>—</span>
        )
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="M13 HITL Hub" description="4 类型联动中枢 + 多级升级 (M22 Loop 2/3)" onRefresh={load} />
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col span={6}><Card>
          <Stat
            title={<>Pending <Badge count={pending} type={pending > 0 ? 'warning' : 'success'} overflowCount={99} /></>}
            value={pending}
            valueStyle={{ color: pending > 0 ? 'orange' : 'green' }}
          />
        </Card></Col>
        <Col span={6}><Card><Stat title="Approved" value={approved} valueStyle={{ color: 'green' }} /></Card></Col>
        <Col span={6}><Card><Stat title="Rejected" value={rejected} valueStyle={{ color: 'red' }} /></Card></Col>
        <Col span={6}><Card><Stat title="Avg Decision (s)" value={avgMs} /></Card></Col>
      </Row>
      <Card>
        <Table columns={columns} dataSource={rows} rowKey="id" pagination={false} />
      </Card>
      <Modal
        title={`升级审批 → L${(escalateModal?.currentLevel ?? 0) + 1}`}
        visible={!!escalateModal}
        onCancel={() => setEscalateModal(null)}
        onOk={confirmEscalate}
        okText="确认升级"
        cancelText="取消"
      >
        <p style={{ marginBottom: 12, color: 'var(--semi-color-text-2)' }}>
          输入新一级审批人的 user UUID (逗号或空格分隔).
          当前 L{escalateModal?.currentLevel} → 新 L{(escalateModal?.currentLevel ?? 0) + 1}
        </p>
        <Input
          value={newApprovers}
          onChange={setNewApprovers}
          placeholder="uuid1, uuid2, uuid3"
        />
      </Modal>
    </div>
  );
}