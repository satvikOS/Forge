import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-weldbead');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Weld Bead — OCCT Weldments fillet bead at perpendicular joint', async () => {
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
    window.__archdiscPlanParams['Sculpt Weld Bead'] = {
      memberLength: 500, beadSize: 6, beadType: 'fillet',
      x: 0, y: 0, z: 0, colorMember: 0x90a8c0, colorBead: 0xe6a040,
    };
  });
  await win.locator('[data-ribbon-tool-name="Sculpt Weld Bead"]').first().dispatchEvent('click');
  await win.waitForFunction(
    () => window.__lastWeldBeadReport && window.__lastWeldBeadReport.error !== 'in progress',
    null,
    { timeout: 8 * 60 * 1000 },
  );
  const r = await win.evaluate(() => window.__lastWeldBeadReport);
  if (r.error) throw new Error('handler error: ' + r.error);
  console.log(`[WeldBead] members=${r.memberLengthMm}mm bead=${r.beadType}×${r.beadSize}mm | weldId=${r.weldId} joint=${JSON.stringify(r.joint)} beadL=${r.beadLength}`);

  // Weld bead built.
  expect(r.weldId).toBeTruthy();
  // Joint is at origin (where both members share an endpoint).
  expect(r.joint).toBeTruthy();
  for (const c of r.joint) expect(Math.abs(c)).toBeLessThan(0.01);
  // Bead length is non-zero.
  expect(r.beadLength).toBeGreaterThan(0);

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
