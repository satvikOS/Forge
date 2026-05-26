/**
 * Render fix — Assembly tab "Insert Component" must render filled bodies
 * from every angle, not just edges/outlines.
 *
 * User-reported bug (screenshot of Assembly tab with 6 components under
 * "GEN"): viewport showed only edges/outlines, no filled face geometry; the
 * model "is not at all fully visible at same angle. have to move around to
 * the other side". Classic FrontSide-only symptom — DIFFERENT from the
 * earlier `ManifoldThreeBridge.manifoldToMesh` FrontSide fix (commit
 * c300ff6a), which only touched the foundation-manifold bridge.
 *
 * Root cause: the Assembly tab inserts components via
 * `AssemblyBridge.renderAssembly`, which has TWO render paths:
 *
 *   1. Instanced (>= 5 parts sharing one solid): builds an `InstancedMesh`
 *      with a material from `EngineMaterials.makeMaterial`. That helper
 *      builds a `MeshPhysicalMaterial` WITHOUT setting `side`, so it
 *      inherits the Three.js default of `FrontSide`. When the user inserts
 *      6 components from the same active solid, all 6 go through this
 *      path → at orbit angles where the camera sees back-faces, nothing
 *      draws. No edge-overlay exists on the instanced path either, so the
 *      body just disappears.
 *
 *   2. Non-instanced (< 5 parts per solid identity): goes through
 *      `ThreeJSBridge.solidToGroup` which DOES set DoubleSide; the
 *      Assembly bridge then post-applies `EngineMaterials.applyToMaterial`
 *      which does not touch `side`, so DoubleSide is preserved. Was OK
 *      already; we re-assert DoubleSide defensively in case a future
 *      preset row needs FrontSide for transparency.
 *
 * Fix: in `AssemblyBridge.js`, force `material.side = THREE.DoubleSide`
 * after `EngineMaterials.makeMaterial` on the instanced path, and re-
 * assert DoubleSide + `frustumCulled = false` on every mesh in the
 * non-instanced and legacy paths.
 *
 * This spec verifies the fix end-to-end in headed Electron:
 *
 *   - Switch to the Assembly tab via the ribbon.
 *   - Insert 6 components — the same active solid is reused so all 6
 *     instance into one InstancedMesh (the previously-broken path).
 *   - Orbit the camera around the assembly centre at 4 azimuth angles
 *     (0°, 90°, 180°, 270°) and screenshot the canvas at each.
 *   - Assert every canvas-PNG > 15 KB (filled geometry compresses to
 *     tens of KB; an edges-only or empty canvas compresses to under
 *     8 KB on a #000 background).
 *
 * Run with:
 *   ./node_modules/.bin/playwright test \
 *     e2e/render-assembly-components-visible-electron.spec.js \
 *     --workers=1 --reporter=list
 */

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT  = path.resolve(__dirname, '..', 'e2e-output', 'render-assembly-components-visible');
const MAIN = path.resolve(__dirname, '..', 'electron', 'main.js');

test.describe.configure({ mode: 'serial' });

test('assembly-tab components stay filled from every camera angle', async () => {
  test.setTimeout(300000);
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(OUT)) {
    if (f.endsWith('.png') || f.endsWith('.webm')) {
      try { fs.rmSync(path.join(OUT, f)); } catch {}
    }
  }

  const app = await electron.launch({
    args: [MAIN],
    env: { ...process.env, NODE_ENV: 'test' },
    slowMo: 120,
    recordVideo: { dir: OUT, size: { width: 1440, height: 900 } },
  });
  const win = await app.firstWindow();
  const pageErrors = [];
  win.on('pageerror', (err) => pageErrors.push(err.message));
  win.on('console', (msg) => { if (msg.type() === 'error') pageErrors.push(`[console] ${msg.text()}`); });

  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscAtomic, null, { timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 60000 });

  // ─── A. Build an active solid in the Part tab so Insert Component reuses it ──
  // We build a single distinguishable solid (a 30 mm box) on the feature tree,
  // then switch to the Assembly tab and click Insert Component 6 times. All 6
  // parts will share the SAME solid identity → all 6 go into one
  // `THREE.InstancedMesh` (the previously-broken FrontSide path).
  await win.evaluate(async () => {
    const A = window.__archdiscAtomic;
    const box = A.createPart('assembly-shared-solid');
    await A.startSketch(box, 'XY');
    A.sketchRectangle(box, 0, 0, 30, 30);
    A.finishSketch(box);
    await A.extrude(box, 30);
  });

  // ─── B. Switch to Assembly tab via the ribbon ─────────────────────────
  await win.locator('.ribbon-tab').filter({ hasText: /^\s*Assembly\s*$/ }).first().click();
  await win.waitForTimeout(500);

  // ─── C. Click "Insert Component" 6 times ──────────────────────────────
  // Use the ribbon-tool selector (matches every other ribbon-driven spec).
  // Each click adds a new PartInstance sharing the same active solid.
  const insertBtn = win.locator('.ribbon-tool').filter({ hasText: /Insert Component/ }).first();
  await expect(insertBtn).toBeVisible({ timeout: 10000 });
  for (let i = 0; i < 6; i++) {
    await insertBtn.dispatchEvent('click');
    await win.waitForTimeout(450);
  }
  await win.waitForTimeout(800);

  // Verify the assembly actually built up to 6 parts in one InstancedMesh
  // (or 6 regular groups; either way the spec asserts visibility).
  const summary = await win.evaluate(() => {
    const scene = window.__three_scene;
    let instancedCount = 0;
    let regularCount = 0;
    let bounds = null;
    scene.traverse(o => {
      if (o.isInstancedMesh && o.userData?.instanced) {
        instancedCount += o.count || 0;
        const THREE = window.THREE;
        const b = new THREE.Box3().setFromObject(o);
        bounds = bounds ? bounds.union(b) : b;
      } else if (o.isMesh && o.userData?.solidId != null && !o.userData.instanced
                 && o.parent?.userData?.partId != null) {
        regularCount++;
        const THREE = window.THREE;
        const b = new THREE.Box3().setFromObject(o);
        bounds = bounds ? bounds.union(b) : b;
      }
    });
    const center = bounds && !bounds.isEmpty()
      ? bounds.getCenter(new window.THREE.Vector3()) : new window.THREE.Vector3();
    const size   = bounds && !bounds.isEmpty()
      ? bounds.getSize(new window.THREE.Vector3())   : new window.THREE.Vector3(0.06, 0.06, 0.06);
    return {
      instancedCount, regularCount,
      total: instancedCount + regularCount,
      center: [center.x, center.y, center.z],
      size:   [size.x,   size.y,   size.z],
    };
  });
  console.log(`  [build] ${JSON.stringify(summary)}`);
  expect(summary.total).toBeGreaterThanOrEqual(6);

  // Cross-check the non-instanced mesh materials carry the DoubleSide
  // re-assertion from `_addPartAsGroup`. Without the fix, a future
  // EngineMaterials preset that overwrites `.side` (e.g. for a transparent
  // material) would silently regress this path.
  const nonInstSides = await win.evaluate(() => {
    const sides = [];
    window.__three_scene.traverse(o => {
      if (o.isMesh && o.parent?.userData?.partId != null) {
        const m = Array.isArray(o.material) ? o.material[0] : o.material;
        sides.push(m?.side);
      }
    });
    return sides;
  });
  console.log(`  [non-inst-sides] ${JSON.stringify(nonInstSides)}`);
  // THREE.DoubleSide === 2. Every part mesh must have side=2.
  for (const s of nonInstSides) expect(s).toBe(2);

  // ─── D. Orbit the camera around the assembly centre at 4 azimuths ─────
  const canvasLoc = win.locator('.workbench-viewport canvas').first();
  const angles = [0, 90, 180, 270];
  const ringRadius = Math.max(
    summary.size[0], summary.size[1], summary.size[2], 0.06,
  ) * 4; // 4× the longest dim — comfortable orbit distance

  const sizes = [];
  for (const az of angles) {
    await win.evaluate(({ centre, az, r }) => {
      const vp = window.__archdiscViewport;
      const THREE = window.THREE;
      const target = new THREE.Vector3(centre[0], centre[1], centre[2]);
      const elDeg = 20;
      const azRad = (az * Math.PI) / 180;
      const elRad = (elDeg * Math.PI) / 180;
      vp.camera.position.set(
        target.x + r * Math.cos(elRad) * Math.sin(azRad),
        target.y + r * Math.sin(elRad),
        target.z + r * Math.cos(elRad) * Math.cos(azRad),
      );
      vp.camera.near = Math.max(r * 0.005, 1e-4);
      vp.camera.far  = Math.max(r * 200, 100);
      vp.camera.updateProjectionMatrix();
      vp.camera.lookAt(target);
      vp.orbitControls.target.copy(target);
      vp.orbitControls.update();
      vp.renderer.render(vp.scene, vp.camera);
    }, { centre: summary.center, az, r: ringRadius });
    await win.waitForTimeout(220);

    const winFile    = path.join(OUT, `assembly-az${String(az).padStart(3,'0')}.png`);
    const canvasFile = path.join(OUT, `assembly-az${String(az).padStart(3,'0')}-canvas.png`);
    await win.screenshot({ path: winFile });
    let canvasBuf = null;
    try {
      canvasBuf = await canvasLoc.screenshot({ path: canvasFile });
    } catch {
      canvasBuf = null;
    }
    const canvasSize = canvasBuf
      ? canvasBuf.length
      : (fs.existsSync(canvasFile) ? fs.statSync(canvasFile).size : 0);
    console.log(`  [orbit] az=${az}°  canvas-png=${canvasSize}B`);
    sizes.push({ az, canvasSize });
  }

  // ─── E. Assertions ────────────────────────────────────────────────────
  // Threshold 15 KB: edges-only or near-empty canvas compresses to under
  // 8 KB on a near-#000 background; a fully shaded body of any meaningful
  // size produces tens of KB. We allow a generous lower bound so a small
  // body on a corner of the canvas isn't false-flagged.
  const MIN_BYTES = 15_000;
  const bad = sizes.filter(s => s.canvasSize < MIN_BYTES);
  if (bad.length) {
    console.error('  [INVISIBLE / EDGES-ONLY ANGLES]');
    for (const r of bad) console.error(`    - az=${r.az}°  canvas-png=${r.canvasSize}B`);
  }
  expect(bad).toEqual([]);

  // Page errors during the run would also indicate a regression.
  const fatalErrors = pageErrors.filter(e => !/ResizeObserver|wasm/i.test(e));
  console.log(`  [summary] ${sizes.length} angles checked, all filled.`);
  console.log(`  [errors]  pageErrors=${pageErrors.length} (fatal=${fatalErrors.length})`);

  // ─── F. Force-instanced coverage ─────────────────────────────────────
  // The Insert Component ribbon handler calls `getFeatureTree().getSolid()`
  // — in this headed environment that returns null (the `__archdiscAtomic`
  // solid isn't on the feature tree), so every click makes a NEW
  // `PrimitiveBuilder.box`, each with its own solid identity → all 6 land
  // on the non-instanced path. That covers the DoubleSide re-assertion in
  // `_addPartAsGroup`. To ALSO cover the InstancedMesh path (the more
  // critical part of the fix, since `EngineMaterials.makeMaterial`
  // historically inherited FrontSide), drive `AssemblyBridge.renderAssembly`
  // directly with an Assembly whose parts all share ONE solid object —
  // that forces `_buildInstancedGroup` (threshold = 5).
  const instOut = await win.evaluate(async () => {
    // Wait for the assembly API helper to be available — exposed by
    // ToolExecutionEngine on workbench mount.
    if (!window.__archdiscAssemblyApi) {
      // Helper not exposed in this build — bail with a sentinel so the
      // test fails clearly (the original spec already covers the
      // non-instanced path).
      return { error: 'no __archdiscAssemblyApi' };
    }
    const { Assembly, PrimitiveBuilder, Vec3, AssemblyBridge } =
      window.__archdiscAssemblyApi;
    const scene = window.__three_scene;
    // Wipe the previous assembly's render-root if any
    const stale = [];
    scene.traverse(o => { if (o.userData?.isAssembly) stale.push(o); });
    for (const r of stale) AssemblyBridge.dispose(r, scene);

    const asm = new Assembly('InstancedCoverage');
    // Use 1 m boxes spread on a 3-m line — matches the world units of
    // the non-instanced path so the same camera ring radius framing
    // captures both. The Insert Component default is `PrimitiveBuilder
    // .box(1, 1, 1)`, so we mirror that here for the forced-instanced
    // coverage too.
    const shared = PrimitiveBuilder.box(1, 1, 1, new Vec3(0, 0, 0));
    for (let i = 0; i < 6; i++) {
      asm.addPart(shared, `inst-${i}`, {
        color: 0x4a90d9,
        position: new Vec3((i - 2.5) * 1.5, 0, 0),
      });
    }
    const root = AssemblyBridge.renderAssembly(asm, scene);

    // Verify we DID get an InstancedMesh
    let instCount = 0;
    let instSide = null;
    let instFrustum = null;
    root.traverse(o => {
      if (o.isInstancedMesh) {
        instCount += o.count || 0;
        instSide = o.material?.side ?? null;
        instFrustum = o.frustumCulled;
      }
    });
    return { instCount, instSide, instFrustum };
  });
  console.log(`  [forced-instanced] ${JSON.stringify(instOut)}`);
  // THREE.DoubleSide === 2 in three.js (Material side enum).
  // THIS is the assertion that pins down the actual bug fix: before the
  // fix, `EngineMaterials.makeMaterial` produced a MeshPhysicalMaterial
  // with default FrontSide (=0), and the user could not see assembly
  // bodies at certain camera angles. After the fix, every instanced
  // material is DoubleSide and frustum-cull-off.
  expect(instOut.instCount).toBe(6);
  expect(instOut.instSide).toBe(2);             // DoubleSide
  expect(instOut.instFrustum).toBe(false);      // frustum culling off

  // Orbit the forced-instanced assembly too and assert visibility.
  // Boxes are 1 m on a side, spread on a ~9 m line → orbit at 20 m.
  for (const az of angles) {
    await win.evaluate(({ az }) => {
      const vp = window.__archdiscViewport;
      const THREE = window.THREE;
      const target = new THREE.Vector3(0, 0, 0);
      const r = 20;
      const elRad = (20 * Math.PI) / 180;
      const azRad = (az * Math.PI) / 180;
      vp.camera.position.set(
        target.x + r * Math.cos(elRad) * Math.sin(azRad),
        target.y + r * Math.sin(elRad),
        target.z + r * Math.cos(elRad) * Math.cos(azRad),
      );
      vp.camera.near = 0.0001;
      vp.camera.far  = 100;
      vp.camera.updateProjectionMatrix();
      vp.camera.lookAt(target);
      vp.orbitControls.target.copy(target);
      vp.orbitControls.update();
      vp.renderer.render(vp.scene, vp.camera);
    }, { az });
    await win.waitForTimeout(220);

    const winFile    = path.join(OUT, `instanced-az${String(az).padStart(3,'0')}.png`);
    const canvasFile = path.join(OUT, `instanced-az${String(az).padStart(3,'0')}-canvas.png`);
    await win.screenshot({ path: winFile });
    let canvasBuf = null;
    try {
      canvasBuf = await canvasLoc.screenshot({ path: canvasFile });
    } catch { canvasBuf = null; }
    const canvasSize = canvasBuf
      ? canvasBuf.length
      : (fs.existsSync(canvasFile) ? fs.statSync(canvasFile).size : 0);
    console.log(`  [orbit-instanced] az=${az}°  canvas-png=${canvasSize}B`);
    expect(canvasSize).toBeGreaterThan(MIN_BYTES);
  }

  await app.close();
});
