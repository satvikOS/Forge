import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'integration');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.describe('Integration: machine elements via Simulate ribbon', () => {
  test.describe.configure({ timeout: 120000 });
  test.beforeAll(() => ensure(ROOT));

  test('Bearing Life ribbon → L10 hours', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.locator('.ribbon-tab', { hasText: 'Simulate' }).first().click();
    await page.locator('.ribbon-tool-label', { hasText: /^Bearing Life$/ }).first().click();
    await page.waitForFunction(() => !!window.__lastBearingResult, null, { timeout: 30000 });
    const r = await page.evaluate(() => window.__lastBearingResult);
    console.log(`\nBearing: P=${r.equivalent.P_kN.toFixed(2)} kN, L10=${r.life.L10_hours.toFixed(0)} hrs, Hertz=${(r.hertz.p_max_Pa/1e6).toFixed(0)} MPa`);
    fs.writeFileSync(path.join(ROOT, 'bearing-integration.json'), JSON.stringify(r, null, 2));
    expect(r.life.L10_hours).toBeGreaterThan(100);
    expect(r.life.L10_hours).toBeLessThan(100000);
    expect(r.hertz.p_max_Pa).toBeGreaterThan(1e8);
  });

  test('Gear Mesh ribbon → AGMA bending + contact', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.locator('.ribbon-tab', { hasText: 'Simulate' }).first().click();
    await page.locator('.ribbon-tool-label', { hasText: /^Gear Mesh$/ }).first().click();
    await page.waitForFunction(() => !!window.__lastGearResult, null, { timeout: 30000 });
    const r = await page.evaluate(() => window.__lastGearResult);
    console.log(`\nGear: d=${r.geometry.pitchDiameter_mm} mm, σ_b=${r.bending.sigma_bending_MPa.toFixed(2)} MPa, σ_c=${r.contact.sigma_contact_MPa.toFixed(0)} MPa, status: ${r.status}`);
    fs.writeFileSync(path.join(ROOT, 'gear-integration.json'), JSON.stringify(r, null, 2));
    expect(r.geometry.pitchDiameter_mm).toBeCloseTo(102, 0);
    expect(r.safetyFactors.bending).toBeGreaterThan(2);
    expect(r.status).toBe('safe');
  });

  test('Shaft Sizing ribbon → DE-Goodman + ASME elliptic', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.locator('.ribbon-tab', { hasText: 'Simulate' }).first().click();
    await page.locator('.ribbon-tool-label', { hasText: /^Shaft Sizing$/ }).first().click();
    await page.waitForFunction(() => !!window.__lastShaftResult, null, { timeout: 30000 });
    const r = await page.evaluate(() => window.__lastShaftResult);
    console.log(`\nShaft: DE-Goodman ${r.goodman.diameter_mm.toFixed(2)} mm, ASME ${r.asme.diameter_mm.toFixed(2)} mm, σ_VM@22mm = ${r.stat.sigma_von_mises_MPa.toFixed(1)} MPa`);
    fs.writeFileSync(path.join(ROOT, 'shaft-integration.json'), JSON.stringify(r, null, 2));
    expect(r.goodman.diameter_mm).toBeGreaterThan(15);
    expect(r.goodman.diameter_mm).toBeLessThan(35);
    expect(r.asme.diameter_mm).toBeLessThan(r.goodman.diameter_mm * 1.1);
  });
});
