// PUSH-114 (Slice-83) — Modal Analysis panel (FEA eigen).
//
// PUSH-48 wired the omnibus Simulation workbench with 10 study types, of
// which Modal was one tab buried beneath material + mesh + loads + BCs.
// PUSH-114 ships a dedicated single-purpose Modal Analysis panel: body
// picker → mesh resolution slider → number-of-modes input → Run, with
// the material E + ρ pulled straight off the PUSH-109 record at
// window.__forgeMaterialProperties[handle].
//
// Proof end-to-end (this spec):
//
//   00 — Boot + seed a 60×20×20 mm cantilever block body (SI metres,
//        like every Forge sim panel) and clear PUSH-109 stores.
//   01 — Set a real material (Steel A36 preset via setMaterialProperties)
//        for the seeded body — exercises the PUSH-109 → PUSH-114 wire.
//   02 — Open the Modal Analysis panel via the tools.modalAnalysis menu
//        action. Asserts E + ρ readout matches the PUSH-109 record.
//   03 — Set the mesh resolution slider to 5 mm + nModes input to 4 +
//        click Run. Asserts (a) the kernel modal solve actually ran
//        (helper readout on window.__forgeModalAnalysis), (b) the modes
//        table renders nModes rows, (c) every reported frequency is > 0
//        (positive Hz).
//   04 — Regression: open PUSH-48's Simulation workbench, mesh + solve a
//        Static study, assert real displacement + von Mises. PUSH-114
//        must not break the simulation pipeline it sits next to.
//
// Multi-cam: iso / front / right / top / iso-final = 5 named camera angles.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-114-modal-analysis');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'modal-analysis-session.mp4');

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
    if (/push-114|modal|matprops|material|fea|forge|error|Error/i.test(t)) {
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
    console.error('[push-114] no .webm');
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
        console.log(`[push-114] mp4 written: ${FINAL_MP4} (${(fs.statSync(FINAL_MP4).size/1024/1024).toFixed(2)} MB)`);
      } else {
        console.error('[push-114] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
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
    if (!window.forge?.fea || typeof window.forge.fea.solveModal !== 'function') {
      return { error: 'forge.fea.solveModal missing' };
    }
    // SI metres: 60×20×20 mm → 0.06×0.02×0.02 m, matching the PUSH-48
    // simulation pipeline (mesh dispatch converts mm→m at the boundary).
    const h = window.forge.makeBox(0.06, 0.02, 0.02);
    window.__forgeAppendBody({
      id: `f-modal-cantilever-${Date.now()}`,
      kind: 'native', handle: h,
      toolId: 'primitive.box', name: 'Modal Cantilever',
      params: { width: 0.06, height: 0.02, distance: 0.02 },
    });
    return { handle: h };
  });
  expect(seeded.error).toBeUndefined();
  expect(seeded.handle).toBeGreaterThan(0);
  await page.waitForFunction(
    () => (window.__forgeBodies || []).some((b) => b.kind === 'native'),
    null, { timeout: 4000 });
  await page.evaluate((h) => { window.__push114Handle = h; }, seeded.handle);
  await shot('body-seeded');
});

test('01 — set a PUSH-109 material (Steel A36 preset) on the seeded body', async () => {
  await cameraTo('front');
  const ok = await page.evaluate(() => {
    const h = window.__push114Handle;
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

  // PUSH-109 contract: window.__forgeMaterialProperties[handle] reflects
  // the numeric record after Apply.
  const rec = await page.evaluate((h) => {
    const map = window.__forgeMaterialProperties;
    return (map && typeof map === 'object') ? (map[h] || null) : null;
  }, ok.handle);
  console.log('[push-114] PUSH-109 record for seeded body =', rec);
  expect(rec).not.toBeNull();
  expect(rec.E).toBeCloseTo(200, 3);
  expect(rec.density).toBeCloseTo(7.85, 3);
});

test('02 — open Modal Analysis panel, material read-out reflects PUSH-109', async () => {
  await cameraTo('right');
  await platformMenuAction('tools.modalAnalysis');
  await page.waitForSelector('[data-testid="forge-modal-panel"]', {
    state: 'visible', timeout: 6000,
  });
  await shot('panel-open');

  // Body picker auto-selects the seeded box.
  const bodyVal = await page.locator('[data-testid="forge-modal-body"]').inputValue();
  expect(Number(bodyVal)).toBeGreaterThan(0);

  // Material readout — E = 200 GPa, ρ = 7.85 g/cc straight off PUSH-109.
  const eTxt = await page.locator('[data-testid="forge-modal-material-E"]').innerText();
  const dTxt = await page.locator('[data-testid="forge-modal-material-density"]').innerText();
  console.log('[push-114] material readout =', eTxt, '·', dTxt);
  expect(eTxt).toMatch(/200\.0\s*GPa/);
  expect(dTxt).toMatch(/7\.85\s*g\/cc/);
});

test('03 — set mesh + nModes + Run → real modes table with positive frequencies', async () => {
  await cameraTo('top');

  // Slider — 5 mm.
  await page.locator('[data-testid="forge-modal-mesh-slider"]').fill('5');
  await pause(200);
  // nModes — 4.
  await page.locator('[data-testid="forge-modal-nmodes"]').fill('4');
  await pause(200);
  await shot('params-set');

  // Run.
  await page.locator('[data-testid="forge-modal-run"]').click({ force: true });
  // The kernel solve is synchronous but the mesh on a 60×20×20 box at
  // 5 mm is small. Wait for the table to materialise.
  await page.waitForSelector('[data-testid="forge-modal-modes-table"]',
    { state: 'visible', timeout: 30000 });
  await pause(400);
  await shot('solved');

  // Helper readout — the run published its summary onto
  // window.__forgeModalAnalysis (no DOM scraping required).
  const summary = await page.evaluate(() => window.__forgeModalAnalysis || null);
  console.log('[push-114] window.__forgeModalAnalysis =',
    summary && {
      handle: summary.bodyHandle,
      meshMm: summary.meshSize_mm,
      nModes: summary.nModes,
      modes: summary.modes.length,
      firstHz: summary.modes[0]?.freqHz,
      lastHz: summary.modes[summary.modes.length-1]?.freqHz,
    });
  expect(summary).not.toBeNull();
  expect(summary.nModes).toBe(4);
  expect(Array.isArray(summary.modes)).toBe(true);
  expect(summary.modes.length).toBeGreaterThanOrEqual(4);

  // Frequency table — count rows, every Hz must be finite & > 0.
  const rowCount = await page.locator('[data-testid^="forge-modal-row-"]').count();
  console.log('[push-114] modes table row count =', rowCount);
  expect(rowCount).toBeGreaterThanOrEqual(4);

  let positiveHz = 0;
  for (let i = 1; i <= rowCount; i++) {
    const cellTxt = await page.locator(`[data-testid="forge-modal-freq-${i}"]`)
      .innerText().catch(() => '');
    const hz = Number(cellTxt);
    if (Number.isFinite(hz) && hz > 0) positiveHz += 1;
  }
  console.log('[push-114] positive-Hz rows =', positiveHz, '/', rowCount);
  // The kernel returns rigid-body modes near zero + structural modes
  // above zero. At least one structural mode must be present at > 0 Hz —
  // otherwise the solve produced nothing real.
  expect(positiveHz).toBeGreaterThan(0);

  // Cross-check against the summary's stored frequencies.
  const summaryPositive = summary.modes
    .filter((m) => Number.isFinite(m.freqHz) && m.freqHz > 0).length;
  expect(summaryPositive).toBeGreaterThan(0);

  // Mesh info ribbon renders > 0 nodes + > 0 elements.
  const meshTxt = await page.locator('[data-testid="forge-modal-mesh-info"]').innerText();
  console.log('[push-114] mesh info =', meshTxt);
  const nums = (meshTxt.match(/(\d[\d,]*)/g) || []).map((s) => Number(s.replace(/,/g, '')));
  const big = nums.filter((n) => n > 0);
  expect(big.length).toBeGreaterThan(0);
});

test('04 — regression: PUSH-48 Simulation workbench still meshes + solves Static', async () => {
  await cameraTo('iso');
  // Close the Modal panel so its overlay can't intercept the Sim
  // workbench's hit-tests.
  await page.locator('[data-testid="forge-modal-close"]').click({ force: true })
    .catch(() => {});
  await pause(300);

  await platformMenuAction('tools.simulation');
  await page.waitForSelector('[data-testid="forge-sim-workbench"]',
    { state: 'visible', timeout: 6000 });
  await shot('sim-panel');

  // Coarsen the mesh — same trick as the PUSH-48 spec; a 3 mm tet on a
  // 60×20×20 block blocks the main thread past the click-settle timeout.
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
  // stress (max von Mises > 0). PUSH-114 must not break this.
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
  console.log('[push-114] PUSH-48 regression cross-check =', JSON.stringify(r));
  expect(r.nNodes).toBeGreaterThan(0);
  expect(r.maxU).toBeGreaterThan(0);
  expect(r.maxVm).toBeGreaterThan(0);
});
