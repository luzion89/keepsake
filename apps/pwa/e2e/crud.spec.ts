/**
 * crud.spec.ts
 * 端到端 CRUD 流程：新建房间 → 进入 → 新建区域 → 进入 → 手动添加物品 → 详情页改 expires_at + notes → 删除
 *
 * 注意：v3.1 重构后 Home/Room 页改用 FAB 添加表单，不再有常驻 input。
 * 操作流程：点 FAB → 展开 form → 填写 → 提交。
 */
import { test, expect } from '@playwright/test';

/** 打开 FAB 并添加条目 */
async function addViaFab(page: import('@playwright/test').Page, placeholder: string, value: string) {
  // 点开 FAB
  await page.locator('[aria-label="添加房间"], [aria-label="添加区域"]').last().click();
  await page.waitForTimeout(100);
  await page.fill(`input[placeholder*="${placeholder}"]`, value);
  await page.locator('button:has-text("添加")').last().click();
  await page.waitForTimeout(200);
}

test.describe('CRUD 全流程', () => {
  test('新建房间 → 区域 → 物品 → 编辑 → 删除', async ({ page }) => {
    await page.goto('/');

    // ── 1. 新建房间（via FAB）──────────────────────────────────
    const roomName = `测试房间_${Date.now()}`;
    await addViaFab(page, '房间名', roomName);

    // 房间出现在列表
    await expect(page.locator(`text=${roomName}`).first()).toBeVisible();

    // ── 2. 进入房间页 ─────────────────────────────────────────
    await page.click(`text=${roomName}`);
    await expect(page).toHaveURL(/\/rooms\//);
    // 新版本用 nav breadcrumb 显示房间名（不是 h1）
    await expect(page.locator(`text=${roomName}`).first()).toBeVisible();

    // ── 3. 新建区域（via FAB）──────────────────────────────────
    const areaName = `测试区域_${Date.now()}`;
    await addViaFab(page, '区域名', areaName);

    await expect(page.locator(`text=${areaName}`).first()).toBeVisible();

    // ── 4. 进入区域页 ─────────────────────────────────────────
    await page.click(`text=${areaName}`);
    await expect(page).toHaveURL(/\/areas\//);
    await expect(page.locator(`text=${areaName}`).first()).toBeVisible();

    // ── 5. 展开「手动添加」并添加物品 ─────────────────────────
    await page.click('button:has-text("手动添加")');
    const itemName = `胶水_${Date.now()}`;
    await page.fill('input[placeholder="物品名"]', itemName);
    // 手动添加容器内的「添加」按钮是同类中最后一个
    await page.getByRole('button', { name: '添加' }).last().click();

    // 物品出现在列表
    await expect(page.locator(`text=${itemName}`).first()).toBeVisible();

    // ── 6. 进入物品详情 ───────────────────────────────────────
    await page.click(`text=${itemName}`);
    await expect(page).toHaveURL(/\/items\//);

    // ── 7. 编辑 expires_at + notes ───────────────────────────
    await page.click('button:has-text("编辑")');
    await page.fill('input[type="date"]', '2027-12-31');
    await page.fill('textarea', '这是备注');
    await page.click('button:has-text("保存")');

    await expect(page.locator('text=2027').first()).toBeVisible();
    await expect(page.locator('text=这是备注')).toBeVisible();

    // ── 8. 删除物品 ───────────────────────────────────────────
    await page.click('button:has-text("删除")');
    // 确认弹窗 —— 点 rose-600 confirm 按钮（ConfirmDialog 的确定键）
    await page.locator('.bg-rose-600').click();

    // 应跳回区域页
    await expect(page).toHaveURL(/\/areas\//);
    await expect(page.locator(`text=${itemName}`)).toHaveCount(0);
  });
});
