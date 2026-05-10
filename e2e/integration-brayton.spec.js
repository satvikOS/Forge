import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'integration');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(120000);

test('Integration: Brayton Cycle ribbon — Trent XWB-class turbofan via foundation', async ({ page }) => {
  ensure(ROOT);

  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });

  await page.locator('.ribbon-tab', { hasText: 'Simulate' }).first().click();
  await page.locator('.ribbon-tool-label', { hasText: /^Brayton Cycle$/ }).first().click();
  await page.waitForFunction(() => !!window.__lastBraytonResult, null, { timeout: 30000 });

  const r = await page.evaluate(() => window.__lastBraytonResult);

  console.log(`\n=== BRAYTON CYCLE via real ribbon ===`);
  console.log(`BPR = ${r.bypassRatio}, OPR = ${r.OPR.toFixed(1)}, T4 = ${r.T4_K} K`);
  console.log(`Thrust = ${(r.thrust_N / 1000).toFixed(1)} kN  (${(r.thrust_lbf / 1000).toFixed(1)} klbf)`);
  console.log(`SFC = ${r.SFC_lb_per_lbf_hr.toFixed(3)} lbm/(lbf·hr)`);
  console.log(`Overall efficiency = ${(r.overallEff * 100).toFixed(1)} %`);
  console.log(`Core jet V9 = ${r.stations.s9.V.toFixed(0)} m/s,  Bypass jet V19 = ${r.stations.s19.V.toFixed(0)} m/s`);
  console.log(`Fuel/air ratio = ${r.fuelAirRatio.toFixed(4)}`);
  fs.writeFileSync(path.join(ROOT, 'brayton-integration.json'), JSON.stringify(r, null, 2));

  // Trent XWB cruise published: ~85 kN at idle / ~290 kN takeoff,
  // SFC ~0.55–0.60 lbm/(lbf·hr) cruise. Our 1300 kg/s scaling gives
  // ~186 kN with SFC ~0.69 — close to a derated cruise condition.
  expect(r.thrust_N).toBeGreaterThan(100000);
  expect(r.thrust_N).toBeLessThan(300000);
  expect(r.SFC_lb_per_lbf_hr).toBeLessThan(1.0);
  expect(r.OPR).toBeGreaterThan(40);
  expect(r.overallEff).toBeGreaterThan(0.20);
});
