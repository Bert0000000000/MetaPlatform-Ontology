// src/components/Stat.tsx — simple Statistic shim (semi-ui v2.102 doesn't export Statistic)
import React from 'react';

export interface StatProps {
  title: React.ReactNode;
  value: number | string;
  valueStyle?: React.CSSProperties;
}

export interface StatTitleProps {
  style?: React.CSSProperties;
  children: React.ReactNode;
}

export default function Stat({ title, value, valueStyle }: StatProps) {
  return (
    <div style={{ textAlign: 'left' }}>
      <div style={{ color: 'var(--semi-color-text-2)', fontSize: 12, marginBottom: 4 }}>
        {title}
      </div>
      <div style={{
        fontSize: 28,
        fontWeight: 600,
        color: valueStyle?.color ?? 'var(--semi-color-text-0)',
        ...valueStyle,
      }}>
        {value}
      </div>
    </div>
  );
}

// compound API shim: <Stat.title>...</Stat.title>
Stat.title = function StatTitle({ style, children }: StatTitleProps) {
  return <div style={{ color: 'var(--semi-color-text-2)', fontSize: 12, ...style }}>{children}</div>;
};
