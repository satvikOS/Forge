import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-gusset');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Gusset — OCCT Weldments triangular reinforcement plate', async () => {
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
    window.__archdiscPlanParams['Sculpt Gusset'] = {
      memberLength: 500, gussetSize: 100, thickness: 6, position: 'inner',
      x: 0, y: 0, z: 0, colorMember: 0x90a8c0, colorGusset: 0x40e090,
    };
  });
  await win.locator('[data-ribbon-tool-name="Sculpt Gusset"]').first().dispatchEvent('click');
  await win.waitForFunction(
    () => window.__lastGussetReport && window.__lastGussetReport.error !== 'in progress',
    null,
    { timeout: 8 * 60 * 1000 },
  );
  const r = await win.evaluate(() => window.__lastGussetReport);
  if (r.error) throw new Error('handler error: ' + r.error);
  console.log(`[Gusset] members=${r.memberLengthMm}mm gusset leg=${r.gussetSize}mm t=${r.thickness}mm @ ${r.position} | gussetId=${r.gussetId} joint=${JSON.stringify(r.joint)} V actual=${r.actualVolume?.toFixed(0)} predicted=${r.predictedVolume}`);

  // Gusset built.
  expect(r.gussetId).toBeTruthy();
  // Joint at origin (shared endpoint of perpendicular members).
  expect(r.joint).toBeTruthy();
  for (const c of r.joint) expect(Math.abs(c)).toBeLessThan(0.01);
  // Predicted gusset triangle area × thickness analytic.
  expect(r.predictedVolume).toBe(30000);  // 0.5 × 100² × 6

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
