/**
 * search-no-guid.spec.ts
 * 防御性测试（#89 GUID bug 回归）：
 * 即使 AI 返回含 [id] 标记的 answer，页面也绝不渲染那个字符串到用户可见区。
 *
 * 策略：
 * 1. 用 page.route 拦截对 OpenRouter / DeepSeek 的请求，注入"故意不听话"的带 GUID 回答
 * 2. 通过 localStorage trick 设置 AI 配置（Dexie 会在 navigate 后初始化）
 * 3. 触发搜索并点 AI 按钮
 * 4. 断言页面上不存在 [xxx-guid] 字符串
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 375, height: 667 } });

const MOCK_GUID = 'abc12345-bad0-guid-test-000000000000';
const GUID_TAG = `[${MOCK_GUID}]`;

test.describe('搜索 AI 回答：GUID 不泄漏到用户可见区（#89 防御性）', () => {
  test('AI 故意返回含 [id] 的 answer，页面不渲染该字符串', async ({ page }) => {
    // ── 1. 拦截所有 AI API 请求 ──────────────────────────────────
    await page.route('**/api/v1/chat/completions', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          choices: [{
            message: {
              content: JSON.stringify({
                answer: `消毒水放在储物柜 ${GUID_TAG} 里，共 3 瓶。`,
                citedIds: [MOCK_GUID],
              }),
            },
          }],
        }),
      });
    });

    // ── 2. 先建房间 → 区域 → 物品 ──────────────────────────────
    await page.goto('/');

    const roomName = `guid测试房_${Date.now()}`;
    await page.fill('input[placeholder*="房间名"]', roomName);
    await page.click('button:has-text("添加")');
    await page.click(`text=${roomName}`);
    await expect(page).toHaveURL(/\/rooms\//);

    const areaName = `guid测试区_${Date.now()}`;
    await page.fill('input[placeholder*="区域名"]', areaName);
    await page.click('button:has-text("添加")');
    await page.click(`text=${areaName}`);
    await expect(page).toHaveURL(/\/areas\//);

    // 手动添加一个物品
    await page.click('button:has-text("手动添加")');
    await page.waitForTimeout(200);
    await page.fill('input[placeholder="物品名"]', '消毒水');
    // 手动添加物品的提交按钮（Area 页中是"添加"）
    const submitBtn = page.locator('button:has-text("添加")').last();
    await submitBtn.click();
    await page.waitForTimeout(300);

    // ── 3. 写入 AI 配置到 IndexedDB（DB 已经初始化后） ──────────
    await page.evaluate(async () => {
      await new Promise<void>((resolve, reject) => {
        // DB 已由 Dexie 初始化（version 3），直接打开最新版
        const req = indexedDB.open('keepsake');
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('kv')) { resolve(); return; }
          const tx = db.transaction('kv', 'readwrite');
          const store = tx.objectStore('kv');
          store.put({ key: 'ai_config', value: { mode: 'on', provider: 'openrouter', apiKey: 'mock-key-for-test', model: 'mock-model' } });
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => { db.close(); reject(tx.error); };
        };
        req.onerror = () => reject(req.error);
      });
    });

    // ── 4. 去搜索页 ──────────────────────────────────────────────
    await page.goto('/search');
    await page.waitForTimeout(500); // 等 AI 配置加载

    await page.fill('input', '消毒水');
    await page.waitForTimeout(300);

    // ── 5. 如果 AI 按钮可见，点击 ───────────────────────────────
    const aiBtn = page.locator('button:has-text("AI 回答")');
    const aiVisible = await aiBtn.isVisible().catch(() => false);

    if (aiVisible) {
      await aiBtn.click();
      // 等待答案区出现
      await expect(page.locator('section').filter({ hasText: 'AI 回答' }).first()).toBeVisible({ timeout: 5000 });
      await page.waitForTimeout(500);
    }

    // ── 6. 核心断言：GUID 标签字符串不出现在可见文本里 ───────────
    const bodyText = await page.locator('body').textContent() ?? '';
    expect(bodyText, `页面不应包含 GUID 标签 "${GUID_TAG}"`).not.toContain(GUID_TAG);
  });
});
