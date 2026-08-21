// src/components/StatCard.tsx — Semi Design Statistic card
import React from 'react';
import { Card, Statistic } from '@douyinfe/semi-ui';

export interface StatCardProps {
  title: string;
  value: number | string;
  description?: string;
  color?: 'primary' | 'success' | 'warning' | 'danger';
}

export default function StatCard({ title, value, description, color }: StatCardProps) {
  return (
    <Card>
      <Statistic.title style={{ color: 'var(--semi-color-text-2)', fontSize: 12 }}>
        {title}
      </Statistic.title>
      <div style={{ marginTop: 8 }}>
        <Statistic
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