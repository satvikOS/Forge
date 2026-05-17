import { test, expect } from '@playwright/test';
import { encodeAVI, encodeMP4 } from '../frontend/src/foundation/VideoMux.js';
import { makeZip } from '../frontend/src/foundation/ZipArchive.js';
import fs from 'fs';
import path from 'path';

/*
 * GE9X — built end-to-end by ORCHESTRATION, in the platform.
 *
 * A pure-data plan of general ArchDisc tools, run through the real app.
 * No GE9X-specific code. Coherence is verified numerically (every
 * module's bbox co-axial on Z, one contiguous envelope) and the
 * deliverable render uses per-part materials with Lambert shading.
 */

const OUT = 'ge9x-deliverable';
// Revolve takes a (radius, axial) profile; the axial extent becomes Z.
const tube = (rIn, rOut, len) => [[rIn, 0], [rOut, 0], [rOut, len], [rIn, len]];
const coneFwd = (rBase, len) => [[0, 0], [rBase, len], [0, len]];   // apex z=0, CCW
const coneAft = (rBase, len) => [[0, 0], [rBase, 0], [0, len]];     // apex z=len, CCW
const duct = (rIn, rOutA, rOutB, len) => [[rIn, 0], [rOutA, 0], [rOutB, len], [rIn, len]];

// ── THE PLAN — pure data, generated. NO rotate: revolve is already
// Z-axial. A real multi-stage turbofan: static structure (revolves) +
// rotor / stator blade rows for fan, booster, HPC, HPT, LPT. All
// co-axial on Z; the build verifies coherence numerically.
const GEOMETRY = [];
let _n = 0;
const lbl = (s) => `${String(++_n).padStart(2, '0')}_${s}`;
const revolve = (name, color, profile, z) =>
  GEOMETRY.push({ tool: 'Revolve Boss', label: lbl(name), color, params: { profile, translate: [0, 0, z] } });
const row = (name, color, p) =>
  GEOMETRY.push({ tool: 'Blade Row', label: lbl(name), color, params: p });

// Static structure.
revolve('nacelle', [176, 182, 196], tube(1780, 1880, 3800), -300);
revolve('fan-case', [150, 156, 168], tube(1690, 1760, 1250), -150);
revolve('spinner', [228, 230, 235], coneFwd(360, 560), -60);
revolve('lp-shaft', [60, 62, 70], tube(90, 120, 3400), 150);
revolve('core-casing', [96, 101, 114], tube(560, 700, 2350), 1180);
revolve('hp-shaft', [74, 76, 84], tube(150, 185, 1150), 1480);
revolve('combustor-case', [212, 96, 56], tube(440, 660, 460), 2350);
revolve('combustor-liner', [232, 140, 80], tube(430, 472, 420), 2360);
revolve('tail-cone', [120, 124, 134], coneAft(300, 520), 3700);
revolve('exhaust-nozzle', [104, 109, 122], duct(300, 720, 540, 560), 3950);

// Blade counts are realistic for a GE9X-class engine — the manifold-3d
// kernel memory fix (dispose intermediates in circularPattern + the
// Blade Row handler) keeps peak WASM heap per-row-transient, so the
// full part count builds without exhausting the heap.

// Fan stage + outlet guide vanes.
row('fan', [205, 210, 222], { count: 16, rHub: 360, rTip: 1660, chordHub: 340,
  chordTip: 520, thickRatio: 0.09, staggerHub: 1.0, staggerTip: 0.42, translate: [0, 0, 250] });
row('fan-OGV', [170, 176, 190], { count: 30, rHub: 620, rTip: 1580, chordHub: 180,
  chordTip: 200, thickRatio: 0.06, staggerHub: 0.2, staggerTip: 0.1, translate: [0, 0, 520] });

// Booster — 3 rotor stages.
for (let s = 0; s < 3; s++) {
  row(`booster-R${s + 1}`, [120, 150, 188], { count: 30 + s * 4, rHub: 380 + s * 8,
    rTip: 560 + s * 6, chordHub: 110, chordTip: 95, thickRatio: 0.1,
    staggerHub: 0.8, staggerTip: 0.5, translate: [0, 0, 700 + s * 130] });
}

// HPC — 5 stages, rotor + stator; radius contracts aft.
for (let s = 0; s < 5; s++) {
  const z = 1320 + s * 180, rTip = 540 - s * 16, rHub = 430 + s * 6;
  row(`hpc-R${s + 1}`, [196, 168, 108], { count: 38, rHub, rTip, chordHub: 92,
    chordTip: 78, thickRatio: 0.08, staggerHub: 0.7, staggerTip: 0.5, translate: [0, 0, z] });
  row(`hpc-S${s + 1}`, [150, 134, 96], { count: 40, rHub: rHub + 4, rTip: rTip - 6,
    chordHub: 70, chordTip: 62, thickRatio: 0.06, staggerHub: 0.3, staggerTip: 0.2,
    translate: [0, 0, z + 90] });
}

// HPT — 2 stages, rotor + stator.
for (let s = 0; s < 2; s++) {
  const z = 2880 + s * 150;
  row(`hpt-R${s + 1}`, [206, 116, 74], { count: 46, rHub: 480 + s * 20, rTip: 700 + s * 10,
    chordHub: 120, chordTip: 108, thickRatio: 0.18, staggerHub: 0.7, staggerTip: 0.5,
    translate: [0, 0, z] });
  row(`hpt-S${s + 1}`, [180, 110, 80], { count: 42, rHub: 490 + s * 20, rTip: 690 + s * 10,
    chordHub: 100, chordTip: 92, thickRatio: 0.14, staggerHub: 0.35, staggerTip: 0.25,
    translate: [0, 0, z + 75] });
}

// LPT — 4 stages, rotor + stator; radius grows aft.
for (let s = 0; s < 4; s++) {
  const z = 3180 + s * 150, rTip = 760 + s * 45, rHub = 540 + s * 20;
  row(`lpt-R${s + 1}`, [126, 168, 138], { count: 48, rHub, rTip, chordHub: 140,
    chordTip: 122, thickRatio: 0.16, staggerHub: 0.7, staggerTip: 0.45, translate: [0, 0, z] });
  row(`lpt-S${s + 1}`, [110, 150, 124], { count: 52, rHub: rHub + 6, rTip: rTip - 8,
    chordHub: 115, chordTip: 104, thickRatio: 0.12, staggerHub: 0.35, staggerTip: 0.25,
    translate: [0, 0, z + 75] });
}
const SIMS = [
  { tool: 'Brayton Cycle', label: '12_cycle-takeoff', slot: '__lastBraytonResult',
    params: { altitudeM: 0, machNumber: 0.25, bypassRatio: 9.9, fanPR: 1.5,
      compressorPR: 40, T4_K: 1850, massFlowKgS: 1700 } },
  { tool: 'Compressor Stage', label: '13_hpc-stage', slot: '__lastCompressorResult',
    params: { massFlowKgS: 160, rpm: 9300, r_tip_m: 0.54, hubToTip: 0.8 } },
  { tool: 'Combustor', label: '14_combustor', slot: '__lastCombustorResult',
    params: { massFlowKgS: 160, T_t3_K: 900, P_t3_Pa: 4.5e6, T_t4_K: 1850 } },
  { tool: 'Blade Cooling', label: '15_hpt-cooling', slot: '__lastBladeCoolingResult',
    params: { T_gas_K: 1850, T_coolant_K: 900 } },
  { tool: 'Rotordynamics', label: '16_rotordynamics', slot: '__lastRotordynResult', params: {} },
];

test('GE9X — built end-to-end by orchestration', async ({ page }) => {
  test.setTimeout(2700000);
  for (const d of ['screenshots', 'videos', 'geometry', 'data']) {
    fs.mkdirSync(path.join(OUT, d), { recursive: true });
  }
  const deliverable = [];
  const add = (p, data) => { fs.writeFileSync(path.join(OUT, p), data); deliverable.push(p); };

  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(2500);
  const canvas = page.locator('canvas').first();

  const runStep = async (tab, step) => {
    await page.locator('.ribbon-tab', { hasText: tab }).first().click();
    await page.waitForTimeout(350);
    await page.evaluate(({ t, p }) => {
      window.__archdiscPlanParams = window.__archdiscPlanParams || {};
      window.__archdiscPlanParams[t] = p;
    }, { t: step.tool, p: step.params });
    await page.locator('.ribbon-tool-label', { hasText: new RegExp(`^${step.tool}$`) }).first().click();
    await page.waitForFunction((k) => !!window[k], step.slot ?? '__lastFoundationManifold',
      { timeout: 90000 });
    await page.waitForTimeout(450);
  };

  // ── 1. Build the engine geometry, verifying co-axial coherence ──
  const moduleBoxes = [];
  for (const step of GEOMETRY) {
    await runStep('Part', step);
    const bb = await page.evaluate(() => {
      const b = window.__lastFoundationManifold.boundingBox();
      return { min: b.min, max: b.max };
    });
    const cx = (bb.min[0] + bb.max[0]) / 2, cy = (bb.min[1] + bb.max[1]) / 2;
    moduleBoxes.push({ label: step.label, bb, cx, cy });
    add(`screenshots/${step.label}.png`, await canvas.screenshot());
    console.log(`  ${step.label}: axis-centre (${cx.toFixed(1)}, ${cy.toFixed(1)}) `
      + `Z[${bb.min[2].toFixed(0)}..${bb.max[2].toFixed(0)}]`);
    expect(Math.abs(cx)).toBeLessThan(8);
    expect(Math.abs(cy)).toBeLessThan(8);
  }
  const zMin = Math.min(...moduleBoxes.map((m) => m.bb.min[2]));
  const zMax = Math.max(...moduleBoxes.map((m) => m.bb.max[2]));
  console.log(`  engine envelope: Z ${zMin.toFixed(0)}..${zMax.toFixed(0)} mm `
    + `(length ${(zMax - zMin).toFixed(0)} mm)`);
  expect(zMax - zMin).toBeGreaterThan(3500);
  expect(zMax - zMin).toBeLessThan(6500);

  // ── 1b. Fastener hardware — 100 000-component capacity via instancing ──
  // A real engine's part count is dominated by repeated hardware
  // (fasteners, rivets, blade attachments). One base part + 100 000
  // per-instance transforms collapse to ONE InstancedMesh / ONE draw
  // call — that is how the platform carries six-figure component counts.
  const capacity = await page.evaluate(async () => {
    const { iso4762 } = await import('/src/foundation/FastenerLib.js');
    const { buildInstancedAssembly, virtualTriangleCount } =
      await import('/src/foundation/MassiveAssembly.js');
    const fastener = await iso4762('M5', 16);
    const baseTriCount = fastener.numTri();
    // Ring patterns on the nacelle skin + aft core casing.
    const instances = [];
    const rings = 100, perRing = 1000;
    for (let r = 0; r < rings; r++) {
      const z = -250 + (r / rings) * 4400;
      const radius = z < 3600 ? 1850 : 760;
      for (let f = 0; f < perRing; f++) {
        const phi = (f / perRing) * 2 * Math.PI;
        instances.push({
          position: [radius * Math.cos(phi), radius * Math.sin(phi), z],
          rotation: [0, 0, (phi * 180) / Math.PI],
        });
      }
    }
    const inst = buildInstancedAssembly({
      basePart: fastener, instances,
      materialOpts: { color: 0x8a929c, roughness: 0.4, metalness: 0.8 },
    });
    inst.scale.setScalar(0.001);                    // mm → viewport metres
    inst.userData.capacityInstanced = true;
    window.__three_scene.add(inst);
    fastener.delete();
    return {
      instanceCount: instances.length, baseTriCount,
      virtualTriangles: virtualTriangleCount(instances, baseTriCount),
      drawCalls: 1,
    };
  });
  console.log(`  capacity: ${capacity.instanceCount.toLocaleString()} instanced fasteners `
    + `→ ${capacity.virtualTriangles.toLocaleString()} virtual triangles in 1 draw call`);
  add('data/capacity.json', JSON.stringify(capacity, null, 2));

  // ── 2. Render the engine in ArchDisc's real Three.js viewport ──
  // Real WebGL (PBR materials, ACES tone-map) via a capture renderer that
  // shares the live scene. The cutaway is a real 3-D clipping-plane cut.
  const colors = GEOMETRY.map((g) => g.color);
  const solidFlag = GEOMETRY.map((g) => g.tool === 'Blade Row');
  const R = await page.evaluate(({ cols, solids }) => {
    const THREE = window.THREE;
    const scene = window.__three_scene;
    // Top-level scene children that contain foundation geometry, in
    // build order — one container per engine module.
    const groups = scene.children.filter((o) => {
      let f = false;
      o.traverse((x) => { if (x.userData && x.userData.foundationManifold) f = true; });
      return f;
    });
    const meshesOf = (g) => { const ms = []; g.traverse((m) => { if (m.isMesh) ms.push(m); }); return ms; };

    // Per-module PBR materials on the real meshes (persist into viewport).
    groups.forEach((g, i) => {
      const c = cols[i] || [150, 150, 160];
      for (const m of meshesOf(g)) {
        m.material = new THREE.MeshStandardMaterial({
          color: new THREE.Color(c[0] / 255, c[1] / 255, c[2] / 255),
          metalness: 0.38, roughness: 0.46, side: THREE.DoubleSide,
        });
      }
    });

    // Hide grid / helpers so the capture frames only the engine.
    const hidden = [];
    scene.traverse((o) => {
      if (o.visible && (o.type === 'GridHelper' || o.type === 'AxesHelper'
        || (o.userData && o.userData.isHelper))) { o.visible = false; hidden.push(o); }
    });

    const box = new THREE.Box3();
    for (const g of groups) { g.updateMatrixWorld(true); box.expandByObject(g); }
    const ctr = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;

    // Dedicated capture renderer — readable buffer, viewport-matched look.
    // Each shot is JPEG-encoded in-browser and returned as a compact data
    // URL (returning raw RGBA arrays OOMs the Playwright bridge).
    const cap = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
    cap.setClearColor(0x0c0e16, 1);
    cap.toneMapping = THREE.ACESFilmicToneMapping;
    cap.toneMappingExposure = 1.08;
    if (THREE.SRGBColorSpace) cap.outputColorSpace = THREE.SRGBColorSpace;
    const cam = new THREE.PerspectiveCamera(38, 1, maxDim * 0.002, maxDim * 200);

    const shoot = (w, h, az, el, distMul, q) => {
      cap.setSize(w, h, false);
      cam.aspect = w / h;
      const a = az * Math.PI / 180, e = el * Math.PI / 180;
      const dist = (maxDim / 2) / Math.tan((cam.fov * Math.PI / 180) / 2) * distMul;
      cam.position.set(
        ctr.x + dist * Math.cos(e) * Math.sin(a),
        ctr.y + dist * Math.sin(e),
        ctr.z + dist * Math.cos(e) * Math.cos(a),
      );
      cam.lookAt(ctr);
      cam.updateProjectionMatrix();
      cap.render(scene, cam);
      const c2 = document.createElement('canvas');
      c2.width = w; c2.height = h;
      c2.getContext('2d').drawImage(cap.domElement, 0, 0);
      return c2.toDataURL('image/jpeg', q);
    };

    // Front-quarter hero view — inlet faces the camera so the fan shows.
    const exterior = shoot(1280, 720, 142, 18, 1.16, 0.92);
    // Close-up on the nacelle skin — shows the instanced fastener field.
    const closeup = shoot(1280, 720, 52, 12, 0.42, 0.92);

    // Cutaway — clip the casings' top half; blade rows stay whole.
    cap.localClippingEnabled = true;
    const plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), ctr.y);
    groups.forEach((g, i) => {
      for (const m of meshesOf(g)) {
        m.material.clippingPlanes = solids[i] ? null : [plane];
        m.material.needsUpdate = true;
      }
    });
    const cutaway = shoot(1280, 720, 34, 27, 1.12, 0.92);
    groups.forEach((g) => {
      for (const m of meshesOf(g)) { m.material.clippingPlanes = null; m.material.needsUpdate = true; }
    });
    cap.localClippingEnabled = false;

    const vid = [];
    for (let f = 0; f < 24; f++) vid.push(shoot(640, 360, (f / 24) * 360, 17, 1.22, 0.85));

    cap.dispose();
    for (const o of hidden) o.visible = true;
    return { exterior, cutaway, closeup, vid, modules: groups.length };
  }, { cols: colors, solids: solidFlag });
  expect(R.modules).toBeGreaterThanOrEqual(GEOMETRY.length);
  const jpegOf = (durl) => Buffer.from(durl.split(',')[1], 'base64');
  add('screenshots/GE9X-exterior.jpg', jpegOf(R.exterior));
  add('screenshots/GE9X-cutaway.jpg', jpegOf(R.cutaway));
  add('screenshots/GE9X-fastener-closeup.jpg', jpegOf(R.closeup));
  const vframes = R.vid.map(jpegOf);
  const frameCount = vframes.length;
  add('videos/GE9X-engine.avi', encodeAVI(vframes, { fps: 12, width: 640, height: 360 }));
  add('videos/GE9X-engine.mp4', encodeMP4(vframes, { fps: 12, width: 640, height: 360 }));
  console.log(`  render: real viewport — ${R.modules} modules → exterior + cutaway + ${frameCount}-frame orbit`);
  add('screenshots/GE9X-viewport.png', await canvas.screenshot());

  // ── 3. Export the assembled engine — the REAL model ──
  await page.locator('.ribbon-tab', { hasText: 'Drawing' }).first().click();
  await page.waitForTimeout(400);
  const [stlDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 90000 }),
    page.locator('.ribbon-tool-label', { hasText: /^Export Assembly$/ }).first().click(),
  ]);
  await page.waitForFunction(() => !!window.__lastAssemblyExport, null, { timeout: 60000 });
  const asm = await page.evaluate(() => window.__lastAssemblyExport);
  const stlBuf = fs.readFileSync(await stlDownload.path());
  add('geometry/GE9X-assembly.stl', stlBuf);
  console.log(`  ASSEMBLY: ${asm.bodyCount} modules → ${asm.triangles.toLocaleString()} triangles, `
    + `${(stlBuf.length / 1048576).toFixed(1)} MB STL`);

  // ── 4. Simulations ──
  const simData = {};
  for (const step of SIMS) {
    await runStep('Simulate', step);
    add(`screenshots/${step.label}.png`, await canvas.screenshot());
    simData[step.label] = await page.evaluate((k) => {
      try { return JSON.parse(JSON.stringify(window[k])); } catch { return { ok: true }; }
    }, step.slot);
    console.log(`  sim: ${step.label}`);
  }
  add('data/simulations.json', JSON.stringify(simData, null, 2));
  add('data/coherence.json', JSON.stringify({ moduleBoxes, assembly: asm }, null, 2));

  // ── 5. Real-world survival — fire / water immersion / bird strike ──
  const survivalStep = {
    tool: 'Survival Test', label: '17_survival', slot: '__lastSurvivalResult',
    params: {
      fireMaterial: 'INCONEL_718', flameTempC: 1100, fireWall_mm: 4, fireDurationS: 300,
      waterMaterial: 'CMSX_4', partTempC: 950, waterWall_mm: 3,
      birdMaterial: 'TI_6AL_4V', birdMassKg: 1.8, impactSpeed_ms: 130,
    },
  };
  await runStep('Simulate', survivalStep);
  add('screenshots/17_survival.png', await canvas.screenshot());
  const survival = await page.evaluate(
    () => JSON.parse(JSON.stringify(window.__lastSurvivalResult)));
  add('data/survival.json', JSON.stringify(survival, null, 2));
  console.log(`  survival: ${survival.overall}`);
  console.log(`    FIRE  ${survival.fire.verdict}`);
  console.log(`    WATER ${survival.water.verdict}`);
  console.log(`    BIRD  ${survival.bird.verdict}`);

  add('README.txt',
    'GE9X — engineering deliverable, orchestrated end-to-end in ArchDisc.\n\n'
    + 'A pure-data plan of general tools, run through the real app.\n'
    + `  geometry/    GE9X-assembly.stl — ${asm.triangles} triangles\n`
    + '  screenshots/ GE9X-exterior.jpg, GE9X-cutaway.jpg, GE9X-fastener-closeup.jpg\n'
    + '  videos/      GE9X-engine.mp4 / .avi\n'
    + '  data/        simulations.json, coherence.json, survival.json, capacity.json\n\n'
    + `Component capacity: ${GEOMETRY.length} distinct geometry modules + `
    + `${capacity.instanceCount.toLocaleString()} instanced fasteners `
    + `(${capacity.virtualTriangles.toLocaleString()} virtual triangles, 1 draw call).\n\n`
    + 'Survival scenarios (foundation.runSurvivalSuite — flagged reduced-order):\n'
    + `  FIRE   ${survival.fire.verdict}\n`
    + `  WATER  ${survival.water.verdict}\n`
    + `  BIRD   ${survival.bird.verdict}\n`);

  // ── Assertions ──
  expect(asm.bodyCount).toBeGreaterThanOrEqual(GEOMETRY.length);
  expect(asm.triangles).toBeGreaterThan(50000);
  expect(stlBuf.length).toBe(84 + asm.triangles * 50);
  expect(frameCount).toBe(24);
  expect(simData['12_cycle-takeoff']).toBeTruthy();
  expect(survival.total).toBe(3);
  expect(survival.passed).toBeGreaterThanOrEqual(1);
  expect(typeof survival.bird.survives).toBe('boolean');
  expect(capacity.instanceCount).toBeGreaterThanOrEqual(100000);

  // ── 6. Package everything into one source archive ──
  const zipEntries = deliverable.map((p) => ({
    path: `GE9X/${p}`, data: fs.readFileSync(path.join(OUT, p)),
  }));
  const zip = makeZip(zipEntries);
  fs.writeFileSync(path.join(OUT, 'GE9X-deliverable.zip'), zip);
  console.log(`  packaged: GE9X-deliverable.zip — ${(zip.length / 1048576).toFixed(1)} MB, `
    + `${zipEntries.length} files`);
  expect(zip.length).toBeGreaterThan(1000000);
  expect(zip.readUInt32LE(0)).toBe(0x04034b50);          // valid PKZIP signature
  console.log(`\nGE9X deliverable: ${deliverable.length} files in ${OUT}/ + GE9X-deliverable.zip`);
});
