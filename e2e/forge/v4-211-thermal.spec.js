// v4-211-thermal.spec.js — Forge-211 thermal network FEA.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-211-thermal';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-211 · thermal network', () => {
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
      !!(window.forge && window.forge.thermal
         && typeof window.forge.thermal.solve === 'function'));
    expect(has).toBe(true);
  });

  test('02 series resistor: midpoint @ 50°C (cam #1)', async () => {
    const r = await page.evaluate(() => window.forge.thermal.solve({
      nodes: [
        { fixed: true, prescribedTemperature: 100 },
        { fixed: false },
        { fixed: true, prescribedTemperature: 0 },
      ],
      edges: [
        { a: 0, b: 1, conductance: 5 },
        { a: 1, b: 2, conductance: 5 },
      ],
    }));
    expect(r.singular).toBe(false);
    expect(r.temperatures[1]).toBeCloseTo(50, 9);
    expect(r.edgeFluxes[0]).toBeCloseTo(250, 9);
    expect(r.edgeFluxes[1]).toBeCloseTo(250, 9);
    await shot(page, 'series');
  });

  test('03 source applied to floating node (cam #2)', async () => {
    const r = await page.evaluate(() => window.forge.thermal.solve({
      nodes: [
        { fixed: true, prescribedTemperature: 0 },
        { fixed: false },
      ],
      edges: [{ a: 0, b: 1, conductance: 10 }],
      sources: [{ node: 1, heatFlux: 100 }],
    }));
    expect(r.temperatures[1]).toBeCloseTo(10, 9);
    expect(r.edgeFluxes[0]).toBeCloseTo(-100, 9);
    await shot(page, 'source');
  });

  test('04 PCB fixture: chip > board > ambient (cam #3)', async () => {
    const r = await page.evaluate(() => {
      return window.__forgeThermalSolve(window.__forgeThermalFixture());
    });
    // chip (node 0) should be hottest. Ambient (3 + 4) should be 25.
    expect(r.singular).toBe(false);
    expect(r.temperatures[0]).toBeGreaterThan(r.temperatures[1]);
    expect(r.temperatures[1]).toBeGreaterThan(25);
    expect(r.temperatures[3]).toBe(25);
    await shot(page, 'pcb');
  });

  test('05 conservation of energy on the PCB fixture (cam #4)', async () => {
    const r = await page.evaluate(() => {
      return window.__forgeThermalSolve(window.__forgeThermalFixture());
    });
    // 10 W in at the chip should leave 10 W out at the ambient sinks.
    const inflow  = 10;
    const outflow = -r.reactions[3] - r.reactions[4];
    expect(Math.abs(inflow - outflow)).toBeLessThan(1e-6);
    await shot(page, 'energy-balance');
  });

  test('06 open the workbench panel (cam #5)', async () => {
    await page.evaluate(() => { window.__forgeOpenThermalWorkbench?.(); });
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid="forge-thermal-panel"]')).toBeVisible();
    await shot(page, 'panel-open');
  });

  test('07 panel solve renders temperatures + edge fluxes (cam #6)', async () => {
    await page.locator('[data-testid="forge-thermal-solve"]').click();
    await page.waitForSelector('[data-testid="forge-thermal-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-thermal-result"]')).toBeVisible();
    const text = await page.locator('[data-testid="forge-thermal-result"]').innerText();
    expect(text).toMatch(/Temperatures/);
    expect(text).toMatch(/Edge fluxes/);
    await shot(page, 'panel-result');
  });

  test('08 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
