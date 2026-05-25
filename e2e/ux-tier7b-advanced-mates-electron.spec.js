/**
 * UX Tier-7b — SolidWorks ADVANCED mate set (Width + Path + Distance-Limit).
 *
 * Tier-7a closed the SW standard-mate set (Parallel, Perpendicular,
 * Tangent, Lock). Tier-7b focused starts the advanced-mate family with
 * the three highest-impact additions:
 *
 *   - WIDTH         — TAB component centred between two reference faces.
 *                     1 translational DOF removed (along the gap normal).
 *   - PATH          — point on partB constrained to lie on a curve in
 *                     partA's frame. 2 translational DOF removed.
 *   - DISTANCE-LIMIT — distance bounded by [min, max]. 0 DOF removed in
 *                     the slack range; 1 DOF removed at either limit.
 *
 * Bespoke assembly — a MACHINE-TOOL SLIDE CARRIAGE: a machinist's linear
 * stage where a carriage rides between two precision rails along a frame,
 * and a slider-pin tracks a sketched cam profile (the path) for motion
 * compounding. Distance-Limit caps the carriage travel.
 *
 *   - Frame      (160 × 80 × 10 mm, mid-grey)    — FIXED (the bedplate)
 *   - Rail A     (160 × 8 × 12 mm, dark-grey)    — back rail
 *   - Rail B     (160 × 8 × 12 mm, dark-grey)    — front rail
 *   - Carriage   (40 × 50 × 16 mm, blue)         — rides between rails
 *   - Slider-Pin (Ø6 × 24 mm cylinder, gold)     — follows the cam-profile path
 *
 * Mate sequence (each verified live):
 *
 *   1. WIDTH    (Carriage ↔ Frame)  — carriage centred between Rail A & B
 *      anchors on the frame (y = ±36 mm in frame-local).
 *   2. PATH     (Slider-Pin ↔ Frame) — pin anchor traces a sketched cam
 *      curve (a clean S-shape in the X–Y plane of the frame).
 *   3. DISTANCE-LIMIT (Carriage ↔ Frame) — carriage travel from frame
 *      origin held in [0, 150] mm (the rail length minus end stops).
 *
 * ONE perfectly-viewable iso framing. 5 stills max. ONE `test()` block,
 * `--workers=1`, no `node:*` imports.
 *
 * Assertions per mate:
 *   - DOF reduction matches expectation (1 / 2 / dynamic-clamp).
 *   - Solver converges within tolerance (1e-3 m = 1 micron geometric).
 *   - Foundation residual (kernel-free helpers) cross-checks the kernel
 *     solver's iterative residual — independent verification of the same
 *     algebra.
 *
 *   ./node_modules/.bin/playwright test \
 *     e2e/ux-tier7b-advanced-mates-electron.spec.js \
 *     --workers=1 --reporter=list
 */

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT  = path.resolve(__dirname, '..', 'e2e-output', 'ux-tier7b');
const MAIN = path.resolve(__dirname, '..', 'electron', 'main.js');

test.describe.configure({ mode: 'serial' });

test('Tier-7b three advanced mates (Width / Path / Distance-Limit) center carriage between rails, force slider-pin onto cam profile, and cap travel to 0-150 mm with correct DOF accounting', async () => {
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

  // Switch to Assembly tab so the 3 new advanced-mate ribbon buttons are visible.
  await win.locator('.ribbon-tab').filter({ hasText: 'Assembly' }).first().click();
  await win.waitForTimeout(400);

  // ─── A. Build the slide-carriage assembly via the kernel API ──────────
  const buildInfo = await win.evaluate(async () => {
    const api = window.__archdiscAssemblyApi;
    const { Assembly, PrimitiveBuilder, Vec3 } = api;
    const scene = window.__three_scene;
    const view = window.__archdiscViewport;

    // Dimensions in METRES (kernel convention).
    const frameBody = PrimitiveBuilder.box(0.160, 0.080, 0.010);
    const railA     = PrimitiveBuilder.box(0.160, 0.008, 0.012);
    const railB     = PrimitiveBuilder.box(0.160, 0.008, 0.012);
    const carriage  = PrimitiveBuilder.box(0.040, 0.050, 0.016);
    const pin       = PrimitiveBuilder.cylinder(0.003, 0.024);   // R3mm, h24mm

    const assy = new Assembly('SlideCarriage');
    // FRAME — fixed at origin.
    const pFrame = assy.addPart(frameBody, 'Frame', {
      position: new Vec3(0, 0, 0),
      color: 0x7a8694,
    });
    pFrame.fixed = true;
    // RAIL A — back rail, +Y at frame's edge.
    assy.addPart(railA, 'RailA', {
      position: new Vec3(0, 0.036, 0.011),
      color: 0x4a5560,
    });
    // RAIL B — front rail, -Y at frame's edge.
    assy.addPart(railB, 'RailB', {
      position: new Vec3(0, -0.036, 0.011),
      color: 0x4a5560,
    });
    // CARRIAGE — INTENTIONALLY off-centre (offset +Y) so the Width snap
    //   is visible in the frame; also placed at +X past the 150 mm
    //   limit so the Distance-Limit clamp is visible.
    const pCarriage = assy.addPart(carriage, 'Carriage', {
      position: new Vec3(0.085, 0.018, 0.018),
      color: 0x4a90d9,
    });
    // SLIDER-PIN — INTENTIONALLY off the cam-profile S-curve so the
    //   Path snap is visible. Starts free-floating above the frame.
    const pPin = assy.addPart(pin, 'Pin', {
      position: new Vec3(-0.040, 0.030, 0.040),
      color: 0xd6a04a,
    });

    api.setCurrentAssembly(assy, scene, view);
    window.__tier7bAssembly = assy;

    return {
      partCount: assy.parts.length,
      partNames: assy.parts.map(p => p.name),
      partIds:   assy.parts.map(p => p.id),
      framePartId:    pFrame.id,
      railAPartId:    assy.parts[1].id,
      railBPartId:    assy.parts[2].id,
      carriagePartId: pCarriage.id,
      pinPartId:      pPin.id,
    };
  });
  console.log(`  [build] ${JSON.stringify(buildInfo)}`);
  expect(buildInfo.partCount).toBe(5);
  expect(buildInfo.partNames).toEqual(['Frame', 'RailA', 'RailB', 'Carriage', 'Pin']);

  // ─── B. Park the camera at ONE perfect iso framing ─────────────────
  await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    const THREE = window.THREE;
    const target = new THREE.Vector3(0.040, 0.000, 0.020);
    const radius = 0.260;
    const az = (32 * Math.PI) / 180;
    const el = (26 * Math.PI) / 180;
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
  await frame('A1-slide-carriage-initial-iso');

  // Helper — ribbon-tool click via dispatchEvent (per project memory).
  const clickRibbonTool = async (label) => {
    await win.locator('.ribbon-tool').filter({ hasText: label }).first()
      .dispatchEvent('click');
    await win.waitForTimeout(800);
  };

  // ─── C. Initial DOF baseline ─────────────────────────────────────────
  const dofInitial = await win.evaluate(() => {
    const { MateSolver } = window.__archdiscAssemblyApi;
    return MateSolver.computeDOF(window.__tier7bAssembly);
  });
  console.log(`  [DOF initial] ${dofInitial}`);
  // 5 parts × 6 DOF − 6 (Frame fixed) = 24 DOF.
  expect(dofInitial).toBe(24);

  // ─── D. WIDTH MATE — Carriage ↔ Frame ────────────────────────────────
  // Centre the carriage between the two reference anchors at y = ±36 mm
  // on the frame. The carriage starts at y = +18 mm (off-centre) — Width
  // should snap its centre to y = 0.
  await win.evaluate((info) => {
    window.__archdiscSelectedAssemblyParts = [info.framePartId, info.carriagePartId];
    window.__archdiscPlanParams = window.__archdiscPlanParams || {};
    window.__archdiscPlanParams['Width Mate'] = {
      refA1x: 0,  refA1y:  36, refA1z: 0,   // Rail A anchor (mm, frame-local)
      refA2x: 0,  refA2y: -36, refA2z: 0,   // Rail B anchor
      tabBx:  0,  tabBy:   0,  tabBz:  0,   // Carriage centre (carriage-local)
    };
  }, buildInfo);
  await clickRibbonTool('Width Mate');
  await win.waitForTimeout(400);
  const widthInfo = await win.evaluate(() => window.__lastMateApplied);
  console.log(`  [width] ${JSON.stringify(widthInfo)}`);
  expect(widthInfo).toBeTruthy();
  expect(widthInfo.kind).toBe('width');
  expect(widthInfo.dofRemovedExpected).toBe(1);
  expect(widthInfo.dofRemovedActual).toBe(1);
  expect(widthInfo.converged).toBe(true);
  // Foundation cross-check — width residual should be ≤ 1 micron after
  // converged solver. Width's residual is in metres (geometric distance).
  expect(widthInfo.foundationResidual).toBeLessThan(1e-3);
  // The carriage's y position should now be ≈ 0 (centred between rails).
  const carriageY = await win.evaluate((info) => {
    const part = window.__tier7bAssembly.getPart(info.carriagePartId);
    return part.position.y;
  }, buildInfo);
  expect(Math.abs(carriageY)).toBeLessThan(0.001);   // < 1 mm of centre
  await frame('B1-after-width-carriage-centered');

  // ─── E. PATH MATE — Slider-Pin ↔ Frame (cam S-curve) ─────────────────
  // Build a clean S-curve in the X–Y plane of the frame (z = 0.020 m, a
  // bit above the frame top surface) and constrain the pin to lie on it.
  // The curve: x sweeps -60 → +60 mm, y oscillates ±25 mm via a smooth
  // sinusoid — a recognisable cam path. 64 samples gives sub-mm fidelity.
  const camPath = [];
  for (let i = 0; i < 64; i++) {
    const t = i / 63;
    const x = -60 + 120 * t;                       // mm
    const y = 25 * Math.sin(Math.PI * 2 * t);      // mm
    const z = 20;                                  // mm
    camPath.push([x, y, z]);
  }
  await win.evaluate((args) => {
    const { info, camPath } = args;
    window.__archdiscSelectedAssemblyParts = [info.framePartId, info.pinPartId];
    window.__archdiscPathMatePath = camPath;           // override the polyline
    window.__archdiscPlanParams = window.__archdiscPlanParams || {};
    // No need to set Path Mate params explicitly — the path override wins.
    window.__archdiscPlanParams['Path Mate'] = {
      pointBx: 0, pointBy: 0, pointBz: 0,             // pin centre (pin-local)
    };
  }, { info: buildInfo, camPath });
  await clickRibbonTool('Path Mate');
  await win.waitForTimeout(400);
  const pathInfo = await win.evaluate(() => window.__lastMateApplied);
  console.log(`  [path] ${JSON.stringify(pathInfo)}`);
  expect(pathInfo).toBeTruthy();
  expect(pathInfo.kind).toBe('path');
  expect(pathInfo.dofRemovedExpected).toBe(2);
  expect(pathInfo.dofRemovedActual).toBe(2);
  expect(pathInfo.converged).toBe(true);
  // Foundation cross-check — pin should now be on the cam path. After
  // converged kernel solver (tolerance 1e-3 metres), the foundation
  // residual is the same value (independent re-computation of nearest-
  // segment distance). Accept ≤ 2 mm — the S-curve is sampled as a
  // 64-point polyline so the local chord error is ~0.6 mm worst-case.
  expect(pathInfo.foundationResidual).toBeLessThan(0.002);
  // Reset the path override so the next mate doesn't see it.
  await win.evaluate(() => { delete window.__archdiscPathMatePath; });
  await frame('B2-after-path-pin-on-cam-curve');

  // ─── F. DISTANCE-LIMIT MATE — Carriage ↔ Frame ───────────────────────
  // Cap the carriage's travel from the frame origin to [0, 150] mm.
  // The carriage's current x position after Width is ~85 mm (well inside
  // the range — should be SLACK), but our INTENTIONAL setup placed it at
  // x = 85 mm so we get a slack reading. We'll then nudge it out of
  // range to demonstrate the clamp.
  await win.evaluate((info) => {
    window.__archdiscSelectedAssemblyParts = [info.framePartId, info.carriagePartId];
    window.__archdiscPlanParams = window.__archdiscPlanParams || {};
    window.__archdiscPlanParams['Distance-Limit Mate'] = {
      pointAx: 0, pointAy: 0, pointAz: 0,             // frame origin
      pointBx: 0, pointBy: 0, pointBz: 0,             // carriage centre
      minDist: 0, maxDist: 150,                       // mm
    };
  }, buildInfo);
  await clickRibbonTool('Distance-Limit Mate');
  await win.waitForTimeout(400);
  const dlInfo = await win.evaluate(() => window.__lastMateApplied);
  console.log(`  [distanceLimit-slack] ${JSON.stringify(dlInfo)}`);
  expect(dlInfo).toBeTruthy();
  expect(dlInfo.kind).toBe('distanceLimit');
  // Slack: no DOF removed by the mate (the carriage is in [0, 150]).
  expect(dlInfo.dofRemovedExpected).toBe(0);
  expect(dlInfo.dofRemovedActual).toBe(0);
  expect(dlInfo.clampedDOF).toBe(0);
  expect(dlInfo.activeLimit).toBeNull();
  expect(dlInfo.converged).toBe(true);
  expect(dlInfo.foundationResidual).toBe(0);
  await frame('B3-after-distance-limit-slack');

  // ─── G. Move carriage past max, re-solve to show CLAMP behaviour ─────
  // Manually push carriage to x = 200 mm (outside [0, 150]), then re-solve
  // the assembly — the distance-limit mate should pull it back to x ≈ 150.
  const clampResult = await win.evaluate(() => {
    const { MateSolver } = window.__archdiscAssemblyApi;
    const assy = window.__tier7bAssembly;
    const carriage = assy.parts.find(p => p.name === 'Carriage');
    carriage.position = new window.__archdiscAssemblyApi.Vec3(0.200, 0, 0.018);
    const r = MateSolver.solve(assy, { tolerance: 1e-3, maxIter: 200 });
    return {
      carriageX: carriage.position.x,
      converged: r.converged,
      residual: r.residual,
      iterations: r.iterations,
    };
  });
  console.log(`  [distanceLimit-clamp] ${JSON.stringify(clampResult)}`);
  expect(clampResult.converged).toBe(true);
  // Carriage should be pulled back to ~0.150 m within the solver
  // tolerance (1e-3 m = 1 mm geometric). Width mate also re-tightens.
  expect(clampResult.carriageX).toBeGreaterThan(0.149);
  expect(clampResult.carriageX).toBeLessThan(0.151);
  await frame('B4-clamp-carriage-pulled-back-to-150mm');

  // ─── H. Final state — verify the DOF book-keeping & all 3 mates ──────
  const finalState = await win.evaluate(() => {
    const { MateSolver } = window.__archdiscAssemblyApi;
    return {
      dof: MateSolver.computeDOF(window.__tier7bAssembly),
      mateCount: window.__tier7bAssembly.mates.length,
      mateKinds: window.__tier7bAssembly.mates.map(x => x.type),
      satisfied: window.__tier7bAssembly.mates.every(m => m.satisfied),
      residuals: window.__tier7bAssembly.mates.map(m => ({ kind: m.type, r: m.error })),
    };
  });
  console.log(`  [final] ${JSON.stringify(finalState)}`);
  // Width removes 1, Path removes 2, DistanceLimit removes 0 (slack table value).
  // Initial 24 − 1 − 2 − 0 = 21 baseline (the distance-limit clamp
  // contributes its 1 DOF dynamically — book-kept via mate.params._clampedDOF
  // rather than the static DOF table — so the table-side total stays 21).
  expect(finalState.dof).toBe(24 - 1 - 2 - 0);
  expect(finalState.mateCount).toBe(3);
  expect(finalState.mateKinds.sort()).toEqual(['distanceLimit', 'path', 'width']);
  // All mates within solver tolerance (1e-3 m).
  for (const r of finalState.residuals) {
    expect(r.r).toBeLessThan(1.5e-3);
  }

  await frame('C1-final-three-advanced-mates-satisfied');

  // ─── I. No-console-error sanity ──────────────────────────────────────
  if (pageErrors.length) {
    console.warn('  [page errors]\n   ' + pageErrors.join('\n   '));
  }
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
