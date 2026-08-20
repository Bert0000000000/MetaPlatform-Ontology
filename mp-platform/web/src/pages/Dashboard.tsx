// src/pages/Dashboard.tsx
// 6 stat cards: Tenants / Users / Audit (24h) / Installs / Presets / Cron Jobs

import { useEffect, useState } from 'react';
import { Spin, Card, Banner } from '@douyinfe/semi-ui';
import { Api } from '@/api/client';

interface Stats {
  tenants: number; users: number; audits24h: number;
  installs: number; presets: number; cron: number;
}

const STAT_DEFS: Array<{ key: keyof Stats; title: string; subtitle: string; tone: string }> = [
  { key: 'tenants',   title: 'Tenants',    subtitle: '当前租户数',         tone: 'blue' },
  { key: 'users',     title: 'Auth Users', subtitle: 'GoTrue 注册用户',     tone: 'green' },
  { key: 'audits24h', title: 'Audit 24h',  subtitle: '最近 24 小时审计',    tone: 'orange' },
  { key: 'installs',  title: 'Installs',   subtitle: '活跃 preset 安装',   tone: 'purple' },
  { key: 'presets',   title: 'Presets',    subtitle: 'preset 仓库条目',    tone: 'cyan' },
  { key: 'cron',      title: 'Cron Jobs',  subtitle: '活跃 pg_cron 任务',  tone: 'red' },
];

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Api.stats().then(setStats).catch((e) => setError(String(e?.message ?? e)));
  }, []);

  if (error) return <Banner type="danger" title="加载 Dashboard 失败" description={error} />;
  if (!stats) return <Spin size="large" />;

  return (
    <div data-testid="mp-dashboard">
      <h2 style={{ marginTop: 0 }}>Dashboard</h2>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 16,
          width: '100%',
        }}
      >
        {STAT_DEFS.map((d) => (
          <div
            key={d.key}
            data-testid={`mp-stat-card-${d.key}`}
          >
            <Card title={d.title} headerLine={false} style={{ width: '100%' }}>
              <div
                style={{ fontSize: 32, fontWeight: 600, color: 'var(--semi-color-primary)' }}
                data-testid={`mp-stat-value-${d.key}`}
              >
                {stats[d.key].toLocaleString()}
              </div>
              <div style={{ fontSize: 13, color: 'var(--semi-color-text-2)' }}>{d.subtitle}</div>
            </Card>
          </div>
        ))}
      </div>
    </div>
  );
}
