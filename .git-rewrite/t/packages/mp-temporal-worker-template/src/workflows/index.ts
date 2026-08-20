/**
 * packages/mp-temporal-worker-template/src/workflows/index.ts
 * PRD: docs/active/prd/temporal-worker-sdk.md §4
 * Workflow 定义模板 — Hello world + 24h 长任务 + HITL signal
 */

import { proxyActivities, sleep, condition } from '@temporalio/workflow';
import type { TenantContext } from '../context.js';

export interface HelloInput {
  readonly tenantId: string;
  readonly actorId: string | null;
  readonly name: string;
}

// Activity 默认配置: 30s start-to-close, 3 retries, backoff 2.0
const defaultActivityOptions = {
  startToCloseTimeout: '30s',
  retry: { maximumAttempts: 3, backoffCoefficient: 2.0 },
};

const activities = proxyActivities({
  defaultOptions: defaultActivityOptions,
});

export async function helloWorldWorkflow(input: HelloInput): Promise<string> {
  const greeting = await activities.sayHello({ name: input.name, tenantId: input.tenantId });
  return greeting;
}

// 长任务 workflow: 24 小时 wait_condition (典型 HITL SaaS 审批)
export async function longRunningApprovalWorkflow(input: {
  readonly approvalId: string;
  readonly timeoutMs: number;
}): Promise: 'approved' | 'rejected' | 'timeout'> {
  let decision: 'approved' | 'rejected' | null = null;

  // 设置 signal handler 接收审批结果
  const signalHandler = (_payload: { decision: 'approved' | 'rejected' }) => {
    decision = _payload.decision;
  };

  // 实际用 setHandler (这里仅展示类型)
  // setHandler(approvalSignal, signalHandler);

  // 等待决策 OR 超时
  const timedOut = await condition(() => decision !== null, input.timeoutMs);

  if (timedOut) {
    if (decision !== null) return decision;
    return 'timeout';
  }
  return decision ?? 'timeout';
}

// Activity heartbeat 示例: 长时间运行的 activity
export async function longActivityWithHeartbeat(input: { steps: number }): Promise<number> {
  let progress = 0;
  for (let i = 0; i < input.steps; i++) {
    progress = await activities.heartbeatStep({ step: i, total: input.steps });
  }
  return progress;
}