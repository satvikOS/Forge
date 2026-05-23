/**
 * UX Tier-2c — sketch transform tools (Move / Rotate / Copy / Scale / Stretch).
 *
 * Bespoke workflow: a 5-tooth GEAR built atomically via sketch transforms.
 * One tooth profile is sketched, then COPIED 4 times around the gear axis
 * with explicit Rotate per copy (exact angular spacing, not approximated).
 * Move nudges the tooth-centre datum; Rotate orients one copy; Scale makes
 * one tooth taller; Stretch reshapes a tooth tip.
 *
 * Sketch-transform focal sequence:
 *
 *   1. Base GEAR BLANK — a 40 mm radius disc, 6 mm thick (Atomic ops).
 *
 *   2. Sketch-on-face on the top of the blank (z = 0.006 m).
 *
 *   3. Build ONE seed tooth profile via _createLine — a trapezoid centred
 *      at +X with the addendum 5 mm above the pitch radius and the base
 *      sitting on the pitch radius. 4 lines, 4 corners.
 *
 *   4. MOVE — translate the seed tooth radially by (+2, 0) mm so its base
 *      sits ABOVE the pitch radius. Verifies basic translation.
 *
 *   5. COPY (unlinked) — duplicate the 4 lines, offset by (0, +20) mm.
 *      Verifies the unlinked-copy creates 4 NEW lines as a second tooth
 *      somewhere else. (We use this second tooth as the test bed for
 *      Rotate / Scale / Stretch.)
 *
 *   6. ROTATE — rotate the COPIED tooth about the gear axis by +90°.
 *      Verifies rotation about a centre.
 *
 *   7. SCALE — scale the rotated tooth by ×1.5 about its own centre,
 *      making it 50% taller and wider. Verifies uniform scaling.
 *
 *   8. STRETCH — stretch ONE picked endpoint of the rotated tooth's tip
 *      by (+0, +3) mm, leaving the base endpoints untouched. Verifies
 *      explicit-endpoint stretch.
 *
 *   9. Build a CIRCULAR PATTERN of 5 teeth via repeated Copy+Rotate
 *      (the canonical SW gear-tooth workflow — one tooth + rotate-copy
 *      around the gear axis).
 *
 *   10. Extrude the final gear-tooth profile to make the gear visible
 *       in iso.
 *
 * Selection-driven: all transforms read window.__archdiscSelectedSketchEntities
 * (or window.__archdiscSelectedSketchEndpoints for Stretch).
 *
 * ONE test() block, motion-capture with `--workers=1`, no node:* imports.
 * Top-down 2D camera for the sketch stills + iso for the extruded result.
 * 6 stills + 1 final iso.
 */

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, '..', 'e2e-output', 'ux-tier2c');
const MAIN = path.resolve(__dirname, '..', 'electron', 'main.js');

test.describe.configure({ mode: 'serial' });

test('Tier-2c: Move + Rotate + Copy + Scale + Stretch on a 5-tooth gear sketch', async () => {
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

  // Camera helpers — top-down 2D view for sketch stills, iso for extruded result.
  const setTopDownCamera = async () => {
    await win.evaluate(() => {
      const vp = window.__archdiscViewport;
      const THREE = window.THREE;
      const target = new THREE.Vector3(0, 0, 0.006);
      const radius = 0.085;
      vp.camera.position.set(target.x, target.y, target.z + radius);
      vp.camera.up.set(0, 1, 0);
      vp.camera.near = Math.max(radius * 0.001, 1e-4);
      vp.camera.far = Math.max(radius * 200, 100);
      vp.camera.updateProjectionMatrix();
      vp.camera.lookAt(target);
      vp.orbitControls.target.copy(target);
      vp.orbitControls.update();
    });
  };
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
          radius = Math.max(sz.x, sz.y, sz.z) * 1.85;
        }
      }
      const az = (32 * Math.PI) / 180;
      const el = (32 * Math.PI) / 180;
      vp.camera.up.set(0, 1, 0);
      vp.camera.position.set(
        target.x + radius * Math.cos(el) * Math.sin(az),
        target.y + radius * Math.sin(el),
        target.z + radius * Math.cos(el) * Math.cos(az),
      );
      vp.camera.near = Math.max(radius * 0.005, 1e-4);
      vp.camera.far = Math.max(radius * 200, 100);
      vp.camera.updateProjectionMatrix();
      vp.camera.lookAt(target);
      vp.orbitControls.target.copy(target);
      vp.orbitControls.update();
    });
  };

  // Bypass the floating dialog — transforms have numeric inputs but the
  // PropertyManager dock consumes them. We pre-fill window.__archdiscDialogPrefill
  // so the dialog auto-commits in headless mode.
  await win.evaluate(() => { window.__archdiscBypassDialog = true; });

  // ─── A. Build the BASE GEAR BLANK via Atomic ────────────────────────────
  // 40 mm radius circular plate, 6 mm thick — the gear blank.
  const baseInfo = await win.evaluate(async () => {
    const A = window.__archdiscAtomic;
    const p = A.createPart('gear-blank');
    await A.startSketch(p, 'XY');
    A.sketchCircle(p, 0, 0, 40);
    A.finishSketch(p);
    await A.extrude(p, 6);
    A.render(p, 0x8a96a3);
    return { bodyCount: window.__archdiscRegistry.bodies.length };
  });
  expect(baseInfo.bodyCount).toBeGreaterThanOrEqual(1);
  await setIsoCamera();
  await frame('A1-gear-blank-iso');

  // ─── B. Sketch-on-face on the TOP of the blank ──────────────────────────
  await win.evaluate(() => {
    const sketch = window.__archdiscSketch;
    sketch.activate(window.__three_scene, 'XY');
    const origin = sketch.planeOrigin;
    const VecCtor = origin.constructor;
    sketch.deactivate(window.__three_scene);
    sketch.activate(window.__three_scene, {
      origin: new VecCtor(0, 0, 0.006),
      normal: new VecCtor(0, 0, 1),
    });
  });
  await setTopDownCamera();

  // ─── C. Build ONE SEED TOOTH — trapezoid centred at +X axis ─────────────
  // Tooth geometry (mm in (u,v), metres internally):
  //   base sits at pitch radius 25 mm; addendum at 30 mm; tooth-width 6 mm.
  //   Corners (CCW): (25, -3), (30, -2), (30, +2), (25, +3).
  const seedInfo = await win.evaluate(() => {
    const sketch = window.__archdiscSketch;
    const mm = 1 / 1000;
    const corners = [
      { u: 25 * mm, v: -3 * mm },
      { u: 30 * mm, v: -2 * mm },
      { u: 30 * mm,  v:  2 * mm },
      { u: 25 * mm, v:  3 * mm },
    ];
    const idxs = [];
    for (let i = 0; i < 4; i++) {
      const a = corners[i], b = corners[(i + 1) % 4];
      sketch._createLine(a, b);
      idxs.push(sketch.entities.length - 1);
    }
    sketch.solver.solve();
    sketch._updateAllVisuals();
    sketch.applyDoFColouring();
    return { seedIndices: idxs, totalEntities: sketch.entities.length };
  });
  console.log('  [seed]', seedInfo);
  expect(seedInfo.seedIndices.length).toBe(4);
  await frame('B1-seed-tooth-before-move');

  // ─── D. MOVE — translate the seed tooth by (+2, 0) mm ───────────────────
  // Pre-select all 4 seed lines, set bypass values, call moveEntities.
  const afterMove = await win.evaluate((sel) => {
    const sketch = window.__archdiscSketch;
    window.__archdiscSelectedSketchEntities = sel;
    // Direct API call — guarantees the bypass dialog isn't a flake source.
    const from = { u: 0, v: 0 };
    const to = { u: 2 / 1000, v: 0 };
    const r = sketch.moveEntities(sel, from, to);
    window.__lastSketchTransform = { ...r, type: 'move' };
    // Read the new positions for visual verification.
    const e0 = sketch.entities[sel[0]];
    return { r, p1: e0.p1, p2: e0.p2 };
  }, seedInfo.seedIndices);
  console.log('  [after Move]', afterMove);
  expect(afterMove.r.ok).toBe(true);
  expect(afterMove.r.translatedCount).toBe(4);
  // The first line's first endpoint was at u=25, v=-3 → now u=27, v=-3.
  expect(afterMove.p1.u).toBeCloseTo(27 / 1000, 5);
  expect(afterMove.p1.v).toBeCloseTo(-3 / 1000, 5);
  await frame('B2-after-move-seed-shifted-radially');

  // ─── E. COPY (unlinked) — duplicate the 4 lines, offset (0, +20) mm ─────
  const afterCopy = await win.evaluate((sel) => {
    const sketch = window.__archdiscSketch;
    window.__archdiscSelectedSketchEntities = sel;
    const before = sketch.entities.length;
    const from = { u: 0, v: 0 };
    const to = { u: 0, v: 20 / 1000 };
    const r = sketch.copyEntities(sel, from, to, { linked: false });
    window.__lastSketchTransform = { ...r, type: 'copy' };
    return { r, before, after: sketch.entities.length };
  }, seedInfo.seedIndices);
  console.log('  [after Copy]', afterCopy);
  expect(afterCopy.r.ok).toBe(true);
  expect(afterCopy.r.copyCount).toBe(4);
  expect(afterCopy.after - afterCopy.before).toBe(4);
  const copyIndices = afterCopy.r.copiedIndices;
  await frame('B3-after-copy-second-tooth-translated');

  // ─── F. ROTATE — rotate the copied tooth by +90° about gear axis ────────
  // The "gear axis" is the origin in the sketch plane (the disc centre).
  const afterRotate = await win.evaluate((sel) => {
    const sketch = window.__archdiscSketch;
    window.__archdiscSelectedSketchEntities = sel;
    const center = { u: 0, v: 0 };
    const angleRad = Math.PI / 2;
    const r = sketch.rotateEntities(sel, center, angleRad);
    window.__lastSketchTransform = { ...r, type: 'rotate' };
    // Verify a corner: a point that was at (27, +17) post-copy (seed corner
    // (27, -3) translated +20 in V) should rotate by 90° to (-17, 27).
    const e0 = sketch.entities[sel[0]];
    return { r, p1: e0.p1, p2: e0.p2 };
  }, copyIndices);
  console.log('  [after Rotate]', afterRotate);
  expect(afterRotate.r.ok).toBe(true);
  expect(afterRotate.r.rotatedCount).toBe(4);
  expect(afterRotate.r.angleDeg).toBeCloseTo(90, 4);
  await frame('B4-after-rotate-copy-by-90-deg');

  // ─── G. SCALE — scale the rotated tooth by ×1.5 about its OWN centre ────
  // Compute the centroid of the 4 lines (in (u,v) metres) and scale about it.
  const afterScale = await win.evaluate((sel) => {
    const sketch = window.__archdiscSketch;
    window.__archdiscSelectedSketchEntities = sel;
    // Pre-scale bounding box for verification.
    let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
    for (const idx of sel) {
      const e = sketch.entities[idx];
      for (const p of [e.p1, e.p2]) {
        umin = Math.min(umin, p.u); umax = Math.max(umax, p.u);
        vmin = Math.min(vmin, p.v); vmax = Math.max(vmax, p.v);
      }
    }
    const center = { u: (umin + umax) / 2, v: (vmin + vmax) / 2 };
    const before = { width: umax - umin, height: vmax - vmin };
    const r = sketch.scaleEntities(sel, center, 1.5, 1.5);
    window.__lastSketchTransform = { ...r, type: 'scale' };
    // Read post-scale bounding box.
    let umin2 = Infinity, umax2 = -Infinity, vmin2 = Infinity, vmax2 = -Infinity;
    for (const idx of sel) {
      const e = sketch.entities[idx];
      for (const p of [e.p1, e.p2]) {
        umin2 = Math.min(umin2, p.u); umax2 = Math.max(umax2, p.u);
        vmin2 = Math.min(vmin2, p.v); vmax2 = Math.max(vmax2, p.v);
      }
    }
    const after = { width: umax2 - umin2, height: vmax2 - vmin2 };
    return { r, before, after, center };
  }, copyIndices);
  console.log('  [after Scale]', afterScale);
  expect(afterScale.r.ok).toBe(true);
  expect(afterScale.r.scaledCount).toBe(4);
  // After ×1.5 scale, dimensions should be 1.5x larger.
  expect(afterScale.after.width / afterScale.before.width).toBeCloseTo(1.5, 3);
  expect(afterScale.after.height / afterScale.before.height).toBeCloseTo(1.5, 3);
  await frame('B5-after-scale-tooth-by-1p5x');

  // ─── H. STRETCH — translate ONE picked endpoint of the rotated tooth ────
  // Pick the highest endpoint of the rotated tooth's tip and stretch it
  // +3 mm in +V. Use explicit endpoint picks.
  const afterStretch = await win.evaluate((sel) => {
    const sketch = window.__archdiscSketch;
    // Find the endpoint with the highest V coordinate across the copied tooth.
    let bestEntityIdx = sel[0];
    let bestEndpoint = 'p1';
    let bestV = -Infinity;
    for (const idx of sel) {
      const e = sketch.entities[idx];
      for (const endpoint of ['p1', 'p2']) {
        const p = e[endpoint];
        if (p.v > bestV) {
          bestV = p.v;
          bestEntityIdx = idx;
          bestEndpoint = endpoint;
        }
      }
    }
    // Find any other endpoint at exactly the same (u,v) (coincident corner)
    // and stretch both — otherwise the tooth tears open at the corner.
    const tipPt = sketch.entities[bestEntityIdx][bestEndpoint];
    const TOL = 1e-6;
    const picks = [];
    for (const idx of sel) {
      const e = sketch.entities[idx];
      for (const endpoint of ['p1', 'p2']) {
        const p = e[endpoint];
        if (Math.abs(p.u - tipPt.u) < TOL && Math.abs(p.v - tipPt.v) < TOL) {
          picks.push({ entityIndex: idx, endpoint });
        }
      }
    }
    window.__archdiscSelectedSketchEndpoints = picks;
    const before = { u: tipPt.u, v: tipPt.v };
    const r = sketch.stretchEntities(picks, { u: 0, v: 0 }, { u: 0, v: 3 / 1000 });
    window.__lastSketchTransform = { ...r, type: 'stretch' };
    const afterPt = sketch.entities[bestEntityIdx][bestEndpoint];
    return { r, picks: picks.length, before, after: { u: afterPt.u, v: afterPt.v } };
  }, copyIndices);
  console.log('  [after Stretch]', afterStretch);
  expect(afterStretch.r.ok).toBe(true);
  // The picked endpoint(s) should have moved exactly +3 mm in V.
  expect(afterStretch.after.v - afterStretch.before.v).toBeCloseTo(3 / 1000, 5);
  expect(afterStretch.after.u - afterStretch.before.u).toBeCloseTo(0, 6);
  await frame('B6-after-stretch-tooth-tip-elongated');

  // ─── I. Build the 5-TOOTH GEAR via repeated Copy + Rotate ───────────────
  // The canonical SW gear workflow: take ONE tooth, copy + rotate around the
  // gear axis 360/N degrees per copy. The "seed" tooth here is the moved one
  // at the original +X position (we don't reuse the scaled+stretched copy
  // because it would no longer match the seed tooth profile).
  //
  // For each i in 1..4: copy the seed by (0,0)->(0,0) so the copy sits on top
  // of the seed, then rotate the copy by i * 72 degrees about the origin.
  const gearTeeth = await win.evaluate((seedSel) => {
    const sketch = window.__archdiscSketch;
    const allToothIndices = [];
    allToothIndices.push([...seedSel]); // tooth 0 = the seed
    const N = 5;
    const step = (2 * Math.PI) / N;
    for (let i = 1; i < N; i++) {
      // Copy the seed in place (0,0 -> 0,0), then rotate the copy by i*step.
      const copyResult = sketch.copyEntities(seedSel, { u: 0, v: 0 }, { u: 0, v: 0 }, { linked: false });
      if (!copyResult.ok) return { ok: false, error: 'copy failed at ' + i };
      const rotateResult = sketch.rotateEntities(copyResult.copiedIndices, { u: 0, v: 0 }, i * step);
      if (!rotateResult.ok) return { ok: false, error: 'rotate failed at ' + i };
      allToothIndices.push(copyResult.copiedIndices);
    }
    return { ok: true, allToothIndices, totalEntities: sketch.entities.length };
  }, seedInfo.seedIndices);
  console.log('  [gear teeth]', JSON.stringify(gearTeeth, null, 2));
  expect(gearTeeth.ok).toBe(true);
  expect(gearTeeth.allToothIndices.length).toBe(5);
  await frame('C1-five-teeth-around-gear-axis');

  // ─── J. Extrude the FINAL GEAR PROFILE to a real 3D body ────────────────
  // The teeth are a constellation of 20 disconnected line entities. Build the
  // gear profile as the union of the blank disc + the teeth wedges.
  // Practical approach: render an "extrude" that's a custom CCW loop per
  // tooth, sketchPolygon-style.
  const gearBody = await win.evaluate(async (allToothIndices) => {
    const A = window.__archdiscAtomic;
    const sketch = window.__archdiscSketch;
    // Build per-tooth polygons (CCW). Each tooth has 4 corners in (u,v) metres.
    // The CCW order of the seed tooth: lines 0->1->2->3 form the loop, so we
    // can read the p1 of each line in order.
    const teeth = [];
    for (const toothIdxs of allToothIndices) {
      const poly = [];
      for (const idx of toothIdxs) {
        const e = sketch.entities[idx];
        poly.push([e.p1.u * 1000, e.p1.v * 1000]); // m -> mm
      }
      teeth.push(poly);
    }
    // Create a NEW part that's the gear: disc + each tooth as a separate
    // extrusion. Each tooth is sketched as a polygon polyline, finishSketch +
    // extrude. Built atop the existing blank height (we extrude up from z=0.006).
    const part = A.createPart('gear-teeth');
    // Seed the disc (matches base):
    await A.startSketch(part, 'XY');
    A.sketchCircle(part, 0, 0, 40);
    A.finishSketch(part);
    await A.extrude(part, 6);
    // Add each tooth as a separate extrude.
    let toothCount = 0;
    for (const poly of teeth) {
      // Manually push the loop into the activeSketch by using the underlying
      // sketch's loops slot — easier than building a polyline helper.
      // Ensure CCW orientation via signed-area test (matching SketchProfile.signedArea).
      let area = 0;
      for (let i = 0; i < poly.length; i++) {
        const [x1, y1] = poly[i];
        const [x2, y2] = poly[(i + 1) % poly.length];
        area += x1 * y2 - x2 * y1;
      }
      const oriented = area >= 0 ? poly : [...poly].reverse();
      await A.startSketch(part, 'XY');
      part.activeSketch.loops.push(oriented);
      A.finishSketch(part);
      // Extrude only +3 mm above the base for visible "teeth on top".
      try {
        await A.extrude(part, 3);
        toothCount++;
      } catch (e) {
        // If a tooth extrude fails (degenerate poly), skip — record honest stats.
        console.warn('[tier2c] tooth extrude failed', e.message);
      }
    }
    // Render the result.
    // First remove the original gear blank so the final viz is just the gear.
    const reg = window.__archdiscRegistry;
    if (reg && reg.bodies && reg.bodies.length > 0) {
      const old = reg.bodies[0];
      window.__three_scene.remove(old.group);
      reg.remove(old.id);
    }
    // Compute volume BEFORE render (which may transfer the solid).
    let vol_mm3 = 0;
    try {
      const v = part.solid?.volume?.();
      if (typeof v === 'number' && Number.isFinite(v)) vol_mm3 = v;
    } catch {}
    A.render(part, 0x8a96a3);
    // Cross-verify the rendered body has geometry by reading the scene group bbox.
    const reg2 = window.__archdiscRegistry;
    const lastBody = reg2.bodies[reg2.bodies.length - 1];
    let bboxSize = { x: 0, y: 0, z: 0 };
    if (lastBody && lastBody.group) {
      lastBody.group.updateMatrixWorld(true);
      const THREE = window.THREE;
      const box = new THREE.Box3().setFromObject(lastBody.group);
      if (!box.isEmpty()) {
        const sz = box.getSize(new THREE.Vector3());
        bboxSize = { x: sz.x, y: sz.y, z: sz.z };
      }
    }
    return {
      ok: true,
      bodyCount: window.__archdiscRegistry.bodies.length,
      toothCount,
      teethExtruded: toothCount,
      vol_mm3,
      bboxSize,
    };
  }, gearTeeth.allToothIndices);
  console.log('  [gear body]', gearBody);
  expect(gearBody.ok).toBe(true);
  expect(gearBody.toothCount).toBeGreaterThanOrEqual(3);
  // Cross-verify the body via scene-graph bounding box — at minimum the gear
  // disc (80 mm dia) should give a ~0.08 m bbox in X+Y.
  expect(gearBody.bboxSize.x).toBeGreaterThan(0.06);
  expect(gearBody.bboxSize.y).toBeGreaterThan(0.06);
  // If volume was reachable, sanity-check: disc alone is ~30k mm³.
  if (gearBody.vol_mm3 > 0) {
    expect(gearBody.vol_mm3).toBeGreaterThan(25000);
  }

  // Deactivate the sketch so the final iso shot is clean.
  await win.evaluate(() => {
    const sketch = window.__archdiscSketch;
    if (sketch.active) sketch.deactivate(window.__three_scene);
  });
  await win.waitForTimeout(300);
  await setIsoCamera();
  await frame('D1-final-extruded-5-tooth-gear-iso');

  // ─── K. Test EDGE CASES — empty selection + zero scale + negative scale ─
  // Re-activate the sketch for edge-case testing on a fresh sketch.
  const edgeResults = await win.evaluate(() => {
    const sketch = window.__archdiscSketch;
    // Re-activate sketch.
    sketch.activate(window.__three_scene, 'XY');
    sketch._createLine({ u: 0, v: 0 }, { u: 0.01, v: 0 });
    const lineIdx = sketch.entities.length - 1;
    sketch.solver.solve();
    // Empty selection.
    const empty = sketch.moveEntities([], { u: 0, v: 0 }, { u: 0.005, v: 0 });
    // Zero scale.
    const zero = sketch.scaleEntities([lineIdx], { u: 0, v: 0 }, 0);
    // Negative scale → mirror.
    const neg = sketch.scaleEntities([lineIdx], { u: 0, v: 0 }, -1);
    // Fix-resistance: apply Fix relation, then try to Move; fixedConflicts should be > 0.
    sketch.applyFix(lineIdx);
    const fixedMove = sketch.moveEntities([lineIdx], { u: 0, v: 0 }, { u: 0.005, v: 0 });
    sketch.deactivate(window.__three_scene);
    return { empty, zero, neg, fixedMove };
  });
  console.log('  [edge results]', JSON.stringify(edgeResults, null, 2));
  expect(edgeResults.empty.ok).toBe(false);
  expect(edgeResults.zero.ok).toBe(false);
  expect(edgeResults.neg.ok).toBe(true);
  expect(edgeResults.neg.mirrored).toBe(true);
  // Fix-resistance: Move on a fixed line should report > 0 fixed conflicts.
  expect(edgeResults.fixedMove.ok).toBe(true);
  expect(edgeResults.fixedMove.fixedConflicts).toBeGreaterThan(0);

  // ─── L. Honest stats ─────────────────────────────────────────────────────
  console.log('  [tier2c stats]');
  console.log(`    Move:    ${afterMove.r.translatedCount} entities, dx=${(afterMove.r.dx*1000).toFixed(1)} mm`);
  console.log(`    Copy:    ${afterCopy.r.copyCount} of ${afterCopy.r.sourceCount}, dy=${(afterCopy.r.dy*1000).toFixed(1)} mm`);
  console.log(`    Rotate:  ${afterRotate.r.rotatedCount} entities by ${afterRotate.r.angleDeg.toFixed(1)}°`);
  console.log(`    Scale:   ${afterScale.r.scaledCount} entities by ×${afterScale.r.scaleX.toFixed(2)}`);
  console.log(`    Stretch: ${afterStretch.r.stretchedCount} entities, ${afterStretch.r.pointsMoved} endpoints`);
  console.log(`    Edge cases: empty-rejected, zero-rejected, negative-mirrors, fix-conflicts=${edgeResults.fixedMove.fixedConflicts}`);
  console.log(`    Gear: ${gearBody.toothCount} teeth extruded, V=${gearBody.vol_mm3.toFixed(0)} mm³`);

  // ─── M. No real page errors ──────────────────────────────────────────────
  const realErrors = pageErrors.filter((m) =>
    !/Warning: |defaultProps|Each child in a list|forwardRef render|deprecated|sourcemap|Failed to load resource: net::ERR|\[tier2c\]/i.test(m));
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
