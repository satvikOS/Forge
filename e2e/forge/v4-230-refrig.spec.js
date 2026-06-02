// v4-230-refrig.spec.js — Forge-230 refrigeration / heat-pump COP.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-230-refrig';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-230 · refrigeration COP', () => {
  let app, page;

  test.beforeAll(async () => {
    app = await _electron.launch({
      args: [ELECTRON_MAIN, '--no-sandbox'],
      env: { ...process.env, FORGE_E2E: '1' },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3500);
  });
  test.afterAll(async () => { if (app) await app.close(); });

  test('01 kernel bridge wired', async () => {
    await shot(page, 'baseline');
    const has = await page.evaluate(() =>
      !!(window.forge && window.forge.refrig
         && typeof window.forge.refrig.carnotCOP === 'function'
         && typeof window.forge.refrig.vaporCycle === 'function'
         && typeof window.forge.refrig.compressorPower === 'function'));
    expect(has).toBe(true);
  });

  test('02 Carnot COP = T_c/(T_h-T_c) (cam #1)', async () => {
    const r = await page.evaluate(() => ({
      refrig:   window.forge.refrig.carnotCOP(308, 268, 'refrig'),
      heatpump: window.forge.refrig.carnotCOP(308, 268, 'heatpump'),
    }));
    expect(r.refrig).toBeCloseTo(268 / 40, 9);
    expect(r.heatpump).toBeCloseTo(308 / 40, 9);
    expect(r.heatpump - r.refrig).toBeCloseTo(1.0, 9);
    await shot(page, 'carnot');
  });

  test('03 Carnot rejects T_hot ≤ T_cold (cam #2)', async () => {
    const r = await page.evaluate(() => {
      try { window.forge.refrig.carnotCOP(250, 300, 'refrig'); return 'no throw'; }
      catch (e) { return String(e.message); }
    });
    expect(r).toMatch(/T_hot > T_cold/);
    await shot(page, 'bad-temps');
  });

  test('04 vapor cycle q_L = h_1 − h_3 (cam #3)', async () => {
    const r = await page.evaluate(() => window.forge.refrig.vaporCycle({
      h1: 245000, h2: 280000, h3: 100000, mode: 'refrig',
    }));
    expect(r.refrigerationEffect).toBeCloseTo(145000, 9);
    expect(r.compressorWork).toBeCloseTo(35000, 9);
    expect(r.condenserRejection).toBeCloseTo(180000, 9);
    expect(r.cop).toBeCloseTo(145 / 35, 9);
    await shot(page, 'cycle');
  });

  test('05 heat-pump COP = refrig COP + 1 for same cycle (cam #4)', async () => {
    const r = await page.evaluate(() => ({
      refrig:   window.forge.refrig.vaporCycle({ h1:245000, h2:280000, h3:100000, mode:'refrig'   }).cop,
      heatpump: window.forge.refrig.vaporCycle({ h1:245000, h2:280000, h3:100000, mode:'heatpump' }).cop,
    }));
    expect(r.heatpump - r.refrig).toBeCloseTo(1.0, 9);
    await shot(page, 'hp-identity');
  });

  test('06 panel compute renders W (cam #5)', async () => {
    await page.evaluate(() => { window.__forgeOpenRefrigWorkbench?.(); });
    await page.waitForTimeout(400);
    await page.locator('[data-testid="forge-refrig-run"]').click();
    await page.waitForSelector('[data-testid="forge-refrig-result"]', { timeout: 5000 });
    const text = await page.locator('[data-testid="forge-refrig-W"]').innerText();
    expect(text).toMatch(/Compressor W/);
    expect(text).toMatch(/kW/);
    await shot(page, 'panel');
  });

  test('07 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
