// v4-328-bundle.spec.js — Forge-328 5-calc bundle.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-328-bundle';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.configure({ timeout: 240000 });
test.describe.serial('Forge-328 · 5-calc bundle', () => {
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

  test('01 5 bridges (cam #1)', async () => {
    await shot(page, 'baseline');
    const has = await page.evaluate(() => ({
      m: !!window.forge?.mullion, s: !!window.forge?.sprinkler,
      sp: !!window.forge?.soundprop, i: !!window.forge?.isa, l: !!window.forge?.lpd,
    }));
    expect(has.m).toBe(true); expect(has.s).toBe(true);
    expect(has.sp).toBe(true); expect(has.i).toBe(true); expect(has.l).toBe(true);
  });

  test('02 Mullion δ = 5wL⁴/(384EI) identity (cam #2)', async () => {
    const r = await page.evaluate(() => window.forge.mullion.analyse({spanLengthMm:3500, windPressureKnM2:1.5, tributaryWidthMm:1500, E_MPa:70000, momentOfInertiaMm4:2e6, deflectionLimitDivisor:175}));
    expect(r.linearLoadKnPerM).toBeCloseTo(1.5 * 1500 / 1000, 5);
    expect(r.deflectionLimitMm).toBeCloseTo(3500/175, 5);
    expect(r.passes).toBe(false);
    await shot(page, 'mullion');
  });

  test('03 Sprinkler Q = K·√P identity (cam #3)', async () => {
    const r = await page.evaluate(() => window.forge.sprinkler.analyse({kFactorUSorMetric:5.6, metricInputs:false, pressurePsi_or_bar:10, designDensityMmPerMin:6.1, operationAreaM2:144}));
    expect(r.sprinklerFlowGpm).toBeCloseTo(5.6 * Math.sqrt(10), 3);
    expect(r.sprinklerFlowLpm).toBeCloseTo(r.sprinklerFlowGpm * 3.785, 2);
    expect(r.requiredAreaFlowLpm).toBeCloseTo(6.1 * 144, 3);
    await shot(page, 'sprinkler');
  });

  test('04 Sound L_p = L_w + 10·log(Q/(4πr²)) (cam #4)', async () => {
    const r = await page.evaluate(() => window.forge.soundprop.analyse({soundPowerLevelDbW:90, distanceM:10, directivityQ:2}));
    const expected_loss = 10 * Math.log10(2 / (4 * Math.PI * 100));
    expect(r.soundPressureLevelDbA).toBeCloseTo(90 + expected_loss, 2);
    expect(r.inverseSquareLossDb).toBeCloseTo(-expected_loss, 2);
    await shot(page, 'sound');
  });

  test('05 ISA at sea level matches standard values (cam #5)', async () => {
    const r = await page.evaluate(() => window.forge.isa.analyse({altitudeM:0}));
    expect(r.temperatureK).toBeCloseTo(288.15, 2);
    expect(r.pressureKpa).toBeCloseTo(101.325, 2);
    expect(r.densityKgM3).toBeCloseTo(1.225, 3);
    expect(r.speedOfSoundMs).toBeCloseTo(340.3, 1);
    await shot(page, 'isa');
  });

  test('06 LPD office 200 m² 150 W: overshoot 23% (cam #6)', async () => {
    const r = await page.evaluate(() => window.forge.lpd.analyse({spaceType:'office', floorAreaM2:200, installedPowerW:150}));
    expect(r.allowanceWperM2).toBe(0.61);
    expect(r.allowedPowerW).toBeCloseTo(122, 1);
    expect(r.overshootW).toBeCloseTo(28, 1);
    expect(r.compliant).toBe(false);
    await shot(page, 'lpd');
  });

  test('07 5 panels open via menu (cam #7)', async () => {
    const ids = ['mullion', 'sprinkler', 'soundprop', 'isa', 'lpd'];
    for (const id of ids) {
      await page.evaluate((i) => {
        window.dispatchEvent(new CustomEvent('forge:menu-action', { detail: { id: `tools.${i}` } }));
      }, id);
      await page.waitForTimeout(300);
    }
    const panels = await page.evaluate(() => ({
      m:!!document.querySelector('[data-testid="forge-mul-panel"]'),
      s:!!document.querySelector('[data-testid="forge-spr-panel"]'),
      sp:!!document.querySelector('[data-testid="forge-sp-panel"]'),
      i:!!document.querySelector('[data-testid="forge-isa-panel"]'),
      l:!!document.querySelector('[data-testid="forge-lpd-panel"]'),
    }));
    expect(panels.m).toBe(true); expect(panels.s).toBe(true);
    expect(panels.sp).toBe(true); expect(panels.i).toBe(true); expect(panels.l).toBe(true);
  });

  test('08 Manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
