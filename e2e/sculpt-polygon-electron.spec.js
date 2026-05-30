import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-polygon');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Polygon Prism — OCCT N-gon extrude (N=3,5,8,12)', async () => {
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

  for (let i = 0; i < 4; i++) {
    const N = [3, 5, 8, 12][i];
    await win.evaluate((c) => { window.__archdiscPlanParams = window.__archdiscPlanParams || {}; window.__archdiscPlanParams['Sculpt Polygon Prism'] = c; },
      { sides: N, radius: 25, height: 20, x: -120 + i * 80, y: 0, z: 0, color: 0x9aaa82 });
    await win.locator('[data-ribbon-tool-name="Sculpt Polygon Prism"]').first().dispatchEvent('click');
    const tmax = i === 0 ? 8 * 60 * 1000 : 60_000;
    await win.waitForFunction((expected) => { const r = window.__lastPrismReport; return !!r && r.sides === expected.N; }, { N }, { timeout: tmax });
    const r = await win.evaluate(() => window.__lastPrismReport);
    console.log(`[Prism N=${r.sides}] predicted=${r.predictedVolume.toFixed(0)} actual=${r.actualVolume.toFixed(0)} relErr=${(r.relError*100).toFixed(3)}% faces=${r.faceCount}`);
    expect(r.relError).toBeLessThan(0.005);
    expect(r.faceCount).toBe(N + 2);   // N sides + 2 caps
    await win.waitForTimeout(1500);
  }
  await win.waitForTimeout(3000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
