/**
 * text-input.spec.ts
 * 专门防 bug #77 复发：从 Area 页点「📝 录入物品」必须跳到 /areas/<id>/text，不能回首页。
 */
import { test, expect } from '@playwright/test';

test.describe('文字录入路由跳转（#77 回归）', () => {
  test('点「📝 录入物品」跳到 /areas/:id/text 而非首页', async ({ page }) => {
    // ── 前置：快速建一个房间 + 区域 ─────────────────────────
    await page.goto('/');

    const roomName = `路由测试房_${Date.now()}`;
    await page.fill('input[placeholder*="房间名"]', roomName);
    await page.click('button:has-text("添加")');
    await expect(page.locator(`text=${roomName}`).first()).toBeVisible();

    await page.click(`text=${roomName}`);
    await expect(page).toHaveURL(/\/rooms\//);

    const areaName = `路由测试区_${Date.now()}`;
    await page.fill('input[placeholder*="区域名"]', areaName);
    await page.click('button:has-text("添加")');
    await expect(page.locator(`text=${areaName}`).first()).toBeVisible();

    await page.click(`text=${areaName}`);
    await expect(page).toHaveURL(/\/areas\//);

    // 取出 areaId
    const areaUrl = page.url();
    const areaId = areaUrl.split('/areas/')[1].replace(/\/.*$/, '');
    expect(areaId).toBeTruthy();

    // ── 核心断言：点「📝 录入物品」─────────────────────────────
    await page.click('a:has-text("📝 录入物品")');

    // URL 必须是 /areas/<id>/text
    await expect(page).toHaveURL(new RegExp(`/areas/${areaId}/text`));

    // 绝对不能是首页
    expect(page.url()).not.toMatch(/^http:\/\/[^/]+\/?$/);
    expect(page.url()).not.toMatch(/^http:\/\/[^/]+\/#?\/?$/);
  });
});
