// forge-bridge.spec.js — verifies window.forge surface is complete.
//
// Run with:
//   ./node_modules/.bin/playwright test e2e/forge/forge-bridge.spec.js \
//     --reporter=list --config=e2e/forge/playwright.headless.config.js

const { test, expect } = require('@playwright/test');
const { launchForge, shot, loadInlinePage } = require('./_helpers');

let app;
let page;

test.beforeAll(async () => {
  app = await launchForge();
  page = await app.firstWindow();
});

test.afterAll(async () => {
  if (app) await app.close();
});

test('window.forge.isReady() returns true', async () => {
  await loadInlinePage(page, '<h1>Forge bridge</h1><div id="state">checking…</div>');
  const state = await page.evaluate(() => {
    return {
      hasForge: typeof window.forge !== 'undefined',
      isReady: window.forge?.isReady?.() ?? null,
      loadError: window.forge?.loadError?.() ?? null,
      version: window.forge?.version?.() ?? null,
    };
  });
  console.log('[forge-bridge]', state);
  expect(state.hasForge).toBe(true);
  expect(state.isReady).toBe(true);
  expect(state.version).toBeTruthy();
  expect(state.version.occt).toMatch(/7\.9/);
  await shot(page, '01-bridge-isReady');
});

test('every namespace is mounted', async () => {
  const namespaces = await page.evaluate(() => {
    const f = window.forge;
    return {
      assembly: !!f.assembly,
      drawings: !!f.drawings,
      sketcher: !!f.sketcher,
      fea: !!f.fea,
      cfd: !!f.cfd,
      cam: !!f.cam,
      io: !!f.io,
    };
  });
  console.log('[forge-bridge] namespaces', namespaces);
  for (const [k, v] of Object.entries(namespaces)) {
    expect(v, `forge.${k} should be mounted`).toBe(true);
  }
  await loadInlinePage(page, `
    <h1>Forge namespaces</h1>
    <div class="panel">
      <pre>${JSON.stringify(namespaces, null, 2)}</pre>
    </div>
  `);
  await shot(page, '02-bridge-namespaces');
});

test('makeBox → massProps → tessellate round-trip', async () => {
  const result = await page.evaluate(() => {
    const f = window.forge;
    const h = f.makeBox(10, 10, 10);
    const mp = f.massProps(h);
    const mesh = f.tessellate(h, 0.1, 0.5);
    f.release(h);
    return {
      handle: h,
      volume: mp.volume,
      area: mp.area,
      com: Array.from(mp.centerOfMass),
      triangleCount: mesh.triangleCount,
      vertexCount: mesh.positions.length / 3,
    };
  });
  console.log('[forge-bridge] makeBox', result);
  expect(result.volume).toBeCloseTo(1000, 3);
  expect(result.area).toBeCloseTo(600, 3);
  expect(result.com).toEqual([5, 5, 5]);
  expect(result.triangleCount).toBe(12);
  expect(result.vertexCount).toBe(24); // 6 faces × 4 unique verts per quad-split
  await loadInlinePage(page, `
    <h1>Forge makeBox(10,10,10)</h1>
    <div class="panel">
      <p>volume = <span class="num">${result.volume.toFixed(4)}</span> mm³ (expected 1000)</p>
      <p>area = <span class="num">${result.area.toFixed(4)}</span> mm² (expected 600)</p>
      <p>centre of mass = [<span class="num">${result.com.join(', ')}</span>]</p>
      <p>triangles = <span class="num">${result.triangleCount}</span>, vertices = <span class="num">${result.vertexCount}</span></p>
      <p class="ok">PASS</p>
    </div>
  `);
  await shot(page, '03-bridge-makeBox-roundtrip');
});

test('forge.io round-trips a STEP file', async () => {
  const result = await page.evaluate(() => {
    const f = window.forge;
    const h = f.makeBox(20, 15, 10);
    const path = '/tmp/forge-e2e.step';
    f.io.exportStep(h, path);
    const back = f.io.importStep(path);
    const mp = f.massProps(back);
    f.release(h); f.release(back);
    return { volume: mp.volume, area: mp.area };
  });
  expect(result.volume).toBeCloseTo(3000, 2);
  expect(result.area).toBeCloseTo(2 * (20*15 + 15*10 + 20*10), 2);
  await loadInlinePage(page, `
    <h1>STEP round-trip</h1>
    <div class="panel">
      <p>exported + re-imported 20×15×10 mm box</p>
      <p>volume = <span class="num">${result.volume.toFixed(4)}</span> mm³ (expected 3000)</p>
      <p>area = <span class="num">${result.area.toFixed(4)}</span> mm² (expected 1300)</p>
      <p class="ok">PASS</p>
    </div>
  `);
  await shot(page, '04-io-step-roundtrip');
});
