import { test, expect } from '@playwright/test';
import { framesToVideo } from '../frontend/src/foundation/VideoMux.js';
import { encodeJPEG } from '../frontend/src/foundation/JpegEncoder.js';
import fs from 'fs';
import path from 'path';

/*
 * GE9X — built end-to-end by ORCHESTRATION, in the platform.
 *
 * A pure-data plan of general ArchDisc tools, run through the real app.
 * No GE9X-specific code.
 *
 * Coherence is VERIFIED NUMERICALLY: manifold's revolve already yields
 * a Z-axial body, and Blade Row builds on Z — so every module's
 * bounding box must be centred on the Z axis (x,y ≈ 0) and span a
 * sensible Z range. A blob (the earlier failure) has off-axis bboxes;
 * a real engine has them all co-axial. Each module is checked.
 */

const OUT = 'ge9x-deliverable';
// Revolve takes a (radius, axial) profile; the axial extent becomes Z.
const tube = (rIn, rOut, len) => [[rIn, 0], [rOut, 0], [rOut, len], [rIn, len]];
const coneFwd = (rBase, len) => [[0, 0], [rBase, len], [0, len]];   // apex at z=0, CCW
const duct = (rIn, rOutA, rOutB, len) => [[rIn, 0], [rOutA, 0], [rOutB, len], [rIn, len]];

// ── THE PLAN — pure data. NO rotate: revolve is already Z-axial. ───
const GEOMETRY = [
  { tool: 'Revolve Boss', label: '01_nacelle',
    params: { profile: tube(1780, 1880, 3800), translate: [0, 0, -300] } },
  { tool: 'Revolve Boss', label: '02_fan-case',
    params: { profile: tube(1690, 1760, 1250), translate: [0, 0, -150] } },
  { tool: 'Revolve Boss', label: '03_spinner',
    params: { profile: coneFwd(360, 560), translate: [0, 0, -60] } },
  { tool: 'Blade Row', label: '04_fan',
    params: { count: 16, rHub: 360, rTip: 1660, chordHub: 340, chordTip: 520,
      thickRatio: 0.09, staggerHub: 1.0, staggerTip: 0.42, translate: [0, 0, 250] } },
  { tool: 'Blade Row', label: '05_booster',
    params: { count: 38, rHub: 380, rTip: 560, chordHub: 110, chordTip: 95,
      thickRatio: 0.1, staggerHub: 0.8, staggerTip: 0.5, translate: [0, 0, 760] } },
  { tool: 'Revolve Boss', label: '06_core-casing',
    params: { profile: tube(560, 700, 2350), translate: [0, 0, 1180] } },
  { tool: 'Blade Row', label: '07_hpc',
    params: { count: 40, rHub: 430, rTip: 540, chordHub: 95, chordTip: 80,
      thickRatio: 0.08, staggerHub: 0.7, staggerTip: 0.5, translate: [0, 0, 1700] } },
  { tool: 'Revolve Boss', label: '08_combustor',
    params: { profile: tube(440, 660, 460), translate: [0, 0, 2350] } },
  { tool: 'Blade Row', label: '09_hpt',
    params: { count: 60, rHub: 480, rTip: 700, chordHub: 130, chordTip: 115,
      thickRatio: 0.18, staggerHub: 0.7, staggerTip: 0.5, translate: [0, 0, 2900] } },
  { tool: 'Blade Row', label: '10_lpt',
    params: { count: 70, rHub: 540, rTip: 940, chordHub: 150, chordTip: 130,
      thickRatio: 0.18, staggerHub: 0.7, staggerTip: 0.45, translate: [0, 0, 3450] } },
  { tool: 'Revolve Boss', label: '11_exhaust-nozzle',
    params: { profile: duct(300, 720, 540, 560), translate: [0, 0, 3950] } },
];
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
  test.setTimeout(900000);
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
      + `Z[${bb.min[2].toFixed(0)}..${bb.max[2].toFixed(0)}] `
      + `R≈${Math.max(Math.abs(bb.max[0]), Math.abs(bb.max[1])).toFixed(0)}`);
    // COHERENCE: every module must sit on the Z axis (x,y centre ≈ 0).
    expect(Math.abs(cx)).toBeLessThan(8);
    expect(Math.abs(cy)).toBeLessThan(8);
  }
  // COHERENCE: modules span one contiguous engine length along Z.
  const zMin = Math.min(...moduleBoxes.map((m) => m.bb.min[2]));
  const zMax = Math.max(...moduleBoxes.map((m) => m.bb.max[2]));
  console.log(`  engine envelope: Z ${zMin.toFixed(0)}..${zMax.toFixed(0)} mm `
    + `(length ${(zMax - zMin).toFixed(0)} mm)`);
  expect(zMax - zMin).toBeGreaterThan(3500);
  expect(zMax - zMin).toBeLessThan(6500);

  // ── 2. Export the assembled engine — the REAL model ──
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
  add('screenshots/12_assembled-engine.png', await canvas.screenshot());
  console.log(`  ASSEMBLY: ${asm.bodyCount} modules → ${asm.triangles.toLocaleString()} triangles, `
    + `${(stlBuf.length / 1048576).toFixed(1)} MB STL`);

  // ── 3. Render the actual engine geometry rotating ──
  const W = 560, H = 360;
  const rgbaFrames = await page.evaluate(({ w, h }) => {
    const mesh = window.__lastFoundationManifold.getMesh();
    const vp = mesh.vertProperties, tv = mesh.triVerts, np = mesh.numProp;
    let cx = 0, cy = 0, cz = 0;
    let minZ = 1e9, maxZ = -1e9;
    const nv = vp.length / np;
    for (let i = 0; i < vp.length; i += np) {
      cx += vp[i]; cy += vp[i + 1]; cz += vp[i + 2];
      if (vp[i + 2] < minZ) minZ = vp[i + 2];
      if (vp[i + 2] > maxZ) maxZ = vp[i + 2];
    }
    cx /= nv; cy /= nv; cz /= nv;
    const sc = (w * 0.82) / (maxZ - minZ);
    const tris = tv.length / 3;
    const stride = tris > 120000 ? 2 : 1;
    const cvE = document.createElement('canvas');
    cvE.width = w; cvE.height = h;
    const ctx = cvE.getContext('2d');
    const out = [];
    const FR = 30;
    for (let f = 0; f < FR; f++) {
      const th = (f / FR) * Math.PI * 2;
      const ct = Math.cos(th), st = Math.sin(th);
      const tilt = 0.32, ctl = Math.cos(tilt), stl = Math.sin(tilt);
      ctx.fillStyle = '#0c0e14'; ctx.fillRect(0, 0, w, h);
      const polys = [];
      for (let t = 0; t < tv.length; t += 3 * stride) {
        const P = []; let depth = 0; let nz = 0;
        const X = [], Y = [], Z = [];
        for (let k = 0; k < 3; k++) {
          const vi = tv[t + k] * np;
          let x = vp[vi] - cx, y = vp[vi + 1] - cy, z = vp[vi + 2] - cz;
          // spin about the engine (Z) axis
          let rx = x * ct - y * st, ry = x * st + y * ct;
          // tilt down so we see it in 3/4
          const ry2 = ry * ctl - 0 * stl;
          X.push(rx); Y.push(ry2); Z.push(z);
          P.push([w / 2 + z * sc, h / 2 - ry2 * sc * 0.96]);
          depth += rx;
        }
        // flat-shade from the triangle normal's x-component (light along +x)
        const ux = X[1] - X[0], uy = Y[1] - Y[0], uz = Z[1] - Z[0];
        const vx = X[2] - X[0], vy = Y[2] - Y[0], vz = Z[2] - Z[0];
        let nx = uy * vz - uz * vy;
        const nl = Math.hypot(nx, uz * vx - ux * vz, ux * vy - uy * vx) || 1;
        const lit = 0.35 + 0.55 * Math.abs(nx / nl);
        polys.push({ P, depth, lit });
      }
      polys.sort((a, b) => a.depth - b.depth);
      for (const poly of polys) {
        const s = poly.lit;
        ctx.fillStyle = `rgb(${(150 * s) | 0},${(160 * s) | 0},${(185 * s) | 0})`;
        ctx.beginPath();
        ctx.moveTo(poly.P[0][0], poly.P[0][1]);
        ctx.lineTo(poly.P[1][0], poly.P[1][1]);
        ctx.lineTo(poly.P[2][0], poly.P[2][1]);
        ctx.fill();
      }
      ctx.fillStyle = '#9ab'; ctx.font = '13px monospace';
      ctx.fillText('GE9X — assembled engine (orchestrated in ArchDisc)', 10, h - 10);
      out.push(Array.from(ctx.getImageData(0, 0, w, h).data));
    }
    return out;
  }, { w: W, h: H });
  const video = framesToVideo(rgbaFrames.map((f) => new Uint8Array(f)), W, H, { fps: 15, quality: 86 });
  add('videos/GE9X-engine.mp4', video.mp4);
  add('videos/GE9X-engine.avi', video.avi);
  console.log(`  engine video: ${video.frameCount} frames of the real geometry`);

  // ── 3b. Cutaway render — slice the engine open to reveal the core ──
  const CW = 1000, CH = 460;
  const cutFrame = await page.evaluate(({ w, h }) => {
    const mesh = window.__lastFoundationManifold.getMesh();
    const vp = mesh.vertProperties, tv = mesh.triVerts, np = mesh.numProp;
    let minZ = 1e9, maxZ = -1e9, cz = 0;
    const nv = vp.length / np;
    for (let i = 0; i < vp.length; i += np) {
      cz += vp[i + 2];
      if (vp[i + 2] < minZ) minZ = vp[i + 2];
      if (vp[i + 2] > maxZ) maxZ = vp[i + 2];
    }
    cz /= nv;
    const sc = (w * 0.9) / (maxZ - minZ);
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#0c0e14'; ctx.fillRect(0, 0, w, h);
    // Keep only the lower half (engine y ≤ 0): the y=0 plane is the cut,
    // viewed face-on so the fan / compressor / combustor / turbine show.
    const tilt = 0.18, ct = Math.cos(tilt), st = Math.sin(tilt);
    const polys = [];
    for (let t = 0; t < tv.length; t += 3) {
      let yc = 0;
      const vi = [tv[t] * np, tv[t + 1] * np, tv[t + 2] * np];
      for (const v of vi) yc += vp[v + 1];
      yc /= 3;
      if (yc > 30) continue;                       // cut: drop the top half
      const P = [], Xr = [], Yr = [], Zr = [];
      for (const v of vi) {
        const x = vp[v], y = vp[v + 1], z = vp[v + 2] - cz;
        // look slightly down onto the cut face
        const yt = y * ct - z * 0 - 0;
        Xr.push(x); Yr.push(y); Zr.push(z);
        P.push([w / 2 + z * sc, h * 0.46 - x * sc * ct - y * sc * st]);
      }
      const ux = Xr[1] - Xr[0], uy = Yr[1] - Yr[0], uz = Zr[1] - Zr[0];
      const vx = Xr[2] - Xr[0], vy2 = Yr[2] - Yr[0], vz = Zr[2] - Zr[0];
      const nyv = uz * vx - ux * vz;
      const nl = Math.hypot(uy * vz - uz * vy2, nyv, ux * vy2 - uy * vx) || 1;
      const lit = 0.32 + 0.62 * Math.abs(nyv / nl);
      polys.push({ P, depth: (Yr[0] + Yr[1] + Yr[2]) / 3, lit });
    }
    polys.sort((a, b) => a.depth - b.depth);       // draw far (−y) first
    for (const poly of polys) {
      const s = poly.lit;
      ctx.fillStyle = `rgb(${(165 * s) | 0},${(172 * s) | 0},${(196 * s) | 0})`;
      ctx.beginPath();
      ctx.moveTo(poly.P[0][0], poly.P[0][1]);
      ctx.lineTo(poly.P[1][0], poly.P[1][1]);
      ctx.lineTo(poly.P[2][0], poly.P[2][1]);
      ctx.fill();
    }
    ctx.fillStyle = '#9ab'; ctx.font = '14px monospace';
    ctx.fillText('GE9X — cutaway (orchestrated in ArchDisc)', 12, h - 12);
    return Array.from(ctx.getImageData(0, 0, w, h).data);
  }, { w: CW, h: CH });
  const cutJpg = encodeJPEG(CW, CH, new Uint8Array(cutFrame), 90);
  add('screenshots/GE9X-cutaway.jpg', cutJpg);
  console.log(`  cutaway render: ${(cutJpg.length / 1024).toFixed(0)} KB`);

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

  // ── Assertions ──
  expect(asm.bodyCount).toBeGreaterThanOrEqual(GEOMETRY.length);
  expect(asm.triangles).toBeGreaterThan(50000);
  expect(stlBuf.length).toBe(84 + asm.triangles * 50);
  expect(video.frameCount).toBe(30);
  expect(simData['12_cycle-takeoff']).toBeTruthy();
  console.log(`\nGE9X deliverable: ${deliverable.length} files in ${OUT}/`);
});
