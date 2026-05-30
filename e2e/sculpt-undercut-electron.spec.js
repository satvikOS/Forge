import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-undercut');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Undercut Analysis — OCCT mold QC shadow-ray, frustum', async () => {
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
    window.__archdiscPlanParams['Sculpt Undercut Analysis'] = {
      r1: 20, r2: 10, h: 30, threshold: 3,
      x: 0, y: 0, z: 0, color: 0xf5b074,
    };
  });
  await win.locator('[data-ribbon-tool-name="Sculpt Undercut Analysis"]').first().dispatchEvent('click');
  await win.waitForFunction(
    () => window.__lastUndercutReport && window.__lastUndercutReport.error !== 'in progress',
    null,
    { timeout: 8 * 60 * 1000 },
  );
  const r = await win.evaluate(() => window.__lastUndercutReport);
  if (r.error) throw new Error('handler error: ' + r.error);
  console.log(`[Undercut] r1=${r.r1} r2=${r.r2} h=${r.h} threshold=${r.threshold}° → faces=${r.faceCount} good=${r.good} undercut=${r.undercut} neutral=${r.neutral} per=${JSON.stringify(r.perFace)}`);

  // Frustum (r1=20, r2=10, h=30): 3 faces total.
  expect(r.faceCount).toBe(3);
  // Top cap + lateral are 'good' (face +Z). Bottom cap is 'undercut'
  // (faces -Z, shadow-ray hits top cap).
  expect(r.good).toBe(2);
  expect(r.undercut).toBe(1);
  expect(r.neutral).toBe(0);
  // The undercut face must have at least one shadow ray hit confirming.
  const uc = r.perFace.find((f) => f.category === 'undercut');
  expect(uc).toBeTruthy();
  expect(uc.shadowHits).toBeGreaterThan(0);

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
