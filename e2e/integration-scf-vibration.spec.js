import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'integration');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.describe('Integration: SCF + Forced Vibration via Simulate ribbon', () => {
  test.describe.configure({ timeout: 120000 });
  test.beforeAll(() => ensure(ROOT));

  test('Stress Concentration ribbon → Peterson tables report', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);   // let viewport settle
    await page.locator('.ribbon-tab', { hasText: 'Simulate' }).first().click();
    await page.waitForTimeout(1000);
    await page.locator('.ribbon-tool-label', { hasText: /^Stress Concentration$/ }).first().click();
    await page.waitForFunction(() => !!window.__lastSCFResult, null, { timeout: 30000 });
    await page.waitForTimeout(7000);   // dwell so human sees status-bar values
    const r = await page.evaluate(() => window.__lastSCFResult);
    console.log(`\nSCF: shoulder bend ${r.shoulderFillet.Kt_bend.toFixed(2)}, hole d/W=0.3 ${r.plateHole_d_W_0_3.toFixed(2)}, K_f bend ${r.Kf_shoulder_bend.toFixed(2)}`);
    fs.writeFileSync(path.join(ROOT, 'scf-integration.json'), JSON.stringify(r, null, 2));
    expect(r.shoulderFillet.Kt_bend).toBeGreaterThan(1.5);
    expect(r.plateHole_d_W_0_3).toBeGreaterThan(2);
    expect(r.Kf_shoulder_bend).toBeGreaterThan(1);
    expect(r.Kf_shoulder_bend).toBeLessThan(r.shoulderFillet.Kt_bend);
  });

  test('Forced Vibration ribbon → FRF + transmissibility', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);
    await page.locator('.ribbon-tab', { hasText: 'Simulate' }).first().click();
    await page.waitForTimeout(1000);
    await page.locator('.ribbon-tool-label', { hasText: /^Forced Vibration$/ }).first().click();
    await page.waitForFunction(() => !!window.__lastVibrationResult, null, { timeout: 30000 });
    await page.waitForTimeout(7000);   // dwell so human sees status-bar values
    const r = await page.evaluate(() => window.__lastVibrationResult);
    console.log(`\nVibration: fn=${r.fn_Hz.toFixed(2)} Hz, peak D=${r.peak_magnification.toFixed(1)}, TR@√2=${r.transmissibility_r_sqrt2.toFixed(3)}, ζ_est=${r.halfPower.zeta_check.toFixed(3)}`);
    fs.writeFileSync(path.join(ROOT, 'vibration-integration.json'), JSON.stringify(r, null, 2));
    // Peak D = 1/(2ζ) = 10 exact
    expect(r.peak_magnification).toBeCloseTo(10, 5);
    // Phase at resonance = 90°
    expect(r.peak_phase_deg).toBeCloseTo(90, 5);
    // TR @ r=√2 = 1.0 exact (universal property of SDOF base excitation)
    expect(r.transmissibility_r_sqrt2).toBeCloseTo(1.0, 6);
    // TR @ r=3 < 1 (isolation regime)
    expect(r.transmissibility_r_3).toBeLessThan(1);
    // Half-power back-out should recover ζ
    expect(r.halfPower.zeta_check).toBeCloseTo(r.zeta, 2);
  });
});
