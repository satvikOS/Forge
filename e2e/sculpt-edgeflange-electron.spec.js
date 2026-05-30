import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-edgeflange');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Edge Flange — OCCT sheet metal, 100×60×2 + 30 mm × 90° flange', async () => {
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

  await win.evaluate(() => {
    window.__archdiscPlanParams = window.__archdiscPlanParams || {};
    window.__archdiscPlanParams['Sculpt Edge Flange'] = {
      plateX: 100, plateY: 60, thickness: 2, flangeL: 30, angleDeg: 90, edgeIdx: 4,
      x: 0, y: 0, z: 0, color: 0xd1d6e8,
    };
  });
  await win.locator('[data-ribbon-tool-name="Sculpt Edge Flange"]').first().dispatchEvent('click');
  await win.waitForFunction(
    () => window.__lastEdgeFlangeReport && window.__lastEdgeFlangeReport.error !== 'in progress',
    null,
    { timeout: 8 * 60 * 1000 },
  );
  const r = await win.evaluate(() => window.__lastEdgeFlangeReport);
  if (r.error) throw new Error('handler error: ' + r.error);
  console.log(`[EdgeFlange] ${r.plateX}×${r.plateY}×${r.thickness} base + ${r.flangeLength}×${r.angleDeg}° edge=${r.edgeIdx} | base V=${r.baseVolume.toFixed(0)} sm-tagged=${r.baseIsSheetMetal} t=${r.baseSheetMetalThickness}, final V=${r.finalVolume.toFixed(0)} faces ${r.baseFaceCount}→${r.finalFaceCount} bends=${r.bendCount} lastBend=${JSON.stringify(r.lastBend)}`);
  if (r.edgesInfo) {
    console.log('[EdgeFlange] all edges:');
    for (const e of r.edgesInfo) console.log(`  edge ${e.idx}: len=${e.len.toFixed(2)} from (${e.p0.x.toFixed(1)},${e.p0.y.toFixed(1)},${e.p0.z.toFixed(1)}) to (${e.p1.x.toFixed(1)},${e.p1.y.toFixed(1)},${e.p1.z.toFixed(1)})`);
  }

  // Base flange must be tagged as sheet metal with correct thickness.
  expect(r.baseIsSheetMetal).toBe(true);
  expect(r.baseSheetMetalThickness).toBe(r.thickness);
  // Base = 100·60·2 = 12000 mm³.
  expect(Math.abs(r.baseVolume - 12000)).toBeLessThan(1);
  // Edge flange must add a bend record.
  expect(r.bendCount).toBeGreaterThanOrEqual(1);
  expect(r.lastBend).toBeTruthy();
  expect(r.lastBend.length).toBe(r.flangeLength);
  expect(r.lastBend.angleDeg).toBe(r.angleDeg);
  expect(r.lastBend.bendAllowance).toBeGreaterThan(0);
  // Faces grew from 6 (base) to ≥ 6 + bend region.
  expect(r.finalFaceCount).toBeGreaterThanOrEqual(r.baseFaceCount);
  // Final volume must be at least the base (flange added material).
  expect(r.finalVolume).toBeGreaterThanOrEqual(r.baseVolume - 0.5);

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
