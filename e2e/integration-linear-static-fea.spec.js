import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'integration');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(300000);

test('Integration: Linear Static FEA in the Simulate ribbon runs foundation.QuadTetFEM', async ({ page }) => {
  ensure(ROOT);

  const consoleLines = [];
  page.on('console', (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (err) => consoleLines.push(`[pageerror] ${err.message}`));

  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });

  const simulateTab = page.locator('.ribbon-tab', { hasText: 'Simulate' }).first();
  await expect(simulateTab).toBeVisible({ timeout: 15000 });
  await simulateTab.click();

  const feaBtn = page.locator('.ribbon-tool', { hasText: 'Linear Static FEA' }).first();
  await expect(feaBtn).toBeVisible({ timeout: 10000 });
  await feaBtn.click();

  // Quadratic tet solver on 10×2×2 grid → ~360 DOFs, takes a couple seconds.
  const result = await page.evaluate(async () => {
    const start = Date.now();
    while (Date.now() - start < 180000) {
      const r = window.__lastFEAResult;
      if (r) return r;
      await new Promise(r => setTimeout(r, 200));
    }
    return { error: 'timeout' };
  });

  if (result?.error) {
    fs.writeFileSync(path.join(ROOT, 'fea-trace.log'), consoleLines.join('\n'));
    throw new Error(`Foundation FEA pipeline failed.\nConsole:\n${consoleLines.slice(-40).join('\n')}`);
  }

  console.log(`\n=== INTEGRATION: LINEAR STATIC FEA through real Simulate ribbon ===`);
  console.log(`δ_tip = ${result.cantileverDeltaMm.toFixed(4)} mm  (analytical ${result.analyticalDeltaMm.toFixed(4)})`);
  console.log(`Bending error vs Euler-Bernoulli: ${result.errorPct.toFixed(2)} %`);
  console.log(`σ_max = ${result.maxStressMPa.toFixed(1)} MPa,  SF = ${result.safetyFactor.toFixed(1)}`);
  console.log(`Mesh: ${result.elementCount} quad-tets, ${result.nodeCount} nodes,  CG ${result.cgIterations} iters`);

  fs.writeFileSync(path.join(ROOT, 'linear-static-fea-integration.json'), JSON.stringify(result, null, 2));

  // Quad-tet element on 10×2×2 grid hits about -1.4 % bending error.
  // We assert <5 % to leave headroom for grid variations.
  expect(Math.abs(result.errorPct)).toBeLessThan(5);
  // Linear bending — peak stress should be near σ = M·c/I = 60 MPa
  expect(result.maxStressMPa).toBeGreaterThan(20);
  expect(result.maxStressMPa).toBeLessThan(100);
  // Aluminum yield 276 MPa, peak ~60 MPa → SF roughly 4-5
  expect(result.safetyFactor).toBeGreaterThan(2);
});
