import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'integration');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(180000);

test('Integration: 3-Axis Milling in the Manufacture ribbon runs foundation.contourMill', async ({ page }) => {
  ensure(ROOT);

  const consoleLines = [];
  page.on('console', (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (err) => consoleLines.push(`[pageerror] ${err.message}`));

  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });

  const manuTab = page.locator('.ribbon-tab', { hasText: 'Manufacture' }).first();
  await expect(manuTab).toBeVisible({ timeout: 15000 });
  await manuTab.click();

  const millBtn = page.locator('.ribbon-tool', { hasText: '3-Axis Milling' }).first();
  await expect(millBtn).toBeVisible({ timeout: 10000 });
  await millBtn.click();

  const result = await page.evaluate(async () => {
    const start = Date.now();
    while (Date.now() - start < 90000) {
      const r = window.__lastGCodeResult;
      if (r) return r;
      await new Promise(r => setTimeout(r, 200));
    }
    return { error: 'timeout' };
  });

  if (result?.error) {
    fs.writeFileSync(path.join(ROOT, 'cam-trace.log'), consoleLines.join('\n'));
    throw new Error(`CAM pipeline failed.\nConsole:\n${consoleLines.slice(-40).join('\n')}`);
  }

  console.log(`\n=== INTEGRATION: 3-AXIS MILLING through Manufacture ribbon ===`);
  console.log(`G-code lines: ${result.totalLines}`);
  console.log(`Cutting moves (G1): ${result.cuttingMoves}`);
  console.log(`Profile segments: ${result.profileSegments}`);
  console.log(`Depth passes: ${result.passes}`);
  console.log(`First 5 lines of G-code:`);
  console.log(result.gcode.split('\n').slice(0, 5).map(l => '  ' + l).join('\n'));

  fs.writeFileSync(path.join(ROOT, 'cam-integration.json'), JSON.stringify({
    totalLines: result.totalLines,
    cuttingMoves: result.cuttingMoves,
    profileSegments: result.profileSegments,
    passes: result.passes,
    gcodeFirstLines: result.gcode.split('\n').slice(0, 10),
  }, null, 2));

  expect(result.totalLines).toBeGreaterThan(20);
  expect(result.cuttingMoves).toBeGreaterThan(5);
  // 4 segments × 2 passes = 8 cutting moves on Z + perimeter, exact count varies
  expect(result.passes).toBe(2);
  // Standard ISO G-code header should be present
  expect(result.gcode).toContain('G21');     // mm units
  expect(result.gcode).toContain('M3');      // spindle on
  expect(result.gcode).toContain('M30');     // program end
});
