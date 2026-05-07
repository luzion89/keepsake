/**
 * text-input-modes.spec.ts
 * 测试 TextInput 页的 mode toggle（增改/覆盖）、replace 模式的 confirm 弹窗行为。
 * AI 调用通过拦截网络请求 mock 掉，避免真实 API 调用。
 */
import { test, expect, type Page } from '@playwright/test';

/** 快速建房间 + 区域，进入 /areas/:id/text 页，返回 areaId */
async function goToTextInput(page: Page): Promise<string> {
  await page.goto('/');

  const roomName = `TextModes房_${Date.now()}`;
  await page.fill('input[placeholder*="房间名"]', roomName);
  await page.click('button:has-text("添加")');
  await page.click(`text=${roomName}`);

  const areaName = `TextModes区_${Date.now()}`;
  await page.fill('input[placeholder*="区域名"]', areaName);
  await page.click('button:has-text("添加")');
  await page.click(`text=${areaName}`);
  await page.waitForURL(/\/areas\//);

  const areaId = page.url().split('/areas/')[1].replace(/\/.*$/, '');

  await page.click('a:has-text("📝 录入物品")');
  await page.waitForURL(/\/areas\/.*\/text/);

  return areaId;
}

/**
 * 向 Dexie kv 写入 AI on 配置，mock AI 网络请求，触发解析，
 * 使页面进入 parsed=true 状态。
 * @param itemsJson - AI 返回的 items 数组
 * @param mode - 触发解析后切换到的模式（默认 merge）
 */
async function setupAiAndParse(
  page: Page,
  itemsJson: Array<{ name: string; qty: number; expires_at: null; notes: string }>,
  mode: 'merge' | 'replace' = 'merge'
): Promise<void> {
  const mockBody = JSON.stringify({
    choices: [{
      message: {
        content: JSON.stringify({ items: itemsJson })
      }
    }]
  });

  // 拦截 AI API 请求
  await page.route('**/openrouter.ai/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: mockBody })
  );
  await page.route('**/api.deepseek.com/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: mockBody })
  );

  // 写入 Dexie kv: { key, value } 格式，DB 名 'keepsake'
  await page.evaluate(() => {
    return new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('keepsake');
      req.onsuccess = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains('kv')) { resolve(); return; }
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put({
          key: 'ai_config',
          value: { mode: 'on', provider: 'openrouter', apiKey: 'sk-test-mock', model: 'google/gemini-2.5-flash-lite' }
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  });

  // 刷新让配置生效
  await page.reload();
  await page.waitForURL(/\/areas\/.*\/text/);

  // 如需 replace 模式，先切换
  if (mode === 'replace') {
    await page.click('button:has-text("覆盖模式")');
    await expect(page.locator('button:has-text("覆盖模式")')).toHaveClass(/bg-amber-600/);
  }

  // 填入文字并触发解析
  await page.fill('textarea[placeholder*="两瓶消毒水"]', '测试物品');
  await page.click('button:has-text("解析")');
  // 等待草稿出现
  await expect(page.locator('text=草稿')).toBeVisible({ timeout: 10000 });
}

test.describe('TextInput 模式切换 (#78)', () => {
  test('默认进入页面是增改模式（sky 背景）', async ({ page }) => {
    await goToTextInput(page);
    const mergeBtn = page.locator('button:has-text("增改模式")');
    await expect(mergeBtn).toBeVisible();
    // PR-C 重构后：增改模式 active 使用 bg-slate-700（neutral dark），覆盖模式 active 使用 bg-amber-600/80
    await expect(mergeBtn).toHaveClass(/bg-slate-700/);
    await expect(page.locator('button:has-text("覆盖模式")')).not.toHaveClass(/bg-amber-600/);
  });

  test('点「覆盖模式」→ amber 背景激活，hint 含"将清空"', async ({ page }) => {
    await goToTextInput(page);
    await page.click('button:has-text("覆盖模式")');

    await expect(page.locator('button:has-text("覆盖模式")')).toHaveClass(/bg-amber-600/);
    await expect(page.locator('button:has-text("增改模式")')).not.toHaveClass(/bg-slate-700/);
    await expect(page.locator('text=/将清空该区域所有/')).toBeVisible();
  });

  test('覆盖模式再切回增改模式 → sky 激活', async ({ page }) => {
    await goToTextInput(page);
    await page.click('button:has-text("覆盖模式")');
    await page.click('button:has-text("增改模式")');
    // PR-C 重构后：增改模式 active = bg-slate-700
    await expect(page.locator('button:has-text("增改模式")')).toHaveClass(/bg-slate-700/);
  });

  test('覆盖模式拒绝 confirm → 停留 text 页不跳转', async ({ page }) => {
    // 建房间+区域
    await page.goto('/');
    const roomName = `覆盖拒绝房_${Date.now()}`;
    await page.fill('input[placeholder*="房间名"]', roomName);
    await page.click('button:has-text("添加")');
    await page.click(`text=${roomName}`);

    const areaName = `覆盖拒绝区_${Date.now()}`;
    await page.fill('input[placeholder*="区域名"]', areaName);
    await page.click('button:has-text("添加")');
    await page.click(`text=${areaName}`);
    await page.waitForURL(/\/areas\//);

    // 手动添加物品，使 existingItems.length > 0，confirm 文案会包含数量
    await page.click('button:has-text("手动添加")');
    await page.fill('input[placeholder="物品名"]', '旧物品');
    await page.getByRole('button', { name: '添加' }).last().click();
    await expect(page.locator('text=旧物品').first()).toBeVisible();

    // 进 text 页
    await page.click('a:has-text("📝 录入物品")');
    await page.waitForURL(/\/areas\/.*\/text/);

    // 设置 AI mock 并解析（覆盖模式）
    await setupAiAndParse(page, [{ name: '新物品', qty: 1, expires_at: null, notes: '' }], 'replace');

    // 拒绝弹窗
    page.on('dialog', d => d.dismiss());
    await page.locator('button:has-text("覆盖入库")').click();

    // 应留在 text 页
    await expect(page).toHaveURL(/\/areas\/.*\/text/);
  });

  test('覆盖模式接受 confirm → 跳转回 area 页', async ({ page }) => {
    await page.goto('/');
    const roomName = `覆盖接受房_${Date.now()}`;
    await page.fill('input[placeholder*="房间名"]', roomName);
    await page.click('button:has-text("添加")');
    await page.click(`text=${roomName}`);

    const areaName = `覆盖接受区_${Date.now()}`;
    await page.fill('input[placeholder*="区域名"]', areaName);
    await page.click('button:has-text("添加")');
    await page.click(`text=${areaName}`);
    await page.waitForURL(/\/areas\//);
    const areaId = page.url().split('/areas/')[1].replace(/\/.*$/, '');

    await page.click('a:has-text("📝 录入物品")');
    await page.waitForURL(/\/areas\/.*\/text/);

    await setupAiAndParse(page, [{ name: '新物品接受', qty: 1, expires_at: null, notes: '' }], 'replace');

    // 接受弹窗
    page.on('dialog', d => d.accept());
    await page.locator('button:has-text("覆盖入库")').click();

    await expect(page).toHaveURL(new RegExp(`/areas/${areaId}$`));
  });

  test('增改模式 badge：新增显示「新增」、已有显示「更新」', async ({ page }) => {
    // 建区域 + 先有物品
    await page.goto('/');
    const roomName = `Badge测试房_${Date.now()}`;
    await page.fill('input[placeholder*="房间名"]', roomName);
    await page.click('button:has-text("添加")');
    await page.click(`text=${roomName}`);

    const areaName = `Badge测试区_${Date.now()}`;
    await page.fill('input[placeholder*="区域名"]', areaName);
    await page.click('button:has-text("添加")');
    await page.click(`text=${areaName}`);
    await page.waitForURL(/\/areas\//);

    // 先添加一个物品
    await page.click('button:has-text("手动添加")');
    await page.fill('input[placeholder="物品名"]', '已有物品');
    await page.getByRole('button', { name: '添加' }).last().click();
    await expect(page.locator('text=已有物品').first()).toBeVisible();

    await page.click('a:has-text("📝 录入物品")');
    await page.waitForURL(/\/areas\/.*\/text/);

    // 增改模式，AI 返回两条：一条已有（→更新），一条新（→新增）
    await setupAiAndParse(page, [
      { name: '已有物品', qty: 2, expires_at: null, notes: '' },
      { name: '全新物品', qty: 1, expires_at: null, notes: '' },
    ], 'merge');

    // 验证 badge 显示
    await expect(page.locator('span:has-text("更新")')).toHaveCount(1);
    await expect(page.locator('span:has-text("新增")')).toHaveCount(1);
  });
});
