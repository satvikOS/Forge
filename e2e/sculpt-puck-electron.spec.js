import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-puck');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Hockey Puck — OCCT cyl + filletAll', async () => {
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

  await win.evaluate(() => { window.__archdiscPlanParams = window.__archdiscPlanParams || {}; window.__archdiscPlanParams['Sculpt Hockey Puck'] = { R: 40, height: 20, rim: 4, x: 0, y: 0, z: 0, color: 0x1a1a1a }; });
  await win.locator('[data-ribbon-tool-name="Sculpt Hockey Puck"]').first().dispatchEvent('click');
  await win.waitForFunction(() => !!window.__lastPuckReport, null, { timeout: 8 * 60 * 1000 });
  const r = await win.evaluate(() => window.__lastPuckReport);
  console.log(`[Puck] Ø${r.R * 2}×${r.height} rim ${r.rim} cylV=${r.cylVolume.toFixed(0)} actual=${r.actualVolume.toFixed(0)} faces=${r.faceCount}`);

  expect(r.actualVolume).toBeGreaterThan(0);
  expect(r.actualVolume).toBeLessThan(r.cylVolume);   // fillet removes material
  expect(r.faceCount).toBeGreaterThanOrEqual(5);      // 1 lateral + 2 top/bot + 2 rim fillets

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
