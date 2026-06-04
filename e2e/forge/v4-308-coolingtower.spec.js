// v4-308-coolingtower.spec.js — Forge-308 cooling tower performance.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-308-coolingtower';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const STD = {
  waterFlowLps: 100, inletTempC: 35, outletTempC: 30, wetBulbTempC: 24,
  cyclesOfConcentration: 4, driftFraction: 2e-5,
};

test.describe.configure({ timeout: 180000 });
test.describe.serial('Forge-308 · cooling tower', () => {
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
      !!(window.forge && window.forge.coolingtower
         && typeof window.forge.coolingtower.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 100 L/s, 35→30, T_wb=24: Q_rej=2093, makeup=1.15% (cam #2)', async () => {
    const r = await page.evaluate((b) => window.forge.coolingtower.analyse(b), STD);
    expect(r.rangeK).toBeCloseTo(5, 6);
    expect(r.approachK).toBeCloseTo(6, 6);
    expect(r.heatRejectionKw).toBeCloseTo(100 * 4.186 * 5, 2);
    expect(r.evaporationPercent).toBeGreaterThan(0.85);
    expect(r.evaporationPercent).toBeLessThan(0.87);
    expect(r.makeupPercent).toBeGreaterThan(1.14);
    expect(r.makeupPercent).toBeLessThan(1.16);
    await shot(page, 'standard');
  });

  test('03 Bleed = Evap / (CoC − 1) identity (cam #3)', async () => {
    const r = await page.evaluate((b) => window.forge.coolingtower.analyse(b), STD);
    expect(r.bleedLps).toBeCloseTo(r.evaporationLps / 3.0, 6);
    await shot(page, 'bleed');
  });

  test('04 Doubled range → doubled evap (cam #4)', async () => {
    const r1 = await page.evaluate((b) => window.forge.coolingtower.analyse(b), STD);
    const r2 = await page.evaluate((b) => window.forge.coolingtower.analyse({
      ...b, inletTempC: 40,
    }), STD);
    expect(r2.rangeK).toBe(10);
    expect(r2.evaporationLps / r1.evaporationLps).toBeCloseTo(2.0, 5);
    expect(r2.heatRejectionKw / r1.heatRejectionKw).toBeCloseTo(2.0, 5);
    await shot(page, 'doubled-range');
  });

  test('05 CoC=6 drops bleed to 0.6× of CoC=4 (cam #5)', async () => {
    const c4 = await page.evaluate((b) => window.forge.coolingtower.analyse(b), STD);
    const c6 = await page.evaluate((b) => window.forge.coolingtower.analyse({
      ...b, cyclesOfConcentration: 6,
    }), STD);
    expect(c6.bleedLps / c4.bleedLps).toBeCloseTo(3/5, 4);  // (CoC-1) ratio = 5/3 inverted
    await shot(page, 'CoC');
  });

  test('06 Inverted ΔT throws (cam #6)', async () => {
    const err = await page.evaluate(() => {
      try { window.forge.coolingtower.analyse({
        waterFlowLps: 100, inletTempC: 30, outletTempC: 35, wetBulbTempC: 24,
        cyclesOfConcentration: 4, driftFraction: 2e-5,
      }); return null; }
      catch (e) { return String(e.message || e); }
    });
    expect(err).toMatch(/inletTempC.*outletTempC|range/);
    await shot(page, 'rejected');
  });

  test('07 Panel renders Q_rej + approach + makeup rows', async () => {
    await page.evaluate(() => { window.__forgeOpenCoolingTowerWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-ct-run"]').click();
    await page.waitForSelector('[data-testid="forge-ct-result"]', { timeout: 5000 });
    const Q  = await page.locator('[data-testid="forge-ct-Q"]').innerText();
    const ap = await page.locator('[data-testid="forge-ct-approach"]').innerText();
    const mk = await page.locator('[data-testid="forge-ct-makeup"]').innerText();
    expect(Q).toMatch(/Q_rej/);
    expect(ap).toMatch(/Approach/);
    expect(mk).toMatch(/Make-up/);
  });

  test('08 Menu route opens cooling tower panel', async () => {
    await page.evaluate(() => { window.__forgeCloseCoolingTowerWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.coolingtower' } }));
    });
    await page.waitForSelector('[data-testid="forge-ct-panel"]', { timeout: 2000 });
  });

  test('09 Manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
