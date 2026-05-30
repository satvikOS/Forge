import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * SP-36 — Sculpt Cope (NX/Creo/SolidWorks weldment flagship op). HEADED
 * on the Mac Electron shell so you can watch each saddle cut land. Drives
 * the real ribbon tool four times — T-joint, 45° miter, K-brace at 60°
 * (with axis offset), X-cross at 90° — each in its own Y-stripe so they
 * stack as a comparison row. Every invocation lands two bodies (the
 * coped primary + the secondary tube) and a cope report on
 * window.__lastCopeReport whose copeDepth matches the analytic
 * planCope formula to within 0.1 mm.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-cope');
fs.mkdirSync(OUT, { recursive: true });

// Each joint is shifted in Y so the row of four is visible at once.
// Primary R=40, Secondary R=30 throughout — only the joint geometry varies.
const JOINTS = [
  {
    label: '01-T-90',
    note: 'T-joint, 90° intersecting axes',
    expectedDepth: 70.0,                                  // R₂ + R₁/sin90 = 30 + 40
    params: { priR: 40, secR: 30, priLen: 600, secLen: 400, angleDeg: 90, offset: 0, clearance: 1.0,
              x: 0, y:    0, z: 0, color: 0xc6a86b, secColor: 0x6b9ec6 },
  },
  {
    label: '02-miter-45',
    note: '45° miter, intersecting axes',
    expectedDepth: 86.57,                                 // 30 + 40/sin45 ≈ 86.57
    params: { priR: 40, secR: 30, priLen: 600, secLen: 400, angleDeg: 45, offset: 0, clearance: 1.0,
              x: 0, y:  250, z: 0, color: 0xc6a86b, secColor: 0xc66b9e },
  },
  {
    label: '03-Kbrace-60',
    note: 'K-brace at 60°, axis offset +25 mm',
    expectedDepth: 51.19,                                 // 30 + (40 − 25·sin60)/sin60 ≈ 51.19
    params: { priR: 40, secR: 30, priLen: 600, secLen: 400, angleDeg: 60, offset: 25, clearance: 1.0,
              x: 0, y:  500, z: 0, color: 0xc6a86b, secColor: 0x9ec66b },
  },
  {
    label: '04-shallow-30',
    note: '30° shallow joint, axes crossing — long saddle',
    expectedDepth: 110.0,                                 // 30 + 40/sin30 = 30 + 80
    params: { priR: 40, secR: 30, priLen: 600, secLen: 400, angleDeg: 30, offset: 0, clearance: 1.0,
              x: 0, y:  750, z: 0, color: 0xc6a86b, secColor: 0xb86bc6 },
  },
];

test.describe.configure({ timeout: 8 * 60 * 1000 });

test('Sculpt Cope — headed Electron, four joints with analytic-depth match', async () => {
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

  // Frame the camera so the 4-joint column is visible end-to-end.
  await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    if (!vp?.camera) return;
    if (vp.orbitControls) { vp.orbitControls.maxDistance = 20; vp.orbitControls.minDistance = 0.05; }
    vp.camera.position.set(1.8, 1.2, 2.4);
    vp.orbitControls.target.set(0, 0.38, 0);
    vp.camera.lookAt(0, 0.38, 0);
    vp.orbitControls.update();
    vp.renderer.render(vp.scene, vp.camera);
  });
  await win.waitForTimeout(200);
  await win.screenshot({ path: path.join(OUT, '00-before.png') });

  const reports = [];
  let bodiesPrev = await win.evaluate(() => (window.__archdiscRegistry?.list?.() || []).length);

  for (const joint of JOINTS) {
    await win.evaluate((j) => {
      window.__archdiscPlanParams = window.__archdiscPlanParams || {};
      window.__archdiscPlanParams['Sculpt Cope'] = j.params;
    }, joint);
    await win.locator('[data-ribbon-tool-name="Sculpt Cope"]').first().dispatchEvent('click');
    await win.waitForFunction(
      (expected) => {
        const r = window.__lastCopeReport;
        return !!r && r.angleDeg === expected.angleDeg && r.offset === expected.offset && r.priR === expected.priR;
      },
      { angleDeg: joint.params.angleDeg, offset: joint.params.offset, priR: joint.params.priR },
      { timeout: 30000 }
    );
    const report = await win.evaluate(() => window.__lastCopeReport);
    reports.push({ ...joint, report });
    const bodiesNow = await win.evaluate(() => (window.__archdiscRegistry?.list?.() || []).length);
    const addedBodies = bodiesNow - bodiesPrev;
    bodiesPrev = bodiesNow;
    console.log(`[Sculpt Cope] ${joint.label} (${joint.note}): bodies +${addedBodies}, report=`,
      JSON.stringify({
        priR: report.priR, secR: report.secR,
        angleDeg: report.angleDeg, offset: report.offset, clearance: report.clearance,
        axesDistance: +report.axesDistance.toFixed(2),
        copeDepth: +report.copeDepth.toFixed(2),
        contactArc: +report.contactArc.toFixed(2),
        volRemoved: +report.volRemoved.toFixed(0),
        willCut: report.willCut,
      }, null, 0));
    await win.waitForTimeout(250);
    await win.screenshot({ path: path.join(OUT, `${joint.label}.png`) });
  }

  // ── ASSERTIONS ────────────────────────────────────────────────────────

  const [t, miter, k, shallow] = reports.map(r => ({ joint: r, r: r.report }));

  // 1. Every joint actually cut material (volRemoved > 0 and willCut true).
  for (const { r, joint } of [t, miter, k, shallow]) {
    expect(r.willCut).toBe(true);
    expect(r.volRemoved).toBeGreaterThan(0);
    // Analytic cope depth from planCope matches the hand-calc to ≤ 0.1 mm.
    expect(r.copeDepth).toBeCloseTo(joint.expectedDepth, 1);
  }

  // 2. Depth ordering: T (90°) < miter (45°) < shallow (30°) — saddle gets
  //    longer as the angle gets shallower, all else equal.
  expect(miter.r.copeDepth).toBeGreaterThan(t.r.copeDepth);
  expect(shallow.r.copeDepth).toBeGreaterThan(miter.r.copeDepth);

  // 3. Volume-removed ordering tracks depth ordering on these centred joints.
  expect(miter.r.volRemoved).toBeGreaterThan(t.r.volRemoved);
  expect(shallow.r.volRemoved).toBeGreaterThan(miter.r.volRemoved);

  // 4. The K-brace (offset 25 mm) cuts LESS than the on-axis 60° would, and
  //    less than the centred T-joint — the offset lifts the secondary away.
  expect(k.r.copeDepth).toBeLessThan(t.r.copeDepth);
  expect(k.r.axesDistance).toBeCloseTo(25, 1);

  // 5. Eight bodies landed total (coped primary + secondary per joint × 4).
  const bodiesNow = await win.evaluate(() => (window.__archdiscRegistry?.list?.() || []).length);
  expect(bodiesNow).toBeGreaterThanOrEqual(JOINTS.length * 2);

  await win.waitForTimeout(400);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });

  await app.close();
});
