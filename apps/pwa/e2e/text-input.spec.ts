/**
 * text-input.spec.ts
 * 专门防 bug #77 复发：从 Area 页点「📝 录入物品」必须跳到 /areas/<id>/text，不能回首页。
 *
 * 注意：v3.1 重构后 Home/Room 页改用 FAB 添加表单。
 */
import { test, expect } from '@playwright/test';

async function addViaFab(page: import('@playwright/test').Page, ariaLabel: string, placeholder: string, value: string) {
  await page.locator(`[aria-label="${ariaLabel}"]`).click();
  await page.waitForTimeout(100);
  await page.fill(`input[placeholder*="${placeholder}"]`, value);
  await page.locator('button:has-text("添加")').last().click();
  await page.waitForTimeout(200);
}

test.describe('文字录入路由跳转（#77 回归）', () => {
  test('点「📝 录入物品」跳到 /areas/:id/text 而非首页', async ({ page }) => {
    await page.goto('/');

    const roomName = `路由测试房_${Date.now()}`;
    await addViaFab(page, '添加房间', '房间名', roomName);
    await expect(page.locator(`text=${roomName}`).first()).toBeVisible();

    await page.click(`text=${roomName}`);
    await expect(page).toHaveURL(/\/rooms\//);

    const areaName = `路由测试区_${Date.now()}`;
    await addViaFab(page, '添加区域', '区域名', areaName);
    await expect(page.locator(`text=${areaName}`).first()).toBeVisible();

    await page.click(`text=${areaName}`);
    await expect(page).toHaveURL(/\/areas\//);

    const areaId = page.url().split('/areas/')[1].replace(/\/.*$/, '');
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
