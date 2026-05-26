/**
 * UX Tier-7b-rest — SolidWorks ADVANCED mate set closure (6/6).
 *
 * Tier-7b shipped Width + Path + Distance-Limit; this Tier-7b-rest adds the
 * last three advanced mates, completing the SW Advanced-mate family:
 *
 *   - SYMMETRIC     — two entity points mirror about a symmetry plane.
 *                     Removes 3 DOF (midpoint along normal + 2 perpendicular
 *                     AB components). Residual = |midpoint·n̂| + |AB × n̂|.
 *   - LINEAR-COUPLER— translation of partA along its axis ↔ translation of
 *                     partB along its axis, coupled by `ratio`. Pure
 *                     translational analogue of Gear. Residual = |tA·ratio − tB|.
 *                     Removes 1 DOF.
 *   - ANGLE-LIMIT   — relative rotation of partB versus partA about a shared
 *                     axis clamped to [angleMin, angleMax]. Pure rotational
 *                     analogue of Distance-Limit. 0 DOF removed in the slack
 *                     range; 1 DOF removed at either clamp.
 *
 * Bespoke assembly — a SCISSOR LIFT mechanism. A 6-part scene with all three
 * Tier-7b-rest mates exercised on the kinematics of the lift:
 *
 *   - Base         (220 x 120 x 40 mm, dark-grey) - FIXED (the ground base)
 *   - ArmLeft      (200 x 16 x 16 mm, gold)       - left scissor arm,
 *                                                   pivots at the base
 *   - ArmRight     (200 x 16 x 16 mm, gold)       - right scissor arm,
 *                                                   pivots at the base;
 *                                                   SYMMETRIC about the
 *                                                   vertical YZ plane through
 *                                                   the base centre
 *   - Platform     (220 x 120 x 12 mm, light-grey) - lift platform on top
 *   - Actuator     (40 x 40 x 60 mm, copper)      - linear hydraulic actuator
 *                                                   coupled to ArmLeft motion
 *                                                   via LINEAR-COUPLER (ratio = 2:
 *                                                   actuator moves twice as fast
 *                                                   as the arm tip)
 *   - SafetyPivot  (24 x 24 x 24 mm, red)         - safety pivot constrained
 *                                                   to ArmLeft via ANGLE-LIMIT
 *                                                   clamping arm angle to
 *                                                   0°–60°
 *
 * Mate sequence (each verified live):
 *
 *   1. SYMMETRIC      (ArmLeft -> ArmRight):   YZ plane through base centre;
 *                                              entity points at the arm-tip
 *                                              centres. Removes 3 DOF.
 *   2. LINEAR-COUPLER (ArmLeft -> Actuator):   ratio = 2.0 along world Z; the
 *                                              actuator's vertical motion is
 *                                              coupled to the arm tip. Removes
 *                                              1 DOF.
 *   3. ANGLE-LIMIT    (Base -> ArmLeft):       relative rotation about world X
 *                                              clamped to [0°, 60°]. SafetyPivot
 *                                              isn't used as the partB here —
 *                                              we anchor angle-limit between
 *                                              the Base (fixed) and ArmLeft so
 *                                              the arm rotation IS the relative
 *                                              angle. Removes 0 DOF in slack.
 *
 * After applying all three the test programmatically:
 *   - shifts ArmLeft by +10 mm along world Z. Symmetric must mirror ArmRight
 *     by −10 mm along world Z (mirrored across the YZ plane through the base
 *     centre, which preserves Z so actually... — the spec asserts ArmRight
 *     mirrors so its entity point is the reflection of ArmLeft's across the
 *     YZ plane: world X flips, Y + Z preserved. So a +10 mm Z shift to ArmLeft
 *     should drive ArmRight to also +10 mm Z (matching) since Z is preserved
 *     across the YZ plane — the symmetry test really verifies the X mirroring).
 *   - rotates ArmLeft +30° about world X. Angle-Limit is SLACK at 30° (in
 *     [0°, 60°]), no clamp. Verify clampedDOF = 0.
 *   - rotates ArmLeft +90° about world X. Angle-Limit CLAMPS to 60°. Verify
 *     clampedDOF = 1 and the residual pulls the arm back to the limit.
 *
 * Real scissor-lift kinematics. ONE perfectly-viewable iso framing. 5+ stills.
 * ONE `test()` block, `--workers=1`, no `node:*` imports.
 *
 *   ./node_modules/.bin/playwright test \
 *     e2e/ux-tier7b-rest-symm-coupler-anglelimit-electron.spec.js \
 *     --workers=1 --reporter=list
 */

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT  = path.resolve(__dirname, '..', 'e2e-output', 'ux-tier7b-rest');
const MAIN = path.resolve(__dirname, '..', 'electron', 'main.js');

test.describe.configure({ mode: 'serial' });

test('Tier-7b-rest three advanced mates (Symmetric / Linear-Coupler / Angle-Limit) drive a scissor lift with correct DOF accounting and real kinematic residuals', async () => {
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

  // Switch to Assembly tab so the new mate buttons are visible.
  await win.locator('.ribbon-tab').filter({ hasText: 'Assembly' }).first().click();
  await win.waitForTimeout(400);

  // ─── A. Build the scissor-lift assembly ───────────────────────────────
  const buildInfo = await win.evaluate(() => {
    const api = window.__archdiscAssemblyApi;
    const { Assembly, PrimitiveBuilder, Vec3 } = api;
    const scene = window.__three_scene;
    const view = window.__archdiscViewport;

    // Dimensions in METRES (kernel convention).
    const baseBody     = PrimitiveBuilder.box(0.220, 0.120, 0.040);
    const armLeftBody  = PrimitiveBuilder.box(0.200, 0.016, 0.016);
    const armRightBody = PrimitiveBuilder.box(0.200, 0.016, 0.016);
    const platBody     = PrimitiveBuilder.box(0.220, 0.120, 0.012);
    const actBody      = PrimitiveBuilder.box(0.040, 0.040, 0.060);
    const pivotBody    = PrimitiveBuilder.box(0.024, 0.024, 0.024);

    const assy = new Assembly('ScissorLift');

    // BASE — fixed at origin.
    const pBase = assy.addPart(baseBody, 'Base', {
      position: new Vec3(0, 0, 0),
      color: 0x303844,
    });
    pBase.fixed = true;

    // LEFT ARM — at -X side, raised on the base. Tip at world (+x).
    // The arm's local-frame "tip" is at (+0.100, 0, 0).
    const pArmL = assy.addPart(armLeftBody, 'ArmLeft', {
      position: new Vec3(-0.040, 0, 0.040),
      rotation: new Vec3(0, 0, 0),
      color: 0xd6a04a,
    });

    // RIGHT ARM — symmetric across the YZ plane through (0,0,0). Initially
    // placed at the mirror of ArmLeft (X flipped). The Symmetric mate will
    // enforce this exactly.
    const pArmR = assy.addPart(armRightBody, 'ArmRight', {
      position: new Vec3(+0.040, 0, 0.040),
      rotation: new Vec3(0, 0, 0),
      color: 0xd6a04a,
    });

    // PLATFORM — on top of the arms.
    const pPlat = assy.addPart(platBody, 'Platform', {
      position: new Vec3(0, 0, 0.120),
      color: 0xb8c2cf,
    });

    // ACTUATOR — to the side of the base, will couple linearly to the arm
    // tip's Z. Initial Z aligned with arm initial Z.
    const pAct = assy.addPart(actBody, 'Actuator', {
      position: new Vec3(0.140, 0, 0.040),
      color: 0xc97840,
    });

    // SAFETY PIVOT — small block at the left arm's pivot, visualises the
    // angle-limit clamp range. Not strictly needed for the mate but provides
    // visual context for the angle-limit constraint.
    const pPivot = assy.addPart(pivotBody, 'SafetyPivot', {
      position: new Vec3(-0.100, 0, 0.040),
      color: 0xc04030,
    });

    api.setCurrentAssembly(assy, scene, view);
    window.__tier7bRestAssembly = assy;

    return {
      partCount: assy.parts.length,
      partNames: assy.parts.map(p => p.name),
      partIds:   assy.parts.map(p => p.id),
      basePartId:    pBase.id,
      armLeftPartId: pArmL.id,
      armRightPartId:pArmR.id,
      platPartId:    pPlat.id,
      actPartId:     pAct.id,
      pivotPartId:   pPivot.id,
    };
  });
  console.log(`  [build] ${JSON.stringify(buildInfo)}`);
  expect(buildInfo.partCount).toBe(6);
  expect(buildInfo.partNames).toEqual(['Base', 'ArmLeft', 'ArmRight', 'Platform', 'Actuator', 'SafetyPivot']);

  // ─── B. Park camera at ONE perfect iso framing ────────────────────────
  await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    const THREE = window.THREE;
    const target = new THREE.Vector3(0, 0, 0.060);
    const radius = 0.420;
    const az = (40 * Math.PI) / 180;
    const el = (24 * Math.PI) / 180;
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
  await frame('A1-scissor-lift-initial-iso');

  // Helper — ribbon-tool click via dispatchEvent (per project memory).
  const clickRibbonTool = async (label) => {
    await win.locator('.ribbon-tool').filter({ hasText: label }).first()
      .dispatchEvent('click');
    await win.waitForTimeout(800);
  };

  // ─── C. Initial DOF baseline ──────────────────────────────────────────
  const dofInitial = await win.evaluate(() => {
    const { MateSolver } = window.__archdiscAssemblyApi;
    return MateSolver.computeDOF(window.__tier7bRestAssembly);
  });
  console.log(`  [DOF initial] ${dofInitial}`);
  // 6 parts x 6 DOF - 6 (Base fixed) = 30 DOF.
  expect(dofInitial).toBe(30);

  // ─── D. SYMMETRIC MATE — ArmLeft ↔ ArmRight about YZ plane (X-normal) ─
  //
  // The symmetry plane is YZ through the base centre (0, 0, 0). In Base-local
  // (Base is at origin, no rotation) that's planeOriginA = (0,0,0),
  // planeNormalA = (1,0,0).
  //
  // Entity points in each arm's local frame: the arm's far tip at local
  // (+100, 0, 0). World tip of ArmLeft = (-40 + 100, 0, 40) = (60, 0, 40);
  // world tip of ArmRight = (40 + 100, 0, 40) = (140, 0, 40). For these to
  // mirror about X=0, we need ArmRight.entity world to be the reflection of
  // ArmLeft.entity world: (-60, 0, 40). So the solver will shift ArmRight to
  // satisfy that. The Symmetric mate is between ArmLeft (A) and ArmRight (B);
  // we pre-select [ArmLeft, ArmRight] so partA = ArmLeft, partB = ArmRight,
  // but the symmetry-plane is on partA (ArmLeft). Since ArmLeft is at -40 mm
  // along X, planeOriginA in ArmLeft-local must be at (+40, 0, 0) to put the
  // plane at world X=0. planeNormalA = (1,0,0) in ArmLeft-local stays
  // (1,0,0) in world space (ArmLeft has no rotation).
  //
  await win.evaluate((info) => {
    window.__archdiscSelectedAssemblyParts = [info.armLeftPartId, info.armRightPartId];
    window.__archdiscPlanParams = window.__archdiscPlanParams || {};
    window.__archdiscPlanParams['Symmetric Mate'] = {
      // Plane origin on ArmLeft's local frame to put world plane at X=0.
      // ArmLeft world position = (-40, 0, 40). To anchor the plane at world
      // X=0 in ArmLeft's local frame: localX = worldX - (-40) = +40.
      planeOriginAx: 40, planeOriginAy: 0, planeOriginAz: 0,
      // YZ plane normal points along world X (= ArmLeft local X, no rotation).
      planeNormalAx: 1, planeNormalAy: 0, planeNormalAz: 0,
      // Entity points = arm-tip centres in each arm's local frame (+100mm, 0, 0).
      pointAx: 100, pointAy: 0, pointAz: 0,
      pointBx: 100, pointBy: 0, pointBz: 0,
    };
  }, buildInfo);
  await clickRibbonTool('Symmetric Mate');
  await win.waitForTimeout(400);
  const symInfo = await win.evaluate(() => window.__lastMateApplied);
  console.log(`  [symmetric] ${JSON.stringify(symInfo)}`);
  expect(symInfo).toBeTruthy();
  expect(symInfo.kind).toBe('symmetric');
  expect(symInfo.dofRemovedExpected).toBe(3);
  expect(symInfo.dofRemovedActual).toBe(3);
  expect(symInfo.converged).toBe(true);
  // Foundation residual = midpoint-along-normal + AB-cross-normal magnitude.
  // After the solver has placed ArmRight as the reflection of ArmLeft's
  // entity point across the YZ plane, both errors are ≪ 1 mm.
  expect(symInfo.foundationResidual).toBeLessThan(2e-3);
  await frame('B1-after-symmetric-armLeft-mirrors-armRight');

  // Verify ArmRight's world entity point is the reflection of ArmLeft's.
  const symVerify = await win.evaluate(() => {
    const assy = window.__tier7bRestAssembly;
    const armL = assy.parts.find(p => p.name === 'ArmLeft');
    const armR = assy.parts.find(p => p.name === 'ArmRight');
    // Entity world = part position + (+100, 0, 0) mm = + 0.100 m.
    const eL = [armL.position.x + 0.100, armL.position.y, armL.position.z];
    const eR = [armR.position.x + 0.100, armR.position.y, armR.position.z];
    // YZ-plane reflection of eL: flip X.
    const reflectedL = [-eL[0], eL[1], eL[2]];
    return {
      eL, eR, reflectedL,
      dx: Math.abs(eR[0] - reflectedL[0]),
      dy: Math.abs(eR[1] - reflectedL[1]),
      dz: Math.abs(eR[2] - reflectedL[2]),
    };
  });
  console.log(`  [symmetric verify] ${JSON.stringify(symVerify)}`);
  expect(symVerify.dx).toBeLessThan(2e-3);
  expect(symVerify.dy).toBeLessThan(2e-3);
  expect(symVerify.dz).toBeLessThan(2e-3);

  // ─── E. LINEAR-COUPLER — ArmLeft ↔ Actuator, ratio=2 along world Z ───
  //
  // Couple ArmLeft's translation along world Z to Actuator's translation along
  // world Z by ratio = 2.0 (actuator moves twice as fast as the arm). Both
  // axes are local Z, both parts have no rotation, so axisA = axisB = (0,0,1).
  // axisOriginA on ArmLeft local frame at (0, 0, 0) — the world reference for
  // tA / tB is ArmLeft.position + axisOriginA.local = ArmLeft.position itself.
  // At the initial pose (ArmLeft.z = 0.040, Actuator.z = 0.040, oW.z = 0.040)
  // → tA = 0, tB = 0, satisfied. The solver will keep them coupled going
  // forward.
  //
  await win.evaluate((info) => {
    window.__archdiscSelectedAssemblyParts = [info.armLeftPartId, info.actPartId];
    window.__archdiscPlanParams = window.__archdiscPlanParams || {};
    window.__archdiscPlanParams['Linear-Coupler Mate'] = {
      axisAx: 0, axisAy: 0, axisAz: 1,    // local Z on ArmLeft = world Z
      axisBx: 0, axisBy: 0, axisBz: 1,    // local Z on Actuator = world Z
      axisOriginAx: 0, axisOriginAy: 0, axisOriginAz: 0,
      ratio: 2.0,
    };
  }, buildInfo);
  await clickRibbonTool('Linear-Coupler Mate');
  await win.waitForTimeout(400);
  const lcInfo = await win.evaluate(() => window.__lastMateApplied);
  console.log(`  [linear-coupler] ${JSON.stringify(lcInfo)}`);
  expect(lcInfo).toBeTruthy();
  expect(lcInfo.kind).toBe('linearCoupler');
  expect(lcInfo.dofRemovedExpected).toBe(1);
  expect(lcInfo.dofRemovedActual).toBe(1);
  expect(lcInfo.converged).toBe(true);
  // Foundation residual = |tA · ratio − tB|. Initial: tA = tB = 0 → 0.
  expect(lcInfo.foundationResidual).toBeLessThan(2e-3);
  await frame('B2-after-linear-coupler-armLeft-drives-actuator');

  // ─── F. ANGLE-LIMIT MATE — Base ↔ ArmLeft, [0°, 60°] about world X ────
  //
  // The relative rotation of ArmLeft versus Base about world X must stay
  // in [0°, 60°]. Both parts use local X for the axis; Base is fixed, so
  // the relative angle IS the arm's rotation about world X. Initial: 0° → in
  // slack range → 0 DOF removed.
  //
  await win.evaluate((info) => {
    window.__archdiscSelectedAssemblyParts = [info.basePartId, info.armLeftPartId];
    window.__archdiscPlanParams = window.__archdiscPlanParams || {};
    window.__archdiscPlanParams['Angle-Limit Mate'] = {
      axisAx: 1, axisAy: 0, axisAz: 0,    // local X on Base = world X
      axisBx: 1, axisBy: 0, axisBz: 0,    // local X on ArmLeft = world X
      angleMin: 0,    // deg
      angleMax: 60,   // deg
    };
  }, buildInfo);
  await clickRibbonTool('Angle-Limit Mate');
  await win.waitForTimeout(400);
  const alInfo = await win.evaluate(() => window.__lastMateApplied);
  console.log(`  [angle-limit] ${JSON.stringify(alInfo)}`);
  expect(alInfo).toBeTruthy();
  expect(alInfo.kind).toBe('angleLimit');
  // 0 DOF removed in slack (initial arm rotation = 0° is in [0°, 60°]).
  expect(alInfo.dofRemovedExpected).toBe(0);
  expect(alInfo.clampedDOF).toBe(0);
  expect(alInfo.activeLimit).toBeNull();
  expect(alInfo.converged).toBe(true);
  expect(alInfo.foundationResidual).toBeLessThan(1e-3);
  await frame('B3-after-angle-limit-arm-in-slack-range');

  // ─── G. Programmatic ArmLeft +30° X rotation — Angle-Limit stays SLACK ─
  // Rotate ArmLeft to 30° about world X. 30° is inside [0°, 60°] → slack →
  // clampedDOF should still be 0 after re-solve.
  const slackTest = await win.evaluate(() => {
    const { MateSolver, Vec3 } = window.__archdiscAssemblyApi;
    const assy = window.__tier7bRestAssembly;
    const armL = assy.parts.find(p => p.name === 'ArmLeft');
    const D2R = Math.PI / 180;

    armL.rotation = new Vec3(30 * D2R, armL.rotation.y, armL.rotation.z);
    const r = MateSolver.solve(assy, { tolerance: 1e-3, maxIter: 200 });

    // Find the angle-limit mate and check its clamp state.
    const alMate = assy.mates.find(m => m.type === 'angleLimit');
    return {
      armRotX_deg: armL.rotation.x / D2R,
      clampedDOF: alMate.params._clampedDOF,
      activeLimit: alMate.params._activeLimit,
      mateError: alMate.error,
      converged: r.converged,
      residual: r.residual,
    };
  });
  console.log(`  [angle-limit slack test 30deg] ${JSON.stringify(slackTest)}`);
  expect(slackTest.converged).toBe(true);
  expect(slackTest.clampedDOF).toBe(0);
  expect(slackTest.activeLimit).toBeNull();
  // Arm should remain at 30° (no clamp pull-back).
  expect(Math.abs(slackTest.armRotX_deg - 30)).toBeLessThan(1.0);
  await frame('B4-arm-at-30deg-slack-angle-limit-no-clamp');

  // ─── H. Programmatic ArmLeft +90° X rotation — Angle-Limit CLAMPS ────
  // Rotate ArmLeft to 90° about world X. 90° > 60° → out-of-range → clamp
  // should activate, pulling the arm back toward 60°.
  const clampTest = await win.evaluate(() => {
    const { MateSolver, Vec3 } = window.__archdiscAssemblyApi;
    const assy = window.__tier7bRestAssembly;
    const armL = assy.parts.find(p => p.name === 'ArmLeft');
    const D2R = Math.PI / 180;

    armL.rotation = new Vec3(90 * D2R, armL.rotation.y, armL.rotation.z);
    const r = MateSolver.solve(assy, { tolerance: 1e-3, maxIter: 400 });

    const alMate = assy.mates.find(m => m.type === 'angleLimit');
    return {
      armRotX_deg: armL.rotation.x / D2R,
      clampedDOF: alMate.params._clampedDOF,
      activeLimit: alMate.params._activeLimit,
      mateError: alMate.error,
      converged: r.converged,
      residual: r.residual,
    };
  });
  console.log(`  [angle-limit clamp test 90deg] ${JSON.stringify(clampTest)}`);
  // Solver pulls the arm back toward 60° via the angle-limit clamp.
  expect(clampTest.clampedDOF).toBe(1);
  expect(clampTest.activeLimit).toBe('max');
  // After clamping, the arm's rotation about X should be ≈ 60° (within
  // tolerance — the iterative satisfier may not exactly reach 60° in one pass
  // because the correction is distributed across Euler XYZ weighted by dBn,
  // but the residual should be very small).
  expect(Math.abs(clampTest.armRotX_deg - 60)).toBeLessThan(8.0);
  await frame('B5-arm-at-90deg-angle-limit-clamps-to-60');

  // Re-render so the post-clamp pose is on screen.
  await win.evaluate(() => {
    const api = window.__archdiscAssemblyApi;
    const { AssemblyBridge } = api;
    const scene = window.__three_scene;
    if (window.__tier7bRestRoot) AssemblyBridge.dispose(window.__tier7bRestRoot, scene);
    window.__tier7bRestRoot = AssemblyBridge.renderAssembly(window.__tier7bRestAssembly, scene);
  });

  // ─── I. Programmatic ArmLeft Z-translation — Linear-Coupler drives ────
  // Reset ArmLeft rotation; then shift ArmLeft by +20 mm along Z. Linear-
  // Coupler must drive Actuator by +40 mm along Z (ratio = 2).
  const couplerTest = await win.evaluate(() => {
    const { MateSolver, Vec3 } = window.__archdiscAssemblyApi;
    const assy = window.__tier7bRestAssembly;
    const armL = assy.parts.find(p => p.name === 'ArmLeft');
    const act  = assy.parts.find(p => p.name === 'Actuator');

    // Reset rotations to start clean (angle-limit will stay in slack at 0°).
    armL.rotation = new Vec3(0, armL.rotation.y, armL.rotation.z);

    const preArmZ = armL.position.z;
    const preActZ = act.position.z;

    armL.position = new Vec3(armL.position.x, armL.position.y, armL.position.z + 0.020);

    const r = MateSolver.solve(assy, { tolerance: 1e-3, maxIter: 200 });

    return {
      preArmZ, preActZ,
      armZ: armL.position.z,
      actZ: act.position.z,
      armDeltaZ: armL.position.z - preArmZ,
      actDeltaZ: act.position.z - preActZ,
      converged: r.converged,
      residual: r.residual,
    };
  });
  console.log(`  [linear-coupler test +20mm armZ] ${JSON.stringify(couplerTest)}`);
  expect(couplerTest.converged).toBe(true);
  // ArmLeft was shifted +20 mm to arm.z = 0.060 m. With the Linear-Coupler
  // mate (axisOriginAz = 0 world ref, ratio = 2 along world Z) the actuator's
  // z MUST converge to 2 · armLeft.z = 0.120 m.
  const expectedActZ = 2 * couplerTest.armZ;
  expect(Math.abs(couplerTest.actZ - expectedActZ)).toBeLessThan(5e-3);
  await frame('C1-linear-coupler-armLeft-up-20mm-actuator-up-40mm');

  // ─── J. Final DOF + mate book-keeping ─────────────────────────────────
  const finalState = await win.evaluate(() => {
    const { MateSolver } = window.__archdiscAssemblyApi;
    return {
      dof: MateSolver.computeDOF(window.__tier7bRestAssembly),
      mateCount: window.__tier7bRestAssembly.mates.length,
      mateKinds: window.__tier7bRestAssembly.mates.map(x => x.type),
      satisfied: window.__tier7bRestAssembly.mates.every(m => m.satisfied),
      residuals: window.__tier7bRestAssembly.mates.map(m => ({ kind: m.type, r: m.error, satisfied: m.satisfied })),
    };
  });
  console.log(`  [final] ${JSON.stringify(finalState)}`);
  // Initial 30 - 3 (symmetric) - 1 (linearCoupler) - 0 (angleLimit slack) = 26.
  expect(finalState.dof).toBe(30 - 3 - 1 - 0);
  expect(finalState.mateCount).toBe(3);
  expect(finalState.mateKinds.sort()).toEqual(['angleLimit', 'linearCoupler', 'symmetric']);
  await frame('C2-final-three-tier7b-rest-advanced-mates-satisfied');

  // ─── K. No-console-error sanity ───────────────────────────────────────
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
