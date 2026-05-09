/**
 * mobile-layout.spec.ts
 * 专门防 bug #76 复发：在 375px 移动端视口下，Room 页 + Area 页「手动添加」区的
 * 所有按钮都必须在容器边界内（button.right <= container.right，误差 ≤ 1px）。
 *
 * 注意：v3.1 重构后 Home/Room 页改用 FAB 添加表单。
 */
import { test, expect } from '@playwright/test';

// 所有测试在 375px 宽度下运行
test.use({ viewport: { width: 375, height: 667 } });

async function addViaFab(page: import('@playwright/test').Page, ariaLabel: string, placeholder: string, value: string) {
  await page.locator(`[aria-label="${ariaLabel}"]`).click();
  await page.waitForTimeout(100);
  await page.fill(`input[placeholder*="${placeholder}"]`, value);
  await page.locator('button:has-text("添加")').last().click();
  await page.waitForTimeout(200);
}

test.describe('移动端布局不溢出（#76 回归）', () => {
  /** 辅助：断言某容器内所有 button 的右边界都未超出容器 */
  async function assertNoButtonOverflow(page: import('@playwright/test').Page, containerSelector: string) {
    const container = page.locator(containerSelector).first();
    await expect(container).toBeVisible();

    const containerBox = await container.boundingBox();
    expect(containerBox).not.toBeNull();
    const containerRight = containerBox!.x + containerBox!.width;

    const buttons = container.locator('button, a[role="button"], a.rounded-\\[12px\\], a.rounded-xl, a.rounded-2xl');
    const count = await buttons.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const btn = buttons.nth(i);
      const box = await btn.boundingBox();
      if (!box) continue; // 隐藏元素跳过
      const btnRight = box.x + box.width;
      // 允许 1px 的亚像素误差
      expect(btnRight, `按钮 #${i} 右边 ${btnRight.toFixed(1)} 超出容器 ${containerRight.toFixed(1)}`).toBeLessThanOrEqual(
        containerRight + 1
      );
    }
  }

  test('Room 页区域列表 section 按钮不溢出', async ({ page }) => {
    await page.goto('/');

    const roomName = `布局测试房_${Date.now()}`;
    await addViaFab(page, '添加房间', '房间名', roomName);
    await page.click(`text=${roomName}`);
    await expect(page).toHaveURL(/\/rooms\//);

    // 先添加一个区域以显示列表
    const areaName = `布局测试区_${Date.now()}`;
    await addViaFab(page, '添加区域', '区域名', areaName);

    // 检查区域列表 section 内按钮不溢出
    await assertNoButtonOverflow(page, 'section');
  });

  test('Area 页入口按钮（录入物品 / 区域照片）不溢出', async ({ page }) => {
    await page.goto('/');

    const roomName = `布局测试房2_${Date.now()}`;
    await addViaFab(page, '添加房间', '房间名', roomName);
    await page.click(`text=${roomName}`);
    await page.waitForURL(/\/rooms\//);

    const areaName = `布局测试区_${Date.now()}`;
    await addViaFab(page, '添加区域', '区域名', areaName);
    await page.click(`text=${areaName}`);
    await expect(page).toHaveURL(/\/areas\//);

    // 检查入口 section（录入物品 + 区域照片）
    await assertNoButtonOverflow(page, 'section');
  });

  test('Area 页「手动添加」展开后按钮不溢出', async ({ page }) => {
    await page.goto('/');

    const roomName = `布局测试房3_${Date.now()}`;
    await addViaFab(page, '添加房间', '房间名', roomName);
    await page.click(`text=${roomName}`);
    await page.waitForURL(/\/rooms\//);

    const areaName = `布局测试区2_${Date.now()}`;
    await addViaFab(page, '添加区域', '区域名', areaName);
    await page.click(`text=${areaName}`);
    await expect(page).toHaveURL(/\/areas\//);

    // 展开手动添加
    await page.click('button:has-text("手动添加")');
    // 等待展开动画
    await page.waitForTimeout(200);

    // 检查手动添加的输入框和按钮容器（v3 使用 bg-paper-card）
    const manualSection = page.locator('.bg-paper-card').filter({ has: page.locator('input[placeholder="物品名"]') }).first();
    await expect(manualSection).toBeVisible();

    const manualBox = await manualSection.boundingBox();
    expect(manualBox).not.toBeNull();
    const containerRight = manualBox!.x + manualBox!.width;

    const buttons = manualSection.locator('button');
    const count = await buttons.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const box = await buttons.nth(i).boundingBox();
      if (!box) continue;
      const btnRight = box.x + box.width;
      expect(btnRight, `手动添加 按钮 #${i} 右边 ${btnRight.toFixed(1)} 超出容器 ${containerRight.toFixed(1)}`).toBeLessThanOrEqual(
        containerRight + 1
      );
    }
  });
});
