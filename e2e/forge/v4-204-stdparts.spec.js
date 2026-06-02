// v4-204-stdparts.spec.js — Forge-204 standard parts library.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-204-stdparts';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-204 · standard parts library', () => {
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
      !!(window.forge && window.forge.stdparts
         && typeof window.forge.stdparts.makeBolt === 'function'
         && typeof window.forge.stdparts.makeNut === 'function'
         && typeof window.forge.stdparts.makeWasher === 'function'
         && typeof window.forge.stdparts.makeBearing === 'function'
         && typeof window.forge.stdparts.makeSpurGear === 'function'));
    expect(has).toBe(true);
  });

  test('02 M8 bolt spec from ISO 4014 table', async () => {
    const s = await page.evaluate(() => window.forge.stdparts.specForMetricBolt(8, 30));
    expect(s.diameter).toBe(8);
    expect(s.length).toBe(30);
    expect(s.headWidth).toBeCloseTo(13.0, 2);
    expect(s.headHeight).toBeCloseTo(5.2, 2);
  });

  test('03 bolt mesh round-trip (cam #1)', async () => {
    const m = await page.evaluate(() => {
      const sp = window.forge.stdparts;
      const spec = sp.specForMetricBolt(8, 30);
      const out = sp.makeBolt(spec, 24);
      return { v: out.positions.length / 3, t: out.indices.length / 3 };
    });
    expect(m.v).toBeGreaterThan(20);
    expect(m.t).toBeGreaterThan(20);
    await shot(page, 'bolt-mesh');
  });

  test('04 bearing 6004 mesh (cam #2)', async () => {
    const m = await page.evaluate(() => {
      const out = window.forge.stdparts.makeBearing(
        { innerDiameter: 20, outerDiameter: 42, width: 12 }, 24);
      return { v: out.positions.length / 3, t: out.indices.length / 3 };
    });
    expect(m.t).toBe(24 * 8 * 2);
    await shot(page, 'bearing-mesh');
  });

  test('05 spur gear (cam #3)', async () => {
    const m = await page.evaluate(() => {
      const out = window.forge.stdparts.makeSpurGear(
        { module: 1.0, teeth: 20, faceWidth: 5, pressureAngle: 0.349 }, 12);
      return { v: out.positions.length / 3, t: out.indices.length / 3 };
    });
    expect(m.v).toBe(162);     // 20 teeth × 4 ring verts × 2 levels + 2 centres
    expect(m.t).toBeGreaterThan(100);
    await shot(page, 'gear-mesh');
  });

  test('06 open the workbench panel (cam #4)', async () => {
    await page.evaluate(() => { window.__forgeOpenStdPartsWorkbench?.(); });
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid="forge-stdparts-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-stdparts-list"]')).toBeVisible();
    await shot(page, 'panel-open');
  });

  test('07 search + select + insert (cam #5)', async () => {
    await page.locator('[data-testid="forge-stdparts-search"]').fill('M8');
    await page.waitForTimeout(150);
    await page.locator('[data-testid="forge-stdparts-row-bolt-m8"]').click();
    await page.locator('[data-testid="forge-stdparts-insert"]').click();
    await page.waitForSelector('[data-testid="forge-stdparts-mesh-stats"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-stdparts-mesh-stats"]')).toBeVisible();
    await shot(page, 'after-insert');
    const stored = await page.evaluate(() => !!window.__forgeLastStdPart);
    expect(stored).toBe(true);
  });

  test('08 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
