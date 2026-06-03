// v4-287-prismoidal.spec.js — Forge-287 earthwork prismoidal volume.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-287-prismoidal';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const LIN = {
  lengthM: 20, areaStartM2: 50, areaMiddleM2: 80, areaEndM2: 110,
};

test.describe.configure({ timeout: 180000 });
test.describe.serial('Forge-287 · prismoidal earthwork volume', () => {
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
      !!(window.forge && window.forge.prismoidal
         && typeof window.forge.prismoidal.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 Linear cross-section: V_p = V_AEA = 1600 m³ (cam #2)', async () => {
    const r = await page.evaluate((b) => window.forge.prismoidal.analyse(b), LIN);
    expect(r.prismoidalVolumeM3).toBeCloseTo(1600, 6);
    expect(r.averageEndAreaVolumeM3).toBeCloseTo(1600, 6);
    expect(r.differenceM3).toBeCloseTo(0, 9);
    expect(r.aeaErrorPct).toBeCloseTo(0, 9);
    await shot(page, 'linear');
  });

  test('03 Pyramidal taper: AEA over-estimates (cam #3)', async () => {
    const r = await page.evaluate(() => window.forge.prismoidal.analyse({
      lengthM: 30, areaStartM2: 100, areaMiddleM2: 49, areaEndM2: 0,
    }));
    expect(r.prismoidalVolumeM3).toBeCloseTo(1480, 6);
    expect(r.averageEndAreaVolumeM3).toBeCloseTo(1500, 6);
    expect(r.averageEndAreaVolumeM3).toBeGreaterThan(r.prismoidalVolumeM3);
    await shot(page, 'pyramid');
  });

  test('04 Truncated cone matches frustum closed form exactly (cam #4)', async () => {
    const L = 5, r1 = 1, r2 = 2;
    const r = await page.evaluate((args) => window.forge.prismoidal.analyse({
      lengthM: args.L, areaStartM2: Math.PI * args.r1 * args.r1,
      areaMiddleM2: Math.PI * Math.pow((args.r1 + args.r2) / 2, 2),
      areaEndM2: Math.PI * args.r2 * args.r2,
    }), { L, r1, r2 });
    const Vfrustum = Math.PI * L / 3 * (r1*r1 + r1*r2 + r2*r2);
    expect(r.prismoidalVolumeM3).toBeCloseTo(Vfrustum, 6);
    await shot(page, 'frustum');
  });

  test('05 V scales linearly with length (cam #5)', async () => {
    const short = await page.evaluate((b) => window.forge.prismoidal.analyse(b), LIN);
    const long  = await page.evaluate((b) => window.forge.prismoidal.analyse({
      ...b, lengthM: 40,
    }), LIN);
    expect(long.prismoidalVolumeM3 / short.prismoidalVolumeM3).toBeCloseTo(2.0, 6);
    await shot(page, 'length-scale');
  });

  test('06 Negative area throws (cam #6)', async () => {
    let threw = false;
    try {
      await page.evaluate(() => window.forge.prismoidal.analyse({
        lengthM: 10, areaStartM2: -1, areaMiddleM2: 0, areaEndM2: 0,
      }));
    } catch (e) { threw = true; }
    expect(threw).toBe(true);
    await shot(page, 'throw');
  });

  test('07 Panel renders V row', async () => {
    await page.evaluate(() => { window.__forgeOpenPrismoidalWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-prismoidal-run"]').click();
    await page.waitForSelector('[data-testid="forge-prismoidal-result"]', { timeout: 5000 });
    const V = await page.locator('[data-testid="forge-prismoidal-V"]').innerText();
    expect(V).toMatch(/V =/);
  });

  test('08 Menu route opens prismoidal panel', async () => {
    await page.evaluate(() => { window.__forgeClosePrismoidalWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.prismoidal' } }));
    });
    await page.waitForSelector('[data-testid="forge-prismoidal-panel"]', { timeout: 2000 });
  });

  test('09 Manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
