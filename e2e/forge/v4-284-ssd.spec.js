// v4-284-ssd.spec.js — Forge-284 AASHTO stopping sight distance.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-284-ssd';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const LEVEL = {
  designSpeedKmH: 80, perceptionTimeS: 2.5,
  frictionCoefficient: 0.35, gradePct: 0,
};

test.describe.serial('Forge-284 · stopping sight distance', () => {
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
      !!(window.forge && window.forge.ssd
         && typeof window.forge.ssd.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 80 km/h level → SSD ≈ 127 m (cam #2)', async () => {
    const r = await page.evaluate((b) => window.forge.ssd.analyse(b), LEVEL);
    expect(r.designSpeedMs).toBeCloseTo(80/3.6, 6);
    expect(r.effectiveDecelerationMs2).toBeCloseTo(9.81 * 0.35, 6);
    expect(r.perceptionDistanceM).toBeCloseTo((80/3.6) * 2.5, 6);
    expect(r.totalSsdM).toBeCloseTo(127.4, 0);
    expect(r.totalSsdFt).toBeCloseTo(r.totalSsdM / 0.3048, 6);
    await shot(page, 'level');
  });

  test('03 Downhill -6% extends SSD (cam #3)', async () => {
    const lv = await page.evaluate((b) => window.forge.ssd.analyse(b), LEVEL);
    const dn = await page.evaluate((b) => window.forge.ssd.analyse({
      ...b, gradePct: -6,
    }), LEVEL);
    expect(dn.effectiveDecelerationMs2).toBeLessThan(lv.effectiveDecelerationMs2);
    expect(dn.totalSsdM).toBeGreaterThan(lv.totalSsdM);
    await shot(page, 'downhill');
  });

  test('04 Uphill +6% shortens SSD (cam #4)', async () => {
    const lv = await page.evaluate((b) => window.forge.ssd.analyse(b), LEVEL);
    const up = await page.evaluate((b) => window.forge.ssd.analyse({
      ...b, gradePct: 6,
    }), LEVEL);
    expect(up.totalSsdM).toBeLessThan(lv.totalSsdM);
    await shot(page, 'uphill');
  });

  test('05 100 km/h disproportionately longer than 80 (cam #5)', async () => {
    const v80  = await page.evaluate((b) => window.forge.ssd.analyse(b), LEVEL);
    const v100 = await page.evaluate((b) => window.forge.ssd.analyse({
      ...b, designSpeedKmH: 100,
    }), LEVEL);
    expect(v100.totalSsdM / v80.totalSsdM).toBeGreaterThan(1.4);
    await shot(page, 'higher-speed');
  });

  test('06 a ≤ 0 (steep downhill / low friction) throws (cam #6)', async () => {
    let threw = false;
    try {
      await page.evaluate((b) => window.forge.ssd.analyse({
        ...b, frictionCoefficient: 0.05, gradePct: -10,
      }), LEVEL);
    } catch (e) { threw = true; }
    expect(threw).toBe(true);
    await shot(page, 'throw-a');
  });

  test('07 Panel renders SSD + ft rows', async () => {
    await page.evaluate(() => { window.__forgeOpenStoppingSightDistanceWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-ssd-run"]').click();
    await page.waitForSelector('[data-testid="forge-ssd-result"]', { timeout: 5000 });
    const tot = await page.locator('[data-testid="forge-ssd-total"]').innerText();
    const ft  = await page.locator('[data-testid="forge-ssd-ft"]').innerText();
    expect(tot).toMatch(/SSD/);
    expect(ft).toMatch(/ft/);
  });

  test('08 Menu route opens SSD panel', async () => {
    await page.evaluate(() => { window.__forgeCloseStoppingSightDistanceWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.ssd' } }));
    });
    await page.waitForSelector('[data-testid="forge-ssd-panel"]', { timeout: 2000 });
  });

  test('09 Manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
