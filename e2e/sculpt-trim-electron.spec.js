import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-trim');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Trimmed NURBS — OCCT trimmed-NURBS face, window cut', async () => {
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
    window.__archdiscPlanParams['Sculpt Trimmed NURBS'] = {
      sizeX: 80, sizeY: 80, bulge: 12,
      trimUMin: 0.25, trimUMax: 0.75, trimVMin: 0.25, trimVMax: 0.75,
      x: 0, y: 0, z: 0, color: 0xa8d8a8,
    };
  });
  await win.locator('[data-ribbon-tool-name="Sculpt Trimmed NURBS"]').first().dispatchEvent('click');
  await win.waitForFunction(
    () => window.__lastTrimReport && window.__lastTrimReport.error !== 'in progress',
    null,
    { timeout: 8 * 60 * 1000 },
  );
  const r = await win.evaluate(() => window.__lastTrimReport);
  if (r.error) throw new Error('handler error: ' + r.error);
  console.log(`[Trim] ${r.sizeX}×${r.sizeY} bulge=${r.bulge} trim u[${r.trimUMin},${r.trimUMax}] v[${r.trimVMin},${r.trimVMax}] | faces=${r.faceCount} edges=${r.edgeCount} V=${r.volume.toFixed(2)}`);

  // Trimmed NURBS face → at least 1 face + 4 trim-window edges.
  expect(r.faceCount).toBeGreaterThanOrEqual(1);
  expect(r.edgeCount).toBeGreaterThanOrEqual(4);

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
