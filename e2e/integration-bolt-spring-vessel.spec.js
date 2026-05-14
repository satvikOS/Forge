import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'integration');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.describe('Integration: bolt/spring/vessel via Simulate ribbon', () => {
  test.describe.configure({ timeout: 120000 });
  test.beforeAll(() => ensure(ROOT));

  test('Bolted Joint ribbon → preload + Goodman fatigue', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.locator('.ribbon-tab', { hasText: 'Simulate' }).first().click();
    await page.locator('.ribbon-tool-label', { hasText: /^Bolted Joint$/ }).first().click();
    await page.waitForFunction(() => !!window.__lastBoltResult, null, { timeout: 30000 });
    const r = await page.evaluate(() => window.__lastBoltResult);
    console.log(`\nBolt: F_i=${r.preload.F_i_N.toFixed(0)} N, σ_max=${r.loadedState.sigma_max_MPa.toFixed(0)} MPa, SF_sep=${r.safetyFactors.separation.toFixed(2)}, status=${r.status}`);
    fs.writeFileSync(path.join(ROOT, 'bolt-integration.json'), JSON.stringify(r, null, 2));
    expect(r.preload.F_i_N).toBeGreaterThan(20000);
    expect(r.safetyFactors.separation).toBeGreaterThan(1);
    expect(r.status).toBe('safe');
  });

  test('Spring Design ribbon → Wahl + Sines fatigue', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.locator('.ribbon-tab', { hasText: 'Simulate' }).first().click();
    await page.locator('.ribbon-tool-label', { hasText: /^Spring Design$/ }).first().click();
    await page.waitForFunction(() => !!window.__lastSpringResult, null, { timeout: 30000 });
    const r = await page.evaluate(() => window.__lastSpringResult);
    console.log(`\nSpring: C=${r.geometry.springIndex}, k=${r.rate.k_N_per_mm.toFixed(2)} N/mm, τ_max=${r.stresses.tau_max_MPa.toFixed(0)} MPa, SF=${r.safetyFactors.fatigue_Sines.toFixed(2)}`);
    fs.writeFileSync(path.join(ROOT, 'spring-integration.json'), JSON.stringify(r, null, 2));
    expect(r.rate.k_N_per_mm).toBeCloseTo(1.446, 1);
    expect(r.Wahl).toBeCloseTo(1.145, 2);
    expect(r.bucklingSafe).toBe(true);
  });

  test('Pressure Vessel ribbon → thin + thick + ASME', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.locator('.ribbon-tab', { hasText: 'Simulate' }).first().click();
    await page.locator('.ribbon-tool-label', { hasText: /^Pressure Vessel$/ }).first().click();
    await page.waitForFunction(() => !!window.__lastVesselResult, null, { timeout: 30000 });
    const r = await page.evaluate(() => window.__lastVesselResult);
    console.log(`\nVessel: thin σ_h=${(r.thin.sigma_hoop_Pa/1e6).toFixed(1)} MPa, thick inner σ_h=${(r.thick.inner.sigma_hoop_Pa/1e6).toFixed(0)} MPa, ASME t=${(r.asme.t_with_CA_m*1000).toFixed(2)} mm`);
    fs.writeFileSync(path.join(ROOT, 'vessel-integration.json'), JSON.stringify(r, null, 2));
    expect(r.thin.sigma_hoop_Pa / 1e6).toBeCloseTo(40, 1);
    expect(r.thick.inner.sigma_radial_Pa / 1e6).toBeCloseTo(-124, 1);
    expect(r.asme.t_with_CA_m).toBeGreaterThan(0);
  });
});
