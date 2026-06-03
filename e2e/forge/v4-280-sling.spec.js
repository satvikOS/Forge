// v4-280-sling.spec.js — Forge-280 wire rope sling capacity (ASME B30.9).

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-280-sling';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const ROPE = {
  breakingStrengthN: 191200, designFactor: 5, hitchType: 'vertical',
};

test.describe.serial('Forge-280 · wire rope sling', () => {
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

  test('01 kernel bridge wired (cam #1 baseline)', async () => {
    await shot(page, 'baseline');
    const has = await page.evaluate(() =>
      !!(window.forge && window.forge.sling
         && typeof window.forge.sling.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 1/2" IWRC vertical → WLL=BS/DF=38.24 kN (cam #2)', async () => {
    const r = await page.evaluate((b) => window.forge.sling.analyse({
      ...b, numberOfLegs: 1, legAngleFromVerticalDeg: 0,
    }), ROPE);
    expect(r.singleLegWllN).toBeCloseTo(38240, 1);
    expect(r.assemblyWllN).toBeCloseTo(38240, 1);
    expect(r.angleStatus).toBe('safe');
    await shot(page, 'vertical');
  });

  test('03 2-leg @60° from vert → assembly = single (cos 60°=0.5) (cam #3)', async () => {
    const r = await page.evaluate((b) => window.forge.sling.analyse({
      ...b, numberOfLegs: 2, legAngleFromVerticalDeg: 60,
    }), ROPE);
    expect(r.assemblyWllN).toBeCloseTo(38240, 0);
    expect(r.angleStatus).toBe('caution');
    await shot(page, 'caution');
  });

  test('04 2-leg @75° → danger zone, capacity drops (cam #4)', async () => {
    const r = await page.evaluate((b) => window.forge.sling.analyse({
      ...b, numberOfLegs: 2, legAngleFromVerticalDeg: 75,
    }), ROPE);
    expect(r.angleStatus).toBe('danger');
    expect(r.assemblyWllN).toBeLessThan(38240);
    await shot(page, 'danger');
  });

  test('05 Choker hitch = 75% of vertical (cam #5)', async () => {
    const v = await page.evaluate((b) => window.forge.sling.analyse({
      ...b, numberOfLegs: 1, legAngleFromVerticalDeg: 0, hitchType: 'vertical',
    }), ROPE);
    const c = await page.evaluate((b) => window.forge.sling.analyse({
      ...b, numberOfLegs: 1, legAngleFromVerticalDeg: 0, hitchType: 'choker',
    }), ROPE);
    expect(c.assemblyWllN / v.assemblyWllN).toBeCloseTo(0.75, 6);
    expect(c.hitchFactor).toBeCloseTo(0.75, 6);
    await shot(page, 'choker');
  });

  test('06 Basket hitch = 2× vertical (cam #6)', async () => {
    const v = await page.evaluate((b) => window.forge.sling.analyse({
      ...b, numberOfLegs: 1, legAngleFromVerticalDeg: 0, hitchType: 'vertical',
    }), ROPE);
    const k = await page.evaluate((b) => window.forge.sling.analyse({
      ...b, numberOfLegs: 1, legAngleFromVerticalDeg: 0, hitchType: 'basket',
    }), ROPE);
    expect(k.assemblyWllN / v.assemblyWllN).toBeCloseTo(2.0, 6);
    expect(k.hitchFactor).toBeCloseTo(2.0, 6);
    await shot(page, 'basket');
  });

  test('07 Panel renders WLL + status banner', async () => {
    await page.evaluate(() => { window.__forgeOpenWireRopeSlingWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-sling-run"]').click();
    await page.waitForSelector('[data-testid="forge-sling-result"]', { timeout: 5000 });
    const wll = await page.locator('[data-testid="forge-sling-wll"]').innerText();
    const st  = await page.locator('[data-testid="forge-sling-status"]').innerText();
    expect(wll).toMatch(/Assembly WLL/);
    expect(st).toMatch(/SAFE|CAUTION|DANGER/);
  });

  test('08 Menu route opens sling panel', async () => {
    await page.evaluate(() => { window.__forgeCloseWireRopeSlingWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.sling' } }));
    });
    await page.waitForSelector('[data-testid="forge-sling-panel"]', { timeout: 2000 });
  });

  test('09 Manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
