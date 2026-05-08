/**
 * no-blue-purple.spec.ts
 * 防御性测试：确保核心页面没有任何蓝/紫调元素（hue 200-280）。
 * 任何人引入蓝紫色时 CI 直接挂。
 *
 * 判定范围：RGB 蓝/紫色调，即：
 *   - blue 分量明显高于 red/green，或
 *   - hue 在 200–280 之间（HSL 换算）
 * 只检查"有色"像素（排除纯白/纯黑/近灰），避免抗锯齿误判。
 */
import { test, expect } from '@playwright/test';

type RGB = [number, number, number];

/** 将 rgb(r,g,b) / rgba(r,g,b,a) 字符串解析为 [r,g,b] */
function parseRgb(css: string): RGB | null {
  const m = css.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return null;
  return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
}

/** RGB → HSL hue (0-360) */
function rgbToHue(r: number, g: number, b: number): number {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const delta = max - min;
  if (delta < 0.001) return 0; // achromatic
  let h = 0;
  if (max === rn) h = ((gn - bn) / delta) % 6;
  else if (max === gn) h = (bn - rn) / delta + 2;
  else h = (rn - gn) / delta + 4;
  h = h * 60;
  if (h < 0) h += 360;
  return h;
}

/** 是否是"有色"像素（排除近灰/近白/近黑，saturation > 10%） */
function isChromatic(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const delta = max - min;
  if (max === 0) return false;
  const s = delta / max; // saturation in HSV
  return s > 0.1 && max > 20; // not too dark
}

/**
 * 收集页面所有可见元素的 background-color / color，
 * 返回蓝紫调（hue 200-280）的颜色列表。
 */
async function collectBluePurpleColors(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    function parseRgb(css: string): [number, number, number] | null {
      const m = css.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (!m) return null;
      return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
    }
    function rgbToHue(r: number, g: number, b: number): number {
      const rn = r / 255, gn = g / 255, bn = b / 255;
      const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
      const delta = max - min;
      if (delta < 0.001) return 0;
      let h = 0;
      if (max === rn) h = ((gn - bn) / delta) % 6;
      else if (max === gn) h = (bn - rn) / delta + 2;
      else h = (rn - gn) / delta + 4;
      h *= 60;
      if (h < 0) h += 360;
      return h;
    }
    function isChromatic(r: number, g: number, b: number): boolean {
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const delta = max - min;
      if (max === 0) return false;
      const s = delta / max;
      return s > 0.1 && max > 20;
    }
    function isBluePurple(hue: number): boolean {
      return hue >= 200 && hue <= 280;
    }

    const all = document.querySelectorAll('*');
    const violations: string[] = [];
    for (const el of all) {
      const style = window.getComputedStyle(el);
      for (const prop of ['backgroundColor', 'color', 'borderColor', 'outlineColor'] as const) {
        const val = style[prop];
        if (!val || val === 'transparent' || val === 'rgba(0, 0, 0, 0)') continue;
        const rgb = parseRgb(val);
        if (!rgb) continue;
        const [r, g, b] = rgb;
        if (!isChromatic(r, g, b)) continue;
        const hue = rgbToHue(r, g, b);
        if (isBluePurple(hue)) {
          // check alpha > 0.05 to avoid near-transparent artifacts
          const alphaMatch = val.match(/rgba?\(\d+,\s*\d+,\s*\d+,\s*([\d.]+)/);
          const alpha = alphaMatch ? parseFloat(alphaMatch[1]) : 1;
          if (alpha > 0.05) {
            violations.push(`${el.tagName}[${prop}=${val} hue=${Math.round(hue)}]`);
          }
        }
      }
    }
    // Deduplicate
    return [...new Set(violations)];
  });
}

const PAGES = [
  { name: 'Home', path: '/' },
  { name: 'Search', path: '/search' },
  { name: 'Settings', path: '/settings' },
];

test.use({ viewport: { width: 375, height: 667 } });

test.describe('防蓝紫色调检测（#97 Editorial/Muji 色系）', () => {
  for (const { name, path } of PAGES) {
    test(`${name} 页 — 无蓝紫调元素（hue 200-280）`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState('networkidle');

      const violations = await collectBluePurpleColors(page);

      if (violations.length > 0) {
        console.log(`[no-blue-purple] ${name} violations:\n`, violations.slice(0, 20).join('\n'));
      }

      expect(
        violations,
        `${name} 页发现蓝/紫调颜色（hue 200-280），违反 Editorial/Muji 色系规范。\n` +
        violations.slice(0, 10).join('\n')
      ).toHaveLength(0);
    });
  }
});
