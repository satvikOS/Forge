// v4-299-catenary.spec.js — Forge-299 catenary cable sag-tension.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-299-catenary';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const POWERLINE = {
  spanM: 300, horizontalTensionN: 30000, linearWeightNPerM: 18,
};

test.describe.configure({ timeout: 180000 });
test.describe.serial('Forge-299 · catenary cable', () => {
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
      !!(window.forge && window.forge.catenary
         && typeof window.forge.catenary.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 300 m powerline, H=30 kN, w=18 N/m → sag ≈ 6.75 m, c = H/w (cam #2)', async () => {
    const r = await page.evaluate((b) => window.forge.catenary.analyse(b), POWERLINE);
    expect(r.catenaryParameterM).toBeCloseTo(30000 / 18, 6);
    expect(r.sagM).toBeGreaterThan(6.74);
    expect(r.sagM).toBeLessThan(6.77);
    expect(r.sagParabolicM).toBeCloseTo(18 * 300 * 300 / (8 * 30000), 6);
    await shot(page, 'powerline');
  });

  test('03 T_max identity: T_max = H + w·sag (cam #3)', async () => {
    const r = await page.evaluate((b) => window.forge.catenary.analyse(b), POWERLINE);
    const Tcheck = 30000 + 18 * r.sagM;
    expect(r.maxTensionN).toBeCloseTo(Tcheck, 3);
    await shot(page, 't-identity');
  });

  test('04 Higher tension → smaller sag (sag ∝ 1/H) (cam #4)', async () => {
    const r1 = await page.evaluate((b) => window.forge.catenary.analyse(b), POWERLINE);
    const r2 = await page.evaluate((b) => window.forge.catenary.analyse({
      ...b, horizontalTensionN: 60000,
    }), POWERLINE);
    expect(r2.sagParabolicM).toBeCloseTo(r1.sagParabolicM / 2, 4);
    expect(r2.sagM).toBeLessThan(r1.sagM);
    await shot(page, 'higher-H');
  });

  test('05 Doubled span → 4× sag (sag ∝ L²) parabolic limit (cam #5)', async () => {
    const r1 = await page.evaluate((b) => window.forge.catenary.analyse(b), POWERLINE);
    const r2 = await page.evaluate((b) => window.forge.catenary.analyse({
      ...b, spanM: 600,
    }), POWERLINE);
    expect(r2.sagParabolicM).toBeCloseTo(4 * r1.sagParabolicM, 4);
    await shot(page, 'doubled-span');
  });

  test('06 Cable length > span (sag adds slack) (cam #6)', async () => {
    const r = await page.evaluate((b) => window.forge.catenary.analyse(b), POWERLINE);
    expect(r.cableLengthM).toBeGreaterThan(300);
    expect(r.cableLengthM).toBeLessThan(301);  // 0.15 m extra at 2.25% sag
    expect(r.cableLengthParabolicM).toBeCloseTo(r.cableLengthM, 2);
    await shot(page, 'slack');
  });

  test('07 Panel renders sag + T_max + ratio rows', async () => {
    await page.evaluate(() => { window.__forgeOpenCatenaryWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-catenary-run"]').click();
    await page.waitForSelector('[data-testid="forge-catenary-result"]', { timeout: 5000 });
    const sag   = await page.locator('[data-testid="forge-catenary-sag"]').innerText();
    const T     = await page.locator('[data-testid="forge-catenary-T"]').innerText();
    const ratio = await page.locator('[data-testid="forge-catenary-ratio"]').innerText();
    expect(sag).toMatch(/sag/);
    expect(T).toMatch(/T_max/);
    expect(ratio).toMatch(/s\/L/);
  });

  test('08 Menu route opens catenary panel', async () => {
    await page.evaluate(() => { window.__forgeCloseCatenaryWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.catenary' } }));
    });
    await page.waitForSelector('[data-testid="forge-catenary-panel"]', { timeout: 2000 });
  });

  test('09 Manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
