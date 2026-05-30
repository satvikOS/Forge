import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-imprint');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Imprint Wire — OCCT face-imprint, topology-only', async () => {
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
    window.__archdiscPlanParams['Sculpt Imprint Wire'] = {
      boxX: 100, boxY: 100, boxZ: 20, toolR: 20, toolH: 30,
      x: 0, y: 0, z: 0, color: 0xa6c1d6,
    };
  });
  await win.locator('[data-ribbon-tool-name="Sculpt Imprint Wire"]').first().dispatchEvent('click');
  await win.waitForFunction(
    () => window.__lastImprintReport && window.__lastImprintReport.error !== 'in progress',
    null,
    { timeout: 8 * 60 * 1000 },
  );
  const r = await win.evaluate(() => window.__lastImprintReport);
  if (r.error) throw new Error('handler error: ' + r.error);
  console.log(`[Imprint] box ${r.boxX}×${r.boxY}×${r.boxZ} + Ø${r.toolR * 2} cyl footprint predicted=${r.predictedVolume.toFixed(0)} actual=${r.actualVolume.toFixed(0)} relErr=${(r.relError * 100).toFixed(3)}% faces ${r.faceCountBefore}→${r.faceCountAfter} (+${r.faceCountDelta}) edges ${r.edgeCountBefore}→${r.edgeCountAfter} (+${r.edgeCountDelta})`);

  // Volume-preservation contract.
  expect(r.relError).toBeLessThan(0.001);
  // Top face must have been split into ≥ 1 extra face.
  expect(r.faceCountAfter).toBeGreaterThan(r.faceCountBefore);
  // At least one new edge from the imprint circle.
  expect(r.edgeCountAfter).toBeGreaterThan(r.edgeCountBefore);

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
