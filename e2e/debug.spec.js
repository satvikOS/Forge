import { test, expect } from '@playwright/test';

test('check viewport canvas renders', async ({ page }) => {
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));

  await page.goto('/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  // Check for canvas
  const canvasCount = await page.locator('canvas').count();
  console.log(`Canvas count: ${canvasCount}`);

  // Check viewport dimensions
  const viewportEl = page.locator('.workbench-viewport');
  if (await viewportEl.count() > 0) {
    const box = await viewportEl.boundingBox();
    console.log(`Viewport: ${JSON.stringify(box)}`);
  } else {
    console.log('No .workbench-viewport found');
    // Check what's in main
    const mainEl = page.locator('main');
    const mainCount = await mainEl.count();
    console.log(`main elements: ${mainCount}`);
  }

  // Check if Three.js loaded
  const hasThree = await page.evaluate(() => typeof window.THREE !== 'undefined' || document.querySelector('canvas') !== null);
  console.log(`Has canvas in DOM: ${hasThree}`);

  // Get all elements with class containing 'viewport'
  const vpEls = await page.evaluate(() => {
    return [...document.querySelectorAll('[class*="viewport"]')].map(e => ({
      tag: e.tagName,
      class: e.className,
      w: e.offsetWidth,
      h: e.offsetHeight,
      children: e.children.length
    }));
  });
  console.log('Viewport elements:', JSON.stringify(vpEls));

  await page.screenshot({ path: 'e2e/screenshots/debug-canvas.png' });

  expect(errors.length).toBe(0);
});
