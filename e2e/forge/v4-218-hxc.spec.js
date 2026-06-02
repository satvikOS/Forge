// v4-218-hxc.spec.js — Forge-218 heat exchanger LMTD + ε-NTU.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-218-hxc';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-218 · heat exchanger', () => {
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
      !!(window.forge && window.forge.hxc
         && typeof window.forge.hxc.lmtd === 'function'
         && typeof window.forge.hxc.requiredArea === 'function'
         && typeof window.forge.hxc.effectiveness === 'function'));
    expect(has).toBe(true);
  });

  test('02 counter-flow LMTD textbook (cam #1)', async () => {
    const r = await page.evaluate(() => window.forge.hxc.lmtd({
      thIn: 100, thOut: 60, tcIn: 20, tcOut: 50, flow: 'counter',
    }));
    expect(r.dT1).toBe(50);
    expect(r.dT2).toBe(40);
    expect(r.lmtd).toBeCloseTo(10 / Math.log(50 / 40), 9);
    await shot(page, 'counter');
  });

  test('03 parallel-flow LMTD textbook (cam #2)', async () => {
    const r = await page.evaluate(() => window.forge.hxc.lmtd({
      thIn: 100, thOut: 60, tcIn: 20, tcOut: 50, flow: 'parallel',
    }));
    expect(r.dT1).toBe(80);
    expect(r.dT2).toBe(10);
    expect(r.lmtd).toBeCloseTo(70 / Math.log(80 / 10), 9);
    await shot(page, 'parallel');
  });

  test('04 equal-ΔT limit returns ΔT₁ (cam #3)', async () => {
    const r = await page.evaluate(() => window.forge.hxc.lmtd({
      thIn: 100, thOut: 70, tcIn: 30, tcOut: 60, flow: 'counter',
    }));
    expect(r.lmtd).toBeCloseTo(40, 6);
    await shot(page, 'equal-dt');
  });

  test('05 requiredArea matches Q/(U·LMTD·F) (cam #4)', async () => {
    const A = await page.evaluate(() => window.forge.hxc.requiredArea({
      Q: 50000, U: 500, lmtd: 44.81, F: 1.0,
    }));
    expect(A).toBeCloseTo(50000 / (500 * 44.81), 9);
    await shot(page, 'area');
  });

  test('06 panel solve renders result card (cam #5)', async () => {
    await page.evaluate(() => { window.__forgeOpenHxcWorkbench?.(); });
    await page.waitForTimeout(400);
    await page.locator('[data-testid="forge-hxc-run"]').click();
    await page.waitForSelector('[data-testid="forge-hxc-result"]', { timeout: 5000 });
    const text = await page.locator('[data-testid="forge-hxc-result"]').innerText();
    expect(text).toMatch(/LMTD/);
    expect(text).toMatch(/Effectiveness/);
    await shot(page, 'panel-result');
  });

  test('07 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
