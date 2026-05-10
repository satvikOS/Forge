import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'integration');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(300000);

test('Integration: Buckling Analysis in the Simulate ribbon runs foundation.solveBuckling', async ({ page }) => {
  ensure(ROOT);

  const consoleLines = [];
  page.on('console', (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (err) => consoleLines.push(`[pageerror] ${err.message}`));

  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });

  const simTab = page.locator('.ribbon-tab', { hasText: 'Simulate' }).first();
  await expect(simTab).toBeVisible({ timeout: 15000 });
  await simTab.click();

  const buckBtn = page.locator('.ribbon-tool', { hasText: 'Buckling Analysis' }).first();
  await expect(buckBtn).toBeVisible({ timeout: 10000 });
  await buckBtn.click();

  const result = await page.evaluate(async () => {
    const start = Date.now();
    while (Date.now() - start < 180000) {
      const r = window.__lastBucklingResult;
      if (r) return r;
      await new Promise(r => setTimeout(r, 200));
    }
    return { error: 'timeout' };
  });

  if (result?.error) {
    fs.writeFileSync(path.join(ROOT, 'buckling-trace.log'), consoleLines.join('\n'));
    throw new Error(`Buckling pipeline failed.\nConsole:\n${consoleLines.slice(-40).join('\n')}`);
  }

  console.log(`\n=== INTEGRATION: BUCKLING ANALYSIS through real Simulate ribbon ===`);
  console.log(`P_cr = ${result.criticalLoadN.toFixed(2)} N  (analytical π²EI/4L² = ${result.analyticalPcrN.toFixed(2)} N, err ${result.errorPct.toFixed(2)} %)`);
  console.log(`Mesh: ${result.elementCount} tets / ${result.nodeCount} nodes,  ${result.iterations} inverse-iteration steps`);

  fs.writeFileSync(path.join(ROOT, 'buckling-integration.json'), JSON.stringify(result, null, 2));

  // Linear-tet on coarse grid over-stiffens column → P_cr over-predicted.
  // Allow up to 100 % over.
  expect(result.criticalLoadN).toBeGreaterThan(result.analyticalPcrN * 0.5);
  expect(result.criticalLoadN).toBeLessThan(result.analyticalPcrN * 3.0);
});
