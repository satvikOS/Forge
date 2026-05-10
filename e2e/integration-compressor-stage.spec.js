import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'integration');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(120000);

test('Integration: Compressor Stage ribbon — velocity triangles + De Haller', async ({ page }) => {
  ensure(ROOT);
  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });

  await page.locator('.ribbon-tab', { hasText: 'Simulate' }).first().click();
  await page.locator('.ribbon-tool-label', { hasText: /^Compressor Stage$/ }).first().click();
  await page.waitForFunction(() => !!window.__lastCompressorResult, null, { timeout: 30000 });

  const r = await page.evaluate(() => window.__lastCompressorResult);

  console.log(`\n=== COMPRESSOR STAGE via real ribbon ===`);
  console.log(`Stage PR = ${r.work.stagePR.toFixed(3)},  power = ${(r.work.total_power_kW / 1000).toFixed(2)} MW`);
  console.log(`U_tip = ${r.blade_speed.U_tip.toFixed(0)} m/s,  M_tip = ${r.blade_speed.M_tip.toFixed(3)}`);
  console.log(`Loading ψ = ${r.nondim.loadingPsi.toFixed(3)},  φ = ${r.nondim.flowPhi.toFixed(3)},  R = ${r.nondim.reactionMean.toFixed(3)}`);
  console.log(`De Haller (hub/mid/tip): ${r.radial.hub.deHaller.toFixed(3)} / ${r.radial.mid.deHaller.toFixed(3)} / ${r.radial.tip.deHaller.toFixed(3)}`);
  console.log(`Blade count: ${r.geometry.bladeCount}`);
  fs.writeFileSync(path.join(ROOT, 'compressor-integration.json'), JSON.stringify(r, null, 2));

  expect(r.work.stagePR).toBeGreaterThan(1.15);
  expect(r.work.stagePR).toBeLessThan(1.40);
  expect(r.deHaller_check.passes).toBe(true);
  expect(r.geometry.bladeCount).toBeGreaterThan(8);
});
