import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'integration');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(120000);

test('Integration: Blade Cooling ribbon — HPT thermal analysis', async ({ page }) => {
  ensure(ROOT);
  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
  await page.locator('.ribbon-tab', { hasText: 'Simulate' }).first().click();
  await page.locator('.ribbon-tool-label', { hasText: /^Blade Cooling$/ }).first().click();
  await page.waitForFunction(() => !!window.__lastBladeCoolingResult, null, { timeout: 30000 });
  const r = await page.evaluate(() => window.__lastBladeCoolingResult);
  console.log(`\nBlade cooling: hot-spot ${r.hotspot} = ${(r.T_metal_max_K - 273.15).toFixed(0)} °C, survives long-life: ${r.survives_long_life}`);
  fs.writeFileSync(path.join(ROOT, 'blade-cooling-integration.json'), JSON.stringify(r, null, 2));
  // Hot-spot under CMSX-4 long-life limit
  expect(r.T_metal_max_K - 273.15).toBeLessThan(1100);
  expect(r.T_metal_max_K - 273.15).toBeGreaterThan(500);
  expect(r.survives_long_life).toBe(true);
});

test('Integration: Mission ribbon — Breguet range for 200t transport', async ({ page }) => {
  ensure(ROOT);
  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
  await page.locator('.ribbon-tab', { hasText: 'Simulate' }).first().click();
  await page.locator('.ribbon-tool-label', { hasText: /^Mission$/ }).first().click();
  await page.waitForFunction(() => !!window.__lastMissionResult, null, { timeout: 30000 });
  const r = await page.evaluate(() => window.__lastMissionResult);
  console.log(`\nMission: range ${r.range.range_km.toFixed(0)} km (${r.range.range_nmi.toFixed(0)} nmi), endurance ${r.endurance.endurance_hr.toFixed(2)} hr, thrust per engine ${(r.cruise.thrust_required_per_engine_N/1000).toFixed(1)} kN`);
  fs.writeFileSync(path.join(ROOT, 'mission-integration.json'), JSON.stringify(r, null, 2));
  expect(r.range.range_km).toBeGreaterThan(5000);
  expect(r.range.range_km).toBeLessThan(15000);
  expect(r.cruise.LoverD_avg).toBeGreaterThan(10);
  expect(r.cruise.thrust_required_per_engine_N).toBeGreaterThan(20000);
  expect(r.cruise.thrust_required_per_engine_N).toBeLessThan(150000);
});
