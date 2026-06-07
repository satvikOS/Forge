// PUSH-119 (Slice-87) — Fatigue Analysis (S-N curve) panel.
//
// PUSH-48 wired the omnibus Simulation workbench. Forge-212 added a load-
// block driven Fatigue Life workbench at tools.fatigue. Neither closed the
// loop from a real body's material + most-recent static FEA stress back
// to "how many cycles will this part survive?".
//
// PUSH-119 ships a dedicated single-purpose Fatigue Analysis (S-N curve)
// panel reachable via tools.fatigueAnalysis:
//
//   • Body picker (defaults to selection).
//   • σY + σU readout off the PUSH-109 material record at
//     window.__forgeMaterialProperties[handle].
//   • S-N material picker (kernel forge.fatigue.materialDefaults names).
//   • σ_a stress amplitude input — typed OR pulled from PUSH-48's last
//     solve (window.__forgeSimulationLast.maxVonMises in Pa).
//   • σ_m mean-stress input.
//   • Correction selector: None / Goodman / Soderberg.
//   • Compute Nf → forge.fatigue.cyclesToFailure(σ_eff, σ'_f, b).
//   • Result block: Nf (linear + log10), σ_eff, regime label.
//
// Proof end-to-end (this spec):
//
//   00 — Boot + seed a 60×20×20 mm cantilever block (SI metres), clear
//        PUSH-109 stores so a prior run can't bleed in stale material.
//   01 — Apply PUSH-109 Steel A36 preset (σY = 250 MPa, σU = 400 MPa) on
//        the seeded body — exercises the PUSH-109 → PUSH-119 wire.
//   02 — Open the Fatigue Analysis panel via tools.fatigueAnalysis. Assert
//        σY = 250 MPa + σU = 400 MPa readouts match PUSH-109.
//   03 — Run with None correction at σ_a = 200 MPa → Nf > 0 + helper readout
//        on window.__forgeFatigueAnalysis matches the kernel call.
//   04 — Run with Goodman correction at σ_a = 200, σ_m = 100 MPa → σ_eff
//        = 200/(1 - 100/400) = 266.67 MPa → Nf strictly less than the
//        None-correction result.
//   05 — Run with Soderberg correction at σ_a = 200, σ_m = 100 MPa → σ_eff
//        = 200/(1 - 100/250) = 333.33 MPa → Nf strictly less than Goodman.
//   06 — Pull max von Mises from PUSH-48: seed window.__forgeSimulationLast
//        with maxVonMises = 250e6 Pa (= 250 MPa), click "Pull max von
//        Mises" → σ_a input updates to 250.
//   07 — Regression: PUSH-48 Simulation workbench still meshes + solves a
//        Static study, real deflection + von Mises returned by the kernel.
//
// Multi-cam: iso / front / right / top / iso-final = 5 named camera angles.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-119-fatigue-analysis');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'fatigue-analysis-session.mp4');

let app, page;
let stepIndex = 0;

async function shot(label) {
  stepIndex += 1;
  const name = String(stepIndex).padStart(3, '0') + '-' +
    label.replace(/[^a-z0-9-_.]/gi, '_');
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(OUTPUT_DIR, `${name}.png`), fullPage: true });
}

async function pause(ms = 350) { await page.waitForTimeout(ms); }

async function platformMenuAction(actionId) {
  await page.evaluate((id) => {
    window.dispatchEvent(new CustomEvent('forge:menu-action', { detail: { id } }));
  }, actionId);
  await pause(500);
}

async function cameraTo(viewName) {
  await platformMenuAction(`view.${viewName}`);
  await pause(300);
}

test.beforeAll(async () => {
  fs.mkdirSync(VIDEO_DIR, { recursive: true });
  app = await electron.launch({
    args: [path.resolve(__dirname, '..')], timeout: 60000,
    recordVideo: { dir: VIDEO_DIR, size: { width: 1920, height: 1080 } },
  });
  page = await app.firstWindow();
  page.on('console', (msg) => {
    const t = msg.text();
    if (/push-119|fatigue|matprops|material|fea|forge|error|Error/i.test(t)) {
      console.log('[browser]', t);
    }
  });
  await page.waitForLoadState('domcontentloaded');
  await pause(3000);
  const setBtn = page.locator('button:has-text("Set")');
  if (await setBtn.count() > 0) await setBtn.first().click({ timeout: 3000 }).catch(() => {});
  else await page.keyboard.press('Escape');
  const discard = page.locator('button:has-text("Discard")');
  if (await discard.count() > 0) await discard.first().click({ timeout: 3000 }).catch(() => {});
  await pause(800);

  // Reset PUSH-109 + PUSH-61 stores so a prior run can't bleed a stale
  // material record onto our seeded body.
  await page.evaluate(() => {
    try { window.localStorage.removeItem('forge.v4.materialProps'); } catch {}
    try { window.localStorage.removeItem('forge.v4.bodyMaterials'); } catch {}
    const mp = window.__forgeMaterialPropertiesHelper;
    if (mp && typeof mp.clearMaterialProperties === 'function') {
      mp.clearMaterialProperties();
    }
    const bm = window.__forgeBodyMaterialsHelper;
    if (bm && typeof bm.clearBodyMaterials === 'function') {
      bm.clearBodyMaterials();
    }
    // Clear any prior fatigue / simulation publish.
    delete window.__forgeFatigueAnalysis;
    delete window.__forgeSimulationLast;
  });
});

test.afterAll(async () => {
  try { await pause(2000); } catch {}
  let videoPath = null;
  try { videoPath = await page.video()?.path(); } catch {}
  if (app) {
    try { await app.close({ timeout: 10000 }); }
    catch { try { (await app.process()).kill('SIGKILL'); } catch {} }
  }
  await new Promise((r) => setTimeout(r, 1200));
  if (!videoPath || !fs.existsSync(videoPath)) {
    const cands = fs.existsSync(VIDEO_DIR)
      ? fs.readdirSync(VIDEO_DIR).filter((f) => f.endsWith('.webm'))
      : [];
    if (cands.length > 0) videoPath = path.join(VIDEO_DIR, cands[0]);
  }
  if (!videoPath || !fs.existsSync(videoPath)) {
    console.error('[push-119] no .webm');
    return;
  }
  try { fs.unlinkSync(FINAL_MP4); } catch {}
  const ffmpegBin = require('ffmpeg-static');
  await new Promise((resolve) => {
    const args = ['-y', '-i', videoPath, '-c:v', 'libx264', '-preset', 'medium',
      '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', FINAL_MP4];
    const child = spawn(ffmpegBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = ''; child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('close', (code) => {
      if (code === 0 && fs.existsSync(FINAL_MP4)) {
        console.log(`[push-119] mp4 written: ${FINAL_MP4} (${(fs.statSync(FINAL_MP4).size/1024/1024).toFixed(2)} MB)`);
      } else {
        console.error('[push-119] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
      }
      resolve();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────

test('00 — boot + seed a 60×20×20 mm cantilever block (SI metres)', async () => {
  await cameraTo('iso');
  await shot('boot');
  const seeded = await page.evaluate(() => {
    if (!window.forge?.makeBox || typeof window.__forgeAppendBody !== 'function') {
      return { error: 'forge.makeBox / __forgeAppendBody missing' };
    }
    if (!window.forge?.fatigue
        || typeof window.forge.fatigue.cyclesToFailure !== 'function'
        || typeof window.forge.fatigue.materialDefaults !== 'function') {
      return { error: 'forge.fatigue.* surface missing' };
    }
    if (!window.forge?.fea || typeof window.forge.fea.solveStatic !== 'function') {
      return { error: 'forge.fea.solveStatic missing' };
    }
    if (!window.__forgeFatigueAnalysisHelper) {
      return { error: 'window.__forgeFatigueAnalysisHelper not installed' };
    }
    // SI metres: 60×20×20 mm → 0.06×0.02×0.02 m, matching the PUSH-48
    // simulation pipeline (the mesh dispatch converts mm→m at the boundary).
    const h = window.forge.makeBox(0.06, 0.02, 0.02);
    window.__forgeAppendBody({
      id: `f-fatigue-cantilever-${Date.now()}`,
      kind: 'native', handle: h,
      toolId: 'primitive.box', name: 'Fatigue Cantilever',
      params: { width: 0.06, height: 0.02, distance: 0.02 },
    });
    return { handle: h };
  });
  expect(seeded.error).toBeUndefined();
  expect(seeded.handle).toBeGreaterThan(0);
  await page.waitForFunction(
    () => (window.__forgeBodies || []).some((b) => b.kind === 'native'),
    null, { timeout: 4000 });
  await page.evaluate((h) => { window.__push119Handle = h; }, seeded.handle);
  await shot('body-seeded');
});

test('01 — set a PUSH-109 material (Steel A36 preset) on the seeded body', async () => {
  await cameraTo('front');
  const ok = await page.evaluate(() => {
    const h = window.__push119Handle;
    const mp = window.__forgeMaterialPropertiesHelper;
    if (!mp || typeof mp.setMaterialProperties !== 'function') return { error: 'helper missing' };
    const PRESETS = mp.PRESETS;
    if (!PRESETS || !PRESETS['Steel A36']) return { error: 'Steel A36 preset missing' };
    return {
      written: mp.setMaterialProperties(h, { preset: 'Steel A36', ...PRESETS['Steel A36'] }),
      handle: h,
    };
  });
  expect(ok.error).toBeUndefined();
  expect(ok.written).toBe(true);

  const rec = await page.evaluate((h) => {
    const map = window.__forgeMaterialProperties;
    return (map && typeof map === 'object') ? (map[h] || null) : null;
  }, ok.handle);
  console.log('[push-119] PUSH-109 record for seeded body =', rec);
  expect(rec).not.toBeNull();
  expect(rec.sigmaY).toBeCloseTo(250, 3);
  expect(rec.sigmaU).toBeCloseTo(400, 3);
});

test('02 — open Fatigue Analysis panel, material read-out reflects PUSH-109', async () => {
  await cameraTo('right');
  await platformMenuAction('tools.fatigueAnalysis');
  await page.waitForSelector('[data-testid="forge-fatigue-analysis-panel"]', {
    state: 'visible', timeout: 6000,
  });
  await shot('panel-open');

  const bodyVal = await page.locator('[data-testid="forge-fatigue-analysis-body"]').inputValue();
  expect(Number(bodyVal)).toBeGreaterThan(0);

  const yTxt = await page.locator('[data-testid="forge-fatigue-analysis-material-sigmaY"]').innerText();
  const uTxt = await page.locator('[data-testid="forge-fatigue-analysis-material-sigmaU"]').innerText();
  console.log('[push-119] material readout =', yTxt, '·', uTxt);
  expect(yTxt).toMatch(/250\s*MPa/);
  expect(uTxt).toMatch(/400\s*MPa/);
});

test('03 — None correction · σ_a = 200 MPa → real Nf from kernel', async () => {
  await cameraTo('top');
  await page.locator('[data-testid="forge-fatigue-analysis-sigma-a"]').fill('200');
  await page.locator('[data-testid="forge-fatigue-analysis-sigma-m"]').fill('0');
  await page.locator('[data-testid="forge-fatigue-analysis-correction-none"]').check({ force: true });
  await pause(200);
  await shot('none-params');

  await page.locator('[data-testid="forge-fatigue-analysis-run"]').click({ force: true });
  await page.waitForSelector('[data-testid="forge-fatigue-analysis-result"]', {
    state: 'visible', timeout: 6000,
  });
  await pause(200);
  await shot('none-solved');

  const summary = await page.evaluate(() => window.__forgeFatigueAnalysis || null);
  console.log('[push-119] None-correction summary =', summary && {
    Nf: summary.Nf, log10Nf: summary.log10Nf, sigma_eff: summary.sigma_eff_MPa,
    sigmaF: summary.sigmaFCoef, b: summary.bExponent, regime: summary.regime,
  });
  expect(summary).not.toBeNull();
  expect(summary.error).toBeUndefined();
  expect(summary.Nf).toBeGreaterThan(0);
  expect(summary.log10Nf).toBeGreaterThan(0);
  expect(summary.sigma_eff_MPa).toBeCloseTo(200, 3);
  // mild-steel: σ'_f = 1000, b = -0.085.
  expect(summary.sigmaFCoef).toBeCloseTo(1000, 1);
  expect(summary.bExponent).toBeCloseTo(-0.085, 4);

  // Direct kernel cross-check — Nf must match forge.fatigue.cyclesToFailure
  // called with the same arguments.
  const kernelNf = await page.evaluate(() => {
    return window.forge.fatigue.cyclesToFailure(200, 1000, -0.085);
  });
  expect(summary.Nf).toBeCloseTo(kernelNf, -2); // closeTo with -2 → match within 50 units
  console.log('[push-119] kernel cross-check Nf =', kernelNf);

  // Stash for the next-test ratio assertion.
  await page.evaluate((nf) => { window.__push119NoneNf = nf; }, summary.Nf);
});

test('04 — Goodman correction · σ_a = 200, σ_m = 100 → σ_eff = 266.67 MPa, Nf < None', async () => {
  await cameraTo('iso');
  await page.locator('[data-testid="forge-fatigue-analysis-sigma-a"]').fill('200');
  await page.locator('[data-testid="forge-fatigue-analysis-sigma-m"]').fill('100');
  await page.locator('[data-testid="forge-fatigue-analysis-correction-goodman"]').check({ force: true });
  await pause(200);
  await shot('goodman-params');

  await page.locator('[data-testid="forge-fatigue-analysis-run"]').click({ force: true });
  await pause(400);
  await shot('goodman-solved');

  const summary = await page.evaluate(() => window.__forgeFatigueAnalysis || null);
  console.log('[push-119] Goodman summary =', summary && {
    Nf: summary.Nf, sigma_eff: summary.sigma_eff_MPa, correction: summary.correction,
  });
  expect(summary).not.toBeNull();
  expect(summary.error).toBeUndefined();
  expect(summary.correction).toBe('goodman');
  // σ_eff = 200 / (1 - 100/400) = 200 / 0.75 = 266.67 MPa.
  expect(summary.sigma_eff_MPa).toBeCloseTo(266.6666666, 3);

  const noneNf = await page.evaluate(() => window.__push119NoneNf);
  expect(summary.Nf).toBeLessThan(noneNf);
  await page.evaluate((nf) => { window.__push119GoodmanNf = nf; }, summary.Nf);
});

test('05 — Soderberg correction · σ_a = 200, σ_m = 100 → σ_eff = 333.33 MPa, Nf < Goodman', async () => {
  await cameraTo('front');
  await page.locator('[data-testid="forge-fatigue-analysis-sigma-a"]').fill('200');
  await page.locator('[data-testid="forge-fatigue-analysis-sigma-m"]').fill('100');
  await page.locator('[data-testid="forge-fatigue-analysis-correction-soderberg"]').check({ force: true });
  await pause(200);
  await shot('soderberg-params');

  await page.locator('[data-testid="forge-fatigue-analysis-run"]').click({ force: true });
  await pause(400);
  await shot('soderberg-solved');

  const summary = await page.evaluate(() => window.__forgeFatigueAnalysis || null);
  console.log('[push-119] Soderberg summary =', summary && {
    Nf: summary.Nf, sigma_eff: summary.sigma_eff_MPa, correction: summary.correction,
  });
  expect(summary).not.toBeNull();
  expect(summary.error).toBeUndefined();
  expect(summary.correction).toBe('soderberg');
  // σ_eff = 200 / (1 - 100/250) = 200 / 0.6 = 333.33 MPa.
  expect(summary.sigma_eff_MPa).toBeCloseTo(333.3333333, 3);

  const goodmanNf = await page.evaluate(() => window.__push119GoodmanNf);
  expect(summary.Nf).toBeLessThan(goodmanNf);
});

test('06 — Pull max von Mises from PUSH-48 stub → σ_a input updates', async () => {
  await cameraTo('right');
  // Seed the PUSH-48 publish slot the panel reads from.
  await page.evaluate(() => {
    window.__forgeSimulationLast = { maxVonMises: 250e6 };   // Pa → 250 MPa
  });
  await page.locator('[data-testid="forge-fatigue-analysis-pull-vm"]').click({ force: true });
  await pause(400);
  await shot('pulled-vm');
  const sigmaAVal = await page.locator('[data-testid="forge-fatigue-analysis-sigma-a"]').inputValue();
  console.log('[push-119] σ_a after Pull =', sigmaAVal);
  expect(Number(sigmaAVal)).toBeCloseTo(250, 1);
});

test('07 — regression: PUSH-48 Simulation workbench still meshes + solves Static', async () => {
  await cameraTo('iso');
  // Close the Fatigue Analysis panel so its overlay can't intercept the Sim
  // workbench's hit-tests.
  await page.locator('[data-testid="forge-fatigue-analysis-close"]').click({ force: true })
    .catch(() => {});
  await pause(300);

  await platformMenuAction('tools.simulation');
  await page.waitForSelector('[data-testid="forge-sim-workbench"]',
    { state: 'visible', timeout: 6000 });
  await shot('sim-panel');

  // Coarsen the mesh — same trick as the PUSH-48 + PUSH-114 specs.
  await page.locator('[data-testid="forge-sim-elem-size-slider"]').fill('5');
  await pause(200);
  const discard2 = page.locator('button:has-text("Discard")');
  if (await discard2.count() > 0) await discard2.first().click({ timeout: 2000 }).catch(() => {});
  await pause(200);
  await page.locator('[data-testid="forge-sim-mesh-now"]')
    .click({ force: true, noWaitAfter: true });
  await pause(2500);
  const info = page.locator('[data-testid="forge-sim-mesh-info"]');
  await expect(info).toBeVisible({ timeout: 15000 });
  await page.locator('[data-testid="forge-sim-solve"]')
    .click({ force: true, noWaitAfter: true });
  await pause(3000);
  await shot('sim-solved');

  // Cross-check the kernel directly — identical to PUSH-48's assertion:
  // a cantilever under load must deflect (max |u| > 0) and develop
  // stress (max von Mises > 0). PUSH-119 must not break this.
  const r = await page.evaluate(() => {
    const f = window.forge;
    const h = f.makeBox(60, 20, 20);
    const mesh = f.fea.meshFromBrep(h, 8);
    const nodes = mesh.nodes || mesh.coords || [];
    const nNodes = mesh.nodeCount ?? (Array.isArray(nodes) ? nodes.length / 3 : 0);
    const bcs = []; const loads = [];
    for (let i = 0; i < nNodes; i++) {
      const x = nodes[i * 3 + 0];
      if (x <= 0.001) bcs.push({ node: i, dof: [true, true, true] });
      if (x >= 59.999) loads.push({ node: i, fx: 0, fy: -50, fz: 0 });
    }
    const mat = { E: 210e9, nu: 0.3, rho: 7850, yield: 250e6 };
    const res = f.fea.solveStatic(mesh, mat, loads, [], bcs);
    let maxU = 0, maxVm = 0;
    const disp = res.displacements || res.u || [];
    for (let i = 0; i < disp.length; i++) maxU = Math.max(maxU, Math.abs(disp[i]));
    const vm = res.vonMises || res.stress || [];
    for (let i = 0; i < vm.length; i++) maxVm = Math.max(maxVm, vm[i]);
    return { nNodes, maxU, maxVm };
  });
  console.log('[push-119] PUSH-48 regression cross-check =', JSON.stringify(r));
  expect(r.nNodes).toBeGreaterThan(0);
  expect(r.maxU).toBeGreaterThan(0);
  expect(r.maxVm).toBeGreaterThan(0);
});
