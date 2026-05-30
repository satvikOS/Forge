import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-infer');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Infer Feature — OCCT face classification, filleted cube', async () => {
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
    window.__archdiscPlanParams['Sculpt Infer Feature'] = {
      boxSize: 40, filletR: 6,
      x: 0, y: 0, z: 0, color: 0xd0d4dc,
    };
  });
  await win.locator('[data-ribbon-tool-name="Sculpt Infer Feature"]').first().dispatchEvent('click');
  await win.waitForFunction(
    () => window.__lastInferReport && window.__lastInferReport.error !== 'in progress',
    null,
    { timeout: 8 * 60 * 1000 },
  );
  const r = await win.evaluate(() => window.__lastInferReport);
  if (r.error) throw new Error('handler error: ' + r.error);
  console.log(`[Infer] ${r.boxSize}³ fillet R=${r.filletR} | ${r.faceCount} faces classified ${JSON.stringify(r.tally)}`);

  // Filleted cube must have 26 faces (6 planar + 12 fillet bands + 8 corner blends).
  expect(r.faceCount).toBe(26);
  // 6 planar faces → 'planar-step'.
  expect(r.tally['planar-step']).toBe(6);
  // 12 fillet bands → 'hole' (concave cylindrical bands).
  expect(r.tally['hole']).toBe(12);
  // 8 corner spherical blends → 'sphere-face'.
  expect(r.tally['sphere-face']).toBe(8);
  const total = Object.values(r.tally).reduce((a, b) => a + b, 0);
  expect(total).toBe(26);
  // Confidence values must be in [0, 1].
  for (const f of r.perFace) {
    if (f.confidence != null) {
      expect(f.confidence).toBeGreaterThanOrEqual(0);
      expect(f.confidence).toBeLessThanOrEqual(1);
    }
  }

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
