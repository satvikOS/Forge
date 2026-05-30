import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-deletefaceheal');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Delete Face And Heal — OCCT defeaturer, box-with-hole → box', async () => {
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
    window.__archdiscPlanParams['Sculpt Delete Face And Heal'] = {
      boxSize: 40, holeR: 5,
      x: 0, y: 0, z: 0, color: 0xc8d8a8,
    };
  });
  await win.locator('[data-ribbon-tool-name="Sculpt Delete Face And Heal"]').first().dispatchEvent('click');
  await win.waitForFunction(
    () => window.__lastDeleteFaceReport && window.__lastDeleteFaceReport.error !== 'in progress',
    null,
    { timeout: 8 * 60 * 1000 },
  );
  const r = await win.evaluate(() => window.__lastDeleteFaceReport);
  if (r.error) throw new Error('handler error: ' + r.error);
  console.log(`[DeleteFace] ${r.boxSize}³ Ø${r.holeR*2} hole | boxV=${r.boxV} holeV=${r.holeV.toFixed(0)} withHoleV=${r.withHoleVActual.toFixed(0)} predicted=${r.withHoleVPredicted.toFixed(0)} faceIdx=${r.holeFaceIdx} type=${r.holeFaceType} healedV=${r.healedV.toFixed(0)} healingRelErr=${(r.healingRelError * 100).toFixed(4)}% faces ${r.withHoleFaceCount}→${r.healedFaceCount}`);

  // box-with-hole volume = 40³ − π·5²·40 ≈ 64000 − 3141.59 = 60858.4 mm³.
  expect(Math.abs(r.withHoleVActual - r.withHoleVPredicted)).toBeLessThan(1);
  // Hole face identified.
  expect(r.holeFaceIdx).toBeGreaterThanOrEqual(1);
  expect(r.holeFaceType).toBe('hole');
  // After deleteFaceAndHeal: volume restored to the box (64,000 mm³).
  expect(r.healingRelError).toBeLessThan(0.001);
  expect(r.healedV).toBeCloseTo(r.boxV, 0);
  // The healed body should have ≤ the box's face count.
  expect(r.healedFaceCount).toBeLessThanOrEqual(r.withHoleFaceCount);

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
