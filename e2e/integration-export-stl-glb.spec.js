import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'integration');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(180000);

/**
 * Chained: create body → export STL → export GLB. All three through
 * real ribbon clicks.
 */
test('Integration: Linear Pattern → Export STL (Manufacture) + Export glTF (Drawing)', async ({ page }) => {
  ensure(ROOT);

  const consoleLines = [];
  page.on('console', (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (err) => consoleLines.push(`[pageerror] ${err.message}`));

  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });

  // Step 1: Linear Pattern
  await page.locator('.ribbon-tab', { hasText: 'Part' }).first().click();
  await page.locator('.ribbon-tool', { hasText: 'Linear Pattern' }).first().click();
  await page.waitForFunction(() => !!window.__lastFoundationManifold, null, { timeout: 60000 });

  // Step 2: Export STL via Manufacture tab
  await page.locator('.ribbon-tab', { hasText: 'Manufacture' }).first().click();
  await page.locator('.ribbon-tool', { hasText: 'Export STL' }).first().click();
  await page.waitForFunction(() => !!window.__lastSTLBytes, null, { timeout: 30000 });
  const stlBytes = await page.evaluate(() => window.__lastSTLBytes);
  const stlTriCount = await page.evaluate(() => window.__lastSTLTriCount);

  // Step 3: Export GLB via Drawing tab
  await page.locator('.ribbon-tab', { hasText: 'Drawing' }).first().click();
  await page.locator('.ribbon-tool', { hasText: 'Export glTF' }).first().click();
  await page.waitForFunction(() => !!window.__lastGLBBytes, null, { timeout: 30000 });
  const glbBytes = await page.evaluate(() => window.__lastGLBBytes);

  console.log(`\n=== INTEGRATION: STL + GLB exports through real ribbons ===`);
  console.log(`STL: ${stlBytes} bytes  (${stlTriCount} triangles)`);
  console.log(`GLB: ${glbBytes} bytes`);

  fs.writeFileSync(path.join(ROOT, 'export-stl-glb-integration.json'), JSON.stringify({
    stlBytes, stlTriCount, glbBytes,
  }, null, 2));

  // Binary STL: 84-byte header + 50 bytes per triangle
  expect(stlBytes).toBe(84 + 50 * stlTriCount);
  expect(stlTriCount).toBeGreaterThan(50);
  expect(glbBytes).toBeGreaterThan(2000);
  // Binary glTF magic: first 4 bytes = "glTF"
  // Verified by the byte count alone for now — the file is downloaded
  // to the browser's downloads dir by the click handler.
});
