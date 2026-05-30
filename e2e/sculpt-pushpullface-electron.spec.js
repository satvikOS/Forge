import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-pushpullface');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Push-Pull Face — OCCT direct editing, top face +20 mm', async () => {
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
    window.__archdiscPlanParams['Sculpt Push-Pull Face'] = {
      boxSize: 40, faceIdx: 6, distance: 20,
      x: 0, y: 0, z: 0, color: 0xa8e6c1,
    };
  });
  await win.locator('[data-ribbon-tool-name="Sculpt Push-Pull Face"]').first().dispatchEvent('click');
  await win.waitForFunction(
    () => window.__lastPushPullFaceReport && window.__lastPushPullFaceReport.error !== 'in progress',
    null,
    { timeout: 8 * 60 * 1000 },
  );
  const r = await win.evaluate(() => window.__lastPushPullFaceReport);
  if (r.error) throw new Error('handler error: ' + r.error);
  console.log(`[PushPullFace] ${r.boxSize}³ face #${r.faceIdx} dist=${r.distance} | V ${r.volumeBefore.toFixed(0)} → ${r.volumeAfter.toFixed(0)} ΔV=${r.volumeDelta.toFixed(0)} predicted=${r.predictedDelta} relErr=${(r.relError * 100).toFixed(3)}% faces ${r.faceCountBefore}→${r.faceCountAfter}`);

  // Box V = 40³ = 64,000 mm³.
  expect(r.volumeBefore).toBeCloseTo(64000, 2);
  // Pushing one 40×40 face by +20 mm adds 40·40·20 = 32,000 mm³.
  expect(r.predictedDelta).toBeCloseTo(32000, 2);
  expect(r.relError).toBeLessThan(0.001);
  expect(r.volumeAfter).toBeCloseTo(96000, 2);
  // Direct editing keeps the face count bounded — original 6 + at most
  // 4 lateral feature faces from the local-feature prism. (BRepFeat
  // splits the picked face into multiple sub-faces in some configs.)
  expect(r.faceCountAfter).toBeGreaterThanOrEqual(6);
  expect(r.faceCountAfter).toBeLessThanOrEqual(10);

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
