import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * SP-46 — Sculpt Variable Fillet Box. The FIRST Sculpt e2e that goes
 * through the OCCT-backed exact B-rep kernel (frontend/src/kernel/brep,
 * opencascade.js). Three boxes in a row demonstrating that variable
 * fillets — a feature the mesh kernel (manifold-3d) can't do at all —
 * land cleanly via the OCCT path:
 *
 *   constant R = 5 mm everywhere       (r1 = r2)
 *   variable R = 1 → 8 mm              (modest taper)
 *   variable R = 0.5 → 12 mm            (heavy contrast)
 *
 * OCCT WASM loads on first call (~50 MB), so the first invocation
 * timeout is generous; subsequent ones are fast.
 *
 * Viewer-friendly pauses (3 s between boxes, 6 s final).
 */

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-varfillet');
fs.mkdirSync(OUT, { recursive: true });

const BOXES = [
  {
    label: '01-constant-R5',
    note: 'Constant R = 5 mm fillet (r1 = r2 = 5)',
    params: { dx: 80, dy: 60, dz: 40, r1: 5, r2: 5,
              x: -150, y: 30, z: 0, color: 0x9c8d6a },
  },
  {
    label: '02-variable-1-to-8',
    note: 'Variable R 1 → 8 mm — modest taper',
    params: { dx: 80, dy: 60, dz: 40, r1: 1, r2: 8,
              x:    0, y: 30, z: 0, color: 0x8d6a9c },
  },
  {
    label: '03-variable-half-to-12',
    note: 'Variable R 0.5 → 12 mm — heavy contrast',
    params: { dx: 80, dy: 60, dz: 40, r1: 0.5, r2: 12,
              x:  150, y: 30, z: 0, color: 0x6a9c8d },
  },
];

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Variable Fillet Box — OCCT B-rep path, 3 boxes in a row', async () => {
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

  // Frame the row of three boxes at (−150, 0, +150) mm. Boxes are
  // 80 × 60 × 40 mm so we set camera distance to ~0.5 m.
  await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    if (!vp?.camera) return;
    if (vp.orbitControls) { vp.orbitControls.maxDistance = 20; vp.orbitControls.minDistance = 0.05; }
    vp.camera.position.set(0.30, 0.25, 0.45);
    vp.orbitControls.target.set(0, 0.02, 0);
    vp.camera.lookAt(0, 0.02, 0);
    vp.orbitControls.update();
    vp.renderer.render(vp.scene, vp.camera);
  });
  await win.waitForTimeout(1500);
  await win.screenshot({ path: path.join(OUT, '00-before.png') });

  const reports = [];
  let bodiesPrev = await win.evaluate(() => (window.__archdiscRegistry?.list?.() || []).length);

  for (let i = 0; i < BOXES.length; i++) {
    const cfg = BOXES[i];
    await win.evaluate((c) => {
      window.__archdiscPlanParams = window.__archdiscPlanParams || {};
      window.__archdiscPlanParams['Sculpt Variable Fillet Box'] = c.params;
    }, cfg);
    await win.locator('[data-ribbon-tool-name="Sculpt Variable Fillet Box"]').first().dispatchEvent('click');
    // OCCT WASM loads on the first call → big timeout for box #1, short for the rest.
    const firstCallTimeoutMs = i === 0 ? 8 * 60 * 1000 : 60_000;
    await win.waitForFunction(
      (expected) => {
        const r = window.__lastVariableFilletReport;
        return !!r && r.r1Requested === expected.r1 && r.r2Requested === expected.r2;
      },
      { r1: cfg.params.r1, r2: cfg.params.r2 },
      { timeout: firstCallTimeoutMs }
    );
    const report = await win.evaluate(() => window.__lastVariableFilletReport);
    reports.push({ ...cfg, report });
    const bodiesNow = await win.evaluate(() => (window.__archdiscRegistry?.list?.() || []).length);
    const added = bodiesNow - bodiesPrev;
    bodiesPrev = bodiesNow;
    console.log(`[Sculpt VarFillet] ${cfg.label} (${cfg.note}): bodies +${added}, report=`,
      JSON.stringify({
        dx: report.dx, dy: report.dy, dz: report.dz,
        r1: report.r1, r2: report.r2, clamped: report.clamped,
        boxVolume: report.boxVolume,
        actualVolume: +report.actualVolume.toFixed(0),
        faceCount: report.faceCount,
        edgeCount: report.edgeCount,
        elapsedMs: report.elapsedMs,
      }, null, 0));
    await win.waitForTimeout(3000);                                  // viewer pause
    await win.screenshot({ path: path.join(OUT, `${cfg.label}.png`) });
  }

  // ── ASSERTIONS ────────────────────────────────────────────────────────

  const [c5, v18, v05_12] = reports.map(r => r.report);

  // 1. Every box landed as a non-empty B-rep body.
  for (const r of [c5, v18, v05_12]) {
    expect(r.actualVolume).toBeGreaterThan(0);
    expect(r.faceCount).toBeGreaterThan(0);
    expect(r.edgeCount).toBeGreaterThan(0);
  }

  // 2. Fillets REMOVE material (rounded corners < sharp box).
  //    Even the small constant R=5 fillet removes some.
  for (const r of [c5, v18, v05_12]) {
    expect(r.actualVolume).toBeLessThan(r.boxVolume);
  }

  // 3. Variable-fillet topology: filleting all 12 edges of a cube
  //    produces a body with 6 (original) + 12 (one per edge) + 8
  //    (one per vertex) = 26 faces. We accept a soft lower bound
  //    since OCCT can simplify coincident corner faces.
  for (const r of [c5, v18, v05_12]) {
    expect(r.faceCount).toBeGreaterThanOrEqual(18);
  }

  // 4. Larger fillets remove more material — v05_12 (heaviest) removes
  //    more than v18 (modest), which removes more than… well, the
  //    constant R=5 case isn't directly comparable because it's not
  //    a tapered fillet. Just check the heavy-contrast case removes
  //    more than the modest-taper case.
  expect(v05_12.boxVolume - v05_12.actualVolume)
    .toBeGreaterThan(v18.boxVolume - v18.actualVolume);

  // 5. Three bodies landed.
  const bodiesNow = await win.evaluate(() => (window.__archdiscRegistry?.list?.() || []).length);
  expect(bodiesNow).toBeGreaterThanOrEqual(BOXES.length);

  await win.waitForTimeout(6000);                                    // final viewer pause
  await win.screenshot({ path: path.join(OUT, '99-after.png') });

  await app.close();
});
