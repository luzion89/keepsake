/**
 * area-entry.spec.ts
 * Area 页入口按钮验证：
 *   - 「📝 录入物品」按钮存在
 *   - 「📷 区域照片」按钮存在
 *   - 不存在「语音输入」按钮（该功能已下线/重定向）
 */
import { test, expect } from '@playwright/test';

/** 快速建房间 + 区域，返回 Area 页 URL */
async function createAreaAndNavigate(page: import('@playwright/test').Page): Promise<string> {
  await page.goto('/');

  const roomName = `Area入口测试_${Date.now()}`;
  await page.fill('input[placeholder*="房间名"]', roomName);
  await page.click('button:has-text("添加")');
  await page.click(`text=${roomName}`);

  const areaName = `入口测试区_${Date.now()}`;
  await page.fill('input[placeholder*="区域名"]', areaName);
  await page.click('button:has-text("添加")');
  await page.click(`text=${areaName}`);
  await page.waitForURL(/\/areas\//);

  return page.url();
}

test.describe('Area 页入口断言', () => {
  test('录入物品 & 区域照片 按钮可见', async ({ page }) => {
    await createAreaAndNavigate(page);
    await expect(page.locator('a:has-text("📝 录入物品")')).toBeVisible();
    await expect(page.locator('a:has-text("📷 区域照片")')).toBeVisible();
  });

  test('「语音输入」按钮不存在', async ({ page }) => {
    await createAreaAndNavigate(page);
    // 语音入口已移除，不应出现任何"语音输入"文字
    await expect(page.locator('text=语音输入')).toHaveCount(0);
  });
});
