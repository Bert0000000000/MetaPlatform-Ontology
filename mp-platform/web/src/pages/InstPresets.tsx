// src/pages/InstPresets.tsx
// Presets + Installs (2 tabs)

import { useEffect, useState } from 'react';
import { Spin, Table, Tabs, Banner } from '@douyinfe/semi-ui';
import { Api } from '@/api/client';

const PRESET_COLUMNS = [
  { title: 'Slug', dataIndex: 'slug' },
  { title: 'Name', dataIndex: 'name' },
  { title: 'Visibility', dataIndex: 'visibility', width: 120 },
  { title: 'Downloads', dataIndex: 'downloads_count', width: 110 },
  { title: 'Version', dataIndex: 'current_version', width: 120 },
  { title: 'Maintainer', dataIndex: 'maintainer_id', width: 140 },
];

const INSTALL_COLUMNS = [
  { title: 'ID', dataIndex: 'id', width: 80 },
  { title: 'Preset', dataIndex: 'preset' },
  { title: 'Workspace', dataIndex: 'workspace_id', width: 200 },
  { title: 'Status', dataIndex: 'status', width: 120 },
  {
    title: 'Installed',
    dataIndex: 'installed_at',
    width: 200,
    render: (v: string) => (v ? new Date(v).toLocaleString() : ''),
  },
];

export default function InstPresetsPage() {
  const [presets, setPresets] = useState<Array<Record<string, unknown>>>([]);
  const [installs, setInstalls] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([Api.presets(), Api.installs()])
      .then(([p, i]) => { setPresets(p); setInstalls(i); })
      .catch((e) => setError(String(e?.message ?? e)))
      .finally(() => setLoading(false));
  }, []);

  if (error) return <Banner type="danger" title="加载 Presets/Installs 失败" description={error} />;

  return (
    <div data-testid="mp-presets-page">
      <h2 style={{ marginTop: 0 }}>Presets / Installs</h2>
      {loading
        ? <Spin />
        : (
          <Tabs>
            <Tabs.TabPane tab="Presets" itemKey="presets">
              <Table
                rowKey="slug"
                dataSource={presets}
                columns={PRESET_COLUMNS as never}
                pagination={{ pageSize: 25 }}
                data-testid="mp-presets-table"
              />
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--semi-color-text-2)' }}>
                共 {presets.length} 条 preset
              </div>
            </Tabs.TabPane>
            <Tabs.TabPane tab="Installs" itemKey="installs">
              <Table
                rowKey="id"
                dataSource={installs}
                columns={INSTALL_COLUMNS as never}
                pagination={{ pageSize: 25 }}
                data-testid="mp-installs-table"
              />
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--semi-color-text-2)' }}>
                共 {installs.length} 条 install
              </div>
            </Tabs.TabPane>
          </Tabs>
        )}
    </div>
  );
}
