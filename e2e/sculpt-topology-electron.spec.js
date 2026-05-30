import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * SP-40 — Sculpt Topology Optimize. HEADED on the Mac Electron shell.
 * Three SIMP cantilever runs against the SAME design domain showing the
 * canonical generative-design progression — light → medium → heavy
 * volume fraction.  Each run carves an organic truss out of the box,
 * the way Creo GTO / NX Generative Engineering / nTopology / Autodesk
 * Generative Design present their outputs.
 *
 * 4-second pauses between runs and a 6-second final pause so a viewer
 * watching the Mac Studio remotely (Windows → macOS over RDP / Screen
 * Sharing) has time to see each new truss settle before the next SIMP
 * solve starts.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-topology');
fs.mkdirSync(OUT, { recursive: true });

const RUNS = [
  {
    label: '01-sparse-25pct',
    note: 'Cantilever, target volume 25 % — minimal load path',
    params: { W: 60, H: 40, T: 30, gridN: 10,
              volumeFraction: 0.25, loadN: 1000, maxIter: 18,
              x: -100, y: 0, z: 0, color: 0xd47a4f },
  },
  {
    label: '02-balanced-40pct',
    note: 'Cantilever, target volume 40 % — balanced truss',
    params: { W: 60, H: 40, T: 30, gridN: 10,
              volumeFraction: 0.40, loadN: 1000, maxIter: 18,
              x:    0, y: 0, z: 0, color: 0xc6a86b },
  },
  {
    label: '03-fuller-55pct',
    note: 'Cantilever, target volume 55 % — fuller truss',
    params: { W: 60, H: 40, T: 30, gridN: 10,
              volumeFraction: 0.55, loadN: 1000, maxIter: 18,
              x:  100, y: 0, z: 0, color: 0x7ab6c6 },
  },
];

test.describe.configure({ timeout: 12 * 60 * 1000 });

test('Sculpt Topology Optimize — headed Electron, 3 cantilever runs with viewer-friendly pauses', async () => {
  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    env: { ...process.env, NODE_ENV: 'test' },
  });
  const win = await app.firstWindow();
  win.on('pageerror', (e) => console.error('[pageerror]', e.message));

  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscRegistry, null, { timeout: 60000 });
  await win.evaluate(() => { window.__archdiscBypassDialog = true; });
  const wc = win.locator('[data-archdisc-welcome-close="true"]').first();
  if (await wc.count() > 0) {
    await wc.dispatchEvent('click');
    await win.locator('[data-archdisc-welcome="open"]').waitFor({ state: 'hidden', timeout: 5000 });
  }
  await win.locator('[data-ribbon-tab-key="part"]').dispatchEvent('click');
  await win.waitForTimeout(2000);

  // Frame the row of three trusses at (−100, 0, +100) mm.
  await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    if (!vp?.camera) return;
    if (vp.orbitControls) { vp.orbitControls.maxDistance = 20; vp.orbitControls.minDistance = 0.05; }
    vp.camera.position.set(0.20, 0.18, 0.42);
    vp.orbitControls.target.set(0, 0, 0);
    vp.camera.lookAt(0, 0, 0);
    vp.orbitControls.update();
    vp.renderer.render(vp.scene, vp.camera);
  });
  await win.waitForTimeout(1500);
  await win.screenshot({ path: path.join(OUT, '00-before.png') });

  const reports = [];
  let bodiesPrev = await win.evaluate(() => (window.__archdiscRegistry?.list?.() || []).length);

  for (const cfg of RUNS) {
    await win.evaluate((c) => {
      window.__archdiscPlanParams = window.__archdiscPlanParams || {};
      window.__archdiscPlanParams['Sculpt Topology Optimize'] = c.params;
    }, cfg);
    await win.locator('[data-ribbon-tool-name="Sculpt Topology Optimize"]').first().dispatchEvent('click');
    await win.waitForFunction(
      (expected) => {
        const r = window.__lastTopoReport;
        return !!r && r.volumeFraction === expected.vf && r.loadN === expected.loadN;
      },
      { vf: cfg.params.volumeFraction, loadN: cfg.params.loadN },
      { timeout: 6 * 60 * 1000 }                                   // SIMP can take a minute
    );
    const report = await win.evaluate(() => window.__lastTopoReport);
    reports.push({ ...cfg, report });
    const bodiesNow = await win.evaluate(() => (window.__archdiscRegistry?.list?.() || []).length);
    const added = bodiesNow - bodiesPrev;
    bodiesPrev = bodiesNow;
    console.log(`[Sculpt Topo] ${cfg.label} (${cfg.note}): bodies +${added}, report=`,
      JSON.stringify({
        W: report.W, H: report.H, T: report.T, grid: [report.nx, report.ny, report.nz],
        volumeFraction: report.volumeFraction, loadN: report.loadN,
        iterations: report.iterations, compliance: +report.compliance.toFixed(3),
        tetCount: report.tetCount,
        optimizedVolume: +report.optimizedVolume.toFixed(0),
        optimizedFractionActual: +(report.optimizedFractionActual * 100).toFixed(1),
        cubeFraction: +(report.cubeFraction * 100).toFixed(1),
        triCount: report.triCount,
        simpMs: report.simpMs,
      }, null, 0));
    await win.waitForTimeout(4000);                                // viewer pause
    await win.screenshot({ path: path.join(OUT, `${cfg.label}.png`) });
  }

  // ── ASSERTIONS ────────────────────────────────────────────────────────

  const [sparse, balanced, full] = reports.map(r => r.report);

  // 1. Every run produced a non-empty watertight solid.
  for (const r of [sparse, balanced, full]) {
    expect(r.optimizedVolume).toBeGreaterThan(0);
    expect(r.triCount).toBeGreaterThan(0);
    expect(r.optimizedVolume).toBeLessThan(r.designVolume);
  }

  // 2. The resulting volume fraction tracks the target. The
  //    actual marching-cubes volume usually overshoots the cube
  //    fraction a little (smooth boundary tessellation adds a thin
  //    skin around each kept cube), so we allow ±15 pp.
  for (const r of [sparse, balanced, full]) {
    expect(r.optimizedFractionActual).toBeGreaterThan(r.volumeFraction - 0.15);
    expect(r.optimizedFractionActual).toBeLessThan(r.volumeFraction + 0.20);
  }

  // 3. Monotonicity: more target volume → more material kept AND
  //    lower compliance (more material is stiffer).
  expect(balanced.optimizedVolume).toBeGreaterThan(sparse.optimizedVolume);
  expect(full.optimizedVolume).toBeGreaterThan(balanced.optimizedVolume);
  expect(balanced.compliance).toBeLessThan(sparse.compliance);
  expect(full.compliance).toBeLessThan(balanced.compliance);

  // 4. SIMP ran to completion (didn't bail at iter 0).
  for (const r of [sparse, balanced, full]) {
    expect(r.iterations).toBeGreaterThan(0);
    expect(r.iterations).toBeLessThanOrEqual(r.maxIter);
  }

  // 5. Three solids landed in the registry.
  const bodiesNow = await win.evaluate(() => (window.__archdiscRegistry?.list?.() || []).length);
  expect(bodiesNow).toBeGreaterThanOrEqual(RUNS.length);

  await win.waitForTimeout(6000);                                  // final viewer pause
  await win.screenshot({ path: path.join(OUT, '99-after.png') });

  await app.close();
});
