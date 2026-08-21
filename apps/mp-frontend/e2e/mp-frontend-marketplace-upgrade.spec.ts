// e2e/mp-frontend-marketplace-upgrade.spec.ts — M05 mp-skill-marketplace 升级视图 E2E
import { test, expect } from '@playwright/test';

test.describe('mp-frontend /admin/marketplace 升级视图', () => {
  test('1. ?upgrading=true 触发全屏升级视图 (Hero + 5 阶段 + 进度条 + ETA)', async ({ page }) => {
    await page.goto('/admin/marketplace?upgrading=true');
    await expect(page).toHaveURL(/upgrading=true/);

    // 1.1 PageHeader 显示升级维护描述
    await expect(page.locator('text=数字员工 (dsh preset) 市场 · 升级维护中').first()).toBeVisible();

    // 1.2 维护通知 Banner
    await expect(page.locator('text=维护通知').first()).toBeVisible();
    await expect(page.locator('text=v2.0 schema').first()).toBeVisible();

    // 1.3 Hero 标题
    await expect(page.locator('h2:has-text("Marketplace 正在升级中")').first()).toBeVisible();

    // 1.4 5 阶段 — 每阶段都有 data-stage 属性
    const stages = ['backup', 'migrate', 'verify', 'edge', 'done'];
    for (const s of stages) {
      await expect(page.locator(`[data-stage="${s}"]`).first()).toBeVisible();
    }

    // 1.5 阶段标题
    await expect(page.locator('text=备份数据').first()).toBeVisible();
    await expect(page.locator('text=迁移 schema').first()).toBeVisible();
    await expect(page.locator('text=验证数据').first()).toBeVisible();
    await expect(page.locator('text=更新 Edge Functions').first()).toBeVisible();
    await expect(page.locator('text=完成').first()).toBeVisible();

    // 1.6 进度条 (semi Progress)
    await expect(page.locator('[role="progressbar"]').first()).toBeVisible();

    // 1.7 ETA + 预计完成
    await expect(page.locator('text=预计剩余').first()).toBeVisible();
    await expect(page.locator('text=预计完成').first()).toBeVisible();

    // 1.8 实时指标 Stat
    await expect(page.locator('text=已迁移 preset').first()).toBeVisible();
    await expect(page.locator('text=已重写 Edge Function').first()).toBeVisible();
    await expect(page.locator('text=checksum 通过率').first()).toBeVisible();
    await expect(page.locator('text=RLS 策略重建').first()).toBeVisible();

    // 1.9 推荐操作按钮
    await expect(page.locator('text=返回 Dashboard').first()).toBeVisible();
    await expect(page.locator('text=查看升级 audit').first()).toBeVisible();

    // 1.10 倒计时格式 HH:MM:SS — 用正则匹配 ETA 块内
    await expect(page.locator('text=/\\d{2}:\\d{2}:\\d{2}/').first()).toBeVisible();
  });

  test('2. 阶段状态标记 (至少 1 个 done + 1 个 pending)', async ({ page }) => {
    await page.goto('/admin/marketplace?upgrading=true');

    // 等待 hydration 完成
    await page.waitForSelector('[data-stage]');

    const doneCount = await page.locator('[data-stage-status="done"]').count();
    const pendingCount = await page.locator('[data-stage-status="pending"]').count();
    const runningCount = await page.locator('[data-stage-status="running"]').count();

    expect(doneCount).toBeGreaterThanOrEqual(1);
    expect(pendingCount).toBeGreaterThanOrEqual(1);
    expect(runningCount).toBeGreaterThanOrEqual(1);
    expect(doneCount + runningCount + pendingCount).toBe(5);
  });

  test('3. ?upgrading=false 回退到非升级视图 (loading 或 Table)', async ({ page }) => {
    await page.goto('/admin/marketplace?upgrading=false');
    await expect(page).not.toHaveURL(/upgrading=true/);
    // 升级视图标题不应出现
    await expect(page.locator('h2:has-text("Marketplace 正在升级中")')).toHaveCount(0);
    // 维护通知 Banner 也不应出现
    await expect(page.locator('text=维护通知').first()).toHaveCount(0);
  });

  test('4. 倒计时实时跳变 (间隔 1.5s 抓 2 次, 值不同)', async ({ page }) => {
    await page.goto('/admin/marketplace?upgrading=true');
    await page.waitForSelector('text=预计剩余');

    const t1 = await page.locator('text=预计剩余').first().locator('xpath=following-sibling::*[1]').textContent();
    await page.waitForTimeout(1600);
    const t2 = await page.locator('text=预计剩余').first().locator('xpath=following-sibling::*[1]').textContent();

    expect(t1).not.toEqual(t2);
  });
});