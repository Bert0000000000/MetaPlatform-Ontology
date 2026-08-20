/**
 * tests/edge/ticket_triage.test.ts
 *
 * Verifies ticket-triage heuristic logic (keyword matching).
 */

import { describe, it, expect } from 'vitest';

function triagePriority(title: string, description: string): 'urgent' | 'high' | 'normal' | 'low' {
  const urgentKeywords = ['紧急', 'urgent', '崩溃', 'crash', '宕机', 'down', '无法', '数据丢失'];
  const highKeywords = ['报错', 'error', '失败', 'failed', '异常', 'abnormal'];
  const text = (title + ' ' + description).toLowerCase();

  if (urgentKeywords.some((k) => text.includes(k.toLowerCase()))) return 'urgent';
  if (highKeywords.some((k) => text.includes(k.toLowerCase()))) return 'high';
  return 'normal';
}

describe(t('ticket-triage heuristic'), () => {
  it('detects urgent keywords (崩溃 / down)', () => {
    expect(triagePriority('服务宕机', '生产环境 down')).toBe('urgent');
    expect(triagePriority('Critical Bug', 'system crash detected')).toBe('urgent');
  });

  it('detects high keywords (error / failed)', () => {
    expect(triagePriority('登录失败', '用户报 error')).toBe('high');
    expect(triagePriority('API timeout', 'request failed abnormal response')).toBe('high');
  });

  it('defaults to normal for benign titles', () => {
    expect(triagePriority('功能咨询', '想了解新功能')).toBe('normal');
    expect(triagePriority('How to use', 'please help with feature X')).toBe('normal');
  });
});