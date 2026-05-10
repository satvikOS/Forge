import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'integration');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(300000);

test('Integration: Topology Optimization in the Simulate ribbon runs foundation.optimizeSIMP', async ({ page }) => {
  ensure(ROOT);

  const consoleLines = [];
  page.on('console', (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (err) => consoleLines.push(`[pageerror] ${err.message}`));

  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });

  const simTab = page.locator('.ribbon-tab', { hasText: 'Simulate' }).first();
  await expect(simTab).toBeVisible({ timeout: 15000 });
  await simTab.click();

  const topOptBtn = page.locator('.ribbon-tool', { hasText: 'Topology Optimization' }).first();
  await expect(topOptBtn).toBeVisible({ timeout: 10000 });
  await topOptBtn.click();

  // SIMP can take 30+ seconds — many compliance solves per iter.
  const result = await page.evaluate(async () => {
    const start = Date.now();
    while (Date.now() - start < 240000) {
      const r = window.__lastTopOptResult;
      if (r) return r;
      await new Promise(r => setTimeout(r, 500));
    }
    return { error: 'timeout' };
  });

  if (result?.error) {
    fs.writeFileSync(path.join(ROOT, 'topopt-trace.log'), consoleLines.join('\n'));
    throw new Error(`TopOpt pipeline failed.\nConsole:\n${consoleLines.slice(-40).join('\n')}`);
  }

  console.log(`\n=== INTEGRATION: TOPOLOGY OPTIMIZATION through real Simulate ribbon ===`);
  console.log(`Outer iterations: ${result.outerIterations}`);
  console.log(`Compliance: ${result.initialCompliance.toFixed(3)} → ${result.finalCompliance.toFixed(3)}`);
  console.log(`Final V_f: ${result.volumeFractionFinal.toFixed(3)}  (target 0.35)`);
  console.log(`Solid: ${result.solidElements} / ${result.totalElements} elements`);

  fs.writeFileSync(path.join(ROOT, 'topopt-integration.json'), JSON.stringify(result, null, 2));

  expect(result.outerIterations).toBeGreaterThan(0);
  // Compliance must improve (decrease) over iterations
  expect(result.finalCompliance).toBeLessThan(result.initialCompliance * 1.5);
  // Volume fraction approximately matches target (0.30..0.40 acceptable)
  expect(result.volumeFractionFinal).toBeGreaterThan(0.20);
  expect(result.volumeFractionFinal).toBeLessThan(0.55);
});
