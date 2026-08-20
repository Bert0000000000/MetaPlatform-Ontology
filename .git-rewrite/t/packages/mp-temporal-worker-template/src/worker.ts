/**
 * packages/mp-temporal-worker-template/src/worker.ts
 * PRD: docs/active/prd/temporal-worker-sdk.md §4.1
 * Temporal Worker 入口 — NativeConnection + TenantContext propagation
 */

import { Worker, NativeConnection } from '@temporalio/worker';
import { runWithContext, type TenantContext } from './context.js';

async function run(): Promise<void> {
  const address = process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';
  const namespace = process.env.TEMPORAL_NAMESPACE ?? 'mp-platform';
  const taskQueue = process.env.TEMPORAL_TASK_QUEUE ?? 'mp-default';

  console.info(`[worker] connecting to ${address}/${namespace} queue=${taskQueue}`);

  const connection = await NativeConnection.create({ address });

  const worker = await Worker.create({
    connection,
    namespace,
    taskQueue,
    workflowsPath: require.resolve('./workflows/index.js'),
    activities: {
      sayHello: async (input) => runWithContext(
        { tenantId: input.tenantId, actorId: null, roles: [] },
        () => import('./activities/index.js').then((m) => m.sayHello(input)),
      ),
      heartbeatStep: async (input) => runWithContext(
        { tenantId: 'unknown', actorId: null, roles: [] },
        () => import('./activities/index.js').then((m) => m.heartbeatStep(input)),
      ),
      dbRead: async (input) => runWithContext(
        { tenantId: 'unknown', actorId: null, roles: [] },
        () => import('./activities/index.js').then((m) => m.dbRead(input)),
      ),
      dbWrite: async (input) => runWithContext(
        { tenantId: 'unknown', actorId: null, roles: [] },
        () => import('./activities/index.js').then((m) => m.dbWrite(input)),
      ),
      approvalRequest: async (input) => runWithContext(
        { tenantId: input.tenantId, actorId: null, roles: [] },
        () => import('./activities/index.js').then((m) => m.approvalRequest(input)),
      ),
    },
    maxConcurrentActivityTaskExecutions: 100,
    maxConcurrentWorkflowTaskExecutions: 50,
  });

  console.info(`[worker] started, polling ${taskQueue}`);
  await worker.run();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((err) => {
    console.error('[worker] fatal:', err);
    process.exit(1);
  });
}

export { run };