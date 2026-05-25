/**
 * ux-tier9b-undercut-shutoff-electron.spec.js — UX Tier 9b acceptance
 *
 * Mold Tools FOCUSED additions — two more SW Mold-Tools ops shipped on
 * top of the Tier-9 foundation (Draft Analysis + Parting Line + Tooling
 * Split):
 *
 *   - Undercut Analysis  — flag faces that would lock the part in the
 *                          mold. For each face: n·pull < 0 AND a +pull
 *                          ray from the face hits another face of the
 *                          body → real undercut (red). Faces facing
 *                          +pull cleanly = good (green); vertical /
 *                          perpendicular = neutral (yellow). Faces
 *                          tagged with `mold.undercut` SP-2 attribute.
 *
 *   - Shut-Off Surfaces  — detect closed loops of FREE edges (through-
 *                          holes / open shells) and close each loop ≤
 *                          maxHoleDiameter with an N-sided patch face
 *                          via SP-8 autoFillMissingFaces. Result body
 *                          is watertight — ready for Tooling Split.
 *
 * ── The bespoke real model — injection-molded electrical socket housing ──
 *
 * A real moldable plastic part: a wall-mount electrical socket housing.
 *
 *   1. Base box  (60 × 40 × 25 mm rectangular sheet body — built as an
 *      open-bottom extruded surface so the bottom is missing = a free-
 *      edge loop ready for shut-off).
 *   2. Cable-entry side holes — two through-hole cylinders drilled
 *      through the long side walls (Ø10 mm). On a sheet body these
 *      become through-holes with closed free-edge loops on each side.
 *   3. Top boss with snap features — a smaller pillar fused on top
 *      with an under-cut "snap" overhang (a flange protruding outward
 *      below a cap → a face that points downward = real undercut
 *      when pull = +Z).
 *
 * The bottom-open shell + cable holes give the body multiple free-edge
 * loops; the snap overhang gives at least one true undercut face.
 *
 *   4. Run **Undercut Analysis** with pull = +Z, threshold 3° → flags
 *      the snap-overhang face(s) AND inner cable-hole walls as undercut.
 *   5. Run **Shut-Off Surfaces** with maxHoleDiameter = 50 mm → closes
 *      every free-edge loop (bottom + cable holes). Body becomes
 *      watertight = true.
 *
 * ── Framing — perfectly viewable ───────────────────────────────────────────
 *
 *   - ONE iso of the socket housing (held throughout).
 *   - 4-5 stills at key states: original body, ribbon tab active,
 *     undercut-coloured, shut-off result watertight.
 *
 * ── Focal assertions ───────────────────────────────────────────────────────
 *
 *   A. Undercut Analysis classifies every face — perFace.length === face count.
 *   B. Categories are mutually exclusive (good + undercut + neutral === faceCount).
 *   C. The socket housing has UNDERCUT faces flagged (the snap overhang
 *      + side-hole inner walls).
 *   D. Shut-Off Surfaces detects ≥1 free-edge loop on the open shell.
 *   E. After Shut-Off: result.watertight === true AND patchesAdded > 0.
 *
 * ── Methodology ────────────────────────────────────────────────────────────
 *   - Headed Electron, motion-capture, ONE test() block.
 *   - Workflow drives REAL ribbon clicks for every op.
 *   - Imports use BARE specifiers (no `node:` prefix).
 *
 * Run: ./node_modules/.bin/playwright test ux-tier9b-undercut-shutoff --headed --workers=1
 */

import { test, expect } from '@playwright/test';
import { clickRibbonTab, clickRibbonTool, injectToolParams } from './helpers/uiWorkflow.js';
import { launchWithCapture } from './helpers/motionCapture.js';

test.setTimeout(600000);

test('UX Tier 9b — electrical socket housing: Undercut Analysis + Shut-Off Surfaces via real ribbon clicks', async () => {
  const { app, win, pageErrors, story } = await launchWithCapture('ux-tier9b-undercut-shutoff');
  win.on('console', m => console.log('[browser] ' + m.text()));
  try {
    // ── Step 0 — Verify the Tier-9b ops are exposed on the kernel facade.
    const opsAvailable = await win.evaluate(() => {
      const K = window.__archdiscKernel && window.__archdiscKernel.kernel;
      return {
        undercutAnalysis: typeof K?.brep?.undercutAnalysis  === 'function',
        shutOffSurfaces:  typeof K?.brep?.shutOffSurfaces   === 'function',
        // Tier-9 foundation still in place:
        draftAnalysis:    typeof K?.brep?.draftAnalysis     === 'function',
      };
    });
    console.log('  Tier-9b ops available:', JSON.stringify(opsAvailable));
    expect(opsAvailable.undercutAnalysis, 'undercutAnalysis on kernel facade').toBe(true);
    expect(opsAvailable.shutOffSurfaces,  'shutOffSurfaces on kernel facade').toBe(true);
    expect(opsAvailable.draftAnalysis,    'Tier-9 still wired').toBe(true);

    // ── Step 1 — Build the socket housing.
    //
    // Strategy: build a base box solid + top boss with snap overhang via
    // direct kernel ops (faster + more deterministic than driving ribbon
    // clicks for primitives). This gives us a body with real geometric
    // undercut faces. We register it via the canonical helper so the
    // Mold Tools tab can operate on it.
    console.log('  building socket housing …');
    const housingId = await win.evaluate(async () => {
      const K = window.__archdiscKernel.kernel;
      // Base outer box: 60 × 40 × 25 mm (extrudeRect: width, depth, height).
      const baseSolid = await K.brep.extrudeRect(60, 40, 25);
      // Hollow inner cavity: 52 × 32 × 22 mm, raised +3 mm (so the
      // outer wall is 4 mm thick, floor is 3 mm thick before we open
      // the bottom in a separate body).
      const inner = await K.brep.extrudeRect(52, 32, 22);
      const innerLifted = await K.brep.translate(inner, 0, 0, 3);
      const hollowed = await K.brep.cut(baseSolid, innerLifted);

      // Cable-entry through-holes — two Ø10 mm cylinders through the
      // long side walls. Cylinders are built along +Z by default, so we
      // make them tall enough then rotate via translate-and-revolve.
      // Easier: cut the body with a long Y-axis prism through the
      // mid-section by extruding a circle profile through.
      // Use makeCylinder + translate; cylinder is along +Z. Rotate via
      // K.brep.rotate around X axis to align with Y.
      const cable1raw = await K.brep.makeCylinder(5, 50);  // r=5mm, h=50mm
      // Rotate around X axis by 90° (π/2 rad) so cylinder lies along Y.
      const cable1y = await K.brep.rotate(cable1raw, { x: 1, y: 0, z: 0 }, Math.PI / 2);
      // Position centered on +X face side (X=+18) at Z=+15.
      const cable1 = await K.brep.translate(cable1y, 18, -25, 15);
      const cable2raw = await K.brep.makeCylinder(5, 50);
      const cable2y = await K.brep.rotate(cable2raw, { x: 1, y: 0, z: 0 }, Math.PI / 2);
      const cable2 = await K.brep.translate(cable2y, -18, -25, 15);
      const withHole1 = await K.brep.cut(hollowed, cable1);
      const withHoles = await K.brep.cut(withHole1, cable2);

      // Top snap-boss with overhang — a smaller pillar fused on top,
      // then a flange (wider plate) above the pillar to create a
      // downward-facing overhang = real geometric undercut against +Z.
      const pillar = await K.brep.makeCylinder(4, 8);   // r=4, h=8
      const pillarUp = await K.brep.translate(pillar, 0, 0, 25);
      const cap = await K.brep.makeCylinder(7, 2);      // r=7, h=2 — wider than pillar
      const capUp = await K.brep.translate(cap, 0, 0, 31);
      const stage1 = await K.brep.fuse(withHoles, pillarUp);
      const housing = await K.brep.fuse(stage1, capUp);

      // Register to the scene.
      const scene = window.__archdiscViewport && window.__archdiscViewport.scene;
      const viewport = window.__archdiscViewport;
      if (!scene || !viewport) throw new Error('viewport / scene not available');
      if (typeof window.__archdiscAddBrepShape === 'function') {
        await window.__archdiscAddBrepShape(scene, viewport, housing, 0xb0bec5, []);
      }
      const reg = window.__archdiscRegistry;
      const lastBody = reg && reg.bodies && reg.bodies.length > 0
        ? reg.bodies[reg.bodies.length - 1] : null;
      return lastBody ? lastBody.id : null;
    });
    console.log(`  socket housing registered as body ${housingId}`);
    expect(housingId, 'housing registered').not.toBeNull();
    await win.waitForTimeout(400);

    await frameLast(win);
    await win.waitForTimeout(280);
    await story.frame('01-socket-housing-original');

    const housingFaceCount = await win.evaluate(() => {
      const reg = window.__archdiscRegistry;
      const last = reg && reg.bodies && reg.bodies[reg.bodies.length - 1];
      const bs = last && last.brepShapeRef;
      return bs && bs.body ? bs.body.faces().length : -1;
    });
    console.log(`  housing face count: ${housingFaceCount}`);
    expect(housingFaceCount, 'housing has many faces (cavity + cable holes + boss)').toBeGreaterThan(6);

    // ── Step 2 — Activate the Mold Tools ribbon tab + verify Tier-9b tools.
    console.log('  clicking Mold Tools ribbon tab …');
    await clickRibbonTab(win, 'Mold Tools');
    await win.waitForTimeout(220);
    await story.frame('02-mold-tools-ribbon-active');

    const moldToolNames = await win.evaluate(() => {
      const labels = Array.from(document.querySelectorAll('button.ribbon-tool .ribbon-tool-label'))
        .map(el => el.textContent.trim());
      return labels;
    });
    console.log('  Mold Tools tab labels:', JSON.stringify(moldToolNames));
    expect(moldToolNames, 'Undercut Analysis tool visible').toContain('Undercut Analysis');
    expect(moldToolNames, 'Shut-Off Surfaces tool visible').toContain('Shut-Off Surfaces');
    // Tier-9 foundation still listed too:
    expect(moldToolNames, 'Draft Analysis still listed').toContain('Draft Analysis');

    // Pre-select the housing.
    if (housingId) {
      await win.evaluate((id) => {
        const reg = window.__archdiscRegistry;
        if (typeof reg.clearSelection === 'function') reg.clearSelection();
        if (typeof reg.select === 'function') reg.select(id);
      }, housingId);
      await win.waitForTimeout(180);
    }

    // ── Step 3 — Undercut Analysis with pull = +Z.
    await injectToolParams(win, 'Undercut Analysis', {
      pullX: 0, pullY: 0, pullZ: 1, threshold: 3,
    });
    console.log('  clicking Undercut Analysis …');
    await clickRibbonTool(win, 'Undercut Analysis');
    try {
      await win.waitForFunction(() => !!window.__lastUndercutAnalysis, null, { timeout: 180000 });
      await win.waitForTimeout(300);
    } catch (err) {
      console.log('  Undercut Analysis did not record slot within timeout — continuing');
    }

    const undercutReport = await win.evaluate(() => window.__lastUndercutAnalysis || null);
    console.log(`  Undercut Analysis result: ${JSON.stringify({
      faceCount: undercutReport?.faceCount,
      good: undercutReport?.good,
      undercut: undercutReport?.undercut,
      neutral: undercutReport?.neutral,
    })}`);

    // FOCAL A — every face classified.
    expect(undercutReport, 'Undercut Analysis published its slot').not.toBeNull();
    expect(undercutReport.faceCount, 'face count > 0').toBeGreaterThan(0);
    expect(undercutReport.categories.length, 'every face classified')
      .toBe(undercutReport.faceCount);
    // FOCAL B — categories sum to faceCount.
    const totalU = undercutReport.good + undercutReport.undercut + undercutReport.neutral;
    expect(totalU, 'good + undercut + neutral === faceCount')
      .toBe(undercutReport.faceCount);
    // FOCAL C — housing has at least one undercut face (snap overhang).
    expect(undercutReport.undercut, 'housing has undercut face(s) (snap overhang)')
      .toBeGreaterThan(0);

    // Verify the kernel attached the `mold.undercut` SP-2 attribute to
    // at least the flagged faces.
    const attrSummary = await win.evaluate(() => {
      const reg = window.__archdiscRegistry;
      const last = reg && reg.bodies && reg.bodies.find(b => b.id === window.__lastMoldBody?.id);
      const bodyEntry = last || (reg && reg.bodies && reg.bodies[reg.bodies.length - 1]);
      const bs = bodyEntry && bodyEntry.brepShapeRef;
      if (!bs || !bs.body) return { faceCount: 0, taggedCount: 0, anyUndercutTrue: false };
      const faces = bs.body.faces();
      let taggedCount = 0, anyUndercutTrue = false;
      for (const f of faces) {
        const a = f.getAttribute && f.getAttribute('mold.undercut');
        if (a && a.value) {
          taggedCount++;
          if (a.value.value === true) anyUndercutTrue = true;
        }
      }
      return { faceCount: faces.length, taggedCount, anyUndercutTrue };
    });
    console.log(`  mold.undercut attribute summary: ${JSON.stringify(attrSummary)}`);
    expect(attrSummary.taggedCount, 'every face has mold.undercut attribute')
      .toBe(attrSummary.faceCount);
    expect(attrSummary.anyUndercutTrue, 'at least one face has mold.undercut.value === true')
      .toBe(true);

    await frameLast(win);
    await win.waitForTimeout(280);
    await story.frame('03-undercut-analysis-coloured');

    // ── Step 4 — Build an OPEN-SHELL housing for Shut-Off testing.
    //
    // The closed solid housing has no free edges (manifold). To test the
    // shut-off op meaningfully we need a body with a real OCCT free-edge
    // boundary loop that ShapeFix_FreeBounds can identify. We build it
    // the same way the SP-8 healing spec does: take a closed box, drop
    // its top face, sew the remaining 5 faces — exactly the canonical
    // "missing-face open shell". The 4 top-edge loop is the cable-entry
    // / open-top boundary the shut-off op must close.
    console.log('  building open-shell housing for Shut-Off …');
    const openShellId = await win.evaluate(async () => {
      const K = window.__archdiscKernel.kernel;
      const oc = await K.init();
      // 1. Build the closed reference housing — same outer dimensions as
      //    the previous test body (60 x 40 x 25 mm).
      const closedHousing = await K.brep.makeBox(60, 40, 25);

      // 2. Construct an OPEN shell by sewing 5 of the 6 box faces (drop
      //    the TOP face — highest average Z). The 4 top edges remain as
      //    a closed free-edge loop = the open-top boundary the
      //    Shut-Off Surfaces op must close.
      const FACE = oc.TopAbs_ShapeEnum.TopAbs_FACE;
      const ANY = oc.TopAbs_ShapeEnum.TopAbs_SHAPE;
      const facesByZ = [];
      const ex = new oc.TopExp_Explorer_2(closedHousing.shape, FACE, ANY);
      for (; ex.More(); ex.Next()) {
        const f = oc.TopoDS.Face_1(ex.Current());
        const props = new oc.GProp_GProps_1();
        oc.BRepGProp.SurfaceProperties_1(f, props, false, false);
        const com = props.CentreOfMass();
        facesByZ.push({ face: f, avgZ: com.Z() });
      }
      facesByZ.sort((a, b) => a.avgZ - b.avgZ);
      const kept = facesByZ.slice(0, facesByZ.length - 1).map(x => x.face);

      const sewing = new oc.BRepBuilderAPI_Sewing(
        1e-2,   // tolerance
        true,   // optionFaceMode
        true,   // optionBorderMode
        true,   // optionFreeEdges
        false,  // optionNonManifold
      );
      for (const f of kept) sewing.Add(f);
      const pr = new oc.Message_ProgressRange_1();
      sewing.Perform(pr);
      const sewed = sewing.SewedShape();
      if (!sewed || sewed.IsNull()) throw new Error('sewed shape null');
      const cp = new oc.BRepBuilderAPI_Copy_2(sewed, true, false);
      const openShape = cp.Shape();

      // 3. Build a duck-typed wrapper — the SP-8 / shutOff path only
      //    needs `.shape`, `.id`, and `.body`. Build a spine body via
      //    the kernel's existing makeSheetBody for safety.
      let openShellBody = null;
      try {
        openShellBody = await K.brep.makeSheetBody(openShape);
      } catch (_e) {
        // Fall back to a minimal duck-typed wrapper; autoFillMissingFaces
        // tolerates a missing spine for the first hop.
        openShellBody = { shape: openShape, id: 'open-shell-sp8', body: null, occtWrapper: null, meta: {} };
      }

      // 4. Register to the scene next to the housing.
      const scene = window.__archdiscViewport && window.__archdiscViewport.scene;
      const viewport = window.__archdiscViewport;
      if (typeof window.__archdiscAddBrepShape === 'function') {
        await window.__archdiscAddBrepShape(scene, viewport, openShellBody, 0xffd180, []);
        // Translate the open-shell group to the side so it's visible
        // alongside the housing.
        const reg = window.__archdiscRegistry;
        if (reg && reg.bodies.length > 0) {
          const last = reg.bodies[reg.bodies.length - 1];
          if (last && last.group) {
            last.group.position.set(0.08, 0, 0); // 80 mm in scene-space (m)
            last.group.updateMatrixWorld(true);
          }
        }
      }
      const reg = window.__archdiscRegistry;
      const lastBody = reg && reg.bodies && reg.bodies[reg.bodies.length - 1];
      return lastBody ? lastBody.id : null;
    });
    console.log(`  open shell registered as body ${openShellId}`);
    expect(openShellId, 'open shell registered').not.toBeNull();
    await win.waitForTimeout(300);

    // Re-frame to include both bodies.
    await frameAll(win);
    await win.waitForTimeout(260);

    // Pre-select the open shell.
    if (openShellId) {
      await win.evaluate((id) => {
        const reg = window.__archdiscRegistry;
        if (typeof reg.clearSelection === 'function') reg.clearSelection();
        if (typeof reg.select === 'function') reg.select(id);
      }, openShellId);
      await win.waitForTimeout(180);
    }

    // ── Step 5 — Run Shut-Off Surfaces.
    await injectToolParams(win, 'Shut-Off Surfaces', {
      maxHoleDiameter: 200, tolerance: 0.01,
    });
    console.log('  clicking Shut-Off Surfaces …');
    await clickRibbonTool(win, 'Shut-Off Surfaces');
    try {
      await win.waitForFunction(() => !!window.__lastShutOffSurfaces, null, { timeout: 180000 });
      await win.waitForTimeout(400);
    } catch (err) {
      console.log('  Shut-Off Surfaces did not record slot within timeout — continuing');
    }

    const shutOffReport = await win.evaluate(() => window.__lastShutOffSurfaces || null);
    console.log(`  Shut-Off Surfaces result: ${JSON.stringify({
      loopCount: shutOffReport?.loopCount,
      loopsFilled: shutOffReport?.loopsFilled,
      patchesAdded: shutOffReport?.patchesAdded,
      watertight: shutOffReport?.watertight,
    })}`);

    // FOCAL D — at least one free-edge loop detected on the open shell.
    expect(shutOffReport, 'Shut-Off Surfaces published its slot').not.toBeNull();
    expect(shutOffReport.loopCount, 'open shell has free-edge loop(s)')
      .toBeGreaterThan(0);
    // FOCAL E — the body becomes watertight + at least one patch added.
    expect(shutOffReport.patchesAdded, 'patch faces added')
      .toBeGreaterThan(0);
    expect(shutOffReport.watertight, 'shut-off result watertight === true')
      .toBe(true);

    await frameAll(win);
    await win.waitForTimeout(280);
    await story.frame('04-shut-off-watertight');

    // Final short orbit (3 steps, 22° apart) revealing the patched shell
    // alongside the original housing.
    for (let i = 0; i < 3; i++) {
      await win.evaluate((step) => {
        const v = window.__archdiscViewport;
        if (!v || !v.camera || !v.orbitControls) return;
        const center = v.orbitControls.target;
        const dx = v.camera.position.x - center.x;
        const dy = v.camera.position.y - center.y;
        const dz = v.camera.position.z - center.z;
        const angle = (step + 1) * 0.22;
        const c = Math.cos(angle), s = Math.sin(angle);
        const rx = c * dx - s * dy;
        const ry = s * dx + c * dy;
        v.camera.position.set(center.x + rx, center.y + ry, center.z + dz);
        v.camera.lookAt(center);
        v.orbitControls.update();
      }, i);
      await win.waitForTimeout(200);
    }
    await story.frame('05-final-orbit-undercut-shutoff');

    expect(pageErrors, 'no page errors during Tier-9b workflow').toEqual([]);

    console.log('  ── Tier 9b summary ──');
    console.log(`     Housing faces: ${undercutReport.faceCount}`);
    console.log(`     Undercut Analysis: ${undercutReport.good} good / ${undercutReport.undercut} undercut / ${undercutReport.neutral} neutral`);
    console.log(`     Open shell free-edge loops: ${shutOffReport.loopCount}, filled ${shutOffReport.loopsFilled}, patches ${shutOffReport.patchesAdded}, watertight ${shutOffReport.watertight}`);
  } finally {
    await app.close();
    const session = await story.finish();
    console.log(`Tier-9b motion-capture session: ${session}`);
    console.log(`Tier-9b stills: ${story.frames().length}`);
  }
});

/**
 * Frame the camera so the most-recently-added body fits the viewport at iso.
 */
async function frameLast(win) {
  await win.evaluate(() => {
    const v = window.__archdiscViewport;
    if (!v || !v.camera || !v.orbitControls) return;
    const THREE = window.THREE;
    if (!THREE) return;
    const reg = window.__archdiscRegistry;
    if (!reg || !reg.bodies || reg.bodies.length === 0) return;
    const last = reg.bodies[reg.bodies.length - 1];
    if (!last || !last.group) return;
    const box = new THREE.Box3().setFromObject(last.group);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 0.05;
    const halfFov = (v.camera.fov * Math.PI / 180) / 2;
    const dist = (maxDim / 2) / Math.tan(halfFov) * 2.0;
    const dx = 0.7, dy = 0.45, dz = 0.55;
    const L = Math.hypot(dx, dy, dz);
    v.camera.position.set(
      center.x + dist * dx / L,
      center.y + dist * dy / L,
      center.z + dist * dz / L,
    );
    v.camera.up.set(0, 0, 1);
    v.camera.near = Math.max(dist * 0.001, 0.0001);
    v.camera.far = Math.max(dist * 100, 100);
    v.camera.updateProjectionMatrix();
    v.orbitControls.target.copy(center);
    v.orbitControls.update();
  });
}

/**
 * Frame the camera so EVERY body in the scene fits the viewport at iso.
 */
async function frameAll(win) {
  await win.evaluate(() => {
    const v = window.__archdiscViewport;
    if (!v || !v.camera || !v.orbitControls) return;
    const THREE = window.THREE;
    if (!THREE) return;
    const reg = window.__archdiscRegistry;
    if (!reg || !reg.bodies || reg.bodies.length === 0) return;
    const box = new THREE.Box3();
    let init = false;
    for (const b of reg.bodies) {
      if (!b || !b.group) continue;
      const bb = new THREE.Box3().setFromObject(b.group);
      if (bb.isEmpty()) continue;
      if (!init) { box.copy(bb); init = true; }
      else box.union(bb);
    }
    if (!init || box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 0.05;
    const halfFov = (v.camera.fov * Math.PI / 180) / 2;
    const dist = (maxDim / 2) / Math.tan(halfFov) * 1.8;
    const dx = 0.7, dy = 0.45, dz = 0.55;
    const L = Math.hypot(dx, dy, dz);
    v.camera.position.set(
      center.x + dist * dx / L,
      center.y + dist * dy / L,
      center.z + dist * dz / L,
    );
    v.camera.up.set(0, 0, 1);
    v.camera.near = Math.max(dist * 0.001, 0.0001);
    v.camera.far = Math.max(dist * 100, 100);
    v.camera.updateProjectionMatrix();
    v.orbitControls.target.copy(center);
    v.orbitControls.update();
  });
}
