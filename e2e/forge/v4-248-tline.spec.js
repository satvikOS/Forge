// v4-248-tline.spec.js — Forge-248 transmission line ABCD.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-248-tline';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const PARAMS = {
  resistancePerKmOhm: 0.16, reactancePerKmOhm: 0.5,
  conductancePerKmS: 0, susceptancePerKmS: 3e-6,
  lengthKm: 200,
};
const LOAD = {
  receivingPhaseVoltageV: 127017, receivingPowerW: 50e6,
  receivingPowerFactor: 0.85, leading: false,
};

test.describe.serial('Forge-248 · transmission line ABCD', () => {
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

  test('01 kernel bridge wired', async () => {
    await shot(page, 'baseline');
    const has = await page.evaluate(() =>
      !!(window.forge && window.forge.tline
         && typeof window.forge.tline.abcd === 'function'
         && typeof window.forge.tline.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 short-line ABCD: A=D=1, C=0, |B|=|Z| (cam #1)', async () => {
    const r = await page.evaluate((p) => window.forge.tline.abcd({
      model: 'short', params: p,
    }), PARAMS);
    expect(r.A_mag).toBeCloseTo(1.0, 9);
    expect(r.D_mag).toBeCloseTo(1.0, 9);
    expect(r.C_mag).toBeLessThan(1e-9);
    expect(r.B_mag).toBeCloseTo(Math.sqrt(32 * 32 + 100 * 100), 6);
    await shot(page, 'short');
  });

  test('03 medium-π ABCD: A = D = 1 + YZ/2 (cam #2)', async () => {
    const r = await page.evaluate((p) => window.forge.tline.abcd({
      model: 'mediumPi', params: p,
    }), PARAMS);
    expect(r.A_mag).toBeCloseTo(0.9700, 3);
    expect(r.A_ang).toBeCloseTo(0.567, 1);
    expect(r.D_mag).toBeCloseTo(r.A_mag, 9);
    expect(r.D_ang).toBeCloseTo(r.A_ang, 9);
    await shot(page, 'mediumPi');
  });

  test('04 long-line A approaches medium-π A for 200 km (cam #3)', async () => {
    const mp = await page.evaluate((p) => window.forge.tline.abcd({
      model: 'mediumPi', params: p,
    }), PARAMS);
    const lg = await page.evaluate((p) => window.forge.tline.abcd({
      model: 'long', params: p,
    }), PARAMS);
    expect(Math.abs(lg.A_mag - mp.A_mag) / mp.A_mag).toBeLessThan(0.005);
    await shot(page, 'long-vs-medium');
  });

  test('05 analyse: |V_S| > |V_R| at lag pf (cam #4)', async () => {
    const r = await page.evaluate((args) => window.forge.tline.analyse(args),
      { model: 'mediumPi', params: PARAMS, load: LOAD });
    expect(r.sendingVoltageV).toBeGreaterThan(LOAD.receivingPhaseVoltageV);
    expect(r.regulationPct).toBeGreaterThan(0);
    expect(r.efficiency).toBeGreaterThan(0.7);
    expect(r.efficiency).toBeLessThanOrEqual(1.0);
    await shot(page, 'analyse');
  });

  test('06 lead PF can reduce regulation (cam #5)', async () => {
    const lag = await page.evaluate((args) => window.forge.tline.analyse(args),
      { model: 'mediumPi', params: PARAMS, load: LOAD });
    const lead = await page.evaluate((args) => window.forge.tline.analyse(args),
      { model: 'mediumPi', params: PARAMS,
        load: { ...LOAD, leading: true }});
    expect(lead.regulationPct).toBeLessThan(lag.regulationPct);
    await shot(page, 'lead-lag');
  });

  test('07 panel renders ABCD + |V_S| + reg + η rows', async () => {
    await page.evaluate(() => { window.__forgeOpenTLineWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-tline-run"]').click();
    await page.waitForSelector('[data-testid="forge-tline-result"]', { timeout: 5000 });
    const vs = await page.locator('[data-testid="forge-tline-VS"]').innerText();
    const reg = await page.locator('[data-testid="forge-tline-reg"]').innerText();
    const eta = await page.locator('[data-testid="forge-tline-eta"]').innerText();
    expect(vs).toMatch(/V_S/);
    expect(reg).toMatch(/Regulation/);
    expect(eta).toMatch(/η/);
  });

  test('08 menu route fires tline workbench', async () => {
    await page.evaluate(() => { window.__forgeCloseTLineWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.tline' } }));
    });
    await page.waitForSelector('[data-testid="forge-tline-panel"]', { timeout: 2000 });
  });

  test('09 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
