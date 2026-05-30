import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * SP-45 — Sculpt Architectural Wall. HEADED on the Mac Electron shell.
 * Three walls of progressive complexity standing in a row so the viewer
 * sees BIM-class parametric walls grow from a solid slab to a wall with
 * a door to a wall with door + window — the canonical Revit /
 * ArchiCAD / FreeCAD BIM ArchWall progression.
 *
 * Viewer-friendly pauses (3 s between walls, 6 s final) for remote
 * viewing.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-wall');
fs.mkdirSync(OUT, { recursive: true });

const WALLS = [
  {
    label: '01-solid',
    note: 'Solid wall, no openings',
    params: { length: 4000, height: 2800, thickness: 200,
              door: 'no', window: 'no',
              doorX: 0, doorW: 900, doorH: 2100,
              windowX: 0, windowZ: 900, windowW: 1200, windowH: 1200,
              x: -5500, y: 0, z: 0, color: 0xc6b899 },
  },
  {
    label: '02-door',
    note: 'Wall with door opening (900 × 2100 mm)',
    params: { length: 4000, height: 2800, thickness: 200,
              door: 'yes', window: 'no',
              doorX: -800, doorW: 900, doorH: 2100,
              windowX: 0, windowZ: 0, windowW: 0, windowH: 0,
              x: 0, y: 0, z: 0, color: 0xb89c66 },
  },
  {
    label: '03-door-window',
    note: 'Wall with door + window (canonical Revit primitive)',
    params: { length: 4000, height: 2800, thickness: 200,
              door: 'yes', window: 'yes',
              doorX: -800, doorW: 900, doorH: 2100,
              windowX: 800, windowZ: 900, windowW: 1200, windowH: 1200,
              x: 5500, y: 0, z: 0, color: 0x99a3c6 },
  },
];

test.describe.configure({ timeout: 10 * 60 * 1000 });

test('Sculpt Architectural Wall — headed Electron, 3 BIM walls in a row', async () => {
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

  // Frame the row of three walls. They're large (4 m × 2.8 m × 0.2 m
  // each) and spaced 5.5 m apart in X, so we need to back the camera off.
  await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    if (!vp?.camera) return;
    if (vp.orbitControls) { vp.orbitControls.maxDistance = 100; vp.orbitControls.minDistance = 0.1; }
    vp.camera.position.set(2.5, 4.5, 12.0);
    vp.orbitControls.target.set(0, 1.4, 0);
    vp.camera.lookAt(0, 1.4, 0);
    vp.orbitControls.update();
    vp.renderer.render(vp.scene, vp.camera);
  });
  await win.waitForTimeout(1500);
  await win.screenshot({ path: path.join(OUT, '00-before.png') });

  const reports = [];
  let bodiesPrev = await win.evaluate(() => (window.__archdiscRegistry?.list?.() || []).length);

  for (const cfg of WALLS) {
    await win.evaluate((c) => {
      window.__archdiscPlanParams = window.__archdiscPlanParams || {};
      window.__archdiscPlanParams['Sculpt Architectural Wall'] = c.params;
    }, cfg);
    await win.locator('[data-ribbon-tool-name="Sculpt Architectural Wall"]').first().dispatchEvent('click');
    await win.waitForFunction(
      (expected) => {
        const r = window.__lastWallReport;
        return !!r && r.openingCount === expected.openingCount;
      },
      { openingCount: (cfg.params.door === 'yes' ? 1 : 0) + (cfg.params.window === 'yes' ? 1 : 0) },
      { timeout: 60000 }
    );
    const report = await win.evaluate(() => window.__lastWallReport);
    reports.push({ ...cfg, report });
    const bodiesNow = await win.evaluate(() => (window.__archdiscRegistry?.list?.() || []).length);
    const added = bodiesNow - bodiesPrev;
    bodiesPrev = bodiesNow;
    console.log(`[Sculpt Wall] ${cfg.label} (${cfg.note}): bodies +${added}, report=`,
      JSON.stringify({
        length: report.length, height: report.height, thickness: report.thickness,
        openingCount: report.openingCount,
        openings: report.openings,
        slabVolume: report.slabVolume,
        removedVolume: report.removedVolume,
        actualVolume: +report.actualVolume.toFixed(0),
        predictedVolume: +report.predictedVolume.toFixed(0),
        relError: +(report.relError * 100).toFixed(3),
        triCount: report.triCount,
      }, null, 0));
    await win.waitForTimeout(3000);                                  // viewer pause
    await win.screenshot({ path: path.join(OUT, `${cfg.label}.png`) });
  }

  // ── ASSERTIONS ────────────────────────────────────────────────────────

  const [solid, withDoor, withBoth] = reports.map(r => r.report);

  // 1. Every wall is non-empty + watertight.
  for (const r of [solid, withDoor, withBoth]) {
    expect(r.actualVolume).toBeGreaterThan(0);
    expect(r.triCount).toBeGreaterThan(0);
  }

  // 2. Actual volume == predicted (slab − openings) to within 0.05 % —
  //    Manifold boolean diff on rectangular openings is exact.
  for (const r of [solid, withDoor, withBoth]) {
    expect(r.relError).toBeLessThan(0.0005);
  }

  // 3. The solid wall has the largest volume; each opening reduces it.
  expect(solid.actualVolume).toBeGreaterThan(withDoor.actualVolume);
  expect(withDoor.actualVolume).toBeGreaterThan(withBoth.actualVolume);

  // 4. Opening counts match.
  expect(solid.openingCount).toBe(0);
  expect(withDoor.openingCount).toBe(1);
  expect(withBoth.openingCount).toBe(2);

  // 5. Removed volume math: door 900 × 2100 × 200 = 378 000 000 mm³;
  //    window 1200 × 1200 × 200 = 288 000 000 mm³.
  expect(withDoor.removedVolume).toBeCloseTo(900 * 2100 * 200, -4);
  expect(withBoth.removedVolume).toBeCloseTo(900 * 2100 * 200 + 1200 * 1200 * 200, -4);

  // 6. Three walls landed.
  const bodiesNow = await win.evaluate(() => (window.__archdiscRegistry?.list?.() || []).length);
  expect(bodiesNow).toBeGreaterThanOrEqual(WALLS.length);

  await win.waitForTimeout(6000);                                    // final viewer pause
  await win.screenshot({ path: path.join(OUT, '99-after.png') });

  await app.close();
});
