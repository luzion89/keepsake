/**
 * routes.spec.ts
 * 验证所有路由可访问不报错（不出现 React 错误边界 / 未处理崩溃）。
 * 对于需要 ID 的路由，先通过数据库操作获取真实 ID，确保路由能渲染。
 */
import { test, expect, type Page } from '@playwright/test';

/** 断言页面没有明显的错误状态（React error boundary 文字） */
async function expectNoError(page: Page) {
  // React 错误边界通常会显示这些文字
  await expect(page.locator('text=/Something went wrong/i')).toHaveCount(0);
  await expect(page.locator('text=/Uncaught Error/i')).toHaveCount(0);
  // 也不应该有 404 fallback redirect 到 / 以外的问题
}

test.describe('路由可访问性（#81 e2e 框架）', () => {
  test('/ — 首页加载正常', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL('/');
    // 首页有添加房间的输入框
    await expect(page.locator('input[placeholder*="房间名"]')).toBeVisible();
    await expectNoError(page);
  });

  test('/settings — 设置页加载正常', async ({ page }) => {
    await page.goto('/settings');
    await expect(page).toHaveURL('/settings');
    await expect(page.locator('button:has-text("保存设置")')).toBeVisible();
    await expectNoError(page);
  });

  test('/search — 搜索页加载正常', async ({ page }) => {
    await page.goto('/search');
    await expect(page).toHaveURL('/search');
    await expectNoError(page);
  });

  test('/rooms/:id — 有效房间页加载正常', async ({ page }) => {
    // 先创建房间取得 ID
    await page.goto('/');
    const roomName = `路由测试房_${Date.now()}`;
    await page.fill('input[placeholder*="房间名"]', roomName);
    await page.click('button:has-text("添加")');
    await page.click(`text=${roomName}`);
    await page.waitForURL(/\/rooms\//);

    await expect(page.locator('h1')).toContainText(roomName);
    await expectNoError(page);
  });

  test('/areas/:id — 有效区域页加载正常', async ({ page }) => {
    await page.goto('/');
    const roomName = `路由测试房2_${Date.now()}`;
    await page.fill('input[placeholder*="房间名"]', roomName);
    await page.click('button:has-text("添加")');
    await page.click(`text=${roomName}`);

    const areaName = `路由测试区_${Date.now()}`;
    await page.fill('input[placeholder*="区域名"]', areaName);
    await page.click('button:has-text("添加")');
    await page.click(`text=${areaName}`);
    await page.waitForURL(/\/areas\//);

    await expect(page.locator('h1')).toContainText(areaName);
    await expectNoError(page);
  });

  test('/areas/:id/text — 文字录入页加载正常', async ({ page }) => {
    await page.goto('/');
    const roomName = `路由测试房3_${Date.now()}`;
    await page.fill('input[placeholder*="房间名"]', roomName);
    await page.click('button:has-text("添加")');
    await page.click(`text=${roomName}`);

    const areaName = `路由测试区2_${Date.now()}`;
    await page.fill('input[placeholder*="区域名"]', areaName);
    await page.click('button:has-text("添加")');
    await page.click(`text=${areaName}`);
    await page.waitForURL(/\/areas\//);
    const areaId = page.url().split('/areas/')[1].replace(/\/.*$/, '');

    await page.goto(`/areas/${areaId}/text`);
    await expect(page).toHaveURL(new RegExp(`/areas/${areaId}/text`));
    await expect(page.locator('h1')).toContainText('文字录入');
    await expectNoError(page);
  });

  test('/areas/:id/capture — 拍照录入页加载正常', async ({ page }) => {
    await page.goto('/');
    const roomName = `路由测试房4_${Date.now()}`;
    await page.fill('input[placeholder*="房间名"]', roomName);
    await page.click('button:has-text("添加")');
    await page.click(`text=${roomName}`);

    const areaName = `路由测试区3_${Date.now()}`;
    await page.fill('input[placeholder*="区域名"]', areaName);
    await page.click('button:has-text("添加")');
    await page.click(`text=${areaName}`);
    await page.waitForURL(/\/areas\//);
    const areaId = page.url().split('/areas/')[1].replace(/\/.*$/, '');

    await page.goto(`/areas/${areaId}/capture`);
    await expect(page).toHaveURL(new RegExp(`/areas/${areaId}/capture`));
    await expectNoError(page);
  });

  test('/items/:id — 有效物品详情页加载正常', async ({ page }) => {
    await page.goto('/');
    const roomName = `路由测试房5_${Date.now()}`;
    await page.fill('input[placeholder*="房间名"]', roomName);
    await page.click('button:has-text("添加")');
    await page.click(`text=${roomName}`);

    const areaName = `路由测试区4_${Date.now()}`;
    await page.fill('input[placeholder*="区域名"]', areaName);
    await page.click('button:has-text("添加")');
    await page.click(`text=${areaName}`);
    await page.waitForURL(/\/areas\//);

    // 添加物品
    await page.click('button:has-text("手动添加")');
    const itemName = `路由测试物品_${Date.now()}`;
    await page.fill('input[placeholder="物品名"]', itemName);
    await page.getByRole('button', { name: '添加' }).last().click();
    await expect(page.locator(`text=${itemName}`).first()).toBeVisible();

    // 点进物品详情
    await page.click(`text=${itemName}`);
    await page.waitForURL(/\/items\//);
    await expectNoError(page);
  });

  test('未知路由 /xyz → 重定向到 /', async ({ page }) => {
    await page.goto('/this-route-does-not-exist');
    await expect(page).toHaveURL('/');
    await expectNoError(page);
  });
});
