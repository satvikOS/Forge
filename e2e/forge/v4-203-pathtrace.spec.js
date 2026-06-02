// v4-203-pathtrace.spec.js — Forge-203 CPU path tracer preview.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-203-pathtrace';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-203 · path tracer preview', () => {
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
      !!(window.forge && window.forge.pathtrace
         && typeof window.forge.pathtrace.render === 'function'));
    expect(has).toBe(true);
  });

  test('02 render a single quad — centre pixel = albedo·(amb+sun) (cam #1)', async () => {
    const r = await page.evaluate(() => {
      const mesh = {
        positions: new Float32Array([
          -10,-10,0,  10,-10,0,  10,10,0,  -10,10,0,
        ]),
        normals: new Float32Array([
          0,0,1,  0,0,1,  0,0,1,  0,0,1,
        ]),
        indices: new Uint32Array([0,1,2,  0,2,3]),
        materialIds: new Uint32Array([0,0]),
        materials: [{ albedo: [0.8, 0.6, 0.4], emission: [0, 0, 0] }],
      };
      const out = window.forge.pathtrace.render({
        mesh,
        camera: { position: [0,0,30], lookAt: [0,0,0], up: [0,1,0], fovYDegrees: 45 },
        sun: { direction: [0,0,1], colour: [1,1,1] },
        ambient: [0.05,0.05,0.05], background: [0.01,0.02,0.03],
        width: 32, height: 32,
        aoSamples: 0, aoStrength: 0, aoMaxDistance: 1e6,
        randomSeed: 1234,
      });
      const c = (16 * 32 + 16) * 3;
      return {
        cR: out.rgb[c], cG: out.rgb[c+1], cB: out.rgb[c+2],
        eR: out.rgb[0], eB: out.rgb[2],
        rayCount: out.rayCount, elapsedSec: out.elapsedSec,
      };
    });
    expect(r.cR).toBeCloseTo(0.84, 1);
    expect(r.cG).toBeCloseTo(0.63, 1);
    expect(r.eR).toBeCloseTo(0.01, 2);
    expect(r.eB).toBeCloseTo(0.03, 2);
    expect(r.rayCount).toBeGreaterThan(1000);
    await shot(page, 'quad-rendered');
  });

  test('03 render the box+floor fixture (cam #2)', async () => {
    const r = await page.evaluate(() => {
      const mesh = window.__forgePathTraceFixtureScene();
      return window.forge.pathtrace.render({
        mesh,
        camera: { position: [30,25,22], lookAt: [0,0,4], up: [0,0,1], fovYDegrees: 35 },
        sun: { direction: [0.5,0.5,0.7], colour: [1,1,1] },
        ambient: [0.08,0.08,0.10], background: [0.04,0.05,0.08],
        width: 64, height: 48,
        aoSamples: 4, aoStrength: 0.5, aoMaxDistance: 30,
        randomSeed: 1234,
      });
    });
    expect(r.rgb.length).toBe(64 * 48 * 3);
    expect(r.rayCount).toBeGreaterThan(10000);
    await shot(page, 'fixture-rendered');
  });

  test('04 open the workbench panel (cam #3)', async () => {
    await page.evaluate(() => { window.__forgeOpenPathTraceWorkbench?.(); });
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid="forge-pathtrace-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-pathtrace-render"]')).toBeVisible();
    await shot(page, 'panel-open');
  });

  test('05 render via the panel button (cam #4)', async () => {
    await page.locator('[data-testid="forge-pathtrace-width"]').fill('96');
    await page.locator('[data-testid="forge-pathtrace-height"]').fill('72');
    await page.locator('[data-testid="forge-pathtrace-ao-samples"]').fill('4');
    await page.locator('[data-testid="forge-pathtrace-render"]').click();
    await page.waitForSelector('[data-testid="forge-pathtrace-stats"]', { timeout: 15000 });
    await expect(page.locator('[data-testid="forge-pathtrace-stats"]')).toBeVisible();
    await shot(page, 'panel-rendered');
  });

  test('06 canvas painted (cam #5)', async () => {
    const hasPixels = await page.evaluate(() => {
      const c = document.querySelector('[data-testid="forge-pathtrace-canvas"]');
      if (!c) return false;
      const ctx = c.getContext('2d');
      const d = ctx.getImageData(c.width / 2, c.height / 2, 1, 1).data;
      return (d[0] + d[1] + d[2]) > 0;
    });
    expect(hasPixels).toBe(true);
    await shot(page, 'canvas-painted');
  });

  test('07 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
