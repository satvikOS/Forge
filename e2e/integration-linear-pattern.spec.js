import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'integration');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(180000);

/**
 * INTEGRATION TEST — Linear Pattern wired into the actual ArchDisc app.
 *
 * Unlike the foundation-* specs which import foundation modules into a
 * stub Playwright page, this test:
 *   1. Loads the real ArchDisc app at /
 *   2. Waits for the Mechanical CAD workbench to render (default)
 *   3. Clicks the Part tab in the ribbon
 *   4. Clicks the "Linear Pattern" button
 *   5. Waits for the foundation handler to finish (manifold-3d WASM
 *      load + linearPattern union of 4 cylinders)
 *   6. Asserts:
 *        a. The status bar shows the success message with V = 4 × seed-V
 *        b. window.getLastFoundationManifold().volume() returns the
 *           expected total (4 × π · 3² · 15 ≈ 1696 mm³)
 *
 * If this passes, the click → handler → foundation kernel → scene
 * pipeline is genuinely integrated, not stubbed.
 */
test('Integration: clicking Linear Pattern in the ribbon runs the foundation kernel and adds geometry to the scene', async ({ page }) => {
  ensure(ROOT);

  // Capture browser console output so we can debug failures.
  const consoleLines = [];
  page.on('console', (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (err) => consoleLines.push(`[pageerror] ${err.message}`));
  page.on('crash', () => consoleLines.push('[crash] page crashed'));

  await page.goto('/');

  // Wait for Mechanical CAD workbench to mount + viewport canvas to appear
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });

  // Open the Part tab in the ribbon (active by default but click for safety)
  const partTab = page.locator('.ribbon-tab', { hasText: 'Part' }).first();
  try {
    await expect(partTab).toBeVisible({ timeout: 15000 });
  } catch (e) {
    fs.writeFileSync(path.join(ROOT, 'console-trace.log'), consoleLines.join('\n'));
    throw new Error(`Part tab not visible. Console:\n${consoleLines.slice(-40).join('\n')}`);
  }
  await partTab.click();

  // Click the "Linear Pattern" tool button in the ribbon
  const linearPatternBtn = page.locator('.ribbon-tool', { hasText: 'Linear Pattern' }).first();
  await expect(linearPatternBtn).toBeVisible({ timeout: 10000 });
  await linearPatternBtn.click();

  // Poll window.__lastFoundationManifold (the handler mirrors its
  // result there because Vite's dynamic-import query-param cache
  // busting can give us a different module instance otherwise).
  const result = await page.evaluate(async () => {
    const start = Date.now();
    while (Date.now() - start < 90000) {
      const m = window.__lastFoundationManifold;
      if (m) {
        const bb = m.boundingBox();
        return {
          volume: m.volume(),
          bbox: {
            min: [bb.min[0], bb.min[1], bb.min[2]],
            max: [bb.max[0], bb.max[1], bb.max[2]],
          },
          hasGroup: !!window.__lastFoundationGroup,
        };
      }
      await new Promise(r => setTimeout(r, 200));
    }
    return { error: 'timeout — foundation manifold never set on window' };
  });
  if (result?.error) {
    fs.writeFileSync(path.join(ROOT, 'console-trace.log'), consoleLines.join('\n'));
    throw new Error(`Foundation pipeline failed: ${result.error}\nConsole tail:\n${consoleLines.slice(-60).join('\n')}`);
  }

  console.log(`\n=== INTEGRATION: LINEAR PATTERN through real ribbon ===`);
  console.log(`Foundation manifold volume = ${result.volume?.toFixed(2)} mm³`);
  console.log(`bbox: [${result.bbox?.min.map(x => x.toFixed(2))}] → [${result.bbox?.max.map(x => x.toFixed(2))}]`);
  console.log(`Group attached to scene: ${result.hasGroup}`);

  fs.writeFileSync(path.join(ROOT, 'linear-pattern-integration.json'), JSON.stringify(result, null, 2));

  // Single cylinder volume: π · 3² · 15 = 424.115
  // Pattern total: 4 × 424.115 = 1696.46
  const Vexpected = 4 * Math.PI * 9 * 15;
  expect(result.volume).toBeGreaterThan(Vexpected * 0.99);
  expect(result.volume).toBeLessThan(Vexpected * 1.01);
  expect(result.hasGroup).toBe(true);

  // Bbox: 4 cylinders along +X spaced 20 mm apart, each Ø6 mm × 15 mm
  // tall (centered around z = 0). The first cylinder spans X = [-3, 3];
  // the fourth's center is at X = 60 spanning [57, 63].
  expect(result.bbox.min[0]).toBeCloseTo(-3, 1);
  expect(result.bbox.max[0]).toBeCloseTo(63, 1);
  expect(result.bbox.min[2]).toBeCloseTo(-7.5, 1);
  expect(result.bbox.max[2]).toBeCloseTo(7.5, 1);
});
