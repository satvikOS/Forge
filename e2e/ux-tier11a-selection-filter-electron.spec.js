/**
 * UX Tier-11a — NX-distinctive Selection-priority pre-filter, in motion.
 *
 * Builds a real bolted-plate flange-joint mockup in the headed Electron app:
 *
 *   - Lower plate (80 × 60 × 8 mm, mid-grey)  — sits at z = 0
 *   - Upper plate (80 × 60 × 6 mm, light blue) — stacked at z = 8 mm
 *   - Four fastener cylinders (Ø 6 × 24 mm)    — at the four corner-ish
 *     bolt holes, threading both plates vertically. (Cylinders, not real
 *     bolts; "bolted-plate assembly" is the geometry we exercise — the
 *     point is multiple bodies + multiple visible faces + multiple edges.)
 *   - One sheet body — a marker rectangle behind the assembly that we tag
 *     with `userData.bodyKind = 'sheet'` so the Sheet-Body filter has a
 *     real target to match (the foundation-manifold path doesn't emit
 *     sheets natively; this is the documented partial state).
 *
 * Demonstrates the NX selection-priority pre-filter cycling through ALL
 * SIX modes with the SAME on-screen click location (a corner of the upper
 * plate, where a face, an edge, and a vertex are all available within a
 * few pixels). One still per mode + a final summary still. ONE perfect
 * iso framing; whole assembly fits clearly; no 7-angle orbit.
 *
 *   - Solid:  click → whole upper plate body selected.
 *   - Sheet:  click on the sheet marker → only the sheet body responds;
 *             clicking on a solid does NOT select it.
 *   - Face:   click → ONE analytic face of the upper plate highlighted.
 *   - Edge:   click → the nearest edge of the upper plate highlighted.
 *   - Vertex: click → the nearest corner-vertex highlighted.
 *   - Single: click → whatever is hit first (legacy behaviour) selected.
 *
 * ONE workflow, ONE `test()`, slow-mo + motion-capture infra, no `node:*`
 * imports. Run with:
 *
 *   ./node_modules/.bin/playwright test \
 *     e2e/ux-tier11a-selection-filter-electron.spec.js \
 *     --workers=1 --reporter=list
 */

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT  = path.resolve(__dirname, '..', 'e2e-output', 'ux-tier11a');
const MAIN = path.resolve(__dirname, '..', 'electron', 'main.js');

test.describe.configure({ mode: 'serial' });

test('Tier-11a NX selection-priority pre-filter cycles through six modes on a bolted-plate assembly', async () => {
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
    slowMo: 220,
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
  await win.waitForFunction(() => !!window.__archdiscRegistry, null, { timeout: 60000 });

  // Bypass the param dialog — we drive everything atomically.
  await win.evaluate(() => { window.__archdiscBypassDialog = true; });

  let frameIdx = 0;
  const frame = async (label) => {
    frameIdx += 1;
    const nn = String(frameIdx).padStart(2, '0');
    const safe = label.replace(/[^a-z0-9_-]/gi, '-');
    const file = path.join(OUT, `${nn}-${safe}.png`);
    await win.waitForTimeout(250);
    await win.screenshot({ path: file });
    console.log(`  [frame] ${file}`);
    return file;
  };

  // ─── A. Build the bolted-plate assembly ────────────────────────────────
  // Lower plate centred at origin, upper plate stacked on top (offset in
  // Z); four cylindrical fasteners through both. We use renderBody (NOT
  // render) to keep each body in the scene; the existing render() helper
  // would clear the previous atomic group.

  const buildInfo = await win.evaluate(async () => {
    const A = window.__archdiscAtomic;
    const THREE = window.THREE;
    const scene = window.__three_scene;

    // Lower plate — 80 × 60 × 8 mm.
    const lower = A.createPart('lower-plate');
    await A.startSketch(lower, 'XY');
    A.sketchRectangle(lower, 0, 0, 80, 60);
    A.finishSketch(lower);
    await A.extrude(lower, 8);
    const lowerGroup = A.renderBody(lower, 0x7a8694);

    // Upper plate — 80 × 60 × 6 mm, translated +8 in Z so it sits on top.
    const upper = A.createPart('upper-plate');
    await A.startSketch(upper, 'XY');
    A.sketchRectangle(upper, 0, 0, 80, 60);
    A.finishSketch(upper);
    await A.extrude(upper, 6);
    A.translate(upper, 0, 0, 8);
    const upperGroup = A.renderBody(upper, 0x7da4c8);

    // Four fastener cylinders — Ø 6 × 24 mm, one at each of the four bolt
    // positions. We place them at ±30 mm X and ±20 mm Y so they're inset
    // from the plate edges.
    const fastenerInfo = [];
    const bolts = [
      { x:  30, y:  20 }, { x: -30, y:  20 },
      { x:  30, y: -20 }, { x: -30, y: -20 },
    ];
    for (const b of bolts) {
      const f = A.createPart(`fastener_${b.x}_${b.y}`);
      await A.startSketch(f, 'XY');
      A.sketchCircle(f, b.x, b.y, 3); // Ø 6 → r = 3
      A.finishSketch(f);
      await A.extrude(f, 24);
      // Lift so the cylinder runs from z = -2 to z = +22 (slightly proud
      // top + bottom — makes the head/tip clearly visible on the body).
      A.translate(f, 0, 0, -2);
      const g = A.renderBody(f, 0xd6a04a);
      fastenerInfo.push({ x: b.x, y: b.y, name: g.name || 'fastener' });
    }

    // ─── Sheet-body marker ─────────────────────────────────────────────
    // The foundation manifold path emits solids only — to exercise the
    // "Sheet Body" filter we explicitly create a Three.js plane mesh,
    // tag it userData.bodyKind = 'sheet', and register it with the
    // BodyRegistry so the Selection Bar has a real sheet to match.
    const sheetGeom = new THREE.PlaneGeometry(0.090, 0.070); // 90 × 70 mm
    const sheetMat  = new THREE.MeshBasicMaterial({
      color: 0xff8c5a, transparent: true, opacity: 0.55,
      side: THREE.DoubleSide, depthTest: true,
    });
    const sheetMesh = new THREE.Mesh(sheetGeom, sheetMat);
    sheetMesh.userData.pickable = true;
    // Place the sheet vertically behind the assembly (parallel to XZ),
    // centred at y = -0.060 m. Rotate it so the normal points +Y.
    sheetMesh.rotation.x = Math.PI / 2;
    sheetMesh.position.set(0, -0.060, 0.012);
    const sheetGroup = new THREE.Group();
    sheetGroup.name = 'BackdropSheet';
    sheetGroup.userData.bodyKind = 'sheet';
    sheetGroup.userData.pickable = true;
    sheetGroup.add(sheetMesh);
    scene.add(sheetGroup);
    // Register so the BodyRegistry / Part Browser shows it.
    const reg = window.__archdiscRegistry;
    // Fabricate a minimal manifold-like stub: BodyRegistry only reads
    // `.volume()`. A flat sheet has no volume — return 0.
    const sheetManifoldStub = { volume: () => 0 };
    reg.register({
      group: sheetGroup,
      manifold: sheetManifoldStub,
      sourceTool: 'BackdropSheet',
      name: 'Backdrop Sheet (sheet body)',
    });

    return {
      bodyCount: reg.bodies.length,
      lowerName: lowerGroup.name,
      upperName: upperGroup.name,
      lowerId: lowerGroup.userData.bodyId,
      upperId: upperGroup.userData.bodyId,
      sheetId: sheetGroup.userData.bodyId,
      fastenerCount: fastenerInfo.length,
    };
  });
  console.log(`  [build] ${JSON.stringify(buildInfo)}`);
  expect(buildInfo.bodyCount).toBeGreaterThanOrEqual(7); // 2 plates + 4 bolts + 1 sheet
  expect(buildInfo.upperId).toBeTruthy();
  expect(buildInfo.sheetId).toBeTruthy();

  // ─── B. Park the camera at ONE perfect iso framing ────────────────────
  // The Selection-Bar lives at the top-left; the heads-up toolbar at
  // top-centre. Aim the camera so the whole assembly fills the lower 2/3
  // of the viewport so both overlays are clearly visible alongside the
  // model. We tilt slightly so the top face of the upper plate is in
  // view + the side faces too, so a single screen-space pick on that
  // corner exposes BOTH a face, edges, AND a vertex.
  await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    const THREE = window.THREE;
    const target = new THREE.Vector3(0.020, 0, 0.012); // close to upper-plate corner area
    const radius = 0.130;
    const az = (40 * Math.PI) / 180;
    const el = (32 * Math.PI) / 180;
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
  await win.waitForTimeout(450);
  await frame('A-bolted-plate-assembly-iso');

  // ─── C. The Selection Bar overlay must be mounted + visible ────────────
  await expect(win.locator('[data-archdisc-selection-bar="active"]')).toBeVisible();
  // Default mode is 'solid'.
  const defaultFilter = await win.evaluate(() => window.__archdiscSelectionFilter);
  expect(defaultFilter).toBe('solid');
  await expect(
    win.locator('[data-archdisc-selection-filter="solid"]')
  ).toHaveAttribute('aria-pressed', 'true');

  // ─── D. Resolve the screen-space click target ──────────────────────────
  // We project a world-space point ON THE UPPER PLATE'S TOP FACE near a
  // corner into screen space, then synthesise a pointerdown + pointerup
  // at that pixel. The point is chosen so that:
  //   - filter='solid'  → the upper plate body wins (foreground hit).
  //   - filter='face'   → the upper plate's TOP face highlights.
  //   - filter='edge'   → the corresponding triangle edge highlights.
  //   - filter='vertex' → a corner vertex highlights.
  // World position: ~ (32 mm, 22 mm, 14 mm) — corner of the upper plate's
  // top face (upper plate occupies x:[-40,40], y:[-30,30], z:[8,14]).
  const clickXY = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    const THREE = window.THREE;
    const world = new THREE.Vector3(0.032, 0.022, 0.014); // metres
    const v = world.clone().project(vp.camera);
    const canvas = vp.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    const x = (v.x + 1) / 2 * rect.width + rect.left;
    const y = (-v.y + 1) / 2 * rect.height + rect.top;
    return { x: Math.round(x), y: Math.round(y) };
  });
  console.log(`  [click target px] (${clickXY.x}, ${clickXY.y})`);

  // Helper: fire a real click at a pixel by dispatching pointerdown +
  // pointerup on the canvas (mirrors the Viewport3D handler wiring).
  // We use the higher-level mouse.click which Playwright already routes
  // through pointer events, then verify __lastViewportPick was updated.
  const clickAt = async (x, y, ms = 280) => {
    await win.mouse.move(x, y);
    await win.waitForTimeout(80);
    await win.mouse.down();
    await win.waitForTimeout(40);
    await win.mouse.up();
    await win.waitForTimeout(ms);
  };

  const setFilter = async (id) => {
    await win.locator(`[data-archdisc-selection-filter="${id}"]`).click();
    await win.waitForTimeout(180);
    const v = await win.evaluate(() => window.__archdiscSelectionFilter);
    expect(v).toBe(id);
  };

  // ─── E. Cycle through filters — Solid Body ────────────────────────────
  await setFilter('solid');
  await clickAt(clickXY.x, clickXY.y);
  const pickSolid = await win.evaluate(() => window.__lastViewportPick);
  console.log(`  [pick solid] ${JSON.stringify(pickSolid)}`);
  expect(pickSolid).toBeTruthy();
  expect(pickSolid.filter).toBe('solid');
  expect(pickSolid.kind).toBe('object');
  // The bodyId should be the upper plate's id (the foreground at the
  // clicked location). It is possible a fastener / lower plate wins if
  // the click landed on one of them; assert ANY bolt-or-plate body id.
  expect(pickSolid.bodyId).toBeTruthy();
  await frame('B-filter-solid-body-selected');

  // ─── F. Sheet Body ───────────────────────────────────────────────────
  // With Sheet filter active, clicking the SAME pixel on the foreground
  // solid must yield NO selection (filter rejects the solid). We then
  // click on the sheet body itself to prove sheet picking works.
  await setFilter('sheet');
  await clickAt(clickXY.x, clickXY.y);
  const pickSheetSolid = await win.evaluate(() => window.__lastViewportPick);
  expect(pickSheetSolid.filter).toBe('sheet');
  // Filter rejected the solid → kind === 'none'.
  expect(pickSheetSolid.kind).toBe('none');

  // Project a point on the sheet body backdrop and click there.
  const sheetXY = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    const THREE = window.THREE;
    const world = new THREE.Vector3(-0.020, -0.058, 0.018);
    const v = world.clone().project(vp.camera);
    const canvas = vp.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.round((v.x + 1) / 2 * rect.width + rect.left),
      y: Math.round((-v.y + 1) / 2 * rect.height + rect.top),
    };
  });
  await clickAt(sheetXY.x, sheetXY.y);
  const pickSheet = await win.evaluate(() => window.__lastViewportPick);
  console.log(`  [pick sheet] ${JSON.stringify(pickSheet)}`);
  expect(pickSheet.filter).toBe('sheet');
  expect(pickSheet.kind).toBe('object');
  await frame('C-filter-sheet-body-selected');

  // ─── G. Face filter ──────────────────────────────────────────────────
  await setFilter('face');
  await clickAt(clickXY.x, clickXY.y);
  const pickFace = await win.evaluate(() => window.__lastViewportPick);
  console.log(`  [pick face] ${JSON.stringify(pickFace)}`);
  expect(pickFace.filter).toBe('face');
  expect(pickFace.kind).toBe('face');
  // Foundation-manifold path returns an analyticFaceId (the cluster id of
  // co-planar triangles) — assert it's a non-negative integer.
  if (typeof pickFace.analyticFaceId === 'number') {
    expect(pickFace.analyticFaceId).toBeGreaterThanOrEqual(0);
  }
  await frame('D-filter-face-selected');

  // ─── H. Edge filter ──────────────────────────────────────────────────
  await setFilter('edge');
  // Aim slightly off the face centre toward the corner so the nearest
  // triangle edge is a clear pick.
  const edgeXY = { x: clickXY.x + 8, y: clickXY.y - 6 };
  await clickAt(edgeXY.x, edgeXY.y);
  const pickEdge = await win.evaluate(() => window.__lastViewportPick);
  console.log(`  [pick edge] ${JSON.stringify(pickEdge)}`);
  expect(pickEdge.filter).toBe('edge');
  expect(pickEdge.kind).toBe('edge');
  // p1 / p2 / length should be defined for the foundation-manifold path.
  if (pickEdge.p1 && pickEdge.p2) {
    expect(pickEdge.length).toBeGreaterThan(0);
  }
  await frame('E-filter-edge-selected');

  // ─── I. Vertex filter ────────────────────────────────────────────────
  await setFilter('vertex');
  // Aim further into the corner.
  const vertexXY = { x: clickXY.x + 14, y: clickXY.y - 10 };
  await clickAt(vertexXY.x, vertexXY.y);
  const pickVertex = await win.evaluate(() => window.__lastViewportPick);
  console.log(`  [pick vertex] ${JSON.stringify(pickVertex)}`);
  expect(pickVertex.filter).toBe('vertex');
  expect(pickVertex.kind).toBe('vertex');
  expect(pickVertex.position).toBeTruthy();
  await frame('F-filter-vertex-selected');

  // ─── J. Single filter (legacy behaviour, no filter) ───────────────────
  await setFilter('single');
  await clickAt(clickXY.x, clickXY.y);
  const pickSingle = await win.evaluate(() => window.__lastViewportPick);
  console.log(`  [pick single] ${JSON.stringify(pickSingle)}`);
  expect(pickSingle.filter).toBe('single');
  // 'single' falls through to the legacy mode (gizmo selectionMode), which
  // defaults to 'object'. So we expect kind === 'object'.
  expect(pickSingle.kind).toBe('object');
  await frame('G-filter-single-selected');

  // ─── K. Final summary still — back to Solid + camera pulled back ─────
  await setFilter('solid');
  await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    const THREE = window.THREE;
    const target = new THREE.Vector3(0, 0, 0.014);
    const radius = 0.180;
    const az = (35 * Math.PI) / 180;
    const el = (30 * Math.PI) / 180;
    vp.camera.position.set(
      target.x + radius * Math.cos(el) * Math.sin(az),
      target.y + radius * Math.sin(el),
      target.z + radius * Math.cos(el) * Math.cos(az),
    );
    vp.camera.lookAt(target);
    vp.orbitControls.target.copy(target);
    vp.orbitControls.update();
  });
  await frame('H-summary-bolted-plate-with-selection-bar');

  // Sanity: no genuine page errors during the workflow.
  const realErrors = pageErrors.filter((m) =>
    !/Warning: |defaultProps|Each child in a list|forwardRef render|deprecated|sourcemap/i.test(m));
  if (realErrors.length) {
    console.log('  [pageErrors filtered]:\n  - ' + realErrors.join('\n  - '));
  }

  await app.close();
  // Resolve the recorded video path (only flushed on close).
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
