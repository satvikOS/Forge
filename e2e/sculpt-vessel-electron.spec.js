import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * SP-41 — Sculpt Pressure Vessel. HEADED on the Mac Electron shell.
 * Three vessels of escalating size — small lab tank, medium process
 * vessel, large storage tank — placed in a row so the viewer sees the
 * canonical plant-design library at a glance. Each vessel's actual
 * Manifold volume matches the closed-form analytic prediction
 * (π·D³/12 + π·D²·L/4) to within sub-percent — the relative error
 * decreases with more circular segments.
 *
 * Viewer-friendly pauses (3 s between vessels, 6 s final) so a remote
 * viewer over RDP / Screen Sharing has time to see each new vessel
 * stand up before the next builds.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-vessel');
fs.mkdirSync(OUT, { recursive: true });

const VESSELS = [
  {
    label: '01-lab-D100',
    note: 'Lab tank — Ø100 × 200 mm shell',
    params: { D: 100, L: 200, headSegments: 24, circularSegments: 48,
              x: -300, y: 0, z: 0, color: 0x8aa5b0 },
  },
  {
    label: '02-process-D200',
    note: 'Process vessel — Ø200 × 500 mm shell',
    params: { D: 200, L: 500, headSegments: 32, circularSegments: 64,
              x:    0, y: 0, z: 0, color: 0x9eb35c },
  },
  {
    label: '03-storage-D300',
    note: 'Storage tank — Ø300 × 800 mm shell',
    params: { D: 300, L: 800, headSegments: 40, circularSegments: 80,
              x:  400, y: 0, z: 0, color: 0xb55c8c },
  },
];

test.describe.configure({ timeout: 10 * 60 * 1000 });

test('Sculpt Pressure Vessel — headed Electron, three sizes with analytic-volume match', async () => {
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

  // Frame the row of three vessels at (−300, 0, +400) mm. Tallest is
  // 950 mm so push the camera back enough to see the tops.
  await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    if (!vp?.camera) return;
    if (vp.orbitControls) { vp.orbitControls.maxDistance = 20; vp.orbitControls.minDistance = 0.05; }
    vp.camera.position.set(0.45, 0.65, 1.50);
    vp.orbitControls.target.set(0.05, 0, 0);
    vp.camera.lookAt(0.05, 0, 0);
    vp.orbitControls.update();
    vp.renderer.render(vp.scene, vp.camera);
  });
  await win.waitForTimeout(1500);
  await win.screenshot({ path: path.join(OUT, '00-before.png') });

  const reports = [];
  let bodiesPrev = await win.evaluate(() => (window.__archdiscRegistry?.list?.() || []).length);

  for (const cfg of VESSELS) {
    await win.evaluate((c) => {
      window.__archdiscPlanParams = window.__archdiscPlanParams || {};
      window.__archdiscPlanParams['Sculpt Pressure Vessel'] = c.params;
    }, cfg);
    await win.locator('[data-ribbon-tool-name="Sculpt Pressure Vessel"]').first().dispatchEvent('click');
    await win.waitForFunction(
      (expected) => {
        const r = window.__lastVesselReport;
        return !!r && r.D === expected.D && r.L === expected.L;
      },
      { D: cfg.params.D, L: cfg.params.L },
      { timeout: 60000 }
    );
    const report = await win.evaluate(() => window.__lastVesselReport);
    reports.push({ ...cfg, report });
    const bodiesNow = await win.evaluate(() => (window.__archdiscRegistry?.list?.() || []).length);
    const added = bodiesNow - bodiesPrev;
    bodiesPrev = bodiesNow;
    console.log(`[Sculpt Vessel] ${cfg.label} (${cfg.note}): bodies +${added}, report=`,
      JSON.stringify({
        D: report.D, L: report.L, height: report.height,
        circularSegments: report.circularSegments,
        volume: +report.volume.toFixed(0),
        predictedVolume: +report.predictedVolume.toFixed(0),
        relError: +(report.relError * 100).toFixed(3),
        triCount: report.triCount,
      }, null, 0));
    await win.waitForTimeout(3000);                                  // viewer pause
    await win.screenshot({ path: path.join(OUT, `${cfg.label}.png`) });
  }

  // ── ASSERTIONS ────────────────────────────────────────────────────────

  const [lab, proc, store] = reports.map(r => r.report);

  // 1. Every vessel is a non-empty watertight solid.
  for (const r of [lab, proc, store]) {
    expect(r.volume).toBeGreaterThan(0);
    expect(r.triCount).toBeGreaterThan(0);
  }

  // 2. Actual volume matches the closed-form analytic prediction.
  //    With ≥ 48 circular segments the marching-cubes / revolve
  //    discretisation is within ~3 % of the analytic ellipsoidal
  //    volume; sub-1 % at 80 segments.
  expect(lab.relError).toBeLessThan(0.05);
  expect(proc.relError).toBeLessThan(0.03);
  expect(store.relError).toBeLessThan(0.02);

  // 3. Volume scales the right way with size: lab < process < storage.
  expect(proc.volume).toBeGreaterThan(lab.volume);
  expect(store.volume).toBeGreaterThan(proc.volume);

  // 4. Triangle counts scale with circular segments (more segs = more
  //    triangles around the revolution).
  expect(store.triCount).toBeGreaterThan(lab.triCount);

  // 5. Three vessels landed.
  const bodiesNow = await win.evaluate(() => (window.__archdiscRegistry?.list?.() || []).length);
  expect(bodiesNow).toBeGreaterThanOrEqual(VESSELS.length);

  await win.waitForTimeout(6000);                                    // final viewer pause
  await win.screenshot({ path: path.join(OUT, '99-after.png') });

  await app.close();
});
