// v4-200-meshrepair.spec.js — Forge-200 mesh repair toolkit.
//
// Verifies that the kernel `meshrepair` namespace is reachable from the
// renderer, each pass produces the expected stats change, and the
// workbench panel runs the full pipeline end-to-end.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-200-meshrepair';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-200 · mesh repair', () => {
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
      !!(window.forge && window.forge.meshrepair
         && typeof window.forge.meshrepair.analyse === 'function'
         && typeof window.forge.meshrepair.dedupeVertices === 'function'
         && typeof window.forge.meshrepair.fillHoles === 'function'
         && typeof window.forge.meshrepair.laplacianSmooth === 'function'
         && typeof window.forge.meshrepair.decimate === 'function'));
    expect(has).toBe(true);
  });

  test('02 dedupe collapses coincident verts', async () => {
    const r = await page.evaluate(() => {
      const mr = window.forge.meshrepair;
      const m = {
        positions: new Float32Array([0,0,0, 1,0,0, 1,1,0, 0.0001,0,0, 0,1,0]),
        indices:   new Uint32Array([0,1,2, 3,2,4]),
      };
      const out = mr.dedupeVertices(m, 0.001);
      return { vCount: out.positions.length / 3, iCount: out.indices.length };
    });
    expect(r.vCount).toBe(4);
    expect(r.iCount).toBe(6);
  });

  test('03 fillHoles closes a boundary (cam #1)', async () => {
    const r = await page.evaluate(() => {
      const mr = window.forge.meshrepair;
      const m = {
        positions: new Float32Array([0,0,0, 1,0,0, 1,1,0, 0,1,0]),
        indices:   new Uint32Array([0, 1, 2]),
      };
      const before = mr.analyse(m);
      const filled = mr.fillHoles(m, 64);
      const after = mr.analyse(filled);
      return { before, after };
    });
    expect(r.before.boundaryEdgeCount).toBe(3);
    expect(r.after.boundaryEdgeCount).toBe(0);
    expect(r.after.triangleCount).toBeGreaterThan(r.before.triangleCount);
    await shot(page, 'fillholes-result');
  });

  test('04 laplacianSmooth pulls displaced apex toward centroid (cam #2)', async () => {
    const r = await page.evaluate(() => {
      const mr = window.forge.meshrepair;
      const m = {
        positions: new Float32Array([
          0,0,0, 2,0,0, 2,2,0, 0,2,0, 1,1,5,
        ]),
        indices: new Uint32Array([0,1,4, 1,2,4, 2,3,4, 3,0,4]),
      };
      const smoothed = mr.laplacianSmooth(m, 5, 0.5);
      return { z0: m.positions[14], z1: smoothed.positions[14] };
    });
    expect(r.z1).toBeLessThan(r.z0);
    expect(r.z1).toBeLessThan(2);
    await shot(page, 'smooth-result');
  });

  test('05 decimate reduces triangle count (cam #3)', async () => {
    const r = await page.evaluate(() => {
      const mr = window.forge.meshrepair;
      const n = 4;
      const pos = [];
      const idx = [];
      for (let j = 0; j <= n; ++j) {
        for (let i = 0; i <= n; ++i) pos.push(i, j, 0);
      }
      for (let j = 0; j < n; ++j) {
        for (let i = 0; i < n; ++i) {
          const a = j*(n+1) + i;
          const b = a + 1;
          const c = a + (n+1);
          const d = c + 1;
          idx.push(a,b,c,  b,d,c);
        }
      }
      const m = { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
      const target = 16;
      const dec = mr.decimate(m, target);
      const before = mr.analyse(m);
      const after = mr.analyse(dec);
      return { before, after, target };
    });
    expect(r.before.triangleCount).toBe(32);
    expect(r.after.triangleCount).toBeLessThan(r.before.triangleCount);
    await shot(page, 'decimate-result');
  });

  test('06 open the workbench panel (cam #4)', async () => {
    await page.evaluate(() => { window.__forgeOpenMeshRepairWorkbench?.(); });
    await page.waitForTimeout(400);
    await shot(page, 'panel-open');
    await expect(page.locator('[data-testid="forge-meshrepair-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-meshrepair-run"]')).toBeVisible();
  });

  test('07 panel run produces a stats table (cam #5)', async () => {
    await page.locator('[data-testid="forge-meshrepair-run"]').click();
    await page.waitForSelector('[data-testid="forge-meshrepair-stats"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-meshrepair-stats"]')).toBeVisible();
    await shot(page, 'stats-shown');
  });

  test('08 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
