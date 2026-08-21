// src/pages/OntologyGraph.tsx — 本体图谱 (SVG 自画)
// 节点: ObjectType, 边: RelationType
import React, { useEffect, useMemo, useState } from 'react';
import { Spin, Card, Tag, Row, Col, Descriptions, Typography, Empty } from '@douyinfe/semi-ui';
import PageHeader from '../components/PageHeader';
import { authedFetch } from '../lib/api';

const { Title, Text } = Typography;

interface ObjectType { rid: string; name: string; status: string; }
interface RelationType { rid: string; name: string; from_type: string; to_type: string; cardinality: string; status: string; }

// 圆形布局: N 个节点均匀分布在圆上
function circleLayout(n: number, cx: number, cy: number, r: number) {
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n - Math.PI / 2;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
}

const NODE_W = 140;
const NODE_H = 56;

export default function OntologyGraph() {
  const [objs, setObjs] = useState<ObjectType[]>([]);
  const [rels, setRels] = useState<RelationType[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<{ kind: 'node' | 'edge'; id: string } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [o, r] = await Promise.all([
        authedFetch('/rest/v1/ontology_object_types?select=rid,name,status&order=rid.asc&limit=100') as Promise<ObjectType[]>,
        authedFetch('/rest/v1/ontology_relation_types?select=rid,name,from_type,to_type,cardinality,status&order=rid.asc&limit=100') as Promise<RelationType[]>,
      ]);
      // 去重 by rid
      const seen = new Set<string>();
      const uniqueObjs = o.filter((x) => seen.has(x.rid) ? false : (seen.add(x.rid), true));
      const seen2 = new Set<string>();
      const uniqueRels = r.filter((x) => seen2.has(x.rid) ? false : (seen2.add(x.rid), true));
      setObjs(uniqueObjs);
      setRels(uniqueRels);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const { svgW, svgH, positions, validRels } = useMemo(() => {
    const W = 800;
    const H = 600;
    const cx = W / 2;
    const cy = H / 2;
    const r = Math.min(W, H) / 2 - 80;
    const n = objs.length;
    const pts = circleLayout(n, cx, cy, r);
    const positions = new Map<string, { x: number; y: number }>();
    objs.forEach((o, i) => {
      positions.set(o.rid, pts[i] ?? { x: cx, y: cy });
    });
    // 只保留两端都在 objs 里的边
    const validRels = rels.filter((r) => positions.has(r.from_type) && positions.has(r.to_type));
    return { svgW: W, svgH: H, positions, validRels };
  }, [objs, rels]);

  if (loading) return <Spin />;

  const selectedNode = selected?.kind === 'node' ? objs.find((o) => o.rid === selected.id) : null;
  const selectedEdge = selected?.kind === 'edge' ? rels.find((r) => r.rid === selected.id) : null;

  return (
    <div>
      <PageHeader
        title="本体图谱"
        description={`节点 = ObjectType (${objs.length}) · 边 = RelationType (${validRels.length}/${rels.length})`}
        onRefresh={load}
      />
      <Row gutter={16}>
        <Col span={16}>
          <Card>
            {objs.length === 0 ? (
              <Empty description="无 ObjectType 数据, 图谱为空" />
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <svg
                  width={svgW}
                  height={svgH}
                  viewBox={`0 0 ${svgW} ${svgH}`}
                  style={{ background: 'linear-gradient(180deg, #f8fafc, #eef2ff)', borderRadius: 6 }}
                  data-testid="ontology-graph-svg"
                >
                  <defs>
                    <marker id="arrowhead" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
                      <path d="M0,0 L0,6 L9,3 z" fill="#6366f1" />
                    </marker>
                  </defs>

                  {/* 边: RelationType */}
                  {validRels.map((r) => {
                    const from = positions.get(r.from_type)!;
                    const to = positions.get(r.to_type)!;
                    const isSelected = selected?.kind === 'edge' && selected.id === r.rid;
                    // 缩短端点, 让箭头进入节点边缘
                    const dx = to.x - from.x;
                    const dy = to.y - from.y;
                    const len = Math.sqrt(dx * dx + dy * dy) || 1;
                    const ux = dx / len;
                    const uy = dy / len;
                    const offset = NODE_W / 2 + 4;
                    const x1 = from.x + ux * offset;
                    const y1 = from.y + uy * offset;
                    const x2 = to.x - ux * offset;
                    const y2 = to.y - uy * offset;
                    // 曲线控制点: 沿法线偏移
                    const mx = (x1 + x2) / 2;
                    const my = (y1 + y2) / 2;
                    const nx = -uy;
                    const ny = ux;
                    const cx = mx + nx * 30;
                    const cy = my + ny * 30;
                    return (
                      <g key={`edge-${r.rid}`} onClick={() => setSelected({ kind: 'edge', id: r.rid })} style={{ cursor: 'pointer' }}>
                        <path
                          d={`M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`}
                          stroke={isSelected ? '#ef4444' : '#6366f1'}
                          strokeWidth={isSelected ? 3 : 1.5}
                          fill="none"
                          markerEnd="url(#arrowhead)"
                          opacity={selected && selected.id !== r.rid && selected.kind === 'edge' ? 0.4 : 1}
                        />
                        <text
                          x={cx}
                          y={cy - 6}
                          textAnchor="middle"
                          fontSize={10}
                          fill={isSelected ? '#ef4444' : '#475569'}
                          style={{ pointerEvents: 'none' }}
                        >
                          {r.rid}
                        </text>
                      </g>
                    );
                  })}

                  {/* 节点: ObjectType */}
                  {objs.map((o) => {
                    const p = positions.get(o.rid);
                    if (!p) return null;
                    const isSelected = selected?.kind === 'node' && selected.id === o.rid;
                    return (
                      <g key={`node-${o.rid}`} onClick={() => setSelected({ kind: 'node', id: o.rid })} style={{ cursor: 'pointer' }}>
                        <rect
                          x={p.x - NODE_W / 2}
                          y={p.y - NODE_H / 2}
                          width={NODE_W}
                          height={NODE_H}
                          rx={8}
                          fill={isSelected ? '#fef2f2' : o.status === 'active' ? '#ffffff' : '#f1f5f9'}
                          stroke={isSelected ? '#ef4444' : '#6366f1'}
                          strokeWidth={isSelected ? 3 : 2}
                        />
                        <text x={p.x} y={p.y - 6} textAnchor="middle" fontSize={13} fontWeight={600} fill="#1e293b" style={{ pointerEvents: 'none' }}>
                          {o.rid}
                        </text>
                        <text x={p.x} y={p.y + 12} textAnchor="middle" fontSize={11} fill="#64748b" style={{ pointerEvents: 'none' }}>
                          {o.name || o.rid}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>
            )}
            <div style={{ marginTop: 12, fontSize: 12, color: 'var(--semi-color-text-2)' }}>
              点击节点 / 边查看详情. <Tag color="indigo">Indigo</Tag> 边 = RelationType, <Tag color="red">Red</Tag> = 选中.
            </div>
          </Card>
        </Col>
        <Col span={8}>
          <Card title="详情" style={{ minHeight: 200 }}>
            {selectedNode ? (
              <Descriptions
                size="small"
                items={[
                  { key: 'kind', label: 'Kind', value: <Tag color="blue">ObjectType</Tag> },
                  { key: 'rid', label: 'rid', value: <code>{selectedNode.rid}</code> },
                  { key: 'name', label: 'name', value: selectedNode.name },
                  { key: 'status', label: 'status', value: <Tag color={selectedNode.status === 'active' ? 'green' : 'grey'}>{selectedNode.status}</Tag> },
                  { key: 'links', label: '链接边', value: <code>{rels.filter((r) => r.from_type === selectedNode.rid || r.to_type === selectedNode.rid).map((r) => r.rid).join(', ') || '—'}</code> },
                ] as unknown as { key: string; value: React.ReactNode }[]}
              />
            ) : selectedEdge ? (
              <Descriptions
                size="small"
                items={[
                  { key: 'kind', label: 'Kind', value: <Tag color="cyan">RelationType</Tag> },
                  { key: 'rid', label: 'rid', value: <code>{selectedEdge.rid}</code> },
                  { key: 'name', label: 'name', value: selectedEdge.name },
                  { key: 'from', label: 'from', value: <code>{selectedEdge.from_type}</code> },
                  { key: 'to', label: 'to', value: <code>{selectedEdge.to_type}</code> },
                  { key: 'card', label: 'cardinality', value: <Tag color="blue">{selectedEdge.cardinality}</Tag> },
                  { key: 'status', label: 'status', value: <Tag color={selectedEdge.status === 'active' ? 'green' : 'grey'}>{selectedEdge.status}</Tag> },
                ] as unknown as { key: string; value: React.ReactNode }[]}
              />
            ) : (
              <Text type="tertiary">点击图谱中的节点 / 边查看详情</Text>
            )}
          </Card>
          <Card title="统计" style={{ marginTop: 16 }}>
            <Descriptions
              size="small"
              items={[
                { key: 'ObjectType 节点', value: <strong>{objs.length}</strong> },
                { key: 'RelationType 边 (有效)', value: <strong>{validRels.length}</strong> },
                { key: '孤立节点 (无边)', value: <strong>{objs.filter((o) => !rels.some((r) => r.from_type === o.rid || r.to_type === o.rid)).length}</strong> },
              ] as unknown as { key: string; value: React.ReactNode }[]}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}