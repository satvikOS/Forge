import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'integration');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(180000);

test('Integration: Steady-State Thermal in the Simulate ribbon runs foundation.solveThermalSteady', async ({ page }) => {
  ensure(ROOT);

  const consoleLines = [];
  page.on('console', (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (err) => consoleLines.push(`[pageerror] ${err.message}`));

  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });

  const simTab = page.locator('.ribbon-tab', { hasText: 'Simulate' }).first();
  await expect(simTab).toBeVisible({ timeout: 15000 });
  await simTab.click();

  const thermalBtn = page.locator('.ribbon-tool', { hasText: 'Steady-State Thermal' }).first();
  await expect(thermalBtn).toBeVisible({ timeout: 10000 });
  await thermalBtn.click();

  const result = await page.evaluate(async () => {
    const start = Date.now();
    while (Date.now() - start < 90000) {
      const r = window.__lastThermalResult;
      if (r) return r;
      await new Promise(r => setTimeout(r, 200));
    }
    return { error: 'timeout' };
  });

  if (result?.error) {
    fs.writeFileSync(path.join(ROOT, 'thermal-trace.log'), consoleLines.join('\n'));
    throw new Error(`Thermal pipeline failed.\nConsole:\n${consoleLines.slice(-40).join('\n')}`);
  }

  console.log(`\n=== INTEGRATION: STEADY-STATE THERMAL through real Simulate ribbon ===`);
  console.log(`T at x=50mm = ${result.midTempC.toFixed(3)} °C  (analytical 50 °C, err ${result.errorPct.toFixed(3)} %)`);
  console.log(`Range: [${result.minT.toFixed(2)}, ${result.maxT.toFixed(2)}] °C`);
  console.log(`Mesh: ${result.elementCount} tets, ${result.nodeCount} nodes, CG ${result.cgIterations} iter`);

  fs.writeFileSync(path.join(ROOT, 'thermal-integration.json'), JSON.stringify(result, null, 2));

  // Linear conduction is element-exact for linear-tet → expect <0.5 % error
  expect(Math.abs(result.errorPct)).toBeLessThan(0.5);
  expect(result.minT).toBeCloseTo(0, 3);
  expect(result.maxT).toBeCloseTo(100, 3);
});
