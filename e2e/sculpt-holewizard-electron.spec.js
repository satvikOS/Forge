import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * SP-47 — Sculpt Hole Wizard. HEADED on the Mac Electron shell. OCCT-
 * backed B-rep kernel. Four plates in a row showing the canonical
 * "hole wizard" combinations every mechanical CAD ships:
 *
 *   plain Ø8 through-hole
 *   Ø8 through + counterbore (Ø14 × 5 mm deep)
 *   Ø8 through + countersink (Ø16 outer, 90° included)
 *   Ø8 through + counterbore + countersink (full machined fastener seat)
 *
 * Validation: analytic predicted volume = plate − (cyl + cbore-annulus +
 * cone-frustum) compared to OCCT's measured volume. The boolean / cone
 * pipeline is exact to ≤ 0.5 % (cone tessellation is the slowest-
 * converging part).
 *
 * Viewer-friendly pauses (3 s between plates, 6 s final) for remote
 * viewing. First plate's timeout is generous because the OCCT WASM
 * loads on demand (~50 MB).
 */

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-holewizard');
fs.mkdirSync(OUT, { recursive: true });

const PLATES = [
  {
    label: '01-plain',
    note: 'Plain Ø8 through-hole',
    params: { plateW: 80, plateH: 60, plateT: 15, holeR: 4, holeX: 0, holeY: 0,
              counterbore: 'no',  counterboreR: 7, counterboreDepth: 5,
              countersink: 'no',  countersinkR: 8, countersinkAngle: 90,
              x: -200, y: 0, z: 0, color: 0x6b8aa5 },
  },
  {
    label: '02-counterbore',
    note: 'Ø8 + Ø14 × 5 mm counterbore',
    params: { plateW: 80, plateH: 60, plateT: 15, holeR: 4, holeX: 0, holeY: 0,
              counterbore: 'yes', counterboreR: 7, counterboreDepth: 5,
              countersink: 'no',  countersinkR: 8, countersinkAngle: 90,
              x:    0, y: 0, z: 0, color: 0xa56b8a },
  },
  {
    label: '03-countersink',
    note: 'Ø8 + Ø16 × 90° countersink',
    params: { plateW: 80, plateH: 60, plateT: 15, holeR: 4, holeX: 0, holeY: 0,
              counterbore: 'no',  counterboreR: 7, counterboreDepth: 5,
              countersink: 'yes', countersinkR: 8, countersinkAngle: 90,
              x:  200, y: 0, z: 0, color: 0x8aa56b },
  },
  {
    label: '04-both',
    note: 'Ø8 + Ø14 counterbore + Ø16 countersink (full machined seat)',
    params: { plateW: 80, plateH: 60, plateT: 18, holeR: 4, holeX: 0, holeY: 0,
              counterbore: 'yes', counterboreR: 7, counterboreDepth: 5,
              countersink: 'yes', countersinkR: 8, countersinkAngle: 90,
              x:  400, y: 0, z: 0, color: 0xa58a6b },
  },
];

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Hole Wizard — OCCT B-rep path, 4 hole types in a row', async () => {
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

  // Frame the row of four plates spanning −200..+400 mm in X. Tilt the
  // camera so the +Z (top) faces with their counterbore / countersink
  // recesses are clearly visible.
  await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    if (!vp?.camera) return;
    if (vp.orbitControls) { vp.orbitControls.maxDistance = 20; vp.orbitControls.minDistance = 0.05; }
    vp.camera.position.set(0.10, 0.30, 0.55);
    vp.orbitControls.target.set(0.10, 0.01, 0);
    vp.camera.lookAt(0.10, 0.01, 0);
    vp.orbitControls.update();
    vp.renderer.render(vp.scene, vp.camera);
  });
  await win.waitForTimeout(1500);
  await win.screenshot({ path: path.join(OUT, '00-before.png') });

  const reports = [];
  let bodiesPrev = await win.evaluate(() => (window.__archdiscRegistry?.list?.() || []).length);

  for (let i = 0; i < PLATES.length; i++) {
    const cfg = PLATES[i];
    await win.evaluate((c) => {
      window.__archdiscPlanParams = window.__archdiscPlanParams || {};
      window.__archdiscPlanParams['Sculpt Hole Wizard'] = c.params;
    }, cfg);
    await win.locator('[data-ribbon-tool-name="Sculpt Hole Wizard"]').first().dispatchEvent('click');
    // OCCT may still be loading on the first call (~50 MB WASM).
    const firstCallTimeoutMs = i === 0 ? 8 * 60 * 1000 : 60_000;
    await win.waitForFunction(
      (expected) => {
        const r = window.__lastHoleReport;
        if (!r) return false;
        const cb = r.counterbore ? 'yes' : 'no';
        const cs = r.countersink ? 'yes' : 'no';
        return cb === expected.cb && cs === expected.cs && r.plateT === expected.plateT;
      },
      { cb: cfg.params.counterbore, cs: cfg.params.countersink, plateT: cfg.params.plateT },
      { timeout: firstCallTimeoutMs }
    );
    const report = await win.evaluate(() => window.__lastHoleReport);
    reports.push({ ...cfg, report });
    const bodiesNow = await win.evaluate(() => (window.__archdiscRegistry?.list?.() || []).length);
    const added = bodiesNow - bodiesPrev;
    bodiesPrev = bodiesNow;
    console.log(`[Sculpt Hole] ${cfg.label} (${cfg.note}): bodies +${added}, report=`,
      JSON.stringify({
        plate: [report.plateW, report.plateH, report.plateT],
        holeR: report.holeR,
        counterbore: report.counterbore, counterboreR: report.counterboreR, counterboreDepth: report.counterboreDepth,
        countersink: report.countersink, countersinkR: report.countersinkR, countersinkAngle: report.countersinkAngle, countersinkDepth: +report.countersinkDepth.toFixed(2),
        removedAnalytic: +report.removedAnalytic.toFixed(0),
        predictedVolume: +report.predictedVolume.toFixed(0),
        actualVolume:    +report.actualVolume.toFixed(0),
        relError: +(report.relError * 100).toFixed(3),
        faceCount: report.faceCount, edgeCount: report.edgeCount,
        elapsedMs: report.elapsedMs,
      }, null, 0));
    await win.waitForTimeout(3000);                                  // viewer pause
    await win.screenshot({ path: path.join(OUT, `${cfg.label}.png`) });
  }

  // ── ASSERTIONS ────────────────────────────────────────────────────────

  const [plain, cbore, csink, both] = reports.map(r => r.report);

  // 1. Every plate is a non-empty B-rep body.
  for (const r of [plain, cbore, csink, both]) {
    expect(r.actualVolume).toBeGreaterThan(0);
    expect(r.faceCount).toBeGreaterThan(0);
    expect(r.edgeCount).toBeGreaterThan(0);
  }

  // 2. Volume = plate − analytic removed material to ≤ 0.5 % (the cone
  //    tessellation is the slowest-converging part).
  for (const r of [plain, cbore, csink, both]) {
    expect(r.relError).toBeLessThan(0.005);
  }

  // 3. Removed material ordering matches geometric expectation:
  //    plain < counterbore-only < countersink-only AND counterbore+
  //    countersink removes more than either alone.
  expect(cbore.removedAnalytic).toBeGreaterThan(plain.removedAnalytic);
  expect(csink.removedAnalytic).toBeGreaterThan(plain.removedAnalytic);
  expect(both.removedAnalytic).toBeGreaterThan(cbore.removedAnalytic);
  expect(both.removedAnalytic).toBeGreaterThan(csink.removedAnalytic);

  // 4. Plain hole topology: 6 plate faces + 1 cylindrical hole side =
  //    7 faces. Counterbore adds a step face + cyl. Countersink adds
  //    a cone face. Soft lower bounds because OCCT may merge / split
  //    coincident faces.
  expect(plain.faceCount).toBeGreaterThanOrEqual(7);
  expect(cbore.faceCount).toBeGreaterThan(plain.faceCount);
  expect(csink.faceCount).toBeGreaterThanOrEqual(plain.faceCount);
  expect(both.faceCount).toBeGreaterThan(cbore.faceCount);

  // 5. Four bodies landed.
  const bodiesNow = await win.evaluate(() => (window.__archdiscRegistry?.list?.() || []).length);
  expect(bodiesNow).toBeGreaterThanOrEqual(PLATES.length);

  await win.waitForTimeout(6000);                                    // final viewer pause
  await win.screenshot({ path: path.join(OUT, '99-after.png') });

  await app.close();
});
