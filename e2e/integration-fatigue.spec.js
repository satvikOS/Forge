import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'integration');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(120000);

test('Integration: Fatigue Analysis ribbon — Goodman + Basquin via foundation', async ({ page }) => {
  ensure(ROOT);

  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });

  await page.locator('.ribbon-tab', { hasText: 'Simulate' }).first().click();
  await page.locator('.ribbon-tool-label', { hasText: /^Fatigue Analysis$/ }).first().click();
  await page.waitForFunction(() => !!window.__lastFatigueResult, null, { timeout: 30000 });

  const r = await page.evaluate(() => window.__lastFatigueResult);

  console.log(`\n=== FATIGUE ANALYSIS via real ribbon ===`);
  console.log(`Material: ${r.materialName}`);
  console.log(`σ_a = ${r.sigmaAlt}, σ_m = ${r.sigmaMean} MPa`);
  console.log(`S_e (Marin-corrected) = ${r.Se_corrected.toFixed(1)} MPa  (k_marin = ${r.marinFactor.toFixed(3)})`);
  console.log(`Goodman SF: ${r.goodmanSF.toFixed(3)},  Soderberg SF: ${r.soderbergSF.toFixed(3)},  Gerber SF: ${r.gerberSF.toFixed(3)}`);
  console.log(`Basquin life: ${r.lifeCycles === Infinity || r.lifeCycles === null ? '∞' : r.lifeCycles.toExponential(3) + ' cycles'}`);
  console.log(`Status: ${r.status}`);
  fs.writeFileSync(path.join(ROOT, 'fatigue-integration.json'), JSON.stringify(r, null, 2));

  // 4340 has Sf_at_1e6 = 600, k_marin ≈ 0.93·1·1·1·0.897 = 0.834
  // → S_e_corrected ≈ 500.5
  // σ_a = 400 < 500.5 → Goodman SF ≈ 1.25, lifeCycles = ∞
  expect(r.materialName).toBe('AISI 4340 (heat-treated)');
  expect(r.sigmaAlt).toBe(400);
  expect(r.Se_corrected).toBeGreaterThan(450);
  expect(r.Se_corrected).toBeLessThan(550);
  expect(r.goodmanSF).toBeGreaterThan(1.0);
});
