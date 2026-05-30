import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-draftanalysis');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Draft Analysis — OCCT mold-tool QC, +Z pull, frustum', async () => {
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
    window.__archdiscPlanParams['Sculpt Draft Analysis'] = {
      r1: 20, r2: 10, h: 30, minDeg: 3,
      x: 0, y: 0, z: 0, color: 0x9be38c,
    };
  });
  await win.locator('[data-ribbon-tool-name="Sculpt Draft Analysis"]').first().dispatchEvent('click');
  await win.waitForFunction(
    () => window.__lastDraftAnalysisReport && window.__lastDraftAnalysisReport.error !== 'in progress',
    null,
    { timeout: 8 * 60 * 1000 },
  );
  const r = await win.evaluate(() => window.__lastDraftAnalysisReport);
  if (r.error) throw new Error('handler error: ' + r.error);
  console.log(`[DraftAnalysis] r1=${r.r1} r2=${r.r2} h=${r.h} minDeg=${r.minDraftDeg}° → faces=${r.faceCount} +${r.positive}/${r.negative}-/${r.vertical}║ theoretical-lateral=${r.theoreticalLateralDeg.toFixed(2)}° per=${JSON.stringify(r.perFace)}`);

  // Frustum (r1=20, r2=10, h=30): 3 faces = 1 cone lateral + 2 caps.
  expect(r.faceCount).toBe(3);
  // Top cap (+Z): positive. Bottom cap (−Z): negative. Lateral: positive
  // because atan(10/30) ≈ 18.4° > 3° threshold and the normal slopes outward+up.
  expect(r.positive).toBe(2);
  expect(r.negative).toBe(1);
  expect(r.vertical).toBe(0);
  // Theoretical sanity on lateral angle.
  expect(r.theoreticalLateralDeg).toBeGreaterThan(18);
  expect(r.theoreticalLateralDeg).toBeLessThan(19);
  // Every face has a sensible signed angle in [-90, +90].
  for (const f of r.perFace) {
    expect(f.angleDeg).toBeGreaterThanOrEqual(-90);
    expect(f.angleDeg).toBeLessThanOrEqual(90);
  }

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
