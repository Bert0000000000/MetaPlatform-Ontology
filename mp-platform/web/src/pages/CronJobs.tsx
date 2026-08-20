// src/pages/CronJobs.tsx
// pg_cron jobs (10+ jobs)

import { useEffect, useState } from 'react';
import { Spin, Table, Tag, Banner } from '@douyinfe/semi-ui';
import { Api } from '@/api/client';

const COLUMNS = [
  { title: 'Job', dataIndex: 'jobname' },
  { title: 'Schedule', dataIndex: 'schedule' },
  {
    title: 'Active',
    dataIndex: 'active',
    width: 120,
    render: (v: boolean) => (v
      ? <Tag color="green" data-testid="mp-cron-active">active</Tag>
      : <Tag color="red">disabled</Tag>),
  },
];

export default function CronJobsPage() {
  const [data, setData] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Api.cron()
      .then(setData)
      .catch((e) => setError(String(e?.message ?? e)))
      .finally(() => setLoading(false));
  }, []);

  if (error) return <Banner type="danger" title="加载 Cron Jobs 失败" description={error} />;

  return (
    <div data-testid="mp-cron-page">
      <h2 style={{ marginTop: 0 }}>pg_cron Jobs</h2>
      {loading
        ? <Spin />
        : (
          <Table
            rowKey="jobname"
            dataSource={data}
            columns={COLUMNS as never}
            pagination={{ pageSize: 50 }}
            data-testid="mp-cron-table"
          />
        )}
      <div style={{ marginTop: 8, fontSize: 12, color: 'var(--semi-color-text-2)' }}>
        共 {data.length} 条 cron job
      </div>
    </div>
  );
}
