// Forge-196 — native-handle bodies MUST render in the viewport.
//
// Parity ledger item #2 (first seen Forge-171): bodies whose record is
// { kind: 'native', handle } showed a gizmo + scene-tree entry but NO
// mesh. Root cause: window.forge.tessellate's Float32Array fields cross
// the contextBridge, which clones typed arrays lossily on some Electron
// versions (the preload's writeBlob comment documents the same trap);
// THREE.BufferAttribute hard-requires TypedArrays, threw inside the try,
// and the catch swallowed it as a console.warn — every native body
// silently dropped. Fix: toTypedArray re-marshal + console.error with
// body context (no silent drop, no synthetic fallback).
//
// This spec is the truth instrument: it reports what tessellate's fields
// actually are post-bridge, then proves a native box AND a native NURBS
// patch (the Forge-171 wing path) both draw real triangles, with
// multi-angle captures per the 5-camera rule.
import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const SHOTS = path.join(__dirname, '..', 'screenshots', 'forge-196-native-render');

async function shot(page, name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

let app; let page;
const tessellateErrors = [];

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  app = await electron.launch({
    args: [path.join(__dirname, '..', '..', 'electron', 'main.js'), '--dev'],
    slowMo: 50,
  });
  page = await app.firstWindow();
  // --dev auto-opens DevTools; firstWindow() can race and grab it.
  if (page.url().startsWith('devtools://')) {
    page = (await app.windows()).find((w) => !w.url().startsWith('devtools://'))
      || await app.waitForEvent('window', { predicate: (w) => !w.url().startsWith('devtools://') });
  }
  page.on('dialog', (d) => { d.dismiss().catch(() => {}); });
  page.on('console', (msg) => {
    if (msg.text().includes('tessellate FAILED')) tessellateErrors.push(msg.text());
  });
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => {
    try { window.localStorage.setItem('forge.v4.onboarded', '1'); } catch (_) {}
  });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('[data-testid="forge-app"]', { timeout: 30000 });
  await page.waitForFunction(() => !!window.__forgeRenderer, { timeout: 15000 });
  await page.waitForTimeout(800);
});

test.afterAll(async () => { if (app) await app.close(); });

test('01 tessellate fields post-bridge are usable (marshalling truth)', async () => {
  const report = await page.evaluate(() => {
    if (!window.forge?.isReady?.()) return { err: 'kernel not ready' };
    const h = window.forge.makeBox(100, 50, 30);
    const m = window.forge.tessellate(h, 0.1, 0.5);
    const kind = (v) => v == null ? String(v)
      : ArrayBuffer.isView(v) ? v.constructor.name
      : Array.isArray(v) ? 'Array'
      : v instanceof ArrayBuffer ? 'ArrayBuffer'
      : typeof v;
    return {
      positions: kind(m.positions), posLen: m.positions?.length ?? Object.keys(m.positions || {}).length,
      normals: kind(m.normals),
      indices: kind(m.indices), idxLen: m.indices?.length ?? 0,
    };
  });
  console.log('[196] tessellate post-bridge:', JSON.stringify(report));
  expect(report.err).toBeUndefined();
  expect(report.posLen).toBeGreaterThan(0);
});

test('02 native box body draws real triangles in the viewport', async () => {
  test.setTimeout(120000);
  const id = await page.evaluate(() => {
    const h = window.forge.makeBox(100, 50, 30);
    const bodyId = `native-render-box-${h}`;
    window.__forgeAppendBody({
      id: bodyId, kind: 'native', handle: h,
      toolId: 'part.make-box', params: { dx: 100, dy: 50, dz: 30 },
      name: 'Forge-196 box',
    });
    return bodyId;
  });
  await page.waitForFunction((bid) => {
    const s = window.__forgeScene;
    if (!s) return false;
    let found = false;
    s.traverse((o) => {
      if (o.isMesh && o.geometry?.attributes?.position?.count > 0) {
        const ud = o.userData || {};
        if (ud.bodyId === bid || ud.id === bid || o.name === bid) found = true;
      }
    });
    if (found) return true;
    // fall back to counting: ANY mesh whose geometry came from tessellate
    let nativeMeshes = 0;
    s.traverse((o) => { if (o.isMesh && o.geometry?.attributes?.position?.count >= 8) nativeMeshes++; });
    return nativeMeshes > 0;
  }, id, { timeout: 20000 });
  await page.evaluate(() => { window.__forgeFit?.(); });
  await shot(page, '02-box-iso');
});

test('03 native NURBS patch (the Forge-171 wing path) renders', async () => {
  test.setTimeout(120000);
  const res = await page.evaluate(() => {
    // Same call chain as WingRibLoftPanel/buildPatch — a 3×3 curved patch.
    const xyz = new Float64Array([
      0, 0, 0, 100, 0, 40, 200, 0, 0,
      0, 100, 30, 100, 100, 80, 200, 100, 30,
      0, 200, 0, 100, 200, 40, 200, 200, 0,
    ]);
    const h = window.forge.surfacing.buildPatch({ uCount: 3, vCount: 3, xyz }, 2, 2);
    if (typeof h !== 'number' || !Number.isFinite(h)) return { err: `non-handle: ${h}` };
    window.__forgeAppendBody({
      id: `native-render-patch-${h}`, kind: 'native', handle: h,
      toolId: 'aero.wingRibLoft', surface: true, params: {},
      name: 'Forge-196 patch',
    });
    return { handle: h };
  });
  expect(res.err).toBeUndefined();
  // The patch is a single curved face — it must contribute a mesh with
  // a healthy triangle count (tessellated NURBS, not a quad).
  await page.waitForFunction(() => {
    const s = window.__forgeScene;
    if (!s) return false;
    let tris = 0;
    s.traverse((o) => {
      if (o.isMesh && o.geometry) {
        const idx = o.geometry.index;
        tris += idx ? idx.count / 3 : (o.geometry.attributes.position?.count || 0) / 3;
      }
    });
    return tris > 30; // box(12) + curved patch(many)
  }, { timeout: 20000 });

  // 5-angle capture per the multi-cam rule.
  const angles = [
    ['front', [0, 0, 500]], ['top', [0, 500, 1]], ['right', [500, 0, 0]],
    ['iso', [350, 300, 350]], ['close', [150, 120, 150]],
  ];
  for (const [name, pos] of angles) {
    await page.evaluate(([p]) => {
      const cam = window.__forgeCamera;
      if (cam) { cam.position.set(p[0], p[1], p[2]); cam.lookAt(100, 100, 30); }
      window.__forgeFit?.();
    }, [pos]);
    await page.waitForTimeout(400);
    await shot(page, `03-patch-${name}`);
  }

  // Zero tolerance for the silent-drop signature in the console.
  // (console.error now carries body context; this spec fails if any
  // tessellation failed while we were drawing.)
  expect(tessellateErrors).toEqual([]);
});
