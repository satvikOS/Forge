// v4-247-symcomp.spec.js — Forge-247 symmetrical components + fault.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-247-symcomp';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-247 · symmetrical components', () => {
  let app, page;

  test.beforeAll(async () => {
    app = await _electron.launch({
      args: [ELECTRON_MAIN, '--no-sandbox'],
      env: { ...process.env, FORGE_E2E: '1' },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3500);
    await page.evaluate(() => {
      document.querySelectorAll('[data-testid="forge-tour-tooltip"]').forEach((n) => n.remove());
      document.querySelectorAll('[data-testid="forge-tour-overlay"]').forEach((n) => n.remove());
    });
  });
  test.afterAll(async () => { if (app) await app.close(); });

  test('01 kernel bridge wired', async () => {
    await shot(page, 'baseline');
    const has = await page.evaluate(() =>
      !!(window.forge && window.forge.symcomp
         && typeof window.forge.symcomp.decompose === 'function'
         && typeof window.forge.symcomp.compose === 'function'
         && typeof window.forge.symcomp.faultCurrents === 'function'));
    expect(has).toBe(true);
  });

  test('02 balanced 3-φ → only V_+ nonzero (cam #1)', async () => {
    const r = await page.evaluate(() => window.forge.symcomp.decompose({
      Va: { magnitude: 1, angleDeg: 0 },
      Vb: { magnitude: 1, angleDeg: -120 },
      Vc: { magnitude: 1, angleDeg: 120 },
    }));
    expect(r.zero.magnitude).toBeLessThan(1e-9);
    expect(r.positive.magnitude).toBeCloseTo(1.0, 9);
    expect(r.negative.magnitude).toBeLessThan(1e-9);
    await shot(page, 'balanced');
  });

  test('03 unbalanced fixture (Stevenson) → V_+ = V_− = 1/√3 (cam #2)', async () => {
    const r = await page.evaluate(() => window.forge.symcomp.decompose({
      Va: { magnitude: 1, angleDeg: 0 },
      Vb: { magnitude: 1, angleDeg: 180 },
      Vc: { magnitude: 0, angleDeg: 0 },
    }));
    expect(r.zero.magnitude).toBeLessThan(1e-9);
    expect(r.positive.magnitude).toBeCloseTo(1 / Math.sqrt(3), 6);
    expect(r.positive.angleDeg).toBeCloseTo(-30, 6);
    expect(r.negative.magnitude).toBeCloseTo(1 / Math.sqrt(3), 6);
    expect(r.negative.angleDeg).toBeCloseTo(30, 6);
    await shot(page, 'unbalanced');
  });

  test('04 decompose → compose round-trip (cam #3)', async () => {
    const Vabc = {
      Va: { magnitude: 1.0, angleDeg: 0 },
      Vb: { magnitude: 0.8, angleDeg: -130 },
      Vc: { magnitude: 0.9, angleDeg: 115 },
    };
    const seq = await page.evaluate((v) => window.forge.symcomp.decompose(v), Vabc);
    const rt = await page.evaluate((s) => window.forge.symcomp.compose(s), seq);
    expect(rt.Va.magnitude).toBeCloseTo(Vabc.Va.magnitude, 6);
    expect(rt.Vb.magnitude).toBeCloseTo(Vabc.Vb.magnitude, 6);
    expect(rt.Vc.magnitude).toBeCloseTo(Vabc.Vc.magnitude, 6);
    await shot(page, 'round-trip');
  });

  test('05 fault currents (Z₀=j0.10, Z₁=Z₂=j0.15) (cam #4)', async () => {
    const r = await page.evaluate(() => window.forge.symcomp.faultCurrents({
      prefaultPhaseVoltage: 1.0,
      Z0_magnitude: 0.10, Z0_angleDeg: 90,
      Z1_magnitude: 0.15, Z1_angleDeg: 90,
      Z2_magnitude: 0.15, Z2_angleDeg: 90,
    }));
    expect(r.threePhaseFaultI).toBeCloseTo(6.667, 2);
    expect(r.lineToGroundFaultI).toBeCloseTo(7.5, 2);
    expect(r.lineToLineFaultI).toBeCloseTo(Math.sqrt(3) / 0.3, 4);
    await shot(page, 'fault');
  });

  test('06 LG > 3φ > LL ordering for this fixture', async () => {
    const r = await page.evaluate(() => window.forge.symcomp.faultCurrents({
      prefaultPhaseVoltage: 1.0,
      Z0_magnitude: 0.10, Z0_angleDeg: 90,
      Z1_magnitude: 0.15, Z1_angleDeg: 90,
      Z2_magnitude: 0.15, Z2_angleDeg: 90,
    }));
    expect(r.lineToGroundFaultI).toBeGreaterThan(r.threePhaseFaultI);
    expect(r.threePhaseFaultI).toBeGreaterThan(r.lineToLineFaultI);
  });

  test('07 panel renders V₀/V₊/V₋ rows + I_3φ/I_LG/I_LL rows (cam #5)', async () => {
    await page.evaluate(() => { window.__forgeOpenSymCompWorkbench?.(); });
    await page.waitForTimeout(300);
    // Tab 1: decompose.
    await page.locator('[data-testid="forge-symcomp-run"]').click();
    await page.waitForSelector('[data-testid="forge-symcomp-Vplus"]', { timeout: 5000 });
    // Tab 2: fault.
    await page.locator('[data-testid="forge-symcomp-tab-fault"]').click();
    await page.locator('[data-testid="forge-symcomp-run"]').click();
    await page.waitForSelector('[data-testid="forge-symcomp-ILG"]', { timeout: 5000 });
    const lg = await page.locator('[data-testid="forge-symcomp-ILG"]').innerText();
    expect(lg).toMatch(/I_LG/);
    expect(lg).toMatch(/p.u./);
    await shot(page, 'panel');
  });

  test('08 menu route fires symcomp workbench', async () => {
    await page.evaluate(() => { window.__forgeCloseSymCompWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.symcomp' } }));
    });
    await page.waitForSelector('[data-testid="forge-symcomp-panel"]', { timeout: 2000 });
  });

  test('09 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
