/**
 * viewport-freeze-debug-electron.spec.js
 *
 * REPRODUCES + GUARDS the "viewport freezes on one click or drag" bug.
 *
 * The real-viewport pointer handler (Viewport3D.jsx handleClick) is registered
 * on renderer.domElement 'pointerup' — which fires for BOTH a plain click AND
 * the release of an orbit-drag. So a click and a drag-release both run the
 * full pick + selection churn (clearSelection + selectObject).
 *
 * The existing e2e suite never exercises handleClick (every spec selects via
 * window.__archdiscRegistry programmatically). This spec is the FIRST to drive
 * the viewport with REAL mouse clicks + drag-orbits, so it is the first that
 * can catch this freeze.
 *
 * Instrumentation:
 *   - A 30 ms setInterval heartbeat in the page. A frozen main thread stops the
 *     interval — sampling __hbTicks over a fixed wall-clock window detects a
 *     hard freeze (main-thread block).
 *   - A round-trip timer (win.evaluate(() => 1)) — >1 s means the thread was
 *     blocked.
 *   - orbitControls.enabled / .enableRotate — a stuck `false` is a SOFT freeze
 *     (app responsive but the viewport can no longer orbit).
 *
 * Constraints: bare `import path` (no node:), ./node_modules/.bin/playwright,
 * test.setTimeout(600000).
 */

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { buildPrimitive } from './helpers/uiWorkflow.js';

const SHOT = path.resolve(__dirname, 'screenshots');

test.setTimeout(600000); // kernel WASM cold-load + a 60+ body scene

// ─── Launch ──────────────────────────────────────────────────────────────────

async function launchAndWarm() {
  fs.mkdirSync(SHOT, { recursive: true });
  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    env: { ...process.env, NODE_ENV: 'test' },
  });
  const pageErrors = [];
  const consoleLines = [];
  const win = await app.firstWindow();
  win.on('pageerror', err => pageErrors.push(err.message));
  win.on('console', msg => {
    const t = msg.text();
    // Collect only our own diagnostic markers to keep the log readable.
    if (t.startsWith('[FREEZE-DEBUG]') || t.startsWith('[handleClick]') ||
        t.startsWith('[clearSelection]') || t.startsWith('[selectObject]')) {
      consoleLines.push(t);
    }
  });
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscKernel, null, { timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 60000 });

  // Pre-warm kernel WASM.
  await win.waitForFunction(async () => {
    try {
      await window.__archdiscKernel.getOCCT();
      window.__occtPreWarmed = { ok: true };
    } catch (e) {
      window.__occtPreWarmed = { ok: false, error: String(e) };
    }
    return !!window.__occtPreWarmed;
  }, null, { timeout: 300000 });
  const occtReady = await win.evaluate(() => window.__occtPreWarmed);
  expect(occtReady.ok, `Kernel load failed: ${occtReady.error ?? 'unknown'}`).toBe(true);

  return { app, win, pageErrors, consoleLines };
}

// ─── Heartbeat freeze detector ───────────────────────────────────────────────

/**
 * Install a 30 ms setInterval that increments window.__hbTicks. A frozen main
 * thread stops the interval entirely. Idempotent.
 */
async function installHeartbeat(win) {
  await win.evaluate(() => {
    if (window.__hbTimer) return;
    window.__hbTicks = 0;
    window.__hbTimer = setInterval(() => { window.__hbTicks += 1; }, 30);
  });
}

/**
 * Sample the heartbeat over a fixed wall-clock window. Returns the number of
 * ticks the page's main thread managed during `windowMs`. On a live thread at
 * 30 ms cadence this is ~windowMs/30; a frozen thread yields ~0.
 *
 * `winMs` is wall-clock measured on the Playwright (node) side, so a frozen
 * page genuinely produces a near-zero tick delta.
 */
async function sampleHeartbeat(win, windowMs = 1500) {
  const before = await win.evaluate(() => window.__hbTicks);
  await win.waitForTimeout(windowMs);
  const after = await win.evaluate(() => window.__hbTicks);
  return after - before;
}

/** Round-trip latency of a trivial evaluate — >1000 ms ⇒ thread was blocked. */
async function evalRoundTripMs(win) {
  const t0 = Date.now();
  await win.evaluate(() => 1);
  return Date.now() - t0;
}

/** Read the live orbitControls flags. */
async function orbitFlags(win) {
  return win.evaluate(() => {
    const oc = window.__archdiscViewport && window.__archdiscViewport.orbitControls;
    return oc ? { enabled: oc.enabled, enableRotate: oc.enableRotate } : null;
  });
}

/** Camera world position. */
async function camPos(win) {
  return win.evaluate(() => {
    const c = window.__archdiscViewport.camera;
    return { x: c.position.x, y: c.position.y, z: c.position.z };
  });
}

/** Registry selected ids + whether a selection outline exists in the scene. */
async function selectionState(win) {
  return win.evaluate(() => {
    const reg = window.__archdiscRegistry;
    const sel = reg && reg.selectedIds ? reg.selectedIds() : [];
    const outline = window.__archdiscViewport.scene
      .getObjectByName('__selection_outline__');
    return { selectedIds: sel, hasOutline: !!outline };
  });
}

// ─── handleClick instrumentation (spec-side, via console.log wrap) ───────────

/**
 * Wrap the three suspect functions with performance.now() timing that
 * console.logs the duration. We cannot reach the closures directly, so we
 * monkey-patch the *Three.js* layer the closures call:
 *   - Object3D.prototype.getObjectByName  (the O(N) recursion clearSelection
 *     calls per-group → the O(N²) hot loop)
 *   - Scene.traverse                       (clearSelection's whole-scene walk)
 * and report aggregate time + call counts during a window we explicitly
 * bracket. This pinpoints WHICH operation is slow without editing app source.
 */
async function instrumentThree(win) {
  await win.evaluate(() => {
    const THREE = window.THREE;
    if (!THREE || THREE.__freezeInstrumented) return;
    THREE.__freezeInstrumented = true;
    window.__freezeStats = {
      getObjectByName: { calls: 0, ms: 0 },
      traverse: { calls: 0, ms: 0 },
      geometryClone: { calls: 0, ms: 0 },
    };
    const O3D = THREE.Object3D.prototype;
    const origGOBN = O3D.getObjectByName;
    O3D.getObjectByName = function (name) {
      const t0 = performance.now();
      const r = origGOBN.call(this, name);
      window.__freezeStats.getObjectByName.calls += 1;
      window.__freezeStats.getObjectByName.ms += performance.now() - t0;
      return r;
    };
    const origTraverse = O3D.traverse;
    O3D.traverse = function (cb) {
      const t0 = performance.now();
      const r = origTraverse.call(this, cb);
      window.__freezeStats.traverse.calls += 1;
      window.__freezeStats.traverse.ms += performance.now() - t0;
      return r;
    };
    const origClone = THREE.BufferGeometry.prototype.clone;
    THREE.BufferGeometry.prototype.clone = function () {
      const t0 = performance.now();
      const r = origClone.call(this);
      window.__freezeStats.geometryClone.calls += 1;
      window.__freezeStats.geometryClone.ms += performance.now() - t0;
      return r;
    };
  });
}

/** Reset the aggregate counters so the next interaction is measured cleanly. */
async function resetFreezeStats(win) {
  await win.evaluate(() => {
    if (window.__freezeStats) {
      for (const k of Object.keys(window.__freezeStats)) {
        window.__freezeStats[k] = { calls: 0, ms: 0 };
      }
    }
  });
}

async function readFreezeStats(win) {
  return win.evaluate(() => window.__freezeStats || null);
}

// ─── Build a scene of N primitives across a grid ─────────────────────────────

/**
 * Build `n` primitive bodies. The first 2-3 are built via the real ribbon
 * (buildPrimitive — Part tab + click + dialog bypass). For large counts the
 * remainder are cloned scene-side from a real ribbon-built body so the scene
 * genuinely has N pickable groups WITHOUT an N-minute kernel build. Each clone
 * is a real THREE.Group registered in the BodyRegistry exactly like a ribbon
 * body — identical structure to what handleClick / clearSelection traverse.
 *
 * Returns the registry ids of all bodies.
 */
async function buildScene(win, n) {
  // Always build at least one real ribbon body so the scene has a genuine
  // kernel-tessellated group to clone and to click.
  const realIds = [];
  realIds.push(await buildPrimitive(win, 'Box', { dx: 20, dy: 20, dz: 20 }));
  if (n >= 2) realIds.push(await buildPrimitive(win, 'Cylinder'));
  if (n >= 3 && n <= 5) realIds.push(await buildPrimitive(win, 'Sphere'));

  if (n <= realIds.length) return realIds;

  // Clone the first real body's group to reach N. Spread the clones on a grid
  // so they are visually distinct and pickable, and register each so the
  // registry has N entries (clearSelection traverses the whole scene).
  await win.evaluate((extra) => {
    const reg = window.__archdiscRegistry;
    const scene = window.__archdiscViewport.scene;
    const THREE = window.THREE;
    const seed = reg.bodies[0] && reg.bodies[0].group;
    if (!seed) throw new Error('buildScene: no seed body group');
    const cols = Math.ceil(Math.sqrt(extra));
    for (let i = 0; i < extra; i++) {
      const g = seed.clone(true); // deep clone — meshes + geometry refs
      const col = i % cols, row = Math.floor(i / cols);
      // 30 mm spacing in scene metres (group scale is 0.001).
      g.position.set((col - cols / 2) * 0.03, 0, (row - cols / 2) * 0.03);
      g.userData = { pickable: true, generatedModel: true, brepShape: true };
      g.updateMatrixWorld(true);
      scene.add(g);
      // Register so the BodyRegistry has a real entry (and a body group the
      // freeze-prone clearSelection scan will walk).
      const shim = { volume: () => 8000 };
      reg.register({ group: g, manifold: shim, sourceTool: 'CloneFill' });
    }
  }, n - realIds.length);

  return win.evaluate(() => window.__archdiscRegistry.bodies.map(b => b.id));
}

/** Project a body's centroid to a viewport CSS pixel (camera projection). */
async function projectBody(win, bodyId) {
  return win.evaluate((bid) => {
    const vp = window.__archdiscViewport;
    const reg = window.__archdiscRegistry;
    const body = reg.bodies.find(b => b.id === bid);
    if (!body || !body.group) return null;
    const g = body.group;
    g.updateMatrixWorld(true);
    const box = new window.THREE.Box3().setFromObject(g);
    if (box.isEmpty()) return null;
    const c = box.getCenter(new window.THREE.Vector3());
    const cam = vp.camera;
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    const ndc = c.clone().project(cam);
    const rect = vp.renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + (ndc.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (-ndc.y * 0.5 + 0.5) * rect.height,
      inFront: ndc.z < 1,
    };
  }, bodyId);
}

/** Frame a body centre-screen via the app's own focus hook. */
async function frameBody(win, bodyId) {
  await win.evaluate((bid) => {
    const reg = window.__archdiscRegistry;
    const body = reg.bodies.find(b => b.id === bid);
    if (body && body.group && typeof window.__archdiscFocusOnObject === 'function') {
      window.__archdiscFocusOnObject(body.group);
    }
  }, bodyId);
  await win.waitForTimeout(260);
}

// ─── Diagnostic report ───────────────────────────────────────────────────────

function report(title, lines) {
  console.log(`\n  ┌─ ${title}`);
  for (const l of lines) console.log(`  │  ${l}`);
  console.log('  └─');
}

// ════════════════════════════════════════════════════════════════════════════
// The probe — runs A (real click) and B (real drag-orbit) at a given scene
// scale and returns the measured diagnostics. Reused for the small-scene and
// large-scene cases so the freeze threshold is recorded unambiguously.
// ════════════════════════════════════════════════════════════════════════════

async function probeAtScale(win, sceneSize, label) {
  const ids = await buildScene(win, sceneSize);
  const bodyCount = await win.evaluate(() => window.__archdiscViewport.scene.children
    .filter(o => o.isGroup && o.userData && o.userData.pickable).length);

  await installHeartbeat(win);
  await instrumentThree(win);

  // ── Test A: real viewport CLICK on a body ──────────────────────────────────
  const targetId = ids[Math.min(2, ids.length - 1)];
  await frameBody(win, targetId);
  const proj = await projectBody(win, targetId);
  expect(proj, `${label}: body ${targetId} must project to screen`).not.toBeNull();

  await resetFreezeStats(win);
  const clickRT0 = await evalRoundTripMs(win); // baseline (thread idle)
  // Issue the click, then immediately race a heartbeat sample against it.
  const clickPromise = win.mouse.click(proj.x, proj.y);
  const hbDuringClick = await sampleHeartbeat(win, 1500);
  await clickPromise;
  const clickRT = await evalRoundTripMs(win);
  const clickStats = await readFreezeStats(win);
  const flagsAfterClick = await orbitFlags(win);
  const selAfterClick = await selectionState(win);

  // ── Test B: real DRAG-ORBIT on the viewport canvas ─────────────────────────
  const box = await win.locator('canvas').first().boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const camBefore = await camPos(win);
  const selBeforeDrag = await selectionState(win);

  await resetFreezeStats(win);
  await win.mouse.move(cx, cy, { steps: 6 });
  await win.mouse.down();
  await win.mouse.move(cx + 220, cy + 60, { steps: 24 });
  // Sample the heartbeat WHILE the drag-release handler runs.
  const upPromise = win.mouse.up();
  const hbDuringDrag = await sampleHeartbeat(win, 1500);
  await upPromise;
  const dragRT = await evalRoundTripMs(win);
  const dragStats = await readFreezeStats(win);
  const flagsAfterDrag = await orbitFlags(win);
  const camAfter = await camPos(win);
  const selAfterDrag = await selectionState(win);
  const camDelta = Math.hypot(
    camAfter.x - camBefore.x, camAfter.y - camBefore.y, camAfter.z - camBefore.z);

  // hb baseline: ~1500/30 ≈ 50 ticks on a fully live thread.
  const liveTicks = Math.round(1500 / 30);

  report(`${label} — scene=${bodyCount} pickable groups`, [
    `[A click]  heartbeat ticks during 1.5 s window: ${hbDuringClick}  (live≈${liveTicks})`,
    `[A click]  eval round-trip: baseline ${clickRT0} ms → after-click ${clickRT} ms`,
    `[A click]  getObjectByName: ${clickStats.getObjectByName.calls} calls, ` +
      `${clickStats.getObjectByName.ms.toFixed(1)} ms total`,
    `[A click]  scene.traverse: ${clickStats.traverse.calls} calls, ` +
      `${clickStats.traverse.ms.toFixed(1)} ms total`,
    `[A click]  geometry.clone: ${clickStats.geometryClone.calls} calls, ` +
      `${clickStats.geometryClone.ms.toFixed(1)} ms total`,
    `[A click]  orbitControls after: enabled=${flagsAfterClick.enabled} ` +
      `enableRotate=${flagsAfterClick.enableRotate}`,
    `[A click]  selection after: ids=${JSON.stringify(selAfterClick.selectedIds)} ` +
      `outline=${selAfterClick.hasOutline}`,
    `[B drag]   heartbeat ticks during 1.5 s window: ${hbDuringDrag}  (live≈${liveTicks})`,
    `[B drag]   eval round-trip after drag-release: ${dragRT} ms`,
    `[B drag]   getObjectByName: ${dragStats.getObjectByName.calls} calls, ` +
      `${dragStats.getObjectByName.ms.toFixed(1)} ms total`,
    `[B drag]   geometry.clone during drag-release: ${dragStats.geometryClone.calls} calls`,
    `[B drag]   orbitControls after: enabled=${flagsAfterDrag.enabled} ` +
      `enableRotate=${flagsAfterDrag.enableRotate}`,
    `[B drag]   camera moved: ${camDelta.toExponential(2)} (>0 ⇒ orbit worked)`,
    `[B drag]   selection before=${JSON.stringify(selBeforeDrag.selectedIds)} ` +
      `after=${JSON.stringify(selAfterDrag.selectedIds)}`,
  ]);

  return {
    bodyCount,
    hbDuringClick, hbDuringDrag, liveTicks,
    clickRT0, clickRT, dragRT,
    clickStats, dragStats,
    flagsAfterClick, flagsAfterDrag,
    selBeforeDrag, selAfterClick, selAfterDrag,
    camDelta, targetId,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// SPEC 1 — small scene (3 bodies). Establishes the baseline.
// ════════════════════════════════════════════════════════════════════════════

test('viewport-freeze: small scene (3 bodies) — click + drag stay responsive', async () => {
  const { app, win, pageErrors } = await launchAndWarm();
  try {
    const r = await probeAtScale(win, 3, 'SMALL SCENE');

    // A genuine click must select; a drag must orbit and NOT alter selection.
    expect(r.flagsAfterClick.enabled, 'orbitControls.enabled stuck false after click').toBe(true);
    expect(r.flagsAfterClick.enableRotate, 'enableRotate stuck false after click').toBe(true);
    expect(r.flagsAfterDrag.enabled, 'orbitControls.enabled stuck false after drag').toBe(true);
    expect(r.flagsAfterDrag.enableRotate, 'enableRotate stuck false after drag').toBe(true);
    // Heartbeat must keep ticking — main thread stayed live.
    expect(r.hbDuringClick, 'main thread froze during click').toBeGreaterThan(r.liveTicks * 0.4);
    expect(r.hbDuringDrag, 'main thread froze during drag-release').toBeGreaterThan(r.liveTicks * 0.4);
    // Click selects.
    expect(r.selAfterClick.selectedIds.length, 'genuine click did not select').toBeGreaterThan(0);
    // Drag must NOT change the selection (correct CAD UX).
    expect(r.selAfterDrag.selectedIds, 'drag-orbit altered the selection')
      .toEqual(r.selBeforeDrag.selectedIds);
    // Drag actually orbited.
    expect(r.camDelta, 'drag-orbit did not move the camera').toBeGreaterThan(0);

    await win.screenshot({ path: path.join(SHOT, 'freeze-debug-small.png') });
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

// ════════════════════════════════════════════════════════════════════════════
// SPEC 2 — large scene (70 bodies). Crosses the BVH>50 threshold and makes the
// O(N²) clearSelection scan bite. This is the scale the user freeze hits.
// ════════════════════════════════════════════════════════════════════════════

test('viewport-freeze: large scene (70 bodies) — click + drag must NOT freeze', async () => {
  const { app, win, pageErrors, consoleLines } = await launchAndWarm();
  try {
    const r = await probeAtScale(win, 70, 'LARGE SCENE');

    report('ROOT-CAUSE VERDICT', [
      `pickable groups in scene: ${r.bodyCount}`,
      `click-handler O(N²) getObjectByName time: ${r.clickStats.getObjectByName.ms.toFixed(0)} ms`,
      `click-handler geometry.clone time: ${r.clickStats.geometryClone.ms.toFixed(0)} ms`,
      `drag-release ALSO ran the pick path: ` +
        `getObjectByName=${r.dragStats.getObjectByName.calls} calls, ` +
        `geometry.clone=${r.dragStats.geometryClone.calls} calls ` +
        `(a drag should run NEITHER)`,
      `main-thread hb during click: ${r.hbDuringClick}/${r.liveTicks} ` +
        `(${r.hbDuringClick < r.liveTicks * 0.4 ? 'FROZE' : 'live'})`,
      `main-thread hb during drag : ${r.hbDuringDrag}/${r.liveTicks} ` +
        `(${r.hbDuringDrag < r.liveTicks * 0.4 ? 'FROZE' : 'live'})`,
      `orbitControls after drag: enabled=${r.flagsAfterDrag.enabled} ` +
        `(${r.flagsAfterDrag.enabled ? 'ok' : 'STUCK — soft freeze'})`,
    ]);
    if (consoleLines.length) {
      report('app console markers', consoleLines.slice(-20));
    }

    // ── Hard assertions: the fixed handler must NOT freeze at 70 bodies ──────
    // Main thread stays live through BOTH interactions.
    expect(r.hbDuringClick, 'HARD FREEZE: main thread blocked during click at 70 bodies')
      .toBeGreaterThan(r.liveTicks * 0.4);
    expect(r.hbDuringDrag, 'HARD FREEZE: main thread blocked during drag-release at 70 bodies')
      .toBeGreaterThan(r.liveTicks * 0.4);
    // The click handler's whole-scene scan must be cheap (de-quadratic'd).
    expect(r.clickStats.getObjectByName.ms,
      'clearSelection getObjectByName scan too slow — still O(N²)').toBeLessThan(500);
    // eval round-trip after each interaction proves no residual block.
    expect(r.clickRT, 'thread blocked >1 s after click').toBeLessThan(1000);
    expect(r.dragRT, 'thread blocked >1 s after drag').toBeLessThan(1000);
    // SOFT freeze guard: orbit must never be left disabled.
    expect(r.flagsAfterClick.enabled, 'SOFT FREEZE: orbit disabled after click').toBe(true);
    expect(r.flagsAfterClick.enableRotate, 'SOFT FREEZE: rotate disabled after click').toBe(true);
    expect(r.flagsAfterDrag.enabled, 'SOFT FREEZE: orbit disabled after drag').toBe(true);
    expect(r.flagsAfterDrag.enableRotate, 'SOFT FREEZE: rotate disabled after drag').toBe(true);
    // A drag-orbit must NOT run the selection path → selection unchanged.
    expect(r.dragStats.geometryClone.calls,
      'drag-orbit ran selectObject (geometry.clone) — drag should not select').toBe(0);
    expect(r.selAfterDrag.selectedIds, 'drag-orbit altered the selection at 70 bodies')
      .toEqual(r.selBeforeDrag.selectedIds);
    // A genuine click STILL selects (motion-capture clickBody depends on this).
    expect(r.selAfterClick.selectedIds.length,
      'genuine click stopped selecting after the fix').toBeGreaterThan(0);
    // Drag still orbits.
    expect(r.camDelta, 'drag-orbit no longer moves the camera').toBeGreaterThan(0);

    await win.screenshot({ path: path.join(SHOT, 'freeze-debug-large.png') });
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});
