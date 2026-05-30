import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-pushpull');
fs.mkdirSync(OUT, { recursive: true });

const CASES = [
  { label: '01-push10',  params: { dx: 60, dy: 40, dz: 30, distance:  10, x: -120, y: 0, z: 0, color: 0x7aa382 } },
  { label: '02-push25',  params: { dx: 60, dy: 40, dz: 30, distance:  25, x:    0, y: 0, z: 0, color: 0xa37a82 } },
  { label: '03-pull-10', params: { dx: 60, dy: 40, dz: 30, distance: -10, x:  120, y: 0, z: 0, color: 0x827aa3 } },
];

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Push-Pull Box — OCCT direct-modeling face shift', async () => {
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

  const reports = [];
  for (let i = 0; i < CASES.length; i++) {
    const cfg = CASES[i];
    await win.evaluate((c) => { window.__archdiscPlanParams = window.__archdiscPlanParams || {}; window.__archdiscPlanParams['Sculpt Push-Pull Box'] = c.params; }, cfg);
    await win.locator('[data-ribbon-tool-name="Sculpt Push-Pull Box"]').first().dispatchEvent('click');
    const tmax = i === 0 ? 8 * 60 * 1000 : 60_000;
    await win.waitForFunction(
      (expected) => { const r = window.__lastPushPullReport; return !!r && r.distance === expected.distance && r.error !== 'in progress'; },
      { distance: cfg.params.distance }, { timeout: tmax }
    );
    const r = await win.evaluate(() => window.__lastPushPullReport);
    reports.push({ ...cfg, report: r });
    console.log(`[Push-Pull] ${cfg.label}: d=${r.distance} topFace#${r.topFaceIndex} predicted=${r.predictedVolume.toFixed(0)} actual=${r.actualVolume.toFixed(0)} relErr=${(r.relError*100).toFixed(3)}% faces=${r.faceCount}`);
    await win.waitForTimeout(2000);
  }

  for (const { report: r } of reports) {
    expect(r.actualVolume).toBeGreaterThan(0);
    expect(r.relError).toBeLessThan(0.005);
    // Push grows new faces (BRepFeat_MakePrism appends a step), pull stays simple.
    expect(r.faceCount).toBeGreaterThanOrEqual(6);
  }

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
