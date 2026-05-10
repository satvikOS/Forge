import { test } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const DIR = path.join(process.cwd(), 'engine-output', 'GE9X', 'drawings');

test.setTimeout(120000);

test('GE9X drawings: render SVG sheets to PNG previews', async ({ page }) => {
  const svgs = fs.readdirSync(DIR).filter(f => f.endsWith('.svg'));

  for (const svg of svgs) {
    const content = fs.readFileSync(path.join(DIR, svg), 'utf8');

    // Wrap in HTML with white background
    const html = `<!doctype html><html><body style="margin:0;background:#fff">${content}</body></html>`;

    await page.setContent(html, { waitUntil: 'load' });
    await page.waitForTimeout(200);

    // Get SVG dimensions
    const dims = await page.evaluate(() => {
      const s = document.querySelector('svg');
      if (!s) return null;
      const w = parseFloat(s.getAttribute('width')) || s.viewBox?.baseVal?.width || 800;
      const h = parseFloat(s.getAttribute('height')) || s.viewBox?.baseVal?.height || 600;
      return { w, h };
    });

    if (dims) {
      await page.setViewportSize({
        width: Math.ceil(dims.w),
        height: Math.ceil(dims.h),
      });
      await page.waitForTimeout(200);
    }

    const pngPath = path.join(DIR, svg.replace('.svg', '.png'));
    await page.screenshot({ path: pngPath, fullPage: true, omitBackground: false });
    console.log(`  ✓ ${svg.replace('.svg', '.png')}`);
  }
});
