import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-pipeline');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Full Pipeline Demo — chained build + analyse + interop on L-bracket', async () => {
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
    window.__archdiscPlanParams['Sculpt Full Pipeline Demo'] = {
      plateX: 100, plateY: 60, thickness: 2, flangeLength: 30, density: 7850,
      x: 0, y: 0, z: 0, color: 0xb8c8d8,
    };
  });
  await win.locator('[data-ribbon-tool-name="Sculpt Full Pipeline Demo"]').first().dispatchEvent('click');
  await win.waitForFunction(
    () => window.__lastPipelineDemoReport && window.__lastPipelineDemoReport.error !== 'in progress',
    null,
    { timeout: 8 * 60 * 1000 },
  );
  const r = await win.evaluate(() => window.__lastPipelineDemoReport);
  if (r.error) throw new Error('handler error: ' + r.error);
  console.log(`[Pipeline] L-bracket ${r.input.plateX}×${r.input.plateY}×${r.input.thickness} + flange ${r.input.flangeLength}`);
  console.log(`  build ${r.timings.build}ms: V=${r.build.finalVolume.toFixed(0)} mm³ faces=${r.build.faceCount} bend=${r.build.bendCount} ba=${r.build.bendAllowance?.toFixed(3)}`);
  console.log(`  mass  ${r.timings.massProps}ms: m=${r.mass.massKg.toFixed(4)} kg A=${r.mass.surfaceAreaMm2.toFixed(0)} mm² centroid=(${r.mass.centroid.x.toFixed(2)},${r.mass.centroid.y.toFixed(2)},${r.mass.centroid.z.toFixed(2)})`);
  console.log(`  draft ${r.timings.draft}ms: +${r.draft.positive}/${r.draft.negative}-/${r.draft.vertical}║ of ${r.draft.faceCount} faces`);
  console.log(`  QA    ${r.timings.qa}ms: tier1 valid=${r.qa.tier1Valid} si=${r.qa.tier1SelfIntersects} tier2 int=${r.qa.tier2Intersecting} pairs=${r.qa.tier2PairCount} → clean=${r.qa.clean}`);
  console.log(`  HLR   ${r.timings.hlr}ms: visible sharp=${r.hlr.visibleSharp} outline=${r.hlr.visibleOutline}, hidden sharp=${r.hlr.hiddenSharp} outline=${r.hlr.hiddenOutline}`);
  console.log(`  STEP  ${r.timings.step}ms: ${r.step.bytes} bytes (ISO=${r.step.isISO10303}), RT V=${r.step.roundTripVolume.toFixed(0)} relErr=${(r.step.roundTripRelError * 100).toFixed(4)}%`);
  console.log(`  GLTF  ${r.timings.gltf}ms: ${r.gltf.bytes} bytes schema=${r.gltf.schema} verts=${r.gltf.verts} tris=${r.gltf.tris}`);
  console.log(`  TOTAL ${r.totalMs}ms`);

  // ── Stage validations ─────────────────────────────────────────────
  // Build: L-bracket with 18,000 mm³, 1 bend.
  expect(r.build.baseVolume).toBeCloseTo(12000, 0);
  expect(r.build.finalVolume).toBeCloseTo(18000, 0);
  expect(r.build.bendCount).toBe(1);
  expect(r.build.bendAllowance).toBeCloseTo(4.712, 2);

  // Mass: steel L-bracket = V × density / 1e9.
  expect(r.mass.massKg).toBeCloseTo(r.build.finalVolume * 7850 * 1e-9, 4);
  expect(r.mass.surfaceAreaMm2).toBeGreaterThan(0);

  // Draft analysis: faces classified.
  expect(r.draft.faceCount).toBeGreaterThanOrEqual(6);
  expect(r.draft.positive + r.draft.negative + r.draft.vertical).toBe(r.draft.faceCount);

  // QA: body is clean.
  expect(r.qa.clean).toBe(true);

  // HLR: visible polylines exist.
  expect(r.hlr.visibleSharp + r.hlr.visibleOutline).toBeGreaterThan(0);

  // STEP: round-trip volume conservation.
  expect(r.step.isISO10303).toBe(true);
  expect(r.step.roundTripRelError).toBeLessThan(0.001);

  // GLTF: schema 2.0 + non-trivial mesh.
  expect(r.gltf.schema).toBe('2.0');
  expect(r.gltf.tris).toBeGreaterThan(10);

  // Total < 30 seconds for the whole pipeline on M4 Max.
  expect(r.totalMs).toBeLessThan(30000);

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
