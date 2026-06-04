// v4-297-consol.spec.js — Forge-297 1D consolidation (Terzaghi).

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-297-consol';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const CLAY = {
  soilDepthM: 6, doubleDrainage: false,
  coefficientOfConsolidationM2yr: 2,
  volumeCompressibilityM2MN: 0.5,
  pressureIncreaseKPa: 100,
  timeYears: 10,
};

test.describe.configure({ timeout: 180000 });
test.describe.serial('Forge-297 · 1D consolidation', () => {
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
      !!(window.forge && window.forge.consol
         && typeof window.forge.consol.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 6 m clay single drainage at t=10 yr (cam #2)', async () => {
    const r = await page.evaluate((b) => window.forge.consol.analyse(b), CLAY);
    expect(r.drainagePathM).toBeCloseTo(6, 6);
    expect(r.timeFactor).toBeCloseTo(2 * 10 / 36, 6);
    expect(r.ultimateSettlementMm).toBeCloseTo(300, 4);
    expect(r.degreeOfConsolidationPct).toBeGreaterThan(75);
    expect(r.degreeOfConsolidationPct).toBeLessThan(85);
    expect(r.settlementAtTimeMm).toBeGreaterThan(220);
    expect(r.settlementAtTimeMm).toBeLessThan(250);
    expect(r.t90Years).toBeCloseTo(0.848 * 36 / 2, 4);
    await shot(page, 'single-drain');
  });

  test('03 Double drainage 4× faster t_90 (cam #3)', async () => {
    const single = await page.evaluate((b) => window.forge.consol.analyse(b), CLAY);
    const dbl    = await page.evaluate((b) => window.forge.consol.analyse({
      ...b, doubleDrainage: true,
    }), CLAY);
    expect(dbl.drainagePathM).toBeCloseTo(3, 6);
    expect(dbl.t90Years / single.t90Years).toBeCloseTo(0.25, 6);
    expect(dbl.degreeOfConsolidation).toBeGreaterThan(single.degreeOfConsolidation);
    expect(dbl.ultimateSettlementMm).toBeCloseTo(single.ultimateSettlementMm, 4);
    await shot(page, 'double-drain');
  });

  test('04 At t = t_90, U ≈ 90% (cam #4)', async () => {
    const base = await page.evaluate((b) => window.forge.consol.analyse(b), CLAY);
    const at90 = await page.evaluate((b) => window.forge.consol.analyse({
      ...b, timeYears: base.t90Years,
    }), { ...CLAY, t90: undefined });
    expect(at90.degreeOfConsolidationPct).toBeCloseTo(90, 0);
    await shot(page, 'at-t90');
  });

  test('05 S_∞ ∝ Δσ\' (linear) (cam #5)', async () => {
    const a = await page.evaluate((b) => window.forge.consol.analyse(b), CLAY);
    const b = await page.evaluate((c) => window.forge.consol.analyse({
      ...c, pressureIncreaseKPa: 200,
    }), CLAY);
    expect(b.ultimateSettlementMm / a.ultimateSettlementMm).toBeCloseTo(2.0, 6);
    await shot(page, 'pressure-scale');
  });

  test('06 t → ∞ ⇒ U → 1 (cam #6)', async () => {
    const r = await page.evaluate((b) => window.forge.consol.analyse({
      ...b, timeYears: 100,
    }), CLAY);
    expect(r.degreeOfConsolidation).toBeGreaterThan(0.99);
    expect(r.settlementAtTimeMm).toBeCloseTo(r.ultimateSettlementMm, 1);
    await shot(page, 'long-time');
  });

  test('07 Panel renders S(t) + U rows', async () => {
    await page.evaluate(() => { window.__forgeOpenConsolidationWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-consol-run"]').click();
    await page.waitForSelector('[data-testid="forge-consol-result"]', { timeout: 5000 });
    const U = await page.locator('[data-testid="forge-consol-U"]').innerText();
    const S = await page.locator('[data-testid="forge-consol-S"]').innerText();
    expect(U).toMatch(/U/);
    expect(S).toMatch(/S\(t\)/);
  });

  test('08 Menu route opens consolidation panel', async () => {
    await page.evaluate(() => { window.__forgeCloseConsolidationWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.consol' } }));
    });
    await page.waitForSelector('[data-testid="forge-consol-panel"]', { timeout: 2000 });
  });

  test('09 Manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
