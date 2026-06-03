// v4-249-syncmachine.spec.js — Forge-249 synchronous machine.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-249-syncmachine';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const CHAPMAN = () => ({
  mode: 'generator',
  terminalPhaseVoltageV: 277, synchronousReactanceOhm: 1.0,
  armatureResistanceOhm: 0,
  realPowerPerPhaseW: 200000,
  powerFactor: 0.8, leading: false,
});

test.describe.serial('Forge-249 · synchronous machine', () => {
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
      !!(window.forge && window.forge.syncmachine
         && typeof window.forge.syncmachine.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 Chapman 5-1 generator: I_a ≈ 902.5 A, δ ≈ 41.4° (cam #1)', async () => {
    const r = await page.evaluate((inp) => window.forge.syncmachine.analyse(inp), CHAPMAN());
    expect(r.armatureCurrentA).toBeCloseTo(902.5, 0);
    expect(r.armatureCurrentAngDeg).toBeCloseTo(-36.87, 1);
    expect(r.inducedEmfV).toBeCloseTo(1091.4, 0);
    expect(r.inducedEmfAngDeg).toBeCloseTo(41.4, 1);
    expect(r.reactivePowerPerPhaseVar / 1000).toBeCloseTo(150, 0);
    expect(r.maxPullOutPowerW / 1000).toBeCloseTo(302.3, 0);
    await shot(page, 'chapman-gen');
  });

  test('03 P_e closed form: P = V·E·sinδ/X_s (cam #2)', async () => {
    const r = await page.evaluate((inp) => window.forge.syncmachine.analyse(inp), CHAPMAN());
    const P_closed = 277 * r.inducedEmfV * Math.sin(r.inducedEmfAngDeg * Math.PI / 180);
    expect(P_closed).toBeCloseTo(200000, -1);
    await shot(page, 'P-closed');
  });

  test('04 motor mode: δ negative (cam #3)', async () => {
    const r = await page.evaluate((inp) => window.forge.syncmachine.analyse(inp),
      { ...CHAPMAN(), mode: 'motor' });
    expect(r.inducedEmfAngDeg).toBeLessThan(0);
    await shot(page, 'motor');
  });

  test('05 leading PF (under-excited motor) flips Q sign (cam #4)', async () => {
    const lag = await page.evaluate((inp) => window.forge.syncmachine.analyse(inp),
      { ...CHAPMAN(), mode: 'generator' });
    const lead = await page.evaluate((inp) => window.forge.syncmachine.analyse(inp),
      { ...CHAPMAN(), mode: 'generator', leading: true });
    expect(lag.reactivePowerPerPhaseVar).toBeGreaterThan(0);
    expect(lead.reactivePowerPerPhaseVar).toBeLessThan(lag.reactivePowerPerPhaseVar);
    await shot(page, 'lead-Q');
  });

  test('06 P_max = V_t · E_f / X_s (cam #5)', async () => {
    const r = await page.evaluate((inp) => window.forge.syncmachine.analyse(inp), CHAPMAN());
    expect(r.maxPullOutPowerW).toBeCloseTo(277 * r.inducedEmfV / 1.0, 0);
    await shot(page, 'P_max');
  });

  test('07 panel renders E_f and P_max rows', async () => {
    await page.evaluate(() => { window.__forgeOpenSyncMWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-syncm-run"]').click();
    await page.waitForSelector('[data-testid="forge-syncm-result"]', { timeout: 5000 });
    const ef = await page.locator('[data-testid="forge-syncm-Ef"]').innerText();
    const pmax = await page.locator('[data-testid="forge-syncm-Pmax"]').innerText();
    expect(ef).toMatch(/E_f/);
    expect(ef).toMatch(/δ/);
    expect(pmax).toMatch(/P_max/);
  });

  test('08 menu route fires syncm workbench', async () => {
    await page.evaluate(() => { window.__forgeCloseSyncMWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.syncm' } }));
    });
    await page.waitForSelector('[data-testid="forge-syncm-panel"]', { timeout: 2000 });
  });

  test('09 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
