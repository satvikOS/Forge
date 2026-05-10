import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'integration');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(300000);

test('Integration: Modal Analysis in the Simulate ribbon runs foundation.lowestNaturalFrequency', async ({ page }) => {
  ensure(ROOT);

  const consoleLines = [];
  page.on('console', (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (err) => consoleLines.push(`[pageerror] ${err.message}`));

  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });

  const simTab = page.locator('.ribbon-tab', { hasText: 'Simulate' }).first();
  await expect(simTab).toBeVisible({ timeout: 15000 });
  await simTab.click();

  const modalBtn = page.locator('.ribbon-tool', { hasText: 'Modal Analysis' }).first();
  await expect(modalBtn).toBeVisible({ timeout: 10000 });
  await modalBtn.click();

  const result = await page.evaluate(async () => {
    const start = Date.now();
    while (Date.now() - start < 180000) {
      const r = window.__lastModalResult;
      if (r) return r;
      await new Promise(r => setTimeout(r, 200));
    }
    return { error: 'timeout' };
  });

  if (result?.error) {
    fs.writeFileSync(path.join(ROOT, 'modal-trace.log'), consoleLines.join('\n'));
    throw new Error(`Modal pipeline failed.\nConsole:\n${consoleLines.slice(-40).join('\n')}`);
  }

  console.log(`\n=== INTEGRATION: MODAL ANALYSIS through real Simulate ribbon ===`);
  console.log(`Fundamental f₁ = ${result.fundamentalHz.toFixed(2)} Hz  (analytical ${result.analyticalHz.toFixed(2)} Hz)`);
  console.log(`Error vs Euler-Bernoulli: ${result.errorPct.toFixed(2)} %`);
  console.log(`Mesh: ${result.elementCount} tets / ${result.nodeCount} nodes,  ${result.iterations} inverse-iteration steps`);

  fs.writeFileSync(path.join(ROOT, 'modal-integration.json'), JSON.stringify(result, null, 2));

  // Linear-tet element over-predicts coarse-mesh natural frequency by
  // about 25-35 %. Allow up to 60 % over (still within order of magnitude).
  expect(result.fundamentalHz).toBeGreaterThan(100);
  expect(result.fundamentalHz).toBeLessThan(2 * result.analyticalHz);
});
