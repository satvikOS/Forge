const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

test('diag: time solve vs overlay', async () => {
  test.setTimeout(120000);
  const app = await _electron.launch({ args: [ELECTRON_MAIN, '--no-sandbox'], env: { ...process.env, FORGE_E2E: '1' } });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(
    () => !!(window.forge && window.forge.isReady && window.forge.isReady()
             && window.__forgeScene && window.__forgeThree && window.__forgeEngine),
    { timeout: 40000 });

  // Step 1: raw kernel solve only, coarse mesh, timed.
  const t1 = await page.evaluate(async () => {
    const T0 = performance.now();
    const h = window.forge.makeBox(60, 20, 8);
    const mesh = window.forge.fea.meshFromBrep(h, 0.006);
    const T1 = performance.now();
    const info = { nodeCount: mesh.nodeCount, elemCount: mesh.elemCount, hasTets: !!mesh.tets, hasElements: !!mesh.elements, meshMs: T1 - T0 };
    return info;
  });
  console.log('[diag] mesh:', JSON.stringify(t1));

  // Step 2: full verb dispatch, coarse mesh, timed, with a hard 30s race.
  const t2 = await page.evaluate(async () => {
    const T0 = performance.now();
    const h = window.forge.makeBox(60, 20, 8);
    window.__forgeAppendBody?.({ id: `diag-${h}`, kind: 'native', handle: h, toolId: 'part.make-box', params: { dx: 60, dy: 20, dz: 8 }, name: 'diag' });
    const p = window.__forgeEngine.dispatchToolCall({
      name: 'simulate.fea-static',
      arguments: { shape: h, material: { E: 2.1e11, nu: 0.3, rho: 7850 }, fixedFace: '-x', loadFace: '+x', force: [0,0,-1500], meshSize: 6 },
    });
    const timeout = new Promise((res) => setTimeout(() => res({ TIMEOUT: true }), 30000));
    const r = await Promise.race([p, timeout]);
    return { ms: performance.now() - T0, ok: r.ok, overlay: r.result?.overlay, err: r.error, timeout: r.TIMEOUT };
  });
  console.log('[diag] dispatch:', JSON.stringify(t2));
  await app.close();
  expect(t2.timeout).toBeFalsy();
});
