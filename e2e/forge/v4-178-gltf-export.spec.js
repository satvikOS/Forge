// v4-178-gltf-export.spec.js — Forge-178 glTF 2.0 binary export.
// Drives the renderer's `window.forge.gltf.exportGlb`, writes a .glb to
// disk via the preload IPC, parses it back in JS, and verifies the
// returned summary + file structure round-trip cleanly.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-178-gltf';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-178 · glTF export · publishing workflow', () => {
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

  test('01 baseline + gltf bridge wired', async () => {
    await shot(page, 'baseline');
    const has = await page.evaluate(() =>
      typeof window.forge === 'object'
      && typeof window.forge.gltf === 'object'
      && typeof window.forge.gltf.exportGlb === 'function');
    expect(has).toBe(true);
  });

  test('02 build a 3-body scene', async () => {
    await page.evaluate(() => {
      const box = window.forge.makeBox(20, 30, 10);
      const cyl = window.forge.makeCylinder(8, 25);
      const sph = window.forge.makeSphere(10);
      window.__forgeAppendBody({ id: 'b1', kind: 'native', handle: box, label: 'box-20',  name: 'box-20' });
      window.__forgeAppendBody({ id: 'b2', kind: 'native', handle: cyl, label: 'cyl-8',   name: 'cyl-8' });
      window.__forgeAppendBody({ id: 'b3', kind: 'native', handle: sph, label: 'sph-10',  name: 'sph-10' });
    });
    await page.waitForTimeout(800);
    await shot(page, 'scene-built');
  });

  test('03 export glTF binary (.glb) to /tmp', async () => {
    const outPath = '/tmp/v4-178-gltf/scene.glb';
    const summary = await page.evaluate(async (filePath) => {
      const bodies = (window.__forgeBodies || []).map((b, i) => ({
        handle: b.handle, name: b.name || `body_${i}`,
        baseColor: [0.5 + i * 0.1, 0.6, 0.8 - i * 0.1, 1.0],
        metallic: 0.3 + i * 0.1, roughness: 0.5,
      }));
      return window.forge.gltf.exportGlb(bodies, filePath,
        { deflection: 0.1, angularDeflection: 0.4, computeNormals: true,
          generator: 'Forge MCAD (e2e Forge-178)' });
    }, outPath);
    expect(summary.bodiesWritten).toBe(3);
    expect(summary.verticesTotal).toBeGreaterThan(100);
    expect(summary.trianglesTotal).toBeGreaterThan(50);
    expect(fs.existsSync(outPath)).toBe(true);
    const stat = fs.statSync(outPath);
    expect(stat.size).toBe(summary.fileSizeBytes);
    await shot(page, 'after-export');
  });

  test('04 verify .glb header — magic, version, chunks', async () => {
    const buf = fs.readFileSync('/tmp/v4-178-gltf/scene.glb');
    expect(buf.readUInt32LE(0)).toBe(0x46546C67);     // 'glTF'
    expect(buf.readUInt32LE(4)).toBe(2);              // version
    expect(buf.readUInt32LE(8)).toBe(buf.length);     // total length
    const jsonLen = buf.readUInt32LE(12);
    expect(buf.readUInt32LE(16)).toBe(0x4E4F534A);    // JSON chunk type
    const jsonStr = buf.toString('utf8', 20, 20 + jsonLen).trim();
    const json = JSON.parse(jsonStr);
    expect(json.asset.version).toBe('2.0');
    expect(json.scenes.length).toBe(1);
    expect(json.nodes.length).toBe(3);
    expect(json.materials.length).toBe(3);
    // Materials should carry the per-body PBR factors we set
    for (let i = 0; i < 3; ++i) {
      const m = json.materials[i].pbrMetallicRoughness;
      expect(Math.abs(m.metallicFactor - (0.3 + i * 0.1))).toBeLessThan(0.01);
    }
  });
});
