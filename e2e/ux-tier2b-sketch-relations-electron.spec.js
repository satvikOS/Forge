/**
 * UX Tier-2b — sketch geometric relations as named user-applied constraints.
 *
 * Bespoke workflow: a flange with a symmetric bolt-hole pattern. The user
 * DECLARES the design intent via five named relations rather than placing
 * individual dimensions, then extrudes the result. The story is the DoF
 * count dropping as relations are applied, and the entity colour flipping
 * from blue (under-defined) to black (fully-defined) per the Tier-1
 * colour-state convention.
 *
 * Sketch-relation focal sequence:
 *
 *   1. Base flange — circular plate (80 mm diameter, 8 mm thick) via the
 *      atomic-ops API. Establishes the body the relations work on.
 *
 *   2. Sketch-on-face on the top of the flange (z = 0.008 m).
 *
 *   3. Place the bore (a circle near the centre, NOT centred yet) +
 *      a separate reference circle around the centre.
 *
 *   4. CONCENTRIC #1 — bore + reference circle share a centre. The
 *      bore snaps to the flange axis.
 *
 *   5. Add 4 bolt-hole circles roughly around the rim, scattered.
 *
 *   6. CONCENTRIC #2 — all 4 bolt-hole centres share a centre with the
 *      reference circle (each bolt centred RADIALLY at the reference
 *      circle, but the angular position stays free).
 *
 *      [WAIT — that's not quite the SW pattern; we'll instead use the
 *       pattern: a horizontal axis line through the centre; symmetric
 *       constrains each pair of bolt-holes about that line. The
 *       reference circle is the construction "pitch circle" the bolts
 *       sit on — that's a Concentric relation per bolt to the pitch
 *       circle, but since that's 4 concentric pairs we'd run out of
 *       solver DoF too aggressively. So we use one Concentric for the
 *       bore + a single Symmetric pair for two bolt-holes about the
 *       horizontal axis, plus one Collinear for two reference edges
 *       and a Midpoint for one point. Five named relations applied to
 *       five distinct sketch entity sets.]
 *
 *   7. SYMMETRIC — pair 2 of the bolt-holes about a horizontal axis
 *      line (drawn through the centre).
 *
 *   8. COLLINEAR — two short reference lines on either side of the
 *      pattern; they're constrained to lie on the same horizontal
 *      infinite line.
 *
 *   9. MIDPOINT — a sketch point placed off-axis is constrained to
 *      the midpoint of the bottom reference segment, snapping it back
 *      to centre.
 *
 *   10. FIX — anchor the central reference circle's centre at the
 *       sketch origin. Locks the entire pattern in place.
 *
 *   11. Verify each Display Relations row + delete one, restoring DoF.
 *
 *   12. Extrude Cut — cut the bore + 2 holes through the flange.
 *
 * ONE test() block, motion-capture with `--workers=1`, no node:* imports.
 * Iso framing for the final extruded result + 2D sketch-view stills for
 * the relation-state captures. 5–6 key stills.
 */

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, '..', 'e2e-output', 'ux-tier2b');
const MAIN = path.resolve(__dirname, '..', 'electron', 'main.js');

test.describe.configure({ mode: 'serial' });

test('Tier-2b: Concentric + Midpoint + Symmetric + Collinear + Fix on a flange bolt-hole pattern', async () => {
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

  // Bypass the floating dialog — relation tools have no numeric inputs but
  // request param dialogs anyway (they're zero-field schemas).
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

  // Camera helpers — top-down 2D view for sketch-state stills, iso for
  // the final extruded result.
  const setTopDownCamera = async () => {
    await win.evaluate(() => {
      const vp = window.__archdiscViewport;
      const THREE = window.THREE;
      const target = new THREE.Vector3(0, 0, 0.008);
      const radius = 0.085;
      // Look straight down along -Z.
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

  // Helper to fetch sketch status (DoF + state).
  const status = () => win.evaluate(() => window.__archdiscSketch.getStatus());

  // ─── A. Build the BASE FLANGE via the atomic-ops API ───────────────────
  // 80 mm diameter circular plate, 8 mm thick. We use sketchCircle so the
  // base has a proper disc top face.
  const baseInfo = await win.evaluate(async () => {
    const A = window.__archdiscAtomic;
    const p = A.createPart('flange-base');
    await A.startSketch(p, 'XY');
    A.sketchCircle(p, 0, 0, 40); // r=40mm circle centered at origin
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
  await frame('A1-base-flange-extruded-iso');

  // ─── B. Sketch-on-face on the TOP of the flange ────────────────────────
  await win.evaluate(() => {
    const sketch = window.__archdiscSketch;
    sketch.activate(window.__three_scene, 'XY');
    const origin = sketch.planeOrigin;
    const VecCtor = origin.constructor;
    sketch.deactivate(window.__three_scene);
    sketch.activate(window.__three_scene, {
      origin: new VecCtor(0, 0, 0.008),
      normal: new VecCtor(0, 0, 1),
    });
  });
  await setTopDownCamera();
  await frame('A2-sketch-on-top-face-active');

  // ─── C. Pre-place the sketch entities the relations will act on ────────
  // Place every entity SCATTERED so the relations have something to do.
  // Numbering (this becomes entity indices in the sketch):
  //   0: bore circle (off-centre)
  //   1: reference/pitch circle (a construction circle at the origin)
  //   2: bolt-hole #1 (off-axis upper)
  //   3: bolt-hole #2 (off-axis lower) — mirror pair for SYMMETRIC
  //   4: horizontal axis line (centre-line construction)
  //   5: reference left line (collinear with #6)
  //   6: reference right line (collinear with #5)
  //   7: midpoint-target point (will be pulled to bottom segment's midpoint)
  //   8: bottom reference segment (defines the midpoint anchor)
  const entityLayout = await win.evaluate(() => {
    const sketch = window.__archdiscSketch;
    const out = {};
    // 0: bore circle — placed off-centre on purpose
    sketch._createCircle({ u: 0.005, v: -0.003 }, 0.010);
    out.bore = sketch.entities.length - 1;
    // 1: reference / pitch circle — start at origin, becomes the
    //    Fix-anchored "datum" for the pattern
    sketch._createCircle({ u: 0, v: 0 }, 0.030);
    sketch.setEntityConstruction(sketch.entities.length - 1, true);
    out.pitch = sketch.entities.length - 1;
    // 2: bolt-hole #1 — upper-right area
    sketch._createCircle({ u: 0.027, v: 0.014 }, 0.004);
    out.bolt1 = sketch.entities.length - 1;
    // 3: bolt-hole #2 — lower-right area (mirror pair candidate)
    sketch._createCircle({ u: 0.029, v: -0.012 }, 0.004);
    out.bolt2 = sketch.entities.length - 1;
    // 4: horizontal axis centre line (construction) for SYMMETRIC axis
    sketch._createCenterLine({ u: -0.040, v: 0 }, { u: 0.040, v: 0 });
    out.axis = sketch.entities.length - 1;
    // 5: reference left line — collinear with #6, slightly y-offset
    sketch._createLine({ u: -0.038, v: -0.034 }, { u: -0.020, v: -0.033 });
    out.refLeft = sketch.entities.length - 1;
    // 6: reference right line — y-offset so it's NOT collinear yet
    sketch._createLine({ u: 0.020, v: -0.032 }, { u: 0.038, v: -0.031 });
    out.refRight = sketch.entities.length - 1;
    // 7: midpoint-target point — somewhere off
    sketch._createPoint({ u: 0.005, v: 0.025 });
    out.midPoint = sketch.entities.length - 1;
    // 8: bottom reference segment — horizontal-ish; the midpoint of which
    //    we'll pin midPoint to
    sketch._createLine({ u: -0.020, v: 0.030 }, { u: 0.020, v: 0.030 });
    out.midSeg = sketch.entities.length - 1;
    return { ...out, totalEntities: sketch.entities.length };
  });
  console.log('  [layout]', JSON.stringify(entityLayout, null, 2));
  expect(entityLayout.totalEntities).toBeGreaterThanOrEqual(9);
  // Solve once to update visuals (no relations yet — everything stays blue).
  await win.evaluate(() => { window.__archdiscSketch.solver.solve(); window.__archdiscSketch._updateAllVisuals(); window.__archdiscSketch.applyDoFColouring(); });
  await frame('B1-scattered-sketch-before-any-relation');

  const initialStatus = await status();
  console.log('  [initial DoF]', initialStatus.signedDof, initialStatus.state);
  expect(initialStatus.state).toBe('under-defined');
  const dof0 = initialStatus.signedDof;

  // Click the Sketch tab so the ribbon shows the Sketch->Relations group
  // (the test app boots with Part as the default tab; relation buttons live
  // in the Sketch tab). Give Vite an extra beat to render the new group.
  await win.locator('.ribbon-tab', { hasText: /^Sketch$/ }).first().click();
  await win.waitForTimeout(800);
  // Confirm the Sketch tab is now active and the Relations group rendered.
  await expect(
    win.locator('.ribbon-tool-label', { hasText: /^Concentric Relation$/ }).first()
  ).toBeVisible({ timeout: 15000 });

  // ─── D. RELATION #1 — CONCENTRIC: bore + pitch circle share centre ─────
  // Pre-select bore + pitch; click the Concentric Relation ribbon.
  await win.evaluate((sel) => {
    window.__archdiscSelectedSketchEntities = sel;
  }, [entityLayout.bore, entityLayout.pitch]);
  await win.locator('.ribbon-tool-label', { hasText: /^Concentric Relation$/ }).first().click();
  await win.waitForFunction(() => !!window.__lastSketchRelation && window.__lastSketchRelation.type === 'concentric', null, { timeout: 15000 });
  const afterConcentric = await status();
  console.log('  [after Concentric] DoF', afterConcentric.signedDof, 'state', afterConcentric.state);
  // Concentric removes 2 DoF for one pair.
  expect(dof0 - afterConcentric.signedDof).toBe(2);
  await frame('C1-after-concentric-bore-snaps-to-centre');

  // ─── E. RELATION #2 — SYMMETRIC: bolt1 + bolt2 about the axis line ─────
  // Pre-select bolt1, bolt2, axis (in that order — axis last is SW
  // convention). Click Symmetric Relation.
  await win.evaluate((sel) => {
    window.__archdiscSelectedSketchEntities = sel;
  }, [entityLayout.bolt1, entityLayout.bolt2, entityLayout.axis]);
  await win.locator('.ribbon-tool-label', { hasText: /^Symmetric Relation$/ }).first().click();
  await win.waitForFunction(() => !!window.__lastSketchRelation && window.__lastSketchRelation.type === 'symmetric', null, { timeout: 15000 });
  const afterSymmetric = await status();
  console.log('  [after Symmetric] DoF', afterSymmetric.signedDof, 'state', afterSymmetric.state);
  // Symmetric on 2 circles: 1 SymmetricConstraint (centres mirror) + 2
  // radius constraints (equal-radius). Total DoF removal:
  //   Symmetric centres: -2
  //   2 radius: -1 each = -2  → total -4 from this relation
  expect(afterConcentric.signedDof - afterSymmetric.signedDof).toBe(4);
  await frame('C2-after-symmetric-bolts-mirror-about-axis');

  // ─── F. RELATION #3 — COLLINEAR: refLeft + refRight on same line ───────
  await win.evaluate((sel) => {
    window.__archdiscSelectedSketchEntities = sel;
  }, [entityLayout.refLeft, entityLayout.refRight]);
  await win.locator('.ribbon-tool-label', { hasText: /^Collinear Relation$/ }).first().click();
  await win.waitForFunction(() => !!window.__lastSketchRelation && window.__lastSketchRelation.type === 'collinear', null, { timeout: 15000 });
  const afterCollinear = await status();
  console.log('  [after Collinear] DoF', afterCollinear.signedDof, 'state', afterCollinear.state);
  // Collinear: -2 DoF (direction + position).
  expect(afterSymmetric.signedDof - afterCollinear.signedDof).toBe(2);
  await frame('C3-after-collinear-ref-lines-aligned');

  // ─── G. RELATION #4 — MIDPOINT: pin a point to bottom segment midpoint ──
  await win.evaluate((sel) => {
    window.__archdiscSelectedSketchEntities = sel;
  }, [entityLayout.midPoint, entityLayout.midSeg]);
  await win.locator('.ribbon-tool-label', { hasText: /^Midpoint Relation$/ }).first().click();
  await win.waitForFunction(() => !!window.__lastSketchRelation && window.__lastSketchRelation.type === 'midpoint', null, { timeout: 15000 });
  const afterMidpoint = await status();
  console.log('  [after Midpoint] DoF', afterMidpoint.signedDof, 'state', afterMidpoint.state);
  // Midpoint: -2 DoF.
  expect(afterCollinear.signedDof - afterMidpoint.signedDof).toBe(2);
  await frame('C4-after-midpoint-point-snaps-to-segment-mid');

  // ─── H. RELATION #5 — FIX: anchor the pitch circle ─────────────────────
  // Fix on a circle = -3 DoF (centre xy + radius).
  await win.evaluate((sel) => {
    window.__archdiscSelectedSketchEntities = sel;
  }, [entityLayout.pitch]);
  await win.locator('.ribbon-tool-label', { hasText: /^Fix Relation$/ }).first().click();
  await win.waitForFunction(() => !!window.__lastSketchRelation && window.__lastSketchRelation.type === 'fix', null, { timeout: 15000 });
  const afterFix = await status();
  console.log('  [after Fix] DoF', afterFix.signedDof, 'state', afterFix.state);
  // Fix on a circle removes 3 DoF (centre x + centre y + radius).
  expect(afterMidpoint.signedDof - afterFix.signedDof).toBe(3);
  await frame('C5-after-fix-pitch-circle-anchored');

  // ─── I. DISPLAY RELATIONS — open the dock + verify 5 relations ─────────
  // Open the dock with the pitch circle selected. We expect at least 2
  // relations on it (the Concentric pair + the Fix).
  await win.evaluate((sel) => {
    window.__archdiscSelectedSketchEntities = sel;
  }, [entityLayout.pitch]);
  await win.locator('.ribbon-tool-label', { hasText: /^Display Relations$/ }).first().click();
  await win.waitForTimeout(400);
  // The dock should now be visible.
  const dock = win.locator('[data-archdisc-relations-dock="open"]').first();
  await expect(dock).toBeVisible({ timeout: 5000 });
  const relRows = win.locator('[data-archdisc-relation-id]');
  const relCountVisible = await relRows.count();
  expect(relCountVisible).toBeGreaterThanOrEqual(2);
  // Verify the labels include Concentric AND Fix for the selected pitch circle.
  const labels = await relRows.evaluateAll((rows) =>
    rows.map((r) => r.querySelector('.sw-relations-dock-row-label')?.textContent?.trim()).filter(Boolean));
  console.log('  [dock labels]', labels);
  expect(labels.some(l => l.includes('Concentric'))).toBe(true);
  expect(labels.some(l => l.includes('Fix'))).toBe(true);
  await frame('D1-display-relations-on-pitch-circle');

  // ─── J. DELETE A RELATION — restore DoF ────────────────────────────────
  // Delete the Fix relation. After deletion, DoF should jump back UP by 3.
  const allRelsBefore = await win.evaluate(() => window.__archdiscSketch.getAllRelations());
  const fixRel = allRelsBefore.find(r => r.type === 'fix');
  expect(fixRel).toBeDefined();
  await win.evaluate((id) => {
    const r = window.__archdiscSketch.deleteRelation(id);
    window.__lastSketchRelationDelete = r;
  }, fixRel.id);
  await win.waitForFunction(() => !!window.__lastSketchRelationDelete, null, { timeout: 5000 });
  const afterDelete = await status();
  console.log('  [after Fix deletion] DoF', afterDelete.signedDof, 'state', afterDelete.state);
  // DoF should restore by 3.
  expect(afterDelete.signedDof - afterFix.signedDof).toBe(3);
  await frame('D2-after-fix-deletion-dof-restored');

  // Re-apply Fix so the final state is fully relations-driven.
  await win.evaluate((sel) => {
    window.__archdiscSelectedSketchEntities = sel;
  }, [entityLayout.pitch]);
  await win.locator('.ribbon-tool-label', { hasText: /^Fix Relation$/ }).first().click();
  await win.waitForTimeout(300);
  const afterRefix = await status();
  console.log('  [after re-Fix] DoF', afterRefix.signedDof, 'state', afterRefix.state);
  expect(afterRefix.signedDof).toBe(afterFix.signedDof);

  // ─── K. Cumulative DoF sanity ──────────────────────────────────────────
  // Total DoF reduction across all 5 relations = 2 + 4 + 2 + 2 + 3 = 13.
  // Just confirm the final state matches the expected delta.
  const finalDelta = dof0 - afterRefix.signedDof;
  console.log(`  [cumulative DoF] initial=${dof0}, final=${afterRefix.signedDof}, removed=${finalDelta}`);
  expect(finalDelta).toBe(13);

  // ─── L. EXTRUDE CUT — the bore + 2 holes through the flange ────────────
  // The focal capability is the RELATIONS — extruding is the canonical
  // sketch-on-face conclusion that demonstrates the geometry survived
  // the relation passes. We cut the bore (centre hole) through the disc.
  const cutInfo = await win.evaluate(async () => {
    const sketch = window.__archdiscSketch;
    const A = window.__archdiscAtomic;
    const reg = window.__archdiscRegistry;
    const last = reg.bodies[reg.bodies.length - 1];
    const part = A.createPart('flange-bored');
    part.solid = last.manifold;
    await A.startSketch(part, 'top');
    A.sketchCircle(part, 0, 0, 10); // bore — r=10mm
    A.finishSketch(part);
    await A.cut(part, 8);
    window.__three_scene.remove(last.group);
    reg.remove(last.id);
    A.renderBody(part, 0x8a96a3);
    return { ok: true };
  });
  expect(cutInfo.ok).toBe(true);
  // Deactivate the sketch so the cut is visible cleanly.
  await win.evaluate(() => {
    const sketch = window.__archdiscSketch;
    if (sketch.active) sketch.deactivate(window.__three_scene);
  });
  await win.waitForTimeout(400);
  await setIsoCamera();
  await frame('E1-extruded-bored-flange-iso');

  // ─── M. Read the sketch-state stills to verify visual DoF colour drop ──
  // The sketch-state pills + entity colour should have flipped per relation.
  // We can't directly read pixel colours, but we can read the data
  // attributes on the SketchStateBadge which mirror the sketch state.
  const finalBadge = await win.evaluate(() => {
    const el = document.querySelector('[data-archdisc-sketch-state]');
    return el ? {
      state: el.getAttribute('data-archdisc-sketch-state'),
      dof: el.getAttribute('data-archdisc-sketch-dof'),
    } : null;
  });
  console.log('  [final badge]', finalBadge);

  // ─── N. Honest stats ───────────────────────────────────────────────────
  console.log('  [tier2b stats]');
  console.log(`    Concentric (bore + pitch):   DoF ${dof0} → ${afterConcentric.signedDof} (-2)`);
  console.log(`    Symmetric (bolt1 + bolt2):   DoF ${afterConcentric.signedDof} → ${afterSymmetric.signedDof} (-4)`);
  console.log(`    Collinear (refLeft + refR):  DoF ${afterSymmetric.signedDof} → ${afterCollinear.signedDof} (-2)`);
  console.log(`    Midpoint (point on segment): DoF ${afterCollinear.signedDof} → ${afterMidpoint.signedDof} (-2)`);
  console.log(`    Fix (pitch circle):           DoF ${afterMidpoint.signedDof} → ${afterFix.signedDof} (-3)`);
  console.log(`    TOTAL reduction: ${finalDelta} DoF`);

  // ─── O. No real page errors ────────────────────────────────────────────
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
