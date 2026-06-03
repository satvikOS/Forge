// v4-285-aashto.spec.js — Forge-285 AASHTO 93 flexible pavement design.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-285-aashto';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const REF = {
  w18Esals: 5e6, reliabilityPct: 95, overallStdDev: 0.45,
  deltaPSI: 1.7, subgradeMrPsi: 5000,
};

test.describe.configure({ timeout: 180000 });
test.describe.serial('Forge-285 · AASHTO 93 flexible pavement', () => {
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
      !!(window.forge && window.forge.aashto
         && typeof window.forge.aashto.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 Reference W=5e6, R=95% → Z_R=-1.645, SN ≈ 5.4 (cam #2)', async () => {
    const r = await page.evaluate((b) => window.forge.aashto.analyse(b), REF);
    expect(r.zR).toBeCloseTo(-1.6449, 3);
    expect(r.logW18).toBeCloseTo(Math.log10(5e6), 6);
    expect(r.structuralNumber).toBeGreaterThan(4.0);
    expect(r.structuralNumber).toBeLessThan(6.0);
    expect(r.iterations).toBeGreaterThan(0);
    expect(r.iterations).toBeLessThan(30);
    await shot(page, 'reference');
  });

  test('03 Higher reliability R=99% bumps SN (cam #3)', async () => {
    const r95 = await page.evaluate((b) => window.forge.aashto.analyse(b), REF);
    const r99 = await page.evaluate((b) => window.forge.aashto.analyse({
      ...b, reliabilityPct: 99,
    }), REF);
    expect(r99.zR).toBeLessThan(r95.zR);
    expect(r99.structuralNumber).toBeGreaterThan(r95.structuralNumber);
    await shot(page, 'high-R');
  });

  test('04 Stiffer subgrade M_R=15k drops SN (cam #4)', async () => {
    const weak = await page.evaluate((b) => window.forge.aashto.analyse(b), REF);
    const stiff = await page.evaluate((b) => window.forge.aashto.analyse({
      ...b, subgradeMrPsi: 15000,
    }), REF);
    expect(stiff.structuralNumber).toBeLessThan(weak.structuralNumber);
    await shot(page, 'stiff-subgrade');
  });

  test('05 Heavier traffic W=5e7 raises SN (cam #5)', async () => {
    const lo = await page.evaluate((b) => window.forge.aashto.analyse(b), REF);
    const hi = await page.evaluate((b) => window.forge.aashto.analyse({
      ...b, w18Esals: 5e7,
    }), REF);
    expect(hi.structuralNumber).toBeGreaterThan(lo.structuralNumber);
    await shot(page, 'heavy-traffic');
  });

  test('06 R=50.5% gives Z_R ≈ 0 (cam #6)', async () => {
    const r = await page.evaluate((b) => window.forge.aashto.analyse({
      ...b, reliabilityPct: 50.5,
    }), REF);
    expect(Math.abs(r.zR)).toBeLessThan(0.05);
    await shot(page, 'R50');
  });

  test('07 Panel renders SN row', async () => {
    await page.evaluate(() => { window.__forgeOpenAashtoPavementWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-aashto-run"]').click();
    await page.waitForSelector('[data-testid="forge-aashto-result"]', { timeout: 5000 });
    const sn = await page.locator('[data-testid="forge-aashto-sn"]').innerText();
    expect(sn).toMatch(/SN =/);
  });

  test('08 Menu route opens AASHTO panel', async () => {
    await page.evaluate(() => { window.__forgeCloseAashtoPavementWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.aashto' } }));
    });
    await page.waitForSelector('[data-testid="forge-aashto-panel"]', { timeout: 2000 });
  });

  test('09 Manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
