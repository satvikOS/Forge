// v4-291-bevelgear.spec.js — Forge-291 bevel gear pair (Tredgold + AGMA).

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-291-bevelgear';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const SHIGLEY = {
  moduleMm: 4, pinionTeeth: 20, gearTeeth: 40,
  faceWidthMm: 25, pressureAngleDeg: 20, pinionTorqueNm: 50,
};

test.describe.configure({ timeout: 180000 });
test.describe.serial('Forge-291 · bevel gear pair', () => {
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
      !!(window.forge && window.forge.bevelgear
         && typeof window.forge.bevelgear.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 Shigley 20/40 → γ_p=26.57°, W_t≈1453 N (cam #2)', async () => {
    const r = await page.evaluate((b) => window.forge.bevelgear.analyse(b), SHIGLEY);
    expect(r.gearRatio).toBeCloseTo(2.0, 6);
    expect(r.pinionConeAngleDeg).toBeCloseTo(Math.atan(0.5) * 180 / Math.PI, 4);
    expect(r.gearConeAngleDeg + r.pinionConeAngleDeg).toBeCloseTo(90, 6);
    expect(r.pinionPitchDiameterMm).toBeCloseTo(80, 6);
    expect(r.gearPitchDiameterMm).toBeCloseTo(160, 6);
    expect(r.coneDistanceMm).toBeCloseTo(Math.sqrt(40*40 + 80*80), 6);
    expect(r.tangentialForceN).toBeGreaterThan(1430);
    expect(r.tangentialForceN).toBeLessThan(1480);
    await shot(page, 'shigley');
  });

  test('03 1:1 ratio: γ_p = γ_g = 45°, W_r = W_a (cam #3)', async () => {
    const r = await page.evaluate(() => window.forge.bevelgear.analyse({
      moduleMm: 4, pinionTeeth: 30, gearTeeth: 30,
      faceWidthMm: 25, pressureAngleDeg: 20, pinionTorqueNm: 50,
    }));
    expect(r.pinionConeAngleDeg).toBeCloseTo(45, 6);
    expect(r.gearConeAngleDeg).toBeCloseTo(45, 6);
    expect(r.radialForceN).toBeCloseTo(r.axialForceN, 4);
    await shot(page, 'one-to-one');
  });

  test('04 W_t ∝ T (linear) (cam #4)', async () => {
    const t50  = await page.evaluate((b) => window.forge.bevelgear.analyse(b), SHIGLEY);
    const t100 = await page.evaluate((b) => window.forge.bevelgear.analyse({
      ...b, pinionTorqueNm: 100,
    }), SHIGLEY);
    expect(t100.tangentialForceN / t50.tangentialForceN).toBeCloseTo(2.0, 6);
    expect(t100.radialForceN     / t50.radialForceN    ).toBeCloseTo(2.0, 6);
    expect(t100.axialForceN      / t50.axialForceN     ).toBeCloseTo(2.0, 6);
    await shot(page, 'torque-scale');
  });

  test('05 W_r/W_t = tan φ · cos γ_p (identity) (cam #5)', async () => {
    const r = await page.evaluate((b) => window.forge.bevelgear.analyse(b), SHIGLEY);
    const tanPhi = Math.tan(20 * Math.PI / 180);
    const expected = tanPhi * Math.cos(Math.atan(0.5));
    expect(r.radialForceN / r.tangentialForceN).toBeCloseTo(expected, 6);
    await shot(page, 'identity');
  });

  test('06 F > R throws (cam #6)', async () => {
    let threw = false;
    try {
      await page.evaluate((b) => window.forge.bevelgear.analyse({
        ...b, faceWidthMm: 200,
      }), SHIGLEY);
    } catch (e) { threw = true; }
    expect(threw).toBe(true);
    await shot(page, 'throw');
  });

  test('07 Panel renders W_t row', async () => {
    await page.evaluate(() => { window.__forgeOpenBevelGearWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-bevelgear-run"]').click();
    await page.waitForSelector('[data-testid="forge-bevelgear-result"]', { timeout: 5000 });
    const W = await page.locator('[data-testid="forge-bevelgear-Wt"]').innerText();
    expect(W).toMatch(/W_t/);
  });

  test('08 Menu route opens bevel gear panel', async () => {
    await page.evaluate(() => { window.__forgeCloseBevelGearWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.bevelgear' } }));
    });
    await page.waitForSelector('[data-testid="forge-bevelgear-panel"]', { timeout: 2000 });
  });

  test('09 Manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
