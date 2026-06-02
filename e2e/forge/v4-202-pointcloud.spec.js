// v4-202-pointcloud.spec.js — Forge-202 point cloud utilities.
//
// Verifies kernel `pointcloud` namespace + the reverse-engineering
// workbench from the renderer with multi-cam (≥5 angle) coverage.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-202-pointcloud';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-202 · point cloud', () => {
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
      !!(window.forge && window.forge.pointcloud
         && typeof window.forge.pointcloud.stats === 'function'
         && typeof window.forge.pointcloud.voxelDownsample === 'function'
         && typeof window.forge.pointcloud.estimateNormals === 'function'
         && typeof window.forge.pointcloud.voxelMesh === 'function'));
    expect(has).toBe(true);
  });

  test('02 stats over a lattice (cam #1)', async () => {
    const s = await page.evaluate(() => {
      const N = 5;
      const pts = [];
      for (let i = 0; i < N; ++i)
        for (let j = 0; j < N; ++j)
          for (let k = 0; k < N; ++k)
            pts.push(i, j, k);
      return window.forge.pointcloud.stats(new Float32Array(pts));
    });
    expect(s.pointCount).toBe(125);
    expect(s.bboxMax[0]).toBe(4);
    expect(s.centroid[0]).toBeCloseTo(2, 5);
    await shot(page, 'stats-lattice');
  });

  test('03 voxel downsample reduces point count (cam #2)', async () => {
    const r = await page.evaluate(() => {
      const N = 5;
      const pts = [];
      for (let i = 0; i < N; ++i)
        for (let j = 0; j < N; ++j)
          for (let k = 0; k < N; ++k)
            pts.push(i, j, k);
      const cloud = new Float32Array(pts);
      const ds = window.forge.pointcloud.voxelDownsample(cloud, 2.0);
      return { before: cloud.length / 3, after: ds.length / 3 };
    });
    expect(r.after).toBeLessThan(r.before);
    expect(r.after).toBeGreaterThan(0);
    await shot(page, 'downsample');
  });

  test('04 normals on a planar patch point ±Z (cam #3)', async () => {
    const r = await page.evaluate(() => {
      const pts = [];
      for (let i = 0; i < 7; ++i)
        for (let j = 0; j < 7; ++j)
          pts.push(i * 0.5, j * 0.5, 0);
      const p = new Float32Array(pts);
      const n = window.forge.pointcloud.estimateNormals(p, 8, [3, 3, 10]);
      let nzPos = 0;
      for (let i = 0; i < p.length / 3; ++i) {
        if (n[i * 3 + 2] > 0.8) ++nzPos;
      }
      return { total: p.length / 3, nzPos };
    });
    expect(r.nzPos).toBeGreaterThan(40);
    expect(r.nzPos).toBe(r.total);
    await shot(page, 'normals');
  });

  test('05 voxel-shell mesh round-trip (cam #4)', async () => {
    const m = await page.evaluate(() => {
      const N = 5;
      const pts = [];
      for (let i = 0; i < N; ++i)
        for (let j = 0; j < N; ++j)
          for (let k = 0; k < N; ++k)
            pts.push(i, j, k);
      const cloud = new Float32Array(pts);
      const out = window.forge.pointcloud.voxelMesh(cloud, 1.0);
      return { v: out.positions.length / 3, t: out.indices.length / 3 };
    });
    expect(m.t).toBe(300);
    expect(m.v).toBeGreaterThan(0);
    await shot(page, 'voxelmesh');
  });

  test('06 open the workbench panel + run pipeline (cam #5)', async () => {
    await page.evaluate(() => { window.__forgeOpenPointCloudWorkbench?.(); });
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid="forge-pointcloud-panel"]')).toBeVisible();
    await page.locator('[data-testid="forge-pointcloud-run"]').click();
    await page.waitForSelector('[data-testid="forge-pointcloud-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-pointcloud-result"]')).toBeVisible();
    await shot(page, 'pipeline-result');
  });

  test('07 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
