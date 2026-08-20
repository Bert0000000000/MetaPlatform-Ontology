// tests/e2e/business-flows.spec.ts
// Playwright 端到端测试套件
// 配套：docs/active/prd/etl-validation.md §4.1.3 L3 端到端测试
// 跑：pnpm playwright test tests/e2e/business-flows.spec.ts

import { test, expect } from '@playwright/test';

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'test-anon-key';

test.describe('L3: 端到端业务校验（ETL 迁移后）', () => {

    test('L3.1 用户登录（密码迁移验证）', async ({ page }) => {
        await page.goto(`${SUPABASE_URL.replace('54321', '3000')}/login`);

        // 用 v3.0 导入的账号登录
        await page.fill('input[type="email"]', 'imported-user-1@example.com');
        await page.fill('input[type="password"]', 'original-v3-password');
        await page.click('button[type="submit"]');

        // 等待跳转
        await page.waitForURL(/\/dashboard/, { timeout: 10000 });

        // 验证 session 存在
        const cookies = await page.context().cookies();
        const sessionCookie = cookies.find(c => c.name.includes('auth-token'));
        expect(sessionCookie).toBeTruthy();
    });

    test('L3.2 跨租户访问被拒（RLS 生效）', async ({ page, request }) => {
        // 登录 tenant A
        const tenantA = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
            data: {
                email: 'tenant-a-user@example.com',
                password: 'original-v3-password'
            }
        });
        const tokenA = (await tenantA.json()).access_token;

        // 尝试查询 tenant B 的数据
        const response = await request.get(
            `${SUPABASE_URL}/rest/v1/orders?tenant_id=eq.<tenant-b-uuid>`,
            {
                headers: {
                    'Authorization': `Bearer ${tokenA}`,
                    'apikey': SUPABASE_ANON_KEY
                }
            }
        );

        expect(response.status()).toBe(200);

        const orders = await response.json();
        // RLS 应该过滤掉所有 tenant B 的数据
        expect(orders).toEqual([]);
    });

    test('L3.3 写数据 + audit_log 触发', async ({ page, request }) => {
        // 登录
        const auth = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
            data: {
                email: 'tenant-a-user@example.com',
                password: 'original-v3-password'
            }
        });
        const token = (await auth.json()).access_token;

        // 写一条订单
        const orderResp = await request.post(`${SUPABASE_URL}/rest/v1/orders`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'apikey': SUPABASE_ANON_KEY,
                'Content-Type': 'application/json',
                'Prefer': 'return=representation'
            },
            data: {
                tenant_id: '<my-tenant-uuid>',
                customer_id: '<my-customer-uuid>',
                amount: 100.00,
                status: 'pending'
            }
        });

        expect(orderResp.ok()).toBeTruthy();
        const order = await orderResp.json();

        // 验证 audit_log 有记录
        const auditResp = await request.get(
            `${SUPABASE_URL}/rest/v1/audit_log?row_pk->>id=eq.${order.id}`,
            {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'apikey': SUPABASE_ANON_KEY
                }
            }
        );

        const audits = await auditResp.json();
        expect(audits.length).toBeGreaterThan(0);
        expect(audits[0].action).toBe('INSERT');
        expect(audits[0].table_name).toBe('orders');
    });

    test('L3.4 切流量 feature flag 工作', async ({ request }) => {
        // 触发切流量
        const flagResp = await request.put(
            `${SUPABASE_URL}/rest/v1/mp_platform/feature_flags`,
            {
                headers: {
                    'Authorization': `Bearer ${SERVICE_KEY}`,
                    'apikey': SUPABASE_ANON_KEY,
                    'Content-Type': 'application/json'
                },
                data: {
                    tenant_id: '<my-tenant-uuid>',
                    key: 'migration.v6.completed',
                    value: true
                }
            }
        );

        expect(flagResp.ok()).toBeTruthy();

        // 验证 flag 生效（v3 兼容路径 vs v6 路径）
        // 假设应用通过 tenant.migration.completed 标志决定走哪个 handler

        // 1. flag = false 时走 v3 兼容路径（仅过渡期）
        await request.put(`${SUPABASE_URL}/rest/v1/mp_platform/feature_flags?...`, {
            // ... flag = false
        });

        const v3Resp = await request.get(`${SUPABASE_URL}/functions/v1/orders/list`, {
            headers: { 'Authorization': 'Bearer <tenant-token>' }
        });
        expect(v3Resp.headers()['x-source']).toBe('v3-legacy');

        // 2. flag = true 时走 v6 路径
        await request.put(`${SUPABASE_URL}/rest/v1/mp_platform/feature_flags?...`, {
            // ... flag = true
        });

        const v6Resp = await request.get(`${SUPABASE_URL}/functions/v1/orders/list`, {
            headers: { 'Authorization': 'Bearer <tenant-token>' }
        });
        expect(v6Resp.headers()['x-source']).toBe('v6');
    });
});

test.describe('L3: 数字员工（dsh）业务流', () => {

    test('数字员工 session 启动 + 简单对话', async ({ page }) => {
        // 登录到 mp-frontend
        await page.goto('https://app.mp-platform.local/login');
        await page.fill('input[type="email"]', 'user@example.com');
        await page.fill('input[type="password"]', 'password');
        await page.click('button[type="submit"]');
        await page.waitForURL(/\/dashboard/);

        // 进入数字员工
        await page.click('text=客服');
        await page.waitForURL(/.*\/agent\/customer-service/);

        // 输入消息
        await page.fill('textarea[name="message"]', '你好');
        await page.click('button[type="submit"]');

        // 等待响应
        await page.waitForSelector('[data-testid="agent-response"]', { timeout: 30000 });

        const responseText = await page.textContent('[data-testid="agent-response"]');
        expect(responseText).toBeTruthy();
    });

    test('数字员工 tool call', async ({ page }) => {
        // 类似上一步，但触发 tool call
        await page.fill('textarea[name="message"]', '查询最近的订单');
        await page.click('button[type="submit"]');

        // 等待 tool call UI 出现
        await page.waitForSelector('[data-testid="tool-call"]', { timeout: 30000 });

        const toolName = await page.textContent('[data-testid="tool-name"]');
        expect(toolName).toContain('search_orders');
    });
});

test.describe('L3: Workflow 业务流', () => {

    test('启动 + 监控 workflow', async ({ request }) => {
        // 启动
        const startResp = await request.post('https://api.mp-platform.local/workflow/v1/workflows/start', {
            headers: {
                'Authorization': 'Bearer <jwt>',
                'Content-Type': 'application/json'
            },
            data: {
                name: 'order-fulfillment',
                input: { orderId: 'test-123' },
                tenantId: '<tenant-uuid>'
            }
        });

        expect(startResp.ok()).toBeTruthy();
        const { workflowId } = await startResp.json();

        // 轮询状态
        let status = 'running';
        for (let i = 0; i < 60; i++) {
            const statusResp = await request.get(`https://api.mp-platform.local/workflow/v1/workflows/${workflowId}`, {
                headers: { 'Authorization': 'Bearer <jwt>' }
            });
            const data = await statusResp.json();
            status = data.status;

            if (status === 'completed' || status === 'failed') break;
            await page.waitForTimeout(1000);
        }

        expect(status).toBe('completed');
    });

    test('Workflow 长任务 + signal 交互', async ({ request }) => {
        const startResp = await request.post('https://api.mp-platform.local/workflow/v1/workflows/start', {
            headers: {
                'Authorization': 'Bearer <jwt>',
                'Content-Type': 'application/json'
            },
            data: {
                name: 'approval-workflow',
                input: { requestId: 'approval-123' },
                tenantId: '<tenant-uuid>'
            }
        });

        const { workflowId } = await startResp.json();

        // 等待 5 秒（模拟等待 signal）
        await page.waitForTimeout(5000);

        // 发 signal
        const signalResp = await request.post(`https://api.mp-platform.local/workflow/v1/workflows/${workflowId}/signal`, {
            headers: {
                'Authorization': 'Bearer <jwt>',
                'Content-Type': 'application/json'
            },
            data: {
                signal_name: 'approval_decision',
                args: { decision: 'approved' }
            }
        });

        expect(signalResp.ok()).toBeTruthy();
    });
});