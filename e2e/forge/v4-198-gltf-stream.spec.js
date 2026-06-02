// v4-198-gltf-stream.spec.js — Forge-198 streaming glTF publish.
//
// Verifies that:
//   * the kernel binding writeGlbStream is reachable from the renderer
//   * it produces a valid .glb (header magic + glTF 2.0 + length match)
//   * peakBytesInMemory < total geometry size (the streaming guarantee)
//   * the workbench panel mounts, exports, and renders the summary
//   * manual UI never posts to Archie's thread
//
// Multi-camera angles (≥5) for the native-handle workbench rule.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-198-gltf-stream';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-198 · streaming glTF publish', () => {
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

  test('01 streaming kernel binding round-trip', async () => {
    await shot(page, 'baseline');

    const out = path.join(SHOT_DIR, 'kernel.glb');
    const result = await page.evaluate(({ outPath }) => {
      const k = window.forge;
      const gltf = window.forge && window.forge.gltf;
      if (!k || !gltf || typeof gltf.exportGlbStream !== 'function') {
        return { ok: false, why: 'binding missing',
                 hasForge: !!window.forge, hasGltf: !!(window.forge && window.forge.gltf) };
      }
      const a = k.makeBox(40, 30, 20);
      const b = k.makeBox(25, 25, 25);
      k.translate(b, 50, 0, 0);
      const c = k.makeBox(20, 20, 20);
      k.translate(c, 0, 50, 0);
      const bodies = [
        { handle: a, name: 'A', baseColor: [0.85, 0.20, 0.10, 1.0] },
        { handle: b, name: 'B', baseColor: [0.15, 0.55, 0.85, 1.0] },
        { handle: c, name: 'C', baseColor: [0.20, 0.75, 0.30, 1.0] },
      ];
      const s = gltf.exportGlbStream(bodies, outPath, { deflection: 0.5 });
      return { ok: true, s };
    }, { outPath: out });

    expect(result.ok).toBe(true);
    expect(fs.existsSync(out)).toBe(true);
    expect(result.s.bodiesWritten).toBe(3);
    expect(result.s.verticesTotal).toBeGreaterThan(0);
    expect(result.s.trianglesTotal).toBeGreaterThan(0);
    expect(result.s.peakBytesInMemory).toBeGreaterThan(0);
    // Streaming guarantee: peak < total geometry bytes
    const totalGeom = result.s.verticesTotal * 24 + result.s.trianglesTotal * 12;
    expect(result.s.peakBytesInMemory).toBeLessThan(totalGeom);

    const buf = fs.readFileSync(out);
    expect(buf.readUInt32LE(0)).toBe(0x46546C67);   // 'glTF'
    expect(buf.readUInt32LE(4)).toBe(2);            // version 2
    expect(buf.readUInt32LE(8)).toBe(buf.length);   // length matches
  });

  test('02 open the publish workbench panel (cam #1)', async () => {
    await page.evaluate(() => { window.__forgeOpenGltfPublishWorkbench?.(); });
    await page.waitForTimeout(500);
    await shot(page, 'panel-open');
    await expect(page.locator('[data-testid="forge-gltf-publish-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-gltf-filepath"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-gltf-export"]')).toBeVisible();
  });

  test('03 set a temp path + deflection (cam #2)', async () => {
    const outPath = path.join(SHOT_DIR, 'panel.glb');
    await page.locator('[data-testid="forge-gltf-filepath"]').fill(outPath);
    await page.locator('[data-testid="forge-gltf-deflection"]').fill('0.5');
    await shot(page, 'inputs-filled');
  });

  test('04 export via window.__forgeExportGlbStream API (cam #3)', async () => {
    const outPath = path.join(SHOT_DIR, 'api.glb');
    const stats = await page.evaluate(({ outPath }) => {
      const k = window.forge;
      const a = k.makeBox(30, 20, 15);
      const b = k.makeBox(20, 20, 20);
      k.translate(b, 40, 0, 0);
      const bodies = [
        { handle: a, name: 'X', color: '#d97a3b', metallic: 0.5, roughness: 0.4 },
        { handle: b, name: 'Y', color: '#2bc6e4', metallic: 0.3, roughness: 0.6 },
      ];
      return window.__forgeExportGlbStream(bodies, outPath, { deflection: 0.3 });
    }, { outPath });
    expect(stats.bodiesWritten).toBe(2);
    expect(fs.existsSync(outPath)).toBe(true);
    await shot(page, 'after-api-export');
  });

  test('05 panel export button posts summary (cam #4)', async () => {
    const outPath = path.join(SHOT_DIR, 'button.glb');
    // Seed a body so the panel has something to publish.
    await page.evaluate(() => {
      const k = window.forge;
      const h = k.makeBox(20, 20, 20);
      window.__forgeListBodies = () => [{ handle: h, name: 'panel_body' }];
    });
    await page.evaluate(() => { window.__forgeCloseGltfPublishWorkbench?.(); });
    await page.waitForTimeout(150);
    await page.evaluate(() => { window.__forgeOpenGltfPublishWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-gltf-filepath"]').fill(outPath);
    await page.locator('[data-testid="forge-gltf-export"]').click();
    await page.waitForSelector('[data-testid="forge-gltf-summary"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-gltf-summary"]')).toBeVisible();
    await shot(page, 'summary-rendered');
    expect(fs.existsSync(outPath)).toBe(true);
  });

  test('06 close + reopen (cam #5)', async () => {
    await page.evaluate(() => { window.__forgeCloseGltfPublishWorkbench?.(); });
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid="forge-gltf-publish-panel"]')).toHaveCount(0);
    await page.evaluate(() => { window.__forgeOpenGltfPublishWorkbench?.(); });
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid="forge-gltf-publish-panel"]')).toBeVisible();
    await shot(page, 'reopened');
  });

  test('07 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
