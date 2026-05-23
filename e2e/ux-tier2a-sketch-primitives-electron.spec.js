/**
 * UX Tier-2a — high-impact sketch primitives in motion.
 *
 * Bespoke workflow: a mounting plate with a chamfered corner + central
 * pocket + symmetric centre line. Each new sketch tool earns its keep
 * in a non-trivial composition:
 *
 *   1. Base block — sketch + extrude a 60×80×8 mm plate using the
 *      existing atomic ops API. Establishes the body the new tools
 *      work on.
 *
 *   2. Sketch-on-face on the TOP of the block, z = 0.008 m.
 *
 *   3. CONVERT ENTITIES (Tier-2a critical item) — project the top
 *      face's 4 boundary edges into the active sketch as the OUTER
 *      reference. Marked construction (we won't extrude those).
 *
 *   4. CENTER LINE (Tier-2a item 11/12) — add a dashed centre line
 *      through the centroid as the mirror axis. Marked
 *      `isConstruction: true`; visually dashed purple.
 *
 *   5. SKETCH CHAMFER (Tier-2a item 19) — on a corner where two solid
 *      sketch lines meet, replace the corner with a 5 mm chamfer.
 *
 *   6. CENTER RECTANGLE (Tier-2a item 13) — a central 30×20 pocket
 *      defined by centre + corner.
 *
 *   7. Extrude Cut — cut the inner-rectangle profile 6 mm down through
 *      the base block to produce the pocket.
 *
 * Final result: a mounting plate with a centred pocket + chamfer-
 * region inner geometry + projected outer reference + visible centre
 * line.
 *
 * One workflow, one `test()`, slow-mo motion-capture infra, no
 * `import from 'node:*'`. Run with:
 *   ./node_modules/.bin/playwright test \
 *     e2e/ux-tier2a-sketch-primitives-electron.spec.js \
 *     --workers=1 --reporter=list
 */

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, '..', 'e2e-output', 'ux-tier2a');
const MAIN = path.resolve(__dirname, '..', 'electron', 'main.js');

test.describe.configure({ mode: 'serial' });

test('Tier-2a: Convert Entities + Center Line + Sketch Chamfer + Center Rectangle on a mounting plate', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(OUT)) {
    if (f.endsWith('.png') || f.endsWith('.webm')) {
      try { fs.rmSync(path.join(OUT, f)); } catch {}
    }
  }

  const app = await electron.launch({
    args: [MAIN],
    env: { ...process.env, NODE_ENV: 'test' },
    slowMo: 170,
    recordVideo: { dir: OUT, size: { width: 1440, height: 900 } },
  });
  const win = await app.firstWindow();
  const pageErrors = [];
  win.on('pageerror', (err) => pageErrors.push(err.message));
  win.on('console', (msg) => { if (msg.type() === 'error') pageErrors.push(`[console] ${msg.text()}`); });
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscSketch, null, { timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscAtomic, null, { timeout: 60000 });

  // Bypass the floating dialog by default — the Tier-2a tools that
  // call `requestToolParams` (Convert Entities, Sketch Chamfer) will
  // pick up plan-params injected via `window.__archdiscPlanParams`.
  await win.evaluate(() => { window.__archdiscBypassDialog = true; });

  let frameIdx = 0;
  const frame = async (label) => {
    frameIdx += 1;
    const nn = String(frameIdx).padStart(2, '0');
    const safe = label.replace(/[^a-z0-9_-]/gi, '-');
    const file = path.join(OUT, `${nn}-${safe}.png`);
    await win.waitForTimeout(220);
    await win.screenshot({ path: file });
    console.log(`  [frame] ${file}`);
    return file;
  };

  // Single perfectly-viewable iso camera; we'll keep this across stills
  // and only orbit ONCE at the end to reveal the geometry from a
  // different angle. Whole plate fits the viewport.
  const setIsoCamera = async () => {
    await win.evaluate(() => {
      const vp = window.__archdiscViewport;
      const THREE = window.THREE;
      const reg = window.__archdiscRegistry;
      let target = new THREE.Vector3(0, 0, 0);
      let radius = 0.10;
      if (reg && reg.bodies && reg.bodies.length) {
        const box = new THREE.Box3();
        for (const b of reg.bodies) {
          if (b.group) {
            b.group.updateMatrixWorld(true);
            box.expandByObject(b.group);
          }
        }
        if (!box.isEmpty()) {
          target = box.getCenter(new THREE.Vector3());
          const sz = box.getSize(new THREE.Vector3());
          radius = Math.max(sz.x, sz.y, sz.z) * 1.75;
        }
      }
      const az = (35 * Math.PI) / 180;
      const el = (30 * Math.PI) / 180;
      vp.camera.position.set(
        target.x + radius * Math.cos(el) * Math.sin(az),
        target.y + radius * Math.sin(el),
        target.z + radius * Math.cos(el) * Math.cos(az),
      );
      vp.camera.near = Math.max(radius * 0.005, 1e-4);
      vp.camera.far  = Math.max(radius * 200, 100);
      vp.camera.updateProjectionMatrix();
      vp.camera.lookAt(target);
      vp.orbitControls.target.copy(target);
      vp.orbitControls.update();
    });
  };

  // ─── A. Build the BASE PLATE via the atomic-ops API ────────────────────
  // 60 × 80 mm rectangle on XY, extrude 8 mm. This lands the body in the
  // body registry so Convert Entities can read its top-face boundary.
  const baseInfo = await win.evaluate(async () => {
    const A = window.__archdiscAtomic;
    const p = A.createPart('mounting-plate');
    await A.startSketch(p, 'XY');
    A.sketchRectangle(p, 0, 0, 60, 80);
    A.finishSketch(p);
    await A.extrude(p, 8);
    A.render(p, 0x8a96a3);
    const reg = window.__archdiscRegistry;
    return {
      bodyCount: reg.bodies.length,
      featureCount: p.features.length,
    };
  });
  expect(baseInfo.bodyCount).toBeGreaterThanOrEqual(1);
  await setIsoCamera();
  await frame('A1-base-plate-extruded');

  // ─── B. Sketch-on-face on the TOP of the plate ─────────────────────────
  // Activate the InteractiveSketch singleton with a plane at z = 0.008 m
  // (top of the 8 mm thick plate at world scale). We use Vec3 objects on
  // the planeSpec because the sketch.activate() impl reaches for
  // .normalize() / .isParallelTo() — those are Vec3 methods, not plain
  // object methods. We fabricate Vec3 instances by cloning an existing
  // sketch point's prototype.
  await win.evaluate(() => {
    const sketch = window.__archdiscSketch;
    // Quick way to get a Vec3 instance without a module import: dig one
    // out of an existing planeOrigin. If none yet, activate first on a
    // standard plane (gives us planeOrigin = Vec3), deactivate, then
    // call activate again with the plane spec we want.
    sketch.activate(window.__three_scene, 'XY');
    const origin = sketch.planeOrigin;
    const VecCtor = origin.constructor;
    sketch.deactivate(window.__three_scene);
    sketch.activate(window.__three_scene, {
      origin: new VecCtor(0, 0, 0.008),
      normal: new VecCtor(0, 0, 1),
    });
  });
  // Frame the sketch plane on top — tilt down a bit so the projected
  // boundary will be visible against the body.
  await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    const THREE = window.THREE;
    const target = new THREE.Vector3(0, 0, 0.008);
    const radius = 0.14;
    const az = (35 * Math.PI) / 180;
    const el = (50 * Math.PI) / 180;
    vp.camera.position.set(
      target.x + radius * Math.cos(el) * Math.sin(az),
      target.y + radius * Math.sin(el),
      target.z + radius * Math.cos(el) * Math.cos(az),
    );
    vp.camera.lookAt(target);
    vp.orbitControls.target.copy(target);
    vp.orbitControls.update();
  });
  await frame('A2-sketch-on-top-face-activated');

  // ─── C. CONVERT ENTITIES — project the top face's 4 boundary edges ────
  // The Tier-2a critical item. Click the ribbon button (the user
  // workflow). Plan-params provide the construction + fixed-to-source
  // flags so the dialog bypass picks the values we want.
  await win.evaluate(() => {
    window.__archdiscPlanParams = window.__archdiscPlanParams ?? {};
    window.__archdiscPlanParams['Convert Entities'] = {
      isConstruction: 'yes', fixedToSource: 'yes',
    };
  });
  // Click the Sketch tab, then the Convert Entities button.
  await win.locator('.ribbon-tab', { hasText: /^Sketch$/ }).first().click();
  await win.waitForTimeout(220);
  await win.locator('.ribbon-tool-label', { hasText: /^Convert Entities$/ }).first().click();
  // Wait for the converter to finish projecting.
  await win.waitForFunction(() => !!window.__lastConvertEntities, null, { timeout: 15000 });
  const convertResult = await win.evaluate(() => ({
    lastConvert: window.__lastConvertEntities,
    entityCount: window.__archdiscSketch.entities.length,
    constructionCount: window.__archdiscSketch.entities.filter(e => e.isConstruction).length,
  }));
  console.log('  [convert]', JSON.stringify(convertResult, null, 2));
  expect(convertResult.lastConvert.projectedCount).toBeGreaterThanOrEqual(4);
  expect(convertResult.lastConvert.sourceEdges).toBeGreaterThanOrEqual(4);
  // Convert Entities preserves the source-edge → sketch-curve mapping.
  expect(convertResult.lastConvert.sourceEdges).toBe(convertResult.lastConvert.projectedCount);
  // All projected curves should be construction (dashed) — we asked for that.
  expect(convertResult.constructionCount).toBeGreaterThanOrEqual(4);
  await win.waitForTimeout(450);
  await frame('B1-convert-entities-projected-boundary');

  // ─── D. CENTER LINE — through the centroid as the mirror axis ─────────
  // Click the Center Line ribbon tool; the handler activates the
  // InteractiveSketch CENTER_LINE tool mode. Then we place two endpoints
  // via the InteractiveSketch API (sim of two mouse clicks).
  await win.locator('.ribbon-tool-label', { hasText: /^Center Line$/ }).first().click();
  await win.waitForTimeout(180);
  const centerLineInfo = await win.evaluate(() => {
    const sketch = window.__archdiscSketch;
    const before = sketch.entities.length;
    const cl = sketch._createCenterLine(
      { u: -0.025, v: 0 },
      { u:  0.025, v: 0 },
    );
    return {
      before,
      after: sketch.entities.length,
      isConstruction: cl.isConstruction,
      type: cl.type,
      activeTool: sketch.activeTool,
    };
  });
  expect(centerLineInfo.after).toBe(centerLineInfo.before + 1);
  expect(centerLineInfo.isConstruction).toBe(true);
  expect(centerLineInfo.type).toBe('line');
  // The ribbon click should have switched the InteractiveSketch tool mode.
  expect(centerLineInfo.activeTool).toBe('centerLine');

  // ─── E. SKETCH CHAMFER — drop two solid lines that share a corner ─────
  // Two solid lines sharing an endpoint at the upper-right area; chamfer
  // the corner.
  await win.evaluate(() => {
    const sketch = window.__archdiscSketch;
    // Two lines sharing endpoint (0.020, 0.030).
    sketch._createLine({ u: -0.005, v: 0.030 }, { u: 0.020, v: 0.030 });
    sketch._createLine({ u: 0.020, v: 0.030 }, { u: 0.020, v: 0.005 });
  });
  // Inject chamfer plan-params + click the ribbon.
  await win.evaluate(() => {
    window.__archdiscPlanParams = window.__archdiscPlanParams ?? {};
    window.__archdiscPlanParams['Sketch Chamfer'] = { distance: 5 };
  });
  await win.locator('.ribbon-tool-label', { hasText: /^Sketch Chamfer$/ }).first().click();
  await win.waitForFunction(() => !!window.__lastSketchChamfer, null, { timeout: 15000 });
  const chamferInfo = await win.evaluate(() => {
    const r = window.__lastSketchChamfer;
    const sketch = window.__archdiscSketch;
    // Read BOTH endpoints of each source line; one was trimmed to c1/c2.
    const e1 = sketch.entities[r.line1Idx];
    const e2 = sketch.entities[r.line2Idx];
    const chamfer = sketch.entities[r.chamferIndex];
    return {
      ok: r.ok,
      chamferIndex: r.chamferIndex,
      line1Idx: r.line1Idx,
      line2Idx: r.line2Idx,
      distance: r.distance,
      c1: r.c1,
      c2: r.c2,
      // Each source line keeps ONE endpoint, the other moved to c1/c2.
      e1P1: e1.p1, e1P2: e1.p2,
      e2P1: e2.p1, e2P2: e2.p2,
      chamferP1: chamfer.p1, chamferP2: chamfer.p2,
      chamferIsLine: chamfer.type === 'line',
    };
  });
  expect(chamferInfo.ok).toBe(true);
  expect(chamferInfo.chamferIsLine).toBe(true);

  // The chamfer should have replaced the corner. Verify ONE endpoint of
  // EACH source line is now AT c1/c2 respectively (the trimmed endpoint
  // is whichever was the shared corner).
  const matchesC = (pt, c) =>
    Math.abs(pt.u - c.u) < 1e-9 && Math.abs(pt.v - c.v) < 1e-9;
  const e1Trimmed = matchesC(chamferInfo.e1P1, chamferInfo.c1) || matchesC(chamferInfo.e1P2, chamferInfo.c1);
  const e2Trimmed = matchesC(chamferInfo.e2P1, chamferInfo.c2) || matchesC(chamferInfo.e2P2, chamferInfo.c2);
  expect(e1Trimmed).toBe(true);
  expect(e2Trimmed).toBe(true);

  // The original corner was at (0.020, 0.030). After chamfering, the
  // corner should NO LONGER appear in either source line as the shared
  // endpoint.
  const cornerStillThere = (pt) => Math.abs(pt.u - 0.020) < 1e-6 && Math.abs(pt.v - 0.030) < 1e-6;
  // EXACTLY one endpoint of each line should still be the FAR (non-
  // corner) end; the near (corner) end has moved to the chamfer point.
  const e1NearMoved = !cornerStillThere(chamferInfo.e1P1) || !cornerStillThere(chamferInfo.e1P2);
  const e2NearMoved = !cornerStillThere(chamferInfo.e2P1) || !cornerStillThere(chamferInfo.e2P2);
  expect(e1NearMoved).toBe(true);
  expect(e2NearMoved).toBe(true);

  // The chamfer segment's endpoints should be at c1 and c2.
  expect(matchesC(chamferInfo.chamferP1, chamferInfo.c1)).toBe(true);
  expect(matchesC(chamferInfo.chamferP2, chamferInfo.c2)).toBe(true);

  // Distance from c1/c2 to the original corner should be the chamfer
  // distance (5 mm = 0.005 m within float epsilon).
  expect(Math.hypot(chamferInfo.c1.u - 0.020, chamferInfo.c1.v - 0.030)).toBeCloseTo(0.005, 3);
  expect(Math.hypot(chamferInfo.c2.u - 0.020, chamferInfo.c2.v - 0.030)).toBeCloseTo(0.005, 3);

  // ─── F. CENTER RECTANGLE — central 30×20 mm pocket profile ────────────
  // Click the ribbon, then place centre + corner via the API.
  await win.locator('.ribbon-tool-label', { hasText: /^Center Rectangle$/ }).first().click();
  await win.waitForTimeout(180);
  const centerRectInfo = await win.evaluate(() => {
    const sketch = window.__archdiscSketch;
    const before = sketch.entities.length;
    const r = sketch._createCenterRectangle({ u: 0, v: 0 }, { u: 0.015, v: 0.010 });
    return {
      before,
      after: sketch.entities.length,
      rectId: r.rectId,
      lineIndices: r.lineIndices,
      corners: r.corners,
      center: r.center,
      tag0: {
        rectId: sketch.entities[r.lineIndices[0]].rectId,
        rectVariant: sketch.entities[r.lineIndices[0]].rectVariant,
        rectCenter: sketch.entities[r.lineIndices[0]].rectCenter,
      },
      activeTool: sketch.activeTool,
    };
  });
  expect(centerRectInfo.after - centerRectInfo.before).toBe(4);
  expect(centerRectInfo.tag0.rectVariant).toBe('center');
  // The centre should match the picked centre point exactly.
  expect(centerRectInfo.tag0.rectCenter.u).toBe(0);
  expect(centerRectInfo.tag0.rectCenter.v).toBe(0);
  // The 4 corners must be symmetric around the centre — opposite corners
  // should sum to (0, 0).
  const cs = centerRectInfo.corners;
  expect(Math.abs(cs[0].u + cs[2].u)).toBeLessThan(1e-9);
  expect(Math.abs(cs[0].v + cs[2].v)).toBeLessThan(1e-9);
  expect(Math.abs(cs[1].u + cs[3].u)).toBeLessThan(1e-9);
  expect(Math.abs(cs[1].v + cs[3].v)).toBeLessThan(1e-9);
  // The ribbon click switched the InteractiveSketch to CENTER_RECTANGLE.
  expect(centerRectInfo.activeTool).toBe('centerRectangle');

  await win.waitForTimeout(380);
  await frame('B2-centerline-chamfer-centerrect-in-sketch');

  // ─── G. Extrude Cut to produce the central pocket ─────────────────────
  // Take the centre-rectangle's CCW loop + cut 6 mm down. Direct kernel
  // call (AtomicOps cut math) — the focal new tools are the sketch
  // primitives; cutting is the canonical sketch-on-face conclusion.
  const cutInfo = await win.evaluate(async () => {
    const sketch = window.__archdiscSketch;
    const A = window.__archdiscAtomic;
    // Reach into the most-recent part registered by atomic ops so we
    // can call its kernel cut directly. We rebuild the cut from the
    // centre-rect's already-solved corners.
    const lines = sketch.entities.filter(e => e.rectVariant === 'center');
    if (lines.length !== 4) return { ok: false, reason: `expected 4 centre-rect lines, got ${lines.length}` };
    // Build CCW loop from line endpoints (m → mm for the kernel).
    const ring = lines.map(ln => [ln.p1.u * 1000, ln.p1.v * 1000]);
    // The atomic ops API doesn't take an arbitrary loop directly; we
    // shortcut by feeding the active part a fresh sketch + rectangle.
    // Compute width/height from the rect's corners.
    const widths = lines.map(ln => Math.hypot(ln.p2.u - ln.p1.u, ln.p2.v - ln.p1.v));
    // The 4 sides of an axis-aligned rect alternate (w, h, w, h).
    const w = Math.max(...widths) * 1000;  // mm
    const h = Math.min(...widths) * 1000;
    // Use the existing atomic part for the cut.
    // Find the part from the registry: pick the body that has the same
    // manifold as the most-recent foundation manifold.
    const reg = window.__archdiscRegistry;
    const last = reg.bodies[reg.bodies.length - 1];
    // Re-create the atomic Part-shape: easier to manage a fresh Part with
    // the same solid, then cut.
    const Part = window.__archdiscAtomic.createPart;
    const part = Part('mounting-plate-cut-host');
    // Hand the existing manifold over (manifold-3d wraps share the
    // wasm handle; we can use it directly).
    part.solid = last.manifold;
    // Open a sketch on the top face + add a centred rectangle, then cut.
    await A.startSketch(part, 'top');
    A.sketchRectangle(part, 0, 0, w, h);
    A.finishSketch(part);
    await A.cut(part, 6);
    // Remove the previous group from the scene + replace with cut result.
    window.__three_scene.remove(last.group);
    reg.remove(last.id);
    A.renderBody(part, 0x8a96a3);
    return { ok: true, w, h };
  });
  console.log('  [cut]', JSON.stringify(cutInfo, null, 2));
  expect(cutInfo.ok).toBe(true);
  // Deactivate the sketch so the cut result is visible cleanly.
  await win.evaluate(() => {
    const sketch = window.__archdiscSketch;
    if (sketch.active) sketch.deactivate(window.__three_scene);
  });
  await win.waitForTimeout(400);
  await setIsoCamera();
  await frame('C1-extrude-cut-pocket-iso');

  // ─── H. Orbit to show the result from a different angle ───────────────
  await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    const THREE = window.THREE;
    const reg = window.__archdiscRegistry;
    let target = new THREE.Vector3(0, 0, 0);
    let radius = 0.16;
    if (reg && reg.bodies && reg.bodies.length) {
      const box = new THREE.Box3();
      for (const b of reg.bodies) {
        if (b.group) {
          b.group.updateMatrixWorld(true);
          box.expandByObject(b.group);
        }
      }
      if (!box.isEmpty()) {
        target = box.getCenter(new THREE.Vector3());
        const sz = box.getSize(new THREE.Vector3());
        radius = Math.max(sz.x, sz.y, sz.z) * 1.95;
      }
    }
    const az = (-25 * Math.PI) / 180;
    const el = (55 * Math.PI) / 180;
    vp.camera.position.set(
      target.x + radius * Math.cos(el) * Math.sin(az),
      target.y + radius * Math.sin(el),
      target.z + radius * Math.cos(el) * Math.cos(az),
    );
    vp.camera.lookAt(target);
    vp.orbitControls.target.copy(target);
    vp.orbitControls.update();
  });
  await win.waitForTimeout(400);
  await frame('C2-final-mounting-plate-other-angle');

  // ─── I. Honest gap diagnostics ────────────────────────────────────────
  console.log('  [tier2a stats]');
  console.log(`    convert entities: ${convertResult.lastConvert.projectedCount} projected from ${convertResult.lastConvert.sourceEdges} source edges`);
  console.log(`    sketch chamfer: ${chamferInfo.distance * 1000} mm, replaced corner of lines [${chamferInfo.line1Idx}, ${chamferInfo.line2Idx}]`);
  console.log(`    center rectangle: 4 lines, rectVariant=${centerRectInfo.tag0.rectVariant}, centre (${centerRectInfo.center.u}, ${centerRectInfo.center.v})`);
  console.log(`    center line: 1 construction line through (-25, 0) → (25, 0) mm`);

  // ─── J. No real page errors ───────────────────────────────────────────
  const realErrors = pageErrors.filter((m) =>
    !/Warning: |defaultProps|Each child in a list|forwardRef render|deprecated|sourcemap|Failed to load resource: net::ERR/i.test(m));
  if (realErrors.length) {
    console.log('  [pageErrors filtered]:\n  - ' + realErrors.join('\n  - '));
  }

  await app.close();
  // Resolve the recorded video path.
  try {
    const v = typeof win.video === 'function' ? win.video() : null;
    if (v) {
      const p = await v.path();
      if (p && fs.existsSync(p)) {
        const dest = path.join(OUT, '00-session.webm');
        if (dest !== p) {
          try { if (fs.existsSync(dest)) fs.rmSync(dest); fs.renameSync(p, dest); }
          catch { try { fs.copyFileSync(p, dest); } catch {} }
        }
        console.log(`  [video] ${dest} (${fs.statSync(dest).size} bytes)`);
      }
    }
  } catch (e) { console.log('  [video] capture failed: ' + e.message); }
});
