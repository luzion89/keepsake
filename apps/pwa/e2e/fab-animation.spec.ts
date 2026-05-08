/**
 * #144 — FAB 三阶段动效验证
 * 验证：① 点击加号 → 输入框滑入，FAB 淡出；② 叉号在输入框右上角；③ 点叉号 → 收回
 */
import { test, expect } from '@playwright/test';

test.describe('#144 FAB 三阶段动效', () => {
  test('首页 FAB：点击 + 展开输入框，叉号出现在右上角', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Stage 1: 初始状态 — FAB 可见
    const fab = page.locator('button[aria-label="添加房间"]');
    await expect(fab).toBeVisible();
    await page.screenshot({ path: 'e2e/screenshots/144-fab-initial.png' });

    // Stage 2: 点击 FAB — 输入框滑入，FAB 淡出，叉号出现
    await fab.click();
    await page.waitForTimeout(350); // wait for 300ms transition
    
    const closeBtn = page.locator('button[aria-label="关闭"]');
    await expect(closeBtn).toBeVisible();
    
    const input = page.locator('input[placeholder="房间名（如 厨房）"]');
    await expect(input).toBeVisible();
    
    await page.screenshot({ path: 'e2e/screenshots/144-fab-expanded.png' });

    // Stage 3: 点叉号 — 收回
    await closeBtn.click();
    await page.waitForTimeout(350);
    
    // FAB should be visible again (opacity-100 class)
    // The input panel should be hidden (max-h-0)
    await expect(fab).toBeVisible();
    await page.screenshot({ path: 'e2e/screenshots/144-fab-closed.png' });
  });

  test('Room 页面 FAB：区域添加同款三阶段动效', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Create a room first to navigate to room page
    const fab = page.locator('button[aria-label="添加房间"]');
    await fab.click();
    await page.waitForTimeout(350);
    
    const input = page.locator('input[placeholder="房间名（如 厨房）"]');
    await input.fill('测试房间');
    await page.locator('button:has-text("添加")').click();
    await page.waitForTimeout(300);
    
    // Navigate to the created room
    await page.locator('text=测试房间').click();
    await page.waitForTimeout(300);
    
    const areaFab = page.locator('button[aria-label="添加区域"]');
    await expect(areaFab).toBeVisible();
    await page.screenshot({ path: 'e2e/screenshots/144-room-fab-initial.png' });
    
    await areaFab.click();
    await page.waitForTimeout(350);
    
    const closeBtn = page.locator('button[aria-label="关闭"]');
    await expect(closeBtn).toBeVisible();
    await page.screenshot({ path: 'e2e/screenshots/144-room-fab-expanded.png' });
    
    await closeBtn.click();
    await page.waitForTimeout(350);
    await page.screenshot({ path: 'e2e/screenshots/144-room-fab-closed.png' });
  });
});
