// src/components/StatCard.tsx — Semi Design Statistic card
import React from 'react';
import { Card } from '@douyinfe/semi-ui';
import Stat from './Stat';

export interface StatCardProps {
  title: string;
  value: number | string;
  description?: string;
  color?: 'primary' | 'success' | 'warning' | 'danger';
}

export default function StatCard({ title, value, description, color }: StatCardProps) {
  return (
    <Card>
      <Stat.title style={{ color: 'var(--semi-color-text-2)', fontSize: 12 }}>
        {title}
      </Stat.title>
      <div style={{ marginTop: 8 }}>
        <Stat
          value={value}
          valueStyle={{
            color: color ? `var(--semi-color-${color})` : undefined,
            fontSize: 28,
            fontWeight: 600,
          }}
        />
      </div>
      {description && (
        <div style={{ fontSize: 11, color: 'var(--semi-color-text-2)', marginTop: 4 }}>
          {description}
        </div>
      )}
    </Card>
  );
}
