import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-jog');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Sheet Metal Jog — OCCT Z-fold, 100×60×2 + jog 10×20×90°', async () => {
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
    window.__archdiscPlanParams['Sculpt Sheet Metal Jog'] = {
      plateX: 100, plateY: 60, thickness: 2,
      jogOffset: 10, flangeLength: 20, angleDeg: 90, edgeIdx: 4,
      x: 0, y: 0, z: 0, color: 0xb8dabd,
    };
  });
  await win.locator('[data-ribbon-tool-name="Sculpt Sheet Metal Jog"]').first().dispatchEvent('click');
  await win.waitForFunction(
    () => window.__lastJogReport && window.__lastJogReport.error !== 'in progress',
    null,
    { timeout: 8 * 60 * 1000 },
  );
  const r = await win.evaluate(() => window.__lastJogReport);
  if (r.error) throw new Error('handler error: ' + r.error);
  console.log(`[Jog] ${r.plateX}×${r.plateY}×${r.thickness} + offset ${r.jogOffset} flange ${r.flangeLength} angle ${r.angleDeg}° edge ${r.edgeIdx} | base V=${r.baseVolume.toFixed(0)} final V=${r.finalVolume.toFixed(0)} faces ${r.baseFaceCount}→${r.finalFaceCount} totalBends=${r.totalBendCount} jogBends=${r.jogBendCount} start=${JSON.stringify(r.jogStart)} end=${JSON.stringify(r.jogEnd)}`);

  // Base 100·60·2 = 12000 mm³.
  expect(Math.abs(r.baseVolume - 12000)).toBeLessThan(1);
  // Jog adds 2 bends: a riser + counter-bend.
  expect(r.totalBendCount).toBe(2);
  expect(r.jogBendCount).toBe(2);
  expect(r.jogStart).toBeTruthy();
  expect(r.jogEnd).toBeTruthy();
  // Start (riser) length = jogOffset.
  expect(r.jogStart.length).toBe(r.jogOffset);
  expect(r.jogStart.angleDeg).toBe(r.angleDeg);
  // End (counter-bend) length = flangeLength, angle negated.
  expect(r.jogEnd.length).toBe(r.flangeLength);
  expect(r.jogEnd.angleDeg).toBe(-r.angleDeg);
  // Riser adds 100·10·2 = 2000 mm³, top section adds 100·20·2 = 4000 mm³.
  // Total ≈ 12000 + 6000 = 18000 mm³.
  expect(r.finalVolume).toBeGreaterThan(17000);
  expect(r.finalVolume).toBeLessThan(19000);

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
