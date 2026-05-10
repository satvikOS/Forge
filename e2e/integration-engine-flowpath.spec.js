import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'integration');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(120000);

test('Integration: Turbine Stage ribbon → HPT mean-line', async ({ page }) => {
  ensure(ROOT);
  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
  await page.locator('.ribbon-tab', { hasText: 'Simulate' }).first().click();
  await page.locator('.ribbon-tool-label', { hasText: /^Turbine Stage$/ }).first().click();
  await page.waitForFunction(() => !!window.__lastTurbineResult, null, { timeout: 30000 });
  const r = await page.evaluate(() => window.__lastTurbineResult);
  console.log(`\nTurbine: ΔT=${r.work.deltaTtotal_K} K, π_drop=${r.work.stagePR_drop.toFixed(3)}, ψ=${r.nondim.loadingPsi.toFixed(2)}, ${r.geometry.bladeCount} blades, ${(r.work.total_power_kW/1000).toFixed(1)} MW`);
  fs.writeFileSync(path.join(ROOT, 'turbine-integration.json'), JSON.stringify(r, null, 2));
  expect(r.work.stagePR_drop).toBeLessThan(1);
  expect(r.work.total_power_kW).toBeGreaterThan(1000);
  expect(r.geometry.bladeCount).toBeGreaterThanOrEqual(20);
});

test('Integration: Combustor ribbon → annular sizing + emissions', async ({ page }) => {
  ensure(ROOT);
  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
  await page.locator('.ribbon-tab', { hasText: 'Simulate' }).first().click();
  await page.locator('.ribbon-tool-label', { hasText: /^Combustor$/ }).first().click();
  await page.waitForFunction(() => !!window.__lastCombustorResult, null, { timeout: 30000 });
  const r = await page.evaluate(() => window.__lastCombustorResult);
  console.log(`\nCombustor: V=${(r.geometry.volume_m3*1000).toFixed(2)} L, length=${r.geometry.liner_length_m.toFixed(3)} m, NOx=${r.emissions.EI_NOx_g_per_kgFuel.toFixed(1)} g/kg fuel`);
  fs.writeFileSync(path.join(ROOT, 'combustor-integration.json'), JSON.stringify(r, null, 2));
  expect(r.geometry.liner_length_m).toBeGreaterThan(0.05);
  expect(r.geometry.liner_length_m).toBeLessThan(1.0);
  expect(r.emissions.EI_NOx_g_per_kgFuel).toBeGreaterThan(0);
  expect(r.emissions.EI_NOx_g_per_kgFuel).toBeLessThan(500);
});

test('Integration: Nozzle ribbon → convergent + CD', async ({ page }) => {
  ensure(ROOT);
  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
  await page.locator('.ribbon-tab', { hasText: 'Simulate' }).first().click();
  await page.locator('.ribbon-tool-label', { hasText: /^Nozzle$/ }).first().click();
  await page.waitForFunction(() => !!window.__lastNozzleResult, null, { timeout: 30000 });
  const r = await page.evaluate(() => window.__lastNozzleResult);
  console.log(`\nConv: choked=${r.conv.choked}, M_e=${r.conv.M_exit.toFixed(2)}, V_e=${r.conv.V_exit.toFixed(0)}`);
  console.log(`CD:  A/A*=${r.cd.A_exit_over_throat.toFixed(3)}, V_e=${r.cd.V_exit_design.toFixed(0)}, ${r.cd.expansion}`);
  fs.writeFileSync(path.join(ROOT, 'nozzle-integration.json'), JSON.stringify(r, null, 2));
  expect(r.conv.choked).toBe(true);
  expect(r.conv.M_exit).toBeCloseTo(1.0, 3);
  expect(r.cd.A_exit_over_throat).toBeCloseTo(1.6875, 3);
  expect(r.cd.expansion).toBe('design_match');
});
