import { test, expect } from '@playwright/test';
import { framesToVideo } from '../frontend/src/foundation/VideoMux.js';
import fs from 'fs';
import path from 'path';

/*
 * GE9X — built end-to-end by ORCHESTRATION.
 *
 * The engine is a PLAN (pure data: {tool, params} steps) of general
 * ArchDisc tools, run through the real application. There is no
 * GE9X-specific code — the "GE9X-ness" lives entirely in this data.
 * The same machinery would build any other machine from a different
 * plan.
 *
 * Deliverable: platform screenshots, a bird-strike .mp4/.avi rendered
 * by the in-platform video pipeline, geometry, raw simulation data —
 * packaged into ge9x-deliverable.zip.
 */

const OUT = 'ge9x-deliverable';

// Profile helpers — still plan DATA, just computed.
const tube = (rIn, rOut, H) => [[rIn, 0], [rOut, 0], [rOut, H], [rIn, H]];
const coneP = (rBase, H) => [[0, 0], [rBase, 0], [0, H]];
const Z90 = [90, 0, 0];   // rotate a Y-axial revolve onto the engine (+Z) axis

// ── THE PLAN — pure data ───────────────────────────────────────────
const GE9X_PLAN = [
  // Geometry: revolved casings/cones + general blade rows, each placed
  // by translate. Engine axis = +Z.
  { tab: 'Part', tool: 'Revolve Boss', label: '01_nacelle',
    params: { profile: tube(1780, 1880, 3800), rotate: Z90, translate: [0, 0, -300] } },
  { tab: 'Part', tool: 'Revolve Boss', label: '02_fan-case',
    params: { profile: tube(1710, 1770, 1300), rotate: Z90, translate: [0, 0, -150] } },
  { tab: 'Part', tool: 'Revolve Boss', label: '03_spinner',
    params: { profile: coneP(360, 560), rotate: [-90, 0, 0], translate: [0, 0, 60] } },
  { tab: 'Part', tool: 'Blade Row', label: '04_fan',
    params: { count: 16, rHub: 360, rTip: 1702, chordHub: 320, chordTip: 520,
      thickRatio: 0.09, staggerHub: 1.0, staggerTip: 0.4, translate: [0, 0, 250] } },
  { tab: 'Part', tool: 'Blade Row', label: '05_booster',
    params: { count: 38, rHub: 380, rTip: 560, chordHub: 90, chordTip: 80,
      thickRatio: 0.1, staggerHub: 0.8, staggerTip: 0.5, translate: [0, 0, 900] } },
  { tab: 'Part', tool: 'Revolve Boss', label: '06_core-casing',
    params: { profile: tube(600, 690, 2400), rotate: Z90, translate: [0, 0, 1300] } },
  { tab: 'Part', tool: 'Blade Row', label: '07_hpc',
    params: { count: 54, rHub: 430, rTip: 560, chordHub: 70, chordTip: 60,
      thickRatio: 0.08, staggerHub: 0.7, staggerTip: 0.5, translate: [0, 0, 1700] } },
  { tab: 'Part', tool: 'Revolve Boss', label: '08_combustor',
    params: { profile: tube(430, 660, 460), rotate: Z90, translate: [0, 0, 2350] } },
  { tab: 'Part', tool: 'Blade Row', label: '09_hpt',
    params: { count: 76, rHub: 470, rTip: 720, chordHub: 95, chordTip: 90,
      thickRatio: 0.18, staggerHub: 0.7, staggerTip: 0.5, translate: [0, 0, 2900] } },
  { tab: 'Part', tool: 'Blade Row', label: '10_lpt',
    params: { count: 90, rHub: 520, rTip: 980, chordHub: 110, chordTip: 100,
      thickRatio: 0.18, staggerHub: 0.7, staggerTip: 0.45, translate: [0, 0, 3500] } },
  { tab: 'Part', tool: 'Revolve Boss', label: '11_exhaust-nozzle',
    params: { profile: [[280, 0], [700, 0], [540, 520], [280, 520]], rotate: Z90, translate: [0, 0, 4000] } },

  // Simulations — the real-world test scenarios.
  { tab: 'Simulate', tool: 'Brayton Cycle', label: '12_cycle-takeoff', slot: '__lastBraytonResult',
    params: { altitudeM: 0, machNumber: 0.25, bypassRatio: 9.9, fanPR: 1.5,
      compressorPR: 40, T4_K: 1850, massFlowKgS: 1700 } },
  { tab: 'Simulate', tool: 'Compressor Stage', label: '13_hpc-stage', slot: '__lastCompressorResult',
    params: { massFlowKgS: 160, rpm: 9300, r_tip_m: 0.56, hubToTip: 0.77 } },
  { tab: 'Simulate', tool: 'Combustor', label: '14_combustor', slot: '__lastCombustorResult',
    params: { massFlowKgS: 160, T_t3_K: 900, P_t3_Pa: 4.5e6, T_t4_K: 1850 } },
  { tab: 'Simulate', tool: 'Blade Cooling', label: '15_hpt-cooling', slot: '__lastBladeCoolingResult',
    params: { T_gas_K: 1850, T_coolant_K: 900 } },
  { tab: 'Simulate', tool: 'Rotordynamics', label: '16_rotordynamics', slot: '__lastRotordynResult',
    params: {} },
  { tab: 'Simulate', tool: 'Impact Simulation', label: '17_bird-strike', slot: '__lastImpactSim',
    params: { gridN: 13, panelSize_mm: 340, stiffness: 11000, breakStrain: 0.22,
      impactSpeed_ms: 130, impactorMass_kg: 1.8, damping: 1.4 } },
];

test('GE9X — built end-to-end by orchestration', async ({ page }) => {
  test.setTimeout(600000);
  for (const d of ['screenshots', 'videos', 'geometry', 'data']) {
    fs.mkdirSync(path.join(OUT, d), { recursive: true });
  }
  const deliverable = [];
  const add = (p, data) => { fs.writeFileSync(path.join(OUT, p), data); deliverable.push({ path: p, data }); };

  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(2500);
  const canvas = page.locator('canvas').first();

  const simData = {};
  let stepsOk = 0;
  for (const step of GE9X_PLAN) {
    await page.locator('.ribbon-tab', { hasText: step.tab }).first().click();
    await page.waitForTimeout(350);
    await page.evaluate(({ t, p }) => {
      window.__archdiscPlanParams = window.__archdiscPlanParams || {};
      window.__archdiscPlanParams[t] = p;
    }, { t: step.tool, p: step.params });
    await page.locator('.ribbon-tool-label', { hasText: new RegExp(`^${step.tool}$`) }).first().click();

    const slot = step.slot ?? '__lastFoundationManifold';
    await page.waitForFunction((k) => !!window[k], slot, { timeout: 60000 });
    await page.waitForTimeout(600);

    add(`screenshots/${step.label}.png`, await canvas.screenshot());
    if (step.slot) {
      simData[step.label] = await page.evaluate((k) => {
        const v = window[k];
        try { return JSON.parse(JSON.stringify(v)); } catch { return { ok: true }; }
      }, step.slot);
    }
    stepsOk++;
    console.log(`  [${stepsOk}/${GE9X_PLAN.length}] ${step.tool} — ${step.label}`);
  }
  expect(stepsOk).toBe(GE9X_PLAN.length);

  // ── Bird-strike video — render the deforming panel to RGBA frames ──
  const W = 360, H = 270;
  const rgbaFrames = await page.evaluate(({ w, h }) => {
    const sim = window.__lastImpactSim;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    const out = [];
    for (const fr of sim.frames) {
      ctx.fillStyle = '#0c0e14'; ctx.fillRect(0, 0, w, h);
      // 3/4 view: project (x,y,z) metres → screen.
      const sc = 520;
      const proj = (p) => [w / 2 + (p[0] - sim.panelSize_m / 2) * sc + p[2] * sc * 0.35,
        h / 2 + (p[1] - sim.panelSize_m / 2) * sc - p[2] * sc * 0.62];
      for (const np of fr.nodePos) {
        const [sx, sy] = proj(np);
        const defl = Math.min(1, Math.abs(np[2]) / 0.05);
        ctx.fillStyle = `rgb(${(60 + 195 * defl) | 0},${(120 - 90 * defl) | 0},${(200 - 150 * defl) | 0})`;
        ctx.fillRect(sx - 2, sy - 2, 4, 4);
      }
      if (fr.impactorPos) {
        const [ix, iy] = proj(fr.impactorPos);
        ctx.fillStyle = '#e8c84a';
        ctx.beginPath(); ctx.arc(ix, iy, 9, 0, 7); ctx.fill();
      }
      ctx.fillStyle = '#8aa'; ctx.font = '12px monospace';
      ctx.fillText(`GE9X bird strike  t=${(fr.t * 1000).toFixed(1)} ms`, 8, h - 8);
      out.push(Array.from(ctx.getImageData(0, 0, w, h).data));
    }
    return out;
  }, { w: W, h: H });
  const video = framesToVideo(rgbaFrames.map((f) => new Uint8Array(f)), W, H, { fps: 20, quality: 85 });
  add('videos/bird-strike.mp4', video.mp4);
  add('videos/bird-strike.avi', video.avi);
  console.log(`  bird-strike video: ${video.frameCount} frames, mp4 ${(video.mp4.length / 1024).toFixed(0)} KB`);

  // ── Geometry export — drive the platform's export tools ──
  await page.locator('.ribbon-tab', { hasText: 'Manufacture' }).first().click();
  await page.waitForTimeout(350);
  await page.locator('.ribbon-tool-label', { hasText: /^Export STL$/ }).first().click();
  await page.waitForFunction(() => !!window.__lastSTLBytes, null, { timeout: 30000 });
  const stl = await page.evaluate(() => Array.from(window.__lastSTLBytes));
  add('geometry/ge9x-last-module.stl', Buffer.from(stl));

  // ── Raw simulation data + manifest ──
  add('data/simulations.json', JSON.stringify(simData, null, 2));
  add('README.txt',
    'GE9X — engineering deliverable\n\n'
    + 'Built end-to-end by ArchDisc ORCHESTRATION: a pure-data plan of\n'
    + 'general tool calls run through the platform. No GE9X-specific code.\n\n'
    + '  screenshots/  platform screenshots, one per orchestration step\n'
    + '  videos/       bird-strike simulation — .mp4 + .avi (in-platform MJPEG)\n'
    + '  geometry/     exported geometry\n'
    + '  data/         raw simulation results\n');

  // The deliverable files are written to ge9x-deliverable/ — the build
  // step packs them into ge9x-deliverable.zip via foundation/ZipArchive.
  console.log(`\nGE9X deliverable: ${deliverable.length} files in ge9x-deliverable/`);

  // ── Assertions ──
  expect(simData['12_cycle-takeoff']).toBeTruthy();
  expect(simData['17_bird-strike'].frames.length).toBeGreaterThan(10);
  expect(video.frameCount).toBeGreaterThan(10);
  expect(deliverable.length).toBeGreaterThan(20);
});
