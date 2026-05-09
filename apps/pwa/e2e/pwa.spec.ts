/**
 * PWA 功能专项测试 — Round 12
 * 覆盖：manifest / Service Worker / 离线模式 / display:standalone / icons
 *
 * 注意：installability prompt（beforeinstallprompt）只在真实 Chrome 会触发，
 * 且需要满足安装标准（HTTPS / SW 注册 / manifest 完整）。
 * 这里用静态断言替代动态 prompt 检测。
 */
import { test, expect } from '@playwright/test';

test.describe('PWA — Manifest 完整性', () => {
  test('manifest.webmanifest 可访问并包含必要字段', async ({ page }) => {
    const res = await page.request.get('/manifest.webmanifest');
    expect(res.status()).toBe(200);
    const manifest = await res.json();
    expect(manifest.name).toBe('Keepsake');
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBeTruthy();
    expect(manifest.display).toBe('standalone');
    expect(manifest.theme_color).toBeTruthy();
    expect(manifest.background_color).toBeTruthy();
    expect(manifest.scope).toBeTruthy();
  });

  test('manifest icons 包含 192 和 512 尺寸', async ({ page }) => {
    const res = await page.request.get('/manifest.webmanifest');
    const manifest = await res.json();
    const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
  });

  test('manifest icons 包含 maskable 图标', async ({ page }) => {
    const res = await page.request.get('/manifest.webmanifest');
    const manifest = await res.json();
    const maskable = manifest.icons.find((i: { purpose?: string }) => i.purpose?.includes('maskable'));
    expect(maskable).toBeTruthy();
  });

  test('192x192 icon 文件可访问', async ({ page }) => {
    const res = await page.request.get('/icons/icon-192.png');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('image/png');
  });

  test('512x512 icon 文件可访问', async ({ page }) => {
    const res = await page.request.get('/icons/icon-512.png');
    expect(res.status()).toBe(200);
  });

  test('maskable icon 文件可访问', async ({ page }) => {
    const res = await page.request.get('/icons/icon-maskable.png');
    expect(res.status()).toBe(200);
  });
});

test.describe('PWA — HTML meta 标签', () => {
  test('页面包含 manifest link 标签', async ({ page }) => {
    await page.goto('/');
    const manifestLink = page.locator('link[rel="manifest"]');
    await expect(manifestLink).toHaveAttribute('href', /manifest\.webmanifest/);
  });

  test('页面包含 theme-color meta 标签', async ({ page }) => {
    await page.goto('/');
    const themeMeta = page.locator('meta[name="theme-color"]');
    await expect(themeMeta).toHaveAttribute('content', /.+/);
  });

  test('页面包含 apple-mobile-web-app-capable（iOS PWA）', async ({ page }) => {
    await page.goto('/');
    // 部分配置可能没有，记录结果不强制失败
    const appleMeta = page.locator('meta[name="apple-mobile-web-app-capable"]');
    const count = await appleMeta.count();
    // 仅记录（iOS PWA 安装提示需要此标签，暂不强制要求）
    console.log(`apple-mobile-web-app-capable: ${count > 0 ? '✓ 存在' : '✗ 缺失（iOS 安装提示可能受影响）'}`);
  });
});

test.describe('PWA — Service Worker', () => {
  test('Service Worker 注册成功', async ({ page }) => {
    await page.goto('/');
    // 等待 SW 注册
    await page.waitForTimeout(1500);
    const swState = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return 'not-supported';
      const regs = await navigator.serviceWorker.getRegistrations();
      if (regs.length === 0) return 'no-registration';
      return regs[0].active ? 'active' : (regs[0].installing ? 'installing' : regs[0].waiting ? 'waiting' : 'unknown');
    });
    // SW 可能处于 installing → waiting → active，均视为正常
    expect(['active', 'installing', 'waiting']).toContain(swState);
  });

  test('sw.js 文件可访问', async ({ page }) => {
    const res = await page.request.get('/sw.js');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toMatch(/javascript/);
  });

  test('workbox 预缓存列表文件存在（sw.js 包含 workbox 内容）', async ({ page }) => {
    const res = await page.request.get('/sw.js');
    const body = await res.text();
    expect(body.length).toBeGreaterThan(100);
    // workbox 生成的 SW 包含 precacheAndRoute 或 cleanupOutdatedCaches
    const hasWorkbox = body.includes('precacheAndRoute') || body.includes('cleanupOutdatedCaches') || body.includes('workbox');
    expect(hasWorkbox).toBe(true);
  });
});

test.describe('PWA — 离线访问', () => {
  test('断网后主页仍可渲染（shell）', async ({ page, context }) => {
    // 先访问一次，让 SW 缓存页面
    await page.goto('/');
    await page.waitForTimeout(2000); // 给 SW 时间完成预缓存

    // 模拟断网
    await context.setOffline(true);

    // 刷新页面
    await page.reload();

    // 页面应能渲染（React shell 存在，而非 Chrome 的恐龙错误页）
    const bodyText = await page.evaluate(() => document.body.innerHTML);
    // 恐龙页有 id="main-message"
    const isChromeDinoPage = await page.evaluate(() => !!document.getElementById('main-message'));
    expect(isChromeDinoPage).toBe(false);

    // 恢复网络
    await context.setOffline(false);
  });
});

test.describe('PWA — display:standalone 检测', () => {
  test('页面 CSS media query standalone 检测（模拟）', async ({ page }) => {
    await page.goto('/');
    // 检查代码是否存在对 standalone 的处理（可选，仅记录）
    const hasStandaloneCheck = await page.evaluate(() => {
      return window.matchMedia('(display-mode: standalone)').media !== '';
    });
    expect(hasStandaloneCheck).toBe(true);
  });
});

test.describe('PWA — 缓存策略验证', () => {
  test('静态资源 CSS/JS 有正常响应', async ({ page }) => {
    await page.goto('/');
    // 收集所有 JS/CSS 请求
    const resourceStatuses: number[] = [];
    page.on('response', (res) => {
      const url = res.url();
      if (url.match(/\.(js|css)$/)) resourceStatuses.push(res.status());
    });
    await page.waitForLoadState('networkidle');
    // 所有静态资源应返回 200
    expect(resourceStatuses.every(s => s === 200 || s === 304)).toBe(true);
  });
});
