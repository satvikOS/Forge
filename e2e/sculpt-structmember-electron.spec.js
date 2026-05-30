import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-structmember');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Structural Member — OCCT Weldments IPE-200, 2 m straight', async () => {
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
    window.__archdiscPlanParams['Sculpt Structural Member'] = {
      lengthM: 2, x: 0, y: 0, z: 0, color: 0x8094a8,
    };
  });
  await win.locator('[data-ribbon-tool-name="Sculpt Structural Member"]').first().dispatchEvent('click');
  await win.waitForFunction(
    () => window.__lastStructMemberReport && window.__lastStructMemberReport.error !== 'in progress',
    null,
    { timeout: 8 * 60 * 1000 },
  );
  const r = await win.evaluate(() => window.__lastStructMemberReport);
  if (r.error) throw new Error('handler error: ' + r.error);
  console.log(`[StructMember] ${r.profile} L=${r.lengthMM}mm csArea=${r.crossSectionArea.toFixed(1)}mm² predicted=${r.predictedVolume.toFixed(0)} actual=${r.actualVolume.toFixed(0)} relErr=${(r.relError * 100).toFixed(3)}% faces=${r.faceCount}`);

  // 80×80 SHS — outer rect area.
  expect(Math.abs(r.crossSectionArea - 6400)).toBeLessThan(0.1);
  // Volume = csArea × length within 0.5 %.
  expect(r.relError).toBeLessThan(0.005);
  // Square tube extrude has 4 lateral faces + 2 caps = 6.
  expect(r.faceCount).toBe(6);

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
