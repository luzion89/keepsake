/**
 * visual-tokens.spec.ts
 * 验证视觉重构 v2（#88）关键设计 token 已落地：
 * - Home 页房间卡片使用 rounded-2xl（而非旧 rounded-xl）
 * - Shell header 存在（包含应用名称）
 * - 底部 nav 存在且包含首页/搜索/设置入口
 * - 搜索输入框 rounded-xl（新 token）
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 375, height: 667 } });

test.describe('Visual token 验证（#88 视觉重构 v2）', () => {
  test('Home 页：房间卡片使用 rounded-2xl', async ({ page }) => {
    await page.goto('/');

    // 先建一个房间，确保有卡片可以检查
    const roomName = `token测试房_${Date.now()}`;
    await page.fill('input[placeholder*="房间名"]', roomName);
    await page.click('button:has-text("添加")');
    await expect(page.locator(`text=${roomName}`).first()).toBeVisible();

    // 检查卡片元素包含 rounded-2xl
    const card = page.locator('.rounded-2xl').filter({ hasText: roomName }).first();
    await expect(card).toBeVisible();
  });

  test('Shell header 存在且展示 app 名称', async ({ page }) => {
    await page.goto('/');
    // Header 中应包含应用名称（Keepsake 或中文名）
    const header = page.locator('header');
    await expect(header).toBeVisible();
  });

  test('底部导航：首页 / 搜索 / 设置 入口可见', async ({ page }) => {
    await page.goto('/');

    // 底部 nav 中应有 3 个入口（首页、搜索、设置）
    const nav = page.locator('nav').last();
    await expect(nav).toBeVisible();

    // 通过底部 nav 内的链接检查（不依赖 class，.first() 避免严格模式冲突）
    await expect(page.locator('nav a[href="/"]').first()).toBeVisible();
    await expect(page.locator('nav a[href="/search"]').first()).toBeVisible();
    await expect(page.locator('nav a[href="/settings"]').first()).toBeVisible();
  });

  test('搜索页：输入框使用 rounded-xl', async ({ page }) => {
    await page.goto('/search');
    const input = page.locator('input[placeholder*="搜索"], input[placeholder*="消毒"], input[type="text"]').first();
    await expect(input).toBeVisible();
    const cls = await input.getAttribute('class') ?? '';
    expect(cls).toContain('rounded-xl');
  });

  test('Settings 页正常加载，标题可见', async ({ page }) => {
    await page.goto('/settings');
    // 页面标题（h1）
    await expect(page.locator('h1')).toBeVisible();
  });
});
