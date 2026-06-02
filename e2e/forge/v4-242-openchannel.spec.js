// v4-242-openchannel.spec.js — Forge-242 open-channel flow (Manning).

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-242-openchannel';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-242 · open channel (Manning + critical depth)', () => {
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
      !!(window.forge && window.forge.openchannel
         && typeof window.forge.openchannel.manningDischarge === 'function'
         && typeof window.forge.openchannel.normalDepth === 'function'
         && typeof window.forge.openchannel.criticalDepth === 'function'
         && typeof window.forge.openchannel.flowRegime === 'function'));
    expect(has).toBe(true);
  });

  test('02 trapezoidal section closed form (cam #1)', async () => {
    const s = await page.evaluate(() => window.forge.openchannel.sectionAtDepth({
      geom: { bottomWidthM: 3, sideSlopeM: 2 }, depthM: 2.0,
    }));
    expect(s.area).toBeCloseTo(14.0, 9);
    expect(s.wetPerim).toBeCloseTo(3 + 4 * Math.sqrt(5), 9);
    expect(s.topWidth).toBeCloseTo(11.0, 9);
    expect(s.hydraulicRadius).toBeCloseTo(14.0 / (3 + 4 * Math.sqrt(5)), 9);
    await shot(page, 'section');
  });

  test('03 Manning Q at y=2m matches Chow textbook (cam #2)', async () => {
    const Q = await page.evaluate(() => window.forge.openchannel.manningDischarge({
      geom: { bottomWidthM: 3, sideSlopeM: 2 },
      manningN: 0.025, slope: 0.0015, depthM: 2.0,
    }));
    expect(Q).toBeCloseTo(24.11, 1);
    await shot(page, 'manning-Q');
  });

  test('04 normal depth Newton-Raphson recovers y_n = 2.0 (cam #3)', async () => {
    const Q = 24.110852116802302;
    const y_n = await page.evaluate((Qv) => window.forge.openchannel.normalDepth({
      geom: { bottomWidthM: 3, sideSlopeM: 2 },
      manningN: 0.025, slope: 0.0015, targetDischarge: Qv,
    }), Q);
    expect(y_n).toBeCloseTo(2.0, 4);
    await shot(page, 'y_n');
  });

  test('05 critical depth: Fr = 1 at y_c (cam #4)', async () => {
    const Q = 24.110852116802302;
    const y_c = await page.evaluate((Qv) => window.forge.openchannel.criticalDepth({
      geom: { bottomWidthM: 3, sideSlopeM: 2 },
      dischargeQ: Qv, gravityG: 9.81,
    }), Q);
    expect(y_c).toBeGreaterThan(0);
    expect(y_c).toBeLessThan(2.0);  // subcritical reach
    const reg = await page.evaluate((args) => window.forge.openchannel.flowRegime({
      geom: { bottomWidthM: 3, sideSlopeM: 2 },
      depthM: args.y_c, dischargeQ: args.Q, gravityG: 9.81,
    }), { y_c, Q });
    expect(reg.froude).toBeCloseTo(1.0, 3);
    expect(reg.regime).toBe(0);  // critical
    await shot(page, 'y_c');
  });

  test('06 subcritical regime at y_n (Fr < 1)', async () => {
    const Q = 24.110852116802302;
    const reg = await page.evaluate((Qv) => window.forge.openchannel.flowRegime({
      geom: { bottomWidthM: 3, sideSlopeM: 2 },
      depthM: 2.0, dischargeQ: Qv, gravityG: 9.81,
    }), Q);
    expect(reg.regime).toBe(1);
    expect(reg.froude).toBeLessThan(1);
  });

  test('07 supercritical regime at shallow depth (Fr > 1)', async () => {
    const Q = 24.110852116802302;
    const reg = await page.evaluate((Qv) => window.forge.openchannel.flowRegime({
      geom: { bottomWidthM: 3, sideSlopeM: 2 },
      depthM: 0.8, dischargeQ: Qv, gravityG: 9.81,
    }), Q);
    expect(reg.regime).toBe(-1);
    expect(reg.froude).toBeGreaterThan(1);
  });

  test('08 panel renders y_n, y_c, Fr regime banner (cam #5)', async () => {
    await page.evaluate(() => { window.__forgeOpenOpenChanWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-openchan-run"]').click();
    await page.waitForSelector('[data-testid="forge-openchan-result"]', { timeout: 5000 });
    const fr = await page.locator('[data-testid="forge-openchan-fr"]').innerText();
    expect(fr).toMatch(/Fr/);
    expect(fr).toMatch(/SUB|SUPER|CRITICAL/);
    await shot(page, 'panel');
  });

  test('09 menu route fires openchan workbench', async () => {
    await page.evaluate(() => { window.__forgeCloseOpenChanWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.openchan' } }));
    });
    await page.waitForSelector('[data-testid="forge-openchan-panel"]', { timeout: 2000 });
  });

  test('10 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
