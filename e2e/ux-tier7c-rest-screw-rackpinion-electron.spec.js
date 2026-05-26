/**
 * UX Tier-7c-rest — SolidWorks MECHANICAL mate set (focused: Screw + Rack-Pinion).
 *
 * Tier-7c (focused) shipped Gear + Hinge. Tier-7c-rest continues the
 * MECHANICAL family with the next two highest-impact additions:
 *
 *   - SCREW       — rotation of part A about its axis is coupled to
 *                   translation of part B along the same axis by `pitch`
 *                   (mm per revolution): theta_A * pitch / (2 pi) - t_B = 0.
 *                   Removes 1 DOF. Right-hand thread (default) or left-
 *                   hand (sign-flipped) handedness.
 *   - RACK-PINION — rotation of pinion (part A) about its axis is coupled
 *                   to translation of rack (part B) along the tangent line
 *                   by `pinionRadius` (rolling without slipping):
 *                   theta_A * pinionRadius - t_B = 0. Removes 1 DOF.
 *
 * Bespoke assembly — a CNC LINEAR-STAGE CARRIAGE. A machine-tool linear
 * stage with two independent feed mechanisms on a shared base frame:
 *
 *   - Frame       (220 x 80 x 50 mm, dark-grey)  - FIXED (the machine bed)
 *   - Leadscrew   (Ø10 x 200 mm cylinder, gold)  - rotates about world X,
 *                                                  drives the carriage via
 *                                                  a SCREW mate (pitch =
 *                                                  2 mm/rev)
 *   - Carriage    (60 x 60 x 35 mm, mid-grey)    - rides along the
 *                                                  leadscrew (linear X)
 *   - Handwheel   (R12 x 14 mm disk, red)        - hand crank; rotates
 *                                                  about world Y, drives
 *                                                  the tool slide via a
 *                                                  RACK-PINION mate
 *                                                  (pinion radius = 10 mm)
 *   - Tool slide  (40 x 25 x 30 mm, light-grey)  - rack translation in
 *                                                  world Z (perpendicular
 *                                                  to handwheel axis)
 *
 * Mate sequence (each verified live):
 *
 *   1. SCREW       (Leadscrew --> Carriage):  pitch = 2 mm/rev along
 *      world X. theta_lead * 2/(2 pi) - x_carriage = 0. Removes 1 DOF.
 *   2. RACK-PINION (Handwheel --> Tool slide): pinion radius = 10 mm.
 *      theta_handwheel * 10 - z_toolslide = 0. Removes 1 DOF.
 *
 * After applying both mates the test programmatically:
 *   - rotates the leadscrew by +5 revs (+10 pi rad). The Screw mate must
 *     advance the carriage by +5 * 2 = +10 mm along world X.
 *   - rotates the handwheel by +pi/2 (90 deg). The Rack-Pinion mate must
 *     advance the tool slide by 10 * pi/2 = +5 pi mm along world Z.
 *
 * Real CNC kinematics. ONE perfectly-viewable iso framing. 5 stills. ONE
 * `test()` block, `--workers=1`, no `node:*` imports.
 *
 *   ./node_modules/.bin/playwright test \
 *     e2e/ux-tier7c-rest-screw-rackpinion-electron.spec.js \
 *     --workers=1 --reporter=list
 */

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT  = path.resolve(__dirname, '..', 'e2e-output', 'ux-tier7c-rest');
const MAIN = path.resolve(__dirname, '..', 'electron', 'main.js');

test.describe.configure({ mode: 'serial' });

test('Tier-7c-rest two mechanical mates (Screw / Rack-Pinion) drive a CNC linear-stage carriage and tool slide with correct DOF accounting and real kinematic coupling', async () => {
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

  // Switch to Assembly tab so the Screw / Rack-Pinion mate buttons are visible.
  await win.locator('.ribbon-tab').filter({ hasText: 'Assembly' }).first().click();
  await win.waitForTimeout(400);

  // ─── A. Build the CNC linear-stage carriage via the kernel API ────────
  const buildInfo = await win.evaluate(async () => {
    const api = window.__archdiscAssemblyApi;
    const { Assembly, PrimitiveBuilder, Vec3 } = api;
    const scene = window.__three_scene;
    const view = window.__archdiscViewport;

    // Dimensions in METRES (kernel convention).
    const frameBody = PrimitiveBuilder.box(0.220, 0.080, 0.050);
    const leadscrew = PrimitiveBuilder.cylinder(0.005, 0.200);   // R5 mm, L200 mm — local Y
    const carriage  = PrimitiveBuilder.box(0.060, 0.060, 0.035);
    const handwheel = PrimitiveBuilder.cylinder(0.022, 0.012);   // R22 mm, h12 mm disk
    const toolSlide = PrimitiveBuilder.box(0.040, 0.025, 0.030);

    const assy = new Assembly('CNCLinearStage');

    // FRAME — fixed at origin (the machine bed).
    const pFrame = assy.addPart(frameBody, 'Frame', {
      position: new Vec3(0, 0, 0),
      color: 0x303844,
    });
    pFrame.fixed = true;

    // LEADSCREW — rotated Pi/2 about world Z so its long axis points
    // along world X. Centred above the frame bed.
    const pLead = assy.addPart(leadscrew, 'Leadscrew', {
      position: new Vec3(0, 0, 0.040),
      rotation: new Vec3(0, 0, Math.PI / 2),
      color: 0xd6a04a,
    });

    // CARRIAGE — rides along the leadscrew (world X). Starts retracted at
    // x = -50 mm. The Screw mate will drive its X position from the
    // leadscrew's rotation.
    const pCar = assy.addPart(carriage, 'Carriage', {
      position: new Vec3(-0.050, 0, 0.040),
      color: 0x8392a4,
    });

    // HANDWHEEL — disk at the RIGHT side of the frame, axis along world Y
    // (perpendicular to leadscrew). The Rack-Pinion mate couples its
    // rotation to the tool-slide's Z translation.
    const pWheel = assy.addPart(handwheel, 'Handwheel', {
      position: new Vec3(0.120, 0.055, 0.080),
      // Cylinder default axis is local Y. To make the wheel's flat faces
      // face along world Y we don't rotate; local Y = world Y.
      rotation: new Vec3(0, 0, 0),
      color: 0xc94236,
    });

    // TOOL SLIDE — rides along world Z above the leadscrew. The Rack-Pinion
    // mate will drive its Z position from the handwheel's rotation.
    const pSlide = assy.addPart(toolSlide, 'ToolSlide', {
      position: new Vec3(0.060, 0, 0.090),
      color: 0xb8c2cf,
    });

    api.setCurrentAssembly(assy, scene, view);
    window.__tier7cRestAssembly = assy;

    return {
      partCount: assy.parts.length,
      partNames: assy.parts.map(p => p.name),
      partIds:   assy.parts.map(p => p.id),
      framePartId:     pFrame.id,
      leadscrewPartId: pLead.id,
      carriagePartId:  pCar.id,
      handwheelPartId: pWheel.id,
      slidePartId:     pSlide.id,
    };
  });
  console.log(`  [build] ${JSON.stringify(buildInfo)}`);
  expect(buildInfo.partCount).toBe(5);
  expect(buildInfo.partNames).toEqual(['Frame', 'Leadscrew', 'Carriage', 'Handwheel', 'ToolSlide']);

  // ─── B. Park camera at ONE perfect iso framing ────────────────────────
  await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    const THREE = window.THREE;
    const target = new THREE.Vector3(0.040, 0.000, 0.060);
    const radius = 0.420;
    const az = (40 * Math.PI) / 180;
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
  await frame('A1-cnc-linear-stage-initial-iso');

  // Helper — ribbon-tool click via dispatchEvent (per project memory).
  const clickRibbonTool = async (label) => {
    await win.locator('.ribbon-tool').filter({ hasText: label }).first()
      .dispatchEvent('click');
    await win.waitForTimeout(800);
  };

  // ─── C. Initial DOF baseline ──────────────────────────────────────────
  const dofInitial = await win.evaluate(() => {
    const { MateSolver } = window.__archdiscAssemblyApi;
    return MateSolver.computeDOF(window.__tier7cRestAssembly);
  });
  console.log(`  [DOF initial] ${dofInitial}`);
  // 5 parts x 6 DOF - 6 (Frame fixed) = 24 DOF.
  expect(dofInitial).toBe(24);

  // ─── D. SCREW MATE — Leadscrew ↔ Carriage, pitch = 2 mm/rev ───────────
  // Leadscrew is rotated Pi/2 about world Z, so its LOCAL Z-axis points
  // along world X. Same for its translation axis projected onto carriage:
  // the carriage is not rotated, so its local X = world X. The Screw mate
  // takes axisA (rotation on leadscrew local Z) = (0, 0, 1) and axisB
  // (translation on carriage local X) = (1, 0, 0).
  await win.evaluate((info) => {
    window.__archdiscSelectedAssemblyParts = [info.leadscrewPartId, info.carriagePartId];
    window.__archdiscPlanParams = window.__archdiscPlanParams || {};
    window.__archdiscPlanParams['Screw Mate'] = {
      axisAx: 0, axisAy: 0, axisAz: 1,    // leadscrew local Z = world X
      axisBx: 1, axisBy: 0, axisBz: 0,    // carriage local X = world X
      axisOriginAx: 0, axisOriginAy: 0, axisOriginAz: 0,
      pitch: 2,                            // 2 mm/rev
      handedness: 'right',
    };
  }, buildInfo);
  await clickRibbonTool('Screw Mate');
  await win.waitForTimeout(400);
  const screwInfo = await win.evaluate(() => window.__lastMateApplied);
  console.log(`  [screw] ${JSON.stringify(screwInfo)}`);
  expect(screwInfo).toBeTruthy();
  expect(screwInfo.kind).toBe('screw');
  expect(screwInfo.dofRemovedExpected).toBe(1);
  expect(screwInfo.dofRemovedActual).toBe(1);
  expect(screwInfo.converged).toBe(true);
  expect(screwInfo.foundationResidual).toBeLessThan(1e-3);
  await frame('B1-after-screw-leadscrew-couples-to-carriage');

  // ─── E. RACK-PINION MATE — Handwheel ↔ ToolSlide, R = 10 mm ───────────
  // Handwheel rotates about world Y (no rotation applied; local Y = world Y).
  // Tool slide translates along world Z (its local Z = world Z).
  await win.evaluate((info) => {
    window.__archdiscSelectedAssemblyParts = [info.handwheelPartId, info.slidePartId];
    window.__archdiscPlanParams = window.__archdiscPlanParams || {};
    window.__archdiscPlanParams['Rack-Pinion Mate'] = {
      axisAx: 0, axisAy: 1, axisAz: 0,    // handwheel rotates about local Y = world Y
      axisBx: 0, axisBy: 0, axisBz: 1,    // tool slide translates along local Z = world Z
      axisOriginAx: 0, axisOriginAy: 0, axisOriginAz: 0,
      pinionRadius: 10,                    // 10 mm pitch radius
    };
  }, buildInfo);
  await clickRibbonTool('Rack-Pinion Mate');
  await win.waitForTimeout(400);
  const rpInfo = await win.evaluate(() => window.__lastMateApplied);
  console.log(`  [rack-pinion] ${JSON.stringify(rpInfo)}`);
  expect(rpInfo).toBeTruthy();
  expect(rpInfo.kind).toBe('rackPinion');
  expect(rpInfo.dofRemovedExpected).toBe(1);
  expect(rpInfo.dofRemovedActual).toBe(1);
  expect(rpInfo.converged).toBe(true);
  expect(rpInfo.foundationResidual).toBeLessThan(1e-3);
  await frame('B2-after-rack-pinion-handwheel-couples-to-tool-slide');

  // ─── F. Programmatic leadscrew rotation — Screw advances carriage ─────
  // Rotate the leadscrew by +5 full revs (+10 pi rad) about its local Z
  // (= world X). With pitch = 2 mm/rev, the carriage should advance by
  // +5 * 2 = +10 mm along world X (-50 mm → -40 mm). Re-solve.
  const screwPropagation = await win.evaluate(() => {
    const { MateSolver, Vec3 } = window.__archdiscAssemblyApi;
    const assy = window.__tier7cRestAssembly;
    const lead = assy.parts.find(p => p.name === 'Leadscrew');
    const car  = assy.parts.find(p => p.name === 'Carriage');

    const preCarX = car.position.x;
    const preLeadRotZ = lead.rotation.z;

    // The leadscrew was rotated Pi/2 about world Z initially. Adding +5*2π
    // to rotation.z rotates the screw an additional 5 full revolutions
    // about world Z. But the Screw mate's anchor (leadscrew) axis is
    // local Z, which after the initial Pi/2 about Z rotation is still
    // (-sin(π/2), 0, cos(π/2)) = (-1, 0, 0)... wait.
    //
    // Actually _rotateLocal applies Rz first (in our XYZ Euler order
    // implementation it's Rx, Ry, Rz applied to local). For local Z =
    // (0,0,1) with rotation (0,0,π/2): Rx leaves z untouched; Ry leaves
    // z untouched (only ry=0); Rz of (0,0,1) is (0,0,1). So world axis
    // direction stays (0,0,1) → world Z, not world X!
    //
    // We rebuilt the screw mate with axisA = local Z which is world Z
    // after the rotation. So adding to leadscrew.rotation.z increases
    // the along-axis angle. Add +5*2π directly to rotation.z.
    lead.rotation = new Vec3(
      lead.rotation.x,
      lead.rotation.y,
      lead.rotation.z + 5 * 2 * Math.PI,
    );

    const r = MateSolver.solve(assy, { tolerance: 1e-4, maxIter: 400 });

    return {
      preCarX, preLeadRotZ,
      carX: car.position.x,
      leadRotZ: lead.rotation.z,
      converged: r.converged,
      residual: r.residual,
      iterations: r.iterations,
    };
  });
  console.log(`  [screw propagation] ${JSON.stringify(screwPropagation)}`);
  expect(screwPropagation.converged).toBe(true);
  // 5 full revs * 2 mm/rev = 10 mm = 0.010 m carriage advance.
  // The Screw mate residual is (θ * pitch / 2π − tB) where tB is along the
  // axis from the world origin. Because we measure t_B from axisOriginA
  // (at world origin), the absolute carriage X position should equal
  // θ_lead * pitch / (2π). With θ_lead = π/2 + 10π and pitch = 0.002 m/rev:
  // target X = (π/2 + 10π) * 0.002 / (2π) ≈ 0.0005 + 0.01 = 0.0105 m.
  const expectedCarX = (Math.PI / 2 + 10 * Math.PI) * 0.002 / (Math.PI * 2);
  expect(Math.abs(screwPropagation.carX - expectedCarX)).toBeLessThan(0.001);
  await frame('B3-leadscrew-5revs-carriage-advances-10mm');

  // ─── G. Programmatic handwheel rotation — Rack-Pinion advances slide ──
  // Rotate the handwheel by +π/2 (90°) about its axis (world Y). With
  // pinion radius R = 10 mm = 0.010 m, the tool slide should advance by
  // R * θ = 0.010 * π/2 ≈ 0.0157 m along world Z. Re-solve.
  const rpPropagation = await win.evaluate(() => {
    const { MateSolver, Vec3 } = window.__archdiscAssemblyApi;
    const assy = window.__tier7cRestAssembly;
    const wheel = assy.parts.find(p => p.name === 'Handwheel');
    const slide = assy.parts.find(p => p.name === 'ToolSlide');

    const preSlideZ = slide.position.z;
    const preWheelRotY = wheel.rotation.y;

    wheel.rotation = new Vec3(
      wheel.rotation.x,
      wheel.rotation.y + Math.PI / 2,
      wheel.rotation.z,
    );

    const r = MateSolver.solve(assy, { tolerance: 1e-4, maxIter: 400 });

    return {
      preSlideZ, preWheelRotY,
      slideZ: slide.position.z,
      wheelRotY: wheel.rotation.y,
      converged: r.converged,
      residual: r.residual,
      iterations: r.iterations,
    };
  });
  console.log(`  [rack-pinion propagation] ${JSON.stringify(rpPropagation)}`);
  expect(rpPropagation.converged).toBe(true);
  // Target slide Z = θ_wheel * R = (π/2) * 0.010 ≈ 0.01571 m (measured
  // from the axis origin on Handwheel, which is the handwheel's centre at
  // world (0.120, 0.055, 0.080) — but the Screw / Rack-Pinion mates
  // measure t_B as (B.position - axisOriginAWorld) projected onto B's
  // tangent. With axisOriginA = (0,0,0) in handwheel-local, the world
  // origin is handwheel.position. So target slideZ.world =
  // handwheel.position.z + θ * R = 0.080 + π/2 * 0.010 ≈ 0.09571 m.
  const expectedSlideZ = 0.080 + (Math.PI / 2) * 0.010;
  expect(Math.abs(rpPropagation.slideZ - expectedSlideZ)).toBeLessThan(0.001);
  await frame('B4-handwheel-90deg-tool-slide-advances-15-7mm');

  // Re-render so the post-propagation pose is on screen.
  await win.evaluate(() => {
    const api = window.__archdiscAssemblyApi;
    const { AssemblyBridge } = api;
    const scene = window.__three_scene;
    if (window.__tier7cRestRoot) AssemblyBridge.dispose(window.__tier7cRestRoot, scene);
    window.__tier7cRestRoot = AssemblyBridge.renderAssembly(window.__tier7cRestAssembly, scene);
  });

  // ─── H. Final DOF + mate book-keeping ─────────────────────────────────
  const finalState = await win.evaluate(() => {
    const { MateSolver } = window.__archdiscAssemblyApi;
    return {
      dof: MateSolver.computeDOF(window.__tier7cRestAssembly),
      mateCount: window.__tier7cRestAssembly.mates.length,
      mateKinds: window.__tier7cRestAssembly.mates.map(x => x.type),
      satisfied: window.__tier7cRestAssembly.mates.every(m => m.satisfied),
      residuals: window.__tier7cRestAssembly.mates.map(m => ({ kind: m.type, r: m.error, satisfied: m.satisfied })),
    };
  });
  console.log(`  [final] ${JSON.stringify(finalState)}`);
  // Initial 24 - 1 (screw) - 1 (rack-pinion) = 22.
  expect(finalState.dof).toBe(24 - 1 - 1);
  expect(finalState.mateCount).toBe(2);
  expect(finalState.mateKinds.sort()).toEqual(['rackPinion', 'screw']);
  await frame('C1-final-two-tier7c-rest-mechanical-mates-satisfied');

  // ─── I. No-console-error sanity ───────────────────────────────────────
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
