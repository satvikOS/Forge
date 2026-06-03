// v4-268-anchorbolt.spec.js — Forge-268 anchor bolt tension (ACI 318-19 Ch.17).

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-268-anchorbolt';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-268 · anchor bolt tension capacity', () => {
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

  test('01 kernel bridge wired (cam #1 baseline)', async () => {
    await shot(page, 'baseline');
    const has = await page.evaluate(() =>
      !!(window.forge && window.forge.anchorbolt
         && typeof window.forge.anchorbolt.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 Reference cast-in 150 mm h_ef, 30 MPa concrete, remote edge (cam #2)', async () => {
    const r = await page.evaluate(() => window.forge.anchorbolt.analyse({
      effectiveTensileAreaMm2: 283, steelUltimateMPa: 830, steelYieldMPa: 660,
      embedmentDepthMm: 150, concreteStrengthMPa: 30,
      minEdgeDistanceMm: 300, bearingAreaMm2: 287,
      lambdaLightweight: 1.0, crackedConcrete: true, castInAnchor: true,
    }));
    expect(r.cappedFutaMPa).toBeCloseTo(830, 1);
    expect(r.phiSteelN).toBeCloseTo(176167.5, 0);
    expect(r.aNcMm2).toBeCloseTo(r.aNcoMm2, 0);
    expect(r.psiEdN).toBeCloseTo(1.0, 9);
    expect(r.governingMode).toBe('pullout');
    await shot(page, 'reference');
  });

  test('03 Edge effect: c_a,min < 1.5·h_ef reduces breakout (cam #3)', async () => {
    const r = await page.evaluate(() => window.forge.anchorbolt.analyse({
      effectiveTensileAreaMm2: 283, steelUltimateMPa: 830, steelYieldMPa: 660,
      embedmentDepthMm: 150, concreteStrengthMPa: 30,
      minEdgeDistanceMm: 100, bearingAreaMm2: 287,
      lambdaLightweight: 1.0, crackedConcrete: true, castInAnchor: true,
    }));
    expect(r.psiEdN).toBeCloseTo(0.7 + 0.3 * 100 / 225, 6);
    expect(r.aNcMm2).toBeLessThan(r.aNcoMm2);
    expect(r.governingMode).toBe('breakout');
    await shot(page, 'edge-near');
  });

  test('04 Uncracked concrete: +25% breakout, +40% pullout (cam #4)', async () => {
    const cracked = await page.evaluate(() => window.forge.anchorbolt.analyse({
      effectiveTensileAreaMm2: 283, steelUltimateMPa: 830, steelYieldMPa: 660,
      embedmentDepthMm: 150, concreteStrengthMPa: 30,
      minEdgeDistanceMm: 300, bearingAreaMm2: 287,
      lambdaLightweight: 1.0, crackedConcrete: true, castInAnchor: true,
    }));
    const uncracked = await page.evaluate(() => window.forge.anchorbolt.analyse({
      effectiveTensileAreaMm2: 283, steelUltimateMPa: 830, steelYieldMPa: 660,
      embedmentDepthMm: 150, concreteStrengthMPa: 30,
      minEdgeDistanceMm: 300, bearingAreaMm2: 287,
      lambdaLightweight: 1.0, crackedConcrete: false, castInAnchor: true,
    }));
    expect(uncracked.breakoutNominalN / cracked.breakoutNominalN).toBeCloseTo(1.25, 4);
    expect(uncracked.pulloutNominalN  / cracked.pulloutNominalN ).toBeCloseTo(1.4 , 4);
    await shot(page, 'uncracked');
  });

  test('05 Post-installed: k_c=7 → 70% of cast-in N_b (cam #5)', async () => {
    const cast = await page.evaluate(() => window.forge.anchorbolt.analyse({
      effectiveTensileAreaMm2: 283, steelUltimateMPa: 830, steelYieldMPa: 660,
      embedmentDepthMm: 150, concreteStrengthMPa: 30,
      minEdgeDistanceMm: 300, bearingAreaMm2: 287,
      lambdaLightweight: 1.0, crackedConcrete: true, castInAnchor: true,
    }));
    const post = await page.evaluate(() => window.forge.anchorbolt.analyse({
      effectiveTensileAreaMm2: 283, steelUltimateMPa: 830, steelYieldMPa: 660,
      embedmentDepthMm: 150, concreteStrengthMPa: 30,
      minEdgeDistanceMm: 300, bearingAreaMm2: 287,
      lambdaLightweight: 1.0, crackedConcrete: true, castInAnchor: false,
    }));
    expect(post.nBN / cast.nBN).toBeCloseTo(0.7, 6);
    await shot(page, 'post-installed');
  });

  test('06 f_uta capped at min(input, 1.9·f_ya, 860) (cam #6)', async () => {
    const r = await page.evaluate(() => window.forge.anchorbolt.analyse({
      effectiveTensileAreaMm2: 283,
      steelUltimateMPa: 2000,  // huge - should be capped
      steelYieldMPa:    400,   // 1.9·400 = 760 → governs cap
      embedmentDepthMm: 150, concreteStrengthMPa: 30,
      minEdgeDistanceMm: 300, bearingAreaMm2: 287,
      lambdaLightweight: 1.0, crackedConcrete: true, castInAnchor: true,
    }));
    expect(r.cappedFutaMPa).toBeCloseTo(760, 4);
    await shot(page, 'cap');
  });

  test('07 Panel renders governing + mode rows', async () => {
    await page.evaluate(() => { window.__forgeOpenAnchorBoltWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-anchorbolt-run"]').click();
    await page.waitForSelector('[data-testid="forge-anchorbolt-result"]', { timeout: 5000 });
    const gov  = await page.locator('[data-testid="forge-anchorbolt-governing"]').innerText();
    const mode = await page.locator('[data-testid="forge-anchorbolt-mode"]').innerText();
    expect(gov).toMatch(/φN_n/);
    expect(mode).toMatch(/Governs/);
  });

  test('08 Menu route opens anchor bolt panel', async () => {
    await page.evaluate(() => { window.__forgeCloseAnchorBoltWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.anchorbolt' } }));
    });
    await page.waitForSelector('[data-testid="forge-anchorbolt-panel"]', { timeout: 2000 });
  });

  test('09 Manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
