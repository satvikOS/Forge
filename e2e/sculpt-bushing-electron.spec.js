import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-bushing');
fs.mkdirSync(OUT, { recursive: true });

const BUSHINGS = [
  { label: '01-thin',  params: { outerR: 20, innerR: 17, height: 40, x: -100, y: 0, z: 0, color: 0x9aa3ad } },
  { label: '02-med',   params: { outerR: 25, innerR: 15, height: 40, x:    0, y: 0, z: 0, color: 0xad9a6b } },
  { label: '03-thick', params: { outerR: 30, innerR: 10, height: 40, x:  100, y: 0, z: 0, color: 0x6bad9a } },
];

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Hollow Cylinder — OCCT cyl − cyl', async () => {
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
    const vp = window.__archdiscViewport;
    if (!vp?.camera) return;
    if (vp.orbitControls) { vp.orbitControls.maxDistance = 20; vp.orbitControls.minDistance = 0.05; }
    vp.camera.position.set(0.10, 0.30, 0.40);
    vp.orbitControls.target.set(0, 0, 0);
    vp.camera.lookAt(0, 0, 0);
    vp.orbitControls.update();
    vp.renderer.render(vp.scene, vp.camera);
  });
  await win.waitForTimeout(1500);
  await win.screenshot({ path: path.join(OUT, '00-before.png') });

  const reports = [];
  for (let i = 0; i < BUSHINGS.length; i++) {
    const cfg = BUSHINGS[i];
    await win.evaluate((c) => {
      window.__archdiscPlanParams = window.__archdiscPlanParams || {};
      window.__archdiscPlanParams['Sculpt Hollow Cylinder'] = c.params;
    }, cfg);
    await win.locator('[data-ribbon-tool-name="Sculpt Hollow Cylinder"]').first().dispatchEvent('click');
    const tmax = i === 0 ? 8 * 60 * 1000 : 60_000;
    await win.waitForFunction(
      (expected) => { const r = window.__lastBushingReport; return !!r && r.outerR === expected.outerR && r.innerR === expected.innerR; },
      { outerR: cfg.params.outerR, innerR: cfg.params.innerR }, { timeout: tmax }
    );
    const r = await win.evaluate(() => window.__lastBushingReport);
    reports.push({ ...cfg, report: r });
    console.log(`[Sculpt Bushing] ${cfg.label}: R=${r.outerR} r=${r.innerR} predicted=${r.predictedVolume.toFixed(0)} actual=${r.actualVolume.toFixed(0)} relErr=${(r.relError*100).toFixed(3)}% faces=${r.faceCount}`);
    await win.waitForTimeout(2000);
    await win.screenshot({ path: path.join(OUT, `${cfg.label}.png`) });
  }

  for (const { report: r } of reports) {
    expect(r.actualVolume).toBeGreaterThan(0);
    expect(r.relError).toBeLessThan(0.005);
    expect(r.faceCount).toBeGreaterThanOrEqual(3);
  }
  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
