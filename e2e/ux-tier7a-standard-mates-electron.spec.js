/**
 * UX Tier-7a — SolidWorks standard-mate set completion, in motion.
 *
 * The four NEW standard mates shipped this dispatch (Parallel,
 * Perpendicular, Tangent, Lock) take ArchDisc's assembly mate vocabulary
 * from 4 (Coincident/Distance/Concentric/Angle) to all 8 SW standard
 * mates. This e2e drives every new mate in flow on a SINGLE real
 * engineered assembly so the motion-capture stills show the assembly
 * SNAPPING into the constrained pose as each mate is applied.
 *
 * Assembly — a real fixture-jig mechanism:
 *
 *   - Base plate (80 × 60 × 8 mm, mid-grey)      — fixed to ground
 *   - Pin       (Ø6 × 30 mm cylinder, gold)      — projects up from base
 *   - Bracket   (40 × 20 × 8 mm, blue)           — sits on the base
 *   - Lever     (50 × 8 × 8 mm, red)             — pivots about the pin
 *   - Cap       (Ø10 × 4 mm puck, green)         — rides tangent to the pin
 *
 * Each mate is exercised on a real component pair:
 *
 *   - LOCK         (Pin ↔ Base):    rigidly attach the pin to the base —
 *                                   removes all 6 DOF, the pin can no longer
 *                                   move independently of the base.
 *   - PARALLEL     (Bracket ↔ Base): the bracket's local Z-axis becomes
 *                                   parallel to the base's Z-axis (its
 *                                   bottom face stays parallel to the
 *                                   base's top face — 2 rotational DOF).
 *   - PERPENDICULAR (Lever ↔ Base): the lever's long axis is forced
 *                                   perpendicular to the base's Z-axis
 *                                   (the lever lies horizontally — 1
 *                                   rotational DOF).
 *   - TANGENT      (Cap ↔ Pin):     the cap's anchor touches the pin's
 *                                   cylindrical surface at radius R (1
 *                                   translational DOF — the cap kisses the
 *                                   pin tangentially).
 *
 * ONE perfectly-viewable iso framing. NO 7-angle orbit. 5 stills — one per
 * mate + one final assembly state — plus a session video. ONE `test()`,
 * `--workers=1`, no `node:*` imports.
 *
 *   ./node_modules/.bin/playwright test \
 *     e2e/ux-tier7a-standard-mates-electron.spec.js \
 *     --workers=1 --reporter=list
 */

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT  = path.resolve(__dirname, '..', 'e2e-output', 'ux-tier7a');
const MAIN = path.resolve(__dirname, '..', 'electron', 'main.js');

test.describe.configure({ mode: 'serial' });

test('Tier-7a four standard mates (Parallel / Perpendicular / Tangent / Lock) snap a fixture-jig assembly into position with correct DOF accounting', async () => {
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
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscAssemblyApi, null, { timeout: 60000 });

  // Bypass the param dialog — mate handlers will use schema defaults via
  // the navigator.webdriver path. We rely on the schema defaults
  // intentionally: Parallel/Perpendicular default Z-axis (matches our
  // component orientation), Tangent radius defaults 10 mm (we set the
  // proper value below via the planParams override).
  await win.evaluate(() => {
    window.__archdiscBypassDialog = true;
  });

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

  // Switch to the Assembly tab so the new mate ribbon buttons are visible.
  await win.locator('.ribbon-tab').filter({ hasText: 'Assembly' }).first().click();
  await win.waitForTimeout(400);

  // ─── A. Build the fixture-jig assembly directly via the kernel API ───
  //
  // We can't go through `Insert Component` repeatedly (it shares one
  // active solid and adds random offsets); instead we construct the
  // kernel Assembly directly with PrimitiveBuilder, then render it.
  // The kernel Assembly object is the same one MateSolver operates on,
  // and the same one ribbon mate handlers see via `_currentAssembly`.

  const buildInfo = await win.evaluate(async () => {
    const api = window.__archdiscAssemblyApi;
    const { Assembly, PrimitiveBuilder, Vec3 } = api;
    const scene = window.__three_scene;
    const view = window.__archdiscViewport;

    // Build the parts: dimensions in METRES (kernel convention).
    const base    = PrimitiveBuilder.box(0.080, 0.060, 0.008);
    const pin     = PrimitiveBuilder.cylinder(0.003, 0.030);   // R3mm, h30mm
    const bracket = PrimitiveBuilder.box(0.040, 0.020, 0.008);
    const lever   = PrimitiveBuilder.box(0.050, 0.008, 0.008);
    const cap     = PrimitiveBuilder.cylinder(0.005, 0.004);   // R5mm, h4mm

    const assy = new Assembly('FixtureJig');
    const pBase    = assy.addPart(base,    'Base',    { position: new Vec3( 0,       0,     0),
                                                         color: 0x7a8694 });
    // The Pin is INTENTIONALLY mis-placed (not centred on the base) so the
    // Lock-mate-snap is visible in the frame. We'll lock it to the base
    // at its current relative offset.
    const pPin     = assy.addPart(pin,     'Pin',     { position: new Vec3( 0.025,   0.020, 0.008),
                                                         color: 0xd6a04a });
    // Bracket is rotated slightly off-axis so Parallel snap is visible.
    const pBracket = assy.addPart(bracket, 'Bracket', { position: new Vec3(-0.020,   0,     0.008),
                                                         rotation: new Vec3(0.45, 0.20, 0),
                                                         color: 0x4a90d9 });
    // Lever is rotated so its long axis is ALMOST aligned with Z (parallel
    // to base normal); Perpendicular mate will force it to lie perpendicular
    // to Z (i.e. lie flat).
    const pLever   = assy.addPart(lever,   'Lever',   { position: new Vec3( 0.005,  -0.012, 0.030),
                                                         rotation: new Vec3(0, 1.40, 0),
                                                         color: 0xc14d4d });
    // Cap starts slightly outside tangent-distance to the pin.
    const pCap     = assy.addPart(cap,     'Cap',     { position: new Vec3( 0.045,   0.020, 0.025),
                                                         color: 0x4eb04e });
    pBase.fixed = true;

    // Plant the assembly into the engine's `_currentAssembly` slot, then
    // re-render through the bridge — the mate handlers operate on that
    // slot, so this is the canonical install path.
    api.setCurrentAssembly(assy, scene, view);

    window.__tier7aAssembly = assy;
    return {
      partCount: assy.parts.length,
      partNames: assy.parts.map(p => p.name),
      partIds:   assy.parts.map(p => p.id),
      basePartId: pBase.id,
      pinPartId: pPin.id,
      bracketPartId: pBracket.id,
      leverPartId: pLever.id,
      capPartId: pCap.id,
    };
  });
  console.log(`  [build] ${JSON.stringify(buildInfo)}`);
  expect(buildInfo.partCount).toBe(5);
  expect(buildInfo.partNames).toEqual(['Base', 'Pin', 'Bracket', 'Lever', 'Cap']);

  // ─── B. Park the camera at ONE perfect iso framing ─────────────────
  await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    const THREE = window.THREE;
    const target = new THREE.Vector3(0.010, 0.005, 0.020);
    const radius = 0.180;
    const az = (35 * Math.PI) / 180;
    const el = (28 * Math.PI) / 180;
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
  await frame('A1-fixture-jig-initial-iso');

  // ─── C. Helper — find a ribbon-tool button by label and click it ─────
  // We use dispatchEvent('click') because the ribbon is in a scrollable
  // container that intercepts real Playwright clicks (per project memory).
  const clickRibbonTool = async (label) => {
    await win.locator('.ribbon-tool').filter({ hasText: label }).first()
      .dispatchEvent('click');
    await win.waitForTimeout(800);
  };

  // ─── D. Initial DOF baseline ─────────────────────────────────────────
  const dofInitial = await win.evaluate(() => {
    const { MateSolver } = window.__archdiscAssemblyApi;
    return MateSolver.computeDOF(window.__tier7aAssembly);
  });
  console.log(`  [DOF initial] ${dofInitial}`);
  // 5 parts × 6 DOF − 6 (Base fixed) = 24 DOF.
  expect(dofInitial).toBe(24);

  // ─── E. LOCK MATE — Pin ↔ Base ─────────────────────────────────────
  // Selection: Pin (idx 1) ↔ Base (idx 0). Order matters: the handler
  // uses partA, partB from the selection — Base must be in the pair so
  // the lock binds the pin to the FIXED base.
  await win.evaluate((info) => {
    window.__archdiscSelectedAssemblyParts = [info.basePartId, info.pinPartId];
  }, buildInfo);
  await clickRibbonTool('Lock Mate');
  await win.waitForTimeout(400);
  const lockInfo = await win.evaluate(() => window.__lastMateApplied);
  console.log(`  [lock] ${JSON.stringify(lockInfo)}`);
  expect(lockInfo).toBeTruthy();
  expect(lockInfo.kind).toBe('lock');
  expect(lockInfo.dofRemovedExpected).toBe(6);
  expect(lockInfo.dofRemovedActual).toBe(6);
  expect(lockInfo.converged).toBe(true);
  await frame('B1-after-lock-pin-rigid-to-base');

  // ─── F. PARALLEL MATE — Bracket ↔ Base ───────────────────────────────
  // The bracket is rotated to (0.45, 0.20, 0) — its local Z-axis points
  // off-vertical. Parallel-to-base-Z should snap its local Z onto world Z.
  await win.evaluate((info) => {
    window.__archdiscSelectedAssemblyParts = [info.basePartId, info.bracketPartId];
  }, buildInfo);
  await clickRibbonTool('Parallel Mate');
  await win.waitForTimeout(400);
  const parallelInfo = await win.evaluate(() => window.__lastMateApplied);
  console.log(`  [parallel] ${JSON.stringify(parallelInfo)}`);
  expect(parallelInfo).toBeTruthy();
  expect(parallelInfo.kind).toBe('parallel');
  expect(parallelInfo.dofRemovedExpected).toBe(2);
  expect(parallelInfo.dofRemovedActual).toBe(2);
  expect(parallelInfo.converged).toBe(true);
  // Foundation cross-check: parallel residual must be small. The kernel
  // MateSolver is an iterative point-relaxation solver with
  // RELAXATION=0.5; we accept residual ≲ 1e-2 (a tenth of a degree off
  // parallel — visually indistinguishable from perfect parallelism).
  expect(parallelInfo.foundationResidual).toBeLessThan(0.01);
  await frame('B2-after-parallel-bracket-snaps-flat');

  // ─── G. PERPENDICULAR MATE — Lever ↔ Base ────────────────────────────
  // The lever starts with rotation.y = 1.40 (almost +Z aligned). The
  // perpendicular mate enforces its local Z is perpendicular to the
  // base's Z — i.e. the lever's local Z must lie in the world XY plane.
  await win.evaluate((info) => {
    window.__archdiscSelectedAssemblyParts = [info.basePartId, info.leverPartId];
  }, buildInfo);
  await clickRibbonTool('Perpendicular Mate');
  await win.waitForTimeout(400);
  const perpInfo = await win.evaluate(() => window.__lastMateApplied);
  console.log(`  [perpendicular] ${JSON.stringify(perpInfo)}`);
  expect(perpInfo).toBeTruthy();
  expect(perpInfo.kind).toBe('perpendicular');
  expect(perpInfo.dofRemovedExpected).toBe(1);
  expect(perpInfo.dofRemovedActual).toBe(1);
  expect(perpInfo.converged).toBe(true);
  expect(perpInfo.foundationResidual).toBeLessThan(0.01);
  await frame('B3-after-perpendicular-lever-lies-flat');

  // ─── H. TANGENT MATE — Cap ↔ Pin ─────────────────────────────────────
  // The cap is at world (0.045, 0.020, 0.025) and the pin's axis runs
  // along local Z from (0, 0, 0) in pin-frame, world-anchored at
  // (0.025, 0.020, 0.008). After Lock above, the pin's pose is fixed.
  // We feed the dialog the pin-axis-origin in pin-local frame (0,0,0),
  // pin-axis-dir Z (0,0,1), cap anchor at (0,0,0) in cap-local frame,
  // and pin radius 3 mm. The cap should slide to where its centre is
  // exactly 3 mm from the pin axis — currently it's ~20 mm away.
  await win.evaluate((info) => {
    window.__archdiscSelectedAssemblyParts = [info.pinPartId, info.capPartId];
    // Override the schema defaults via planParams so the radius matches
    // the real pin (3 mm rather than the schema default of 10 mm).
    window.__archdiscPlanParams = window.__archdiscPlanParams || {};
    window.__archdiscPlanParams['Tangent Mate'] = {
      axisOriginX: 0, axisOriginY: 0, axisOriginZ: 0,
      axisDirX: 0, axisDirY: 0, axisDirZ: 1,
      pointBx: 0, pointBy: 0, pointBz: 0,
      radius: 3,
    };
  }, buildInfo);
  await clickRibbonTool('Tangent Mate');
  await win.waitForTimeout(400);
  const tanInfo = await win.evaluate(() => window.__lastMateApplied);
  console.log(`  [tangent] ${JSON.stringify(tanInfo)}`);
  expect(tanInfo).toBeTruthy();
  expect(tanInfo.kind).toBe('tangent');
  expect(tanInfo.dofRemovedExpected).toBe(1);
  expect(tanInfo.dofRemovedActual).toBe(1);
  expect(tanInfo.converged).toBe(true);
  // Foundation cross-check: cap should now be tangent to the pin — within
  // 0.5 mm of the cylinder surface (radius 3 mm in metres = 0.003). The
  // kernel MateSolver's RELAXATION=0.5 + tolerance=1e-3 yields sub-mm
  // tangent accuracy on the first solve; subsequent solves converge
  // further as more mates are added. Honest gap: tighter tolerance would
  // need the foundation/AssemblyMate Levenberg-Marquardt solver.
  expect(tanInfo.foundationResidual).toBeLessThan(0.0005);
  await frame('B4-after-tangent-cap-kisses-pin');

  // ─── I. Final assembly state — DOF should be 24 − (6+2+1+1) = 14 ─────
  const dofFinal = await win.evaluate(() => {
    const { MateSolver } = window.__archdiscAssemblyApi;
    return {
      dof: MateSolver.computeDOF(window.__tier7aAssembly),
      mateCount: window.__tier7aAssembly.mates.length,
      mateKinds: window.__tier7aAssembly.mates.map(x => x.type),
    };
  });
  console.log(`  [DOF final] ${JSON.stringify(dofFinal)}`);
  expect(dofFinal.dof).toBe(24 - 6 - 2 - 1 - 1);
  expect(dofFinal.mateCount).toBe(4);
  expect(dofFinal.mateKinds.sort()).toEqual(['lock', 'parallel', 'perpendicular', 'tangent']);

  await frame('C1-final-fully-mated-assembly');

  // ─── J. Honest no-console-error check ──────────────────────────────
  if (pageErrors.length) {
    console.warn('  [page errors]\n   ' + pageErrors.join('\n   '));
  }
  // Only fail on errors that look like real JS faults from OUR new code.
  // Pre-existing / environmental noise: Health check (backend offline in
  // test), THREE.Object3D add warning (foundation manifold/AssemblyBridge
  // pre-existing — fires on every build), ERR_FILE_NOT_FOUND on optional
  // assets (Cesium / health-check stubs), favicon.ico, devtools-extension.
  const realErrors = pageErrors.filter(e =>
    !e.toLowerCase().includes('warning') &&
    !e.toLowerCase().includes('chrome-extension') &&
    !e.toLowerCase().includes('devtools') &&
    !e.toLowerCase().includes('health check') &&
    !e.toLowerCase().includes('net::err_file_not_found') &&
    !e.toLowerCase().includes('three.object3d.add') &&
    !e.toLowerCase().includes('axioserror') &&
    !e.toLowerCase().includes('network error') &&
    !e.toLowerCase().includes('favicon')
  );
  expect(realErrors).toEqual([]);

  await app.close();
});
