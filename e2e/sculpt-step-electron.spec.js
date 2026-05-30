import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-step');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt STEP Round-Trip — OCCT ISO 10303 export + import, filleted cube', async () => {
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
    window.__archdiscPlanParams['Sculpt STEP Round-Trip'] = {
      boxSize: 40, filletR: 4,
      x: 0, y: 0, z: 0, color: 0xc0d4e8,
    };
  });
  await win.locator('[data-ribbon-tool-name="Sculpt STEP Round-Trip"]').first().dispatchEvent('click');
  await win.waitForFunction(
    () => window.__lastStepReport && window.__lastStepReport.error !== 'in progress',
    null,
    { timeout: 8 * 60 * 1000 },
  );
  const r = await win.evaluate(() => window.__lastStepReport);
  if (r.error) throw new Error('handler error: ' + r.error);
  console.log(`[STEP] ${r.boxSize}³ fillet R=${r.filletR} | STEP ${r.stepBytes} bytes, original V=${r.originalVolume.toFixed(0)} → imported V=${r.importedVolume.toFixed(0)} relErr=${(r.volumeRelError * 100).toFixed(4)}% faces ${r.originalFaceCount}→${r.importedFaceCount} match=${r.faceCountMatch} export=${r.exportMs}ms import=${r.importMs}ms`);
  console.log(`[STEP] header first 100 chars: ${r.stepHeader.slice(0, 100).replace(/\n/g, '\\n')}`);

  // STEP file must declare ISO-10303-21.
  expect(r.isISO10303).toBe(true);
  // A real STEP file for a filleted box is at least a few KB.
  expect(r.stepBytes).toBeGreaterThan(2000);
  // Round-trip volume conservation < 0.1 %.
  expect(r.volumeRelError).toBeLessThan(0.001);
  // Topology preserved.
  expect(r.faceCountMatch).toBe(true);
  // Original = 40³ − corner-cube reductions. With R=4 fillets on all
  // 12 edges, V ≈ 64000 minus (12 fillet-edge bands + 8 corner cubes).
  expect(r.originalVolume).toBeGreaterThan(60000);
  expect(r.originalVolume).toBeLessThan(64000);

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
