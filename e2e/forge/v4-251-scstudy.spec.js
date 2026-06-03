// v4-251-scstudy.spec.js — Forge-251 short-circuit study (Z_bus).

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-251-scstudy';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const THREE_BUS_RADIAL = () => ({
  numBuses: 3, prefaultVoltagePu: 1.0,
  generators: [{ busIndex: 0, subtransientX: 0.20 }],
  branches: [
    { from: 0, to: 1, R: 0, X: 0.10 },
    { from: 1, to: 2, R: 0, X: 0.10 },
  ],
});

test.describe.serial('Forge-251 · short-circuit study Z_bus', () => {
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
      !!(window.forge && window.forge.shortcircuit
         && typeof window.forge.shortcircuit.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 3-bus radial driving-point impedances (cam #1)', async () => {
    const r = await page.evaluate((inp) => window.forge.shortcircuit.analyse(inp),
      THREE_BUS_RADIAL());
    // Bus 0: X_d'' = 0.20.
    expect(r.buses[0].zDriveMag).toBeCloseTo(0.20, 6);
    // Bus 1: 0.20 + 0.10 = 0.30.
    expect(r.buses[1].zDriveMag).toBeCloseTo(0.30, 6);
    // Bus 2: 0.20 + 0.10 + 0.10 = 0.40.
    expect(r.buses[2].zDriveMag).toBeCloseTo(0.40, 6);
    await shot(page, 'radial-Z');
  });

  test('03 fault current closer to source > further (cam #2)', async () => {
    const r = await page.evaluate((inp) => window.forge.shortcircuit.analyse(inp),
      THREE_BUS_RADIAL());
    expect(r.buses[0].faultCurrentPu).toBeGreaterThan(r.buses[1].faultCurrentPu);
    expect(r.buses[1].faultCurrentPu).toBeGreaterThan(r.buses[2].faultCurrentPu);
    expect(r.buses[0].faultCurrentPu).toBeCloseTo(5.0, 4);
    expect(r.buses[2].faultCurrentPu).toBeCloseTo(2.5, 4);
    await shot(page, 'I_F-radial');
  });

  test('04 fault MVA per-unit matches V²/|Z_ii| (cam #3)', async () => {
    const r = await page.evaluate((inp) => window.forge.shortcircuit.analyse(inp),
      THREE_BUS_RADIAL());
    for (let i = 0; i < 3; i++) {
      expect(r.buses[i].faultMvaPu).toBeCloseTo(1.0 / r.buses[i].zDriveMag, 4);
    }
    await shot(page, 'S_F');
  });

  test('05 second generator at remote bus reduces |Z_ii| (cam #4)', async () => {
    const noGen2 = await page.evaluate((inp) => window.forge.shortcircuit.analyse(inp),
      THREE_BUS_RADIAL());
    const withGen2 = await page.evaluate(() => window.forge.shortcircuit.analyse({
      numBuses: 3, prefaultVoltagePu: 1.0,
      generators: [
        { busIndex: 0, subtransientX: 0.20 },
        { busIndex: 2, subtransientX: 0.25 },
      ],
      branches: [
        { from: 0, to: 1, R: 0, X: 0.10 },
        { from: 1, to: 2, R: 0, X: 0.10 },
      ],
    }));
    expect(withGen2.buses[2].zDriveMag).toBeLessThan(noGen2.buses[2].zDriveMag);
    expect(withGen2.buses[2].faultCurrentPu).toBeGreaterThan(noGen2.buses[2].faultCurrentPu);
    await shot(page, 'second-gen');
  });

  test('06 Y singular without any generator throws (cam #5)', async () => {
    let threw = false;
    try {
      await page.evaluate(() => window.forge.shortcircuit.analyse({
        numBuses: 2, prefaultVoltagePu: 1.0,
        generators: [],
        branches: [{ from: 0, to: 1, R: 0, X: 0.10 }],
      }));
    } catch (e) { threw = true; }
    expect(threw).toBe(true);
    await shot(page, 'singular');
  });

  test('07 panel renders rows for each bus', async () => {
    await page.evaluate(() => { window.__forgeOpenSCStudyWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-scstudy-run"]').click();
    await page.waitForSelector('[data-testid="forge-scstudy-result"]', { timeout: 5000 });
    const row0 = await page.locator('[data-testid="forge-scstudy-row-0"]').innerText();
    const row2 = await page.locator('[data-testid="forge-scstudy-row-2"]').innerText();
    expect(row0).toMatch(/0/);
    expect(row2).toMatch(/2/);
  });

  test('08 menu route fires scstudy workbench', async () => {
    await page.evaluate(() => { window.__forgeCloseSCStudyWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.scstudy' } }));
    });
    await page.waitForSelector('[data-testid="forge-scstudy-panel"]', { timeout: 2000 });
  });

  test('09 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
