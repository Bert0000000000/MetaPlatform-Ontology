/**
 * apps/web/src/components/OntologyDiff/OntologyDiffViewer.tsx
 * PRD: docs/active/prd/ontology-gen.md §4.4
 * Batch: MP-V6-ONTOLOGY-GEN-01
 *
 * 渲染 ontology 变更 diff (JSON format), 用 Semi Design Table 高亮 added/removed/modified
 */

import React from 'react';
import { Table, Tag } from '@douyinfe/semi-design-ui';

export interface OntologyDiffViewerProps {
  diff: Record<string, unknown>;
  objectTypeRid: string;
  changeType: 'create' | 'update' | 'delete' | 'rename';
  onApprove?: () => void;
  onReject?: (reason: string) => void;
}

interface DiffRow {
  field: string;
  oldValue: unknown;
  newValue: unknown;
  status: 'added' | 'removed' | 'modified' | 'unchanged';
}

function computeDiffRows(diff: Record<string, unknown>): DiffRow[] {
  // 简化: 假设 diff 形如 { old: {...}, new: {...} } 或 直接列出 added/removed/modified
  const rows: DiffRow[] = [];

  if (diff['old'] && diff['new'] && typeof diff['old'] === 'object' && typeof diff['new'] === 'object') {
    const oldObj = diff['old'] as Record<string, unknown>;
    const newObj = diff['new'] as Record<string, unknown>;
    const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);

    for (const key of allKeys) {
      const oldVal = oldObj[key];
      const newVal = newObj[key];
      let status: DiffRow['status'] = 'unchanged';
      if (!(key in oldObj)) status = 'added';
      else if (!(key in newObj)) status = 'removed';
      else if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) status = 'modified';

      rows.push({ field: key, oldValue: oldVal, newValue: newVal, status });
    }
  }

  return rows;
}

export function OntologyDiffViewer({ diff, objectTypeRid, changeType, onApprove, onReject }: OntologyDiffViewerProps) {
  const rows = React.useMemo(() => computeDiffRows(diff), [diff]);

  const columns = [
    {
      title: '字段',
      dataIndex: 'field',
      width: 200,
    },
    {
      title: '旧值',
      dataIndex: 'oldValue',
      render: (val: unknown) => val === undefined ? <Tag color="grey">N/A</Tag> : JSON.stringify(val),
    },
    {
      title: '新值',
      dataIndex: 'newValue',
      render: (val: unknown, row: DiffRow) => {
        const tag = row.status === 'added' ? <Tag color="green">+ ADDED</Tag>
                  : row.status === 'removed' ? <Tag color="red">- REMOVED</Tag>
                  : row.status === 'modified' ? <Tag color="yellow">~ MODIFIED</Tag>
                  : <Tag color="grey">unchanged</Tag>;
        return <>{tag} {JSON.stringify(val)}</>;
      },
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <h2>本体变更预览</h2>
      <p>
        <Tag color="blue">{changeType.toUpperCase()}</Tag>
        <code>{objectTypeRid}</code>
      </p>
      <Table
        columns={columns}
        dataSource={rows}
        rowKey="field"
        pagination={false}
        size="small"
      />
      <div style={{ marginTop: 24 }}>
        {onApprove && <button onClick={onApprove}>批准</button>}
        {onReject && <button onClick={() => onReject('user rejected')}>拒绝</button>}
      </div>
    </div>
  );
}

export default OntologyDiffViewer;