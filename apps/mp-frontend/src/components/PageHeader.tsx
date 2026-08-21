// src/components/PageHeader.tsx — Semi Design 通用页头
import React from 'react';
import { Typography, Space, Button } from '@douyinfe/semi-ui';
import { IconRefresh } from '@douyinfe/semi-icons';

const { Title, Text } = Typography;

export interface PageHeaderProps {
  title: string;
  description?: string;
  onRefresh?: () => void;
  extra?: React.ReactNode;
}

export default function PageHeader({ title, description, onRefresh, extra }: PageHeaderProps) {
  return (
    <div style={{ marginBottom: 20 }}>
      <Space style={{ width: '100%', justifyContent: 'space-between' }}>
        <div>
          <Title heading={3} style={{ margin: 0 }}>{title}</Title>
          {description && (
            <Text type="tertiary" style={{ fontSize: 13, marginTop: 4, display: 'block' }}>
              {description}
            </Text>
          )}
        </div>
        <Space>
          {extra}
          {onRefresh && (
            <Button icon={<IconRefresh />} onClick={onRefresh}>
              刷新
            </Button>
          )}
        </Space>
      </Space>
    </div>
  );
}