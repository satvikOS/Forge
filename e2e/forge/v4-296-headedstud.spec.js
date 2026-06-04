// v4-296-headedstud.spec.js — Forge-296 headed shear stud connector.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-296-headedstud';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const REF = {
  studDiameterMm: 19, concreteStrengthMPa: 28,
  concreteUnitWeightKgM3: 2400, studUltimateStressMPa: 415,
  groupFactorRg: 1.0, positionFactorRp: 0.75,
  studCount: 100, requiredHorizShearKN: 5000,
};

test.describe.configure({ timeout: 180000 });
test.describe.serial('Forge-296 · headed shear stud', () => {
  let app, page;

  test.beforeAll(async () => {
    app = await _electron.launch({
      args: [ELECTRON_MAIN, '--no-sandbox'],
      env: { ...process.env, FORGE_E2E: '1' },
      timeout: 150000,
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3500);
    await page.evaluate(() => {
      document.querySelectorAll('[data-testid="forge-tour-tooltip"]').forEach((n) => n.remove());
      document.querySelectorAll('[data-testid="forge-tour-overlay"]').forEach((n) => n.remove());
    });
  });
  test.afterAll(async () => {
    if (!app) return;
    try { await Promise.race([app.close(), new Promise((r) => setTimeout(r, 4000))]); }
    catch (e) { /* ignore */ }
    try { app.process()?.kill('SIGKILL'); } catch (e) { /* ignore */ }
  });

  test('01 kernel bridge wired (cam #1 baseline)', async () => {
    await shot(page, 'baseline');
    const has = await page.evaluate(() =>
      !!(window.forge && window.forge.headedstud
         && typeof window.forge.headedstud.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 19 mm A108 in 28 MPa NW conc: steel governs, DCR≈0.57 (cam #2)', async () => {
    const r = await page.evaluate((b) => window.forge.headedstud.analyse(b), REF);
    expect(r.studAreaMm2).toBeCloseTo(Math.PI * 19 * 19 / 4, 4);
    expect(r.qNominalSteelN).toBeLessThan(r.qNominalConcreteN);
    expect(r.qNominalSingleN).toBeCloseTo(r.qNominalSteelN, 6);
    expect(r.totalCapacityKN).toBeCloseTo(r.qNominalSingleN * 100 / 1000, 6);
    expect(r.demandCapacityRatio).toBeGreaterThan(0.55);
    expect(r.demandCapacityRatio).toBeLessThan(0.60);
    expect(r.passes).toBe(true);
    await shot(page, 'reference');
  });

  test('03 Stronger concrete: steel still governs (cam #3)', async () => {
    const lo = await page.evaluate((b) => window.forge.headedstud.analyse(b), REF);
    const hi = await page.evaluate((b) => window.forge.headedstud.analyse({
      ...b, concreteStrengthMPa: 45,
    }), REF);
    expect(hi.qNominalConcreteN).toBeGreaterThan(lo.qNominalConcreteN);
    expect(hi.totalCapacityKN).toBeCloseTo(lo.totalCapacityKN, 4);
    await shot(page, 'strong-conc');
  });

  test('04 d=22 mm: A scales d² (cam #4)', async () => {
    const d19 = await page.evaluate((b) => window.forge.headedstud.analyse(b), REF);
    const d22 = await page.evaluate((b) => window.forge.headedstud.analyse({
      ...b, studDiameterMm: 22,
    }), REF);
    expect(d22.studAreaMm2 / d19.studAreaMm2).toBeCloseTo((22/19)**2, 6);
    expect(d22.totalCapacityKN).toBeGreaterThan(d19.totalCapacityKN);
    await shot(page, 'bigger-stud');
  });

  test('05 Overload V_h=12000 kN fails (cam #5)', async () => {
    const r = await page.evaluate((b) => window.forge.headedstud.analyse({
      ...b, requiredHorizShearKN: 12000,
    }), REF);
    expect(r.demandCapacityRatio).toBeGreaterThan(1.0);
    expect(r.passes).toBe(false);
    await shot(page, 'overload');
  });

  test('06 Solid slab R_p=1.0 raises Q_steel (cam #6)', async () => {
    const deck  = await page.evaluate((b) => window.forge.headedstud.analyse(b), REF);
    const solid = await page.evaluate((b) => window.forge.headedstud.analyse({
      ...b, positionFactorRp: 1.0,
    }), REF);
    expect(solid.qNominalSteelN / deck.qNominalSteelN).toBeCloseTo(1/0.75, 6);
    await shot(page, 'solid-slab');
  });

  test('07 Panel renders Q_n + pass row', async () => {
    await page.evaluate(() => { window.__forgeOpenHeadedStudWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-headedstud-run"]').click();
    await page.waitForSelector('[data-testid="forge-headedstud-result"]', { timeout: 5000 });
    const Qn = await page.locator('[data-testid="forge-headedstud-Qn"]').innerText();
    const pass = await page.locator('[data-testid="forge-headedstud-pass"]').innerText();
    expect(Qn).toMatch(/Q_n/);
    expect(pass).toMatch(/Studs/);
  });

  test('08 Menu route opens headed stud panel', async () => {
    await page.evaluate(() => { window.__forgeCloseHeadedStudWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.headedstud' } }));
    });
    await page.waitForSelector('[data-testid="forge-headedstud-panel"]', { timeout: 2000 });
  });

  test('09 Manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
