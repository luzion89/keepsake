/**
 * settings.spec.ts
 * 验证 Settings 页在 375px 视口下 sticky 保存按钮不跑出屏幕。
 * boundingBox.bottom ≤ viewport.height
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 375, height: 667 } });

test.describe('Settings 页 sticky 保存按钮（#80 回归）', () => {
  test('sticky 保存按钮 bottom ≤ viewport height（375px）', async ({ page }) => {
    await page.goto('/settings');

    // 等页面加载完成
    await expect(page.locator('button:has-text("保存设置")')).toBeVisible();

    const saveBtn = page.locator('button:has-text("保存设置")');
    const box = await saveBtn.boundingBox();
    expect(box, '保存按钮应有可见 bounding box').not.toBeNull();

    const viewportHeight = 667;
    const btnBottom = box!.y + box!.height;

    // 底部 ≤ viewport 高度（允许 1px 误差）
    expect(
      btnBottom,
      `保存按钮 bottom (${btnBottom.toFixed(1)}) 超出视口高度 ${viewportHeight}`
    ).toBeLessThanOrEqual(viewportHeight + 1);
  });

  test('sticky 容器有 sticky bottom-0 样式', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.locator('button:has-text("保存设置")')).toBeVisible();

    // 验证页面中存在 sticky bottom-0 容器（nav + 保存按钮容器，至少 1 个含 sticky bottom-0）
    const stickyContainers = page.locator('.sticky.bottom-0');
    const count = await stickyContainers.count();
    expect(count, 'sticky bottom-0 容器数量应 ≥ 1').toBeGreaterThanOrEqual(1);
  });

  test('滚动到底部后保存按钮仍可见（sticky 有效）', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.locator('button:has-text("保存设置")')).toBeVisible();

    // 滚动到底部
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(100);

    const saveBtn = page.locator('button:has-text("保存设置")');
    await expect(saveBtn).toBeVisible();

    const box = await saveBtn.boundingBox();
    expect(box).not.toBeNull();
    const btnBottom = box!.y + box!.height;
    expect(btnBottom).toBeLessThanOrEqual(668); // 667 + 1px 误差
  });
});
