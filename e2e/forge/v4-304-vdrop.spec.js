// v4-304-vdrop.spec.js — Forge-304 cable voltage drop (NEC 215.2).

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-304-vdrop';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const STD = {
  conductor: 'copper', phaseSystem: 'single',
  crossSectionMm2: 21.15, currentA: 50, oneWayLengthM: 30,
  nominalVoltageV: 240, powerFactor: 1.0,
  conductorTempC: 75, reactancePerMOhm: 0,
};

test.describe.configure({ timeout: 180000 });
test.describe.serial('Forge-304 · voltage drop', () => {
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
      !!(window.forge && window.forge.voltagedrop
         && typeof window.forge.voltagedrop.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 Cu 21.15 mm² 50 A 30 m → 2.97 V, 1.24 % (cam #2)', async () => {
    const r = await page.evaluate((b) => window.forge.voltagedrop.analyse(b), STD);
    expect(r.resistancePerMOhm).toBeCloseTo(9.89e-4, 5);
    expect(r.voltageDropV).toBeGreaterThan(2.96);
    expect(r.voltageDropV).toBeLessThan(2.98);
    expect(r.voltageDropPercent).toBeGreaterThan(1.23);
    expect(r.voltageDropPercent).toBeLessThan(1.25);
    expect(r.meetsFeederLimit).toBe(true);
    expect(r.meetsCombinedLimit).toBe(true);
    await shot(page, 'standard');
  });

  test('03 Three-phase: V_drop = √3·I·Z·L (vs 2·I·Z·L single) (cam #3)', async () => {
    const s = await page.evaluate((b) => window.forge.voltagedrop.analyse(b), STD);
    const t = await page.evaluate((b) => window.forge.voltagedrop.analyse({
      ...b, phaseSystem: 'three',
    }), STD);
    expect(t.voltageDropV / s.voltageDropV).toBeCloseTo(Math.sqrt(3) / 2, 4);
    await shot(page, 'phase');
  });

  test('04 Aluminum has ~1.65× the Cu resistance at 75 °C (cam #4)', async () => {
    const cu = await page.evaluate((b) => window.forge.voltagedrop.analyse(b), STD);
    const al = await page.evaluate((b) => window.forge.voltagedrop.analyse({
      ...b, conductor: 'aluminum',
    }), STD);
    expect(al.resistancePerMOhm / cu.resistancePerMOhm).toBeGreaterThan(1.60);
    expect(al.resistancePerMOhm / cu.resistancePerMOhm).toBeLessThan(1.70);
    expect(al.voltageDropPercent).toBeGreaterThan(cu.voltageDropPercent);
    await shot(page, 'alum');
  });

  test('05 Long run 120 m trips 3 % feeder, passes 5 % combined (cam #5)', async () => {
    const r = await page.evaluate((b) => window.forge.voltagedrop.analyse({
      ...b, oneWayLengthM: 120,
    }), STD);
    expect(r.voltageDropPercent).toBeGreaterThan(3.0);
    expect(r.voltageDropPercent).toBeLessThan(5.0);
    expect(r.meetsFeederLimit).toBe(false);
    expect(r.meetsCombinedLimit).toBe(true);
    await shot(page, 'long-run');
  });

  test('06 P_loss = I²·R·L·N identity (cam #6)', async () => {
    const r = await page.evaluate((b) => window.forge.voltagedrop.analyse(b), STD);
    const calc = 50 * 50 * r.resistancePerMOhm * 30 * 2 / 1000;
    expect(r.powerLossKw).toBeCloseTo(calc, 5);
    await shot(page, 'p-loss');
  });

  test('07 Panel renders drop% + feeder/combined banners', async () => {
    await page.evaluate(() => { window.__forgeOpenVoltageDropWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-vdrop-run"]').click();
    await page.waitForSelector('[data-testid="forge-vdrop-result"]', { timeout: 5000 });
    const pct = await page.locator('[data-testid="forge-vdrop-pct"]').innerText();
    const f   = await page.locator('[data-testid="forge-vdrop-feeder"]').innerText();
    const c   = await page.locator('[data-testid="forge-vdrop-combined"]').innerText();
    expect(pct).toMatch(/Drop/);
    expect(f).toMatch(/Feeder/);
    expect(c).toMatch(/Combined/);
  });

  test('08 Menu route opens vdrop panel', async () => {
    await page.evaluate(() => { window.__forgeCloseVoltageDropWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.voltagedrop' } }));
    });
    await page.waitForSelector('[data-testid="forge-vdrop-panel"]', { timeout: 2000 });
  });

  test('09 Manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
