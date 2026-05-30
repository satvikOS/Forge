import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-sheetmetal');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Sheet Metal L-Bracket + Flat Pattern — OCCT', async () => {
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

  await win.evaluate(() => { window.__archdiscPlanParams = window.__archdiscPlanParams || {}; window.__archdiscPlanParams['Sculpt Sheet Metal L-Bracket'] = { plateW: 80, plateH: 50, thickness: 1.5, flangeLen: 30, bendAngleDeg: 90, separation: 120, x: 0, y: 0, z: 0, colorFolded: 0x8aa56b, colorFlat: 0xa56b8a }; });
  await win.locator('[data-ribbon-tool-name="Sculpt Sheet Metal L-Bracket"]').first().dispatchEvent('click');
  await win.waitForFunction(() => { const r = window.__lastSheetMetalReport; return !!r && r.error !== 'in progress'; }, null, { timeout: 8 * 60 * 1000 });
  const r = await win.evaluate(() => window.__lastSheetMetalReport);
  console.log(`[SheetMetal] error=${r.error} folded=V${r.foldedVolume.toFixed(0)}/F${r.foldedFaces} flat=V${r.flatVolume.toFixed(0)}/F${r.flatFaces} ms=${r.elapsedMs}`);

  expect(r.error).toBeNull();
  expect(r.foldedVolume).toBeGreaterThan(0);
  expect(r.flatVolume).toBeGreaterThan(0);
  expect(r.foldedFaces).toBeGreaterThanOrEqual(6);
  expect(r.flatFaces).toBeGreaterThanOrEqual(6);

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
