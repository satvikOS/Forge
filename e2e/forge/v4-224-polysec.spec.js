// v4-224-polysec.spec.js — Forge-224 polygon centroid + area moments.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-224-polysec';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-224 · polygon section', () => {
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
      !!(window.forge && window.forge.polysec
         && typeof window.forge.polysec.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 unit square: A=1, I=b·h³/12=1/12 (cam #1)', async () => {
    const r = await page.evaluate(() => window.forge.polysec.analyse({
      outer: [[0,0],[1,0],[1,1],[0,1]],
    }));
    expect(r.area).toBeCloseTo(1, 12);
    expect(r.centroid.x).toBeCloseTo(0.5, 12);
    expect(r.centroid.y).toBeCloseTo(0.5, 12);
    expect(r.IxxCentroid).toBeCloseTo(1/12, 12);
    expect(r.IyyCentroid).toBeCloseTo(1/12, 12);
    await shot(page, 'square');
  });

  test('03 right triangle: I_xx = b·h³/36 (cam #2)', async () => {
    const r = await page.evaluate(() => window.forge.polysec.analyse({
      outer: [[0,0],[3,0],[0,2]],
    }));
    expect(r.area).toBeCloseTo(3, 12);
    expect(r.centroid.x).toBeCloseTo(1, 12);
    expect(r.centroid.y).toBeCloseTo(2/3, 12);
    expect(r.IxxCentroid).toBeCloseTo(2/3, 9);
    expect(r.IyyCentroid).toBeCloseTo(1.5, 9);
    await shot(page, 'triangle');
  });

  test('04 hole reduces area + leaves centroid centred (cam #3)', async () => {
    const r = await page.evaluate(() => {
      const h = 0.2;
      return window.forge.polysec.analyse({
        outer: [[0,0],[1,0],[1,1],[0,1]],
        holes: [[
          [0.5-h, 0.5-h], [0.5-h, 0.5+h],
          [0.5+h, 0.5+h], [0.5+h, 0.5-h],
        ]],
      });
    });
    expect(r.area).toBeCloseTo(1 - 0.16, 12);
    expect(r.centroid.x).toBeCloseTo(0.5, 12);
    expect(r.centroid.y).toBeCloseTo(0.5, 12);
    await shot(page, 'with-hole');
  });

  test('05 I-beam fixture produces non-zero I (cam #4)', async () => {
    const r = await page.evaluate(() => window.forge.polysec.analyse({
      outer: [
        [-100,-100],[100,-100],[100,-80],[20,-80],
        [20,80],[100,80],[100,100],[-100,100],
        [-100,80],[-20,80],[-20,-80],[-100,-80],
      ],
    }));
    expect(r.area).toBeGreaterThan(0);
    expect(r.IxxCentroid).toBeGreaterThan(0);
    expect(r.IyyCentroid).toBeGreaterThan(0);
    await shot(page, 'ibeam');
  });

  test('06 panel analyse renders result card (cam #5)', async () => {
    await page.evaluate(() => { window.__forgeOpenPolySecWorkbench?.(); });
    await page.waitForTimeout(400);
    await page.locator('[data-testid="forge-polysec-run"]').click();
    await page.waitForSelector('[data-testid="forge-polysec-result"]', { timeout: 5000 });
    const text = await page.locator('[data-testid="forge-polysec-result"]').innerText();
    expect(text).toMatch(/Area/);
    expect(text).toMatch(/I_xx/);
    expect(text).toMatch(/r_gx/);
    await shot(page, 'panel-result');
  });

  test('07 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
