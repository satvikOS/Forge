import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-iges');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt IGES Round-Trip — OCCT IGES 5.3 export + import, filleted cube', async () => {
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
    window.__archdiscPlanParams['Sculpt IGES Round-Trip'] = {
      boxSize: 40, filletR: 4,
      x: 0, y: 0, z: 0, color: 0x90c6e6,
    };
  });
  await win.locator('[data-ribbon-tool-name="Sculpt IGES Round-Trip"]').first().dispatchEvent('click');
  await win.waitForFunction(
    () => window.__lastIgesReport && window.__lastIgesReport.error !== 'in progress',
    null,
    { timeout: 8 * 60 * 1000 },
  );
  const r = await win.evaluate(() => window.__lastIgesReport);
  if (r.error) throw new Error('handler error: ' + r.error);
  console.log(`[IGES] ${r.boxSize}³ fillet R=${r.filletR} | IGES ${r.igesBytes} bytes S=${r.startLines} G=${r.globalLines} D=${r.directoryLines} P=${r.parameterLines} T=${r.terminateLines}, V ${r.originalVolume.toFixed(0)} → ${r.importedVolume.toFixed(0)} relErr=${(r.volumeRelError * 100).toFixed(4)}% faces ${r.originalFaceCount}→${r.importedFaceCount} export=${r.exportMs}ms import=${r.importMs}ms`);

  // IGES file has the 5-section layout: S/G/D/P/T.
  expect(r.startLines).toBeGreaterThanOrEqual(1);
  expect(r.globalLines).toBeGreaterThanOrEqual(1);
  expect(r.directoryLines).toBeGreaterThanOrEqual(2);  // ≥ 1 directory pair
  expect(r.parameterLines).toBeGreaterThanOrEqual(1);
  expect(r.terminateLines).toBe(1);
  // Non-trivial file size.
  expect(r.igesBytes).toBeGreaterThan(5000);
  // Volume round-trip — IGES is surface-based and conversions can
  // introduce small numerical drift. We allow up to 0.5 %.
  expect(r.volumeRelError).toBeLessThan(0.005);
  // Importedfilleted box must have a positive volume.
  expect(r.importedVolume).toBeGreaterThan(0);

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
